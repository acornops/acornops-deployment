import http from 'node:http';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const toolDefinition = {
  name: 'rollout_probe', description: 'Return the registered rollout case marker.',
  capability: 'read', version: 'v1', timeout_ms: 30000, artifactPolicy: 'never',
  inputSchema: { type: 'object', required: ['caseId'], additionalProperties: false,
    properties: { caseId: { type: 'string', maxLength: 80 } } },
  outputSchema: { type: 'object', required: ['schemaVersion', 'data'], additionalProperties: false,
    properties: { schemaVersion: { const: 'acornops.full-tool-result.v1' },
      data: { type: 'object', required: ['caseId', 'ok'], additionalProperties: false,
        properties: { caseId: { type: 'string' }, ok: { const: true } } } } },
};

export function toolResult(caseId) {
  const data = { caseId, ok: true };
  const text = JSON.stringify({ schemaVersion: 'acornops.model-context.v1', tool: 'rollout_probe',
    status: 'success', summary: `Completed ${caseId}.`, data, omissions: [] });
  return { content: [{ type: 'text', text }],
    structuredContent: { schemaVersion: 'acornops.full-tool-result.v1', data }, isError: false,
    _meta: { 'acornops.dev/result': { contextSchemaVersion: 'v1', artifactPolicy: 'never',
      originalBytes: Buffer.byteLength(JSON.stringify(data)), contextBytes: Buffer.byteLength(text) } } };
}

function reject(status, message) { throw Object.assign(new Error(message), { status }); }
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) reject(413, 'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { reject(400, 'Invalid JSON'); }
}

export function createFixture({ token, providerKey, agentUrl, wsPackage } = {}) {
  if (!token || !providerKey) throw new Error('Fixture control and provider credentials are required');
  const cases = new Map();
  const agentEvents = [];
  let agent, agentConfig, heartbeat, reconnect, generation = 0, stopped = false, reconnectOpen = true;
  const event = (state, type, detail = {}) => state.events.push({ seq: state.events.length + 1,
    at: new Date().toISOString(), type, ...detail });
  const stateFor = (id) => cases.get(id) || reject(400, 'Unknown case');
  const snapshot = (state) => ({ caseId: state.caseId, events: state.events,
    providerCalls: state.providerCalls, toolCalls: state.toolCalls, pending: [...state.pending.keys()] });
  const json = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };

  async function gate(state, phase, signal) {
    if (state.holdPhase !== phase || state.released.has(phase)) return true;
    return new Promise((resolve) => {
      const finish = (success) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        waiters.delete(finish);
        if (!waiters.size) state.pending.delete(phase);
        resolve(success);
      };
      const aborted = () => finish(false);
      const waiters = state.pending.get(phase) || new Set();
      state.pending.set(phase, waiters);
      waiters.add(finish);
      const timer = setTimeout(() => { event(state, 'hold_expired', { phase }); finish(false); }, state.maxHoldMs);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) finish(false);
    });
  }

  async function provider(req, res, input) {
    if (req.headers.authorization !== `Bearer ${providerKey}`) reject(401, 'Invalid fixture credential');
    if (input.model !== 'gpt-5.4-mini' || input.stream !== true) reject(400, 'Unsupported fixture request');
    const caseId = [...JSON.stringify(input.input).matchAll(/ROLLOUT_CASE:([A-Za-z0-9_-]{1,80})/g)].at(-1)?.[1];
    const state = stateFor(caseId);
    if (state.providerCalls.length >= 128) reject(429, 'Fixture call bound exceeded');
    const call = { ordinal: state.providerCalls.length + 1, peer: req.socket.remoteAddress, finished: false };
    state.providerCalls.push(call);
    event(state, 'provider_started', { ordinal: call.ordinal, peer: call.peer });
    const abort = new AbortController();
    res.once('close', () => {
      if (!call.finished) event(state, 'provider_disconnected', { ordinal: call.ordinal });
      abort.abort();
    });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    const emit = (value) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`); };
    const delta = (text) => emit({ type: 'response.output_text.delta', delta: text });
    delta(`case:${caseId}:started `);
    const keepalive = setInterval(() => delta('.'), 2000);
    try {
      if (state.kind === 'tool' && call.ordinal === 1) {
        if (!await gate(state, 'before_tool', abort.signal)) return;
        const tool = input.tools?.find((item) => (item.name || item.function?.name)?.includes('rollout_probe'));
        if (!tool) throw new Error('Fixture tool absent from provider request');
        const item = { id: `fc_${caseId}`, type: 'function_call', call_id: `call_${caseId}`,
          name: tool.name || tool.function.name, arguments: '' };
        emit({ type: 'response.output_item.added', item });
        emit({ type: 'response.output_item.done', item: { ...item, arguments: JSON.stringify({ caseId }) } });
        event(state, 'provider_tool_emitted');
      } else {
        if (state.kind === 'tool' && !input.input?.some((item) => item.type === 'function_call_output'
          && item.call_id === `call_${caseId}` && JSON.stringify(item.output).includes(caseId))) {
          throw new Error('Successful fixture tool output absent from follow-up request');
        }
        if (!await gate(state, 'provider_final', abort.signal)) return;
        delta(`case:${caseId}:completed`);
      }
      emit({ type: 'response.completed', response: { usage: { input_tokens: 4, output_tokens: 3,
        output_tokens_details: { reasoning_tokens: 0 } } } });
      call.finished = true;
      event(state, 'provider_finished', { ordinal: call.ordinal });
    } catch (error) {
      event(state, 'fixture_error', { message: error.message });
    } finally {
      clearInterval(keepalive);
      if (!res.destroyed) {
        if (!call.finished) emit({ type: 'response.failed', response: { error: { message: 'Fixture failed or expired' } } });
        res.end();
      }
    }
  }

  function connectAgent() {
    if (stopped || !agentConfig) return;
    if (!reconnectOpen) { reconnect = setTimeout(connectAgent, 100); return; }
    const require = createRequire(wsPackage || fileURLToPath(new URL('../../../control-plane/package.json', import.meta.url)));
    const WebSocket = require('ws');
    const current = ++generation;
    const socket = new WebSocket(agentConfig.websocketUrl, { headers: {
      'x-agent-key': agentConfig.agentKey, 'x-connector-version': 'agentk/rollout-fixture' } });
    agent = socket;
    const send = (message) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
    socket.on('open', () => {
      agentEvents.push({ type: 'connected', generation: current, at: new Date().toISOString() });
      send({ jsonrpc: '2.0', id: `handshake-${current}`, method: 'lifecycle/handshake', params: {
        targetId: agentConfig.targetId, targetType: 'kubernetes', agentType: 'agentk',
        agentKey: agentConfig.agentKey, supportedCapabilities: ['read'] } });
      heartbeat = setInterval(() => send({ jsonrpc: '2.0', method: 'lifecycle/heartbeat',
        params: { timestamp: new Date().toISOString() } }), 5000);
    });
    socket.on('message', async (raw) => {
      let request;
      try {
        request = JSON.parse(raw.toString());
        if (request.id === `handshake-${current}`) {
          agentEvents.push({ type: request.error ? 'handshake_error' : 'ready', generation: current });
        } else if (request.method === 'tools/list') {
          send({ jsonrpc: '2.0', id: request.id, result: { tools: [toolDefinition] } });
        } else if (request.method === 'tools/call') {
          if (request.params?.name !== 'rollout_probe') throw new Error('Unknown tool');
          const state = stateFor(request.params.arguments?.caseId);
          const call = { id: request.id, generation: current, replied: false };
          state.toolCalls.push(call);
          event(state, 'tool_received', { id: call.id, generation: current });
          const abort = new AbortController();
          const closed = () => abort.abort();
          socket.once('close', closed);
          try {
            if (await gate(state, 'tool_reply', abort.signal) && socket.readyState === WebSocket.OPEN) {
              send({ jsonrpc: '2.0', id: request.id, result: toolResult(state.caseId) });
              call.replied = true;
              event(state, 'tool_replied', { id: call.id, generation: current });
            }
          } finally { socket.removeListener('close', closed); }
        }
      } catch (error) {
        agentEvents.push({ type: 'fixture_error', message: error.message, generation: current });
        if (request?.id) send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: error.message } });
      }
    });
    socket.on('error', () => {});
    socket.on('close', (code) => {
      clearInterval(heartbeat);
      agentEvents.push({ type: 'closed', code, generation: current, at: new Date().toISOString() });
      if (!stopped) reconnect = setTimeout(connectAgent, 100);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://fixture').pathname;
      if (req.method === 'GET' && path === '/health') return json(res, 200, { status: 'ok' });
      if (req.method === 'POST' && path === '/v1/responses') return await provider(req, res, await body(req));
      if (!path.startsWith('/control/') || req.headers.authorization !== `Bearer ${token}`) reject(401, 'Unauthorized');
      if (req.method === 'GET' && path === '/control/state') return json(res, 200, {
        cases: [...cases.values()].map(snapshot), agentEvents, generation });
      const match = path.match(/^\/control\/cases\/([A-Za-z0-9_-]{1,80})(\/release)?$/);
      if (req.method === 'GET' && match && !match[2]) return json(res, 200, snapshot(stateFor(match[1])));
      if (req.method !== 'POST') reject(404, 'Unknown control route');
      const input = await body(req);
      if (path === '/control/cases') {
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.caseId) || !['text', 'tool'].includes(input.kind)
          || !['provider_final', 'before_tool', 'tool_reply', 'none'].includes(input.holdPhase)
          || !Number.isInteger(input.maxHoldMs ?? 90000) || (input.maxHoldMs ?? 90000) < 1
          || (input.maxHoldMs ?? 90000) > 90000) reject(400, 'Invalid case');
        if (cases.has(input.caseId)) reject(409, 'Case already exists');
        if (cases.size >= 32) reject(429, 'Fixture case bound exceeded');
        const state = { ...input, maxHoldMs: input.maxHoldMs ?? 90000,
          events: [], providerCalls: [], toolCalls: [], pending: new Map(), released: new Set() };
        cases.set(input.caseId, state);
        return json(res, 201, snapshot(state));
      }
      if (match?.[2]) {
        const state = stateFor(match[1]);
        if (!['provider_final', 'before_tool', 'tool_reply'].includes(input.phase)) reject(400, 'Invalid phase');
        if (!state.released.has(input.phase)) {
          state.released.add(input.phase);
          event(state, 'released', { phase: input.phase });
          for (const finish of [...(state.pending.get(input.phase) || [])]) finish(true);
        }
        return json(res, 200, snapshot(state));
      }
      if (path === '/control/agent/configure') {
        if (agentConfig) reject(409, 'Agent already configured');
        if (!agentUrl || input.websocketUrl !== agentUrl || !input.targetId || !input.agentKey) reject(400, 'Invalid agent configuration');
        agentConfig = input;
        connectAgent();
        return json(res, 200, { configured: true });
      }
      if (path === '/control/agent/reconnect-gate' && typeof input.open === 'boolean') {
        reconnectOpen = input.open;
        return json(res, 200, { open: reconnectOpen });
      }
      reject(404, 'Unknown control route');
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.message });
      else res.destroy(error);
    }
  });
  return { server, close: async () => {
    stopped = true;
    clearTimeout(reconnect);
    clearInterval(heartbeat);
    agent?.terminate();
    for (const state of cases.values()) for (const waiters of state.pending.values()) {
      for (const finish of [...waiters]) finish(false);
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const runtime = createFixture({ token: process.env.FIXTURE_CONTROL_TOKEN,
    providerKey: process.env.FIXTURE_PROVIDER_KEY, agentUrl: process.env.FIXTURE_AGENT_URL,
    wsPackage: process.env.FIXTURE_WS_PACKAGE });
  runtime.server.listen(8099, '0.0.0.0');
  process.once('SIGTERM', () => runtime.close());
}
