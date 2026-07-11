# Step 1 — Analyze & choose

Inspect the target project and decide the **embedding method**, the **Local Agent language**, and the **placement**. Fix these as a one-line statement before touching anything (like fixing the "population and grain" before writing a query).

## What to inspect

1. **Integration root**: which directory to integrate into. If unclear, ask.
2. **`package.json`**: framework, dependencies, scripts (`dev`/`build`). If absent, treat as a Vanilla/static site.
3. **Package manager**: `package-lock.json`→npm / `yarn.lock`→yarn / `pnpm-lock.yaml`→pnpm / `bun.lockb`→bun.
4. **Framework**: React / Next / Vue / Nuxt / Svelte / Astro / Vite / Vanilla (see `references/project-analysis.md`).
5. **Static serve location**: `public/`, `static/`, `assets/`, output dir — somewhere to place the iframe HTML/JS.
6. **Entry / layout**: a shared layout where `embed.js` can be loaded once (`_app`, `layout`, `App.vue`, `index.html`, …).
7. **Static hosting?**: whether it deploys to something like GitHub Pages (frontend static, Local Agent stays local).

## What to decide (state in one line)

- **Embedding method**: default is **iframe** (framework-agnostic, least invasive). Use the React/Vue wrapper only when tight framework integration is explicitly wanted.
- **Local Agent language**: **first-class, up-front choice.**
  - `node` — Node 22+. Familiar to web devs; uses `ws` + `node-pty` (native build). Works on macOS, Linux, and Windows.
  - `python` — Python 3.11+ recommended. Stdlib `pty` + `websockets`; no native build. **macOS/Linux/Unix-like only** — not usable on Windows (no stdlib `pty`).
  - a **new language** (Go, Rust, Ruby, …) — implement `references/protocol.md` under `assets/local-agent/<lang>/`. Go/Rust give a single static binary and avoid native-build friction.
  - If the user has no preference: Node if the project is already Node-based or the target OS includes Windows; Python if they're on macOS/Linux and want to avoid native builds; suggest Go when a distributable single binary matters. Never default to Python if Windows support is needed — it will not run there.
- **Frontend placement**: a static-serve path (e.g. `public/claude-embed/`).
- **Local Agent placement**: `local-agent/` under the project (or anywhere outside it).
- **Port / origin**: default port `4820`. Whether to allowlist the Web UI origin (`http://localhost:5173`, `https://<user>.github.io`, …).

## Confirm, then proceed

Present the decision as "embedding = X, agent language = Y, frontend placement = Z, agent placement = W, origin = V". If the structure differs from expectations (monorepo, SSR-only with no shared layout, …), state your interpretation and get agreement before Step 2.
