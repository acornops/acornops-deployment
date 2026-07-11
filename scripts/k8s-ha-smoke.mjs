#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { createRuntime, findFreePort, requestJson } from './lib/k8s-ha-smoke/runtime.mjs';
import {
  assertNonProductionHost,
  controlPlaneName,
  controlPlaneService,
  createSmokeSecretIfRequested,
  createSmokeValuesFile,
  findOwnerPod,
  readyReplicas
} from './lib/k8s-ha-smoke/platform.mjs';
import { controlPlaneInternalWsUrl, ensureSmokeLogPod, localAgentChart } from './lib/k8s-ha-smoke/workload.mjs';

const config = buildConfig();
const runtime = createRuntime({
  context: config.context,
  timeoutMs: config.timeoutMs,
  workloadContext: config.workloadContext
});

function env(name, fallback) {
  return process.env[name] || fallback;
}

function buildConfig() {
  const release = env('ACORNOPS_K8S_HA_SMOKE_RELEASE', 'acornops-ha-smoke');
  const namespace = env('ACORNOPS_K8S_HA_SMOKE_NAMESPACE', 'acornops-ha-smoke');
  const explicitLogPodNamespace = env('ACORNOPS_K8S_HA_SMOKE_LOG_POD_NAMESPACE', '');
  const explicitLogPodName = env('ACORNOPS_K8S_HA_SMOKE_LOG_POD_NAME', '');
  const valuesFiles = env('ACORNOPS_K8S_HA_SMOKE_VALUES', '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    agentNamespace: env('ACORNOPS_K8S_HA_SMOKE_AGENT_NAMESPACE', `${namespace}-agent`),
    agentRelease: env('ACORNOPS_K8S_HA_SMOKE_AGENT_RELEASE', 'acornops-agent'),
    chart: 'kubernetes/helm/acornops-platform',
    cleanup: env('ACORNOPS_K8S_HA_SMOKE_CLEANUP', 'false') === 'true',
    consoleHost: env('ACORNOPS_K8S_HA_SMOKE_CONSOLE_HOST', 'console.acornops-ha-smoke.local'),
    context: env('ACORNOPS_K8S_HA_SMOKE_CONTEXT', ''),
    explicitLogPodName,
    explicitLogPodNamespace,
    namespace,
    platformHost: env('ACORNOPS_K8S_HA_SMOKE_PLATFORM_HOST', 'acornops-ha-smoke.local'),
    release,
    secretName: env('ACORNOPS_K8S_HA_SMOKE_SECRET_NAME', 'acornops-ha-smoke-secrets'),
    smokeLogPodName: explicitLogPodName || 'acornops-ha-smoke-log-target',
    smokeLogPodNamespace: explicitLogPodNamespace || `${namespace}-workload`,
    timeoutMs: Number(env('ACORNOPS_K8S_HA_SMOKE_TIMEOUT_MS', '600000')),
    valuesFiles,
    workloadContext: env('ACORNOPS_K8S_HA_SMOKE_WORKLOAD_CONTEXT', env('ACORNOPS_K8S_HA_SMOKE_CONTEXT', ''))
  };
}

async function installPlatform() {
  createSmokeSecretIfRequested(config, runtime);
  const smokeValues = createSmokeValuesFile(config, runtime);
  runtime.helm([
    'upgrade',
    '--install',
    config.release,
    config.chart,
    '--namespace',
    config.namespace,
    '--create-namespace',
    '--wait',
    '--timeout',
    '10m',
    '-f',
    smokeValues,
    ...config.valuesFiles.flatMap((file) => ['-f', file])
  ]);

  runtime.kubectl(['-n', config.namespace, 'rollout', 'status', `deployment/${controlPlaneName(config)}`, '--timeout=5m']);
  await runtime.waitFor('three control-plane replicas ready', async () => {
    const ready = readyReplicas(config, runtime);
    if (ready < 3) throw new Error(`readyReplicas=${ready}`);
  });
}

async function signUpSmokeUser(baseUrl) {
  const username = `smoke-${Date.now()}`;
  const password = `Smoke-${randomBytes(12).toString('hex')}`;
  const signup = await requestJson(baseUrl, 'POST', '/auth/password/signup', {
    displayName: 'HA Smoke',
    email: `${username}@example.invalid`,
    password,
    username
  });
  const cookie = String(signup.headers['set-cookie'] || '').split(';')[0];
  if (!cookie) throw new Error('Password signup did not return a session cookie');
  return cookie;
}

async function registerWorkloadCluster(baseUrl, cookie) {
  const workspace = await requestJson(baseUrl, 'POST', '/workspaces', { name: 'HA Smoke' }, cookie);
  const cluster = await requestJson(
    baseUrl,
    'POST',
    `/workspaces/${workspace.body.id}/kubernetes-clusters`,
    { name: 'HA Smoke Workload' },
    cookie
  );
  return {
    agentKey: cluster.body.agentKey,
    clusterId: cluster.body.cluster.id,
    workspaceId: workspace.body.id
  };
}

function installWorkloadAgent(agentKey, clusterId) {
  const websocketUrl = env(
    'ACORNOPS_K8S_HA_SMOKE_AGENT_WEBSOCKET_URL',
    config.workloadContext === config.context ? controlPlaneInternalWsUrl(config) : ''
  );
  if (!websocketUrl) {
    throw new Error('ACORNOPS_K8S_HA_SMOKE_AGENT_WEBSOCKET_URL is required when workload context differs from platform context.');
  }
  runtime.workloadHelm([
    'upgrade',
    '--install',
    config.agentRelease,
    localAgentChart(),
    '--namespace',
    config.agentNamespace,
    '--create-namespace',
    '--wait',
    '--timeout',
    '5m',
    '--set-string',
    `config.websocketUrl=${websocketUrl}`,
    '--set-string',
    `config.agentKey=${agentKey}`,
    '--set-string',
    `config.clusterId=${clusterId}`
  ]);
}

async function waitForClusterOnline(baseUrl, cookie, workspaceId, clusterId, label) {
  await runtime.waitFor(label, async () => {
    const response = await requestJson(baseUrl, 'GET', `/workspaces/${workspaceId}/kubernetes-clusters/${clusterId}`, undefined, cookie);
    if (response.body.status !== 'online') throw new Error(`cluster status=${response.body.status}`);
  });
}

async function verifyAgentBackedLogs(baseUrl, cookie, path, label) {
  await runtime.waitFor(label, async () => {
    await requestJson(baseUrl, 'GET', path, undefined, cookie);
  });
}

async function main() {
  if (!config.context) {
    throw new Error('ACORNOPS_K8S_HA_SMOKE_CONTEXT is required. Refuse to run this release smoke without an explicit non-production context.');
  }
  assertNonProductionHost(config.platformHost, 'ACORNOPS_K8S_HA_SMOKE_PLATFORM_HOST');
  assertNonProductionHost(config.consoleHost, 'ACORNOPS_K8S_HA_SMOKE_CONSOLE_HOST');

  await installPlatform();
  const port = await findFreePort();
  await runtime.startPortForward({
    localPort: port,
    namespace: config.namespace,
    serviceName: controlPlaneService(config)
  });
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const cookie = await signUpSmokeUser(baseUrl);
  const { agentKey, clusterId, workspaceId } = await registerWorkloadCluster(baseUrl, cookie);

  const agentInstallStartedAt = new Date();
  installWorkloadAgent(agentKey, clusterId);
  await waitForClusterOnline(baseUrl, cookie, workspaceId, clusterId, 'registered agent is online');

  const pod = ensureSmokeLogPod(config, runtime);
  const logsPath = `/workspaces/${workspaceId}/kubernetes-clusters/${clusterId}/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}/logs`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await verifyAgentBackedLogs(baseUrl, cookie, logsPath, `agent-backed pod logs before failover ${attempt + 1}`);
  }

  const ownerPod = findOwnerPod(config, runtime, agentInstallStartedAt);
  runtime.kubectl(['-n', config.namespace, 'delete', 'pod', ownerPod, '--wait=false']);
  runtime.kubectl(['-n', config.namespace, 'rollout', 'status', `deployment/${controlPlaneName(config)}`, '--timeout=5m']);

  await waitForClusterOnline(baseUrl, cookie, workspaceId, clusterId, 'agent reconnects after owner pod deletion');
  await verifyAgentBackedLogs(baseUrl, cookie, logsPath, 'agent-backed pod logs after failover');

  console.log('Kubernetes control-plane HA smoke passed.');
}

function cleanupResources() {
  runtime.cleanupGeneratedFiles();
  if (config.cleanup) {
    if (!config.explicitLogPodNamespace && !config.explicitLogPodName) {
      try {
        runtime.workloadKubectl(['delete', 'namespace', config.smokeLogPodNamespace, '--ignore-not-found=true'], { capture: true });
      } catch {
        // Best-effort cleanup only.
      }
    }
    try {
      runtime.workloadHelm(['uninstall', config.agentRelease, '--namespace', config.agentNamespace], { capture: true });
    } catch {
      // Best-effort cleanup only.
    }
    try {
      runtime.helm(['uninstall', config.release, '--namespace', config.namespace], { capture: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(cleanupResources);
