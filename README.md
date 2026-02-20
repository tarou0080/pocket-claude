# pocket-claude

A lightweight, mobile-first Web UI for Claude Code, optimized for iOS Safari.

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

### Prerequisites

- Node.js v18+
- [Claude Code CLI](https://code.claude.com/) installed and authenticated

### Installation

```bash
git clone https://github.com/yourusername/pocket-claude.git
cd pocket-claude
npm install
```

### Configuration

1. Copy example configs:
```bash
cp config.example.json config.json
cp projects.example.json projects.json
```

2. Edit `projects.json` to add your working directories:
```json
{
  "home": "/home/user",
  "work": "/home/user/workspace"
}
```

3. (Optional) Edit `config.json`:
```json
{
  "port": 3333,
  "permissionMode": "ask",
  "sessionDir": "./sessions",
  "logsDir": "./logs"
}
```

### Run

```bash
npm start
```

Access at `http://localhost:3333`

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
    ↓ HTTPS
[nginx (optional)]
    ↓
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

## 🐳 Docker (Optional)

```bash
docker build -t pocket-claude .
docker run -p 3333:3333 \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/projects.json:/app/projects.json:ro \
  -v $(pwd)/sessions:/app/sessions \
  -v $(pwd)/logs:/app/logs \
  -v ~/.claude:/root/.claude:ro \
  pocket-claude
```

## 🔒 Security Considerations

pocket-claude is designed for **trusted environments**. Recommended deployment:

1. **Local network only** - Bind to localhost or private IPs
2. **VPN access** - Use WireGuard/OpenVPN for remote access
3. **Authentication proxy** - Add nginx + Authelia/OAuth2 Proxy
4. **Permission mode** - Keep `permissionMode: "ask"` unless fully trusted

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

- Issues: [GitHub Issues](https://github.com/yourusername/pocket-claude/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/pocket-claude/discussions)
