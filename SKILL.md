---
name: claude-code-web-embed
description: Integrate a locally running Claude Code into an existing web interface. The Claude Code CLI is not reimplemented — the copy installed on the user's machine is bridged to an xterm.js terminal in the web UI through a Local Agent (WebSocket + PTY). Use when the user wants to "embed a Claude Code terminal in a web app", "integrate Claude Code into a site", "run Claude Code from the browser", or "generate a Local Agent and embedded terminal". The Local Agent language is selectable up front (Node.js or Python ship ready-made; any language can be added via the protocol). Works with React/Next/Vue/Nuxt/Svelte/Astro/Vite/Vanilla and static hosting such as GitHub Pages. The iframe approach is the default.
---

# claude-code-web-embed (embed Claude Code into an existing web app)

**Embed the locally installed Claude Code CLI into an existing web UI.** Claude Code is neither modified nor reimplemented — the machine's `claude` is launched on a PTY and relayed over WebSocket to an xterm.js terminal.

```
Existing web UI (xterm.js terminal / iframe)
        │ WebSocket  (language-neutral JSON protocol)
        ▼
Local Agent (WebSocket + PTY + security)   ← this skill scaffolds it; language is selectable
        │
        ▼
Claude Code CLI (existing, as-is)
```

## What this skill produces

- **Local Agent** (`assets/local-agent/`): pick one implementation — **`node/`** (Node 18+) or **`python/`** (Python 3.8+). Both speak the same protocol (`references/protocol.md`). Any other language (Go, Rust, …) can be added via the porting guide.
- **Frontend** (`assets/frontend/`): xterm.js terminal (iframe), embed script, connection-status UI, plus React/Vue wrappers. Shared across all agent languages.
- **Docs** (`assets/docs-templates/`): README / architecture / setup for the target project.

These are **finished template assets**. The skill's job is to analyze the target project, choose the embedding method and agent language, place the assets, and wire them into the existing UI with minimal change. **Do not rewrite the code from scratch each time.**

## Procedure (3 steps)

Always confirm the target project root first (where the integration goes). If unclear, ask in one line before proceeding.

### Step 1 — Analyze & choose  `steps/step1-analyze.md`

Inspect `package.json`, framework, package manager, layout, and whether it is statically hosted. Decide, and state in one line:
- **Embedding method** — iframe (default, framework-agnostic) vs React/Vue wrapper.
- **Local Agent language** — `node` or `python` (or a new language via `references/protocol.md`). This is a first-class, up-front choice.
- **Placement** and **port/origin**.

### Step 2 — Generate & place  `steps/step2-scaffold.md`

Copy the frontend assets and the **chosen** agent implementation into the target project. Adjust only project-specific values (port, origin, serve path).

### Step 3 — Integrate & verify  `steps/step3-integrate.md`

Wire the embed into the existing UI in one place (for the iframe default: load `embed.js` + call `ClaudeEmbed.init`). Place the docs and confirm the **completion criteria** below.

## References

- `references/protocol.md` — the language-neutral contract between frontend and agent, plus a porting guide for adding languages.
- `references/project-analysis.md` — per-framework placement/injection quick-reference.
- `references/security.md` — mandatory security requirements (loopback-only, Origin, token, working-directory scope).
- `assets/docs-templates/architecture.md` — design rationale (why PTY / WebSocket / iframe).

## Principles

- **Do not reimplement Claude Code.** Just launch the existing CLI on a PTY. Thinking / Tool Use / Slash Commands / Permission dialogs / Bash / Git / MCP all work unchanged.
- **The agent language is a choice, not a given.** Node and Python are ready; the protocol makes any language a drop-in. Keep the frontend identical across languages.
- **Do not disrupt the existing app.** Integrate with minimal change via the iframe approach.
- **Security is mandatory.** Loopback-only bind, Origin allowlist, session token, working-directory scope. No public arbitrary-shell API (`references/security.md`).
- **Nothing goes to the cloud.** Neither Claude Code nor local files are sent externally. Even with a statically hosted frontend, all communication is handled solely by the Local Agent.

## Completion criteria

After generating/integrating, confirm:

- The Local Agent starts and `/health` returns `ok`.
- The terminal renders inside the web UI and accepts keyboard input.
- Claude Code output is displayed.
- Resize is reflected in the terminal.
- It auto-reconnects when the Local Agent restarts.
- All communication goes through the Local Agent (no cloud transfer).
- The frontend works even on static hosting (e.g. GitHub Pages).
- The existing app's structure is not significantly changed.

> Verify via the Local Agent's `/health` and the manual steps in `assets/docs-templates/setup.md`. Do not auto-launch a browser to check UI changes.
