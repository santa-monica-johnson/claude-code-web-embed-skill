'use strict';

// claude-launcher.js — ローカルにインストール済みの Claude Code CLI を
// そのまま起動するための仕様を組み立てる。Claude Code 自体は再実装しない。

const { execFileSync } = require('child_process');

// 可用性チェックはシェル spawn を伴うため短時間キャッシュする（/health のポーリング対策）。
const AVAILABILITY_TTL_MS = 5000;
const availabilityCache = new Map(); // command -> { value, at }

// Claude Code コマンドが PATH 上で利用可能か確認する（TTL 付きメモ化）。
function isClaudeAvailable(command) {
  const now = Date.now();
  const cached = availabilityCache.get(command);
  if (cached && now - cached.at < AVAILABILITY_TTL_MS) {
    return cached.value;
  }

  let value;
  try {
    if (process.platform === 'win32') {
      execFileSync('where', [command], { stdio: 'ignore' });
    } else {
      // command -v はシェル組み込み。sh 経由で実行する。
      execFileSync('/bin/sh', ['-c', `command -v ${escapeArg(command)}`], {
        stdio: 'ignore',
      });
    }
    value = true;
  } catch {
    value = false;
  }

  availabilityCache.set(command, { value, at: now });
  return value;
}

// シェルに渡すコマンド名をエスケープする（存在確認のみに使用）。
function escapeArg(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

// PTY 起動用のコマンド・引数・環境を構築する。
function buildLaunchSpec(config) {
  return {
    command: config.claudeCommand,
    args: config.claudeArgs,
    cwd: config.workingDir,
    env: Object.assign({}, process.env, {
      TERM: 'xterm-256color',
      // 端末幅に依存する装飾を Claude Code 側で有効化させる。
      COLORTERM: 'truecolor',
    }),
  };
}

module.exports = { isClaudeAvailable, buildLaunchSpec };
