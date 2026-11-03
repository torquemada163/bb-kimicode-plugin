import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeAcpGuard } from '../src/acp-guard.js';

test('ACP guard surfaces hidden failures, redacts provider text, and allows recovery in the same session', { timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-guard-'));
  const child = spawn(process.execPath, [writeAcpGuard(dir), resolve('test/fixtures/failing-acp-agent.mjs')], {
    env: { ...process.env, KIMI_CODE_HOME: dir, BB_KIMI_EXECUTABLE: process.execPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const messages: any[] = [];
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => messages.push(JSON.parse(line)));
  let serial = 0;
  async function request(method: string, params: object) {
    const id = ++serial;
    const reply = new Promise<any>((resolveReply, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Timeout: ${method}; ${stderr}`)); }, 2000);
      function onLine(line: string) {
        const message = JSON.parse(line);
        if (message.id === id) { cleanup(); resolveReply(message); }
      }
      function cleanup() { clearTimeout(timer); lines.off('line', onLine); }
      lines.on('line', onLine);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return reply;
  }
  try {
    await request('session/new', {});
    const prompt = (text: string) => request('session/prompt', { sessionId: 'fixture-session', prompt: [{ type: 'text', text }] });
    const failure = await prompt('tpd');
    assert.match(failure.error.message, /daily token limit \(TPD\).*1501724.*1500000/);
    assert.equal(failure.result, undefined);
    const recovered = await prompt('ok');
    assert.equal(recovered.result.stopReason, 'end_turn');
    assert.equal(recovered.error, undefined, 'a previous turn error must not poison the next turn');
    assert.ok(JSON.stringify(messages).includes('RECOVERED_OK'));
    assert.match((await prompt('tpd-delayed')).error.message, /daily token limit/);
    assert.equal((await prompt('cancelled')).result.stopReason, 'cancelled');
    const serverError = await prompt('server-error');
    assert.match(serverError.error.message, /HTTP 503/);
    assert.doesNotMatch(JSON.stringify(messages), /org-private|ak-private|secret-key/);
  } finally {
    child.kill();
    await new Promise<void>((resolveExit) => child.once('close', () => resolveExit()));
    rmSync(dir, { recursive: true, force: true });
  }
});
