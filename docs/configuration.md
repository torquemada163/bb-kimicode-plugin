# Configuration and credentials

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `executable` | `kimi` | Official Kimi Code CLI executable on the execution host |
| `envFile` | empty; configuration required | Absolute path to a dotenv file containing `KIMI_API_KEY` |
| `baseUrl` | `https://api.kimi.com/coding/v1` | Kimi Code API URL; overseas accounts can use `https://api.kimi.ai/coding/v1` |
| `sourceConfig` | `auto` | Read models/providers from the host's `KIMI_CODE_HOME/config.toml` or `~/.kimi-code/config.toml`; `none` disables import; an absolute TOML path selects a source |
| `model` | `auto` | Initial CLI default from the source config, or an API model ID/configured alias; individual threads use BB's model picker |
| `maxContextSize` | `auto` | Preserve each model's native context window; a numeric value overrides subscription models only |

The model catalog comes from Kimi's ACP server. Thinking controls follow each model's ACP capabilities. Usage quotas, explicit compaction, and native BB forks are not exposed. Ordinary multi-turn conversations and session restore use ACP. BB presents `accept-edits` and `full` permissions through the shared ACP adapter; neither mode is an OS sandbox. The plugin keeps Kimi's permission requests enabled and does not pass `--auto` or `--yolo`.

For remote execution, install `kimi` and place the credentials file on **each execution host** at the configured paths. This version uses one set of plugin paths for all hosts.

## Isolation and secrets

The server registers only provider `kimi-code`. It does not contribute environment variables to other providers or edit BB's global provider configuration, `~/.claude`, or Codex settings.

The plugin sends only the credentials **file path** to the host. Its isolated bridge process reads that file as dotenv data (never `source`/`eval`) and passes `BB_KIMI_CODE_API_KEY` directly to its Kimi child, referenced with `api_key_env` in the isolated config. The actual key is absent from server-side settings, persisted provider options, and `provider.env-resolved` contributions. Only `KIMI_API_KEY` is read; other dotenv entries are ignored. Missing/empty credentials fail with a bounded diagnostic.

Kimi uses a plugin-owned `kimi-home` under the host bridge's data directory, keeping CLI config, sessions, and logs apart from an existing standalone Kimi installation. Only provider/model tables are imported, not standalone MCP servers, tools, or other settings. Subscription OAuth fields are replaced by the `.env` API-key reference. Other configured providers retain their own credentials in a host-local snapshot with mode `600`, inside a directory created with mode `700`. The original source config is never modified. Import API-key providers whose credentials are self-contained in the config or explicitly supplied through their `api_key_env`; external OAuth credential stores are not copied. Rotating the key requires replacing it in the credentials file and starting/resuming a CLI session. As with other CLI agents, the child process receives the key in its environment; its own diagnostics and tools remain trusted code.

`.env`, `.env.*`, logs, `node_modules`, and generated bundles are ignored by Git. The npm `files` allowlist excludes credentials. A placeholder `.env.example` is included.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Kimi executable not found | Install the official Node-based Kimi Code CLI on the execution host; set `executable` to its absolute path if needed. |
| Credentials cannot be read | `envFile` must be an absolute path on the execution host, with a nonempty `KIMI_API_KEY`. |
| A newly added model is missing | Reload the plugin with `bb plugin reload kimicode`, reopen the model picker, and check `bb provider models kimi-code --json`. |
| A model is listed but the API rejects it | Model availability depends on the account, endpoint region, and membership tier. Imported third-party providers use their own credentials. |
| A connection change does not affect a running conversation | Start a new thread so the CLI process gets the new credentials and config. |

`sourceConfig=auto` imports the host CLI's provider/model tables. Set it to `none` to use only the six subscription model presets. When importing another provider, credentials in its config are copied to the private host snapshot; a referenced `api_key_env` must already be available on that host. External OAuth stores are not copied.

The plugin accepts BB's inherited `medium` as `high`, matching the documented Kimi Code API mapping. It forwards explicit Low / High / Max selections unchanged. Kimi Code HighSpeed has fixed Thinking ON; the CLI currently represents that with one High entry.

Config changes refresh the provider registration automatically. Long-lived CLI sessions can still use their earlier snapshot. The catalog is provided by ACP; the picker can temporarily show cached data until the plugin and picker are refreshed.
