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
const { httpServer, wss } = createServer(config);

httpServer.listen(config.port, config.host, () => {
  const base = `http://${config.host}:${config.port}`;
  const line = '──────────────────────────────────────────────';
  console.log(line);
  console.log(' Claude Code Local Agent');
  console.log(line);
  console.log(` HTTP      : ${base}`);
  console.log(` WebSocket : ws://${config.host}:${config.port}/terminal`);
  console.log(` 作業Dir   : ${config.workingDir}`);
  console.log(
    ` Claude    : ${
      isClaudeAvailable(config.claudeCommand)
        ? '利用可能'
        : '未検出（要インストール / ログイン）'
    }`
  );
  if (!isLoopbackHost(config.host)) {
    console.log(
      ' 警告      : localhost 以外にバインドしています。公開ネットワークで使用しないでください。'
    );
  }
  console.log('');
  console.log(' セッショントークン（フロントエンドに設定してください）:');
  console.log(`   ${config.sessionToken}`);
  console.log(line);
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `ポート ${config.port} は既に使用されています。CLAUDE_AGENT_PORT で変更してください。`
    );
  } else {
    console.error('サーバ起動エラー:', err.message);
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nシャットダウンします...');
  // 接続中の WebSocket を切断（各 PTY は close ハンドラで kill される）。
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
