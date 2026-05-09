# Changelog

English | [日本語](CHANGELOG.ja.md)

All notable changes to pocket-claude are documented here.

## [v2.0.0] - 2026-05-09

### Added
- **Request body size limit** - Configurable from the Settings panel (MB; 0 = unlimited); applied server-side at runtime without restart; stored in `config.json`
- **Model list API** (`GET /api/models`) - Returns available models from `config.json`; fallback to built-in list on failure
- **Image attachment** - Attach images to prompts (base64, multi-image supported)
- **Status icon with stop control** - Integrated stop button in the header status icon
- **Clipboard button** - Added to header for quick copy

### Fixed
- Idle state false-positives suppressed via `turning` flag in `/api/status`
- SSE reconnect no longer triggers spurious `isRunning=true`
- Scheduled post card prompt truncation fixed
- SSE reconnect now correctly reflects running status
- Status icon size, animation, and appearance corrected
- ctx% display in history replay after browser reload
- iOS Safari auto-zoom on schedule modal inputs prevented
- Always-on mode: auto-resume, scheduled posts, and status icon now work correctly

### Changed (internal)
- `getClaudeSessionId()` consolidated from 3 duplicated locations into `services/sessions.js`

## [2026-03-28]

### Added
- **Scheduled Posts** - Schedule a prompt to be sent at a future date/time; edit or cancel from the output panel; persisted in `scheduled-posts.json` (survives server restarts)
- **Language switching** - UI available in Japanese and English; persisted in localStorage
- **Rate limit auto-resume** - When rate-limited, a panel appears to enable server-side auto-resume; schedule persisted in `schedules.json`
- **AskUserQuestion display** - Tool result auto-expands showing question and options
- **Code font size setting** - Independently configurable from output font size
- Tab inherits model/effort/thinking settings from the current tab on creation
- Thinking control: 3-state segment (`None | On | Off`) instead of checkbox

### Changed
- Tool expansion display reworked to VS Code extension style: Bash shows IN/OUT, Edit shows red/green diff
- Rate limit messages displayed in red; reset time prominently visible
- Usage limit stderr messages shown as `line-error` without `[err]` prefix
- Model selector text aligned left; Send button height stretches with textarea
- Header button height unified to 30px
- Settings UI labels for Effort and Thinking localized to Japanese

### Fixed
- CLI command parse errors (`is_error: true`) now shown in red instead of silently ignored
- `crypto.randomUUID` polyfill added for HTTP environments
- `parseResetTime` handles `am/pm + IANA timezone` format
- Scheduled posts list no longer conflicts with history loading (race condition fixed)
- Project selector updates selection state immediately after switching without closing settings

## [2026-03-21]

### Added
- **History browser** - Browse and resume past sessions
- **SSE output buffering** - Reconnection restores previous output
- **Multiple themes** - Blue Dark / Purple Dark via CSS variables + themes.js
- **Context usage bar** - Real-time token % display
- **Project management** - Add/remove project directories from browser UI; `ADDITIONAL_ALLOWED_DIRS` env var support
- **Graceful shutdown** - SIGTERM handling
- **Startup repair** - Unfinished log entries from previous crashes are automatically closed

### Changed
- Tab management moved to localStorage only (no server-side tabs.json)
- Session persistence separated: pocket-session ID and Claude session ID managed independently
