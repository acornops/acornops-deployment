# Local Source Development (Full Stack)

This mode runs all AcornOps components together with local bind mounts and hot reload.

Requires [Task](https://taskfile.dev/) CLI (`task`).

Bootstrap the rest with:

```bash
task install
task doctor
```

On macOS, automated command installs use Homebrew. On Linux, `task install` supports `apt-get`, `dnf`, `yum`, `pacman`, and `zypper` for Docker Engine, then installs `kubectl` and `k3d` from their official release installers.

## Compose Files

1. `compose/vm-prod/compose.yaml`
2. `compose/local/compose.source.yaml`

## Environment

1. `task install` creates `env/local/.env.local` and `env/local/.env.agent` from the example files when missing.
2. Configure dev seed provider keys as needed (`ACORNOPS_DEV_SEED_GEMINI_API_KEY`, `ACORNOPS_DEV_SEED_OPENAI_API_KEY`, `ACORNOPS_DEV_SEED_ANTHROPIC_API_KEY`) or add keys later in AI Settings. By default, the local stack uses real provider responses and leaves blank seed keys unconfigured. Set `LLM_ENABLE_DETERMINISTIC_DEV_RESPONSES=true` only for providerless smoke runs that need deterministic tool-backed completion; in that mode the seed job writes fake local-only provider keys so control-plane credential preflight can exercise the full run path without calling a real provider.
3. Keep full-stack runtime configuration here. Component repository `.env.example` files are for standalone service runs; they should not be copied into each component when using `task local-up`.
4. Tune AI agent behavior with the `AGENT_*` settings in `env/local/.env.local`, including `AGENT_SYSTEM_INSTRUCTION`, bootstrap limits, temperature, and tool timeout.

## Run

```bash
task local-up
```

`local-up` generates and persists `GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64` in `.env.local` when it is empty, then executes `llm-gateway-init` (`alembic upgrade head` + seed) and `control-plane-init` (`npm run db:migrate`). Keeping that key stable prevents control-plane restarts from invalidating active run tokens or leaving the gateway on a stale JWKS key.
It also creates the local k3d cluster named by `LOCAL_K3D_CLUSTER_NAME` when `LOCAL_K3D_AUTO_CREATE=true`, then writes a dedicated kubeconfig for the `agentk` container and demo workload seeding. The seed includes a healthy nginx Deployment and an intentionally misspelled nginx image tag that starts in `ImagePullBackOff`; the latter is a repairable troubleshooting scenario for patching the owning Deployment to `nginx:1.27.4-alpine`.
Local AgentK collection and tools cover all namespaces by default. Set `ACORNOPS_AGENT_WATCH_NAMESPACES` to a comma-separated allowlist only when a narrower local scope is intentional.
The Compose-managed local agents explicitly set `ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT=true` because the local control plane uses plain HTTP/WebSocket transport inside the Docker network; production agent deployments must keep secure transport enabled.

The local source overlay also starts `agentv` as `agentv`. It uses the seeded `LOCAL_VM_TARGET_ID` and `LOCAL_VM_AGENT_KEY` values, connects outbound to the control plane WebSocket, and runs the real AgentV process with mock Linux/systemd collectors. This gives local development a deterministic VM target without requiring a privileged host install.

Optional profiles:

1. Keycloak OIDC parity: `task local-up LOCAL_OIDC_PROFILE=oidc-keycloak`
2. Local Vault testing: `SECRETS_BACKEND=vault task local-up LOCAL_EXTRA_PROFILES=local-vault`

## Stop / Reset

```bash
task local-down
task local-reset
```

`local-reset` removes named volumes and cleans seeded demo namespace resources.

## Smoke Coverage

`task local-smoke` verifies the seeded Kubernetes cluster and the seeded Linux VM target. It resets the repairable Kubernetes Deployment to the misspelled image, drives an assistant run through `get_resource`, `patch_resource`, approval, and a healthy rollout, then performs the VM checks for snapshot-backed resources, durable issues, metrics, journald logs, MCP registrations, and a read-only troubleshooting tool call. Set `ACORNOPS_SMOKE_RUN_REMEDIATION=false` only when intentionally skipping the local write regression. For providerless smoke, bring the stack up with `LLM_ENABLE_DETERMINISTIC_DEV_RESPONSES=true task local-up`; otherwise provide a real key for the configured default provider.
Set `ACORNOPS_SMOKE_REMEDIATION_ONLY=true` to stop after the Kubernetes repair regression when iterating specifically on assistant remediation behavior.
Set `ACORNOPS_SMOKE_REMEDIATION_RUNS=20` with that focused mode to run the production release gate repeatedly from only the failing Pod identity.
