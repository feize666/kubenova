import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';

@Injectable()
export class K8sClientService {
  private readonly logger = new Logger(K8sClientService.name);

  /** 根据 kubeconfig YAML 创建 k8s 客户端 */
  createClient(kubeconfigYaml: string): k8s.KubeConfig {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(kubeconfigYaml);
    return kc;
  }

  /** 获取 CoreV1Api */
  getCoreApi(kubeconfigYaml: string): k8s.CoreV1Api {
    const kc = this.createClient(kubeconfigYaml);
    return kc.makeApiClient(k8s.CoreV1Api);
  }

  /** 获取 AppsV1Api */
  getAppsApi(kubeconfigYaml: string): k8s.AppsV1Api {
    const kc = this.createClient(kubeconfigYaml);
    return kc.makeApiClient(k8s.AppsV1Api);
  }

  /** 获取 NetworkingV1Api */
  getNetworkingApi(kubeconfigYaml: string): k8s.NetworkingV1Api {
    const kc = this.createClient(kubeconfigYaml);
    return kc.makeApiClient(k8s.NetworkingV1Api);
  }

  /** 获取 DiscoveryV1Api */
  getDiscoveryApi(kubeconfigYaml: string): k8s.DiscoveryV1Api {
    const kc = this.createClient(kubeconfigYaml);
    return kc.makeApiClient(k8s.DiscoveryV1Api);
  }

  /** 获取 CustomObjectsApi */
  getCustomObjectsApi(kubeconfigYaml: string): k8s.CustomObjectsApi {
    const kc = this.createClient(kubeconfigYaml);
    return kc.makeApiClient(k8s.CustomObjectsApi as never);
  }

  /** 获取 StorageV1Api */
  getStorageApi(kubeconfigYaml: string): k8s.StorageV1Api {
    const kc = this.createClient(kubeconfigYaml);
    return kc.makeApiClient(k8s.StorageV1Api);
  }

  /** 获取 BatchV1Api */
  getBatchApi(kubeconfigYaml: string): k8s.BatchV1Api {
    const kc = this.createClient(kubeconfigYaml);
    return kc.makeApiClient(k8s.BatchV1Api);
  }

  /** 测试集群连通性，返回服务器版本 */
  async testConnection(
    kubeconfigYaml: string,
  ): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const kc = this.createClient(kubeconfigYaml);
      const versionApi = kc.makeApiClient(k8s.VersionApi);
      const resp = await versionApi.getCode();
      return { ok: true, version: `${resp.major}.${resp.minor}` };
    } catch (err) {
      this.logger.warn(`testConnection failed: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }
}
