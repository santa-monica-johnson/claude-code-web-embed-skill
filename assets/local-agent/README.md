# Local Agent — pick an implementation

The Local Agent bridges the web UI to your locally installed Claude Code CLI over
a WebSocket + PTY. **Choose one implementation.** They all speak the same
language-neutral protocol (`references/protocol.md`), so the frontend is identical
regardless of which you pick.

| Implementation | Directory | Runtime | Notes |
| --- | --- | --- | --- |
| **Node.js** | `node/` | Node 18+ | Familiar to web devs; same language as xterm.js. Uses `ws` + `node-pty` (native build). |
| **Python** | `python/` | Python 3.8+ | Uses the stdlib `pty` + `websockets`. No native build. Unix/macOS/Linux only (on Windows, use the Node implementation). |

Both are verified working. Additional languages (Go, Rust, Ruby, …) can be added
by following the porting guide in `references/protocol.md`; Go/Rust are the best
choices when you want a single static binary.

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
