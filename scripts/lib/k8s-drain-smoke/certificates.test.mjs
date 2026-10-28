import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCertificates } from './certificates.mjs';
import { capacityProbePorts, createRuntime } from './runtime.mjs';

const name = (component) => `drain-certificate-fixture-acornops-platform-${component}`;

test('ephemeral role certificates trust their CA and match Kubernetes Service DNS names', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'drain-key-cleanup-'));
  let tls;
  try {
    tls = createCertificates('drain-certificate-fixture', name, temporaryRoot);
    assert.deepEqual(readdirSync(temporaryRoot), []);
  } finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
  const ca = new X509Certificate(tls.material['ca.crt']);
  assert.equal(ca.ca, true);
  assert.equal(tls.material['ca.key'], undefined);
  const other = createCertificates('drain-other', name);
  const wrongCa = new X509Certificate(other.material['ca.crt']);
  const keys = new Set();
  for (const [role, component] of [['controlPlane', 'control-plane'], ['executionEngine', 'execution-engine'], ['llmGateway', 'llm-gateway']]) {
    const config = tls.values.certificates[role];
    const cert = new X509Certificate(tls.material[config.certKey]);
    assert.equal(cert.subject, `CN=${component}`);
    assert.equal(cert.ca, false);
    assert.equal(cert.verify(ca.publicKey), true);
    assert.equal(cert.verify(wrongCa.publicKey), false);
    assert.equal(cert.checkPrivateKey(createPrivateKey(tls.material[config.keyKey])), true);
    assert.ok(cert.keyUsage.includes('1.3.6.1.5.5.7.3.1')); // serverAuth
    assert.ok(cert.keyUsage.includes('1.3.6.1.5.5.7.3.2')); // clientAuth
    for (const suffix of ['', '.drain-certificate-fixture', '.drain-certificate-fixture.svc', '.drain-certificate-fixture.svc.cluster.local']) {
      assert.equal(cert.checkHost(name(component) + suffix), name(component) + suffix);
    }
    assert.equal(cert.checkHost('production.example'), undefined);
    keys.add(tls.material[config.keyKey]);
  }
  assert.equal(keys.size, 3);
  assert.equal(tls.values.requireClientCert, true);
});

test('TLS evidence redacts PEM, JSON escaped and base64 private material', () => {
  const directory = mkdtempSync(join(tmpdir(), 'drain-redaction-'));
  try {
    const tls = createCertificates('drain-evidence', name);
    const runtime = createRuntime({}, directory);
    tls.redactions.forEach(runtime.addRedaction);
    runtime.save('fixture.json', { secret: tls.material, base64: tls.redactions.map((value) => Buffer.from(value).toString('base64')) });
    runtime.save('fixture.log', tls.redactions.join('\n'));
    for (const filename of ['fixture.json', 'fixture.log']) {
      const output = readFileSync(join(directory, filename), 'utf8');
      assert.ok(output.includes('[redacted]'));
      for (const value of tls.redactions) {
        assert.ok(!output.includes(JSON.stringify(value).slice(1, -1)));
        assert.ok(!output.includes(Buffer.from(value).toString('base64')));
        for (const line of value.trim().split('\n')) assert.ok(!output.includes(line));
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('capacity activation probes dedicated plain health listeners in TLS mode', () => {
  assert.deepEqual(capacityProbePorts(true), [['control-plane', 8081], ['execution-engine', 18080], ['llm-gateway', 18001]]);
  assert.deepEqual(capacityProbePorts(false), [['control-plane', 8081], ['execution-engine', 8080], ['llm-gateway', 8001]]);
});
