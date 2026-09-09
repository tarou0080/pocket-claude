# pocket-claude

**Use Claude Code from your browser, anywhere.**

[English](README.md) | [日本語](README.ja.md)

pocket-claude is a web interface for Claude Code CLI. If you're using Claude Code, you can install this to get a browser-based UI instead of working in the terminal.

## What does it do?

Turn your Claude Code CLI into a web app:
- **Browse to a URL** and chat with Claude Code through a clean web interface
- **Use your phone or tablet** - works in any modern browser, including mobile
- **Access from anywhere** - via VPN, SSH tunnel, or local network
- **Keep conversations organized** - tab-based session management
- **Works with CLAUDE.md** - Respects your project's CLAUDE.md configuration

**This works for ANY Claude Code user:**
- Local laptop, home server, cloud VM - anywhere Claude Code runs
- Use browser instead of terminal
- Access from your phone
- Switch between multiple projects easily

**No server required** - Just `npm install` and run it wherever your Claude Code is installed.

## Features

- **Browser-Based UI** - Works on desktop and mobile browsers
- **Ultra-Lightweight** - Vanilla HTML/CSS/JS, no build step required
- **Tab-Based Conversations** - Manage multiple conversations simultaneously
- **Context Usage Tracking** - Real-time token usage visualization
- **Integrated History Browser** - Browse and resume past sessions
- **SSE Streaming** - Real-time output with automatic reconnection
- **Markdown Rendering** - Clean, readable output formatting
- **Image Attachment** - Attach images to prompts (paste, drag-and-drop, or file picker)
- **Scheduled Posts** - Schedule prompts to run at a future time (server-side, no browser required)
- **Rate Limit Auto-Resume** - Automatically re-sends when Claude's rate limit resets
- **Language Switching** - UI available in Japanese and English
- **Request Body Size Limit** - Configurable from Settings panel (MB; 0 = unlimited)
- **Port-in-use guard** - Exits with a clear message if the port is already taken (avoids broken double-start)

## Screenshots

### Main Interface
![Main Interface](./screenshots/main.png)

### Settings
![Settings](./screenshots/projects.png)

## Why pocket-claude?

Existing solutions are feature-rich but heavyweight. pocket-claude takes a different approach:

- **No React/Vite/TypeScript** - Just Express + vanilla JS
- **Self-hosted focused** - Designed for home server environments
- **No build step** - Just `npm install` and run
- **Minimal dependencies** - Only marked.js for markdown rendering

## Quick Start

**Simplest installation (works with Claude Code):**

```bash
git clone https://github.com/tarou0080/pocket-claude.git
cd pocket-claude
npm install
npm start
```

Access at `http://localhost:3333`

That's it! It works out-of-the-box with sensible defaults.

### Optional Configuration

**Add custom project directories** (`projects.json`):
```json
{
  "home": "/home/user",
  "work": "/home/user/workspace",
  "myproject": "/path/to/project"
}
```

**Change settings** (`config.json`):
```json
{
  "port": 3333,
  "host": "0.0.0.0",
  "permissionMode": "acceptEdits",
  "sessionDir": "./sessions",
  "logsDir": "./logs",
  "maxBodySizeMb": 0
}
```

Copy from examples:
```bash
cp config.example.json config.json
cp projects.example.json projects.json
```

**Route specific models through a proxy** (`proxyModels`, optional):

```json
{
  "models": [
    { "value": "my-proxy-model", "label": "My Proxy Model" }
  ],
  "proxyModels": {
    "my-proxy-model": {
      "ANTHROPIC_BASE_URL": "http://localhost:3456",
      "ANTHROPIC_API_KEY": "your-proxy-key"
    }
  }
}
```

Models mapped in `proxyModels` get these environment variables injected into their `claude` process only, so you can route them through any Anthropic-compatible endpoint (translation proxies such as claude-code-router or LiteLLM, corporate gateways, etc.). Sessions using other models never touch the proxy — if it goes down, only the mapped models are affected. This is the mechanism behind the "GLM-5.2 (Cloudflare)" option mentioned in the changelog; it is not a built-in model.

You can also limit which tools a session is allowed to use, from the **Settings panel in the browser** (collapsible "Advanced: Tool Configuration" section). There are two independent lists — one for sessions talking to Claude directly, one for sessions routed through `proxyModels` — and each is an allowlist: leave it unset and nothing is restricted (all tools available). The tool list itself is not hard-coded; pocket-claude learns it automatically from the `system/init` event the CLI sends at session start and saves it to `tools-catalog.json`, so it stays current as Anthropic adds tools. Changes apply the next time a session starts (running conversations are unaffected). `AskUserQuestion` is always disabled regardless of this setting, since headless mode cannot resolve it interactively.

This is mostly useful for endpoints where prompt caching does not apply — e.g. a small local model behind a translation proxy, where the full tool definitions are re-sent and re-processed on every turn. One measurement: 24 tool definitions at 64,310 bytes trimmed to 5 tools (`Bash`, `Edit`, `Read`, `Write`, `WebFetch`) at 6,789 bytes, shrinking the whole request from 83,225 to 16,960 bytes; against a local Ollama model this cut the first response from ~40 seconds to ~13, and grew usable context from ~50K to ~70K tokens. If your `proxyModels` entry actually reaches a real Claude behind a corporate gateway, prompt caching still applies there, so there is no benefit to trimming — leave the proxy list unset. The "Claude direct" list works the same way functionally, but for sessions talking to Anthropic directly the tool definitions ride Anthropic's prompt cache, so trimming there saves little.

> **Note on Fable 5 billing (as of 2026-07-20):** Anthropic bills Fable 5 differently by plan. **Max / Team Premium** subscribers get it **included** in the subscription (up to 50% of usage limits). **Pro / Team Standard** subscribers get a one-time $100 usage credit, after which Fable 5 falls back to **metered API billing** ($10 / $50 per million input/output tokens). Because pocket-claude can't know your plan, the default model list labels it `Fable 5 (Pro: metered)` — Pro users should expect usage charges, Max users can ignore the note. Edit the label in `config.json` (or `ALL_MODELS` in `public/index.html`) to suit your plan.

### Prerequisites

- Node.js v18+
- [Claude Code CLI](https://code.claude.com/) installed and authenticated

## Project Management

pocket-claude allows you to manage project directories from the browser or configuration files.

### Add from Browser (Recommended)

1. Click the **⚙** (Settings) button in the header
2. Scroll to the **Projects** section
3. Enter project name and directory path, then click **Add**

Settings are persisted across server restarts.

### Manage via Configuration File

Edit `projects.json` to define projects:

```json
{
  "home": "/home/user",
  "myapp": "/srv/shell/myapp",
  "website": "/var/www/html"
}
```

### Add via Environment Variable

You can also add projects at startup using environment variables:

```bash
export ADDITIONAL_ALLOWED_DIRS="/srv/shell:/opt/projects"
npm start
```

These are automatically added as `env_0`, `env_1`, etc.

## Configuration Options

### Permission Modes

- `"ask"` (default) - Prompt for tool execution approval
- `"bypassPermissions"` - Auto-approve all tool executions

⚠️ **Security Warning**: `bypassPermissions` mode allows Claude Code to execute tools without confirmation. Only use in trusted environments with proper authentication (e.g., VPN + 2FA).

## Model selection

The model dropdown ships with **tier aliases**, not pinned model IDs:

| Dropdown option | Passed to `claude` | Resolves to |
|---|---|---|
| Default | (no `--model`) | Your CLI's own default |
| Fable / Opus / Sonnet / Haiku | `--model sonnet`, etc. | The **latest** model in that tier |

Aliases are resolved by the Claude Code CLI itself at spawn time, so when Anthropic ships a newer model in a tier you get it automatically — no config edit required. The dropdown also relabels each option with the concrete model it actually resolved to (learned from the CLI's `system/init` event), e.g. `Sonnet` becomes `Sonnet 5` and `Default` becomes `Default (Sonnet 5)`, so you can always see what will actually run.

> ⚠️ **Keep your Claude Code CLI up to date.** Aliases only track the latest model *as far as your installed CLI knows*. A stale CLI resolves an alias like `sonnet` to an **older** model (we hit a case where a CLI ~47 versions behind resolved `sonnet` to a legacy 4.6 model instead of Sonnet 5). Update with:
>
> ```bash
> npm install -g @anthropic-ai/claude-code@latest
> ```
>
> The resolved name shown in the dropdown is your tell: if `Default (…)` or `Sonnet` shows an older model than you expect, your CLI is out of date.

To keep it current automatically, add a cron job (adjust for your platform):

```bash
# Update the Claude Code CLI every Monday at 03:00
0 3 * * 1 npm install -g @anthropic-ai/claude-code@latest >> ~/claude-cli-update.log 2>&1
```

### Pinning a specific (or older) model

If you want a specific model rather than "latest in tier" — to stay on an older model, or to add one that isn't in the default list — set the dropdown option's `value` to an exact model ID. The value is passed verbatim as `claude --model <value>`.

Add it in `config.json` (applied on restart; this file is not committed):

```json
{
  "models": [
    { "value": "",                "label": "Default" },
    { "value": "sonnet",          "label": "Sonnet (latest)" },
    { "value": "claude-opus-4-1", "label": "Opus 4.1 (pinned)" }
  ]
}
```

- Use exact IDs from the [models overview](https://platform.claude.com/docs/en/about-claude/models/overview) — a wrong ID makes `claude` return a 404.
- Pinned IDs do **not** auto-update; that's the point. You can mix aliases (auto-latest) and pins (fixed) in the same list.
- `config.json` is gitignored (per-instance). To change what fresh clones see by default, edit `ALL_MODELS` in `public/index.html` instead.

## Settings

Open the **⚙** panel in the header to adjust:

- **Effort** — Global default reasoning effort (`Auto` / `Low` / `Medium` / `High`) applied to all sessions. The header's effort dots (**●●●**) instead cycle *only the current tab's* effort without changing the default.
- **Theme** — Switch between the bundled UI themes (Blue Dark / Purple Dark). Add your own by editing `public/themes.js`.
- **Font size** — Adjust conversation text size.
- **Language** — Japanese / English.
- **Request body size limit** — Max upload size in MB (`0` = unlimited), useful when attaching large images.

All settings are stored in the browser and persist across restarts.

## Usage notes

- **Questions come as plain text, not tap-to-choose.** In headless mode the CLI cannot use interactive choice tools (`AskUserQuestion`), so Claude asks its questions as normal text and you answer in the normal input box. No multiple-choice buttons appear — this is intentional (see the changelog for the technical reason).
- **Image attachment** — Attach images by clicking the clip icon (📎), pasting, or dragging into the input area. Text-only or image-only messages both work.
- **Scheduled posts** — Schedule a prompt to run at a future time. It runs server-side, so no browser needs to stay open. Each entry keeps its state (pending / running / failed): a delivery that fails is not deleted, it stays in the list with the reason, and you can retry, edit or delete it. Deleting one puts its text back into the input box as a draft. A post whose time passed while the server was down is marked failed rather than fired late.
- **Rate-limit auto-resume** — When Claude's rate limit resets, a queued prompt is automatically re-sent. A resume card above the input shows the scheduled kick time and counts down; enable "resume by default" in Settings to have it arm itself on every limit.
- **Upgrading to v2.12.0 converts your existing data once, after taking a backup.** The first start unifies each conversation's two IDs into one (see the changelog). Before changing anything it writes `migration-backup-<timestamp>.tar.gz` into the install directory, holding `sessions/`, `logs/`, `schedules.json` and `scheduled-posts.json` - this is the only way back, so keep it until you are satisfied, then delete it. Restore by extracting it over the install directory. The same start also deletes live logs that are redundant with, or unreachable from, the CLI's own transcripts, which can free a substantial amount of disk. The conversion runs only once and later versions do not take this backup. If the server fails to start, set `PC_SKIP_STARTUP_MIGRATION=1` to boot without converting.
- **Stop cancels the turn, not the session** — Tapping the status dot while running interrupts the current turn via the CLI's control protocol. The session's `claude` process stays alive, so your next prompt continues in the same session without a restart. On CLI versions that don't support the control message, pocket-claude falls back to terminating the process (the next prompt then resumes the session).

## Architecture

```
[Mobile Browser]
    ↓ HTTP
[pocket-claude (Node.js/Express)]
    ↓ spawn
[claude CLI (headless mode)]
    ↓
[Your Project Directory]
```

- **Frontend**: Single HTML file with vanilla JavaScript
- **Backend**: Express server managing a persistent `claude` process per session (stream-json mode)
- **Communication**: Server-Sent Events (SSE) for streaming
- **Session Management**: JSON files for persistence

## Security Considerations

pocket-claude is designed for **local/trusted network use**:

- **Local network only** - Runs on localhost or LAN by default
- **Configurable bind address** - Set `host` in `config.json` (or the `HOST` env var) to listen on a specific interface only, e.g. so the server is reachable solely through your reverse proxy (default: `0.0.0.0`)
- **Permission mode** - Use `permissionMode: "acceptEdits"` for safer operation. Valid values are those accepted by `claude --permission-mode`: `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. An unknown value makes the CLI refuse to start.
- **Trusted environment** - Not designed for public internet exposure

For remote access, consider using a VPN or SSH tunnel instead of exposing the server directly.

> **Trust model**: pocket-claude does **not** restrict which directories can be registered as projects. Anyone who can reach the API (or edit `projects.json`) can run `claude` in any directory the server user can access — and with `bypassPermissions`, that means arbitrary command execution. This is by design: pocket-claude is a thin wrapper that delegates access control to your network/auth layer (VPN, reverse-proxy auth, firewall). Do not expose it to untrusted clients.

### Environment Variables

Set `ADDITIONAL_ALLOWED_DIRS` to allow access to additional directories (colon-separated):

```bash
export ADDITIONAL_ALLOWED_DIRS="/srv/shell:/opt/projects"
npm start
```

Set `PC_SKIP_STARTUP_MIGRATION=1` to skip the one-time v2.12.0 data conversion at startup (see Usage notes). Intended as an escape hatch if the conversion prevents the server from starting.

## Out of Scope

pocket-claude is intentionally minimal. The following features are **not planned**:

- **File editor** - Use VSCode or your preferred editor
- **Terminal emulator** - Use SSH or native terminal
- **Multi-user support** - Designed for single-user, trusted environment
- **Database integration** - Session data is stored in simple JSON files
- **Authentication system** - Rely on network-level security (VPN, firewall)

If you need these features, consider:
- [claudecodeui](https://github.com/siteboon/claudecodeui) - Full-featured web IDE
- [claude-relay](https://github.com/chadbyte/claude-relay) - More advanced features

## Troubleshooting

### Claude CLI not found
Ensure Claude Code CLI is installed and in your PATH:
```bash
which claude
```

### Permission denied errors
Check that your project directories are readable by the user running pocket-claude.

### SSE connection issues
If using nginx, ensure buffering is disabled:
```nginx
proxy_buffering off;
proxy_cache off;
```

### Port already in use
Change the port in `config.json` or set `PORT` environment variable:
```bash
PORT=3334 npm start
```

### Project directory not accessible
If adding a project fails:

1. Check if the directory exists:
   ```bash
   ls -ld /path/to/project
   ```

2. Check if you have read permissions:
   ```bash
   # Run as the user running pocket-claude
   cd /path/to/project
   ```

3. Check server logs for details:
   ```
   [WARNING] Invalid project path: myproject -> /srv/shell (No such file or directory)
   ```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- [marked.js](https://github.com/markedjs/marked) - Markdown parser (MIT)
- [Express](https://expressjs.com/) - Web framework (MIT)

Inspired by:
- [claude-code-webui](https://github.com/sugyan/claude-code-webui) by sugyan
- [claudecodeui](https://github.com/siteboon/claudecodeui) by siteboon
- [claude-relay](https://github.com/chadbyte/claude-relay) by chadbyte

## Contributing

Contributions welcome! Please feel free to submit a Pull Request.

## Support

- Issues: [GitHub Issues](https://github.com/tarou0080/pocket-claude/issues)
- Discussions: [GitHub Discussions](https://github.com/tarou0080/pocket-claude/discussions)
