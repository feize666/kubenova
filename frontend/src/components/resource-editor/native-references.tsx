"use client";

import { Alert, Select, Space, Typography } from 'antd';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';
import { useState } from 'react';
import { getNetworkResources } from '@/lib/api/network';
import { apiRequest } from '@/lib/api/client';
import { getManifestValue, type ResourceManifest } from '@/lib/resource-editor';
import { isRecord, type FieldPath } from './native-model';

export function useNativeReferences(kind: string, value: ResourceManifest, clusterId?: string, token?: string) {
  const namespace = value.metadata.namespace ?? '';
  const services = useResourceListQuery({ queryKey: ['native-form-services', clusterId, namespace, token], queryFn: () => getNetworkResources({ clusterId, namespace, kind: 'Service', pageSize: 1000 }, token), enabled: kind === 'Ingress' && Boolean(clusterId && namespace && token), retry: false });
  const secrets = useResourceListQuery({ queryKey: ['native-form-secrets', clusterId, namespace, token], queryFn: ({ signal }) => apiRequest<{ items: Array<{ name: string; type?: string; keys: string[] }> }>('/api/resources/editor/config-references', { query: { clusterId, namespace, kind: 'Secret' }, token, signal }), enabled: kind === 'Ingress' && Boolean(clusterId && namespace && token), retry: false });
  const classes = useResourceListQuery({ queryKey: ['native-form-ingressclasses', clusterId, token], queryFn: ({ signal }) => apiRequest<{ items: Array<{ name: string; controller: string; isDefault: boolean }> }>('/api/resources/ingressclasses', { query: { clusterId }, token, signal }), enabled: kind === 'Ingress' && Boolean(clusterId && token), retry: false });
  return { services, secrets, classes };
}

export function NativeReferenceInput({ value, path, manifest, disabled, clusterId, token, services, secrets, classes, onChange }: {
  value: unknown; path: FieldPath; manifest: ResourceManifest; disabled: boolean; clusterId?: string; token?: string;
  services: ReturnType<typeof useNativeReferences>['services']; secrets: ReturnType<typeof useNativeReferences>['secrets']; classes: ReturnType<typeof useNativeReferences>['classes'];
  onChange: (next: unknown) => void;
}) {
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const type = path.join('.') === 'spec.ingressClassName' ? 'class' : path.at(-1) === 'secretName' ? 'secret' : path.at(-1) === 'port' ? 'port' : 'service';
  let options: Array<{ value: string; label: string }> = [];
  let loading = false;
  let readError = '';
  if (type === 'class') {
    options = (classes.data?.items ?? []).map(item => ({ value: item.name, label: `${item.name}${item.isDefault ? '（默认）' : ''}` }));
    loading = classes.isFetching; readError = classes.error?.message ?? '';
  } else if (type === 'secret') {
    options = (secrets.data?.items ?? []).filter(item => item.type === 'kubernetes.io/tls').map(item => ({ value: item.name, label: item.name }));
    loading = secrets.isFetching; readError = secrets.error?.message ?? '';
  } else if (type === 'service') {
    options = (services.data?.items ?? []).map(item => ({ value: item.name, label: item.name }));
    loading = services.isFetching; readError = services.error?.message ?? '';
  } else {
    const serviceName = getManifestValue(manifest, [...path.slice(0, -1), 'name']);
    const service = services.data?.items.find(item => item.name === serviceName);
    const ports = service?.spec?.ports;
    options = Array.isArray(ports) ? ports.filter(isRecord).filter(port => Number.isInteger(port.port)).map(port => ({ value: typeof port.name === 'string' && port.name ? `name:${port.name}` : `number:${port.port}`, label: `${typeof port.name === 'string' ? `${port.name} / ` : ''}${port.port} (${port.protocol ?? 'TCP'})` })) : [];
    loading = services.isFetching; readError = services.error?.message ?? '';
  }
  const selected = type === 'port' ? isRecord(value) ? typeof value.name === 'string' ? `name:${value.name}` : typeof value.number === 'number' ? `number:${value.number}` : undefined : undefined : typeof value === 'string' ? value : undefined;
  const missing = selected && !options.some(option => option.value === selected);
  if (missing) options.unshift({ value: selected, label: `${selected.replace(/^(name|number):/, '')}（原引用，尚未验证）` });
  return <Space orientation="vertical" style={{ width: '100%' }} data-resource-editor-pending={checking ? 'true' : undefined}>
    <Select aria-label={type === 'class' ? 'IngressClass' : type === 'secret' ? '证书 Secret' : type === 'port' ? '后端服务端口' : '后端服务名称'} showSearch allowClear disabled={disabled || checking} loading={loading || checking} value={selected} options={options} style={{ width: '100%' }} placeholder={type === 'port' ? '先选择服务，再选择已声明的端口' : '选择已有资源'} onChange={async next => {
      setError('');
      if (!next) { onChange(undefined); return; }
      if (type === 'secret') {
        if (!clusterId || !token) { setError('请选择集群后读取证书类型'); return; }
        setChecking(true);
        try {
          const secret = secrets.data?.items.find(item => item.name === next);
          if (secret?.type !== 'kubernetes.io/tls') throw new Error('请选择 kubernetes.io/tls 类型的 Secret');
          onChange(next);
        } catch (reason) { setError(reason instanceof Error ? reason.message : '无法验证证书 Secret'); }
        finally { setChecking(false); }
      } else if (type === 'port') {
        const [portType, ...parts] = next.split(':');
        const raw = parts.join(':');
        onChange(portType === 'name' ? { name: raw } : { number: Number(raw) });
      } else onChange(next);
    }} />
    {type === 'secret' && <Typography.Text type="secondary">选择后验证 TLS 类型，不显示证书或私钥内容。</Typography.Text>}
    {missing && <Typography.Text type="warning">旧引用已保留，读取失败不会自动删除。</Typography.Text>}
    {readError && <Alert type="warning" title="候选资源读取失败" description={readError} />}
    {error && <Alert type="error" title={error} />}
  </Space>;
}
