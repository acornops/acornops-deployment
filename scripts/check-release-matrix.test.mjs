import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

for (const version of ['99999.0.0', '']) {
  test(`release preflight rejects a tag outside the checked matrix (${JSON.stringify(version)})`, () => {
    const result = spawnSync(process.execPath, ['scripts/check-release-matrix.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, ACORNOPS_RELEASE_VERSION: version, ACORNOPS_CHECK_PUBLISHED_ARTIFACTS: 'false' }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Release tag does not match the platform chart version/);
  });
}

test('release preflight accepts the chart version in the checked matrix', () => {
  const version = readFileSync('kubernetes/helm/acornops-platform/Chart.yaml', 'utf8').match(/^version: (.+)$/m)[1];
  const result = spawnSync(process.execPath, ['scripts/check-release-matrix.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, ACORNOPS_RELEASE_VERSION: version, ACORNOPS_CHECK_PUBLISHED_ARTIFACTS: 'false' }
  });
  assert.equal(result.status, 0, result.stderr);
});

test('release preflight rejects a stale AgentV pin in an additional bundled example', (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'acornops-release-matrix-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const path of [
    'scripts/check-release-matrix.mjs',
    'scripts/lib/release-matrix-agentv.mjs',
    'release/stack-versions.yaml',
    'kubernetes/helm/acornops-platform',
    'compose/vm-prod/compose.yaml',
    'env/vm/.env.example',
    '.github/workflows/release-chart.yml'
  ]) {
    const destination = join(fixture, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(path, destination, { recursive: true });
  }
  const example = 'values-agentv-regression.yaml';
  writeFileSync(join(fixture, 'kubernetes/helm/acornops-platform/examples', example),
    'targetAgents:\n  agentv:\n    systemd:\n      version: 0.0.1-experimental.6\n');

  const env = { ...process.env, ACORNOPS_CHECK_PUBLISHED_ARTIFACTS: 'false' };
  delete env.ACORNOPS_RELEASE_VERSION;
  const result = spawnSync(process.execPath, ['scripts/check-release-matrix.mjs'], {
    cwd: fixture,
    encoding: 'utf8',
    env
  });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes(example), result.stderr);
  assert.match(result.stderr, /AGENTV_SYSTEMD_RELEASE_VERSION/);
  assert.match(result.stderr, /0\.0\.1-experimental\.6/);
});
