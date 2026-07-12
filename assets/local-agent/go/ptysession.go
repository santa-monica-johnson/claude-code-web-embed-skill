package main

// ptysession.go — 1 つの PTY セッション（＝1 つの Claude Code プロセス）を管理する。
// creack/pty により擬似端末上で子プロセスを起動する。ブラウザの WebSocket と
// 端末の間の橋渡しを担う。
//
// PTY の寿命は WebSocket 接続の寿命から切り離されている。Attach/Detach で
// 「現在どの WebSocket に出力を届けるか」を切り替えられるため、ブラウザの
// リロードや瞬断があっても Claude Code プロセス自体は生き続け、再接続時に
// 同じセッションへ再アタッチしてスクロールバックを復元できる（server.go 側で制御）。
//
// creack/pty の Start/StartWithSize は内部で setsid + TIOCSCTTY 相当の処理
// （SysProcAttr.Setsid / Setctty）を行うため、node-pty 同様、Python 版で必要だった
// 「制御端末を明示的に設定しないと SIGWINCH が届かない」問題への追加対応は不要。

import (
	"errors"
	"os"
	"os/exec"
	"sync"
	"syscall"

	"github.com/creack/pty"
)

type PtySession struct {
	Pid int

	cmd  *exec.Cmd
	ptmx *os.File

	mu              sync.Mutex
	currentConn     *wsConn
	closed          bool
	buffer          []byte
	scrollbackChars int

	exitCbMu      sync.Mutex
	exitCallbacks []func(exitCode int, signal string)
}

func newPtySession(spec launchSpec, cols, rows, scrollbackChars int) (*PtySession, error) {
	cmd := exec.Command(spec.command, spec.args...)
	cmd.Dir = spec.cwd
	cmd.Env = spec.env

	size := &pty.Winsize{
		Rows: uint16(sanitizeDim(rows, 24)),
		Cols: uint16(sanitizeDim(cols, 80)),
	}
	ptmx, err := pty.StartWithSize(cmd, size)
	if err != nil {
		return nil, err
	}

	s := &PtySession{
		Pid:             cmd.Process.Pid,
		cmd:             cmd,
		ptmx:            ptmx,
		scrollbackChars: scrollbackChars,
	}
	go s.readLoop()
	return s, nil
}

// readLoop は PTY の出力を読み続け、UTF-8 のマルチバイト境界がチャンクの継ぎ目で
// 分断されないよう、不完全な末尾バイト列は次回の読み取り分と結合してから配信する。
func (s *PtySession) readLoop() {
	buf := make([]byte, 65536)
	var pending []byte
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			chunk := append(pending, buf[:n]...)
			valid, remainder := splitValidUTF8(chunk)
			pending = append([]byte(nil), remainder...)
			if len(valid) > 0 {
				s.deliverOutput(valid)
			}
		}
		if err != nil {
			break
		}
	}
	// 終了時、不完全な末尾バイト列が残っていればそのまま(replace 相当なしで)流す。
	if len(pending) > 0 {
		s.deliverOutput(pending)
	}
	s.handleExit()
}

func (s *PtySession) deliverOutput(data []byte) {
	s.mu.Lock()
	s.appendBuffer(data)
	conn := s.currentConn
	s.mu.Unlock()
	if conn != nil {
		_ = conn.sendJSON(map[string]any{"type": "output", "data": string(data)})
	}
}

// appendBuffer は呼び出し側が mu を保持している前提。
func (s *PtySession) appendBuffer(data []byte) {
	s.buffer = append(s.buffer, data...)
	if len(s.buffer) > s.scrollbackChars {
		s.buffer = trimUTF8Prefix(s.buffer, s.scrollbackChars)
	}
}

// GetBuffer は再アタッチ時に画面を復元するための直近出力を返す。
func (s *PtySession) GetBuffer() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return string(s.buffer)
}

// Attach は conn を現在の出力先にする。既に別の conn がアタッチ中なら、
// 理由(replaced)を通知したうえで切断する（1 つの PTY に同時アタッチできるのは 1 接続のみ）。
func (s *PtySession) Attach(conn *wsConn) {
	s.mu.Lock()
	previous := s.currentConn
	s.currentConn = conn
	s.mu.Unlock()
	if previous != nil && previous != conn {
		_ = previous.sendJSON(map[string]any{"type": "status", "state": "replaced"})
		previous.close()
	}
}

// Detach は conn が現在の出力先であれば解除する（別の conn に奪われている場合は何もしない）。
func (s *PtySession) Detach(conn *wsConn) {
	s.mu.Lock()
	if s.currentConn == conn {
		s.currentConn = nil
	}
	s.mu.Unlock()
}

// CurrentConn は現在アタッチ中の接続を返す（無ければ nil）。
func (s *PtySession) CurrentConn() *wsConn {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.currentConn
}

func (s *PtySession) Write(data string) {
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		return
	}
	_, _ = s.ptmx.Write([]byte(data))
}

func (s *PtySession) Resize(cols, rows int) {
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		return
	}
	_ = pty.Setsize(s.ptmx, &pty.Winsize{
		Rows: uint16(sanitizeDim(rows, 24)),
		Cols: uint16(sanitizeDim(cols, 80)),
	})
}

// OnExit はプロセス終了時に呼ばれるコールバックを登録する。
func (s *PtySession) OnExit(cb func(exitCode int, signal string)) {
	s.exitCbMu.Lock()
	s.exitCallbacks = append(s.exitCallbacks, cb)
	s.exitCbMu.Unlock()
}

func (s *PtySession) handleExit() {
	err := s.cmd.Wait()
	exitCode := 0
	signal := ""
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		if ws, ok := exitErr.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
			signal = ws.Signal().String()
			exitCode = 128 + int(ws.Signal())
		} else {
			exitCode = exitErr.ExitCode()
		}
	}

	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()

	s.exitCbMu.Lock()
	cbs := make([]func(int, string), len(s.exitCallbacks))
	copy(cbs, s.exitCallbacks)
	s.exitCbMu.Unlock()
	for _, cb := range cbs {
		cb(exitCode, signal)
	}
}

// Close はプロセスグループ全体へ SIGTERM を送り、PTY マスタを閉じる。
// creack/pty が Start 時に Setsid しているため pid == pgid であり、負の PID を
// 使ったグループキル（Python 版の os.killpg 相当）が成立する。
// 猶予期間の満了時、およびエージェント自体のシャットダウン時に呼ばれる。
func (s *PtySession) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.mu.Unlock()

	_ = syscall.Kill(-s.Pid, syscall.SIGTERM)
	_ = s.ptmx.Close()
}

// --- ヘルパー ---

func sanitizeDim(value, fallback int) int {
	if value < 1 {
		return fallback
	}
	if value > 1000 {
		return 1000
	}
	return value
}

// splitValidUTF8 は data のうち安全に確定できる先頭部分(valid)と、末尾に残る
// 不完全な UTF-8 シーケンス(remainder, 最大 3 バイト)とに分割する。
func splitValidUTF8(data []byte) (valid []byte, remainder []byte) {
	n := len(data)
	if n == 0 {
		return data, nil
	}
	limit := 4
	if limit > n {
		limit = n
	}
	for i := 1; i <= limit; i++ {
		b := data[n-i]
		if b&0xC0 == 0x80 {
			continue // 継続バイト、さらに前へ
		}
		var need int
		switch {
		case b&0x80 == 0:
			need = 1
		case b&0xE0 == 0xC0:
			need = 2
		case b&0xF0 == 0xE0:
			need = 3
		case b&0xF8 == 0xF0:
			need = 4
		default:
			need = 1 // 不正な先頭バイト。分割対象にはしない。
		}
		if i < need {
			return data[:n-i], data[n-i:]
		}
		break
	}
	return data, nil
}

// trimUTF8Prefix は b の末尾 limit バイトを残して先頭を切り詰める際、
// マルチバイト文字の途中で切らないよう、切り詰め開始位置を継続バイトの手前まで戻す。
func trimUTF8Prefix(b []byte, limit int) []byte {
	if len(b) <= limit {
		return b
	}
	start := len(b) - limit
	for start < len(b) && b[start]&0xC0 == 0x80 {
		start++
	}
	return b[start:]
}
