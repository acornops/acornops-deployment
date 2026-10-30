import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { agentVExampleFailures } from './lib/release-matrix-agentv.mjs';

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
const chartReleaseWorkflow = read('.github/workflows/release-chart.yml');
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
  platformAdminConsole: componentLine(k8sPlatformStack, 'platformAdminConsole'),
  managementConsole: componentLine(k8sPlatformStack, 'managementConsole'),
  controlPlane: componentLine(k8sPlatformStack, 'controlPlane'),
  executionEngine: componentLine(k8sPlatformStack, 'executionEngine'),
  llmGateway: componentLine(k8sPlatformStack, 'llmGateway')
};
const expectedPlatformChart = splitVersionedOciRef(chartLine(k8sPlatformStack, 'acornopsPlatform'));
if (process.env.ACORNOPS_RELEASE_VERSION !== undefined
    && process.env.ACORNOPS_RELEASE_VERSION !== expectedPlatformChart.version) {
  throw new Error(`Release tag does not match the platform chart version ${expectedPlatformChart.version}`);
}
const expectedAgentChart = splitVersionedOciRef(chartLine(k8sPlatformStack, 'acornopsAgentK'));
const expectedVmAgentVRelease = componentLine(vmProdStack, 'agentV');
const expectedK8sAgentVRelease = componentLine(k8sPlatformStack, 'agentV');
const agentVReleaseMatch = expectedVmAgentVRelease?.match(/^https:\/\/github\.com\/acornops\/agentv\/releases\/tag\/v(.+)$/);
const expectedAgentVVersion = agentVReleaseMatch?.[1];

for (const [name, block] of [
  ['local-dev', localStack],
  ['vm-prod-v1', vmProdStack],
  ['k8s-platform-v1', k8sPlatformStack]
]) {
  expect(stackMetadata(block, 'executionContractVersion') === '2', `${name} must declare exact execution contract version 2`);
  expect(
    stackMetadata(block, 'databaseSchemaEpoch') === 'greenfield-1',
    `${name} must declare database schema epoch greenfield-1`
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
expect(
  !chartReleaseWorkflow.includes('--app-version'),
  'chart release workflow must preserve Chart.yaml appVersion when packaging'
);
expect(Boolean(expectedAgentVVersion), 'vm-prod-v1 should pin AgentV to an immutable GitHub release tag');
expect(expectedK8sAgentVRelease === expectedVmAgentVRelease, 'VM and Kubernetes platform tracks should pin the same AgentV release');
expect(
  compose.includes(`AGENTV_SYSTEMD_RELEASE_VERSION:-${expectedAgentVVersion}`),
  'VM compose should default generated AgentV installs to the release-matrix version'
);

for (const [component, image] of Object.entries(expectedVmProdImages)) {
  expect(
    typeof image === 'string' && image.length > 0,
    `vm-prod-v1 should pin ${component} to a concrete image`
  );
  expect(compose.includes(image), `VM compose fallback should pin ${component} image to ${image}`);
}

// Exercise the documented installation path, not just the source fallbacks:
// an explicit image in the example env overrides even a correct Compose pin.
// Do not let the caller's shell overrides mask a stale shipped example.
const composeEnv = { ...process.env };
for (const key of Object.keys(composeEnv)) {
  if (key.startsWith('COMPOSE_') || key.endsWith('_IMAGE') || key.endsWith('_DRAIN_TIMEOUT_SECONDS') || key.endsWith('_STOP_GRACE_SECONDS') || key === 'AGENT_HANDOFF_TIMEOUT_MS') delete composeEnv[key];
}
delete composeEnv.AGENTV_SYSTEMD_RELEASE_VERSION;
const composeResult = spawnSync('docker', [
  'compose', '-f', 'compose/vm-prod/compose.yaml', '--profile', 'prod',
  '--env-file', 'env/vm/.env.example', 'config', '--format', 'json'
], { encoding: 'utf8', env: composeEnv });
if (composeResult.status !== 0) {
  throw new Error(composeResult.stderr || composeResult.error?.message || 'VM Compose render failed');
}
const vmServices = JSON.parse(composeResult.stdout).services;
for (const [name, drain, grace] of [['control-plane', 150, 180], ['execution-engine', 870, 900], ['llm-gateway', 210, 240]]) {
  const service = vmServices[name];
  expect(service.stop_grace_period === `${grace}s` || service.stop_grace_period === `${grace / 60}m0s`, `${name} Compose stop grace must cover drain and cleanup`);
  expect(service.environment.SERVICE_DRAIN_TIMEOUT_SECONDS === String(drain), `${name} Compose drain budget must match Kubernetes defaults`);
  expect(service.environment.AGENT_HANDOFF_TIMEOUT_MS === '45000', `${name} Compose handoff allowance must be consistent`);
}
expect(
  vmServices?.['control-plane']?.environment?.AGENTV_SYSTEMD_RELEASE_VERSION === expectedAgentVVersion,
  `VM example should render generated AgentV installs at ${expectedAgentVVersion}; got ${vmServices?.['control-plane']?.environment?.AGENTV_SYSTEMD_RELEASE_VERSION}`
);
for (const [service, component] of Object.entries({
  'management-console': 'managementConsole',
  'control-plane': 'controlPlane',
  'control-plane-init': 'controlPlane',
  'execution-engine': 'executionEngine',
  'llm-gateway': 'llmGateway',
  'llm-gateway-init': 'llmGateway'
})) {
  const actual = vmServices?.[service]?.image;
  expect(actual === expectedVmProdImages[component],
    `VM example should render ${service} image ${expectedVmProdImages[component]}; got ${actual}`);
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
const renderedWithPlatformAdmin = run('helm', [
  'template',
  'acornops',
  chartPath,
  '--namespace',
  'acornops',
  '--set',
  'components.platformAdminConsole.enabled=true',
  '--set',
  'adminApi.enabled=true',
  '--set',
  'internalTransport.tls.enabled=true',
  '--set-string',
  'internalTransport.tls.ca.secretName=acornops-internal-ca',
  '--set-string',
  'internalTransport.tls.certificates.controlPlane.secretName=control-plane-tls',
  '--set-string',
  'internalTransport.tls.certificates.platformAdminConsole.secretName=platform-admin-console-tls',
  '--set-string',
  'internalTransport.tls.certificates.executionEngine.secretName=execution-engine-tls',
  '--set-string',
  'internalTransport.tls.certificates.llmGateway.secretName=llm-gateway-tls'
]);
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
  'targetAgents.agentk.helm.files.additionalCaBundle.sourcePath=/opt/acornops/organization-ca.pem',
  '--set-string',
  'targetAgents.agentv.systemd.version=1.2.3',
  '--set-string',
  'targetAgents.agentv.systemd.releaseBaseUrl=https://artifacts.internal.example/acornops/agentv'
]);
for (const [component, image] of Object.entries(expectedK8sImages)) {
  const output = component === 'platformAdminConsole' ? renderedWithPlatformAdmin : rendered;
  expect(output.includes(`image: "${image}"`), `platform chart should render ${image}`);
}
expect(
  rendered.includes('AGENTK_HELM_CHART_REF: "oci://ghcr.io/acornops/charts/acornops-agentk"'),
  'platform chart should render the acornops-agentk chart reference'
);
expect(
  rendered.includes('AGENTK_HELM_CHART_VERSION: ""'),
  'platform chart should leave the optional agentk chart version pin unset by default'
);
failures.push(...agentVExampleFailures(rendered, expectedAgentVVersion, 'platform chart defaults'));
for (const example of readdirSync(`${chartPath}/examples`).filter((file) => /\.ya?ml$/.test(file)).sort()) {
  const exampleRender = run('helm', [
    'template', 'acornops', chartPath, '--namespace', 'acornops', '-f', `${chartPath}/examples/${example}`
  ]);
  failures.push(...agentVExampleFailures(exampleRender, expectedAgentVVersion, example));
}

const productionAndAirgapArgs = [
  'template', 'acornops', chartPath, '--namespace', 'acornops',
  '-f', `${chartPath}/examples/values-production.yaml`,
  '-f', `${chartPath}/examples/values-air-gapped-catalog.yaml`
];
const productionAndAirgap = run('helm', productionAndAirgapArgs);
failures.push(...agentVExampleFailures(productionAndAirgap, expectedAgentVVersion, 'production + air-gapped examples'));
expect(
  productionAndAirgap.includes('AGENTV_SYSTEMD_RELEASE_BASE_URL: "https://artifacts.internal.example/acornops/agentv"'),
  'production + air-gapped examples should preserve the AgentV release mirror'
);
const explicitAgentVOverride = run('helm', [
  ...productionAndAirgapArgs, '--set-string', 'targetAgents.agentv.systemd.version=1.2.3',
  '--set-string', 'targetAgents.agentv.systemd.releaseBaseUrl=https://operator.example/agentv'
]);
failures.push(...agentVExampleFailures(explicitAgentVOverride, '1.2.3', 'operator AgentV override'));
expect(
  explicitAgentVOverride.includes('AGENTV_SYSTEMD_RELEASE_BASE_URL: "https://operator.example/agentv"'),
  'an explicit operator AgentV release mirror should override bundled examples'
);
expect(
  rendered.includes('AGENTV_SYSTEMD_RELEASE_BASE_URL: "https://github.com/acornops/agentv/releases/download"'),
  'platform chart should render the default AgentV release source'
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
  renderedWithAgentAirgapDefaults.includes('AGENTV_SYSTEMD_RELEASE_VERSION: "1.2.3"')
    && renderedWithAgentAirgapDefaults.includes('AGENTV_SYSTEMD_RELEASE_BASE_URL: "https://artifacts.internal.example/acornops/agentv"'),
  'platform chart should render an internal AgentV release mirror and exact version'
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
  const expectedPublishedCharts = process.env.ACORNOPS_SKIP_CURRENT_PLATFORM_CHART_ARTIFACT === 'true'
    ? [expectedAgentChart]
    : [expectedPlatformChart, expectedAgentChart];
  for (const image of expectedPublishedImages) {
    expect(commandSucceeds('docker', ['manifest', 'inspect', image]), `published image should exist: ${image}`);
  }
  for (const chartRef of expectedPublishedCharts) {
    expect(
      commandSucceeds('helm', ['show', 'chart', chartRef.ref, '--version', chartRef.version]),
      `published chart should exist: ${chartRef.ref}:${chartRef.version}`
    );
  }
  const agentVReleaseBase = `https://github.com/acornops/agentv/releases/download/v${expectedAgentVVersion}`;
  for (const asset of [
    'install-agentv.sh',
    'install-agentv.sh.sha256',
    `agentv-${expectedAgentVVersion}.tar.gz`,
    `agentv-${expectedAgentVVersion}.tar.gz.sha256`
  ]) {
    expect(
      commandSucceeds('curl', ['-fsSIL', `${agentVReleaseBase}/${asset}`]),
      `published AgentV release asset should exist: ${asset}`
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
