# Claude Code Web Embed

This directory contains everything needed to integrate a **locally running Claude Code** into an existing web interface. Claude Code itself is neither modified nor reimplemented — the CLI already installed on this machine is used as-is.

## Overview

```
Web UI (xterm.js terminal)
        │ WebSocket (language-neutral JSON protocol)
        ▼
Local Agent (WebSocket + PTY)   ← choose an implementation: Node or Python
        │
        ▼
Claude Code CLI (existing)
```

The Web UI connects to the Local Agent over WebSocket, and the Local Agent launches Claude Code inside a pseudo-terminal (PTY). Output, input, and resize events are relayed over WebSocket. The frontend is identical regardless of which agent implementation you run.

## Requirements

- **Node implementation**: Node.js 18+
- **Python implementation**: Python 3.8+
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

Claude Code and local files are never sent to the cloud. Even if you host the frontend statically (e.g. on GitHub Pages), all communication with Claude Code is handled solely by the local Local Agent.

## Supported frameworks

Because it uses the iframe approach, it works with React / Next.js / Vue / Nuxt / Svelte / Astro / Vite / Vanilla JS. Thin component wrappers for React and Vue are also included.

## Adding another agent language

The frontend and agent talk over a small language-neutral protocol, so you can add
a Go/Rust/Ruby/… implementation without touching the frontend. See the protocol
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
| `posix_spawnp failed.` (Node, macOS) | The bundled `spawn-helper` lost its execute bit. Restore it with `chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper` (or `build/Release/spawn-helper` for a built version) and re-run. (Not applicable to the Python implementation.) |

See `setup.md` for setup details and `architecture.md` for the design.
