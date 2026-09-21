# Encrypted Offsite Database Backup

Status: implementation available; offsite upload and restore rehearsal not yet accepted.

Local archive rehearsal (2026-09-18): restored the pre-MFA custom archive
`/tmp/kubenova-pre-mfa.a3WtT8/k8s_aiops.dump` with real PostgreSQL 16 pg_restore,
using --exit-on-error --single-transaction --no-owner --no-acl into the newly
created disposable loopback database `kubenova_restore_mfa_20260918_01`.
Restore exited successfully; readback found 2 users, 1 access grant and 18
migration records, with MfaCredential absent as expected for this archive.
The disposable database was then dropped; source database and archive retained.
Both backup and restore shell guard regressions pass. Restic is not installed
in the inspected local tool path; no encrypted repository or offsite transfer
was tested. This proves local archive restoration only, not account login,
snapshot freshness, full data equivalence or disaster-recovery acceptance.

`scripts/backup-database.sh` streams a PostgreSQL custom-format dump into an
already initialized Restic S3-compatible repository (including compatible OSS
endpoints). Restic encrypts data before upload. No plaintext database dump is
written to local disk. Application logs are excluded.

Prerequisites: compatible `pg_dump`, Restic supporting `--stdin-from-command`, an initialized repository,
`DATABASE_URL`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`, and the storage
provider credentials supported by Restic. Keep the password file readable only
by the service account. Do not put credentials into command-line arguments or Git.

Backup now clears inherited PGHOSTADDR, PGSERVICE, PGSERVICEFILE and PGOPTIONS
before invoking pg_dump, matching restore's connection-override protection.
The regression injects all four overrides and verifies that the dump sees only
the intended PGDATABASE URL. It failed before the fix and passes afterward;
dump failure still prevents snapshot commit and retention.

Run with the configured environment:

```bash
bash scripts/backup-database.sh
```

For the independent Keycloak PostgreSQL database, set
`BACKUP_DATABASE=keycloak` and `KEYCLOAK_DATABASE_URL` in the protected backup
environment, then run the same script. Missing identity configuration fails
closed; it never falls back to `DATABASE_URL`. The archive is
`kubenova-keycloak.dump`, tagged `kubenova-keycloak`, with independent seven-daily /
four-weekly retention. The default application archive and tag are unchanged.
Shell regressions verify database selection, archive/tag separation, failure
gating and missing configuration. They do not prove real upload or recovery.

For identity rehearsal, set `RESTORE_DATABASE=keycloak` and select an explicit
identity snapshot. The guarded restore script selects `kubenova-keycloak.dump`
and checks public-schema realm/client/user table counts instead of application
tables. The target must still be an empty loopback `kubenova_restore_*` database.
Non-default Keycloak database schemas are not supported by this readback check.
`node scripts/restore-database-flow.test.cjs` verifies archive selection, database
transaction flags and failure handling using external-command doubles. Real
realm/client/binding and login acceptance remain required; counts alone are not
data-equivalence evidence. Encryption keys and deployment configuration remain
outside these database snapshots.

After successful upload, retention keeps seven daily and four weekly snapshots
within the `kubenova-database` tag and host/path group. Other backup classes are
not selected. This does not run prune, initialize repositories or install a
schedule. Failed uploads do not trigger retention.

Restic runs pg_dump itself using `--stdin-from-command`; a failing dump command
must not commit a truncated snapshot. `bash scripts/backup-database.test.sh`
checks command wiring and retention gating with shell test doubles. It does
not validate encryption, real Restic behavior or restore integrity.

Restore rehearsal must use a separate empty database, never the active one.
Select an explicit snapshot ID using `restic snapshots --tag kubenova-database`,
inspect it, then pipe `restic dump SNAPSHOT_ID kubenova-postgresql.dump` into
`pg_restore --exit-on-error --no-owner --no-acl --dbname=DISPOSABLE_DATABASE`.
Validate migrations, user/grant counts and login behavior before declaring the
backup recoverable. Do not use `--clean` against a running database.

This database backup is not full disaster recovery: encryption keys, Keycloak
state and application deployment configuration require separately protected
backups. Losing application encryption keys can make restored credentials
unusable. Restore acceptance, OSS/S3 access validation, scheduling, failure
notifications and the settings UI remain pending.

`scripts/restore-database-rehearsal.sh` provides a guarded rehearsal entry point.
Set `RESTORE_DATABASE_URL` to an already created, empty loopback database named
`kubenova_restore_*`, and `RESTIC_SNAPSHOT` to a full 64-character snapshot ID.
The script rejects remote/active targets, URL query overrides and nonempty targets.
Inherited libpq hostaddr/service/options overrides are cleared before connecting.
It does not create, clear or drop databases. SQL errors roll back the restore;
source archive failures propagate through pipefail and never report acceptance.
Use a dedicated disposable database: archive authenticity, roles/privileges,
application encryption keys and application login acceptance remain operator gates.

The shell guard regression now checks exact rejection reasons and proves inherited
connection overrides are cleared. It initially failed on those overrides, then
passed after correction. This is not evidence of a real Restic/S3 restore.
# Local Connection Fix (2026-09-20)

## Deployment Configuration Backup

### Single-Server Scheduling

`scripts/backup-all.sh` serializes application DB, identity DB and configuration
backups and fails the run if any stage fails. Partial snapshots can exist after a
failure; do not label them a complete recovery set. Stage-order/failure tests pass.

Optional deployment units: `deploy/systemd/kubenova-backup.service` and `.timer`.
Schedule: 03:00 Asia/Shanghai daily with up to ten minutes jitter and catch-up
after downtime. The oneshot unit prevents overlapping timer starts. It uses the
dedicated `kubenova-backup` account, read-only system sandbox, private temporary
directory and a writable private cache. Defaults assume scripts at
`/data/kubenova/current/scripts`, matching the requested /data deployment layout.

Before enabling: install Node/PostgreSQL tools/Restic on PATH; create that service
account; explicitly grant read access to selected configuration and password
files; prepare root-owned `/etc/kubenova/backup.env` containing DATABASE_URL,
KEYCLOAK_DATABASE_URL, BACKUP_CONFIG_FILES, RESTIC_REPOSITORY,
RESTIC_PASSWORD_FILE and required S3 credentials. The systemd manager reads the
environment file. Keep it 0600; never commit it. Do not add the repository password
file to BACKUP_CONFIG_FILES. Confirm database/S3 least-privilege policies.

On the Linux acceptance host, run `systemd-analyze verify` on both units, manually
run the service and inspect its exit status before enabling the timer. No units
were installed/enabled here; macOS cannot prove systemd runtime/sandbox behavior.
S3 acceptance, backup status UI and failure notification integration remain open.

### Backup Run Status

`backup-all.sh` now atomically publishes `running`, `success` or `failed` to
`BACKUP_STATUS_FILE`, with start/completion timestamps only. Success requires
all three backup stages and the final status write to succeed. Missing settings
and stage failures publish failure; status-write failure aborts before backup.
SIGKILL or host loss cannot publish completion, so a leftover `running` record
must be investigated against the service state, not interpreted as success.

The systemd unit uses `/data/kubenova/backup-state/status.json`. Before starting
it, create `/data/kubenova/backup-state` owned by the backup service account.
The file is private (0600); configure the control API with the same
`BACKUP_STATUS_FILE` and read access to that file (for a container, a read-only
mount with appropriate UID mapping). Do not share repository password files
with the API merely to display status. A missing/unreadable file is unknown.
Outside systemd the script defaults to `$PWD/.run/backup-status.json`; use an
explicit shared path because the API and scripts can have different working
directories. These changes do not enable the timer or perform an offsite upload.

Configuration recovery: run `node scripts/restore-config.cjs` with an explicit
full RESTIC_SNAPSHOT, repository/password file and CONFIG_RESTORE_PARENT pointing
to a canonical, existing administrator-owned recovery directory. The script
requires the kubenova-configuration snapshot tag and restores with verification
into a NEW private child directory; it never overwrites running configuration.
Restored directories/files are restricted to 0700/0600 and symlinks/special files
are rejected. On failure only its newly created child is removed. Success prints
the recovery directory path, not secrets. Operator review and deliberate cutover
are still required; do not auto-source recovered environment files.

Actual Restic fixture acceptance passed: exact secret-like content restored,
private permissions, original untouched, latest alias and database-tag snapshot
refused. Temporary encrypted repository/passwords/restores and isolated worktree
were removed. This does not establish S3 connectivity or production key matching.

Run `node scripts/backup-config.cjs` with BACKUP_CONFIG_FILES set to a JSON array
of explicit absolute, canonical file paths. Select the production .env, compose
files, reverse-proxy/TLS configuration and any separately mounted application
key files. Preserve AI_CREDENTIAL_ENCRYPTION_KEY, MFA_ENCRYPTION_KEY, JWT/runtime
secrets, OIDC client configuration and DB credentials required by that deployment.
Never rely on the DB dump to contain these external encryption keys. Keep the
Restic repository password in separate escrow, not this same backup.

The script requires an initialized S3 Restic repository and password file,
refuses directories/symlinks/duplicate paths/repository-password self-backup,
backs up only selected regular files (maximum 32, 16 MiB each), and uses separate
kubenova-configuration retention (7 daily/4 weekly) only after upload succeeds.
It does not read file contents into output, restore over running configuration,
or initialize repositories. Canonical paths are required, including resolving
macOS /tmp symlinks. Run against administrator-owned stable configuration files.

Boundary/failed-upload tests pass with a storage-tool double. Real S3 upload and
configuration restore/decryption acceptance remain pending. No real secrets were
read or uploaded during this implementation; temporary fixture worktree removed.

Combined encryption/restore acceptance now passes with
`RESTIC_BIN=<verified-binary> node scripts/restore-postgres.test.cjs`: actual
pg_dump streams directly into encrypted Restic storage with no plaintext dump;
explicit snapshot restoration uses the production rehearsal script and actual
pg_restore. Application and Keycloak-shaped fixture records survive exactly;
full repository integrity checks pass and nonempty destinations refuse overwrite.
Temporary databases, encryption passwords, repositories and caches were removed.
Local storage only: S3 transport, remote retention, full schema/login recovery and
deployment secrets/config restoration are still outstanding. No business data or
production environment was touched; production S3-only policy remains intact.

Restic acceptance: official Darwin ARM64 v0.19.1 downloaded and checked against
the official SHA256SUMS; archive hash
`7be0a144ccc377880f294204aa271d76e4b79554b42a751151d425ce6ebac143`.
Verified binary retained at `/tmp/kubenova-restic.8yRrcW/restic` for subsequent
integration. `RESTIC_BIN=<binary> node scripts/restic-encryption.test.cjs` passed:
real local encrypted repository, exact fixture recovery, wrong-password denial,
`check --read-data`, and repository scan finding no plaintext fixture. Temporary
passwords, archive repository and cache were removed. This is local-backend
verification only, not S3/offsite or combined database upload acceptance; the
production backup script's S3 requirement remains unchanged.

Real restore follow-up: `scripts/restore-postgres.test.cjs` creates isolated local
source/target databases for application and identity classes, fills only fixture
tables, executes actual pg_dump/custom archive and the real rehearsal script's
pg_restore/psql pipeline, then checks exact records. Both classes passed and a
second restore into the nonempty target was refused. All four temporary databases
and fixture archives were removed. Restic transport is a local command double:
this proves database restore wiring, NOT encryption/S3 upload, complete production
schema compatibility, Keycloak startup or application login recovery. No business
rows were copied. Independent worktree removed after acceptance.

Feature 1aaf84a corrects PGDATABASE URI handling: backup and restore commands now
use `scripts/postgres-command.cjs` to map validated URLs into libpq environment
fields without placing credentials in process arguments. Node is required for
backup as well as restore. Supported URL options are sslmode, sslrootcert,
sslcert, sslkey and connect_timeout; unsupported or duplicate options fail closed.
Inherited hostaddr/service/options overrides are removed.

Validation passed: existing backup selection/retention failure tests, restore
target refusal tests and restore pipeline tests. New postgres-command.test.cjs
used actual local psql and pg_dump; schema-only custom archive stayed in memory,
no application data rows were exported. Independent worktree removed. Actual
Restic S3 upload, full restore and application/login acceptance remain pending.
