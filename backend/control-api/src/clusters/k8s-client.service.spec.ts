jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    private apiServer?: string;

    loadFromString(value: string) {
      this.apiServer = value.match(/server:\s*(\S+)/)?.[1];
    }

    getCurrentCluster() {
      return this.apiServer ? { server: this.apiServer } : undefined;
    }

    makeApiClient() {
      return {
        getCode: async () => ({
          gitVersion: 'v1.31.8-aliyun.1',
          major: '1',
          minor: '31',
        }),
      };
    }
  },
  VersionApi: class {},
}));

import { K8sClientService } from './k8s-client.service';

describe('K8sClientService', () => {
  const kubeconfig = `
apiVersion: v1
kind: Config
clusters:
  - name: ack-cluster
    cluster:
      server: https://10.140.115.176:6443/
contexts:
  - name: ack-context
    context:
      cluster: ack-cluster
      user: ack-user
current-context: ack-context
users:
  - name: ack-user
    user:
      token: test-token
`;

  it('extracts API Server from current kubeconfig context without connecting', () => {
    const service = new K8sClientService();

    expect(service.inspectKubeconfig(kubeconfig)).toEqual({
      apiServer: 'https://10.140.115.176:6443',
    });
  });

  it('rejects kubeconfig without a current API Server', () => {
    const service = new K8sClientService();

    expect(() =>
      service.inspectKubeconfig('apiVersion: v1\nkind: Config\n'),
    ).toThrow('kubeconfig 当前 context 未配置 API Server');
  });

  it('returns detected API Server and Kubernetes version when reachable', async () => {
    const service = new K8sClientService();

    await expect(service.testConnection(kubeconfig)).resolves.toEqual({
      ok: true,
      apiServer: 'https://10.140.115.176:6443',
      version: 'v1.31.8-aliyun.1',
    });
  });
});
