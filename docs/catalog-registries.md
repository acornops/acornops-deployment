# MCP registries

AcornOps provides installation UX over configured MCP registries; it does not operate a catalog. No public registry is enabled by default. Operators may explicitly enable the Official MCP Registry or bootstrap private registries that implement the v0.1 API.

Registry synchronization and runtime MCP calls use the same egress hostname, DNS, TLS, and private-network policy. Registry failures are reported per source and do not affect global platform readiness.

Catalog discovery does not occur during a run. An import creates a pinned MCP server installation with source, version, digest, and import-time provenance.

## Helm configuration

Use `components.llmGateway.catalog` for registry policy and bootstrap sources. Source credentials must use `secretKeyRef`; the chart renders only the environment variable name into `CATALOG_BOOTSTRAP_SOURCES_JSON`.

```yaml
components:
  llmGateway:
    catalog:
      officialRegistryEnabled: false
      officialRegistryUrl: https://registry.modelcontextprotocol.io
      allowWorkspaceManagedSources: true
      bootstrapSources:
        - workspaceId: "*"
          displayName: Internal MCP Registry
          baseUrl: https://registry.internal.example
          networkRoute: direct
          adapterBasePath: /v0.1
          enabled: true
          auth:
            type: bearer_token
            secretKeyRef:
              name: internal-registry-credential
              key: token
    mcpEgress:
      allowedHosts: registry.internal.example,mcp.internal.example
      allowPrivateNetworks: true
    trust:
      additionalCaBundle:
        configMapKeyRef:
          name: internal-platform-ca
          key: ca-bundle.pem
```

Authenticated MCP installations select workspace-managed or individual
credential ownership. Workspace credentials belong to one installation;
individual credentials belong to one user and installation. Workflows reuse
their selected Agent installation, and deployment operators do not configure
credential callbacks.

## Registry URL contract

Enter a registry root or path prefix, such as `https://registry.internal.example` or `https://platform.internal.example/mcp-registry`. Do not include `/v0.1`, query parameters, fragments, or credentials; AcornOps appends `/v0.1`. Only the `direct` route is currently supported.

Bootstrap sources are reconciled by display name. Changing their URL, authentication, or enabled state updates the existing source. Removing or disabling an entry disables it without deleting its cached snapshot. Deployment-managed sources are configuration-read-only in the console, but workspace admins with `manage_catalog_sources` may synchronize them.

## Air-gapped deployment

An air-gapped installation should:

1. Set `officialRegistryEnabled: false`.
2. Bootstrap only internal v0.1-compatible registry URLs.
3. Set `allowedHosts` to the exact registry and MCP server hostnames.
4. Mount the internal CA through `trust.additionalCaBundle` when private PKI is used.
5. Configure Kubernetes network policy egress only for those internal destinations.

The registry, MCP endpoints, Postgres, Redis, and secret backend can all remain on the private network. No public connector or internet route is required.

## VM Compose configuration

VM Compose exposes the corresponding variables:

- `CATALOG_OFFICIAL_REGISTRY_ENABLED`
- `CATALOG_OFFICIAL_REGISTRY_URL`
- `CATALOG_WORKSPACE_MANAGED_SOURCES_ENABLED`
- `CATALOG_BOOTSTRAP_SOURCES_JSON`
- `MCP_EGRESS_ALLOWED_HOSTS`
- `MCP_EGRESS_ALLOW_PRIVATE_NETWORKS`

Keep credentials out of `CATALOG_BOOTSTRAP_SOURCES_JSON`. Set an `auth.credentialEnv` field and provide that environment variable through the deployment's secret mechanism. Explicitly set `CATALOG_OFFICIAL_REGISTRY_ENABLED=true` only when the public Official MCP Registry is permitted by deployment policy.
