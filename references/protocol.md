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
ws://127.0.0.1:4820/terminal?token=<SESSION_TOKEN>&cols=<N>&rows=<N>&session=<SESSION_ID>
```

`session` is optional but should always be sent by well-behaved clients (see
"Session persistence" below). It is a client-generated opaque string, not a
credential — `token` remains the sole authorization mechanism.

The agent validates the connection **at upgrade time**, before creating or
reattaching a PTY:

| Condition | Response |
| --- | --- |
| Origin not allowed | `403 Forbidden` |
| Missing / wrong token | `401 Unauthorized` |
| No existing session for `session` id **and** concurrent sessions ≥ max | `503 Service Unavailable` |
| OK | `101 Switching Protocols` (upgrade) |

Reattaching to an existing session (see below) never counts against the
concurrent-session cap — only spawning a *new* Claude Code process does.

On a fresh session the agent launches Claude Code on a PTY in the configured
working directory, sized to `cols`×`rows`. On a reattached session, no new
process is spawned; the agent instead resizes the existing PTY to the new
`cols`×`rows` and replays buffered scrollback (see Lifecycle).

### Messages — client → server (JSON)

| `type` | Fields | Meaning |
| --- | --- | --- |
| `input` | `data: string` | Keyboard input to write to the PTY |
| `resize` | `cols: number`, `rows: number` | Resize the PTY |
| `ping` | — | Liveness check |

### Messages — server → client (JSON)

| `type` | Fields | Meaning |
| --- | --- | --- |
| `status` | `state: string`, `pid?: number`, `sessionId?: string`, `resumed?: boolean` | Session state. `state` is one of `connected`, `replaced` (see below). `sessionId` is the id the server resolved (client should persist it). `resumed: true` means this reattached an existing PTY instead of spawning a new one. |
| `output` | `data: string` | PTY output (raw terminal bytes as text). On reattach, the first `output` message is the replayed scrollback buffer. |
| `exit` | `exitCode: number`, `signal?: string\|null` | Claude Code process exited |
| `error` | `message: string` | Launch/other error (shown in the terminal) |
| `pong` | — | Reply to `ping` |

`status: { state: 'replaced' }` is sent to a connection right before the server
closes it because another connection reattached to the same session id (e.g. the
same page open in two tabs). A client that receives this **must not**
auto-reconnect — otherwise two tabs sharing one session id fight over it in an
infinite reconnect loop. Treat it like a deliberate, user-initiated close.

### Lifecycle

1. Client connects with token + dimensions + session id.
2. **New session**: server validates, spawns Claude Code on a PTY, sends `status: {state: 'connected', resumed: false}`.
   **Reattach** (an existing, still-alive session exists for that id): server cancels any pending grace-period timer, attaches this connection to the existing PTY, sends `status: {state: 'connected', resumed: true}`, replays the buffered scrollback as one `output` message, then resizes the PTY to the new dimensions.
3. PTY output → `output` messages, delivered only to the currently attached connection (preserve ordering; use an incremental UTF-8 decoder so multibyte characters are not split across chunks).
4. Client `input`/`resize` → written to the PTY.
5. PTY EOF / process exit → `exit` sent to whichever connection is currently attached (if any), then that socket closes and the session is fully removed (no reattachment possible after a real process exit).
6. **Socket close (without a process exit) → the agent must NOT immediately kill the PTY.** Instead start a grace-period timer (`CLAUDE_AGENT_SESSION_GRACE_MS`). If no connection reattaches to that session id before it elapses, kill the PTY process (group) and free the session. If a connection reattaches first, cancel the timer (step 2).
7. **Takeover**: if a second connection reattaches to a session id that already has a connection attached, the agent sends that existing connection `status: {state: 'replaced'}` and closes it, then attaches the new connection. Implementations must take care that the *old* connection's own close-handling does not then start a grace-period timer for a session that is actively in use by the new connection (a real race found and fixed in both reference implementations — see the source comments in `server.js`'s `cleanup()` and `agent.py`'s `PtySession.attach()`).
8. Agent process shutdown → kill all live PTYs immediately, bypassing any pending grace-period timers (no orphaned Claude processes on restart).

### Session persistence (why `session` exists)

Browser page reloads or brief network drops would otherwise kill the running
Claude Code process every time, losing the conversation. By sending a stable,
client-generated `session` id across reconnects (both reference frontends store
it in `sessionStorage`, which survives a reload but not closing the tab) and by
having the agent hold the PTY alive for a grace period after disconnect, a
reload transparently reattaches to the same running process with its scrollback
restored — as long as it happens within the grace period.

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
| `CLAUDE_AGENT_SESSION_GRACE_MS` | `120000` | How long a PTY survives after its WebSocket disconnects, waiting for reattachment, before being killed |
| `CLAUDE_AGENT_SCROLLBACK_CHARS` | `200000` | Max buffered output (characters) kept per session, replayed on reattach |

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
- [ ] `/terminal` upgrade validates Origin, token (constant-time), and session cap (reattaches exempt).
- [ ] Spawns Claude Code on a PTY in the working dir, honoring `cols`/`rows`.
- [ ] Relays `input`/`resize`/`ping` ⇄ `output`/`exit`/`error`/`status`/`pong`.
- [ ] Session persistence: keeps a session-id → PTY map decoupled from any one connection; buffers scrollback (`CLAUDE_AGENT_SCROLLBACK_CHARS`); on disconnect, starts a grace timer (`CLAUDE_AGENT_SESSION_GRACE_MS`) instead of killing immediately; a same-id reconnect within the grace period cancels the timer and reattaches (replays the buffer) instead of relaunching.
- [ ] Takeover: a second connection for an already-attached session id notifies the old connection (`status: replaced`) and closes it — and does **not** let that old connection's own cleanup schedule a grace-kill for the (still actively used) session.
- [ ] Kills the PTY process group on socket close once the grace period elapses with no reattachment, and unconditionally on agent shutdown.
- [ ] Reads the shared env vars / `.env`.
- [ ] Prints the startup banner incl. the session token.

**Distribution note**: Go and Rust compile to a single static binary, which
avoids native-build friction such as node-pty's `spawn-helper` execute-bit issue
on macOS. They are the strongest choices when you want a drop-in binary.

## Manual verification checklist

There is no automated CI for this project yet. Before calling an implementation
(new or modified) "working", exercise at least the following manually — e.g.
with a small WebSocket test script and `curl`, using a harmless command like
`cat` or `bash` in place of `claude` where you just need to observe PTY I/O
rather than a real Claude Code session:

- [ ] Agent starts and prints the banner (host, port, working dir, Claude
      availability, session token).
- [ ] `GET /health` returns `200` with the documented JSON shape.
- [ ] `GET /terminal` upgrade with a missing/wrong token is rejected `401`.
- [ ] `GET /terminal` upgrade with a disallowed Origin is rejected `403`.
- [ ] A valid connection reaches `status: connected`, a real PTY starts, and
      input/output round-trips correctly (including multibyte UTF-8 across
      chunk boundaries).
- [ ] A `resize` message is accepted and reflected in the PTY's window size.
- [ ] The child process exits cleanly and the agent reports it (`exit` message,
      `activeSessions` count drops).
- [ ] **Session persistence**: disconnect and reconnect with the same `session`
      id before the grace period elapses — same PID, `resumed: true`, buffered
      output is replayed, and new input/output continues to work.
- [ ] **Grace expiry**: reconnect with the same `session` id *after* the grace
      period elapses — a *different* PID (fresh process), not a hang or crash.
- [ ] **Takeover**: connect twice with the same `session` id while the first is
      still open — the first receives `status: replaced` and closes; the second
      keeps working correctly even after the (would-be) grace period has passed
      (this specific check catches a real race found during development — see
      `server.js`'s `cleanup()` comment and `agent.py`'s `PtySession.attach()`
      comment for what can go wrong here in each language).
- [ ] Agent shutdown (SIGINT/SIGTERM) terminates all live PTYs immediately,
      including ones mid-grace-period.

Record what you actually ran (OS, language, command used in place of `claude`)
wherever "verified working" is claimed in documentation — don't claim coverage
of an OS or language combination you haven't actually run.
