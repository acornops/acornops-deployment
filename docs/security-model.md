# Security Model

## Trust Boundaries

- Public browser traffic terminates at the edge proxy.
- Control-plane is the public API boundary for authenticated management console traffic.
- Control-plane admin endpoints are exposed only on the API host under
  `/admin/v1` when explicitly enabled. The management console host must not
  route `/admin`.
- Execution-engine and llm-gateway should remain internal to the deployment network.
- agentk uses cluster-scoped credentials and an agent key to connect back to the control plane.

## Secrets

- Do not commit generated env files or production secrets.
- Generate service tokens, OIDC secrets, database passwords, and encryption keys with cryptographically strong randomness.
- Generate admin API raw tokens with cryptographically strong randomness and
  store only their SHA-256 hash descriptors in deployment configuration.
- Keep `SECRETS_KEK_BASE64` and webhook encryption keys at decoded 32-byte length.

## High-Risk Changes

- Edge proxy route changes
- Admin API enablement, `/admin` route exposure, or admin token Secret wiring
- OIDC profile wiring
- Production env template changes
- Agent deploy/remove script changes
- Compose network, volume, or migration job changes
