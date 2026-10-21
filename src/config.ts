import { isAbsolute } from 'node:path';
import type { AcpLaunchSpec } from '@get-bb/plugin-sdk/provider-bridge/acp';

export const PROVIDER_ID = 'kimi-code';
export const DEFAULT_BASE_URL = 'https://api.kimi.com/coding/v1';
export type KimiSettings = {
  sourceConfig: string;
  executable: string;
  envFile: string;
  baseUrl: string;
  model: string;
  maxContextSize: string;
};

export function readSettings(values: Readonly<Record<string, unknown>>): KimiSettings {
  const string = (name: string, fallback: string) =>
    typeof values[name] === 'string' && values[name].trim() ? values[name].trim() : fallback;
  const config = {
    executable: string('executable', 'kimi'),
    sourceConfig: string('sourceConfig', 'auto'),
    envFile: string('envFile', ''),
    baseUrl: string('baseUrl', DEFAULT_BASE_URL),
    model: string('model', 'auto'),
    maxContextSize: string('maxContextSize', 'auto'),
  };
  if (config.envFile && !isAbsolute(config.envFile)) {
    throw new Error('Kimi Code: envFile must be an absolute path on the execution host.');
  }
  if (!['auto', 'none'].includes(config.sourceConfig) && !isAbsolute(config.sourceConfig)) throw new Error('Kimi Code: sourceConfig must be auto, none, or an absolute path.');
  const url = new URL(config.baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Kimi Code: baseUrl must be an HTTPS API URL without credentials, query, or fragment.');
  }
  if (config.maxContextSize !== 'auto' && (!/^\d+$/.test(config.maxContextSize) || Number(config.maxContextSize) < 4096 || Number(config.maxContextSize) > 1048576)) {
    throw new Error('Kimi Code: maxContextSize must be between 4096 and 1048576.');
  }
  return config;
}

export function launchSpec(config: KimiSettings): AcpLaunchSpec {
  return {
    displayName: 'Kimi Code',
    command: config.executable,
    args: ['acp'],
    env: {},
    // Keep approvals in ACP so BB can handle them. Do not pass --auto/--yolo.
  };
}

export function bridgeOptions(config: KimiSettings) {
  return {
    acpDialect: 'acp',
    acpLaunchSpec: { ...launchSpec(config) },
    kimiConfig: { ...config },
  };
}
