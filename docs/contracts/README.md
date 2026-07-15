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
- Helm Ingress ownership and NetworkPolicy peer authorization for public workloads
- Helm global and per-component `trust.additionalCaBundle` references for
  additive private CA trust
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

## Ingress Ownership And NetworkPolicy Peers

Helm Ingress ownership and packet authorization are independent contracts.
`exposure.ingress.enabled` controls only whether the chart renders the Ingress
resource. It must not change Services, Deployments, or NetworkPolicy source
allowances. `networkPolicies.enabled` controls whether the chart renders its
default-deny and explicit allow policies.

When NetworkPolicies are enabled, `networkPolicies.ingressController.from`
controls whether and from where ingress-controller traffic may reach the
management console and control plane, regardless of whether the chart or an
external system owns the Ingress. A non-empty list renders exactly the
configured Kubernetes NetworkPolicy peers for both public workloads. An empty
list omits each ingress-controller allow rule entirely and therefore fails
closed without weakening default deny or removing internal component rules.
These rules use each workload's configured `service.targetPort`; the chart does
not discover ingress-controller labels or infer authorization from Ingress
ownership.

## Additional CA Trust

The global Helm values contract is one of these two mutually exclusive,
namespace-local references:

- `global.trust.additionalCaBundle.configMapKeyRef.name` and `.key`
- `global.trust.additionalCaBundle.secretKeyRef.name` and `.key`

The same shape under `components.controlPlane`, `components.executionEngine`,
or `components.llmGateway` overrides the global bundle for that component.

Runtime wiring uses `ADDITIONAL_CA_BUNDLE_FILE` for Python, adds
`NODE_EXTRA_CA_CERTS` for Node.js, selects the VM Compose overlay with
`ADDITIONAL_CA_BUNDLE_SOURCE_PATH`, and uses
`ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE` for target-agent install paths.

Both references default to `null`; a selected reference requires both of its
fields. The chart accepts no inline PEM, private key, client certificate, custom
mount path, or TLS-verification bypass. It maps the selected key from an
existing resource in the Helm release namespace to the read-only
`additional-ca` volume at `/etc/acornops/trust/additional-ca.pem` and sets
`ADDITIONAL_CA_BUNDLE_FILE`; Node.js workloads also receive
`NODE_EXTRA_CA_CERTS`. The source is not optional, so a missing resource or key
fails pod startup. Runtime clients add this file to public CA trust rather than
replacing that trust.

This CA-only contract is independent of `internalTransport.tls`, which
owns AcornOps service-to-service HTTPS/mTLS trust and identity material. It also
does not grant NetworkPolicy egress to a private issuer. Operators must
distribute the resource into the AcornOps namespace, configure required
`networkPolicies.extraEgress.<component>` rules, and restart affected pods
after trust-bundle changes. Rotation uses an old/new CA overlap followed by a
restart at each bundle transition because Node.js reads `NODE_EXTRA_CA_CERTS`
only at process startup.

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
