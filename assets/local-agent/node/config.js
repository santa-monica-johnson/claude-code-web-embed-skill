'use strict';

// config.js — Local Agent の設定を環境変数（および任意の .env）から解決する。
// 依存を増やさないため、.env は最小パーサで読み込む（既存の環境変数は上書きしない）。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// .env を読み込んで process.env に反映する（既存値は尊重）。
function loadDotenv(dir) {
  const file = path.join(dir, '.env');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return; // .env が無ければ何もしない
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 前後のクォートを外す
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseOrigins(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadConfig(env = process.env) {
  const host = env.CLAUDE_AGENT_HOST || '127.0.0.1';
  const port = Number.parseInt(env.CLAUDE_AGENT_PORT || '4820', 10) || 4820;

  // Claude Code を起動する作業ディレクトリ。既定はエージェントの cwd。
  const workingDir = path.resolve(env.CLAUDE_AGENT_CWD || process.cwd());

  // Origin 許可リスト。空なら localhost 系のみ許可（security.js 側で判定）。
  const allowedOrigins = parseOrigins(env.CLAUDE_AGENT_ALLOWED_ORIGINS);

  // セッショントークン。未指定なら起動ごとにランダム生成。
  const sessionToken =
    env.CLAUDE_AGENT_TOKEN || crypto.randomBytes(32).toString('hex');

  // Claude Code の起動コマンドと引数。
  const claudeCommand = env.CLAUDE_AGENT_COMMAND || 'claude';
  const claudeArgs = env.CLAUDE_AGENT_ARGS
    ? env.CLAUDE_AGENT_ARGS.split(' ').filter(Boolean)
    : [];

  // 同時セッション上限。
  const maxSessions =
    Number.parseInt(env.CLAUDE_AGENT_MAX_SESSIONS || '4', 10) || 4;

  return {
    host,
    port,
    workingDir,
    allowedOrigins,
    sessionToken,
    claudeCommand,
    claudeArgs,
    maxSessions,
  };
}

module.exports = { loadConfig, loadDotenv, parseOrigins };
