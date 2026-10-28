#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { validateConfig, createConfiguration } from './lib/k8s-drain-smoke/config.mjs';
import { createRuntime } from './lib/k8s-drain-smoke/runtime.mjs';
import { bootstrap } from './lib/k8s-drain-smoke/bootstrap.mjs';
import { runScenarios } from './lib/k8s-drain-smoke/scenarios.mjs';

const { values } = parseArgs({ options: {
  preflight: { type: 'boolean' }, run: { type: 'boolean' }, cleanup: { type: 'boolean', default: false },
  kubeconfig: { type: 'string' }, 'expected-cluster': { type: 'string' }, ingress: { type: 'string' },
  capacity: { type: 'string', default: 'on' }, 'cp-image': { type: 'string' },
  'internal-tls': { type: 'boolean', default: false },
  'ee-image': { type: 'string' }, 'gw-image': { type: 'string' },
} });
const config = { ...values, expectedCluster: values['expected-cluster'], cpImage: values['cp-image'],
  eeImage: values['ee-image'], gwImage: values['gw-image'], internalTls: values['internal-tls'] };
const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const reportDirectory = join(tmpdir(), `acornops-drain-${id}`);
const runtime = createRuntime(config, reportDirectory);
let api;
try {
  if (!values.run && !values.preflight) throw new Error('Choose --preflight (read-only) or --run (creates an isolated namespace)');
  validateConfig(config);
  await runtime.preflight();
  if (values.run) {
    const platform = createConfiguration(config, id);
    await runtime.verifyImages();
    await runtime.install(platform);
    api = await bootstrap(config, platform, runtime);
    await runScenarios(config, platform, runtime, api);
    runtime.save('result.json', { status: 'passed', capacity: config.capacity, namespace: platform.namespace,
      internalTls: config.internalTls, provider: 'controlled fixture', agent: 'protocol fixture' });
    console.log(`Kubernetes rolling restart smoke passed (capacity ${config.capacity}).`);
  }
} catch (error) {
  runtime.save('result.json', { status: 'failed', internalTls: config.internalTls, message: error.message });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  api?.save();
  await runtime.diagnostics();
  await runtime.cleanup();
  console.log(`Rollout evidence: ${reportDirectory}`);
}
