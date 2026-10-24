---
name: kimicode
description: Configure or troubleshoot the independent Kimi Code provider in BB, including its host credentials file and API model.
---

# Kimi Code provider

This plugin registers `kimi-code` independently from Claude Code and Codex. Never change `BB_CLAUDE_CODE_EXECUTABLE`, `ANTHROPIC_*`, or Codex settings to configure it.

Inspect models with `bb provider models kimi-code --json`. Inspect nonsecret settings with `bb plugin config kimicode`. Set a setting with `bb plugin config kimicode set <name> <value>`.

Settings: `executable` (official Kimi Code CLI 2.2+, default `kimi`), `envFile` (absolute execution-host dotenv path containing `KIMI_API_KEY`), `baseUrl` (default `https://api.kimi.com/coding/v1`, overseas `https://api.kimi.ai/coding/v1`), `sourceConfig` (default `auto`, snapshot provider/model tables from the native host config; `none` for subscription-only), `model` (default `auto`, follows source default), `maxContextSize` (default `auto`, preserves per-model windows). Never put an actual key in CLI arguments or output.

The host reads dotenv as data and passes the key only to its Kimi child. Other dotenv entries are ignored. Kimi uses a plugin-owned home. Paths apply on the execution machine, not the browser; every remote host needs its CLI and credentials at the configured paths.

Select a model and supported thinking level from the ACP catalog in the composer. The isolated catalog preserves the source CLI aliases and metadata; API-only setups get six subscription models. Third-party providers retain their own credentials and billing. The subscription key is never sent to their endpoints. Only provider/model tables are copied; the original config is unchanged. Existing `__kimi_env_model__` selections migrate to the configured default. Restart/resume the CLI session after changing credentials or API model. Usage quotas, explicit compaction, and native BB forks are not exposed in this version.

See README.md in the plugin for installation and development. Do not print credentials while troubleshooting.

BB may submit `medium` when no effort was selected. The plugin translates it to high, matching the official Kimi Code API effort mapping; do not instruct users to change project-wide defaults to fix it.
