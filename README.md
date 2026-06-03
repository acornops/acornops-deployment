<p align="center">
  <img width="220" src="https://raw.githubusercontent.com/acornops/docs/main/logo/light.svg" alt="AcornOps" />
</p>

<h1 align="center">AcornOps Deployment Repository</h1>

<p align="center">
  <a href="https://github.com/acornops/acornops-deployment/actions/workflows/ci.yml"><img src="https://github.com/acornops/acornops-deployment/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="docs/index.md"><img src="https://img.shields.io/badge/deployment-orchestration-blue.svg" alt="Deployment orchestration" /></a>
  <img src="https://img.shields.io/badge/coverage-not_applicable-lightgrey.svg" alt="Coverage not applicable" />
  <a href="docs/contracts/README.md"><img src="https://img.shields.io/badge/contracts-checked-blue.svg" alt="Contracts checked" /></a>
  <a href="scripts/check-python-service-standards.mjs"><img src="https://img.shields.io/badge/python_service_standards-checked-blue.svg" alt="Python service standards checked" /></a>
</p>

<p align="center">
  Full-system deployment orchestration for AcornOps local, VM, Kubernetes platform, and per-cluster agent tracks.
</p>

This repository orchestrates full-system deployment for AcornOps across deployment tracks:

1. local full-stack development (all components together)
2. production-like Docker-on-VM deployment
3. per-cluster Kubernetes agent rollout
4. central platform Kubernetes deployment

Central platform Kubernetes deployment is documented in [kubernetes/README.md](kubernetes/README.md).

## Status

This repository owns full-system deployment wiring, environment templates, operator runbooks, compatibility metadata, and cross-repo harness checks. Component code coverage is generated in the component repositories; this orchestration repository has no runtime application package to instrument.

Start from [docs/index.md](docs/index.md) for the repo-local knowledge base.

## Agent-Assisted Development

This repository supports human and agent-assisted development. Start coding agents from this repository root for deployment-only work, and from the `acornops-workspace` root for changes that touch multiple AcornOps repositories.

## Contracts

Cross-repo deployment contract documentation lives in [`docs/contracts/README.md`](docs/contracts/README.md). Machine-readable contract data lives in [`docs/contracts/manifest.json`](docs/contracts/manifest.json).
Run `task contracts:check` to verify deployment contract metadata and `task platform-contracts` when sibling AcornOps repositories are available.

## Documentation

Primary docs:

- [`AGENTS.md`](AGENTS.md)
- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`docs/index.md`](docs/index.md)
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- Deployment architecture: [`docs/deployment-architecture.md`](docs/deployment-architecture.md)
- Whole-system architecture: [`../docs/system-architecture.md`](../docs/system-architecture.md)

## What This Repository Owns

This repository is the distribution/orchestration layer, not component source code.

It owns:

1. compose stacks and profile wiring
2. environment templates and deployment scripts
3. operator-facing runbooks and compatibility metadata

It does **not** own application runtime code for:

1. management console
2. control-plane
3. execution-engine
4. llm-gateway
5. k8s-agent

## Repository Structure

```text
acornops-deployment/
  compose/
    vm-prod/
      compose.yaml
      proxy/
      oidc/
    local/
      compose.source.yaml
  env/
    local/
      .env.example
      .env.local                # user-created
      .env.agent.example
      .env.agent                # user-created
    vm/
      .env.example
      .env.prod                 # user-created
      .env.agent.example
      .env.agent                # user-created
    k8s/
      .env.agent.example
      .env.agent                # user-created
  scripts/
  release/
    stack-versions.yaml
  docs/
  kubernetes/
    helm/
      acornops-platform/
    README.md
  k8s/
    demo-workloads.yaml.tpl
  Taskfile.yml
  explore.md
```

## Deployment Tracks

Environment files are organized by deployment surface first. Each track owns the settings it needs, including its agent settings.

For full-platform local development and VM deployment, treat this repository's env files as the source of truth. Component repository `.env.example` files still exist for standalone component development and CI-oriented documentation, but developers should not need to copy or maintain component-local `.env` files when running the whole platform through `acornops-deployment`.

### 1. Local Full Stack (Contributor Path)

Use this when developing AcornOps end-to-end with hot reload and local source mounts.

- compose base: `compose/vm-prod/compose.yaml`
- local source overlay: `compose/local/compose.source.yaml`
- default env file: `env/local/.env.local`
- default agent env file: `env/local/.env.agent`
- profiles: `local` + one OIDC profile (`oidc-dex` or `oidc-keycloak`)

### 2. Docker-on-VM Production (Self-Hosted Path)

Use this for production/pilot environments running containers directly on VMs.

- compose file: `compose/vm-prod/compose.yaml`
- default env file: `env/vm/.env.prod`
- default agent env file: `env/vm/.env.agent`
- profile: `prod`
- image-only deployment (no local bind-mount source workflow)

### 3. Kubernetes Platform Deployment

Use this for central platform deployment into Kubernetes. The platform chart deploys the management console, control-plane, execution-engine, and llm-gateway, while keeping Postgres and Redis external.

- chart: `kubernetes/helm/acornops-platform`
- single-node test values: `kubernetes/helm/acornops-platform/examples/values-k3s-single-node.yaml`
- production baseline values: `kubernetes/helm/acornops-platform/examples/values-production.yaml`
- default platform Secret name: `acornops-platform-secrets`
- public hosts: `console.acornops.dev` for the management console, `api.acornops.dev` for `/api`, and `docs.acornops.dev` for Mintlify docs

The production baseline runs the management console, control-plane, execution-engine, and llm-gateway with three replicas. Control-plane HA depends on external Redis for agent ownership, cross-pod command routing, run event fanout, and renewed scheduler leases. Agent-backed commands in flight on a restarting owner pod can fail; the agent reconnects and later calls recover through the new owner.

Write confirmations for agent write tools are enabled by default in the platform chart through `agent.runtime.writeConfirmationRequired` and `agent.runtime.writeConfirmationTimeoutSeconds`, which render to `AGENT_WRITE_CONFIRMATION_REQUIRED` and `AGENT_WRITE_CONFIRMATION_TIMEOUT_SECONDS`. The setting is the deployment default; clusters can inherit it or set a per-cluster override in the control plane.

The per-cluster agent rollout remains separate. Agent settings for the Kubernetes track live in `env/k8s/.env.agent`.

## Quick Start

Prerequisites:

1. Docker Desktop (or Docker Engine + Compose plugin)
2. [Task](https://taskfile.dev/) CLI (`task`)

Bootstrap the rest with:

```bash
task install
task doctor
```

`task install` bootstraps host tools used by `task local-up` and creates `env/local/.env.local` plus `env/local/.env.agent` from the examples when missing. On macOS, automated command installs use Homebrew. On Linux, `task install` supports `apt-get`, `dnf`, `yum`, `pacman`, and `zypper` for Docker Engine, then installs `kubectl` and `k3d` from their official release installers. `task doctor` validates the full local bring-up contract and exits non-zero when something is still missing.

### Local Full Stack

1. Bootstrap local prerequisites:

```bash
task install
task doctor
```

2. Start the stack:

```bash
task local-up
```

`local-up` runs the llm-gateway init job (`llm-gateway-init`) and the control-plane init job (`control-plane-init`) on every bring-up before starting the full stack. During the pre-release phase, reset local volumes when schema files have been rewritten. It also checks for the local k3d cluster defined by `LOCAL_K3D_CLUSTER_NAME` and creates it automatically when missing.

3. Verify:

```bash
task local-ps
task local-smoke
```

`task local-smoke` is intentionally local-only. It connects to the local edge
proxy at `http://127.0.0.1:8088` and sends Host headers for
`console.acornops.localhost`, `acornops.localhost`, and the direct local service
hosts. It refuses non-local endpoints unless `ACORNOPS_SMOKE_ALLOW_NON_LOCAL=true`
is set deliberately. It checks the console app shell, same-origin `/api`
routing, service readiness, dev login, workspace/target seed data, and public
API host JWKS routing.

4. Stop while preserving data:

```bash
task local-down
```

5. Full reset to clean base state:

```bash
task local-reset
```

Notes:

- default local OIDC profile is Dex (`LOCAL_OIDC_PROFILE=oidc-dex`)
- switch to Keycloak with `task local-up LOCAL_OIDC_PROFILE=oidc-keycloak`
- optional Vault profile: `SECRETS_BACKEND=vault task local-up LOCAL_EXTRA_PROFILES=local-vault`
- local Kubernetes bootstrap defaults to `LOCAL_K3D_CLUSTER_NAME=acornops-demo-cluster`
- set `LOCAL_K3D_AUTO_CREATE=false` to skip k3d bootstrap and use an existing kubeconfig instead
- conversation history retention defaults to 30 days (`CONVERSATION_RETENTION_DAYS`)
- recent target chat activity warnings default to 5 minutes (`TARGET_CHAT_RECENT_ACTIVITY_WINDOW_SECONDS=300`)
- AI agent behavior can be tuned from the deployment env with `AGENT_SYSTEM_INSTRUCTION`, `AGENT_CONTEXT_MAX_TOKENS`, `AGENT_BUDGET_CENTS`, `AGENT_LLM_TEMPERATURE`, `AGENT_MAX_RUNTIME_MS`, `AGENT_MAX_STEPS`, `AGENT_MAX_TOOL_CALLS`, `AGENT_MAX_DUPLICATE_TOOL_CALLS`, and `AGENT_TOOL_DEFAULT_TIMEOUT_MS`

### Production (Docker-on-VM)

1. Prepare env file:

```bash
cp env/vm/.env.example env/vm/.env.prod
```

2. Set real values (domains, image tags, secrets, DB credentials, OIDC).

Generate service/admin tokens, OIDC/CSRF secrets, and database passwords with `openssl rand -base64 32`. Generate `SECRETS_KEK_BASE64` and `WEBHOOK_SECRET_ENCRYPTION_KEY` with `openssl rand -base64 32`; both runtime validators require decoded 32-byte keys. Generate `GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64` once and share it across all control-plane replicas. Production services reject placeholders and known development defaults at startup.

Production edge exposure is intentionally narrow: publish `MANAGEMENT_CONSOLE_HOST` for the browser app and `API_HOST` for the platform API; keep execution-engine and llm-gateway reachable only on the Docker network. Configure TLS at the edge proxy or in front of it with a load balancer, and firewall the VM so only the public edge ports are reachable from the internet.

VM production readiness gates execution-engine and llm-gateway on `/ready`; `/health` is liveness only. Execution-engine requires Redis DB 1 for run-id coordination, event retry, and terminal commit retry, and `EXECUTION_GATEWAY_BASE_URL` must point at the internal llm-gateway service.

3. Deploy:

```bash
task prod-up
```

`prod-up` also runs the llm-gateway and control-plane init jobs before starting services to prevent schema/code drift. During the pre-release phase, schema files may be rewritten directly; reset disposable deployment databases when they were created from older files.

4. Verify:

```bash
task prod-ps
```

5. Stop:

```bash
task prod-down
```

### Per-Cluster k8s-agent Rollout

This remains cluster-scoped and independent from central stack lifecycle.

For the current VM deployment track, prepare the VM agent env file:

```bash
cp env/vm/.env.agent.example env/vm/.env.agent
```

This env file is used by `task agent-deploy` and `task agent-remove`. For Kubernetes platform deployment, use `env/k8s/.env.agent` by passing `ENV_AGENT=env/k8s/.env.agent`.

2. Set required values (`ACORNOPS_AGENT_PLATFORM_URL`, `ACORNOPS_CLUSTER_ID`, `ACORNOPS_AGENT_KEY`).

For active-passive agent HA, set `K8S_AGENT_REPLICAS` above `1` and `ACORNOPS_AGENT_LEADER_ELECTION_ENABLED=true`. Passive replicas participate in Kubernetes Lease election only; they do not connect to the control plane until elected.

3. Deploy/remove:

```bash
task agent-deploy
task agent-remove
```

## Local Endpoints

When running local profile through edge-proxy:

- Management console: `http://console.acornops.localhost:8088/`
- Control plane API (same-origin path): `http://acornops.localhost:8088/api/v1`
- Control plane API (direct host): `http://control-plane.acornops.localhost:8088/api/v1`
- Control plane Swagger UI: `http://control-plane.acornops.localhost:8088/docs`
- Execution engine API: `http://execution-engine.acornops.localhost:8088/api/v1`
- Execution engine Swagger UI: `http://execution-engine.acornops.localhost:8088/docs`
- LLM gateway API: `http://llm-gateway.acornops.localhost:8088/api/v1`
- LLM gateway Swagger UI: `http://llm-gateway.acornops.localhost:8088/docs`
- Dex (`LOCAL_OIDC_PROFILE=oidc-dex`): `http://localhost:5556/dex`
- Keycloak (`LOCAL_OIDC_PROFILE=oidc-keycloak`): `http://localhost:8082`

Production public routes are narrower than local development. The default production DNS layout uses subdomains under `acornops.dev`:

- Management console: `https://console.acornops.dev/`
- Public documentation: `https://docs.acornops.dev/`
- Public control-plane API: `https://api.acornops.dev/api/v1`
- k8s-agent WebSocket: `wss://api.acornops.dev/api/v1/agent/connect`

Mintlify owns `docs.acornops.dev`; execution-engine and llm-gateway are internal-only in production and should not have public DNS, edge proxy routes, or open firewall rules.

## Task Targets

- `task local-up`
- `task local-down`
- `task local-reset`
- `task local-logs`
- `task local-ps`
- `task local-smoke`
- `task install`
- `task doctor`
- `task prod-up`
- `task prod-down`
- `task prod-logs`
- `task prod-ps`
- `task agent-deploy`
- `task agent-remove`
- `task k8s-chart-check`
- `task release-matrix-check`
- `task validate`

## Validation

Run the deployment checks that match the change:

- `task contracts:check`
- `task harness:check`
- `task validate`
- `task platform-contracts` when sibling AcornOps repositories are available
- `task local-ps` or `task prod-ps` after bringing up a stack

## Compatibility Metadata

Supported stack combinations are documented in:

- [release/stack-versions.yaml](release/stack-versions.yaml)

Use this as the source of truth when choosing image tags for production deployments.

## Environment File Layout

This repository uses structured env paths:

1. `env/local/.env.local`
2. `env/local/.env.agent`
3. `env/vm/.env.prod`
4. `env/vm/.env.agent`
5. `env/k8s/.env.agent`

The scripts use these paths directly.
