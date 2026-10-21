import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { experimental_createBridgeJsonRpcTestHarness as harnessFor } from '@get-bb/plugin-sdk/provider-bridge/testing';
import type { ProviderBridgeEntry } from '@get-bb/plugin-sdk/provider-bridge';
// @ts-expect-error The generated JavaScript artifact has no declaration file.
const { experimental_providerBridge: bridge } = await import('../dist/host.js') as { experimental_providerBridge: ProviderBridgeEntry };
import { bridgeOptions, readSettings } from '../src/config.js';

const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-smoke-'));
bridge.start?.({ pluginId: 'kimicode', dataDir: dir, tempDir: dir });
const harness = harnessFor(bridge.handleLine);
const providerOptions = bridgeOptions(readSettings({ envFile: resolve('.env'), executable: process.env.KIMI_EXECUTABLE ?? 'kimi' }));
let counter = 0;
const options = { model: 'kimi-for-coding', reasoningLevel: process.env.KIMI_SMOKE_REASONING ?? 'high', permissionMode: 'accept-edits', permissionScope: 'workspace', approvalReviewer: 'user', permissionEscalation: 'deny', providerOptions };
async function request(method: string, params: Record<string, unknown>) {
  const id = `smoke-${++counter}`;
  harness.sendRequest(id, method, params as import('@get-bb/plugin-sdk/provider-bridge/testing').BridgeJsonRpcObject);
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const response = harness.messages.find((m) => m.id === id && ('result' in m || 'error' in m));
    if (response) {
      if (response.error) throw new Error(`${method}: ${JSON.stringify(response.error)}`);
      return response.result as Record<string, unknown>;
    }
    await delay(50);
  }
  throw new Error(`Timeout: ${method}`);
}
try {
  await request('initialize', { protocolVersion: 2, client: { name: 'bb-kimi-smoke', version: '0.1.0' }, grammarVersions: [3, 3] });
  const models = await request('model/list', { cwd: dir, providerOptions });
  process.stderr.write(`Model catalog: ${JSON.stringify(models)}\n`);
  const available = models.models as { id: string; isDefault: boolean }[];
  options.model = process.env.KIMI_SMOKE_MODEL ?? available.find((model) => model.isDefault)?.id ?? available[0].id;
  const session = await request('thread/start', { threadId: 'kimi-smoke', cwd: dir, instructionMode: 'append', options });
  process.stderr.write('Session started.\n');
  const providerThreadId = session.providerThreadId;
  await request('turn/start', { threadId: 'kimi-smoke', providerThreadId, clientRequestId: 'creq_kimismqke2', input: [{ type: 'text', text: 'Reply with exactly KIMI_BB_OK. Do not use tools.', mentions: [] }], options });
  const deadline = Date.now() + 90000;
  function responseText() {
    return harness.messages.flatMap((m: any) => m.params?.deltas ?? []).filter((d: any) => d.kind === 'item.textDelta' && d.channel === 'agentMessage').map((d: any) => d.text).join('');
  }
  while (Date.now() < deadline && !responseText().includes('KIMI_BB_OK')) await delay(100);
  const success = responseText().includes('KIMI_BB_OK');
  process.stderr.write(`Real model response marker: ${success ? 'PASS' : 'FAIL'}\n`);
  if (!success) process.stderr.write(JSON.stringify(harness.messages.slice(-8)) + '\n');
  await request('thread/stop', { threadId: 'kimi-smoke', providerThreadId, activeTurnId: null, intent: 'release' });
  process.exitCode = success ? 0 : 1;
} catch (error) {
  process.stderr.write(String(error) + '\n'); process.exitCode = 1;
} finally {
  harness.restore(); process.exit(process.exitCode ?? 0);
}
