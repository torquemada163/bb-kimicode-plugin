import type { BbPluginApi, PluginProviderDeclaration } from '@get-bb/plugin-sdk';
import { cliCommand, defineCli } from '@get-bb/plugin-sdk';
import timers from 'node:timers/promises';
import { CATALOG_TTL_MS } from './src/subscription-catalog.js';
import { REASONING_LEVELS } from './src/reasoning.js';
import { bridgeOptions, DEFAULT_BASE_URL, PROVIDER_ID, readSettings } from './src/config.js';

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    executable: { type: 'string', label: 'Kimi executable', default: 'kimi', description: 'kimi on PATH, or an absolute path on each execution host. Requires Kimi Code CLI 2.2+.' },
    envFile: { type: 'string', label: 'API key dotenv file', default: '', description: 'Absolute host path to a dotenv file containing KIMI_API_KEY. Only the host reads the key; its value is never a BB provider option.' },
    sourceConfig: { type: 'string', label: 'Source Kimi config', default: 'auto', description: 'auto: preferred default from the host Kimi config. External API entries are imported only when explicitly enabled. none: no import; or use an absolute TOML path. The source file is never changed.' },
    includeExternalModels: { type: 'boolean', label: 'Include separate API providers', default: false, description: 'Opt in to models billed through providers from sourceConfig. Disabled: only your Kimi Code subscription models are listed and accepted.' },
    baseUrl: { type: 'string', label: 'Kimi Code API URL', default: DEFAULT_BASE_URL, description: 'Use https://api.kimi.ai/coding/v1 for the overseas endpoint.' },
    model: { type: 'string', label: 'Default model ID', default: 'auto', description: 'auto: prefer the CLI default when available. Or set a subscription model ID or configured alias. Select models per thread in the composer.' },
    maxContextSize: { type: 'string', label: 'Context size in tokens', default: 'auto', description: 'auto: preserve each model’s native context window. Or override subscription models with a token count.' },
  });

  let registration: { dispose(): void } | undefined;
  let refreshAfter = Date.now();
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
      experimental_bridgeOptions: bridgeOptions(config, refreshAfter),
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
        return bridgeOptions(readSettings(context.settings), refreshAfter);
      },
    };
    registration?.dispose();
    registration = bb.providers.register(declaration);
  }
  register(await settings.get());
  settings.onChange((next) => {
    try { refreshAfter = Date.now(); register(next); }
    catch { bb.log.error('Invalid Kimi Code settings; the previous provider registration is retained. Check envFile, baseUrl, and maxContextSize.'); }
  });
  bb.background.service('subscription-catalog-refresh', {
    async start(signal) {
      try {
        while (!signal.aborted) {
          await timers.setTimeout(CATALOG_TTL_MS, undefined, { signal });
          refreshAfter = Date.now();
          register(await settings.get());
        }
      } catch (error) { if (!signal.aborted) throw error; }
    },
  });
  bb.cli.register(defineCli({
    name: 'kimicode', summary: 'Refresh the Kimi Code subscription model catalog',
    commands: {
      'models refresh': cliCommand({
        summary: 'Refresh available models using the subscription key on the execution host',
        options: { machine: { type: 'string', description: 'Execution host ID; defaults to the current thread host, otherwise the server host' } },
        async run(input, context) {
          let hostId = input.options.machine;
          if (!hostId && context.threadId) {
            const thread = await bb.sdk.threads.get({ threadId: context.threadId, signal: context.signal });
            if (thread.environmentId) hostId = (await bb.sdk.environments.get({ environmentId: thread.environmentId, signal: context.signal })).hostId;
          }
          refreshAfter = Date.now();
          register(await settings.get());
          const routing = hostId ? { hostId } : {};
          const load = () => bb.sdk.providers.models({ providerId: PROVIDER_ID, ...routing, signal: context.signal });
          let result = await load();
          for (const wait of [250, 500, 1000, 2000]) {
            if (!result.modelLoadError || !/Provider .* is not running/.test(result.modelLoadError.detail ?? '')) break;
            await timers.setTimeout(wait, undefined, { signal: context.signal });
            result = await load();
          }
          return { exitCode: result.modelLoadError ? 1 : 0,
            stdout: JSON.stringify({ models: result.models.map(({ id, displayName, description }) => ({ id, displayName, description })), error: result.modelLoadError }, null, 2) + '\n' };
        },
      }),
    },
  }));
  bb.onDispose(() => registration?.dispose());
}
