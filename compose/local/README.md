# compose/local

`compose.source.yaml` is the local source-mounted overlay.

It is intended to be merged with `../vm-prod/compose.yaml` to run the full stack with hot reload and bind mounts.

Used by:

- `task local-up`
- `task local-down`
- `task local-reset`

The Task lifecycle includes the `platform-admin` profile by default through
`PLATFORM_ADMIN_CONSOLE=true`. Set `PLATFORM_ADMIN_CONSOLE=false` to omit the
real control-plane-backed admin console and its dedicated local Keycloak realm.
The underlying Compose service remains profile-gated.
