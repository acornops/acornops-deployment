# Security Model

## Trust Boundaries

- Public browser traffic terminates at the edge proxy.
- Control-plane is the public API boundary for authenticated management console traffic.
- Platform-admin browser traffic uses the dedicated admin host. That host routes
  `/admin-auth` to the control plane and the console/BFF routes to the
  platform-admin-console. Raw `/admin/v1` routes remain private when
  `adminApi.ingress.enabled=false`; the management console host never routes
  `/admin`.
- Execution-engine and llm-gateway should remain internal to the deployment network.
- agentk uses cluster-scoped credentials and an agent key to connect back to the control plane.

## Secrets

- Do not commit generated env files or production secrets.
- Generate service tokens, OIDC secrets, database passwords, and encryption keys with cryptographically strong randomness.
- Generate admin API raw tokens with cryptographically strong randomness and
  store only their SHA-256 hash descriptors in deployment configuration.
- Keep the platform-admin BFF raw token, dedicated OIDC client secret, and admin
  CSRF signing secret in the platform Secret. The browser receives none of
  these values.
- Keep `SECRETS_KEK_BASE64` and webhook encryption keys at decoded 32-byte length.

## High-Risk Changes

- Edge proxy route changes
- Admin API enablement, `/admin` route exposure, or admin token Secret wiring
- OIDC profile wiring
- Platform-admin role mapping, MFA assurance claims, session settings, or audit retention/integrity changes
- Production env template changes
- Agent deploy/remove script changes
- Compose network, volume, or migration job changes
