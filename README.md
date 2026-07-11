# Claude Code Web Embed Skill

A Claude Code skill that **embeds a locally running Claude Code into an existing web interface**. The Claude Code CLI is neither modified nor reimplemented — the copy already installed on your machine is bridged to an xterm.js terminal in your web UI through a **Local Agent (WebSocket + PTY)**.

```
Existing Web UI (xterm.js / iframe)
        │ WebSocket (language-neutral JSON protocol)
        ▼
Local Agent (WebSocket + PTY + security)   ← implementation is selectable
        │
        ▼
Claude Code CLI (existing, as-is)
```

The frontend and the Local Agent talk over a small, language-neutral protocol
([`references/protocol.md`](references/protocol.md)), so **the agent can be written
in any language**. Node.js and Python implementations ship ready-made and are
verified working; Go/Rust/Ruby/… can be added via the porting guide.

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
    │   └── python/              #     Python (stdlib pty + websockets)
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

- Requires a logged-in `claude` CLI, plus the runtime for your chosen agent (Node.js 18+ **or** Python 3.8+).
- Node: in `local-agent/node/`, run `npm install && npm start`. Python: in `local-agent/python/`, `pip install -r requirements.txt && python3 agent.py`. Copy the session token from the startup log into the frontend.
- The iframe approach is the default. Works with React / Next / Vue / Nuxt / Svelte / Astro / Vite / Vanilla, and with static hosting such as GitHub Pages.

## Security

Loopback-only binding, Origin allowlisting, a session token, working-directory scoping, and child-process management are all mandatory, and no public arbitrary-shell-execution API is exposed. Neither Claude Code nor local files are ever sent to the cloud. See `references/security.md` for details.

## Supported environments

- **Frontend**: React / Next.js / Vue / Nuxt / Svelte / Astro / Vite / Vanilla JS
- **Backend**: Any (only the frontend and the Local Agent are integrated)
- **Hosting**: The frontend runs even on static hosting (e.g. GitHub Pages). All communication with Claude is handled solely by the local Local Agent.
