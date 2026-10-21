import { detectDeploymentMode } from './deployment-mode';

describe('detectDeploymentMode', () => {
  it('recognizes a Kubernetes runtime from the service-account mount', () => {
    expect(detectDeploymentMode({ KUBERNETES_SERVICE_HOST: '10.0.0.1' })).toBe('kubernetes');
  });

  it('recognizes a configured host executor as a managed host deployment', () => {
    expect(detectDeploymentMode({ KUBENOVA_UPDATE_EXECUTOR_SOCKET: '/run/kubenova-update/executor.sock' })).toBe('systemd');
    expect(detectDeploymentMode({ KUBENOVA_UPDATE_EXECUTOR_URL: 'http://127.0.0.1:4200' })).toBe('compose');
  });

  it('keeps source development explicit instead of guessing a production mode', () => {
    expect(detectDeploymentMode({ KUBENOVA_BUILD_TYPE: 'source' })).toBe('source');
  });
});
