import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig, validateCluster, createConfiguration } from './config.mjs';

const config = { kubeconfig: '/tmp/fixture', expectedCluster: 'acornops-drain-test',
  ingress: 'http://127.0.0.1:18089', capacity: 'on' };
const cluster = { contexts: [{ name: 'k3d-acornops-drain-test', context: { cluster: 'k3d-acornops-drain-test' } }],
  'current-context': 'k3d-acornops-drain-test',
  clusters: [{ name: 'k3d-acornops-drain-test', cluster: { server: 'https://127.0.0.1:56543' } }] };

test('rollout runner requires explicit isolated context and loopback ingress before mutations', () => {
  assert.doesNotThrow(() => validateConfig(config));
  for (const input of [{ ...config, kubeconfig: '' }, { ...config, expectedCluster: 'production' },
    { ...config, ingress: 'https://api.acornops.dev' }, { ...config, ingress: 'http://127.0.0.1:80/path' },
    { ...config, capacity: 'maybe' }, { ...config, internalTls: 'true' }]) assert.throws(() => validateConfig(input));
});

test('a matching name cannot authorize a remote cluster or wrong current context', () => {
  assert.equal(validateCluster(config, cluster), 'k3d-acornops-drain-test');
  assert.throws(() => validateCluster(config, { ...cluster, 'current-context': 'k3d-demo' }));
  assert.throws(() => validateCluster(config, { ...cluster,
    clusters: [{ name: 'k3d-acornops-drain-test', cluster: { server: 'https://production.example:6443' } }] }));
});

test('capacity profiles render native service routing with optional mutual TLS', () => {
  const directory = mkdtempSync(join(tmpdir(), 'drain-render-'));
  try {
    for (const capacity of ['on', 'off']) for (const internalTls of [false, true]) {
      const generated = createConfiguration({ ...config, capacity, internalTls, cpImage: 'acornops-drain-cp:test',
        eeImage: 'acornops-drain-ee:test', gwImage: 'acornops-drain-gw:test' }, 'render');
      const values = join(directory, 'values.json');
      writeFileSync(values, JSON.stringify(generated.values));
      const render = spawnSync('helm', ['template', generated.release, 'kubernetes/helm/acornops-platform', '-n', generated.namespace, '-f', values], { encoding: 'utf8' });
      assert.equal(render.status, 0, render.stderr);
      assert.match(render.stdout, new RegExp(`WORKSPACE_CAPACITY_ENABLED: "${capacity === 'on'}"`));
      assert.match(render.stdout, /WORKSPACE_ADMISSION_ENABLED: "true"/);
      assert.match(render.stdout, /WORKSPACE_DISPATCH_ENABLED: "true"/);
      assert.match(render.stdout, /LLM_PROVIDER_OPENAI_BASE_URL: "http:\/\/drain-fixture:8099\/v1\/"/);
      assert.match(render.stdout, /terminationGracePeriodSeconds: 900/);
      for (const reference of render.stdout.matchAll(/secretKeyRef:\n\s+name: [^\n]+\n\s+key: ([^\n]+)(?:\n\s+optional: (true|false))?/g)) {
        if (reference[2] !== 'true') assert.ok(Object.hasOwn(generated.secret, reference[1].replaceAll('"', '')),
          `Fixture must supply required Secret key ${reference[1]}`);
      }
      assert.equal(generated.values.internalTransport.tls.enabled, internalTls);
      assert.match(render.stdout, new RegExp(`INTERNAL_TRANSPORT_TLS_ENABLED: "${internalTls}"`));
      if (internalTls) {
        assert.match(render.stdout, /INTERNAL_TRANSPORT_TLS_REQUIRE_CLIENT_CERT: "true"/);
        for (const [role, port] of [['control-plane', 8443], ['execution-engine', 8080], ['llm-gateway', 8001]]) {
          assert.ok(render.stdout.includes(`https://${generated.name(role)}.${generated.namespace}.svc:${port}`));
        }
        assert.match(render.stdout, /INTERNAL_TRANSPORT_HEALTH_PORT: "18080"/);
        assert.match(render.stdout, /INTERNAL_TRANSPORT_HEALTH_PORT: "18001"/);
        const tlsSecret = generated.dependencies.find((item) => item.metadata.name === generated.values.internalTransport.tls.ca.secretName);
        assert.equal(tlsSecret.kind, 'Secret');
        assert.deepEqual(tlsSecret.metadata.labels, generated.labels);
        for (const material of Object.values(tlsSecret.stringData)) assert.ok(!render.stdout.includes(material));
        for (const role of ['controlPlane', 'executionEngine', 'llmGateway']) {
          const certificate = generated.values.internalTransport.tls.certificates[role];
          assert.equal(certificate.secretName, tlsSecret.metadata.name);
          assert.ok(tlsSecret.stringData[certificate.certKey].includes('BEGIN CERTIFICATE'));
          assert.ok(tlsSecret.stringData[certificate.keyKey].includes('PRIVATE KEY'));
          assert.ok(render.stdout.includes(`- key: "${certificate.certKey}"`));
          assert.ok(render.stdout.includes(`- key: "${certificate.keyKey}"`));
        }
        assert.ok(render.stdout.includes(`secretName: "${tlsSecret.metadata.name}"`));
        assert.match(render.stdout, /INTERNAL_TRANSPORT_TLS_CA_FILE: "\/var\/run\/acornops\/internal-transport-tls\/ca\/ca.crt"/);
      } else assert.equal(generated.dependencies.filter((item) => item.kind === 'Secret').length, 1);
      assert.equal(generated.agentUrl.startsWith('ws://'), true);
      for (const dependency of generated.dependencies) {
        assert.equal(dependency.metadata.namespace, generated.namespace);
        assert.deepEqual(dependency.metadata.labels, generated.labels);
      }
      assert.equal(generated.dependencies.filter((item) => item.kind === 'NetworkPolicy').length, 1);
      assert.equal(generated.values.components.llmGateway.providerBaseUrls.openai, 'http://drain-fixture:8099/v1/');
      assert.match(render.stdout, /MCP_OAUTH_ENABLED: "false"/);
      assert.equal(generated.dependencies.filter((item) => item.kind === 'Deployment').length, 3);
      assert.equal(generated.values.components.executionEngine.maxConcurrentRuns, 4);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
