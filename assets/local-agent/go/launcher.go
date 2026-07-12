package main

// launcher.go — ローカルにインストール済みの Claude Code CLI をそのまま起動するための
// 仕様を組み立てる。Claude Code 自体は再実装しない。

import (
	"os"
	"os/exec"
	"sync"
	"time"
)

// 可用性チェックはシェル探索を伴うため短時間キャッシュする（/health のポーリング対策）。
const availabilityTTL = 5 * time.Second

type availabilityCacheEntry struct {
	value bool
	at    time.Time
}

var (
	availabilityMu    sync.Mutex
	availabilityCache = map[string]availabilityCacheEntry{}
)

// isClaudeAvailable は Claude Code コマンドが PATH 上で利用可能か確認する（TTL 付きメモ化）。
func isClaudeAvailable(command string) bool {
	now := time.Now()

	availabilityMu.Lock()
	if cached, ok := availabilityCache[command]; ok && now.Sub(cached.at) < availabilityTTL {
		availabilityMu.Unlock()
		return cached.value
	}
	availabilityMu.Unlock()

	_, err := exec.LookPath(command)
	value := err == nil

	availabilityMu.Lock()
	availabilityCache[command] = availabilityCacheEntry{value: value, at: now}
	availabilityMu.Unlock()

	return value
}

// launchSpec は PTY 起動用のコマンド・引数・作業ディレクトリ・環境を保持する。
type launchSpec struct {
	command string
	args    []string
	cwd     string
	env     []string
}

// buildLaunchSpec は設定から起動仕様を組み立てる。
func buildLaunchSpec(cfg Config) launchSpec {
	env := append(os.Environ(),
		"TERM=xterm-256color",
		// 端末幅に依存する装飾を Claude Code 側で有効化させる。
		"COLORTERM=truecolor",
	)
	return launchSpec{
		command: cfg.ClaudeCommand,
		args:    cfg.ClaudeArgs,
		cwd:     cfg.WorkingDir,
		env:     env,
	}
}
