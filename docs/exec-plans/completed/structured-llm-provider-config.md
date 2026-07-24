# Structured LLM provider configuration

## Goal

Make the Helm provider map the readable deployment source of truth and render
it to the control plane's JSON environment contract.

## Constraints

- This is an explicitly accepted breaking values and environment change.
- Local Compose, VM Compose, Helm defaults, examples, schemas, and contract
  documentation must agree.
- Provider keys imply allowance; no separate provider allow-list remains.

## Decision log

- Helm uses `ai.providers.<provider>[]`.
- The chart renders `LLM_PROVIDERS_JSON` with `toJson`.
- Removed Helm keys and environment variables are rejected rather than
  supported through compatibility aliases.

## Validation log

- `node scripts/check-kubernetes-platform-chart.mjs` passed.
- Local and VM Compose rendering passed with the new JSON contract.
- `task contracts:check` passed.
- `task validate` passed.
- Workspace platform contract checks passed.

## Completion criteria

- All deployment tracks use the structured provider source or its JSON wire
  representation.
- Chart rendering and schema tests cover defaults, customization, and removed
  key rejection.
- Repository and platform contract checks pass.
