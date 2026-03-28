# Changelog

English | [日本語](CHANGELOG.ja.md)

All notable changes to pocket-claude are documented here.

## [Unreleased] - 2026-03-28

### Added
- **Scheduled Posts** - Schedule a prompt to be sent at a future date/time; edit or cancel from the output panel; persisted in `scheduled-posts.json` (survives server restarts)
- **Language switching** - UI available in Japanese and English; persisted in localStorage
- **systemd detection badge** - Warns in the header if pocket-claude is running outside systemd management; `/api/health` endpoint returns `systemd_managed` flag
- **Rate limit auto-resume** - When rate-limited, a panel appears to enable server-side auto-resume; schedule persisted in `schedules.json`
- Tab inherits model/effort/thinking settings from the current tab on creation

### Changed
- Effort and Thinking labels localized to Japanese in settings UI
- Model selector default label fixed to alphabetic `default` (prevents layout shift)
- Header button height unified to 30px
- Schedule button uses SVG icon (emoji caused height misalignment)

### Fixed
- Project selector: switching projects now updates selection state immediately without closing settings
- `parseResetTime` now handles `am/pm + IANA timezone` format
- Scheduled posts list rendering: moved `loadScheduledPosts()` call after `loadHistoryBulk` completes to prevent race condition

## [v4.35] - 2026-03-23

### Fixed
- CLI command parse errors (`type: "result"`, `is_error: true`) now displayed in red instead of being silently ignored

## [v4.34] - 2026-03-22

### Changed
- Model selector text aligned left (Safari `text-align-last` fix)
- Send button height now stretches to match textarea height

## [v4.32–v4.33] - 2026-03-22

### Changed
- Tool expansion display reworked to match VS Code extension style: Bash shows IN/OUT, Edit shows red/green diff
- Grep description format unified to `"pattern" (in /path)`
- Status dot: removed border, changed to red
- Tool parameter display inherits output font size

## [v4.31] - 2026-03-22

### Added
- Code font size setting (default 12px, controlled via `--code-font-size` CSS variable)

### Fixed
- Fixed font sizes in ask-text, ask-option, tool-result etc. that were hardcoded and not inheriting output font size

## [v4.30] - 2026-03-22

### Added
- Rate limit auto-resume: server-side scheduler re-sends prompt when rate limit resets; countdown displayed in UI; reset time parsed automatically from Claude's message

## [v4.28–v4.29] - 2026-03-21

### Added
- Thinking control changed from checkbox to 3-state segment: `None | On | Off`

### Fixed
- Rate limit messages now detected from `assistant` event (`ev.error === "rate_limit"`) and displayed in red

## [v4.27] - 2026-03-21

### Added
- AskUserQuestion tool result auto-expands showing question and options

### Fixed
- `--include-partial-messages` was corrupting `input_json_delta`, causing JSON.parse failures silently caught; fixed by using complete `assistant` message data for rendering
- `crypto.randomUUID` polyfill added for HTTP environments
- `Cache-Control: no-store` added to root response

## [v4.26] - 2026-03-21

### Changed
- Usage limit messages from stderr displayed directly as `line-error` (red, normal size) without `[err]` prefix
- Reset time now prominently visible
