import { experimental_acpProviderBridge as acp } from '@get-bb/plugin-sdk/provider-bridge/acp';
import { experimental_defineProviderBridge } from '@get-bb/plugin-sdk/provider-bridge';
import { normalizeReasoningOptions } from './src/reasoning.js';
import { asRecord, prepareHostOptions } from './src/credentials.js';
import { pickerModels } from './src/catalog.js';

let hostDataDir: string | undefined;
let closing = false;
const stopped = new Map<string, number>();

export const experimental_providerBridge = experimental_defineProviderBridge({
  start(context) {
    hostDataDir = context.dataDir;
    closing = false;
    acp.start?.(context);
  },
  handleLine(line) {
    let message: Record<string, unknown>;
    try { message = asRecord(JSON.parse(line)); }
    catch { acp.handleLine(line); return; }
    const params = asRecord(message.params);
    const threadId = typeof params.threadId === 'string' ? params.threadId : undefined;
    if (message.method === 'thread/stop') {
      if (threadId) stopped.set(threadId, (stopped.get(threadId) ?? 0) + 1);
      acp.handleLine(line);
      return;
    }
    const generation = threadId ? stopped.get(threadId) ?? 0 : 0;
    const execution = asRecord(params.options);
    const owner = 'providerOptions' in execution ? execution : params;
    const options = asRecord(owner.providerOptions);
    if ('kimiConfig' in options) {
      void (async () => { try {
        if (!hostDataDir) throw new Error('Kimi Code bridge is not initialized.');
        const { kimiCatalog, ...prepared } = await prepareHostOptions(options, hostDataDir, !String(message.method).startsWith('provider/'));
        if (closing) return;
        if (threadId && generation !== (stopped.get(threadId) ?? 0)) throw new Error('Запрос отменён во время обновления каталога.');
        if (message.method === 'model/list') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id,
            result: { models: pickerModels(kimiCatalog), selectedOnlyModels: [] } }) + '\n');
          return;
        }
        owner.providerOptions = prepared;
        if (['thread/start', 'thread/resume', 'thread/fork', 'turn/start'].includes(String(message.method))) {
          let selected = execution.model;
          if (!selected || selected === '__kimi_env_model__') selected = prepared.kimiDefaultModel;
          if (typeof selected === 'string' && !selected.includes('/') && !Object.hasOwn(kimiCatalog.models, selected) && Object.hasOwn(kimiCatalog.models, `kimi-code/${selected}`)) selected = `kimi-code/${selected}`;
          if (typeof selected !== 'string' || !Object.hasOwn(kimiCatalog.models, selected)) {
            throw new Error('Выбранная модель отсутствует в доступном каталоге Kimi Code. Обновите список и выберите подписочную модель. История треда сохранена; автоматического переключения на другой API нет.');
          }
          execution.model = selected;
          const caps = kimiCatalog.models[selected].capabilities;
          if (!caps?.includes('thinking')) delete execution.reasoningLevel;
        }
        normalizeReasoningOptions(execution);
        acp.handleLine(JSON.stringify(message));
      } catch (error) {
        // Do not echo the line, credential file contents, or third-party error payloads.
        if (!closing && (typeof message.id === 'string' || typeof message.id === 'number')) {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id,
            error: { code: -32602, message: error instanceof Error ? error.message : 'Kimi Code configuration error.' },
          }) + '\n');
        }
      } })();
      return;
    }
    normalizeReasoningOptions(execution);
    acp.handleLine(JSON.stringify(message));
  },
  onClose: () => { closing = true; acp.onClose?.(); },
  onSigterm: () => { closing = true; acp.onSigterm?.(); },
  onSigint: () => { closing = true; acp.onSigint?.(); },
});
