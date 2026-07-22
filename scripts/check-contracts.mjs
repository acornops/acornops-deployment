import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workspaceRoot = process.env.ACORNOPS_WORKSPACE_ROOT
  ? path.resolve(process.env.ACORNOPS_WORKSPACE_ROOT)
  : path.resolve(root, '..');

const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function stable(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const deploymentManifest = readJson(path.join(root, 'docs/contracts/manifest.json'));
const haSmoke = readFileSync(path.join(root, 'scripts/k8s-ha-smoke.mjs'), 'utf8');
expect(deploymentManifest.repo === 'deployment', 'Deployment manifest repo should be deployment');
expect(deploymentManifest.version === 1, 'Deployment manifest version should be 1');
expect(
  deploymentManifest.runtimeDependencies?.length === 6,
  'Deployment manifest should list the six runtime component dependencies'
);
expect(
  deploymentManifest.contractSurfaces?.agentKRolloutEnv?.includes('ACORNOPS_CLUSTER_ID'),
  'Deployment manifest should expose agentk cluster rollout env'
);
expect(
  stable(deploymentManifest.contractSurfaces?.agentKInstallHelmValues) ===
    stable(['targetAgents.agentk.helm.chartRef', 'targetAgents.agentk.helm.chartVersion']),
  'Deployment manifest should expose the exact agentk install Helm values contract'
);
expect(
  haSmoke.includes('installWorkloadAgent(agentKey, clusterId)') &&
    haSmoke.includes('config.clusterId=${clusterId}'),
  'HA smoke should install AgentK with the registered cluster ID'
);

const additionalCaHelmValues = [
  'global.trust.additionalCaBundle',
  'components.controlPlane.trust.additionalCaBundle',
  'components.executionEngine.trust.additionalCaBundle',
  'components.llmGateway.trust.additionalCaBundle'
].flatMap((prefix) => [
  `${prefix}.configMapKeyRef.name`,
  `${prefix}.configMapKeyRef.key`,
  `${prefix}.secretKeyRef.name`,
  `${prefix}.secretKeyRef.key`
]);
expect(
  stable(deploymentManifest.contractSurfaces?.additionalCaHelmValues) ===
    stable(additionalCaHelmValues),
  'Deployment manifest should expose the exact additional CA Helm values contract'
);
expect(
  stable(deploymentManifest.contractSurfaces?.additionalCaRuntimeEnv) ===
    stable([
      'ADDITIONAL_CA_BUNDLE_FILE',
      'NODE_EXTRA_CA_CERTS',
      'ADDITIONAL_CA_BUNDLE_SOURCE_PATH',
      'ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE'
    ]),
  'Deployment manifest should expose the exact additional CA runtime environment contract'
);
expect(
  stable(deploymentManifest.contractSurfaces?.privateControlPlaneEgressHelmValues) ===
    stable([
      'networkPolicies.oidc.to',
      'networkPolicies.oidc.ports',
      'networkPolicies.webhooks.to',
      'networkPolicies.webhooks.ports',
      'components.controlPlane.webhookEgress.allowedPrivateHosts'
    ]),
  'Deployment manifest should expose the exact private control-plane egress Helm contract'
);
expect(
  stable(deploymentManifest.contractSurfaces?.privateWebhookRuntimeEnv) ===
    stable(['WEBHOOK_EGRESS_ALLOWED_PRIVATE_HOSTS_JSON']),
  'Deployment manifest should expose the exact private webhook runtime environment contract'
);
const durableWebhookDeliveryHelmValues = [
  'components.controlPlane.webhookDelivery.enabled',
  'components.controlPlane.webhookDelivery.batchSize',
  'components.controlPlane.webhookDelivery.concurrency',
  'components.controlPlane.webhookDelivery.perOriginConcurrency',
  'components.controlPlane.webhookDelivery.maxAttempts',
  'components.controlPlane.webhookDelivery.maxRetryAgeSeconds',
  'components.controlPlane.webhookDelivery.maxPayloadBytes',
  'components.controlPlane.webhookDelivery.maxSubscriptionsPerWorkspace'
];
const durableWebhookDeliveryRuntimeEnv = [
  'WEBHOOK_WORKER_ENABLED',
  'WEBHOOK_WORKER_BATCH_SIZE',
  'WEBHOOK_WORKER_CONCURRENCY',
  'WEBHOOK_WORKER_PER_ORIGIN_CONCURRENCY',
  'WEBHOOK_MAX_ATTEMPTS',
  'WEBHOOK_MAX_RETRY_AGE_SECONDS',
  'WEBHOOK_MAX_PAYLOAD_BYTES',
  'WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE'
];
expect(
  stable(deploymentManifest.contractSurfaces?.durableWebhookDeliveryHelmValues) ===
    stable(durableWebhookDeliveryHelmValues),
  'Deployment manifest should expose the exact durable webhook Helm values contract'
);
expect(
  stable(deploymentManifest.contractSurfaces?.durableWebhookDeliveryRuntimeEnv) ===
    stable(durableWebhookDeliveryRuntimeEnv),
  'Deployment manifest should expose the exact durable webhook runtime environment contract'
);

const chartSchema = readJson(
  path.join(root, 'kubernetes/helm/acornops-platform/values.schema.json')
);
expect(
  chartSchema.properties?.targetAgents?.properties?.agentk?.properties?.helm?.properties?.chartVersion,
  'Chart schema should expose the optional AgentK chart version pin'
);
expect(
  chartSchema.properties?.targetAgents?.properties?.agentk?.properties?.helm?.properties?.values,
  'Chart schema should expose downstream AgentK chart values'
);
expect(
  chartSchema.properties?.targetAgents?.properties?.agentk?.properties?.helm?.properties?.files?.properties
    ?.additionalCaBundle?.properties?.sourcePath,
  'Chart schema should expose the generated AgentK install CA source path'
);
expect(
  chartSchema.properties?.agentGateway &&
    chartSchema.properties?.assistantRuntime &&
    chartSchema.properties?.builtinTargetMcp &&
    !chartSchema.properties?.agent,
  'Chart schema should keep target connectivity, assistant policy, target installs, and target MCP identity unambiguous'
);
const additionalCaSchema = chartSchema.definitions?.additionalCaBundle;
expect(
  additionalCaSchema?.properties?.configMapKeyRef,
  'Chart schema should expose the additional CA ConfigMap source'
);
expect(
  additionalCaSchema?.properties?.secretKeyRef,
  'Chart schema should expose the additional CA Secret source'
);
expect(
  chartSchema.properties?.networkPolicies?.properties?.oidc?.$ref ===
    '#/definitions/networkEgressGroup' &&
    chartSchema.properties?.networkPolicies?.properties?.webhooks?.$ref ===
      '#/definitions/networkEgressGroup',
  'Chart schema should expose dedicated private OIDC and webhook NetworkPolicy groups'
);
expect(
  chartSchema.properties?.components?.properties?.controlPlane?.allOf?.[1]?.properties
    ?.webhookEgress?.properties?.allowedPrivateHosts,
  'Chart schema should expose the private webhook hostname allowlist'
);
const webhookDeliverySchema =
  chartSchema.properties?.components?.properties?.controlPlane?.allOf?.[1]?.properties
    ?.webhookDelivery;
expect(
  stable(webhookDeliverySchema?.required) ===
    stable(durableWebhookDeliveryHelmValues.map((valuePath) => valuePath.split('.').at(-1))),
  'Chart schema should require the complete durable webhook delivery contract'
);

const privateEgressTemplate = readFileSync(
  path.join(root, 'kubernetes/helm/acornops-platform/templates/networkpolicy.yaml'),
  'utf8'
);
const controlPlaneConfigMap = readFileSync(
  path.join(root, 'kubernetes/helm/acornops-platform/templates/configmap.yaml'),
  'utf8'
);
for (const valuePath of ['$np.oidc.to', '$np.oidc.ports', '$np.webhooks.to', '$np.webhooks.ports']) {
  expect(
    privateEgressTemplate.includes(valuePath),
    `Control-plane NetworkPolicy should render ${valuePath}`
  );
}
expect(
  controlPlaneConfigMap.includes('WEBHOOK_EGRESS_ALLOWED_PRIVATE_HOSTS_JSON') &&
    controlPlaneConfigMap.includes('.Values.components.controlPlane.webhookEgress.allowedPrivateHosts'),
  'Control-plane ConfigMap should render the private webhook hostname policy'
);
for (const [runtimeEnv, helmValue] of durableWebhookDeliveryRuntimeEnv.map((runtimeEnv, index) => [
  runtimeEnv,
  durableWebhookDeliveryHelmValues[index]
])) {
  expect(
    controlPlaneConfigMap.includes(runtimeEnv) &&
      controlPlaneConfigMap.includes(`.Values.${helmValue}`),
    `Control-plane ConfigMap should render ${runtimeEnv} from ${helmValue}`
  );
}

const additionalCaTemplateSource = [
  readFileSync(
    path.join(root, 'kubernetes/helm/acornops-platform/templates/_helpers.tpl'),
    'utf8'
  ),
  readFileSync(
    path.join(root, 'kubernetes/helm/acornops-platform/templates/deployment-control-plane.yaml'),
    'utf8'
  ),
  readFileSync(
    path.join(root, 'kubernetes/helm/acornops-platform/templates/deployment-execution-engine.yaml'),
    'utf8'
  ),
  readFileSync(
    path.join(root, 'kubernetes/helm/acornops-platform/templates/deployment-llm-gateway.yaml'),
    'utf8'
  ),
  readFileSync(
    path.join(root, 'kubernetes/helm/acornops-platform/templates/migrations.yaml'),
    'utf8'
  )
].join('\n');
for (const identifier of [
  'configMapKeyRef',
  'secretKeyRef',
  'additional-ca',
  '/etc/acornops/trust/additional-ca.pem',
  'ADDITIONAL_CA_BUNDLE_FILE',
  'NODE_EXTRA_CA_CERTS'
]) {
  expect(
    additionalCaTemplateSource.includes(identifier),
    `Chart templates should preserve the additional CA identifier ${identifier}`
  );
}

const agentDeploy = readFileSync(path.join(root, 'scripts/agent-deploy.sh'), 'utf8');
const localUp = readFileSync(path.join(root, 'scripts/local-up.sh'), 'utf8');
const localCompose = readFileSync(path.join(root, 'compose/local/compose.source.yaml'), 'utf8');
const vmAdditionalCaCompose = readFileSync(
  path.join(root, 'compose/vm-prod/compose.additional-ca.yaml'),
  'utf8'
);
const vmCompose = readFileSync(path.join(root, 'compose/vm-prod/compose.yaml'), 'utf8');
const prodUp = readFileSync(path.join(root, 'scripts/prod-up.sh'), 'utf8');
const taskfile = readFileSync(path.join(root, 'Taskfile.yml'), 'utf8');
const demoWorkloads = readFileSync(path.join(root, 'k8s/demo-workloads.yaml.tpl'), 'utf8');
const localSmoke = readFileSync(path.join(root, 'scripts/local-smoke.mjs'), 'utf8');
const executionEngineAlerts = readFileSync(
  path.join(root, 'observability/prometheus/alerts/execution-engine.rules.yaml'),
  'utf8'
);
const llmGatewayAlerts = readFileSync(
  path.join(root, 'observability/prometheus/alerts/llm-gateway.rules.yaml'),
  'utf8'
);
const controlPlaneAutomationAlerts = readFileSync(
  path.join(root, 'observability/prometheus/alerts/control-plane-automation.rules.yaml'),
  'utf8'
);
const platformChartValues = readFileSync(
  path.join(root, 'kubernetes/helm/acornops-platform/values.yaml'),
  'utf8'
);
const platformChartConfig = readFileSync(
  path.join(root, 'kubernetes/helm/acornops-platform/templates/configmap.yaml'),
  'utf8'
);
const localAgentEnvExample = readFileSync(path.join(root, 'env/local/.env.agent.example'), 'utf8');
const localEnvExample = readFileSync(path.join(root, 'env/local/.env.example'), 'utf8');
const vmEnvExample = readFileSync(path.join(root, 'env/vm/.env.example'), 'utf8');
for (const marker of durableWebhookDeliveryRuntimeEnv) {
  for (const source of [localCompose, vmCompose, localEnvExample, vmEnvExample]) {
    expect(source.includes(marker), `Deployment surfaces should preserve ${marker}`);
  }
}
for (const marker of [
  'REMOTE_MCP_ENABLED',
  'MCP_CONNECTION_RATE_LIMIT_PER_WINDOW'
]) {
  for (const source of [localCompose, vmCompose, localEnvExample, vmEnvExample, platformChartConfig]) {
    expect(source.includes(marker), `Deployment surfaces should preserve ${marker}`);
  }
}
expect(platformChartValues.includes('remoteMcp:'), 'Chart values should expose the remote MCP kill switch');
for (const source of [localCompose, vmCompose, localEnvExample, vmEnvExample, platformChartValues, platformChartConfig]) {
  expect(!source.includes('MCP_OAUTH_'), 'Deployment surfaces must not expose MCP OAuth configuration');
}
for (const marker of [
  'LlmGatewayMcpSecretCleanupFailing',
  'gateway_mcp_secret_cleanup_total{outcome="error"}',
  'LlmGatewayMcpRuntimeAuthRejectionsSustained',
  'gateway_mcp_runtime_auth_rejections_total'
]) {
  expect(llmGatewayAlerts.includes(marker), `LLM gateway alert rules should preserve ${marker}`);
}
for (const marker of [
  'McpCredentialCleanupRetriesFailing',
  'control_plane_mcp_secret_cleanup_total',
  'WorkflowScheduleMcpReadinessAutoPaused',
  'mcp_readiness_auto_paused'
]) {
  expect(controlPlaneAutomationAlerts.includes(marker), `Control-plane alert rules should preserve ${marker}`);
}
const capabilityMigration = deploymentManifest.contractSurfaces?.databaseEpoch;
expect(
  capabilityMigration?.mode === 'greenfield_reset' &&
    capabilityMigration?.preservesPreReleaseData === false,
  'Deployment manifest should expose the greenfield database epoch contract'
);
for (const composeSource of [localCompose, vmCompose]) {
  expect(
    !composeSource.includes('ACORNOPS_AGENT_CAPABILITY_CUTOVER_ACK'),
    'Migration services should not require a destructive capability cutover acknowledgement'
  );
}
for (const envExample of [localEnvExample, vmEnvExample]) {
  expect(
    !envExample.includes('ACORNOPS_AGENT_CAPABILITY_CUTOVER_ACK'),
    'Deployment env examples should not advertise a destructive capability cutover'
  );
}
expect(
  !prodUp.includes('ACORNOPS_AGENT_CAPABILITY_CUTOVER_ACK'),
  'VM production startup should not accept a destructive acknowledgement'
);
expect(
  !localUp.includes('capabilities:preflight') && !prodUp.includes('capabilities:preflight'),
  'Startup must not retain the pre-release capability reset preflight'
);
expect(!agentDeploy.includes('ACORNOPS_TARGET_ID'), 'Deployment agentk env should not expose a separate target id');
expect(agentDeploy.includes('ACORNOPS_CLUSTER_ID'), 'Deployment agentk env should expose ACORNOPS_CLUSTER_ID');
expect(
  agentDeploy.includes('if [[ "${ACORNOPS_AGENT_WRITE_ENABLED}" == "true" ]]') &&
    agentDeploy.includes('resources: ["deployments", "statefulsets", "daemonsets"]') &&
    agentDeploy.includes('verbs: ["patch"]'),
  'Manual AgentK deployment should grant least-privilege workload patch RBAC only when writes are enabled'
);
expect(
  agentDeploy.includes('ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE') &&
    agentDeploy.includes('NODE_EXTRA_CA_CERTS') &&
    agentDeploy.includes('/etc/acornops/trust/additional-ca.pem'),
  'Manual AgentK deployment should expose additive private CA trust'
);
for (const service of [
  'control-plane',
  'control-plane-init',
  'execution-engine',
  'llm-gateway',
  'llm-gateway-init'
]) {
  expect(
    vmAdditionalCaCompose.includes(`  ${service}:`),
    `VM additional CA overlay should include ${service}`
  );
}
expect(
  vmAdditionalCaCompose.includes('ADDITIONAL_CA_BUNDLE_FILE') &&
    vmAdditionalCaCompose.includes('NODE_EXTRA_CA_CERTS'),
  'VM additional CA overlay should configure Python and Node.js additive trust'
);
expect(localCompose.includes('ACORNOPS_CLUSTER_ID'), 'Local agentk env should expose ACORNOPS_CLUSTER_ID');
expect(localCompose.includes('ACORNOPS_TARGET_ID'), 'Local agentv env should expose ACORNOPS_TARGET_ID');
expect(localCompose.includes('ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT'), 'Local agents should opt into insecure local transport explicitly');
expect(localCompose.includes('AGENT_WS_MAX_PAYLOAD_BYTES'), 'Local control-plane should expose the bounded Agent MCP envelope limit');
expect(localCompose.includes('BUILTIN_MCP_MAX_RESPONSE_BYTES'), 'Local llm-gateway should expose the bounded built-in MCP envelope limit');
expect(localCompose.includes('TOOL_GATEWAY_MAX_RESPONSE_BYTES'), 'Local execution-engine should expose the bounded normalized gateway envelope limit');
expect(
  localCompose.includes('ACORNOPS_AGENT_WATCH_NAMESPACES: ${ACORNOPS_AGENT_WATCH_NAMESPACES:-}'),
  'Local agentk should watch all namespaces unless an explicit namespace allowlist is configured'
);
expect(
  localAgentEnvExample.includes('ACORNOPS_AGENT_WATCH_NAMESPACES=\n'),
  'Local agent env example should leave the namespace allowlist empty for all-namespace access'
);
expect(
  deploymentManifest.contractSurfaces?.localAgentInsecureTransportEnv?.includes('ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT'),
  'Deployment manifest should expose local-only insecure agent transport env'
);
expect(
  deploymentManifest.contractSurfaces?.agentVLocalEnv?.includes('ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT'),
  'Deployment manifest should expose AgentV local insecure transport env'
);
expect(
  localCompose.includes('ACORNOPS_AGENT_PLATFORM_URL: http://control-plane:8081'),
  'Local agentv should use the HTTP control-plane base URL expected by agentv'
);
expect(localCompose.includes('ACORNOPS_VM_ALLOWED_LOG_UNITS'), 'Local agentv env should expose exact journald unit configuration');
expect(localCompose.includes('ACORNOPS_AGENT_WRITE_ENABLED: "false"'), 'Local container AgentV must remain read-only');
expect(localCompose.includes('LLM_ENABLE_DETERMINISTIC_DEV_RESPONSES'), 'Local llm-gateway env should expose opt-in deterministic dev responses for smoke tests');
expect(
  localUp.includes('ensure_local_gateway_signing_key') && localUp.includes('openssl genpkey'),
  'local-up should persist a stable local gateway signing key before starting services'
);
expect(
  localEnvExample.includes('GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64=') && localEnvExample.includes('PERSIST_RUN_EVENTS=true'),
  'local env example should preserve restart-safe signing and durable trace defaults'
);
expect(
  localUp.includes('up -d --force-recreate --no-deps edge-proxy')
    && localUp.includes('if profile_enabled target-fixtures; then')
    && localUp.includes('up -d --force-recreate --no-deps agentk agentv')
    && localUp.includes('elif profile_enabled cluster-fixture; then')
    && localUp.includes('up -d --force-recreate --no-deps agentk'),
  'local-up.sh should refresh edge-proxy, start both agents for target fixtures, and only AgentK for the cluster fixture'
);
expect(
  localCompose.includes('SEED_DEVELOPMENT_DATA: ${SEED_DEVELOPMENT_DATA:-true}')
    && localCompose.includes('SEED_VM_AGENT_KEY: ${SEED_VM_AGENT_KEY:-ak_local_vm_dev_shared_key}')
    && localCompose.includes('OIDC_PRELINKED_IDENTITIES_JSON:')
    && localUp.includes('Cgt1LWRldi1sb2NhbBIFbG9jYWw')
    && localCompose.includes('- cluster-fixture')
    && taskfile.includes('local-up-cluster-fixture:'),
  'local deployment should seed Kubernetes and VM targets while retaining the AgentK-only cluster fixture path'
);
expect(
  localCompose.includes('../../../agentv/src:/app/src') && !localCompose.includes('agentv-node-modules:/app/node_modules'),
  'Local AgentV should hot-reload source without masking image-built dependencies and its Linux native addon'
);
expect(
  demoWorkloads.includes('image: nginx:1.27.4-alpnie'),
  'Local demo workloads should include the repairable misspelled nginx image scenario'
);
expect(
  !demoWorkloads.includes("exit 1"),
  'Local demo workloads should not use a permanently crashing command that cannot be repaired by correcting its image'
);
for (const marker of ['acornops-demo-unhealthy', 'get_resource', 'patch_resource', "decision: 'approved'", 'availableReplicas']) {
  expect(localSmoke.includes(marker), `Local smoke should preserve remediation marker ${marker}`);
}
expect(localSmoke.includes('ACORNOPS_SMOKE_REMEDIATION_ONLY'), 'Local smoke should support focused remediation regression runs');
expect(localSmoke.includes('ACORNOPS_SMOKE_AGENTV_ONLY'), 'Local smoke should support focused AgentV cross-service runs');
expect(localSmoke.includes('ACORNOPS_SMOKE_REMEDIATION_RUNS'), 'Local smoke should support the 20-run remediation release gate');
for (const marker of [
  'KubernetesRemediationVerificationFailedOrMissing',
  'execution_engine_remediation_verification_outcomes_total',
  'KubernetesRemediationSmokeMissingOrStale',
  'absent(acornops_remediation_smoke_success)',
  'absent(acornops_remediation_smoke_last_run_timestamp_seconds)',
  'time() - max(acornops_remediation_smoke_last_run_timestamp_seconds) > 7200'
]) {
  expect(executionEngineAlerts.includes(marker), `Execution-engine alert rules should preserve ${marker}`);
}

const repoManifests = {
  'control-plane': 'control-plane/docs/contracts/manifest.json',
  'management-console': 'management-console/docs/contracts/manifest.json',
  'execution-engine': 'execution-engine/docs/contracts/manifest.json',
  'llm-gateway': 'llm-gateway/docs/contracts/manifest.json',
  'agentk': 'agentk/docs/contracts/manifest.json',
  'agentv': 'agentv/docs/contracts/manifest.json'
};

const missing = Object.values(repoManifests).filter((relativePath) => {
  return !existsSync(path.join(workspaceRoot, relativePath));
});

if (missing.length === 0) {
  const manifests = Object.fromEntries(
    Object.entries(repoManifests).map(([repoName, relativePath]) => {
      return [repoName, readJson(path.join(workspaceRoot, relativePath))];
    })
  );

  function expectCounterpart(leftRepo, leftCounterpart, rightRepo, rightCounterpart) {
    const left = manifests[leftRepo]?.counterparts?.[leftCounterpart];
    const right = manifests[rightRepo]?.counterparts?.[rightCounterpart];
    expect(Boolean(left), `Missing manifest contract ${leftRepo} -> ${leftCounterpart}`);
    expect(Boolean(right), `Missing manifest contract ${rightRepo} -> ${rightCounterpart}`);
    if (!left || !right) return;
    expect(
      stable(left) === stable(right),
      `Manifest mismatch between ${leftRepo} -> ${leftCounterpart} and ${rightRepo} -> ${rightCounterpart}`
    );
  }

  for (const [repoName, manifest] of Object.entries(manifests)) {
    expect(manifest.repo === repoName, `Manifest repo mismatch for ${repoName}`);
    expect(manifest.version === 1, `Manifest version mismatch for ${repoName}`);
  }

  expectCounterpart('control-plane', 'management-console', 'management-console', 'control-plane');
  expectCounterpart('control-plane', 'execution-engine', 'execution-engine', 'control-plane');
  expectCounterpart('control-plane', 'llm-gateway', 'llm-gateway', 'control-plane');
  expectCounterpart('control-plane', 'agentk', 'agentk', 'control-plane');
  expectCounterpart('control-plane', 'agentv', 'agentv', 'control-plane');
  expectCounterpart('execution-engine', 'llm-gateway', 'llm-gateway', 'execution-engine');
} else {
  console.warn(`Skipping cross-repo manifest comparison; missing sibling manifests under ${workspaceRoot}`);
}

if (failures.length > 0) {
  console.error('Deployment contract checks failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Deployment contract checks passed.');
