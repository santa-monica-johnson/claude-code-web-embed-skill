# フレームワーク別 早見表

Step 1 の判定と Step 3 の統合先を素早く決めるための対応表。**既定は常に iframe 方式**。React/Vue ラッパーは密結合が明確に必要なときだけ。

## 判定

| 手掛かり | フレームワーク | 静的配信先 | `embed.js` 読み込み位置 |
| --- | --- | --- | --- |
| `next.config.*` | Next.js | `public/` | `pages/_app.tsx` または `app/layout.tsx`（`next/script`） |
| `react` + Vite | React (Vite) | `public/` | `src/main.tsx` か `index.html` |
| `nuxt.config.*` | Nuxt | `public/`（v3）/`static/`（v2） | `app.vue` またはプラグイン |
| `vue` + Vite | Vue (Vite) | `public/` | `src/main.ts` か `index.html` |
| `svelte.config.*` | SvelteKit | `static/` | `src/routes/+layout.svelte` |
| `astro.config.*` | Astro | `public/` | 共通レイアウトの `<body>` 末尾 |
| `vite.config.*` のみ | Vite (Vanilla) | `public/` | `index.html` |
| `package.json` 無し | 静的サイト | ルート／任意 | `index.html` の `</body>` 直前 |

## パッケージマネージャー

| ロックファイル | コマンド |
| --- | --- |
| `package-lock.json` | `npm install` / `npm run` |
| `yarn.lock` | `yarn` / `yarn` |
| `pnpm-lock.yaml` | `pnpm install` / `pnpm` |
| `bun.lockb` | `bun install` / `bun run` |

## 配置の原則

- iframe 資産（`claude-terminal.{html,css,js}`）は**そのままの相対参照で動く**単位。静的配信先の 1 ディレクトリ（例 `public/claude-embed/`）にまとめて置く。
- `embed.js` は同じディレクトリに置き、ホストページから 1 箇所読み込む。
- React/Vue ラッパーを使う場合も iframe 資産は静的配信先に必要（実体が iframe のため）。
- Local Agent は静的配信物に含めない。ユーザーの PC でローカル起動する。

## 静的ホスティング（GitHub Pages 等）

- フロント資産は静的配信でそのまま動作する。
- `agentUrl` は `ws://127.0.0.1:4820`（ユーザーのローカル Agent）。デプロイ URL ではない。
- デプロイ先 Origin（`https://<user>.github.io` 等）を `CLAUDE_AGENT_ALLOWED_ORIGINS` に追加する。
- base path があるサブパス配信では `iframeSrc` をその base 込みで指定する。
