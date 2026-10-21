# Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
bb plugin build
npm run check:install
npm run check:package
```

Tests cover full catalog snapshots, provider credential separation, unchanged source files, snapshot permissions, native thinking metadata, dotenv handling, host-only secret injection, parent-environment preservation, missing/oversized/malformed credentials, and the SDK's canonical bridge conformance suite against an offline ACP fixture. These tests use no real key or model calls.

For an optional real request using `.env` in the current directory:

```sh
npm run build
npm run smoke
```

This consumes a small amount of Kimi subscription quota and uses a temporary Kimi home. `KIMI_EXECUTABLE=/absolute/path/to/kimi npm run smoke` overrides the executable. It discovers the model through the BB adapter, opens a session, checks streamed reply text, and releases the session. No additional BB thread is created. Set `KIMI_SMOKE_MODEL=kimi-code/k3` and `KIMI_SMOKE_REASONING=low` to test a specific model/effort.

The provider bridge SDK is a production dependency so Git installations can build the host bundle with dev dependencies omitted. The pinned `bb-app` development dependency supplies a standalone build CLI for CI.

The plugin uses only public `@get-bb/plugin-sdk` entrypoints. `host.ts` wraps the published ACP bridge to resolve host-local credentials immediately before dispatch. `server.ts` defines the settings and provider registration. Headless: no frontend bundle is needed.

## Repository layout

| Path | Purpose |
| --- | --- |
| `server.ts` | Provider registration and settings |
| `host.ts` | Host bridge wrapper and request normalization |
| `src/catalog.ts` | Private, isolated snapshot of Kimi provider/model tables |
| `src/credentials.ts` | Host-only dotenv loading and child environment |
| `src/reasoning.ts` | BB-to-Kimi reasoning compatibility |
| `assets/` | Official K glyph and source attribution |
| `skills/kimicode/` | Agent-facing configuration guide |
| `test/` | Offline regression and bridge conformance checks |

## Releases

1. Update `version` in `package.json` and `package-lock.json`, and add a changelog entry.
2. Run the checks above and review the npm package with `npm pack --dry-run`.
3. Commit and push to `main`, then tag that commit as `vX.Y.Z`.
4. Push the tag and publish GitHub release notes from `CHANGELOG.md`.

A Git URL installation tracks the default branch. Users who want a release range can install with:

```sh
bb plugin install 'git:https://github.com/torquemada163/bb-kimicode-plugin.git@^0.2.3'
```

Never move an existing release tag. Generated `dist/` files are built by BB on installation and are not committed. CI verifies tests, types, the pinned SDK, and a build on macOS and Linux. Live smoke checks are manual and require a real subscription key; CI uses no credentials.

The SDK is intentionally a production dependency: host bridge imports must remain available when BB installs from Git with `--omit=dev`. BB 0.46.1’s generic `plugin types --check` asks to move it to devDependencies; do not apply that change to this provider plugin. The clean Git-install build checks the required dependency layout instead.
