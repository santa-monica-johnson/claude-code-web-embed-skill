# Step 2 — 生成・配置

`assets/` のテンプレートを対象プロジェクトへコピーし、プロジェクト固有の値だけを調整する。**コードは書き直さない。** 調整するのはポート・Origin・配信パスといった設定値のみ。

## 配置

Step 1 で決めた配置先へコピーする（例）。

```
<project>/
├── local-agent/                    ← assets/local-agent/ をコピー
│   ├── index.js server.js pty-manager.js claude-launcher.js security.js config.js
│   ├── package.json  .env.example
└── public/claude-embed/            ← assets/frontend/ の iframe 資産をコピー
    ├── claude-terminal.html
    ├── claude-terminal.css
    ├── claude-terminal.js
    └── embed.js
```

- **iframe 方式（既定）**: `claude-terminal.{html,css,js}` と `embed.js` を静的配信パスへ置く。
- **React**: `assets/frontend/react/ClaudeTerminal.jsx` をコンポーネントディレクトリへ。iframe 資産（`claude-terminal.*`）も静的配信パスへ置く（実体は iframe のため）。
- **Vue**: `assets/frontend/vue/ClaudeTerminal.vue` を同様に。

## 調整する値

| 対象 | 何を | どこで |
| --- | --- | --- |
| ポート | `4820` 以外にするなら | `.env`（`CLAUDE_AGENT_PORT`）と フロントの `agentUrl` |
| Origin | Web UI の Origin を許可 | `.env`（`CLAUDE_AGENT_ALLOWED_ORIGINS`） |
| 作業ディレクトリ | Claude を動かす場所 | `.env`（`CLAUDE_AGENT_CWD`）または起動時に指定 |
| 配信パス | `iframeSrc` の URL | 統合コード（Step 3） |

`.env.example` を `.env` にコピーして必要な値を埋める。トークンは未設定なら起動ごとに自動生成される（固定したいときのみ `CLAUDE_AGENT_TOKEN`）。

## 依存の導入

```bash
cd <project>/local-agent
<pm> install     # npm / yarn / pnpm / bun のいずれか（Step 1 で判定）
```

`node-pty` はネイティブビルドを伴う。失敗する場合は各 OS のビルドツール導入を案内する（`assets/docs-templates/README.md` のトラブルシューティング）。

## GitHub Pages など静的ホスティング

フロント資産（`claude-terminal.*`・`embed.js`）は静的配信でそのまま動く。Local Agent はユーザーの PC でローカル起動する前提。デプロイ先の Origin を `CLAUDE_AGENT_ALLOWED_ORIGINS` に追加する。
