import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentVExampleFailures } from './release-matrix-agentv.mjs';

const key = 'AGENTV_SYSTEMD_RELEASE_VERSION';
const expected = '1.2.3';

for (const scalar of ['1.2.3', '"1.2.3"', "'1.2.3'"]) {
  test(`accepts one matrix-aligned generated version (${scalar})`, () => {
    assert.deepEqual(agentVExampleFailures(`data:\n  ${key}: ${scalar}\r\n`, expected, 'example.yaml'), []);
  });
}

for (const [name, rendered] of [
  ['stale', `  ${key}: "0.0.1-experimental.6"\n  other: "1.2.3"\n`],
  ['missing', `  OTHER_${key}: "1.2.3"\n`],
  ['empty', `  ${key}:\n`],
  ['quoted empty', `  ${key}: ""\n`],
  ['duplicate', `  ${key}: "1.2.3"\n  ${key}: "1.2.3"\n`],
  ['conflicting', `  ${key}: "1.2.3"\n  ${key}: "0.0.1-experimental.6"\n`]
]) {
  test(`rejects ${name} generated version with a labeled diagnostic`, () => {
    const failures = agentVExampleFailures(rendered, expected, 'example.yaml');
    assert.equal(failures.length, 1);
    assert.ok(failures[0].includes('example.yaml'));
    assert.ok(failures[0].includes(key));
    assert.ok(failures[0].includes(expected));
    if (rendered.includes('0.0.1-experimental.6')) {
      assert.ok(failures[0].includes('0.0.1-experimental.6'));
    }
  });
}
