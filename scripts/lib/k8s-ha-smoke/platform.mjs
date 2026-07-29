import { generateKeyPairSync, randomBytes } from 'node:crypto';

export function assertNonProductionHost(host, name) {
  const normalized = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (normalized === 'acornops.dev' || normalized === 'api.acornops.dev' || normalized === 'console.acornops.dev') {
    throw new Error(`${name} must not point at production (${host}). Use a non-production smoke host.`);
  }
}

export function randomBase64(bytes = 32) {
  return randomBytes(bytes).toString('base64');
}

export function randomGatewaySigningKeyB64() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001
  });
  return Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()).toString('base64');
}

export function literal(name, fallback) {
  return process.env[`ACORNOPS_K8S_HA_SMOKE_${name}`] || process.env[name] || fallback;
}

export function controlPlaneName(config) {
  return `${config.release}-acornops-platform-control-plane`;
}

export function controlPlaneService(config) {
  return controlPlaneName(config);
}

export function createSmokeSecretIfRequested(config, runtime) {
  const shouldCreate = env('ACORNOPS_K8S_HA_SMOKE_CREATE_SECRET', config.valuesFiles.length === 0 ? 'true' : 'false') === 'true';
  if (!shouldCreate) return;

  const requiredSecretInputs = [
    'CONTROL_PLANE_DATABASE_URL',
    'CONTROL_PLANE_REDIS_URL',
    'EXECUTION_ENGINE_REDIS_URL',
    'LLM_GATEWAY_DATABASE_URL',
    'LLM_GATEWAY_REDIS_URL'
  ];
  for (const name of requiredSecretInputs) {
    if (!literal(name, '')) {
      throw new Error(`ACORNOPS_K8S_HA_SMOKE_${name} or ${name} is required when creating the smoke secret.`);
    }
  }

  if (!runtime.commandSucceeds('kubectl', ['--context', config.context, 'get', 'namespace', config.namespace])) {
    runtime.kubectl(['create', 'namespace', config.namespace]);
  }
  const args = [
    '-n',
    config.namespace,
    'create',
    'secret',
    'generic',
    config.secretName,
    '--dry-run=client',
    '-o',
    'yaml',
    `--from-literal=CONTROL_PLANE_DATABASE_URL=${literal('CONTROL_PLANE_DATABASE_URL')}`,
    `--from-literal=CONTROL_PLANE_REDIS_URL=${literal('CONTROL_PLANE_REDIS_URL')}`,
    `--from-literal=OIDC_CLIENT_SECRET=${literal('OIDC_CLIENT_SECRET', `oidc_${randomBase64(24)}`)}`,
    `--from-literal=CSRF_SECRET=${literal('CSRF_SECRET', `csrf_${randomBase64(24)}`)}`,
    `--from-literal=GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64=${literal('GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64', randomGatewaySigningKeyB64())}`,
    `--from-literal=ORCH_SERVICE_TOKEN=${literal('ORCH_SERVICE_TOKEN', `orch_${randomBase64(24)}`)}`,
    `--from-literal=WEBHOOK_SECRET_ENCRYPTION_KEY=${literal('WEBHOOK_SECRET_ENCRYPTION_KEY', randomBase64(32))}`,
    `--from-literal=EXECUTION_ENGINE_REDIS_URL=${literal('EXECUTION_ENGINE_REDIS_URL')}`,
    `--from-literal=EXECUTION_ENGINE_DISPATCH_TOKEN=${literal('EXECUTION_ENGINE_DISPATCH_TOKEN', `dispatch_${randomBase64(24)}`)}`,
    `--from-literal=LLM_GATEWAY_DATABASE_URL=${literal('LLM_GATEWAY_DATABASE_URL')}`,
    `--from-literal=LLM_GATEWAY_REDIS_URL=${literal('LLM_GATEWAY_REDIS_URL')}`,
    `--from-literal=LLM_GATEWAY_ADMIN_TOKEN=${literal('LLM_GATEWAY_ADMIN_TOKEN', `gateway_${randomBase64(24)}`)}`,
    `--from-literal=SECRETS_KEK_BASE64=${literal('SECRETS_KEK_BASE64', randomBase64(32))}`
  ];
  const secretYaml = runtime.kubectl(args, { capture: true });
  const secretFile = runtime.writeGeneratedFile('acornops-ha-smoke-secret.yaml', secretYaml);
  runtime.kubectl(['apply', '-f', secretFile]);
}

export function createSmokeValuesFile(config, runtime) {
  const values = [
    'platform:',
    `  publicUrl: http://${config.platformHost}`,
    `  consoleUrl: http://${config.consoleHost}`,
    `  adminConsoleUrl: http://admin.${config.platformHost}`,
    'exposure:',
    '  ingress:',
    '    enabled: false',
    `    apiHost: ${config.platformHost}`,
    `    consoleHost: ${config.consoleHost}`,
    `    adminHost: admin.${config.platformHost}`,
    '    tls:',
    '      enabled: false',
    'userAccess:',
    '  oidc:',
    '    enabled: false',
    '  password:',
    '    enabled: true',
    '    emailVerificationRequired: false',
    '    signupAllowUnverifiedEmail: true',
    'platformSettings:',
    '  userSignInMethods:',
    '    allowedMethods: [password]',
    '    defaultMethods: [password]',
    'agentGateway:',
    '  distributedRouting:',
    '    enabled: true',
    'components:',
    '  controlPlane:',
    '    replicas: 3',
    '    podDisruptionBudget:',
    '      enabled: true',
    '      minAvailable: 2',
    'secrets:',
    `  existingSecretName: ${config.secretName}`
  ].join('\n');
  return runtime.writeGeneratedFile('acornops-ha-smoke-values.yaml', `${values}\n`);
}

export function readyReplicas(config, runtime) {
  const output = runtime.kubectl([
    '-n',
    config.namespace,
    'get',
    'deploy',
    controlPlaneName(config),
    '-o',
    'json'
  ], { capture: true });
  const deployment = JSON.parse(output);
  return Number(deployment.status?.readyReplicas || 0);
}

export function controlPlanePods(config, runtime) {
  const output = runtime.kubectl([
    '-n',
    config.namespace,
    'get',
    'pods',
    '-l',
    'app.kubernetes.io/component=control-plane',
    '-o',
    'json'
  ], { capture: true });
  const list = JSON.parse(output);
  return list.items.map((item) => item.metadata.name);
}

export function ownerPodLogArgs({ namespace, pod, sinceTime }) {
  return [
    '-n',
    namespace,
    'logs',
    pod,
    sinceTime ? `--since-time=${sinceTime.toISOString()}` : '--since=5m'
  ];
}

export function findOwnerPod(config, runtime, sinceTime) {
  for (const pod of controlPlanePods(config, runtime)) {
    const logs = runtime.kubectl(ownerPodLogArgs({ namespace: config.namespace, pod, sinceTime }), { capture: true });
    if (logs.includes('Agent websocket connected')) return pod;
  }
  throw new Error('Could not identify the owning control-plane pod from recent logs');
}

function env(name, fallback) {
  return process.env[name] || fallback;
}
