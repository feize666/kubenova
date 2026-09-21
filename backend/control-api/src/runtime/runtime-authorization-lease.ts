import { ForbiddenException } from '@nestjs/common';
import type { AuthorizationInvalidation } from '../common/authorization-invalidation';
import type { RuntimeSessionService, ValidateRuntimeSessionTokenInput } from './runtime-session.service';

/** Internal callers must authenticate the gateway before invoking this function. */
export async function createRuntimeAuthorizationLease(
  input: ValidateRuntimeSessionTokenInput,
  sessions: RuntimeSessionService,
  invalidation: AuthorizationInvalidation,
) {
  const initial = await sessions.validateSessionTokenDetailed(input);
  if (!initial.payload) throw new ForbiddenException('Runtime access denied');
  const lease = invalidation.register(initial.payload.userId, new Date(initial.payload.exp * 1000));
  try {
    // Register first, then recheck: a revoke between initial validation and LISTEN
    // registration must not leave a live connection with stale authorization.
    const final = await sessions.validateSessionTokenDetailed(input);
    if (lease.signal.aborted || !final.payload || final.payload.userId !== initial.payload.userId || final.payload.exp < initial.payload.exp) {
      throw new ForbiddenException('Runtime access revoked');
    }
    return lease;
  } catch (error) {
    lease.close();
    throw error;
  }
}
