/*
 * embed.js — 既存 Web ページに Claude Code ターミナルを埋め込むためのフレームワーク非依存スクリプト。
 *
 * ドッキングしたパネルを生成し、その中に claude-terminal.html を iframe として読み込む。
 * パネルは 下部(bottom)・右(right)・左(left)・浮遊ウィンドウ(floating) に配置でき、
 * ヘッダー上のセレクタから実行時に切り替えられる（選択は localStorage に保存）。
 * ヘッダーには 配置切替 / 再接続 / 全画面 / 最小化 / 接続状態 の UI を持つ。
 * 端末そのものの入出力は iframe（xterm.js）側が担当し、本スクリプトはパネルの枠と制御のみを担う。
 *
 * 使い方:
 *   <script src="/claude-embed/embed.js"></script>
 *   <script>
 *     ClaudeEmbed.init({
 *       iframeSrc: '/claude-embed/claude-terminal.html',
 *       agentUrl: 'ws://127.0.0.1:4820',
 *       token: 'エージェント起動ログのトークン',
 *       position: 'floating',  // 初期配置。'bottom'(既定) | 'right' | 'left' | 'floating'
 *     });
 *   </script>
 */
(function (global) {
  'use strict';

  var POSITIONS = ['bottom', 'right', 'left', 'floating'];
  var POSITION_LABEL = { bottom: 'Bottom', right: 'Right', left: 'Left', floating: 'Floating' };
  var STORAGE_KEY = 'claudeEmbedPosition';

  var DEFAULTS = {
    iframeSrc: null, // claude-terminal.html の URL（必須）
    agentUrl: 'ws://127.0.0.1:4820', // Local Agent の WebSocket ベース URL
    token: null, // セッショントークン（必須）
    position: 'bottom', // 初期配置
    height: 360, // bottom / floating の高さ(px)
    width: 420, // right/left / floating の幅(px)
    x: null, // floating の初期 left(px)。null なら中央寄せ
    y: null, // floating の初期 top(px)。null なら中央寄せ
    minHeight: 120,
    minWidth: 280,
    title: 'Claude Code',
    open: true, // 初期状態で開くか
    persist: true, // 配置の選択を localStorage に保存・復元するか
    passConfigViaPostMessage: true, // true: トークンを URL に載せず postMessage で渡す
  };

  var STATUS_LABEL = {
    connected: 'Connected',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    exited: 'Exited',
    error: 'Error',
    unconfigured: 'Not configured',
    'waiting-config': 'Waiting for config',
    replaced: 'Opened elsewhere',
  };
  var STATUS_COLOR = {
    connected: '#3fb950',
    connecting: '#d29922',
    disconnected: '#8b949e',
    exited: '#8b949e',
    error: '#f85149',
    unconfigured: '#f85149',
    'waiting-config': '#d29922',
    replaced: '#d29922',
  };

  function injectStyles() {
    if (document.getElementById('claude-embed-styles')) return;
    var css =
      '.claude-embed-panel{position:fixed;z-index:2147483000;display:flex;flex-direction:column;' +
      'background:#161b22;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}' +
      '.claude-embed-panel--bottom{left:0;right:0;bottom:0;border-top:1px solid #30363d;box-shadow:0 -4px 24px rgba(0,0,0,.4)}' +
      '.claude-embed-panel--right{top:0;bottom:0;right:0;border-left:1px solid #30363d;box-shadow:-4px 0 24px rgba(0,0,0,.4)}' +
      '.claude-embed-panel--left{top:0;bottom:0;left:0;border-right:1px solid #30363d;box-shadow:4px 0 24px rgba(0,0,0,.4)}' +
      '.claude-embed-panel--floating{border:1px solid #30363d;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.5)}' +
      '.claude-embed-panel--floating .claude-embed-header{cursor:move}' +
      '.claude-embed-panel--bottom .claude-embed-header{cursor:ns-resize}' +
      '.claude-embed-panel.is-fullscreen{inset:0;width:auto!important;height:auto!important;border-radius:0}' +
      '.claude-embed-panel.is-hidden{display:none}' +
      '.claude-embed-header{display:flex;align-items:center;gap:8px;padding:6px 10px;' +
      'background:#0d1117;border-bottom:1px solid #30363d;color:#e6edf3;font-size:13px;' +
      'user-select:none;flex:0 0 auto}' +
      '.claude-embed-title{font-weight:600;display:flex;align-items:center;gap:8px;min-width:0}' +
      '.claude-embed-title span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.claude-embed-dot{width:9px;height:9px;border-radius:50%;background:#8b949e;flex:0 0 auto}' +
      '.claude-embed-status{color:#8b949e;font-size:12px;white-space:nowrap}' +
      '.claude-embed-spacer{flex:1 1 auto}' +
      '.claude-embed-select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;' +
      'font-size:12px;padding:2px 4px;cursor:pointer;flex:0 0 auto}' +
      '.claude-embed-btn{background:transparent;border:1px solid transparent;color:#c9d1d9;' +
      'border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;line-height:1.6;flex:0 0 auto}' +
      '.claude-embed-btn:hover{background:#21262d;border-color:#30363d}' +
      '.claude-embed-body{flex:1 1 auto;min-height:0;position:relative}' +
      '.claude-embed-iframe{border:0;width:100%;height:100%;display:block;background:#1e1e1e}' +
      '.claude-embed-grip{position:absolute;z-index:2}' +
      '.claude-embed-panel--bottom .claude-embed-grip{display:none}' +
      '.claude-embed-panel--right .claude-embed-grip{left:0;top:0;bottom:0;width:6px;cursor:ew-resize}' +
      '.claude-embed-panel--left .claude-embed-grip{right:0;top:0;bottom:0;width:6px;cursor:ew-resize}' +
      '.claude-embed-panel--floating .claude-embed-grip{right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize}' +
      '.claude-embed-panel--floating .claude-embed-grip::after{content:"";position:absolute;right:3px;bottom:3px;' +
      'width:7px;height:7px;border-right:2px solid #6e7681;border-bottom:2px solid #6e7681}' +
      '.claude-embed-grip:hover{background:rgba(48,54,61,.6)}' +
      '.claude-embed-launcher{position:fixed;z-index:2147483000;background:#238636;color:#fff;border:0;' +
      'border-radius:20px;padding:8px 16px;font-size:13px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.35);' +
      'font-family:-apple-system,sans-serif;right:16px;bottom:16px}' +
      '.claude-embed-launcher.is-hidden{display:none}';
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

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function loadSavedPosition() {
    try {
      return global.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function ClaudeEmbed(options) {
    this.opts = Object.assign({}, DEFAULTS, options || {});
    if (!this.opts.iframeSrc) throw new Error('ClaudeEmbed: iframeSrc is required');
    if (!this.opts.token) {
      console.warn('ClaudeEmbed: token is not set. Check the Local Agent startup log.');
    }
    if (POSITIONS.indexOf(this.opts.position) === -1) this.opts.position = 'bottom';
    // 保存済みの配置があれば優先（ヘッダーのセレクタで選んだ状態を復元）。
    if (this.opts.persist) {
      var saved = loadSavedPosition();
      if (saved && POSITIONS.indexOf(saved) !== -1) this.opts.position = saved;
    }
    this._setPosFlags(this.opts.position);
    this.isOpen = this.opts.open;
    this.isFullscreen = false;
    injectStyles();
    this._build();
    this._wireMessages();
  }

  ClaudeEmbed.prototype._setPosFlags = function (pos) {
    this.pos = pos;
    this.isSide = pos === 'right' || pos === 'left';
    this.isFloating = pos === 'floating';
  };

  // 配置に応じたサイズ・位置（開いているとき）を適用する。
  ClaudeEmbed.prototype._applySize = function () {
    if (this.isFullscreen) return;
    var o = this.opts;
    var s = this.panel.style;
    if (this.isFloating) {
      s.width = o.width + 'px';
      s.height = o.height + 'px';
      s.left = o.x + 'px';
      s.top = o.y + 'px';
    } else if (this.isSide) {
      s.width = o.width + 'px';
      s.height = '';
    } else {
      s.height = o.height + 'px';
      s.width = '';
    }
  };

  ClaudeEmbed.prototype._build = function () {
    var o = this.opts;
    var self = this;

    if (this.isFloating) this._ensureFloatingCoords();

    var panel = el('div', 'claude-embed-panel claude-embed-panel--' + this.pos);

    // ヘッダー
    var header = el('div', 'claude-embed-header');
    var title = el('div', 'claude-embed-title');
    this.dot = el('span', 'claude-embed-dot');
    title.appendChild(this.dot);
    title.appendChild(el('span', null, o.title));
    this.statusEl = el('span', 'claude-embed-status', '—');

    var spacer = el('div', 'claude-embed-spacer');

    // 配置セレクタ
    var select = el('select', 'claude-embed-select');
    select.title = 'Display position';
    POSITIONS.forEach(function (p) {
      var opt = el('option', null, POSITION_LABEL[p]);
      opt.value = p;
      if (p === self.pos) opt.selected = true;
      select.appendChild(opt);
    });

    var reconnectBtn = el('button', 'claude-embed-btn', 'Reconnect');
    var fullscreenBtn = el('button', 'claude-embed-btn', '⛶');
    var minimizeBtn = el('button', 'claude-embed-btn', '—');
    reconnectBtn.title = 'Reconnect';
    fullscreenBtn.title = 'Full screen';
    minimizeBtn.title = 'Minimize';

    header.appendChild(title);
    header.appendChild(this.statusEl);
    header.appendChild(spacer);
    header.appendChild(select);
    header.appendChild(reconnectBtn);
    header.appendChild(fullscreenBtn);
    header.appendChild(minimizeBtn);

    // 本体（iframe）
    var body = el('div', 'claude-embed-body');
    var iframe = el('iframe', 'claude-embed-iframe');
    iframe.setAttribute('title', o.title);
    iframe.src = o.passConfigViaPostMessage ? o.iframeSrc : this._srcWithQuery();
    body.appendChild(iframe);

    // リサイズ用グリップ（bottom では CSS で非表示）
    var grip = el('div', 'claude-embed-grip');

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(grip);
    document.body.appendChild(panel);

    var launcher = el('button', 'claude-embed-launcher is-hidden', o.title);
    document.body.appendChild(launcher);

    this.panel = panel;
    this.header = header;
    this.body = body;
    this.iframe = iframe;
    this.grip = grip;
    this.selectEl = select;
    this.launcher = launcher;

    this._applySize();
    if (!this.isOpen) this.close();

    select.addEventListener('change', function () {
      self.setPosition(select.value);
    });
    reconnectBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      self.reconnect();
    });
    fullscreenBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      self.toggleFullscreen();
    });
    minimizeBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      self.close();
    });
    launcher.addEventListener('click', function () {
      self.open();
    });
    iframe.addEventListener('load', function () {
      self._sendConfig();
    });

    this._enableHeaderDrag();
    this._enableGrip();
  };

  ClaudeEmbed.prototype._ensureFloatingCoords = function () {
    var o = this.opts;
    if (o.x == null) o.x = Math.max(12, Math.round((window.innerWidth - o.width) / 2));
    if (o.y == null) o.y = Math.max(12, Math.round((window.innerHeight - o.height) / 3));
  };

  ClaudeEmbed.prototype._srcWithQuery = function () {
    var o = this.opts;
    var sep = o.iframeSrc.indexOf('?') === -1 ? '?' : '&';
    return (
      o.iframeSrc + sep + 'agent=' + encodeURIComponent(o.agentUrl) + '&token=' + encodeURIComponent(o.token || '')
    );
  };

  ClaudeEmbed.prototype._sendConfig = function () {
    if (!this.opts.passConfigViaPostMessage) return;
    this._postToIframe({ type: 'claude-embed-config', agentUrl: this.opts.agentUrl, token: this.opts.token });
  };

  ClaudeEmbed.prototype._postToIframe = function (msg) {
    if (this.iframe && this.iframe.contentWindow) this.iframe.contentWindow.postMessage(msg, '*');
  };

  // ドラッグ中は iframe がマウスイベントを奪わないよう pointer-events を切る。
  ClaudeEmbed.prototype._setIframeInteractive = function (on) {
    if (this.iframe) this.iframe.style.pointerEvents = on ? '' : 'none';
  };

  ClaudeEmbed.prototype._savePosition = function () {
    if (!this.opts.persist) return;
    try {
      global.localStorage.setItem(STORAGE_KEY, this.pos);
    } catch (e) {
      /* localStorage 不可でも動作は継続 */
    }
  };

  // 実行時に配置を切り替える（ヘッダーのセレクタから呼ばれる）。
  ClaudeEmbed.prototype.setPosition = function (pos) {
    if (POSITIONS.indexOf(pos) === -1 || pos === this.pos) return;
    var rect = this.panel.getBoundingClientRect();

    this.panel.classList.remove('claude-embed-panel--' + this.pos);
    this._setPosFlags(pos);
    this.panel.classList.add('claude-embed-panel--' + pos);

    // インライン位置指定を一旦リセットしてから新配置を適用。
    var s = this.panel.style;
    s.left = s.top = s.width = s.height = '';
    this.isFullscreen = false;
    this.panel.classList.remove('is-fullscreen');

    if (this.isFloating) {
      // 現在の見た目位置・サイズを引き継いで浮遊化（極端な値はクランプ）。
      this.opts.width = clamp(Math.round(rect.width), this.opts.minWidth, 720);
      this.opts.height = clamp(Math.round(rect.height), this.opts.minHeight, 520);
      this.opts.x = clamp(Math.round(rect.left), 0, Math.max(0, window.innerWidth - this.opts.width));
      this.opts.y = clamp(Math.round(rect.top), 0, Math.max(0, window.innerHeight - 40));
    }

    this._applySize();
    if (this.selectEl) this.selectEl.value = pos;
    this._savePosition();

    var self = this;
    setTimeout(function () {
      self._postToIframe({ type: 'claude-embed-fit' });
    }, 60);
  };

  // ヘッダーのドラッグ。bottom=高さリサイズ / floating=移動 / side=無効。配置ごとに実行時判定。
  ClaudeEmbed.prototype._enableHeaderDrag = function () {
    var self = this;
    var sx = 0, sy = 0, base = 0, ox = 0, oy = 0, dragging = false;

    function onMove(e) {
      if (!dragging) return;
      if (self.isFloating) {
        var r = self.panel.getBoundingClientRect();
        self.opts.x = clamp(ox + (e.clientX - sx), 0, Math.max(0, window.innerWidth - r.width));
        self.opts.y = clamp(oy + (e.clientY - sy), 0, Math.max(0, window.innerHeight - 40));
        self.panel.style.left = self.opts.x + 'px';
        self.panel.style.top = self.opts.y + 'px';
      } else {
        self.panel.style.height = Math.max(self.opts.minHeight, base + (sy - e.clientY)) + 'px';
      }
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      self._setIframeInteractive(true);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!self.isFloating) {
        self.opts.height = self.panel.getBoundingClientRect().height;
        self._postToIframe({ type: 'claude-embed-fit' });
      }
    }
    this.header.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('claude-embed-btn') || e.target.classList.contains('claude-embed-select')) return;
      if (self.isSide) return; // サイドはヘッダードラッグ無効（グリップで幅調整）
      if (!self.isOpen || self.isFullscreen) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      var rect = self.panel.getBoundingClientRect();
      base = rect.height;
      ox = self.opts.x;
      oy = self.opts.y;
      self._setIframeInteractive(false);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  };

  // グリップのドラッグ。side=幅リサイズ / floating=幅＋高さリサイズ（bottom は非表示）。
  ClaudeEmbed.prototype._enableGrip = function () {
    var self = this;
    var sx = 0, sy = 0, sw = 0, sh = 0, dragging = false;

    function onMove(e) {
      if (!dragging) return;
      if (self.isFloating) {
        self.panel.style.width = Math.max(self.opts.minWidth, sw + (e.clientX - sx)) + 'px';
        self.panel.style.height = Math.max(self.opts.minHeight, sh + (e.clientY - sy)) + 'px';
      } else {
        var dx = self.pos === 'right' ? sx - e.clientX : e.clientX - sx;
        self.panel.style.width = Math.max(self.opts.minWidth, sw + dx) + 'px';
      }
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      self._setIframeInteractive(true);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      var rect = self.panel.getBoundingClientRect();
      self.opts.width = rect.width;
      if (self.isFloating) self.opts.height = rect.height;
      self._postToIframe({ type: 'claude-embed-fit' });
    }
    this.grip.addEventListener('mousedown', function (e) {
      if (self.pos === 'bottom') return; // bottom はグリップ非表示
      if (!self.isOpen || self.isFullscreen) return;
      dragging = true;
      var rect = self.panel.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      sw = rect.width;
      sh = rect.height;
      self._setIframeInteractive(false);
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
      if (msg.type === 'claude-embed-status') self._renderStatus(msg.state);
    };
    window.addEventListener('message', this._onMessage);
  };

  ClaudeEmbed.prototype._renderStatus = function (state) {
    this.statusEl.textContent = STATUS_LABEL[state] || state || '—';
    this.dot.style.background = STATUS_COLOR[state] || '#8b949e';
  };

  ClaudeEmbed.prototype.open = function () {
    this.isOpen = true;
    this.panel.classList.remove('is-hidden');
    this.launcher.classList.add('is-hidden');
    this._applySize();
    this._postToIframe({ type: 'claude-embed-fit' });
    this._postToIframe({ type: 'claude-embed-focus' });
  };

  ClaudeEmbed.prototype.close = function () {
    this.isOpen = false;
    this.isFullscreen = false;
    this.panel.classList.remove('is-fullscreen');
    this.panel.classList.add('is-hidden');
    this.launcher.classList.remove('is-hidden');
  };

  ClaudeEmbed.prototype.toggle = function () {
    if (this.isOpen) this.close();
    else this.open();
  };

  ClaudeEmbed.prototype.toggleFullscreen = function () {
    if (!this.isOpen) this.open();
    this.isFullscreen = !this.isFullscreen;
    this.panel.classList.toggle('is-fullscreen', this.isFullscreen);
    if (this.isFullscreen) {
      var s = this.panel.style;
      s.left = s.top = s.width = s.height = ''; // クラス(inset:0)に委ねる
    } else {
      this._applySize();
    }
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
    if (this.panel && this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
    if (this.launcher && this.launcher.parentNode) this.launcher.parentNode.removeChild(this.launcher);
  };

  var api = {
    init: function (options) {
      return new ClaudeEmbed(options);
    },
    ClaudeEmbed: ClaudeEmbed,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ClaudeEmbed = api;
}(typeof window !== 'undefined' ? window : this));
