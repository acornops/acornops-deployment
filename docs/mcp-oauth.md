# Automatic MCP OAuth

AcornOps can authorize an individual user to a compatible HTTP MCP server from
only the MCP URL and a browser login. This feature is provider-neutral: the MCP
resource and authorization server must publish standards-compliant metadata and
must advertise either Client ID Metadata Documents (CIMD) or unauthenticated
public Dynamic Client Registration (DCR).

AcornOps does not accept provider client IDs, client secrets, initial-access
tokens, or endpoint overrides. It does not configure the MCP or authorization
server. An administrator of those systems remains responsible for enabling the
MCP service and allowing CIMD or public DCR.

## Deployment contract

The shared feature flag is enabled by default and remains an operator kill
switch:

```dotenv
MCP_OAUTH_ENABLED=true
MCP_OAUTH_FLOW_TTL_SECONDS=600
MCP_OAUTH_REFRESH_SAFETY_SECONDS=60
MCP_OAUTH_HTTP_TIMEOUT_MS=10000
MCP_OAUTH_MAX_RESPONSE_BYTES=65536
```

Compose derives `MCP_OAUTH_PUBLIC_CONSOLE_URL` from
`MANAGEMENT_CONSOLE_BASE_URL`. Helm derives it from `platform.consoleUrl`.
This is a trusted deployment value; do not construct it from an inbound
`Host` header. The console origin must route `/api` to the control plane,
because OAuth callbacks intentionally return to the same host that owns the
user's host-only AcornOps session cookie.

The public endpoints are:

- `<platform.consoleUrl>/api/v1/mcp/oauth/client-metadata`
- `<platform.consoleUrl>/api/v1/mcp/oauth/callback`

Production URLs must use HTTPS. Changing the console URL changes both the
public CIMD client ID and callback URI. AcornOps will not reuse a DCR
registration created for the old public client metadata, so affected
connections must be reauthorized.

## Prerequisites

Before enabling OAuth:

1. Confirm control-plane and gateway Redis are durable, reachable by every
   replica, and not shared with an untrusted workload.
2. Confirm the gateway encrypted secret backend is configured. For
   `SECRETS_BACKEND=database`, use a strong `SECRETS_KEK_BASE64` and keep
   `SECRETS_CACHE_TTL_SEC=0` in production. For Vault, restrict the token to the
   AcornOps gateway namespace.
3. Confirm `platform.consoleUrl` (or its Compose equivalent) is the exact
   externally reachable HTTPS origin and serves the control-plane `/api`
   route on that same origin.
4. Allow the MCP resource, authorization-server discovery, registration, token,
   and revocation destinations through the existing MCP egress policy. Private
   destinations also need exact host allow-list entries, NetworkPolicy egress,
   and any required additional CA bundle.
5. Confirm the ingress forwards the public callback and CIMD paths to the
   control plane without rewriting the URL.
6. Configure every edge, ingress, CDN, WAF, and APM layer to omit query strings
   from access logs for the OAuth callback. Authorization codes and state arrive
   in that query. The bundled VM NGINX proxy logs `$uri` rather than `$request`;
   Kubernetes ingress logging is operator-owned and must provide the same
   guarantee.

External MCP and authorization servers are not readiness dependencies. When the
feature is enabled, readiness does fail if Redis or encrypted secret storage is
unavailable or misconfigured.

## Rollout and GitLab 18.10 canary

Deploy the gateway, control plane, console, and deployment configuration in that
order. Validate one compatible GitLab 18.10 MCP installation in a
non-production environment before production rollout:

1. Paste only the MCP URL and select OAuth.
2. Confirm the displayed issuer origin, scopes, registration method, and
   `offline_access` disclosure.
3. Complete browser authorization and verify that authenticated `tools/list`
   succeeds before the connection becomes connected.
4. Exercise token refresh, rotated refresh-token persistence, disconnect and
   revocation, reconnect, authorization denial, and an abandoned flow.
5. Confirm logs, metrics, audit events, and browser errors contain no code,
   state, PKCE verifier, access token, refresh token, or full authorization URL.
   Include ingress-controller, CDN, WAF, and APM request logs in this check.
6. Confirm `none`, bearer-token, and custom-header installations still connect
   and execute normally.

After the canary, enable the flag progressively. Monitor bounded OAuth stage,
method, and error-class metrics together with sanitized audit events. Issuer
URLs and user identities must not be metric labels.

## Rollback

Set `MCP_OAUTH_ENABLED=false` on both the control plane and gateway and roll the
two workloads. Existing static MCP authentication continues to work. Disabling
the flag prevents new OAuth preparation and execution; it does not require
deleting encrypted token records or DCR-created remote applications. Re-enable
only after the underlying issue is corrected.
