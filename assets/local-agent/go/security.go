package main

// security.go — 接続の検証を担う。
// 二重の関門: (1) Origin 許可リスト（ブラウザ経由の CSRF / DNS リバインディング対策）
//            (2) セッショントークン（真の認可）。

import (
	"crypto/subtle"
	"net/url"
	"regexp"
)

// isLoopbackHost はバインド先が loopback かどうかを判定する（設定検証のヒントに使う）。
func isLoopbackHost(host string) bool {
	return host == "127.0.0.1" || host == "::1" || host == "localhost"
}

// safeCompare は定数時間でのトークン比較。長さが違えば即 false。
func safeCompare(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// isOriginAllowed は Origin ヘッダを検証する。
//   - Origin ヘッダ無し（ブラウザ以外のローカルクライアント）は許可。CSRF の経路にならないため。
//   - allowedOrigins 指定時はそのリストに一致した場合のみ許可。
//   - 未指定時は localhost / 127.0.0.1 / ::1 の Origin のみ許可。
func isOriginAllowed(origin string, allowedOrigins []string) bool {
	if origin == "" {
		return true
	}
	if len(allowedOrigins) > 0 {
		for _, o := range allowedOrigins {
			if o == origin {
				return true
			}
		}
		return false
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "127.0.0.1" || host == "::1" || host == "localhost"
}

// sessionIdPattern はクライアント指定の再接続 ID の形式検証。
// これは認可情報ではない（token が引き続き必須）。単に PTY 再アタッチ先を選ぶ
// キーなので、想定外の形式・長さ（DoS/メモリ膨張の芽）だけ弾く。
var sessionIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func sanitizeSessionID(raw string) string {
	if sessionIDPattern.MatchString(raw) {
		return raw
	}
	return ""
}
