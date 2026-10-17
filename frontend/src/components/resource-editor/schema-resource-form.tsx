"use client";

import { Alert, Button, Form, Input, InputNumber, Select, Space, Switch, Typography } from 'antd';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { getManifestValue } from '@/lib/resource-editor';
import type { ResourceFormProps } from '@/lib/resource-editor';
import { isRecord, parseIntOrString } from './native-model';
import type { FieldPath } from './native-model';
import { hiddenSchemaFields, schemaInitialValue, schemaProperties, schemaType, updateSchemaField, validateResourceSchema, validateSchemaValue } from './schema-model';
import type { ResourceSchema } from './schema-model';
import styles from './native-form.module.css';

export { validateResourceSchema } from './schema-model';
export type { SchemaIssue } from './schema-model';

type EditorProps = {
  schema: ResourceSchema; value: unknown; path: FieldPath; label: string; required?: boolean;
  disabled: boolean; onChange: (path: FieldPath, value: unknown) => void;
};

function SchemaField({ schema, value, path, label, required = false, disabled, onChange }: EditorProps) {
  const [newKey, setNewKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [touched, setTouched] = useState(false);
  const [removedRows, setRemovedRows] = useState<unknown[] | null>(null);
  const locked = disabled || schema.readOnly === true;
  const type = schemaType(schema);
  const issues = schema.readOnly ? [] : validateSchemaValue(schema, value, path.join('.'));
  const missing = !schema.readOnly && required && value === undefined;
  const change = (next: unknown) => { if (!locked) { setTouched(true); setRemovedRows(null); onChange(path, next); } };
  const child = (definition: ResourceSchema, next: unknown, key: string | number, required = false) => <SchemaField key={key} schema={definition} value={next} path={[...path, key]} label={String(definition.title ?? key)} required={required} disabled={locked} onChange={onChange} />;
  let control: ReactNode;
  if (schema.readOnly) control = <Typography.Text type="secondary">只读字段：原值保留，不会提交修改。</Typography.Text>;
  else if (Array.isArray(schema.enum)) {
    const options = schema.enum;
    control = <Select aria-label={label} disabled={locked} style={{ width: '100%' }} value={value === undefined ? undefined : options.findIndex(option => Object.is(option, value))} placeholder="请选择" options={options.map((option, index) => ({ value: index, label: String(option) }))} onChange={index => change(options[index])} />;
  } else if (type === 'int-or-string') {
    control = <Input aria-label={label} disabled={locked} value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''} onChange={event => change(parseIntOrString(event.target.value))} />;
  } else if (type === 'object') {
    if (value !== undefined && value !== null && !isRecord(value)) control = <Alert type="warning" title="当前值不是对象；原值已保留，请使用 YAML 修正。" />;
    else {
      const map = isRecord(value) ? value : {};
      const properties = schemaProperties(schema);
      const extra = Object.entries(map).filter(([key]) => !Object.hasOwn(properties, key));
      const additional = isRecord(schema.additionalProperties) ? schema.additionalProperties : undefined;
      control = <div className={styles.section}>
        {Object.entries(properties).map(([key, definition]) => child(definition, map[key], key, Array.isArray(schema.required) && schema.required.includes(key)))}
        {additional && extra.map(([key, next]) => child(additional, next, key))}
        {!additional && extra.length > 0 && <Typography.Text type="secondary">{extra.length} 个未定义属性原样保留，不会转换为文本。</Typography.Text>}
        {additional && <Space orientation="vertical" style={{ width: '100%' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input aria-label={`${label} 新属性名称`} disabled={locked} value={newKey} placeholder="新增属性名称" onChange={event => { if (!locked) { setNewKey(event.target.value); setKeyError(''); } }} />
            <Button disabled={locked || !newKey || (typeof schema.maxProperties === 'number' && Object.keys(map).length >= schema.maxProperties)} onClick={() => {
              if (locked || !newKey) return;
              if (Object.hasOwn(map, newKey) || Object.hasOwn(properties, newKey)) { setKeyError('键名已存在，不会覆盖原值'); return; }
              if (['__proto__', 'prototype', 'constructor'].includes(newKey)) { setKeyError('不安全的字段名称'); return; }
              onChange([...path, newKey], schemaInitialValue(additional));
              setNewKey('');
              setKeyError('');
            }}>新增属性</Button>
          </Space.Compact>
          {keyError && <Typography.Text type="danger">{keyError}</Typography.Text>}
        </Space>}
        {!Object.keys(properties).length && !extra.length && !additional && <Typography.Text type="secondary">空对象；可保留或取消设置。</Typography.Text>}
      </div>;
    }
  } else if (type === 'array') {
    const item = isRecord(schema.items) ? schema.items : {};
    if (value !== undefined && value !== null && !Array.isArray(value)) control = <Alert type="warning" title="当前值不是数组；原值已保留，请使用 YAML 修正。" />;
    else {
      const rows = Array.isArray(value) ? value : [];
      control = <Space orientation="vertical" style={{ width: '100%' }}>
        {rows.map((row, index) => <div key={index} className={styles.repeat}>
          <div className={styles.repeatHeader}><Typography.Text strong>第 {index + 1} 项</Typography.Text><Button danger disabled={locked || (typeof schema.minItems === 'number' && rows.length <= schema.minItems)} aria-label={`删除 ${label} 第 ${index + 1} 项`} onClick={() => { change(rows.filter((_, i) => i !== index)); setRemovedRows(rows); }}>删除</Button></div>
          {child(item, row, index, true)}
        </div>)}
        {removedRows && <Button disabled={locked} onClick={() => change(removedRows)}>撤销删除</Button>}
        {!rows.length && <Typography.Text type="secondary">暂无条目。新增项按 Schema 创建真实类型，不写入 null。</Typography.Text>}
        <Button disabled={locked || (typeof schema.maxItems === 'number' && rows.length >= schema.maxItems)} onClick={() => change([...rows, schemaInitialValue(item)])}>新增{label}项</Button>
      </Space>;
    }
  } else if (type === 'boolean') {
    control = <Space><Switch aria-label={label} disabled={locked} checked={value === true} onChange={change} /><Typography.Text type="secondary">{value === undefined ? '未设置（不是 false）' : value === true ? 'true' : 'false'}</Typography.Text>{value === undefined && <Button size="small" disabled={locked} onClick={() => change(false)}>设为 false</Button>}</Space>;
  } else if (type === 'number' || type === 'integer') {
    control = <InputNumber aria-label={label} disabled={locked} style={{ width: '100%' }} value={typeof value === 'number' ? value : null} min={typeof schema.minimum === 'number' ? schema.minimum : undefined} max={typeof schema.maximum === 'number' ? schema.maximum : undefined} precision={type === 'integer' ? 0 : undefined} onChange={next => change(next ?? undefined)} />;
  } else if (type === 'string') {
    if (value !== undefined && value !== null && typeof value !== 'string') control = <Alert type="warning" title="当前值不是字符串；未做强制转换，请使用 YAML 修正。" />;
    else control = schema.format === 'password' ? <Input.Password aria-label={label} autoComplete="new-password" disabled={locked} value={typeof value === 'string' ? value : ''} onChange={event => change(event.target.value)} /> : <Input.TextArea aria-label={label} disabled={locked} autoSize={{ minRows: 1, maxRows: 8 }} value={typeof value === 'string' ? value : ''} onChange={event => change(event.target.value)} />;
  } else control = <Alert type="warning" title="无法安全编辑该类型，请使用 YAML。" />;
  return <Form.Item data-resource-editor-pending={missing || issues.length ? 'true' : undefined} label={label} required={required} validateStatus={touched && (missing || issues.length) ? 'error' : undefined} help={touched ? missing ? '必填字段未设置' : issues.map(issue => `${issue.path}: ${issue.message}`).join('；') || undefined : undefined} extra={<Space orientation="vertical" size={2}>
    {typeof schema.description === 'string' && <Typography.Text type="secondary">{schema.description}</Typography.Text>}
    {!required && value !== undefined && !schema.readOnly && <Button size="small" disabled={locked} onClick={() => change(undefined)}>取消设置</Button>}
    {value === undefined && !schema.readOnly && ['object', 'array', 'string'].includes(type) && <Button size="small" disabled={locked} onClick={() => change(schemaInitialValue(schema))}>设置{type === 'string' ? '空文本' : type === 'array' ? '数组' : '对象'}</Button>}
  </Space>}><div onBlurCapture={() => setTouched(true)}>{control}</div></Form.Item>;
}

export function SchemaResourceForm({ value, onChange, schema, disabled = false, mode }: ResourceFormProps & { schema: ResourceSchema }) {
  const [error, setError] = useState('');
  const issues = validateResourceSchema(schema);
  const properties = schemaProperties(schema);
  const visible = Object.entries(properties).filter(([key]) => !hiddenSchemaFields.has(key));
  if (issues.length) return <Alert type="warning" title="Schema 无法安全渲染，请使用 YAML 回退。" description={issues.map(issue => `${issue.path}: ${issue.message}`).join('；')} />;
  return <Space orientation="vertical" className={styles.form} style={{ width: '100%' }}>
    <Typography.Text type="secondary">按服务端 Schema 编辑；{mode === 'edit' ? '编辑模式锁定身份与只读字段。' : '只读字段不会改写。'}未展示属性保持原样，集群准入校验仍以服务器为准。</Typography.Text>
    {error && <Alert type="error" title="修改未应用" description={error} />}
    {visible.map(([key, definition]) => <SchemaField key={key} schema={definition} value={getManifestValue(value, [key])} path={[key]} label={String(definition.title ?? key)} required={Array.isArray(schema.required) && schema.required.includes(key)} disabled={disabled} onChange={(path, next) => {
      if (disabled) return;
      try {
        const updated = updateSchemaField(value, schema, path, next, disabled);
        if (updated !== value) onChange(updated);
        setError('');
      } catch (reason) { setError(reason instanceof Error ? reason.message : '字段值无效'); }
    }} />)}
    {!visible.length && <Alert type="info" title="未提供可编辑的 Schema 属性，请使用 YAML 编辑器。" />}
  </Space>;
}

export default SchemaResourceForm;
