import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

// Kept as source text because the host bundle minifies names and injects helpers.
const guardScript = `async function runKimiAcpGuard() {
    const { spawn } = await import('node:child_process');
    const { createInterface } = await import('node:readline');
    const { readdirSync, statSync, openSync, readSync, closeSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { setTimeout: delay } = await import('node:timers/promises');
    const executable = process.env.BB_KIMI_EXECUTABLE;
    const home = process.env.KIMI_CODE_HOME;
    if (!executable || !home)
        throw new Error('Missing Kimi launch configuration.');
    const childEnv = { ...process.env };
    delete childEnv.BB_KIMI_EXECUTABLE;
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, process.argv.slice(2), {
        env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const pending = new Map();
    const paths = new Map();
    const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
    function wirePath(sessionId) {
        if (paths.has(sessionId))
            return paths.get(sessionId);
        if (!/^[\\w-]+$/.test(sessionId))
            return;
        const root = join(home, 'sessions');
        try {
            for (const workspace of readdirSync(root, { withFileTypes: true })) {
                if (!workspace.isDirectory())
                    continue;
                const path = join(root, workspace.name, sessionId, 'agents', 'main', 'wire.jsonl');
                try {
                    statSync(path);
                    paths.set(sessionId, path);
                    return path;
                }
                catch { /* not this workspace */ }
            }
        }
        catch { /* The CLI may not have created a session yet. */ }
    }
    function size(path) {
        try {
            return path ? statSync(path).size : 0;
        }
        catch {
            return 0;
        }
    }
    function outcome(request) {
        const path = request.path ?? (request.sessionId ? wirePath(request.sessionId) : undefined);
        if (!path)
            return;
        let fd;
        try {
            const end = size(path);
            const start = Math.max(request.offset, end - 131072);
            if (end <= start)
                return;
            const buffer = Buffer.alloc(end - start);
            fd = openSync(path, 'r');
            const count = readSync(fd, buffer, 0, buffer.length, start);
            for (const line of buffer.subarray(0, count).toString('utf8').split('\\n').reverse()) {
                try {
                    const record = JSON.parse(line);
                    if (record.type === 'turn.ended' && record.agentId === 'main')
                        return record;
                }
                catch { /* Ignore incomplete records and a truncated first line. */ }
            }
        }
        catch { /* Unknown CLI layouts retain their original ACP result. */ }
        finally {
            if (fd !== undefined)
                closeSync(fd);
        }
    }
    function describeFailure(error) {
        // Never forward raw provider text: it can contain account ids or credentials.
        const message = typeof error.message === 'string' ? error.message : '';
        const status = Number(error.details?.statusCode);
        if (/TPD\\s+rate\\s+limit/i.test(message)) {
            const counts = /current:\\s*(\\d{1,15}),\\s*limit:\\s*(\\d{1,15})/i.exec(message);
            return 'Kimi API: daily token limit (TPD) reached' +
                (counts ? \` (reported: \${counts[1]}, limit: \${counts[2]})\` : '') +
                '. Check the selected API account limits or retry after the quota resets. The conversation is preserved.';
        }
        if (status === 429 || error.code === 'provider.rate_limit') {
            return 'Kimi API: rate limit reached (HTTP 429). Wait before retrying or check the selected API account limits. The conversation is preserved.';
        }
        if (status === 401 || status === 403 || error.code === 'provider.auth_error') {
            return 'Kimi API: authentication or access denied. Check the credentials for the selected model provider.';
        }
        if (status === 402 || /quota|balance/i.test(message)) {
            return 'Kimi API: account quota or balance exhausted. Check the account for the selected model provider.';
        }
        return 'Kimi API request failed' + (Number.isInteger(status) && status >= 400 && status <= 599 ? \` (HTTP \${status})\` : '') +
            '. Retry the message or check the Kimi session log on the execution host. The conversation is preserved.';
    }
    createInterface({ input: process.stdin }).on('line', (line) => {
        try {
            const request = JSON.parse(line);
            if ((typeof request.id === 'string' || typeof request.id === 'number') && typeof request.method === 'string') {
                const sessionId = request.params?.sessionId;
                const path = typeof sessionId === 'string' ? wirePath(sessionId) : undefined;
                pending.set(request.id, { method: request.method, sessionId, path, offset: size(path) });
            }
        }
        catch { /* Let the ACP server validate the original input. */ }
        child.stdin.write(line + '\\n');
    }).on('close', () => child.stdin.end());
    let output = Promise.resolve();
    createInterface({ input: child.stdout }).on('line', (line) => {
        output = output.then(async () => {
            let response;
            try {
                response = JSON.parse(line);
            }
            catch {
                process.stdout.write(line + '\\n');
                return;
            }
            const request = pending.get(response.id);
            if (request) {
                pending.delete(response.id);
                const sessionId = response.result?.sessionId ?? request.sessionId;
                if (typeof sessionId === 'string')
                    wirePath(sessionId);
                if (request.method === 'session/prompt' && response.result?.stopReason === 'end_turn') {
                    let ended = outcome(request);
                    // Persistence may flush just after ACP settles the turn.
                    for (let n = 0; !ended && n < 10; n++) {
                        await delay(50);
                        ended = outcome(request);
                    }
                    if (ended?.reason === 'failed' && ended.error && typeof ended.error === 'object') {
                        send({ jsonrpc: '2.0', id: response.id, error: { code: -32000, message: describeFailure(ended.error) } });
                        return;
                    }
                }
            }
            send(response);
        }).catch(() => {
            process.stderr.write('Kimi ACP error handling failed.\\n');
            child.kill();
            process.exitCode = 1;
        });
    });
    child.stderr.pipe(process.stderr);
    child.on('error', () => { process.stderr.write('Cannot start the configured Kimi executable.\\n'); process.exitCode = 1; });
    child.on('close', (code) => { void output.finally(() => process.exit(code ?? 1)); });
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    process.on('SIGINT', () => child.kill('SIGINT'));
}

runKimiAcpGuard().catch(() => { process.stderr.write("Cannot initialize Kimi ACP guard.\\n"); process.exitCode = 1; });
`;

export function writeAcpGuard(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'kimi-acp-guard.mjs');
  const script = guardScript;
  if (!existsSync(path) || readFileSync(path, 'utf8') !== script) {
    const temporary = join(dataDir, `kimi-acp-guard-${randomUUID()}.tmp`);
    writeFileSync(temporary, script, { mode: 0o600 });
    renameSync(temporary, path);
  }
  return path;
}
