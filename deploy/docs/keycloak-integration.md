# Keycloak Integration Gate

Status: console OIDC and MFA have isolated local implementation and test evidence
in `docs/local-integration-checkpoint-20260918.md`. Native kubectl and full
production identity/revocation acceptance remain incomplete. Do not interpret
console login tests as API-server OIDC or personal kubeconfig acceptance.

## Single-Host Service

`deploy/docker/docker-compose.identity.yml` is a separate Compose project with
its own PostgreSQL database and persistent volume. It does not reuse application
database credentials. The Keycloak HTTP port is loopback-only; a trusted HTTPS
reverse proxy must overwrite forwarded headers, not forward client-supplied
values. No database or management port is published.

Set these variables in a protected, untracked environment file outside the repo:

- `KEYCLOAK_DB_PASSWORD`: independent randomly generated database password.
- `KEYCLOAK_PUBLIC_URL`: fixed HTTPS identity origin reachable through the VPN
  by the browser, control API, and Kubernetes API servers where OIDC is supported.
- `KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME` / `KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD`:
  temporary bootstrap credentials. Create a named administrator and remove the
  bootstrap account after initialization; do not reuse a KubeNova user password.
- Optional `KEYCLOAK_HTTP_PORT`, default 8080 on loopback.

After local acceptance, the deployment operator can validate and start it:

```sh
docker compose --env-file /data/kubenova/secrets/identity.env \
  -p kubenova-identity -f deploy/docker/docker-compose.identity.yml config --quiet
docker compose --env-file /data/kubenova/secrets/identity.env \
  -p kubenova-identity -f deploy/docker/docker-compose.identity.yml up -d
```

The image version is explicit (26.7.4, verified against the upstream release
metadata). Before production, review its advisories and pin the approved digest.
Memory limits are initial single-host budgets, not measured capacity guarantees.
Do not run `down -v`; the volume contains identities, credentials and realm state.
Back up this database separately until the backup workflow covers it explicitly.

## Realm and Client

1. Create a dedicated `kubenova` realm. Disable public registration and implicit
   email-based account linking.
2. Create a confidential OpenID Connect client `kubenova-console`. Enable only
   standard authorization-code flow; disable implicit and direct password grants.
   Require PKCE S256. Do not enable service accounts for the login client.
3. Register the exact callback `https://<console-origin>/login/oidc`, with no
   wildcard redirects. Use `http://127.0.0.1:3000/login/oidc` only in a distinct
   development client. Restrict web origins to the corresponding console origin.
4. Configure the control API with `OIDC_ENABLED=true`, `OIDC_ISSUER` equal to the
   realm's discovery issuer, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and
   `OIDC_REDIRECT_URI`. Keep the secret outside the frontend and Git.
5. A platform administrator creates the local user and explicitly binds the
   verified issuer and immutable Keycloak user ID (token `sub`) under user actions
   > enterprise identity. Email and username are not substitutes for `sub`.
6. Test code-flow login with an isolated non-administrator. An unbound identity
   must be denied; no provider role should become a local administrator role.

## Personal kubectl Public Client

The client import template is `deploy/keycloak/kubenova-kubectl-client.json`.
Import it through Clients > Import client in the dedicated `kubenova` realm.
This is a client representation, not a realm import: never replace the realm or
overwrite the existing `kubenova-console` client. If `kubenova-kubectl` already
exists, review its settings instead of deleting it or blindly importing again.

The template enables only authorization-code flow with mandatory PKCE S256.
It is public and contains no secret; password/direct grants, implicit flow and
service accounts are disabled. It does not request role/group or offline-access
scopes. Realm login/MFA policy remains authoritative; this client does not alter
any user's MFA settings or create users.

For the separately installed `int128/kubelogin` kubectl OIDC plugin, register
exact loopback callbacks `http://localhost:8000` and `http://localhost:18000`.
These HTTP addresses are local browser callbacks, not the gateway or issuer:
the latter must remain trusted VPN-reachable HTTPS endpoints in deployment.
Do not add wildcard callbacks, web origins or remote HTTP redirects. Keep the
plugin's callback path and listener ports consistent with these registrations.
Verify the installed plugin's help/version before using it; do not install or
execute binaries supplied by a kubeconfig download.

The native gateway settings use audience `kubenova-kubectl`, the exact realm
issuer and its discovery `jwks_uri`. The exec plugin must supply its signed ID
token, not the console session token. Bind the same immutable issuer/subject to
the platform account. No client roles grant Kubernetes rights: the gateway
independently checks the current platform account and namespace grants.

Template validation:

```sh
node scripts/keycloak-native-client.test.cjs
```

This check validates configuration constraints, not a real provider login.
Before enabling personal access, verify in an isolated realm that missing/plain
PKCE is rejected, S256 browser login succeeds, the returned ID token has the
expected issuer/audience/subject, and an unbound or disabled user is denied by
the gateway. Provisioned least-privilege RBAC and the personal download workflow
remain separate incomplete gates. Importing the client alone enables neither.

## Remaining Security Gates

- MFA is optional for every role and its policy is controlled only by the
  superadministrator. Users may enroll and verify, not change policy. The
  reset routes are implemented with fresh action-bound reauthentication and a
  deployment-owned `SUPERADMIN_USER_ID` boundary. This ID is deliberately unset
  locally, so no real user has reset authority. Self-enrollment, login challenge
  and reset have isolated HTTP/PostgreSQL/Redis checks and mocked browser checks;
  real-user/provider reset acceptance remains open. Do not bypass enrollment by
  setting the database flag or designate a real owner merely to pass a test.
- Verify MFA assurance with the actual realm authentication flow and signed token
  claims before permitting session issuance; local-password login must not bypass
  a policy enabled for that account.
- Test provider logout, account disable, binding removal and policy changes across
  access tokens, refresh tokens and active log/terminal streams. Current local
  version invalidation is not proof of provider backchannel logout integration.
- Native kubectl needs a separate public PKCE client, exact API-server issuer and
  audience settings, VPN reachability and reconciled least-privilege RBAC. Do not
  distribute the console client secret or shared administrator kubeconfig.
  See `docs/native-access-delivery-plan.md` for ordered implementation gates and
  the direct-stream revocation constraint. The existing administrator-only
  ServiceAccount export is not personal OIDC access.
- Verify restore of realm state and application bindings together before claiming
  the encrypted offsite backup goal is complete.
