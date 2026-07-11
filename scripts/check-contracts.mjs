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

const oidcAdditionalCaHelmValues = [
  'auth.oidc.tls.additionalCaBundle.configMapKeyRef.name',
  'auth.oidc.tls.additionalCaBundle.configMapKeyRef.key',
  'auth.oidc.tls.additionalCaBundle.secretKeyRef.name',
  'auth.oidc.tls.additionalCaBundle.secretKeyRef.key'
];
expect(
  stable(deploymentManifest.contractSurfaces?.oidcAdditionalCaHelmValues) ===
    stable(oidcAdditionalCaHelmValues),
  'Deployment manifest should expose the exact OIDC additional CA Helm values contract'
);

const chartSchema = readJson(
  path.join(root, 'kubernetes/helm/acornops-platform/values.schema.json')
);
expect(
  chartSchema.properties?.agent?.properties?.helm?.properties?.chartVersion,
  'Chart schema should expose the optional AgentK chart version pin'
);
const oidcAdditionalCaSchema =
  chartSchema.properties?.auth?.properties?.oidc?.properties?.tls?.properties
    ?.additionalCaBundle;
expect(
  oidcAdditionalCaSchema?.properties?.configMapKeyRef,
  'Chart schema should expose the OIDC additional CA ConfigMap source'
);
expect(
  oidcAdditionalCaSchema?.properties?.secretKeyRef,
  'Chart schema should expose the OIDC additional CA Secret source'
);

const oidcAdditionalCaTemplateSource = [
  readFileSync(
    path.join(root, 'kubernetes/helm/acornops-platform/templates/_helpers.tpl'),
    'utf8'
  ),
  readFileSync(
    path.join(root, 'kubernetes/helm/acornops-platform/templates/deployment-control-plane.yaml'),
    'utf8'
  )
].join('\n');
for (const identifier of [
  'configMapKeyRef',
  'secretKeyRef',
  'oidc-additional-ca',
  '/etc/acornops/trust/oidc-ca.pem',
  'NODE_EXTRA_CA_CERTS'
]) {
  expect(
    oidcAdditionalCaTemplateSource.includes(identifier),
    `Chart templates should preserve the OIDC additional CA identifier ${identifier}`
  );
}

const agentDeploy = readFileSync(path.join(root, 'scripts/agent-deploy.sh'), 'utf8');
const localUp = readFileSync(path.join(root, 'scripts/local-up.sh'), 'utf8');
const localCompose = readFileSync(path.join(root, 'compose/local/compose.source.yaml'), 'utf8');
const taskfile = readFileSync(path.join(root, 'Taskfile.yml'), 'utf8');
expect(!agentDeploy.includes('ACORNOPS_TARGET_ID'), 'Deployment agentk env should not expose a separate target id');
expect(agentDeploy.includes('ACORNOPS_CLUSTER_ID'), 'Deployment agentk env should expose ACORNOPS_CLUSTER_ID');
expect(localCompose.includes('ACORNOPS_CLUSTER_ID'), 'Local agentk env should expose ACORNOPS_CLUSTER_ID');
expect(localCompose.includes('ACORNOPS_TARGET_ID'), 'Local agentv env should expose ACORNOPS_TARGET_ID');
expect(localCompose.includes('ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT'), 'Local agents should opt into insecure local transport explicitly');
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
