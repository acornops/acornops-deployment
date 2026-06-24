# acornops-platform

Helm chart for the central AcornOps platform.

This chart deploys:

- management console
- control-plane
- execution-engine
- llm-gateway

It intentionally does not deploy Postgres or Redis. Provide external database
and cache endpoints through the existing Secret configured by
`secrets.existingSecretName`.

## Defaults

- management console: `3` replicas
- execution-engine: `3` replicas
- llm-gateway: `3` replicas
- control-plane: `3` replicas
- API docs: disabled
- auth: OIDC plus username/password login, with signup disabled and password reset enabled by default
- write confirmations: required by default for write-capable agent tools
- public Ingress: `console.acornops.dev/` for the management console and `api.acornops.dev/api` for the control-plane API
- public docs: `docs.acornops.dev/` is hosted by Mintlify and is not rendered by this chart
- migration Jobs: enabled as Helm pre-install/pre-upgrade hooks
- NetworkPolicies: enabled by default with namespace-wide default-deny ingress and egress for chart pods
- AI policy: OpenAI is the default provider, `gpt-5.5` is the default model, and the default OpenAI allow list contains only GPT-5.x models

## Values Layout

The chart values are organized by operator concern:

- `platform`: public API and console URLs
- `exposure`: Ingress hosts, class, annotations, and TLS
- `secrets`: existing Secret name and grouped Secret key mappings
- `auth`: session, OIDC, and password-auth settings
- `ai`: default provider/model policy
- `agent`: control-plane defaults for agent routing, runtime limits, and agent Helm installs
- `internalTransport.tls`: optional operator-supplied internal HTTPS/mTLS for service-to-service traffic
- `internalAuth`: gateway token claims and signing-key metadata
- `networkPolicies`: ingress, DNS, public egress, Postgres, Redis, Vault, and per-component extra egress
- `components`: workload and component-local settings for management-console, control-plane, execution-engine, and llm-gateway

Control-plane HA requires external Redis for agent ownership, cross-pod
JSON-RPC command routing, run event fanout, and renewed scheduler leases. The
default `components.controlPlane.terminationGracePeriodSeconds` is 45 seconds so WebSockets
can close and active local commands can fail quickly during rollout. Single-node
k3s values keep every component at one replica and disable PDBs.

The default NetworkPolicies allow only the expected platform service flows:
ingress-controller traffic to the public management console/control-plane
services, control-plane traffic to execution-engine and llm-gateway, execution
engine traffic to control-plane and llm-gateway, and llm-gateway traffic to
control-plane for JWKS and built-in MCP calls. DNS egress is explicit. Public
HTTP/HTTPS egress is limited to non-private IPv4 ranges for OIDC, webhooks, LLM
providers, and external MCP targets. Postgres and Redis egress default to public
service ports; private databases, private Redis, custom ingress
controllers, Vault, and private OIDC providers must be added under
`networkPolicies.postgres.to`, `networkPolicies.redis.to`, `networkPolicies.vault.to`,
or `networkPolicies.extraEgress.*` before deployment.

For k3s, override `exposure.ingress.className` to `traefik` and set
`networkPolicies.ingressController.from` to the namespace/pod selectors used by
the k3s Traefik controller. The included single-node k3s examples assume
Traefik runs in `kube-system`.

Write confirmation defaults are controlled by:

- `agent.runtime.writeConfirmationRequired` -> `AGENT_WRITE_CONFIRMATION_REQUIRED`
- `agent.runtime.writeConfirmationTimeoutSeconds` -> `AGENT_WRITE_CONFIRMATION_TIMEOUT_SECONDS`

The default is confirmation required. Individual clusters can inherit this value or override it from the control plane. Required confirmations are enforced by the execution runtime before write tool execution; browser and external adapter UIs only submit approve/reject decisions.

Target chat coordination warnings are controlled by `components.controlPlane.recentActivity.windowSeconds`, which renders to `TARGET_CHAT_RECENT_ACTIVITY_WINDOW_SECONDS`. The default is `300` seconds.

External integration account linking uses `EXTERNAL_INTEGRATION_CLIENTS_JSON`
from the existing platform Secret. The JSON contains installed client
descriptors with SHA-256 token hashes only, never raw bearer tokens. The key name
is configured with `secrets.keys.controlPlane.externalIntegrationClientsJson`;
the default key is `EXTERNAL_INTEGRATION_CLIENTS_JSON`.

Management-console runtime languages can be customized without rebuilding the
console image by setting `components.managementConsole.locales.existingConfigMap`
to a ConfigMap containing `manifest.json` and any referenced locale JSON files.
The chart mounts the ConfigMap at `/usr/share/nginx/html/locales`; when unset,
the console uses its bundled English and Mandarin Chinese languages.

## Internal Transport TLS

`internalTransport.tls.enabled` defaults to `false`. When set to `true`, the
chart mounts operator-supplied Kubernetes Secrets for the internal CA bundle and
each service certificate/key pair. The chart never accepts raw PEM values.

Required values when enabled:

- `internalTransport.tls.ca.secretName`
- `internalTransport.tls.certificates.controlPlane.secretName`
- `internalTransport.tls.certificates.executionEngine.secretName`
- `internalTransport.tls.certificates.llmGateway.secretName`

Default Secret keys are `ca.crt` for the CA bundle and `tls.crt`/`tls.key` for
each service Secret. Service certificates should include DNS SANs for the
rendered service names, for example
`acornops-acornops-platform-control-plane.acornops.svc`.

The public control-plane Ingress remains HTTP to the backend service port. The
control-plane adds a separate `internal-mtls` service port for internal callbacks,
JWKS, and the built-in MCP bridge. Execution-engine and llm-gateway keep probe
traffic on dedicated HTTP health ports while business endpoints use mTLS.

## Examples

Single-node k3s-style test:

```bash
helm upgrade --install acornops ./kubernetes/helm/acornops-platform \
  --namespace acornops \
  --create-namespace \
  --atomic \
  --cleanup-on-fail \
  -f ./kubernetes/helm/acornops-platform/examples/values-k3s-single-node.yaml
```

Single-node k3s with an in-cluster Keycloak issuer:

```bash
helm upgrade --install acornops ./kubernetes/helm/acornops-platform \
  --namespace acornops \
  --create-namespace \
  --atomic \
  --cleanup-on-fail \
  -f ./kubernetes/helm/acornops-platform/examples/values-k3s-keycloak.yaml
```

Production baseline:

```bash
helm upgrade --install acornops ./kubernetes/helm/acornops-platform \
  --namespace acornops \
  --create-namespace \
  --atomic \
  --cleanup-on-fail \
  -f ./kubernetes/helm/acornops-platform/examples/values-production.yaml
```

Run chart checks from the deployment repository root:

```bash
task k8s-chart-check
```
