# Changelog

## Unreleased

## 0.5.0 — 2026-11-19

### Subscription limits in bb

- See your Kimi Code allowances in the sidebar **Provider usage → Kimi Code** panel and **Settings → Usage limits**, with quota bars, usage percentages, and reset countdowns.
- Send `/usage` as a standalone message for a text report with used/remaining percentages and reset times in UTC. No model request is made; type the command directly, as it is not listed in ACP's command menu.
- Read the actual five-hour, weekly, or monthly windows returned by the subscription API. Quotas are shared across the account and are separate from thread context and external API billing.
- Keep credentials on the execution host. Handle authentication failures, unavailable hosts, malformed responses, cancellation, and refresh requests without inventing quota values.

### ACP reply reliability

- Prevent the native background-task/cron execution path that loses replies over Kimi ACP ([upstream #4109](https://github.com/MoonshotAI/kimi-code/issues/4109)). Disable native task tools, cron, and automatic shell detachment on timeout in the isolated plugin config.
- Keep ordinary commands and foreground subagents available. Use **BB terminals** for persistent browsers, dev servers, and observers. Standalone Kimi configuration stays unchanged.
- Add a real-CLI loopback regression for rejected background work, foreground timeout, visible follow-ups, and stop/resume, plus an independent reproduction of the upstream bug.

### After updating

Stop and resume an existing Kimi thread, or create a new one, so its CLI loads the background-task policy. Already-running native background processes are not migrated automatically. Open the chart icon at the bottom of the sidebar and select **Kimi Code** to view subscription limits.

### Validation

- 25 offline tests, 17 SDK bridge conformance checks, and the host catalog guard.
- TypeScript, build, clean Git-install build without development dependencies, and package content checks.
- Real subscription metadata verified through the built bridge and the live BB sidebar; no model call is required for quota reporting.
- Background-task and HTTP 429 recovery regressions previously verified locally with Kimi Code CLI 2.4.0 against a fake loopback API. The original user browser scenario remains unverified; the workaround does not implement autonomous ACP event delivery.

## 0.4.0 — 2026-11-03

- Fetch subscription models and metadata directly from the authenticated Kimi Code `/models` endpoint; remove the fixed six-model runtime catalog.
- Add a private per-account catalog cache, 15-minute refresh, stale labels and timestamps, and `bb kimicode models refresh` for manual updates.
- Show subscription labels and make separate API provider imports opt-in through `includeExternalModels=false` by default. Reject retired or disabled selections without changing the thread's API route.
- Surface Kimi API failures in BB instead of silently waiting through long retry delays or reporting a failed ACP turn as successful.
- Disable hidden CLI retries for LLM steps and compaction; preserve the session so the user can retry after resolving the API limit.
- Add offline coverage for HTTP 429, redaction, and recovery in the same session, including a smoke check with the real Kimi CLI.

## 0.3.0 — 2026-10-25

- Add K3.1 Pro (`k3.1-pro`) and K3.1 Pro Highspeed (`k3.1-pro-highspeed`) to the built-in subscription catalog, including API-key-only installations.
- Preserve their thinking-only behavior, Low / High / Max efforts (default High), up-to-1M context, image/video input, and native tool capabilities.
- Import the updated Kimi Code CLI 2.3.1 catalog, including separately configured Moonshot K3.1 entries.
- Update the model table and setup guidance; recommend a fresh thread when moving to the K3.1 Pro series.
- Add regression coverage for both new presets and API-ID selection.

## 0.2.3 — 2026-10-22

Initial public release.

- Independent Kimi Code provider for bb, using the official CLI over ACP.
- Full model catalog from the host CLI, with four subscription presets for API-key-only setups.
- Per-model thinking controls and compatibility with bb's inherited `medium` setting.
- Host-only subscription key loading from dotenv, plus isolated config and session storage.
- Existing third-party provider entries preserve their credentials and endpoints.
- Official Kimi K mark with source attribution.
- Offline regression tests, published SDK conformance checks, and an optional live smoke command.
