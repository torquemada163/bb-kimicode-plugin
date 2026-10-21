#!/usr/bin/env node
// Minimal offline ACP peer for exercising BB's real published bridge.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
let next = 0;
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const models = { currentModelId: '__kimi_env_model__', availableModels: [{ modelId: '__kimi_env_model__', name: 'Fixture Kimi' }] };
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const { id, method, params } = request;
  if (id === undefined) return;
  const reply = (result) => send({ id, result });
  switch (method) {
    case 'initialize':
      reply({ protocolVersion: 1, agentInfo: { name: 'kimi-fixture', version: '1.0.0' }, agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} }, promptCapabilities: { embeddedContext: true }, mcpCapabilities: { http: true } }, authMethods: [] }); break;
    case 'session/new': reply({ sessionId: `fixture-${randomUUID()}`, models }); break;
    case 'session/load': reply({ models }); break;
    case 'session/fork': reply({ sessionId: `fixture-${randomUUID()}`, models }); break;
    case 'session/set_model': reply({}); break;
    case 'session/prompt': {
      const prompt = params.prompt.map((p) => p.text ?? '').join('');
      if (!prompt.includes('/noop')) send({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'KIMI_FIXTURE_OK' } } } });
      reply({ stopReason: 'end_turn' }); break;
    }
    default: send({ id, error: { code: -32601, message: 'Unknown method' } });
  }
});
