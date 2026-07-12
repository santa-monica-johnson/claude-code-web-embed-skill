# Step 3 — Integrate & verify

Wire the embed into the existing UI in exactly one place, place the docs, and
confirm the completion criteria. Do not significantly change the existing app.

## Integration (one place, per method)

### iframe method (default)

Add this once to the shared layout / entry HTML:

```html
<script src="/claude-embed/embed.js"></script>
<script>
  ClaudeEmbed.init({
    iframeSrc: '/claude-embed/claude-terminal.html',
    agentUrl: 'ws://127.0.0.1:4820',
    token: window.__CLAUDE_AGENT_TOKEN__, // inject via server / build time in dev
  });
</script>
```

- Next.js: load in `pages/_app` or `app/layout` via `next/script`.
- Nuxt: in `app.vue` or a plugin.
- Astro: at the end of the shared layout `<body>`.
- Vanilla: just before `</body>` in `index.html`.

### React / Vue method

Place the `ClaudeTerminal` component and pass `iframeSrc` / `agentUrl` / `token`
(see the header comments in `assets/frontend/react|vue`).

## Passing the token

Inject the token into the frontend without putting it in the URL.

- Dev: embed it into a global from a server template or environment variable.
- The default `embed.js` passes the token to the iframe via `postMessage`, so it never appears in the URL query.

> For security, never put the token, local paths, or personal data in a URL query or an external request.

## Place the docs

Copy `assets/docs-templates/` (`README.md`, `architecture.md`, `setup.md`) into
the integration target (e.g. under `claude-embed/`). Adjust the port/paths and,
if relevant, note which agent implementation (node/python/go) was chosen.

## Verify (completion criteria)

Do not auto-launch a browser. Confirm:

1. Start the Local Agent and `curl -s http://127.0.0.1:4820/health` returns `{"status":"ok",...}`.
2. `claudeAvailable` is `true` (`claude` installed and logged in).
3. The integration lives in one place and does not break the existing build.
4. Walk the user through the manual checks in `setup.md` (render, input, output, resize, reconnect).

Use the "Completion criteria" in `SKILL.md` as the final checklist.
