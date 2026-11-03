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

The plugin uses only public `@get-bb/plugin-sdk` entrypoints. `host.ts` wraps the published ACP bridge to resolve host-local credentials immediately before dispatch. `server.ts` defines the settings and provider registration. Headless: no frontend bundle is needed.

For an offline HTTP error/recovery smoke using the real CLI:

```sh
npm run build
KIMI_EXECUTABLE=/absolute/path/to/kimi npm run smoke:errors
```

This seeds a fixture subscription cache and runs an explicit external API fixture on loopback with fake credentials. It checks HTTP 429 with a one-hour Retry-After, the error reported to BB, and a successful next turn in the same session. It makes no production model calls. On macOS a restricted process sandbox may break Kimi's filesystem watchers with `EMFILE`; run the real CLI smoke on the authorized execution host.

## Repository layout

| Path | Purpose |
| --- | --- |
| `server.ts` | Provider registration and settings |
| `host.ts` | Host bridge wrapper and request normalization |
| `src/catalog.ts` | Labeled subscription snapshot, optional external API import, and BB picker models |
| `src/subscription-catalog.ts` | Authenticated live catalog, validation, per-account cache, and refresh policy |
| `src/acp-guard.ts` | Host-local ACP launcher that surfaces hidden CLI errors |
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
bb plugin install 'git:https://github.com/torquemada163/bb-kimicode-plugin.git@^0.3.0'
```

Never move an existing release tag. Generated `dist/` files are built by BB on installation and are not committed. CI verifies tests, types, the pinned SDK, and a build on macOS and Linux. Live smoke checks are manual and require a real subscription key; CI uses no credentials.

The SDK is intentionally a production dependency: host bridge imports must remain available when BB installs from Git with `--omit=dev`. BB 0.46.1’s generic `plugin types --check` asks to move it to devDependencies; do not apply that change to this provider plugin. The clean Git-install build checks the required dependency layout instead.

## Dependency updates

Dependabot checks npm dependencies and GitHub Actions monthly. Minor and patch updates are grouped; major updates arrive as individual PRs for separate review. Node type declarations remain on the Node 22 major used by CI. The Plugin SDK and `bb-app` stay pinned and are updated together manually after compatibility testing. No dependency PRs are merged automatically.
