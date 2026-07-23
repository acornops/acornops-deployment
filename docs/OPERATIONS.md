# Deployment Operations

## Runtime Ownership

This repository owns operator workflows for:

- local full-stack development
- Docker-on-VM production deployment
- central platform Kubernetes deployment
- workload-cluster agent rollout
- release compatibility metadata

Component repositories own service internals. This repository owns how those components are assembled and exposed.

## Durable Webhook Delivery

Every control-plane replica may run the Postgres-backed webhook worker. Claims
use expiring database leases, so no Redis queue is required. Set
`WEBHOOK_WORKER_ENABLED=false` to pause new delivery claims while continuing to
enqueue events safely. Re-enable it after maintenance to drain the backlog.

The default worker claims 50 jobs per sweep and, per control-plane replica,
runs 20 deliveries concurrently with no more than 4 per destination origin.
Effective cluster concurrency scales with the replica count; expiring database
leases and fenced completion coordinate ownership. The lease covers the
configured batch's worst-case same-origin drain time. Delivery stops retrying
after 10 attempts or 24 hours and remains HTTPS-only. A private Mattermost bot
must use an exact hostname in `WEBHOOK_EGRESS_ALLOWED_PRIVATE_HOSTS_JSON`
together with the matching packet-level egress rule; this does not weaken DNS,
redirect, or reserved-address protections. External endpoint failures are not
readiness failures.

## Production Domains

Default production DNS zone:

```text
acornops.dev
```

Public production routes:

- `https://console.acornops.dev/`
- `https://docs.acornops.dev/`
- `https://api.acornops.dev/api/v1`
- `https://api.acornops.dev/admin/v1` when the admin API is explicitly enabled
- `wss://api.acornops.dev/api/v1/agent/connect`

Mintlify hosts the public docs at `docs.acornops.dev`; root-domain redirects are owned outside the platform API surface. Execution-engine and llm-gateway stay internal by default.

Platform operators can route provider traffic through API-compatible endpoints
without changing workspace credentials. For VM Compose, set any of
`LLM_PROVIDER_OPENAI_BASE_URL`, `LLM_PROVIDER_ANTHROPIC_BASE_URL`, or
`LLM_PROVIDER_GEMINI_BASE_URL`. For Helm, set the corresponding
`components.llmGateway.providerBaseUrls` value. Empty values retain the vendor
endpoint defaults. Provider SDK-specific environment variables are not part of
the AcornOps configuration contract.

OpenAI uses the Responses API by default. To route through an endpoint that
implements Chat Completions, set
`LLM_PROVIDER_OPENAI_API_SURFACE=chat_completions` for VM Compose or
`components.llmGateway.openaiApiSurface=chat_completions` for Helm. API-surface
selection is explicit and deployment-wide; the gateway never probes or falls
back between the two endpoints. Roll back by restoring `responses`. Chat
Completions supports normalized text and custom function calls but rejects
AcornOps native tools, and reasoning-summary requests return an unavailable
event.

## LLM Provider Policy

Helm configures allowed providers and their model allow lists through one map:

```yaml
ai:
  defaultProvider: openai
  defaultModel: gpt-5.5
  providers:
    openai:
      - gpt-5.5
      - gpt-5.4
    anthropic:
      - claude-fable-5
```

Provider keys are the deployment allow list. Every value must be a non-empty
array of unique model names. `defaultProvider` must be present and
`defaultModel` must belong to its array; Helm rejects an inconsistent render.
The default chart enables OpenAI, Anthropic, and Gemini. Helm merges maps, so
an override that removes a default provider must set that provider key to
`null`.

The chart serializes the map to `LLM_PROVIDERS_JSON` for the control plane.
Compose uses the same JSON environment variable directly. The removed
`LLM_ALLOWED_PROVIDERS` and `LLM_ALLOWED_PROVIDER_MODELS` variables are not
supported.

The `/admin` route is only routed on the API host and must not be proxied from
the management console host.

## VM Production

Prepare:

```bash
cp env/vm/.env.example env/vm/.env.prod
```

This version establishes a greenfield schema epoch. Back up if needed, then
explicitly drop and recreate both application databases before deploying:

```bash
pg_dump --format=custom --file acornops-control-plane-backup.dump "$CONTROL_PLANE_DATABASE_URL"
dropdb --force --dbname "$POSTGRES_ADMIN_URL" "$CONTROL_PLANE_DATABASE_NAME"
createdb --dbname "$POSTGRES_ADMIN_URL" "$CONTROL_PLANE_DATABASE_NAME"
```

Use provider-specific snapshots instead where appropriate. This cutover does not
preserve pre-release data. Deploy the pinned
control-plane, execution-engine, and llm-gateway matrix together; mixed versions
are unsupported.

During the maintenance window, stop new run admission and schedulers, drain
active runs, set `REMOTE_MCP_ENABLED=false`, and back up the gateway database and
secret namespace. Smoke test built-in tools plus workspace and individual
credential lifecycles before re-enabling remote MCP.

Vault KV v2 cleanup must delete metadata beneath the configured namespace,
mount, `VAULT_PATH_PREFIX`, and workspace path. Limit the cleanup token to that
boundary. Platform OIDC is independent: it signs users into AcornOps and is not
a remote MCP credential or callback.

Deploy:

```bash
task prod-up
```

Operate:

```bash
task prod-ps
task prod-logs
task prod-down
```

## Kubernetes Production

Validate:

```bash
task k8s-chart-check
task release-matrix-check
```

Run the control-plane HA smoke against a non-production cluster before release promotion:

```bash
ACORNOPS_K8S_HA_SMOKE_CONTEXT=<non-production-context> task k8s-ha-smoke
```

The smoke requires external test Postgres and Redis values or a caller-provided
values file. It creates a deterministic log-target pod by default; set
`ACORNOPS_K8S_HA_SMOKE_LOG_POD_NAMESPACE` and
`ACORNOPS_K8S_HA_SMOKE_LOG_POD_NAME` together to reuse an existing workload pod.
It deliberately does not run as part of `task validate`.

After pushing release tags and publishing artifacts, verify GHCR images and
charts with registry credentials:

```bash
ACORNOPS_CHECK_PUBLISHED_ARTIFACTS=true task release-matrix-check
```

Install:

```bash
helm upgrade --install acornops kubernetes/helm/acornops-platform \
  --namespace acornops \
  --create-namespace \
  --atomic \
  --cleanup-on-fail \
  -f kubernetes/helm/acornops-platform/examples/values-production.yaml
```

Kubernetes deployments require external Postgres and Redis plus a pre-created
platform Secret. Recreate both application databases before this first-install
cutover; it is not a rolling upgrade. All pinned stack images must be deployed
together.
NetworkPolicies are enabled by default. Before installing or upgrading, set
`networkPolicies.ingressController.from` for the cluster ingress controller and
allow any private Postgres, Redis, OIDC, Vault, webhook, or MCP destinations in
`networkPolicies.postgres.to`, `networkPolicies.redis.to`, `networkPolicies.vault.to`,
or `networkPolicies.extraEgress.*`.

### Ingress ownership and public access

Treat Ingress ownership and NetworkPolicy authorization as separate choices:

- `exposure.ingress.enabled` controls only whether the platform chart renders
  the public Ingress. Keep it `false` when an operator, GitOps application, or
  another Helm release owns the equivalent Ingress.
- `networkPolicies.ingressController.from` controls which peers can reach the
  management console and control plane. Configure the actual controller peers
  for either ownership model.
- Set `networkPolicies.ingressController.from: []` to render no public
  ingress-controller allow rule. This fails closed while preserving default
  deny and explicit internal component traffic.

Namespace-only selectors allow every pod in the selected namespace. Add a
`podSelector` to the same peer when the namespace is shared, and use multiple
peer items when more than one controller must reach AcornOps. Inspect actual
namespace and pod labels before deployment. The chart does not discover those
labels or install the controller.

NetworkPolicy ports are destination pod ports. The public rules use
`components.managementConsole.service.targetPort` and
`components.controlPlane.service.targetPort`, which default to TCP `8080` and
`8081`; they do not use the Services' externally visible `port` values.

### Verify an Ingress deployment

After installing or upgrading, list the policies and inspect the public
workload policies by their rendered names:

```bash
kubectl -n acornops get networkpolicy

kubectl -n acornops get networkpolicy \
  <management-console-networkpolicy-name> -o yaml

kubectl -n acornops get networkpolicy \
  <control-plane-networkpolicy-name> -o yaml
```

Confirm both policies contain the configured controller peers and their
respective destination `targetPort`. When the peer list is empty, confirm
neither policy contains an empty or broad controller rule and that the
control-plane's internal component rules still exist.

Verify the control-plane Service and endpoints:

```bash
kubectl -n acornops get service \
  <control-plane-service-name> -o yaml

kubectl -n acornops get endpointslice \
  -l kubernetes.io/service-name=<control-plane-service-name> -o wide
```

Then verify the management-console route and both public control-plane routes:

```bash
curl -fsS -o /dev/null https://console.<domain>/
curl -fsS https://console.<domain>/api/v1/auth/config
curl -fsS https://api.<domain>/api/v1/auth/config
```

The API requests should return the same control-plane JSON response without an
ingress timeout. A working console `/` with `504` responses from both `/api`
routes points to the shared control-plane path; inspect its policy, Service,
and EndpointSlice before changing application, hostname, TLS, or OIDC settings.

### Temporary policy for an older chart

If an older chart omits the control-plane allowance when an external Ingress is
used, apply a tightly selected, additive NetworkPolicy until the corrected
chart is deployed. This is a conceptual example; copy the pod and namespace
labels from the live controller and control-plane resources, and use the
configured control-plane `targetPort`:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: acornops-control-plane-external-ingress
  namespace: acornops
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: control-plane
      app.kubernetes.io/instance: acornops
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - protocol: TCP
          port: 8081
```

Do not disable all NetworkPolicies as a workaround. Kubernetes policies are
additive, so this policy can grant only the missing flow while the chart's
default-deny and component policies remain active.

After upgrading to the corrected chart, inspect the chart-managed
control-plane policy and verify both `/api` routes before removing the temporary
policy:

```bash
kubectl -n acornops delete networkpolicy \
  acornops-control-plane-external-ingress
```

### Roll back

Workflow schema epoch 2 is not rollback-safe to a V1 stack. Helm rollback is
supported only between releases that declare the same `workflowSchemaEpoch` and
execution contract version 2. Restoring V1 requires restoring the pre-cutover
database backup and the complete pinned V1 image matrix during an outage.

Use Helm history to select the preceding published chart revision, then roll
back and repeat the policy, Service, EndpointSlice, and route checks:

```bash
helm -n acornops history acornops
helm -n acornops rollback acornops <revision> --wait --cleanup-on-fail
```

If the target revision predates ingress-independent policy rendering and the
deployment uses an external Ingress, apply or retain the temporary additive
policy before the rollback. Keep it until a corrected release is deployed and
verified; otherwise the control-plane routes can return to the denied state.

The default Kubernetes and VM deployment policy uses OpenAI with `gpt-5.5` and
allows workspace reasoning summaries, which default to `auto`. Provider API keys
are workspace-owned and configured from AI Settings.

Optional internal service-to-service HTTPS/mTLS is configured under
`internalTransport.tls`. It is disabled by default and uses operator-supplied
Kubernetes Secrets only. Create a CA Secret and one TLS Secret per service, then
set the Secret names under `internalTransport.tls.ca.secretName` and
`internalTransport.tls.certificates.*.secretName`. Keep the public Ingress
backend on the control-plane `http` service port; the chart adds a separate
internal `internal-mtls` port when this feature is enabled. Restart affected pods
after rotating the mounted Secrets.

Password reset is enabled by default for password-backed accounts. Password
self-service signup remains off by default. Configure SMTP delivery first
(`email.deliveryMode=smtp`, `email.from`, `email.smtp.host`, and
`SMTP_USERNAME`/`SMTP_PASSWORD` in the platform Secret) before relying on reset
or enabling signup. Keep `auth.password.emailVerificationRequired=true`;
production startup rejects password reset or signup with required verification
when email delivery is disabled.

### Admin API and workspace plans

The admin API is off by default. Enable it only for reviewed operator
environments, and provide token descriptors through the platform Secret:

```yaml
adminApi:
  enabled: true
  ingress:
    enabled: true
  tokens:
    existingSecretName: acornops-platform-secrets
    tokensJsonKey: CONTROL_PLANE_ADMIN_TOKENS_JSON
```

`CONTROL_PLANE_ADMIN_TOKENS_JSON` must contain SHA-256 hash descriptors, not raw
tokens. Rotate raw tokens out of band, update the Secret hash descriptor, and
roll the control-plane pods. The chart renders `CONTROL_PLANE_ADMIN_API_ENABLED`
from `adminApi.enabled` and loads `CONTROL_PLANE_ADMIN_TOKENS_JSON` only from a
Secret. Ingress renders `/admin` only under `exposure.ingress.apiHost`.

Workspace plans are configured with `workspacePlans` and rendered to
`WORKSPACE_PLANS_CONFIG_JSON` for the control plane:

```yaml
workspacePlans:
  defaultPlanKey: default
  plans:
    - key: default
      name: Default
      quotas:
        members: 100
        kubernetesClusters: 30
        virtualMachines: 30
```

VM Compose uses the matching `CONTROL_PLANE_ADMIN_API_ENABLED`,
`CONTROL_PLANE_ADMIN_TOKENS_JSON`, and `WORKSPACE_PLANS_CONFIG_JSON`
environment variables. Its nginx template also exposes `/admin/` only on
`API_HOST`.

## Migration Operations

Both VM and Kubernetes production paths run database migrations before application startup:

- control-plane SQL migrations
- llm-gateway Alembic migrations

For pre-release deployments, keep external databases disposable or resettable when schema files change.

## Required Validation

Before release or deployment changes:

```bash
task validate
```

When a local full stack is running, run the local-only release smoke:

```bash
task local-smoke
```

Use `task local-up` for the full local stack with seeded Kubernetes and VM
targets plus AgentK and AgentV. Use `task local-up-cluster-fixture` when only
AgentK should connect; both target records remain seeded, but the VM stays
offline. `task local-up-target-fixtures` is the explicit equivalent of the
default target setup.

Starter automation is not a target fixture. The control plane provisions it for
every workspace and backfills existing workspaces before readiness, regardless
of `SEED_DEVELOPMENT_DATA` or the selected local startup profile.

The smoke script connects to the local edge proxy at `http://127.0.0.1:8088`
and sends `*.acornops.localhost` Host headers, so it does not rely on production
DNS. It refuses non-local endpoints unless explicitly overridden. Use it after
`task local-up` or `task local-up-target-fixtures` to verify edge routing,
service readiness, same-origin API auth, VM
inventory/issues/metrics/logs, target MCP registration, and a completed
read-only VM troubleshooting run with a VM tool call. It can also reset the
local `acornops-demo-unhealthy` Deployment, require the assistant to read and
patch that exact Deployment, approve the pending write, and verify a healthy
rollout. Set
`ACORNOPS_SMOKE_RUN_REMEDIATION=false` to skip that mutation scenario. It does
not touch production.
