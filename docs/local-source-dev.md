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

1. `task install` creates `env/local/.env.local` and `env/local/.env.agent` from the example files when missing. Both files contain local-only deterministic target identities and Agent keys that may be overridden for alternate registrations.
2. The normal local stack seeds a development workspace with Kubernetes and Linux VM targets, then starts AgentK and AgentV for them. Production configuration keeps development seeding disabled.
3. Keep full-stack runtime configuration here. Component repository `.env.example` files are for standalone service runs; they should not be copied into each component when using `task local-up`.
4. Assistant runtime limits remain configurable through `ASSISTANT_*`; target instructions come from the registered target-adapter contract, while workspace Agent instructions come from the selected versioned Agent record.

## Run

```bash
task local-up
```

`local-up` generates and persists `GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64` in `.env.local` when it is empty, then runs only the llm-gateway Alembic migrations and control-plane migrations. Keeping that key stable prevents control-plane restarts from invalidating active run tokens or leaving the gateway on a stale JWKS key.

Local startup paths are:

| Command | Control-plane data | Target agents |
| --- | --- | --- |
| `task local-up` | Development workspace with seeded Kubernetes and VM targets | AgentK and AgentV |
| `task local-up-cluster-fixture` | Same seeded Kubernetes and VM targets | AgentK only; VM remains offline |
| `task local-up-target-fixtures` | Explicit equivalent of the default seeded target setup | AgentK and AgentV |

Every workspace receives starter automation from the control plane. The local target seed adds only the development owner, workspace, Kubernetes target and settings, Linux VM target, and their Agent registrations. Local startup uses the reserved IDs and keys, creates k3d, and applies demo workloads by default. Set `SEED_DEMO_K3S_WORKLOADS=false` to opt out. Override the IDs and keys in the ignored Agent env file only when testing alternate registrations.

Local AgentK collection and tools cover all namespaces by default. Set `ACORNOPS_AGENT_WATCH_NAMESPACES` to a comma-separated allowlist only when a narrower local scope is intentional. Compose-managed fixture agents explicitly set `ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT=true` because the local control plane uses plain HTTP/WebSocket transport inside the Docker network; production agents must keep secure transport enabled.

The AgentV source overlay mounts only `src/`; dependencies and its Linux native
addon remain image-built, so an old dependency volume cannot mask a package
change and container builds cannot overwrite host-native artifacts. The local
fixture runs the real read-only AgentV process with mock Linux/systemd adapters
and never advertises `restart_service` because the container has no privileged
host helper.

Optional profiles:

1. Keycloak OIDC parity: `task local-up LOCAL_OIDC_PROFILE=oidc-keycloak`
2. Local Vault testing: `SECRETS_BACKEND=vault task local-up LOCAL_EXTRA_PROFILES=local-vault`
3. Connected development cluster: `task local-up-cluster-fixture`
4. Explicit seeded Kubernetes + VM targets: `task local-up-target-fixtures`

## Stop / Reset

```bash
task local-down
task local-reset
```

`local-reset` removes named volumes and cleans demo namespace resources when either fixture profile was used.

## Smoke Coverage

`task local-smoke` requires the seeded target agents and a real configured provider credential. It verifies the Kubernetes and VM targets, exercises target-native tools and approval, and checks the resulting runtime evidence. Set `ACORNOPS_SMOKE_RUN_REMEDIATION=false` only when intentionally skipping the local write regression.

Use `task local-agentv-smoke` for the focused cross-service AgentV release gate.
It retains edge, authentication, workspace, control-plane, execution-engine,
gateway, VM snapshot, journald, MCP registration, and read-only assistant tool
call checks while intentionally omitting Kubernetes and unrelated catalog flows.
Set `ACORNOPS_SMOKE_REMEDIATION_ONLY=true` to stop after the Kubernetes repair regression when iterating specifically on assistant remediation behavior.
Set `ACORNOPS_SMOKE_REMEDIATION_RUNS=20` with that focused mode to run the production release gate repeatedly from only the failing Pod identity.
