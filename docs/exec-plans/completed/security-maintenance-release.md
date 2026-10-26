# Security and agent maintenance demo release

Completed on 2026-10-26. Demo runs chart `.28`, revision 10, with all five
platform deployments Ready and retained data, secrets and enrollment. This
experimental release is not a production sign-off; remaining gates are recorded
in the [production audit](../active/production-readiness-audit.md).

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

- [x] Final combined-source review and fresh affected-repository validation.
- [x] Helm render/controller checks cover repair, managed-key rollout, value/RBAC
  preservation, and external Secrets. Hosted fresh-image Kubernetes rollout and
  read-only RBAC passed. The separate local live-upgrade canary was blocked by
  Docker disk pressure and ARM/AMD64 execution limits; it remains a production
  acceptance gate, not a claimed pass. No existing cluster was mutated.
- [x] Commit reviewed changes, fast-forward main, push without force, and require
  exact-source CI before publishing unique tags.
- [x] Require hosted Linux browser, Kubernetes, and Node 22/24 systemd gates;
  verify published artifact availability, checksums, and source provenance.
- [x] Validate coordinated chart/Compose/matrix pins and publish the platform
  chart only after its dependencies exist. Verify the public chart mirror.
- [x] Capture demo readiness/storage/secret/target baseline, validate private
  pins, and trigger its existing leased atomic deployment once.
- [x] Verify runtime versions/digests, public routes, maintenance API, retained
  data and enrollment, then synchronize all local/remote main branches.

## Rollback and evidence

No new database migration or agent protocol version. Rollback uses chart `.27`
and its previous image/installer pins; do not reset databases or re-enroll.
Deploy Control Plane before the console consumes the additive maintenance API.
Installed agents are not automatically upgraded by this platform release.
The original baseline is revision 8 (Control Plane `.39`, console `.40`, installer
`.11`); revision 9 is the intermediate backend-first stage, not the full previous
matrix. Restore the intended complete pins through the leased workflow rather
than assuming the immediately previous Helm revision is a full rollback.

Local logs and disposable acceptance assets:
`/tmp/acornops-security-maintenance-release-urIgnd/`.
Image vulnerability checks and remaining production gates must be reported
separately from application dependency audits and demo acceptance.

## Source qualification

Fresh local gates passed: Control Plane 1,358 tests plus migrated-database,
authorization, OpenAPI, contracts, build and runtime audit; AgentK 262 unit plus
one lifecycle test and Helm checks; AgentV 104 unit plus four protocol tests and
package smoke; Management Console 1,190 unit and 28 focused browser tests, plus
full validation. Docs build/links, workspace validation, deployment validation
and platform contracts passed. The combined independent review found no new
actionable source issue. Runtime audits in the three Node services report zero
advisories; image scans remain a separate gate.

| Repository | Integrated source | Exact-source CI |
| --- | --- | --- |
| Control Plane | `719d0604ee45d4855975904263483de57e743cd5` | [40337233183](https://github.com/acornops/control-plane/actions/runs/40337233183) |
| AgentK | `3340466e82b7c3d86ca52b66c2041cae13772c1e` | [40337256827](https://github.com/acornops/agentk/actions/runs/40337256827) |
| AgentV | `9b8685801055503b7f155c305e34673ce9129e41` | [40337247149](https://github.com/acornops/agentv/actions/runs/40337247149) |
| Management Console | `97890d8a1aad89568b7efc747eb3583a734d9b60` | [40337307171](https://github.com/acornops/management-console/actions/runs/40337307171) |
| Public docs | `061d1e896968b7f094f84fa834cdbe74f5292fcf` | [40337229344](https://github.com/acornops/docs-website/actions/runs/40337229344) |
| Deployment pins | `2bddc1cd52bf904841fd84e8d257d8cc1df12ca6` | [40337481407](https://github.com/acornops/acornops-deployment/actions/runs/40337481407) |

The console CI includes Linux desktop/mobile routes, snapshots, fixtures and MCP
parity. No screenshots were replaced to bypass a mismatch. AgentK's
[release](https://github.com/acornops/agentk/actions/runs/40339293773) independently
built and ran the exact new image in Kubernetes, verified read-only RBAC and
passed lifecycle tests. AgentV's
[release](https://github.com/acornops/agentv/actions/runs/40337653941) passed live
Ubuntu systemd checks on Node 22 and 24, runtime trust checks, curl 7.68
compatibility, and package verification.

The local upgrade/replacement canary did not pass: Docker storage prevented the
cached development image from scheduling; the smaller published AMD64 baseline
could not execute on the ARM node. Only the task-owned cluster, temporary image
tag, and disposable database/cache containers were removed. No user images,
volumes, services or checkouts were pruned. Hosted fresh-install verification
does not establish live credential-preserving upgrade acceptance.

## Backend-first demo stage

Baseline: chart `.27`, revision 8, all five deployments Ready, one enrolled VM
online on AgentV `.10`. No competing deployment or lease existed. Before changing
demo, captured PVC identities and hashes of the platform Secret, workspace/target
identities, agent registrations and AgentV credentials, without exposing secret
values.

To honor API-before-console rollout, a separately leased atomic upgrade retained
chart `.27` and all existing values, changing only the Control Plane image to
`.40`. Revision 9 became Ready before the new console deployment. Public route
checks passed and all identity/credential/Secret hashes were unchanged. The new
maintenance route rejected an unauthenticated probe with 401. The VM remained
online; no enrollment or host operation was performed. The shared lease was
released after this stage. The final private pin push triggered the ordinary
leased deployment once, bringing the coordinated chart and installer pins forward.

Authenticated browser inspection is limited by the absence of a signed-in demo
session. Public console rendering and OIDC navigation work; signed-in UI flows
are covered by the automated fixture/CI suites, not claimed as live-demo acceptance.

## Published artifacts

All component releases succeeded, including Control Plane
[40338390910](https://github.com/acornops/control-plane/actions/runs/40338390910)
and Management Console
[40340071030](https://github.com/acornops/management-console/actions/runs/40340071030).
The latter reran its full browser suite before building the image. Image build
provenance points to the exact integrated commits above. AgentV archive and
bootstrap checksums and signed GitHub attestations match its release tag,
workflow and source commit.

| Image | OCI index digest |
| --- | --- |
| Control Plane `.40` | `sha256:546c35aa4cbff1057dd186d315d17bcd65391662a11ff2415894a90fd791e536` |
| Management Console `.41` | `sha256:859ad13298bc52da6963852ce19f0805bf880f5f7d9b4502036c5a16365a17c4` |
| AgentK `.15` | `sha256:d5d78b7e77f268f79cf07436a565b154163245c1230c77123311949c27bbf5f8` |
| AgentV `.12` | `sha256:d506beae149126d6dcc92257b2b6087371656d91cbcd0bc4342e3443f69a907f` |

Platform chart `.28`, source `2bddc1cd52bf904841fd84e8d257d8cc1df12ca6`, passed
[publication](https://github.com/acornops/acornops-deployment/actions/runs/40345275210).
Its OCI digest is `sha256:7050b7dcbed84c76ff2763dbf4818667a2ac737b7aa9671eea6c46e2b77194c5`.
Both chart archives match reviewed source (allowing Helm's normalized Chart.yaml
formatting), and each public Pages mirror is byte-identical to its OCI archive.
The complete published matrix check passed with no skipped artifacts.

Fresh Trivy scans found no new High/Critical package/advisory pairs relative to
the previous experimental release. Targeted Zod/Nodemailer findings are absent.
Remaining OS and bundled npm findings are **not waived for production**:

| Image | High | Critical | Findings with a fixed version |
| --- | ---: | ---: | ---: |
| Control Plane `.40` | 67 | 1 | 10 |
| AgentK `.15` | 67 | 1 | 10 |
| AgentV `.12` | 75 | 1 | 10 |
| Management Console `.41` | 56 | 2 | 58 |

The private demo pin commit `49e9f70cbd1ca51d4edffad2f184667255f408c3` triggered
[deployment 40345613922](https://github.com/acornops/demo-infra/actions/runs/40345613922)
once. No extra workflow dispatch, secret upload, cleanup override or teardown
was used. Local private-repository checks included required Ansible syntax and
secret-reference validation; the latter uploaded nothing. Live preflight found
33 GB free disk, about 11 GB available memory, all services Ready and no competing
deployment lease.

## Final acceptance

The demo workflow and private main CI both succeeded. The final release is
`deployed`, chart `.28`, revision 10. All five deployments are Ready; Control
Plane `.40` and console `.41` runtime image IDs match the verified OCI index
digests. Execution Engine `.16`, Gateway `.21` and Admin Console `.7` remain
selected. Generated AgentV commands select `.12`.

`task demo:verify` and the explicit before/after assertions in
`/tmp/acornops-security-maintenance-release-urIgnd/verify-final.mjs` passed:

- All PVC identities and the platform Secret checksum are unchanged.
- Workspace/target identities and agent registration/credential hashes are unchanged.
- The existing VM remains online on `.10`, with heartbeat and snapshot timestamps
  newer than the final upgrade. This verifies compatibility, not a host upgrade.
- Public console/API/identity/admin readiness checks pass. Browser inspection
  loaded the new `index-BIoUwFde.js` entrypoint with no captured console errors.
- The shared deployment lease was released. No reset, credential rotation,
  production deployment, paid request, or user-VM service operation occurred.

The user's next host step is **VM Settings → Upgrade or repair AgentV** to install
`.12` while preserving its credential and policy. Live Kubernetes upgrade/repair
acceptance, production-like SMTP/provider/backup recovery, input-resource budgets,
and the remaining image findings still require separate production qualification.
