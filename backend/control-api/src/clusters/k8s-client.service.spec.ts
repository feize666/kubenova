jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    private apiServer?: string;
    private options?: unknown;

    loadFromString(value: string) {
      this.apiServer = value.match(/server:\s*(\S+)/)?.[1];
    }

    getCurrentCluster() {
      return this.apiServer ? { server: this.apiServer } : undefined;
    }

    makeApiClient() {
      return {
        getCode: () =>
          Promise.resolve({
            gitVersion: 'v1.31.8-aliyun.1',
            major: '1',
            minor: '31',
          }),
      };
    }

    loadFromOptions(value: unknown) {
      this.options = value;
    }

    exportConfig() {
      return this.options;
    }
  },
  VersionApi: class {},
  dumpYaml: (value: unknown) => JSON.stringify(value),
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

  it('exports a kubeconfig containing only the scoped bearer token credential', () => {
    const service = new K8sClientService();

    const exported = JSON.parse(
      service.exportKubeconfig({
        clusterName: 'cluster-prod',
        server: 'https://api.example.test:6443',
        caData: 'public-ca-data',
        skipTLSVerify: false,
        userName: 'readonly-token',
        contextName: 'prod-readonly',
        namespace: 'default',
        token: 'short-lived-token',
      }),
    ) as unknown as {
      users: Array<{ name: string; token: string }>;
    };

    expect(exported.users).toEqual([
      {
        name: 'readonly-token',
        token: 'short-lived-token',
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain('client-certificate');
    expect(JSON.stringify(exported)).not.toContain('client-key');
    expect(JSON.stringify(exported)).not.toContain('password');
    expect(JSON.stringify(exported)).not.toContain('exec');
  });
});
