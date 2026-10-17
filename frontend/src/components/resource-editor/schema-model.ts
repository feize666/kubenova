import { getManifestValue, setManifestValue } from '@/lib/resource-editor';
import type { ResourceManifest } from '@/lib/resource-editor';
import { assertSafeValue, isRecord } from './native-model';
import type { FieldPath } from './native-model';

export type ResourceSchema = Record<string, unknown>;
export type SchemaIssue = { path: string; message: string };
export const hiddenSchemaFields = new Set(['apiVersion', 'kind', 'metadata', 'status']);
export function schemaProperties(schema: ResourceSchema): Record<string, ResourceSchema> {
  return isRecord(schema.properties) ? schema.properties as Record<string, ResourceSchema> : {};
}
export function isIntOrString(schema: ResourceSchema): boolean { return schema.format === 'int-or-string' || schema['x-kubernetes-int-or-string'] === true; }
export function schemaType(schema: ResourceSchema): string {
  if (isIntOrString(schema)) return 'int-or-string';
  if (typeof schema.type === 'string') return schema.type;
  if (schema.properties || schema.additionalProperties) return 'object';
  if (Array.isArray(schema.enum) && schema.enum.length) return typeof schema.enum[0] === 'number' ? 'number' : typeof schema.enum[0];
  return '';
}

export function validateResourceSchema(schema: ResourceSchema): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (!isRecord(node)) { issues.push({ path, message: '缺少明确 Schema，请使用 YAML' }); return; }
    if (node.readOnly === true) return;
    if (depth > 30) { issues.push({ path, message: 'Schema 嵌套过深，请使用 YAML' }); return; }
    for (const key of ['$ref', 'oneOf', 'anyOf', 'allOf', 'not', 'patternProperties', 'dependencies', 'dependentSchemas', 'if', 'then', 'else', 'contains', 'prefixItems', 'x-kubernetes-validations']) {
      if (!(key in node)) continue;
      // Kubernetes' standard int-or-string union is explicitly supported.
      if (key === 'anyOf' && isIntOrString(node) && Array.isArray(node.anyOf) && node.anyOf.length === 2 && node.anyOf.every(child => isRecord(child) && ['integer', 'string'].includes(String(child.type)) && Object.keys(child).length === 1)) continue;
      issues.push({ path, message: `不支持 ${key}，请使用 YAML 回退` });
    }
    const type = schemaType(node);
    if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'int-or-string'].includes(type)) issues.push({ path, message: '字段类型不明确或不支持，请使用 YAML' });
    if (Array.isArray(node.enum) && node.enum.some(item => !['string', 'number', 'boolean'].includes(typeof item))) issues.push({ path, message: '复杂枚举请使用 YAML' });
    if (typeof node.pattern === 'string') { try { new RegExp(node.pattern); } catch { issues.push({ path, message: '正则约束无法识别，请使用 YAML' }); } }
    if (type === 'object') {
      for (const [key, child] of Object.entries(schemaProperties(node))) {
        if (path === '$' && hiddenSchemaFields.has(key)) continue;
        if (['__proto__', 'prototype', 'constructor'].includes(key)) { issues.push({ path, message: 'Schema 包含不安全的字段名' }); continue; }
        walk(child, `${path}.${key}`, depth + 1);
      }
      if (node.additionalProperties === true || (node['x-kubernetes-preserve-unknown-fields'] === true && !Object.keys(schemaProperties(node)).length)) issues.push({ path, message: '任意类型对象没有安全的字段定义，请使用 YAML' });
      else if (node.additionalProperties !== undefined && node.additionalProperties !== false) walk(node.additionalProperties, path + '.*', depth + 1);
    }
    if (type === 'array') walk(node.items, path + '[]', depth + 1);
  };
  walk(schema, '$', 0);
  return issues;
}

export function schemaInitialValue(schema: ResourceSchema): unknown {
  if (schema.default !== undefined && !validateSchemaValue(schema, schema.default).length) return structuredClone(schema.default);
  if (Array.isArray(schema.enum) && schema.enum.length) return structuredClone(schema.enum[0]);
  switch (schemaType(schema)) {
    case 'boolean': return false;
    case 'integer':
    case 'number': return typeof schema.minimum === 'number' ? schema.minimum : 0;
    case 'array': return [];
    case 'object': return Object.fromEntries(Object.entries(schemaProperties(schema)).filter(([key, child]) => Array.isArray(schema.required) && schema.required.includes(key) && !child.readOnly).map(([key, child]) => [key, schemaInitialValue(child)]));
    default: return '';
  }
}

export function validateSchemaValue(schema: ResourceSchema, value: unknown, path = '$'): SchemaIssue[] {
  if (value === undefined || schema.readOnly === true || (value === null && schema.nullable === true)) return [];
  const issues: SchemaIssue[] = [];
  const error = (message: string) => issues.push({ path, message });
  const type = schemaType(schema);
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) error('必须选择枚举值');
  if (type === 'int-or-string') {
    if (!(typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)))) error('必须是字符串或整数');
    return issues;
  }
  if (type === 'object') {
    if (!isRecord(value)) { error('必须是对象'); return issues; }
    const properties = schemaProperties(schema);
    if (Array.isArray(schema.required)) for (const key of schema.required) if (typeof key === 'string' && !(path === '$' && hiddenSchemaFields.has(key)) && !properties[key]?.readOnly && value[key] === undefined) issues.push({ path: `${path}.${key}`, message: '必填字段未设置' });
    for (const [key, child] of Object.entries(value)) {
      if (path === '$' && hiddenSchemaFields.has(key)) continue;
      const definition = properties[key] ?? (isRecord(schema.additionalProperties) ? schema.additionalProperties : undefined);
      if (definition) issues.push(...validateSchemaValue(definition, child, `${path}.${key}`));
    }
    if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) error(`至少 ${schema.minProperties} 个属性`);
    if (typeof schema.maxProperties === 'number' && Object.keys(value).length > schema.maxProperties) error(`最多 ${schema.maxProperties} 个属性`);
  } else if (type === 'array') {
    if (!Array.isArray(value)) { error('必须是数组'); return issues; }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) error(`至少 ${schema.minItems} 项`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) error(`最多 ${schema.maxItems} 项`);
    if (schema.uniqueItems === true && new Set(value.map(item => JSON.stringify(item))).size !== value.length) error('数组项不能重复');
    value.forEach((item, index) => {
      if (item === undefined) issues.push({ path: `${path}[${index}]`, message: '数组不能包含未定义项' });
      else if (isRecord(schema.items)) issues.push(...validateSchemaValue(schema.items, item, `${path}[${index}]`));
    });
  } else if (type === 'integer' || type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) error('必须是有限数字');
    else {
      if (type === 'integer' && !Number.isInteger(value)) error('必须是整数');
      if (typeof schema.minimum === 'number' && (value < schema.minimum || (schema.exclusiveMinimum === true && value === schema.minimum))) error(`必须${schema.exclusiveMinimum === true ? '大于' : '不少于'} ${schema.minimum}`);
      if (typeof schema.maximum === 'number' && (value > schema.maximum || (schema.exclusiveMaximum === true && value === schema.maximum))) error(`必须${schema.exclusiveMaximum === true ? '小于' : '不大于'} ${schema.maximum}`);
      if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) error(`必须大于 ${schema.exclusiveMinimum}`);
      if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) error(`必须小于 ${schema.exclusiveMaximum}`);
      if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0 && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-8) error(`必须是 ${schema.multipleOf} 的倍数`);
    }
  } else if (type === 'string') {
    if (typeof value !== 'string') error('必须是字符串');
    else {
      const length = Array.from(value).length;
      if (typeof schema.minLength === 'number' && length < schema.minLength) error(`至少 ${schema.minLength} 个字符`);
      if (typeof schema.maxLength === 'number' && length > schema.maxLength) error(`最多 ${schema.maxLength} 个字符`);
      if (typeof schema.pattern === 'string') { try { if (!new RegExp(schema.pattern).test(value)) error('不满足格式约束'); } catch { error('无法解析格式约束，请使用 YAML'); } }
    }
  } else if (type === 'boolean' && typeof value !== 'boolean') error('必须是布尔值');
  return issues;
}

export function updateSchemaField(value: ResourceManifest, schema: ResourceSchema, path: FieldPath, next: unknown, disabled = false): ResourceManifest {
  if (disabled || hiddenSchemaFields.has(String(path[0]))) return value;
  if (path.some(key => ['__proto__', 'prototype', 'constructor'].includes(String(key)))) throw new Error('不安全的字段路径');
  let node = schema;
  for (const key of path) {
    if (node.readOnly === true) return value;
    const candidate = typeof key === 'number' ? node.items : schemaProperties(node)[key] ?? node.additionalProperties;
    if (!isRecord(candidate)) return value;
    node = candidate;
  }
  if (node.readOnly === true) return value;
  assertSafeValue(next);
  // A parent unset/replacement cannot remove a nested readOnly field.
  const keepsReadOnly = (definition: ResourceSchema, before: unknown, after: unknown): boolean => {
    if (definition.readOnly === true) return JSON.stringify(before) === JSON.stringify(after);
    if (schemaType(definition) === 'array' && Array.isArray(before) && isRecord(definition.items)) return before.every((item, index) => keepsReadOnly(definition.items as ResourceSchema, item, Array.isArray(after) ? after[index] : undefined));
    if (schemaType(definition) === 'object') {
      const properties = schemaProperties(definition);
      const entries = Object.entries(properties);
      if (isRecord(definition.additionalProperties)) {
        const keys = new Set([...Object.keys(isRecord(before) ? before : {}), ...Object.keys(isRecord(after) ? after : {})]);
        return entries.every(([key, child]) => keepsReadOnly(child, getManifestValue(before, [key]), getManifestValue(after, [key]))) && [...keys].every(key => {
          if (Object.hasOwn(properties, key)) return true;
          return keepsReadOnly(definition.additionalProperties as ResourceSchema, getManifestValue(before, [key]), getManifestValue(after, [key]));
        });
      }
      return entries.every(([key, child]) => keepsReadOnly(child, getManifestValue(before, [key]), getManifestValue(after, [key])));
    }
    return true;
  };
  if (!keepsReadOnly(node, getManifestValue(value, path), next)) return value;
  return setManifestValue(value, path, next);
}
