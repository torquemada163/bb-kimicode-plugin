---
name: kimicode
description: Configure or troubleshoot the independent Kimi Code provider in BB, including its host credentials file and API model.
---

# Kimi Code provider

This plugin registers `kimi-code` independently from Claude Code and Codex. Never change `BB_CLAUDE_CODE_EXECUTABLE`, `ANTHROPIC_*`, or Codex settings to configure it.

Inspect models with `bb provider models kimi-code --json`. Refresh immediately with `bb kimicode models refresh [--machine host_id]`; without a machine flag it targets the current thread host, otherwise BB's server host. Inspect nonsecret settings with `bb plugin config kimicode`. Set a setting with `bb plugin config kimicode set <name> <value>`.

Settings: `executable` (official Kimi Code CLI 2.2+, default `kimi`), `envFile` (absolute execution-host dotenv path containing `KIMI_API_KEY`), `baseUrl` (default `https://api.kimi.com/coding/v1`, overseas `https://api.kimi.ai/coding/v1`), `sourceConfig` (default `auto`, source for the preferred model and optional external API tables; `none` disables import), `includeExternalModels` (default `false`; explicitly opt in to separate API billing), `model` (default `auto`, follows a valid source default), `maxContextSize` (default `auto`, preserves per-model windows). Never put an actual key in CLI arguments or output.

The host reads dotenv as data, uses the key on that host to fetch the subscription catalog, and passes it to its Kimi child. Other dotenv entries are ignored. Kimi uses a plugin-owned home. Paths apply on the execution machine, not the browser; every remote host needs its CLI and credentials at the configured paths.

Select a model labeled `подписка Kimi Code` and its supported thinking level in the composer. The subscription catalog and context/thinking metadata come directly from the authenticated Kimi Code `/models` endpoint; no fixed model roster is merged into it. The catalog refreshes at startup and every 15 minutes. Offline updates preserve the last successful account-scoped cache, show `кеш`, and retain its timestamp in the model description. A cold catalog failure produces an error. Retired or disabled model selections are rejected without switching the thread to another model or billing route. New model IDs automatically receive the same subscription label.

With `includeExternalModels=true`, third-party providers from `sourceConfig` appear with `API (provider-id)` labels and retain their own credentials and billing. The subscription key is never sent to their endpoints. Only provider/model tables are copied; the original config is unchanged. Existing `__kimi_env_model__` selections migrate to the configured default. Restart/resume the CLI session after changing credentials or API model. Usage quotas, explicit compaction, and native BB forks are not exposed in this version.

See README.md in the plugin for installation and development. Do not print credentials while troubleshooting.

BB may submit `medium` when no effort was selected. The plugin translates it to high, matching the official Kimi Code API effort mapping; do not instruct users to change project-wide defaults to fix it.

The plugin disables hidden CLI retries and surfaces failed ACP turns as errors when the CLI session record is available (verified with Kimi CLI 2.4.0). Retry manually after resolving the provider error; the session is preserved. For TPD/429, check the selected route: `moonshot-cn/...` uses the imported Moonshot API account, while `kimi-code/...` uses the subscription key from `envFile`. A new thread does not reset account limits, and context capacity is separate from token quotas. Do not infer a complete account lockout or a quota reset time from a single rejected request.
