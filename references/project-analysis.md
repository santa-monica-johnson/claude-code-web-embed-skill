# Framework quick-reference

For quickly deciding Step 1's analysis and Step 3's integration point. **The
default is always the iframe method.** Use the React/Vue wrappers only when tight
coupling is clearly needed. The Local Agent language (node/python/…) is chosen
separately and is independent of the frontend framework.

## Detection

| Signal | Framework | Static serve dir | Where to load `embed.js` |
| --- | --- | --- | --- |
| `next.config.*` | Next.js | `public/` | `pages/_app.tsx` or `app/layout.tsx` (`next/script`) |
| `react` + Vite | React (Vite) | `public/` | `src/main.tsx` or `index.html` |
| `nuxt.config.*` | Nuxt | `public/` (v3) / `static/` (v2) | `app.vue` or a plugin |
| `vue` + Vite | Vue (Vite) | `public/` | `src/main.ts` or `index.html` |
| `svelte.config.*` | SvelteKit | `static/` | `src/routes/+layout.svelte` |
| `astro.config.*` | Astro | `public/` | end of the shared layout `<body>` |
| `vite.config.*` only | Vite (Vanilla) | `public/` | `index.html` |
| no `package.json` | static site | root / anywhere | just before `</body>` in `index.html` |

## Package manager

| Lockfile | Commands |
| --- | --- |
| `package-lock.json` | `npm install` / `npm run` |
| `yarn.lock` | `yarn` / `yarn` |
| `pnpm-lock.yaml` | `pnpm install` / `pnpm` |
| `bun.lockb` | `bun install` / `bun run` |

## Placement principles

- The iframe assets (`claude-terminal.{html,css,js}`) form a unit that **works with plain relative references**. Put them together in one static-serve directory (e.g. `public/claude-embed/`).
- Put `embed.js` in the same directory and load it once from the host page.
- Even when using the React/Vue wrapper, the iframe assets are still needed on the static serve path (the implementation is the iframe).
- The Local Agent is not part of the static bundle. It runs locally on the user's machine. Its language (node/python/…) does not affect the frontend.

## Static hosting (GitHub Pages, etc.)

- Frontend assets work as-is on static hosting.
- `agentUrl` is `ws://127.0.0.1:4820` (the user's local agent), not the deploy URL.
- Add the deploy origin (`https://<user>.github.io`, …) to `CLAUDE_AGENT_ALLOWED_ORIGINS`.
- For a sub-path deploy with a base path, set `iframeSrc` including that base.
