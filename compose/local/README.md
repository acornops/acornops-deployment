# compose/local

`compose.source.yaml` is the local source-mounted overlay.

It is intended to be merged with `../vm-prod/compose.yaml` to run the full stack with hot reload and bind mounts.

Used by:

- `task local-up`
- `task local-down`
- `task local-reset`

The `platform-admin` profile is opt-in through
`PLATFORM_ADMIN_CONSOLE=true`. It adds the real control-plane-backed admin
console and its dedicated local Keycloak realm without changing the default
local service set.
