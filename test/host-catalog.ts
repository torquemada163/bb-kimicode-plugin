import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { experimental_createBridgeJsonRpcTestHarness as harnessFor } from '@get-bb/plugin-sdk/provider-bridge/testing';
import { experimental_providerBridge as bridge } from '../host.js';
import { bridgeOptions, readSettings } from '../src/config.js';
import { seedSubscription } from './fixtures/subscription.js';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-catalog-bridge-'));
  const envFile = join(dir, '.env');
  writeFileSync(envFile, 'KIMI_API_KEY=fixture-key\n');
  await seedSubscription(dir, 'fixture-key');
  const providerOptions = bridgeOptions(readSettings({ envFile, sourceConfig: 'none', executable: '/not-installed/should-never-run' }));
  bridge.start?.({ pluginId: 'kimicode', dataDir: dir, tempDir: dir });
  const harness = harnessFor(bridge.handleLine);
  let next = 0;
  async function request(method: string, params: Record<string, any>): Promise<any> {
    const id = ++next;
    harness.sendRequest(id, method, params);
    for (let n = 0; n < 100; n++) {
      const reply = harness.messages.find((m) => m.id === id);
      if (reply) return reply;
      await delay(10);
    }
    throw new Error(`No reply: ${method}`);
  }
  try {
    await request('initialize', { protocolVersion: 2, client: { name: 'catalog-test', version: '1' }, grammarVersions: [3, 3] });
    const result = await request('model/list', { cwd: dir, providerOptions });
    assert.equal(result.result.models.length, 6);
    assert.ok(result.result.models.every((m: any) => m.id.startsWith('kimi-code/') && m.displayName.includes('подписка Kimi Code')));
    for (const model of ['kimi-code/retired-model', 'moonshot-cn/kimi-k3.1-pro']) {
      const failure = await request('thread/start', { threadId: 'catalog-test', cwd: dir, instructionMode: 'append',
        options: { model, permissionMode: 'accept-edits', permissionScope: 'workspace', approvalReviewer: 'user', permissionEscalation: 'deny', providerOptions } });
      assert.match(failure.error.message, /модель отсутствует/);
      assert.doesNotMatch(failure.error.message, /fixture-key/);
    }
    const starting = request('thread/start', { threadId: 'cancel-catalog', cwd: dir, instructionMode: 'append',
      options: { model: 'kimi-code/k3.1-pro', permissionMode: 'accept-edits', permissionScope: 'workspace', approvalReviewer: 'user', permissionEscalation: 'deny', providerOptions } });
    await request('thread/stop', { threadId: 'cancel-catalog', activeTurnId: null, intent: 'release' });
    assert.match((await starting).error.message, /отменён/);
  } finally { harness.restore(); rmSync(dir, { recursive: true, force: true }); }
}

await main();
process.stderr.write("Subscription catalog and unavailable-model guard: PASS\n");
