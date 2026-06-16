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
const expectedAgentChart = splitVersionedOciRef(chartLine(k8sPlatformStack, 'acornopsK8sAgent'));

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
  componentLine(localStack, 'k8sAgent') === 'acornops/k8s-agent:local',
  'local-dev stack should keep k8sAgent local image metadata'
);
expect(
  stackVersions.includes('chartRef: oci://ghcr.io/acornops/charts/acornops-k8s-agent') === false,
  'release matrix should track component images only; agent chart refs belong in deployment values'
);

const rendered = run('helm', ['template', 'acornops', chartPath, '--namespace', 'acornops']);
for (const image of Object.values(expectedK8sImages)) {
  expect(rendered.includes(`image: "${image}"`), `platform chart should render ${image}`);
}
expect(
  rendered.includes('AGENT_HELM_CHART_REF: "oci://ghcr.io/acornops/charts/acornops-k8s-agent"'),
  'platform chart should render the acornops-k8s-agent chart reference'
);

if (process.env.ACORNOPS_CHECK_PUBLISHED_ARTIFACTS === 'true') {
  const expectedPublishedImages = [
    ...new Set([
      ...Object.values(expectedVmProdImages),
      ...Object.values(expectedK8sImages),
      `ghcr.io/acornops/k8s-agent:${expectedAgentChart.version}`
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
