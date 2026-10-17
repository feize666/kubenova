"use client";

import { Alert, Button, Form, Input, Segmented, Select, Space, Switch, Typography } from 'antd';
import { useRef, useState } from 'react';
import { apiRequest } from '@/lib/api/client';
import { getManifestValue, setManifestValue, type ResourceFormProps, type ResourceManifest } from '@/lib/resource-editor';
import { isRecord, updateNativeField } from './native-model';
import { applySecretFiles, dockerConfig, SECRET_TYPES, secretRawBytes, secretText, setDockerCredentials, validatePem, validateSecretSize, type FileDecision, type SecretFile } from './secret-model';
import styles from './native-form.module.css';

function SecretUpload({ value, onChange, disabled, fixedKey, validate }: {
  value: ResourceManifest; onChange: (value: ResourceManifest) => void; disabled: boolean;
  fixedKey?: string; validate?: (value: ResourceManifest) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<SecretFile[]>([]);
  const [decisions, setDecisions] = useState<Record<string, FileDecision>>({});
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  return <Space orientation="vertical" style={{ width: '100%' }} data-resource-editor-pending={files.length || reading ? 'true' : undefined}>
    <input ref={input} type="file" multiple={!fixedKey} disabled={disabled || reading} style={{ display: 'none' }} aria-label={fixedKey ? `上传 ${fixedKey}` : '上传密钥文件'} onChange={async event => {
      const selected = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (!selected.length || disabled) return;
      setError('');
      if (selected.length > 50) { setError('每次最多上传 50 个文件'); return; }
      if (selected.some(file => file.size > 1024 * 1024)) { setError('单文件大小不能超过 1 MiB'); return; }
      if (selected.reduce((sum, file) => sum + file.size, 0) > 900 * 1024) { setError('本次文件原始数据不能超过 900 KiB'); return; }
      setReading(true);
      try {
        const loaded = await Promise.all(selected.map(async file => ({ name: fixedKey ?? file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
        setFiles(loaded);
        setDecisions({});
      } catch { setError('文件读取失败，请重新选择'); }
      finally { setReading(false); }
    }} />
    <Button disabled={disabled || reading} loading={reading} onClick={() => input.current?.click()}>{fixedKey ? `选择 ${fixedKey} 文件` : '上传本地文件'}</Button>
    {!fixedKey && <Typography.Text type="secondary">文件名作为键名，保留原始二进制。最多 50 个文件，单文件 1 MiB，Secret 原始数据总量 900 KiB。</Typography.Text>}
    {files.map((file, index) => {
      const exists = getManifestValue(value, ['data', file.name]) !== undefined || getManifestValue(value, ['stringData', file.name]) !== undefined;
      const choice = decisions[file.name];
      return <div key={`${file.name}-${index}`} className={styles.uploadRow}>
        <Typography.Text className={styles.fileName}>{file.name}</Typography.Text><Typography.Text type="secondary">{file.bytes.length.toLocaleString()} B</Typography.Text>
        {exists ? <Space orientation="vertical" style={{ width: '100%' }}>
          <Select aria-label={`${file.name} 同名处理`} disabled={disabled} value={choice?.action} placeholder="同名键：请选择" style={{ width: '100%' }} options={[{ value: 'overwrite', label: '覆盖现有值' }, { value: 'skip', label: '跳过此文件' }, ...(!fixedKey ? [{ value: 'rename', label: '重命名键' }] : [])]} onChange={action => setDecisions(current => ({ ...current, [file.name]: { action } }))} />
          {choice?.action === 'rename' && <Input aria-label={`${file.name} 新键名`} disabled={disabled} value={choice.key ?? ''} placeholder="新键名" onChange={event => setDecisions(current => ({ ...current, [file.name]: { action: 'rename', key: event.target.value } }))} />}
        </Space> : <Typography.Text type="secondary">待添加</Typography.Text>}
      </div>;
    })}
    {files.length > 0 && <Space><Button disabled={disabled} onClick={() => {
      try { const next = applySecretFiles(value, files, decisions); validate?.(next); onChange(next); setFiles([]); setDecisions({}); setError(''); }
      catch (reason) { setError(reason instanceof Error ? reason.message : '文件尚未应用'); }
    }}>应用文件到草稿</Button><Button disabled={disabled} onClick={() => { setFiles([]); setDecisions({}); setError(''); }}>取消上传</Button></Space>}
    {error && <Alert type="error" title={error} />}
  </Space>;
}

function OpaqueSecret({ value, onChange, mode, disabled }: ResourceFormProps) {
  const [visible, setVisible] = useState(false);
  const [extraKeys, setExtraKeys] = useState<Array<{ id: number; key: string; text: string }>>([]);
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<ResourceManifest | null>(null);
  const keys = [...new Set([...Object.keys(isRecord(value.data) ? value.data : {}), ...Object.keys(isRecord(value.stringData) ? value.stringData : {})])];
  const save = (next: ResourceManifest) => { validateSecretSize(next); onChange(next); setUndo(null); setError(''); };
  const setText = (key: string, text: string) => {
    if (disabled) return;
    try { save(updateNativeField(value, ['stringData', key], text, mode)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '键值无效'); }
  };
  return <Space orientation="vertical" style={{ width: '100%' }} data-resource-editor-pending={extraKeys.length || error ? 'true' : undefined}>
    <Space><Typography.Text type="secondary">{keys.length} 个键，未编辑的原始数据保持不变。</Typography.Text><Button onClick={() => setVisible(!visible)}>{visible ? '隐藏内容' : '显示并编辑内容'}</Button></Space>
    {keys.map(key => {
      let text = ''; let binary = false;
      if (visible) { try { text = secretText(value, key); } catch { binary = true; } }
      return <div className={styles.row} key={key}>
        <Input aria-label="Secret 键名" value={key} readOnly />
        {visible ? binary ? <Typography.Text type="secondary">二进制内容已保留，可上传同名文件替换。</Typography.Text> : <Input.TextArea aria-label={`Secret ${key} 值`} disabled={disabled} autoComplete="off" value={text} autoSize={{ minRows: 1, maxRows: 8 }} onChange={event => setText(key, event.target.value)} /> : <Typography.Text type="secondary">内容已隐藏</Typography.Text>}
        <Button danger disabled={disabled} onClick={() => { const next = setManifestValue(setManifestValue(value, ['data', key], undefined), ['stringData', key], undefined); onChange(next); setUndo(value); }}>删除</Button>
      </div>;
    })}
    {extraKeys.map(row => <div className={styles.row} key={row.id}>
      <Input aria-label="新增 Secret 键名" disabled={disabled} value={row.key} placeholder="键名" onChange={event => setExtraKeys(current => current.map(item => item.id === row.id ? { ...item, key: event.target.value } : item))} />
      <Input.Password aria-label="新增 Secret 值" autoComplete="new-password" disabled={disabled} value={row.text} placeholder="值（默认隐藏）" onChange={event => setExtraKeys(current => current.map(item => item.id === row.id ? { ...item, text: event.target.value } : item))} />
      <Button disabled={disabled} onClick={() => { setExtraKeys(current => current.filter(item => item.id !== row.id)); setError(''); }}>取消</Button>
    </div>)}
    <Space wrap><Button disabled={disabled} onClick={() => setExtraKeys(current => [...current, { id: Date.now(), key: '', text: '' }])}>新增键值</Button>
      {extraKeys.length > 0 && <Button disabled={disabled} onClick={() => {
        try {
          let next = value;
          const used = new Set(keys);
          for (const row of extraKeys) {
            if (!/^[A-Za-z0-9._-]+$/.test(row.key) || ['__proto__', 'constructor', 'prototype'].includes(row.key)) throw new Error('请填写有效的键名');
            if (used.has(row.key)) throw new Error('新增键名已存在，请编辑原条目或上传时明确选择覆盖');
            used.add(row.key);
            next = updateNativeField(next, ['stringData', row.key], row.text, mode);
          }
          save(next); setExtraKeys([]);
        } catch (reason) { setError(reason instanceof Error ? reason.message : '键值无效'); }
      }}>应用新增键值</Button>}
      {undo && <Button disabled={disabled} onClick={() => { onChange(undo); setUndo(null); }}>撤销删除</Button>}
    </Space>
    {error && <Alert type="error" title={error} />}
    <SecretUpload value={value} onChange={next => { onChange(next); setUndo(null); }} disabled={Boolean(disabled)} />
  </Space>;
}

function DockerSecret({ value, onChange, disabled }: ResourceFormProps) {
  const scope = useRef<HTMLDivElement>(null);
  const [registry, setRegistry] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [method, setMethod] = useState('credentials');
  let registries: string[] = [];
  let malformed = '';
  try { registries = Object.keys(dockerConfig(value).auths as Record<string, unknown>); } catch (reason) { malformed = reason instanceof Error ? reason.message : 'Docker 配置无效'; }
  return <div ref={scope}><Space orientation="vertical" style={{ width: '100%' }} data-resource-editor-pending={registry || username || password ? 'true' : undefined}>
    {registries.length > 0 && <Typography.Text type="secondary">已配置仓库：{registries.join('、')}。新增凭据保留其他仓库及扩展字段。</Typography.Text>}
    {malformed && <Alert type="warning" title={malformed} description="原值保留，请上传有效配置或使用 YAML 修正。" />}
    <Segmented disabled={disabled} value={method} options={[{ value: 'credentials', label: '仓库凭据' }, { value: 'file', label: '配置文件' }]} onChange={next => {
      if(scope.current?.querySelector('[data-resource-editor-pending="true"]')) {setError('请先应用或取消凭据/文件草稿，再切换输入方式。');return;}
      setError('');setMethod(String(next));
    }} />
    {method === 'credentials' ? <div>
      <Form.Item label="镜像仓库地址" required><Input disabled={disabled} aria-label="镜像仓库地址" value={registry} placeholder="registry.example.com" onChange={event => setRegistry(event.target.value)} /></Form.Item>
      <Form.Item label="用户名" required><Input disabled={disabled} aria-label="镜像仓库用户名" autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} /></Form.Item>
      <Form.Item label="密码" required><Input.Password disabled={disabled} aria-label="镜像仓库密码" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></Form.Item>
      {registries.includes(registry.trim()) && <Alert type="warning" title="将替换该仓库的凭据，其他仓库保留。" />}
      <Button disabled={disabled || !registry || !username || !password} onClick={() => { try { onChange(setDockerCredentials(value, registry, username, password)); setRegistry(''); setUsername(''); setPassword(''); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : '凭据尚未应用'); } }}>应用凭据到草稿</Button>
      {(registry || username || password) && <Button disabled={disabled} onClick={()=>{setRegistry('');setUsername('');setPassword('');setError('');}}>取消凭据草稿</Button>}
    </div> : <SecretUpload value={value} disabled={Boolean(disabled)} fixedKey=".dockerconfigjson" validate={next => { dockerConfig(next); }} onChange={onChange} />}
    {error && <Alert type="error" title={error} />}
  </Space></div>;
}

function TlsSecret({ value, onChange, disabled, mode, clusterId, token }: ResourceFormProps & { clusterId?: string; token?: string }) {
  const [revealed, setRevealed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ valid: boolean; message: string } | null>(null);
  const edit = (key: string, text: string) => { if (disabled) return; try { const next = updateNativeField(value, ['stringData', key], text, mode); validateSecretSize(next); onChange(next); setResult(null); } catch (reason) { setResult({ valid: false, message: reason instanceof Error ? reason.message : '内容无效' }); } };
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Typography.Text type="secondary">支持 PEM 证书和私钥。提交前在服务端验证格式及公私钥匹配，敏感内容仅保留在当前草稿。</Typography.Text>
    <Button onClick={() => setRevealed(!revealed)}>{revealed ? '隐藏证书与私钥' : '显示并编辑证书与私钥'}</Button>
    {(['tls.crt', 'tls.key'] as const).map(key => <Form.Item key={key} label={key === 'tls.crt' ? '证书' : '私钥'} required>
      <Space orientation="vertical" style={{ width: '100%' }}>
        {revealed && (() => { try { return <Input.TextArea disabled={disabled} aria-label={key} autoComplete="off" autoSize={{ minRows: 4, maxRows: 10 }} value={secretText(value, key)} onChange={event => edit(key, event.target.value)} />; } catch { return <Alert type="warning" title="内容不是有效文本，原值保留，请上传 PEM 文件。" />; } })()}
        <SecretUpload value={value} disabled={Boolean(disabled)} fixedKey={key} onChange={next => { onChange(next); setResult(null); }} />
      </Space>
    </Form.Item>)}
    <Button disabled={!clusterId || !token || checking} loading={checking} onClick={async () => {
      setChecking(true); setResult(null);
      try {
        const certificate = secretText(value, 'tls.crt'); const privateKey = secretText(value, 'tls.key');
        validatePem(certificate, privateKey);
        await apiRequest<{ valid: true }>('/api/resources/editor/validate-tls', { method: 'POST', body: { clusterId, namespace: value.metadata.namespace, certificate, privateKey }, token });
        setResult({ valid: true, message: '证书格式及公私钥匹配检查通过' });
      } catch (reason) { setResult({ valid: false, message: reason instanceof Error ? reason.message : '证书检查失败' }); }
      finally { setChecking(false); }
    }}>检查证书与私钥</Button>
    {result && <Alert type={result.valid ? 'success' : 'error'} title={result.message} />}
  </Space>;
}

export function SecretResourceForm(props: ResourceFormProps & { clusterId?: string; token?: string }) {
  const scope = useRef<HTMLDivElement>(null);
  const [switchError, setSwitchError] = useState('');
  const { value, onChange, mode, disabled = false } = props;
  const type = typeof value.type === 'string' ? value.type : 'Opaque';
  const locked = disabled || (mode === 'edit' && value.immutable === true);
  let bytes = 0; let sizeError = '';
  try { bytes = secretRawBytes(value); validateSecretSize(value); } catch (reason) { sizeError = reason instanceof Error ? reason.message : '数据无效'; }
  return <div ref={scope} className={styles.form}>
    <Form.Item label="Secret 类型" required extra={mode === 'edit' ? '类型创建后锁定；更换类型请复制为新资源。' : '切换类型保留当前草稿数据；提交前请检查不适用的键。'}>
      <Segmented disabled={disabled || mode === 'edit'} value={type} options={[{ value: 'Opaque', label: '普通密钥' }, { value: 'kubernetes.io/dockerconfigjson', label: '镜像仓库' }, { value: 'kubernetes.io/tls', label: 'TLS 证书' }]} onChange={next => {
        if(scope.current?.querySelector('[data-resource-editor-pending="true"]:not(.ant-alert)')) {setSwitchError('请先应用或取消当前键值/文件草稿，再切换 Secret 类型。');return;}
        setSwitchError('');onChange(setManifestValue(value, ['type'], next));
      }} />
    </Form.Item>
    {switchError && <Alert type="error" title={switchError}/>}
    {mode === 'edit' && value.immutable === true && <Alert type="info" title="该 Secret 已设为不可变，数据编辑已锁定。" />}
    {!SECRET_TYPES.includes(type) ? <Alert type="info" title="该 Secret 类型使用 YAML 编辑" description="已有类型与数据完整保留，专用表单支持普通密钥、镜像仓库和 TLS。" /> : <div className={styles.section}>
      {type === 'Opaque' ? <OpaqueSecret {...props} disabled={locked} /> : type === 'kubernetes.io/dockerconfigjson' ? <DockerSecret {...props} disabled={locked} /> : <TlsSecret {...props} disabled={locked} />}
    </div>}
    <Form.Item label="不可变" extra="提交启用后不能撤销，也无法再修改数据。"><Switch aria-label="Secret 不可变" checked={value.immutable === true} disabled={disabled || (mode === 'edit' && value.immutable === true)} onChange={next => onChange(setManifestValue(value, ['immutable'], next))} /></Form.Item>
    <Typography.Text type="secondary">原始数据：{bytes.toLocaleString()} B / 900 KiB</Typography.Text>
    {sizeError && <Alert type="error" title={sizeError} data-resource-editor-pending="true" />}
  </div>;
}
