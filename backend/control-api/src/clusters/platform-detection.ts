import type { V1Node, V1Pod } from '@kubernetes/client-node';

export function detectRuntimes(nodes: V1Node[]) {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const version = node.status?.nodeInfo?.containerRuntimeVersion?.trim();
    if (version) counts.set(version, (counts.get(version) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([version, nodes]) => ({ version, nodes }));
}

export function detectCni(pods: V1Pod[]) {
  const plugins: Record<string, RegExp> = {
    Calico: /calico/, Cilium: /cilium/, Flannel: /flannel/, Antrea: /antrea/,
    Terway: /terway/, 'VPC-CNI': /vpc[-_]cni|amazon-k8s-cni|aws-node/,
    'Kube-OVN': /kube[-_]ovn/, Weave: /weave[-/]net/,
  };
  const components = new Map<string, { name: string; plugin: string | null; images: string[] }>();
  for (const pod of pods) {
    const images = (pod.spec?.containers ?? []).map(c => c.image ?? '').filter(Boolean);
    const text = [pod.metadata?.name, ...Object.values(pod.metadata?.labels ?? {}), ...images].join(' ').toLowerCase();
    const plugin = Object.entries(plugins).find(([, pattern]) => pattern.test(text))?.[0] ?? null;
    if (!plugin && !/\bcni\b|network-plugin/.test(text)) continue;
    const name = pod.metadata?.ownerReferences?.find(owner => owner.controller)?.name ?? pod.metadata?.name ?? '未知组件';
    components.set(name, { name, plugin, images });
  }
  const items = [...components.values()].sort((a, b) => a.name.localeCompare(b.name));
  // Multus attaches secondary networks; it must not be reported as the main CNI.
  const names = [...new Set(items.map(c => c.plugin).filter(Boolean))];
  return { cniPlugin: names.join(' · ') || (items.length ? `${items.map(c => c.name).join(' · ')}（未标准化识别）` : '未识别'), components: items };
}
