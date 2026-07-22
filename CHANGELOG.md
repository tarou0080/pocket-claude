# Changelog

English | [日本語](CHANGELOG.ja.md)

All notable changes to pocket-claude are documented here.

## [v2.5.0] - 2026-07-22

### Added
- **Model entries use CLI aliases and the dropdown shows the concrete resolved model** - Models are now selected via the Claude CLI aliases (`fable`, `opus`, `sonnet`, `haiku`) instead of pinned IDs, so each tier automatically resolves to its current latest model without maintaining hardcoded version IDs. The dropdown enriches each option's label with the concrete model the CLI actually resolved to (learned from the `system/init` event's `model` field), so **Default** shows e.g. `Default (Sonnet 5)` — making it clear what the CLI default runs. Model names are never hardcoded, so labels track whatever the CLI resolves; the previous separate header caption was removed in favor of this in-dropdown display.

### Changed
- **Fable 5 model label now flags Pro metered billing** - As of 2026-07-20 Anthropic includes Fable 5 in Max / Team Premium subscriptions but bills Pro / Team Standard users per-token (metered) once a one-time $100 credit is exhausted. Since pocket-claude can't know your plan, the default model list labels it `Fable 5 (Pro: metered)` so Pro users aren't surprised by usage charges; Max users can ignore it. See README for details and how to adjust the label.

### Security
- **Bump body-parser to 1.20.6** - Resolves a low-severity denial-of-service advisory (GHSA-v422-hmwv-36x6) where an invalid `limit` value could silently disable request body size enforcement. Transitive dependency via express; lockfile-only change, no API impact.

## [v2.4.0] - 2026-07-18

### Added
- **Configurable bind address** - `host` in `config.json` (or the `HOST` env var) restricts which interface the server listens on. Default remains `0.0.0.0`; set a specific interface IP to make the server reachable only through your reverse proxy.

### Fixed
- **Resume card buried mid-conversation** - The rate-limit resume card now renders in a dedicated status slot above the input area instead of being appended to the conversation flow. History replay racing with card restore (after background resume or re-authentication) can no longer bury the card in the middle of the conversation. Trade-off: the card is always shown above the input rather than inline at the point the limit occurred.
- **Stuck "running" indicator after app resume** - If a turn finished while the app was in the background, returning to the app no longer leaves the status dot blinking "running" with the model selector locked. Reconnect reconciliation is now fully bidirectional against the server, and the dot no longer visually jumps between shapes on every reconnect while a session is running.

### Docs
- README: documented `proxyModels` — route specific models through any Anthropic-compatible proxy endpoint. This is the mechanism behind the v2.3.0 "GLM-5.2 (Cloudflare)" entry, which is not a built-in model.
- Screenshot refreshed (generic paths).

## [v2.3.0] - 2026-07-01

### Added
- **GLM-5.2 (Cloudflare) model option** - Opt-in alternative backend. Only sessions that explicitly select it are routed through a translation proxy; the default Claude path is unaffected and has zero dependency on the proxy's availability.
- **Auto-resume improvements** - Rate-limit auto-resume now waits reset-time + 3 minutes (was +60s) before retrying, and staggers simultaneous resumes across sessions 3 minutes apart to avoid re-triggering the limit. Resume cards now show the actual scheduled kick-off time instead of a generic countdown.
- **Auto-resume default-on setting** - New setting to have rate-limited sessions automatically resume without manually toggling it per incident; persists server-side so it still fires if the client was disconnected when the limit hit. New scheduled-post modals default their date/time field to the rate-limit reset time while a limit is active.

### Fixed
- **Instant conversation restore on reload** - Rendered conversation HTML is now cached (IndexedDB) and restored immediately on page reload, then synced incrementally instead of re-fetching and re-rendering the entire history from scratch.
- **Background-tab state loss on reload** - Resume cards, the running-session badge, and the send queue are now reconciled against the server for every open tab (not just the foreground one) on reload, reconnect, and app-resume, so state left in background tabs is no longer lost.
- **Stale/zombie state during reconnect replay** - Log replay after a reconnect is now tagged distinctly from live events, so replaying old history can no longer resurrect an already-resolved rate-limit card, clear a still-relevant one, or otherwise disturb live UI state.
- **Full-reload blank-conversation regression** - Fixed a case where a hard reload could show an empty conversation instead of the cached history.
- **Resume card double-display and model-switch lag** - Fixed the resume card occasionally appearing twice, and model switches now reflect immediately rather than on the next message.

### Changed
- Model list updated: Claude Sonnet 4.6 replaced with Claude Sonnet 5 (`claude-sonnet-5`).

## [v2.2.0] - 2026-06-12

### Security
- **Removed dead `config/security.js`** - It defined `isPathAllowed()` / `ALLOWED_BASE_DIRS` but was never wired into project loading, giving a false sense of protection. The project-directory trust model (delegated to the network/auth layer) is now documented explicitly in the README instead.
- **`git pull` hardened** - Now runs with `--no-verify` (prevents repo hooks like `post-merge` from firing) and `GIT_TERMINAL_PROMPT=0` (no auth hangs).
- **Process-error messages no longer leak internals** - Spawn errors are logged server-side; clients receive a generic message.
- **Dependencies updated** - `npm audit fix` resolves 4 known advisories (path-to-regexp, qs, body-parser, express) — 0 remaining.

### Changed (internal)
- `getClaudeSessionId` / `saveClaudeSessionId` consolidated into `services/sessions.js`; `services/spawner.js` no longer re-implements them (DRY).
- SSE in-memory buffer capped at 5000 events per session to prevent unbounded memory growth in long-lived sessions (full history still persisted to log files).

### Docs
- README: documented the project-directory trust model; corrected the stale "systemd Integration" feature note to "Port-in-use guard".

## [v2.1.0] - 2026-06-11

### Removed
- **AskUserQuestion choice UI** - The tool is now disabled at the CLI level (`--disallowed-tools AskUserQuestion`). In headless stream-json mode the CLI self-resolves the tool call with an error before any answer can be injected, so a tappable choice UI cannot work by design. The model now asks questions in plain text and you reply in the normal input field. The `/api/respond` endpoint and all related UI code were removed.

### Added
- **Claude Fable 5** added to the built-in model fallback list (Opus 4.7 → 4.8 also updated)
- **Scroll-to-bottom button** - Circular button appears when scrolled up in the output area
- **Resume with progress** - Session resume shows percentage progress instead of a blank screen
- Image attachment UX improvements

### Fixed
- Rate-limit panel and send-queue panel now re-sync with the server on SSE reconnect; stale panels no longer linger when auto-resume or queue consumption happened while the device was in background
- Auto-resume ON registration no longer destroyed by subsequent rate-limit events
- Auto-resume ON button silent failure fixed; schedule registration is now logged
- Models newly added to `config.json` now appear in the selector automatically
- SSE freeze after returning from background fixed; running sessions always reconnect on visibility change
- Duplicate log rendering after background resume fixed
- Rate-limit card no longer reappears after reload, tab switch, or past its reset time
- `Surrogate-Control: no-store` added to bypass Cloudflare caching of API responses
- iOS Safari auto-zoom prevented on settings modal inputs

### Changed (internal)
- `projects.json` and `schedules.json` removed from version control (local state files; see `projects.example.json`)

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
