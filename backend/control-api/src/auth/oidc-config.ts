import { z } from 'zod';

/** Validated OIDC settings; secrets are deliberately never returned to clients. */
export const oidcConfigSchema = z.object({
  issuer: z.string().url(),
  clientId: z.string().min(1).max(200),
  redirectUri: z.string().url(),
  enabled: z.boolean().default(false),
});
export type OidcConfig = z.infer<typeof oidcConfigSchema>;
