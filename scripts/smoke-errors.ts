// Runs the installed Kimi CLI against an offline API fixture, through the built BB bridge.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { experimental_createBridgeJsonRpcTestHarness as harnessFor } from '@get-bb/plugin-sdk/provider-bridge/testing';
import type { ProviderBridgeEntry } from '@get-bb/plugin-sdk/provider-bridge';
import { bridgeOptions, DEFAULT_BASE_URL, readSettings } from '../src/config.js';
import { loadSubscriptionCatalog } from '../src/subscription-catalog.js';
// @ts-expect-error The generated JavaScript artifact has no declaration file.
const { experimental_providerBridge: bridge } = await import('../dist/host.js') as { experimental_providerBridge: ProviderBridgeEntry };

const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-error-smoke-'));
let requests = 0;
let fail = true;
const server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    requests++;
    if (fail) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3600' });
      res.end(JSON.stringify({ error: { type: 'rate_limit_reached_error', message: 'request reached organization TPD rate limit, current: 1501724, limit: 1500000' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = { id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'kimi-k3.1-pro', choices: [{ index: 0, delta: { role: 'assistant', content: 'KIMI_RECOVERED_OK' }, finish_reason: null }] };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = (server.address() as { port: number }).port;
const envFile = join(dir, '.env');
const sourceConfig = join(dir, 'source.toml');
writeFileSync(envFile, 'KIMI_API_KEY=fixture-only-key\n');
await loadSubscriptionCatalog({ dataDir: dir, key: 'fixture-only-key', baseUrl: DEFAULT_BASE_URL,
  fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'fixture-subscription', limit: { context: 262144 } }] })) });
writeFileSync(sourceConfig, `default_model = "mock/model"
[providers.mock]
type = "kimi"
base_url = "http://127.0.0.1:${port}/v1"
api_key = "fixture-only-key"
[models."mock/model"]
provider = "mock"
model = "kimi-k3.1-pro"
max_context_size = 1048576
`);
bridge.start?.({ pluginId: 'kimicode', dataDir: dir, tempDir: dir });
const harness = harnessFor(bridge.handleLine);
let serial = 0;
async function request(method: string, params: Record<string, any>) {
  const id = `smoke-${++serial}`;
  harness.sendRequest(id, method, params);
  for (let n = 0; n < 200; n++) {
    const reply = harness.messages.find((m) => m.id === id && ('result' in m || 'error' in m));
    if (reply) { assert.equal(reply.error, undefined, JSON.stringify(reply.error)); return reply.result as Record<string, any>; }
    await delay(50);
  }
  throw new Error(`Timeout: ${method}`);
}
function deltas() { return harness.messages.flatMap((m: any) => m.params?.deltas ?? []); }
async function waitForEnd(count: number) {
  for (let n = 0; n < 200; n++) {
    if (deltas().filter((d: any) => d.kind === 'turn.boundary' || (d.kind === 'provider.error' && d.settlesTurn)).length >= count) return;
    await delay(50);
  }
  throw new Error('Turn did not settle: ' + JSON.stringify(deltas().slice(-6)));
}
let providerThreadId: unknown;
try {
  await request('initialize', { protocolVersion: 2, client: { name: 'bb-kimi-error-smoke', version: '1.0.0' }, grammarVersions: [3, 3] });
  const providerOptions = bridgeOptions(readSettings({ sourceConfig, envFile, includeExternalModels: true, executable: process.env.KIMI_EXECUTABLE ?? 'kimi' }));
  const options = { model: 'mock/model', reasoningLevel: 'high', permissionMode: 'accept-edits', permissionScope: 'workspace', approvalReviewer: 'user', permissionEscalation: 'deny', providerOptions };
  const session = await request('thread/start', { threadId: 'error-smoke', cwd: dir, instructionMode: 'append', options });
  providerThreadId = session.providerThreadId;
  const turn = (text: string, id: string) => request('turn/start', { threadId: 'error-smoke', providerThreadId, clientRequestId: id, input: [{ type: 'text', text, mentions: [] }], options });
  await turn('Hello', 'creq_2222222222');
  await waitForEnd(1);
  assert.equal(requests, 1, 'the CLI must not silently wait for Retry-After: 3600');
  assert.match(JSON.stringify(deltas()), /daily token limit \(TPD\)/);
  process.stderr.write('HTTP 429 with Retry-After: 3600 surfaced and turn settled: PASS\n');
  fail = false;
  await turn('Reply with KIMI_RECOVERED_OK', 'creq_3333333333');
  await waitForEnd(2);
  assert.match(JSON.stringify(deltas()), /KIMI_RECOVERED_OK/);
  assert.equal(requests, 2);
  process.stderr.write('Recovery in the same Kimi session: PASS\n');
} catch (error) {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
} finally {
  if (providerThreadId) await request('thread/stop', { threadId: 'error-smoke', providerThreadId, activeTurnId: null, intent: 'release' });
  harness.restore();
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  rmSync(dir, { recursive: true, force: true });
}
