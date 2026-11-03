import { createInterface } from 'node:readline';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.env.KIMI_CODE_HOME, 'sessions', 'workspace', 'fixture-session', 'agents', 'main');
mkdirSync(dir, { recursive: true });
const wire = join(dir, 'wire.jsonl');
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'session/new') { send({ id, result: { sessionId: 'fixture-session' } }); return; }
  if (method !== 'session/prompt') { send({ id, result: {} }); return; }
  const text = params.prompt[0].text;
  const failure = ['tpd', 'tpd-delayed', 'cancelled'].includes(text) ? {
    code: 'provider.rate_limit', message: 'org-private / ak-private secret-key TPD rate limit, current: 1501724, limit: 1500000', details: { statusCode: 429 },
  } : text === 'server-error' ? {
    code: 'provider.server_error', message: 'secret-key org-private', details: { statusCode: 503 },
  } : undefined;
  const ended = { type: 'turn.ended', agentId: 'main', reason: failure ? 'failed' : 'completed', error: failure };
  const persist = () => appendFileSync(wire, JSON.stringify(ended) + '\n');
  if (text === 'tpd-delayed') setTimeout(persist, 100);
  else persist();
  if (!failure) send({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'RECOVERED_OK' } } } });
  send({ id, result: { stopReason: text === 'cancelled' ? 'cancelled' : 'end_turn' } });
});
