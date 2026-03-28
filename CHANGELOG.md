# Changelog

All notable changes to pocket-claude are documented here.

## [1.0.0] - 2026-03-21

Initial public release.

### Features

#### Core
- Claude Code CLI web interface via `claude -p` one-shot mode
- SSE streaming with automatic reconnection and output buffering
- Tab-based conversation management (localStorage only, no server-side tabs)
- Session persistence: resume past conversations from history browser
- Queue-based execution (one Claude process per tab)
- Graceful shutdown on SIGTERM

#### UI
- Mobile-first design, optimized for iOS Safari (visualViewport API for keyboard handling)
- Dark theme (Blue Dark / Purple Dark) via CSS variables + themes.js
- Real-time context usage bar (token %)
- Markdown rendering (marked.js)
- Tab inherits model/effort/thinking settings from current tab on creation
- Language switching: Japanese / English (persisted in localStorage)

#### Settings
- Model selection: Sonnet 4.6, Opus 4.6, Haiku 4.5
- Effort level: Low / Medium / High (Max for Opus only)
- Thinking: None / On / Off (3-state segment control)
- Font size and code font size independently configurable

#### Tool Display
- VS Code-style tool expansion: Bash shows IN/OUT, Edit shows red/green diff
- AskUserQuestion auto-expand with question and options listed
- Error results (`is_error: true`) shown in red

#### Rate Limit Handling
- Rate limit messages displayed in red
- Auto-resume scheduler: set a time and pocket-claude re-sends automatically (server-side, browser-independent)
- Schedule persisted in `schedules.json` — survives server restarts

#### Scheduled Posts
- Schedule a prompt to be sent at a future date/time
- Edit or cancel from the output panel
- Persisted in `scheduled-posts.json` — survives server restarts

#### Project Management
- Add/remove project directories from browser UI
- `projects.json` for persistent configuration
- `ADDITIONAL_ALLOWED_DIRS` environment variable support

#### Reliability
- systemd detection badge: warns if pocket-claude is running outside systemd
- Startup repair: unfinished log entries from previous crashes are automatically closed
- `/api/health` endpoint with `systemd_managed` flag
