# Deployment Contracts

This repository owns deployment and compatibility contracts rather than service API schemas.

## Contract Surfaces

- Compose service names and profile membership
- Edge proxy public routes
- Mintlify public docs host (`docs.acornops.dev`)
- Admin API enablement, token Secret wiring, and API-host-only `/admin` routing
- Workspace plan and quota config rendered into control-plane runtime env
- AI provider/model and reasoning summary policy rendered into control-plane runtime env
- Deployment-track environment templates
- External integration account-link token wiring for VM Compose and Helm
- Helm `internalTransport.tls` values for optional operator-supplied internal HTTPS/mTLS
- Password email verification/reset and SMTP environment wiring
- Release image compatibility metadata
- agentk rollout env expectations for Kubernetes cluster installs

## Internal Transport TLS

Kubernetes platform deployments use HTTP for service-to-service calls by default.
When operators set `internalTransport.tls.enabled=true`, the chart mounts an
operator-supplied CA Secret and per-service TLS Secrets into control-plane,
execution-engine, and llm-gateway pods. The chart only accepts Secret names and
Secret key names; it does not render raw certificate or private key material.

Application-layer credentials remain required in both modes:
`EXECUTION_ENGINE_DISPATCH_TOKEN`, `ORCH_SERVICE_TOKEN`, `LLM_GATEWAY_ADMIN_TOKEN`,
and run-scoped JWTs are still enforced. The control-plane public HTTP listener
continues to serve Ingress traffic, while internal callbacks, JWKS, and the
built-in MCP bridge use the separate internal HTTPS listener when TLS is enabled.

## Admin API And Workspace Plans

The deployment contract for the control-plane admin API is:

- Helm value `adminApi.enabled` renders `CONTROL_PLANE_ADMIN_API_ENABLED`.
- Helm loads `CONTROL_PLANE_ADMIN_TOKENS_JSON` from an existing Kubernetes
  Secret key; the chart does not render raw admin tokens into ConfigMaps.
- Helm ingress adds `/admin` only for `exposure.ingress.apiHost`.
- VM Compose passes `CONTROL_PLANE_ADMIN_API_ENABLED` and
  `CONTROL_PLANE_ADMIN_TOKENS_JSON` to the control plane from the env file.
- VM nginx routes `/admin/` only for `API_HOST`.

Admin token JSON values are SHA-256 hash descriptors. Raw admin tokens are
operator-held secrets and must not appear in values files, ConfigMaps, logs, or
docs examples.

Workspace plans are configured by Helm `workspacePlans` or VM
`WORKSPACE_PLANS_CONFIG_JSON` and rendered into the control plane as
`WORKSPACE_PLANS_CONFIG_JSON`. The default plan includes member, Kubernetes
cluster, and virtual machine quotas; admin quota overrides are persisted by the
control plane per workspace.

Workspace audit log lifecycle is configured by Helm `auditLogging`. The chart
renders `auditLogging.mode` to `WORKSPACE_AUDIT_LOGGING_MODE`; supported values
are `read_write`, `write_only`, and `disabled`, with `read_write` as the
default. The chart renders `auditLogging.retentionDays` to
`WORKSPACE_AUDIT_RETENTION_DAYS`; it must be a positive integer and defaults to
`365`.

AI provider/model policy is configured by Helm `ai.*` values or the matching
Compose environment variables. The chart renders reasoning summary policy to
`LLM_REASONING_SUMMARIES_ENABLED`,
`LLM_ALLOWED_REASONING_SUMMARY_MODES`, and
`LLM_ALLOWED_REASONING_EFFORTS`. These values are a deployment ceiling only;
new workspaces default to `auto` when summaries are enabled and allowed, and
workspace admins can tune or disable summaries through AI Settings.

## External integration account linking

The deployment contract for external integration account linking is:

- VM Compose passes `EXTERNAL_INTEGRATION_CLIENTS_JSON` to the control plane from
  the env file.
- Helm loads `EXTERNAL_INTEGRATION_CLIENTS_JSON` from the existing platform Secret
  through `secrets.keys.controlPlane.externalIntegrationClientsJson`.
- The JSON contains installed integration client descriptors with SHA-256 token
  hashes only. Raw bearer tokens are generated and distributed out of band, are
  never committed, and only authorize the external integration link, resolve,
  revoke, and linked-user bot endpoints.

## Validation

- `task contracts:check` validates this repository's deployment manifest and, when sibling repos are present, cross-repo contract manifests.
- `task platform-contracts` runs the same cross-repo comparison explicitly.
- Service API contracts remain in the service repositories and are mirrored through their `docs/contracts/manifest.json` files.
