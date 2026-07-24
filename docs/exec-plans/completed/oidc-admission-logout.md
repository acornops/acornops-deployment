# OIDC admission and logout deployment contract

## Goal

Expose the new OIDC enablement, admission, and logout configuration through Helm and Compose without editing generated charts directly.

## Validation

- Chart schema/render checks cover enabled, password-only, malformed admission, and Keycloak logout configurations.
- Compose rendering for Dex and Keycloak profiles passes.
- `task validate`, repository contract/harness checks, and workspace platform contract/harness checks pass.

## Completion criteria

- Policy JSON is rendered with Helm JSON serialization.
- Keycloak fixtures register the exact post-logout redirect URI.
- Dex can use the local-only logout fallback.
