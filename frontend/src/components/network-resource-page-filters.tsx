"use client";

import type { ReactNode } from "react";
import { ResourceClusterNamespaceFilters } from "@/components/resource-cluster-namespace-filters";

type Option = { label: string; value: string };

type NetworkResourcePageFiltersProps = {
  clusterId: string;
  namespace: string;
  keywordInput: string;
  clusterOptions: Option[];
  clusterLoading?: boolean;
  clusterUnavailable?: boolean;
  knownNamespaces: string[];
  namespaceLoading?: boolean;
  namespaceDisabled?: boolean;
  namespacePlaceholder?: string;
  onClusterChange: (value: string) => void;
  onNamespaceChange: (value: string) => void;
  onScopeChange?: (clusterId: string, namespace: string) => void;
  onKeywordInputChange: (value: string) => void;
  onSearch: () => void;
  extraFilters?: ReactNode;
  keywordPlaceholder?: string;
  marginBottom?: number;
  showKeywordSearch?: boolean;
};

export function NetworkResourcePageFilters({
  clusterId,
  namespace,
  keywordInput,
  clusterOptions,
  clusterLoading,
  clusterUnavailable = false,
  knownNamespaces,
  namespaceLoading = false,
  namespaceDisabled,
  namespacePlaceholder,
  onClusterChange,
  onNamespaceChange,
  onScopeChange,
  onKeywordInputChange,
  onSearch,
  extraFilters,
  keywordPlaceholder = "按名称/标签搜索",
  marginBottom,
  showKeywordSearch = false,
}: NetworkResourcePageFiltersProps) {
  return (
    <ResourceClusterNamespaceFilters
      clusterId={clusterId}
      namespace={namespace}
      keywordInput={keywordInput}
      clusterOptions={clusterOptions}
      clusterLoading={clusterLoading}
      clusterUnavailable={clusterUnavailable}
      knownNamespaces={knownNamespaces}
      namespaceLoading={namespaceLoading}
      namespaceDisabled={namespaceDisabled}
      namespacePlaceholder={namespacePlaceholder}
      onClusterChange={onClusterChange}
      onNamespaceChange={onNamespaceChange}
      onScopeChange={onScopeChange}
      onKeywordInputChange={onKeywordInputChange}
      onSearch={onSearch}
      extraFilters={extraFilters}
      keywordPlaceholder={keywordPlaceholder}
      marginBottom={marginBottom}
      showKeywordSearch={showKeywordSearch}
    />
  );
}
