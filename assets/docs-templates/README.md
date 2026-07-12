# Claude Code Web Embed

This directory contains everything needed to integrate a **locally running Claude Code** into an existing web interface. Claude Code itself is neither modified nor reimplemented — the CLI already installed on this machine is used as-is.

## Overview

```
Web UI
  └─ iframe or framework wrapper
       └─ Terminal Frontend (xterm.js)
              │ WebSocket (language-neutral JSON protocol)
              ▼
Local Agent (WebSocket + PTY)   ← choose an implementation: Node, Python, or Go
              │
              ▼
Claude Code CLI (existing)
```

The Web UI connects to the Local Agent over WebSocket, and the Local Agent launches Claude Code inside a pseudo-terminal (PTY). Output, input, and resize events are relayed over WebSocket. The frontend is identical regardless of which agent implementation you run.

## Requirements

- **Node implementation**: Node.js 22+. Works on macOS, Linux, and Windows 10 1809+ (via `node-pty`/ConPTY).
- **Python implementation**: Python 3.11+ recommended (the `websockets` dependency itself only requires 3.10+, but that version reaches end-of-life in October 2026). **macOS/Linux/Unix-like only** — it uses the stdlib `pty` module, which does not exist on Windows. Windows users should use the Node implementation instead.
- **Go implementation**: Go 1.21+ (developed/verified with 1.26). **macOS/Linux/Unix-like only** — same reasoning as Python (its PTY library sets up the controlling terminal via Unix `setsid`/`TIOCSCTTY`). Compiles to a single static binary; no runtime needed on the machine that runs it beyond the binary itself.
- Claude Code CLI installed locally (the `claude` command), logged in

## Install & start

Run **one** implementation.

### Node

```bash
cd local-agent/node
npm install
CLAUDE_AGENT_CWD="/path/to/your/project" npm start
```

`node-pty` is a native module, so some environments need build tools (macOS: Xcode Command Line Tools; Linux: build-essential/python3; Windows: windows-build-tools).

### Python

```bash
cd local-agent/python
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
CLAUDE_AGENT_CWD="/path/to/your/project" python3 agent.py
```

### Go

```bash
cd local-agent/go
go build -o claude-local-agent .
CLAUDE_AGENT_CWD="/path/to/your/project" ./claude-local-agent
```

Either way, set the **session token** printed in the startup log into the frontend, and start the Web UI the way your existing app normally starts (see `setup.md`).

## Session persistence

Reloading the page (or a brief network drop) does **not** restart Claude Code.
The frontend keeps a small session id in the browser's `sessionStorage` (cleared
when the tab closes, but kept across a reload) and reconnects with it; the Local
Agent reattaches to the still-running Claude Code process instead of launching a
new one, and replays recent output so the screen looks the same as before. If
nothing reattaches within `CLAUDE_AGENT_SESSION_GRACE_MS` (default 2 minutes,
e.g. the tab was closed for good), the process is terminated.

Opening the same page in a second tab takes over that session (the first tab
is disconnected, not duplicated) — this mirrors how a single `tmux`/`screen`
session can only be attached from one place at a time.

## Panel controls

The embedded panel's header (iframe/`embed.js` method — the React/Vue wrappers
have a simpler header without these controls) has:

- **Position selector** — dock the terminal to the **bottom**, **right**, or
  **left** of the page, or pop it out as a **floating** window you can drag
  (by the header) and resize (by its edge/corner handle). Switching is
  instant and has nothing to do with `init()`'s `position` option, which only
  sets the *initial* placement — the choice made here is remembered across
  reloads via `localStorage`.
- **Pick an element** (`⌖`) — click, then hover anywhere on the page to
  highlight elements and click one to select it. Its CSS selector, opening
  tag, visible text, and an HTML snippet are inserted into the terminal's
  current input line (as a paste, not auto-submitted) so you can say
  something like "make this bigger" with concrete context attached. The
  selector is best-effort — if it matches more than one element, a note is
  added so you know to double-check before acting on it. Press `Esc` or
  click the panel's own UI to cancel without selecting anything. Known
  limitation: content inside a Shadow DOM (web components) can only be
  selected down to the shadow host, not the elements inside it.
- **Reconnect** — force a fresh WebSocket connection without reloading the page.
- **Full screen** (`⛶`) — expand the panel to fill the viewport.
- **Minimize** (`—`) — collapse the panel to a small launcher button; click it
  to reopen.

## Configuration

Configure via `.env` (or environment variables); the variable names are identical across implementations. See `.env.example`.

| Variable | Default | Description |
| --- | --- | --- |
| `CLAUDE_AGENT_HOST` | `127.0.0.1` | Listen host (loopback strongly recommended) |
| `CLAUDE_AGENT_PORT` | `4820` | Listen port |
| `CLAUDE_AGENT_CWD` | agent's cwd | Claude Code working directory |
| `CLAUDE_AGENT_ALLOWED_ORIGINS` | localhost only | Allowed origins (comma-separated) |
| `CLAUDE_AGENT_TOKEN` | randomly generated | Session token |
| `CLAUDE_AGENT_COMMAND` | `claude` | Launch command |
| `CLAUDE_AGENT_MAX_SESSIONS` | `4` | Max concurrent sessions |
| `CLAUDE_AGENT_SESSION_GRACE_MS` | `120000` | How long a disconnected session survives, waiting for reattachment |
| `CLAUDE_AGENT_SCROLLBACK_CHARS` | `200000` | Buffered output replayed on reattach |

## Security

- The Local Agent listens on **loopback only** by default.
- Browser connections are restricted by an **Origin allowlist**.
- Every WebSocket connection requires a **session token**.
- Claude Code launches in the **configured working directory**.
- No public API for running arbitrary shell commands is exposed.

The bridge between the Web UI and the Local Agent stays on the user's own
machine — this project doesn't proxy terminal traffic, repository contents, or
credentials through any cloud service of its own. **Claude Code itself
communicates with whatever model provider it's configured to use** (normally
Anthropic) as part of its ordinary operation, sending prompts and code
context; that data handling is governed by the provider and by the user's own
Claude Code account/organization settings, independent of this integration.

If you host the frontend statically (e.g. on GitHub Pages), it still works —
but only for a visitor who has their own Local Agent running on their own
machine with the matching token. Depending on the browser, connecting from a
publicly hosted page to `localhost` may also require the visitor to grant a
local-network-access permission (a restriction some browsers are rolling out).
Local development, where both the frontend and the agent run on `localhost`,
is unaffected by any of this.

## Supported frameworks

Because it uses the iframe approach, it works with React / Next.js / Vue / Nuxt / Svelte / Astro / Vite / Vanilla JS. Thin component wrappers for React and Vue are also included.

## Adding another agent language

The frontend and agent talk over a small language-neutral protocol, so you can add
a Rust/Ruby/… implementation without touching the frontend. See the protocol
and porting guide bundled with the skill (`references/protocol.md`).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Stuck on "unconfigured" | Check that `agentUrl` and `token` are passed to the frontend |
| `401 Unauthorized` | Check that the token matches the value in the startup log |
| `403 Forbidden` | Add the Web UI's origin to `CLAUDE_AGENT_ALLOWED_ORIGINS` |
| `403 Forbidden` when opening the page via `file:///path/to/index.html` | Browsers send `Origin: null` for `file://` pages. Add the literal string `null` to `CLAUDE_AGENT_ALLOWED_ORIGINS` (and re-list any `http://localhost:PORT` origins you still need — see `.env.example`) |
| "Failed to launch Claude Code" | Verify `claude` is on your PATH and logged in |
| Port-in-use error | Change `CLAUDE_AGENT_PORT` |
| `node-pty` build failure (Node) | Install build tools and re-run `npm install` |
| `posix_spawnp failed.` (Node, macOS) | The bundled `spawn-helper` lost its execute bit. Restore it with `chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper` (or `build/Release/spawn-helper` for a built version) and re-run. (Not applicable to the Python or Go implementations.) |
| `.env` not picked up (Go) | The agent looks for `.env` next to the running binary, plus the current working directory as a fallback. With `go run .` the binary lives in a temp build dir, so either `cd` into `local-agent/go` before running, or build a real binary with `go build` first. |

See `setup.md` for setup details and `architecture.md` for the design.
