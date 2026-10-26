# Security and agent maintenance demo release

## Authority and scope

On 2026-10-26 the user authorized a final check, committing the outstanding
changes to main, publication, and demo redeployment. Follow the existing release
procedure and upgrade demo in place. Preserve data, secrets, AI policy, enrolled
targets, existing local services, and unrelated workspace `tmp/` evidence. Do not
deploy production or upgrade the user's installed VM agent.

This integrates the reviewed runtime-validation security and agent-maintenance
changes. The separate production-readiness audit retains its remaining gates.

## Release coordinates

Fresh remote tags were checked before selecting these unused versions:

| Component | Experimental version |
| --- | --- |
| Control Plane | `0.0.1-experimental.40` |
| Management Console | `0.0.1-experimental.41` |
| AgentK image/chart | `0.0.1-experimental.15` |
| AgentV image/installer | `0.0.1-experimental.12` |
| Platform chart | `0.0.1-experimental.28` |

Execution Engine `.16`, Gateway `.21`, and Platform Admin Console `.7` are
unchanged. Public documentation is included in the main synchronization.

## Gates

- [ ] Final combined-source review and fresh affected-repository validation.
- [ ] Disposable-cluster repair, managed-key rollout, value/RBAC preservation,
  and external-Secret checks; no existing cluster mutations.
- [ ] Commit reviewed changes, fast-forward main, push without force, and require
  exact-source CI before publishing unique tags.
- [ ] Require hosted Linux browser, Kubernetes, and Node 22/24 systemd gates;
  verify published artifact availability, checksums, and source provenance.
- [ ] Validate coordinated chart/Compose/matrix pins and publish the platform
  chart only after its dependencies exist. Verify the public chart mirror.
- [ ] Capture demo readiness/storage/secret/target baseline, validate private
  pins, and trigger its existing leased atomic deployment once.
- [ ] Verify runtime versions/digests, public routes, maintenance API, retained
  data and enrollment, then synchronize all local/remote main branches.

## Rollback and evidence

No new database migration or agent protocol version. Rollback uses chart `.27`
and its previous image/installer pins; do not reset databases or re-enroll.
Deploy Control Plane before the console consumes the additive maintenance API.
Installed agents are not automatically upgraded by this platform release.

Local logs and disposable acceptance assets:
`/tmp/acornops-security-maintenance-release-urIgnd/`.
Image vulnerability checks and remaining production gates must be reported
separately from application dependency audits and demo acceptance.
