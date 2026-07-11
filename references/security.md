# Security requirements

The Local Agent launches your local Claude Code on a PTY. It effectively opens
powerful local access to the web UI, so the following are **mandatory** and must
not be removed — regardless of the implementation language.

## Mandatory requirements

1. **Loopback-only bind**
   - Default `127.0.0.1`. Never bind to a public network.
   - If `CLAUDE_AGENT_HOST` is changed, the agent warns on a non-loopback bind.

2. **Origin restriction (CSRF / DNS-rebinding defense for browsers)**
   - If `CLAUDE_AGENT_ALLOWED_ORIGINS` is set, allow only listed origins.
   - If unset, allow only `localhost` / `127.0.0.1` / `::1` origins.
   - A missing `Origin` header (non-browser local client) is allowed — it is not a CSRF vector.

3. **Session token (the real authorization)**
   - Required on every WebSocket connection; mismatch → `401`.
   - Compare in **constant time** (e.g. `crypto.timingSafeEqual` / `secrets.compare_digest`; length mismatch → immediate false) to resist timing attacks.
   - Randomly generated per start by default; fix with `CLAUDE_AGENT_TOKEN`.

4. **Working-directory scoping**
   - Claude Code launches in `CLAUDE_AGENT_CWD` (default: the agent's cwd).
   - Do not make an unexpectedly broad tree the working target; scope it to the use case.

5. **Child-process management**
   - Kill the PTY process reliably when the WebSocket closes (kill the process group).
   - On shutdown, disconnect all connections and terminate PTYs.
   - Bound runaway usage with a concurrent-session cap (`CLAUDE_AGENT_MAX_SESSIONS`).

6. **No arbitrary-shell API**
   - Provide only "launch Claude Code on a PTY and relay".
   - Never add a general command-execution endpoint.

## Handling of information

- Never put the token, local paths, or personal data in a URL query or an external request.
  - The default `embed.js` passes the token to the iframe via `postMessage`, keeping it out of the URL.
- Never send Claude Code I/O or local files to the cloud.
- Do not persist the token beyond the startup log (exclude it if log collection is in place).

## Review checklist

After generating or changing an implementation, verify at least the following
(use the `code-review` skill):

- Both Origin and token are validated before upgrade.
- Token comparison is constant-time.
- The PTY is killed on socket close and on error (no leaks).
- External input (terminal dimensions, etc.) is sanitized to integers within range.
- The default bind is loopback.
