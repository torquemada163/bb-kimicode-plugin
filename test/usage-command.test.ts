import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { experimental_assembleCapturedThreadEvents as assemble } from '@get-bb/plugin-sdk/provider-bridge/testing';
import { threadDeltaNotificationParamsSchema, providerUsageResultSchema } from '@get-bb/plugin-sdk/provider-bridge';
import type { ProviderUsageResult } from '@get-bb/plugin-sdk/provider-bridge';
import { createUsageHandler } from '../src/usage-command.js';
import { parseUsage } from '../src/usage.js';

const ok: ProviderUsageResult = { supported: true, usage: parseUsage({ usages: { limit_5h: { used_ratio: 0.25 } } }) };
const params = { threadId: 'usage-test', providerThreadId: 'fixture-session', clientRequestId: 'creq_2222222222',
  input: [{ type: 'text', text: '/usage', mentions: [] }],
  options: { model: 'kimi-code/k3', permissionMode: 'full', permissionScope: 'full', approvalReviewer: null, permissionEscalation: null,
    providerOptions: { kimiConfig: { envFile: '/host/private.env' } } } };

function setup(load: Parameters<typeof createUsageHandler>[0]) {
  const messages: any[] = [];
  const handler = createUsageHandler(load, (line) => { messages.push(JSON.parse(line)); });
  const harness = { messages, sendRequest(id: number, method: string, params: object) {
    assert.equal(handler.handle({ id, method, params }), true);
  }, restore() {} };
  return { handler, harness };
}

test('/usage is a schema-valid visible local turn, never forwarded to an agent', async () => {
  let calls = 0;
  const { handler, harness } = setup(async (options) => { calls++; assert.deepEqual(options, params.options.providerOptions); return ok; });
  try {
    harness.sendRequest(1, 'turn/start', params);
    await tick();
    assert.equal(calls, 1);
    assert.ok(harness.messages.some((m) => m.id === 1 && m.result));
    const notifications = harness.messages.filter((m) => m.method);
    for (const m of notifications) threadDeltaNotificationParamsSchema.parse(m.params);
    const events = assemble(notifications as any, 'kimi-code');
    assert.ok(events.some((e: any) => e.type === 'turn/input/accepted'));
    assert.ok(events.some((e: any) => e.type === 'item/agentMessage/delta' && /25%.*75%/.test(e.delta)));
    assert.ok(events.some((e: any) => e.type === 'turn/completed' && e.status === 'completed'));
    for (const input of [[{ type: 'text', text: '/usage extra', mentions: [] }],
      [{ type: 'text', text: 'Explain /usage', mentions: [] }],
      [...params.input, { type: 'text', text: 'also do this', mentions: [] }]]) {
      assert.equal(handler.handle({ id: 2, method: 'turn/start', params: { ...params, input } }), false);
    }
  } finally { handler.close(); harness.restore(); }
});

test('stop cancels /usage, settles once, and suppresses delayed output; next command works', async () => {
  let release!: (value: ProviderUsageResult) => void;
  let signal: AbortSignal | undefined;
  let calls = 0;
  const { handler, harness } = setup(async (_options, s) => {
    signal = s;
    if (++calls === 1) return new Promise((resolve) => { release = resolve; });
    return ok;
  });
  try {
    harness.sendRequest(1, 'turn/start', params);
    harness.sendRequest(2, 'turn/start', params);
    assert.ok(harness.messages.find((m) => m.id === 2)?.error);
    handler.stop(params.threadId);
    assert.equal(signal?.aborted, true);
    release(ok);
    await tick();
    let deltas = harness.messages.flatMap((m: any) => m.params?.deltas ?? []);
    assert.deepEqual(deltas.filter((d: any) => d.kind === 'turn.boundary').map((d: any) => d.status), ['interrupted']);
    assert.equal(deltas.some((d: any) => d.kind === 'item.textDelta'), false);
    harness.sendRequest(3, 'turn/start', params);
    await tick();
    deltas = harness.messages.flatMap((m: any) => m.params?.deltas ?? []);
    assert.deepEqual(deltas.filter((d: any) => d.kind === 'turn.boundary').map((d: any) => d.status), ['interrupted', 'completed']);
  } finally { handler.close(); harness.restore(); }
});

test('provider/usage returns standard BB limits without a CLI session; close cancels maintenance', async () => {
  let signal: AbortSignal | undefined;
  const { handler, harness } = setup(async (_options, s) => { signal = s; return ok; });
  try {
    harness.sendRequest(1, 'provider/usage', { providerId: 'kimi-code', providerOptions: params.options.providerOptions });
    await tick();
    assert.deepEqual(providerUsageResultSchema.parse(harness.messages.find((m) => m.id === 1)?.result), ok);
    harness.sendRequest(2, 'provider/usage', { providerId: 'other' });
    assert.deepEqual(harness.messages.find((m) => m.id === 2)?.result, { supported: false });
    handler.close();
    assert.equal(signal?.aborted, true);
  } finally { handler.close(); harness.restore(); }
});

test('/usage failures produce a visible failed turn, and a later request succeeds', async () => {
  let calls = 0;
  const { handler, harness } = setup(async () => ++calls === 1
    ? { supported: true, usage: { status: 'error', message: 'Лимиты временно недоступны (HTTP 500).', accountEmail: null, planLabel: null } }
    : ok);
  try {
    harness.sendRequest(1, 'turn/start', params);
    await tick();
    const notifications = harness.messages.filter((m) => m.method);
    const events = assemble(notifications as any, 'kimi-code');
    assert.ok(events.some((e: any) => e.type === 'item/agentMessage/delta' && /HTTP 500/.test(e.delta)));
    assert.ok(events.some((e: any) => e.type === 'turn/completed' && e.status === 'failed'));
    harness.sendRequest(2, 'turn/start', params);
    await tick();
    const boundaries = harness.messages.flatMap((m: any) => m.params?.deltas ?? []).filter((d: any) => d.kind === 'turn.boundary');
    assert.deepEqual(boundaries.map((d: any) => d.status), ['failed', 'completed']);
  } finally { handler.close(); }
});
