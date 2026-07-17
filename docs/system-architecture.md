# AcornOps System Architecture

The canonical whole-platform architecture has moved to the workspace root:

- `../../docs/system-architecture.md` from this docs directory when the
  repository is checked out through the `acornops` workspace
- `acornops/docs/system-architecture.md` in the parent workspace
  repository

This deployment repository now keeps deployment-specific architecture in
[deployment-architecture.md](deployment-architecture.md).

Use the workspace-level system architecture for component responsibilities,
runtime flows, and repository ownership. Use the deployment architecture for
Compose, Kubernetes, ingress, state services, HA, and operator topology.
