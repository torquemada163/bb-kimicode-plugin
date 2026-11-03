# Configuration and credentials

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `executable` | `kimi` | Official Kimi Code CLI executable on the execution host |
| `envFile` | empty; configuration required | Absolute path to a dotenv file containing `KIMI_API_KEY` |
| `baseUrl` | `https://api.kimi.com/coding/v1` | Kimi Code API URL; overseas accounts can use `https://api.kimi.ai/coding/v1` |
| `sourceConfig` | `auto` | Read the preferred default and, when enabled, external API providers from the host's `KIMI_CODE_HOME/config.toml` or `~/.kimi-code/config.toml`; `none` disables import |
| `includeExternalModels` | `false` | Explicitly enable separate API providers from `sourceConfig`; subscription models are always fetched from Kimi Code |
| `model` | `auto` | Initial CLI default from the source config, or an API model ID/configured alias; individual threads use BB's model picker |
| `maxContextSize` | `auto` | Preserve each model's native context window; a numeric value overrides subscription models only |

The model catalog comes directly from `${baseUrl}/models`, authenticated with the subscription key on the execution host. The response supplies context windows, names, capabilities, and thinking controls; no fixed model list is merged into it. Usage quotas, explicit compaction, and native BB forks are not exposed. Ordinary multi-turn conversations and session restore use ACP. BB presents `accept-edits` and `full` permissions through the shared ACP adapter; neither mode is an OS sandbox. The plugin keeps Kimi's permission requests enabled and does not pass `--auto` or `--yolo`.

The server refreshes the provider catalog registration on startup and every 15 minutes; connected hosts fetch the new catalog when BB probes their model lists. Model listing and session requests also check the host cache age. `bb kimicode models refresh [--machine host_id]` requests an immediate refresh on the selected execution host. Without `--machine`, the command uses its current thread's host, otherwise BB's server host. Existing in-flight requests keep their selected model; later requests validate that model against the current catalog.

Successful responses replace the entire subscription catalog, including removal of retired models. Failed, malformed, or incomplete responses preserve the last successful list and original timestamp. Stale subscription entries show **кеш**, with the timestamp in their description. Failed refreshes are throttled for one minute; a manual refresh can bypass that delay. Without a saved catalog, model discovery reports an actionable error instead of guessing available models. An authoritative empty list remains empty. A missing model fails before launching the CLI; there is no automatic fallback to another model or API route.

For remote execution, install `kimi` and place the credentials file on **each execution host** at the configured paths. This version uses one set of plugin paths for all hosts.

## Isolation and secrets

The server registers only provider `kimi-code`. It does not contribute environment variables to other providers or edit BB's global provider configuration, `~/.claude`, or Codex settings.

The plugin sends only the credentials **file path** to the host. Its isolated bridge process reads that file as dotenv data (never `source`/`eval`), uses it for the subscription catalog request, and passes `BB_KIMI_CODE_API_KEY` directly to its Kimi child, referenced with `api_key_env` in the isolated config. The actual key is absent from server-side settings, persisted provider options, and `provider.env-resolved` contributions. Only `KIMI_API_KEY` is read; other dotenv entries are ignored. Missing/empty credentials fail with a bounded diagnostic. Catalog requests do not follow redirects. The private cache is scoped by endpoint and a one-way key fingerprint, contains only normalized model metadata and timestamps, and is written atomically with mode `600`. Cache data from a different key or endpoint is never reused.

Kimi uses a plugin-owned `kimi-home` under the host bridge's data directory, keeping CLI config, sessions, and logs apart from an existing standalone Kimi installation. Subscription models are rebuilt from the live or cached catalog; their credentials use the `.env` API-key reference. With `includeExternalModels=true`, only external provider/model tables are imported, not standalone MCP servers, tools, or other settings. External providers retain their own credentials in a host-local snapshot with mode `600`, inside a directory created with mode `700`. The original source config is never modified. Import API-key providers whose credentials are self-contained in the config or explicitly supplied through their `api_key_env`; external OAuth credential stores are not copied. Rotating the key requires replacing it in the credentials file and starting/resuming a CLI session. As with other CLI agents, the child process receives the key in its environment; its own diagnostics and tools remain trusted code.

`.env`, `.env.*`, logs, `node_modules`, and generated bundles are ignored by Git. The npm `files` allowlist excludes credentials. A placeholder `.env.example` is included.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Kimi executable not found | Install the official Node-based Kimi Code CLI on the execution host; set `executable` to its absolute path if needed. |
| Credentials cannot be read | `envFile` must be an absolute path on the execution host, with a nonempty `KIMI_API_KEY`. |
| A newly added model is missing | Run `bb kimicode models refresh` on the intended execution host, then reopen the model picker. Check whether the response is marked as cached. |
| An old thread selected a Moonshot API model | Choose an entry labeled **подписка Kimi Code**. External API entries are disabled by default; the plugin will not silently replace the thread's model. |
| A model is listed but the API rejects it | Model availability depends on the account, endpoint region, and membership tier. Imported third-party providers use their own credentials. |
| A connection change does not affect a running conversation | Start a new thread so the CLI process gets the new credentials and config. |
| Daily token limit (TPD) or HTTP 429 | Check the account for the selected model route. `moonshot-cn/...` uses its imported Moonshot API credentials; `kimi-code/...` uses the subscription key from `envFile`. Retry after the provider allows the request. A fresh thread does not reset account limits. |

The plugin disables the CLI's hidden per-step and compaction retries. API failures end the current turn with an error, preserving the session for a manual retry. Kimi CLI 2.4.0 can report a failed turn as a normal ACP `end_turn`; the plugin's host-local ACP launcher checks the new `turn.ended` record in that session's `agents/main/wire.jsonl` and converts failures to JSON-RPC errors. Only a bounded tail appended during the current prompt is read. Raw provider error text is not forwarded to BB. Unknown session layouts keep the CLI's original ACP response; the error recovery path is verified with CLI 2.4.0.

Context capacity and account rate limits are separate. `maxContextSize=auto` preserves model metadata; it does not discover a user's live quota. A short fresh thread can be accepted while a larger request is rejected by the provider. The exact quota admission rules and reset time are not inferred by the plugin.

`sourceConfig=auto` supplies the preferred default and optionally external provider/model tables. `includeExternalModels=false` keeps all separate API providers disabled, even if they exist in that source. When importing another provider, credentials in its config are copied to the private host snapshot; a referenced `api_key_env` must already be available on that host. External OAuth stores are not copied.

The plugin accepts BB's inherited `medium` as `high`, matching the documented Kimi Code API mapping. It forwards explicit Low / High / Max selections unchanged. Kimi Code HighSpeed has fixed Thinking ON; the CLI currently represents that with one High entry.

Config changes refresh the provider registration automatically. Long-lived CLI sessions can still use their earlier snapshot until they are resumed/restarted. The picker can temporarily retain BB's cached data until a model probe completes.
