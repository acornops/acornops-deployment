# Rolling restart acceptance test

`scripts/k8s-drain-smoke.mjs` exercises literal Kubernetes `rollout restart`
using the native control-plane, execution-engine and LLM gateway images, the
platform chart, real PostgreSQL/Redis, and a controllable OpenAI Responses and
WebSocket agent fixture. Business requests use Ingress and Service routing.
Only the fixture control channel uses a port-forward.

The test creates a fresh labeled namespace with disposable stores. It never
adopts an existing namespace, changes the default context, or touches the local
Compose stack. It requires an explicit kubeconfig selecting an
`acornops-drain-*` k3d cluster with a loopback API address and no disk or memory
pressure. Allow enough memory and disk for old and replacement pods to overlap.

Build committed runtime revisions with the production Dockerfiles. These
commands run from the deployment repository and use task-specific image tags:

```bash
cp_revision=$(git -C ../control-plane rev-parse HEAD)
ee_revision=$(git -C ../execution-engine rev-parse HEAD)
gw_revision=$(git -C ../llm-gateway rev-parse HEAD)
docker build --target runtime -t acornops-drain-cp:test \
  --label org.opencontainers.image.revision="$cp_revision" ../control-plane
docker build --target production -t acornops-drain-ee:test \
  --label org.opencontainers.image.revision="$ee_revision" ../execution-engine
docker build -f ../llm-gateway/deployments/Dockerfile.gateway \
  -t acornops-drain-gw:test --label org.opencontainers.image.revision="$gw_revision" ../llm-gateway
k3d image import --cluster acornops-drain-local \
  acornops-drain-cp:test acornops-drain-ee:test acornops-drain-gw:test \
  postgres:16-alpine redis:7-alpine
```

Create that isolated cluster with `--kubeconfig-update-default=false` and
`--kubeconfig-switch-context=false`, map an ingress port on loopback, and write
its kubeconfig to a private file. The runner checks the image revision against
the sibling checkout and refuses uncommitted runtime source changes. No package
installation takes place in the fixture pod; it uses the CP image's `ws` module.
Before bootstrap and capacity activation, the runner compares every ready service
container's Kubernetes image ID to the locally verified immutable Docker image
ID. It repeats that check for replacements before accepting a rollout. Reimport
images after rebuilding a tag; a stale cluster copy fails this check.

```bash
task k8s-drain-check
node scripts/k8s-drain-smoke.mjs --preflight \
  --kubeconfig /tmp/acornops-drain-kubeconfig \
  --expected-cluster acornops-drain-local --ingress http://127.0.0.1:18089
node scripts/k8s-drain-smoke.mjs --run --capacity on \
  --kubeconfig /tmp/acornops-drain-kubeconfig \
  --expected-cluster acornops-drain-local --ingress http://127.0.0.1:18089 \
  --cp-image acornops-drain-cp:test --ee-image acornops-drain-ee:test --gw-image acornops-drain-gw:test
```

Repeat with `--capacity off`; each invocation gets separate stores and a new
namespace. The runner records its evidence directory and retains the namespace
by default for diagnosis. Add `--cleanup` to delete only its exact namespace
after checking the ownership label. Remove retained test namespaces and the
isolated cluster when finished; neither is a production deployment.

Add `--internal-tls` to run either capacity profile with mutually authenticated
TLS on the chart's internal control-plane, engine and gateway Services. This
requires local `openssl`. The runner generates a one-day ephemeral CA and distinct
role certificates with Service DNS SANs and server/client authentication usage,
deletes its temporary key files, and installs a labeled namespace-owned Secret.
The chart mounts the CA and role keys with client certificates required; peer
verification stays enabled. Capacity activation reads metadata from CP's public
8081 listener and the engine/gateway's dedicated plaintext health listeners on
18080/18001. Application traffic uses the chart-derived HTTPS Service URLs.

The scenarios check active inference during each service restart, a held
cross-replica agent reply followed by owner handoff, queued work during engine
drain, cancellation after the old engine leaves ready endpoints, and overlapping
service restarts. Assertions include durable run/message identity, provider and
raw tool-dispatch counts, capacity settlement, and old-pod disappearance rather
than only replacement readiness. With capacity disabled, queue recovery must
finish on the replacement while the old engine still holds its active run.

The fixture uses dummy credentials and a namespace egress policy; no paid model
or real agent tool executes. The default profile uses internal plaintext;
`--internal-tls` enables internal mTLS. Both retain HTTP Ingress and controlled
HTTP provider/WS agent fixtures, with `NODE_ENV=development` to permit those local
URLs; they keep native server commands and disable development seeds. The report's
`internalTls` field records the selected mode. Render checks and native TLS process
tests remain separate evidence until the selected rollout matrix completes.
This test does not establish crash
resumption, mixed-version rollout safety, arbitrary write exactly-once behavior,
or uninterrupted execution beyond the configured drain deadlines.

Reports contain fixture events, accepted IDs, HTTP statuses, image revisions,
pod/endpoint observations and scoped old-pod logs. Generated Secret values,
session cookies, agent keys, provider credentials and ephemeral TLS keys are
redacted from reports, including PEM, JSON-escaped and base64 representations.
`running-images.json` records the checked container IDs at installation and
replacement readiness. Each completed case records the verified client message
ID, durable user message ID, session/run association and assistant completion ID.
