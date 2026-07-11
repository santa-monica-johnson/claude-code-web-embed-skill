# Architecture

A design reference for developers. It summarizes the structure, communication flow, and design decisions behind Claude Code Web Embed.

## System structure

```
┌──────────────────────────────┐
│ Existing web interface        │
│  ┌────────────────────────┐  │
│  │ Claude Code Terminal     │  │  ← xterm.js (iframe)
│  └────────────────────────┘  │
└──────────────┬───────────────┘
               │ WebSocket (input / output / resize / status)
               ▼
┌──────────────────────────────┐
│ Local Agent                   │
│  • HTTP Server (health/status)│
│  • WebSocket Server            │
│  • PTY Manager                 │
│  • Claude Launcher             │
│  • Security (Origin/Token/cwd) │
└──────────────┬───────────────┘
               │ pseudo-terminal (PTY)
               ▼
         Claude Code CLI (existing)
```

## Component responsibilities

### Web Interface (frontend/)

- `claude-terminal.html` / `.js` / `.css`: the terminal itself, running inside the iframe. Initializes xterm.js and connects to the Local Agent over WebSocket.
- `embed.js`: a framework-agnostic script loaded by the existing page. Builds the bottom-docked panel, the control UI, and the iframe, and controls the iframe via `postMessage`.
- `react/`, `vue/`: thin wrappers for each framework (the actual implementation is the iframe).

### Local Agent (local-agent/)

The agent is **implementation-selectable**: `node/` (Node 18+) and `python/`
(Python 3.8+) ship ready-made, and any language can be added by implementing the
language-neutral protocol (see the skill's `references/protocol.md`). All
implementations behave identically. Every implementation provides:

- **Entry / server**: HTTP (`/health`, `/status`) + WebSocket (`/terminal`); creates a PTY session per connection.
- **PTY management**: create, I/O, resize, and terminate the PTY.
- **Claude launcher**: build the launch spec (command, args, env) and check availability.
- **Security**: Origin validation + constant-time token comparison.
- **Config**: resolve settings from environment variables / `.env` (identical variable names across implementations).

Node splits these into `index.js` / `server.js` / `pty-manager.js` /
`claude-launcher.js` / `security.js` / `config.js`; Python keeps them in
`agent.py`. Same contract either way.

## Communication flow

1. The browser loads `embed.js`, which builds the bottom panel and the iframe.
2. After the iframe loads, the parent passes `agentUrl` and `token` via `postMessage`.
3. The iframe opens a WebSocket to `ws://127.0.0.1:PORT/terminal?token=...&cols=..&rows=..`.
4. On upgrade, the Local Agent validates Origin, token, and the session limit.
5. Once validated, it launches Claude Code on a PTY and relays both directions.
   - Client → Server: `{type:'input'|'resize'|'ping'}`
   - Server → Client: `{type:'output'|'exit'|'error'|'status'|'pong'}`
6. When the WebSocket closes, the PTY process is terminated.

## Design decisions

### Why a PTY

Claude Code has an interactive terminal UI (thinking display, permission dialogs, color, cursor control). An ordinary pipe would lose all of that, so it is launched on a pseudo-terminal (PTY) to preserve its original UI and behavior.

### Why WebSocket

A terminal needs a low-latency, bidirectional stream. HTTP request/response is awkward for streaming output and key input, so all real-time communication is consolidated over WebSocket. HTTP is used only for health checks and status.

### Why iframe is the default

It is framework-agnostic and works as-is on static hosting (e.g. GitHub Pages). It integrates with minimal changes to the existing app. When React/Vue is needed, use the bundled wrappers.

## Security design

Protected by two gates.

1. **Origin allowlist**: prevents browser-based CSRF / DNS rebinding. When unspecified, only localhost-family origins are allowed.
2. **Session token**: the real authorization. Verified with constant-time comparison.

In addition, loopback binding, working-directory scoping, a concurrent-session limit, and the absence of any arbitrary-shell-execution API minimize the attack surface.

## Extension points

- `config.js`: add configuration options.
- `server.js`: add new HTTP endpoints or WebSocket message types.
- `claude-launcher.js`: customize the launch command, args, and environment.
- `embed.js`: extend panel placement (e.g. right dock) and theming.
