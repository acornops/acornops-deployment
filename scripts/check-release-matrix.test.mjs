import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
