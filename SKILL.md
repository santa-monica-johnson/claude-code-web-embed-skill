---
name: claude-code-web-embed
description: Integrate a locally running Claude Code into an existing web interface. The Claude Code CLI is not reimplemented — the copy installed on the user's machine is bridged to a terminal frontend (xterm.js, inside an iframe or framework wrapper) in the web UI through a Local Agent (WebSocket + PTY). Use when the user wants to "embed a Claude Code terminal in a web app", "integrate Claude Code into a site", "run Claude Code from the browser", or "generate a Local Agent and embedded terminal". The Local Agent language is selectable up front (Node.js 22+ or Python 3.11+ ship ready-made; any language can be added via the protocol). Works with React/Next/Vue/Nuxt/Svelte/Astro/Vite/Vanilla, and can be deployed on static hosting (e.g. GitHub Pages) subject to the visitor's browser and their own local Local Agent. The iframe approach is the default.
---

# claude-code-web-embed (embed Claude Code into an existing web app)

**Embed the locally installed Claude Code CLI into an existing web UI.** Claude Code is neither modified nor reimplemented — the machine's `claude` is launched on a PTY and relayed over WebSocket to an xterm.js terminal.

```
Existing web UI
  └─ iframe or framework wrapper
       └─ Terminal Frontend (xterm.js)
              │ WebSocket  (language-neutral JSON protocol)
              ▼
Local Agent (WebSocket + PTY + security)   ← this skill scaffolds it; language is selectable
              │
              ▼
Claude Code CLI (existing, as-is)
```

## What this skill produces

- **Local Agent** (`assets/local-agent/`): pick one implementation — **`node/`** (Node 22+; also the only option on Windows) or **`python/`** (Python 3.11+; Unix/macOS/Linux only — its stdlib `pty` module doesn't exist on Windows). Both speak the same protocol (`references/protocol.md`). Any other language (Go, Rust, …) can be added via the porting guide.
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
- **No cloud relay of our own.** The web UI ↔ Local Agent bridge stays on the user's machine; this skill doesn't proxy terminal traffic, repo contents, or credentials through any cloud service it operates. Claude Code itself still talks to whatever model provider it's configured to use (normally Anthropic) as part of its ordinary operation — that's expected and outside this skill's scope, not something to hide or contradict in generated docs.

## Completion criteria

After generating/integrating, confirm:

- The Local Agent starts and `/health` returns `ok`.
- The terminal renders inside the web UI and accepts keyboard input.
- Claude Code output is displayed.
- Resize is reflected in the terminal.
- It auto-reconnects when the Local Agent restarts.
- Reloading the page (or a brief network drop) reattaches to the same running Claude Code session (via the `session` id in `sessionStorage`) instead of restarting it, within the configured grace period.
- The web UI ↔ Local Agent bridge goes through no cloud relay of this project's own (Claude Code's own traffic to its configured model provider is separate and expected).
- If the frontend is statically hosted (e.g. GitHub Pages), it still works for a visitor who has their own Local Agent running locally, subject to the browser's Origin/local-network permission behavior — see `references/security.md`.
- The existing app's structure is not significantly changed.

> Verify via the Local Agent's `/health` and the manual steps in `assets/docs-templates/setup.md`. Do not auto-launch a browser to check UI changes.
