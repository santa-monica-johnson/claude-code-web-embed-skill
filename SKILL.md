---
name: claude-code-web-embed
description: 既存の Web インターフェースへ、ローカルで動作する Claude Code をそのまま統合する汎用スキル。Claude Code CLI は再実装せず、PC にインストール済みのものを Local Agent（WebSocket + PTY）経由で Web UI の xterm.js ターミナルに橋渡しする。「Web アプリに Claude Code のターミナルを埋め込みたい」「サイトに Claude Code を統合したい」「ブラウザから Claude Code を動かしたい」「Local Agent と埋め込みターミナルを生成して」というときに使う。React/Next/Vue/Nuxt/Svelte/Astro/Vite/Vanilla、および GitHub Pages など静的ホスティングに対応。iframe 方式が既定。
---

# claude-code-web-embed（既存 Web への Claude Code 統合）

**ローカルにインストール済みの Claude Code CLI を、既存の Web UI に埋め込む。** Claude Code は変更も再実装もしない。この PC の `claude` をそのまま PTY 上で起動し、WebSocket で xterm.js ターミナルへ中継する。

```
既存 Web UI（xterm.js ターミナル / iframe）
        │ WebSocket
        ▼
Local Agent（WebSocket + PTY + セキュリティ）   ← このスキルが生成
        │
        ▼
Claude Code CLI（既存・そのまま）
```

## このスキルが生成するもの

- **Local Agent**（`assets/local-agent/`）: WebSocket サーバ・PTY 管理・Claude 起動・セキュリティ。
- **Frontend**（`assets/frontend/`）: xterm.js ターミナル（iframe）・埋め込みスクリプト・接続状態 UI・React/Vue ラッパー。
- **ドキュメント**（`assets/docs-templates/`）: README / architecture / setup。

これらは**完成済みのテンプレート資産**である。スキルの仕事は、対象プロジェクトを解析し、これらを適切な場所へ配置し、既存 UI へ最小変更で組み込むこと。**ゼロから書き直さない**（毎回同じコードを再生成しない）。

## 進め方（3 ステップ）

作業前に必ず対象プロジェクトのルートを確認する（どこに統合するのか）。曖昧なら統合先ディレクトリをユーザーに一言確認してから進める。

### Step 1 — プロジェクト解析　`steps/step1-analyze.md`

`package.json`・使用フレームワーク・パッケージマネージャー・レイアウト構造・静的公開の有無を調べ、**埋め込み方式（iframe / React / Vue）** と **配置先** を決める。判断を一文で明示してから次へ進む。

### Step 2 — 生成・配置　`steps/step2-scaffold.md`

`assets/` のテンプレートを対象プロジェクトへコピーする（既定の配置先は `public/claude-embed/` または静的配信可能な場所 + `local-agent/`）。プロジェクト固有の値（ポート・Origin・配信パス）だけを調整する。

### Step 3 — 統合・検証　`steps/step3-integrate.md`

既存 UI へ埋め込みを 1 箇所組み込む（iframe 既定なら `embed.js` の読み込み + `ClaudeEmbed.init`）。ドキュメントを配置し、**完了条件**（下記）を確認する。

## 参照

- `references/project-analysis.md` — フレームワーク別の配置先・注入方法の早見表。
- `references/security.md` — セキュリティ要件と検証観点（localhost 限定・Origin・トークン・作業ディレクトリ）。
- `assets/docs-templates/architecture.md` — 設計判断（PTY / WebSocket / iframe の採用理由）。

## 原則

- **Claude Code を再実装しない。** 既存 CLI を PTY 起動するだけ。Thinking / Tool Use / Slash Commands / Permission ダイアログ / Bash / Git / MCP はそのまま使える。
- **既存アプリの構成を大きく変えない。** iframe 方式で最小侵襲に統合する。
- **セキュリティは必須。** localhost 限定・Origin 制限・セッショントークン・作業ディレクトリ限定を外さない。任意 Shell 実行の公開 API は作らない（`references/security.md`）。
- **クラウドへ送らない。** Claude Code もローカルファイルも外部送信しない。フロントを静的公開しても通信は Local Agent のみが担う。

## 完了条件

生成・統合後、以下を満たすことを確認する。

- Local Agent が起動し、`/health` が `ok` を返す。
- Web UI 内にターミナルが表示され、キーボード入力ができる。
- Claude Code の出力が表示される。
- リサイズが端末に反映される。
- Local Agent 再起動時に自動再接続する。
- すべての通信が Local Agent 経由である（クラウド送信なし）。
- 静的ホスティング環境（GitHub Pages 等）でもフロントが動作する構成である。
- 既存アプリの構成を大きく変更していない。

> UI の変更後にブラウザを自動で開いて確認しない。動作確認は Local Agent の `/health` と、ユーザーによる手動確認（`assets/docs-templates/setup.md` の手順）に委ねる。
