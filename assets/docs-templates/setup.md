# Setup guide

Everything from first-time setup to verifying the connection.

## 1. Install Claude Code

Confirm that the Claude Code CLI is installed on this machine.

```bash
claude --version
```

If the command is not found, install Claude Code ([claude.com/claude-code](https://claude.com/claude-code)).

## 2. Log in to Claude Code

```bash
claude
```

The first run triggers an authentication flow. Confirm you are logged in, then exit.

> Tip: if you want to run a shell command yourself during this session, prefix it with `!` (e.g. `! claude`); it runs on the spot and its output is pulled into the conversation.

## 3. Start the Local Agent

Run the implementation you chose.

**Node:**
```bash
cd claude-embed/local-agent/node
npm install            # first time only (builds node-pty)
CLAUDE_AGENT_CWD="/path/to/your/project" npm start
```

**Python:**
```bash
cd claude-embed/local-agent/python
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt   # first time only
CLAUDE_AGENT_CWD="/path/to/your/project" python3 agent.py
```

**Go:**
```bash
cd claude-embed/local-agent/go
go build -o claude-local-agent .   # first time only
CLAUDE_AGENT_CWD="/path/to/your/project" ./claude-local-agent
```

On startup you'll see output like this:

```
──────────────────────────────────────────────
 Claude Code Local Agent
──────────────────────────────────────────────
 HTTP      : http://127.0.0.1:4820
 WebSocket : ws://127.0.0.1:4820/terminal
 Work dir  : /path/to/your/project
 Claude    : available
 Session token (set this in the frontend):
   3f9a...(truncated)
──────────────────────────────────────────────
```

Note the **session token** shown. To fix it, set `CLAUDE_AGENT_TOKEN` in `.env`.

## 4. Start the Web UI

Start your existing app the usual way (example):

```bash
npm run dev
```

If you use `embed.js`, pass the token to the frontend. During development, injecting it via an environment variable is the simplest option.

```html
<script src="/claude-embed/embed.js"></script>
<script>
  ClaudeEmbed.init({
    iframeSrc: '/claude-embed/claude-terminal.html',
    agentUrl: 'ws://127.0.0.1:4820',
    token: window.__CLAUDE_AGENT_TOKEN__, // injected at build time / by the server
  });
</script>
```

## 5. Verify the connection

1. Open the web app.
2. A "Claude Code" panel appears at the bottom of the screen.
3. The status in the header shows "connected".
4. Type something like `help` and confirm Claude Code responds.
5. Resize the window or the panel and confirm the terminal follows.
6. Restart the Local Agent and confirm the panel reconnects automatically.

## If something goes wrong

- Status stays "unconfigured" → check that `agentUrl` / `token` reach the frontend.
- `401` → check that the token matches the value in the startup log.
- `403` → add the Web UI's origin to `CLAUDE_AGENT_ALLOWED_ORIGINS`.
- "Failed to launch Claude Code" → re-check steps 1 and 2.

See the troubleshooting section in `README.md` for details.
