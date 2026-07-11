# Claude Code Web Embed

このディレクトリには、既存の Web インターフェースへ**ローカルで動作する Claude Code** を統合するための一式が含まれる。Claude Code 自体は変更・再実装せず、この PC にインストール済みの CLI をそのまま利用する。

## 概要

```
Web UI（xterm.js ターミナル）
        │ WebSocket
        ▼
Local Agent（WebSocket + PTY）
        │
        ▼
Claude Code CLI（既存）
```

Web UI は Local Agent に WebSocket で接続し、Local Agent が擬似端末（PTY）上で Claude Code を起動する。Claude Code の出力・入力・リサイズはすべて WebSocket を介して中継される。

## 必要環境

- Node.js 18 以上
- ローカルにインストール済みの Claude Code CLI（`claude` コマンド）
- Claude Code へのログイン済み状態

## インストール

```bash
cd claude-embed/local-agent
npm install
```

`node-pty` はネイティブモジュールのため、環境によってはビルドツール（macOS: Xcode Command Line Tools、Linux: build-essential/python3、Windows: windows-build-tools）が必要になる。

## 起動

```bash
# Local Agent を起動（作業ディレクトリを指定可能）
cd claude-embed/local-agent
CLAUDE_AGENT_CWD="/path/to/your/project" npm start
```

起動ログに表示される**セッショントークン**をフロントエンドに設定する。Web UI 側は既存アプリの起動方法に従う（`setup.md` 参照）。

## 利用方法

1. Local Agent を起動する。
2. 既存 Web アプリを開く。画面下部に Claude Code ターミナルパネルが表示される。
3. パネル内でキーボード入力すると、ローカルの Claude Code が応答する。
4. ヘッダの操作で 開閉 / 再接続 / 全画面 が行える。

## 設定

Local Agent は `.env`（または環境変数）で設定する。`.env.example` を参照。

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `CLAUDE_AGENT_HOST` | `127.0.0.1` | 待ち受けホスト（localhost 固定を推奨） |
| `CLAUDE_AGENT_PORT` | `4820` | 待ち受けポート |
| `CLAUDE_AGENT_CWD` | エージェントの cwd | Claude Code の作業ディレクトリ |
| `CLAUDE_AGENT_ALLOWED_ORIGINS` | localhost 系 | 許可 Origin（カンマ区切り） |
| `CLAUDE_AGENT_TOKEN` | ランダム生成 | セッショントークン |
| `CLAUDE_AGENT_COMMAND` | `claude` | 起動コマンド |
| `CLAUDE_AGENT_MAX_SESSIONS` | `4` | 同時セッション上限 |

## セキュリティ

- Local Agent は既定で **localhost のみ**待ち受ける。
- ブラウザ経由の接続は **Origin 許可リスト**で制限する。
- すべての WebSocket 接続は**セッショントークン**を必須とする。
- Claude Code は**指定した作業ディレクトリ**で起動する。
- 任意の Shell を実行する公開 API は提供しない。

Claude Code やローカルファイルをクラウドへ送信することはない。GitHub Pages などにフロントエンドを静的ホスティングしても、Claude Code との通信はローカルの Local Agent のみが担当する。

## 対応フレームワーク

iframe 方式のため React / Next.js / Vue / Nuxt / Svelte / Astro / Vite / Vanilla JS のいずれでも利用できる。React / Vue 向けの薄いコンポーネントラッパーも同梱する。

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| 「未設定」のまま接続しない | フロントエンドに `agentUrl` と `token` が渡っているか確認 |
| `401 Unauthorized` | トークンが起動ログの値と一致しているか確認 |
| `403 Forbidden` | `CLAUDE_AGENT_ALLOWED_ORIGINS` に Web UI の Origin を追加 |
| 「Claude Code の起動に失敗」 | `claude` が PATH にあり、ログイン済みか確認 |
| ポート使用中エラー | `CLAUDE_AGENT_PORT` を変更 |
| `node-pty` のビルド失敗 | ビルドツールを導入して `npm install` を再実行 |
| `posix_spawnp failed.`（macOS） | 同梱 `spawn-helper` が実行権を失っている。`chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper`（ビルド版なら `build/Release/spawn-helper`）を付与して再実行 |

詳細は `setup.md`、設計は `architecture.md` を参照。
