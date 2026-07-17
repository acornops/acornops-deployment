# Deployment Agent Entry Point

Use this file as a map, not as the full source of truth. The repository knowledge base lives in the linked docs.

## Agent-Assisted Development

This repository supports human and agent-assisted development. When using a coding agent directly inside this repo, start from this repository root and read this file before editing files.

For work that touches multiple AcornOps repositories, start the agent from the
AcornOps workspace root instead. The workspace root is cloned from the
`acornops` repository and contains the cross-repo manifest, shared skills,
validation helpers, and PR coordination workflow.

## Start Here

- [Architecture](ARCHITECTURE.md)
- [Docs Index](docs/index.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Operations Guide](docs/OPERATIONS.md)
- [Deployment Architecture](docs/deployment-architecture.md)
- [Workspace System Architecture](../docs/system-architecture.md)
- [Contracts](docs/contracts/README.md)
- [Design Notes](docs/design-docs/index.md)
- [Product Scope](docs/product-specs/index.md)
- [Plans](docs/PLANS.md)
- [Agent Handoff](docs/AGENT_HANDOFF.md)
- [Quality Score](docs/QUALITY_SCORE.md)
- [Reliability Rules](docs/RELIABILITY.md)
- [Security Policy](docs/SECURITY.md)
- [Security Model](docs/security-model.md)

## Component Map

- `compose/`: local and VM production compose topology
- `env/`: deployment-track environment templates
- `scripts/`: operational entrypoints and validation scripts
- `release/`: stack compatibility metadata
- `k8s/` and `kubernetes/`: cluster-agent rollout assets and platform Kubernetes chart

## Working Rules

- Treat `docs/` as the system of record for deployment knowledge.
- Keep this file short. Push durable operational rules and runbooks into linked docs.
- If a change affects cross-repo deployment contracts, update `docs/contracts/manifest.json` and run the platform contract check.
- If work spans multiple steps or design decisions, create an execution plan in `docs/exec-plans/active/`.
- Shared skills live in `.agents/skills/shared`; repository-owned skills live in `.agents/skills/local`.
- Agent tools may not auto-discover nested skills. When a task matches a skill description, open the relevant `SKILL.md` from `.agents/skills/shared` or `.agents/skills/local` before editing.
- Do not edit `.agents/skills/shared` here; update shared skills in the parent `acornops` repository and sync them into this repo.
- Follow [Agent Handoff](docs/AGENT_HANDOFF.md) before final response, commit, or pull request handoff.
- Keep this harness vendor-neutral; do not add required vendor-specific instruction files.

## Required Validation

- `task contracts:check`
- `task harness:check`
- `task validate`
- `task platform-contracts` when sibling AcornOps repositories are available
- `task local-ps` or `task prod-ps` after bringing up a stack

## High-Risk Areas

- Edge proxy routing, SPA fallback, and API path forwarding
- Production env templates, generated secrets, and service tokens
- Compose profile wiring and migration job ordering
- agentk deployment and removal scripts

## Documentation Hygiene

- Document new or changed deployment behavior in the same change; if docs do not change, include `Docs impact: none` and the reason in handoff evidence.
- Update [docs/index.md](docs/index.md) when adding or moving durable knowledge.
- Keep [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), [docs/OPERATIONS.md](docs/OPERATIONS.md), and [docs/deployment-architecture.md](docs/deployment-architecture.md) current when deployment tracks change.
- Keep [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md) and [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md) current when you discover lasting gaps.
