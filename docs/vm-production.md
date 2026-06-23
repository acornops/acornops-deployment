# Docker-on-VM Production Deployment

This mode deploys pinned images on a single VM (or small VM group) using Docker Compose.

Requires [Task](https://taskfile.dev/) CLI (`task`) and Docker Compose.

## Compose File

- `compose/vm-prod/compose.yaml`

## Environment

1. Copy template: `cp env/vm/.env.example env/vm/.env.prod`
2. Copy agent template if deploying cluster agents against this VM platform: `cp env/vm/.env.agent.example env/vm/.env.agent`
3. Set production values:
   - domain/hosts (`BASE_DOMAIN=acornops.dev`, `API_HOST=api.acornops.dev`, `MANAGEMENT_CONSOLE_HOST=console.acornops.dev`, and any OIDC subdomains)
   - pinned image tags (`MANAGEMENT_CONSOLE_IMAGE`, `CONTROL_PLANE_IMAGE`, `EXECUTION_ENGINE_IMAGE`, `LLM_GATEWAY_IMAGE`)
   - OIDC settings (production Keycloak or equivalent provider)
   - secrets and DB credentials
   - durable execution settings (`PERSIST_RUN_EVENTS=true`, `EXECUTION_ENGINE_REDIS_URL=redis://cp-redis:6379/1`)
   - internal gateway readiness target (`EXECUTION_GATEWAY_BASE_URL=http://llm-gateway:8001`)
4. Use a disposable or resettable Postgres database while the platform remains pre-release.

Generate every production secret before starting the stack. Runtime validation rejects placeholder/default values such as `change-me`, `replace-me`, development service tokens, default database passwords, and the local gateway KEK.

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

LLM gateway MCP egress is deny-by-default for private networks in production. Keep `MCP_EGRESS_ALLOWED_HOSTS` empty for public remote MCP servers and require HTTPS. For private deployments, add only reviewed internal hostnames to `MCP_EGRESS_ALLOWED_HOSTS`; avoid setting `MCP_EGRESS_ALLOW_PRIVATE_NETWORKS=true` unless the whole gateway network is dedicated to trusted internal MCP traffic.

## Deploy

```bash
task prod-up
```

`prod-up` runs `llm-gateway-init` and `control-plane-init` before starting application services. During the pre-release phase, schema files may be rewritten directly; inspect job logs or run the control-plane `db:status` command inside the service image when checking migration state.

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
5. Reset disposable deployment databases when schema files have been rewritten from an older local state.
