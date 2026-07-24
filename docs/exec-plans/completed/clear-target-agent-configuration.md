# Clear target-agent configuration

## Goal

Replace the overloaded platform-chart `agent` section and generic environment
names with a configuration model whose scope is obvious to operators.

## Contract

- `agentGateway`: shared AgentK and AgentV control-plane connectivity.
- `assistantRuntime`: AI assistant limits and write-approval defaults.
- `targetAgents.agentk.helm`: generated AgentK installation settings.
- `builtinTargetMcp`: shared AgentK and AgentV target-tool bridge identity.

The control plane uses matching `ASSISTANT_*`, `AGENTK_HELM_*`, and
`BUILTIN_TARGET_MCP_SERVER_*` environment variables. The old names are removed;
the product has no released configuration contract that requires aliases.

## Validation

- Render and validate the platform chart and its examples.
- Type-check and test the control-plane configuration and AgentK install flow.
- Run deployment and workspace contract validation.
- Validate public documentation links and formatting.

## Result

The four-section chart contract and matching environment names are implemented
across deployment, control plane, LLM gateway, management console, and public
docs. Chart rendering, repository contracts, affected tests, production builds,
and documentation validation pass. The full control-plane database suite still
requires its external `CONTROL_PLANE_TEST_DATABASE_URL`; the directly affected
database-independent tests pass.
