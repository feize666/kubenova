# Errors

Command failures and integration errors.

---

## [ERR-20260531-001] command

**Logged**: 2026-05-31T23:17:19+08:00
**Priority**: low
**Status**: pending
**Area**: tests

### Summary
`python` command unavailable while invoking local webapp-testing helper.

### Details
`python /root/.codex/skills/webapp-testing/scripts/with_server.py --help` failed with `/bin/bash: line 1: python: command not found`. The same helper runs with `python3`.

### Suggested Action
Use `python3` for Playwright helper scripts in this environment.

### Metadata
- Source: error
- Related Files: /root/.codex/skills/webapp-testing/scripts/with_server.py
- Tags: python, tooling, playwright

## [ERR-20260531-002] cleanup

**Logged**: 2026-05-31T23:35:00+08:00
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
Removing `frontend/.next` while an existing Next dev service used port 3000 caused browser chunk load failures.

### Details
The cleanup step removed `frontend/.next` after verification. An already-running user-owned Next service on port 3000 still depended on those chunks, and a later browser matrix saw `Internal Server Error` plus failed chunk loads. Running `cd frontend && npm run build` restored `.next`.

### Suggested Action
Before cleaning build artifacts, verify no active service depends on the directory or only clean artifacts created by the current owned server.

### Metadata
- Source: error
- Related Files: frontend/.next
- Tags: cleanup, nextjs, browser-regression

## ERR-20260606-performance-login-selector

**Logged**: 2026-06-06T02:01:00+08:00
**Area**: frontend-tests

### Summary
Playwright `getByRole("button", { name: "登录控制台" })` matched the wrong visible element when login page had duplicate text, causing `GET /login?` and no auth request.

### Action
For performance probes, prefer API login plus writing the app auth storage keys. Keep UI login only as a fallback, and if using UI wait for hydration/network idle before clicking the form-scoped `button[type="submit"]`.

---

## ERR-20260606-eslint-flat-file-flag

**Logged**: 2026-06-06T02:10:00+08:00
**Area**: frontend-lint

### Summary
`npm run lint -- --file <path>` fails with ESLint 9 flat config: `Invalid option '--file'`.

### Action
Use positional paths instead, for example `npm run lint -- src/app/clusters/page.tsx`.

---
