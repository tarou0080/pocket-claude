# pocket-claude

**Use Claude Code from your browser, anywhere.**

pocket-claude is a web interface for Claude Code CLI. If you're using Claude Code, you can install this to get a browser-based UI instead of working in the terminal.

## 💡 What does it do?

Turn your Claude Code CLI into a web app:
- **Browse to a URL** and chat with Claude Code through a clean web interface
- **Use your phone or tablet** - especially optimized for iOS Safari
- **Access from anywhere** - via VPN, SSH tunnel, or local network
- **Keep conversations organized** - tab-based session management
- **Works with CLAUDE.md** - Respects your project's CLAUDE.md configuration

**This works for ANY Claude Code user:**
- On your local laptop - use browser instead of terminal
- On a home server - access Claude Code from your phone while traveling
- On a cloud VM - prefer web UI over SSH + terminal sessions
- Anywhere Claude Code CLI runs - this adds a browser interface

**No server required** - Just `npm install` and run it wherever your Claude Code is installed.

## ✨ Features

- 📱 **Mobile-First Design** - Tested and optimized for iPhone Safari
- 🪶 **Ultra-Lightweight** - Vanilla HTML/CSS/JS, no build step required
- 🗂️ **Tab-Based Conversations** - Manage multiple conversations simultaneously
- 📊 **Context Usage Tracking** - Real-time token usage visualization
- 📜 **Integrated History Browser** - Browse and resume past sessions
- 🔄 **SSE Streaming** - Real-time output with automatic reconnection
- 🎨 **Markdown Rendering** - Clean, readable output formatting

## 🎯 Why pocket-claude?

Existing solutions are feature-rich but heavyweight. pocket-claude takes a different approach:

- **No React/Vite/TypeScript** - Just Express + vanilla JS
- **Self-hosted focused** - Designed for home server environments
- **iOS-optimized** - visualViewport API for perfect keyboard handling
- **Minimal dependencies** - Only marked.js for markdown rendering

## 🚀 Quick Start

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
  "permissionMode": "ask",
  "sessionDir": "./sessions",
  "logsDir": "./logs"
}
```

Copy from examples:
```bash
cp config.example.json config.json
cp projects.example.json projects.json
```

### Prerequisites

- Node.js v18+
- [Claude Code CLI](https://code.claude.com/) installed and authenticated

## ⚙️ Configuration Options

### Permission Modes

- `"ask"` (default) - Prompt for tool execution approval
- `"bypassPermissions"` - Auto-approve all tool executions

⚠️ **Security Warning**: `bypassPermissions` mode allows Claude Code to execute tools without confirmation. Only use in trusted environments with proper authentication (e.g., VPN + 2FA).

### Projects

Define working directories in `projects.json`. Each project appears as a selectable option when creating new conversations.

## 🏗️ Architecture

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
- **Backend**: Express server spawning `claude -p` processes
- **Communication**: Server-Sent Events (SSE) for streaming
- **Session Management**: JSON files for persistence

## 🔒 Security Considerations

pocket-claude is designed for **local/trusted network use**:

- **Local network only** - Runs on localhost or LAN by default
- **Permission mode** - Use `permissionMode: "ask"` for safer operation
- **Trusted environment** - Not designed for public internet exposure

For remote access, consider using a VPN or SSH tunnel instead of exposing the server directly.

### Environment Variables

Set `ADDITIONAL_ALLOWED_DIRS` to allow access to additional directories (colon-separated):

```bash
export ADDITIONAL_ALLOWED_DIRS="/srv/shell:/opt/projects"
npm start
```

## 🚫 Out of Scope

pocket-claude is intentionally minimal. The following features are **not planned**:

- **File editor** - Use VSCode or your preferred editor
- **Terminal emulator** - Use SSH or native terminal
- **Multi-user support** - Designed for single-user, trusted environment
- **Database integration** - Session data is stored in simple JSON files
- **Authentication system** - Rely on network-level security (VPN, firewall)

If you need these features, consider:
- [claudecodeui](https://github.com/siteboon/claudecodeui) - Full-featured web IDE
- [claude-relay](https://github.com/chadbyte/claude-relay) - More advanced features

## 🔧 Troubleshooting

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

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [marked.js](https://github.com/markedjs/marked) - Markdown parser (MIT)
- [Express](https://expressjs.com/) - Web framework (MIT)

Inspired by:
- [claude-code-webui](https://github.com/sugyan/claude-code-webui) by sugyan
- [claudecodeui](https://github.com/siteboon/claudecodeui) by siteboon
- [claude-relay](https://github.com/chadbyte/claude-relay) by chadbyte

## 🤝 Contributing

Contributions welcome! Please feel free to submit a Pull Request.

## 📧 Support

- Issues: [GitHub Issues](https://github.com/tarou0080/pocket-claude/issues)
- Discussions: [GitHub Discussions](https://github.com/tarou0080/pocket-claude/discussions)
