import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ownershipLabel, validateCluster } from './config.mjs';

export async function waitFor(label, action, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let failure;
  while (Date.now() < deadline) {
    try { const result = await action(); if (result) return result; }
    catch (error) { failure = error; }
    await delay(300);
  }
  throw new Error(`${label} timed out${failure ? `: ${failure.message}` : ''}`);
}

function run(command, args, { input, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed (${code}): ${stderr.slice(-4000)}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function createRuntime(config, reportDirectory) {
  mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });
  const children = [];
  const observations = [];
  const podLogs = new Map();
  const redactions = new Set();
  let context, platform, fixtureUrl;
  const args = () => ['--kubeconfig', config.kubeconfig, ...(context ? ['--context', context] : [])];
  const kubectl = (argv, options) => run('kubectl', [...args(), ...argv], options);
  const scoped = (argv, options) => kubectl(['-n', platform.namespace, ...argv], options);
  const save = (name, value) => {
    let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    for (const secret of redactions) if (secret?.length >= 8) text = text.replaceAll(secret, '[redacted]');
    writeFileSync(join(reportDirectory, name), text, { mode: 0o600 });
  };
  const get = async (kind, selector) => JSON.parse(await scoped(['get', kind, ...(selector ? ['-l', selector] : []), '-o', 'json']));
  const pods = async (component) => (await get('pods', `app.kubernetes.io/component=${component}`)).items;
  const apply = (items) => scoped(['apply', '-f', '-'], { input: JSON.stringify({ apiVersion: 'v1', kind: 'List', items }) });

  async function preflight() {
    context = validateCluster(config, JSON.parse(await kubectl(['config', 'view', '--minify', '-o', 'json'])));
    const nodes = JSON.parse(await kubectl(['get', 'nodes', '-o', 'json']));
    for (const node of nodes.items) {
      const conditions = new Map(node.status.conditions.map((item) => [item.type, item.status]));
      if (conditions.get('Ready') !== 'True' || conditions.get('DiskPressure') !== 'False'
        || conditions.get('MemoryPressure') !== 'False') throw new Error(`Node ${node.metadata.name} is not ready without resource pressure`);
    }
    if (!nodes.items.length) throw new Error('No nodes in isolated cluster');
    save('preflight.json', { context, nodes: nodes.items.map((node) => ({ name: node.metadata.name,
      conditions: node.status.conditions, allocatable: node.status.allocatable })) });
    console.log(`ok preflight ${context}`);
  }

  async function verifyImages() {
    const evidence = [];
    for (const [name, image, command, paths] of [
      ['control-plane', config.cpImage, ['node', 'dist/server.js'], ['src', 'migrations', 'package.json', 'package-lock.json']],
      ['execution-engine', config.eeImage, ['python', '-m', 'execution_engine.serve'], ['execution_engine', 'requirements.lock']],
      ['llm-gateway', config.gwImage, ['python', '-m', 'app.serve'], ['app', 'requirements.lock']],
    ]) {
      const [metadata] = JSON.parse(await run('docker', ['image', 'inspect', image]));
      const revision = (await run('git', ['-C', `../${name}`, 'rev-parse', 'HEAD'])).trim();
      const dirty = (await run('git', ['-C', `../${name}`, 'status', '--porcelain', '--', ...paths])).trim();
      if (JSON.stringify(metadata.Config.Cmd) !== JSON.stringify(command)
        || metadata.Config.Labels?.['org.opencontainers.image.revision'] !== revision || dirty) {
        throw new Error(`${name} image must match the committed runtime source revision and native production command`);
      }
      evidence.push({ name, image, id: metadata.Id, command, revision: metadata.Config.Labels['org.opencontainers.image.revision'] });
    }
    save('images.json', evidence);
  }

  async function install(generated) {
    Object.values(generated.secret).forEach((secret) => redactions.add(secret));
    // Create, never adopt or overwrite, a namespace for this run.
    await kubectl(['create', '-f', '-'], { input: JSON.stringify({ apiVersion: 'v1', kind: 'Namespace',
      metadata: { name: generated.namespace, labels: generated.labels } }) });
    platform = generated;
    // Install test isolation after native migration hooks have bootstrapped.
    // The local network-policy controller can briefly reject a new pod's first
    // connection while populating its rules. No provider credentials exist yet.
    await apply(platform.dependencies.filter((item) => item.kind !== 'NetworkPolicy'));
    for (const name of ['drain-postgres', 'drain-redis', 'drain-fixture']) {
      await scoped(['rollout', 'status', `deployment/${name}`, '--timeout=180s'], { timeoutMs: 190000 });
    }
    if (config.capacity === 'on') {
      await installValues(false, false, 'quiesced');
      await capacityCommand('prepare');
      await installValues(true, false, 'capacity-enabled');
      await capacityCommand('verify');
    }
    await installValues(config.capacity === 'on', true, 'ready');
    await apply(platform.dependencies.filter((item) => item.kind === 'NetworkPolicy'));
    await startFixtureForward();
    console.log(`ok installed ${platform.namespace}`);
  }

  async function installValues(enabled, open, phase) {
    const values = { ...platform.values, workspaceCapacity: {
      enabled, admissionEnabled: open, dispatchEnabled: open } };
    const file = `values-${phase}.json`;
    save(file, values);
    await run('helm', ['upgrade', '--install', platform.release, 'kubernetes/helm/acornops-platform',
      '--kubeconfig', config.kubeconfig, '--kube-context', context,
      '-n', platform.namespace, '-f', join(reportDirectory, file), '--wait', '--timeout', '10m'], { timeoutMs: 610000 });
  }

  async function capacityCommand(command) {
    const peers = [];
    let controlPlanePod;
    for (const [component, port] of [['control-plane', 8081], ['execution-engine', 8080], ['llm-gateway', 8001]]) {
      const active = (await pods(component)).filter((pod) => !pod.metadata.deletionTimestamp
        && pod.status.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'));
      if (!active.length) throw new Error(`No ready ${component} peers for capacity activation`);
      for (const pod of active) peers.push({ service: component, url: `http://${pod.status.podIP}:${port}` });
      if (component === 'control-plane') controlPlanePod = active[0].metadata.name;
    }
    await scoped(['exec', '-i', controlPlanePod, '--', 'node', '-e',
      'require("node:fs").writeFileSync("/tmp/rollout-peers.json",require("node:fs").readFileSync(0))'],
    { input: JSON.stringify(peers) });
    const output = await scoped(['exec', controlPlanePod, '--', 'node', 'dist/scripts/workspace-capacity-rollout.js',
      command, '/tmp/rollout-peers.json', '--require-finite']);
    save(`capacity-${command}.log`, output);
    console.log(`ok capacity ${command}`);
  }

  async function startFixtureForward() {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    const child = spawn('kubectl', [...args(), '-n', platform.namespace, 'port-forward',
      'deployment/drain-fixture', `${port}:8099`, '--address=127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe'] });
    children.push(child);
    child.stderr.pipe(createWriteStream(join(reportDirectory, 'fixture-forward.log')));
    fixtureUrl = `http://127.0.0.1:${port}`;
    await waitFor('fixture control forwarding', async () => (await fetch(`${fixtureUrl}/health`)).ok, 15000);
  }

  async function control(path, data) {
    const response = await fetch(`${fixtureUrl}/control${path}`, { method: data ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${platform.secret.FIXTURE_CONTROL_TOKEN}`, 'content-type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok) throw new Error(`Fixture ${path}: ${response.status} ${JSON.stringify(result)}`);
    return result;
  }

  async function restart(component) {
    const old = await pods(component);
    for (const pod of old) {
      const child = spawn('kubectl', [...args(), '-n', platform.namespace, 'logs', '-f', pod.metadata.name],
        { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      const name = `${pod.metadata.name}.log`;
      const collect = (chunk) => podLogs.set(name, ((podLogs.get(name) || '') + chunk).slice(-5 * 1024 * 1024));
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('close', () => save(name, podLogs.get(name) || ''));
    }
    const record = { component, startedAt: new Date().toISOString(), old: old.map((pod) => ({
      name: pod.metadata.name, uid: pod.metadata.uid, ip: pod.status.podIP })), samples: [] };
    observations.push(record);
    await scoped(['rollout', 'restart', `deployment/${platform.name(component)}`]);
    return record;
  }

  async function drained(record, ip) {
    return waitFor(`${record.component} old pod terminating and removed from ready endpoints`, async () => {
      const current = await pods(record.component);
      const oldUids = new Set(record.old.filter((pod) => !ip || pod.ip === ip.replace('::ffff:', '')).map((pod) => pod.uid));
      if (!oldUids.size) throw new Error('Held request peer is not an old component pod');
      const terminating = current.filter((pod) => oldUids.has(pod.metadata.uid) && pod.metadata.deletionTimestamp);
      if (!terminating.length) return false;
      const slices = await get('endpointslices', `kubernetes.io/service-name=${platform.name(record.component)}`);
      const ready = slices.items.flatMap((item) => item.endpoints || []).filter((item) => item.conditions?.ready);
      if (ready.some((endpoint) => oldUids.has(endpoint.targetRef?.uid))) return false;
      record.samples.push({ at: new Date().toISOString(), terminating: terminating.map((pod) => pod.metadata.uid),
        ready: ready.map((endpoint) => endpoint.targetRef?.uid) });
      return terminating;
    }, 90000);
  }

  async function settled(record) {
    await scoped(['rollout', 'status', `deployment/${platform.name(record.component)}`, '--timeout=180s'], { timeoutMs: 190000 });
    await waitFor(`${record.component} old pods gone`, async () => {
      const current = await pods(record.component);
      return !current.some((pod) => record.old.some((old) => old.uid === pod.metadata.uid));
    }, 180000);
    record.finishedAt = new Date().toISOString();
  }

  const redis = (key) => scoped(['exec', 'deployment/drain-redis', '--', 'redis-cli', '--raw', 'GET', key]).then((value) => value.trim());
  const sql = (query) => scoped(['exec', 'deployment/drain-postgres', '--', 'psql', '-U', 'acornops',
    '-d', 'control_plane', '-At', '-c', query]).then((value) => value.trim());
  async function observeRpc(owner) {
    if (!/^[A-Za-z0-9_-]+$/.test(owner)) throw new Error('Invalid owner identity');
    const records = [];
    const child = spawn('kubectl', [...args(), '-n', platform.namespace, 'exec', 'deployment/drain-redis', '--',
      'redis-cli', '--raw', 'SUBSCRIBE', `cp:agent:rpc:${owner}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let buffered = '', subscribed = false;
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      for (;;) {
        const newline = buffered.indexOf('\n');
        if (newline < 0) break;
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line === 'subscribe') subscribed = true;
        if (!line.startsWith('{')) continue;
        try {
          const message = JSON.parse(line);
          records.push({ at: new Date().toISOString(), originInstanceId: message.originInstanceId,
            method: message.method, agentRequestId: message.agentRequestId,
            requestId: message.requestId, runId: message.execution?.runId });
        } catch { /* Redis protocol markers are not payloads. */ }
      }
    });
    await waitFor('owner RPC observation subscription', () => subscribed, 10000);
    return { records, close: () => child.kill('SIGTERM') };
  }
  async function diagnostics() {
    save('rollouts.json', observations);
    for (const [name, log] of podLogs) save(name, log);
    if (!platform) return;
    for (const kind of ['pods', 'endpointslices', 'events']) {
      try { save(`${kind}.json`, await get(kind)); } catch { /* Keep the original failure. */ }
    }
    try {
      for (const pod of (await get('pods')).items) {
        try { save(`${pod.metadata.name}-tail.log`, await scoped(['logs', pod.metadata.name, '--all-containers', '--tail=300'])); }
        catch { /* A never-started pod has no container log. */ }
      }
    } catch { /* Namespace creation can fail before diagnostics exist. */ }
    try { save('fixture.json', await control('/state')); } catch { /* Fixture startup can fail. */ }
  }
  async function cleanup() {
    for (const child of children) child.kill('SIGTERM');
    if (config.cleanup && platform) {
      const namespace = JSON.parse(await kubectl(['get', 'namespace', platform.namespace, '-o', 'json']));
      if (namespace.metadata.labels?.[ownershipLabel] !== platform.labels[ownershipLabel]) throw new Error('Namespace ownership changed; cleanup refused');
      await kubectl(['delete', 'namespace', platform.namespace, '--wait=false']);
    }
  }
  return { preflight, verifyImages, install, control, pods, scoped, apply, get, restart, drained, settled,
    redis, sql, observeRpc, save, addRedaction: (secret) => redactions.add(secret), diagnostics, cleanup };
}
