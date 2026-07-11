'use strict';

// server.js — HTTP（ヘルスチェック／状態取得）と WebSocket（端末 I/O）を提供する。
// リアルタイム通信はすべて WebSocket で行い、端末セッションは接続ごとに生成する。

const http = require('http');
const { WebSocketServer } = require('ws');
const { isOriginAllowed, safeCompare } = require('./security');
const { PtySession } = require('./pty-manager');
const { buildLaunchSpec, isClaudeAvailable } = require('./claude-launcher');

function createServer(config) {
  const sessions = new Map(); // ws -> PtySession

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
        activeSessions: sessions.size,
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
        activeSessions: sessions.size,
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

    if (sessions.size >= config.maxSessions) {
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

    const spec = buildLaunchSpec(config);
    let session;
    try {
      session = new PtySession(Object.assign({}, spec, { cols, rows }));
    } catch (err) {
      sendMsg(ws, {
        type: 'error',
        message: `Claude Code の起動に失敗しました: ${err.message}`,
      });
      try {
        ws.close();
      } catch {
        /* noop */
      }
      return;
    }
    sessions.set(ws, session);

    sendMsg(ws, { type: 'status', state: 'connected', pid: session.pid });

    session.onData((data) => {
      sendMsg(ws, { type: 'output', data });
    });

    session.onExit(({ exitCode, signal }) => {
      sendMsg(ws, { type: 'exit', exitCode, signal });
      try {
        ws.close();
      } catch {
        /* noop */
      }
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // 不正な JSON は無視する。
      }
      switch (msg.type) {
        case 'input':
          if (typeof msg.data === 'string') session.write(msg.data);
          break;
        case 'resize':
          session.resize(msg.cols, msg.rows);
          break;
        case 'ping':
          sendMsg(ws, { type: 'pong' });
          break;
        default:
          break;
      }
    });

    const cleanup = () => {
      session.kill();
      sessions.delete(ws);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  return { httpServer, wss, sessions };
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
