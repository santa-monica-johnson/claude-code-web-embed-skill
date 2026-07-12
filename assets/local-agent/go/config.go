package main

// config.go — Local Agent の設定を環境変数（および任意の .env）から解決する。
// Node/Python 版と同じ環境変数名・既定値・.env 読み込み規則（既存の環境変数は上書きしない）。

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Host            string
	Port            int
	WorkingDir      string
	AllowedOrigins  []string
	SessionToken    string
	ClaudeCommand   string
	ClaudeArgs      []string
	MaxSessions     int
	SessionGraceMs  int
	ScrollbackChars int
}

// loadDotenv は .env を読み込み os.Setenv で反映する（既存の環境変数は尊重し上書きしない）。
func loadDotenv(dir string) {
	f, err := os.Open(filepath.Join(dir, ".env"))
	if err != nil {
		return // .env が無ければ何もしない
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.Index(line, "=")
		if eq == -1 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		value := strings.TrimSpace(line[eq+1:])
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, value)
		}
	}
}

func parseOrigins(value string) []string {
	if value == "" {
		return nil
	}
	var out []string
	for _, s := range strings.Split(value, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

func randomToken() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		panic(err) // crypto/rand の失敗はプロセス継続不能な環境異常
	}
	return hex.EncodeToString(buf)
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func loadConfig() Config {
	host := os.Getenv("CLAUDE_AGENT_HOST")
	if host == "" {
		host = "127.0.0.1"
	}

	port := envInt("CLAUDE_AGENT_PORT", 4820)

	cwd := os.Getenv("CLAUDE_AGENT_CWD")
	if cwd == "" {
		wd, err := os.Getwd()
		if err == nil {
			cwd = wd
		}
	}
	workingDir, err := filepath.Abs(cwd)
	if err != nil {
		workingDir = cwd
	}

	allowedOrigins := parseOrigins(os.Getenv("CLAUDE_AGENT_ALLOWED_ORIGINS"))

	sessionToken := os.Getenv("CLAUDE_AGENT_TOKEN")
	if sessionToken == "" {
		sessionToken = randomToken()
	}

	claudeCommand := os.Getenv("CLAUDE_AGENT_COMMAND")
	if claudeCommand == "" {
		claudeCommand = "claude"
	}

	var claudeArgs []string
	if raw := os.Getenv("CLAUDE_AGENT_ARGS"); raw != "" {
		for _, a := range strings.Split(raw, " ") {
			if a != "" {
				claudeArgs = append(claudeArgs, a)
			}
		}
	}

	return Config{
		Host:            host,
		Port:            port,
		WorkingDir:      workingDir,
		AllowedOrigins:  allowedOrigins,
		SessionToken:    sessionToken,
		ClaudeCommand:   claudeCommand,
		ClaudeArgs:      claudeArgs,
		MaxSessions:     envInt("CLAUDE_AGENT_MAX_SESSIONS", 4),
		SessionGraceMs:  envInt("CLAUDE_AGENT_SESSION_GRACE_MS", 120000),
		ScrollbackChars: envInt("CLAUDE_AGENT_SCROLLBACK_CHARS", 200000),
	}
}
