# Local Agent Protocol (language-neutral contract)

The frontend (xterm.js, running in the browser) and the Local Agent talk over a
small, language-neutral protocol. **The Local Agent can be implemented in any
language** as long as it honors this contract — the frontend never changes.
Node.js and Python reference implementations ship under `assets/local-agent/`.

```
Frontend (browser, JS/xterm.js)  ──── this protocol ────  Local Agent (any language)
                                                                 │
                                                                 ▼
                                                          Claude Code CLI (PTY)
```

## Transport

- **HTTP** — health/status only.
- **WebSocket** — all terminal I/O (input, output, resize, status).

Default bind: `127.0.0.1:4820`.

## HTTP endpoints

### `GET /health`

```json
{ "status": "ok", "claudeAvailable": true, "activeSessions": 0 }
```

### `GET /status`

```json
{
  "status": "ok",
  "host": "127.0.0.1",
  "port": 4820,
  "workingDir": "/path/to/project",
  "maxSessions": 4,
  "activeSessions": 0,
  "claudeAvailable": true
}
```

CORS: reflect `Access-Control-Allow-Origin` only for allowed origins (see security below).

## WebSocket

### Connect

```
ws://127.0.0.1:4820/terminal?token=<SESSION_TOKEN>&cols=<N>&rows=<N>
```

The agent validates the connection **at upgrade time**, before creating a PTY:

| Condition | Response |
| --- | --- |
| Origin not allowed | `403 Forbidden` |
| Missing / wrong token | `401 Unauthorized` |
| Concurrent sessions ≥ max | `503 Service Unavailable` |
| OK | `101 Switching Protocols` (upgrade) |

On a successful upgrade the agent launches Claude Code on a PTY in the configured
working directory, sized to `cols`×`rows`.

### Messages — client → server (JSON)

| `type` | Fields | Meaning |
| --- | --- | --- |
| `input` | `data: string` | Keyboard input to write to the PTY |
| `resize` | `cols: number`, `rows: number` | Resize the PTY |
| `ping` | — | Liveness check |

### Messages — server → client (JSON)

| `type` | Fields | Meaning |
| --- | --- | --- |
| `status` | `state: string`, `pid?: number` | Session state (e.g. `connected`) |
| `output` | `data: string` | PTY output (raw terminal bytes as text) |
| `exit` | `exitCode: number`, `signal?: string\|null` | Claude Code process exited |
| `error` | `message: string` | Launch/other error (shown in the terminal) |
| `pong` | — | Reply to `ping` |

### Lifecycle

1. Client connects with token + dimensions.
2. Server validates, spawns Claude Code on a PTY, sends `status: connected`.
3. PTY output → `output` messages (preserve ordering; use an incremental UTF-8 decoder so multibyte characters are not split across chunks).
4. Client `input`/`resize` → written to the PTY.
5. PTY EOF / process exit → `exit`, then the socket closes.
6. **Socket close → the agent must terminate the PTY process** (kill the process group). No orphaned Claude processes.

## Security requirements (mandatory)

Any implementation must enforce all of these (see `security.md` for rationale):

- **Loopback-only bind** by default (`127.0.0.1`).
- **Origin allowlist**: if configured, allow only listed origins; otherwise allow only localhost-family origins. A missing `Origin` header (non-browser client) is allowed (not a CSRF vector).
- **Session token**: required on every WebSocket connection; compare in **constant time**.
- **Working-directory scoping**: launch Claude Code in the configured directory only.
- **Child-process management**: kill the PTY process on socket close; enforce a concurrent-session cap.
- **No arbitrary-shell API**: expose only "launch Claude Code on a PTY and relay".

## Configuration (shared env var names)

All implementations read the same variables (and an optional `.env`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_AGENT_HOST` | `127.0.0.1` | Bind host |
| `CLAUDE_AGENT_PORT` | `4820` | Bind port |
| `CLAUDE_AGENT_CWD` | agent cwd | Claude Code working directory |
| `CLAUDE_AGENT_ALLOWED_ORIGINS` | localhost only | Comma-separated origin allowlist |
| `CLAUDE_AGENT_TOKEN` | random per start | Session token |
| `CLAUDE_AGENT_COMMAND` | `claude` | Launch command |
| `CLAUDE_AGENT_ARGS` | — | Extra launch args (space-separated) |
| `CLAUDE_AGENT_MAX_SESSIONS` | `4` | Concurrent session cap |

## Porting guide — add a new language

To add an implementation (e.g. Go, Rust, Ruby), implement the four capabilities
below and the contract above. Put it under `assets/local-agent/<lang>/`.

| Capability | Node (ref) | Python (ref) | Go | Rust | Ruby |
| --- | --- | --- | --- | --- | --- |
| PTY | `node-pty` | stdlib `pty` | `creack/pty` | `portable-pty` (wezterm) | stdlib `PTY` |
| WebSocket | `ws` | `websockets` | `gorilla/websocket` or `coder/websocket` | `tokio-tungstenite` | `faye-websocket` / `async-websocket` |
| HTTP health | stdlib `http` | `websockets` `process_request` | stdlib `net/http` | `hyper`/`axum` | stdlib `webrick` / rack |
| Process mgmt | `child_process` | `subprocess` + `os.killpg` | `os/exec` | `std::process` | `Process` |

Checklist for a new implementation:

- [ ] `GET /health` and `GET /status` return the JSON shapes above.
- [ ] `/terminal` upgrade validates Origin, token (constant-time), and session cap.
- [ ] Spawns Claude Code on a PTY in the working dir, honoring `cols`/`rows`.
- [ ] Relays `input`/`resize`/`ping` ⇄ `output`/`exit`/`error`/`status`/`pong`.
- [ ] Kills the PTY process group on socket close.
- [ ] Reads the shared env vars / `.env`.
- [ ] Prints the startup banner incl. the session token.

**Distribution note**: Go and Rust compile to a single static binary, which
avoids native-build friction such as node-pty's `spawn-helper` execute-bit issue
on macOS. They are the strongest choices when you want a drop-in binary.
