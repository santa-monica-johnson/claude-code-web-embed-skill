# Local Agent — pick an implementation

The Local Agent bridges the web UI to your locally installed Claude Code CLI over
a WebSocket + PTY. **Choose one implementation.** They all speak the same
language-neutral protocol (`references/protocol.md`), so the frontend is identical
regardless of which you pick.

| Implementation | Directory | Runtime | OS support | Notes |
| --- | --- | --- | --- | --- |
| **Node.js** | `node/` | Node 22+ | macOS, Linux, Windows 10 1809+ | Familiar to web devs; same language as xterm.js. Uses `ws` + `node-pty` (native build; `node-pty` also provides the Windows ConPTY backend). |
| **Python** | `python/` | Python 3.11+ (the `websockets` dependency itself only needs 3.10+) | macOS, Linux, Unix-like only | Uses the stdlib `pty` + `websockets`. No native build. **Not usable on Windows** — the stdlib `pty` module doesn't exist there; use the Node implementation instead. |

Ready-made Node.js and Python implementations are included. Both have been
manually exercised end-to-end on macOS during development (health check, auth
rejection, PTY input/output round-trip, resize, session reattachment,
concurrent-session takeover) — see `references/protocol.md`'s manual
verification checklist. There is no automated CI yet, and neither has been
tested on Linux or Windows; treat those as unverified until you or someone
else confirms them. Additional languages (Go, Rust, Ruby, …) can be added by
following the porting guide in `references/protocol.md`; Go/Rust are the best
choices when you want a single static binary.

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

Either way, copy the **session token** from the startup log into the frontend.
See `../docs-templates/setup.md` for the full setup and `references/protocol.md`
for the wire protocol.
