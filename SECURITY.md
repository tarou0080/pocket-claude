# Security Policy

## Supported versions

Only the latest release receives fixes. pocket-claude is in maintenance mode (see the README): security fixes and Claude Code CLI compatibility fixes continue, new features do not.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting instead:
**Security** tab → **Report a vulnerability** (https://github.com/tarou0080/pocket-claude/security/advisories/new).

Include the version, steps to reproduce, and the impact you expect. You will get a reply as soon as possible; there is no fixed SLA because this is a personal project.

## Scope

pocket-claude runs the Claude Code CLI on the host with your permissions. It has **no authentication of its own** and is meant to sit behind your own access control (VPN, SSH tunnel, or an authenticating reverse proxy) — see "Security Considerations" in the README. Reports about exposing it directly to the internet without such a layer are out of scope; reports about flaws inside that design are in scope — for example, conversation or tool output that injects HTML/script into the UI, or API input that bypasses validation (such as path traversal through session IDs).
