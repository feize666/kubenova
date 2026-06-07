# Binary Deployment

This directory defines the filesystem layout and operating workflow for
binary-based deployment (with systemd).

## Scope

- Artifact placement for release bundles
- Versioned release directory structure
- `current` symlink switch strategy
- Fast rollback procedure

## Recommended Runtime Paths

- Base: `/opt/kubenova`
- Releases: `/opt/kubenova/releases/<version>`
- Current symlink: `/opt/kubenova/current`
- Shared runtime data: `/var/lib/kubenova`
- Logs: `/var/log/kubenova`
- Env files: `/etc/kubenova/*.env`

## Artifact Placement

Release artifact should be unpacked into:

- `/opt/kubenova/releases/<version>/control-api`
- `/opt/kubenova/releases/<version>/runtime-gateway`
- `/opt/kubenova/releases/<version>/frontend` (if statically served)
- `/opt/kubenova/releases/<version>/metadata.json`

Never deploy into `current` directly.

## Switch Strategy

1. Install new release into a new versioned directory.
2. Validate files, permissions, and checksum.
3. Atomically update symlink:
   - `ln -sfn /opt/kubenova/releases/<version> /opt/kubenova/current`
4. Restart/reload services.
5. Verify health endpoints.

This keeps rollback as a symlink switch instead of rebuild/reinstall.

## Rollback

Rollback must be performed by switching `current` back to previous version and
restarting services. See:

- [install-layout.md](install-layout.md)
