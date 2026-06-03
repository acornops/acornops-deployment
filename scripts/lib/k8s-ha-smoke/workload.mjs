import fs from 'node:fs';
import path from 'node:path';
import { controlPlaneService } from './platform.mjs';

export function controlPlaneInternalWsUrl(config) {
  return `ws://${controlPlaneService(config)}.${config.namespace}.svc.cluster.local:8081/api/v1/agent/connect`;
}

export function localAgentChart() {
  const candidate = path.resolve('../k8s-agent/charts/acornops-k8s-agent');
  return fs.existsSync(candidate)
    ? candidate
    : env('ACORNOPS_K8S_HA_SMOKE_AGENT_CHART', 'oci://ghcr.io/acornops/charts/acornops-k8s-agent');
}

export function ensureSmokeLogPod(config, runtime) {
  if (config.explicitLogPodNamespace && config.explicitLogPodName) {
    runtime.workloadKubectl(['-n', config.explicitLogPodNamespace, 'get', 'pod', config.explicitLogPodName], { capture: true });
    return {
      namespace: config.explicitLogPodNamespace,
      name: config.explicitLogPodName
    };
  }
  if (config.explicitLogPodNamespace || config.explicitLogPodName) {
    throw new Error('Set both ACORNOPS_K8S_HA_SMOKE_LOG_POD_NAMESPACE and ACORNOPS_K8S_HA_SMOKE_LOG_POD_NAME, or neither.');
  }

  if (!runtime.commandSucceeds('kubectl', ['--context', config.workloadContext, 'get', 'namespace', config.smokeLogPodNamespace])) {
    runtime.workloadKubectl(['create', 'namespace', config.smokeLogPodNamespace]);
  }
  const manifest = [
    'apiVersion: v1',
    'kind: Pod',
    'metadata:',
    `  name: ${config.smokeLogPodName}`,
    `  namespace: ${config.smokeLogPodNamespace}`,
    '  labels:',
    '    app.kubernetes.io/name: acornops-ha-smoke-log-target',
    'spec:',
    '  restartPolicy: Always',
    '  containers:',
    '    - name: log-target',
    '      image: busybox:1.36',
    '      command:',
    '        - sh',
    '        - -c',
    '        - while true; do echo acornops-ha-smoke-log-target; sleep 30; done'
  ].join('\n');
  const manifestFile = runtime.writeGeneratedFile('acornops-ha-smoke-log-target.yaml', `${manifest}\n`);
  runtime.workloadKubectl(['apply', '-f', manifestFile]);
  runtime.workloadKubectl([
    '-n',
    config.smokeLogPodNamespace,
    'wait',
    '--for=condition=Ready',
    `pod/${config.smokeLogPodName}`,
    '--timeout=3m'
  ]);
  return {
    namespace: config.smokeLogPodNamespace,
    name: config.smokeLogPodName
  };
}

function env(name, fallback) {
  return process.env[name] || fallback;
}
