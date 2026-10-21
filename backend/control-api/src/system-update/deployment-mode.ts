export type DeploymentMode = 'compose' | 'systemd' | 'kubernetes' | 'source' | 'unknown';

export function detectDeploymentMode(env: NodeJS.ProcessEnv = process.env): DeploymentMode {
  if (env.KUBERNETES_SERVICE_HOST?.trim()) return 'kubernetes';
  if (env.KUBENOVA_UPDATE_EXECUTOR_SOCKET?.trim()) return 'systemd';
  if (env.KUBENOVA_UPDATE_EXECUTOR_URL?.trim()) return 'compose';
  if (env.KUBENOVA_BUILD_TYPE === 'source' || env.NODE_ENV !== 'production') return 'source';
  return 'unknown';
}
