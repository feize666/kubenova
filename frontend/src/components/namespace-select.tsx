'use client';
import { Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useAuth } from './auth-context';
import { getNamespaces } from '@/lib/api/namespaces';

interface NamespaceSelectProps {
  value: string;
  onChange: (v: string) => void;
  // Namespaces dynamically discovered from already-loaded data
  knownNamespaces?: string[];
  clusterId?: string;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
}

export function NamespaceSelect({
  value,
  onChange,
  knownNamespaces = [],
  clusterId,
  disabled = false,
  loading = false,
  placeholder = "全部名称空间",
  style,
}: NamespaceSelectProps) {
  const { accessToken, isInitializing } = useAuth();
  const namespacesQuery = useQuery({
    queryKey: ['namespaces', clusterId || 'all', accessToken],
    queryFn: () => getNamespaces({ clusterId: clusterId || undefined, page: 1, pageSize: 500 }, accessToken),
    enabled: !isInitializing && Boolean(accessToken) && Boolean(clusterId) && !disabled,
    staleTime: 30_000,
  });

  const remoteNamespaces = (namespacesQuery.data?.items ?? []).map(
    (item) => item.namespace,
  );

  // Merge remote + locally discovered namespaces, deduplicate and sort
  const allNamespaces = Array.from(
    new Set([...remoteNamespaces, ...knownNamespaces]),
  ).sort();

  const options = [
    { label: '全部名称空间', value: '' },
    ...allNamespaces.map((ns) => ({ label: ns, value: ns })),
  ];

  return (
    <Select
      className="resource-filter-select resource-filter-select--namespace"
      style={{ width: '100%', ...style }}
      value={value}
      onChange={onChange}
      options={options}
      loading={loading || namespacesQuery.isLoading}
      disabled={disabled}
      showSearch
      placeholder={placeholder}
      filterOption={(input, option) =>
        (option?.value as string)?.toLowerCase().includes(input.toLowerCase())
      }
      allowClear
      onClear={() => onChange('')}
    />
  );
}
