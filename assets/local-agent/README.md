# Local Agent — pick an implementation

The Local Agent bridges the web UI to your locally installed Claude Code CLI over
a WebSocket + PTY. **Choose one implementation.** They all speak the same
language-neutral protocol (`references/protocol.md`), so the frontend is identical
regardless of which you pick.

| Implementation | Directory | Runtime | OS support | Notes |
| --- | --- | --- | --- | --- |
| **Node.js** | `node/` | Node 22+ | macOS, Linux, Windows 10 1809+ | Familiar to web devs; same language as xterm.js. Uses `ws` + `node-pty` (native build; `node-pty` also provides the Windows ConPTY backend). |
| **Python** | `python/` | Python 3.11+ (the `websockets` dependency itself only needs 3.10+) | macOS, Linux, Unix-like only | Uses the stdlib `pty` + `websockets`. No native build. **Not usable on Windows** — the stdlib `pty` module doesn't exist there; use the Node implementation instead. |
| **Go** | `go/` | Go 1.21+ (developed/verified with 1.26) | macOS, Linux (Unix-like; not usable on Windows — see below) | Uses `creack/pty` + `gorilla/websocket`. Compiles to a single static binary — no native-build friction, no runtime to install on the target machine. |

Ready-made Node.js, Python, and Go implementations are included. All three have
been manually exercised end-to-end on macOS during development (health check,
auth rejection, PTY input/output round-trip including multibyte UTF-8, resize,
session reattachment, grace-period expiry, concurrent-session takeover,
process-group kill, agent shutdown) — see `references/protocol.md`'s manual
verification checklist. There is no automated CI yet, and none of the three
has been tested on Linux or Windows; treat those as unverified until you or
someone else confirms them. The Go implementation currently uses `creack/pty`,
which sets up the PTY via Unix `setsid`/`TIOCSCTTY` and process groups — the
same mechanism Python's manual workaround targets — so it is Unix-like only
for now; a Windows backend (ConPTY, mirroring Node's `node-pty`) is not
implemented. Additional languages (Rust, Ruby, …) can be added by following
the porting guide in `references/protocol.md`; Go/Rust are the best choices
when you want a single static binary.

The Python implementation explicitly sets the PTY as the child's controlling
terminal (`setsid()` + `TIOCSCTTY` in `preexec_fn`) so that resize signals
(`SIGWINCH`) actually reach Claude Code — `subprocess.Popen`'s
`start_new_session=True` alone does not do this, and without it a panel
resize silently fails to redraw. This was found and fixed after Node's
`node-pty` (which handles it internally) showed no such issue.

Both also implement **session persistence**: a page reload or brief disconnect
reattaches to the still-running Claude Code process instead of restarting it
(see `../docs-templates/README.md`'s "Session persistence" section and
`references/protocol.md` for the wire-level design).

## Quick start

### Node

```bash
cd node
npm install
CLAUDE_AGENT_CWD="/path/to/your/project" npm start
```

### Python

```bash
cd python
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
CLAUDE_AGENT_CWD="/path/to/your/project" python3 agent.py
```

### Go

```bash
cd go
go build -o claude-local-agent .
CLAUDE_AGENT_CWD="/path/to/your/project" ./claude-local-agent
```

(`go run .` also works during development, but the `.env` auto-load looks next
to the running binary — with `go run` that's a temp build directory, not this
folder — so it also checks the current working directory as a fallback. Build
a real binary for normal use.)

Either way, copy the **session token** from the startup log into the frontend.
See `../docs-templates/setup.md` for the full setup and `references/protocol.md`
for the wire protocol.
