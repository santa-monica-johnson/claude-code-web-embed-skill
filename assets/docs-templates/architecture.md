# アーキテクチャ

開発者向けの設計資料。Claude Code Web Embed の構成・通信フロー・設計判断をまとめる。

## システム構成

```
┌──────────────────────────────┐
│ 既存 Web インターフェース       │
│  ┌────────────────────────┐  │
│  │ Claude Code Terminal     │  │  ← xterm.js（iframe）
│  └────────────────────────┘  │
└──────────────┬───────────────┘
               │ WebSocket（入力 / 出力 / リサイズ / 状態）
               ▼
┌──────────────────────────────┐
│ Local Agent                   │
│  • HTTP Server（health/status）│
│  • WebSocket Server            │
│  • PTY Manager                 │
│  • Claude Launcher             │
│  • Security（Origin/Token/cwd）│
└──────────────┬───────────────┘
               │ 擬似端末（PTY）
               ▼
         Claude Code CLI（既存）
```

## コンポーネントの責務

### Web Interface（frontend/）

- `claude-terminal.html` / `.js` / `.css`: iframe 内で動く端末本体。xterm.js を初期化し、Local Agent と WebSocket 接続する。
- `embed.js`: 既存ページに読み込むフレームワーク非依存スクリプト。下部ドックパネル・操作 UI・iframe を生成し、`postMessage` で iframe を制御する。
- `react/`, `vue/`: 各フレームワーク向けの薄いラッパー（実体は iframe）。

### Local Agent（local-agent/）

- `index.js`: エントリ。設定読込とサーバ起動、シャットダウン処理。
- `server.js`: HTTP（`/health`, `/status`）と WebSocket（`/terminal`）を提供。接続ごとに PTY セッションを生成。
- `pty-manager.js`: node-pty による PTY セッションの生成・入出力・リサイズ・終了。
- `claude-launcher.js`: Claude Code の起動仕様（コマンド・引数・環境）を構築、可用性確認。
- `security.js`: Origin 検証・トークン定数時間比較。
- `config.js`: 環境変数 / `.env` からの設定解決。

## 通信フロー

1. ブラウザが `embed.js` を読み込み、下部パネルと iframe を生成する。
2. iframe 読込後、親が `postMessage` で `agentUrl` と `token` を渡す。
3. iframe が `ws://127.0.0.1:PORT/terminal?token=...&cols=..&rows=..` へ WebSocket 接続する。
4. Local Agent は upgrade 時に Origin・トークン・セッション上限を検証する。
5. 検証通過後、PTY 上で Claude Code を起動し、双方向に中継する。
   - Client → Server: `{type:'input'|'resize'|'ping'}`
   - Server → Client: `{type:'output'|'exit'|'error'|'status'|'pong'}`
6. WebSocket が閉じると PTY プロセスを終了する。

## 設計判断

### なぜ PTY か

Claude Code は対話的なターミナル UI（Thinking 表示・Permission ダイアログ・カラー・カーソル制御）を持つ。通常のパイプではこれらが失われるため、擬似端末（PTY）で起動して本来の UI・操作性を維持する。

### なぜ WebSocket か

端末は低遅延の双方向ストリームを要する。HTTP のリクエスト／レスポンスでは逐次出力とキー入力を扱いにくいため、リアルタイム通信は WebSocket に集約する。HTTP はヘルスチェックと状態取得のみに用いる。

### なぜ iframe を既定にするか

フレームワーク非依存で、静的ホスティング（GitHub Pages 等）でもそのまま動く。既存アプリの構成を大きく変えずに統合できる。React / Vue が必要な場合は同梱ラッパーを使う。

## セキュリティ設計

二重の関門で保護する。

1. **Origin 許可リスト**: ブラウザ由来の CSRF / DNS リバインディングを防ぐ。未指定時は localhost 系のみ許可。
2. **セッショントークン**: 真の認可。定数時間比較で検証する。

加えて、localhost バインド・作業ディレクトリ限定・同時セッション上限・任意 Shell 実行 API の非提供により攻撃面を最小化する。

## 拡張ポイント

- `config.js`: 設定項目の追加。
- `server.js`: 新しい HTTP エンドポイントや WebSocket メッセージ種別の追加。
- `claude-launcher.js`: 起動コマンド・引数・環境のカスタマイズ。
- `embed.js`: パネルの配置（右ドック等）やテーマの拡張。
