'use strict';

// security.js — 接続の検証を担う。
// 二重の関門: (1) Origin 許可リスト（ブラウザ経由の CSRF / DNS リバインディング対策）
//            (2) セッショントークン（真の認可）。

const crypto = require('crypto');

// 定数時間でのトークン比較。長さが違えば即 false。
function safeCompare(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// バインド先が loopback か。設定検証のヒントに使う。
function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

// Origin 検証。
// - Origin ヘッダ無し（ブラウザ以外のローカルクライアント）は許可。CSRF の経路にならないため。
// - allowedOrigins 指定時はそのリストに一致した場合のみ許可。
// - 未指定時は localhost / 127.0.0.1 / ::1 の Origin のみ許可。
function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;

  if (allowedOrigins && allowedOrigins.length > 0) {
    return allowedOrigins.includes(origin);
  }

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname;
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

// クライアントが指定するセッション再接続 ID の形式検証。
// これは認可情報ではない（token が引き続き必須）。単に PTY 再アタッチ先を選ぶ
// キーなので、想定外の形式・長さ（DoS/メモリ膨張の芽）だけ弾く。
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
function sanitizeSessionId(raw) {
  return typeof raw === 'string' && SESSION_ID_PATTERN.test(raw) ? raw : null;
}

module.exports = { safeCompare, isLoopbackHost, isOriginAllowed, sanitizeSessionId };
