# AcornOps Full-System Exploration (Deployment Repo)

This document is for exploring AcornOps end-to-end from the deployment repository (all components together), not for isolated per-component tests.

It covers:

1. Bringing up the full local stack.
2. Validating routing, auth, orchestration, execution, and gateway flows.
3. Inspecting state across Postgres/Redis/logs.
4. Exercising realistic failure and debug workflows.

Tested against local stack on 2026-03-01 using `task local-up` in this repo.

## 1. Prerequisites

```bash
cd acornops-deployment
```

Tools used below:

```bash
command -v docker
command -v jq
command -v curl
command -v task
```

If needed, initialize local env file:

```bash
cp -n env/local/.env.example env/local/.env.local
```

## 2. Start Full Stack

Start all local services (edge proxy + management console + control-plane + execution-engine + llm-gateway + k8s-agent + dex + stateful dependencies):

```bash
task local-up
```

Check service status:

```bash
task local-ps
```

Tail all logs:

```bash
task local-logs
```

## 3. Shell Bootstrap (recommended)

Run this once in your shell for the rest of the commands:

```bash
export AO_CP="http://control-plane.acornops.localhost:8088"
export AO_EE="http://execution-engine.acornops.localhost:8088"
export AO_GW="http://llm-gateway.acornops.localhost:8088"
export AO_WEB="http://console.acornops.localhost:8088"
export AO_API="http://acornops.localhost:8088"
export AO_COOKIE="/tmp/acornops-explore.cookies"
export AO_ORCH_TOKEN="dev_orchestrator_token"
rm -f "$AO_COOKIE"
```

## 4. Edge Routing and Base Health

Platform routing checks through edge proxy:

```bash
curl -sS "$AO_CP/health" | jq .
curl -sS "$AO_EE/health" | jq .
curl -sS "$AO_GW/health" | jq .
curl -sS "$AO_GW/ready" | jq .
```

Host-header fallback (if `*.localhost` resolution is problematic):

```bash
curl -sS -H 'Host: control-plane.acornops.localhost' http://127.0.0.1:8088/health | jq .
curl -sS -H 'Host: execution-engine.acornops.localhost' http://127.0.0.1:8088/health | jq .
curl -sS -H 'Host: llm-gateway.acornops.localhost' http://127.0.0.1:8088/health | jq .
```

Management console/API host landing path behavior:

```bash
curl -i -sS "$AO_WEB/" | sed -n '1,20p'
curl -i -sS "$AO_API/" | sed -n '1,20p'
```

Swagger/OpenAPI checks (local development defaults):

```bash
curl -i -sS "$AO_CP/docs" | sed -n '1,20p'
curl -sS "$AO_CP/openapi.json" | jq '.info'

curl -i -sS "$AO_EE/docs" | sed -n '1,20p'
curl -sS "$AO_EE/openapi.json" | jq '.info'

curl -i -sS "$AO_GW/docs" | sed -n '1,20p'
curl -sS "$AO_GW/openapi.json" | jq '.info'
```

## 5. Authenticate (Control-Plane Dev Login)

For local exploration, use dev-login to get session cookie:

```bash
curl -sS -c "$AO_COOKIE" -X POST "$AO_CP/api/v1/auth/dev-login" \
  -H 'content-type: application/json' \
  -d '{"email":"dev@acornops.local","name":"Dev User"}' | jq .
```

Verify session:

```bash
curl -sS -b "$AO_COOKIE" "$AO_CP/api/v1/me" | jq .
```

Logout:

```bash
curl -sS -b "$AO_COOKIE" -c "$AO_COOKIE" -X POST "$AO_CP/api/v1/auth/logout" | jq .
```

## 6. Workspace and Cluster Exploration

List workspaces and default seeded workspace:

```bash
curl -sS -b "$AO_COOKIE" "$AO_CP/api/v1/workspaces" | jq .
```

List clusters in seeded workspace (`4b930d98-add9-4924-ab26-3c16d96ec373`):

```bash
curl -sS -b "$AO_COOKIE" "$AO_CP/api/v1/workspaces/4b930d98-add9-4924-ab26-3c16d96ec373/kubernetes-clusters" | jq .
```

Get seeded cluster (`5b006e4c-509c-458a-9f02-5aafbdc01ade`) details and latest snapshot:

```bash
curl -sS -b "$AO_COOKIE" "$AO_CP/api/v1/workspaces/4b930d98-add9-4924-ab26-3c16d96ec373/kubernetes-clusters/5b006e4c-509c-458a-9f02-5aafbdc01ade" | jq .
```

Create new workspace:

```bash
NEW_WS_JSON=$(curl -sS -b "$AO_COOKIE" -X POST "$AO_CP/api/v1/workspaces" \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Workspace"}')
echo "$NEW_WS_JSON" | jq .
export AO_WS_ID=$(echo "$NEW_WS_JSON" | jq -r '.id')
```

Register cluster in new workspace:

```bash
NEW_CLUSTER_JSON=$(curl -sS -b "$AO_COOKIE" \
  -X POST "$AO_CP/api/v1/workspaces/$AO_WS_ID/kubernetes-clusters" \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Cluster"}')
echo "$NEW_CLUSTER_JSON" | jq .
export AO_CLUSTER_ID=$(echo "$NEW_CLUSTER_JSON" | jq -r '.cluster.id')
export AO_CLUSTER_AGENT_KEY=$(echo "$NEW_CLUSTER_JSON" | jq -r '.agentKey')
```

Update cluster metadata:

```bash
curl -sS -b "$AO_COOKIE" \
  -X PATCH "$AO_CP/api/v1/workspaces/$AO_WS_ID/kubernetes-clusters/$AO_CLUSTER_ID" \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Cluster Renamed"}' | jq .
```

Rotate cluster agent key:

```bash
curl -sS -b "$AO_COOKIE" \
  -X POST "$AO_CP/api/v1/workspaces/$AO_WS_ID/kubernetes-clusters/$AO_CLUSTER_ID/rotate-agent-key" | jq .
```

## 7. Chat Session and Run Lifecycle (Cross-Service)

Create session in the seeded Kubernetes cluster:

```bash
SESSION_JSON=$(curl -sS -b "$AO_COOKIE" \
  -X POST "$AO_CP/api/v1/workspaces/4b930d98-add9-4924-ab26-3c16d96ec373/kubernetes-clusters/5b006e4c-509c-458a-9f02-5aafbdc01ade/sessions" \
  -H 'content-type: application/json' \
  -d '{"title":"Investigate CrashLoopBackOff"}')
echo "$SESSION_JSON" | jq .
export AO_SESSION_ID=$(echo "$SESSION_JSON" | jq -r '.id')
```

List conversations for cluster (newest first, cursor pagination):

```bash
curl -sS -b "$AO_COOKIE" \
  "$AO_CP/api/v1/workspaces/4b930d98-add9-4924-ab26-3c16d96ec373/kubernetes-clusters/5b006e4c-509c-458a-9f02-5aafbdc01ade/sessions?limit=20" \
  | jq .
```

Post user message to start run (control-plane dispatches execution-engine):

```bash
RUN_TRIGGER_JSON=$(curl -sS -b "$AO_COOKIE" \
  -X POST "$AO_CP/api/v1/sessions/$AO_SESSION_ID/messages" \
  -H 'content-type: application/json' \
  -d '{"content":"Pods are restarting continuously in namespace default. Investigate."}')
echo "$RUN_TRIGGER_JSON" | jq .
export AO_RUN_ID=$(echo "$RUN_TRIGGER_JSON" | jq -r '.run_id')
```

Idempotent message submit retry example (same `clientMessageId` should return same run):

```bash
export AO_CLIENT_MESSAGE_ID="$(uuidgen | tr 'A-Z' 'a-z')-msg-1"
curl -sS -b "$AO_COOKIE" \
  -X POST "$AO_CP/api/v1/sessions/$AO_SESSION_ID/messages" \
  -H 'content-type: application/json' \
  -d "{\"content\":\"Check pod health in acornops-demo namespace\",\"clientMessageId\":\"$AO_CLIENT_MESSAGE_ID\"}" \
  | jq .
curl -sS -b "$AO_COOKIE" \
  -X POST "$AO_CP/api/v1/sessions/$AO_SESSION_ID/messages" \
  -H 'content-type: application/json' \
  -d "{\"content\":\"Check pod health in acornops-demo namespace\",\"clientMessageId\":\"$AO_CLIENT_MESSAGE_ID\"}" \
  | jq .
```

Poll run status:

```bash
for i in {1..10}; do
  curl -sS -b "$AO_COOKIE" "$AO_CP/api/v1/runs/$AO_RUN_ID" | jq '{id,status,errorCode,errorMessage,startedAt,endedAt}'
  sleep 1
done
```

List session messages:

```bash
curl -sS -b "$AO_COOKIE" "$AO_CP/api/v1/sessions/$AO_SESSION_ID/messages" | jq .
```

Run SSE stream (Ctrl+C to stop):

```bash
curl -sS -N -b "$AO_COOKIE" "$AO_CP/api/v1/runs/$AO_RUN_ID/stream"
```

Short SSE sample (auto-stop in 5 seconds):

```bash
curl -sS -N --max-time 5 -b "$AO_COOKIE" "$AO_CP/api/v1/runs/$AO_RUN_ID/stream"
```

Cancel run:

```bash
curl -sS -b "$AO_COOKIE" -X POST "$AO_CP/api/v1/runs/$AO_RUN_ID/cancel" | jq .
```

Delete conversation:

```bash
curl -sS -b "$AO_COOKIE" -X DELETE "$AO_CP/api/v1/sessions/$AO_SESSION_ID" -i
```

## 8. Internal Orchestration Endpoints (Bootstrap, Events, Commit)

These endpoints are consumed by execution-engine and use orchestrator service token auth.

Get bootstrap snapshot for a run:

```bash
BOOTSTRAP_JSON=$(curl -sS -b "$AO_COOKIE" \
  -H "Authorization: Bearer $AO_ORCH_TOKEN" \
  -X POST "$AO_CP/api/v1/runs/$AO_RUN_ID/bootstrap")
echo "$BOOTSTRAP_JSON" | jq '{contract_version,scope,context,llm,tools}'
```

Get session context payload:

```bash
curl -sS -b "$AO_COOKIE" \
  -H "Authorization: Bearer $AO_ORCH_TOKEN" \
  "$AO_CP/api/v1/sessions/$AO_SESSION_ID/context?run_id=$AO_RUN_ID" | jq .
```

Ingest synthetic run events:

```bash
NOW_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -sS -b "$AO_COOKIE" \
  -H "Authorization: Bearer $AO_ORCH_TOKEN" \
  -H 'content-type: application/json' \
  -X POST "$AO_CP/api/v1/runs/$AO_RUN_ID/events" \
  -d "{\"events\":[
    {\"schema_version\":1,\"run_id\":\"$AO_RUN_ID\",\"seq\":1,\"ts\":\"$NOW_UTC\",\"type\":\"run_started\",\"payload\":{\"source\":\"manual\"}},
    {\"schema_version\":1,\"run_id\":\"$AO_RUN_ID\",\"seq\":2,\"ts\":\"$NOW_UTC\",\"type\":\"assistant_token_delta\",\"payload\":{\"text\":\"Checking deployment status...\"}}
  ]}" | jq .
```

Get run events:

```bash
curl -sS -b "$AO_COOKIE" \
  -H "Authorization: Bearer $AO_ORCH_TOKEN" \
  "$AO_CP/api/v1/runs/$AO_RUN_ID/events" | jq .
```

Commit final run result manually:

```bash
START_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
END_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -sS -b "$AO_COOKIE" \
  -H "Authorization: Bearer $AO_ORCH_TOKEN" \
  -H 'content-type: application/json' \
  -X POST "$AO_CP/api/v1/runs/$AO_RUN_ID/commit" \
  -d "{
    \"status\":\"completed\",
    \"assistant_message\":{
      \"content\":\"Investigated. Check readiness probe failures and recent rollouts.\",
      \"format\":\"markdown\"
    },
    \"usage\":{\"input_tokens\":350,\"output_tokens\":120,\"tool_calls\":1},
    \"timing\":{\"started_at\":\"$START_UTC\",\"ended_at\":\"$END_UTC\"}
  }" | jq .
```

Get commit object:

```bash
curl -sS -b "$AO_COOKIE" \
  -H "Authorization: Bearer $AO_ORCH_TOKEN" \
  "$AO_CP/api/v1/runs/$AO_RUN_ID/commit" | jq .
```

## 9. LLM Gateway Direct Exploration (Using Run-Scoped JWT)

Extract run-scoped gateway token from bootstrap:

```bash
export AO_GATEWAY_TOKEN=$(echo "$BOOTSTRAP_JSON" | jq -r '.llm.gateway.token')
```

### 9.1 MCP Tool Call Through llm-gateway

Call seeded tool (`get_weather`) in llm-gateway (`llm-gateway/scripts/seed_db.py`):

```bash
curl -sS -H "Authorization: Bearer $AO_GATEWAY_TOKEN" \
  -H 'content-type: application/json' \
  -X POST "$AO_GW/api/v1/mcp/tool-call" \
  -d "{
    \"run_id\":\"$AO_RUN_ID\",
    \"workspace_id\":\"4b930d98-add9-4924-ab26-3c16d96ec373\",
    \"target_id\":\"5b006e4c-509c-458a-9f02-5aafbdc01ade\",
    \"target_type\":\"kubernetes\",
    \"tool\":\"get_weather\",
    \"arguments\":{\"location\":\"Singapore\"}
  }" | jq .
```

Expected: `is_error=false` with weather text from mock MCP server.

Scope mismatch check (should return 403):

```bash
curl -i -sS -H "Authorization: Bearer $AO_GATEWAY_TOKEN" \
  -H 'content-type: application/json' \
  -X POST "$AO_GW/api/v1/mcp/tool-call" \
  -d "{
    \"run_id\":\"wrong_run_id\",
    \"workspace_id\":\"4b930d98-add9-4924-ab26-3c16d96ec373\",
    \"target_id\":\"5b006e4c-509c-458a-9f02-5aafbdc01ade\",
    \"target_type\":\"kubernetes\",
    \"tool\":\"get_weather\",
    \"arguments\":{\"location\":\"Singapore\"}
  }" | sed -n '1,80p'
```

### 9.2 LLM Streaming Endpoint

NDJSON stream call:

```bash
curl -sS -N -H "Authorization: Bearer $AO_GATEWAY_TOKEN" \
  -H 'content-type: application/json' \
  -X POST "$AO_GW/api/v1/llm/chat-completions:stream" \
  -d "{
    \"run_id\":\"$AO_RUN_ID\",
    \"workspace_id\":\"4b930d98-add9-4924-ab26-3c16d96ec373\",
    \"target_id\":\"5b006e4c-509c-458a-9f02-5aafbdc01ade\",
    \"target_type\":\"kubernetes\",
    \"session_id\":\"$AO_SESSION_ID\",
    \"provider\":\"gemini\",
    \"model\":\"gemini-2.0-flash\",
    \"messages\":[
      {\"role\":\"system\",\"content\":\"You are AcornOps.\"},
      {\"role\":\"user\",\"content\":\"Give one troubleshooting step for CrashLoopBackOff.\"}
    ],
    \"temperature\":0.2,
    \"max_output_tokens\":128
  }"
```

If `ACORNOPS_DEV_SEED_GEMINI_API_KEY` is not set before local seed, and no workspace key is configured later, API keys are fake and you will typically get an `error` stream event from the provider SDK.

## 10. Execution Engine Direct Exploration

Start run directly on execution-engine API:

```bash
EE_RUN_ID="manual_$(date +%s)"
curl -i -sS -X POST "$AO_EE/api/v1/runs" \
  -H 'content-type: application/json' \
  -d "{
    \"run_id\":\"$EE_RUN_ID\",
    \"workspace_id\":\"4b930d98-add9-4924-ab26-3c16d96ec373\",
    \"target_id\":\"5b006e4c-509c-458a-9f02-5aafbdc01ade\",
    \"target_type\":\"kubernetes\",
    \"session_id\":\"s_demo\",
    \"message_id\":\"m_demo\",
    \"requested_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" | sed -n '1,40p'
```

Cancel run directly:

```bash
curl -i -sS -X POST "$AO_EE/api/v1/runs/$EE_RUN_ID/cancel" | sed -n '1,40p'
```

Execution-engine metrics quick view:

```bash
curl -sS "$AO_EE/metrics" | rg 'active_runs|runs_started_total|runs_completed_total|runs_failed_total|runs_cancelled_total'
```

## 11. Agent and Cluster Connectivity Exploration

Check k8s-agent logs:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local logs --tail=150 k8s-agent
```

Check control-plane websocket logs:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local logs --tail=150 control-plane
```

Check cluster status and latest snapshot:

```bash
curl -sS -b "$AO_COOKIE" "$AO_CP/api/v1/workspaces/4b930d98-add9-4924-ab26-3c16d96ec373/kubernetes-clusters/5b006e4c-509c-458a-9f02-5aafbdc01ade" | jq '{id,status,latestSnapshot}'
```

Direct agent tool calls are not exposed on the public API. Use the cluster chat/session APIs to trigger authorized diagnostic runs, or inspect the internal MCP bridge from service-to-service tests.

## 12. Datastore and State Inspection

### 12.1 Control-Plane Postgres

List latest runs:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T cp-postgres \
  psql -U acornops -d acornops_control_plane \
  -c "select id,workspace_id,target_id,status,requested_at,started_at,ended_at from runs order by requested_at desc limit 20;"
```

Inspect sessions/messages:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T cp-postgres \
  psql -U acornops -d acornops_control_plane \
  -c "select id,workspace_id,target_id,title,status,created_at from sessions order by created_at desc limit 20;"

docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T cp-postgres \
  psql -U acornops -d acornops_control_plane \
  -c "select id,session_id,run_id,role,left(content,100) as content_preview,created_at from messages order by created_at desc limit 20;"
```

Inspect run events:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T cp-postgres \
  psql -U acornops -d acornops_control_plane \
  -c "select run_id,seq,type,ts from run_events order by ts desc, seq desc limit 30;"
```

Inspect cluster snapshots and agent registrations:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T cp-postgres \
  psql -U acornops -d acornops_control_plane \
  -c "select target_id,workspace_id,snapshot_ts from target_snapshots order by snapshot_ts desc limit 20;"

docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T cp-postgres \
  psql -U acornops -d acornops_control_plane \
  -c "select target_id,key_version,last_seen_at,last_heartbeat_at,last_connection_id,last_agent_version from target_agent_registrations order by target_id;"
```

### 12.2 Control-Plane Redis

List active session keys:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T cp-redis \
  redis-cli --scan --pattern 'cp:session:*'
```

Read one session record:

```bash
SESSION_KEY=$(docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T cp-redis \
  redis-cli --scan --pattern 'cp:session:*' | head -n 1)

docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T cp-redis \
  redis-cli get "$SESSION_KEY"
```

### 12.3 Gateway Postgres

List tables:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T gateway-postgres \
  psql -U gateway_user -d gateway -c '\dt'
```

Inspect seeded gateway tools:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T gateway-postgres \
  psql -U gateway_user -d gateway \
  -c "select workspace_id,target_id,target_type,tool_name,mcp_server_url,enabled from gateway_tools;"
```

Inspect secret record count (encrypted payloads):

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local exec -T gateway-postgres \
  psql -U gateway_user -d gateway \
  -c "select count(*) as encrypted_secret_records from gateway_secrets;"
```

## 13. Observability and Runtime Diagnostics

Service-specific logs:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local logs --tail=200 control-plane

docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local logs --tail=200 execution-engine

docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local logs --tail=200 llm-gateway

docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local logs --tail=200 k8s-agent

docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local logs --tail=200 mock-mcp
```

Metrics snapshots:

```bash
curl -sS "$AO_CP/metrics"
curl -sS "$AO_EE/metrics" | head -n 40
curl -sS "$AO_GW/metrics" | head -n 40
```

Container resource snapshot:

```bash
docker stats --no-stream
```

## 14. Failure Drills and Recovery

Stop llm-gateway and observe impact:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local stop llm-gateway
curl -i -sS "$AO_GW/health" | sed -n '1,20p'
```

Restart llm-gateway and re-check:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local start llm-gateway
curl -sS "$AO_GW/health" | jq .
```

Restart execution-engine:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local restart execution-engine
curl -sS "$AO_EE/health" | jq .
```

Rebuild one service after code or dependency changes:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local up -d --build control-plane
```

## 15. OIDC Profile Switching (Dex vs Keycloak)

Default local profile is Dex:

```bash
task local-down
task local-up LOCAL_OIDC_PROFILE=oidc-dex
```

Optional local Keycloak profile:

```bash
task local-down
task local-up LOCAL_OIDC_PROFILE=oidc-keycloak
```

Keycloak checks:

```bash
curl -sS http://localhost:8082/realms/acornops/.well-known/openid-configuration | jq .
```

Dex checks:

```bash
curl -sS http://localhost:5556/dex/.well-known/openid-configuration | jq .
```

## 16. Internal Endpoint Auth Notes

Current behavior in this codebase:

1. Execution-engine calls control-plane internal execution endpoints using service token auth (`Authorization: Bearer $AO_ORCH_TOKEN`).
2. Internal run lifecycle endpoints (`/bootstrap`, `/events`, `/commit`) are expected to succeed with service token only.
3. User-facing run endpoints (`GET /api/v1/runs/{runId}`, `GET /api/v1/runs/{runId}/events`, `GET /api/v1/runs/{runId}/stream`) require user session cookie.

Quick check for unexpected internal auth failures:

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local logs --tail=200 execution-engine | rg 'bootstrap|/events|/commit|401|403'
```

## 17. Cleanup

Stop local stack:

```bash
task local-down
```

Stop and remove containers/networks (preserve named volumes):

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local down
```

Hard reset local state (removes volumes/data):

```bash
docker compose -f compose/vm-prod/compose.yaml -f compose/local/compose.source.yaml --profile local --profile oidc-dex --env-file env/local/.env.local down -v
```

Use hard reset only when you intentionally want to discard local Postgres/Redis/Dex data.
