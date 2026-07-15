import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ownerPodLogArgs } from './lib/k8s-ha-smoke/platform.mjs';

const chart = 'kubernetes/helm/acornops-platform';
const chartManagedIngressValues = `${chart}/examples/values-ingress-chart-managed.yaml`;
const disabledIngressValues = `${chart}/examples/values-ingress-disabled.yaml`;
const externalIngressValues = `${chart}/examples/values-ingress-external.yaml`;
const k3sValues = `${chart}/examples/values-k3s-single-node.yaml`;
const k3sKeycloakValues = `${chart}/examples/values-k3s-keycloak.yaml`;
const productionValues = `${chart}/examples/values-production.yaml`;
const exampleValues = fs
  .readdirSync(`${chart}/examples`)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort()
  .map((file) => `${chart}/examples/${file}`);
const globalAdditionalCaValuesPath = 'global.trust.additionalCaBundle';
const additionalCaPath = '/etc/acornops/trust/additional-ca.pem';
const configMapCaArgs = [
  '--set-string',
  `${globalAdditionalCaValuesPath}.configMapKeyRef.name=organization-configmap-trust`,
  '--set-string',
  `${globalAdditionalCaValuesPath}.configMapKeyRef.key=configmap-ca.crt`
];
const secretCaArgs = [
  '--set-string',
  `${globalAdditionalCaValuesPath}.secretKeyRef.name=organization-secret-trust`,
  '--set-string',
  `${globalAdditionalCaValuesPath}.secretKeyRef.key=secret-ca.pem`
];
const llmGatewayAdditionalCaValuesPath = 'components.llmGateway.trust.additionalCaBundle';
const llmGatewayConfigMapCaArgs = [
  '--set-string',
  `${llmGatewayAdditionalCaValuesPath}.configMapKeyRef.name=organization-llm-trust`,
  '--set-string',
  `${llmGatewayAdditionalCaValuesPath}.configMapKeyRef.key=ca-bundle.pem`
];
const llmGatewaySecretCaArgs = [
  '--set-string',
  `${llmGatewayAdditionalCaValuesPath}.secretKeyRef.name=organization-llm-trust`,
  '--set-string',
  `${llmGatewayAdditionalCaValuesPath}.secretKeyRef.key=ca-bundle.pem`
];
const internalTlsArgs = [
  '--set',
  'internalTransport.tls.enabled=true',
  '--set-string',
  'internalTransport.tls.ca.secretName=acornops-internal-ca',
  '--set-string',
  'internalTransport.tls.certificates.controlPlane.secretName=control-plane-tls',
  '--set-string',
  'internalTransport.tls.certificates.executionEngine.secretName=execution-engine-tls',
  '--set-string',
  'internalTransport.tls.certificates.llmGateway.secretName=llm-gateway-tls'
];
const externalIngressArgs = ['--set', 'exposure.ingress.enabled=false'];
const emptyIngressControllerArgs = [
  '--set-json',
  'networkPolicies.ingressController.from=[]'
];
const customIngressControllerPeers = [
  {
    namespaceSelector: {
      matchLabels: {
        'kubernetes.io/metadata.name': 'ingress-system'
      }
    },
    podSelector: {
      matchLabels: {
        'app.kubernetes.io/name': 'ingress-nginx',
        'app.kubernetes.io/component': 'controller'
      },
      matchExpressions: [
        {
          key: 'acornops.io/ingress-scope',
          operator: 'In',
          values: ['public']
        }
      ]
    }
  },
  {
    namespaceSelector: {
      matchLabels: {
        'kubernetes.io/metadata.name': 'internal-gateway'
      }
    }
  },
  {
    ipBlock: {
      cidr: '192.0.2.0/24',
      except: ['192.0.2.128/25']
    }
  }
];
const customIngressControllerArgs = [
  '--set-json',
  `networkPolicies.ingressController.from=${JSON.stringify(customIngressControllerPeers)}`
];
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

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected:\n${expected}\nActual:\n${actual}`);
  }
}

function assertOccurrences(output, needle, expected, message) {
  const actual = output.split(needle).length - 1;
  if (actual !== expected) {
    throw new Error(`${message}\nExpected ${expected} occurrences of ${needle}, found ${actual}`);
  }
}

function normalizedManifestDocuments(output) {
  return output
    .split(/^---\s*$/m)
    .map((document) => document.trim())
    .filter((document) => document.includes('\nkind: '));
}

function manifestsWithoutKind(output, kind) {
  return normalizedManifestDocuments(output)
    .filter((document) => !document.includes(`\nkind: ${kind}\n`))
    .join('\n---\n');
}

function firstIngressFromBlock(networkPolicy) {
  const ingressMarker = '\n  ingress:\n';
  const ingressStart = networkPolicy.indexOf(ingressMarker);
  if (ingressStart === -1) {
    throw new Error('Could not find the ingress rules');
  }
  const fromMarker = '    - from:\n';
  const fromStart = networkPolicy.indexOf(fromMarker, ingressStart + ingressMarker.length);
  if (fromStart === -1) {
    throw new Error('Could not find the first ingress from block');
  }
  const portsStart = networkPolicy.indexOf('\n      ports:', fromStart + fromMarker.length);
  if (portsStart === -1) {
    throw new Error('Could not find ports for the first ingress from block');
  }
  return networkPolicy.slice(fromStart + fromMarker.length, portsStart).trimEnd();
}

function firstIngressRule(networkPolicy) {
  const ingressMarker = '\n  ingress:\n';
  const ingressStart = networkPolicy.indexOf(ingressMarker);
  if (ingressStart === -1) {
    throw new Error('Could not find the ingress rules');
  }
  const ruleStart = networkPolicy.indexOf('    - from:\n', ingressStart + ingressMarker.length);
  if (ruleStart === -1) {
    throw new Error('Could not find the first ingress rule');
  }
  const nextRule = networkPolicy.indexOf('\n    - from:\n', ruleStart + 1);
  return networkPolicy.slice(ruleStart, nextRule === -1 ? undefined : nextRule).trimEnd();
}

function assertNoEmptyFromRules(output, message) {
  const lines = output.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== '- from:') {
      continue;
    }
    const indentation = lines[index].length - lines[index].trimStart().length;
    const nextLine = lines.slice(index + 1).find((line) => line.trim());
    if (!nextLine) {
      throw new Error(`${message}\nEmpty from rule near line ${index + 1}`);
    }
    const nextIndentation = nextLine.length - nextLine.trimStart().length;
    if (nextLine.trim() === '[]' || nextLine.trim() === 'null' || nextIndentation <= indentation + 2) {
      throw new Error(`${message}\nEmpty from rule near line ${index + 1}`);
    }
  }
}

function manifestDocument(output, kind, name) {
  const marker = `kind: ${kind}\nmetadata:\n  name: ${name}`;
  const document = output.split(/^---\s*$/m).find((candidate) => candidate.includes(marker));
  if (!document) {
    throw new Error(`Could not find ${kind} manifest ${name}`);
  }
  return document;
}

function indentedNamedListItem(output, indentation, name) {
  const lines = output.split('\n');
  const prefix = ' '.repeat(indentation);
  const start = lines.findIndex((line) => line === `${prefix}- name: ${name}`);
  if (start === -1) {
    throw new Error(`Could not find list item ${name} at indentation ${indentation}`);
  }

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    const leadingSpaces = line.length - line.trimStart().length;
    if (line.trim() && leadingSpaces <= indentation) {
      break;
    }
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

function deploymentReplicas(output, deploymentName) {
  const pattern = new RegExp(`kind: Deployment\\nmetadata:\\n  name: ${deploymentName}[\\s\\S]*?spec:\\n  replicas: (\\d+)`);
  const match = output.match(pattern);
  if (!match) {
    throw new Error(`Could not find replica count for ${deploymentName}`);
  }
  return Number(match[1]);
}

runHelm(['lint', chart, '--strict']);
for (const valuesFile of exampleValues) {
  runHelm(['lint', chart, '--strict', '-f', valuesFile]);
}
runHelm(['lint', chart, '--strict', ...configMapCaArgs]);
runHelm(['lint', chart, '--strict', ...secretCaArgs]);
runHelm(['lint', chart, '--strict', ...llmGatewayConfigMapCaArgs]);
runHelm(['lint', chart, '--strict', ...llmGatewaySecretCaArgs]);
for (const args of [
  externalIngressArgs,
  emptyIngressControllerArgs,
  [...externalIngressArgs, ...emptyIngressControllerArgs],
  ['--set', 'networkPolicies.enabled=false'],
  [...externalIngressArgs, '--set', 'networkPolicies.enabled=false'],
  customIngressControllerArgs,
  [...externalIngressArgs, ...customIngressControllerArgs],
  ['--set', 'components.managementConsole.enabled=false'],
  ['--set', 'components.controlPlane.enabled=false'],
  internalTlsArgs,
  [...internalTlsArgs, ...externalIngressArgs],
  [...internalTlsArgs, ...emptyIngressControllerArgs]
]) {
  runHelm(['lint', chart, '--strict', ...args]);
}

for (const [args, message] of [
  [['--set', 'ingress.enabled=false'], 'old top-level ingress values should be rejected by schema'],
  [
    ['--set-json', 'networkPolicies.ingressController.from=[{}]'],
    'empty ingress-controller peers should be rejected because they allow every source'
  ],
  [
    ['--set', 'networkPolicies.ingressController.enabled=true'],
    'ingress-controller access should use the peer list rather than a contradictory enablement flag'
  ],
  [
    ['--set-json', 'networkPolicies.ingressController.from=[{"namespace":"ingress-system"}]'],
    'unknown ingress-controller peer fields should be rejected'
  ],
  [
    ['--set-json', 'networkPolicies.ingressController.from=[{"ipBlock":{}}]'],
    'ingress-controller IP blocks should require a CIDR'
  ],
  [
    [
      '--set-json',
      'networkPolicies.ingressController.from=[{"namespaceSelector":{},"ipBlock":{"cidr":"192.0.2.0/24"}}]'
    ],
    'ingress-controller IP blocks should not be combined with namespace selectors'
  ],
  [
    [
      '--set-json',
      'networkPolicies.ingressController.from=[{"podSelector":{"matchExpressions":[{"key":"app","operator":"Equals","values":["ingress"]}]}}]'
    ],
    'ingress-controller label selector operators should match Kubernetes LabelSelector semantics'
  ],
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
    [...configMapCaArgs, ...secretCaArgs],
    'OIDC additional CA ConfigMap and Secret sources should be mutually exclusive'
  ],
  [
    [...llmGatewayConfigMapCaArgs, ...llmGatewaySecretCaArgs],
    'MCP egress CA ConfigMap and Secret sources should be mutually exclusive'
  ],
  [
    ['--set-string', `${globalAdditionalCaValuesPath}.configMapKeyRef.key=ca.crt`],
    'OIDC additional CA ConfigMap source should require a name'
  ],
  [
    ['--set-string', `${globalAdditionalCaValuesPath}.configMapKeyRef.name=organization-trust-bundle`],
    'OIDC additional CA ConfigMap source should require a key'
  ],
  [
    [
      '--set-string',
      `${globalAdditionalCaValuesPath}.configMapKeyRef.name=`,
      '--set-string',
      `${globalAdditionalCaValuesPath}.configMapKeyRef.key=ca.crt`
    ],
    'OIDC additional CA ConfigMap source should reject an empty name'
  ],
  [
    [
      '--set-string',
      `${globalAdditionalCaValuesPath}.configMapKeyRef.name=organization-trust-bundle`,
      '--set-string',
      `${globalAdditionalCaValuesPath}.configMapKeyRef.key=`
    ],
    'OIDC additional CA ConfigMap source should reject an empty key'
  ],
  [
    ['--set-string', `${globalAdditionalCaValuesPath}.secretKeyRef.key=ca.crt`],
    'OIDC additional CA Secret source should require a name'
  ],
  [
    ['--set-string', `${globalAdditionalCaValuesPath}.secretKeyRef.name=organization-trust-bundle`],
    'OIDC additional CA Secret source should require a key'
  ],
  [
    [
      '--set-string',
      `${globalAdditionalCaValuesPath}.secretKeyRef.name=`,
      '--set-string',
      `${globalAdditionalCaValuesPath}.secretKeyRef.key=ca.crt`
    ],
    'OIDC additional CA Secret source should reject an empty name'
  ],
  [
    [
      '--set-string',
      `${globalAdditionalCaValuesPath}.secretKeyRef.name=organization-trust-bundle`,
      '--set-string',
      `${globalAdditionalCaValuesPath}.secretKeyRef.key=`
    ],
    'OIDC additional CA Secret source should reject an empty key'
  ],
  [
    [
      ...configMapCaArgs,
      '--set-string',
      `${globalAdditionalCaValuesPath}.configMapKeyRef.namespace=other`
    ],
    'OIDC additional CA references should reject unknown fields'
  ],
  [
    ['--set-string', `${globalAdditionalCaValuesPath}.inlinePem=unsupported`],
    'OIDC additional CA configuration should reject inline PEM fields'
  ],
  [
    ['--set', 'global.trust.skipTlsVerify=true'],
    'additional CA configuration should reject TLS verification bypasses'
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

const ambiguousOidcAdditionalCaFailure = expectHelmFailure(
  ['--skip-schema-validation', ...configMapCaArgs, ...secretCaArgs],
  'template validation should reject ambiguous OIDC additional CA configuration'
);
assertIncludes(
  ambiguousOidcAdditionalCaFailure,
  'effective additional CA bundle for components.controlPlane must configure only one of configMapKeyRef or secretKeyRef',
  'ambiguous OIDC additional CA template failure should be actionable'
);

const disabledControlPlaneAmbiguousOidcAdditionalCaFailure = expectHelmFailure(
  [
    '--skip-schema-validation',
    '--set',
    'components.controlPlane.enabled=false',
    ...configMapCaArgs,
    ...secretCaArgs
  ],
  'template validation should reject ambiguous OIDC additional CA configuration when control-plane is disabled'
);
assertIncludes(
  disabledControlPlaneAmbiguousOidcAdditionalCaFailure,
  'effective additional CA bundle for components.controlPlane must configure only one of configMapKeyRef or secretKeyRef',
  'OIDC additional CA validation should not depend on rendering the control-plane Deployment'
);

const incompleteOidcAdditionalCaConfigMapFailure = expectHelmFailure(
  [
    '--skip-schema-validation',
    '--set-string',
    `${globalAdditionalCaValuesPath}.configMapKeyRef.key=ca.crt`
  ],
  'template validation should reject an incomplete OIDC additional CA ConfigMap source'
);
assertIncludes(
  incompleteOidcAdditionalCaConfigMapFailure,
  'additionalCaBundle.configMapKeyRef.name is required when configMapKeyRef is configured',
  'incomplete OIDC additional CA ConfigMap template failure should name the missing field'
);

const disabledControlPlaneIncompleteOidcAdditionalCaFailure = expectHelmFailure(
  [
    '--skip-schema-validation',
    '--set',
    'components.controlPlane.enabled=false',
    '--set-string',
    `${globalAdditionalCaValuesPath}.configMapKeyRef.key=ca.crt`
  ],
  'template validation should reject incomplete OIDC additional CA configuration when control-plane is disabled'
);
assertIncludes(
  disabledControlPlaneIncompleteOidcAdditionalCaFailure,
  'additionalCaBundle.configMapKeyRef.name is required when configMapKeyRef is configured',
  'incomplete OIDC additional CA validation should not depend on rendering the control-plane Deployment'
);

const incompleteOidcAdditionalCaSecretFailure = expectHelmFailure(
  [
    '--skip-schema-validation',
    '--set-string',
    `${globalAdditionalCaValuesPath}.secretKeyRef.name=organization-trust-bundle`
  ],
  'template validation should reject an incomplete OIDC additional CA Secret source'
);
assertIncludes(
  incompleteOidcAdditionalCaSecretFailure,
  'additionalCaBundle.secretKeyRef.key is required when secretKeyRef is configured',
  'incomplete OIDC additional CA Secret template failure should name the missing field'
);

for (const file of [
  'compose/local/compose.source.yaml',
  'compose/vm-prod/compose.yaml',
  'env/local/.env.example',
  'env/vm/.env.example',
  `${chart}/values.yaml`
]) {
  const content = fs.readFileSync(file, 'utf8');
  if (staleAgentChartRefPattern.test(content)) {
    throw new Error(`${file} must reference the acornops-agentk chart, not the release name`);
  }
}

for (const file of [
  `${chart}/README.md`,
  'kubernetes/README.md',
  'docs/OPERATIONS.md',
  ...exampleValues
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
assertExcludes(defaultRender, 'name: additional-ca', 'default chart should not mount an additional CA bundle');
assertExcludes(defaultRender, 'name: ADDITIONAL_CA_BUNDLE_FILE', 'default chart should preserve the image trust configuration');

const llmGatewayConfigMapCaRender = helmTemplate(llmGatewayConfigMapCaArgs);
assertMatch(
  llmGatewayConfigMapCaRender,
  /name: additional-ca\n\s+configMap:\n\s+name: "organization-llm-trust"/,
  'component ConfigMap trust should render the configured volume source'
);
assertIncludes(llmGatewayConfigMapCaRender, 'name: ADDITIONAL_CA_BUNDLE_FILE', 'component ConfigMap trust should configure the runtime');
assertIncludes(llmGatewayConfigMapCaRender, `value: "${additionalCaPath}"`, 'component ConfigMap trust should use the fixed file path');
assertIncludes(llmGatewayConfigMapCaRender, `mountPath: "${additionalCaPath}"`, 'component ConfigMap trust should mount the fixed file path');

const llmGatewaySecretCaRender = helmTemplate(llmGatewaySecretCaArgs);
assertMatch(
  llmGatewaySecretCaRender,
  /name: additional-ca\n\s+secret:\n\s+secretName: "organization-llm-trust"/,
  'component Secret trust should render the configured volume source'
);
assertIncludes(llmGatewaySecretCaRender, 'name: ADDITIONAL_CA_BUNDLE_FILE', 'component Secret trust should configure the runtime');
assertIncludes(llmGatewaySecretCaRender, `value: "${additionalCaPath}"`, 'component Secret trust should use the fixed file path');
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
const managementConsolePolicyName = `${defaultPrefix}-management-console-ingress`;
const controlPlanePolicyName = `${defaultPrefix}-control-plane-ingress`;
const defaultDenyPolicyName = `${defaultPrefix}-default-deny`;
const managedManagementConsolePolicy = manifestDocument(
  defaultRender,
  'NetworkPolicy',
  managementConsolePolicyName
);
const managedControlPlanePolicy = manifestDocument(defaultRender, 'NetworkPolicy', controlPlanePolicyName);
assertEqual(
  firstIngressFromBlock(managedManagementConsolePolicy),
  firstIngressFromBlock(managedControlPlanePolicy),
  'management-console and control-plane should render the same configured ingress-controller peers'
);
assertIncludes(
  firstIngressRule(managedManagementConsolePolicy),
  'port: 8080',
  'management-console ingress-controller access should use its targetPort'
);
assertIncludes(
  firstIngressRule(managedControlPlanePolicy),
  'port: 8081',
  'control-plane ingress-controller access should use its targetPort'
);

const externalIngressRender = helmTemplate(externalIngressArgs);
assertExcludes(externalIngressRender, 'kind: Ingress', 'external Ingress ownership should omit the chart Ingress');
assertEqual(
  manifestsWithoutKind(defaultRender, 'Ingress'),
  manifestsWithoutKind(externalIngressRender, 'Ingress'),
  'exposure.ingress.enabled should change only Ingress resource rendering'
);
const externalManagementConsolePolicy = manifestDocument(
  externalIngressRender,
  'NetworkPolicy',
  managementConsolePolicyName
);
const externalControlPlanePolicy = manifestDocument(
  externalIngressRender,
  'NetworkPolicy',
  controlPlanePolicyName
);
assertEqual(
  managedManagementConsolePolicy,
  externalManagementConsolePolicy,
  'management-console NetworkPolicy should not depend on Ingress ownership'
);
assertEqual(
  managedControlPlanePolicy,
  externalControlPlanePolicy,
  'control-plane NetworkPolicy should not depend on Ingress ownership'
);

const chartManagedExampleRender = helmTemplate(['-f', chartManagedIngressValues]);
const externalIngressExampleRender = helmTemplate(['-f', externalIngressValues]);
assertIncludes(
  chartManagedExampleRender,
  'kind: Ingress',
  'chart-managed Ingress example should render the public Ingress'
);
assertExcludes(
  externalIngressExampleRender,
  'kind: Ingress',
  'external Ingress example should omit the chart Ingress'
);
for (const [render, ownership] of [
  [chartManagedExampleRender, 'chart-managed'],
  [externalIngressExampleRender, 'external']
]) {
  for (const policyName of [managementConsolePolicyName, controlPlanePolicyName]) {
    assertIncludes(
      manifestDocument(render, 'NetworkPolicy', policyName),
      'kubernetes.io/metadata.name: ingress-nginx',
      `${ownership} Ingress example should allow the configured controller for ${policyName}`
    );
  }
}

const managedEmptyPeersRender = helmTemplate(emptyIngressControllerArgs);
const externalEmptyPeersRender = helmTemplate([
  ...externalIngressArgs,
  ...emptyIngressControllerArgs
]);
assertIncludes(
  managedEmptyPeersRender,
  'kind: Ingress',
  'chart-managed Ingress should still render when ingress-controller peers are empty'
);
assertExcludes(
  externalEmptyPeersRender,
  'kind: Ingress',
  'external Ingress ownership should still omit the chart Ingress when peers are empty'
);
assertEqual(
  manifestsWithoutKind(managedEmptyPeersRender, 'Ingress'),
  manifestsWithoutKind(externalEmptyPeersRender, 'Ingress'),
  'empty ingress-controller peers should produce the same non-Ingress resources in both ownership modes'
);
assertNoEmptyFromRules(
  managedEmptyPeersRender,
  'empty ingress-controller peers must not render an empty or source-less allow rule'
);
assertNoEmptyFromRules(
  externalEmptyPeersRender,
  'external Ingress ownership with empty peers must not render an empty or source-less allow rule'
);
const disabledIngressExampleRender = helmTemplate(['-f', disabledIngressValues]);
assertExcludes(
  disabledIngressExampleRender,
  'kind: Ingress',
  'disabled public Ingress example should omit the chart Ingress'
);
assertNoEmptyFromRules(
  disabledIngressExampleRender,
  'disabled public Ingress example must not render an empty or source-less allow rule'
);
assertExcludes(
  manifestDocument(disabledIngressExampleRender, 'NetworkPolicy', managementConsolePolicyName),
  '- from:',
  'disabled public Ingress example should omit management-console controller access'
);
assertExcludes(
  manifestDocument(disabledIngressExampleRender, 'NetworkPolicy', controlPlanePolicyName),
  'kubernetes.io/metadata.name: ingress-nginx',
  'disabled public Ingress example should omit control-plane controller access'
);
const emptyPeersManagementConsolePolicy = manifestDocument(
  managedEmptyPeersRender,
  'NetworkPolicy',
  managementConsolePolicyName
);
const emptyPeersControlPlanePolicy = manifestDocument(
  managedEmptyPeersRender,
  'NetworkPolicy',
  controlPlanePolicyName
);
assertExcludes(
  emptyPeersManagementConsolePolicy,
  '- from:',
  'empty peers should omit the management-console ingress-controller rule entirely'
);
assertExcludes(
  emptyPeersControlPlanePolicy,
  'kubernetes.io/metadata.name: ingress-nginx',
  'empty peers should omit the control-plane ingress-controller rule entirely'
);
assertOccurrences(
  emptyPeersControlPlanePolicy,
  '    - from:',
  3,
  'empty peers should preserve control-plane rules for execution-engine, llm-gateway, and self traffic'
);
assertOccurrences(
  emptyPeersControlPlanePolicy,
  'port: 8081',
  3,
  'empty peers should preserve every control-plane internal HTTP caller port'
);
for (const component of ['execution-engine', 'llm-gateway', 'control-plane']) {
  assertIncludes(
    emptyPeersControlPlanePolicy,
    `app.kubernetes.io/component: ${component}`,
    `empty peers should preserve control-plane traffic from ${component}`
  );
}
assertEqual(
  manifestDocument(defaultRender, 'NetworkPolicy', defaultDenyPolicyName),
  manifestDocument(managedEmptyPeersRender, 'NetworkPolicy', defaultDenyPolicyName),
  'empty ingress-controller peers should not change the default-deny policy'
);

const customPortArgs = [
  '--set',
  'components.managementConsole.service.port=7080',
  '--set',
  'components.managementConsole.service.targetPort=9080',
  '--set',
  'components.controlPlane.service.port=7081',
  '--set',
  'components.controlPlane.service.targetPort=9081'
];
const customPeerRender = helmTemplate([...customIngressControllerArgs, ...customPortArgs]);
const customManagementConsolePolicy = manifestDocument(
  customPeerRender,
  'NetworkPolicy',
  managementConsolePolicyName
);
const customControlPlanePolicy = manifestDocument(customPeerRender, 'NetworkPolicy', controlPlanePolicyName);
const customManagementConsolePeers = firstIngressFromBlock(customManagementConsolePolicy);
const customControlPlanePeers = firstIngressFromBlock(customControlPlanePolicy);
assertEqual(
  customManagementConsolePeers,
  customControlPlanePeers,
  'multiple configured peers should render identically for both public workloads'
);
assertMatch(
  customManagementConsolePeers,
  /- namespaceSelector:[\s\S]*?kubernetes.io\/metadata.name: ingress-system[\s\S]*?podSelector:[\s\S]*?app.kubernetes.io\/component: controller/,
  'namespace and pod selectors in the same peer should preserve their combined structure'
);
assertIncludes(
  customManagementConsolePeers,
  'matchExpressions:',
  'NetworkPolicy peers should preserve label selector matchExpressions'
);
assertIncludes(
  customManagementConsolePeers,
  'kubernetes.io/metadata.name: internal-gateway',
  'multiple ingress-controller namespace peers should remain separate'
);
assertIncludes(customManagementConsolePeers, 'ipBlock:', 'NetworkPolicy peers should support IP blocks');
assertIncludes(customManagementConsolePeers, 'cidr: 192.0.2.0/24', 'NetworkPolicy IP blocks should preserve CIDRs');
assertIncludes(
  customManagementConsolePeers,
  '- 192.0.2.128/25',
  'NetworkPolicy IP blocks should preserve excluded CIDRs'
);
assertExcludes(
  customManagementConsolePeers,
  '0.0.0.0/0',
  'ingress-controller peers should not introduce an internet-wide allowance'
);
for (const marker of ['ingress-system', 'internal-gateway', '192.0.2.0/24']) {
  assertOccurrences(
    customPeerRender,
    marker,
    2,
    `configured ingress-controller peer ${marker} should appear only in the two public workload policies`
  );
}
assertIncludes(
  firstIngressRule(customManagementConsolePolicy),
  'port: 9080',
  'management-console controller access should follow a customized targetPort'
);
assertIncludes(
  firstIngressRule(customControlPlanePolicy),
  'port: 9081',
  'control-plane controller access should follow a customized targetPort'
);
assertExcludes(customManagementConsolePolicy, 'port: 7080', 'management-console policy must not use the Service port');
assertExcludes(customControlPlanePolicy, 'port: 7081', 'control-plane policy must not use the Service port');

const managementConsoleDisabledRender = helmTemplate([
  ...customIngressControllerArgs,
  '--set',
  'components.managementConsole.enabled=false'
]);
assertExcludes(
  managementConsoleDisabledRender,
  `kind: NetworkPolicy\nmetadata:\n  name: ${managementConsolePolicyName}`,
  'disabled management-console should omit its NetworkPolicy'
);
assertIncludes(
  manifestDocument(managementConsoleDisabledRender, 'NetworkPolicy', controlPlanePolicyName),
  'kubernetes.io/metadata.name: ingress-system',
  'control-plane should retain configured ingress-controller access when management-console is disabled'
);
const controlPlaneDisabledRender = helmTemplate([
  ...customIngressControllerArgs,
  '--set',
  'components.controlPlane.enabled=false'
]);
assertExcludes(
  controlPlaneDisabledRender,
  `kind: NetworkPolicy\nmetadata:\n  name: ${controlPlanePolicyName}`,
  'disabled control-plane should omit its NetworkPolicy'
);
assertIncludes(
  manifestDocument(controlPlaneDisabledRender, 'NetworkPolicy', managementConsolePolicyName),
  'kubernetes.io/metadata.name: ingress-system',
  'management-console should retain configured ingress-controller access when control-plane is disabled'
);

const managedPoliciesDisabledRender = helmTemplate(['--set', 'networkPolicies.enabled=false']);
const externalPoliciesDisabledRender = helmTemplate([
  ...externalIngressArgs,
  '--set',
  'networkPolicies.enabled=false'
]);
assertIncludes(
  managedPoliciesDisabledRender,
  'kind: Ingress',
  'chart Ingress should render independently when NetworkPolicies are disabled'
);
assertExcludes(
  managedPoliciesDisabledRender,
  'kind: NetworkPolicy',
  'disabled NetworkPolicies should omit every NetworkPolicy'
);
assertExcludes(
  externalPoliciesDisabledRender,
  'kind: Ingress',
  'external ownership should omit Ingress when NetworkPolicies are disabled'
);
assertExcludes(
  externalPoliciesDisabledRender,
  'kind: NetworkPolicy',
  'disabled NetworkPolicies should omit every NetworkPolicy with external ownership'
);
assertEqual(
  manifestsWithoutKind(managedPoliciesDisabledRender, 'Ingress'),
  manifestsWithoutKind(externalPoliciesDisabledRender, 'Ingress'),
  'Ingress ownership should remain independent when NetworkPolicies are disabled'
);

const externalTlsOwnershipRender = helmTemplate([...internalTlsArgs, ...externalIngressArgs]);
assertEqual(
  manifestsWithoutKind(helmTemplate(internalTlsArgs), 'Ingress'),
  manifestsWithoutKind(externalTlsOwnershipRender, 'Ingress'),
  'Ingress ownership should not change NetworkPolicies when internal TLS is enabled'
);
const emptyPeersTlsRender = helmTemplate([...internalTlsArgs, ...emptyIngressControllerArgs]);
const emptyPeersTlsControlPlanePolicy = manifestDocument(
  emptyPeersTlsRender,
  'NetworkPolicy',
  controlPlanePolicyName
);
assertExcludes(
  emptyPeersTlsControlPlanePolicy,
  'kubernetes.io/metadata.name: ingress-nginx',
  'empty peers should omit public access when internal TLS is enabled'
);
assertOccurrences(
  emptyPeersTlsControlPlanePolicy,
  'port: 8443',
  3,
  'empty peers should preserve all control-plane internal mTLS caller rules'
);
assertExcludes(
  emptyPeersTlsControlPlanePolicy,
  'port: 8081',
  'empty peers should not leave a public HTTP rule when internal TLS is enabled'
);
assertExcludes(defaultRender, 'name: additional-ca', 'default chart should not render an additional CA volume or mount');
assertExcludes(defaultRender, 'NODE_EXTRA_CA_CERTS', 'default chart should not configure Node.js additional CA trust');
assertExcludes(defaultRender, additionalCaPath, 'default chart should not render the fixed OIDC additional CA path');
assertExcludes(defaultRender, 'NODE_TLS_REJECT_UNAUTHORIZED', 'chart must not disable Node.js TLS verification');

const configMapCaRender = helmTemplate(configMapCaArgs);
const configMapControlPlane = manifestDocument(
  configMapCaRender,
  'Deployment',
  `${defaultPrefix}-control-plane`
);
const configMapCaMount = indentedNamedListItem(configMapControlPlane, 12, 'additional-ca');
assertIncludes(configMapCaMount, `mountPath: "${additionalCaPath}"`, 'ConfigMap CA should use the fixed mount path');
assertIncludes(configMapCaMount, 'subPath: additional-ca.pem', 'ConfigMap CA should use the fixed mounted filename');
assertIncludes(configMapCaMount, 'readOnly: true', 'ConfigMap CA mount should be read-only');
const configMapCaEnv = indentedNamedListItem(configMapControlPlane, 12, 'NODE_EXTRA_CA_CERTS');
assertIncludes(configMapCaEnv, `value: "${additionalCaPath}"`, 'ConfigMap CA should configure Node.js with the fixed path');
const configMapCaVolume = indentedNamedListItem(configMapControlPlane, 8, 'additional-ca');
assertIncludes(configMapCaVolume, 'configMap:', 'ConfigMap CA should render a ConfigMap volume source');
assertIncludes(configMapCaVolume, 'name: "organization-configmap-trust"', 'ConfigMap CA should reference the configured resource');
assertIncludes(configMapCaVolume, 'key: "configmap-ca.crt"', 'ConfigMap CA should select the configured key');
assertIncludes(configMapCaVolume, 'path: additional-ca.pem', 'ConfigMap CA key should map to the fixed filename');
assertExcludes(configMapCaVolume, 'secret:', 'ConfigMap CA should not render a Secret volume source');
assertExcludes(configMapCaVolume, 'optional:', 'ConfigMap CA source should fail closed when the resource or key is missing');

for (const [kind, name] of [
  ['Deployment', `${defaultPrefix}-execution-engine`],
  ['Deployment', `${defaultPrefix}-llm-gateway`],
  ['Job', `${defaultPrefix}-control-plane-migrate`],
  ['Job', `${defaultPrefix}-llm-gateway-migrate`]
]) {
  const workload = manifestDocument(configMapCaRender, kind, name);
  assertIncludes(workload, 'name: additional-ca', `global CA trust should mount in ${name}`);
  assertIncludes(workload, 'name: ADDITIONAL_CA_BUNDLE_FILE', `global CA trust should configure ${name}`);
}

for (const name of [`${defaultPrefix}-control-plane`, `${defaultPrefix}-execution-engine`]) {
  const workload = manifestDocument(llmGatewayConfigMapCaRender, 'Deployment', name);
  assertExcludes(workload, 'name: additional-ca', 'an llm-gateway override must not affect sibling components');
}

const secretCaRender = helmTemplate(secretCaArgs);
const secretControlPlane = manifestDocument(secretCaRender, 'Deployment', `${defaultPrefix}-control-plane`);
const secretCaMount = indentedNamedListItem(secretControlPlane, 12, 'additional-ca');
assertIncludes(secretCaMount, `mountPath: "${additionalCaPath}"`, 'Secret CA should use the fixed mount path');
assertIncludes(secretCaMount, 'subPath: additional-ca.pem', 'Secret CA should use the fixed mounted filename');
assertIncludes(secretCaMount, 'readOnly: true', 'Secret CA mount should be read-only');
const secretCaEnv = indentedNamedListItem(secretControlPlane, 12, 'NODE_EXTRA_CA_CERTS');
assertIncludes(secretCaEnv, `value: "${additionalCaPath}"`, 'Secret CA should configure Node.js with the fixed path');
const secretCaVolume = indentedNamedListItem(secretControlPlane, 8, 'additional-ca');
assertIncludes(secretCaVolume, 'secret:', 'Secret CA should render a Secret volume source');
assertIncludes(secretCaVolume, 'secretName: "organization-secret-trust"', 'Secret CA should reference the configured resource');
assertIncludes(secretCaVolume, 'key: "secret-ca.pem"', 'Secret CA should select the configured key');
assertIncludes(secretCaVolume, 'path: additional-ca.pem', 'Secret CA key should map to the fixed filename');
assertExcludes(secretCaVolume, 'configMap:', 'Secret CA should not render a ConfigMap volume source');
assertExcludes(secretCaVolume, 'optional:', 'Secret CA source should fail closed when the resource or key is missing');

for (const caRender of [configMapCaRender, secretCaRender]) {
  assertExcludes(caRender, 'NODE_TLS_REJECT_UNAUTHORIZED', 'additional CA trust must preserve TLS verification');
  assertExcludes(caRender, 'BEGIN CERTIFICATE', 'chart must not render inline CA certificate material');
  assertExcludes(caRender, 'BEGIN PRIVATE KEY', 'chart must not render private key material');
}

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
  'AGENT_WS_MAX_PAYLOAD_BYTES: "3145728"',
  'authenticated agent transport should accommodate complete tool-result envelopes'
);
assertIncludes(
  defaultRender,
  'BUILTIN_MCP_MAX_RESPONSE_BYTES: "3145728"',
  'gateway built-in MCP transport should accommodate complete tool-result envelopes'
);
assertIncludes(
  defaultRender,
  'TOOL_GATEWAY_MAX_RESPONSE_BYTES: "5242880"',
  'execution engine should bound normalized gateway response envelopes'
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
assertIncludes(defaultRender, 'name: EXTERNAL_INTEGRATION_CLIENTS_JSON', 'control-plane should render external integration clients env');
assertIncludes(defaultRender, 'key: EXTERNAL_INTEGRATION_CLIENTS_JSON', 'external integration client descriptors should be read from platform secret');
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

const tlsRender = helmTemplate(internalTlsArgs);
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

const tlsWithAdditionalCaRender = helmTemplate([...internalTlsArgs, ...configMapCaArgs]);
assertIncludes(
  tlsWithAdditionalCaRender,
  'name: internal-transport-ca',
  'internal mTLS CA volume should remain configured alongside additional CA trust'
);
assertIncludes(
  tlsWithAdditionalCaRender,
  'name: additional-ca',
  'additional CA volume should remain configured alongside internal mTLS'
);
assertIncludes(
  tlsWithAdditionalCaRender,
  'name: NODE_EXTRA_CA_CERTS',
  'additional CA environment should remain configured alongside internal mTLS'
);
assertIncludes(
  tlsWithAdditionalCaRender,
  'INTERNAL_TRANSPORT_TLS_ENABLED: "true"',
  'internal mTLS configuration should remain enabled alongside additional CA trust'
);

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
const extraRender = helmTemplate(['-f', extraValuesPath, ...configMapCaArgs]);
assertIncludes(extraRender, 'acornops.dev/test-label: control-plane', 'podLabels should render on component pods');
assertIncludes(extraRender, 'priorityClassName: "platform-critical"', 'priorityClassName should render on component pods');
assertIncludes(extraRender, 'topologySpreadConstraints:', 'topology spread constraints should render on component pods');
assertIncludes(extraRender, 'name: control-plane-extra-env', 'extraEnvFrom should render on component containers');
assertIncludes(extraRender, 'name: EXTRA_CONTROL_PLANE_ENV', 'extraEnv should render on component containers');
assertIncludes(extraRender, 'name: NODE_EXTRA_CA_CERTS', 'additional CA environment should coexist with extraEnv');
assertIncludes(extraRender, 'name: additional-ca', 'additional CA mount should coexist with extraEnvFrom');

console.log('Kubernetes platform Helm chart checks passed.');
