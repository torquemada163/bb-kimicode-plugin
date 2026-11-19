# Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
bb plugin build
npm run check:install
npm run check:package
```

Tests cover model additions and retirement, context/thinking metadata updates, subscription-only defaults, explicit API opt-in, unchanged source files, snapshot permissions, failed/partial catalog refreshes, stale timestamps, key-scoped caches, duplicate-request coalescing, manual refresh routing, service disposal, dotenv handling, host-only secret injection, and the SDK's canonical bridge conformance suite against an offline ACP fixture. They also verify rejection of unavailable/API models before CLI launch. These tests use no real key or model calls.

For an optional real request using `.env` in the current directory:

```sh
npm run build
npm run smoke
```

This consumes a small amount of Kimi subscription quota and uses a temporary Kimi home. `KIMI_EXECUTABLE=/absolute/path/to/kimi npm run smoke` overrides the executable. It discovers the model through the BB adapter, opens a session, checks streamed reply text, and releases the session. No additional BB thread is created. Set `KIMI_SMOKE_MODEL=kimi-code/k3` and `KIMI_SMOKE_REASONING=low` to test a specific model/effort.

The provider bridge SDK is a production dependency so Git installations can build the host bundle with dev dependencies omitted. The pinned `bb-app` development dependency supplies a standalone build CLI for CI.

The plugin uses only public `@get-bb/plugin-sdk` entrypoints. `host.ts` wraps the published ACP bridge to resolve host-local credentials immediately before dispatch. `server.ts` defines the settings and provider registration. Headless: no frontend bundle is needed. `src/usage-source.ts` publishes the discoverable Provider Usage v1 RPC contract for the built-in sidebar and usage settings. Its Zod schemas validate both inputs and observations; `zod` is a direct runtime dependency.

For an offline HTTP error/recovery smoke using the real CLI:

```sh
npm run build
KIMI_EXECUTABLE=/absolute/path/to/kimi npm run smoke:errors
```

This seeds a fixture subscription cache and runs an explicit external API fixture on loopback with fake credentials. It checks HTTP 429 with a one-hour Retry-After, the error reported to BB, and a successful next turn in the same session. It makes no production model calls. On macOS a restricted process sandbox may break Kimi's filesystem watchers with `EMFILE`; run the real CLI smoke on the authorized execution host.

## Background-task regression

For a local background-task regression with the real CLI and a fake loopback API:

```sh
npm run build
KIMI_EXECUTABLE=/absolute/path/to/kimi npm run smoke:background
```

This checks rejected native background commands/subagents, disabled task/cron tools, foreground timeout without detachment, ordinary shell commands, visible follow-up replies, and release/resume in the same session. No production model calls or real credentials are used. `npm run smoke:background -- --reproduce` runs an independent control without the plugin policy: a short background shell task triggers the invisible autonomous turn and premature empty `end_turn` on CLI 2.4.0. The control expects the upstream bug and may fail after it is fixed. Both modes use a temporary home and remove their fixtures. Run outside a restricted macOS sandbox if Kimi's watchers fail with `EMFILE`.

## Subscription usage smoke

```sh
npm run build
npm run smoke:usage
```

This makes two authenticated metadata GETs to `/usages`: one through `provider/usage`, one through a local `/usage` turn in the built bridge. It verifies visible completion, formatted quota output, and no CLI home creation. No model call or CLI installation is needed. The default credentials file is `.env`; set `KIMI_USAGE_ENV_FILE=/absolute/path/to/credentials.env` or `KIMI_USAGE_BASE_URL=https://api.kimi.ai/coding/v1` as needed. It uses a temporary bridge directory and removes it after the check.

Offline usage tests also cover sidebar inventory without quota calls, provider ownership, per-host routing, malformed resource IDs, disconnects, observation timestamps, error redaction, concurrent reads and refresh ordering. They cover current and legacy payloads, invalid metadata, privacy, host-only authentication, HTTP failures and timeout signals, size bounds, local turn assembly, cancellation, and suppression of late output. Unit tests inject a bridge writer because the SDK stdout-capture harness conflicts with Node's test-runner IPC. The standalone smoke can use that harness; do not call `bridge.onClose()` in its cleanup because the SDK exits the process and can hide assertion failures.

## Repository layout

| Path | Purpose |
| --- | --- |
| `server.ts` | Provider registration and settings |
| `host.ts` | Host bridge wrapper and request normalization |
| `src/catalog.ts` | Labeled subscription snapshot, optional external API import, and BB picker models |
| `src/subscription-catalog.ts` | Authenticated live catalog, validation, per-account cache, and refresh policy |
| `src/acp-guard.ts` | Host-local ACP launcher that surfaces hidden CLI errors |
| `src/usage.ts` | Host-only subscription quota fetch, validation, and formatting |
| `src/usage-source.ts` | Discoverable per-host quota resources for BB sidebar and usage settings |
| `src/usage-command.ts` | Local `/usage` turns and standard BB `provider/usage` handling |
| `src/credentials.ts` | Host-only dotenv loading and child environment |
| `src/reasoning.ts` | BB-to-Kimi reasoning compatibility |
| `assets/` | Official K glyph and source attribution |
| `skills/kimicode/` | Agent-facing configuration guide |
| `test/` | Offline regression and bridge conformance checks |

## Releases

1. Update `version` in `package.json` and `package-lock.json`, and add a changelog entry.
2. Run the checks above and review the npm package with `npm pack --dry-run`.
3. Commit and push to `main`, then tag that commit as `vX.Y.Z`.
4. Push the tag. The Release workflow reruns CI on Linux and macOS, verifies the tag matches `package.json` and the commit is on `main`, and publishes a GitHub Release using the dated changelog entry. The installation uses Git source, so no binary download is needed.

A Git URL installation tracks the default branch. Users who want a release range can install with:

```sh
bb plugin install 'git:https://github.com/torquemada163/bb-kimicode-plugin.git@^0.5.0'
```

Never move an existing release tag. Generated `dist/` files are built by BB on installation and are not committed. CI verifies tests, types, the pinned SDK, and a build on macOS and Linux. Live smoke checks are manual and require a real subscription key; CI uses no credentials.

The SDK is intentionally a production dependency: host bridge imports must remain available when BB installs from Git with `--omit=dev`. BB 0.46.1’s generic `plugin types --check` asks to move it to devDependencies; do not apply that change to this provider plugin. The clean Git-install build checks the required dependency layout instead.

## Dependency updates

Dependabot checks npm dependencies and GitHub Actions monthly. Minor and patch updates are grouped; major updates arrive as individual PRs for separate review. Node type declarations remain on the Node 22 major used by CI. The Plugin SDK and `bb-app` stay pinned and are updated together manually after compatibility testing. No dependency PRs are merged automatically.
