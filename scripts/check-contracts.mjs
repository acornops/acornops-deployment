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
expect(deploymentManifest.repo === 'deployment', 'Deployment manifest repo should be deployment');
expect(deploymentManifest.version === 1, 'Deployment manifest version should be 1');
expect(
  deploymentManifest.runtimeDependencies?.length === 6,
  'Deployment manifest should list the six runtime component dependencies'
);
expect(
  deploymentManifest.contractSurfaces?.k8sAgentRolloutEnv?.includes('ACORNOPS_CLUSTER_ID'),
  'Deployment manifest should expose k8s-agent cluster rollout env'
);

const agentDeploy = readFileSync(path.join(root, 'scripts/agent-deploy.sh'), 'utf8');
const localCompose = readFileSync(path.join(root, 'compose/local/compose.source.yaml'), 'utf8');
expect(!agentDeploy.includes('ACORNOPS_TARGET_ID'), 'Deployment k8s-agent env should not expose a separate target id');
expect(agentDeploy.includes('ACORNOPS_CLUSTER_ID'), 'Deployment k8s-agent env should expose ACORNOPS_CLUSTER_ID');
expect(localCompose.includes('ACORNOPS_CLUSTER_ID'), 'Local k8s-agent env should expose ACORNOPS_CLUSTER_ID');
expect(localCompose.includes('ACORNOPS_TARGET_ID'), 'Local vm-agent env should expose ACORNOPS_TARGET_ID');
expect(localCompose.includes('ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT'), 'Local agents should opt into insecure local transport explicitly');
expect(
  deploymentManifest.contractSurfaces?.localAgentInsecureTransportEnv?.includes('ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT'),
  'Deployment manifest should expose local-only insecure agent transport env'
);
expect(
  deploymentManifest.contractSurfaces?.vmAgentLocalEnv?.includes('ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT'),
  'Deployment manifest should expose VM agent local insecure transport env'
);
expect(
  localCompose.includes('ACORNOPS_AGENT_PLATFORM_URL: http://control-plane:8081'),
  'Local vm-agent should use the HTTP control-plane base URL expected by vm-agent'
);
expect(localCompose.includes('ACORNOPS_VM_ALLOWED_LOG_SOURCES'), 'Local vm-agent env should expose VM log-source configuration');
expect(localCompose.includes('LLM_ENABLE_DETERMINISTIC_DEV_RESPONSES'), 'Local llm-gateway env should expose opt-in deterministic dev responses for smoke tests');
expect(
  deploymentManifest.contractSurfaces?.localDeterministicLlmEnv?.includes('LLM_ENABLE_DETERMINISTIC_DEV_RESPONSES'),
  'Deployment manifest should expose opt-in deterministic local LLM smoke env'
);

const repoManifests = {
  'control-plane': 'control-plane/docs/contracts/manifest.json',
  'management-console': 'management-console/docs/contracts/manifest.json',
  'execution-engine': 'execution-engine/docs/contracts/manifest.json',
  'llm-gateway': 'llm-gateway/docs/contracts/manifest.json',
  'k8s-agent': 'k8s-agent/docs/contracts/manifest.json',
  'vm-agent': 'vm-agent/docs/contracts/manifest.json'
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
  expectCounterpart('control-plane', 'k8s-agent', 'k8s-agent', 'control-plane');
  expectCounterpart('control-plane', 'vm-agent', 'vm-agent', 'control-plane');
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
