# Deployment Design Notes

The deployment repository is intentionally thin: it composes independently versioned AcornOps services without owning their runtime code.

## Current Shape

- Local development runs source-mounted services through Docker Compose.
- Docker-on-VM production runs image-based services behind the edge proxy.
- Kubernetes production deploys the platform through the `acornops-platform` Helm chart with operator-provided Postgres and Redis.
- agentk rollout remains cluster-scoped and independent from central stack lifecycle.

## Design Constraints

- Keep environment files grouped by deployment track.
- Keep destructive operations explicit through named Taskfile targets.
- Keep Kubernetes manifests generated from the Helm chart rather than checked in as rendered output.
- Keep component runtime contracts in their owning repositories and mirror only deployment compatibility expectations here.
