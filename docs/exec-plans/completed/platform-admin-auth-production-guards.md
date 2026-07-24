# Platform Admin Auth Production Guards

Status: complete
Branch: `feat/platform-admin-console`

## Outcome

Make the Helm release fail before deployment when the platform admin console
would weaken the privileged-session baseline or omit its dedicated OIDC
identity configuration.

## Guardrails

- Require a non-empty admin OIDC issuer and client ID.
- Require at least one configured MFA assurance claim.
- Cap the absolute session at one hour and idle/recent-auth windows at 15
  minutes when the platform admin console is enabled.
- Preserve internal mTLS, ingress TLS, and required human-auth checks.

## Validation

- Chart rejection cases passed for missing issuer/client/MFA evidence and
  excessive absolute, idle, and recent-auth session windows.
- Full deployment validation and cross-repository contract checks passed.
