'use strict';

// pty-manager.js — 1 つの PTY セッション（＝1 つの Claude Code プロセス）を管理する。
// node-pty により擬似端末上で子プロセスを起動する。ブラウザの WebSocket と
// 端末の間の橋渡しを担う。
//
// PTY の寿命は WebSocket 接続の寿命から切り離されている。attach/detach で
// 「現在どの WebSocket に出力を届けるか」を切り替えられるため、ブラウザの
// リロードや瞬断があっても Claude Code プロセス自体は生き続け、再接続時に
// 同じセッションへ再アタッチしてスクロールバックを復元できる（server.js 側で制御）。

const pty = require('node-pty');

class PtySession {
  constructor({ command, args = [], cwd, env, cols = 80, rows = 24, scrollbackChars = 200000 }) {
    this.proc = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: sanitizeDim(cols, 80),
      rows: sanitizeDim(rows, 24),
      cwd,
      env,
    });
    this.pid = this.proc.pid;
    this._exited = false;
    this.currentWs = null; // 現在アタッチされている WebSocket（null = 誰もアタッチしていない）
    this._scrollbackChars = scrollbackChars;
    this._buffer = '';
  }

  // ws を「現在の出力先」にする。既に別の ws がアタッチ中なら、それを切断する
  // （1 つの PTY に同時にアタッチできるのは 1 接続のみ。tmux の attach と同様）。
  attach(ws) {
    if (this.currentWs && this.currentWs !== ws) {
      try {
        this.currentWs.close();
      } catch {
        /* noop */
      }
    }
    this.currentWs = ws;
  }

  // ws が現在の出力先であれば解除する（別の ws に奪われている場合は何もしない）。
  detach(ws) {
    if (this.currentWs === ws) this.currentWs = null;
  }

  onData(cb) {
    this.proc.onData((data) => {
      this._appendBuffer(data);
      cb(data);
    });
  }

  onExit(cb) {
    this.proc.onExit((e) => {
      this._exited = true;
      cb(e);
    });
  }

  _appendBuffer(data) {
    this._buffer += data;
    const limit = this._scrollbackChars;
    if (this._buffer.length > limit) {
      this._buffer = this._buffer.slice(this._buffer.length - limit);
    }
  }

  // 再アタッチ時に画面を復元するための直近出力（ANSI 込みの生バイト列相当）。
  getBuffer() {
    return this._buffer;
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
