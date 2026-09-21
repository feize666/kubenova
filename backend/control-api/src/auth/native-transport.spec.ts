import { forwardNativeRead } from './native-transport';
import type { KubeConfig } from '@kubernetes/client-node';

describe('native transport validation', () => {
  const config = (server: string, skipTLSVerify=false) => ({ getCurrentCluster:()=>({server,skipTLSVerify}), applyToHTTPSOptions:async()=>{} }) as unknown as KubeConfig;
  const invoke = (server: string, target='/api/v1/namespaces/ai/pods', insecure=false) => forwardNativeRead(config(server,insecure),target,'kubenova:native:'+'a'.repeat(40),new AbortController().signal);
  it('rejects untrusted transports and ambiguous paths before opening a socket', async () => {
    for(const endpoint of ['http://example.com','https://user:pass@example.com','https://example.com/?token=x','https://example.com/#fragment']) {
      await expect(invoke(endpoint)).rejects.toThrow();
    }
    await expect(invoke('https://example.com','/api/v1/namespaces/ai/pods',true)).rejects.toThrow();
    await expect(invoke('https://example.com','/api/v1/namespaces/ai/pods/../secrets')).rejects.toThrow();
  });
  it('rejects exec on the read transport and arbitrary impersonation identities', async () => {
    await expect(invoke('https://example.com','/api/v1/namespaces/ai/pods/p/exec')).rejects.toThrow();
    await expect(forwardNativeRead(config('https://example.com'),'/api/v1/namespaces/ai/pods','system:admin',new AbortController().signal)).rejects.toThrow();
  });
});
