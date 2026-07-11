# Step 3 — 統合・検証

既存 UI へ埋め込みを 1 箇所だけ組み込み、ドキュメントを配置し、完了条件を確認する。既存アプリの構成は大きく変えない。

## 統合（方式別に 1 箇所）

### iframe 方式（既定）

共通レイアウト／エントリ HTML に次を 1 箇所だけ追加する。

```html
<script src="/claude-embed/embed.js"></script>
<script>
  ClaudeEmbed.init({
    iframeSrc: '/claude-embed/claude-terminal.html',
    agentUrl: 'ws://127.0.0.1:4820',
    token: window.__CLAUDE_AGENT_TOKEN__, // 開発時はサーバ／ビルド時に注入
  });
</script>
```

- Next.js: `pages/_app` か `app/layout` に `next/script` で読み込む。
- Nuxt: `app.vue` か plugin で読み込む。
- Astro: 共通レイアウトの `<body>` 末尾に。
- Vanilla: `index.html` の `</body>` 直前に。

### React / Vue 方式

`ClaudeTerminal` コンポーネントを任意の場所に配置し、`iframeSrc`・`agentUrl`・`token` を渡す（`assets/frontend/react|vue` のヘッダコメント参照）。

## トークンの渡し方

トークンは URL に載せず、フロントへ安全に注入する。

- 開発時: サーバ側テンプレートや環境変数からグローバル変数へ埋め込む。
- 既定の `embed.js` は `postMessage` で iframe へ渡すため、URL クエリにトークンは出ない。

> セキュリティ上、トークン・ローカルパス・個人データを URL クエリや外部リクエストに載せない。

## ドキュメント配置

`assets/docs-templates/` の `README.md`・`architecture.md`・`setup.md` を統合先（例: `claude-embed/` 直下）へコピーする。プロジェクト固有のポート・パスに合わせて微調整する。

## 検証（完了条件）

ブラウザを自動で開いて確認しない。次を確認する。

1. Local Agent を起動し、`curl -s http://127.0.0.1:4820/health` が `{"status":"ok",...}` を返す。
2. `claudeAvailable` が `true`（`claude` がインストール・ログイン済み）。
3. 統合コードが 1 箇所に入り、既存構成を壊していない（ビルドが通る）。
4. `setup.md` の手動確認手順をユーザーに案内する（表示・入力・出力・リサイズ・再接続）。

`SKILL.md` の「完了条件」を最終チェックリストとして用いる。
