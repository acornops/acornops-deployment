# Docker-on-VM Production Deployment

This mode deploys pinned images on a single VM (or small VM group) using Docker Compose.

Requires [Task](https://taskfile.dev/) CLI (`task`) and Docker Compose.

## Compose File

- `compose/vm-prod/compose.yaml`

## Environment

The template-copy and secret-generation steps below are for a fresh installation.
For an upgrade, preserve the existing environment files, encryption keys and
other secrets. Do not overwrite them with templates or generate replacement keys;
follow the [upgrade procedure](OPERATIONS.md#installation-and-upgrade-paths) and
change only the configuration required by the selected release.

1. Copy template: `cp env/vm/.env.example env/vm/.env.prod`
2. Copy agent template if deploying cluster agents against this VM platform: `cp env/vm/.env.agent.example env/vm/.env.agent`
3. Set production values:
   - domain/hosts (`BASE_DOMAIN=acornops.dev`, `API_HOST=api.acornops.dev`, `MANAGEMENT_CONSOLE_HOST=console.acornops.dev`, and any OIDC subdomains)
   - pinned image tags (`MANAGEMENT_CONSOLE_IMAGE`, `CONTROL_PLANE_IMAGE`, `EXECUTION_ENGINE_IMAGE`, `LLM_GATEWAY_IMAGE`)
   - pinned VM agent release (`AGENTV_SYSTEMD_RELEASE_VERSION`) and HTTPS release source (`AGENTV_SYSTEMD_RELEASE_BASE_URL`)
   - OIDC settings (production Keycloak or equivalent provider)
   - secrets and DB credentials
   - durable execution settings (`PERSIST_RUN_EVENTS=true`, `EXECUTION_ENGINE_REDIS_URL=redis://cp-redis:6379/1`)
   - internal gateway readiness target (`EXECUTION_GATEWAY_BASE_URL=http://llm-gateway:8001`)
   - optional organization CA (`ADDITIONAL_CA_BUNDLE_SOURCE_PATH`); when non-empty,
     `prod-up` enables `compose.additional-ca.yaml` for every server component
     and migration job
4. Verify the starting database state using the [installation and upgrade paths](OPERATIONS.md#installation-and-upgrade-paths); pre-release status does not authorize discarding existing data.

For a fresh installation, generate every production secret before starting the stack. Runtime validation rejects placeholder/default values such as `change-me`, `replace-me`, development service tokens, default database passwords, and the local gateway KEK.

```bash
# Shared bearer tokens, OIDC client secrets, and CSRF signing secrets.
openssl rand -base64 32

# 32-byte base64 keys for SECRETS_KEK_BASE64 and WEBHOOK_SECRET_ENCRYPTION_KEY.
openssl rand -base64 32

# Shared control-plane RSA signing key for gateway run JWTs.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | base64 | tr -d '\n'

# Database passwords.
openssl rand -base64 24
```

Required production values include `OIDC_CLIENT_SECRET`, `CSRF_SECRET`, `GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64`, `ORCH_SERVICE_TOKEN`, `EXTERNAL_INTEGRATION_CLIENTS_JSON`, `EXECUTION_ENGINE_DISPATCH_TOKEN`, `LLM_GATEWAY_ADMIN_TOKEN`, `WEBHOOK_SECRET_ENCRYPTION_KEY`, `CP_DB_PASSWORD`, `GATEWAY_DB_PASSWORD`, `SECRETS_KEK_BASE64`, `SECRETS_CACHE_TTL_SEC=0`, and Vault settings when `SECRETS_BACKEND=vault`.

Production application images must be pinned to immutable release tags. The
compose defaults follow `release/stack-versions.yaml`; do not use mutable tags
such as `latest` for `MANAGEMENT_CONSOLE_IMAGE`, `CONTROL_PLANE_IMAGE`,
`EXECUTION_ENGINE_IMAGE`, or `LLM_GATEWAY_IMAGE` in VM production.

LLM gateway MCP egress is deny-by-default for private networks in production. Keep `MCP_EGRESS_ALLOWED_HOSTS` empty for public remote MCP servers and require HTTPS. For private deployments, add only reviewed internal hostnames to `MCP_EGRESS_ALLOWED_HOSTS`; avoid setting `MCP_EGRESS_ALLOW_PRIVATE_NETWORKS=true` unless the whole gateway network is dedicated to trusted internal MCP traffic. `REMOTE_MCP_ENABLED=false` is the emergency kill switch and leaves built-in tools operational. `MCP_CONNECTION_RATE_LIMIT_PER_WINDOW` bounds connect and verify attempts for each credential owner and installation.

Automatic MCP OAuth is enabled by default and requires the canonical
`CONTROL_PLANE_BASE_URL` and `MANAGEMENT_CONSOLE_BASE_URL` to be public HTTPS
URLs, plus gateway Redis and encrypted secret storage. Complete the checklist in
[`mcp-oauth.md`](mcp-oauth.md) before deployment. Set
`MCP_OAUTH_ENABLED=false` to disable the capability.

## Deploy

First follow the [installation and upgrade paths](OPERATIONS.md#installation-and-upgrade-paths)
using both databases' recorded migration history and the selected images:

- Fresh empty databases need initialization, with no reset.
- Existing matching `greenfield-1` databases and secrets are preserved through pending forward migrations.
- A verified earlier epoch requires a separate data migration or explicit approval to discard data using the scoped reset procedure.
- Unknown history, checksum drift, divergent revisions, or a database ahead of the selected images require stopping and investigation.

For an upgrade, rehearse restoration and the selected procedure, quiesce writers
as required, and back up both databases plus the matching gateway secret
namespace. Deploy the control plane, execution engine, gateway and deployment
configuration as one pinned matrix.

```bash
task prod-up
```

`prod-up` runs `llm-gateway-init` and `control-plane-init` before the new
applications start; it does not stop existing writers. Inspect logs or
run the control-plane `db:status` command inside the service image when checking
migration state.

When crossing the MCP credential-model boundary, follow the
[coordinated upgrade](OPERATIONS.md#mcp-coordinated-upgrade) maintenance and
rollback procedure. Do not repeat its credential reset after the boundary is
already complete. Smoke test retained data, built-in tools and applicable
credential lifecycles before reopening traffic.

## Operate

```bash
task prod-ps
task prod-logs
task prod-down
```

## Notes

1. Keep API docs disabled in production (`CP_ENABLE_API_DOCS=false`, etc.) unless explicitly required.
2. Use `release/stack-versions.yaml` to keep cross-service versions compatible.
3. Run events are persisted in control-plane Postgres by default for production replay. The execution engine uses Redis DB 1 for run-id coordination, event outbox retry, terminal commit retry, and stale-run recovery.
4. VM Compose gates execution-engine and llm-gateway traffic on `/ready`; `/health` remains liveness-only for those services.
5. Investigate migration-history or checksum mismatches using the upgrade runbook; do not reset an existing installation to bypass them.
