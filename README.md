# Claude Code Web Embed Skill

A Claude Code skill that **embeds a locally running Claude Code into an existing web interface**. The Claude Code CLI is neither modified nor reimplemented — the copy already installed on your machine is bridged to an xterm.js terminal in your web UI through a **Local Agent (WebSocket + PTY)**.

```
Existing Web UI (xterm.js / iframe)
        │ WebSocket
        ▼
Local Agent (WebSocket + PTY + security)
        │
        ▼
Claude Code CLI (existing, as-is)
```

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
│   ├── project-analysis.md      #   Framework quick-reference
│   └── security.md              #   Security requirements
└── assets/                      # Templates placed as-is
    ├── local-agent/             #   Local Agent (Node.js / ws / node-pty)
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

- Requires Node.js 18+ and a logged-in `claude` CLI.
- In `local-agent/`, run `npm install && npm start`. Copy the session token from the startup log into the frontend.
- The iframe approach is the default. Works with React / Next / Vue / Nuxt / Svelte / Astro / Vite / Vanilla, and with static hosting such as GitHub Pages.

## Security

Loopback-only binding, Origin allowlisting, a session token, working-directory scoping, and child-process management are all mandatory, and no public arbitrary-shell-execution API is exposed. Neither Claude Code nor local files are ever sent to the cloud. See `references/security.md` for details.

## Supported environments

- **Frontend**: React / Next.js / Vue / Nuxt / Svelte / Astro / Vite / Vanilla JS
- **Backend**: Any (only the frontend and the Local Agent are integrated)
- **Hosting**: The frontend runs even on static hosting (e.g. GitHub Pages). All communication with Claude is handled solely by the local Local Agent.
