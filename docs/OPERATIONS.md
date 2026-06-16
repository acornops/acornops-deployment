# Deployment Operations

## Runtime Ownership

This repository owns operator workflows for:

- local full-stack development
- Docker-on-VM production deployment
- central platform Kubernetes deployment
- workload-cluster agent rollout
- release compatibility metadata

Component repositories own service internals. This repository owns how those components are assembled and exposed.

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
The `/admin` route is only routed on the API host and must not be proxied from
the management console host.

## VM Production

Prepare:

```bash
cp env/vm/.env.example env/vm/.env.prod
```

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

Kubernetes deployments require external Postgres and Redis plus a pre-created platform Secret.
NetworkPolicies are enabled by default. Before installing or upgrading, set
`networkPolicies.ingressController.from` for the cluster ingress controller and
allow any private Postgres, Redis, OIDC, Vault, webhook, or MCP destinations in
`networkPolicies.postgres.to`, `networkPolicies.redis.to`, `networkPolicies.vault.to`,
or `networkPolicies.extraEgress.*`.

The default Kubernetes and VM deployment policy uses OpenAI with `gpt-5.5`.
Provider API keys are workspace-owned and configured from AI Settings.

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

The smoke script connects to the local edge proxy at `http://127.0.0.1:8088`
and sends `*.acornops.localhost` Host headers, so it does not rely on production
DNS. It refuses non-local endpoints unless explicitly overridden. Use it after
`task local-up` to verify edge routing, service readiness, same-origin API auth,
seeded workspace/target API paths, VM inventory/findings/metrics/logs, VM MCP
server registration, and a completed read-only VM troubleshooting run with a VM
tool call. It does not touch production.
