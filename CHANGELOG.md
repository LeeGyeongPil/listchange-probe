# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/LeeGyeongPil/listchange-probe/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LeeGyeongPil/listchange-probe/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/LeeGyeongPil/listchange-probe/releases/tag/v0.1.0
