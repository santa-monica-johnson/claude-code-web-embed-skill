/*
 * ClaudeTerminal.jsx — React 向けの薄いラッパー。
 * iframe(claude-terminal.html) をマウントし、postMessage で設定・制御する。
 * 端末の実体は iframe 側（xterm.js）にあるため、React 側は枠と状態管理のみを担う。
 *
 * 使い方:
 *   <ClaudeTerminal
 *     iframeSrc="/claude-embed/claude-terminal.html"
 *     agentUrl="ws://127.0.0.1:4820"
 *     token={token}
 *     height={360}
 *   />
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';

const STATUS_LABEL = {
  connected: '接続済み',
  connecting: '接続中…',
  disconnected: '切断',
  exited: '終了',
  error: 'エラー',
  unconfigured: '未設定',
  'waiting-config': '設定待ち',
};

export default function ClaudeTerminal({
  iframeSrc,
  agentUrl = 'ws://127.0.0.1:4820',
  token,
  height = 360,
  title = 'Claude Code',
}) {
  const iframeRef = useRef(null);
  const [status, setStatus] = useState('waiting-config');

  const postToIframe = useCallback((msg) => {
    const win = iframeRef.current && iframeRef.current.contentWindow;
    if (win) win.postMessage(msg, '*');
  }, []);

  // iframe からの状態通知を受け取る。
  useEffect(() => {
    function onMessage(ev) {
      if (iframeRef.current && ev.source !== iframeRef.current.contentWindow) return;
      const msg = ev.data;
      if (msg && msg.type === 'claude-embed-status') setStatus(msg.state);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // 設定変更時に iframe へ config を送る。
  const sendConfig = useCallback(() => {
    postToIframe({ type: 'claude-embed-config', agentUrl, token });
  }, [postToIframe, agentUrl, token]);

  useEffect(() => {
    sendConfig();
  }, [sendConfig]);

  const reconnect = useCallback(() => {
    postToIframe({ type: 'claude-embed-reconnect' });
  }, [postToIframe]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: '#0d1117',
          color: '#e6edf3',
          fontSize: 13,
          borderBottom: '1px solid #30363d',
        }}
      >
        <strong>{title}</strong>
        <span style={{ color: '#8b949e', fontSize: 12 }}>
          {STATUS_LABEL[status] || status}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={reconnect}>再接続</button>
      </div>
      <iframe
        ref={iframeRef}
        title={title}
        src={iframeSrc}
        onLoad={sendConfig}
        style={{ border: 0, flex: 1, width: '100%', background: '#1e1e1e' }}
      />
    </div>
  );
}
