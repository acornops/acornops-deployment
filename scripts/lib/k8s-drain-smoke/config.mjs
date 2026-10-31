import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCertificates } from './certificates.mjs';

export const ownershipLabel = 'acornops.dev/rollout-smoke';
export function validateConfig(config) {
  if (!config.kubeconfig || !/^acornops-drain-[a-z0-9-]+$/.test(config.expectedCluster || '')) {
    throw new Error('Explicit kubeconfig and an isolated acornops-drain-* k3d cluster are required');
  }
  const url = new URL(config.ingress);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/'
    || url.username || url.password || url.search || url.hash) throw new Error('Ingress must be a loopback HTTP origin');
  if (!['on', 'off'].includes(config.capacity)) throw new Error('Capacity must be on or off');
  if (config.internalTls !== undefined && typeof config.internalTls !== 'boolean') throw new Error('Internal TLS must be boolean');
}

export function validateCluster(config, document) {
  validateConfig(config);
  const expected = `k3d-${config.expectedCluster}`;
  const context = document.contexts?.find((item) => item.name === document['current-context']);
  const cluster = document.clusters?.find((item) => item.name === context?.context.cluster);
  if (context?.name !== expected || cluster?.name !== expected
    || new URL(cluster.cluster.server).hostname !== '127.0.0.1') {
    throw new Error('Kubeconfig must select the expected isolated local cluster');
  }
  return expected;
}

function image(value) {
  const match = /^(acornops-drain-[a-z-]+):([A-Za-z0-9_.-]+)$/.exec(value || '');
  if (!match) throw new Error('Supply explicit locally built acornops-drain-*:<revision> images');
  return { repository: match[1], tag: match[2], pullPolicy: 'Never' };
}

export function createConfiguration(config, id) {
  const namespace = `drain-${id}`, release = namespace;
  const name = (component) => `${release}-acornops-platform-${component}`.slice(0, 63).replace(/-$/, '');
  const host = `${namespace}.localhost`, port = new URL(config.ingress).port;
  const origin = `http://${host}${port ? `:${port}` : ''}`;
  const secretName = `${namespace}-secrets`;
  const random = () => randomBytes(32).toString('base64');
  const password = randomBytes(24).toString('hex');
  const redis = 'redis://drain-redis:6379/0';
  const cpUrl = `postgresql://acornops:${password}@drain-postgres:5432/control_plane`;
  const gwUrl = `postgresql+asyncpg://acornops:${password}@drain-postgres:5432/gateway`;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const secret = {
    CONTROL_PLANE_DATABASE_URL: cpUrl, CONTROL_PLANE_REDIS_URL: redis, OIDC_CLIENT_SECRET: random(),
    EXTERNAL_INTEGRATION_CLIENTS_JSON: '[]',
    CSRF_SECRET: random(), GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64:
      Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
    ORCH_SERVICE_TOKEN: random(), WEBHOOK_SECRET_ENCRYPTION_KEY: random(),
    EXECUTION_ENGINE_REDIS_URL: redis, EXECUTION_ENGINE_DISPATCH_TOKEN: random(),
    LLM_GATEWAY_DATABASE_URL: gwUrl, LLM_GATEWAY_REDIS_URL: redis,
    LLM_GATEWAY_ADMIN_TOKEN: random(), SECRETS_KEK_BASE64: random(),
    POSTGRES_PASSWORD: password, FIXTURE_CONTROL_TOKEN: random(), FIXTURE_PROVIDER_KEY: `fixture-${random()}`,
  };
  const limits = (concurrent) => ({ maxConcurrentRuns: concurrent, maxOutstandingRuns: 16 });
  const component = (imageName, replicas = 1) => ({ image: image(imageName), replicas,
    podDisruptionBudget: { enabled: false }, resources: {
      requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } } });
  const values = {
    platform: { publicUrl: origin, consoleUrl: origin, adminConsoleUrl: `http://admin.${host}` },
    exposure: { ingress: { enabled: true, className: 'traefik', apiHost: host, consoleHost: host,
      adminHost: `admin.${host}`, tls: { enabled: false } } },
    internalTransport: { tls: { enabled: false } },
    mcpOAuth: { enabled: false },
    userAccess: { oidc: { enabled: false }, password: { enabled: true,
      emailVerificationRequired: false, signupAllowUnverifiedEmail: true } },
    platformSettings: { userSignInMethods: { allowedMethods: ['password'], defaultMethods: ['password'] } },
    agentGateway: { distributedRouting: { enabled: true } },
    workspaceCapacity: { enabled: config.capacity === 'on', admissionEnabled: true, dispatchEnabled: true },
    workspacePlans: { defaultPlanKey: 'default', plans: [{ key: 'default', name: 'Rollout fixture',
      quotas: { members: 10, kubernetesClusters: 10, virtualMachines: 10 }, executionLimits: {
        chat: limits(4), agent: limits(1), workflow: limits(1), autoTriage: limits(1), insights: limits(1) } }] },
    ai: { defaultProvider: 'openai', defaultModel: 'gpt-5.4-mini',
      providers: { openai: ['gpt-5.4-mini'], anthropic: null, gemini: null },
      reasoningSummariesEnabled: false, allowedReasoningSummaryModes: 'off', allowedReasoningEfforts: 'off,low,medium,high' },
    components: {
      managementConsole: { enabled: false }, platformAdminConsole: { enabled: false },
      controlPlane: { ...component(config.cpImage, 2), extraEnv: [
        { name: 'NODE_ENV', value: 'development' }, { name: 'SEED_DEVELOPMENT_DATA', value: 'false' },
        { name: 'AGENT_WS_REQUIRE_SECURE_TRANSPORT', value: 'false' }] },
      executionEngine: { ...component(config.eeImage), maxConcurrentRuns: 4, durability: { keyPrefix: namespace } },
      llmGateway: { ...component(config.gwImage), providerBaseUrls: { openai: 'http://drain-fixture:8099/v1/' },
        openaiApiSurface: 'responses', remoteMcp: { enabled: false },
        catalog: { officialRegistryEnabled: false, bootstrapSources: [] }, database: { poolMin: 1, poolMax: 5 } },
    },
    networkPolicies: { enabled: false }, secrets: { existingSecretName: secretName },
  };
  const labels = { [ownershipLabel]: id };
  const tls = config.internalTls ? createCertificates(namespace, name) : undefined;
  if (tls) values.internalTransport.tls = tls.values;
  const object = (kind, name, spec, apiVersion = 'v1') => ({ apiVersion, kind,
    metadata: { name, namespace, labels }, ...spec });
  function dependency(name, imageName, port, env, extra = {}) {
    const podLabels = { ...labels, app: name };
    return [object('Service', name, { spec: { selector: { app: name }, ports: [{ port }] } }),
      object('Deployment', name, { spec: { replicas: 1, selector: { matchLabels: { app: name } },
        template: { metadata: { labels: podLabels }, spec: { containers: [{ name, image: imageName,
          imagePullPolicy: 'IfNotPresent', env, ports: [{ containerPort: port }],
          resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { memory: '384Mi' } },
          ...extra.container }], ...extra.pod } } } }, 'apps/v1')];
  }
  const envSecret = (key) => ({ name: key, valueFrom: { secretKeyRef: { name: secretName, key } } });
  const dependencies = [
    object('Secret', secretName, { type: 'Opaque', stringData: secret }),
    ...(tls ? [object('Secret', tls.values.ca.secretName, { type: 'Opaque', stringData: tls.material })] : []),
    object('ConfigMap', 'drain-init', { data: { 'init.sql': 'CREATE DATABASE control_plane;\nCREATE DATABASE gateway;\n' } }),
    ...dependency('drain-postgres', 'postgres:16-alpine', 5432,
      [{ name: 'POSTGRES_USER', value: 'acornops' }, envSecret('POSTGRES_PASSWORD')], {
        container: { readinessProbe: { exec: { command: ['pg_isready', '-U', 'acornops'] }, periodSeconds: 2 },
          volumeMounts: [{ name: 'data', mountPath: '/var/lib/postgresql/data' },
            { name: 'init', mountPath: '/docker-entrypoint-initdb.d', readOnly: true }] },
        pod: { volumes: [{ name: 'data', emptyDir: {} }, { name: 'init', configMap: { name: 'drain-init' } }] } }),
    ...dependency('drain-redis', 'redis:7-alpine', 6379, [], {
      container: { command: ['redis-server', '--save', '', '--appendonly', 'no'],
        readinessProbe: { exec: { command: ['redis-cli', 'ping'] }, periodSeconds: 2 } } }),
    object('ConfigMap', 'drain-fixture', { data: {
      'drain-runtime.mjs': readFileSync(new URL('../../fixtures/drain-runtime.mjs', import.meta.url), 'utf8') } }),
    ...dependency('drain-fixture', config.cpImage, 8099, [envSecret('FIXTURE_CONTROL_TOKEN'), envSecret('FIXTURE_PROVIDER_KEY'),
      { name: 'FIXTURE_AGENT_URL', value: `ws://${name('control-plane')}:8081/api/v1/agent/connect` },
      { name: 'FIXTURE_WS_PACKAGE', value: '/app/package.json' }], {
      container: { command: ['node', '/fixtures/drain-runtime.mjs'],
        readinessProbe: { httpGet: { path: '/health', port: 8099 }, periodSeconds: 2 },
        volumeMounts: [{ name: 'fixture', mountPath: '/fixtures', readOnly: true }] },
      pod: { volumes: [{ name: 'fixture', configMap: { name: 'drain-fixture' } }] } }),
    object('NetworkPolicy', 'drain-isolation', { spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'],
      ingress: [{ from: [{ podSelector: {} }, { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } } }] }],
      egress: [{ to: [{ podSelector: {} }] }, { to: [{ namespaceSelector: { matchLabels: {
        'kubernetes.io/metadata.name': 'kube-system' } } }], ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] }] } },
    'networking.k8s.io/v1'),
  ];
  return { namespace, release, host, origin, secret, values, dependencies, name, labels, tlsRedactions: tls?.redactions || [],
    agentUrl: `ws://${name('control-plane')}:8081/api/v1/agent/connect` };
}
