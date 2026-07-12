// Command claude-local-agent は Local Agent のエントリポイント。
// 設定を読み込み、HTTP + WebSocket サーバを localhost で起動する。
package main

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	exeDir := "."
	if exePath, err := os.Executable(); err == nil {
		exeDir = filepath.Dir(exePath)
	}
	// エージェントのディレクトリにある .env を読み込む（既存の環境変数は上書きしない）。
	loadDotenv(exeDir)
	// go run 実行時など、カレントディレクトリに .env がある場合にも対応する。
	if wd, err := os.Getwd(); err == nil && wd != exeDir {
		loadDotenv(wd)
	}

	cfg := loadConfig()
	srv := newServer(cfg)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	httpServer := &http.Server{Addr: addr, Handler: srv}

	line := "──────────────────────────────────────────────"
	fmt.Println(line)
	fmt.Println(" Claude Code Local Agent (Go)")
	fmt.Println(line)
	fmt.Printf(" HTTP      : http://%s\n", addr)
	fmt.Printf(" WebSocket : ws://%s/terminal\n", addr)
	fmt.Printf(" Work dir  : %s\n", cfg.WorkingDir)
	if isClaudeAvailable(cfg.ClaudeCommand) {
		fmt.Println(" Claude    : available")
	} else {
		fmt.Println(" Claude    : not found (install / log in required)")
	}
	if !isLoopbackHost(cfg.Host) {
		fmt.Println(" Warning   : bound to a non-localhost address. Do not use on a public network.")
	}
	fmt.Println("")
	fmt.Println(" Session token (set this in the frontend):")
	fmt.Printf("   %s\n", cfg.SessionToken)
	fmt.Println(line)

	serveErr := make(chan error, 1)
	go func() {
		err := httpServer.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serveErr:
		if errors.Is(err, syscall.EADDRINUSE) {
			fmt.Fprintf(os.Stderr, "Port %d is already in use. Change it with CLAUDE_AGENT_PORT.\n", cfg.Port)
		} else {
			fmt.Fprintln(os.Stderr, "Server startup error:", err)
		}
		os.Exit(1)
	case <-sigCh:
		fmt.Println("\nShutting down...")
		// 猶予期間を待たず、生存中の全 PTY(claude プロセス)を即終了する。
		// このプロセス自体が終わるため、猶予後の再アタッチは起こり得ない。
		srv.killAllSessions()
		done := make(chan struct{})
		go func() {
			_ = httpServer.Close()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
	}
}
