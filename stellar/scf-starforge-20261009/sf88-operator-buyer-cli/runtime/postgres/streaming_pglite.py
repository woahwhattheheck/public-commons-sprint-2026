"""Run PGlite behind a local socket with native streaming COPY.

PostgreSQL blocks in its wire-read callback in a separate Node process. This
broker remains responsive and forwards client packets and engine results without
rewriting either. Each client retains the single backend until native rollback
and session reset have completed.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import platform
import select
import shutil
import socket
import struct
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import zipfile

from native_postgres import DRIVER_WHEELS, _download, _quote_dsn

PGLITE_PACKAGE = {
    "name": "@electric-sql/pglite",
    "version": "0.5.8",
    "url": "https://registry.npmjs.org/@electric-sql/pglite/-/pglite-0.5.8.tgz",
    "integrity": "sha512-n9tsbUOhwx2epK1V0ZG9Ar4SHWUju04dhmzZXiSBXwBoleOvIfals33NAaWgagQVAL4Rbvx/Ptsu3P+pA09f6Q==",
}
FRAME_LIMIT = 65536
NODE_MEMORY_FLAGS = ("--max-old-space-size=128", "--max-semi-space-size=4", "--liftoff-only")


def _read_exact(stream, length, deadline=None):
    result = bytearray()
    fd = stream.fileno()
    while len(result) < length:
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([fd], [], [], remaining)[0]:
                raise TimeoutError("PGLITE_WORKER_RESPONSE_TIMEOUT")
        chunk = os.read(fd, length - len(result))
        if not chunk:
            raise EOFError("PGLITE_WORKER_PIPE_CLOSED")
        result.extend(chunk)
    return bytes(result)


def _read_frame(stream, deadline=None):
    header = _read_exact(stream, 5, deadline)
    size = struct.unpack("!I", header[1:])[0]
    if size > FRAME_LIMIT:
        raise RuntimeError("PGLITE_WORKER_FRAME_TOO_LARGE")
    return chr(header[0]), _read_exact(stream, size, deadline)


class StreamingPGlite:
    """Own the runtime, private socket and orderly PostgreSQL restart.

    A context normally owns and removes its temporary database. An explicit
    data_directory survives cleanup and must be controlled by the caller.
    Never point it at another running/shared PostgreSQL data directory.
    """

    def __init__(self, *, temporary_parent=None, data_directory=None, node=None, node_arguments=None, transport="unix", startup_timeout=90):
        if sys.version_info[:2] != (3, 12) or sys.platform != "linux" or platform.machine() != "x86_64":
            raise RuntimeError("PGLITE_DRIVER_REQUIRES_LINUX_X64_PYTHON312")
        if transport not in {"unix", "loopback"}:
            raise ValueError("PGLITE_TRANSPORT_INVALID")
        self.transport = transport
        self.temporary_parent = temporary_parent
        self.data_directory = Path(data_directory).resolve() if data_directory is not None else None
        self.node = node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
        if not self.node:
            raise RuntimeError("PGLITE_NODE_RUNTIME_MISSING")
        self.node_arguments = tuple(NODE_MEMORY_FLAGS if node_arguments is None else node_arguments)
        self.startup_timeout = startup_timeout
        self.server = self.listener = self.client = self.broker = self.temporary = self.log = None
        self.failure = None
        self.stop_requested = threading.Event()
        self.write_lock = threading.Lock()
        self.starts, self.stops, self.sessions, self.downloads, self.exits = [], [], [], [], []

    def __enter__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pglite-stream-", dir=self.temporary_parent)
        self.base = Path(self.temporary.name)
        self.base.chmod(0o700)
        try:
            self._restore()
            self.data = self.data_directory or self.base / "database"
            self.data.mkdir(mode=0o700, parents=True, exist_ok=True)
            self.socket_directory = self.base / "socket"
            self.socket_directory.mkdir(mode=0o700)
            self.socket_path = self.socket_directory / ".s.PGSQL.5432"
            if self.transport == "unix" and len(os.fsencode(self.socket_path)) >= 108:
                raise ValueError("PGLITE_UNIX_SOCKET_PATH_TOO_LONG")
            self.environment = {**os.environ, "PGUSER": "postgres", "PGDATABASE": "postgres", "PGSSLMODE": "disable",
                "PGGSSENCMODE": "disable", "PYTHONDONTWRITEBYTECODE": "1"}
            for name in ("PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS", "PGHOSTADDR"):
                self.environment.pop(name, None)
            self.environment["PYTHONPATH"] = str(self.driver) + (":" + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else "")
            self.start()
            return self
        except BaseException:
            self.__exit__(*sys.exc_info())
            raise

    def _restore(self):
        package = self.base / "pglite-package"
        package.mkdir(mode=0o700)
        archive = self.base / "pglite.tgz"
        self.downloads.append(_download(PGLITE_PACKAGE["url"], archive, "sha512",
            PGLITE_PACKAGE["integrity"].split("-", 1)[1], limit=30_000_000))
        with tarfile.open(archive, "r:gz") as bundle:
            members = bundle.getmembers()
            if sum(member.size for member in members) > 80_000_000 or len(members) > 2000:
                raise RuntimeError("PGLITE_PACKAGE_UNPACKED_SIZE_LIMIT")
            if any(member.name.split("/", 1)[0] != "package" for member in members):
                raise RuntimeError("PGLITE_PACKAGE_ROOT_INVALID")
            bundle.extractall(package, filter="data")
        archive.unlink()
        self.package = package / "package"
        self.driver = self.base / "driver"
        self.driver.mkdir(mode=0o700)
        for index, (url, expected) in enumerate(DRIVER_WHEELS):
            wheel = self.base / ("driver-" + str(index) + ".whl")
            self.downloads.append(_download(url, wheel, "sha256", expected, limit=6_000_000))
            with zipfile.ZipFile(wheel) as bundle:
                if any(Path(name).is_absolute() or ".." in Path(name).parts for name in bundle.namelist()):
                    raise RuntimeError("PGLITE_DRIVER_WHEEL_PATH_INVALID")
                bundle.extractall(self.driver)
            wheel.unlink()

    def _write_frame(self, kind, data=b""):
        if len(data) > FRAME_LIMIT:
            raise RuntimeError("PGLITE_BROKER_FRAME_TOO_LARGE")
        packet = kind.encode("ascii") + struct.pack("!I", len(data)) + data
        with self.write_lock:
            if self.server is None or self.server.stdin is None:
                raise RuntimeError("PGLITE_WORKER_NOT_RUNNING")
            view = memoryview(packet)
            while view:
                count = os.write(self.server.stdin.fileno(), view)
                if not count:
                    raise EOFError("PGLITE_WORKER_PIPE_WRITE_ZERO")
                view = view[count:]

    def _read_client(self, client, errors):
        try:
            while data := client.recv(FRAME_LIMIT):
                self._write_frame("D", data)
        except (OSError, EOFError, RuntimeError) as error:
            errors.append(str(error))
        finally:
            try:
                self._write_frame("E")
            except (OSError, EOFError, RuntimeError) as error:
                errors.append(str(error))

    @staticmethod
    def _close_client(client):
        try:
            client.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def _serve(self):
        try:
            while not self.stop_requested.is_set():
                try:
                    client, _ = self.listener.accept()
                except OSError:
                    if self.stop_requested.is_set():
                        return
                    raise
                self.client = client
                input_errors = []
                incoming = threading.Thread(target=self._read_client, args=(client, input_errors),
                    name="pglite-client-input", daemon=True)
                incoming.start()
                try:
                    while True:
                        kind, data = _read_frame(self.server.stdout)
                        if kind == "D":
                            try:
                                client.sendall(data)
                            except OSError:
                                self._close_client(client)
                        elif kind == "C":
                            self._close_client(client)
                        elif kind == "A":
                            self.sessions.append(json.loads(data))
                            break
                        elif kind == "F":
                            raise RuntimeError("PGLITE_NATIVE_FAILURE: " + data.decode("utf8"))
                        else:
                            raise RuntimeError("PGLITE_UNEXPECTED_CLIENT_FRAME_" + kind)
                finally:
                    self._close_client(client)
                    incoming.join(timeout=5)
                    client.close()
                    self.client = None
                    if incoming.is_alive():
                        raise RuntimeError("PGLITE_CLIENT_INPUT_DID_NOT_STOP")
                if input_errors and self.server.poll() is not None:
                    raise RuntimeError("PGLITE_WORKER_DIED: " + "; ".join(input_errors))
        except BaseException as error:
            self.failure = error
            self.stop_requested.set()
            if self.listener is not None:
                try:
                    self.listener.close()
                except OSError:
                    pass

    def _open_listener(self):
        domain = socket.AF_UNIX if self.transport == "unix" else socket.AF_INET
        listener = socket.socket(domain, socket.SOCK_STREAM)
        try:
            if self.transport == "unix":
                listener.bind(str(self.socket_path))
                os.chmod(self.socket_path, 0o700)
                address, port = str(self.socket_directory), "5432"
            else:
                listener.bind(("127.0.0.1", 0))
                address, number = listener.getsockname()
                port = str(number)
            listener.listen(16)
        except BaseException:
            listener.close()
            raise
        self.listener = listener
        self.environment.update(PGHOST=address, PGPORT=port)
        self.environment["SF_BUYER_POSTGRES_DSN"] = " ".join([
            "host=" + _quote_dsn(address), "port=" + port, "dbname=postgres", "user=postgres",
            "sslmode=disable", "gssencmode=disable",
        ])

    def start(self):
        if self.server is not None:
            raise RuntimeError("PGLITE_ALREADY_STARTED")
        self.failure = None
        self.stop_requested.clear()
        try:
            # Establish the selected supported transport before allocating an engine.
            self._open_listener()
            self.log = (self.base / ("pglite-" + str(len(self.starts)) + ".log")).open("wb")
            worker = Path(__file__).with_name("pglite_stream_worker.mjs")
            self.server = subprocess.Popen([self.node, *self.node_arguments, str(worker), str(self.package), str(self.data)],
                env=self.environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log, bufsize=0,
                start_new_session=True)
            kind, data = _read_frame(self.server.stdout, time.monotonic() + self.startup_timeout)
            if kind == "F":
                raise RuntimeError("PGLITE_STARTUP_FAILED: " + data.decode("utf8"))
            if kind != "R":
                raise RuntimeError("PGLITE_STARTUP_FRAME_" + kind)
            self.starts.append({**json.loads(data), "transport": self.transport})
            self.broker = threading.Thread(target=self._serve, name="pglite-wire-broker", daemon=True)
            self.broker.start()
        except BaseException:
            self._kill_worker()
            if self.listener is not None:
                self.listener.close()
                self.listener = None
            self.socket_path.unlink(missing_ok=True)
            raise

    def run(self, argv, *, timeout=120, extra_environment=None):
        if self.failure is not None:
            raise RuntimeError("PGLITE_BROKER_FAILED: " + str(self.failure))
        if self.server is None or self.server.poll() is not None:
            raise RuntimeError("PGLITE_WORKER_NOT_RUNNING")
        result = subprocess.run(argv, env={**self.environment, **(extra_environment or {})},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
        if self.failure is not None:
            raise RuntimeError("PGLITE_BROKER_FAILED: " + str(self.failure))
        return result

    def _kill_worker(self):
        if self.server is not None and self.server.poll() is None:
            self.server.kill()
            self.server.wait(timeout=10)

    def stop(self):
        server = self.server
        if server is None:
            return
        failure = None
        try:
            self.stop_requested.set()
            if self.listener is not None:
                try:
                    self.listener.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                self.listener.close()
            if self.client is not None:
                self._close_client(self.client)
            if self.broker is not None:
                self.broker.join(timeout=10)
                if self.broker.is_alive():
                    raise RuntimeError("PGLITE_BROKER_STOP_TIMEOUT")
            if self.failure is not None:
                raise RuntimeError("PGLITE_BROKER_FAILED: " + str(self.failure))
            if server.poll() is None:
                self._write_frame("S")
                kind, data = _read_frame(server.stdout, time.monotonic() + 30)
                if kind != "Z":
                    raise RuntimeError("PGLITE_CLOSE_FAILED: " + kind + " " + data.decode("utf8", errors="replace"))
                self.stops.append(json.loads(data))
                server.wait(timeout=10)
            if server.returncode:
                raise RuntimeError("PGLITE_WORKER_EXIT_" + str(server.returncode))
        except BaseException as error:
            failure = error
        finally:
            self._kill_worker()
            self.exits.append(server.returncode)
            if server.stdin is not None:
                server.stdin.close()
            if server.stdout is not None:
                server.stdout.close()
            self.server = self.listener = self.broker = None
            self.socket_path.unlink(missing_ok=True)
            if self.log is not None:
                self.log.close()
                self.log = None
        if failure is not None:
            raise failure

    def restart(self):
        self.stop()
        self.start()

    def __exit__(self, exception_type, exception, traceback):
        try:
            self.stop()
        except BaseException:
            if exception is None:
                raise
        finally:
            if self.log is not None:
                self.log.close()
                self.log = None
            if self.temporary is not None:
                self.temporary.cleanup()
                self.temporary = None
