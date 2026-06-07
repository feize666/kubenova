# Install Layout and Release Switch

## 1) Target Layout

```text
/opt/kubenova/
  releases/
    1.0.0/
      control-api/
      runtime-gateway/
      frontend/
      metadata.json
    1.1.0/
      ...
  current -> /opt/kubenova/releases/1.1.0

/etc/kubenova/
  control-api.env
  runtime-gateway.env

/var/lib/kubenova/
/var/log/kubenova/
```

## 2) Artifact Placement Rules

1. Every release is immutable after unpack.
2. One release = one version directory under `releases/`.
3. Shared mutable state must stay outside release directories.
4. `current` is the only path referenced by systemd startup command.

## 3) Versioned Release Workflow

1. Prepare target directory:
   - `mkdir -p /opt/kubenova/releases/<version>`
2. Unpack artifact into that directory.
3. Validate:
   - required files exist
   - executable permissions are correct
   - checksum verification passes
4. Keep current running version unchanged until validation passes.

## 4) Atomic Switch (Upgrade)

1. Record current target:
   - `readlink -f /opt/kubenova/current`
2. Switch symlink:
   - `ln -sfn /opt/kubenova/releases/<new-version> /opt/kubenova/current`
3. Restart services:
   - `systemctl daemon-reload`
   - `systemctl restart kubenova-runtime-gateway.service kubenova-control-api.service`
4. Verify:
   - process active
   - health endpoints return success

## 5) Rollback (Seconds-Level)

Prerequisite: previous release directory still exists.

1. Find previous version directory (example: `1.0.0`).
2. Switch symlink back:
   - `ln -sfn /opt/kubenova/releases/1.0.0 /opt/kubenova/current`
3. Restart services:
   - `systemctl restart kubenova-runtime-gateway.service kubenova-control-api.service`
4. Verify health.

Rollback does not rebuild artifacts; it is a pointer switch + service restart.

## 6) Retention

1. Keep at least last 2 successful versions.
2. Do not delete previous version before post-upgrade verification window ends.
3. Clean old versions only after explicit confirmation.
