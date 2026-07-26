# Deployment Repository Development

## Scope

This repository owns full-stack orchestration, environment templates, release compatibility metadata, local/VM/Kubernetes deployment runbooks, and cross-repo validation.

It does not own application runtime code. Runtime code stays in the component repositories.

## Prerequisites

- Docker or Docker Desktop
- Docker Compose plugin
- Task CLI
- Node.js for validation scripts
- Helm for Kubernetes chart validation
- Optional: k3d/kubectl for local workload cluster testing

## Local Development

Bootstrap host prerequisites and local env files:

```bash
task install
task doctor
```

Start the full local stack:

```bash
task local-up
```

The connected platform-admin console is included by default. Omit it when it is
not needed:

```bash
task local-up PLATFORM_ADMIN_CONSOLE=false
```

The console is available at
`http://127.0.0.1:4173` and uses the dedicated local administrator
`admin@acornops.local / devpass`.

Stop while preserving data:

```bash
task local-down
```

Reset local data:

```bash
task local-reset
```

## Kubernetes Chart Development

Validate the platform chart:

```bash
task k8s-chart-check
```

Render manually:

```bash
helm template acornops kubernetes/helm/acornops-platform --namespace acornops
```

## Validation

Canonical validation:

```bash
task validate
```

Focused checks:

```bash
task contracts:check
task harness:check
task python-standards-check
task k8s-chart-check
```

## Documentation Drift Control

Treat documentation as part of feature acceptance. Update the nearest durable doc in the same change when work changes local, VM, Kubernetes, release, environment, ingress, chart, operations, security, or reliability behavior.

If docs are intentionally unchanged, record `Docs impact: none` and the reason in handoff evidence.

## Documentation Harness

Keep `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, `docs/index.md`, this file, `docs/OPERATIONS.md`, and `docs/deployment-architecture.md` in sync when deployment tracks change. `task validate` runs the harness checks.
