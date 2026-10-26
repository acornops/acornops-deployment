# Approval resume and compact capability preview release

User-approved scope: verify and release the focused approval lifecycle, safe
approval error, AgentV restart-precondition guidance, and restored compact
capabilities list. Upgrade demo in place only; no reset, production deployment,
secret rotation, paid model call, or upgrade/restart of the user's VM agent.

## Release coordinates

- Control Plane `0.0.1-experimental.41` (previous `.40`).
- Execution Engine `0.0.1-experimental.17` (previous `.16`).
- Management Console `0.0.1-experimental.42` (previous `.41`).
- AgentV image and systemd assets `0.0.1-experimental.13` (previous `.12`).
- Platform chart `0.0.1-experimental.29` (previous `.28`).
- Gateway `.21`, admin console `.7`, and AgentK `.15` stay unchanged.

## Checklist

- [ ] Re-run component validation and focused browser tests; preserve the prior
  isolated integration and independent-review evidence in each component plan.
- [ ] Commit related changes separately, link PRs, pass hosted CI, and integrate
  into main. Publish new immutable tags only from verified source.
- [ ] Verify image digests/provenance, AgentV live systemd gates and release
  assets, then validate and publish the coordinated matrix/chart.
- [ ] Confirm the OCI chart and public chart mirror agree byte for byte.
- [x] Capture read-only demo versions, health, PVC UIDs, and identity/credential
  hashes. Keep all existing AI policy and values.
- [ ] Under the shared deployment lease, upgrade Control Plane first using the
  previous chart and `--reuse-values --atomic`. Confirm readiness before the new
  engine can resume runs. Stop if the Helm release is pending or preconditions fail.
- [ ] Update demo pins once; its main push triggers the normal deployment
  workflow. Do not dispatch a duplicate workflow.
- [ ] Verify new images, installer pin, HTTP/browser health, fresh VM heartbeat
  and telemetry, unchanged PVCs/secrets/identities/credentials, and released lease.
- [ ] Record release evidence, rollback and remaining user acceptance; archive
  this plan and reconcile affected local and remote main branches.

## Rollback and acceptance

There are no new database migrations or wire-shape changes. Keep the old images
and chart available. If necessary, restore the previous pinned matrix using the
normal atomic rollout with retained values; do not reset databases or credentials.
Rolling back restores the known approval-resume bug and the taller popup.

Publishing AgentV changes generated commands, not installed hosts. The owner
must explicitly run **Upgrade or repair AgentV** to receive the updated tool
descriptions. No actual service restart or paid chat is part of this release
verification. Existing production security/staging/recovery gates remain in
`production-readiness-audit.md`; demo success is not production certification.
