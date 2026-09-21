import type { KubeConfig } from '@kubernetes/client-node';
import { ForbiddenException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { AuthorizationService } from '../common/authorization.service';
import type { AuthorizationInvalidation } from '../common/authorization-invalidation';
import type { NamespaceIdentityService } from '../common/namespace-identity.service';
import { authorizeNativeRequest } from './native-authorization';
import { nativeRbacSubject } from './native-rbac';
import { forwardNativeRead } from './native-transport';

/** Internal composition. Readiness must verify opt-in, applied RBAC revision and TLS prerequisites. */
export async function openNativeRead(
  input: { token: string; clusterId: string; target: string; config: KubeConfig; signal: AbortSignal },
  dependencies: {
    authenticate: (token: string) => Promise<{userId: string; authzVersion: number; expiresAt: Date}>;
    authorization: AuthorizationService; identities: NamespaceIdentityService;
    invalidation: AuthorizationInvalidation;
    assertReady: (decision: Awaited<ReturnType<typeof authorizeNativeRequest>>) => Promise<void>;
  },
) {
  input.signal.throwIfAborted();
  const check = async () => authorizeNativeRequest(await dependencies.authenticate(input.token), input.clusterId,
    'GET', input.target, dependencies.authorization, dependencies.identities);
  const initial = await check();
  await dependencies.assertReady(initial);
  const lease = dependencies.invalidation.register(initial.userId, initial.expiresAt);
  const signal = AbortSignal.any([lease.signal, input.signal]);
  try {
    const final = await check();
    await dependencies.assertReady(final);
    if (signal.aborted || final.userId !== initial.userId || final.authzVersion !== initial.authzVersion ||
      final.namespaceUid !== initial.namespaceUid || final.expiresAt.getTime() < initial.expiresAt.getTime() ||
      !isDeepStrictEqual([...final.grantIds].sort(), [...initial.grantIds].sort())) {
      throw new ForbiddenException('Native authorization changed');
    }
    const response = await forwardNativeRead(input.config, input.target, nativeRbacSubject(final.userId, input.clusterId), signal);
    if (signal.aborted || response.destroyed) {
      response.destroy(); throw new ForbiddenException('Native authorization ended');
    }
    response.once('close', lease.close);
    return response;
  } catch (error) {
    lease.close(); throw error;
  }
}
