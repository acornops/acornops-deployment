# Remove automation rollout configuration

Status: implemented, validated, and independently reviewed; blocked for deployment until
a compatible control-plane release is pinned.

Remove retired mode and canary environment variables and Helm properties from
Compose, example env files, chart defaults/schema/templates, and the drain-smoke
fixture. Keep worker cadence and existing workspace admission/dispatch controls.
Document removal from user overrides, explicit maintenance pauses, and the
diagnostics contract change. The matching runtime and public docs changes use
`fix/remove-automation-rollout` in control-plane, management-console, and
docs-website.

## Release prerequisite

The current control-plane `0.0.1-experimental.42` image still defaults to disabled
dispatch without its mode setting. Merge and release the control-plane removal,
then advance the release matrix and image pins before merging or deploying these
templates. No release number is reserved by this change. No images are published
and no environment is deployed during implementation.

## Verification

Run `task validate`, including strict Helm schema/render checks, local/production
Compose rendering, drain fixtures, contracts, and release-matrix consistency.
Run workspace platform contract checks against all coordinated branches.
`task validate` passed after synchronizing the mirrored console contract and
providing the existing `ws` dependency for local drain fixtures. Strict Helm
checks additionally confirmed that default rendering omits retired environment
settings and rejects either retired Helm override. Workspace platform contracts
passed across all coordinated branches. Public docs validation/links passed.
One independent whole-change review found no actionable issues. No live upgrade
or production deployment was run; the release prerequisite remains open.
