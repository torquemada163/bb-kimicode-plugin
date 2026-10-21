import type { BbPluginApi, PluginProviderDeclaration } from '@get-bb/plugin-sdk';
import { REASONING_LEVELS } from './src/reasoning.js';
import { bridgeOptions, DEFAULT_BASE_URL, PROVIDER_ID, readSettings } from './src/config.js';

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    executable: { type: 'string', label: 'Kimi executable', default: 'kimi', description: 'kimi on PATH, or an absolute path on each execution host. Requires Kimi Code CLI 2.2+.' },
    envFile: { type: 'string', label: 'API key dotenv file', default: '', description: 'Absolute host path to a dotenv file containing KIMI_API_KEY. Only the host reads the key; its value is never a BB provider option.' },
    sourceConfig: { type: 'string', label: 'Source Kimi config', default: 'auto', description: 'auto: snapshot models/providers from the host Kimi config; none: subscription models only; or an absolute TOML path. The source file is never changed.' },
    baseUrl: { type: 'string', label: 'Kimi Code API URL', default: DEFAULT_BASE_URL, description: 'Use https://api.kimi.ai/coding/v1 for the overseas endpoint.' },
    model: { type: 'string', label: 'API model ID', default: 'auto', description: 'auto: use the CLI default. Or set an API model ID or configured alias. Select models per thread in the composer.' },
    maxContextSize: { type: 'string', label: 'Context size in tokens', default: 'auto', description: 'auto: preserve each model’s native context window. Or override subscription models with a token count.' },
  });

  let registration: { dispose(): void } | undefined;
  function register(values: Readonly<Record<string, unknown>>) {
    const config = readSettings(values);
    const declaration: PluginProviderDeclaration = {
      id: PROVIDER_ID,
      displayName: 'Kimi Code',
      family: 'kimi',
      icon: './assets/kimi.svg',
      strings: {
        signInHint: 'Configure the Kimi Code plugin: set envFile to a host dotenv file containing KIMI_API_KEY.',
        expiredHint: 'Check your Kimi Code API key and subscription, then reload the plugin.',
        installUrl: 'https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html',
      },
      experimental_visibility: 'always',
      experimental_bridgeOptions: bridgeOptions(config),
      maintenance: { health: true, usage: false, installation: false },
      capabilities: {
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        fork: 'none',
        supportsManualCompaction: false,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['accept-edits', 'full'],
        reasoningLevels: [...REASONING_LEVELS],
      },
      completedTurnDisplay: 'flat',
      reasoningLevels: [{ id: 'medium', label: 'Medium → High' }, { id: 'low', label: 'Low' }, { id: 'high', label: 'High' }, { id: 'max', label: 'Max' }],
      composerActions: [],
      models: { scope: 'host', fallback: [] },
      deriveProviderOptions(context) {
        return bridgeOptions(readSettings(context.settings));
      },
    };
    registration?.dispose();
    registration = bb.providers.register(declaration);
  }
  register(await settings.get());
  settings.onChange((next) => {
    try { register(next); }
    catch { bb.log.error('Invalid Kimi Code settings; the previous provider registration is retained. Check envFile, baseUrl, and maxContextSize.'); }
  });
  bb.onDispose(() => registration?.dispose());
}
