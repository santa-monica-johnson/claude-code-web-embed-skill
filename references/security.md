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
   - **`file://` pages**: a browser opening the frontend directly as a local file (e.g. double-clicking `index.html`) sends the literal `Origin: null` header, not an empty header. Because `"null"` fails URL parsing, it is **rejected by default** (`403`) even though it looks like a "local" page. To support this, add the literal string `null` to `CLAUDE_AGENT_ALLOWED_ORIGINS` — but note that setting this variable at all switches the allowlist from "auto-allow localhost family" to "explicit matches only", so also re-list any `http://localhost:PORT` origins you still need (e.g. `CLAUDE_AGENT_ALLOWED_ORIGINS=null,http://localhost:8000`). Also note `null` cannot be scoped to "this one file" — every `file://` page on the machine serializes to the same `null` origin, so allowing it means *any* local HTML file (not just yours) can attempt to connect (the session token is still required, so this doesn't grant access without it, but it does widen who can *try*).

3. **Session token (the real authorization)**
   - Required on every WebSocket connection; mismatch → `401`.
   - Compare in **constant time** (e.g. `crypto.timingSafeEqual` / `secrets.compare_digest`; length mismatch → immediate false) to resist timing attacks.
   - Randomly generated per start by default; fix with `CLAUDE_AGENT_TOKEN`.
   - The optional `session` reconnection id (see `protocol.md`) is **not** a credential — it only selects which PTY to reattach to. It must never bypass the token check above; validate its format (`^[A-Za-z0-9_-]{1,128}$`) to keep it from being used as a memory-exhaustion vector, nothing more.

4. **Working-directory scoping**
   - Claude Code launches in `CLAUDE_AGENT_CWD` (default: the agent's cwd).
   - Do not make an unexpectedly broad tree the working target; scope it to the use case.

5. **Child-process management**
   - Kill the PTY process reliably when the WebSocket closes **and the reattachment grace period elapses** (`CLAUDE_AGENT_SESSION_GRACE_MS`) with nobody reattached — see `protocol.md` for the reattachment design. A closed socket must not leave the process running forever.
   - On shutdown, kill all PTYs immediately, bypassing any pending grace-period timers.
   - Bound runaway usage with a concurrent-session cap (`CLAUDE_AGENT_MAX_SESSIONS`); reattaching to an existing session must not consume additional capacity.

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
- The PTY is eventually killed after socket close (once the grace period elapses) and on error (no leaks), and unconditionally on agent shutdown.
- External input (terminal dimensions, session id, etc.) is sanitized/bounded.
- The default bind is loopback.
- A "takeover" (second connection reattaching to an in-use session) does not let the displaced connection's own cleanup schedule a kill for the session that is still actively attached elsewhere.
