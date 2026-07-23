# OpenAI Chat Completions API surface

Status: completed 2026-07-23

## Goal

Expose the llm-gateway OpenAI API-surface selection consistently through local
Compose, VM production Compose, and the platform Helm chart.

## Runtime contract

- Environment variable:
  `LLM_PROVIDER_OPENAI_API_SURFACE=responses|chat_completions`
- Default: `responses`
- Helm value:
  `components.llmGateway.openaiApiSurface`
- The selection is deployment-wide and uses the same rollout boundary as
  `components.llmGateway.providerBaseUrls.openai`.
- Rollback is a configuration-only change back to `responses`.

## Implementation

1. Add the environment variable to both Compose deployment tracks.
2. Add the Helm value, JSON-schema enum, and ConfigMap rendering.
3. Update chart and operational documentation.
4. Update deployment contract artifacts only if existing contract checks show
   that this environment setting is manifest-owned.

## Cross-repository coordination

- Runtime producer: `llm-gateway`
- Deployment consumer: `acornops-deployment`
- Shared branch: `feat/openai-chat-completions-surface`
- Merge order: `llm-gateway`, then `acornops-deployment`

## Validation

- `task validate`: passed, including deployment contracts, harness checks,
  local fixture profiles, Linux install dry-run, Python standards, Helm chart,
  release matrix, production edge, production images, and Compose renders.
- `task platform-contracts`: passed.
- The local fixture profile check renders both the default `responses` value
  and an explicit `chat_completions` value.
- The Helm chart check renders both values, rejects an invalid value, and
  rejects placing the setting under a non-gateway component.
- An explicit VM production Compose render with
  `LLM_PROVIDER_OPENAI_API_SURFACE=chat_completions` passed and preserved the
  selected value in the llm-gateway environment.
- Workspace `node scripts/harness/check-platform-contracts.mjs`: passed.

## Rollout and rollback

Merge after the corresponding `llm-gateway` change. Retain the default
`responses` value for the first rollout, then set
`components.llmGateway.openaiApiSurface=chat_completions` (or the equivalent
Compose environment value) where required. Roll back by restoring `responses`;
the change is configuration-only and has no data migration.

## Completion criteria

- Every supported deployment track passes exactly one validated API-surface
  value to llm-gateway.
- Defaults retain the Responses API.
- Invalid Helm values fail schema validation.
- Operational documentation describes selection and rollback.
