import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  edgeUrl: 'http://127.0.0.1:8088',
  consoleHost: 'console.acornops.localhost',
  platformHost: 'acornops.localhost',
  controlPlaneHost: 'control-plane.acornops.localhost',
  executionEngineHost: 'execution-engine.acornops.localhost',
  llmGatewayHost: 'llm-gateway.acornops.localhost',
  timeoutMs: 120_000,
  intervalMs: 2_000
};

function env(name, fallback) {
  return process.env[name] || fallback;
}

function positiveIntegerEnv(name, fallback) {
  const value = Number(env(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const config = {
  edgeUrl: normalizeBaseUrl(env('ACORNOPS_SMOKE_EDGE_URL', DEFAULTS.edgeUrl)),
  consoleHost: env('ACORNOPS_SMOKE_CONSOLE_HOST', DEFAULTS.consoleHost),
  platformHost: env('ACORNOPS_SMOKE_PLATFORM_HOST', DEFAULTS.platformHost),
  controlPlaneHost: env('ACORNOPS_SMOKE_CONTROL_PLANE_HOST', DEFAULTS.controlPlaneHost),
  executionEngineHost: env('ACORNOPS_SMOKE_EXECUTION_ENGINE_HOST', DEFAULTS.executionEngineHost),
  llmGatewayHost: env('ACORNOPS_SMOKE_LLM_GATEWAY_HOST', DEFAULTS.llmGatewayHost),
  timeoutMs: Number(env('ACORNOPS_SMOKE_TIMEOUT_MS', String(DEFAULTS.timeoutMs))),
  intervalMs: Number(env('ACORNOPS_SMOKE_INTERVAL_MS', String(DEFAULTS.intervalMs))),
  allowNonLocal: env('ACORNOPS_SMOKE_ALLOW_NON_LOCAL', 'false') === 'true',
  runRemediation: env('ACORNOPS_SMOKE_RUN_REMEDIATION', 'true') === 'true',
  agentvOnly: env('ACORNOPS_SMOKE_AGENTV_ONLY', 'false') === 'true',
  remediationOnly: env('ACORNOPS_SMOKE_REMEDIATION_ONLY', 'false') === 'true',
  remediationRuns: positiveIntegerEnv('ACORNOPS_SMOKE_REMEDIATION_RUNS', 1),
  remediationMetricsPushUrl: env('ACORNOPS_SMOKE_REMEDIATION_METRICS_PUSH_URL', ''),
  kubeconfig: env('LOCAL_KUBECONFIG_PATH', '/tmp/acornops-local-kube/config')
};

class FatalSmokeError extends Error {}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function joinUrl(baseUrl, path) {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function isLocalUrl(value) {
  const url = new URL(value);
  return isLocalHost(url.hostname);
}

function isLocalHost(value) {
  const trimmed = value.trim();
  const bracketedIpv6 = /^\[(.*)\](?::\d+)?$/.exec(trimmed);
  const hostname = bracketedIpv6
    ? bracketedIpv6[1]
    : trimmed.includes(':') && trimmed.indexOf(':') === trimmed.lastIndexOf(':')
      ? trimmed.split(':')[0]
      : trimmed;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

function assertLocalOnly() {
  if (config.allowNonLocal) return;
  if (!isLocalUrl(config.edgeUrl)) {
    throw new Error('ACORNOPS_SMOKE_EDGE_URL must point at localhost for local smoke tests. Set ACORNOPS_SMOKE_ALLOW_NON_LOCAL=true to override deliberately.');
  }
  for (const [name, value] of Object.entries({
    ACORNOPS_SMOKE_CONSOLE_HOST: config.consoleHost,
    ACORNOPS_SMOKE_PLATFORM_HOST: config.platformHost,
    ACORNOPS_SMOKE_CONTROL_PLANE_HOST: config.controlPlaneHost,
    ACORNOPS_SMOKE_EXECUTION_ENGINE_HOST: config.executionEngineHost,
    ACORNOPS_SMOKE_LLM_GATEWAY_HOST: config.llmGatewayHost
  })) {
    if (!isLocalHost(value)) {
      throw new Error(`${name} must point at localhost for local smoke tests. Set ACORNOPS_SMOKE_ALLOW_NON_LOCAL=true to override deliberately.`);
    }
  }
}

function request(name, host, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = joinUrl(config.edgeUrl, path);
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const requestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: { ...options.headers, Host: host },
      timeout: 10_000
    };

    const req = client.request(requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const response = {
          status: res.statusCode || 0,
          headers: {
            get(headerName) {
              const value = res.headers[headerName.toLowerCase()];
              if (Array.isArray(value)) return value.join(', ');
              return value || null;
            }
          }
        };
        const expectedStatuses = options.expectedStatuses || [200];
        if (!expectedStatuses.includes(response.status)) {
          reject(new Error(`${name} returned HTTP ${response.status}; body: ${text.slice(0, 500)}`));
          return;
        }
        resolve({ response, text });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`${name} timed out after 10000ms`));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parseJson(name, text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${name} did not return valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function waitFor(name, check) {
  const deadline = Date.now() + config.timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      console.log(`ok ${name}`);
      return result;
    } catch (err) {
      if (err instanceof FatalSmokeError) throw err;
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
    }
  }
  throw new Error(`${name} did not pass within ${config.timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} response must be an object`);
  }
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} response must be an array`);
  }
  return value;
}

function requireListItems(value, name) {
  if (Array.isArray(value)) return value;
  const payload = requireObject(value, name);
  if (!Array.isArray(payload.items)) {
    throw new Error(`${name} response must be an array or an object with an items array`);
  }
  return payload.items;
}

function firstArrayField(value, fields, name) {
  const payload = requireObject(value, name);
  for (const field of fields) {
    if (Array.isArray(payload[field])) return payload[field];
  }
  throw new Error(`${name} response missing expected array field: ${fields.join(', ')}`);
}

function requireReadyStatus(payload, name) {
  if (payload.status && !['ok', 'ready'].includes(payload.status)) {
    throw new Error(`${name} status is ${payload.status}`);
  }
}

async function kubectl(...args) {
  if (!config.runRemediation) throw new Error('Local remediation smoke is disabled');
  const { stdout } = await execFileAsync('kubectl', ['--kubeconfig', config.kubeconfig, ...args], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024
  });
  return stdout;
}

function getSessionCookie(response) {
  const raw = response.headers.get('set-cookie');
  if (!raw) throw new Error('dev-login did not set a session cookie');
  return raw.split(';')[0];
}

function getNamedCookie(response, cookieName) {
  const raw = response.headers.get('set-cookie');
  if (!raw) throw new Error(`${cookieName} cookie was not set`);
  const cookies = raw.split(/,\s*(?=[^;,]+=)/);
  const cookie = cookies.find((item) => item.startsWith(`${cookieName}=`));
  if (!cookie) throw new Error(`${cookieName} cookie was not set`);
  return cookie.split(';')[0];
}

async function publishRemediationSmokeMetric(succeeded) {
  if (!config.remediationOnly || !config.remediationMetricsPushUrl) return;
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await fetch(config.remediationMetricsPushUrl, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
    body: [
      '# TYPE acornops_remediation_smoke_success gauge',
      `acornops_remediation_smoke_success ${succeeded ? 1 : 0}`,
      '# TYPE acornops_remediation_smoke_last_run_timestamp_seconds gauge',
      `acornops_remediation_smoke_last_run_timestamp_seconds ${timestamp}`,
      ''
    ].join('\n')
  });
  if (!response.ok) {
    throw new Error(`remediation smoke metric push failed with HTTP ${response.status}`);
  }
}

async function main() {
assertLocalOnly();

console.log('Running local AcornOps full-stack smoke...');
console.log(`edge: ${config.edgeUrl}`);
console.log(`console host: ${config.consoleHost}`);
console.log(`platform host: ${config.platformHost}`);

await waitFor('management console root', async () => {
  const { response, text } = await request('management console root', config.consoleHost, '/');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error(`expected HTML, got ${contentType}`);
  if (!text.includes('<div id="root"') && !text.includes('/src/')) {
    throw new Error('console HTML does not look like the management console app shell');
  }
});

await waitFor('management console deep link', async () => {
  const { text } = await request(
    'management console deep link',
    config.consoleHost,
    '/workspaces/smoke-workspace/kubernetes-clusters/smoke-cluster/resources'
  );
  if (!text.includes('<div id="root"') && !text.includes('/src/')) {
    throw new Error('console deep link did not return the app shell');
  }
});

await waitFor('control-plane readiness', async () => {
  const { text } = await request('control-plane readiness', config.controlPlaneHost, '/ready');
  const payload = requireObject(parseJson('control-plane readiness', text), 'control-plane readiness');
  requireReadyStatus(payload, 'control-plane readiness');
});

await waitFor('llm-gateway readiness', async () => {
  const { text } = await request('llm-gateway readiness', config.llmGatewayHost, '/ready');
  const payload = requireObject(parseJson('llm-gateway readiness', text), 'llm-gateway readiness');
  requireReadyStatus(payload, 'llm-gateway readiness');
});

await waitFor('execution-engine readiness', async () => {
  const { text } = await request('execution-engine readiness', config.executionEngineHost, '/ready');
  const payload = requireObject(parseJson('execution-engine readiness', text), 'execution-engine readiness');
  requireReadyStatus(payload, 'execution-engine readiness');
});

await waitFor('public API host JWKS route', async () => {
  const { text } = await request('public API host JWKS route', config.platformHost, '/api/v1/auth/jwks.json');
  const payload = requireObject(parseJson('public API host JWKS route', text), 'public API host JWKS route');
  if (!Array.isArray(payload.keys)) throw new Error('JWKS response missing keys array');
});

await waitFor('same-origin auth config', async () => {
  const { text } = await request('same-origin auth config', config.consoleHost, '/api/v1/auth/config');
  requireObject(parseJson('same-origin auth config', text), 'same-origin auth config');
});

const cookie = await waitFor('same-origin dev login', async () => {
  const { response, text } = await request('same-origin dev login', config.consoleHost, '/api/v1/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'dev@acornops.local', name: 'Dev User' })
  });
  const payload = requireObject(parseJson('same-origin dev login', text), 'same-origin dev login');
  if (!payload.user || typeof payload.user !== 'object') throw new Error('dev-login response missing user');
  return getSessionCookie(response);
});

await waitFor('same-origin auth methods', async () => {
  const { text } = await request('same-origin auth methods', config.consoleHost, '/api/v1/auth/methods', {
    headers: { cookie }
  });
  requireObject(parseJson('same-origin auth methods', text), 'same-origin auth methods');
});

const csrf = await waitFor('same-origin csrf token', async () => {
  const { response, text } = await request('same-origin csrf token', config.consoleHost, '/api/v1/auth/csrf', {
    headers: { cookie }
  });
  const payload = requireObject(parseJson('same-origin csrf token', text), 'same-origin csrf token');
  if (typeof payload.csrfToken !== 'string' || payload.csrfToken.length === 0) {
    throw new Error('CSRF response missing csrfToken');
  }
  return {
    cookie: `${cookie}; ${getNamedCookie(response, 'acornops_cp_csrf')}`,
    token: payload.csrfToken
  };
});

await waitFor('same-origin authenticated me', async () => {
  const { text } = await request('same-origin authenticated me', config.consoleHost, '/api/v1/me', {
    headers: { cookie }
  });
  const payload = requireObject(parseJson('same-origin authenticated me', text), 'same-origin authenticated me');
  if (!payload.id) throw new Error('/me response missing user id');
});

const workspace = await waitFor('workspace list', async () => {
  const { text } = await request('workspace list', config.consoleHost, '/api/v1/workspaces', {
    headers: { cookie }
  });
  const workspaces = requireListItems(parseJson('workspace list', text), 'workspace list');
  if (workspaces.length === 0) throw new Error('expected at least one workspace from development seed');
  return workspaces.find((item) => item.name === 'Demo Workspace') || workspaces[0];
});

await waitFor('workspace detail', async () => {
  const { text } = await request('workspace detail', config.consoleHost, `/api/v1/workspaces/${workspace.id}`, {
    headers: { cookie }
  });
  const payload = requireObject(parseJson('workspace detail', text), 'workspace detail');
  if (payload.id !== workspace.id) throw new Error('workspace detail id does not match listed workspace');
});

await waitFor('workspace roles', async () => {
  const { text } = await request('workspace roles', config.consoleHost, `/api/v1/workspaces/${workspace.id}/roles`, {
    headers: { cookie }
  });
  requireListItems(parseJson('workspace roles', text), 'workspace roles');
});

await waitFor('workspace AI settings', async () => {
  const { text } = await request('workspace AI settings', config.consoleHost, `/api/v1/workspaces/${workspace.id}/ai-settings`, {
    headers: { cookie }
  });
  requireObject(parseJson('workspace AI settings', text), 'workspace AI settings');
});

await waitFor('workspace members', async () => {
  const { text } = await request('workspace members', config.consoleHost, `/api/v1/workspaces/${workspace.id}/members?limit=50`, {
    headers: { cookie }
  });
  const members = requireListItems(parseJson('workspace members', text), 'workspace members');
  if (members.length === 0) throw new Error('workspace members are empty');
});

await waitFor('workspace invitations', async () => {
  const { text } = await request('workspace invitations', config.consoleHost, `/api/v1/workspaces/${workspace.id}/invitations?limit=50`, {
    headers: { cookie }
  });
  requireListItems(parseJson('workspace invitations', text), 'workspace invitations');
});

await waitFor('workspace audit log', async () => {
  const { text } = await request('workspace audit log', config.consoleHost, `/api/v1/workspaces/${workspace.id}/audit-log?limit=25`, {
    headers: { cookie }
  });
  requireListItems(parseJson('workspace audit log', text), 'workspace audit log');
});

const workspaceIssues = await waitFor('workspace issues', async () => {
  const { text } = await request('workspace issues', config.consoleHost, `/api/v1/workspaces/${workspace.id}/issues?limit=25`, {
    headers: { cookie }
  });
  return requireListItems(parseJson('workspace issues', text), 'workspace issues');
});

if (workspaceIssues.length > 0) {
  const issue = workspaceIssues[0];
  await waitFor('workspace issue detail', async () => {
    const { text } = await request(
      'workspace issue detail',
      config.consoleHost,
      `/api/v1/workspaces/${workspace.id}/issues/${encodeURIComponent(issue.id)}`,
      { headers: { cookie } }
    );
    const payload = requireObject(parseJson('workspace issue detail', text), 'workspace issue detail');
    if (payload.id !== issue.id) throw new Error('workspace issue detail id does not match listed issue');
  });

  await waitFor('workspace issue observations', async () => {
    const { text } = await request(
      'workspace issue observations',
      config.consoleHost,
      `/api/v1/workspaces/${workspace.id}/issues/${encodeURIComponent(issue.id)}/observations?limit=10`,
      { headers: { cookie } }
    );
    requireListItems(parseJson('workspace issue observations', text), 'workspace issue observations');
  });
}

if (!config.agentvOnly) {
const cluster = await waitFor('cluster list', async () => {
  const { text } = await request('cluster list', config.consoleHost, `/api/v1/workspaces/${workspace.id}/kubernetes-clusters`, {
    headers: { cookie }
  });
  const clusters = requireListItems(parseJson('cluster list', text), 'cluster list');
  if (clusters.length === 0) throw new Error('expected at least one cluster from development seed');
  return clusters.find((item) => item.name === 'Demo Cluster') || clusters[0];
});

await waitFor('cluster detail', async () => {
  const { text } = await request(
    'cluster detail',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/kubernetes-clusters/${cluster.id}`,
    { headers: { cookie } }
  );
  const payload = requireObject(parseJson('cluster detail', text), 'cluster detail');
  if (payload.id !== cluster.id) throw new Error('cluster detail id does not match listed cluster');
});

await waitFor('target list', async () => {
  const { text } = await request(
    'target list',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets?limit=50`,
    { headers: { cookie } }
  );
  const targets = requireListItems(parseJson('target list', text), 'target list');
  if (targets.length === 0) throw new Error('target list is empty');
});

await waitFor('cluster target detail', async () => {
  const { text } = await request(
    'cluster target detail',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${cluster.id}`,
    { headers: { cookie } }
  );
  const payload = requireObject(parseJson('cluster target detail', text), 'cluster target detail');
  if (payload.id !== cluster.id && payload.targetId !== cluster.id) throw new Error('cluster target detail id does not match listed cluster');
});

await waitFor('cluster resources', async () => {
  const { text } = await request(
    'cluster resources',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/kubernetes-clusters/${cluster.id}/resources`,
    { headers: { cookie } }
  );
  const resources = requireListItems(parseJson('cluster resources', text), 'cluster resources');
  if (resources.length === 0) throw new Error('cluster resources are empty');
});

await waitFor('cluster metrics', async () => {
  const { text } = await request(
    'cluster metrics',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/kubernetes-clusters/${cluster.id}/metrics/history?window=6h&limit=24`,
    { headers: { cookie } }
  );
  firstArrayField(parseJson('cluster metrics', text), ['points', 'items'], 'cluster metrics');
});

await waitFor('workspace cluster metrics', async () => {
  const { text } = await request(
    'workspace cluster metrics',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/kubernetes-clusters/metrics/history?clusterIds=${encodeURIComponent(cluster.id)}&window=6h&limit=24`,
    { headers: { cookie } }
  );
  const payload = requireObject(parseJson('workspace cluster metrics', text), 'workspace cluster metrics');
  if (!Array.isArray(payload.items)) throw new Error('workspace cluster metrics response missing items array');
});

await waitFor('cluster sessions', async () => {
  const { text } = await request(
    'cluster sessions',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/kubernetes-clusters/${cluster.id}/sessions?limit=10`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('cluster sessions', text), 'cluster sessions');
});

await waitFor('cluster MCP catalog', async () => {
  const { text } = await request(
    'cluster MCP catalog',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${cluster.id}/mcp/catalog?limit=50`,
    { headers: { cookie } }
  );
  const catalog = requireObject(parseJson('cluster MCP catalog', text), 'cluster MCP catalog');
  const servers = requireArray(catalog.servers, 'cluster MCP catalog servers');
  const builtIn = servers.find((server) => server?.type === 'builtin');
  if (!builtIn) throw new Error('cluster MCP catalog is missing the built-in agent server');
  if (builtIn.connectionStatus !== 'ok') throw new Error(`built-in agent server is ${builtIn.connectionStatus || 'unknown'}`);
  const getResource = requireArray(builtIn.tools, 'built-in agent tools').find((tool) => tool?.name === 'get_resource');
  if (!getResource?.enabledEffective) throw new Error('get_resource is not effectively available');
});

await waitFor('cluster target tools', async () => {
  const { text } = await request(
    'cluster target tools',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${cluster.id}/tools`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('cluster target tools', text), 'cluster target tools');
});

await waitFor('cluster assistant capabilities preview', async () => {
  const { text } = await request(
    'cluster assistant capabilities preview',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${cluster.id}/assistant/capabilities-preview?toolAccessMode=read_only`,
    { headers: { cookie } }
  );
  requireObject(parseJson('cluster assistant capabilities preview', text), 'cluster assistant capabilities preview');
});

if (config.runRemediation) {
  const demoNamespace = 'acornops-demo';
  const demoDeployment = 'acornops-demo-unhealthy';
  const brokenImage = 'nginx:1.27.4-alpnie';
  const repairedImage = 'nginx:1.27.4-alpine';

  for (let remediationIndex = 1; remediationIndex <= config.remediationRuns; remediationIndex += 1) {
    await kubectl('-n', demoNamespace, 'set', 'image', `deployment/${demoDeployment}`, `nginx=${brokenImage}`);
    const failingPodName = await waitFor('repairable demo workload starts in ImagePullBackOff', async () => {
      const pods = parseJson(
        'repairable demo pods',
        await kubectl('-n', demoNamespace, 'get', 'pods', '-l', `app.kubernetes.io/name=${demoDeployment}`, '-o', 'json')
      );
      const items = requireListItems(pods, 'repairable demo pods');
      const failingPod = items.find((pod) =>
        (pod.status?.containerStatuses || []).some((status) =>
          ['ErrImagePull', 'ImagePullBackOff'].includes(status.state?.waiting?.reason)
        )
      );
      if (!failingPod?.metadata?.name) throw new Error('demo workload has not reached an image pull failure');
      return failingPod.metadata.name;
    });

    const remediationSession = await waitFor('Kubernetes remediation session', async () => {
      const { text } = await request(
        'Kubernetes remediation session',
        config.consoleHost,
        `/api/v1/workspaces/${workspace.id}/targets/${cluster.id}/sessions`,
        {
          method: 'POST',
          headers: { cookie: csrf.cookie, 'content-type': 'application/json', 'x-csrf-token': csrf.token },
          expectedStatuses: [201],
          body: JSON.stringify({ title: `Repair demo ImagePullBackOff ${remediationIndex}` })
        }
      );
      const payload = requireObject(parseJson('Kubernetes remediation session', text), 'Kubernetes remediation session');
      if (!payload.id) throw new Error('Kubernetes remediation session response missing id');
      return payload;
    });

    const remediationRun = await waitFor('Kubernetes remediation run dispatch', async () => {
      const { text } = await request(
        'Kubernetes remediation message',
        config.consoleHost,
        `/api/v1/sessions/${remediationSession.id}/messages`,
        {
          method: 'POST',
          headers: { cookie: csrf.cookie, 'content-type': 'application/json', 'x-csrf-token': csrf.token },
          expectedStatuses: [202],
          body: JSON.stringify({
            content: `Pod ${failingPodName} in namespace ${demoNamespace} is in ImagePullBackOff. Start by inspecting that exact Pod with get_resource, diagnose and repair it using the available Kubernetes tools, then verify the repair. Use only the returned remediationTarget; do not infer an owner name from the Pod name.`,
            toolAccessMode: 'read_write',
            clientMessageId: `local-smoke-repair-image-pull-${remediationIndex}`
          })
        }
      );
      const payload = requireObject(parseJson('Kubernetes remediation message', text), 'Kubernetes remediation message');
      if (!payload.run_id) throw new Error('Kubernetes remediation message response missing run_id');
      return payload;
    });

    const approval = await waitFor('Kubernetes remediation patch approval', async () => {
      const { text } = await request(
        'Kubernetes remediation approvals',
        config.consoleHost,
        `/api/v1/runs/${remediationRun.run_id}/approvals`,
        { headers: { cookie } }
      );
      const approvals = requireListItems(parseJson('Kubernetes remediation approvals', text), 'Kubernetes remediation approvals');
      const pending = approvals.find((item) => item.status === 'pending' && item.toolName === 'patch_resource');
      if (!pending) {
        const { text: runText } = await request(
          'Kubernetes remediation run while awaiting approval',
          config.consoleHost,
          `/api/v1/runs/${remediationRun.run_id}`,
          { headers: { cookie } }
        );
        const run = requireObject(
          parseJson('Kubernetes remediation run while awaiting approval', runText),
          'Kubernetes remediation run while awaiting approval'
        );
        if (['completed', 'failed', 'cancelled'].includes(run.status)) {
          throw new FatalSmokeError(
            `remediation run reached ${run.status} before patch approval${run.errorCode ? ` (${run.errorCode}: ${run.errorMessage || 'no message'})` : ''}`
          );
        }
        throw new Error('pending patch_resource approval not created yet');
      }
      if (pending.arguments?.name !== demoDeployment || pending.arguments?.namespace !== demoNamespace) {
        throw new Error('patch_resource approval targeted the wrong Kubernetes resource');
      }
      if (typeof pending.arguments?.expected_uid !== 'string' || pending.arguments.expected_uid.length === 0) {
        throw new Error('patch_resource approval is missing the UID obtained by the guarded resource read');
      }
      const imageChange = pending.arguments?.changes?.find((change) => change.type === 'set_image');
      if (imageChange?.container !== 'nginx' || imageChange?.expected_image !== brokenImage || imageChange?.image !== repairedImage) {
        throw new Error('patch_resource approval does not contain the expected guarded image change');
      }
      return pending;
    });

    const fullResultArtifact = await waitFor('Kubernetes remediation compact events and artifact metadata', async () => {
      const { text } = await request(
        'Kubernetes remediation run events', config.consoleHost,
        `/api/v1/runs/${remediationRun.run_id}/events`, { headers: { cookie } }
      );
      const events = requireListItems(parseJson('Kubernetes remediation run events', text), 'Kubernetes remediation run events');
      const serialized = JSON.stringify(events);
      if (serialized.includes('full_result') || serialized.includes('structuredContent')) {
        throw new Error('full tool result leaked into the run-event stream');
      }
      const firstResourceRead = events.find((event) =>
        event.type === 'tool_call_started' && event.payload?.tool === 'get_resource'
      );
      if (
        firstResourceRead?.payload?.arguments?.kind !== 'Pod'
        || firstResourceRead.payload.arguments.name !== failingPodName
        || firstResourceRead.payload.arguments.namespace !== demoNamespace
      ) {
        throw new Error('remediation did not start from the exact failing Pod');
      }
      const completedRead = events.find((event) =>
        event.type === 'tool_call_completed'
        && event.payload?.tool === 'get_resource'
        && event.payload?.result?.data?.resource?.kind === 'Pod'
        && event.payload.result.data.resource.name === failingPodName
        && event.payload?.artifact?.id
      );
      if (!completedRead) throw new Error('failing Pod get_resource evidence and artifact metadata are not available yet');
      if (completedRead.payload?.context_meta?.strategy !== 'producer_projection') {
        throw new Error(`get_resource used ${completedRead.payload?.context_meta?.strategy || 'no'} projection strategy`);
      }
      const remediationTarget = completedRead.payload?.result?.data?.remediationTarget;
      if (
        remediationTarget?.kind !== 'Deployment'
        || remediationTarget.name !== demoDeployment
        || remediationTarget.namespace !== demoNamespace
        || typeof remediationTarget.uid !== 'string'
        || remediationTarget.uid.length === 0
      ) {
        throw new Error('failing Pod evidence did not resolve the exact Deployment remediation target');
      }
      if (approval.arguments?.expected_uid !== remediationTarget.uid) {
        throw new Error('patch_resource UID did not come from the Pod remediation target');
      }
      return completedRead.payload.artifact;
    });

    const artifactDownload = await request(
      'Kubernetes remediation full redacted result', config.consoleHost,
      `/api/v1/runs/${remediationRun.run_id}/tool-result-artifacts/${fullResultArtifact.id}`,
      { headers: { cookie } }
    );
    parseJson('Kubernetes remediation full redacted result', artifactDownload.text);
    if (artifactDownload.response.headers.get('cache-control') !== 'no-store') {
      throw new Error('full redacted result response is missing Cache-Control: no-store');
    }

    await request(
      'approve Kubernetes remediation patch',
      config.consoleHost,
      `/api/v1/runs/${remediationRun.run_id}/approvals/${approval.id}/decision`,
      {
        method: 'POST',
        headers: { cookie: csrf.cookie, 'content-type': 'application/json', 'x-csrf-token': csrf.token },
        body: JSON.stringify({ decision: 'approved' })
      }
    );

    await waitFor('Kubernetes remediation run completed', async () => {
      const { text } = await request(
        'Kubernetes remediation run',
        config.consoleHost,
        `/api/v1/runs/${remediationRun.run_id}`,
        { headers: { cookie } }
      );
      const payload = requireObject(parseJson('Kubernetes remediation run', text), 'Kubernetes remediation run');
      if (payload.status !== 'completed') throw new Error(`Kubernetes remediation run is ${payload.status}`);
      if (payload.toolAccessMode !== 'read_write') throw new Error(`Kubernetes remediation run toolAccessMode is ${payload.toolAccessMode}`);
    });

    await waitFor('Kubernetes remediation patch execution succeeded', async () => {
      const { text } = await request(
        'Kubernetes remediation approvals after execution',
        config.consoleHost,
        `/api/v1/runs/${remediationRun.run_id}/approvals`,
        { headers: { cookie } }
      );
      const approvals = requireListItems(
        parseJson('Kubernetes remediation approvals after execution', text),
        'Kubernetes remediation approvals after execution'
      );
      const executed = approvals.find((item) => item.id === approval.id);
      if (executed?.status !== 'approved' || executed?.executionStatus !== 'succeeded' || executed?.toolResultIsError) {
        throw new Error(`patch_resource execution is ${executed?.executionStatus || 'missing'}`);
      }
    });

    await waitFor('Kubernetes remediation was verified through a fresh resource read', async () => {
      const { text } = await request(
        'Kubernetes remediation verification events', config.consoleHost,
        `/api/v1/runs/${remediationRun.run_id}/events`, { headers: { cookie } }
      );
      const events = requireListItems(
        parseJson('Kubernetes remediation verification events', text),
        'Kubernetes remediation verification events'
      );
      const patchCompleted = events.find((event) =>
        event.type === 'tool_call_completed'
        && event.payload?.tool === 'patch_resource'
        && event.payload?.is_error === false
      );
      if (!patchCompleted) throw new Error('successful patch_resource completion event is missing');
      const verificationRead = events.find((event) => {
        if (
          event.type !== 'tool_call_completed'
          || event.payload?.tool !== 'get_resource'
          || event.payload?.is_error
          || Number(event.seq) <= Number(patchCompleted.seq)
        ) return false;
        const result = event.payload?.result?.data;
        const target = result?.remediationTarget || result?.resource;
        if (
          target?.kind !== 'Deployment'
          || target.name !== demoDeployment
          || target.namespace !== demoNamespace
          || target.uid !== approval.arguments.expected_uid
        ) return false;
        const containers = result?.remediationTarget?.containers || result?.configuration?.containers || [];
        return containers.some((container) => container?.name === 'nginx' && container?.image === repairedImage);
      });
      if (!verificationRead) {
        throw new Error('no post-patch get_resource evidence confirmed the exact repaired Deployment image');
      }
    });

    await waitFor('Kubernetes remediation rollout healthy', async () => {
      const deployment = requireObject(
        parseJson(
          'repaired demo deployment',
          await kubectl('-n', demoNamespace, 'get', 'deployment', demoDeployment, '-o', 'json')
        ),
        'repaired demo deployment'
      );
      const image = deployment.spec?.template?.spec?.containers?.find((container) => container.name === 'nginx')?.image;
      if (image !== repairedImage) throw new Error(`demo workload image is ${image}`);
      if (deployment.status?.availableReplicas !== deployment.spec?.replicas) {
        throw new Error('repaired demo Deployment is not fully available');
      }
    });
    console.log(`Local Kubernetes remediation smoke run ${remediationIndex}/${config.remediationRuns} passed.`);
  }

  if (config.remediationOnly) {
    console.log('Local Kubernetes remediation smoke passed.');
    return;
  }
}

await waitFor('cluster target skills', async () => {
  const { text } = await request(
    'cluster target skills',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${cluster.id}/skills?limit=25`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('cluster target skills', text), 'cluster target skills');
});

await waitFor('cluster knowledge bank entries', async () => {
  const { text } = await request(
    'cluster knowledge bank entries',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${cluster.id}/knowledge-bank?limit=25`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('cluster knowledge bank entries', text), 'cluster knowledge bank entries');
});

await waitFor('cluster knowledge bank activity', async () => {
  const { text } = await request(
    'cluster knowledge bank activity',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${cluster.id}/knowledge-bank/activity`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('cluster knowledge bank activity', text), 'cluster knowledge bank activity');
});

await waitFor('cluster knowledge bank export', async () => {
  const { text } = await request(
    'cluster knowledge bank export',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${cluster.id}/knowledge-bank/export`,
    { headers: { cookie } }
  );
  if (typeof text !== 'string') throw new Error('knowledge bank export did not return text');
});

await waitFor('workspace agents', async () => {
  const { text } = await request(
    'workspace agents',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/agents`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('workspace agents', text), 'workspace agents');
});

const agents = await waitFor('workspace agents including inactive', async () => {
  const { text } = await request(
    'workspace agents including inactive',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/agents?includeInactive=true`,
    { headers: { cookie } }
  );
  const items = requireListItems(parseJson('workspace agents including inactive', text), 'workspace agents including inactive');
  if (items.length === 0) throw new Error('workspace agents including inactive is empty');
  return items;
});

const agent = agents[0];
await waitFor('agent detail', async () => {
  const { text } = await request(
    'agent detail',
    config.consoleHost,
    `/api/v1/agents/${encodeURIComponent(agent.id)}?workspaceId=${encodeURIComponent(workspace.id)}`,
    { headers: { cookie } }
  );
  const payload = requireObject(parseJson('agent detail', text), 'agent detail');
  if (!payload.agent || payload.agent.id !== agent.id) throw new Error('agent detail id does not match listed agent');
});

await waitFor('agent versions', async () => {
  const { text } = await request(
    'agent versions',
    config.consoleHost,
    `/api/v1/agents/${encodeURIComponent(agent.id)}/versions?workspaceId=${encodeURIComponent(workspace.id)}`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('agent versions', text), 'agent versions');
});

await waitFor('agent activity', async () => {
  const { text } = await request(
    'agent activity',
    config.consoleHost,
    `/api/v1/agents/${encodeURIComponent(agent.id)}/activity?workspaceId=${encodeURIComponent(workspace.id)}`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('agent activity', text), 'agent activity');
});

const workflow = await waitFor('workspace workflows', async () => {
  const { text } = await request(
    'workspace workflows',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/workflows`,
    { headers: { cookie } }
  );
  const workflows = requireListItems(parseJson('workspace workflows', text), 'workspace workflows');
  if (workflows.length === 0) throw new Error('expected at least one workflow from development seed');
  return workflows[0];
});

await waitFor('workspace workflow options', async () => {
  const { text } = await request(
    'workspace workflow options',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/workflow-options`,
    { headers: { cookie } }
  );
  const payload = requireObject(parseJson('workspace workflow options', text), 'workspace workflow options');
  for (const field of ['agents', 'mcpServers', 'mcpTools', 'skills', 'approvalPolicies', 'runtimeLimits', 'retentionPolicies']) {
    if (!Array.isArray(payload[field])) throw new Error(`workflow options response missing ${field} array`);
  }
});

await waitFor('workspace workflow schedules', async () => {
  const { text } = await request(
    'workspace workflow schedules',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/workflow-schedules`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('workspace workflow schedules', text), 'workspace workflow schedules');
});

await waitFor('workspace approvals', async () => {
  const { text } = await request(
    'workspace approvals',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/approvals?status=pending&limit=25`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('workspace approvals', text), 'workspace approvals');
});

await waitFor('workflow detail', async () => {
  const { text } = await request(
    'workflow detail',
    config.consoleHost,
    `/api/v1/workflows/${workflow.id}?workspaceId=${encodeURIComponent(workspace.id)}`,
    { headers: { cookie } }
  );
  const payload = requireObject(parseJson('workflow detail', text), 'workflow detail');
  if (!payload.workflow || payload.workflow.id !== workflow.id) throw new Error('workflow detail id does not match listed workflow');
});

await waitFor('workflow sessions', async () => {
  const { text } = await request(
    'workflow sessions',
    config.consoleHost,
    `/api/v1/workflows/${workflow.id}/sessions?workspaceId=${encodeURIComponent(workspace.id)}`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('workflow sessions', text), 'workflow sessions');
});

await waitFor('workspace workflow MCP servers', async () => {
  const { text } = await request(
    'workspace workflow MCP servers',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/mcp/servers`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('workspace workflow MCP servers', text), 'workspace workflow MCP servers');
});

const workflowMcpServers = await waitFor('workspace workflow MCP servers with tools', async () => {
  const { text } = await request(
    'workspace workflow MCP servers with tools',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/mcp/servers`,
    { headers: { cookie } }
  );
  return requireListItems(parseJson('workspace workflow MCP servers with tools', text), 'workspace workflow MCP servers with tools');
});

if (workflowMcpServers.length > 0) {
  await waitFor('workspace workflow MCP server tools', async () => {
    const { text } = await request(
      'workspace workflow MCP server tools',
      config.consoleHost,
      `/api/v1/workspaces/${workspace.id}/mcp/servers/${encodeURIComponent(workflowMcpServers[0].id)}/tools`,
      { headers: { cookie } }
    );
    requireListItems(parseJson('workspace workflow MCP server tools', text), 'workspace workflow MCP server tools');
  });
}
}

const vm = await waitFor('virtual machine list', async () => {
  const { text } = await request(
    'virtual machine list',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/virtual-machines`,
    { headers: { cookie } }
  );
  const virtualMachines = requireListItems(parseJson('virtual machine list', text), 'virtual machine list');
  if (virtualMachines.length === 0) throw new Error('expected at least one VM from development seed');
  return virtualMachines.find((item) => item.name === 'Development Linux VM') || virtualMachines[0];
});

await waitFor('virtual machine detail online', async () => {
  const { text } = await request(
    'virtual machine detail',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/virtual-machines/${vm.id}`,
    { headers: { cookie } }
  );
  const payload = requireObject(parseJson('virtual machine detail', text), 'virtual machine detail');
  if (payload.id !== vm.id) throw new Error('VM detail id does not match listed VM');
  if (payload.status !== 'online') throw new Error(`VM is ${payload.status}; expected online`);
});

await waitFor('virtual machine target detail', async () => {
  const { text } = await request(
    'virtual machine target detail',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${vm.id}`,
    { headers: { cookie } }
  );
  const payload = requireObject(parseJson('virtual machine target detail', text), 'virtual machine target detail');
  if (payload.id !== vm.id && payload.targetId !== vm.id) throw new Error('VM target detail id does not match listed VM');
});

await waitFor('virtual machine resources', async () => {
  const { text } = await request(
    'virtual machine resources',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/virtual-machines/${vm.id}/resources`,
    { headers: { cookie } }
  );
  const resources = requireListItems(parseJson('virtual machine resources', text), 'virtual machine resources');
  if (resources.length === 0) throw new Error('VM resources are empty');
});

await waitFor('virtual machine issues', async () => {
  const { text } = await request(
    'virtual machine issues',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${vm.id}/issues?limit=20`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('virtual machine issues', text), 'virtual machine issues');
});

await waitFor('virtual machine issue summary', async () => {
  const { text } = await request(
    'virtual machine issue summary',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${vm.id}/issues/summary`,
    { headers: { cookie } }
  );
  const summary = requireObject(parseJson('virtual machine issue summary', text), 'virtual machine issue summary');
  for (const field of ['total', 'active', 'recovering', 'critical', 'warning', 'info']) {
    if (!Number.isInteger(summary[field])) throw new Error(`VM issue summary missing integer ${field}`);
  }
});

await waitFor('virtual machine metrics', async () => {
  const { text } = await request(
    'virtual machine metrics',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/virtual-machines/${vm.id}/metrics/history`,
    { headers: { cookie } }
  );
  const metrics = firstArrayField(parseJson('virtual machine metrics', text), ['points', 'items'], 'virtual machine metrics');
  if (metrics.length === 0) throw new Error('VM metrics are empty');
});

await waitFor('virtual machine logs', async () => {
  const { text } = await request(
    'virtual machine logs',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/virtual-machines/${vm.id}/logs?source=journald&limit=20`,
    { headers: { cookie } }
  );
  const logs = firstArrayField(parseJson('virtual machine logs', text), ['entries', 'items'], 'virtual machine logs');
  if (logs.length === 0) throw new Error('VM logs are empty');
});

await waitFor('virtual machine MCP servers', async () => {
  const { text } = await request(
    'virtual machine MCP servers',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${vm.id}/mcp/servers`,
    { headers: { cookie } }
  );
  const servers = requireListItems(parseJson('virtual machine MCP servers', text), 'virtual machine MCP servers');
  if (servers.length === 0) throw new Error('expected VM MCP server registrations');
});

const vmMcpServers = await waitFor('virtual machine MCP servers with tools', async () => {
  const { text } = await request(
    'virtual machine MCP servers with tools',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${vm.id}/mcp/servers`,
    { headers: { cookie } }
  );
  return requireListItems(parseJson('virtual machine MCP servers with tools', text), 'virtual machine MCP servers with tools');
});

if (vmMcpServers.length > 0) {
  await waitFor('virtual machine MCP server tools', async () => {
    const { text } = await request(
      'virtual machine MCP server tools',
      config.consoleHost,
      `/api/v1/workspaces/${workspace.id}/targets/${vm.id}/mcp/servers/${encodeURIComponent(vmMcpServers[0].id)}/tools?limit=25`,
      { headers: { cookie } }
    );
    requireListItems(parseJson('virtual machine MCP server tools', text), 'virtual machine MCP server tools');
  });
}

await waitFor('virtual machine chat activity', async () => {
  const { text } = await request(
    'virtual machine chat activity',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${vm.id}/chat-activity?windowSeconds=300`,
    { headers: { cookie } }
  );
  const payload = requireObject(parseJson('virtual machine chat activity', text), 'virtual machine chat activity');
  if (!Array.isArray(payload.recentActivity)) throw new Error('VM chat activity response missing recentActivity array');
});

const vmSession = await waitFor('virtual machine troubleshooting session', async () => {
  const { text } = await request(
    'virtual machine troubleshooting session',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${vm.id}/sessions`,
    {
      method: 'POST',
      headers: { cookie: csrf.cookie, 'content-type': 'application/json', 'x-csrf-token': csrf.token },
      expectedStatuses: [201],
      body: JSON.stringify({ title: 'VM smoke troubleshooting' })
    }
  );
  const payload = requireObject(parseJson('virtual machine troubleshooting session', text), 'virtual machine troubleshooting session');
  if (!payload.id) throw new Error('VM session response missing id');
  return payload;
});

await waitFor('virtual machine session list', async () => {
  const { text } = await request(
    'virtual machine session list',
    config.consoleHost,
    `/api/v1/workspaces/${workspace.id}/targets/${vm.id}/sessions?limit=10`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('virtual machine session list', text), 'virtual machine session list');
});

const vmRun = await waitFor('virtual machine troubleshooting run dispatch', async () => {
  const { text } = await request(
    'virtual machine troubleshooting message',
    config.consoleHost,
    `/api/v1/sessions/${vmSession.id}/messages`,
    {
      method: 'POST',
      headers: { cookie: csrf.cookie, 'content-type': 'application/json', 'x-csrf-token': csrf.token },
      expectedStatuses: [202],
      body: JSON.stringify({
        content: 'Use read-only VM tools to summarize host health.',
        toolAccessMode: 'read_only',
        clientMessageId: 'local-smoke-vm-health'
      })
    }
  );
  const payload = requireObject(parseJson('virtual machine troubleshooting message', text), 'virtual machine troubleshooting message');
  if (!payload.run_id) throw new Error('VM troubleshooting message response missing run_id');
  return payload;
});

await waitFor('virtual machine session messages', async () => {
  const { text } = await request(
    'virtual machine session messages',
    config.consoleHost,
    `/api/v1/sessions/${vmSession.id}/messages?limit=25`,
    { headers: { cookie } }
  );
  requireListItems(parseJson('virtual machine session messages', text), 'virtual machine session messages');
});

await waitFor('virtual machine troubleshooting run completed with tool call', async () => {
  const { text } = await request('virtual machine troubleshooting run', config.consoleHost, `/api/v1/runs/${vmRun.run_id}`, {
    headers: { cookie }
  });
  const payload = requireObject(parseJson('virtual machine troubleshooting run', text), 'virtual machine troubleshooting run');
  if (payload.targetType !== 'virtual_machine') throw new Error(`VM run targetType is ${payload.targetType}`);
  if (payload.toolAccessMode !== 'read_only') throw new Error(`VM run toolAccessMode is ${payload.toolAccessMode}`);
  if (payload.status !== 'completed') {
    throw new Error(`VM run is ${payload.status}; expected completed`);
  }
  const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage : {};
  if (Number(usage.tool_calls || 0) < 1) {
    throw new Error('VM run completed without a recorded tool call');
  }
});

await waitFor('virtual machine troubleshooting run events', async () => {
  const { text } = await request('virtual machine troubleshooting run events', config.consoleHost, `/api/v1/runs/${vmRun.run_id}/events`, {
    headers: { cookie }
  });
  requireListItems(parseJson('virtual machine troubleshooting run events', text), 'virtual machine troubleshooting run events');
});

await waitFor('virtual machine troubleshooting run approvals', async () => {
  const { text } = await request('virtual machine troubleshooting run approvals', config.consoleHost, `/api/v1/runs/${vmRun.run_id}/approvals`, {
    headers: { cookie }
  });
  requireListItems(parseJson('virtual machine troubleshooting run approvals', text), 'virtual machine troubleshooting run approvals');
});

console.log('Local AcornOps full-stack smoke passed.');
}

try {
  await main();
  await publishRemediationSmokeMetric(true);
} catch (error) {
  try {
    await publishRemediationSmokeMetric(false);
  } catch (publishError) {
    console.error(publishError instanceof Error ? publishError.message : String(publishError));
  }
  throw error;
}
