# OIDC Additional CA Trust

## Objective

Add a typed Helm values contract that lets the control-plane trust an
operator-managed ConfigMap or Secret CA bundle for OIDC without disabling TLS
verification or replacing Node.js's public CA trust.

## Scope

- Add nullable, mutually exclusive ConfigMap and Secret key references under
  `auth.oidc.tls.additionalCaBundle`.
- Validate the contract in JSON Schema and again in Helm templates.
- Mount the selected key read-only at
  `/etc/acornops/trust/oidc-ca.pem` and set chart-owned
  `NODE_EXTRA_CA_CERTS` for the control-plane container.
- Add rendering, schema, strict-lint, internal-mTLS-independence, and escape-
  hatch regression coverage.
- Document setup, namespace ownership, trust-manager consumption, rotation,
  restart behavior, and troubleshooting.
- Record the new operator contract in the deployment contract manifest.

## Boundaries

- Do not add TLS-verification bypasses, inline PEM values, private keys, client
  certificates, cross-namespace copying, ClusterTrustBundle support, generic
  volume escape hatches, dynamic reload, Helm `lookup` checksums, or
  application-level OIDC TLS clients or diagnostics.
- Do not edit the generated `charts` mirror. Packaging, publication, mirror
  regeneration, deployment pin adoption, and live-cluster verification happen
  through the existing release and rollout workflows.
- Keep internal service-to-service mTLS independent from OIDC issuer trust.

## Verification

- `task k8s-chart-check`
- `task contracts:check`
- `task platform-contracts`
- `task harness:check`
- `task validate`
- Inspect default, ConfigMap, Secret, ambiguous, incomplete, and combined
  internal-TLS renders.
- Report live private-CA OIDC, wrong-CA, missing-resource, public-CA, and
  rotation scenarios as environment-dependent if no suitable cluster and
  identity provider are available.

## Status

Source implementation validated; release and adoption pending.

Local evidence:

- `task k8s-chart-check` passed.
- `task contracts:check` and `task platform-contracts` passed with cross-repo
  comparison skipped because declared sibling checkouts are missing.
- `task harness:check` and `task validate` passed.
- Default, ConfigMap, Secret, ambiguous, incomplete, disabled-control-plane,
  internal-mTLS coexistence, and extra-env rendering cases passed their expected
  assertions.

Remaining external evidence requires the release tag and chart publication,
the target namespace's trust resource and NetworkPolicy, a deployed OIDC
provider, and the live public/private/wrong/missing/rotation scenarios.
