# Kimi Code for bb

[![CI](https://github.com/torquemada163/bb-kimicode-plugin/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/torquemada163/bb-kimicode-plugin/actions/workflows/check.yml)
[![bb](https://img.shields.io/badge/bb-0.46.1%2B-6366f1)](https://getbb.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Run **Kimi Code** alongside your existing coding agents in [bb](https://getbb.app). This plugin adds its own provider, model picker, and thinking controls using the official Kimi Code CLI over ACP. Claude Code and Codex keep their existing connections and credentials.

[Install](#install) · [Configuration](docs/configuration.md) · [Development](docs/development.md) · [Changelog](CHANGELOG.md)

## What you get

- A separate **Kimi Code** entry in bb's provider picker, with the official Kimi mark.
- A live catalog of models available through your Kimi Code subscription, with clear subscription labels.
- Low / High / Max thinking levels on models that support them.
- Optional separately configured API providers, with explicit API labels and separate billing.
- Multi-turn conversations and session restore through ACP.
- An isolated CLI home, with host-local credentials and an unchanged standalone Kimi config.

## Install

In bb's plugin installer, add this repository URL:

```text
https://github.com/torquemada163/bb-kimicode-plugin
```

Or install from the terminal:

```sh
bb plugin install https://github.com/torquemada163/bb-kimicode-plugin
```

BB downloads the source, installs its runtime dependencies, and builds the plugin. You do **not** need to clone the repository or run npm commands for a normal installation.

### Requirements

- **bb 0.46.1+**, providing Plugin SDK 0.6.49+.
- The official [Kimi Code CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html), **2.2+**, on the machine that runs your agents. The legacy Python `kimi-cli` is not supported. Verified locally with CLI 2.4.0.
- A **Kimi Code subscription API key**. Moonshot Platform keys and billing are separate.

The plugin is tested on macOS and Linux. Install the CLI and credentials on the **execution host**, including when you access bb through a remote browser.

## Connect your account

Create a private dotenv file on the execution host, using your editor:

```dotenv
KIMI_API_KEY=your-kimi-code-api-key
```

For example, save it as `~/.config/bb-kimicode/credentials.env`. Create the directory first and protect the file with `chmod 600` on macOS/Linux. Keep the key out of your repository and terminal command arguments.

Open **Settings → Plugins → Kimi Code** and set **API key dotenv file** to the file's **absolute path**. Set **Kimi executable** if `kimi` is not on bb's host PATH.

The equivalent CLI configuration is:

```sh
bb plugin config kimicode set envFile "$HOME/.config/bb-kimicode/credentials.env"
# Optional: use an absolute executable path if PATH discovery fails.
bb plugin config kimicode set executable /absolute/path/to/kimi
bb provider models kimi-code --json
```

For an overseas account, you can select the matching API endpoint:

```sh
bb plugin config kimicode set baseUrl https://api.kimi.ai/coding/v1
```

Start a new thread, choose **Kimi Code**, then select your model and thinking level.

## Models and thinking

| Kimi Code model | API ID | Thinking |
| --- | --- | --- |
| K3.1 Pro | `k3.1-pro` | Low / High / Max; thinking required |
| K3.1 Pro Highspeed | `k3.1-pro-highspeed` | Low / High / Max; thinking required |
| K3 | `k3` | Low / High / Max |
| K3-256k | `k3-256k` | Low / High / Max |
| K2.8 Preview | `kimi-for-coding` | Low / High / Max |
| K2.7 Code HighSpeed | `kimi-for-coding-highspeed` | Thinking ON; no adjustable effort |

The table above gives examples, not a fixed catalog. The plugin reads `/models` from your configured Kimi Code endpoint using your subscription key on the execution host. Availability, context windows, capabilities, names, and thinking efforts come from that response. There is no built-in fallback list that can resurrect retired models. BB uses stable aliases such as `kimi-code/k3.1-pro`, with labels such as **K3.1 Pro · подписка Kimi Code**.

Start a **new thread** for K3.1 Pro models rather than switching an existing K3/K2.x conversation. Both variants require thinking enabled and support up to 1M context, subject to your subscription. Use CLI 2.3.1+ for the updated native catalog.

BB's inherited `medium` setting is translated to `high`, following Kimi's documented API mapping. HighSpeed currently appears in ACP with a single High entry, representing its fixed/default Thinking behavior.

The catalog refreshes on plugin startup and every 15 minutes. Refresh it manually with:

```sh
bb kimicode models refresh
# Optional: target another execution host by ID.
bb kimicode models refresh --machine host_example
```

If an update fails, the last successful catalog remains available with a **кеш** label and its timestamp in the model description. A cold setup needs one successful catalog fetch. A removed or disabled model is rejected before starting a request; the plugin preserves the thread and asks you to choose a model instead of switching API routes.

Only subscription models are listed and accepted by default. To explicitly include separate API providers from the host Kimi config:

```sh
bb plugin config kimicode set includeExternalModels true
```

These entries carry an **API (provider-id)** label and retain their own credentials and billing. `sourceConfig=none` disables that import altogether. Native subscription model entries do not override the live subscription catalog.

[All settings, credential handling, and troubleshooting →](docs/configuration.md)

## Scope and limitations

- The plugin registers only `kimi-code`; other bb providers are not reconfigured.
- The subscription key is read on the execution host, used there to fetch the subscription catalog, and passed directly to the Kimi child process. The source config is never modified. See [isolation and secrets](docs/configuration.md#isolation-and-secrets).
- Usage quota reporting, manual compaction, and native bb forks are not exposed yet.
- Permissions use bb's shared ACP adapter. The plugin does not pass `--auto` or `--yolo`; permission modes are not an OS sandbox.
- One set of executable and credentials paths applies across hosts. Each execution host needs the corresponding files.

## Update or remove

```sh
bb plugin update kimicode
bb plugin remove kimicode
```

Git installations track the repository's default branch. Removing the plugin leaves your external credentials file and other providers intact. Review plugin-owned host data separately if you want to erase Kimi session history.

For a local checkout used during development, use `bb plugin build` and `bb plugin reload kimicode` instead of `update`. See the [development guide](docs/development.md).

## Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
```

Tests use an offline ACP fixture and require no API key. A separate manual smoke check can make a real model request. See [development and release instructions](docs/development.md).

The implementation uses the public [bb Plugin SDK](https://getbb.app/plugin-guide) and the official [Kimi ACP interface](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html).

## License

Plugin code is distributed under [MIT](LICENSE), as is, without warranty. Support, updates, and issue responses are not guaranteed.

The Kimi mark belongs to Moonshot AI and is not relicensed under MIT; [asset attribution](assets/README.md) records its source. This is an independent integration, not affiliated with Moonshot AI or bb.
