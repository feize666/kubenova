import { ForbiddenException, Injectable } from '@nestjs/common';
import { ClustersService } from '../clusters/clusters.service';
import { K8sClientService } from '../clusters/k8s-client.service';

@Injectable()
export class NamespaceIdentityService {
  constructor(
    private readonly clusters: ClustersService,
    private readonly clients: K8sClientService,
  ) {}

  async resolve(clusterId: string, namespace: string): Promise<string> {
    if (!clusterId?.trim() || !namespace?.trim()) {
      throw new ForbiddenException({ code: 'NAMESPACE_SCOPE_REQUIRED' });
    }
    try {
      const config = await this.clusters.getKubeconfig(clusterId);
      if (!config) throw new Error('Missing cluster configuration');
      // Resolve live: recreating a namespace must not inherit its old grants.
      const resource = await this.clients.getCoreApi(config).readNamespace({ name: namespace });
      const uid = resource?.metadata?.uid;
      if (!uid?.trim()) throw new Error('Missing namespace UID');
      return uid;
    } catch {
      throw new ForbiddenException({ code: 'NAMESPACE_IDENTITY_UNAVAILABLE' });
    }
  }
}
