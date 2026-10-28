import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { waitFor } from './runtime.mjs';
import { requestIngress } from './ingress.mjs';

export async function bootstrap(config, platform, runtime) {
  const cookies = new Map();
  const transcript = [];
  let csrf;
  async function request(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 0; ; attempt++) {
      const response = await requestIngress(`${config.ingress}/api/v1${path}`, { method,
        headers: { host: platform.host, origin: platform.origin, 'content-type': 'application/json',
          cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
          ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: payload, signal: AbortSignal.timeout(20000) });
      for (const cookie of response.headers.getSetCookie()) {
        const entry = cookie.split(';', 1)[0], at = entry.indexOf('=');
        cookies.set(entry.slice(0, at), entry.slice(at + 1));
        runtime.addRedaction(entry.slice(at + 1));
      }
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch { result = { error: { message: text.slice(0, 200) } }; }
      transcript.push({ method, path, status: response.status, at: new Date().toISOString() });
      runtime.save('requests.json', transcript);
      const error = result.error;
      if (attempt < 3 && response.status === 503 && error?.code === 'SERVICE_DRAINING'
        && error.outcome === 'not_started' && error.retryable === true && !response.redirected) {
        await delay(1000);
        continue;
      }
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(result).slice(0, 500)}`);
      return result;
    }
  }
  csrf = await waitFor('public API through ingress', async () => (await request('GET', '/auth/csrf')).csrfToken);
  const username = platform.namespace;
  await request('POST', '/auth/password/signup', { username, displayName: 'Rollout fixture',
    email: `${username}@example.invalid`, password: `Drain-${randomBytes(20).toString('hex')}!` });
  csrf = (await request('GET', '/auth/csrf')).csrfToken;
  const workspace = await request('POST', '/workspaces', { name: `Rollout ${username}` });
  const registration = await request('POST', `/workspaces/${workspace.id}/kubernetes-clusters`, { name: 'Rollout fixture' });
  runtime.addRedaction(registration.agentKey);
  const targetId = registration.cluster.id;
  await request('PUT', `/workspaces/${workspace.id}/ai-provider-credentials/openai`, { apiKey: platform.secret.FIXTURE_PROVIDER_KEY });
  await request('PATCH', `/workspaces/${workspace.id}/ai-settings`, {
    defaultProvider: 'openai', defaultModel: 'gpt-5.4-mini', reasoningSummaryMode: 'off', reasoningEffort: 'off' });
  await runtime.control('/agent/configure', { targetId, agentKey: registration.agentKey, websocketUrl: platform.agentUrl });
  await waitFor('agent and builtin tool catalog', async () => {
    const cluster = await request('GET', `/workspaces/${workspace.id}/kubernetes-clusters/${targetId}`);
    if (cluster.status !== 'online') return false;
    const catalog = await request('GET', `/workspaces/${workspace.id}/targets/${targetId}/mcp/catalog?limit=50`);
    const builtin = catalog.servers.find((server) => server.type === 'builtin');
    return builtin?.connectionStatus === 'ok'
      && builtin.tools.some((tool) => tool.name === 'rollout_probe' && tool.enabledEffective);
  });
  console.log('ok bootstrap and agent catalog');

  async function start(caseId, { kind = 'text', holdPhase = 'provider_final' } = {}) {
    await runtime.control('/cases', { caseId, kind, holdPhase });
    const session = await request('POST', `/workspaces/${workspace.id}/targets/${targetId}/sessions`, { title: caseId });
    const accepted = await request('POST', `/sessions/${session.id}/messages`, {
      content: `ROLLOUT_CASE:${caseId}`, toolAccessMode: 'read_only', clientMessageId: `msg-${caseId}`,
      llm: { provider: 'openai', model: 'gpt-5.4-mini', reasoningEffort: 'off' } });
    assert.ok(accepted.run_id, 'Acceptance must return a durable run ID');
    assert.match(accepted.run_id, /^[A-Za-z0-9_-]{1,200}$/);
    const run = { caseId, sessionId: session.id, runId: accepted.run_id, messageId: accepted.message_id, kind };
    transcript.push({ accepted: run });
    return run;
  }
  const state = (run) => runtime.control(`/cases/${run.caseId}`);
  const release = (run, phase = 'provider_final') => runtime.control(`/cases/${run.caseId}/release`, { phase });
  const status = (run) => request('GET', `/runs/${run.runId}`);
  const started = (run, event = 'provider_started') => waitFor(`${run.caseId} ${event}`, async () => {
    const current = await state(run);
    return current.events.some((item) => item.type === event) && current;
  });
  async function completed(run) {
    await waitFor(`${run.caseId} durable completion`, async () => {
      const current = await status(run);
      if (['failed', 'cancelled'].includes(current.status)) throw new Error(`${run.runId} ${current.status}: ${JSON.stringify(current.error || '')}`);
      return current.status === 'completed';
    });
    const messages = await request('GET', `/sessions/${run.sessionId}/messages`);
    const items = Array.isArray(messages) ? messages : messages.items;
    const finals = items.filter((item) => item.role === 'assistant'
      && JSON.stringify(item.content).includes(`case:${run.caseId}:completed`));
    assert.equal(finals.length, 1, 'Exactly one durable assistant completion');
    const evidence = await state(run);
    assert.equal(evidence.providerCalls.length, run.kind === 'tool' ? 2 : 1, 'No duplicate provider attempts');
    assert.equal(evidence.events.some((item) => ['hold_expired', 'fixture_error', 'provider_disconnected'].includes(item.type)), false,
      'No premature disconnect, hold expiry or fixture failure');
    if (run.kind === 'tool') {
      assert.equal(evidence.toolCalls.length, 1, 'Exactly one raw tool dispatch');
      assert.equal(evidence.toolCalls[0].replied, true, 'Tool response delivered on its original connection');
    }
    if (config.capacity === 'on') {
      assert.match(run.runId, /^[A-Za-z0-9_-]+$/);
      await waitFor(`${run.caseId} capacity settlement`, async () => await runtime.sql(
        `SELECT count(*) FROM workspace_run_reservations WHERE run_id='${run.runId}' AND settled_at IS NULL;`) === '0');
      assert.equal(await runtime.sql(`SELECT count(*) FROM workspace_run_operations WHERE run_id='${run.runId}' AND finished_at IS NULL;`), '0');
    }
    runtime.save(`${run.caseId}.json`, { run, evidence });
    console.log(`ok ${run.caseId}`);
    return evidence;
  }
  const cancel = (run) => request('POST', `/runs/${run.runId}/cancel`, {});
  return { start, state, release, status, started, completed, cancel, request, workspaceId: workspace.id, targetId,
    save: () => runtime.save('requests.json', transcript) };
}
