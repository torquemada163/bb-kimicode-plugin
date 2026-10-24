# Changelog

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
