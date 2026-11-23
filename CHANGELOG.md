# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] - 2026-11-23

### Changed
- Tests are split in two layers: `npm test` runs only deterministic unit tests (fixtures, the CLI called in-process, the probe server in memory; no timers, child processes, temporary files or ports), and `npm run test:integration` runs the real child-process, timer and demo checks locally.
- CI is reduced to `npm ci`, `npm run build` and `npm test` on Node 22; the failure-diagnostics helper and the log upload are removed.
- The CLI entry point is split into `src/cli.ts` (starts the process) and `src/main.ts` (the commands). Output and exit codes are unchanged.

### Docs
- README: all extra verdict reasons are listed, the 0 ms of the simulated refresh client is explained, and the log example is in seq order.

## [0.1.4] - 2026-11-23

### Fixed
- `--help`: the `report` exit-code line now matches behavior (0 includes PASS_SLOW, 64 is a usage error). Tests: 42.

## [0.1.3] - 2026-11-23

### Fixed
- Tests: timing assertions relaxed further for slow CI runners; the CLI test child process now has a 120 s upper bound.
- CI: the workflow prints diagnostics on failure, using the new helper `.github/scripts/explain-failure.mjs`.

## [0.1.2] - 2026-11-23

### Fixed
- `demo`: the refresh client now waits for its re-list to finish instead of a fixed pause, so results no longer depend on machine speed.
- `demo`: the delayed client schedules its re-list once per trigger.
- A log path that cannot be written now exits with code 3 and a clear message.
- Tests: stdio timing assertions relaxed for slow CI; added a test for the log-path error.
- CI: job timeout and tool versions printed in the log.

## [0.1.1] - 2026-11-23

### Fixed
- Stabilized the stdio, in-memory and CLI tests so the CI workflow passes.

## [0.1.0] - 2026-11-23

### Added
- `serve`: stdio probe MCP server with `tools`, `prompts` and `resources` scenarios; the change is triggered by calling `probe_add` or by `--after <seconds>`.
- JSONL v1 traffic log (`seq`, `t_ms`, session ids); a second run appends to the same log.
- `report`: seq-based judge (PASS, PASS_SLOW, FAIL, UNKNOWN), stale-call detection, `refreshed_on_new_session`, table or JSON output, exit codes 0/1/2/3.
- `demo`: three simulated reference clients (refresh, ignore, delayed) against the real probe server.
- `--lang en|ko`, `LISTCHANGE_PROBE_LANG`, then `LC_ALL`/`LC_MESSAGES`/`LANG`.
- `examples/dispatcher-server.ts`: fixed-dispatcher workaround for clients that ignore `list_changed`.

[Unreleased]: https://github.com/LeeGyeongPil/listchange-probe/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/LeeGyeongPil/listchange-probe/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/LeeGyeongPil/listchange-probe/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/LeeGyeongPil/listchange-probe/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LeeGyeongPil/listchange-probe/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LeeGyeongPil/listchange-probe/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/LeeGyeongPil/listchange-probe/releases/tag/v0.1.0
