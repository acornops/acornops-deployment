import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercise the real startup script, replacing only Docker so this regression
// cannot start containers or touch a developer's databases or Kubernetes cluster.
const directory = mkdtempSync(join(tmpdir(), 'acornops-local-up-test-'));
try {
  const log = join(directory, 'docker-calls.jsonl');
  const envFile = join(directory, '.env.local');
  writeFileSync(envFile, [
    'GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64=test-key',
    'LOCAL_K3D_AUTO_CREATE=false',
    'SEED_DEMO_K3S_WORKLOADS=false'
  ].join('\n'));
  writeFileSync(join(directory, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_DOCKER_CALLS, JSON.stringify(args) + '\\n');
if (args.includes('run') && args.includes(process.env.TEST_FAIL_MIGRATION)) process.exit(23);
`, { mode: 0o755 });
  // No real k3d/kubectl calls, including discovery of the host kubeconfig.
  for (const command of ['k3d', 'kubectl']) {
    writeFileSync(join(directory, command), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  }

  function run(failMigration = '', profiles = 'target-fixtures', platformAdmin = 'false') {
    writeFileSync(log, '');
    const result = spawnSync('bash', ['scripts/local-up.sh', envFile, join(directory, 'no-agent-env')], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        LOCAL_EXTRA_PROFILES: profiles,
        LOCAL_K8S_RUNTIME_DIR: join(directory, 'kube'),
        LOCAL_KUBECONFIG_PATH: join(directory, 'kube/config'),
        PLATFORM_ADMIN_CONSOLE: platformAdmin,
        TEST_DOCKER_CALLS: log,
        TEST_FAIL_MIGRATION: failMigration
      }
    });
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    return { result, calls };
  }

  const { result, calls } = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(calls.filter((args) => args.includes('run')).map((args) => args.at(-1)),
    ['llm-gateway-init', 'control-plane-init']);
  const refreshIndex = calls.findIndex((args) => args.includes('rm'));
  const refresh = calls[refreshIndex];
  assert.ok(refresh?.includes('--stop') && refresh.includes('--force') && refresh.includes('--volumes'),
    'refresh disposable containers and their anonymous dependency caches');
  assert.deepEqual(refresh.slice(refresh.indexOf('rm') + 4),
    ['control-plane', 'control-plane-init', 'management-console', 'agentk']);
  assert.ok(refreshIndex > calls.findIndex((args) => args.includes('run') && args.includes('control-plane-init')),
    'do not stop source services before migrations succeed');
  assert.ok(refreshIndex < calls.findIndex((args) => args.includes('up')), 'refresh before starting source services');
  const agentRestart = calls.find((args) => args.includes('up') && args.includes('agentk'));
  assert.ok(agentRestart?.includes('--force-recreate') && agentRestart.includes('--no-deps'));
  assert.deepEqual(agentRestart.slice(-2), ['agentk', 'agentv']);
  assert.ok(calls.some((args) => args.includes('up') && args.includes('--force-recreate')
    && args.includes('--no-deps') && args.at(-1) === 'edge-proxy'), 'refresh proxy upstream addresses');
  const cluster = run('', 'cluster-fixture');
  assert.equal(cluster.result.status, 0, cluster.result.stderr || cluster.result.stdout);
  const clusterRestart = cluster.calls.find((args) => args.includes('up') && args.includes('agentk'));
  assert.ok(clusterRestart?.includes('--force-recreate'));
  assert.ok(!clusterRestart.includes('agentv'), 'cluster-only fixture must not start AgentV');
  const admin = run('', 'target-fixtures', 'true');
  assert.equal(admin.result.status, 0, admin.result.stderr || admin.result.stdout);
  const adminRefresh = admin.calls.find((args) => args.includes('rm'));
  assert.deepEqual(adminRefresh.slice(adminRefresh.indexOf('rm') + 4),
    ['control-plane', 'control-plane-init', 'management-console', 'platform-admin-console', 'agentk']);

  for (const migration of ['llm-gateway-init', 'control-plane-init']) {
    const failed = run(migration);
    assert.equal(failed.result.status, 23, 'migration failures must propagate');
    assert.ok(!failed.calls.some((args) => args.includes('up')), 'failed migration must prevent stack startup');
    assert.ok(!failed.calls.some((args) => args.includes('rm')), 'failed migration must leave existing source services intact');
  }
  console.log('local startup lifecycle checks passed');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
