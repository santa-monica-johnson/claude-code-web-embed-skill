/*
 * claude-terminal.js — iframe 内で動く端末クライアント。
 *
 * 責務:
 *   - xterm.js の初期化とリサイズ（fit）
 *   - Local Agent との WebSocket 接続・再接続
 *   - 端末入出力の中継（input / output / resize）
 *   - 接続状態を親ウィンドウへ postMessage で通知
 *
 * 設定（agentUrl / token）の受け取り方:
 *   1. URL クエリ  ?agent=ws://127.0.0.1:4820&token=xxxx
 *   2. 親からの postMessage  { type: 'claude-embed-config', agentUrl, token }
 *   トークンを URL に載せたくない場合は 2 を使う（embed.js の既定）。
 *
 * セッションの継続（ブラウザのリロードに影響されない）:
 *   接続のたびに sessionStorage 由来の固定 session id を送る。Local Agent は
 *   これを使って、同じ claude プロセスに再アタッチする（プロセスを再起動しない）。
 *   sessionStorage はタブを閉じると消えるが、リロードでは保持されるため、
 *   「リロードしてもセッションは続くが、タブを閉じたら新しいセッションになる」
 *   という直感的な挙動になる。
 *
 * 要素選択からのテキスト挿入:
 *   親（embed.js）から postMessage { type: 'claude-embed-insert-text', text }
 *   を受け取ると、bracketed paste で包んで PTY へ input として送る。入力行に
 *   挿入されるだけで自動送信はしない（ユーザーが確認・追記して Enter する）。
 */
(function () {
  'use strict';

  var SESSION_ID_KEY = 'claudeTerminalSessionId';
  // bracketed paste の開始/終了エスケープ（複数行テキストを「貼り付け」として
  // 安全に挿入するため。行ごとの Enter 誤送信を防ぐ）。
  var BRACKETED_PASTE_START = '\x1b[200~';
  var BRACKETED_PASTE_END = '\x1b[201~';

  function getOrCreateSessionId() {
    var id = null;
    try {
      id = window.sessionStorage.getItem(SESSION_ID_KEY);
    } catch (e) {
      /* sessionStorage が使えない環境（プライベートモード等）では毎回新規セッションになる */
    }
    if (!id) {
      id =
        window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      try {
        window.sessionStorage.setItem(SESSION_ID_KEY, id);
      } catch (e) {
        /* 保存できなくても接続自体は続行する */
      }
    }
    return id;
  }

  function saveSessionId(id) {
    try {
      window.sessionStorage.setItem(SESSION_ID_KEY, id);
    } catch (e) {
      /* noop */
    }
  }

  var term = new window.Terminal({
    fontFamily: 'Menlo, Monaco, "DejaVu Sans Mono", "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    theme: { background: '#1e1e1e', foreground: '#e6e6e6' },
  });

  var fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  try {
    term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
  } catch (e) {
    /* web-links アドオンが無くても動作する */
  }
  term.open(document.getElementById('terminal'));

  var socket = null;
  var config = { agentUrl: null, token: null };
  var reconnectDelay = 1000;
  var reconnectTimer = null;
  var manualClose = false;
  var resizeTimer = null;
  var sessionId = getOrCreateSessionId();

  // URL クエリから初期設定を読む。
  var params = new URLSearchParams(window.location.search);
  if (params.get('agent')) config.agentUrl = params.get('agent');
  if (params.get('token')) config.token = params.get('token');

  function postToParent(msg) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(msg, '*');
    }
  }

  function setStatus(state, detail) {
    postToParent({ type: 'claude-embed-status', state: state, detail: detail || null });
  }

  function currentDims() {
    var dims = null;
    try {
      dims = fitAddon.proposeDimensions();
    } catch (e) {
      /* まだレイアウト未確定 */
    }
    return dims && dims.cols && dims.rows ? dims : { cols: 80, rows: 24 };
  }

  function buildUrl() {
    var u = new URL(config.agentUrl);
    u.pathname = '/terminal';
    u.searchParams.set('token', config.token || '');
    u.searchParams.set('session', sessionId);
    var dims = currentDims();
    u.searchParams.set('cols', String(dims.cols));
    u.searchParams.set('rows', String(dims.rows));
    return u.toString();
  }

  function connect() {
    if (!config.agentUrl || !config.token) {
      setStatus('unconfigured');
      return;
    }
    // 保留中の再接続タイマーを破棄し、ソケットの二重生成を防ぐ。
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    manualClose = false;
    setStatus('connecting');

    try {
      socket = new WebSocket(buildUrl());
    } catch (e) {
      setStatus('error', String(e));
      scheduleReconnect();
      return;
    }

    socket.onopen = function () {
      reconnectDelay = 1000;
      setStatus('connected');
      fit();
      term.focus();
    };

    socket.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg.type === 'output') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        term.write(
          '\r\n\x1b[33m[process exited code=' + msg.exitCode + ']\x1b[0m\r\n'
        );
        setStatus('exited');
      } else if (msg.type === 'error') {
        term.write('\r\n\x1b[31m' + msg.message + '\x1b[0m\r\n');
        setStatus('error', msg.message);
      } else if (msg.type === 'status') {
        // サーバが確定した session id を反映する（通常は自分が送った id と同じ）。
        if (msg.sessionId && msg.sessionId !== sessionId) {
          sessionId = msg.sessionId;
          saveSessionId(sessionId);
        }
        if (msg.state === 'replaced') {
          // 別タブ／別ウィンドウが同じセッションに再接続してきたため、こちら側は
          // 意図的な切断として扱う（自動再接続すると奪い合いの無限ループになるため）。
          manualClose = true;
          term.write('\r\n\x1b[33m[session opened in another tab/window]\x1b[0m\r\n');
        }
        setStatus(msg.state);
      }
    };

    socket.onclose = function () {
      setStatus('disconnected');
      if (!manualClose) scheduleReconnect();
    };

    socket.onerror = function () {
      setStatus('error');
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return; // 既にスケジュール済みなら重ねない。
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
      connect();
    }, reconnectDelay);
  }

  function closeSocket() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) {
      manualClose = true;
      try {
        socket.close();
      } catch (e) {
        /* noop */
      }
      socket = null;
    }
  }

  function send(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function fit() {
    try {
      fitAddon.fit();
    } catch (e) {
      return;
    }
    var dims = currentDims();
    send({ type: 'resize', cols: dims.cols, rows: dims.rows });
  }

  function scheduleFit() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fit, 100);
  }

  // 端末入力を Local Agent へ送る。
  term.onData(function (data) {
    send({ type: 'input', data: data });
  });

  window.addEventListener('resize', scheduleFit);
  if (window.ResizeObserver) {
    new ResizeObserver(scheduleFit).observe(document.getElementById('terminal'));
  }

  // 親ウィンドウからの制御メッセージ。別フレーム／別ウィンドウからの成りすましを防ぐため、
  // 送信元が実際の親ウィンドウであることを確認する（embed.js 側の _wireMessages と同じ方針）。
  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var msg = ev.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'claude-embed-config') {
      config.agentUrl = msg.agentUrl || config.agentUrl;
      config.token = msg.token || config.token;
      closeSocket();
      connect();
    } else if (msg.type === 'claude-embed-reconnect') {
      closeSocket();
      connect();
    } else if (msg.type === 'claude-embed-fit') {
      fit();
    } else if (msg.type === 'claude-embed-focus') {
      term.focus();
    } else if (msg.type === 'claude-embed-insert-text' && typeof msg.text === 'string') {
      // bracketed paste で包んで送る。改行を含むテキストでも、行ごとに Enter として
      // 誤送信されず、貼り付けとして入力行にそのまま挿入される（自動送信はしない）。
      // 実機で bash / Claude Code 双方に対して検証済み。
      // ESC バイトは事前に除去する: そのまま通すと、テキスト中に紛れ込んだ
      // 終端シーケンス(\x1b[201~)で貼り付けが早期終了し、直後の \r が実際の
      // Enter として解釈され得る（貼り付け保護を回避した誤/不正実行の経路になる）。
      // 選択した要素のセレクタ/タグ/テキスト/HTML に本来 ESC 文字は含まれない。
      var safeText = msg.text.replace(/\x1b/g, '');
      var sent = send({ type: 'input', data: BRACKETED_PASTE_START + safeText + BRACKETED_PASTE_END });
      if (!sent) {
        setStatus('error', 'Not connected — could not insert the picked element.');
      }
      term.focus();
    }
  });

  // クエリで設定済みなら即接続、そうでなければ親からの config を待つ。
  if (config.agentUrl && config.token) {
    connect();
  } else {
    setStatus('waiting-config');
  }
}());
