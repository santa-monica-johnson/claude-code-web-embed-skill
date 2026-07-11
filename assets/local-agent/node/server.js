'use strict';

// server.js — HTTP（ヘルスチェック／状態取得）と WebSocket（端末 I/O）を提供する。
// リアルタイム通信はすべて WebSocket で行う。
//
// PTY セッションは「session id」で管理し、WebSocket 接続の寿命から独立させている。
// 切断後もセッションはしばらく（sessionGraceMs）生存し、同じ session id で
// 再接続すればプロセスを再起動せず再アタッチする（ブラウザのリロード・瞬断に強い）。
// 猶予時間内に再接続がなければ PTY を終了し、リソースを解放する。

const crypto = require('crypto');
const http = require('http');
const { WebSocketServer } = require('ws');
const { isOriginAllowed, safeCompare, sanitizeSessionId } = require('./security');
const { PtySession } = require('./pty-manager');
const { buildLaunchSpec, isClaudeAvailable } = require('./claude-launcher');

function createServer(config) {
  const sessions = new Map(); // sessionId -> { pty: PtySession, graceTimer: Timeout|null }

  function activeSessionCount() {
    return sessions.size;
  }

  function generateSessionId() {
    return 'sess-' + crypto.randomBytes(12).toString('hex');
  }

  const httpServer = http.createServer((req, res) => {
    const origin = req.headers.origin;
    // localhost 系 / 許可済み Origin にのみ CORS を返す（ブラウザからの health 取得用）。
    if (origin && isOriginAllowed(origin, config.allowedOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
    } catch {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        claudeAvailable: isClaudeAvailable(config.claudeCommand),
        activeSessions: activeSessionCount(),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      sendJson(res, 200, {
        status: 'ok',
        host: config.host,
        port: config.port,
        workingDir: config.workingDir,
        maxSessions: config.maxSessions,
        activeSessions: activeSessionCount(),
        claudeAvailable: isClaudeAvailable(config.claudeCommand),
      });
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  });

  const wss = new WebSocketServer({ noServer: true });

  // アップグレード時に Origin / トークン / セッション上限を検証してから WS を確立する。
  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== '/terminal') {
      socket.destroy();
      return;
    }

    if (!isOriginAllowed(req.headers.origin, config.allowedOrigins)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    if (!token || !safeCompare(token, config.sessionToken)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // 既存セッションへの再接続は新規プロセスを作らないため、上限カウントには含めない。
    const requestedId = sanitizeSessionId(url.searchParams.get('session'));
    const willReattach = requestedId && sessions.has(requestedId);
    if (!willReattach && activeSessionCount() >= config.maxSessions) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, url);
    });
  });

  wss.on('connection', (ws, req, url) => {
    const cols = clampInt(url.searchParams.get('cols'), 80, 1, 1000);
    const rows = clampInt(url.searchParams.get('rows'), 24, 1, 1000);

    const requestedId = sanitizeSessionId(url.searchParams.get('session'));
    const id = requestedId || generateSessionId();
    const existing = sessions.get(id);

    if (existing) {
      // 再接続: 既存 PTY（＝既存の claude プロセス）にアタッチし直す。
      if (existing.graceTimer) {
        clearTimeout(existing.graceTimer);
        existing.graceTimer = null;
      }
      // 別タブ等が既にアタッチ中なら、切断される側へ理由を通知する
      // （通知なしだと、切断された側が自動再接続を試み、奪い合いの無限ループになりうる）。
      if (existing.pty.currentWs && existing.pty.currentWs !== ws) {
        sendMsg(existing.pty.currentWs, { type: 'status', state: 'replaced' });
      }
      existing.pty.attach(ws);
      sendMsg(ws, {
        type: 'status',
        state: 'connected',
        pid: existing.pty.pid,
        sessionId: id,
        resumed: true,
      });
      // 直近の出力を再送して画面を復元してから、以降はライブ中継に合流する。
      const buffered = existing.pty.getBuffer();
      if (buffered) sendMsg(ws, { type: 'output', data: buffered });
      existing.pty.resize(cols, rows);
      wireSocket(ws, existing.pty, id);
      return;
    }

    const spec = buildLaunchSpec(config);
    let pty;
    try {
      pty = new PtySession(
        Object.assign({}, spec, { cols, rows, scrollbackChars: config.scrollbackChars })
      );
    } catch (err) {
      sendMsg(ws, { type: 'error', message: `Failed to launch Claude Code: ${err.message}` });
      try {
        ws.close();
      } catch {
        /* noop */
      }
      return;
    }

    const entry = { pty, graceTimer: null };
    sessions.set(id, entry);
    pty.attach(ws);
    sendMsg(ws, { type: 'status', state: 'connected', pid: pty.pid, sessionId: id, resumed: false });

    pty.onData((data) => {
      if (pty.currentWs) sendMsg(pty.currentWs, { type: 'output', data });
    });

    pty.onExit(({ exitCode, signal }) => {
      if (pty.currentWs) sendMsg(pty.currentWs, { type: 'exit', exitCode, signal });
      if (entry.graceTimer) clearTimeout(entry.graceTimer);
      sessions.delete(id);
      try {
        if (pty.currentWs) pty.currentWs.close();
      } catch {
        /* noop */
      }
    });

    wireSocket(ws, pty, id);
  });

  // ws の message/close/error 配線。新規作成・再接続どちらの経路からも呼ばれる。
  function wireSocket(ws, pty, id) {
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // 不正な JSON は無視する。
      }
      switch (msg.type) {
        case 'input':
          if (typeof msg.data === 'string') pty.write(msg.data);
          break;
        case 'resize':
          pty.resize(msg.cols, msg.rows);
          break;
        case 'ping':
          sendMsg(ws, { type: 'pong' });
          break;
        default:
          break;
      }
    });

    const cleanup = () => {
      pty.detach(ws);
      const entry = sessions.get(id);
      if (!entry) return; // 既に exit 等で削除済み
      // takeover（別タブが同じ session に先に再接続 → こちらは attach() 経由で
      // close された）の場合、detach() は自分が currentWs でなければ no-op になる。
      // その場合 pty.currentWs には新しい接続が入ったままなので、ここで猶予タイマーを
      // 仕掛けると、後から「使用中のセッション」を誤って kill してしまう。
      // 本当に誰もアタッチしていない時だけ猶予を開始する。
      if (entry.pty.currentWs) return;
      entry.graceTimer = setTimeout(() => {
        entry.pty.kill();
        sessions.delete(id);
      }, config.sessionGraceMs);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  }

  // シャットダウン時など、猶予を待たず全セッションを即終了する。
  function killAllSessions() {
    for (const entry of sessions.values()) {
      if (entry.graceTimer) clearTimeout(entry.graceTimer);
      entry.pty.kill();
    }
    sessions.clear();
  }

  return { httpServer, wss, sessions, killAllSessions };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendMsg(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

module.exports = { createServer };
