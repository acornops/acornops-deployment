import assert from 'node:assert/strict';
import { waitFor } from './runtime.mjs';

export async function runScenarios(config, platform, runtime, api) {
  const baseline = await api.start('baseline', { holdPhase: 'none' });
  await api.completed(baseline);

  for (const component of ['control-plane', 'execution-engine', 'llm-gateway']) {
    const held = await api.start(`inference-${component}`);
    const initial = await api.started(held);
    const rollout = await runtime.restart(component);
    if (component === 'control-plane') await runtime.settled(rollout);
    else await runtime.drained(rollout, component === 'llm-gateway' ? initial.providerCalls[0].peer : undefined);
    const fresh = await api.start(`fresh-${component}`, { holdPhase: 'none' });
    await api.completed(fresh);
    assert.equal((await api.state(held)).events.some((event) => event.type === 'provider_disconnected'), false);
    await api.release(held);
    await api.completed(held);
    await runtime.settled(rollout);
  }

  await ownerHandoff(platform, runtime, api);
  await queuedReclaim(config, platform, runtime, api);
  await cancellation(config, platform, runtime, api);
  await overlapping(runtime, api);
}

async function ownerHandoff(platform, runtime, api) {
  const key = `cp:agent:owner:${api.targetId}`;
  const owner = JSON.parse(await runtime.redis(key));
  const observation = await runtime.observeRpc(owner.instanceId);
  try {
    let held;
    for (let attempt = 0; attempt < 8; attempt++) {
      const offset = observation.records.length;
      const candidate = await api.start(`owner-${attempt}`, { kind: 'tool', holdPhase: 'tool_reply' });
      const received = await api.started(candidate, 'tool_received');
      if (observation.records.slice(offset).some((event) => event.method === 'tools/call'
        && event.agentRequestId === received.toolCalls[0].id
        && event.originInstanceId && event.originInstanceId !== owner.instanceId)) {
        held = candidate;
        break;
      }
      await api.release(candidate, 'tool_reply');
      await api.completed(candidate);
    }
    assert.ok(held, 'A real cross-replica owner RPC must be observed through normal Service routing');
    const next = await api.start('owner-next', { kind: 'tool', holdPhase: 'before_tool' });
    await api.started(next);
    const rollout = await runtime.restart('control-plane');
    await runtime.drained(rollout);
    await waitFor('owning connection marked draining', async () => {
      const value = await runtime.redis(key);
      return value && JSON.parse(value).state === 'draining';
    }, 25000);
    await api.release(next, 'before_tool');
    await api.started(next, 'provider_tool_emitted');
    assert.equal((await api.state(next)).toolCalls.length, 0, 'Next command waits for owner handoff');
    await api.release(held, 'tool_reply');
    const first = await api.completed(held);
    const second = await api.completed(next);
    assert.ok(second.toolCalls[0].generation > first.toolCalls[0].generation, 'Next tool uses reconnected agent');
    const replacement = JSON.parse(await runtime.redis(key));
    assert.notEqual(replacement.instanceId, owner.instanceId, 'Agent owner changed');
    runtime.save('owner-handoff.json', { oldOwner: owner.instanceId, newOwner: replacement.instanceId,
      rpc: observation.records, first, second });
    await runtime.settled(rollout);
  } finally { observation.close(); }
}

async function setConcurrency(platform, runtime, count) {
  await runtime.scoped(['set', 'env', `deployment/${platform.name('execution-engine')}`, `MAX_CONCURRENT_RUNS=${count}`]);
  await runtime.scoped(['rollout', 'status', `deployment/${platform.name('execution-engine')}`, '--timeout=180s'], { timeoutMs: 190000 });
}

async function queuedReclaim(config, platform, runtime, api) {
  if (config.capacity === 'off') await setConcurrency(platform, runtime, 1);
  try {
    // Fill the immutable workspace plan's four slots in capacity mode. Changing
    // a plan's limits in place would violate the existing catalogue contract.
    const held = [];
    for (let index = 0; index < (config.capacity === 'on' ? 4 : 1); index++) {
      const run = await api.start(`queue-active-${index}`);
      await api.started(run);
      held.push(run);
    }
    const queued = await api.start('queue-waiting', { holdPhase: 'none' });
    await waitFor('second run durably queued', async () => (await api.status(queued)).status === 'queued');
    assert.equal((await api.state(queued)).providerCalls.length, 0);
    const activeKey = `${platform.namespace}:run_lock:${held[0].runId}`;
    const queuedKey = `${platform.namespace}:run_lock:${queued.runId}`;
    const owner = config.capacity === 'off' ? await runtime.redis(activeKey) : undefined;
    if (config.capacity === 'off') {
      assert.ok(owner, 'Active run lock exists');
      await waitFor('queued run claimed by old registry', async () => await runtime.redis(queuedKey) === owner);
    }
    const rollout = await runtime.restart('execution-engine');
    await runtime.drained(rollout);
    if (config.capacity === 'off') {
      await api.completed(queued);
      assert.equal(await runtime.redis(activeKey), owner, 'Draining engine retains active ownership');
      assert.ok((await runtime.pods('execution-engine')).some((pod) => pod.metadata.deletionTimestamp
        && rollout.old.some((old) => old.uid === pod.metadata.uid)), 'Queue reclaimed before old engine exits');
    } else {
      const records = await runtime.pods('execution-engine');
      assert.ok(records.some((pod) => !rollout.old.some((old) => old.uid === pod.metadata.uid)), 'Replacement exists');
      assert.equal((await api.state(queued)).providerCalls.length, 0, 'Workspace capacity still gates queued work');
    }
    await api.release(held[0]);
    await api.completed(held[0]);
    if (config.capacity === 'on') await api.completed(queued);
    for (const run of held.slice(1)) {
      await api.release(run);
      await api.completed(run);
    }
    await runtime.settled(rollout);
  } finally { if (config.capacity === 'off') await setConcurrency(platform, runtime, 4); }
}

async function cancellation(config, platform, runtime, api) {
  const held = await api.start('cancel-draining-engine');
  await api.started(held);
  const rollout = await runtime.restart('execution-engine');
  await runtime.drained(rollout);
  await api.cancel(held);
  await waitFor('draining engine stops provider after durable cancellation', async () => {
    const state = await api.state(held);
    assert.equal(state.events.some((event) => event.type === 'hold_expired'), false);
    return state.events.some((event) => event.type === 'provider_disconnected');
  }, 15000);
  assert.equal((await api.status(held)).status, 'cancelled');
  assert.equal((await api.state(held)).providerCalls.length, 1);
  if (config.capacity === 'off') {
    await waitFor('cancelled lock released', async () => !await runtime.redis(`${platform.namespace}:run_lock:${held.runId}`));
  } else {
    await waitFor('cancelled reservation settled', async () => await runtime.sql(
      `SELECT count(*) FROM workspace_run_reservations WHERE run_id='${held.runId}' AND settled_at IS NULL;`) === '0');
  }
  runtime.save('cancellation.json', { run: held, evidence: await api.state(held) });
  await runtime.settled(rollout);
  console.log('ok cancellation reached draining engine');
}

async function overlapping(runtime, api) {
  const inference = await api.start('overlap-inference');
  const tool = await api.start('overlap-tool', { kind: 'tool', holdPhase: 'tool_reply' });
  const initial = await api.started(inference);
  await api.started(tool, 'tool_received');
  const rollouts = await Promise.all(['control-plane', 'execution-engine', 'llm-gateway'].map((component) => runtime.restart(component)));
  await Promise.all(rollouts.map((record) => runtime.drained(record,
    record.component === 'llm-gateway' ? initial.providerCalls[0].peer : undefined)));
  const terminating = await Promise.all(rollouts.map(async (record) => (await runtime.pods(record.component))
    .some((pod) => pod.metadata.deletionTimestamp && record.old.some((old) => old.uid === pod.metadata.uid))));
  assert.ok(terminating.filter(Boolean).length >= 2, 'Multiple old services terminate simultaneously while work is held');
  const fresh = await api.start('overlap-fresh', { holdPhase: 'none' });
  await api.completed(fresh);
  await api.release(tool, 'tool_reply');
  await api.release(inference);
  await Promise.all([api.completed(tool), api.completed(inference)]);
  await Promise.all(rollouts.map((record) => runtime.settled(record)));
}
