"use client";

import { Alert, Button, Collapse, Form, Input, InputNumber, Select, Space, Switch, Typography, theme } from 'antd';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getManifestValue } from '@/lib/resource-editor';
import type { ResourceFormProps } from '@/lib/resource-editor';
import { NativeAdvancedInput, NativeMapInput } from './native-controls';
import { isNativeFieldLocked, isRecord, nativeFields, nativeKind, parseIntOrString, setVolumeSource, supportsNativeResourceForm, updateNativeField, volumeSources } from './native-model';
import type { FieldPath, NativeField } from './native-model';
import { SecretResourceForm } from './secret-resource-form';
import { NativeReferenceInput, useNativeReferences } from './native-references';
import styles from './native-form.module.css';

export { supportsNativeResourceForm } from './native-model';

export function NativeResourceForm({ value, onChange, mode, disabled = false, clusterId, token: accessToken }: ResourceFormProps & { clusterId?: string; token?: string }) {
  const { token } = theme.useToken();
  const [error, setError] = useState('');
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [removed, setRemoved] = useState<{ path: FieldPath; rows: unknown[] } | null>(null);
  const kind = nativeKind(value.kind);
  const references = useNativeReferences(kind, value, clusterId, accessToken);
  const defaults = references.classes.data?.items.filter(item => item.isDefault) ?? [];
  useEffect(() => {
    if (kind === 'Ingress' && mode === 'create' && !disabled && getManifestValue(value, ['spec', 'ingressClassName']) === undefined && defaults.length === 1) onChange(updateNativeField(value, ['spec', 'ingressClassName'], defaults[0].name, mode));
  }, [kind, mode, disabled, references.classes.data]); // Only prefill when candidates are first loaded, never after an explicit clear.
  if (!supportsNativeResourceForm(kind)) return <Alert type="info" title="该资源使用 CRD Schema 表单或 YAML 编辑器" />;
  const update = (path: FieldPath, next: unknown) => {
    if (disabled) return;
    try {
      const result = updateNativeField(value, path, next, mode, disabled);
      if (result !== value) onChange(result);
      setTouched(current => new Set([...current, path.join('.')]));
      setRemoved(null);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '修改未应用'); }
  };
  const renderFields = (fields: NativeField[], prefix: FieldPath = [], inheritedLocked = false): ReactNode => fields.map(field => {
    const path = [...prefix, ...field.path];
    const current = getManifestValue(value, path);
    const parent = prefix.length ? getManifestValue(value, prefix) : value;
    if (field.when && !field.when(value, parent)) return null;
    const immutable = inheritedLocked || isNativeFieldLocked(value, path, mode);
    const locked = disabled || immutable;
    const id = path.join('.');
    const missing = field.required && (current === undefined || current === '' || (Array.isArray(current) && !current.length));
    const showError = missing && touched.has(id);
    const change = (next: unknown) => { if (!locked) update(path, next); };
    let control: ReactNode;
    switch (field.type) {
      case 'map':
        control = <NativeMapInput label={field.label} value={current} onChange={change} disabled={locked} sensitive={field.sensitive} />;
        break;
      case 'yaml':
        control = <NativeAdvancedInput label={field.label} value={current} type={field.yamlType ?? 'object'} onChange={change} disabled={locked} />;
        break;
      case 'group':
        control = current === undefined && !field.required ? <Button disabled={locked} onClick={() => change({})}>配置{field.label}</Button> : <div className={styles.section}>{renderFields(field.fields ?? [], path, immutable)}</div>;
        break;
      case 'list': {
        if (current !== undefined && !Array.isArray(current)) { control = <Alert type="warning" title="当前值不是列表，已保留原值；请使用 YAML 检查。" />; break; }
        const rows = Array.isArray(current) ? current : [];
        control = <Space orientation="vertical" style={{ width: '100%' }}>
          {!rows.length && <Typography.Text type="secondary">尚无条目，点击新增填写。</Typography.Text>}
          {rows.map((row, index) => <div key={index} className={styles.repeat}>
            <div className={styles.repeatHeader}><Typography.Text strong>{field.label} {index + 1}</Typography.Text><Button danger size="small" disabled={locked} aria-label={`删除 ${field.label} ${index + 1}`} onClick={() => { change(rows.filter((_, i) => i !== index)); setRemoved({ path, rows }); }}>删除</Button></div>
            {isRecord(row) ? renderFields(field.fields ?? [], [...path, index], immutable) : <Alert type="warning" title="条目结构不匹配，原值保留，请使用 YAML 编辑。" />}
          </div>)}
          {removed?.path.join('.') === id && <Button disabled={locked} onClick={() => change(removed.rows)}>撤销删除</Button>}
          <Button disabled={locked} onClick={() => change([...rows, structuredClone(field.initial ?? {})])}>新增{field.label}</Button>
        </Space>;
        break;
      }
      case 'boolean':
        control = <Switch aria-label={field.label} disabled={locked} checked={current === true} onChange={change} />;
        break;
      case 'select':
        control = <Select aria-label={field.label} disabled={locked} value={typeof current === 'string' ? current : undefined} placeholder="请选择" style={{ width: '100%' }} options={field.options?.map(option => ({ value: option, label: option || '（空）' }))} onChange={change} />;
        break;
      case 'tags': {
        const apiGroups = field.path.at(-1) === 'apiGroups';
        const selected = Array.isArray(current) ? current.map(item => apiGroups && item === '' ? 'core' : String(item)) : [];
        control = <Select aria-label={field.label} mode={['accessModes', 'policyTypes', 'scopes'].includes(String(field.path.at(-1))) ? 'multiple' : 'tags'} disabled={locked} value={selected} style={{ width: '100%' }} placeholder="输入后按回车添加" options={field.options?.map(option => ({ label: option, value: option }))} onChange={items => change(apiGroups ? items.map((item: string) => item === 'core' ? '' : item) : items)} />;
        break;
      }
      case 'number':
        control = <InputNumber aria-label={field.label} disabled={locked} style={{ width: '100%' }} value={typeof current === 'number' ? current : null} min={field.minimum} max={field.maximum} precision={0} onChange={next => change(next ?? undefined)} />;
        break;
      case 'service-port': {
        const port = isRecord(current) ? current : {};
        const named = typeof port.name === 'string';
        control = <Space.Compact style={{ width: '100%' }}>
          <Select aria-label={`${field.label} 模式`} disabled={locked} value={named ? 'name' : 'number'} options={[{ label: '端口号', value: 'number' }, { label: '端口名称', value: 'name' }]} onChange={type => {
            const next = { ...port }; delete next.name; delete next.number; next[type] = type === 'number' ? 80 : ''; change(next);
          }} />
          {named ? <Input aria-label={field.label} disabled={locked} value={String(port.name)} onChange={event => change({ ...port, name: event.target.value })} /> : <InputNumber aria-label={field.label} disabled={locked} min={1} max={65535} precision={0} value={typeof port.number === 'number' ? port.number : null} onChange={number => change(number === null ? undefined : { ...port, number })} />}
        </Space.Compact>;
        break;
      }
      case 'int-or-string':
        control = <Input aria-label={field.label} disabled={locked} value={current === undefined ? '' : String(current)} onChange={event => change(event.target.value === '' ? undefined : parseIntOrString(event.target.value))} />;
        break;
      default:
        control = current !== undefined && typeof current !== 'string' ? <Alert type="warning" title="当前值不是文本，已保留原值；请使用 YAML 编辑。" /> : <Input aria-label={field.label} disabled={locked} value={current ?? ''} onChange={event => change(event.target.value)} />;
    }
    if (kind === 'Ingress' && (id === 'spec.ingressClassName' || path.at(-1) === 'secretName' || (path.at(-2) === 'service' && ['name', 'port'].includes(String(path.at(-1)))))) control = <NativeReferenceInput value={current} path={path} manifest={value} disabled={locked} clusterId={clusterId} token={accessToken} {...references} onChange={next => { if (path.at(-1) === 'name' && current !== next) { const service = getManifestValue(value, path.slice(0, -1)); update(path.slice(0, -1), { ...(isRecord(service) ? service : {}), name: next, port: undefined }); } else change(next); }} />;
    const item = <Form.Item key={id} data-resource-editor-pending={missing ? 'true' : undefined} label={field.label} required={field.required} validateStatus={showError ? 'error' : undefined} help={showError ? '请填写必填字段' : undefined} extra={<Space orientation="vertical" size={2}>
      {immutable && <Typography.Text type="secondary">编辑模式：该字段不可变，已锁定。</Typography.Text>}
      {field.note && <Typography.Text type="secondary">{field.note}</Typography.Text>}
      {!field.required && current !== undefined && <Button size="small" disabled={locked} onClick={() => change(undefined)}>取消设置</Button>}
    </Space>}>{control}</Form.Item>;
    return field.type === 'yaml' ? <Collapse key={id} ghost items={[{ key: id, label: `${field.label}${current !== undefined ? ' · 已配置' : ''}`, children: item }]} /> : item;
  });
  const source = volumeSources.find(name => getManifestValue(value, ['spec', name]) !== undefined);
  if (kind === 'Secret') return <SecretResourceForm value={value} onChange={onChange} mode={mode} disabled={disabled} clusterId={clusterId} token={accessToken} />;
  return <Space orientation="vertical" className={styles.form} style={{ width: '100%', color: token.colorText }}>
    <Typography.Text type="secondary">{kind} 专用配置；名称、命名空间、标签与注解由上层管理。未展示字段原样保留。</Typography.Text>
    {error && <Alert type="error" title="修改未应用" description={error} />}
    {kind === 'Ingress' && defaults.length > 1 && <Alert type="warning" title="集群存在多个默认 IngressClass，请明确选择一个类。" />}
    {kind === 'IngressClass' && <Form.Item label="默认类" extra="设为默认会影响后续未指定类的 Ingress。设为默认操作及其他默认类的调整在列表中确认。"><Typography.Text>{getManifestValue(value, ['metadata', 'annotations', 'ingressclass.kubernetes.io/is-default-class']) === 'true' ? '当前为默认类' : '当前不是默认类'}</Typography.Text></Form.Item>}
    {kind === 'Service' && getManifestValue(value, ['spec', 'type']) !== 'ExternalName' && <Form.Item label="无头服务（Headless）" extra="使用 clusterIP: None；已有服务不能直接切换集群 IP。"><Switch aria-label="无头服务" disabled={disabled || mode === 'edit'} checked={getManifestValue(value, ['spec', 'clusterIP']) === 'None'} onChange={next => update(['spec', 'clusterIP'], next ? 'None' : undefined)} /></Form.Item>}
    {kind === 'Service' && getManifestValue(value, ['spec', 'type']) === 'LoadBalancer' && <Alert type="info" title="外部地址由集群负载均衡能力分配" description="若集群未配置实现，服务可能持续等待地址；创建不代表公网已开放。" />}
    {kind === 'PersistentVolume' && <Form.Item data-resource-editor-pending={!source && mode === 'create' ? 'true' : undefined} label="存储源类型" required extra={mode === 'edit' ? '存储源创建后不可变，编辑模式已锁定。' : '切换类型会移除前一种存储源，不能同时配置多个存储源。'}>
      <Select aria-label="存储源类型" disabled={disabled || mode === 'edit'} value={source} placeholder="请选择存储源" options={volumeSources.map(name => ({ label: name, value: name }))} onChange={name => { if (!disabled && mode !== 'edit') onChange(setVolumeSource(value, name, mode)); }} />
      {!source && <Typography.Text type="warning">请选择存储源；已有其他类型的源请使用 YAML 编辑。</Typography.Text>}
    </Form.Item>}
    {kind === 'Namespace' ? <Alert type="info" title="Namespace 的名称、标签与注解请在基础信息中配置，无需额外专用字段。" /> : renderFields(nativeFields(kind))}
  </Space>;
}

export default NativeResourceForm;
