# Catalog source deployment configuration

## Goal

Expose LLM gateway catalog policy, official registry bootstrap, workspace-managed
source policy, private connectivity allowlists, secret-referenced bootstrap
credentials, and the additive capability ownership migration in supported VM
and Helm configuration.

Operators may inventory legacy workspace and target capabilities before
deployment. Migrations preserve Cluster/VM MCP servers and skills, retain
legacy workspace rows until explicit ownership mapping is available, and pause
only workflows whose obsolete references cannot be resolved safely.

## Validation

- Schema, render, environment, contracts, and air-gapped configuration checks.
- `task validate` and platform contract checks.

## Local data profiles

- `task local-up` seeds deterministic Kubernetes and VM targets, creates k3d,
  and starts AgentK plus AgentV. Universal starter automation still applies to
  the seeded workspace.
- `task local-up-cluster-fixture` retains the same target records but starts
  only AgentK, leaving the VM offline.
- `task local-up-target-fixtures` is the explicit equivalent of the default
  seeded-target workflow; local IDs and keys remain overridable.
- Render all three profiles in validation and assert service inclusion and seed
  values.
- Treat starter automation as control-plane workspace provisioning, independent
  of `SEED_DEVELOPMENT_DATA` and all three local target profiles.

## Local profile validation evidence

- Contract, harness, install, Python standards, profile rendering, production
  edge/image, and Compose rendering checks pass. The profile assertions confirm
  default Kubernetes/VM seeding, cluster-fixture AgentK only, and
  target-fixtures AgentK plus AgentV with both records seeded.
- `task validate` cannot complete its Helm chart and release-matrix gates because
  `helm` is not installed in this environment; all subsequent non-Helm checks
  were run directly and passed.
- A live isolated cluster-fixture stack was not started because the workspace
  already has an active local stack using the same Compose project and k3d
  resources. Rendered profile behavior is covered without disturbing it.
