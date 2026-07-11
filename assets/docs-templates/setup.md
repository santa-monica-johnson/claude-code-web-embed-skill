# セットアップ手順

初回セットアップから接続確認までの手順をまとめる。

## 1. Claude Code のインストール

Claude Code CLI がこの PC にインストール済みであることを確認する。

```bash
claude --version
```

コマンドが見つからない場合は Claude Code を導入する（[claude.com/claude-code](https://claude.com/claude-code)）。

## 2. Claude Code へのログイン

```bash
claude
```

初回は認証フローが走る。ログイン済みであることを確認してから終了する。

> ヒント: このセッションでシェルコマンドを自分で実行したい場合は、プロンプトに `! claude` のように `!` を付けて入力すると、その場で実行され出力が会話に取り込まれる。

## 3. Local Agent の起動

```bash
cd claude-embed/local-agent
npm install            # 初回のみ（node-pty のビルドが走る）
CLAUDE_AGENT_CWD="/path/to/your/project" npm start
```

起動すると以下のような出力が表示される。

```
──────────────────────────────────────────────
 Claude Code Local Agent
──────────────────────────────────────────────
 HTTP      : http://127.0.0.1:4820
 WebSocket : ws://127.0.0.1:4820/terminal
 作業Dir   : /path/to/your/project
 Claude    : 利用可能
 セッショントークン（フロントエンドに設定してください）:
   3f9a...（省略）
──────────────────────────────────────────────
```

表示された**セッショントークン**を控える。固定したい場合は `.env` に `CLAUDE_AGENT_TOKEN` を設定する。

## 4. Web UI の起動

既存アプリの通常の起動方法に従う（例）。

```bash
npm run dev
```

`embed.js` を利用する場合は、トークンをフロントエンドへ渡す。開発時は環境変数などで注入するのが簡単。

```html
<script src="/claude-embed/embed.js"></script>
<script>
  ClaudeEmbed.init({
    iframeSrc: '/claude-embed/claude-terminal.html',
    agentUrl: 'ws://127.0.0.1:4820',
    token: window.__CLAUDE_AGENT_TOKEN__, // ビルド時／サーバ側で注入
  });
</script>
```

## 5. 接続確認

1. Web アプリを開く。
2. 画面下部に「Claude Code」パネルが表示される。
3. ヘッダの状態表示が「接続済み」になる。
4. パネル内で `help` などを入力し、Claude Code が応答することを確認する。
5. ウィンドウやパネルをリサイズし、端末が追従することを確認する。
6. Local Agent を再起動し、パネルが自動で再接続することを確認する。

## うまくいかないときは

- 状態が「未設定」→ `agentUrl` / `token` がフロントに渡っているか確認。
- `401` → トークンが起動ログの値と一致しているか確認。
- `403` → `CLAUDE_AGENT_ALLOWED_ORIGINS` に Web UI の Origin を追加。
- 「Claude Code の起動に失敗」→ 手順 1・2 を再確認。

詳細は `README.md` のトラブルシューティングを参照。
