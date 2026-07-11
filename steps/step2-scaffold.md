# Step 2 — Generate & place

Copy the templates from `assets/` into the target project and adjust only
project-specific values. **Do not rewrite the code.** You only touch settings
such as port, origin, and serve path.

## Placement

Copy the frontend assets and the **chosen** agent implementation (from Step 1).

```
<project>/
├── local-agent/                    ← copy the CHOSEN implementation
│   ├── node/     …  assets/local-agent/node/     (if language = node)
│   └── python/   …  assets/local-agent/python/   (if language = python)
└── public/claude-embed/            ← copy the iframe assets from assets/frontend/
    ├── claude-terminal.html
    ├── claude-terminal.css
    ├── claude-terminal.js
    └── embed.js
```

Copy only the implementation you picked (you don't need both). If you added a new
language, place it under `local-agent/<lang>/` following `references/protocol.md`.

- **iframe method (default)**: place `claude-terminal.{html,css,js}` and `embed.js` on the static serve path.
- **React**: `assets/frontend/react/ClaudeTerminal.jsx` into your components; the iframe assets (`claude-terminal.*`) still go on the static serve path (the implementation is the iframe).
- **Vue**: `assets/frontend/vue/ClaudeTerminal.vue`, likewise.

## Values to adjust

| Target | What | Where |
| --- | --- | --- |
| Port | if not `4820` | `.env` (`CLAUDE_AGENT_PORT`) and the frontend `agentUrl` |
| Origin | allow the Web UI origin | `.env` (`CLAUDE_AGENT_ALLOWED_ORIGINS`) |
| Working dir | where Claude runs | `.env` (`CLAUDE_AGENT_CWD`) or at launch |
| Serve path | the `iframeSrc` URL | integration code (Step 3) |

Copy `.env.example` to `.env` and fill in what you need. If the token is unset it
is generated per start (set `CLAUDE_AGENT_TOKEN` only if you want it fixed). The
env var names are identical across implementations (`references/protocol.md`).

## Install dependencies

**Node:**
```bash
cd <project>/local-agent/node
<pm> install     # npm / yarn / pnpm / bun (from Step 1)
```
`node-pty` involves a native build. If it fails, guide the OS build tools (see the docs-templates README troubleshooting, incl. the macOS `spawn-helper` chmod fix).

**Python:**
```bash
cd <project>/local-agent/python
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
```

## Static hosting (e.g. GitHub Pages)

The frontend assets (`claude-terminal.*`, `embed.js`) work as-is on static hosting.
The Local Agent runs locally on the visitor's own machine — add the deploy origin
to `CLAUDE_AGENT_ALLOWED_ORIGINS` (mandatory). This is not an unconditional
guarantee: some browsers gate a public HTTPS page's access to `localhost` behind
a Local Network Access permission prompt. State this to the user as conditional
on their browser, not as flatly "supported" (`references/security.md`).
