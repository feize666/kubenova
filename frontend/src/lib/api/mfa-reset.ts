import { apiRequest } from "./client";

export type MfaStatus = { enabled: boolean; passwordReauthenticationAvailable: boolean; canManageMfa: boolean };
export type ResetFactor = { code: string; method: "totp" | "recovery" };
export type ResetProof = { token: string; expiresIn: number };

export const getMfaStatus = (token: string) => apiRequest<MfaStatus>("/api/v1/auth/mfa/status", { token });

export function prepareMfaReset(token: string, targetUserId: string, password: string, factor?: ResetFactor) {
  return apiRequest<ResetProof>("/api/v1/auth/mfa/reset/prepare", {
    method: "POST", token, suppressAuthExpiryBroadcast: true,
    body: { targetUserId, password, ...(factor ? { code: factor.code, method: factor.method } : {}) },
  });
}

export function confirmMfaReset(token: string, targetUserId: string, proof: string) {
  return apiRequest<{ userId: string; mfaEnabled: false }>("/api/v1/auth/mfa/reset/confirm", {
    method: "POST", token, body: { targetUserId, token: proof }, suppressAuthExpiryBroadcast: true,
  });
}

export function prepareMfaResetOidc(token: string, targetUserId: string) {
  return apiRequest<{ url: string }>("/api/v1/auth/mfa/reset/oidc/prepare", {
    method: "POST", token, body: { targetUserId }, suppressAuthExpiryBroadcast: true,
  });
}

export function exchangeMfaResetOidc(token: string, targetUserId: string, callbackUrl: string, factor?: ResetFactor) {
  return apiRequest<ResetProof>("/api/v1/auth/mfa/reset/oidc/exchange", {
    method: "POST", token, suppressAuthExpiryBroadcast: true,
    body: { targetUserId, callbackUrl, ...(factor ? { code: factor.code, method: factor.method } : {}) },
  });
}
