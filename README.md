# Claude Code Web Embed Skill

A Claude Code skill that **embeds a locally running Claude Code into an existing web interface**. The Claude Code CLI is neither modified nor reimplemented — the copy already installed on your machine is bridged to an xterm.js terminal in your web UI through a **Local Agent (WebSocket + PTY)**.

```
Existing Web UI
  └─ iframe or framework wrapper
       └─ Terminal Frontend (xterm.js)
              │ WebSocket (language-neutral JSON protocol)
              ▼
Local Agent (WebSocket + PTY + security)   ← implementation is selectable
              │
              ▼
Claude Code CLI (existing, as-is)
```

The frontend and the Local Agent talk over a small, language-neutral protocol
([`references/protocol.md`](references/protocol.md)), so **the agent can be written
in any language**. Ready-made Node.js, Python, and Go implementations are included;
Rust/Ruby/… can be added via the porting guide. All three have been manually
exercised end-to-end (health check, auth rejection, PTY round-trip including
multibyte UTF-8, resize, session reattachment, grace-period expiry,
concurrent-session takeover, process-group kill, agent shutdown) on macOS
during development — see
[`references/protocol.md`](references/protocol.md#manual-verification-checklist)
for the checklist; there is no CI yet.

Two things make it feel like a persistent tool rather than a page widget:

- **Session persistence** — reloading the page (or a brief network drop) does not
  restart Claude Code. The Local Agent keeps the process alive for a grace period
  and reattaches on reconnect, replaying scrollback so the screen looks the same
  as before.
- **Runtime-selectable panel position** — the embedded panel can dock to the
  bottom, right, or left of the page, or float as a draggable/resizable window;
  switchable live from a selector in the panel's own header (persisted via
  `localStorage`), not just at init time.

## What is this

This repository bundles a single Claude Code skill (`SKILL.md`) together with the **ready-made template assets** it produces. When you invoke the skill, it analyzes the target project, drops the templates into place, and wires them into the existing UI with minimal changes.

## Repository layout

```
.
├── SKILL.md                     # The skill itself (orchestrator)
├── steps/                       # Three-step procedure
│   ├── step1-analyze.md         #   Project analysis
│   ├── step2-scaffold.md        #   Generate & place
│   └── step3-integrate.md       #   Integrate & verify
├── references/                  # Decision material
│   ├── protocol.md              #   Language-neutral agent protocol + porting guide
│   ├── project-analysis.md      #   Framework quick-reference
│   └── security.md              #   Security requirements
└── assets/                      # Templates placed as-is
    ├── local-agent/             #   Local Agent — pick one implementation
    │   ├── node/                #     Node.js (ws + node-pty)
    │   ├── python/              #     Python (stdlib pty + websockets)
    │   └── go/                  #     Go (creack/pty + gorilla/websocket)
    ├── frontend/                #   xterm.js terminal + embed.js + React/Vue wrappers
    └── docs-templates/          #   README / architecture / setup for the target project
```

## Using it as a skill

### Install (place under `~/.claude/skills/`)

```bash
# Symlink (to keep editing this repo while using it)
ln -s "$(pwd)" ~/.claude/skills/claude-code-web-embed

# Or copy
cp -R "$(pwd)" ~/.claude/skills/claude-code-web-embed
```

### Invoke

In a Claude Code session, ask for it (or run `/claude-code-web-embed`):

> Embed a Claude Code terminal into this project's web UI

The skill runs through Steps 1–3 and places/integrates `assets/` into the target project.

## Using the generated output

After placement, see `assets/docs-templates/` (README / setup / architecture), which is copied into the target project. In short:

- Requires a logged-in `claude` CLI, plus the runtime for your chosen agent: **Node.js 22+**, **Python 3.11+** (the `websockets` dependency itself only requires 3.10+, but 3.10 reaches end-of-life in October 2026 — 3.11+ gives more runway), or **Go 1.21+**. Windows users should pick the Node implementation; the Python and Go agents rely on Unix-only mechanisms (stdlib `pty`, and `creack/pty`'s `setsid`/`TIOCSCTTY`, respectively).
- Node: in `local-agent/node/`, run `npm install && npm start`. Python: in `local-agent/python/`, `pip install -r requirements.txt && python3 agent.py`. Go: in `local-agent/go/`, `go build -o claude-local-agent . && ./claude-local-agent`. Copy the session token from the startup log into the frontend.
- The iframe approach is the default. Works with React / Next / Vue / Nuxt / Svelte / Astro / Vite / Vanilla. Statically hosted frontends (e.g. GitHub Pages) are supported too, subject to the browser permitting the page to reach the visitor's own `localhost` Local Agent (see "Security" below).

## Security

Loopback-only binding, Origin allowlisting, a session token, working-directory scoping, and child-process management are all mandatory; no public arbitrary-shell-execution API is exposed. See `references/security.md` for details.

The bridge between the web UI and the Local Agent stays on the user's own
machine — this project doesn't proxy terminal traffic, repository contents, or
credentials through any cloud service of its own. **Claude Code itself does
communicate with whatever model provider it's configured to use** (normally
Anthropic), sending prompts and code context as part of its ordinary operation;
that data handling is governed by the provider and by the user's own Claude
Code account/organization settings, independent of this skill.

Because the Local Agent only listens on loopback, embedding this on a publicly
hosted page does not expose *your* Claude Code to site visitors — it only
works for whoever has their own Local Agent running on their own machine, with
the matching token.

## Supported environments

- **Frontend**: React / Next.js / Vue / Nuxt / Svelte / Astro / Vite / Vanilla JS.
- **Backend**: Any (only the frontend and the Local Agent are integrated).
- **Local Agent OS support**: Node implementation — macOS, Linux, Windows 10 1809+ (via `node-pty`/ConPTY). Python and Go implementations — macOS, Linux, and other Unix-like systems only (Python uses the stdlib `pty` module; Go's `creack/pty` sets up the controlling terminal via Unix `setsid`/`TIOCSCTTY`; neither exists on Windows).
- **Hosting**: The frontend can be statically hosted (e.g. GitHub Pages) as long as the visitor's browser is willing to let that page connect to their local Local Agent. Depending on the browser, this may involve a same-origin/Origin-allowlist check (mandatory, see `references/security.md`) and, on browsers that implement Local Network Access / Private Network Access restrictions, an explicit permission prompt for a public page reaching into `localhost`. Local development (frontend and agent both on `localhost`) is unaffected by any of this.

## License

[MIT](LICENSE)
