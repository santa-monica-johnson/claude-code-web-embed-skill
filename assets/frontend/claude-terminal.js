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
 */
(function () {
  'use strict';

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
          '\r\n\x1b[33m[プロセスが終了しました code=' + msg.exitCode + ']\x1b[0m\r\n'
        );
        setStatus('exited');
      } else if (msg.type === 'error') {
        term.write('\r\n\x1b[31m' + msg.message + '\x1b[0m\r\n');
        setStatus('error', msg.message);
      } else if (msg.type === 'status') {
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
    }
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

  // 親ウィンドウからの制御メッセージ。
  window.addEventListener('message', function (ev) {
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
    }
  });

  // クエリで設定済みなら即接続、そうでなければ親からの config を待つ。
  if (config.agentUrl && config.token) {
    connect();
  } else {
    setStatus('waiting-config');
  }
}());
