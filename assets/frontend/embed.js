/*
 * embed.js — 既存 Web ページに Claude Code ターミナルを埋め込むためのフレームワーク非依存スクリプト。
 *
 * 画面下部にドッキングしたパネルを生成し、その中に claude-terminal.html を iframe として読み込む。
 * パネルのヘッダには 開閉 / 再接続 / 全画面 / 接続状態 の UI を持つ。
 * 端末そのものの入出力は iframe（xterm.js）側が担当し、本スクリプトはパネルの枠と制御のみを担う。
 *
 * 使い方:
 *   <script src="/claude-embed/embed.js"></script>
 *   <script>
 *     ClaudeEmbed.init({
 *       iframeSrc: '/claude-embed/claude-terminal.html',
 *       agentUrl: 'ws://127.0.0.1:4820',
 *       token: 'エージェント起動ログのトークン',
 *     });
 *   </script>
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    iframeSrc: null, // claude-terminal.html の URL（必須）
    agentUrl: 'ws://127.0.0.1:4820', // Local Agent の WebSocket ベース URL
    token: null, // セッショントークン（必須）
    height: 360, // パネル高さ(px)
    minHeight: 120,
    title: 'Claude Code',
    open: true, // 初期状態で開くか
    passConfigViaPostMessage: true, // true: トークンを URL に載せず postMessage で渡す
  };

  var STATUS_LABEL = {
    connected: '接続済み',
    connecting: '接続中…',
    disconnected: '切断',
    exited: '終了',
    error: 'エラー',
    unconfigured: '未設定',
    'waiting-config': '設定待ち',
  };
  var STATUS_COLOR = {
    connected: '#3fb950',
    connecting: '#d29922',
    disconnected: '#8b949e',
    exited: '#8b949e',
    error: '#f85149',
    unconfigured: '#f85149',
    'waiting-config': '#d29922',
  };

  function injectStyles() {
    if (document.getElementById('claude-embed-styles')) return;
    var css =
      '.claude-embed-panel{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;' +
      'display:flex;flex-direction:column;background:#161b22;border-top:1px solid #30363d;' +
      'box-shadow:0 -4px 24px rgba(0,0,0,.4);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'transition:height .15s ease;overflow:hidden}' +
      '.claude-embed-panel.is-fullscreen{top:0;height:100%!important}' +
      '.claude-embed-header{display:flex;align-items:center;gap:8px;padding:6px 10px;' +
      'background:#0d1117;border-bottom:1px solid #30363d;color:#e6edf3;font-size:13px;' +
      'cursor:ns-resize;user-select:none;flex:0 0 auto}' +
      '.claude-embed-title{font-weight:600;display:flex;align-items:center;gap:8px}' +
      '.claude-embed-dot{width:9px;height:9px;border-radius:50%;background:#8b949e;flex:0 0 auto}' +
      '.claude-embed-status{color:#8b949e;font-size:12px}' +
      '.claude-embed-spacer{flex:1 1 auto}' +
      '.claude-embed-btn{background:transparent;border:1px solid transparent;color:#c9d1d9;' +
      'border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;line-height:1.6}' +
      '.claude-embed-btn:hover{background:#21262d;border-color:#30363d}' +
      '.claude-embed-body{flex:1 1 auto;min-height:0;position:relative}' +
      '.claude-embed-iframe{border:0;width:100%;height:100%;display:block;background:#1e1e1e}' +
      '.claude-embed-panel.is-closed .claude-embed-body{display:none}' +
      '.claude-embed-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483000;' +
      'background:#238636;color:#fff;border:0;border-radius:20px;padding:8px 16px;font-size:13px;' +
      'cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.35);font-family:-apple-system,sans-serif}';
    var style = document.createElement('style');
    style.id = 'claude-embed-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function ClaudeEmbed(options) {
    this.opts = Object.assign({}, DEFAULTS, options || {});
    if (!this.opts.iframeSrc) throw new Error('ClaudeEmbed: iframeSrc は必須です');
    if (!this.opts.token) {
      console.warn('ClaudeEmbed: token が未設定です。Local Agent の起動ログを確認してください。');
    }
    this.isOpen = this.opts.open;
    this.isFullscreen = false;
    injectStyles();
    this._build();
    this._wireMessages();
  }

  ClaudeEmbed.prototype._build = function () {
    var o = this.opts;
    var self = this;

    var panel = el('div', 'claude-embed-panel');
    panel.style.height = this.isOpen ? o.height + 'px' : '34px';
    if (!this.isOpen) panel.classList.add('is-closed');

    // ヘッダ（ドラッグでリサイズ）
    var header = el('div', 'claude-embed-header');
    var title = el('div', 'claude-embed-title');
    this.dot = el('span', 'claude-embed-dot');
    title.appendChild(this.dot);
    title.appendChild(el('span', null, o.title));
    this.statusEl = el('span', 'claude-embed-status', '—');

    var spacer = el('div', 'claude-embed-spacer');
    var reconnectBtn = el('button', 'claude-embed-btn', '再接続');
    var fullscreenBtn = el('button', 'claude-embed-btn', '⛶');
    var toggleBtn = el('button', 'claude-embed-btn', this.isOpen ? '▾' : '▴');

    reconnectBtn.title = '再接続';
    fullscreenBtn.title = '全画面';
    toggleBtn.title = '開閉';

    header.appendChild(title);
    header.appendChild(this.statusEl);
    header.appendChild(spacer);
    header.appendChild(reconnectBtn);
    header.appendChild(fullscreenBtn);
    header.appendChild(toggleBtn);

    // 本体（iframe）
    var body = el('div', 'claude-embed-body');
    var iframe = el('iframe', 'claude-embed-iframe');
    iframe.setAttribute('title', o.title);
    iframe.src = o.passConfigViaPostMessage ? o.iframeSrc : this._srcWithQuery();
    body.appendChild(iframe);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    this.panel = panel;
    this.header = header;
    this.body = body;
    this.iframe = iframe;
    this.toggleBtn = toggleBtn;

    // イベント配線
    toggleBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      self.toggle();
    });
    reconnectBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      self.reconnect();
    });
    fullscreenBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      self.toggleFullscreen();
    });

    iframe.addEventListener('load', function () {
      self._sendConfig();
    });

    this._enableResize();
  };

  ClaudeEmbed.prototype._srcWithQuery = function () {
    var o = this.opts;
    var sep = o.iframeSrc.indexOf('?') === -1 ? '?' : '&';
    return (
      o.iframeSrc +
      sep +
      'agent=' +
      encodeURIComponent(o.agentUrl) +
      '&token=' +
      encodeURIComponent(o.token || '')
    );
  };

  ClaudeEmbed.prototype._sendConfig = function () {
    if (!this.opts.passConfigViaPostMessage) return;
    this._postToIframe({
      type: 'claude-embed-config',
      agentUrl: this.opts.agentUrl,
      token: this.opts.token,
    });
  };

  ClaudeEmbed.prototype._postToIframe = function (msg) {
    if (this.iframe && this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage(msg, '*');
    }
  };

  // 親でヘッダ上ドラッグによるパネル高さ変更を実装。
  ClaudeEmbed.prototype._enableResize = function () {
    var self = this;
    var startY = 0;
    var startH = 0;
    var dragging = false;

    function onMove(e) {
      if (!dragging) return;
      var dy = startY - e.clientY;
      var h = Math.max(self.opts.minHeight, startH + dy);
      self.panel.style.height = h + 'px';
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // ドラッグ後の高さを既定として保持し、開閉トグルで元に戻らないようにする。
      self.opts.height = self.panel.getBoundingClientRect().height;
      self._postToIframe({ type: 'claude-embed-fit' });
    }
    this.header.addEventListener('mousedown', function (e) {
      // ボタン上のドラッグは無視。
      if (e.target.classList.contains('claude-embed-btn')) return;
      if (!self.isOpen || self.isFullscreen) return;
      dragging = true;
      startY = e.clientY;
      startH = self.panel.getBoundingClientRect().height;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  };

  ClaudeEmbed.prototype._wireMessages = function () {
    var self = this;
    this._onMessage = function (ev) {
      if (self.iframe && ev.source !== self.iframe.contentWindow) return;
      var msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'claude-embed-status') {
        self._renderStatus(msg.state);
      }
    };
    window.addEventListener('message', this._onMessage);
  };

  ClaudeEmbed.prototype._renderStatus = function (state) {
    this.statusEl.textContent = STATUS_LABEL[state] || state || '—';
    this.dot.style.background = STATUS_COLOR[state] || '#8b949e';
  };

  ClaudeEmbed.prototype.open = function () {
    this.isOpen = true;
    this.panel.classList.remove('is-closed');
    this.panel.style.height = this.opts.height + 'px';
    this.toggleBtn.textContent = '▾';
    this._postToIframe({ type: 'claude-embed-fit' });
    this._postToIframe({ type: 'claude-embed-focus' });
  };

  ClaudeEmbed.prototype.close = function () {
    this.isOpen = false;
    this.isFullscreen = false;
    this.panel.classList.remove('is-fullscreen');
    this.panel.classList.add('is-closed');
    this.panel.style.height = '34px';
    this.toggleBtn.textContent = '▴';
  };

  ClaudeEmbed.prototype.toggle = function () {
    if (this.isOpen) this.close();
    else this.open();
  };

  ClaudeEmbed.prototype.toggleFullscreen = function () {
    if (!this.isOpen) this.open();
    this.isFullscreen = !this.isFullscreen;
    this.panel.classList.toggle('is-fullscreen', this.isFullscreen);
    if (!this.isFullscreen) this.panel.style.height = this.opts.height + 'px';
    var self = this;
    setTimeout(function () {
      self._postToIframe({ type: 'claude-embed-fit' });
    }, 160);
  };

  ClaudeEmbed.prototype.reconnect = function () {
    this._postToIframe({ type: 'claude-embed-reconnect' });
  };

  ClaudeEmbed.prototype.destroy = function () {
    window.removeEventListener('message', this._onMessage);
    if (this.panel && this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel);
    }
  };

  var api = {
    init: function (options) {
      return new ClaudeEmbed(options);
    },
    ClaudeEmbed: ClaudeEmbed,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.ClaudeEmbed = api;
}(typeof window !== 'undefined' ? window : this));
