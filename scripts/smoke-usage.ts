// Subscription metadata GETs only; no model call and no Kimi CLI launch.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { providerUsageResultSchema } from '@get-bb/plugin-sdk/provider-bridge';
import type { ProviderBridgeEntry } from '@get-bb/plugin-sdk/provider-bridge';
import { experimental_createBridgeJsonRpcTestHarness as harnessFor } from '@get-bb/plugin-sdk/provider-bridge/testing';
import { bridgeOptions, readSettings } from '../src/config.js';
// @ts-expect-error Generated JavaScript has no declaration file.
const { experimental_providerBridge: bridge } = await import('../dist/host.js') as { experimental_providerBridge: ProviderBridgeEntry };
const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-usage-smoke-'));
bridge.start?.({ pluginId: 'kimicode', dataDir: dir, tempDir: dir });
const harness = harnessFor(bridge.handleLine);
const providerOptions = bridgeOptions(readSettings({ envFile: resolve(process.env.KIMI_USAGE_ENV_FILE ?? '.env'),
  baseUrl: process.env.KIMI_USAGE_BASE_URL, sourceConfig: 'none', executable: '/not-installed/usage-must-not-run-cli' }));
let serial = 0;
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Usage bridge check timed out.');
    await delay(20);
  }
}
async function request(method: string, params: Record<string, any>) {
  const id = ++serial;
  harness.sendRequest(id, method, params);
  await waitFor(() => harness.messages.some((m) => m.id === id));
  const reply = harness.messages.find((m) => m.id === id)!;
  assert.equal(reply.error, undefined, JSON.stringify(reply.error));
  return reply.result;
}
try {
  await request('initialize', { protocolVersion: 2, client: { name: 'usage-smoke', version: '1' }, grammarVersions: [3, 3] });
  const result = providerUsageResultSchema.parse(await request('provider/usage', { providerId: 'kimi-code', providerOptions }));
  assert.ok(result.supported && result.usage.status === 'ok', JSON.stringify(result));
  await request('turn/start', { threadId: 'usage-smoke', providerThreadId: 'usage-fixture', clientRequestId: 'creq_2222222222',
    input: [{ type: 'text', text: '/usage', mentions: [] }],
    options: { model: 'kimi-code/k3', permissionMode: 'full', permissionScope: 'full', approvalReviewer: null, permissionEscalation: null, providerOptions } });
  const deltas = () => harness.messages.flatMap((m: any) => m.params?.deltas ?? []);
  await waitFor(() => deltas().some((d: any) => d.kind === 'turn.boundary'));
  assert.equal(deltas().find((d: any) => d.kind === 'turn.boundary').status, 'completed');
  const text = deltas().filter((d: any) => d.kind === 'item.textDelta' && d.channel === 'agentMessage').map((d: any) => d.text).join('');
  assert.match(text, /Лимиты подписки Kimi Code/);
  assert.match(text, /использовано.*осталось/);
  assert.equal(existsSync(join(dir, 'kimi-home')), false);
  process.stderr.write(text + '\n\nprovider/usage and /usage through built BB bridge, without CLI/model/catalog: PASS\n');
} finally { harness.restore(); rmSync(dir, { recursive: true, force: true }); }
