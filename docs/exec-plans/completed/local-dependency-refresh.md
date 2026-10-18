# Local dependency refresh

Status: implementation and local validation completed, 2026-10-18.

## Problem and scope

`task local-up` builds an up-to-date control-plane image, but the persistent
`node_modules` volume masks its dependencies. The observed failure is missing
`cron-parser`; gateway readiness then fails because the control plane is down.
The same volume pattern affects both consoles and AgentK.

## Changes

- [x] Add regression coverage for disposable dependency mounts and startup refresh.
- [x] Use anonymous image-populated dependency volumes in the local overlay;
  remove only selected disposable Node containers and their anonymous caches
  after migrations succeed, before recreating the source services.
- [x] Keep all database, authentication, and session volumes named and persistent.
- [x] Document rebuild behavior and verify the real local stack without a reset.

Production images, API contracts, credentials, and application behavior are out
of scope. The old named dependency caches may remain unused; do not prune
unrelated Docker resources. Rollback is a local overlay/script revert, not a
data reset.

## Validation

- Existing container: `require.resolve('cron-parser')` fails; rebuilt image:
  the same probe succeeds. This isolates the stale mounted dependency cache.
- Both regression checks failed before the corresponding fixes and pass now:
  `node scripts/check-local-fixture-profiles.mjs` and
  `node scripts/check-local-up.mjs`. Coverage includes profile selection,
  migration failure propagation, refresh ordering, and named-volume isolation.
- `task validate`, `task platform-contracts`, `bash -n scripts/local-up.sh`,
  `git diff --check`, and the parent workspace's
  `node scripts/harness/check-platform-contracts.mjs` passed.
- `task local-up` passed with an isolated public-image Docker client config;
  repeated startup confirmed recovery. The final targeted refresh also passed.
  Inspection confirmed that old dependency caches were removed and all six
  persistent database/authentication volumes remained. State services stayed
  running during the final targeted refresh.
- `task local-ps`: all 15 long-running local services running; every configured
  health check healthy. Both migration jobs exited successfully.
- `ACORNOPS_SMOKE_RUN_REMEDIATION=false ACORNOPS_SMOKE_TIMEOUT_MS=30000 task local-smoke`
  passed after startup finished. An earlier invocation overlapped recreation
  and timed out on a transient console HTTP 502; the completed-stack rerun
  passed every enabled check.
- Browser verification: workspace Dex login and administrator Keycloak login
  succeeded. Both sessions survived restart. Real backend data showed the
  development Kubernetes and VM targets online. AgentV remains the documented
  Docker-only mock fixture, not a real systemd VM.

## Validation limits and workstation notes

- The workstation's normal Docker client stalled in
  `docker-credential-desktop get` during public base-image metadata lookup.
  Two stalled attempts were canceled. Builds succeeded using a temporary
  `DOCKER_CONFIG` containing only public-image configuration and a
  `DOCKER_HOST` pointing to the same local Docker Desktop socket. Saved Docker
  credentials/settings were not changed. This separate host-level issue still
  needs user attention if ordinary startup continues to stall.
- No AI provider credential is configured in the local workspace. The smoke
  suite verified its missing-credential rejection path; provider-backed tool
  execution and write remediation were not exercised. One local VM smoke chat
  was created by the suite. This is not production release certification.
- No reset, database-volume deletion, credential replacement, or production
  change was made. Four unused dependency caches from the initial validation
  approach were removed; all are reproducible from their source images.
- API, profile, environment, and release compatibility contracts did not
  change, so contract manifests and release pins remain unchanged.
