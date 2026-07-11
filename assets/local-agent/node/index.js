#!/usr/bin/env node
'use strict';

// index.js — Local Agent のエントリポイント。
// 設定を読み込み、HTTP + WebSocket サーバを localhost で起動する。

const { loadConfig, loadDotenv } = require('./config');
const { createServer } = require('./server');
const { isClaudeAvailable } = require('./claude-launcher');
const { isLoopbackHost } = require('./security');

// エージェントのディレクトリにある .env を読み込む（既存の環境変数は上書きしない）。
loadDotenv(__dirname);

const config = loadConfig();
const { httpServer, wss, killAllSessions } = createServer(config);

httpServer.listen(config.port, config.host, () => {
  const base = `http://${config.host}:${config.port}`;
  const line = '──────────────────────────────────────────────';
  console.log(line);
  console.log(' Claude Code Local Agent');
  console.log(line);
  console.log(` HTTP      : ${base}`);
  console.log(` WebSocket : ws://${config.host}:${config.port}/terminal`);
  console.log(` Work dir  : ${config.workingDir}`);
  console.log(
    ` Claude    : ${
      isClaudeAvailable(config.claudeCommand)
        ? 'available'
        : 'not found (install / log in required)'
    }`
  );
  if (!isLoopbackHost(config.host)) {
    console.log(
      ' Warning   : bound to a non-localhost address. Do not use on a public network.'
    );
  }
  console.log('');
  console.log(' Session token (set this in the frontend):');
  console.log(`   ${config.sessionToken}`);
  console.log(line);
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${config.port} is already in use. Change it with CLAUDE_AGENT_PORT.`
    );
  } else {
    console.error('Server startup error:', err.message);
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down...');
  // 猶予期間を待たず、生存中の全 PTY(claude プロセス)を即終了する。
  // このプロセス自体が終わるため、猶予後の再アタッチは起こり得ない。
  killAllSessions();
  for (const client of wss.clients) {
    try {
      client.terminate();
    } catch {
      /* noop */
    }
  }
  httpServer.close(() => process.exit(0));
  // フォールバック: 一定時間で強制終了。
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
