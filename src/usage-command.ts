import { createBridgeIo, providerMaintenanceParamsSchema, THREAD_DELTA_NOTIFICATION_METHOD, turnStartParamsSchema } from '@get-bb/plugin-sdk/provider-bridge';
import type { ThreadDelta } from '@get-bb/plugin-sdk/provider-bridge';
import { loadHostUsage, formatUsage } from './usage.js';

/** Local, model-free /usage turns and sessionless BB subscription usage reads. */
export function createUsageHandler(load = loadHostUsage, write?: (line: string) => void) {
  const io = createBridgeIo({ write });
  const lifetime = new AbortController();
  const turns = new Map<string, AbortController>();
  let serial = 0;
  const deltas = (threadId: string, values: ThreadDelta[]) => io.send({ jsonrpc: '2.0',
    method: THREAD_DELTA_NOTIFICATION_METHOD, params: { threadId, deltas: values } });
  return {
    handle(message: Record<string, unknown>): boolean {
      const id = message.id;
      if (typeof id !== 'string' && typeof id !== 'number') return false;
      if (message.method === 'provider/usage') {
        const params = providerMaintenanceParamsSchema.safeParse(message.params);
        if (!params.success) { io.sendError(id, -32602, 'Invalid provider/usage parameters.'); return true; }
        if (params.data.providerId !== 'kimi-code') { io.sendResult(id, { supported: false }); return true; }
        void load(params.data.providerOptions ?? {}, lifetime.signal).then((result) => {
          if (!lifetime.signal.aborted) io.sendResult(id, result);
        }).catch(() => {
          if (!lifetime.signal.aborted) io.sendError(id, -32000, 'Не удалось получить лимиты Kimi Code.');
        });
        return true;
      }
      const raw = message.params as Record<string, unknown> | undefined;
      if ((message.method === 'turn/start' || message.method === 'turn/steer') &&
        typeof raw?.threadId === 'string' && turns.has(raw.threadId)) {
        io.sendError(id, -32000, 'Дождитесь завершения /usage или остановите текущий ход.');
        return true;
      }
      if (message.method !== 'turn/start' || !Array.isArray(raw?.input) || raw.input.length !== 1) return false;
      const input = raw.input[0];
      if (input?.type !== 'text' || typeof input.text !== 'string' || input.text.trim() !== '/usage' || input.mentions?.length) return false;
      const params = turnStartParamsSchema.safeParse(message.params);
      if (!params.success) { io.sendError(id, -32602, 'Invalid /usage turn parameters.'); return true; }
      const { threadId, clientRequestId, options } = params.data;
      const controller = new AbortController();
      const key = { channel: `kimi-usage-${++serial}` };
      turns.set(threadId, controller);
      deltas(threadId, [{ kind: 'turn.open' }, { kind: 'input.accepted', clientRequestId }]);
      io.sendResult(id, { threadId });
      void load(options.providerOptions ?? {}, AbortSignal.any([lifetime.signal, controller.signal])).then((result) => {
        if (lifetime.signal.aborted || turns.get(threadId) !== controller) return;
        const text = formatUsage(result);
        const ok = result.supported && result.usage.status === 'ok';
        deltas(threadId, [
          { kind: 'item.textDelta', key, channel: 'agentMessage', text },
          { kind: 'item.textClose', key, channel: 'agentMessage' },
          { kind: 'turn.boundary', status: ok ? 'completed' : 'failed', ...(ok ? {} : { error: { message: text } }) },
        ]);
      }).catch(() => {
        if (!lifetime.signal.aborted && turns.get(threadId) === controller) {
          deltas(threadId, [{ kind: 'turn.boundary', status: 'failed', error: { message: 'Не удалось получить лимиты Kimi Code.' } }]);
        }
      }).finally(() => { if (turns.get(threadId) === controller) turns.delete(threadId); });
      return true;
    },
    stop(threadId: string) {
      const controller = turns.get(threadId);
      if (!controller) return;
      turns.delete(threadId);
      controller.abort();
      deltas(threadId, [{ kind: 'turn.boundary', status: 'interrupted' }]);
    },
    close() {
      lifetime.abort();
      for (const controller of turns.values()) controller.abort();
      turns.clear();
    },
  };
}
