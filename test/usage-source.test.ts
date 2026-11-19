import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import { registerUsageSource, usageSourceContract, LIST_USAGE_RESOURCES as LIST, GET_USAGE_RESOURCE as GET } from '../src/usage-source.js';

const resourceId = JSON.stringify(['host-a', 'kimi-code']);
const quota = { status: 'ok', accountEmail: null, planLabel: 'Подписка Kimi Code', windows: [
  { label: 'За 5 часов', usedPercent: 12.5, resetsAt: '2026-11-19T18:22:26Z' },
  { label: 'За неделю', usedPercent: 78, resetsAt: null },
] };
const provider = { id: 'kimi-code', pluginId: 'kimicode', displayName: 'Kimi Code' };

function setup() {
  const hosts = [{ id: 'host-a', name: 'Mac', status: 'connected' }, { id: 'host-b', name: 'Remote', status: 'connected' }];
  const fixture = createFakePluginHost({ pluginId: 'kimicode', sdk: {
    hosts: { list: async () => hosts as any, get: async ({ hostId }) => hosts.find((h) => h.id === hostId) as any },
    providers: { list: async ({ hostId } = {}) => hostId === 'host-a' ? [provider] as any : [
      { ...provider, pluginId: 'another-plugin' }, { ...provider, id: 'another-provider' },
    ] as any },
    system: { usageLimits: async () => ({ 'kimi-code': quota }) as any },
  } });
  registerUsageSource(fixture.bb);
  return { ...fixture, hosts,
    list: async () => usageSourceContract[LIST].output.parse(await fixture.harness.behavior.callRpc(LIST, {})),
    get: async (refresh = false, id = resourceId) => usageSourceContract[GET].output.parse(
      await fixture.harness.behavior.callRpc(GET, { resourceId: id, refresh })),
  };
}

test('sidebar inventory discovers only owned host resources without collecting quotas', async () => {
  const f = setup();
  try {
    const result = await f.list();
    assert.deepEqual(result.resources, [{ id: resourceId, providerId: 'kimi-code', label: 'Kimi Code', accountKey: null,
      scope: { kind: 'host', hostId: 'host-a', hostName: 'Mac' } }]);
    assert.equal(f.harness.inspection.sdk.callsTo('system.usageLimits').length, 0);
    const usage = await f.get(true);
    assert.deepEqual(f.harness.inspection.sdk.callsTo('system.usageLimits')[0], [{ hostId: 'host-a', providerId: 'kimi-code', refresh: true }]);
    assert.equal(usage.accountKey, null);
    assert.ok(usage.observedAt);
    assert.equal(usage.usage.status, 'ok');
    if (usage.usage.status === 'ok') {
      assert.deepEqual(usage.usage.windows.map((w) => [w.kind, w.usedPercent, w.cost]), [['five-hour', 12.5, null], ['weekly', 78, null]]);
      assert.equal(usage.usage.plan, null, 'do not invent a membership tier');
    }
    await assert.rejects(f.get(false, JSON.stringify(['host-b', 'kimi-code'])));
    await assert.rejects(f.get(false, JSON.stringify(['host-a', 'codex'])));
    await assert.rejects(f.get(false, 'broken-id'));
    assert.equal(f.harness.inspection.sdk.callsTo('system.usageLimits').length, 1);
  } finally { await f.harness.lifecycle.dispose(); }
});

test('sidebar failures preserve last-success time without displaying stale success or secret errors', async () => {
  const f = setup();
  try {
    const first = await f.get();
    f.harness.inspection.sdk.stub('system.usageLimits', async () => { throw new Error('private-key/raw-body'); });
    const failed = await f.get(true);
    assert.equal(failed.usage.status, 'error');
    assert.equal(failed.observedAt, first.observedAt);
    assert.doesNotMatch(JSON.stringify(failed), /private-key|raw-body|windows/);
    f.harness.inspection.sdk.stub('system.usageLimits', async () => ({ 'kimi-code': { status: 'expired' } }));
    assert.equal((await f.get(true)).usage.status, 'expired');
    f.hosts[0].status = 'disconnected';
    assert.equal((await f.get(true)).usage.status, 'error');
    assert.equal(f.harness.inspection.sdk.callsTo('system.usageLimits').length, 3);
    f.hosts.splice(0, 1);
    assert.deepEqual((await f.list()).resources, []);
  } finally { await f.harness.lifecycle.dispose(); }
});

test('sidebar coalesces concurrent reads and honors refresh after an in-flight cached read', async () => {
  const f = setup();
  let release!: () => void;
  let calls = 0;
  f.harness.inspection.sdk.stub('system.usageLimits', async () => {
    if (++calls === 1) await new Promise<void>((resolve) => { release = resolve; });
    return { 'kimi-code': quota };
  });
  try {
    const initial = f.get(false), shared = f.get(false), fresh = f.get(true);
    await tick();
    assert.equal(calls, 1);
    release();
    await Promise.all([initial, shared, fresh]);
    assert.equal(calls, 2);
    assert.deepEqual(f.harness.inspection.sdk.callsTo('system.usageLimits').map((args) => (args[0] as { refresh: boolean }).refresh), [false, true]);
  } finally { await f.harness.lifecycle.dispose(); }
});
