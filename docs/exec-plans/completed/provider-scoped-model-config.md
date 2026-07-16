# Provider-scoped model configuration

## Goal

Expose provider-scoped model policy as a first-class deployment setting and
remove the ineffective flat model allow-list setting.

## Constraints

- Render `LLM_ALLOWED_PROVIDER_MODELS` for the control plane in Helm and Compose.
- Keep `LLM_ALLOWED_PROVIDERS` as a separate, actively enforced setting.
- Update deployment contract manifests, examples, and validation fixtures.

## Decision log

- Helm owns the policy through `ai.allowedProviderModels`; `extraEnv` remains a
  generic escape hatch, not the documented configuration path.
- The provider/model serialization remains the control-plane-native string
  format: `provider:model|model;provider:model`.
- The demo deployment moves to chart `0.0.1-experimental.12` and must merge only
  after that chart release is published.

## Validation log

- `node scripts/check-kubernetes-platform-chart.mjs` passed, including custom
  first-class value rendering and legacy value rejection.
- `task contracts:check` passed.
- `task validate` passed.
- Workspace `node scripts/harness/check-platform-contracts.mjs` passed.
- Demo `task validate` passed; optional Ansible syntax validation was skipped
  because `ansible-playbook` is not installed.

## Completion criteria

- Helm schema, defaults, ConfigMap, examples, and tests use
  `allowedProviderModels` only.
- Compose and environment templates pass `LLM_ALLOWED_PROVIDER_MODELS` only.
- Deployment contract and repository validation pass.
