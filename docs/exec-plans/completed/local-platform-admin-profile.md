# Connected Local Platform Admin Profile

Status: completed
Branch: `feat/workflow-runtime-parameters`

## Outcome

Add an opt-in local development flag that starts the platform-admin console
against the real local control plane while preserving the existing default
`task local-up` topology.

## Decisions

- Use `PLATFORM_ADMIN_CONSOLE=true` as the Task flag.
- Keep the console out of the default local Compose profile.
- Run the console in `control-plane` mode with the existing seven-scope BFF
  contract and require a real local platform-admin browser session.
- Use a deployment-owned Keycloak realm dedicated to local platform-admin
  authentication so the normal management-console OIDC profile remains
  unchanged.
- Publish the admin console only on `127.0.0.1`.
- Use documented local-only credentials and token material; production
  configuration remains unchanged.

## Risks

- Profile selection must not enable the admin API when the flag is absent.
- The raw BFF token must remain local-only and must match the configured
  SHA-256 descriptor.
- OIDC cookies, callback origins, roles, and assurance claims must work over
  local HTTP without weakening production guards.
- Stop, status, logs, reset, and validation commands must understand the
  optional profile.

## Validation

- `task local-fixtures:check`: default render omitted the admin console and
  disabled the admin API; the opt-in render included the console, Keycloak,
  human-session requirement, exact seven-scope token, and loopback port.
- `task validate`: deployment contracts, harness, fixture profiles, install
  dry-run, Python standards, Helm, release matrix, edge exposure, and
  production image checks passed.
- Parent `task platform:contracts && task validate`: cross-repository
  contracts, runtime truth, conventional commits, and harness checks passed.
- `npm run validate` in `platform-admin-console`: lint, 86 tests, contracts,
  requirements, harness, build, and route smoke passed.
- `ACORNOPS_SMOKE_RUN_REMEDIATION=false task local-smoke`: the complete
  credential-free local service and AgentV smoke passed.
- `task local-up PLATFORM_ADMIN_CONSOLE=true`: the full local stack started;
  Keycloak and the console became healthy, and the console readiness endpoint
  reported `mode=control-plane` with `upstream=ok`.
- Browser verification completed the Keycloak PKCE login as
  `admin@acornops.local`, rendered the `platform-admin` human identity, and
  displayed the real seeded control-plane workspace, user, Kubernetes, and VM
  totals.
