<!--
  ClaudeTerminal.vue — Vue 3 向けの薄いラッパー。
  iframe(claude-terminal.html) をマウントし、postMessage で設定・制御する。
  端末の実体は iframe 側（xterm.js）にあるため、Vue 側は枠と状態管理のみを担う。

  使い方:
    <ClaudeTerminal
      iframe-src="/claude-embed/claude-terminal.html"
      agent-url="ws://127.0.0.1:4820"
      :token="token"
      :height="360"
    />
-->
<template>
  <div class="claude-terminal" :style="{ height: height + 'px' }">
    <div class="claude-terminal__header">
      <strong>{{ title }}</strong>
      <span class="claude-terminal__status">{{ statusLabel }}</span>
      <span class="claude-terminal__spacer" />
      <button @click="reconnect">Reconnect</button>
    </div>
    <iframe
      ref="frame"
      :title="title"
      :src="iframeSrc"
      class="claude-terminal__frame"
      @load="sendConfig"
    />
  </div>
</template>

<script>
const STATUS_LABEL = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
  exited: 'Exited',
  error: 'Error',
  unconfigured: 'Not configured',
  'waiting-config': 'Waiting for config',
};

export default {
  name: 'ClaudeTerminal',
  props: {
    iframeSrc: { type: String, required: true },
    agentUrl: { type: String, default: 'ws://127.0.0.1:4820' },
    token: { type: String, default: '' },
    height: { type: Number, default: 360 },
    title: { type: String, default: 'Claude Code' },
  },
  data() {
    return { status: 'waiting-config' };
  },
  computed: {
    statusLabel() {
      return STATUS_LABEL[this.status] || this.status;
    },
  },
  mounted() {
    this._onMessage = (ev) => {
      const frame = this.$refs.frame;
      if (frame && ev.source !== frame.contentWindow) return;
      const msg = ev.data;
      if (msg && msg.type === 'claude-embed-status') this.status = msg.state;
    };
    window.addEventListener('message', this._onMessage);
  },
  beforeUnmount() {
    window.removeEventListener('message', this._onMessage);
  },
  watch: {
    agentUrl: 'sendConfig',
    token: 'sendConfig',
  },
  methods: {
    postToIframe(msg) {
      const frame = this.$refs.frame;
      if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*');
    },
    sendConfig() {
      this.postToIframe({
        type: 'claude-embed-config',
        agentUrl: this.agentUrl,
        token: this.token,
      });
    },
    reconnect() {
      this.postToIframe({ type: 'claude-embed-reconnect' });
    },
  },
};
</script>

<style scoped>
.claude-terminal {
  display: flex;
  flex-direction: column;
}
.claude-terminal__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #0d1117;
  color: #e6edf3;
  font-size: 13px;
  border-bottom: 1px solid #30363d;
}
.claude-terminal__status {
  color: #8b949e;
  font-size: 12px;
}
.claude-terminal__spacer {
  flex: 1;
}
.claude-terminal__frame {
  border: 0;
  flex: 1;
  width: 100%;
  background: #1e1e1e;
}
</style>
