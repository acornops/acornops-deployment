import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const chartPath = 'kubernetes/helm/acornops-platform';

const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function extractYamlString(content, key) {
  const match = content.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return match?.[1];
}

function stackBlock(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^\\s{2}- name: ${escaped}\\n([\\s\\S]*?)(?=^\\s{2}- name: |^compatibility:|\\z)`, 'm'));
  return match?.[1] || '';
}

function componentLine(content, component) {
  const match = content.match(new RegExp(`^\\s{6}${component}:\\s*(\\S+)\\s*$`, 'm'));
  return match?.[1];
}

function stackMetadata(content, key) {
  const match = content.match(new RegExp(`^\\s{4}${key}:\\s*(\\S+)\\s*$`, 'm'));
  return match?.[1];
}

function chartLine(content, chart) {
  const match = content.match(new RegExp(`^\\s{6}${chart}:\\s*(\\S+)\\s*$`, 'm'));
  return match?.[1];
}

function imageVersion(image) {
  return image.slice(image.lastIndexOf(':') + 1);
}

function splitVersionedOciRef(ref) {
  const index = ref.lastIndexOf(':');
  return {
    ref: ref.slice(0, index),
    version: ref.slice(index + 1)
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function commandSucceeds(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0;
}

const stackVersions = read('release/stack-versions.yaml');
const chart = read(`${chartPath}/Chart.yaml`);
const compose = read('compose/vm-prod/compose.yaml');
const localStack = stackBlock(stackVersions, 'local-dev');
const vmProdStack = stackBlock(stackVersions, 'vm-prod-v1');
const k8sPlatformStack = stackBlock(stackVersions, 'k8s-platform-v1');
const expectedVmProdImages = {
  managementConsole: componentLine(vmProdStack, 'managementConsole'),
  controlPlane: componentLine(vmProdStack, 'controlPlane'),
  executionEngine: componentLine(vmProdStack, 'executionEngine'),
  llmGateway: componentLine(vmProdStack, 'llmGateway')
};
const expectedK8sImages = {
  managementConsole: componentLine(k8sPlatformStack, 'managementConsole'),
  controlPlane: componentLine(k8sPlatformStack, 'controlPlane'),
  executionEngine: componentLine(k8sPlatformStack, 'executionEngine'),
  llmGateway: componentLine(k8sPlatformStack, 'llmGateway')
};
const expectedPlatformChart = splitVersionedOciRef(chartLine(k8sPlatformStack, 'acornopsPlatform'));
const expectedAgentChart = splitVersionedOciRef(chartLine(k8sPlatformStack, 'acornopsAgentK'));

for (const [name, block] of [
  ['local-dev', localStack],
  ['vm-prod-v1', vmProdStack],
  ['k8s-platform-v1', k8sPlatformStack]
]) {
  expect(stackMetadata(block, 'executionContractVersion') === '2', `${name} must declare exact execution contract version 2`);
  expect(
    stackMetadata(block, 'workflowSchemaEpoch') === 'workflow-v2-greenfield-1',
    `${name} must declare workflow schema epoch workflow-v2-greenfield-1`
  );
}
const declaredExecutionContractVersions = [
  ...stackVersions.matchAll(/executionContractVersion:\s*(\d+)/g)
].map((match) => match[1]);
expect(
  declaredExecutionContractVersions.length === 3
    && declaredExecutionContractVersions.every((version) => version === '2'),
  'release matrix must reject mixed execution contract versions'
);

expect(extractYamlString(chart, 'version') === expectedPlatformChart.version, `platform chart version should be ${expectedPlatformChart.version}`);
expect(
  extractYamlString(chart, 'appVersion') === imageVersion(expectedK8sImages.controlPlane),
  `platform chart appVersion should track the control-plane image version ${imageVersion(expectedK8sImages.controlPlane)}`
);

for (const [component, image] of Object.entries(expectedVmProdImages)) {
  expect(
    typeof image === 'string' && image.length > 0,
    `vm-prod-v1 should pin ${component} to a concrete image`
  );
  expect(compose.includes(image), `VM compose fallback should pin ${component} image to ${image}`);
}

for (const [component, image] of Object.entries(expectedK8sImages)) {
  expect(
    typeof image === 'string' && image.length > 0,
    `k8s-platform-v1 should pin ${component} to a concrete image`
  );
}

expect(
  componentLine(localStack, 'agentK') === 'acornops/agentk:local',
  'local-dev stack should keep agentK local image metadata'
);
expect(
  stackVersions.includes('chartRef: oci://ghcr.io/acornops/charts/acornops-agentk') === false,
  'release matrix should track component images only; agent chart refs belong in deployment values'
);

const rendered = run('helm', ['template', 'acornops', chartPath, '--namespace', 'acornops']);
const renderedWithAgentPin = run('helm', [
  'template',
  'acornops',
  chartPath,
  '--namespace',
  'acornops',
  '--set-string',
  'targetAgents.agentk.helm.chartVersion=0.0.1-experimental.4'
]);
const renderedWithAgentAirgapDefaults = run('helm', [
  'template',
  'acornops',
  chartPath,
  '--namespace',
  'acornops',
  '--set-string',
  'targetAgents.agentk.helm.chartRef=oci://docker.artifact.internal.org/acornops/charts/acornops-agentk',
  '--set-string',
  'targetAgents.agentk.helm.values.image.repository=docker.artifact.internal.org/ghcr.io/acornops/agentk',
  '--set-string',
  `targetAgents.agentk.helm.values.image.tag=${expectedAgentChart.version}`,
  '--set-string',
  'targetAgents.agentk.helm.files.additionalCaBundle.sourcePath=/opt/acornops/organization-ca.pem'
]);
for (const image of Object.values(expectedK8sImages)) {
  expect(rendered.includes(`image: "${image}"`), `platform chart should render ${image}`);
}
expect(
  rendered.includes('AGENTK_HELM_CHART_REF: "oci://ghcr.io/acornops/charts/acornops-agentk"'),
  'platform chart should render the acornops-agentk chart reference'
);
expect(
  rendered.includes('AGENTK_HELM_CHART_VERSION: ""'),
  'platform chart should leave the optional agentk chart version pin unset by default'
);
expect(
  renderedWithAgentPin.includes('AGENTK_HELM_CHART_VERSION: "0.0.1-experimental.4"'),
  'platform chart should render an explicit agentk chart version pin when configured'
);
expect(
  renderedWithAgentAirgapDefaults.includes(
    'AGENTK_HELM_CHART_REF: "oci://docker.artifact.internal.org/acornops/charts/acornops-agentk"'
  ),
  'platform chart should render an internal AgentK chart reference'
);
expect(
  renderedWithAgentAirgapDefaults.includes(
    `AGENTK_HELM_VALUES_JSON: "{\\"image\\":{\\"repository\\":\\"docker.artifact.internal.org/ghcr.io/acornops/agentk\\",\\"tag\\":\\"${expectedAgentChart.version}\\"}}"`
  ),
  'platform chart should serialize downstream AgentK values as JSON'
);
expect(
  renderedWithAgentAirgapDefaults.includes(
    'AGENTK_HELM_ADDITIONAL_CA_FILE_PATH: "/opt/acornops/organization-ca.pem"'
  ),
  'platform chart should render the generated AgentK install CA source path'
);

if (process.env.ACORNOPS_CHECK_PUBLISHED_ARTIFACTS === 'true') {
  const expectedPublishedImages = [
    ...new Set([
      ...Object.values(expectedVmProdImages),
      ...Object.values(expectedK8sImages),
      `ghcr.io/acornops/agentk:${expectedAgentChart.version}`
    ])
  ];
  const expectedPublishedCharts = [expectedPlatformChart, expectedAgentChart];
  for (const image of expectedPublishedImages) {
    expect(commandSucceeds('docker', ['manifest', 'inspect', image]), `published image should exist: ${image}`);
  }
  for (const chartRef of expectedPublishedCharts) {
    expect(
      commandSucceeds('helm', ['show', 'chart', chartRef.ref, '--version', chartRef.version]),
      `published chart should exist: ${chartRef.ref}:${chartRef.version}`
    );
  }
}

if (failures.length > 0) {
  console.error('Release matrix checks failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Release matrix checks passed for ${expectedPlatformChart.version}.`);
