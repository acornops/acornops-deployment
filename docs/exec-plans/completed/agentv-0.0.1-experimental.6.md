# AgentV 0.0.1-experimental.6 platform matrix

## Goal

Publish one consistent first-production platform matrix with the AgentV local
write-approval fixture and exact immutable systemd release.

## Outcome

- Pinned AgentV `0.0.1-experimental.6` across local Compose, VM Compose, Helm
  values, examples, and the compatibility matrix.
- Pinned control plane `0.0.1-experimental.34` while retaining management console
  `0.0.1-experimental.35` and unrelated component versions.
- Exposed one local-only mock restart override and asserted that it controls both
  AgentV write and mock-action gates.

## Validation

- `task validate` passed deployment contracts, harness checks, local fixture
  rendering, Linux install dry-run, Python standards, Helm validation, release
  matrix, edge exposure, and production image checks.

## Release impact

Publish platform chart `0.0.1-experimental.23` only after the AgentV, management
console, and control-plane release artifacts referenced by the matrix exist.
