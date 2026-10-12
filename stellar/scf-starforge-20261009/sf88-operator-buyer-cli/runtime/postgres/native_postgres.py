"""Run an owned native PostgreSQL host from the original pinned Linux package.

The context provides an isolated private Unix socket, Psycopg 3.3.6, explicit
server restart, and complete process cleanup for an existing native operation.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.request import urlopen
import zipfile

POSTGRES_PACKAGE = {
    "name": "@embedded-postgres/linux-x64",
    "version": "18.4.0-beta.17",
    "url": "https://registry.npmjs.org/@embedded-postgres/linux-x64/-/linux-x64-18.4.0-beta.17.tgz",
    "integrity": "sha512-jVw/MdDtIX/vICH/DKIe6/mHpiCggdx6QVyza4vt/NbcZFsL0KhwglF6F1Koqx3gRBZ9XtN+vi63EsqSyqOSxA==",
    "unpacked_bytes": 59216961,
}
DRIVER_WHEELS = (
    ("https://files.pythonhosted.org/packages/4e/de/748bd7609c71cae5d737f0ba9192f19329f70180ecda8fff3cac02c5abe3/psycopg-3.3.6-py3-none-any.whl",
     "a1db9f7148b06a28606767efaca51fa6f9398c5c0a3810519be69d7000bdb631"),
    ("https://files.pythonhosted.org/packages/0a/42/948bb3d2617795093512613fd96ba380e922992c7908fbc073858147d196/psycopg_binary-3.3.6-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
     "1679a1cb93fbe5a6d1fd58d82cbddcc6fcb8c61446ba7cae6eb2a7b19bc585de"),
)


def _download(url, target, algorithm, expected, *, limit=80_000_000):
    checksum, size = hashlib.new(algorithm), 0
    with urlopen(url, timeout=30) as response, target.open("xb") as stream:
        while data := response.read(65536):
            size += len(data)
            if size > limit:
                raise RuntimeError("NATIVE_DOWNLOAD_SIZE_LIMIT")
            checksum.update(data)
            stream.write(data)
    actual = checksum.hexdigest() if algorithm == "sha256" else base64.b64encode(checksum.digest()).decode()
    if actual != expected:
        raise RuntimeError("NATIVE_PACKAGE_DIGEST_MISMATCH")
    return {"url": url, "bytes": size, algorithm: actual}


def _quote_dsn(value):
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


class NativePostgres:
    """Own a temporary PostgreSQL server and provide its native client settings."""

    def __init__(self, *, temporary_parent=None, statement_timeout_ms=300000):
        if platform.system() != "Linux" or platform.machine() != "x86_64" or sys.version_info[:2] != (3, 12):
            raise RuntimeError("NATIVE_RUNTIME_REQUIRES_LINUX_X64_PYTHON312")
        if type(statement_timeout_ms) is not int or not 1 <= statement_timeout_ms <= 3600000:
            raise ValueError("NATIVE_STATEMENT_TIMEOUT_INVALID")
        self.temporary_parent = temporary_parent
        self.statement_timeout_ms = statement_timeout_ms
        self.server = None
        self.server_log = None
        self.temporary = None
        self.downloads = []
        self.starts = []
        self.owner_uid, self.owner_gid = os.getuid(), os.getgid()
        if self.owner_uid == 0:
            account = pwd.getpwnam("nobody")
            self.owner_uid, self.owner_gid = account.pw_uid, account.pw_gid
            for name, identity in (("uid_map", self.owner_uid), ("gid_map", self.owner_gid)):
                ranges = [tuple(map(int, line.split())) for line in Path("/proc/self/" + name).read_text().splitlines()]
                if not any(start <= identity < start + count for start, _, count in ranges):
                    raise RuntimeError("NATIVE_POSTGRES_REQUIRES_EXISTING_NONROOT_IDENTITY")

    def _prepare_child(self, *, database_owner):
        try:
            Path("/proc/self/oom_score_adj").write_text("1000")
        except OSError:
            pass
        if database_owner and os.getuid() == 0:
            os.setgroups([])
            os.setgid(self.owner_gid)
            os.setuid(self.owner_uid)

    def _database_directory(self, name):
        result = self.base / name
        result.mkdir(mode=0o700)
        if os.getuid() == 0:
            os.chown(result, self.owner_uid, self.owner_gid)
        return result

    def __enter__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="native-postgres-", dir=self.temporary_parent)
        self.base = Path(self.temporary.name)
        self.base.chmod(0o711)
        try:
            self._restore()
            self.data = self._database_directory("database")
            self.socket = self._database_directory("socket")
            self.database_tmp = self._database_directory("database-tmp")
            self.environment = {
                **os.environ,
                "LD_LIBRARY_PATH": str(self.native / "lib") + (":" + os.environ["LD_LIBRARY_PATH"] if os.environ.get("LD_LIBRARY_PATH") else ""),
                "TMPDIR": str(self.database_tmp),
                "PGHOST": str(self.socket),
                "PGPORT": "5432",
                "PGUSER": "postgres",
                "PGDATABASE": "postgres",
                "PYTHONDONTWRITEBYTECODE": "1",
            }
            # A private Unix socket is the entire transport; the host has no TCP listener.
            for name in ("PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS", "PGSSLMODE", "PGHOSTADDR"):
                self.environment.pop(name, None)
            self.environment["SF_BUYER_POSTGRES_DSN"] = " ".join([
                "host=" + _quote_dsn(self.socket), "port=5432", "dbname=postgres", "user=postgres",
            ])
            self.environment["PYTHONPATH"] = str(self.driver) + (":" + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else "")
            init = self._command([
                str(self.native / "bin/initdb"), "-D", str(self.data), "-U", "postgres",
                "-A", "trust", "--locale=C", "--encoding=UTF8",
            ], database_owner=True, timeout=60)
            if init.returncode:
                raise RuntimeError("NATIVE_INITDB_FAILED: " + init.stderr[-4000:])
            self.start()
            return self
        except BaseException:
            self.__exit__(*sys.exc_info())
            raise

    def _restore(self):
        package = self.base / "postgres-package"
        package.mkdir(mode=0o755)
        archive = self.base / "postgres.tgz"
        self.downloads.append(_download(POSTGRES_PACKAGE["url"], archive, "sha512", POSTGRES_PACKAGE["integrity"].split("-", 1)[1]))
        with tarfile.open(archive, "r:gz") as bundle:
            members = bundle.getmembers()
            if sum(member.size for member in members) != POSTGRES_PACKAGE["unpacked_bytes"]:
                raise RuntimeError("NATIVE_PACKAGE_UNPACKED_SIZE_CHANGED")
            if any(member.name.split("/", 1)[0] != "package" for member in members):
                raise RuntimeError("NATIVE_PACKAGE_ROOT_INVALID")
            bundle.extractall(package, filter="data")
        archive.unlink()
        self.native = package / "package/native"
        for name in ("postgres", "initdb"):
            if not (self.native / "bin" / name).is_file():
                raise RuntimeError("NATIVE_POSTGRES_PROGRAM_MISSING_" + name)
        self.driver = self.base / "driver"
        self.driver.mkdir(mode=0o700)
        for index, (url, expected) in enumerate(DRIVER_WHEELS):
            wheel = self.base / ("driver-" + str(index) + ".whl")
            self.downloads.append(_download(url, wheel, "sha256", expected, limit=6_000_000))
            with zipfile.ZipFile(wheel) as bundle:
                if any(Path(name).is_absolute() or ".." in Path(name).parts for name in bundle.namelist()):
                    raise RuntimeError("NATIVE_DRIVER_WHEEL_PATH_INVALID")
                bundle.extractall(self.driver)
            wheel.unlink()

    def _command(self, argv, *, database_owner=False, timeout=60, environment=None):
        return subprocess.run(argv, env=self.environment if environment is None else environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout,
            preexec_fn=lambda: self._prepare_child(database_owner=database_owner))

    def start(self):
        if self.server is not None:
            raise RuntimeError("NATIVE_POSTGRES_ALREADY_STARTED")
        self.server_log = (self.base / ("postgres-" + str(len(self.starts)) + ".log")).open("w+")
        args = [str(self.native / "bin/postgres"), "-D", str(self.data), "-k", str(self.socket),
            "-c", "listen_addresses=", "-c", "unix_socket_permissions=0700",
            "-c", "shared_buffers=8MB", "-c", "work_mem=1MB", "-c", "maintenance_work_mem=8MB",
            "-c", "max_connections=10", "-c", "max_worker_processes=0", "-c", "max_parallel_workers=0",
            "-c", "min_wal_size=32MB", "-c", "max_wal_size=64MB",
            "-c", "statement_timeout=" + str(self.statement_timeout_ms)]
        self.server = subprocess.Popen(args, env=self.environment, stdout=self.server_log, stderr=self.server_log,
            start_new_session=True, preexec_fn=lambda: self._prepare_child(database_owner=True))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.server.poll() is not None:
                self.server_log.flush()
                raise RuntimeError("NATIVE_POSTGRES_START_FAILED: " + Path(self.server_log.name).read_text()[-4000:])
            readiness = (
                "import json,os,psycopg; "
                "connection=psycopg.connect(os.environ['SF_BUYER_POSTGRES_DSN'],connect_timeout=1); "
                "version=connection.execute('SELECT version()').fetchone()[0]; "
                "print(json.dumps({'version':version,'driver':psycopg.__version__})); connection.close()"
            )
            ready = self._command([sys.executable, "-c", readiness], timeout=5)
            if ready.returncode == 0:
                self.starts.append({**json.loads(ready.stdout), "pid": self.server.pid})
                return
            time.sleep(0.1)
        raise RuntimeError("NATIVE_POSTGRES_START_TIMEOUT")

    def run(self, argv, *, timeout=120, extra_environment=None):
        if self.server is None or self.server.poll() is not None:
            raise RuntimeError("NATIVE_POSTGRES_NOT_RUNNING")
        environment = {**self.environment, **(extra_environment or {})}
        return self._command(argv, timeout=timeout, environment=environment)

    def stop(self):
        if self.server is None:
            return
        server, self.server = self.server, None
        if server.poll() is None:
            # SIGTERM requests PostgreSQL's native orderly shutdown/checkpoint.
            server.send_signal(signal.SIGTERM)
            try:
                server.wait(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(server.pid, signal.SIGKILL)
                server.wait()
                raise RuntimeError("NATIVE_POSTGRES_SHUTDOWN_TIMEOUT")
        if self.server_log is not None:
            self.server_log.close()
            self.server_log = None
        if server.returncode:
            raise RuntimeError("NATIVE_POSTGRES_EXIT_" + str(server.returncode))

    def restart(self):
        self.stop()
        self.start()

    def __exit__(self, *_):
        try:
            self.stop()
        finally:
            if self.server_log is not None:
                self.server_log.close()
                self.server_log = None
            if self.temporary is not None:
                self.temporary.cleanup()
                self.temporary = None
