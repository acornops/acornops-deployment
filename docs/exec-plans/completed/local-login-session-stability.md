# Local login session stability

Status: completed

## Goal

Keep the local management and platform-admin consoles on stable origins and
preserve their authenticated sessions across ordinary source rebuilds.

## Scope

- Pin the platform-admin host port in the checked-in local environment.
- Give the local platform-admin session the same seven-day maximum and
  twenty-four-hour idle cadence as the management console.
- Keep Redis, Keycloak, and Dex data in their existing named volumes.
- Document the canonical origins and the reset behavior.

Production session limits and production deployment settings are unchanged.

## Verification

- Local Compose configuration rendered successfully.
- `scripts/local-up.sh` passed shell syntax validation.
- `task local-up` completed successfully.
- The management console returned HTTP 200 at
  `http://console.acornops.localhost:8088`.
- The platform-admin console returned HTTP 200 at
  `http://127.0.0.1:4173`.
- The live control plane received the seven-day maximum and twenty-four-hour
  idle and recent-auth session settings.
- Redis, Keycloak, and Dex retained their persistent named volumes.
- Per the user request, no test suite was run.
