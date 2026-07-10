# Ingress-Independent NetworkPolicy Access

## Objective

Decouple public workload NetworkPolicy allowances from Helm Ingress ownership so
configured ingress-controller peers can reach the management console and
control plane whether the chart or an external system creates the Ingress.

## Scope

- Guard both public workload allow rules with
  `networkPolicies.ingressController.from`.
- Keep `exposure.ingress.enabled` responsible only for rendering the chart's
  Ingress resource.
- Preserve default-deny and all internal component traffic rules, including
  internal TLS port selection.
- Type standard Kubernetes NetworkPolicy peer fields in the Helm values schema
  while preserving empty and multiple peer lists.
- Add focused rendering and strict-lint coverage for Ingress ownership,
  configured and empty peers, component enablement, selector structure,
  destination ports, disabled NetworkPolicies, and internal TLS modes.
- Document chart-managed, externally managed, and disabled public access
  configurations, plus verification and rollback guidance.
- Prepare the source and validation for the next immutable experimental chart
  release; adopt its version in source and stack metadata only after publication.

## Boundaries

- Do not change control-plane application code, HTTP ports, routes, hostnames,
  TLS, DNS, ingress-controller installation, or unrelated egress policy.
- Do not broaden access to a whole release namespace or `0.0.0.0/0`.
- Do not inspect or mutate externally managed Ingress resources.
- Do not move internal component rules under the ingress-controller peer guard.
- Do not hand-edit the generated `charts` mirror. Packaging, publication,
  Artifactory mirroring, deployment, and live route verification remain in the
  existing release and rollout workflows.

## Security And Compatibility

- Non-empty peer lists render exactly the configured NetworkPolicy peers for
  both public workloads.
- Empty peer lists omit the entire public ingress-controller rule and fail
  closed without an empty `from` field.
- Existing values remain backward compatible; no extra enablement flag is
  introduced.
- The schema accepts standard `namespaceSelector`, `podSelector`, and `ipBlock`
  peer fields, including combined selectors and multiple peers.
- Rollback is a Helm downgrade to the preceding published chart. Operators using
  an external Ingress may temporarily retain an additive, tightly selected
  control-plane NetworkPolicy until the corrected release is deployed.

## Verification

- Reproduce the pre-change render with `exposure.ingress.enabled=false` and
  confirm the control-plane public allow rule is missing.
- `task k8s-chart-check`
- `task contracts:check`
- `task platform-contracts`
- `task harness:check`
- `task validate`
- `node scripts/harness/check-platform-contracts.mjs` from the workspace root
  when available under the workspace validation flow.
- Inspect rendered NetworkPolicies for the full ownership, peer, component, and
  internal TLS matrix.
- Report packaging, publication, internal mirror synchronization, cluster
  rollout, and public route checks as external follow-up when credentials and a
  target cluster are not part of the local workspace.

## Status

Source implementation, immutable chart publication, public mirror generation,
and source metadata adoption are complete. Internal Artifactory promotion and
live rollout remain externally dependent.

Local evidence:

- The pre-change external-Ingress render reproduced a missing control-plane
  ingress-controller rule while leaving the management-console rule present.
- `task k8s-chart-check`, `task contracts:check`, `task platform-contracts`,
  `task harness:check`, `task release-matrix-check`, and `task validate` passed.
- The chart check now covers Ingress ownership, configured and empty peers,
  component toggles, selector structure, custom target ports, disabled
  NetworkPolicies, internal TLS, and all three focused example overlays.
- A local `0.0.1-experimental.7` preflight package was built with the release
  workflow's version overrides. Strict lint passed for the package defaults and
  every example; packaged source hashes matched the working tree; and the
  packaged ownership/peer rendering matrix passed.
- Source PR #10 passed CI and merged to `main` at `90ab3ff`.
- Release tag `v0.0.1-experimental.7` published the OCI chart with manifest
  digest
  `sha256:a9728a488bb07946f70c9ac90b455f2e122a25aedd6d927fd0a6f5b66661c199`.
- The classic chart mirror published `.7` at commit `7d2d4ae`. OCI and classic
  package bytes match at SHA-256
  `0b4e71c8836989156f4c38f74ce56c09704ab4792580c9831a802fc95df19e62`,
  and the GitHub Pages package URL returns HTTP 200.
- The published ownership/peer rendering matrix passed against the downloaded
  `.7` artifact.
- Published-artifact validation confirmed the platform `.7` chart. The full
  stack check still reports pre-existing unavailable `agentk` `.2` image and
  chart pins; those unrelated agent artifacts are outside this enhancement.
- `Chart.yaml` and the Kubernetes stack release pin now track the published
  `0.0.1-experimental.7` chart. Component image pins remain unchanged because
  the enhancement changes only Helm rendering.
- The direct workspace platform-contract command remains unavailable because
  the declared `agentk` and `agentv` sibling checkouts are missing; the
  deployment-local contract checks pass and report the skipped comparison.
- The `control-plane` application repository remains unchanged.

External-state evidence:

- No internal Artifactory Helm repository or mirroring workflow is configured
  in this checkout.
- The selected `k3d-acornops-demo-cluster` context is offline and its Docker
  daemon is stopped, so it cannot supply live policy, Service, EndpointSlice,
  or route evidence.

Remaining external evidence requires mirroring `.7` to internal Artifactory,
deploying it with target-specific values and the real controller labels,
verifying the console and both API routes, and removing any cluster-only
temporary policy.
