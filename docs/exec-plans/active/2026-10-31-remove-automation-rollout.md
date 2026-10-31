# Remove automation rollout configuration

Status: implemented, validated, independently reviewed, and compatible runtime
image published/verified. Final merge evidence is tracked in deployment PR #28.

Remove retired mode and canary environment variables and Helm properties from
Compose, example env files, chart defaults/schema/templates, and the drain-smoke
fixture. Keep worker cadence and existing workspace admission/dispatch controls.
Document removal from user overrides, explicit maintenance pauses, and the
diagnostics contract change. The matching runtime and public docs changes use
`fix/remove-automation-rollout` in control-plane, management-console, and
docs-website.

## Release prerequisite

Control-plane `0.0.1-experimental.42` still defaults to disabled dispatch without
its mode setting. The coordinated fix is merged in control-plane #32 and the
compatible `0.0.1-experimental.43` image is required by these updated Compose and
Helm defaults. The image also includes the separately merged additive index
migration 013; run the normal migration initializer and use a quiet maintenance
window for substantial triage history. No database reset is needed.

The user authorized the focused capacity repair and merging/pushing all related
changes. Publish and verify the compatible runtime image before merging this
configuration. No running environment or new platform chart is deployed/published.

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
or production deployment was run. Final publication evidence follows below.

## Verified runtime publication

Control-plane release workflow [41210733262](https://github.com/acornops/control-plane/actions/runs/41210733262)
published `ghcr.io/acornops/control-plane:0.0.1-experimental.43` after verifying
[CI 41209999306](https://github.com/acornops/control-plane/actions/runs/41209999306)
for commit `903d79b7f12270f98c10dbd0c68c74e807d15527`. That tested commit is
merged into main and has the same source tree as merge commit `8f163bf`.
Registry inspection confirmed digest
`sha256:b69ab81b1b3f03855c5fbbfef3d389d1ae56b0210d51111837b21660e040660d`;
release provenance records the same source revision and digest.

Final `task validate` passed with the updated Compose application/init image,
Helm image/appVersion, release matrix, and migration guidance. Workspace contract
checks passed. The source chart defaults are updated; the already published
platform chart .30 remains immutable and no new platform chart was published.
The next chart release must receive its own version and promotion validation.
