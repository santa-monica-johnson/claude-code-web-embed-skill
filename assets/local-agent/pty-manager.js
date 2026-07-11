'use strict';

// pty-manager.js — 1 つの PTY セッション（＝1 つの Claude Code プロセス）を管理する。
// node-pty により擬似端末上で子プロセスを起動する。ブラウザの WebSocket と
// 端末の間の橋渡しを担う。

const pty = require('node-pty');

class PtySession {
  constructor({ command, args = [], cwd, env, cols = 80, rows = 24 }) {
    this.proc = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: sanitizeDim(cols, 80),
      rows: sanitizeDim(rows, 24),
      cwd,
      env,
    });
    this.pid = this.proc.pid;
    this._exited = false;
  }

  onData(cb) {
    this.proc.onData(cb);
  }

  onExit(cb) {
    this.proc.onExit((e) => {
      this._exited = true;
      cb(e);
    });
  }

  write(data) {
    if (this._exited) return;
    this.proc.write(data);
  }

  resize(cols, rows) {
    if (this._exited) return;
    const c = sanitizeDim(cols, 80);
    const r = sanitizeDim(rows, 24);
    try {
      this.proc.resize(c, r);
    } catch {
      // 既に終了間際などでのリサイズ失敗は致命的でないため無視する。
    }
  }

  kill(signal) {
    if (this._exited) return;
    try {
      this.proc.kill(signal);
    } catch {
      // 既に終了している場合など。
    }
  }
}

// 端末サイズを安全な整数に丸める。
function sanitizeDim(value, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 1000);
}

module.exports = { PtySession };
