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
  knownNamespaces: string[];
  namespaceLoading?: boolean;
  namespaceDisabled?: boolean;
  namespacePlaceholder?: string;
  onClusterChange: (value: string) => void;
  onNamespaceChange: (value: string) => void;
  onKeywordInputChange: (value: string) => void;
  onSearch: () => void;
  extraFilters?: ReactNode;
  keywordPlaceholder?: string;
};

export function NetworkResourcePageFilters({
  clusterId,
  namespace,
  keywordInput,
  clusterOptions,
  clusterLoading,
  knownNamespaces,
  namespaceLoading = false,
  namespaceDisabled,
  namespacePlaceholder,
  onClusterChange,
  onNamespaceChange,
  onKeywordInputChange,
  onSearch,
  extraFilters,
  keywordPlaceholder = "按名称/标签搜索",
}: NetworkResourcePageFiltersProps) {
  return (
    <ResourceClusterNamespaceFilters
      clusterId={clusterId}
      namespace={namespace}
      keywordInput={keywordInput}
      clusterOptions={clusterOptions}
      clusterLoading={clusterLoading}
      knownNamespaces={knownNamespaces}
      namespaceLoading={namespaceLoading}
      namespaceDisabled={namespaceDisabled}
      namespacePlaceholder={namespacePlaceholder}
      onClusterChange={onClusterChange}
      onNamespaceChange={onNamespaceChange}
      onKeywordInputChange={onKeywordInputChange}
      onSearch={onSearch}
      extraFilters={extraFilters}
      keywordPlaceholder={keywordPlaceholder}
    />
  );
}
