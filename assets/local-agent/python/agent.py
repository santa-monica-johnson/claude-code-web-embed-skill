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
import secrets
import shutil
import signal
import struct
import subprocess
import termios
from dataclasses import dataclass
from typing import List, Set
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
    """1 つの PTY セッション（＝1 つの Claude Code プロセス）。"""

    def __init__(self, command, args, cwd, env, cols, rows):
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


def make_process_request(config: Config, sessions: Set):
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
            if len(sessions) >= config.max_sessions:
                return connection.respond(503, "Service Unavailable")
            return None  # 認可 OK → WS ハンドシェイクへ進む

        return connection.respond(404, "Not Found")

    return process_request


async def send_msg(connection, obj: dict) -> None:
    try:
        await connection.send(json.dumps(obj))
    except Exception:
        pass


def make_handler(config: Config, sessions: Set):
    """認可済みの /terminal 接続を処理する。"""

    async def handler(connection):
        split = urlsplit(connection.request.path)
        if split.path != "/terminal":
            return

        query = parse_qs(split.query)
        cols = sanitize_dim(query.get("cols", [80])[0], 80)
        rows = sanitize_dim(query.get("rows", [24])[0], 24)

        env = dict(os.environ)
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"

        try:
            session = PtySession(
                config.claude_command, config.claude_args, config.working_dir, env, cols, rows
            )
        except Exception as exc:  # noqa: BLE001 - 起動失敗はクライアントへ通知
            await send_msg(
                connection,
                {"type": "error", "message": f"Failed to launch Claude Code: {exc}"},
            )
            return

        sessions.add(connection)
        loop = asyncio.get_running_loop()
        out_queue: asyncio.Queue = asyncio.Queue()
        fd = session.master_fd

        await send_msg(connection, {"type": "status", "state": "connected", "pid": session.pid})

        # PTY -> キュー（読み取りは loop のリーダーで非ブロッキングに）
        def on_readable():
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            out_queue.put_nowait(data if data else None)
            if not data:
                try:
                    loop.remove_reader(fd)
                except (OSError, ValueError):
                    pass

        loop.add_reader(fd, on_readable)

        # キュー -> WS（順序保持。マルチバイト境界のため逐次デコーダを使用）
        decoder = codecs.getincrementaldecoder("utf-8")("replace")

        async def pump():
            while True:
                data = await out_queue.get()
                if data is None:  # EOF = プロセス終了
                    code = session.proc.poll()
                    if code is None:
                        code = await loop.run_in_executor(None, session.proc.wait)
                    await send_msg(
                        connection, {"type": "exit", "exitCode": code, "signal": None}
                    )
                    await connection.close()
                    return
                await send_msg(connection, {"type": "output", "data": decoder.decode(data)})

        pump_task = asyncio.create_task(pump())

        try:
            async for raw in connection:
                try:
                    msg = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                mtype = msg.get("type")
                if mtype == "input" and isinstance(msg.get("data"), str):
                    session.write(msg["data"])
                elif mtype == "resize":
                    session.resize(msg.get("cols"), msg.get("rows"))
                elif mtype == "ping":
                    await send_msg(connection, {"type": "pong"})
        finally:
            try:
                loop.remove_reader(fd)
            except (OSError, ValueError):
                pass
            pump_task.cancel()
            session.close()
            sessions.discard(connection)

    return handler


async def amain() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(here, ".env"))
    config = load_config()
    sessions: Set = set()

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


def main() -> None:
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
