import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { bootstrap } from './bootstrap.mjs';
import * as runtimeModule from './runtime.mjs';

const currentId = `sha256:${'a'.repeat(64)}`;
const staleId = `sha256:${'b'.repeat(64)}`;
const pod = (name, imageID = currentId) => ({ metadata: { name, uid: name },
  spec: { containers: [{ name: 'control-plane', image: 'acornops-drain-cp:test' }] },
  status: { conditions: [{ type: 'Ready', status: 'True' }],
    containerStatuses: [{ name: 'control-plane', ready: true, imageID }] } });

test('rejects a stale imported image even when every pod uses the verified mutable tag', () => {
  assert.throws(() => runtimeModule.verifyPodImages('control-plane', [pod('first'), pod('stale', staleId)],
    { image: 'acornops-drain-cp:test', id: currentId }), /stale.*image ID/);
});

test('records every ready replica image ID and refuses missing runtime status', () => {
  const evidence = runtimeModule.verifyPodImages('control-plane', [pod('first'), pod('second')],
    { image: 'acornops-drain-cp:test', id: currentId });
  assert.deepEqual(evidence.map((item) => [item.pod, item.imageId]), [['first', currentId], ['second', currentId]]);
  const missing = pod('missing');
  missing.status.containerStatuses = [];
  assert.throws(() => runtimeModule.verifyPodImages('control-plane', [missing], { id: currentId }), /runtime container/);
  assert.throws(() => runtimeModule.verifyPodImages('control-plane', [], { id: currentId }), /ready/);
});

const messageId = '12345678-1234-4123-8123-123456789abc';
const runId = '12345678-1234-4123-8123-123456789def';
async function exercise(t, { acceptedId = messageId, duplicate = false, badAssociation = false } = {}) {
  const saved = new Map();
  const user = { id: messageId, sessionId: 'session', runId, role: 'user', kind: 'user',
    content: 'ROLLOUT_CASE:baseline', clientMessageId: 'msg-baseline', createdAt: '2026-10-29T00:00:00Z' };
  const assistant = { id: 'assistant', sessionId: 'session', runId, role: 'assistant', kind: 'assistant_final',
    content: 'case:baseline:completed', createdAt: '2026-10-29T00:00:01Z' };
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* Consume request body before response. */ }
    const path = req.url.replace('/api/v1', '');
    let body;
    if (path === '/auth/csrf') body = { csrfToken: 'csrf' };
    else if (path === '/workspaces') body = { id: 'workspace' };
    else if (path === '/workspaces/workspace/kubernetes-clusters' && req.method === 'POST') body = { cluster: { id: 'target' }, agentKey: 'key' };
    else if (path.endsWith('/kubernetes-clusters/target')) body = { status: 'online' };
    else if (path.includes('/mcp/catalog')) body = { servers: [{ type: 'builtin', connectionStatus: 'ok', tools: [{ name: 'rollout_probe', enabledEffective: true }] }] };
    else if (path.endsWith('/sessions')) body = { id: 'session' };
    else if (path === '/sessions/session/messages' && req.method === 'POST') body = { message_id: acceptedId, run_id: runId, runtimeSelection: { provider: 'openai', model: 'gpt-5.4-mini', reasoningEffort: 'off' } };
    else if (path.startsWith('/sessions/session/messages')) body = { items: [user, ...(duplicate ? [{ ...user, id: 'duplicate' }] : []), assistant], nextCursor: null };
    else if (path === `/runs/${runId}`) body = { id: runId, sessionId: 'session', messageId: badAssociation ? 'wrong' : messageId, status: 'completed' };
    else body = {};
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const api = await bootstrap({ ingress: `http://127.0.0.1:${server.address().port}`, capacity: 'off' },
    { host: 'drain.localhost', origin: 'http://drain.localhost', namespace: 'drain-test', secret: { FIXTURE_PROVIDER_KEY: 'fixture-key' } },
    { addRedaction() {}, save: (name, value) => saved.set(name, value), control: async () => ({ providerCalls: [{}], events: [] }) });
  return { api, saved };
}

test('rejects a mismatched accepted message ID despite a successful assistant completion', async (t) => {
  const { api } = await exercise(t, { acceptedId: '12345678-1234-4123-8123-123456789aaa' });
  await assert.rejects(async () => api.completed(await api.start('baseline')), /accepted message ID/);
});

test('rejects duplicate durable user messages for the submitted logical client identity', async (t) => {
  const { api } = await exercise(t, { duplicate: true });
  await assert.rejects(async () => api.completed(await api.start('baseline')), /Exactly one durable user message/);
});

test('rejects a run associated with another message', async (t) => {
  const { api } = await exercise(t, { badAssociation: true });
  await assert.rejects(async () => api.completed(await api.start('baseline')), /Run message association/);
});

test('rejects a missing or malformed acceptance message ID before returning accepted work', async (t) => {
  for (const acceptedId of ['', null, 'not-a-uuid']) {
    const { api } = await exercise(t, { acceptedId });
    await assert.rejects(() => api.start('baseline'), /durable message ID/);
  }
});

test('records the verified durable client, message, session and run identity', async (t) => {
  const { api, saved } = await exercise(t);
  await api.completed(await api.start('baseline'));
  assert.deepEqual(saved.get('baseline.json').identity, { clientMessageId: 'msg-baseline', messageId,
    sessionId: 'session', runId, assistantMessageId: 'assistant' });
});
