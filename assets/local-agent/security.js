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

module.exports = { safeCompare, isLoopbackHost, isOriginAllowed };
