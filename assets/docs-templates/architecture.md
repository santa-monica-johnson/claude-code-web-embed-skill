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
- `embed.js`: a framework-agnostic script loaded by the existing page. Builds the panel (dockable bottom/right/left, or a floating window — switchable at runtime from a selector in its own header, persisted via `localStorage`), the control UI, and the iframe, and controls the iframe via `postMessage`. Because it runs directly in the host page (not inside the iframe), it can also implement an element picker: on click, it attaches capturing listeners to the host document to highlight the hovered element and, on click, build a descriptor (CSS selector, opening tag, text, HTML snippet) and post it to the iframe as `claude-embed-insert-text`.
- `react/`, `vue/`: thin wrappers for each framework (the actual implementation is the iframe).

### Local Agent (local-agent/)

The agent is **implementation-selectable**: `node/` (Node 22+; macOS/Linux/Windows)
and `python/` (Python 3.11+ recommended; macOS/Linux/Unix-like only — no Windows,
since it relies on the stdlib `pty` module) ship ready-made, and any language can
be added by implementing the language-neutral protocol (see the skill's
`references/protocol.md`). All implementations behave identically. Every
implementation provides:

- **Entry / server**: HTTP (`/health`, `/status`) + WebSocket (`/terminal`); creates a PTY session per connection.
- **PTY management**: create, I/O, resize, and terminate the PTY.
- **Claude launcher**: build the launch spec (command, args, env) and check availability.
- **Security**: Origin validation + constant-time token comparison.
- **Config**: resolve settings from environment variables / `.env` (identical variable names across implementations).

Node splits these into `index.js` / `server.js` / `pty-manager.js` /
`claude-launcher.js` / `security.js` / `config.js`; Python keeps them in
`agent.py`. Same contract either way.

## Communication flow

1. The browser loads `embed.js`, which builds the panel (in whichever position was last selected, or the `init()` default) and the iframe.
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

A PTY alone isn't enough for correct resize behavior, though: the child process
also needs the PTY set as its **controlling terminal**, or the `SIGWINCH`
signal that a `TIOCSWINSZ` resize normally triggers never reaches it, and the
terminal UI silently keeps rendering at the old size. Node's `node-pty`
handles this internally. The Python implementation does it explicitly via
`os.setsid()` + `TIOCSCTTY` in a `preexec_fn` — a plain
`subprocess.Popen(..., start_new_session=True)` calls `setsid()` but never
makes the PTY the controlling terminal, which is why an earlier version of the
Python agent had panel resizes silently fail to redraw (fixed; see the
`PtySession.__init__` comment in `agent.py`).

### Why WebSocket

A terminal needs a low-latency, bidirectional stream. HTTP request/response is awkward for streaming output and key input, so all real-time communication is consolidated over WebSocket. HTTP is used only for health checks and status.

### Why iframe is the default

It is framework-agnostic and works as-is on static hosting (e.g. GitHub Pages). It integrates with minimal changes to the existing app. When React/Vue is needed, use the bundled wrappers.

### Why sessions outlive the WebSocket

A naive design ties the Claude Code process's lifetime to the WebSocket
connection: close the socket, kill the process. That means every page reload
or brief network drop throws away the running conversation. Instead, the PTY's
lifetime is decoupled from any one connection (see `protocol.md`'s "Session
persistence"): the agent keeps a `session id → PTY` map, holds a disconnected
PTY alive for a grace period, and lets a reconnect with the same id reattach
(replaying buffered scrollback) instead of relaunching. This is the same model
`tmux`/`screen` use for detach/reattach, applied to a browser tab instead of a
terminal multiplexer client.

### Why the element picker uses bracketed paste

Writing a multi-line descriptor (selector/tag/text/HTML) straight into the PTY
as plain input is unsafe: a raw `\n` byte is ordinarily interpreted by the
receiving line editor as Enter, so a naive implementation would submit a
partial, broken command after each line instead of leaving the whole block
sitting in the prompt. Wrapping the text in the standard bracketed-paste
escape sequence (`\x1b[200~ ... \x1b[201~`, the same mechanism a real terminal
uses when you paste multi-line text) tells the receiving app "this is one
pasted block" — internal newlines are preserved literally and nothing is
submitted until the user presses Enter themselves. Verified against both
`bash` and the real Claude Code CLI during development.

Bracketed paste alone is not a complete safety boundary: if the wrapped text
itself contained a real `\x1b[201~` (paste-end) byte sequence, that would
close the paste early, and any bytes after it — including a `\r` — would be
interpreted as real keystrokes, up to and including a real Enter that submits
whatever was in the input line. Legitimate picker-generated text (a CSS
selector, tag, trimmed text content, HTML snippet) never legitimately contains
raw ESC bytes, so `claude-terminal.js` strips `\x1b` from the text before
wrapping it — this was verified against an adversarial payload containing an
embedded fake paste-end sequence followed by a shell command, confirming it
lands inertly in the prompt rather than executing. The `message` listener also
checks `ev.source === window.parent` (mirroring the same check `embed.js`
already does in the other direction) so a different frame/window can't
impersonate the parent to inject text this way.

## Security design

Protected by two gates.

1. **Origin allowlist**: prevents browser-based CSRF / DNS rebinding. When unspecified, only localhost-family origins are allowed.
2. **Session token**: the real authorization. Verified with constant-time comparison.

In addition, loopback binding, working-directory scoping, a concurrent-session limit, and the absence of any arbitrary-shell-execution API minimize the attack surface.

## Extension points

- `config.js`: add configuration options.
- `server.js`: add new HTTP endpoints or WebSocket message types.
- `claude-launcher.js`: customize the launch command, args, and environment.
- `embed.js`: add new panel positions or theming (bottom/right/left/floating already supported, runtime-switchable).
