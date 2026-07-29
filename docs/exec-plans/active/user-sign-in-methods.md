# User Sign-In Methods

## Goal

Replace the legacy password-signup deployment policy with a runtime policy for
workspace-user Password and OIDC sign-in methods.

## Scope and boundary

- Render only non-secret deployment constraints and defaults into
  `PLATFORM_SETTINGS_POLICY_JSON`.
- Preserve the separate OIDC-only Platform Admin authentication boundary.
- Keep at least one deployment-supported workspace-user method available.
- Password selection permits password sign-in and first-time self-service
  signup; it does not enable any new administrative access path.

## Validation plan

- Update Helm values, schema, compose defaults, examples, and contract docs to
  the control-plane policy shape.
- Run the focused Helm contract/render checks and workspace platform contract
  check after the companion control-plane change is available.
