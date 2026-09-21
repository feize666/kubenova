export type MfaResetIdentity = {
  actorUserId: string;
  actorSessionId: string;
  actorAuthzVersion: number;
  targetUserId: string;
  targetAuthzVersion: number;
  targetMfaVersion: number;
};

export type MfaResetProof = MfaResetIdentity & {
  action: 'mfa-reset';
  expiresAt: number;
};
