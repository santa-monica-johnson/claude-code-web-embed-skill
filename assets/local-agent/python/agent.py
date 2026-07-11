#!/usr/bin/env python3
"""Claude Code Local Agent (Python 実装).

ローカルにインストール済みの Claude Code CLI を擬似端末(PTY)で起動し、
WebSocket 経由で Web UI の xterm.js ターミナルへ中継する。
Node 版と同一のプロトコル・挙動。開発者向けコメントは日本語、
利用者が目にする文言は英語で統一する。

必要: Python 3.8+ / websockets (requirements.txt)
"""

import asyncio
import codecs
import fcntl
import json
import logging
import os
import pty
import re
import secrets
import shutil
import signal
import struct
import subprocess
import termios
from dataclasses import dataclass
from typing import List
from urllib.parse import urlsplit, parse_qs

from websockets.asyncio.server import serve
from websockets.exceptions import InvalidStatus
from websockets.http11 import Response
from websockets.datastructures import Headers


class _SuppressIntentionalHTTP(logging.Filter):
    """process_request が意図的に返す HTTP 応答（health/status や 401/403/404）は、
    websockets 内部では「WS ハンドシェイク失敗(InvalidStatus)」として ERROR ログ化される。
    これは想定内なので抑制する。真のプロトコルエラーは通す。"""

    def filter(self, record: logging.LogRecord) -> bool:
        exc = record.exc_info[1] if record.exc_info else None
        return not isinstance(exc, InvalidStatus)


# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------

def load_dotenv(path: str) -> None:
    """.env を読み込み os.environ に反映する（既存の環境変数は上書きしない）。"""
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


@dataclass
class Config:
    host: str
    port: int
    working_dir: str
    allowed_origins: List[str]
    session_token: str
    claude_command: str
    claude_args: List[str]
    max_sessions: int
    session_grace_seconds: float
    scrollback_chars: int


def load_config() -> Config:
    env = os.environ
    return Config(
        host=env.get("CLAUDE_AGENT_HOST", "127.0.0.1"),
        port=int(env.get("CLAUDE_AGENT_PORT", "4820") or 4820),
        working_dir=os.path.abspath(env.get("CLAUDE_AGENT_CWD") or os.getcwd()),
        allowed_origins=[
            o.strip()
            for o in (env.get("CLAUDE_AGENT_ALLOWED_ORIGINS") or "").split(",")
            if o.strip()
        ],
        session_token=env.get("CLAUDE_AGENT_TOKEN") or secrets.token_hex(32),
        claude_command=env.get("CLAUDE_AGENT_COMMAND", "claude"),
        claude_args=[a for a in (env.get("CLAUDE_AGENT_ARGS") or "").split(" ") if a],
        max_sessions=int(env.get("CLAUDE_AGENT_MAX_SESSIONS", "4") or 4),
        session_grace_seconds=int(env.get("CLAUDE_AGENT_SESSION_GRACE_MS", "120000") or 120000) / 1000.0,
        scrollback_chars=int(env.get("CLAUDE_AGENT_SCROLLBACK_CHARS", "200000") or 200000),
    )


# ---------------------------------------------------------------------------
# セキュリティ
# ---------------------------------------------------------------------------

def is_loopback_host(host: str) -> bool:
    return host in ("127.0.0.1", "::1", "localhost")


def is_origin_allowed(origin, allowed_origins) -> bool:
    """Origin 検証。Origin 無し(ブラウザ以外)は許可。allowed 指定時はそのリスト。
    未指定時は localhost 系のみ許可。"""
    if not origin:
        return True
    if allowed_origins:
        return origin in allowed_origins
    try:
        host = urlsplit(origin).hostname
    except ValueError:
        return False
    return host in ("127.0.0.1", "::1", "localhost")


def safe_compare(a, b) -> bool:
    return secrets.compare_digest(str(a), str(b))


def claude_available(command: str) -> bool:
    return shutil.which(command) is not None


_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def sanitize_session_id(raw):
    """クライアント指定の再接続キーの形式検証。認可情報ではない
    （token は引き続き必須）。想定外の形式・長さだけ弾く。"""
    return raw if isinstance(raw, str) and _SESSION_ID_RE.match(raw) else None


def generate_session_id() -> str:
    return "sess-" + secrets.token_hex(12)


# ---------------------------------------------------------------------------
# PTY セッション
# ---------------------------------------------------------------------------

def sanitize_dim(value, default: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return min(max(n, 1), 1000)


def set_winsize(fd: int, cols, rows) -> None:
    c = sanitize_dim(cols, 80)
    r = sanitize_dim(rows, 24)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))


class PtySession:
    """1 つの PTY セッション（＝1 つの Claude Code プロセス）。

    WebSocket 接続の寿命とは独立して生存する。attach/detach で「現在どの
    接続に出力を届けるか」を切り替えられるため、ブラウザのリロードや瞬断が
    あっても Claude Code プロセス自体は生き続け、再接続時に同じセッションへ
    再アタッチしてスクロールバックを復元できる（agent.py 側で制御）。
    読み取り・出力配送は生成時に自前で開始する（特定の connection に依存しない）。
    """

    def __init__(self, command, args, cwd, env, cols, rows, scrollback_chars=200000):
        self.master_fd, slave_fd = pty.openpty()
        # 起動に失敗しても openpty の fd を必ず解放する（例: claude 未検出で Popen が例外）。
        try:
            set_winsize(self.master_fd, cols, rows)
            self.proc = subprocess.Popen(
                [command, *args],
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=cwd,
                env=env,
                start_new_session=True,  # 子プロセスグループを分離しまとめて kill 可能に
                close_fds=True,
            )
        except BaseException:
            os.close(self.master_fd)
            os.close(slave_fd)
            raise
        os.close(slave_fd)
        os.set_blocking(self.master_fd, False)
        self.pid = self.proc.pid
        self._closed = False
        self.current_connection = None
        self._scrollback_chars = scrollback_chars
        self._buffer = ""
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self._exit_callbacks = []
        self._loop = asyncio.get_running_loop()
        self._out_queue: asyncio.Queue = asyncio.Queue()
        self._loop.add_reader(self.master_fd, self._on_readable)
        self._pump_task = asyncio.create_task(self._pump())

    def _on_readable(self):
        try:
            data = os.read(self.master_fd, 65536)
        except OSError:
            data = b""
        self._out_queue.put_nowait(data if data else None)
        if not data:
            try:
                self._loop.remove_reader(self.master_fd)
            except (OSError, ValueError):
                pass

    async def _pump(self):
        while True:
            data = await self._out_queue.get()
            if data is None:  # EOF = プロセス終了
                code = self.proc.poll()
                if code is None:
                    code = await self._loop.run_in_executor(None, self.proc.wait)
                self._closed = True
                for cb in list(self._exit_callbacks):
                    await cb(code)
                return
            text = self._decoder.decode(data)
            self._append_buffer(text)
            if self.current_connection is not None:
                await send_msg(self.current_connection, {"type": "output", "data": text})

    def on_exit(self, cb) -> None:
        self._exit_callbacks.append(cb)

    def _append_buffer(self, text: str) -> None:
        self._buffer += text
        limit = self._scrollback_chars
        if len(self._buffer) > limit:
            self._buffer = self._buffer[-limit:]

    def get_buffer(self) -> str:
        return self._buffer

    async def attach(self, connection) -> None:
        """connection を現在の出力先にする。既に別の接続がアタッチ中なら、
        理由を通知したうえで切断する（1 つの PTY に同時アタッチできるのは 1 接続のみ）。

        新しい接続を「先に」current_connection へ確定させてから、旧接続を await で
        閉じる。逆順にすると、await previous.close() がイベントループへ制御を返す
        隙に旧接続側の finally（detach）が先に走り、current_connection がまだ旧接続の
        ままなので誤って None にされ、「誰もアタッチしていない」と判定されて
        使用中のセッションに猶予キルが仕掛けられてしまう（実際に発生した競合状態）。
        """
        previous = self.current_connection
        self.current_connection = connection
        if previous is not None and previous is not connection:
            await send_msg(previous, {"type": "status", "state": "replaced"})
            try:
                await previous.close()
            except Exception:
                pass

    def detach(self, connection) -> None:
        if self.current_connection is connection:
            self.current_connection = None

    def write(self, data) -> None:
        if self._closed:
            return
        payload = data.encode("utf-8") if isinstance(data, str) else data
        try:
            os.write(self.master_fd, payload)
        except OSError:
            pass

    def resize(self, cols, rows) -> None:
        if self._closed:
            return
        try:
            set_winsize(self.master_fd, cols, rows)
        except OSError:
            pass

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._loop.remove_reader(self.master_fd)
        except (OSError, ValueError):
            pass
        self._pump_task.cancel()
        try:
            os.killpg(os.getpgid(self.pid), signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass
        try:
            os.close(self.master_fd)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# サーバ（HTTP: health/status, WebSocket: /terminal）
# ---------------------------------------------------------------------------

def json_response(status: int, body: dict, origin, config: Config) -> Response:
    payload = json.dumps(body).encode("utf-8")
    headers = Headers()
    headers["Content-Type"] = "application/json; charset=utf-8"
    headers["Content-Length"] = str(len(payload))
    if origin and is_origin_allowed(origin, config.allowed_origins):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    reason = {200: "OK", 404: "Not Found"}.get(status, "OK")
    return Response(status, reason, headers, payload)


def make_process_request(config: Config, sessions: dict):
    """アップグレード前に HTTP 応答と WS の認可を行う。"""

    def process_request(connection, request):
        split = urlsplit(request.path)
        path = split.path
        origin = request.headers.get("Origin")

        if path == "/health":
            return json_response(
                200,
                {
                    "status": "ok",
                    "claudeAvailable": claude_available(config.claude_command),
                    "activeSessions": len(sessions),
                },
                origin,
                config,
            )

        if path == "/status":
            return json_response(
                200,
                {
                    "status": "ok",
                    "host": config.host,
                    "port": config.port,
                    "workingDir": config.working_dir,
                    "maxSessions": config.max_sessions,
                    "activeSessions": len(sessions),
                    "claudeAvailable": claude_available(config.claude_command),
                },
                origin,
                config,
            )

        if path == "/terminal":
            if not is_origin_allowed(origin, config.allowed_origins):
                return connection.respond(403, "Forbidden")
            token = parse_qs(split.query).get("token", [None])[0]
            if not token or not safe_compare(token, config.session_token):
                return connection.respond(401, "Unauthorized")
            # 既存セッションへの再接続は新規プロセスを作らないため、上限カウントに含めない。
            requested_id = sanitize_session_id(parse_qs(split.query).get("session", [None])[0])
            will_reattach = requested_id is not None and requested_id in sessions
            if not will_reattach and len(sessions) >= config.max_sessions:
                return connection.respond(503, "Service Unavailable")
            return None  # 認可 OK → WS ハンドシェイクへ進む

        return connection.respond(404, "Not Found")

    return process_request


async def send_msg(connection, obj: dict) -> None:
    try:
        await connection.send(json.dumps(obj))
    except Exception:
        pass


def make_handler(config: Config, sessions: dict):
    """認可済みの /terminal 接続を処理する。

    sessions は session_id -> {"pty": PtySession, "grace_task": asyncio.Task|None}。
    同じ session_id で再接続した場合は新しい claude プロセスを起動せず、既存 PTY に
    再アタッチしてスクロールバックを再送する。
    """

    async def handler(connection):
        split = urlsplit(connection.request.path)
        if split.path != "/terminal":
            return

        query = parse_qs(split.query)
        cols = sanitize_dim(query.get("cols", [80])[0], 80)
        rows = sanitize_dim(query.get("rows", [24])[0], 24)
        requested_id = sanitize_session_id(query.get("session", [None])[0])
        session_id = requested_id or generate_session_id()

        entry = sessions.get(session_id)
        if entry is not None:
            # 再接続: 既存 PTY（＝既存の claude プロセス）に再アタッチする。
            grace_task = entry.get("grace_task")
            if grace_task is not None:
                grace_task.cancel()
                entry["grace_task"] = None
            pty_session = entry["pty"]
            await pty_session.attach(connection)
            await send_msg(
                connection,
                {"type": "status", "state": "connected", "pid": pty_session.pid,
                 "sessionId": session_id, "resumed": True},
            )
            buffered = pty_session.get_buffer()
            if buffered:
                await send_msg(connection, {"type": "output", "data": buffered})
            pty_session.resize(cols, rows)
        else:
            env = dict(os.environ)
            env["TERM"] = "xterm-256color"
            env["COLORTERM"] = "truecolor"
            try:
                pty_session = PtySession(
                    config.claude_command, config.claude_args, config.working_dir, env,
                    cols, rows, config.scrollback_chars,
                )
            except Exception as exc:  # noqa: BLE001 - 起動失敗はクライアントへ通知
                await send_msg(
                    connection,
                    {"type": "error", "message": f"Failed to launch Claude Code: {exc}"},
                )
                return

            entry = {"pty": pty_session, "grace_task": None}
            sessions[session_id] = entry
            await pty_session.attach(connection)
            await send_msg(
                connection,
                {"type": "status", "state": "connected", "pid": pty_session.pid,
                 "sessionId": session_id, "resumed": False},
            )

            async def on_exit(exit_code):
                if pty_session.current_connection is not None:
                    await send_msg(
                        pty_session.current_connection,
                        {"type": "exit", "exitCode": exit_code, "signal": None},
                    )
                    try:
                        await pty_session.current_connection.close()
                    except Exception:
                        pass
                pending = sessions.get(session_id, {}).get("grace_task")
                if pending is not None:
                    pending.cancel()
                sessions.pop(session_id, None)

            pty_session.on_exit(on_exit)

        try:
            async for raw in connection:
                try:
                    msg = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                mtype = msg.get("type")
                if mtype == "input" and isinstance(msg.get("data"), str):
                    pty_session.write(msg["data"])
                elif mtype == "resize":
                    pty_session.resize(msg.get("cols"), msg.get("rows"))
                elif mtype == "ping":
                    await send_msg(connection, {"type": "pong"})
        finally:
            pty_session.detach(connection)
            live_entry = sessions.get(session_id)
            # takeover（別接続が同じセッションへ先に再接続済み）の場合、detach() は
            # no-op になり pty_session.current_connection は新しい接続のままになる。
            # その場合ここで猶予タイマーを仕掛けると、使用中のセッションを後から
            # 誤って kill してしまうため、本当に誰もアタッチしていない時だけ行う。
            if live_entry is not None and pty_session.current_connection is None:
                async def grace_kill():
                    try:
                        await asyncio.sleep(config.session_grace_seconds)
                    except asyncio.CancelledError:
                        return
                    pty_session.close()
                    sessions.pop(session_id, None)

                live_entry["grace_task"] = asyncio.create_task(grace_kill())

    return handler


async def amain() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(here, ".env"))
    config = load_config()
    sessions: dict = {}  # session_id -> {"pty": PtySession, "grace_task": asyncio.Task|None}

    logging.getLogger("websockets.server").addFilter(_SuppressIntentionalHTTP())

    handler = make_handler(config, sessions)
    process_request = make_process_request(config, sessions)

    line = "─" * 46
    print(line)
    print(" Claude Code Local Agent (Python)")
    print(line)
    print(f" HTTP      : http://{config.host}:{config.port}")
    print(f" WebSocket : ws://{config.host}:{config.port}/terminal")
    print(f" Work dir  : {config.working_dir}")
    print(
        " Claude    : "
        + ("available" if claude_available(config.claude_command) else "not found (install / log in required)")
    )
    if not is_loopback_host(config.host):
        print(" Warning   : bound to a non-localhost address. Do not use on a public network.")
    print("")
    print(" Session token (set this in the frontend):")
    print(f"   {config.session_token}")
    print(line)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    async with serve(handler, config.host, config.port, process_request=process_request):
        await stop.wait()
        print("\nShutting down...")
        # 猶予期間を待たず、生存中の全 PTY(claude プロセス)を即終了する。
        # このプロセス自体が終わるため、猶予後の再アタッチは起こり得ない。
        for entry in list(sessions.values()):
            grace_task = entry.get("grace_task")
            if grace_task is not None:
                grace_task.cancel()
            entry["pty"].close()
        sessions.clear()


def main() -> None:
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
