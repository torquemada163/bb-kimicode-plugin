import { experimental_acpProviderBridge as acp } from '@get-bb/plugin-sdk/provider-bridge/acp';
import { experimental_defineProviderBridge } from '@get-bb/plugin-sdk/provider-bridge';
import { normalizeReasoningOptions } from './src/reasoning.js';
import { asRecord, prepareHostOptions } from './src/credentials.js';

let hostDataDir: string | undefined;

export const experimental_providerBridge = experimental_defineProviderBridge({
  start(context) {
    hostDataDir = context.dataDir;
    acp.start?.(context);
  },
  handleLine(line) {
    let message: Record<string, unknown>;
    try { message = asRecord(JSON.parse(line)); }
    catch { acp.handleLine(line); return; }
    const params = asRecord(message.params);
    const execution = asRecord(params.options);
    const owner = 'providerOptions' in execution ? execution : params;
    const options = asRecord(owner.providerOptions);
    if ('kimiConfig' in options) {
      try {
        if (!hostDataDir) throw new Error('Kimi Code bridge is not initialized.');
        const prepared = prepareHostOptions(options, hostDataDir);
        owner.providerOptions = prepared;
        if (execution.model === '__kimi_env_model__') execution.model = prepared.kimiDefaultModel;
      } catch (error) {
        // Do not echo the line, credential file contents, or third-party error payloads.
        if (typeof message.id === 'string' || typeof message.id === 'number') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id,
            error: { code: -32602, message: error instanceof Error ? error.message : 'Kimi Code configuration error.' },
          }) + '\n');
        }
        return;
      }
    }
    normalizeReasoningOptions(execution);
    acp.handleLine(JSON.stringify(message));
  },
  onClose: () => acp.onClose?.(),
  onSigterm: () => acp.onSigterm?.(),
  onSigint: () => acp.onSigint?.(),
});
