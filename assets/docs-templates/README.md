# Claude Code Web Embed

This directory contains everything needed to integrate a **locally running Claude Code** into an existing web interface. Claude Code itself is neither modified nor reimplemented — the CLI already installed on this machine is used as-is.

## Overview

```
Web UI (xterm.js terminal)
        │ WebSocket
        ▼
Local Agent (WebSocket + PTY)
        │
        ▼
Claude Code CLI (existing)
```

The Web UI connects to the Local Agent over WebSocket, and the Local Agent launches Claude Code inside a pseudo-terminal (PTY). Claude Code's output, input, and resize events are all relayed over WebSocket.

## Requirements

- Node.js 18 or later
- Claude Code CLI installed locally (the `claude` command)
- A logged-in Claude Code session

## Install

```bash
cd claude-embed/local-agent
npm install
```

`node-pty` is a native module, so some environments require build tools (macOS: Xcode Command Line Tools; Linux: build-essential/python3; Windows: windows-build-tools).

## Start

```bash
# Start the Local Agent (you can specify the working directory)
cd claude-embed/local-agent
CLAUDE_AGENT_CWD="/path/to/your/project" npm start
```

Set the **session token** printed in the startup log into the frontend. Start the Web UI the way your existing app normally starts (see `setup.md`).

## Usage

1. Start the Local Agent.
2. Open your existing web app. A Claude Code terminal panel appears at the bottom of the screen.
3. Type into the panel; your local Claude Code responds.
4. Use the header controls to open/close, reconnect, or go full screen.

## Configuration

Configure the Local Agent via `.env` (or environment variables). See `.env.example`.

| Variable | Default | Description |
| --- | --- | --- |
| `CLAUDE_AGENT_HOST` | `127.0.0.1` | Listen host (loopback strongly recommended) |
| `CLAUDE_AGENT_PORT` | `4820` | Listen port |
| `CLAUDE_AGENT_CWD` | agent's cwd | Claude Code working directory |
| `CLAUDE_AGENT_ALLOWED_ORIGINS` | localhost only | Allowed origins (comma-separated) |
| `CLAUDE_AGENT_TOKEN` | randomly generated | Session token |
| `CLAUDE_AGENT_COMMAND` | `claude` | Launch command |
| `CLAUDE_AGENT_MAX_SESSIONS` | `4` | Max concurrent sessions |

## Security

- The Local Agent listens on **loopback only** by default.
- Browser connections are restricted by an **Origin allowlist**.
- Every WebSocket connection requires a **session token**.
- Claude Code launches in the **configured working directory**.
- No public API for running arbitrary shell commands is exposed.

Claude Code and local files are never sent to the cloud. Even if you host the frontend statically (e.g. on GitHub Pages), all communication with Claude Code is handled solely by the local Local Agent.

## Supported frameworks

Because it uses the iframe approach, it works with React / Next.js / Vue / Nuxt / Svelte / Astro / Vite / Vanilla JS. Thin component wrappers for React and Vue are also included.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Stuck on "unconfigured" | Check that `agentUrl` and `token` are passed to the frontend |
| `401 Unauthorized` | Check that the token matches the value in the startup log |
| `403 Forbidden` | Add the Web UI's origin to `CLAUDE_AGENT_ALLOWED_ORIGINS` |
| "Failed to launch Claude Code" | Verify `claude` is on your PATH and logged in |
| Port-in-use error | Change `CLAUDE_AGENT_PORT` |
| `node-pty` build failure | Install build tools and re-run `npm install` |
| `posix_spawnp failed.` (macOS) | The bundled `spawn-helper` lost its execute bit. Restore it with `chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper` (or `build/Release/spawn-helper` for a built version) and re-run |

See `setup.md` for setup details and `architecture.md` for the design.
