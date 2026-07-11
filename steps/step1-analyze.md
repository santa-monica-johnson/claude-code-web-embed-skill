# Step 1 — プロジェクト解析

対象プロジェクトを調べ、**埋め込み方式**と**配置先**を決める。SQL でいう「母集団・粒度」を先に固定するのと同じで、ここで統合方針を一文にしてから手を動かす。

## 調べること

1. **統合先ルート**: どのディレクトリに統合するか。曖昧ならユーザーに確認する。
2. **`package.json`**: フレームワーク・依存・スクリプト（`dev`/`build`）を読む。無ければ Vanilla/静的サイトとして扱う。
3. **パッケージマネージャー**: `package-lock.json`→npm / `yarn.lock`→yarn / `pnpm-lock.yaml`→pnpm / `bun.lockb`→bun。
4. **フレームワーク**: React / Next / Vue / Nuxt / Svelte / Astro / Vite / Vanilla のいずれか（`references/project-analysis.md` の早見表）。
5. **静的配信の場所**: `public/`・`static/`・`assets/`・出力ディレクトリなど。iframe 用の HTML/JS を置ける場所。
6. **エントリ / レイアウト**: `embed.js` を 1 箇所読み込める共通レイアウト（`_app`・`layout`・`App.vue`・`index.html` 等）。
7. **静的ホスティング前提か**: GitHub Pages などにデプロイするか（フロントは静的、Local Agent はローカルのまま）。

## 決めること（一文で明示する）

- **埋め込み方式**: 既定は **iframe**（フレームワーク非依存・最小侵襲）。React/Vue で密に組み込みたい要望が明確なときだけラッパーを使う。
- **フロント配置先**: 静的配信できるパス（例: `public/claude-embed/`）。
- **Local Agent 配置先**: プロジェクト直下 `local-agent/`（またはリポジトリ外の任意の場所でも可）。
- **ポート / Origin**: 既定ポート `4820`。Web UI の Origin（`http://localhost:5173` や `https://<user>.github.io` 等）を許可リストに入れるか。

## 確認してから進む

決めた方針を「埋め込み方式＝X、フロント配置＝Y、Agent 配置＝Z、Origin＝W」の形で提示する。想定と違う構成（モノレポ・SSR のみでレイアウト共有が難しい等）なら、解釈を示して合意を取ってから Step 2 へ。
