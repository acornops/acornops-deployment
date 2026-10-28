import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixture, toolResult } from './drain-runtime.mjs';

test('ConfigMap-style symlink entrypoint starts the fixture instead of silently exiting', () => {
  const directory = mkdtempSync(join(tmpdir(), 'drain-entrypoint-'));
  try {
    const entrypoint = join(directory, 'runtime.mjs');
    symlinkSync(fileURLToPath(new URL('./drain-runtime.mjs', import.meta.url)), entrypoint);
    const result = spawnSync(process.execPath, [entrypoint], {
      env: { ...process.env, FIXTURE_CONTROL_TOKEN: '', FIXTURE_PROVIDER_KEY: '' }, encoding: 'utf8' });
    assert.equal(result.status, 1, 'The main entrypoint must execute its configuration validation');
    assert.match(result.stderr, /Fixture control and provider credentials are required/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

async function fixture(t) {
  const runtime = createFixture({ token: 'test-control', providerKey: 'test-provider' });
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  t.after(() => runtime.close());
  const url = `http://127.0.0.1:${runtime.server.address().port}`;
  const control = async (path, body) => {
    const response = await fetch(`${url}/control${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer test-control', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const infer = (caseId, extra = {}) => fetch(`${url}/v1/responses`, {
    method: 'POST', headers: { authorization: 'Bearer test-provider', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.4-mini', stream: true,
      input: [{ role: 'user', content: `ROLLOUT_CASE:${caseId}` }], ...extra }),
  });
  return { runtime, url, control, infer };
}

test('held provider response emits headers, releases once, and records duplicate attempts', async (t) => {
  const { control, infer } = await fixture(t);
  assert.equal((await control('/cases', { caseId: 'held', kind: 'text', holdPhase: 'provider_final' })).status, 201);
  const response = await infer('held');
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /case:held:started/);
  assert.deepEqual((await control('/cases/held')).body.pending, ['provider_final']);
  await control('/cases/held/release', { phase: 'provider_final' });
  await control('/cases/held/release', { phase: 'provider_final' });
  let output = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    output += new TextDecoder().decode(value);
  }
  assert.match(output, /case:held:completed/);
  assert.match(output, /response.completed/);
  await (await infer('held')).text();
  const state = (await control('/cases/held')).body;
  assert.equal(state.providerCalls.length, 2);
  assert.equal(state.events.filter((event) => event.type === 'released').length, 1);
  assert.equal(state.events.filter((event) => event.type === 'provider_disconnected').length, 0);
});

test('hold expiry is recorded as failure and cannot impersonate successful completion', async (t) => {
  const { control, infer } = await fixture(t);
  await control('/cases', { caseId: 'expiry', kind: 'text', holdPhase: 'provider_final', maxHoldMs: 50 });
  const output = await (await infer('expiry')).text();
  assert.doesNotMatch(output, /case:expiry:completed/);
  assert.match(output, /response.failed/);
  assert.equal((await control('/cases/expiry')).body.events.some((event) => event.type === 'hold_expired'), true);
});

test('fixture rejects unauthenticated controls, unknown cases and duplicate registration', async (t) => {
  const { url, control, infer } = await fixture(t);
  assert.equal((await fetch(`${url}/control/state`)).status, 401);
  assert.equal((await infer('missing')).status, 400);
  assert.equal((await control('/cases', { caseId: 'known', kind: 'text', holdPhase: 'none' })).status, 201);
  assert.equal((await control('/cases', { caseId: 'known', kind: 'text', holdPhase: 'none' })).status, 409);
});

test('tool response preserves the trusted model-context envelope and UTF-8 byte accounting', () => {
  const result = toolResult('héllo');
  const context = JSON.parse(result.content[0].text);
  assert.equal(context.schemaVersion, 'acornops.model-context.v1');
  assert.equal(context.status, 'success');
  assert.deepEqual(context.omissions, []);
  assert.deepEqual(result.structuredContent, {
    schemaVersion: 'acornops.full-tool-result.v1', data: { caseId: 'héllo', ok: true },
  });
  assert.equal(result._meta['acornops.dev/result'].contextBytes, Buffer.byteLength(result.content[0].text));
});

test('agent holds replies on their original connection and records duplicate raw dispatch', async (t) => {
  const require = createRequire(new URL('../../../control-plane/package.json', import.meta.url));
  const { WebSocketServer } = require('ws');
  const sockets = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(sockets, 'listening');
  const agentUrl = `ws://127.0.0.1:${sockets.address().port}/api/v1/agent/connect`;
  const runtime = createFixture({ token: 'control', providerKey: 'provider', agentUrl });
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  t.after(async () => { await runtime.close(); sockets.close(); });
  const control = async (path, data) => {
    const response = await fetch(`http://127.0.0.1:${runtime.server.address().port}/control${path}`, {
      method: data ? 'POST' : 'GET', headers: { authorization: 'Bearer control', 'content-type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined });
    assert.ok(response.ok);
    return response.json();
  };
  await control('/cases', { caseId: 'tool', kind: 'tool', holdPhase: 'tool_reply' });
  const connection = once(sockets, 'connection');
  await control('/agent/configure', { targetId: 'target', agentKey: 'fake', websocketUrl: agentUrl });
  const [socket] = await connection;
  const replies = [];
  socket.on('message', (raw) => replies.push(JSON.parse(raw)));
  const request = { jsonrpc: '2.0', id: 'stable-tool-id', method: 'tools/call', params: {
    name: 'rollout_probe', arguments: { caseId: 'tool' } } };
  socket.send(JSON.stringify(request));
  socket.send(JSON.stringify(request));
  const deadline = Date.now() + 2000;
  while ((await control('/cases/tool')).toolCalls.length < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await control('/cases/tool')).toolCalls.length, 2, 'Duplicates remain observable to the acceptance test');
  assert.equal(replies.filter((reply) => reply.id === request.id).length, 0);
  await control('/cases/tool/release', { phase: 'tool_reply' });
  while (replies.filter((reply) => reply.id === request.id).length < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(replies.filter((reply) => reply.id === request.id).length, 2);
  await control('/agent/reconnect-gate', { open: false });
  socket.close(1012, 'rolling restart');
  await once(socket, 'close');
  assert.deepEqual((await control('/cases/tool')).toolCalls.map((call) => call.generation), [1, 1]);
});
