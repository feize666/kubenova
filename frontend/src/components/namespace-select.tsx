'use client';
import { Empty, Input, Select, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useMemo, useState } from 'react';
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
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

interface NamespaceFilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  namespaces: string[];
  allValue?: string;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** Single-layer namespace filter modeled after the VKE resource list control. */
export function NamespaceFilterSelect({
  value,
  onChange,
  namespaces,
  allValue = "",
  disabled = false,
  loading = false,
  placeholder = "全部命名空间",
  label = "命名空间",
  className,
  style,
}: NamespaceFilterSelectProps) {
  const options = useMemo(() => [
    { label: "全部命名空间", value: allValue },
    ...Array.from(new Set(namespaces))
      .filter((namespace) => namespace && namespace !== allValue)
      .sort((left, right) => left.localeCompare(right, "zh-CN"))
      .map((namespace) => ({ label: namespace, value: namespace })),
  ], [allValue, namespaces]);

  return (
    <Select<string>
      aria-label="选择命名空间"
      className={["namespace-filter-select", className].filter(Boolean).join(" ")}
      classNames={{ popup: { root: "namespace-filter-select-dropdown" } }}
      style={style}
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      disabled={disabled}
      showSearch
      prefix={<span className="namespace-filter-select__label">{label}:</span>}
      placeholder={placeholder}
      popupMatchSelectWidth={300}
      listHeight={288}
      notFoundContent="未找到匹配的命名空间"
      filterOption={(input, option) => {
        if (option?.value === allValue) return true;
        return String(option?.label ?? "").toLocaleLowerCase().includes(input.trim().toLocaleLowerCase());
      }}
    />
  );
}

export function NamespaceSelect({
  value,
  onChange,
  knownNamespaces = [],
  clusterId,
  disabled = false,
  loading = false,
  placeholder = "全部命名空间",
  label = "命名空间",
  className,
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

  return (
    <NamespaceFilterSelect
      className={["resource-filter-select", "resource-filter-select--namespace", className].filter(Boolean).join(" ")}
      style={{ width: '100%', ...style }}
      value={value}
      onChange={onChange}
      namespaces={allNamespaces}
      loading={loading || namespacesQuery.isLoading}
      disabled={disabled}
      placeholder={placeholder}
      label={label}
    />
  );
}

type NamespaceOptionListProps = Omit<NamespaceSelectProps, "style"> & {
  onSelect: (value: string) => void;
};

/** Direct list presentation for scope popovers; avoids a nested Select control. */
export function NamespaceOptionList({
  value,
  onChange,
  onSelect,
  knownNamespaces = [],
  clusterId,
  disabled = false,
  loading = false,
}: NamespaceOptionListProps) {
  const { accessToken, isInitializing } = useAuth();
  const [query, setQuery] = useState("");
  const namespacesQuery = useQuery({
    queryKey: ['namespaces', clusterId || 'all', accessToken],
    queryFn: () => getNamespaces({ clusterId: clusterId || undefined, page: 1, pageSize: 500 }, accessToken),
    enabled: !isInitializing && Boolean(accessToken) && Boolean(clusterId) && !disabled,
    staleTime: 30_000,
  });
  const remoteNamespaces = (namespacesQuery.data?.items ?? []).map((item) => item.namespace);
  const allNamespaces = Array.from(new Set([...remoteNamespaces, ...knownNamespaces])).sort();
  const filteredNamespaces = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? allNamespaces.filter((namespace) => namespace.toLowerCase().includes(normalized))
      : allNamespaces;
  }, [allNamespaces, query]);
  const busy = loading || namespacesQuery.isLoading;

  return (
    <div className="namespace-option-list" role="listbox" aria-label="命名空间列表" aria-disabled={disabled}>
      <Input
        aria-label="搜索命名空间"
        prefix={<SearchOutlined />}
        allowClear
        placeholder="搜索命名空间"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
      />
      {busy ? (
        <div className="namespace-option-list__state"><Spin size="small" /></div>
      ) : (
        <div className="namespace-option-list__options">
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={!value ? "is-selected" : undefined}
            onClick={() => {
              onChange("");
              onSelect("");
            }}
          >
            全部命名空间
          </button>
          {filteredNamespaces.map((namespace) => (
            <button
              key={namespace}
              type="button"
              role="option"
              aria-selected={value === namespace}
              className={value === namespace ? "is-selected" : undefined}
              onClick={() => {
                onChange(namespace);
                onSelect(namespace);
              }}
            >
              {namespace}
            </button>
          ))}
          {!filteredNamespaces.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无命名空间" /> : null}
        </div>
      )}
    </div>
  );
}
