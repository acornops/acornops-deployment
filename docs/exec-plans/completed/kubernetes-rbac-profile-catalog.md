# Kubernetes RBAC Profile Catalog

## Goal

Expose a deployment-owned Kubernetes RBAC profile baseline through Helm and
allow the control plane's audited runtime setting to add, replace, or disable
profiles without changing existing cluster snapshots.

## Boundaries

- `platformSettings.kubernetesRbacAdditions.profiles` is non-secret deployment
  configuration serialized through `PLATFORM_SETTINGS_POLICY_JSON`.
- The chart defaults to an empty catalog; third-party CRD profiles are explicit
  operator choices rather than AcornOps-maintained vendor presets.
- `runtimeEditable` can make the deployment catalog immutable from Platform
  Admin when an operator requires a deployment-only boundary.
- Rollback to an earlier chart preserves the PostgreSQL overlay; unsupported or
  invalid entries fail closed in the control plane rather than widening RBAC.

## Validation

- Render default and custom profile values.
- Reject malformed profiles through the chart schema and control-plane parser.
- Run contract, harness, chart, and repository validation.

## Result

Complete. Default and CloudNativePG example renders pass, malformed and
patch-without-list values are rejected, and fixture, Linux-install, Python
standards, release-matrix, production edge/image, compose, chart, and harness
checks pass. The workspace contract aggregate still reports its pre-existing
control-plane/management-console/AgentK manifest drift; the new Kubernetes RBAC
counterpart fields match.

The catalog now accepts the focused custom-resource verb set `get`, `list`,
`watch`, `create`, `patch`, and `delete`. Read-only onboarding renders only the
configured read verbs; read/write onboarding also renders configured writes. The
CloudNativePG starter example deliberately omits `delete` while the schema keeps
it available as an explicit administrator choice.
