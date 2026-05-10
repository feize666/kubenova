# Binary Deployment

This directory defines the filesystem layout and operating workflow for
binary-based deployment (with systemd).

## Scope

- Artifact placement for release bundles
- Versioned release directory structure
- `current` symlink switch strategy
- Fast rollback procedure

## Recommended Runtime Paths

- Base: `/opt/k8s-aiops-manager`
- Releases: `/opt/k8s-aiops-manager/releases/<version>`
- Current symlink: `/opt/k8s-aiops-manager/current`
- Shared runtime data: `/var/lib/k8s-aiops-manager`
- Logs: `/var/log/k8s-aiops-manager`
- Env files: `/etc/k8s-aiops-manager/*.env`

## Artifact Placement

Release artifact should be unpacked into:

- `/opt/k8s-aiops-manager/releases/<version>/control-api`
- `/opt/k8s-aiops-manager/releases/<version>/runtime-gateway`
- `/opt/k8s-aiops-manager/releases/<version>/frontend` (if statically served)
- `/opt/k8s-aiops-manager/releases/<version>/metadata.json`

Never deploy into `current` directly.

## Switch Strategy

1. Install new release into a new versioned directory.
2. Validate files, permissions, and checksum.
3. Atomically update symlink:
   - `ln -sfn /opt/k8s-aiops-manager/releases/<version> /opt/k8s-aiops-manager/current`
4. Restart/reload services.
5. Verify health endpoints.

This keeps rollback as a symlink switch instead of rebuild/reinstall.

## Rollback

Rollback must be performed by switching `current` back to previous version and
restarting services. See:

- [install-layout.md](install-layout.md)
