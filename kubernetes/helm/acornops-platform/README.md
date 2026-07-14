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
- write confirmation timeout: 900 seconds
- automation runtime: `off` by default for staged production rollout
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
- `auth.oidc.tls.additionalCaBundle`: optional existing ConfigMap or Secret with
  additional CA trust for a private OIDC issuer
- `ai`: default provider/model policy
- `agent`: control-plane defaults for agent routing, runtime limits, and agent Helm installs
- `automation`: durable runtime mode, canary workspace allow-list, and worker poll interval
- `internalTransport.tls`: optional operator-supplied internal HTTPS/mTLS for service-to-service traffic
- `internalAuth`: gateway token claims and signing-key metadata
- `networkPolicies`: ingress, DNS, public egress, Postgres, Redis, Vault, and per-component extra egress
- `components`: workload and component-local settings for management-console, control-plane, execution-engine, and llm-gateway
- `components.llmGateway.providerBaseUrls`: optional deployment-wide OpenAI,
  Anthropic, and Gemini native API base URL overrides
- `components.llmGateway.mcpEgress`: remote MCP hostname policy and optional
  namespace-local TLS trust bundle

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

Private MCP endpoints require all three controls: an exact hostname in
`components.llmGateway.mcpEgress.allowedHosts`, a matching private destination
under `networkPolicies.extraEgress.llmGateway`, and TLS trust for the issuing
organization CA. Configure the trust file from exactly one existing ConfigMap
or Secret in the release namespace:

```yaml
components:
  llmGateway:
    mcpEgress:
      allowedHosts: test-mcp.app.internal.org
      caBundle:
        configMapKeyRef:
          name: organization-trust-bundle
          key: ca-bundle.pem

networkPolicies:
  extraEgress:
    llmGateway:
      - to:
          - ipBlock:
              cidr: 10.20.30.40/32
        ports:
          - protocol: TCP
            port: 443
```

`secretKeyRef` with the same `name` and `key` shape is also supported. The
selected key is mounted read-only and assigned to
`MCP_EGRESS_CA_BUNDLE_FILE`. HTTPX extends its normal public roots with this
bundle only for generic remote MCP traffic; provider, JWKS, Vault, and built-in
bridge trust are unchanged. A missing resource or key prevents the gateway pod
from starting, and this setting never disables certificate or hostname
verification. Do not duplicate `MCP_EGRESS_CA_BUNDLE_FILE` through
`components.llmGateway.extraEnv` while the dedicated setting is enabled.

For k3s, override `exposure.ingress.className` to `traefik` and set
`networkPolicies.ingressController.from` to the namespace/pod selectors used by
the k3s Traefik controller. The included single-node k3s examples assume
Traefik runs in `kube-system`.

## Public Ingress Ownership And NetworkPolicy

Ingress object ownership and traffic authorization are independent contracts:

| Value | Contract |
|---|---|
| `exposure.ingress.enabled` | Controls only whether this chart renders the public `Ingress`. Set it to `false` when another Helm release, a GitOps application, or an operator owns the equivalent Ingress. |
| `networkPolicies.ingressController.from` | Controls which Kubernetes NetworkPolicy peers can reach the management-console and control-plane pod ports. It applies whether the chart or another system owns the Ingress. |

A non-empty `networkPolicies.ingressController.from` list is rendered exactly
as the source peers for both public workloads. An empty list omits the complete
ingress-controller rule; it does not render an empty `from` field. Default deny
and the explicit internal component rules remain in place, so an empty list is
the supported fail-closed configuration. No separate ingress-controller
enablement flag is required.

Use one of the focused overlays as a starting point:

- [`values-ingress-chart-managed.yaml`](examples/values-ingress-chart-managed.yaml)
  renders the chart-owned Ingress and allows the configured controller peers.
- [`values-ingress-external.yaml`](examples/values-ingress-external.yaml) omits
  the chart-owned Ingress while preserving the same controller allowances for
  an externally managed equivalent.
- [`values-ingress-disabled.yaml`](examples/values-ingress-disabled.yaml) omits
  both the chart-owned Ingress and public ingress-controller allow rules.

Changing only `exposure.ingress.enabled` between the first two ownership models
must not change the rendered workload NetworkPolicies. The external owner is
responsible for the hosts, paths, TLS, and lifecycle of its Ingress; this chart
does not inspect or mutate that resource.

### Selecting ingress-controller peers

A namespace-only peer permits every pod in the matching namespace and is best
suited to a namespace dedicated to the ingress controller. In a shared
namespace, combine namespace and pod selectors in the same peer to narrow the
source:

```yaml
networkPolicies:
  ingressController:
    from:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: ingress-system
        podSelector:
          matchLabels:
            app.kubernetes.io/name: ingress-nginx
            app.kubernetes.io/component: controller
```

The namespace and pod selectors in that peer are both required to match. To
allow multiple controllers, add peer items rather than merging their labels:

```yaml
networkPolicies:
  ingressController:
    from:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: ingress-nginx
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: internal-gateway
        podSelector:
          matchLabels:
            app: internal-gateway-controller
```

Peer items are alternatives. Inspect the labels on the actual controller pods
and namespace before deploying; the chart does not assume a controller name,
discover cluster labels, or install an ingress controller. The values schema
also accepts standard NetworkPolicy `ipBlock` peers.

### Destination ports

NetworkPolicy ports describe the destination pod port, not the externally
visible Service port. The public rules therefore use
`components.managementConsole.service.targetPort` (default `8080`) and
`components.controlPlane.service.targetPort` (default `8081`). Keep those
values aligned with the workloads' `http` container ports; do not substitute
the Service `port` value in a policy override.

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

## OIDC Additional CA Trust

Use `auth.oidc.tls.additionalCaBundle` when the control plane must reach an OIDC
issuer whose server certificate chains to an organization-private CA. The chart
references an existing ConfigMap or Secret in the Helm release namespace; it
does not create or copy the resource, and Kubernetes cannot mount a resource
from another namespace. A ConfigMap is preferred because CA certificates are
public trust anchors, while Secret support accommodates PKI systems that
distribute all certificate material as Secrets.

The selected key must contain one or more PEM-encoded CA certificates. Use a
root CA or an intentionally managed CA bundle, not the OIDC server's private
key, a client certificate/private-key pair, or a frequently replaced leaf
certificate. The chart does not accept inline PEM content.

ConfigMap source:

```yaml
auth:
  oidc:
    tls:
      additionalCaBundle:
        configMapKeyRef:
          name: organization-trust-bundle
          key: ca.crt
```

Secret source:

```yaml
auth:
  oidc:
    tls:
      additionalCaBundle:
        secretKeyRef:
          name: organization-trust-bundle
          key: ca.crt
```

Configure exactly one source. Both `name` and `key` are required for a selected
source. When neither source is set, the chart renders no OIDC CA volume, mount,
or environment variable. When one is set, the control-plane container receives:

- a read-only `oidc-additional-ca` volume at
  `/etc/acornops/trust/oidc-ca.pem`; and
- chart-owned
  `NODE_EXTRA_CA_CERTS=/etc/acornops/trust/oidc-ca.pem`.

`NODE_EXTRA_CA_CERTS` adds the bundle to Node.js's normal public CA set; it does
not replace public trust or disable certificate and hostname verification. It
does apply the added trust process-wide to outbound TLS from the control plane.
Do not override or duplicate `NODE_EXTRA_CA_CERTS` through
`components.controlPlane.extraEnv` while the dedicated setting is enabled.

The volume source is intentionally not optional. A missing resource or key
prevents the pod from starting instead of silently falling back to a different
trust policy. An unrelated or incorrect CA remains untrusted. This setting is
also independent of `internalTransport.tls`: that feature owns AcornOps
service-to-service HTTPS/mTLS certificates and private keys, while this feature
adds CA-only trust for the external OIDC provider.

Private OIDC endpoints also need an explicit control-plane egress allowance
when `networkPolicies.enabled=true`. The default public HTTPS rule excludes
private address ranges, so add the issuer destination under
`networkPolicies.extraEgress.controlPlane` using selectors or CIDRs appropriate
for the cluster. Supplying a CA bundle does not change NetworkPolicy behavior.

### trust-manager compatibility

The chart can consume the namespace-local ConfigMap produced by cert-manager
trust-manager or an equivalent enterprise PKI distributor. AcornOps neither
requires trust-manager nor creates its cluster-scoped `Bundle`. For example, a
cluster administrator can select the AcornOps namespace and publish a target
ConfigMap there:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: acornops
  labels:
    acornops.io/trust-bundle: enabled
---
apiVersion: trust.cert-manager.io/v1alpha1
kind: Bundle
metadata:
  name: organization-trust-bundle
spec:
  sources:
    - configMap:
        name: organization-root-ca
        key: ca.crt
  target:
    configMap:
      key: ca.crt
    namespaceSelector:
      matchLabels:
        acornops.io/trust-bundle: enabled
```

Point `configMapKeyRef` at the resulting `organization-trust-bundle` ConfigMap
and `ca.crt` key in the `acornops` namespace, as in the ConfigMap example above.
The cluster administrator remains responsible for trust-manager source rules,
the trust namespace, namespace selection, and distribution policy.

### CA rotation and restarts

Node.js reads `NODE_EXTRA_CA_CERTS` only at process startup, and the chart mounts
the file with `subPath`. Updating the external ConfigMap or Secret therefore
does not update trust in an already-running process. Rotate with an overlap:

1. Publish a bundle containing both the old and new CA trust anchors.
2. Restart the control-plane Deployment.
3. Rotate the OIDC provider's serving certificate to the new CA.
4. After the overlap window, remove the old CA from the bundle.
5. Restart the control-plane Deployment again.

Trigger each rollout explicitly, substituting the rendered Deployment name:

```bash
kubectl -n acornops rollout restart deployment/<control-plane-deployment>
kubectl -n acornops rollout status deployment/<control-plane-deployment>
```

If the cluster already runs a reloader controller, pass its workload opt-in
annotation through `global.commonAnnotations`. For example,
[Stakater Reloader](https://docs.stakater.com/reloader/1.4/reference/annotations.html)
recognizes this annotation on the rendered Deployment:

```yaml
global:
  commonAnnotations:
    reloader.stakater.com/auto: "true"
```

`global.commonAnnotations` applies to other rendered top-level objects too;
controllers ignore unsupported resource kinds. Controllers that explicitly
watch pod-template annotations can instead use
`components.controlPlane.podAnnotations`. This is only an interoperability
example. The chart does not install, require, or configure a reloader, and
operators must verify that their controller restarts pods after updates to
referenced resources. The chart deliberately avoids `lookup`-based content
checksums because they are inconsistent across offline rendering, Helm
upgrades, and GitOps renderers.

### Troubleshooting OIDC discovery

First confirm that the selected resource and key exist in the release namespace
and inspect pod events for volume setup errors:

```bash
kubectl -n acornops get configmap organization-trust-bundle
kubectl -n acornops describe pod <control-plane-pod>
```

Use `get secret` instead for a Secret source. Do not print PEM content or any
private material into shared terminals or logs. In a running control-plane pod,
verify discovery through the same Node.js trust configuration used by the
application:

```bash
kubectl -n acornops exec deployment/<control-plane-deployment> -- \
  node -e "fetch(process.env.OIDC_ISSUER_URL + '/.well-known/openid-configuration')
    .then(async r => { console.log(r.status); console.log(await r.text()); })
    .catch(e => { console.error(e); process.exit(1); })"
```

`unable to get local issuer certificate` usually means the configured bundle
does not contain the issuer chain's required CA. A pod stuck before startup
usually indicates a missing resource or key. A timeout to a private issuer may
indicate that `networkPolicies.extraEgress.controlPlane` is incomplete. The API
keeps certificate details out of browser responses; correlate the request ID
with control-plane logs for the underlying TLS error without logging the
certificate contents.

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
