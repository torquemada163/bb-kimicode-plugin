Run Kimi Code alongside your other coding agents in bb, with a separate provider, model picker, and model-specific thinking levels.

## What you get

- K3, K3-256k, K2.8 Preview, and K2.7 Code HighSpeed through the official Kimi Code CLI.
- Low, High, and Max thinking where the selected model supports them.
- Existing Kimi CLI provider/model entries, with a subscription-only option.
- Multi-turn conversations and session restore over ACP.
- An isolated CLI home and a host-local API key file, keeping your standalone Kimi config unchanged.

Claude Code and Codex retain their existing providers and credentials. Imported third-party API providers keep their own credentials and billing.

## Setup

Install Kimi Code CLI 2.2+ on the execution host. Create a private dotenv file containing `KIMI_API_KEY`, then set its absolute path in the plugin's **API key dotenv file** setting. If needed, specify the CLI executable path and the API endpoint for your region.

Choose **Kimi Code** when creating a thread, then select a model and thinking level. Model access depends on your subscription.

## Current limits

Usage quota reporting, manual compaction, and native bb forks are not exposed. Each execution host needs the configured executable and credentials paths. Tested on macOS and Linux.
