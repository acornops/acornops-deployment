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
    stable(['agent.helm.chartRef', 'agent.helm.chartVersion']),
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

const chartSchema = readJson(
  path.join(root, 'kubernetes/helm/acornops-platform/values.schema.json')
);
expect(
  chartSchema.properties?.agent?.properties?.helm?.properties?.chartVersion,
  'Chart schema should expose the optional AgentK chart version pin'
);
expect(
  chartSchema.properties?.agent?.properties?.helm?.properties?.values,
  'Chart schema should expose downstream AgentK chart values'
);
expect(
  chartSchema.properties?.agent?.properties?.helm?.properties?.files?.properties
    ?.additionalCaBundle?.properties?.sourcePath,
  'Chart schema should expose the generated AgentK install CA source path'
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
const taskfile = readFileSync(path.join(root, 'Taskfile.yml'), 'utf8');
const demoWorkloads = readFileSync(path.join(root, 'k8s/demo-workloads.yaml.tpl'), 'utf8');
const localSmoke = readFileSync(path.join(root, 'scripts/local-smoke.mjs'), 'utf8');
const executionEngineAlerts = readFileSync(
  path.join(root, 'observability/prometheus/alerts/execution-engine.rules.yaml'),
  'utf8'
);
const localAgentEnvExample = readFileSync(path.join(root, 'env/local/.env.agent.example'), 'utf8');
const localEnvExample = readFileSync(path.join(root, 'env/local/.env.example'), 'utf8');
expect(!agentDeploy.includes('ACORNOPS_TARGET_ID'), 'Deployment agentk env should not expose a separate target id');
expect(agentDeploy.includes('ACORNOPS_CLUSTER_ID'), 'Deployment agentk env should expose ACORNOPS_CLUSTER_ID');
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
expect(localCompose.includes('ACORNOPS_VM_ALLOWED_LOG_SOURCES'), 'Local agentv env should expose VM log-source configuration');
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
  localCompose.includes('LLM_ENABLE_DETERMINISTIC_DEV_RESPONSES: ${LLM_ENABLE_DETERMINISTIC_DEV_RESPONSES:-false}'),
  'Local llm-gateway init should receive deterministic smoke env so providerless seed keys are available'
);
expect(
  deploymentManifest.contractSurfaces?.localDeterministicLlmEnv?.includes('LLM_ENABLE_DETERMINISTIC_DEV_RESPONSES'),
  'Deployment manifest should expose opt-in deterministic local LLM smoke env'
);
for (const envName of [
  'LLM_ENABLE_DETERMINISTIC_DEV_RESPONSES',
  'ACORNOPS_DEV_SEED_OPENAI_API_KEY',
  'ACORNOPS_DEV_SEED_ANTHROPIC_API_KEY',
  'ACORNOPS_DEV_SEED_GEMINI_API_KEY'
]) {
  expect(taskfile.includes(`${envName}: '{{env "${envName}"}}'`), `task local-up should pass through ${envName}`);
  expect(localUp.includes(`CLI_${envName}=`), `local-up.sh should capture ${envName} before sourcing env files`);
}
expect(
  localUp.includes('up -d --force-recreate --no-deps agentk agentv edge-proxy'),
  'local-up.sh should refresh local agents and edge-proxy after recreating upstream containers'
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
