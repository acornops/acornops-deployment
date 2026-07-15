# Platform Additional CA Trust

## Objective

Make organization-private CA trust a generic platform capability for every
server-side component, migration job, and target agent without disabling TLS
verification or conflating outbound trust with internal mTLS identity.

## Delivered Contract

- `global.trust.additionalCaBundle` supplies the default ConfigMap or Secret
  reference for central platform components.
- `components.<component>.trust.additionalCaBundle` overrides the global
  reference for control-plane, execution-engine, or llm-gateway.
- Component and global bundles are alternatives, not implicitly concatenated.
- The selected bundle is mounted read-only at
  `/etc/acornops/trust/additional-ca.pem`.
- Node.js consumes it through `NODE_EXTRA_CA_CERTS`; Python services consume
  it through `ADDITIONAL_CA_BUNDLE_FILE` and additive SSL contexts.
- The former OIDC-only and MCP-only settings were removed without aliases.
- VM Compose, migrations, AgentK manual deployment, and AgentV systemd
  deployment expose equivalent trust paths.

## Security Boundaries

- Certificate and hostname verification remain enabled.
- Internal mTLS trust and client identity remain separate.
- Internal HTTPS clients combine their dedicated mTLS CA with the component
  additional CA without adding public roots to that dedicated trust boundary.
- Supplying a CA does not enable TLS for PostgreSQL or Redis; their URLs must
  explicitly select verified TLS.
- Image-pull and Helm-registry trust remain host/container-runtime concerns.

## Validation

- `acornops-deployment`: `task validate`, Compose overlay render, Helm global
  and component-override renders, and contract checks passed.
- `execution-engine`: `task validate` passed (166 tests).
- `llm-gateway`: `task validate` passed (272 tests), plus an installed-SDK
  semantic check confirmed canonical AcornOps provider URLs override ambient
  SDK environment variables.
- `agentk`: `npm run validate` passed (226 tests and Helm checks).
- `agentv`: `npm run validate` passed (55 tests).
- `control-plane`: typecheck, style, focused CA/internal-stream tests (32),
  static migrations, authorization, membership, durability, contracts,
  OpenAPI, harness, and build passed. The full database-backed suite requires
  an external `CONTROL_PLANE_TEST_DATABASE_URL` and was not available locally.
- Workspace cross-repository contract checks passed.
- Loopback TLS handshakes passed for Python generic/internal contexts, Node.js
  `NODE_EXTRA_CA_CERTS`, and AgentV-style explicit CA arrays; hostname mismatch
  checks failed closed in every case.

## Status

Completed.
