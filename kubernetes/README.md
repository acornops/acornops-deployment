# Kubernetes Platform Deployment

The central AcornOps platform can be deployed to Kubernetes with the
`acornops-platform` Helm chart.

This chart deploys the management console, control-plane, execution-engine, and
llm-gateway. It does not deploy Postgres or Redis. Operators must provide those
dependencies and expose their connection strings through an existing Kubernetes
Secret.

The per-cluster `acornops-agentk` chart remains separate. Install that chart
into each workload cluster after the central platform is reachable.

## Chart Layout

```text
kubernetes/
  helm/
    acornops-platform/
      Chart.yaml
      values.yaml
      values.schema.json
      examples/
        values-k3s-single-node.yaml
        values-k3s-keycloak.yaml
        values-production.yaml
      templates/
  examples/
    production/
```

## Required Secret

Create the Secret referenced by `secrets.existingSecretName` before installing
the chart. The default name is `acornops-platform-secrets`.

Default required keys:

- `CONTROL_PLANE_DATABASE_URL`
- `CONTROL_PLANE_REDIS_URL`
- `OIDC_CLIENT_SECRET`
- `CSRF_SECRET`
- `GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64`
- `ORCH_SERVICE_TOKEN`
- `WEBHOOK_SECRET_ENCRYPTION_KEY`
- `EXECUTION_ENGINE_REDIS_URL`
- `EXECUTION_ENGINE_DISPATCH_TOKEN`
- `LLM_GATEWAY_DATABASE_URL`
- `LLM_GATEWAY_REDIS_URL`
- `LLM_GATEWAY_ADMIN_TOKEN`
- `SECRETS_KEK_BASE64`

Optional SMTP and Vault keys:

- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `VAULT_TOKEN`

Provider API keys are not injected into runtime pods. Configure workspace-owned
AI provider credentials from AI Settings before enabling real inference
for a workspace.

Use real production values. Runtime validators reject placeholder service
tokens, weak database passwords, and invalid encryption keys.

## Install

Render and validate the chart:

```bash
task k8s-chart-check
```

Install into a single-node k3s-style test cluster:

```bash
helm upgrade --install acornops kubernetes/helm/acornops-platform \
  --namespace acornops \
  --create-namespace \
  --atomic \
  --cleanup-on-fail \
  -f kubernetes/helm/acornops-platform/examples/values-k3s-single-node.yaml
```

For k3s with an in-cluster Keycloak issuer, start from the Keycloak overlay:

```bash
helm upgrade --install acornops kubernetes/helm/acornops-platform \
  --namespace acornops \
  --create-namespace \
  --atomic \
  --cleanup-on-fail \
  -f kubernetes/helm/acornops-platform/examples/values-k3s-keycloak.yaml
```

Install with the production baseline values:

```bash
helm upgrade --install acornops kubernetes/helm/acornops-platform \
  --namespace acornops \
  --create-namespace \
  --atomic \
  --cleanup-on-fail \
  -f kubernetes/helm/acornops-platform/examples/values-production.yaml
```

Override at least:

- `platform.publicUrl`
- `platform.consoleUrl`
- `exposure.ingress.apiHost`
- `exposure.ingress.consoleHost`
- `exposure.ingress.className`
- `exposure.ingress.tls.secretName`
- `auth.oidc.issuerUrl`
- `auth.oidc.clientId`
- `auth.oidc.requireVerifiedEmail` if a trusted OIDC provider explicitly emits `email_verified=false` for acceptable accounts
- `auth.password.enabled` if you do not want username/password login alongside OIDC
- `auth.password.signupEnabled=true` only after SMTP delivery is configured and tested
- `email.deliveryMode=smtp`, `email.from`, `email.smtp.host`, and `SMTP_USERNAME`/`SMTP_PASSWORD` when enabling password self-service signup
- `networkPolicies.ingressController.from` if your ingress controller is not in the `ingress-nginx` namespace
- `networkPolicies.postgres.to` for private Postgres endpoints
- `networkPolicies.redis.to` for private Redis endpoints
- `networkPolicies.vault.to` if using a private Vault backend
- `networkPolicies.extraEgress.*` for private OIDC providers, webhook targets, MCP targets, or other approved private egress
- `secrets.existingSecretName` if using a non-default Secret name

The default AI policy uses OpenAI with `gpt-5.5`, the default OpenAI allow list
contains only GPT-5.x models, and workspace reasoning summaries default to
`auto` when enabled by deployment policy. Provider credentials are still
workspace-owned and must be configured through AI Settings.

Use `--atomic --cleanup-on-fail` for direct Helm installs and upgrades. If Helm
reports `another operation (install/upgrade/rollback) is in progress`, inspect
`helm -n acornops history acornops` and the failed hook Jobs before retrying.
Only disposable demo environments should automatically delete stuck pending
release metadata.

When Keycloak runs inside the same cluster but browsers reach it through a public
identity hostname, use a private `auth.oidc.issuerUrl`, a browser-visible
`auth.oidc.publicIssuerUrl`, public authorization endpoint override, and internal
token/userinfo/JWKS endpoint overrides. Also allow control-plane egress to the
Keycloak namespace with `networkPolicies.extraEgress.controlPlane`.

## Internal service TLS/mTLS

Internal platform transport hardening is optional and disabled by default. Enable
it with `internalTransport.tls.enabled=true` after creating operator-managed
Secrets for the internal CA bundle and per-service certificate/key pairs.

Create example Secrets:

```bash
kubectl -n acornops create secret generic acornops-internal-ca \
  --from-file=ca.crt=./ca.crt

kubectl -n acornops create secret tls control-plane-internal-tls \
  --cert=./control-plane.crt \
  --key=./control-plane.key

kubectl -n acornops create secret tls execution-engine-internal-tls \
  --cert=./execution-engine.crt \
  --key=./execution-engine.key

kubectl -n acornops create secret tls llm-gateway-internal-tls \
  --cert=./llm-gateway.crt \
  --key=./llm-gateway.key
```

Then set:

```yaml
internalTransport:
  tls:
    enabled: true
    ca:
      secretName: acornops-internal-ca
    certificates:
      controlPlane:
        secretName: control-plane-internal-tls
      executionEngine:
        secretName: execution-engine-internal-tls
      llmGateway:
        secretName: llm-gateway-internal-tls
```

Each service certificate should be unique and include `serverAuth` and
`clientAuth` EKUs when EKU is present. Include DNS SANs matching the rendered
internal service names, such as:

- `acornops-acornops-platform-control-plane.acornops.svc`
- `acornops-acornops-platform-execution-engine.acornops.svc`
- `acornops-acornops-platform-llm-gateway.acornops.svc`

Optional cert-manager automation can create equivalent Secrets; cert-manager is
not required by the chart. A representative `Certificate` for the control-plane
Secret looks like this:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: control-plane-internal-tls
  namespace: acornops
spec:
  secretName: control-plane-internal-tls
  issuerRef:
    name: acornops-internal-ca-issuer
    kind: Issuer
  dnsNames:
    - acornops-acornops-platform-control-plane.acornops.svc
  usages:
    - server auth
    - client auth
```

Create equivalent certificates for `execution-engine` and `llm-gateway` with
their rendered service DNS names and Secret names.

Restart pods after rotating the CA or leaf Secrets:

```bash
kubectl -n acornops rollout restart deployment/acornops-acornops-platform-control-plane
kubectl -n acornops rollout restart deployment/acornops-acornops-platform-execution-engine
kubectl -n acornops rollout restart deployment/acornops-acornops-platform-llm-gateway
```

Troubleshooting:

- Missing Secret names fail Helm schema validation when TLS is enabled.
- Missing mounted files fail service startup with the configured file path.
- `unknown authority` means a service does not trust the mounted CA bundle.
- Hostname mismatch means the leaf certificate SAN does not match the rendered
  `*.svc` hostname.
- `client certificate required` means the caller did not present its service
  certificate.
- Readiness failures after enabling TLS usually point to missing health ports,
  incorrect Secret keys, or rejected internal HTTPS dependency URLs.
- Built-in MCP bridge failures can occur if `agent.builtinMcpServer.url` is
  overridden to a URL that does not match the internal control-plane listener.

Docker Compose internal mTLS is not implemented by this Helm-focused setting.

## Public Routes

The chart exposes only these routes through Kubernetes Ingress:

- `console.acornops.dev/` -> management console
- `api.acornops.dev/api` -> control-plane
- `console.acornops.dev/api` -> control-plane for same-origin browser API calls
- `docs.acornops.dev/` -> Mintlify-hosted public documentation, outside this platform chart

The execution-engine and llm-gateway stay internal by default.

## Network Policies

The platform chart enables Kubernetes NetworkPolicies by default. It renders a
default-deny ingress and egress policy for platform pods, then adds narrow
allow policies for expected service traffic:

- ingress controller -> management console and control-plane
- control-plane -> execution-engine, llm-gateway, and control-plane self-calls
- execution-engine -> control-plane and llm-gateway
- llm-gateway -> control-plane
- migration Jobs -> external Postgres and Redis egress
- DNS egress for platform services that need hostname resolution

Public HTTP/HTTPS egress is limited to non-private IPv4 ranges. Postgres and Redis
egress default to public service ports. Private databases, Redis,
Vault, OIDC, webhook, or MCP destinations must be explicitly allowed in values
before deploying to production. The policies require a CNI that enforces
`networking.k8s.io/v1` NetworkPolicy.

## Password Signup And Reset Email

Password reset is enabled by default for password-backed accounts. Password
self-service signup is disabled by default. Configure SMTP, use a verified
sender address in `email.from`, and set `email.publicBaseUrl` only if the public
verification/reset-link base differs from `platform.consoleUrl`. When enabling
signup, keep `auth.password.emailVerificationRequired=true`.

For local or private test installs, `email.deliveryMode=log` prints verification
and reset links from the control-plane pod. Do not use log delivery in
production unless `email.allowLogInProduction=true` is set as an explicit unsafe
override.

Build the management-console production image with:

- `VITE_APP_BASE_PATH=/`
- `VITE_CONTROL_PLANE_API_BASE_URL=` for same-origin `/api` requests. The
  default management-console and edge CSP only permits same-origin browser API
  calls; fully-qualified cross-origin control-plane URLs require a matching
  custom CSP.

The repository Dockerfile defaults the production image to `/` and
same-origin API calls.

To customize management-console languages without rebuilding the image, create a
ConfigMap containing a `manifest.json` key and any referenced locale JSON file
keys, then set `components.managementConsole.locales.existingConfigMap`:

```bash
kubectl create configmap acornops-console-locales \
  --from-file=manifest.json=./locales/manifest.json \
  --from-file=fr.json=./locales/fr.json
```

The chart mounts that ConfigMap at `/usr/share/nginx/html/locales`. If no
runtime locale ConfigMap is configured, the console uses its bundled English and
Mandarin Chinese languages.

## Pod Hardening

The platform chart defaults each workload and migration Job to Kubernetes
restricted-profile-friendly security settings:

- non-root pod users/groups
- `seccompProfile.type: RuntimeDefault`
- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`
- all Linux capabilities dropped
- writable `/tmp` provided through `emptyDir`

Override the per-component `podSecurityContext` or `containerSecurityContext`
values only when a replacement image requires different runtime IDs.

## HA Defaults

The chart uses production-oriented HA defaults for platform services:

- management console: `3` replicas, PDB `minAvailable: 2`
- execution-engine: `3` replicas, PDB `minAvailable: 2`
- llm-gateway: `3` replicas, PDB `minAvailable: 2`
- control-plane: `3` replicas, PDB `minAvailable: 2`

Control-plane HA requires external Redis. The control-plane uses Redis for
agent WebSocket ownership, cross-pod JSON-RPC command routing, run event fanout,
and renewed scheduler leases. The chart sets each pod's `CONTROL_PLANE_INSTANCE_ID`
from its Kubernetes pod name. The chart also sets
`components.controlPlane.terminationGracePeriodSeconds: 45` so pods can close agent
WebSockets and reject pending local commands before Kubernetes sends SIGKILL.

Execution-engine replicas are horizontally feasible with Redis-backed run
reservation and locking. Active runs are still pod-owned; a pod loss can fail
in-flight work, while later work can be picked up by another pod.
`components.executionEngine.maxConcurrentRuns` is per pod.

For single-node k3s testing, use `examples/values-k3s-single-node.yaml`; it sets
Traefik ingress, all replicas to `1`, and disables PDBs. Use
`examples/values-k3s-keycloak.yaml` when Keycloak also runs in-cluster behind a
public identity hostname.

## Migration Jobs

The chart runs database migrations as Helm pre-install/pre-upgrade Jobs:

- control-plane: `node dist/scripts/control-plane-db.js migrate`
- llm-gateway: `alembic upgrade head`

These Jobs are the Kubernetes equivalent of the compose init services. They are
not long-running workloads. A failed migration fails the Helm release, which
prevents new application pods from starting against an incompatible schema.

Back up external databases before upgrades.

## Control-Plane HA Smoke Scenario

Run `task k8s-ha-smoke` against a non-production Kubernetes context before
release promotion. The smoke installs the platform chart with three
control-plane replicas, registers a workload cluster, deploys the agentk,
checks an agent-backed pod-log path, deletes the owning control-plane pod, and
verifies the agent reconnects and the same path recovers.

The smoke requires `ACORNOPS_K8S_HA_SMOKE_CONTEXT` and refuses production hosts
such as `acornops.dev`, `api.acornops.dev`, or `console.acornops.dev`. It creates a deterministic
test pod for the agent-backed log read unless
`ACORNOPS_K8S_HA_SMOKE_LOG_POD_NAMESPACE` and
`ACORNOPS_K8S_HA_SMOKE_LOG_POD_NAME` point at an existing pod. Provide external
test Postgres/Redis through `ACORNOPS_K8S_HA_SMOKE_*` secret inputs or a values
file via `ACORNOPS_K8S_HA_SMOKE_VALUES`.

## Validation

`task k8s-chart-check` runs:

- `helm lint`
- schema rejection checks for stale or invalid values
- default chart render checks
- single-node k3s values render checks
- production values render checks
- workload knob render checks for labels, priority classes, topology spread, and extra env
- static assertions that no Postgres/Redis workloads are rendered
- static assertions that only the console host and `/api` are public
- static assertions that NetworkPolicies render default-deny and required internal service flows
- static assertions that API docs default to disabled
- static assertions that migration Jobs are Helm hooks
- static assertions that the platform chart uses `acornops-agentk` as the agent chart ref
- static assertions that default auth enables OIDC plus password login and keeps signup disabled
- static assertions that OIDC verified-email enforcement is rendered for the control plane
