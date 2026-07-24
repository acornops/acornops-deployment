# Platform Admin Demo Release

## Objective

Publish the connected platform-admin console as an immutable image, include it
in the platform chart release matrix, and let demo-infra opt into the complete
privileged administration topology without changing the default deployment.

## Scope

- Release `ghcr.io/acornops/platform-admin-console:0.0.1-experimental.1`.
- Release `acornops-platform` chart `0.0.1-experimental.16` with that image pin.
- Keep `components.platformAdminConsole.enabled=false` in chart defaults.
- Record the admin console in local and Kubernetes release matrices.
- Validate the enabled chart render separately from the default render.
- Consume the released image and chart from demo-infra behind an explicit flag.

## Security And Compatibility

- Enabling the console also enables the control-plane admin API, human OIDC
  sessions, the fixed seven-scope BFF credential, public TLS, and internal mTLS.
- The default local, VM, and demo deployment topologies remain unchanged.
- Platform administration uses a dedicated OIDC client and host.
- Rollback is a chart downgrade to `0.0.1-experimental.15`; disabling the demo
  flag removes the admin workload and returns the control plane to its prior
  non-admin configuration.

## Verification

- `npm run validate` in `platform-admin-console`.
- `task contracts:check`
- `task harness:check`
- `task release-matrix-check`
- `task validate`
- Published image manifest and chart artifact checks.
- Demo teardown, opt-in deployment, readiness checks, and authenticated login.

## Status

Complete. The immutable console image and chart are published, demo-infra
defaults to the console being disabled, and the opt-in deployment is live and
connected to the control plane over mTLS.

Local evidence:

- `platform-admin-console`: `npm run validate` passed with 86 tests, contract
  and requirements checks, build, and route smoke checks.
- `acornops-deployment`: `task release-matrix-check`,
  `task k8s-chart-check`, `task contracts:check`, `task harness:check`, and
  `task validate` passed.
- `demo-infra`: `task validate` passed with Ansible syntax required.
- Both the default and `PLATFORM_ADMIN_CONSOLE=true` demo templates rendered,
  parsed as YAML/JSON, passed strict Helm lint, and templated successfully.
- The enabled Keycloak render contains the dedicated client and owner role; the
  default render contains neither the client nor an enabled admin workload.
- Workspace cross-repository contract checks passed.
- `ghcr.io/acornops/platform-admin-console:0.0.1-experimental.1` and
  `oci://ghcr.io/acornops/charts/acornops-platform:0.0.1-experimental.16`
  were published successfully.
- The control-plane mTLS listener fix was published as
  `ghcr.io/acornops/control-plane:0.0.1-experimental.24`.
- The demo cluster was torn down with `--confirm`, rebuilt from clean
  platform/data/identity namespaces, and redeployed with
  `PLATFORM_ADMIN_CONSOLE=true`.
- Live verification found all five platform workloads ready, the admin
  readiness route healthy, an unauthenticated admin API request correctly
  bounded with `ADMIN_SESSION_REQUIRED`, and the demo owner able to sign in and
  load platform insights.
