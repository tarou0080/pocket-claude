# Changelog

English | [日本語](CHANGELOG.ja.md)

All notable changes to pocket-claude are documented here.

## [v2.21.1] - 2026-10-04

### Changed
- **Maintenance mode** - Claude Code now has official [Remote Control](https://code.claude.com/docs/en/remote-control), so no new features are planned. The README (English/Japanese) states what will still be fixed: security issues (including bundled libraries) and breakage from Claude Code CLI changes.
- Added `SECURITY.md`: report vulnerabilities through GitHub private vulnerability reporting, not public issues.
- Updated the bundled DOMPurify from 3.4.14 to 3.4.16 (GHSA-p98j-92pf-mc4p, low severity). pocket-claude was not affected — the issue needs `IN_PLACE` sanitizing together with a hook that removes nodes, and pocket-claude uses neither — but the bundled copy now matches the fixed release.
- Refreshed the settings screenshot (English UI).

## [v2.21.0] - 2026-10-04

### Changed
- **All UI text goes through the dictionary** - v2.20.0 only covered conversation lines; the rest of the UI still had text written directly in the code (header tooltips, history panel, schedule modal and list, rate-limit card, resume button, send errors, Effort labels, ...), so English users saw Japanese and Japanese users saw English. Every user-facing string now comes from `STRINGS` via `t()`. Static HTML uses `data-i18n` / `data-i18n-title` / `data-i18n-aria` and is re-applied when the language changes. CLI terms that stay English in both languages (Done, Interrupted, compacted?, auto-compact, effort levels, ...) are defined once in `CLI_TERMS`.
- **Server messages are English with a key** - Failure reasons sent by the server (`reason`) are now English, with a `reasonKey` (`deliveryFailed`, `injectFailed`, `noProject`, ...) that the UI translates. `POST /api/claude` failures include `reasonKey`; scheduled posts carry `failedReasonKey` (older saved posts without it show their stored text). Reasons without a key (e.g. exception messages) are shown as is.
- The default auto-resume prompt follows the language (`続けてください` / `Please continue.`) unless you set your own.
- `test/ui-glyphs.test.js` now also fails on Japanese text outside the dictionary (client and server), visible text or `title`/`placeholder`/`aria-label` written directly in the HTML, keys missing from either language, and server keys/reason keys without a translation.

## [v2.20.0] - 2026-10-04

### Changed
- **Line icons instead of color emoji** - Markers in the conversation (notifications, retries, "waiting to be read", compacted?, Done/Interrupted, stopped, scheduled-post and auto-resume messages) and in the rate-limit card and scheduled-post list were emoji (🔔 ⏳ ⚡ 🕐 ⏱ ⚠). Emoji ignore the line color and stood out, especially on iPhone. They are now line icons drawn like the header buttons (Feather Icons) and follow the line color. A test fails if color emoji come back.
- **Conversation messages follow the language setting** - Messages that were hard-coded in Japanese (stopped, could not stop, retrying, waiting to be read, agent exited, scheduled-post failures, ...) now switch with the Japanese/English setting. Messages sent by the server (scheduled post sent, auto-resumed, send failures) carry a `key` and `params` so each device shows them in its own language; the Japanese `text` is kept as a fallback for older pages. CLI terms (Done, Interrupted, compacted?, auto-compact) stay in English as before, and text written by the CLI is shown as is.
- Server warnings shown in the conversation (scheduled post / auto-resume / send failures) are now red like other errors.

## [v2.19.2] - 2026-10-04

### Fixed
- **`ops/update-claude-cli.sh` defaults to `http://localhost:3333`** - The `POCKET_URL` fallback used to check `GET /api/busy` before restarting pointed at a private address from the author's setup. Set `POCKET_URL` (e.g. in the crontab line) if pocket-claude listens on a specific address.
- **`.gitignore` ignores leftovers from removed features again** - `sessions/` and `migration-backup-*.tar.gz` (the v2.12.0 backup, which contains conversation logs) can still exist in installs that ran older versions. Their ignore rules were dropped together with the features in v2.14.0; they are back so the leftovers can't be committed by accident.
- **Scheduled-post routes reject non-UUID session IDs consistently** - `GET /api/scheduled-posts/session/:sessionId` now returns 400 for an invalid ID instead of an empty list, matching the other routes.

### Docs
- Transcript path corrected to `~/.claude/projects/<project-dir>/<id>.jsonl` (README, v2.14.0 entry).
- v2.14.0: added an upgrade note for installs still on v2.11.x or earlier.

## [v2.19.1] - 2026-10-03

### Fixed
- **Background notifications shown as one line** - Notifications (command completion, Monitor events and stream end) were rendered with the CLI's tags for Claude (`<task-id>`, `<summary>`, `<event>`, ...) and looked like leaked code. They are now shown as a single `🔔 …` line with just the human-readable summary and event, in both the conversation view and the history detail view. Task IDs and output file paths are hidden. Unknown shapes with neither summary nor event are shown raw as before.

## [v2.19.0] - 2026-09-28

### Fixed
- **Auto-resume after a weekly limit was scheduled a day early** - The date in "resets Sep 28, 3am (Asia/Tokyo)" was ignored and the resume was set for the next 3am, i.e. while still limited. Dated messages are now parsed with their date (rolling over to next year when needed).
- **A restart right after the reset time silently dropped auto-resumes** - On startup, schedules whose reset time had passed were discarded, even though the resume fires 3 minutes after the reset. Overdue resumes are now kept and fire 3 minutes after startup.

### Added
- **`GET /api/busy`** - Returns `{"running": n}`, the number of turns in progress, so maintenance jobs (e.g. CLI updates) can avoid restarting mid-turn. `ops/update-claude-cli.sh` now defers the restart to a later run while a turn is running.

## [v2.18.0] - 2026-09-28

### Fixed
- **Messages sent while Claude is working show up in the conversation again** - Since v2.15.0 the conversation is drawn from the CLI's transcript, but a message sent mid-turn is not written there as a user line: the CLI queues it and, when it reads it after the running tool finishes, records it as `attachment{type:"queued_command"}` (nothing is printed on stdout). pocket-claude skipped that record, so these messages never appeared, live or in history (Claude did receive them). They are now shown as your message at the point Claude read it, both live and when reopening past conversations. Background task notifications that arrive mid-turn are shown the same way as those between turns (`[notification]`).
- **Sending mid-turn no longer drops the in-progress output kept for reconnects** - The server cleared the current turn's buffer on every send, so reconnecting right after a mid-turn send redrew a block from the middle. It is now cleared only when a send starts a new turn.

### Added
- **"Waiting to be read" indicator** - Until Claude reads a message sent mid-turn (up to the end of the running tool, which can be minutes), the slot above the input shows `⏳ 取り込み待ち: <start of message>`. It disappears when the message appears in the conversation or the turn ends. Memory only: a reload hides it, but the message still appears once read. `POST /api/send` returns `queued: true` in this case (additive).

## [v2.17.0] - 2026-09-28

### Fixed
- **Model names in the dropdown are no longer guessed by each browser** - Labels used to be rewritten from a per-browser cache keyed by whatever the tab had selected, and the cache was also rewritten while replaying old conversations. Opening a Sonnet conversation could relabel a pinned `claude-opus-5-5` option as `Sonnet 5`, so the option you added seemed to be missing. The server now records which model each dropdown value actually ran as (the CLI's report right after pocket-claude starts a session or switches its model with that value) and returns it from `/api/models` along with the context window. Browsers render that as-is: configured names are never replaced; aliases get the actual model in parentheses (`Opus (Opus 5.5) · 1M`). The old browser caches (`pc-resolved-models`, `pc-model-context`) are deleted on load.
- **Reopening a conversation from history restores the option you actually picked** - Transcripts only hold the resolved model, which cannot tell `opus` from a pinned `claude-opus-5-5`. `/api/session-settings` and auto-resume now use the value pocket-claude itself passed when it last started the session (from its own log), then fall back to matching the last model that answered.
- **`config.example.json` no longer hides the Claude models** - It listed only the proxy example, and `models` replaces the whole list, so copying it as the README says left only "My Proxy Model". It now includes the default aliases.

### Changed
- **The default model list lives on the server** (`DEFAULT_MODELS` in `services/models.js`) instead of `ALL_MODELS` in `public/index.html`. `/api/models` always returns a full list; each entry may carry `resolved` and `contextWindow` (additive).

## [v2.16.2] - 2026-09-24

### Fixed
- **A changed auto-compact window now reaches idle sessions** - The CLI reads `autoCompactWindow` only at startup, so a session whose process was already waiting kept the old value after you saved a new one (resuming it from history just re-attaches to that process). On the next send, if the idle process was started with a different value than the current setting, that session alone is restarted with `--resume` (the same path a model switch across proxy routes already uses), so the new value applies from that turn and the `✓` line shows it. Other tabs and sessions in the middle of a turn are untouched. Scheduled posts and auto-resume still inject into a live process as before; the next manual send applies the change.

## [v2.16.1] - 2026-09-24

### Changed
- **The `✓` line's auto-compact note is always in English** - `· auto-compact ~267K` / `· auto-compact: CLI default`, in the CLI's own term (`autocompact`), like the rest of the line (`K`, `%`). Front-end only.

## [v2.16.0] - 2026-09-24

### Added
- **Auto-compact window setting** - The settings modal has a new `Auto-compact window` choice (`CLI default` / `100K`–`1M`, same steps as the CLI's own setting). It is stored in `config.json` as `autoCompactWindow` (`GET`/`PATCH /api/server-config`) and passed to every spawned session via `--settings` as the CLI's `autoCompactWindow`, so browserless paths (scheduled posts, auto-resume) honor it too. It takes effect for sessions started after saving; running sessions keep the value they were started with (the CLI's `apply_flag_settings` control request acknowledges this key but does not apply it to a running session). Values above the model's window are capped by the CLI. Also sent to proxy models: it only affects the CLI's own compaction decision, nothing is sent to the API.
- **`✓` line shows where auto-compaction starts** - e.g. `✓ 4% (39K / 1000K) · auto-compact at ~267K`. The server attaches the value the session was started with to each `result` event (`autoCompactWindow`, `null` = CLI default), so the line is right after a reload and after the setting changes mid-conversation. The start point is `min(window, context window) - 33K` (the CLI's autocompact buffer as measured with `/context`; the CLI does not report it, hence "~"). Sessions on `CLI default` show `auto-compact CLI default` without a number, because the CLI's default start point cannot be observed from outside (Haiku's `/context` shows no buffer at all).
- **Model dropdown shows each model's context window** - e.g. `Opus 5.5 · 1M`, `Haiku 4.5 · 200K`, learned per device from `result.modelUsage[].contextWindow` the first time a model is used (stored in `localStorage` as `pc-model-context`). Nothing is hard-coded, in line with the resolved-name labels.

## [v2.15.3] - 2026-09-24

### Fixed
- **Conversations in projects other than the first now work end to end** - The CLI stores each conversation under a directory derived from its working directory, but pocket-claude only ever looked in the one derived from `$HOME`. Conversations started in any other project never appeared in history, and since v2.15.0 (where the body is streamed from the CLI transcript) they could not be streamed, restored, or resumed correctly either. Transcripts are now located in every registered project's directory (history, replay, live tail, session settings), and the new-vs-resume decision looks where the CLI itself will look (the spawn cwd). The history panel now lists the current tab's project only and shows its name in the title; `GET /api/history?project=<name>` filters, and each entry carries `project`.
- **Directory names follow the CLI's rule** - Every non-alphanumeric character becomes `-` (previously only `/`), so homes such as `/home/john.doe` resolve correctly; names over 200 characters are matched by the CLI's hashed prefix.
- **Tests no longer depend on the running `config.json` or write into `~/.claude`.**

## [v2.15.2] - 2026-09-24

### Fixed
- **Every item in the settings modal now waits for `Save ✕`** - The header-confirm flow from v2.10.0 only covered the tool lists and the body-size limit; device settings (default model, visible models, effort, thinking, resume prompt / resume-by-default, font sizes, theme, language) were written to `localStorage` on every click, so changing them never turned `✕` into `Save ✕` and there was no way to undo. Now any change since the modal was opened shows `Save ✕` / `Cancel`: changes preview immediately, `Save ✕` commits them (effort is applied to all tabs and thinking to the current tab at that point; resume-by-default is sent to the server in the same PATCH), and `Cancel` restores the values from when the modal was opened, including the look. Reverting a change by hand returns the header to `✕`. Front-end only, no restart needed.

## [v2.15.1] - 2026-09-21

### Fixed
- **Effort option `Auto` renamed to `CLI default`** - The label was wrong. Neither the `claude` CLI nor the API has a mode that picks the effort level per prompt; with this option pocket-claude simply passes no effort, and the CLI resolves it as `effortLevel`/`modelSettings` in `~/.claude/settings.json`, else the model default (`high` on Opus 5 / Sonnet 5). README now states this. Stored value (`''`) is unchanged, so existing tabs and saved settings are unaffected; front-end only, no restart needed.

## [v2.15.0] - 2026-09-17

### Changed
- **Conversations are delivered over a single path** (part 3 of 3) - `GET /api/stream` now takes `fromA`/`fromB` cursors instead of `fromLine`/`epoch`/`Last-Event-ID`. Conversations pocket spawned and conversations started outside pocket-claude (`claude --session-id ...` in a terminal) are streamed through the same route; the only remaining branches are the synthesized `start` event for external sessions and watching the external pid for `done {reason:'external_exit'}`. After the opening replay (`event: history` with `id: A<n>`/`B<n>`), the in-flight turn's buffered events are re-sent (converted to the display vocabulary where they are `assistant`/`user`, raw otherwise), then a `history-meta {maxA, maxB, external}` closes the replay section, and everything after that is live, as anonymous events. Appended A lines are tailed per session (size-diff read, incomplete trailing line buffered as bytes) and re-sent as `event: history` with `id: A<n>`, so a B line and its A counterpart can be deduped by the client.
- **`X-Cursor-A` / `X-Cursor-B`** - `GET /api/history/:id/events` now returns the cursors (`maxA+1` / `maxB+1`) the client should send back as `fromA`/`fromB` when re-opening the stream. A cursor that runs past the server's history (file swept, session reused) is answered with a single `history-meta {maxA, maxB, reset:true}` instead of a partial replay.
- **Fact logs are self-weaving** - Each line in `logs/<id>.jsonl` now carries `after: <uuid|null>` (the uuid of the preceding A line), so the pocket log says by itself where it hangs off the CLI transcript. `log_start`/`mainLines`/`epoch` markers are gone; legacy-format logs are converted to the `after` format once at startup.
- **The current turn's raw stdout events are no longer persisted** - They live only in memory (`state[id].buffer`) and are re-sent to newly connecting clients; the full history remains in A (the CLI transcript) and B (facts only).

### Migration note
- Old `logs/*.jsonl` files (with a `log_start` first line) are converted in place at startup; no manual action needed. Clients must stop sending `fromLine`/`epoch` and use `fromA`/`fromB` (this repo's bundled `public/index.html` is updated in the same release).

## [v2.14.0] - 2026-09-16

### Changed
- **`sessions/*.json` and the v2.12.0 startup migration are removed** - pocket-claude no longer keeps its own session metadata files. Project, model, effort, and thinking are all read directly from the CLI's own transcript (`~/.claude/projects/<project-dir>/<id>.jsonl`) via the new `services/session-facts.js`. The startup migration, `PC_SKIP_STARTUP_MIGRATION`, and `migration-backup-*.tar.gz` are gone. This follows the design principle "a thin wrapper should not hold facts that the CLI already holds".
- **Conversations started outside pocket-claude are now tracked live** - If a `claude` process is running with `--session-id <id>` or `--resume <id>` but pocket-claude did not spawn it, the UI still shows it as running, streams its output from the CLI transcript, and prevents conflicting sends with a 409 `external process running`. When the external process exits, the pane displays `── External process ended ──`.
- **`POST /api/send` can now omit the `model` field to mean "do not change"** - Sending `model: ''` still means "use the default", and any other value still switches the model. Sending no `model` at all leaves the current session's model untouched.
- **History list now shows each conversation's last used model** - `GET /api/history` includes a `model` field for each session, and the client meta line displays `date · N messages · <model>` (omitted if unknown).
- **Old pocket-ID tabs are no longer forwarded** - The `canonicalId` field and the `movedTo` forwarding stub infrastructure from the v2.12.0 migration have been removed. Tabs that still hold an old pocket ID are simply reopened under the canonical session ID.

### Migration note
- **Upgrading from v2.11.x or earlier: start v2.13.1 once first.** The one-time ID unification (and its `migration-backup-*.tar.gz`) only exists in v2.12.0-v2.13.1. If you jump straight to v2.14.0 or later, it never runs: your conversations stay reachable from History (they live in the CLI's transcripts), but open tabs, scheduled posts and auto-resume entries that still refer to old pocket IDs will not find their conversation. `git checkout v2.13.1 && npm start`, wait for the conversion log to finish, then update.
- A leftover `sessions/` directory and any `migration-backup-*.tar.gz` are no longer read and can be deleted once you are satisfied.

## [v2.13.1] - 2026-09-15

### Docs
- CHANGELOG: v2.12.2 (cursor generation / out-of-range reset) now has its own heading; it had been folded under v2.12.3.
- README: the `permissionMode` note no longer lists the CLI's accepted values - the value is passed to `claude --permission-mode` as-is and pocket-claude keeps no copy of that list (matches the v2.13.0 change).
- `config.example.json` now shows `toolsDirect` alongside `toolsProxy`.
- `screenshots/projects.png` updated to the current Settings panel (tool allowlists, header Save/Cancel).

## [v2.13.0] - 2026-09-15

### Changed
- Retention for `logs/*.jsonl` no longer uses a hardcoded 30-day constant - it now follows Claude Code's own `cleanupPeriodDays` setting, read from `/etc/claude-code/managed-settings.json` first, then `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`); project/local settings are not consulted. Missing or invalid values (absent, non-numeric, `<= 1`) fall back to 30 (new `services/claude-dir.js`, `readCleanupPeriodDays`).
- `sessions/*.json` (pocket's own session metadata) is now swept on the same age basis as logs - it previously had no lifespan and had grown to 1332 files in production against 122 CLI transcripts. `sessions/.schema.json` (the migration version marker) is excluded from the sweep.
- `services/directories.js`'s `sweepOldPocketLogs` was generalized into `sweepOldFiles(dir, ext, maxAgeDays, { exclude })` plus a new `sweepRetention(maxAgeDays)` that sweeps both `logs/` and `sessions/` in one call. `server.js` now reads `cleanupPeriodDays` once at startup and passes that same value to both the startup sweep and the daily `setInterval` - a config change takes effect on restart.
- `services/history.js` no longer computes `~/.claude/projects/<...>` itself; it now takes `CLAUDE_PROJECTS_DIR` from the new `services/claude-dir.js`, which honors `CLAUDE_CONFIG_DIR` if set (previously hardcoded to `~/.claude` regardless of the CLI's own config location).
- `services/spawner.js` no longer duplicates the CLI's list of valid `--permission-mode` values or silently falls back to `acceptEdits` on an unrecognized one. `config.permissionMode` (defaulting to `acceptEdits` if unset) is passed to the CLI as-is; an invalid value is now rejected by the CLI itself, visible in the tab as a stderr message, instead of being silently rewritten.

### Migration note
- The v2.12.0 startup migration (`sessions/*.json` merge, `migration-backup-*.tar.gz`, `PC_SKIP_STARTUP_MIGRATION`) was removed in v2.14.0. From v2.14.0 onward pocket-claude keeps no session metadata of its own.

## [v2.12.4] - 2026-09-15

### Changed
- Removed the `serverShuttingDown` shutdown flag and its `markServerShuttingDown` function/export from `services/spawner.js` and `server.js` - the process-close discard it used to suppress was already removed in v2.12.3, so the flag no longer guarded anything and the comment describing it was stale.
- `sweepOldPocketLogs` now takes the target directory as a second argument (`sweepOldPocketLogs(maxAgeDays, dir)`), defaulting to `config.LOGS_DIR` so `initDirectories()` and the daily `server.js` timer are unaffected. `test/directories.test.js` now runs entirely against a `fs.mkdtempSync` temp directory instead of writing into and sweeping the real `logs/` directory.

### Docs
- README.md's v2.12.0 upgrade note now makes clear the described live-log deletion happened only during that one-time conversion, and that live logs are kept under the 30-day retention from v2.12.3 onward - the previous wording read as still-current behavior.

## [v2.12.3] - 2026-09-15

### Fixed
- **Crossing a server restart could drop a tab's start marker, token-percent line and `⚠ Interrupted (server restarted)` indicator** - the startup sweep used to delete any live log (`logs/<id>.jsonl`) whose CLI transcript counterpart already existed, on the assumption the live log was then redundant. The CLI's own transcript carries none of pocket-claude's own server-side facts (`done`, `result`, `start`, stderr), so once the live log for a session was swept, reopening that tab after a restart rebuilt it purely from the CLI transcript and those markers were gone.

### Changed
- **The live log's lifetime is now a plain 30-day age-based sweep, not process-close discard or a "CLI transcript already exists" startup sweep** - both of those removed logs that were still the only source for on-screen markers. The `log_start` boundary already cuts precisely regardless of how long a live log is kept, so keeping it longer does not cause duplicate rendering. The sweep now runs at startup and once a day thereafter.

## [v2.12.2] - 2026-09-14

### Fixed
- **A turn that finished while a device was disconnected could silently vanish** - v2.12.1 made the live log (`logs/<id>.jsonl`) live for exactly one turn, discarded right after the CLI reports `result`/`error`. If the turn finished while the client was offline, the file was already gone by the time the client reconnected and asked for the line after the one it last saw - there was nothing there to serve, and that turn simply never appeared. A related, longer-standing gap: after a server restart, line numbers start over from zero, and if a session's live log grew past a stale cached line number before the client reconnected, the client had no way to tell its cursor no longer pointed at what it used to and would silently splice new content onto old.
### Changed
- **The live log's lifetime is now the CLI process's lifetime, not one turn** - the discard that used to run right after `result`/`error` is gone; the log is only removed when the CLI process actually closes (unchanged) or by the startup sweep for logs left over from a crash. A new `log_start` line marks where a live log picks up relative to the CLI's own transcript, replacing the previous text-matching heuristic used to avoid re-showing the same turn twice on reopen.
- **The server can now tell a client its saved position is invalid, in both directions** - each server process now has a generation number (an "epoch"), and every stream response reports it alongside the valid line range. A client whose epoch doesn't match, whose position now predates everything the server has, or whose position is ahead of everything the server has, is told to discard its cache and start over - server-driven now, rather than relying on the client noticing on its own.

## [v2.12.1] - 2026-09-14

### Fixed
- **Resuming a conversation from history sometimes rendered it twice** - v2.12.0's ID unification meant a conversation's live log (`logs/<id>.jsonl`) now survives under the same ID history looks up, which broke the assumption that a tab opened from history had no live log of its own. Resume drew the full conversation from the CLI's own transcript, then immediately opened the SSE stream from line 0, which replayed the live log's own copy of the same turns on top - visible as every message doubling in the pane. The live log's lifetime is now exactly one turn: it is discarded right after the CLI reports `result`/`error`, not only when the process later closes, and a startup sweep removes any left over from a prior crash or restart. `GET /api/history/:id/events` now also trims the currently in-progress turn from the transcript it returns when a live log still exists for it, since that turn arrives separately over the reopened stream. Discarding the live log no longer rewinds its line-number counter, so the client's existing duplicate-line guard keeps working across a discard.
- **The client's history-loading path is now a single function** - `resumeConversation`'s download/parse/render phase and a separate `fillFromHistoryEventsOnce` catch-up path did the same thing slightly differently; only one of them exists now (`loadHistoryIntoPane`), called before the live connection opens whenever a pane is still empty.

## [v2.12.0] - 2026-09-09

### Changed
- **A conversation now has one ID instead of two** - Every conversation used to carry two identities: a "pocket session ID" that pocket-claude invented, and the Claude session ID the CLI created for the same conversation. History lists conversations by the Claude ID, while settings, the running process, auto-resume and scheduled posts were all keyed by the pocket ID. Three separate pieces of code tried to translate between them and the places that had no translation simply broke - most visibly, a conversation started on Sonnet came back as something else when reopened from history, because the settings lookup missed and fell back to the device default. pocket-claude now tells the CLI which ID to use (`--session-id`), so both sides agree from the start and all three translation layers are gone. If the ID the CLI reports back ever disagrees with the one requested, a warning is logged instead of silently splitting again.
- **History replay now shows tool calls, tool results and thinking** - Replaying a finished conversation from history previously rendered only text blocks, so tool activity and extended thinking were missing. The converter that turns the CLI's own transcript into screen events now normalizes them into the same event vocabulary live streaming uses, with the same collapsible tool results - no separate rendering path for history.
- **Live logs are no longer kept forever** - pocket-claude used to keep its own copy of every conversation indefinitely, including conversations the CLI itself had already deleted (its default retention is 30 days), which meant a large amount of disk was held by transcripts that could no longer be shown anywhere. The CLI's transcript is the source of truth for finished conversations, so redundant and unreachable copies are now removed. There is deliberately no retention setting to configure.

### Migration
- **The first start of v2.12.0 converts existing data, after taking a backup** - Records under `sessions/` whose filename disagrees with the conversation's Claude session ID are merged into a single record under the canonical ID, keys in `schedules.json` and `scheduled-posts.json` are repointed, and the old ID is left behind as a one-line forwarding stub so tabs already open on other devices still resolve. Where both records held a value for the same field, the value from the original (pocket-side) record wins and every such collision is printed to the startup log. **Before touching anything, a `migration-backup-<timestamp>.tar.gz` is written to the install directory** containing `sessions/`, `logs/`, `schedules.json` and `scheduled-posts.json`; it is the only way back. Delete it once you are satisfied, and restore by extracting it over the install directory. The conversion is idempotent (recorded in `sessions/.schema.json`) and runs only once - later versions do not take this backup. Set `PC_SKIP_STARTUP_MIGRATION=1` to start without it if anything goes wrong.

## [v2.11.0] - 2026-09-07

### Added
- **API retries are now visible instead of silent** - When Anthropic returns 529 Overloaded, the CLI retries up to 10 times with exponential backoff (~0.5s to ~38s, about 3 minutes in total). The `system/api_retry` events it emits carry no `text` field, so the frontend dropped them and the screen stayed completely blank for those three minutes - indistinguishable from a dead tab, which led to pressing stop and resending, hitting the congestion again. A single orange line now reports `⏳ API is congested - retrying (n/10), next attempt in ~Xs`, rewritten in place for each attempt. Once the API responds again the line collapses to `⚠ Retried n times due to API congestion` if there were 3 or more attempts, and disappears silently for shorter blips. The indicator is live-only; history replay never shows it.
- **Opening a running conversation from history now joins the live session instead of creating a disconnected tab** - History lists conversations by their Claude session ID, but the live process, streaming output and "running" flag are all tracked by a separate pocket session ID. Tapping a running conversation from history used to open a "shadow" tab with no connection to the real one: output never grew, the status dot stayed green, and a reload was the only way to see progress. Doing so also risked spawning a second `claude --resume` process for the same conversation if you sent a message from the shadow tab. Now, opening a running conversation resolves it to the live pocket session and joins the same incremental sync used by regular tabs: the transcript keeps growing without a reload, and the status correctly shows running, returning to connected when the turn finishes. Known limitation: a joined tab only shows what happened since that pocket session itself started - if that session was itself resumed from history earlier, whatever came before that point still isn't shown (by design; live streaming and log replay use different event granularities that can't be safely stitched together).

### Security
- **Dependency: forced `qs` to 6.16.0** - `npm audit` reported three moderate advisories in `qs` (array-limit bypass via bracket-key comma parsing, and a denial of service via attacker-controlled `isBuffer`), reached transitively through `express` -> `body-parser`. Plain `npm audit fix` could not resolve them because `body-parser` pins `qs` with a tilde range that excludes the fixed release, and clearing them otherwise would have meant jumping to Express 5. An `overrides` entry in `package.json` pulls in the patched `qs` while leaving `express` and `body-parser` untouched. Vulnerability count is back to zero.

## [v2.10.0] - 2026-08-31

### Added
- **Tool selection is now a settings-panel allowlist, learned automatically from the CLI** - Replaces the previous hard-coded 23-tool denylist (`proxyDisallowedTools`), which had already drifted out of sync with the CLI's actual tool set. There are now two independent allowlists, `toolsDirect` and `toolsProxy`, editable from the browser's Settings → "Advanced: Tool Configuration" panel (the proxy group only shows up if `proxyModels` is configured); leaving either unset restricts nothing (checking every box saves as unset, so a fully-checked list keeps picking up tools Anthropic adds later). The tool list itself is captured from the `system/init` event the CLI sends at session start and cached to `tools-catalog.json`, so it stays current as Anthropic adds tools instead of silently missing new ones. Changes apply starting with the next session (running conversations are unaffected). `AskUserQuestion` remains always-disabled regardless of this setting. This mainly helps endpoints where prompt caching doesn't apply (e.g. a small local model behind a translation proxy): one measurement went from 24 tool definitions / 64,310 bytes to 5 tools / 6,789 bytes, shrinking the full request from 83,225 to 16,960 bytes, cutting a local Ollama model's first response from ~40s to ~13s, and growing usable context from ~50K to ~70K tokens. Models talking to Anthropic directly get little benefit from trimming since their tool definitions already ride the prompt cache.
- **A resumed conversation keeps its own model, effort and thinking settings** - Reopening a conversation from history used to fall back to the device defaults. The last settings actually used in that session are now read back from the server (`GET /api/session-settings/:sessionId`) and applied to the restored tab.

### Changed
- **Request body size limit no longer has its own Save button** - Editing `maxBodySizeMb` in the Settings panel is now folded into the same unsaved-changes flow as the new tool configuration: the header's ✕ turns into a blue "Save ✕" and a red "Cancel" appears next to it, and both the body-size limit and the tool allowlists are sent together in a single request when you save.

### Fixed
- **Switching away from a proxied model kept using the old proxy** - Switching, say, a local model to a Claude model succeeded via `set_model`, but a process's environment (`ANTHROPIC_BASE_URL` and friends) is fixed at spawn time: the CLI reported the new model while every request still went to the old proxy. When the two models belong to different proxy routes, pocket-claude now skips `set_model` and restarts the process with `--resume` so it comes back with the correct environment.
- **The per-tab model dropdown no longer overwrites the device default model** - Changing the model for one tab silently rewrote the saved default for every new tab. The default is now changed only from the radio buttons in the settings modal.
- **Context usage was stuck at 0% on models without cache reporting** - The `message_delta` usage is the full accounting for one API call, so it is now applied as a replacement rather than accumulated on top of previous deltas (falling back to the old accumulate behaviour only on paths that report no input tokens at all). Local Ollama models now show a real context percentage.

## [v2.9.0] - 2026-08-21

### Added
- **Crash-safe exit handling** - `unhandledRejection` and `uncaughtException` are now caught: the reason and stack trace are always logged before the process shuts down through the existing graceful-shutdown path (running sessions get a proper `done` notice instead of the process just vanishing). Recovery still relies on the process manager's restart policy.
- **A minimal test suite** - `npm test` (`node --test`, no new dependency) now covers the three areas that caused real regressions in past releases: the scheduler's fire-time collision avoidance, the session settings fallback chain (record -> saved session -> default) that a delivery path silently broke last cycle, and the history replay event reducer (verified to leave rendered output unchanged).
- **marked and DOMPurify are vendored** - Both libraries are fetched at a pinned version into `public/vendor/` and loaded from there instead of a floating-major CDN URL with no integrity check. The app now renders and sanitizes messages without any external network dependency.

### Changed
- **All JSON persistence is now atomic** - Every place that writes a JSON file (sessions, scheduler, scheduled posts, server config, projects) now writes to a temp file and renames it into place, instead of writing in place. A write that's interrupted (crash, OOM kill) can no longer leave a half-written, corrupt file. Failures are logged instead of being silently swallowed, and a scheduled post whose save fails now says so on screen - previously a disk write failure could make a scheduled post vanish on the next restart without any warning.
- **sessionId is validated on every write path** - The UUID format check that already guarded history reads is now applied to `POST /api/send`, `GET /api/stream`, `POST /api/register-session`, `POST /api/stop` and `POST /api/reset` as well; a malformed value is rejected with 400 instead of being used to build a file path.
- **The `model` parameter is checked against the configured list** - If `models` is set in `config.json`, a value outside that list is rejected with 400 instead of being passed straight to `--model`. Installations that don't configure `models` are unaffected.
- **`POST /api/client-log` now has its own body-size cap** (64 KB) - independent of `maxBodySizeMb`, which defaults to unlimited - so a runaway client can no longer write unbounded data into the server's logs.

### Removed
- **The `/api/tabs` endpoint and the tab-settings subsystem behind it** - Tab configuration moved to per-session files (`sessions/<id>.json`) back in v2.7.0-era changes; nothing in the UI called `/api/tabs` anymore, and `tabs.json` was dead weight. The route, `services/tabs.js`, and the unused `getSessionId`/`saveSessionId` helpers are gone. If you have a leftover `tabs.json` on disk, it's simply ignored now - delete it whenever convenient.

## [v2.8.0] - 2026-08-21

### Added
- **`ops/` - operational scripts that ship with the repo** - The two cron scripts that keep a pocket-claude host healthy are now version-controlled instead of living only on the machine: `update-claude-cli.sh` (daily Claude Code CLI update that verifies the *actual* binary reached the latest version, then restarts the service) and `claude-keepalive/keepalive.sh`. They are not deployed automatically - see `ops/README.md` for where each one goes.
- **Scheduled posts have a lifecycle** - Each scheduled post now carries a state (pending / running / failed). A post that fails to be delivered is no longer deleted: it stays in the list with the reason, and offers retry / edit / delete. Deleting one returns its text to the input box as a draft. A post whose time passed while the server was down is marked failed instead of firing late, and the success message is now shown *after* delivery succeeds (it used to be shown unconditionally, before delivery).

### Changed
- **Resuming a long conversation is much faster** - Time to resume was dominated by bytes on the wire, not by event count: a 4.40 MB conversation rendered only 135 KB of visible text, the rest being live-streaming envelopes, duplicates and events that never reach the screen. History replay now sends a slimmed event stream (duplicate `assistant` turns, text-less `system` events, thinking/signature deltas and unused tool results removed; consecutive deltas coalesced), producing identical rendered output: 4.40 MB / 5291 events -> 2.08 MB / 1157 events, 1152 KB -> 640 KB gzipped.
- **History responses are gzip-compressed** - The events payload is compressed with zlib (4.62 MB -> 1.18 MB measured, no new dependency) and decoded incrementally on the client.
- **Links in messages open in a new tab** - Tapping a link used to navigate the app away, losing the view of a running session. Links are now given `target="_blank"` with `rel="noopener noreferrer"`, including links in conversations restored from the local cache.

### Removed
- **The "unsent" prompt list is gone** - The queue was a leftover from before prompt delivery was unified: with injection into the resident process working, nothing accumulated there, and it could only mislead. Delivery failures are now always reported on screen as a system message instead.

### Fixed
- **Resuming from history could hang silently** - An exception inside the replay loop's `requestAnimationFrame` callback was swallowed, leaving the promise forever unresolved: the progress percentage simply froze with no error and no recovery. Replay now skips a bad event individually and surfaces fatal errors. Related: a `set_model` switch leaves a `<local-command-stdout>` entry whose `content` is a string, which threw a `TypeError` and stopped replay at that point every time; it is now rendered as a system line.
- **Resume progress stuck at 50%** - Progress used `Content-Length` (post-gzip) as the denominator while counting decompressed bytes, so it pinned at 50% about a quarter of the way through. It now uses the uncompressed length reported by the server.
- **Scheduled posts silently failed to deliver** - A regression from the v2.7.0 delivery unification: the new `if (!project)` guard did not carry over the old fallback to the default project, so every scheduled post to a tab whose `claude` process was not alive failed. The root cause was deeper - a tab's project/model/effort/thinking lived only in the browser's `localStorage`, so any path that fires without a browser (scheduled posts, rate-limit auto-resume) had to guess. Those settings are now persisted server-side per session and resolved as record -> saved session -> default. Auto-resume therefore also keeps the tab's model instead of silently dropping to the default.
- **A failed send could lose what you had typed** - The in-flight prompt is now persisted as `pendingSend` and cleared only once delivery is confirmed (success response, or a matching `user_input` replay). Previously the optimistic clear could only restore text if the response came back, so closing the page - or never receiving a response - lost it. Attached images and previews are restored too, and the optimistically-rendered image row is withdrawn.
- **A prompt could appear on screen without reaching Claude** - `POST /api/send` now returns 502 with a reason when delivery fails, and the `user_input` broadcast only happens after the write to the child process actually succeeded. Injection failures are logged on the server.
- **Context percentage collapsed to 0% after a resume** - A resume makes the CLI emit an empty turn (`num_turns: 0`, empty `modelUsage`) that was rendered unconditionally, flattening a correct context reading. Turns with no token information are now ignored for both display and internal state.
- **Restarts drew two "interrupted" lines** - The graceful-shutdown notice and the actual process exit both rendered. They now collapse into a single `Interrupted (server restarted)` line.
- **A tab resumed from history went blank on a hard reload** - Such a tab owns no log of its own, so a cache-less reload showed nothing; it is now backfilled once.

## [v2.7.0] - 2026-07-26

### Added
- **Stop now interrupts the turn instead of killing the session** - The stop button sends the CLI's `control_request`/`interrupt` control message over stdin, so only the running turn is cancelled and the resident `claude` process stays alive. The next prompt continues in the same session without a `--resume` restart (no context reload, no repeated project setup). If the CLI doesn't acknowledge the control message, it falls back to the previous `SIGTERM` behavior.
- **Model switching uses `set_model`** - Changing the model on an idle session now sends the `set_model` control message instead of killing and re-spawning the process with `--resume`. Falls back to the old restart path if unacknowledged.

### Changed
- **Stop responds the moment you tap it** - Tapping stop immediately switches the indicator to a `stopping` state (blinking stops, dimmed) instead of waiting for the stream's `done` event, which is easily missed on a flaky mobile connection. Failures are now surfaced explicitly (expired auth proxy session, offline, or "already stopped") and the UI is reconciled against the server instead of being left in a stale "running" state. Stopping also clears any unsent prompts and notifies the client, so the count no longer lingers on screen.
- **Single prompt delivery path** - Manual sends, rate-limit auto-resume, and scheduled posts now all go through one delivery function that checks the process is alive, injects or starts with `--resume`, and always reports failures to the UI. Previously auto-resume and scheduled posts ignored the injection result, so a failed delivery could be lost silently. The pending list is now labelled "unsent" rather than "queued", which is what it actually holds.

### Fixed
- **Fresh clones couldn't start a session** - The default `permissionMode` was `ask`, which current Claude Code CLI versions reject, so every session failed to start for anyone without their own `config.json` (only raw stderr was shown). The default is now `acceptEdits`, and an unknown value is logged with a reason and falls back to the default.
- **Draft prompts both lingering and disappearing** - The prompt draft had two sources of truth (memory, updated on every keystroke; localStorage, written only when switching tabs), which caused opposite-looking symptoms with the same cause: an already-sent prompt could reappear in the input box after a reload, while a half-typed prompt was lost when the page navigated away (for example an expired auth-proxy session). All writes now go through a single `setDraft()` path that updates both together (debounced while typing; immediate on send, on send failure, and on tab switch). Note: attached images are still not restored when a send fails - text only.
- **Send failure could paste text into the wrong tab** - Restoring a failed send wrote directly to the shared input box, so switching tabs while the request was in flight pushed the previous tab's text into the new tab. Restore now targets the session and only touches the input box when that session is in the foreground.
- **"Authentication expired" is now named explicitly** - When an authenticating reverse proxy (e.g. Authelia) has expired the session, `POST /api/send` gets a cross-origin 302 that a `follow` fetch turns into an opaque CORS `TypeError`, so the UI could only say "Connection failed". Sends now use `redirect: 'manual'` and show "your session expired - reload the page and sign in again".
- **Stop status could be reported for turns that weren't stopped** - Detecting "user stopped it" from the result subtype alone made genuine runtime errors show up as "stopped", hiding failures. The server now emits an `interrupted` marker that the following `result` consumes in order, and no marker is emitted when the session is idle (an idle interrupt is a safe no-op, but the leftover marker previously mislabelled the *next* successful turn as stopped).

## [v2.6.0] - 2026-07-22

### Documentation
- **Model selection guide** - README now documents how the model dropdown uses CLI tier aliases (`fable`/`opus`/`sonnet`/`haiku`) that auto-resolve to each tier's latest model, why keeping the Claude Code CLI up to date matters (a stale CLI routes aliases to older models), and how to pin a specific or older model by setting an exact model ID as the option's `value`.
- **Settings & usage notes** - Documented the Settings panel (effort, theme, font size, language, request body-size limit) and usage notes (plain-text questions instead of tap-to-choose, image attachment, scheduled posts, rate-limit auto-resume).

### Note
- Includes the model-alias dropdown redesign commit that landed after the v2.5.0 tag.

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
