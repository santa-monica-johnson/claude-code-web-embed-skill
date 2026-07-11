# Claude Code Web Embed Skill

既存の Web インターフェースへ、**ローカルで動作する Claude Code をそのまま統合する** Claude Code スキル。Claude Code CLI は変更・再実装せず、PC にインストール済みのものを **Local Agent（WebSocket + PTY）** 経由で Web UI の xterm.js ターミナルに橋渡しする。

```
既存 Web UI（xterm.js / iframe）
        │ WebSocket
        ▼
Local Agent（WebSocket + PTY + セキュリティ）
        │
        ▼
Claude Code CLI（既存・そのまま）
```

## これは何か

このリポジトリは 1 つの Claude Code スキル（`SKILL.md`）と、その生成物となる**完成済みテンプレート資産**をまとめたもの。スキルを起動すると、対象プロジェクトを解析し、テンプレートを配置し、既存 UI へ最小変更で統合する。

## リポジトリ構成

```
.
├── SKILL.md                     # スキル本体（オーケストレーター）
├── steps/                       # 3 ステップの手順
│   ├── step1-analyze.md         #   プロジェクト解析
│   ├── step2-scaffold.md        #   生成・配置
│   └── step3-integrate.md       #   統合・検証
├── references/                  # 判断材料
│   ├── project-analysis.md      #   フレームワーク別 早見表
│   └── security.md              #   セキュリティ要件
└── assets/                      # そのまま配置するテンプレート
    ├── local-agent/             #   Local Agent（Node.js / ws / node-pty）
    ├── frontend/                #   xterm.js ターミナル + embed.js + React/Vue ラッパー
    └── docs-templates/          #   統合先に置く README / architecture / setup
```

## スキルとして使う

### インストール（`~/.claude/skills/` へ配置）

```bash
# シンボリックリンク（このリポジトリを編集しながら使う場合）
ln -s "$(pwd)" ~/.claude/skills/claude-code-web-embed

# またはコピー
cp -R "$(pwd)" ~/.claude/skills/claude-code-web-embed
```

### 起動

Claude Code のセッションで次のように依頼する（あるいは `/claude-code-web-embed`）。

> このプロジェクトの Web UI に Claude Code のターミナルを埋め込んで

スキルが Step 1〜3 を進め、`assets/` を対象プロジェクトへ配置・統合する。

## 生成物の使い方

配置後の使い方・セットアップ・設計は、統合先に置かれる `assets/docs-templates/`（README / setup / architecture）を参照。要点:

- Node.js 18+ と、ログイン済みの `claude` CLI が必要。
- `local-agent/` で `npm install && npm start`。起動ログのトークンをフロントへ設定。
- iframe 方式が既定。React/Next/Vue/Nuxt/Svelte/Astro/Vite/Vanilla、GitHub Pages 等の静的ホスティングに対応。

## セキュリティ

localhost 限定バインド・Origin 制限・セッショントークン・作業ディレクトリ限定・子プロセス管理を必須とし、任意 Shell 実行の公開 API は提供しない。Claude Code もローカルファイルもクラウドへ送信しない。詳細は `references/security.md`。

## 対応環境

- **フロント**: React / Next.js / Vue / Nuxt / Svelte / Astro / Vite / Vanilla JS
- **バックエンド**: 不問（統合するのはフロントと Local Agent のみ）
- **ホスティング**: 静的ホスティング（GitHub Pages 等）でもフロントは動作。Claude との通信はローカルの Local Agent のみが担う。
