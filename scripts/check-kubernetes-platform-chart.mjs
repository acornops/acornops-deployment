import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ownerPodLogArgs } from './lib/k8s-ha-smoke/platform.mjs';

const chart = 'kubernetes/helm/acornops-platform';
const k3sValues = `${chart}/examples/values-k3s-single-node.yaml`;
const k3sKeycloakValues = `${chart}/examples/values-k3s-keycloak.yaml`;
const productionValues = `${chart}/examples/values-production.yaml`;
const staleAgentChartRefPattern = /oci:\/\/ghcr\.io\/acornops\/charts\/acornops-agent(?:\s|$|["'}`])/;

function runHelm(args) {
  const result = spawnSync('helm', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const error = new Error(result.stderr || result.stdout || `helm ${args.join(' ')} exited ${result.status}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result.stdout;
}

function helmTemplate(args = []) {
  return runHelm(['template', 'acornops', chart, '--namespace', 'acornops', ...args]);
}

function expectHelmFailure(args, message) {
  const result = spawnSync('helm', ['template', 'acornops', chart, '--namespace', 'acornops', ...args], {
    encoding: 'utf8'
  });
  if (result.status === 0) {
    throw new Error(`${message}\nExpected helm template to fail.`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

function assertIncludes(output, needle, message) {
  if (!output.includes(needle)) {
    throw new Error(`${message}\nMissing: ${needle}`);
  }
}

function assertExcludes(output, needle, message) {
  if (output.includes(needle)) {
    throw new Error(`${message}\nUnexpected: ${needle}`);
  }
}

function assertMatch(output, pattern, message) {
  if (!pattern.test(output)) {
    throw new Error(`${message}\nPattern: ${pattern}`);
  }
}

function deploymentReplicas(output, deploymentName) {
  const pattern = new RegExp(`kind: Deployment\\nmetadata:\\n  name: ${deploymentName}[\\s\\S]*?spec:\\n  replicas: (\\d+)`);
  const match = output.match(pattern);
  if (!match) {
    throw new Error(`Could not find replica count for ${deploymentName}`);
  }
  return Number(match[1]);
}

runHelm(['lint', chart]);

for (const [args, message] of [
  [['--set', 'ingress.enabled=false'], 'old top-level ingress values should be rejected by schema'],
  [
    ['--set', 'components.controlPlane.image.pullPolicy=Sometimes'],
    'invalid image pull policy should be rejected by schema'
  ],
  [['--set', 'components.controlPlane.logLevel=verbose'], 'unsupported control-plane log level should be rejected'],
  [['--set', 'components.llmGateway.secretsBackend=memory'], 'unsupported llm-gateway secret backend should be rejected'],
  [['--set', 'components.executionEngine.replicas=0'], 'zero replicas should be rejected'],
  [['--set', 'ai.gatewayTimeoutMs=0'], 'invalid gateway timeout should be rejected'],
  [['--set', 'components.llmGateway.rateLimits.windowSeconds=0'], 'invalid rate limit window should be rejected'],
  [['--set', 'components.llmGateway.maxRequestBodyBytes=0'], 'invalid llm-gateway request body limit should be rejected'],
  [['--set', 'auditLogging.mode=everything'], 'invalid audit logging mode should be rejected'],
  [['--set', 'auditLogging.retentionDays=0'], 'invalid audit logging retention should be rejected'],
  [['--set-json', 'auditLogging.mode=null'], 'missing audit logging mode should be rejected'],
  [['--set-json', 'auditLogging.retentionDays=null'], 'missing audit logging retention should be rejected'],
  [
    ['--set', 'components.managementConsole.maxConcurrentRuns=10'],
    'component-local settings should be rejected under the wrong component'
  ],
  [
    ['--set', 'components.controlPlane.locales.existingConfigMap=console-locales'],
    'management-console locale settings should be rejected under the wrong component'
  ],
  [
    ['--set', 'internalTransport.tls.enabled=true'],
    'enabled internal transport TLS should require operator-supplied Secret names'
  ],
  [
    ['--set', 'auth.session.maxAgeSeconds=3600', '--set', 'auth.session.idleTimeoutSeconds=7200'],
    'browser session idle timeout must not exceed max age'
  ],
  [
    [
      '--set',
      'internalTransport.tls.enabled=true',
      '--set',
      'internalTransport.tls.ca.secretName=acornops-internal-ca',
      '--set',
      'internalTransport.tls.certificates.controlPlane.secretName=control-plane-tls'
    ],
    'enabled internal transport TLS should require every service certificate Secret'
  ]
]) {
  expectHelmFailure(args, message);
}

for (const file of [
  'compose/local/compose.source.yaml',
  'compose/vm-prod/compose.yaml',
  'env/local/.env.example',
  'env/vm/.env.example',
  `${chart}/values.yaml`
]) {
  const content = fs.readFileSync(file, 'utf8');
  if (staleAgentChartRefPattern.test(content)) {
    throw new Error(`${file} must reference the acornops-k8s-agent chart, not the release name`);
  }
}

for (const file of [
  `${chart}/README.md`,
  'kubernetes/README.md',
  'docs/OPERATIONS.md',
  `${chart}/examples/values-production.yaml`,
  `${chart}/examples/values-k3s-single-node.yaml`,
  `${chart}/examples/values-k3s-keycloak.yaml`
]) {
  const content = fs.readFileSync(file, 'utf8');
  const stalePaths = [
    ['global', 'publicUrl'],
    ['ingress', 'host'],
    ['ingress', 'managementConsoleHost'],
    ['controlPlane', 'oidc']
  ].map((parts) => parts.join('.'));
  for (const stalePath of stalePaths) {
    if (content.includes(stalePath)) {
      throw new Error(`${file} must not reference old chart value path ${stalePath}`);
    }
  }
}

const defaultOwnerLogArgs = ownerPodLogArgs({ namespace: 'acornops', pod: 'control-plane-0' });
if (!defaultOwnerLogArgs.includes('--since=5m') || defaultOwnerLogArgs.some((arg) => arg.startsWith('--since-time='))) {
  throw new Error('k8s HA smoke owner-pod log lookup should use --since only when no sinceTime is supplied');
}
const timedOwnerLogArgs = ownerPodLogArgs({
  namespace: 'acornops',
  pod: 'control-plane-0',
  sinceTime: new Date('2026-01-01T00:00:00.000Z')
});
if (timedOwnerLogArgs.includes('--since=5m') || !timedOwnerLogArgs.includes('--since-time=2026-01-01T00:00:00.000Z')) {
  throw new Error('k8s HA smoke owner-pod log lookup should use --since-time only when sinceTime is supplied');
}

const defaultRender = helmTemplate();
assertIncludes(defaultRender, 'kind: Ingress', 'default chart should render an Ingress');
assertIncludes(defaultRender, 'host: "console.acornops.dev"', 'Ingress should expose the management console host');
assertIncludes(defaultRender, 'host: "api.acornops.dev"', 'Ingress should expose the platform API host');
assertMatch(defaultRender, /host: "console\.acornops\.dev"[\s\S]*?path: \/[\s\S]*?name: acornops-acornops-platform-management-console/, 'console host should route root traffic to management-console');
assertMatch(defaultRender, /host: "console\.acornops\.dev"[\s\S]*?path: \/api[\s\S]*?name: acornops-acornops-platform-control-plane/, 'console host should route same-origin API traffic to control-plane');
assertIncludes(defaultRender, 'path: /api', 'Ingress should expose the control-plane API path');
assertMatch(
  defaultRender,
  /kind: Deployment[\s\S]*?name: acornops-acornops-platform-management-console[\s\S]*?containerPort: 8080/,
  'management-console should render its non-root nginx port'
);
assertExcludes(defaultRender, 'name: runtime-locales', 'management-console should not mount runtime locales by default');
assertExcludes(defaultRender, 'path: "/console"', 'Ingress must not expose the old management console path');
assertExcludes(defaultRender, 'path: /docs', 'API docs should not be exposed through Ingress');
assertExcludes(defaultRender, 'kind: StatefulSet', 'chart must not render bundled databases');
assertExcludes(defaultRender, 'image: postgres', 'chart must not render Postgres workloads');
assertExcludes(defaultRender, 'image: redis', 'chart must not render Redis workloads');
assertMatch(defaultRender, /ENABLE_API_DOCS:\s+"false"/, 'API docs should default to disabled');
assertIncludes(defaultRender, 'name: acornops-platform-secrets', 'default chart should reference the existing platform Secret');
assertIncludes(defaultRender, '"helm.sh/hook": pre-install,pre-upgrade', 'migration jobs should run as Helm hooks');
assertIncludes(defaultRender, 'command: ["node", "dist/scripts/control-plane-db.js", "migrate"]', 'control-plane migration job should render');
assertIncludes(defaultRender, 'command: ["sh", "-c", "alembic upgrade head"]', 'llm-gateway migration job should render');

assertIncludes(defaultRender, 'app.kubernetes.io/component: execution-engine', 'execution-engine should render');
assertIncludes(defaultRender, 'app.kubernetes.io/component: llm-gateway', 'llm-gateway should render');
assertIncludes(defaultRender, 'SECRETS_CACHE_TTL_SEC: "0"', 'llm-gateway production secret cache must default to disabled');
assertMatch(
  defaultRender,
  /name: acornops-acornops-platform-llm-gateway[\s\S]*?MAX_REQUEST_BODY_BYTES: "1000000"/,
  'llm-gateway should render its request body limit from components.llmGateway.maxRequestBodyBytes'
);
assertExcludes(defaultRender, 'path: /execution-engine', 'execution-engine must not be publicly routed');
assertExcludes(defaultRender, 'path: /llm-gateway', 'llm-gateway must not be publicly routed');
assertIncludes(defaultRender, 'kind: NetworkPolicy', 'chart should render NetworkPolicies by default');
assertIncludes(defaultRender, 'name: acornops-acornops-platform-default-deny', 'chart should render a default-deny NetworkPolicy');
assertIncludes(defaultRender, 'kubernetes.io/metadata.name: ingress-nginx', 'NetworkPolicies should restrict public ingress to the configured ingress controller namespace');
assertIncludes(defaultRender, 'kubernetes.io/metadata.name: kube-system', 'NetworkPolicies should allow DNS egress explicitly');
assertIncludes(defaultRender, 'name: acornops-acornops-platform-control-plane-migrate-egress', 'migration jobs should have external dependency egress policy');
assertIncludes(defaultRender, 'name: acornops-acornops-platform-llm-gateway-migrate-egress', 'llm-gateway migrations should have external dependency egress policy');
assertMatch(
  defaultRender,
  /name: acornops-acornops-platform-execution-engine-ingress[\s\S]*?app.kubernetes.io\/component: control-plane[\s\S]*?port: 8080/,
  'execution-engine ingress should only allow control-plane on its service port'
);
assertMatch(
  defaultRender,
  /name: acornops-acornops-platform-llm-gateway-ingress[\s\S]*?app.kubernetes.io\/component: control-plane[\s\S]*?app.kubernetes.io\/component: execution-engine[\s\S]*?port: 8001/,
  'llm-gateway ingress should allow only control-plane and execution-engine callers'
);
assertMatch(
  defaultRender,
  /name: acornops-acornops-platform-control-plane-egress[\s\S]*?app.kubernetes.io\/component: execution-engine[\s\S]*?port: 8080[\s\S]*?app.kubernetes.io\/component: llm-gateway[\s\S]*?port: 8001/,
  'control-plane egress should allow internal calls only to execution-engine and llm-gateway service ports'
);
const defaultPrefix = 'acornops-acornops-platform';
for (const component of ['management-console', 'control-plane', 'execution-engine', 'llm-gateway']) {
  assertMatch(
    defaultRender,
    new RegExp(`kind: Deployment[\\s\\S]*?name: ${defaultPrefix}-${component}[\\s\\S]*?runAsNonRoot: true[\\s\\S]*?seccompProfile:[\\s\\S]*?type: RuntimeDefault[\\s\\S]*?allowPrivilegeEscalation: false[\\s\\S]*?readOnlyRootFilesystem: true[\\s\\S]*?drop:[\\s\\S]*?- ALL[\\s\\S]*?mountPath: /tmp`),
    `${component} should render restricted pod and container security settings`
  );
}
for (const job of ['control-plane-migrate', 'llm-gateway-migrate']) {
  assertMatch(
    defaultRender,
    new RegExp(`kind: Job[\\s\\S]*?name: ${defaultPrefix}-${job}[\\s\\S]*?runAsNonRoot: true[\\s\\S]*?readOnlyRootFilesystem: true[\\s\\S]*?mountPath: /tmp`),
    `${job} should render restricted pod and container security settings`
  );
}

if (deploymentReplicas(defaultRender, `${defaultPrefix}-management-console`) !== 3) {
  throw new Error('management-console should default to 3 replicas');
}
if (deploymentReplicas(defaultRender, `${defaultPrefix}-execution-engine`) !== 3) {
  throw new Error('execution-engine should default to 3 replicas');
}
if (deploymentReplicas(defaultRender, `${defaultPrefix}-llm-gateway`) !== 3) {
  throw new Error('llm-gateway should default to 3 replicas');
}
if (deploymentReplicas(defaultRender, `${defaultPrefix}-control-plane`) !== 3) {
  throw new Error('control-plane should default to 3 replicas');
}
assertIncludes(defaultRender, 'CONTROL_PLANE_DISTRIBUTED_ROUTING_ENABLED:', 'control-plane distributed routing should render');
assertIncludes(defaultRender, 'WORKSPACE_ROLES_CONFIG_JSON:', 'control-plane workspace role templates config should render');
assertMatch(defaultRender, /WORKSPACE_ROLES_CONFIG_JSON: .*owner/, 'default workspace built-in roles should render');
assertIncludes(defaultRender, 'TRUST_PROXY: "1"', 'control-plane trusted proxy setting should render');
assertIncludes(
  defaultRender,
  'CONTROL_PLANE_DISTRIBUTED_ROUTING_ENABLED: "true"',
  'control-plane distributed routing should default to enabled'
);
assertIncludes(
  defaultRender,
  'CONTROL_PLANE_AGENT_OWNER_TTL_SECONDS: "90"',
  'control-plane agent owner TTL should render'
);
assertIncludes(
  defaultRender,
  'CONTROL_PLANE_AGENT_SNAPSHOT_INTERVAL_SECONDS: "60"',
  'control-plane agent snapshot interval should render'
);
assertIncludes(
  defaultRender,
  'TARGET_CHAT_RECENT_ACTIVITY_WINDOW_SECONDS: "300"',
  'target chat recent activity window should default to 300 seconds'
);
const localeRender = helmTemplate(['--set', 'components.managementConsole.locales.existingConfigMap=console-locales']);
assertMatch(
  localeRender,
  /kind: Deployment[\s\S]*?name: acornops-acornops-platform-management-console[\s\S]*?name: runtime-locales[\s\S]*?mountPath: \/usr\/share\/nginx\/html\/locales[\s\S]*?readOnly: true/,
  'management-console should mount configured runtime locale files read-only'
);
assertMatch(
  localeRender,
  /name: runtime-locales[\s\S]*?configMap:[\s\S]*?name: "console-locales"/,
  'management-console runtime locale mount should use the configured ConfigMap'
);
assertIncludes(defaultRender, 'WORKSPACE_AUDIT_LOGGING_MODE: "read_write"', 'audit logging mode should default to read_write');
assertIncludes(defaultRender, 'WORKSPACE_AUDIT_RETENTION_DAYS: "365"', 'audit retention days should default to 365');
const customAuditRender = helmTemplate(['--set', 'auditLogging.mode=write_only', '--set', 'auditLogging.retentionDays=90']);
assertIncludes(customAuditRender, 'WORKSPACE_AUDIT_LOGGING_MODE: "write_only"', 'audit logging mode should render configured value');
assertIncludes(customAuditRender, 'WORKSPACE_AUDIT_RETENTION_DAYS: "90"', 'audit retention days should render configured value');
assertIncludes(defaultRender, 'SESSION_MAX_AGE_SECONDS: "604800"', 'browser session max age should default to 7 days');
assertIncludes(defaultRender, 'SESSION_IDLE_TIMEOUT_SECONDS: "86400"', 'browser session idle timeout should default to 24 hours');
assertExcludes(defaultRender, 'SESSION_TTL_SECONDS:', 'legacy browser session TTL should not render into default chart config');
assertIncludes(defaultRender, 'INTERNAL_TRANSPORT_TLS_ENABLED: "false"', 'internal transport TLS should default disabled');
assertExcludes(defaultRender, 'internal-transport-ca', 'default render should not mount internal transport TLS Secrets');
assertIncludes(
  defaultRender,
  'EXECUTION_ENGINE_BASE_URL: "http://acornops-acornops-platform-execution-engine:8080"',
  'default execution-engine URL should remain HTTP'
);
assertIncludes(
  defaultRender,
  'AUTH_JWKS_URL: "http://acornops-acornops-platform-control-plane:8081/api/v1/auth/jwks.json"',
  'default JWKS URL should remain HTTP'
);
assertIncludes(defaultRender, 'PASSWORD_AUTH_ENABLED: "true"', 'password auth should default to enabled');
assertIncludes(defaultRender, 'PASSWORD_SIGNUP_ENABLED: "false"', 'password signup should default to disabled in production chart deployments');
assertIncludes(defaultRender, 'PASSWORD_EMAIL_VERIFICATION_REQUIRED: "true"', 'password email verification should default to enabled');
assertIncludes(defaultRender, 'PASSWORD_SIGNUP_ALLOW_UNVERIFIED_EMAIL: "false"', 'unverified password signup should default to disabled');
assertIncludes(defaultRender, 'PASSWORD_RESET_ENABLED: "true"', 'password reset should default to enabled');
assertIncludes(defaultRender, 'PASSWORD_RESET_TOKEN_TTL_SECONDS: "3600"', 'password reset token TTL should render');
assertIncludes(defaultRender, 'PASSWORD_RESET_REQUEST_WINDOW_SECONDS: "300"', 'password reset request window should render');
assertIncludes(defaultRender, 'EMAIL_DELIVERY_MODE: "smtp"', 'email delivery should default to SMTP for the production chart');
assertIncludes(defaultRender, 'EMAIL_PUBLIC_BASE_URL: "https://console.acornops.dev"', 'email public base URL should default to the console URL');
assertIncludes(defaultRender, 'MANAGEMENT_CONSOLE_BASE_URL: "https://console.acornops.dev"', 'external integration link base URL should default to the console URL');
assertIncludes(defaultRender, 'key: SMTP_PASSWORD', 'SMTP password should be read from the platform secret');
assertExcludes(defaultRender, 'SMTP_PASSWORD:', 'SMTP password must not render into ConfigMaps');
assertIncludes(defaultRender, 'PASSWORD_AUTH_IDENTIFIER_MAX_ATTEMPTS: "50"', 'identifier-wide password limit should render');
assertIncludes(defaultRender, 'LLM_DEFAULT_PROVIDER: "openai"', 'OpenAI should be the default LLM provider');
assertIncludes(defaultRender, 'LLM_DEFAULT_MODEL: "gpt-5.5"', 'GPT-5.5 should be the default LLM model');
assertIncludes(
  defaultRender,
  'LLM_ALLOWED_MODELS: "gpt-5.5,gpt-5.4,gpt-5.4-mini,gpt-5.4-nano,gpt-5,gpt-5-mini,gpt-5-nano,claude-3-5-sonnet-latest,gemini-2.0-flash"',
  'default LLM allow list should include GPT-5 OpenAI models'
);
assertExcludes(defaultRender, 'gpt-4.1-mini', 'default chart policy should not allow GPT-4 OpenAI models');
assertExcludes(defaultRender, 'CSRF_COOKIE_NAME:', 'CSRF cookie name is a fixed browser contract and should not be chart-configurable');
assertExcludes(defaultRender, 'CSRF_HEADER_NAME:', 'CSRF header name is a fixed browser contract and should not be chart-configurable');
assertIncludes(defaultRender, 'key: CSRF_SECRET', 'control-plane should read CSRF secret from platform secret');
assertIncludes(
  defaultRender,
  'key: GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64',
  'control-plane should read gateway signing key from platform secret'
);
assertIncludes(defaultRender, 'name: EXTERNAL_INTEGRATION_SERVICE_TOKEN', 'control-plane should render external integration service token env');
assertIncludes(defaultRender, 'key: EXTERNAL_INTEGRATION_SERVICE_TOKEN', 'external integration service token should be read from platform secret');
assertIncludes(defaultRender, 'GATEWAY_VERIFICATION_JWKS_JSON: ""', 'gateway verification keyring should render');
assertIncludes(defaultRender, 'OIDC_REQUIRE_VERIFIED_EMAIL: "true"', 'OIDC verified email enforcement should default to enabled');
assertIncludes(defaultRender, 'OIDC_HTTP_TIMEOUT_MS: "10000"', 'OIDC outbound timeout should render');
assertIncludes(defaultRender, 'fieldPath: metadata.name', 'control-plane should use pod name as instance identity');
assertMatch(
  defaultRender,
  /kind: Deployment[\s\S]*?name: acornops-acornops-platform-control-plane[\s\S]*?terminationGracePeriodSeconds: 45/,
  'control-plane should render a shutdown grace period'
);

const k3sRender = helmTemplate(['-f', k3sValues]);
for (const component of ['management-console', 'control-plane', 'execution-engine', 'llm-gateway']) {
  if (deploymentReplicas(k3sRender, `${defaultPrefix}-${component}`) !== 1) {
    throw new Error(`${component} should render one replica in k3s single-node values`);
  }
}
assertIncludes(
  k3sRender,
  'CONTROL_PLANE_DISTRIBUTED_ROUTING_ENABLED: "false"',
  'single-node k3s values should disable control-plane distributed routing'
);
assertIncludes(k3sRender, 'ingressClassName: "traefik"', 'single-node k3s values should use Traefik ingress');
assertExcludes(k3sRender, 'kubernetes.io/metadata.name: ingress-nginx', 'single-node k3s values should not allow ingress-nginx by default');
assertExcludes(k3sRender, 'kind: PodDisruptionBudget', 'single-node k3s values should disable PDBs');

const k3sKeycloakRender = helmTemplate(['-f', k3sKeycloakValues]);
assertIncludes(k3sKeycloakRender, 'host: "console.demo.acornops.dev"', 'k3s Keycloak example should render demo console host');
assertIncludes(k3sKeycloakRender, 'host: "api.demo.acornops.dev"', 'k3s Keycloak example should render demo API host');
assertIncludes(k3sKeycloakRender, 'ingressClassName: "traefik"', 'k3s Keycloak example should use Traefik ingress');
assertIncludes(k3sKeycloakRender, 'OIDC_ISSUER_URL: "http://acornops-keycloak.acornops-identity.svc.cluster.local/realms/acornops"', 'k3s Keycloak example should use the in-cluster issuer URL');
assertIncludes(k3sKeycloakRender, 'OIDC_PUBLIC_ISSUER_URL: "https://identity.demo.acornops.dev/realms/acornops"', 'k3s Keycloak example should expose the browser-visible issuer URL');
assertIncludes(k3sKeycloakRender, 'OIDC_AUTHORIZATION_ENDPOINT_OVERRIDE: "https://identity.demo.acornops.dev/realms/acornops/protocol/openid-connect/auth"', 'k3s Keycloak example should route browser authorization to the public identity host');
assertIncludes(k3sKeycloakRender, 'OIDC_TOKEN_ENDPOINT_OVERRIDE: "http://acornops-keycloak.acornops-identity.svc.cluster.local/realms/acornops/protocol/openid-connect/token"', 'k3s Keycloak example should route token exchange internally');
assertIncludes(k3sKeycloakRender, 'kubernetes.io/metadata.name: acornops-identity', 'k3s Keycloak example should allow control-plane egress to the identity namespace');
assertIncludes(k3sKeycloakRender, 'PASSWORD_AUTH_ENABLED: "false"', 'k3s Keycloak example should be OIDC-only by default');

const productionRender = helmTemplate(['-f', productionValues]);
if (deploymentReplicas(productionRender, `${defaultPrefix}-management-console`) !== 3) {
  throw new Error('production management-console should render 3 replicas');
}
if (deploymentReplicas(productionRender, `${defaultPrefix}-execution-engine`) !== 3) {
  throw new Error('production execution-engine should render 3 replicas');
}
if (deploymentReplicas(productionRender, `${defaultPrefix}-llm-gateway`) !== 3) {
  throw new Error('production llm-gateway should render 3 replicas');
}
if (deploymentReplicas(productionRender, `${defaultPrefix}-control-plane`) !== 3) {
  throw new Error('production control-plane should render 3 replicas');
}
assertMatch(productionRender, /kind: PodDisruptionBudget[\s\S]*?app.kubernetes.io\/component: management-console/, 'production should render management-console PDB');
assertMatch(productionRender, /kind: PodDisruptionBudget[\s\S]*?app.kubernetes.io\/component: control-plane/, 'production should render control-plane PDB');
assertMatch(productionRender, /kind: PodDisruptionBudget[\s\S]*?app.kubernetes.io\/component: execution-engine/, 'production should render execution-engine PDB');
assertMatch(productionRender, /kind: PodDisruptionBudget[\s\S]*?app.kubernetes.io\/component: llm-gateway/, 'production should render llm-gateway PDB');
assertIncludes(productionRender, 'PASSWORD_AUTH_ENABLED: "true"', 'production should keep password auth enabled');
assertIncludes(productionRender, 'SESSION_MAX_AGE_SECONDS: "604800"', 'production should keep browser session max age at 7 days');
assertIncludes(productionRender, 'SESSION_IDLE_TIMEOUT_SECONDS: "86400"', 'production should keep browser session idle timeout at 24 hours');
assertIncludes(productionRender, 'PASSWORD_SIGNUP_ENABLED: "false"', 'production should keep password signup disabled');
assertIncludes(productionRender, 'PASSWORD_EMAIL_VERIFICATION_REQUIRED: "true"', 'production should keep password email verification enabled');
assertIncludes(productionRender, 'PASSWORD_RESET_ENABLED: "true"', 'production should keep password reset enabled');
assertIncludes(productionRender, 'OIDC_REQUIRE_VERIFIED_EMAIL: "true"', 'production should keep OIDC verified email enforcement enabled');
assertIncludes(productionRender, 'OIDC_HTTP_TIMEOUT_MS: "10000"', 'production should render OIDC outbound timeout');
assertIncludes(productionRender, 'LLM_DEFAULT_PROVIDER: "openai"', 'production should default to OpenAI provider');
assertIncludes(productionRender, 'LLM_DEFAULT_MODEL: "gpt-5.5"', 'production should default to GPT-5.5');
assertExcludes(productionRender, 'gpt-4.1-mini', 'production should not allow GPT-4 OpenAI models by default');
assertIncludes(productionRender, 'SECRETS_CACHE_TTL_SEC: "0"', 'production should keep llm-gateway plaintext secret caching disabled');

const tlsRender = helmTemplate([
  '--set',
  'internalTransport.tls.enabled=true',
  '--set',
  'internalTransport.tls.ca.secretName=acornops-internal-ca',
  '--set',
  'internalTransport.tls.certificates.controlPlane.secretName=control-plane-tls',
  '--set',
  'internalTransport.tls.certificates.executionEngine.secretName=execution-engine-tls',
  '--set',
  'internalTransport.tls.certificates.llmGateway.secretName=llm-gateway-tls'
]);
assertIncludes(
  tlsRender,
  'EXECUTION_ENGINE_BASE_URL: "https://acornops-acornops-platform-execution-engine.acornops.svc:8080"',
  'enabled internal TLS should render HTTPS execution-engine URL'
);
assertIncludes(
  tlsRender,
  'LLM_GATEWAY_URL: "https://acornops-acornops-platform-llm-gateway.acornops.svc:8001"',
  'enabled internal TLS should render HTTPS llm-gateway URL'
);
assertIncludes(
  tlsRender,
  'ORCH_BASE_URL: "https://acornops-acornops-platform-control-plane.acornops.svc:8443"',
  'enabled internal TLS should render control-plane internal HTTPS URL'
);
assertIncludes(
  tlsRender,
  'AUTH_JWKS_URL: "https://acornops-acornops-platform-control-plane.acornops.svc:8443/api/v1/auth/jwks.json"',
  'enabled internal TLS should render control-plane internal JWKS URL'
);
assertIncludes(tlsRender, 'name: internal-mtls', 'control-plane Service should expose internal mTLS port');
assertIncludes(tlsRender, 'port: 8443', 'enabled internal TLS should render control-plane internal port');
assertIncludes(tlsRender, 'secretName: "acornops-internal-ca"', 'enabled internal TLS should mount CA Secret');
assertIncludes(tlsRender, 'secretName: "control-plane-tls"', 'enabled internal TLS should mount control-plane TLS Secret');
assertIncludes(tlsRender, 'secretName: "execution-engine-tls"', 'enabled internal TLS should mount execution-engine TLS Secret');
assertIncludes(tlsRender, 'secretName: "llm-gateway-tls"', 'enabled internal TLS should mount llm-gateway TLS Secret');
assertIncludes(tlsRender, 'containerPort: 18080', 'execution-engine probe health port should render');
assertIncludes(tlsRender, 'containerPort: 18001', 'llm-gateway probe health port should render');
assertMatch(
  tlsRender,
  /host: "console\.acornops\.dev"[\s\S]*?path: \/api[\s\S]*?port:\n\s+name: http/,
  'public ingress should keep the control-plane http service port'
);
assertMatch(
  tlsRender,
  /name: acornops-acornops-platform-control-plane-ingress[\s\S]*?kubernetes.io\/metadata.name: ingress-nginx[\s\S]*?port: 8081[\s\S]*?app.kubernetes.io\/component: execution-engine[\s\S]*?port: 8443/,
  'NetworkPolicy should keep ingress public HTTP and allow internal callers on 8443'
);
assertMatch(
  tlsRender,
  /name: acornops-acornops-platform-llm-gateway-egress[\s\S]*?app.kubernetes.io\/component: control-plane[\s\S]*?port: 8443/,
  'llm-gateway egress should allow control-plane internal mTLS port when internal TLS is enabled'
);
assertExcludes(tlsRender, 'BEGIN PRIVATE KEY', 'rendered manifests must not include raw private key material');

const extraValuesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acornops-platform-values-'));
const extraValuesPath = path.join(extraValuesDir, 'extra-workload-values.yaml');
fs.writeFileSync(
  extraValuesPath,
  `components:
  controlPlane:
    podLabels:
      acornops.dev/test-label: control-plane
    priorityClassName: platform-critical
    topologySpreadConstraints:
      - maxSkew: 1
        topologyKey: kubernetes.io/hostname
        whenUnsatisfiable: ScheduleAnyway
        labelSelector:
          matchLabels:
            app.kubernetes.io/component: control-plane
    extraEnvFrom:
      - secretRef:
          name: control-plane-extra-env
    extraEnv:
      - name: EXTRA_CONTROL_PLANE_ENV
        value: enabled
`
);
const extraRender = helmTemplate(['-f', extraValuesPath]);
assertIncludes(extraRender, 'acornops.dev/test-label: control-plane', 'podLabels should render on component pods');
assertIncludes(extraRender, 'priorityClassName: "platform-critical"', 'priorityClassName should render on component pods');
assertIncludes(extraRender, 'topologySpreadConstraints:', 'topology spread constraints should render on component pods');
assertIncludes(extraRender, 'name: control-plane-extra-env', 'extraEnvFrom should render on component containers');
assertIncludes(extraRender, 'name: EXTRA_CONTROL_PLANE_ENV', 'extraEnv should render on component containers');

console.log('Kubernetes platform Helm chart checks passed.');
