import { readFileSync, statSync } from 'node:fs';
import { writeHostCatalog } from './catalog.js';
import { parse } from 'dotenv';
import { readSettings, launchSpec } from './config.js';

/** Called in the isolated bridge process on the execution host, never on the server. */
export function prepareHostOptions(options: Record<string, unknown>, dataDir: string) {
  const config = readSettings(asRecord(options.kimiConfig));
  if (!config.envFile) throw new Error('Set the Kimi Code plugin envFile to an absolute dotenv path containing KIMI_API_KEY.');
  let key: string | undefined;
  try {
    if (statSync(config.envFile).size > 65536) throw new Error('oversize');
    key = parse(readFileSync(config.envFile)).KIMI_API_KEY?.trim();
  } catch {
    throw new Error('Cannot read Kimi Code credentials. Check the envFile path and permissions on the execution host.');
  }
  if (!key || /[\r\n\0]/.test(key)) throw new Error('The Kimi Code dotenv file must contain a nonempty, single-line KIMI_API_KEY.');
  const spec = launchSpec(config);
  const catalog = writeHostCatalog(config, dataDir);
  spec.env = {
    KIMI_CODE_HOME: catalog.home,
    BB_KIMI_CODE_API_KEY: key,
    KIMI_DISABLE_TELEMETRY: '1',
    // Disable inherited one-model overrides: the catalog now lives in config.toml.
    KIMI_MODEL_NAME: '',
    KIMI_MODEL_API_KEY: '',
    KIMI_CODE_CUSTOM_HEADERS: '',
  };
  return { ...options, acpLaunchSpec: spec, kimiDefaultModel: catalog.defaultModel };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
