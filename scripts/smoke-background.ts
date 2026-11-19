// Real Kimi CLI, fake credentials, loopback API only. No subscription calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { experimental_createBridgeJsonRpcTestHarness as harnessFor } from '@get-bb/plugin-sdk/provider-bridge/testing';
import type { ProviderBridgeEntry } from '@get-bb/plugin-sdk/provider-bridge';
import { bridgeOptions, DEFAULT_BASE_URL, readSettings } from '../src/config.js';
import { loadSubscriptionCatalog } from '../src/subscription-catalog.js';

type Reply = { text: string; wait?: Promise<void> } | { tool: string; args: object };
const replies: Reply[] = [];
const bodies: any[] = [];
const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-background-smoke-'));
const marker = join(dir, 'native-background-ran');
let apiFailure: unknown;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => { void (async () => {
    const parsed = JSON.parse(body);
    bodies.push(parsed);
    const reply = replies.shift();
    assert.ok(reply, 'Unexpected API call (possibly an autonomous turn)');
    if ('wait' in reply) await reply.wait;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = 'tool' in reply ? { role: 'assistant', tool_calls: [{ index: 0, id: `fixture_${bodies.length}`,
      type: 'function', function: { name: reply.tool, arguments: JSON.stringify(reply.args) } }] }
      : { role: 'assistant', content: reply.text };
    const chunk = { id: `mock-${bodies.length}`, object: 'chat.completion.chunk', created: 0, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason: null }] };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'tool' in reply ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  })().catch((error) => { apiFailure = error; res.writeHead(500); res.end(); }); });
});

async function until(check: () => boolean, description: string, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (apiFailure) throw apiFailure;
    if (Date.now() >= deadline) throw new Error(`Timeout: ${description}`);
    await delay(20);
  }
}

await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
const port = (server.address() as { port: number }).port;
const sourceConfig = join(dir, 'source.toml');
writeFileSync(sourceConfig, `default_model = "mock/model"
[providers.mock]
type = "kimi"
base_url = "http://127.0.0.1:${port}/v1"
api_key = "fixture-only-key"
[models."mock/model"]
provider = "mock"
model = "fixture"
max_context_size = 262144
`);
const executable = process.env.KIMI_EXECUTABLE ?? 'kimi';
const backgroundArgs = { command: `sleep 0.3; touch '${marker}'`, cwd: dir,
  run_in_background: true, description: 'Local ACP background regression fixture' };

async function reproduce() {
  // Deliberately omit the plugin policy in this independent control case.
  writeFileSync(join(dir, 'config.toml'), readFileSync(sourceConfig));
  const child = spawn(executable, ['acp'], { cwd: dir,
    env: { ...process.env, KIMI_CODE_HOME: dir, KIMI_DISABLE_TELEMETRY: '1',
      KIMI_MODEL_NAME: '', KIMI_MODEL_API_KEY: '', KIMI_CODE_CUSTOM_HEADERS: '' },
    stdio: ['pipe', 'pipe', 'pipe'] });
  const messages: any[] = [];
  let stderr = '';
  let closed = false;
  const exited = new Promise<void>((done) => child.once('close', () => { closed = true; done(); }));
  child.on('error', (error) => { stderr += error.message; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  const send = (value: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    messages.push(message);
    if (message.method === 'session/request_permission') send({ id: message.id,
      result: { outcome: { outcome: 'selected', optionId: message.params.options.find((o: any) => o.kind === 'allow_once').optionId } } });
  });
  let serial = 0;
  async function request(method: string, params: object) {
    const id = ++serial;
    send({ id, method, params });
    try {
      await until(() => {
        if (closed) throw new Error(`CLI exited: ${stderr.slice(-2000)}`);
        return messages.some((m) => m.id === id && !m.method);
      }, method);
    } catch (error) { throw new Error(`${error}; ${stderr.slice(-2000)}`); }
    const response = messages.find((m) => m.id === id && !m.method);
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response.result;
  }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'bb-kimi-background-control', version: '1' } });
    const session = await request('session/new', { cwd: dir, mcpServers: [] });
    replies.push({ tool: 'Bash', args: backgroundArgs }, { text: 'BACKGROUND_STARTED' },
      { text: 'AUTONOMOUS_RESULT', wait: gate }, { text: 'QUEUED_USER_RESULT' });
    const prompt = (text: string) => request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text }] });
    await prompt('Start the fixture background command.');
    await until(() => bodies.length === 3, 'autonomous API request');
    assert.ok(existsSync(marker));
    const before = messages.length;
    const result = await prompt('Follow-up while the autonomous turn is busy.');
    assert.equal(result.stopReason, 'end_turn');
    assert.equal(messages.slice(before).filter((m) => m.method === 'session/update').length, 0);
    release();
    await until(() => bodies.length === 4, 'queued user request runs later');
    process.stderr.write('Original bug reproduced: empty end_turn while the CLI later executes the queued prompt: PASS\n');
  } finally {
    release();
    child.kill();
    const kill = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 2000);
    await exited;
    clearTimeout(kill);
    lines.close();
  }
}

async function verify() {
  // @ts-expect-error Generated JavaScript has no declaration file.
  const { experimental_providerBridge: bridge } = await import('../dist/host.js') as { experimental_providerBridge: ProviderBridgeEntry };
  const envFile = join(dir, '.env');
  writeFileSync(envFile, 'KIMI_API_KEY=fixture-only-key\n');
  await loadSubscriptionCatalog({ dataDir: dir, key: 'fixture-only-key', baseUrl: DEFAULT_BASE_URL,
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'fixture-subscription', limit: { context: 262144 } }] })) });
  bridge.start?.({ pluginId: 'kimicode', dataDir: dir, tempDir: dir });
  const harness = harnessFor(bridge.handleLine);
  let serial = 0;
  async function request(method: string, params: Record<string, any>) {
    const id = ++serial;
    harness.sendRequest(id, method, params);
    await until(() => harness.messages.some((m) => m.id === id), method);
    const response = harness.messages.find((m) => m.id === id)!;
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response.result as Record<string, any>;
  }
  const deltas = () => harness.messages.flatMap((m: any) => m.params?.deltas ?? []);
  const providerOptions = bridgeOptions(readSettings({ sourceConfig, envFile, includeExternalModels: true, executable }));
  const options = { model: 'mock/model', permissionMode: 'full', permissionScope: 'full', approvalReviewer: null, permissionEscalation: null, providerOptions };
  let session: any;
  let turns = 0;
  async function turn(text: string) {
    const boundary = ++turns;
    const before = deltas().length;
    await request('turn/start', { threadId: 'background-smoke', providerThreadId: session.providerThreadId,
      clientRequestId: `creq_${'abcdefghijkmnpqrstuvwxyz'[boundary].repeat(10)}`, input: [{ type: 'text', text, mentions: [] }], options });
    await until(() => deltas().filter((d: any) => d.kind === 'turn.boundary' || (d.kind === 'provider.error' && d.settlesTurn)).length >= boundary, 'turn completion');
    const current = deltas().slice(before);
    assert.equal(current.some((d: any) => d.kind === 'provider.error'), false, JSON.stringify(current));
    return current.filter((d: any) => d.kind === 'item.textDelta' && d.channel === 'agentMessage').map((d: any) => d.text).join('');
  }
  try {
    await request('initialize', { protocolVersion: 2, client: { name: 'bb-kimi-background-smoke', version: '1' }, grammarVersions: [3, 3] });
    session = await request('thread/start', { threadId: 'background-smoke', cwd: dir, instructionMode: 'append', options });
    const cases = [
      { tool: 'Bash', args: backgroundArgs, expected: /Background execution is not available/ },
      { tool: 'Agent', args: { prompt: 'Return OK', description: 'Background regression', run_in_background: true }, expected: /background.*(?:disabled|not available)|not.*background/i },
      { tool: 'TaskList', args: {}, expected: /disabled/ },
      { tool: 'CronCreate', args: { cron: '* * * * *', prompt: 'Return OK' }, expected: /disabled/ },
      { tool: 'Bash', args: { command: `sleep 2; touch '${marker}'`, cwd: dir, timeout: 1 }, expected: /killed by timeout/i },
      { tool: 'Bash', args: { command: 'echo FOREGROUND_OK', cwd: dir }, expected: /FOREGROUND_OK/ },
    ];
    for (const item of cases) {
      replies.push({ tool: item.tool, args: item.args }, { text: 'FIXTURE_TURN_OK' });
      const at = bodies.length;
      assert.match(await turn(`Run fixture ${item.tool}.`), /FIXTURE_TURN_OK/);
      assert.equal(bodies.length, at + 2);
      const outputs = bodies.at(-1).messages.filter((m: any) => m.role === 'tool');
      assert.match(JSON.stringify(outputs.at(-1)), item.expected);
      assert.equal(existsSync(marker), false, 'a rejected/timed-out command must not complete later');
      replies.push({ text: 'FOLLOWUP_OK' });
      assert.match(await turn('Reply to the follow-up.'), /FOLLOWUP_OK/);
      await delay(400);
      assert.equal(bodies.length, at + 3, 'no autonomous model request after settling');
      process.stderr.write(`${item.tool}: ${item.expected}; visible follow-up in the same session: PASS\n`);
    }
    const tools = bodies[0].tools.map((t: any) => t.function.name);
    for (const tool of ['TaskList', 'TaskOutput', 'TaskStop', 'WaitFor', 'CronCreate']) assert.equal(tools.includes(tool), false);
    for (const tool of ['Bash', 'Agent']) assert.ok(tools.includes(tool));
    const started = join(dir, 'foreground-started');
    replies.push({ tool: 'Bash', args: { command: `touch '${started}'; sleep 10; touch '${marker}'`, cwd: dir, timeout: 30 } });
    const interrupted = turn('Run the foreground command until interrupted.');
    await until(() => existsSync(started), 'foreground command started');
    await request('thread/stop', { threadId: 'background-smoke', providerThreadId: session.providerThreadId, activeTurnId: null, intent: 'interrupt' });
    await interrupted;
    // BB releases the ACP runtime on stop, then resumes it for the next turn.
    session = await request('thread/resume', { threadId: 'background-smoke', providerThreadId: session.providerThreadId, cwd: dir, instructionMode: 'append', options });
    replies.push({ text: 'AFTER_STOP_OK' });
    assert.match(await turn('Reply after stopping the command.'), /AFTER_STOP_OK/);
    assert.equal(existsSync(marker), false);
    process.stderr.write('Interrupt/resume stops a foreground command and preserves the next visible reply: PASS\n');
    await request('thread/stop', { threadId: 'background-smoke', providerThreadId: session.providerThreadId, activeTurnId: null, intent: 'release' });
    session = await request('thread/resume', { threadId: 'background-smoke', providerThreadId: session.providerThreadId, cwd: dir, instructionMode: 'append', options });
    replies.push({ tool: 'Bash', args: backgroundArgs }, { text: 'RESUMED_POLICY_OK' });
    assert.match(await turn('Check the background policy after resuming.'), /RESUMED_POLICY_OK/);
    assert.match(JSON.stringify(bodies.at(-1).messages.filter((m: any) => m.role === 'tool').at(-1)), /Background execution is not available/);
    replies.push({ text: 'RESUMED_FOLLOWUP_OK' });
    assert.match(await turn('Reply after resuming.'), /RESUMED_FOLLOWUP_OK/);
    const calls = bodies.length;
    await delay(1100);
    assert.equal(bodies.length, calls);
    assert.equal(existsSync(marker), false);
    process.stderr.write('Release/resume retains the policy and visible follow-up replies: PASS\n');
    const root = join(dir, 'kimi-home/sessions');
    const wire = readdirSync(root).flatMap((workspace) => readdirSync(join(root, workspace)).map((id) => join(root, workspace, id, 'agents/main/wire.jsonl')))
      .filter(existsSync).flatMap((path) => readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line)));
    assert.equal(wire.some((x) => x.type === 'turn.prompt' && x.origin?.kind === 'task'), false);
    assert.equal(wire.filter((x) => x.type === 'turn.prompt' && x.origin?.kind === 'user').length, turns);
  } finally {
    try { if (session) await request('thread/stop', { threadId: 'background-smoke', providerThreadId: session.providerThreadId, activeTurnId: null, intent: 'release' }); }
    finally { harness.restore(); }
  }
}

try {
  if (process.argv.includes('--reproduce')) await reproduce();
  else await verify();
  if (apiFailure) throw apiFailure;
} finally {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(dir, { recursive: true, force: true });
}
