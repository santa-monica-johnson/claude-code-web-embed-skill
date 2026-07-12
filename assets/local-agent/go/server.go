package main

// server.go — HTTP（ヘルスチェック／状態取得）と WebSocket（端末 I/O）を提供する。
// リアルタイム通信はすべて WebSocket で行う。
//
// PTY セッションは「session id」で管理し、WebSocket 接続の寿命から独立させている。
// 切断後もセッションはしばらく（sessionGraceMs）生存し、同じ session id で
// 再接続すればプロセスを再起動せず再アタッチする（ブラウザのリロード・瞬断に強い）。
// 猶予時間内に再接続がなければ PTY を終了し、リソースを解放する。

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// wsConn は *websocket.Conn を書き込み用ミューテックスで包む。
// gorilla/websocket は「1 接続につき同時に 1 goroutine だけが書き込む」制約があり、
// PtySession からの出力配信と、このファイル内でのステータス送信が競合し得るため。
type wsConn struct {
	ws      *websocket.Conn
	writeMu sync.Mutex
}

func (c *wsConn) sendJSON(v any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.ws.WriteJSON(v)
}

func (c *wsConn) close() {
	_ = c.ws.Close()
}

type sessionEntry struct {
	pty        *PtySession
	graceTimer *time.Timer
}

type Server struct {
	config Config

	sessionsMu sync.Mutex
	sessions   map[string]*sessionEntry

	upgrader websocket.Upgrader
	mux      *http.ServeMux
}

func newServer(cfg Config) *Server {
	s := &Server{
		config:   cfg,
		sessions: make(map[string]*sessionEntry),
		upgrader: websocket.Upgrader{
			// Origin はここに来る前に isOriginAllowed で検証済みのため無条件許可する。
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
	s.mux = http.NewServeMux()
	s.mux.HandleFunc("/health", s.handleHealth)
	s.mux.HandleFunc("/status", s.handleStatus)
	s.mux.HandleFunc("/terminal", s.handleTerminal)
	return s
}

func (s *Server) activeSessionCount() int {
	s.sessionsMu.Lock()
	defer s.sessionsMu.Unlock()
	return len(s.sessions)
}

func generateSessionID() string {
	buf := make([]byte, 12)
	_, _ = rand.Read(buf)
	return "sess-" + hex.EncodeToString(buf)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin != "" && isOriginAllowed(origin, s.config.AllowedOrigins) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	s.mux.ServeHTTP(w, r)
}

func sendJSONResponse(w http.ResponseWriter, status int, body map[string]any) {
	payload, _ := json.Marshal(body)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		sendJSONResponse(w, 404, map[string]any{"error": "not_found"})
		return
	}
	sendJSONResponse(w, 200, map[string]any{
		"status":          "ok",
		"claudeAvailable": isClaudeAvailable(s.config.ClaudeCommand),
		"activeSessions":  s.activeSessionCount(),
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		sendJSONResponse(w, 404, map[string]any{"error": "not_found"})
		return
	}
	sendJSONResponse(w, 200, map[string]any{
		"status":          "ok",
		"host":            s.config.Host,
		"port":            s.config.Port,
		"workingDir":      s.config.WorkingDir,
		"maxSessions":     s.config.MaxSessions,
		"activeSessions":  s.activeSessionCount(),
		"claudeAvailable": isClaudeAvailable(s.config.ClaudeCommand),
	})
}

func clampInt(raw string, fallback, min, max int) int {
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

// handleTerminal は /terminal への WebSocket アップグレードを扱う。
// アップグレード前に Origin・トークン・セッション上限を検証してから WS を確立する。
func (s *Server) handleTerminal(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if !isOriginAllowed(origin, s.config.AllowedOrigins) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	q := r.URL.Query()
	token := q.Get("token")
	if token == "" || !safeCompare(token, s.config.SessionToken) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	requestedID := sanitizeSessionID(q.Get("session"))

	s.sessionsMu.Lock()
	_, willReattach := s.sessions[requestedID]
	willReattach = willReattach && requestedID != ""
	activeCount := len(s.sessions)
	s.sessionsMu.Unlock()

	if !willReattach && activeCount >= s.config.MaxSessions {
		http.Error(w, "Service Unavailable", http.StatusServiceUnavailable)
		return
	}

	cols := clampInt(q.Get("cols"), 80, 1, 1000)
	rows := clampInt(q.Get("rows"), 24, 1, 1000)

	rawConn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade 自体が失敗した場合、既にエラーレスポンスは書かれている
	}
	conn := &wsConn{ws: rawConn}

	id := requestedID
	if id == "" {
		id = generateSessionID()
	}

	s.sessionsMu.Lock()
	entry, existing := s.sessions[id]
	s.sessionsMu.Unlock()

	var ptySession *PtySession

	if existing {
		// 再接続: 既存 PTY（＝既存の claude プロセス）にアタッチし直す。
		if entry.graceTimer != nil {
			entry.graceTimer.Stop()
			entry.graceTimer = nil
		}
		ptySession = entry.pty
		// Attach が「別接続が既にアタッチ中なら replaced 通知して切断」まで面倒を見る。
		ptySession.Attach(conn)
		_ = conn.sendJSON(map[string]any{
			"type":      "status",
			"state":     "connected",
			"pid":       ptySession.Pid,
			"sessionId": id,
			"resumed":   true,
		})
		if buffered := ptySession.GetBuffer(); buffered != "" {
			_ = conn.sendJSON(map[string]any{"type": "output", "data": buffered})
		}
		ptySession.Resize(cols, rows)
	} else {
		spec := buildLaunchSpec(s.config)
		var err error
		ptySession, err = newPtySession(spec, cols, rows, s.config.ScrollbackChars)
		if err != nil {
			_ = conn.sendJSON(map[string]any{"type": "error", "message": "Failed to launch Claude Code: " + err.Error()})
			conn.close()
			return
		}

		newEntry := &sessionEntry{pty: ptySession}
		s.sessionsMu.Lock()
		s.sessions[id] = newEntry
		s.sessionsMu.Unlock()

		ptySession.Attach(conn)
		_ = conn.sendJSON(map[string]any{
			"type":      "status",
			"state":     "connected",
			"pid":       ptySession.Pid,
			"sessionId": id,
			"resumed":   false,
		})

		sessionID := id
		ptySession.OnExit(func(exitCode int, signal string) {
			if cur := ptySession.CurrentConn(); cur != nil {
				var sig any
				if signal != "" {
					sig = signal
				}
				_ = cur.sendJSON(map[string]any{"type": "exit", "exitCode": exitCode, "signal": sig})
				cur.close()
			}
			s.sessionsMu.Lock()
			if e, ok := s.sessions[sessionID]; ok {
				if e.graceTimer != nil {
					e.graceTimer.Stop()
				}
				delete(s.sessions, sessionID)
			}
			s.sessionsMu.Unlock()
		})
	}

	s.wireSocket(conn, ptySession, id)
}

// wireSocket は conn からの input/resize/ping を PTY セッションへ中継し、
// 切断時にクリーンアップ（detach・猶予タイマーの起動）を行う。
func (s *Server) wireSocket(conn *wsConn, ptySession *PtySession, id string) {
	defer s.cleanupConn(conn, ptySession, id)

	for {
		_, raw, err := conn.ws.ReadMessage()
		if err != nil {
			return
		}
		var msg map[string]any
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue // 不正な JSON は無視する
		}
		switch msg["type"] {
		case "input":
			if data, ok := msg["data"].(string); ok {
				ptySession.Write(data)
			}
		case "resize":
			cols := numField(msg["cols"], 80)
			rows := numField(msg["rows"], 24)
			ptySession.Resize(cols, rows)
		case "ping":
			_ = conn.sendJSON(map[string]any{"type": "pong"})
		}
	}
}

func numField(v any, fallback int) int {
	f, ok := v.(float64) // encoding/json は数値を float64 として Unmarshal する
	if !ok {
		return fallback
	}
	return int(f)
}

// cleanupConn は ws の message ループ終了（close/error）時に呼ばれる。
// 新規作成・再接続どちらの経路からも wireSocket 経由で呼ばれる。
func (s *Server) cleanupConn(conn *wsConn, ptySession *PtySession, id string) {
	ptySession.Detach(conn)

	s.sessionsMu.Lock()
	_, ok := s.sessions[id]
	s.sessionsMu.Unlock()
	if !ok {
		return // 既に exit 等で削除済み
	}

	// takeover（別接続が同じ session に先に再接続 → こちらは Attach() 経由で
	// close された）の場合、Detach() は自分が currentConn でなければ no-op になる。
	// その場合 ptySession.CurrentConn() には新しい接続が入ったままなので、ここで猶予
	// タイマーを仕掛けると、後から「使用中のセッション」を誤って kill してしまう。
	// 本当に誰もアタッチしていない時だけ猶予を開始する。
	if ptySession.CurrentConn() != nil {
		return
	}

	graceDuration := time.Duration(s.config.SessionGraceMs) * time.Millisecond
	s.sessionsMu.Lock()
	// ロック解放後から今までの間に他 goroutine が同じ entry を操作している可能性があるため、
	// 再度存在確認してからタイマーを設定する。
	if entry, ok := s.sessions[id]; ok {
		entry.graceTimer = time.AfterFunc(graceDuration, func() {
			ptySession.Close()
			s.sessionsMu.Lock()
			delete(s.sessions, id)
			s.sessionsMu.Unlock()
		})
	}
	s.sessionsMu.Unlock()
}

// killAllSessions はシャットダウン時など、猶予を待たず全セッションを即終了する。
func (s *Server) killAllSessions() {
	s.sessionsMu.Lock()
	entries := make([]*sessionEntry, 0, len(s.sessions))
	for _, e := range s.sessions {
		entries = append(entries, e)
	}
	s.sessions = make(map[string]*sessionEntry)
	s.sessionsMu.Unlock()

	for _, e := range entries {
		if e.graceTimer != nil {
			e.graceTimer.Stop()
		}
		e.pty.Close()
	}
}
