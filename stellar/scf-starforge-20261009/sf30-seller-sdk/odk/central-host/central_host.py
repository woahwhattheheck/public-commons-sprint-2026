#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Operate the released ODK Central stack through its original Docker Compose source.

Python standard library; Docker Engine, Compose >=2.24.4, git and openssl on the
selected host. Runtime files stay private. This module does not submit forms.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

SCHEMA = "stellar-forge.odk-central-host.v1"
SOURCE = {
    "repository": "https://github.com/getodk/central.git",
    "release": "v2026.3.1",
    "commit": "7d6de621955c5bb6a68e098ca10c9cbb92285cdf",
    "backend_commit": "de0d2a07fd7c9ff698cbc312e550dd40ff058340",
    "compose_blob": "b93ddbcfa31ac590cf962a856e0c6aef9cae175f",
}
VOLUME_KEYS = ("postgres14", "secrets", "enketo_redis_main", "enketo_redis_cache")
SERVICE_KEYS = ("postgres", "postgres14", "mail", "pyxform", "secrets", "enketo_redis_main",
                "enketo_redis_cache", "enketo", "service", "nginx")
PUBLIC_ENV = {"EMAIL_FROM", "EMAIL_HOST", "EMAIL_PORT", "EMAIL_SECURE",
              "EMAIL_IGNORE_TLS", "EMAIL_USER", "SESSION_LIFETIME", "DB_POOL_SIZE",
              "SERVICE_NODE_OPTIONS"}
SECRET_ENV = {"EMAIL_PASSWORD"}
ENV_NAME = re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$")
NAME = re.compile(r"^[a-z][a-z0-9_-]{1,47}$")
KNOWN_CONFIG = {"schema", "operation_id", "directory", "checkout", "compose_project",
                "mode", "domain", "url", "http_port", "https_port", "bind_address",
                "sysadmin_email", "auth_env", "admin", "tls", "environment",
                "secret_environment", "backup_passphrase_env", "connection_name"}

def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_identity(path):
    path = Path(path)
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as inp:
        for block in iter(lambda: inp.read(1024 * 1024), b""):
            h.update(block)
            size += len(block)
    return {"filename": path.name, "bytes": size, "sha256": h.hexdigest()}

def load_json(path):
    return json.loads(Path(path).read_text("utf-8"))

def private_dir(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Use a real, private directory: " + str(path))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir() or path.stat().st_mode & 0o077:
        raise ValueError("The operation directory must be mode 0700: " + str(path))
    return path.resolve()

def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def atomic_bytes(path, data, *, exact=False):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Refusing a symbolic-link output: " + str(path))
    if exact and path.exists():
        if path.read_bytes() != data:
            raise ValueError("The original output has different bytes: " + str(path))
        return
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            os.fchmod(out.fileno(), 0o600)
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        if exact:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.read_bytes() != data:
                    raise ValueError("A different original output already exists: " + str(path))
            os.unlink(temporary)
        else:
            os.replace(temporary, path)
        fsync_dir(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def atomic_json(path, value, *, exact=False):
    atomic_bytes(path, canonical(value), exact=exact)

def secret(name):
    if not isinstance(name, str) or not ENV_NAME.fullmatch(name):
        raise ValueError("Use an environment reference name.")
    value = os.environ.get(name)
    if value is None or not value or "\x00" in value or "\r" in value or "\n" in value:
        raise ValueError("Set the selected nonempty secret on this host: " + name)
    return value

def validate_config(raw):
    if not isinstance(raw, dict) or raw.get("schema") != SCHEMA:
        raise ValueError("Use the original Central host configuration schema.")
    unknown = set(raw) - KNOWN_CONFIG
    if unknown:
        raise ValueError("Unknown host configuration fields: " + ", ".join(sorted(unknown)))
    c = dict(raw)
    for key in ("directory", "checkout"):
        if not isinstance(c.get(key), str) or not Path(c[key]).is_absolute():
            raise ValueError(key + " must be an explicitly selected absolute path.")
        c[key] = str(Path(c[key]).absolute())
    if Path(c["checkout"]) == Path(c["directory"]):
        raise ValueError("Keep original checkout and private runtime directories separate.")
    if not NAME.fullmatch(str(c.get("compose_project", ""))):
        raise ValueError("Choose a distinct lowercase Docker Compose project name.")
    if not isinstance(c.get("operation_id"), str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", c["operation_id"]):
        raise ValueError("Retain a stable original operation_id.")
    c.setdefault("mode", "local")
    if c["mode"] not in ("local", "customssl", "letsencrypt", "upstream"):
        raise ValueError("mode must be local, customssl, letsencrypt or upstream.")
    c.setdefault("domain", "localhost" if c["mode"] == "local" else "")
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?", c["domain"]):
        raise ValueError("Use the selected bare DNS hostname.")
    c["domain"] = c["domain"].lower()
    if c["mode"] == "local" and c["domain"] != "localhost":
        raise ValueError("Local receiving uses the original localhost identity.")
    if c["mode"] != "local" and ("." not in c["domain"] or c["domain"] in ("127.0.0.1", "localhost")):
        raise ValueError("A deployed Central instance needs its selected DNS hostname.")
    c.setdefault("http_port", 8080 if c["mode"] == "local" else 80)
    c.setdefault("https_port", 8443 if c["mode"] == "local" else 443)
    for key in ("http_port", "https_port"):
        if not isinstance(c[key], int) or isinstance(c[key], bool) or not 1 <= c[key] <= 65535:
            raise ValueError("Use an integer TCP port for " + key)
    if c["http_port"] == c["https_port"]:
        raise ValueError("HTTP and HTTPS ports must differ.")
    c.setdefault("bind_address", "127.0.0.1" if c["mode"] in ("local", "upstream") else "0.0.0.0")
    if c["bind_address"] not in ("127.0.0.1", "0.0.0.0"):
        raise ValueError("Select bind_address 127.0.0.1 or 0.0.0.0.")
    if c["mode"] in ("local", "upstream") and c["bind_address"] != "127.0.0.1":
        raise ValueError("Local and upstream-proxy listeners bind only to loopback.")
    expected = "https://" + c["domain"] + ("" if c["https_port"] == 443 else ":" + str(c["https_port"])) + "/"
    c.setdefault("url", expected)
    parsed = urllib.parse.urlsplit(c["url"])
    if parsed.scheme != "https" or parsed.hostname != c["domain"] or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("Use the exact HTTPS origin for this Central hostname.")
    if (parsed.port or 443) != c["https_port"]:
        raise ValueError("url port must match the external https_port.")
    c["url"] = expected
    if c["mode"] == "letsencrypt" and (c["http_port"], c["https_port"]) != (80, 443):
        raise ValueError("Original Let's Encrypt installation requires ports 80 and 443.")
    email = c.get("sysadmin_email", "")
    if not isinstance(email, str) or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("Provide the actual selected system administrator email.")
    c.setdefault("auth_env", "ODK_CENTRAL_AUTHORIZATION")
    c.setdefault("backup_passphrase_env", "ODK_CENTRAL_BACKUP_PASSPHRASE")
    for key in ("auth_env", "backup_passphrase_env"):
        if not ENV_NAME.fullmatch(str(c[key])):
            raise ValueError(key + " must be an environment reference.")
    admin = c.get("admin")
    if admin is not None:
        if set(admin) != {"email", "password_env"} or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", str(admin.get("email", ""))):
            raise ValueError("admin has email and password_env fields.")
        if not ENV_NAME.fullmatch(str(admin["password_env"])):
            raise ValueError("admin.password_env must name its host secret.")
    for key, allowed in (("environment", PUBLIC_ENV), ("secret_environment", SECRET_ENV)):
        c.setdefault(key, {})
        if not isinstance(c[key], dict) or set(c[key]) - allowed:
            raise ValueError("Unsupported original " + key + " setting.")
    for key, value in c["environment"].items():
        if not isinstance(value, (str, int)) or isinstance(value, bool) or any(x in str(value) for x in ("\r", "\n", "\x00")):
            raise ValueError("Use a literal value for " + key)
    for value in c["secret_environment"].values():
        if not ENV_NAME.fullmatch(str(value)):
            raise ValueError("Private environment values must be named references.")
    tls = c.get("tls", {})
    if c["mode"] == "customssl":
        if set(tls) - {"fullchain", "private_key", "ca"} or not all(Path(tls.get(k, "")).is_absolute() for k in ("fullchain", "private_key")):
            raise ValueError("Select existing absolute fullchain and private_key paths.")
    elif tls and (c["mode"] != "upstream" or set(tls) != {"ca"} or not Path(tls["ca"]).is_absolute()):
        raise ValueError("Only a private upstream-proxy CA may be selected here.")
    c.setdefault("tls", {})
    c.setdefault("connection_name", "Central " + c["compose_project"])
    return c

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Central returned an unexpected redirect; retain the selected origin.")

class Host:
    def __init__(self, config):
        self.c = validate_config(config)
        self.root = Path(self.c["directory"])
        self.checkout = Path(self.c["checkout"])
        self.state_path = self.root / "operation.json"
        self.lockfile = None
        self.s = None

    def enter(self):
        private_dir(self.root)
        self.lockfile = (self.root / "operation.lock").open("a+b")
        try:
            fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lockfile.close()
            raise ValueError("The original Central host operation is already active.")
        selected = digest(canonical(self.c))
        if self.state_path.exists():
            self.s = load_json(self.state_path)
            if self.s.get("config_sha256") != selected or self.s.get("operation_id") != self.c["operation_id"]:
                raise ValueError("Retain the original host configuration and operation identity.")
        else:
            self.s = {"schema": SCHEMA + ".operation", "operation_id": self.c["operation_id"],
                      "config_sha256": selected, "source": SOURCE, "created_at": now(),
                      "phase": "SELECTED", "commands": [], "snapshots": []}
            self.save()
        return self

    def close(self):
        if self.lockfile:
            fcntl.flock(self.lockfile, fcntl.LOCK_UN)
            self.lockfile.close()
            self.lockfile = None

    def save(self, **changes):
        self.s.update(changes)
        self.s["updated_at"] = now()
        atomic_json(self.state_path, self.s)

    def run(self, argv, *, data=None, output=None, env=None, timeout=1800, record=True):
        # Commands contain no credential values. Child input and output are private.
        inherited = set(PUBLIC_ENV) | set(SECRET_ENV) | {
            "DOMAIN", "SYSADMIN_EMAIL", "SSL_TYPE", "HTTP_PORT", "HTTPS_PORT",
            "FRONTEND_BUILD_MODE", "PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD",
            "PGAPPNAME", "DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSL",
            "S3_SERVER", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET_NAME",
            "OIDC_ENABLED", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET",
            "SENTRY_KEY", "SENTRY_PROJECT", "SENTRY_ORG_SUBDOMAIN", "SENTRY_TRACE_RATE",
            "SENTRY_DSN_FRONTEND"}
        chosen = {k: v for k, v in os.environ.items()
                  if k not in inherited and not k.startswith("COMPOSE_")}
        chosen["COMPOSE_PARALLEL_LIMIT"] = "1"
        if env:
            chosen.update(env)
        label = "%04d" % (len(self.s["commands"]) + 1)
        errpath = self.root / ("command-" + label + ".stderr")
        outpath = Path(output) if output else self.root / ("command-" + label + ".stdout")
        if outpath.exists():
            raise ValueError("Preserve existing command output: " + str(outpath))
        entry = {"id": label, "argv": [str(x) for x in argv], "started_at": now(),
                 "stdout": str(outpath), "stderr": str(errpath), "status": "RUNNING"}
        if record:
            self.s["commands"].append(entry)
            self.save()
        try:
            with outpath.open("xb") as out, errpath.open("xb") as err:
                os.chmod(outpath, 0o600)
                os.chmod(errpath, 0o600)
                source = data if hasattr(data, "read") else subprocess.PIPE if data is not None else subprocess.DEVNULL
                child = subprocess.Popen([str(x) for x in argv], cwd=self.checkout if self.checkout.exists() else self.root,
                                         stdin=source, stdout=out, stderr=err, env=chosen)
                entry["pid"] = child.pid
                if record:
                    self.save()
                try:
                    child.communicate(input=data if isinstance(data, bytes) else None, timeout=timeout)
                except subprocess.TimeoutExpired:
                    child.terminate()
                    try:
                        child.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
                    raise TimeoutError("The selected native command exceeded its timeout.")
                out.flush()
                err.flush()
                os.fsync(out.fileno())
                os.fsync(err.fileno())
                entry.update(ended_at=now(), exit_code=child.returncode,
                             status="COMPLETED" if child.returncode == 0 else "FAILED")
            entry["stdout_file"] = file_identity(outpath)
            entry["stderr_file"] = file_identity(errpath)
            if child.returncode:
                raise RuntimeError("Native command failed; read private " + str(errpath))
            return outpath.read_bytes() if output is None else outpath
        except BaseException as exc:
            entry.update(status="FAILED", ended_at=now(), error=type(exc).__name__)
            raise
        finally:
            if record:
                self.save()

    def compose(self, *args, **kwargs):
        return self.run(["docker", "compose", "--project-name", self.c["compose_project"],
                         "--project-directory", str(self.checkout),
                         "--env-file", str(self.root / "runtime.env"),
                         "-f", str(self.checkout / "docker-compose.yml"),
                         "-f", str(self.root / "host.override.yml"), *args], **kwargs)

    def versions(self):
        docker = json.loads(self.run(["docker", "version", "--format", "{{json .Server}}"]))
        compose = self.run(["docker", "compose", "version", "--short"]).decode().strip()
        match = re.search(r"(\d+)\.(\d+)\.(\d+)", compose)
        if not match or tuple(map(int, match.groups())) < (2, 24, 4):
            raise ValueError("Use Docker Compose >=2.24.4 for original-list replacement (!override).")
        info = json.loads(self.run(["docker", "info", "--format", "{{json .}}"]))
        return {"docker": docker.get("Version"), "compose": compose,
                "architecture": info.get("Architecture"), "cpus": info.get("NCPU"),
                "memory_bytes": info.get("MemTotal"), "docker_root": info.get("DockerRootDir"),
                "runtime_available_bytes": shutil.disk_usage(self.root).free}

    def verify_source(self):
        head = self.run(["git", "-C", str(self.checkout), "rev-parse", "HEAD"]).decode().strip()
        backend = self.run(["git", "-C", str(self.checkout / "server"), "rev-parse", "HEAD"]).decode().strip()
        dirty = self.run(["git", "-C", str(self.checkout), "status", "--porcelain", "--untracked-files=no"]).decode()
        backend_dirty = self.run(["git", "-C", str(self.checkout / "server"), "status", "--porcelain", "--untracked-files=no"]).decode()
        if head != SOURCE["commit"] or backend != SOURCE["backend_commit"] or dirty or backend_dirty:
            raise ValueError("Use the exact clean released Central and backend checkout.")
        compose_blob = self.run(["git", "-C", str(self.checkout), "hash-object", "docker-compose.yml"]).decode().strip()
        if compose_blob != SOURCE["compose_blob"]:
            raise ValueError("The native Compose source changed.")
        return {"commit": head, "backend_commit": backend, "compose_blob": compose_blob}

    def acquire_source(self):
        if not self.checkout.exists():
            self.checkout.parent.mkdir(parents=True, exist_ok=True)
            self.run(["git", "clone", "--no-checkout", SOURCE["repository"], str(self.checkout)])
            self.run(["git", "-C", str(self.checkout), "checkout", "--detach", SOURCE["commit"]])
            self.run(["git", "-C", str(self.checkout), "submodule", "update", "--init", "--recursive"])
        return self.verify_source()

    def local_tls(self):
        folder = private_dir(self.root / "tls")
        pki = private_dir(self.root / "pki")
        final = folder / "tls.json"
        if final.exists():
            selected = load_json(final)
            for name, expected in selected["files"].items():
                if file_identity(folder / name) != expected:
                    raise ValueError("The original local receiving TLS identity changed.")
            return folder
        # Each completed original key/certificate is reused after an interruption.
        # The CA private key stays outside the directory mounted by nginx.
        if not (pki / "ca.key").exists():
            self.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
                      "-out", str(pki / "ca.key")])
        self.run(["openssl", "pkey", "-in", str(pki / "ca.key"), "-noout"])
        if not (pki / "ca.pem").exists():
            self.run(["openssl", "req", "-x509", "-new", "-key", str(pki / "ca.key"),
                      "-out", str(pki / "ca.pem"), "-days", "365",
                      "-subj", "/CN=Central local receiving CA",
                      "-addext", "basicConstraints=critical,CA:TRUE",
                      "-addext", "keyUsage=critical,keyCertSign,cRLSign"])
        self.run(["openssl", "x509", "-in", str(pki / "ca.pem"), "-noout", "-checkend", "0"])
        atomic_bytes(folder / "ca.pem", (pki / "ca.pem").read_bytes(), exact=True)
        if not (folder / "privkey.pem").exists():
            self.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
                      "-out", str(folder / "privkey.pem")])
        self.run(["openssl", "pkey", "-in", str(folder / "privkey.pem"), "-noout"])
        if not (pki / "server.csr").exists():
            self.run(["openssl", "req", "-new", "-key", str(folder / "privkey.pem"),
                      "-out", str(pki / "server.csr"), "-subj", "/CN=localhost"])
        ext = b"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n"
        atomic_bytes(pki / "server.ext", ext, exact=True)
        if not (pki / "server.pem").exists():
            self.run(["openssl", "x509", "-req", "-in", str(pki / "server.csr"),
                      "-CA", str(pki / "ca.pem"), "-CAkey", str(pki / "ca.key"),
                      "-CAcreateserial", "-out", str(pki / "server.pem"), "-days", "365",
                      "-sha256", "-extfile", str(pki / "server.ext")])
        self.run(["openssl", "verify", "-CAfile", str(pki / "ca.pem"),
                  "-verify_hostname", "localhost", str(pki / "server.pem")])
        atomic_bytes(folder / "fullchain.pem", (pki / "server.pem").read_bytes() + (pki / "ca.pem").read_bytes(), exact=True)
        for directory in (folder, pki):
            for path in directory.iterdir():
                if path.is_file():
                    os.chmod(path, 0o600)
        atomic_json(final, {"schema": SCHEMA + ".local-tls", "created_at": now(),
                           "files": {p.name: file_identity(p) for p in folder.iterdir() if p.is_file()}}, exact=True)
        return folder

    def runtime_env(self):
        c = self.c
        values = {"DOMAIN": c["domain"], "SYSADMIN_EMAIL": c["sysadmin_email"],
                  "SSL_TYPE": "customssl" if c["mode"] == "local" else c["mode"],
                  "HTTP_PORT": str(c["http_port"]), "HTTPS_PORT": str(c["https_port"]),
                  "FRONTEND_BUILD_MODE": "fetch"}
        values.update({k: str(v) for k, v in c["environment"].items()})
        values.update({k: secret(ref) for k, ref in c["secret_environment"].items()})
        # Compose double quotes use JSON-compatible escapes; $$ retains a literal dollar.
        def quote(value):
            return json.dumps(value.replace("$", "$$"), ensure_ascii=False)
        return "".join(k + "=" + quote(v) + "\n" for k, v in sorted(values.items())).encode()

    def override(self, images=None):
        c = self.c
        ports = [c["bind_address"] + ":" + str(c["http_port"]) + ":80"]
        if c["mode"] != "upstream":
            ports.append(c["bind_address"] + ":" + str(c["https_port"]) + ":443")
        lines = ["services:", "  service:",
                 "    env_file: !override [" + json.dumps(str(self.root / "runtime.env")) + "]",
                 "    environment:", '      SENTRY_KEY: ""', '      SENTRY_PROJECT: ""',
                 '      SENTRY_ORG_SUBDOMAIN: ""', '      SENTRY_TRACE_RATE: "0"',
                 "  nginx:", "    ports: !override " + json.dumps(ports),
                 "    environment:", '      SENTRY_DSN_FRONTEND: ""']
        if c["mode"] in ("local", "customssl"):
            tls = self.root / "tls"
            lines.extend(["    volumes:",
                          "      - type: bind",
                          "        source: " + json.dumps(str(tls)),
                          "        target: /etc/customssl/live/local",
                          "        read_only: true"])
        if images:
            # One mapping per service; append image pins to their existing mapping.
            parsed = {"service": [], "nginx": []}
            for service, iid in images.items():
                if service not in SERVICE_KEYS or not re.fullmatch(r"sha256:[0-9a-f]{64}", iid):
                    raise ValueError("Invalid original runtime image selection.")
                parsed.setdefault(service, []).extend(["    image: " + json.dumps(iid),
                                                      "    build: !reset null", "    pull_policy: never"])
            result, current = [], None
            for line in lines:
                if re.fullmatch(r"  [a-z0-9_]+:", line):
                    if current:
                        result.extend(parsed.pop(current, []))
                    current = line.strip()[:-1]
                result.append(line)
            if current:
                result.extend(parsed.pop(current, []))
            for service, addition in parsed.items():
                result.extend(["  " + service + ":", *addition])
            lines = result
        return ("\n".join(lines) + "\n").encode()

    def prepare(self):
        runtime = self.versions()
        source = self.acquire_source()
        if self.c["mode"] == "local":
            self.local_tls()
        elif self.c["mode"] == "customssl":
            private_dir(self.root / "tls")
            for source_key, output in (("fullchain", "fullchain.pem"), ("private_key", "privkey.pem")):
                atomic_bytes(self.root / "tls" / output, Path(self.c["tls"][source_key]).read_bytes(), exact=True)
            if self.c["tls"].get("ca"):
                atomic_bytes(self.root / "tls" / "ca.pem", Path(self.c["tls"]["ca"]).read_bytes(), exact=True)
        env_path = self.root / "runtime.env"
        if self.s.get("runtime_env_file"):
            if file_identity(env_path) != self.s["runtime_env_file"]:
                raise ValueError("The original private runtime configuration changed.")
        else:
            atomic_bytes(env_path, self.runtime_env(), exact=True)
            self.save(runtime_env_file=file_identity(env_path))
        atomic_bytes(self.root / "host.override.yml", self.override(self.s.get("restored_images")), exact=True)
        atomic_json(self.root / "selection.json", self.c, exact=True)
        # Expanded config is private command output; only service/volume names enter the handover.
        config = json.loads(self.compose("config", "--format", "json"))
        if set(VOLUME_KEYS) - set(config.get("volumes", {})):
            raise ValueError("The original four Central volume definitions are incomplete.")
        if set(SERVICE_KEYS) - set(config.get("services", {})):
            raise ValueError("The original Central service definitions are incomplete.")
        for key in ("PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"):
            expected = {"PGHOST": "postgres14", "PGDATABASE": "odk", "PGUSER": "odk", "PGPASSWORD": "odk"}[key]
            if str(config["services"]["service"].get("environment", {}).get(key)) != expected:
                raise ValueError("This complete host profile uses the native bundled PostgreSQL instance.")
        if config["services"]["service"].get("environment", {}).get("S3_SERVER"):
            raise ValueError("Select the original local attachment store for this complete host profile.")
        self.save(phase="PREPARED", runtime=runtime, verified_source=source)
        return {"phase": self.s["phase"], "runtime": runtime, "source": source}

    def containers(self):
        raw = self.compose("ps", "--all", "--format", "json").decode().strip()
        if not raw:
            return []
        items = json.loads(raw) if raw.startswith("[") else [json.loads(line) for line in raw.splitlines()]
        return [{"id": x.get("ID"), "service": x.get("Service"), "state": x.get("State"),
                 "health": x.get("Health"), "exit_code": x.get("ExitCode"),
                 "name": x.get("Name")} for x in items]

    def image_selection(self):
        result = {}
        for service in SERVICE_KEYS:
            ids = self.compose("images", "--quiet", service).decode().split()
            ids = list(dict.fromkeys(ids))
            if len(ids) != 1:
                raise ValueError("Retain one original image for service " + service)
            info = json.loads(self.run(["docker", "image", "inspect", ids[0]]))[0]
            result[service] = info["Id"]
        return result

    def build(self):
        self.prepare()
        if self.s.get("images"):
            for iid in set(self.s["images"].values()):
                self.run(["docker", "image", "inspect", "--format", "{{.Id}}", iid])
            return {"images": self.s["images"], "reused": True}
        self.compose("pull", "--ignore-buildable", timeout=3600)
        self.compose("build", timeout=7200)
        # Original Compose creates short-lived secrets alongside persistent services.
        self.compose("create", "--no-build")
        images = self.image_selection()
        self.save(phase="IMAGES_READY", images=images)
        return {"images": images, "reused": False}

    def ssl_context(self):
        ca = self.root / "tls" / "ca.pem"
        custom = self.c["tls"].get("ca")
        return ssl.create_default_context(cafile=str(ca if ca.exists() else custom) if ca.exists() or custom else None)

    def auth_value(self):
        retained = self.root / "connection-secret.json"
        external = os.environ.get(self.c["auth_env"])
        if external:
            return secret(self.c["auth_env"])
        if retained.exists():
            value = load_json(retained)
            if set(value) != {self.c["auth_env"]}:
                raise ValueError("The retained original connection secret reference changed.")
            return value[self.c["auth_env"]]
        if self.c.get("admin"):
            admin = self.c["admin"]
            return "Basic " + base64.b64encode((admin["email"] + ":" + secret(admin["password_env"])).encode()).decode()
        raise ValueError("Set the original Central authorization environment reference.")

    def http(self, path, *, auth=False, body=None, target=None, timeout=120):
        origin = self.c["url"]
        url = urllib.parse.urljoin(origin, path)
        if urllib.parse.urlsplit(url).netloc != urllib.parse.urlsplit(origin).netloc:
            raise ValueError("The request left the selected Central origin.")
        headers = {"Accept": "application/json"}
        if auth:
            headers["Authorization"] = self.auth_value()
        data = None if body is None else canonical(body)
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method="GET" if data is None else "POST")
        opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=self.ssl_context()))
        with opener.open(req, timeout=timeout) as response:
            receipt = {"url": url, "status": response.status, "at": now(),
                       "content_type": response.headers.get("Content-Type"),
                       "content_length": response.headers.get("Content-Length")}
            h, count = hashlib.sha256(), 0
            if target:
                if Path(target).exists():
                    raise ValueError("Keep the original backup output: " + str(target))
                with Path(target).open("xb") as out:
                    os.chmod(target, 0o600)
                    for chunk in iter(lambda: response.read(1024 * 1024), b""):
                        count += len(chunk)
                        h.update(chunk)
                        out.write(chunk)
                    out.flush()
                    os.fsync(out.fileno())
                content = None
            else:
                content = response.read(8 * 1024 * 1024 + 1)
                if len(content) > 8 * 1024 * 1024:
                    raise ValueError("The selected metadata response exceeded 8 MiB.")
                h.update(content)
                count = len(content)
            if receipt["content_length"] and int(receipt["content_length"]) != count:
                raise ValueError("The original response ended before its full Content-Length.")
            return content, {**receipt, "bytes": count, "sha256": h.hexdigest()}

    def check(self, authenticated=False):
        data, version_receipt = self.http("version.txt")
        text = data.decode("utf-8")
        if SOURCE["commit"] not in text or SOURCE["backend_commit"] not in text:
            raise RuntimeError("The running Central version does not match the selected source.")
        record = {"url": self.c["url"], "version": text, "version_receipt": version_receipt,
                  "containers": self.containers(), "checked_at": now()}
        if authenticated:
            raw, receipt = self.http("v1/users/current", auth=True)
            user = json.loads(raw)
            raw, project_receipt = self.http("v1/projects", auth=True)
            projects = json.loads(raw)
            if not isinstance(projects, list):
                raise ValueError("Central returned an invalid original project collection.")
            record.update(user={"id": user.get("id"), "email": user.get("email")},
                          user_receipt=receipt, project_receipt=project_receipt,
                          project_count=len(projects), project_ids=[x["id"] for x in projects])
        return record

    def start(self):
        self.prepare()
        if not self.s.get("images"):
            self.build()
        self.compose("up", "--detach", "--no-build")
        deadline = time.monotonic() + 600
        error = None
        while time.monotonic() < deadline:
            try:
                record = self.check()
                self.save(phase="RUNNING", running=record)
                return record
            except (OSError, ValueError, urllib.error.URLError) as exc:
                error = type(exc).__name__
                time.sleep(2)
        raise TimeoutError("Central did not return its original version within ten minutes: " + str(error))

    def bootstrap(self):
        self.start()
        try:
            result = self.check(authenticated=True)
        except urllib.error.HTTPError as exc:
            if exc.code != 401 or not self.c.get("admin"):
                raise
            admin = self.c["admin"]
            # This is ODK's original account task, fed through private stdin.
            js = ("const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));"
                  "process.argv[1]='/usr/odk/lib/bin/cli.js';"
                  "const {run}=require('./lib/task/task');"
                  "const {createUser}=require('./lib/task/account');run(createUser(p.email,p.password));")
            self.compose("exec", "-T", "service", "node", "-e", js,
                         data=canonical({"email": admin["email"], "password": secret(admin["password_env"])}))
            result = self.check(authenticated=True)
        if self.c.get("admin"):
            admin = self.c["admin"]
            if result["user"]["email"] != admin["email"]:
                raise ValueError("The authenticated identity differs from the selected bootstrap administrator.")
            try:
                self.http("v1/users", auth=True)
            except urllib.error.HTTPError as exc:
                if exc.code != 403:
                    raise
                self.compose("exec", "-T", "service", "odk-cmd", "--email", admin["email"], "user-promote")
                self.http("v1/users", auth=True)
                result = self.check(authenticated=True)
        atomic_json(self.root / "connection-secret.json", {self.c["auth_env"]: self.auth_value()}, exact=True)
        connection = {"id": self.c["compose_project"], "name": self.c["connection_name"],
                      "url": self.c["url"], "authEnv": self.c["auth_env"], "allowLoopback": False}
        atomic_json(self.root / "connection.json", connection, exact=True)
        self.save(phase="AUTHENTICATED", authenticated=result, connection=connection)
        return {"connection": connection, "service": result,
                "private_environment_file": str(self.root / "connection-secret.json"),
                "node_extra_ca_certs": str(self.root / "tls" / "ca.pem") if self.c["mode"] == "local" else self.c["tls"].get("ca")}

    def stop(self):
        before = self.containers()
        self.compose("stop", "--timeout", "60")
        after = self.containers()
        if any(x["state"] == "running" for x in after):
            raise RuntimeError("A selected Central container is still running.")
        self.save(phase="STOPPED", stopped_at=now())
        return {"before": before, "after": after, "stopped_at": self.s["stopped_at"]}

    def volume_selection(self):
        raw = self.run(["docker", "volume", "ls", "--filter",
                        "label=com.docker.compose.project=" + self.c["compose_project"],
                        "--format", "{{json .}}"]).decode()
        found = [json.loads(line) for line in raw.splitlines() if line.strip()]
        by_name = {}
        for name in [x["Name"] for x in found]:
            value = json.loads(self.run(["docker", "volume", "inspect", name]))[0]
            labels = value.get("Labels") or {}
            key = labels.get("com.docker.compose.volume")
            if key in VOLUME_KEYS:
                by_name[name] = {"name": name, "key": key, "labels": labels,
                                 "driver": value.get("Driver"), "bindings": []}
        # Include image-declared anonymous volumes (for example original nginx
        # certificate state and the legacy upgrade volume), not only named data.
        for container in self.containers():
            value = json.loads(self.run(["docker", "inspect", container["id"]]))[0]
            for mount in value.get("Mounts", []):
                if mount.get("Type") != "volume":
                    continue
                name = mount["Name"]
                if name not in by_name:
                    volume = json.loads(self.run(["docker", "volume", "inspect", name]))[0]
                    by_name[name] = {"name": name, "key": None,
                                     "labels": volume.get("Labels") or {},
                                     "driver": volume.get("Driver"), "bindings": []}
                by_name[name]["bindings"].append({"service": container["service"],
                                                   "target": mount["Destination"],
                                                   "read_only": not mount.get("RW", False)})
        result = {}
        for info in by_name.values():
            info["bindings"].sort(key=lambda x: (x["service"], x["target"]))
            key = info.pop("key")
            if key is None:
                key = "auxiliary_" + digest(canonical(info["bindings"]))[:20]
            if key in result:
                raise ValueError("Ambiguous original persistent volume " + key)
            if info["driver"] != "local" or not info["bindings"]:
                raise ValueError("Use the native local volumes attached to this selected Compose project.")
            result[key] = info
        if set(VOLUME_KEYS) - set(result):
            raise ValueError("Retain all four original Central data volumes before snapshotting.")
        return result

    def snapshot(self, out, include_images=False):
        folder = private_dir(out)
        if any(folder.iterdir()):
            complete = folder / "snapshot.json"
            if complete.exists():
                record = load_json(complete)
                if record.get("operation_id") != self.c["operation_id"]:
                    raise ValueError("Snapshot belongs to another original operation.")
                for entry in record["files"]:
                    if file_identity(folder / entry["filename"]) != entry:
                        raise ValueError("The complete original snapshot changed.")
                if record["running_services"]:
                    self.compose("up", "--detach", "--no-build", *record["running_services"])
                reopened = self.check(authenticated=True)
                self.save(phase="AUTHENTICATED", authenticated=reopened)
                return record
            raise ValueError("Retain and inspect the incomplete snapshot directory.")
        service = self.check(authenticated=True)
        password = secret(self.c["backup_passphrase_env"])
        # Original streamed API backup, then full stopped-service volume state.
        partial = folder / "database.pgdump.enc.bin.partial"
        _, receipt = self.http("v1/backup", auth=True, body={"passphrase": password}, target=partial, timeout=3600)
        verify_js = ("const {pipeline}=require('node:stream/promises');"
                     "const {spawn}=require('node:child_process');"
                     "const p=spawn('/bin/bash',['-c','set -o pipefail; openssl enc -d -chacha20 -pbkdf2 -pass env:ODK_BACKUP_PASSPHRASE | pg_restore --exit-on-error --file /dev/null'],"
                     "{stdio:['pipe','pipe','inherit']});pipeline(process.stdin,p.stdin).catch(()=>{});"
                     "p.stdout.resume();p.on('exit',c=>{process.exitCode=c===0?0:1;});")
        with partial.open("rb") as inp:
            self.compose("exec", "-T", "-e", "ODK_BACKUP_PASSPHRASE", "service", "node", "-e", verify_js,
                         data=inp, env={"ODK_BACKUP_PASSPHRASE": password}, timeout=3600)
        os.rename(partial, folder / "database.pgdump.enc.bin")
        volumes = self.volume_selection()
        running = [x["service"] for x in self.containers() if x["state"] == "running"]
        images = self.image_selection()
        stopped = False
        record = None
        try:
            self.compose("stop", "--timeout", "60")
            stopped = True
            if any(x["state"] == "running" for x in self.containers()):
                raise ValueError("A selected service still writes to the snapshot volumes.")
            for key, info in volumes.items():
                part = folder / (key + ".tar.partial")
                self.run(["docker", "run", "--rm", "--network", "none", "--user", "0:0",
                          "--volume", info["name"] + ":/source:ro",
                          "--entrypoint", "/bin/tar", images["service"],
                          "-cpf", "-", "-C", "/source", "."], output=part, timeout=3600)
                os.rename(part, folder / (key + ".tar"))
            atomic_bytes(folder / "runtime.env", (self.root / "runtime.env").read_bytes(), exact=True)
            atomic_json(folder / "host-selection.json", self.c, exact=True)
            for subfolder in ("tls", "pki"):
                source_folder = self.root / subfolder
                if source_folder.is_dir():
                    for path in sorted(source_folder.iterdir()):
                        if path.is_file() and not path.is_symlink():
                            atomic_bytes(folder / (subfolder + "-" + path.name), path.read_bytes(), exact=True)
            if (self.root / "connection-secret.json").exists():
                atomic_bytes(folder / "connection-secret.json", (self.root / "connection-secret.json").read_bytes(), exact=True)
            if include_images:
                part = folder / "native-images.tar.partial"
                self.run(["docker", "image", "save", *sorted(set(images.values()))], output=part, timeout=7200)
                os.rename(part, folder / "native-images.tar")
            record = {"schema": SCHEMA + ".snapshot", "operation_id": self.c["operation_id"],
                      "source": SOURCE, "created_at": now(), "service_at_backup": service,
                      "database_backup_receipt": receipt, "volumes": volumes, "images": images,
                      "running_services": running, "configuration_sha256": self.s["config_sha256"],
                      "files": [file_identity(p) for p in sorted(folder.iterdir()) if p.is_file()],
                      "data_storage": "original bundled PostgreSQL; original local attachments",
                      "web_form_state": "original Enketo Redis volumes and secrets volume",
                      "private": True}
            atomic_json(folder / "snapshot.json", record, exact=True)
            self.s["snapshots"].append({"directory": str(folder), **file_identity(folder / "snapshot.json")})
            self.save()
        finally:
            if stopped and running:
                self.compose("up", "--detach", "--no-build", *running)
        if record:
            reopened = self.check(authenticated=True)
            atomic_json(folder / "source-reopened.json", reopened, exact=True)
            self.save(phase="AUTHENTICATED", authenticated=reopened)
        return record

    def restore(self, snapshot_path):
        """Restore only into a new, unused Compose project; original instance is preserved."""
        folder = Path(snapshot_path).resolve()
        record = load_json(folder / "snapshot.json")
        if record.get("schema") != SCHEMA + ".snapshot" or record.get("source") != SOURCE:
            raise ValueError("Use a complete original snapshot for this released Central source.")
        origin = load_json(folder / "host-selection.json")
        if self.c["compose_project"] == origin["compose_project"] or Path(self.c["directory"]).resolve() == Path(origin["directory"]).resolve():
            raise ValueError("Restore into a separately selected new project and runtime directory.")
        for entry in record["files"]:
            path = folder / entry["filename"]
            if path.parent != folder or path.is_symlink() or file_identity(path) != entry:
                raise ValueError("The exact original snapshot file is missing or changed.")
        if self.s.get("restored_from"):
            expected = file_identity(folder / "snapshot.json")
            if self.s["restored_from"] != expected:
                raise ValueError("This receiver already holds another snapshot.")
            self.start()
            return self.check(authenticated=True)
        ids = self.run(["docker", "ps", "-aq", "--filter",
                        "label=com.docker.compose.project=" + self.c["compose_project"]]).decode().split()
        vols = self.run(["docker", "volume", "ls", "-q", "--filter",
                         "label=com.docker.compose.project=" + self.c["compose_project"]]).decode().split()
        intent = self.s.get("restore_intent")
        expected_snapshot = file_identity(folder / "snapshot.json")
        if intent is None:
            if ids or vols:
                raise ValueError("The selected restore destination already has containers or volumes; inspect its original operation.")
            intent = {"snapshot": expected_snapshot, "selected_at": now(), "volumes": {}, "completed_volumes": []}
            self.save(restore_intent=intent)
        elif intent["snapshot"] != expected_snapshot:
            raise ValueError("Continue the same original snapshot selection in this receiver.")
        elif any(x["state"] == "running" for x in self.containers()):
            raise ValueError("An incomplete restore destination has running services; preserve its state for inspection.")
        self.prepare()
        if (folder / "native-images.tar").exists():
            self.run(["docker", "image", "load", "--input", str(folder / "native-images.tar")], timeout=7200)
        for iid in set(record["images"].values()):
            self.run(["docker", "image", "inspect", "--format", "{{.Id}}", iid])
        self.save(restored_images=record["images"])
        atomic_bytes(self.root / "host.override.yml", self.override(record["images"]))
        self.compose("create", "--no-build")
        destination = self.volume_selection()
        if set(destination) != set(record["volumes"]):
            raise ValueError("The restored native persistent mount roster differs from the source.")
        for key, info in destination.items():
            if info["bindings"] != record["volumes"][key]["bindings"]:
                raise ValueError("The original persistent mount binding changed: " + key)
        if set(v["name"] for v in destination.values()) & set(v["name"] for v in record["volumes"].values()):
            raise ValueError("Restore volumes alias the live original source.")
        if intent["volumes"] and intent["volumes"] != destination:
            raise ValueError("The original unused restore volume identities changed.")
        intent["volumes"] = destination
        self.save(restore_intent=intent)
        for key, info in destination.items():
            if key in intent["completed_volumes"]:
                continue
            # This receiver was empty at the recorded original selection and has never started.
            # Reapplying a interrupted tar fills that same unused volume with the same exact bytes.
            with (folder / (key + ".tar")).open("rb") as inp:
                self.run(["docker", "run", "--rm", "--network", "none", "--user", "0:0",
                          "--volume", info["name"] + ":/destination", "--entrypoint", "/bin/tar",
                          record["images"]["service"], "-xpf", "-", "-C", "/destination"],
                         data=inp, timeout=3600)
            intent["completed_volumes"].append(key)
            self.save(restore_intent=intent)
        if (folder / "connection-secret.json").exists():
            inherited = load_json(folder / "connection-secret.json")
            if origin["auth_env"] not in inherited:
                raise ValueError("Original authentication reference is incomplete.")
            atomic_json(self.root / "connection-secret.json",
                        {self.c["auth_env"]: inherited[origin["auth_env"]]}, exact=True)
        self.save(phase="RESTORED", images=record["images"],
                  restored_from=file_identity(folder / "snapshot.json"),
                  restored_source_operation=record["operation_id"])
        self.start()
        received = self.check(authenticated=True)
        if sorted(received["project_ids"], key=str) != sorted(record["service_at_backup"]["project_ids"], key=str):
            raise ValueError("The restored native project roster differs; inspect the retained source and target.")
        atomic_json(self.root / "restore-result.json",
                    {"schema": SCHEMA + ".restore", "source": file_identity(folder / "snapshot.json"),
                     "destination": self.c["compose_project"], "received": received, "at": now()}, exact=True)
        connection = {"id": self.c["compose_project"], "name": self.c["connection_name"],
                      "url": self.c["url"], "authEnv": self.c["auth_env"], "allowLoopback": False}
        atomic_json(self.root / "connection.json", connection, exact=True)
        self.save(phase="AUTHENTICATED", authenticated=received, connection=connection)
        return received

    def handover(self):
        received = self.check(authenticated=True)
        result = {"schema": SCHEMA + ".handover", "operation_id": self.c["operation_id"],
                  "source": SOURCE, "url": self.c["url"], "mode": self.c["mode"],
                  "version": received["version"], "observed_at": received["checked_at"],
                  "compose_project": self.c["compose_project"], "runtime": self.s.get("runtime"),
                  "connection": self.s.get("connection"),
                  "container_states": received["containers"],
                  "backup_count": len(self.s["snapshots"]),
                  "restore": self.s.get("restored_from"),
                  "receiving_operation": "Continue the original selected product fixture and driver."}
        atomic_json(self.root / "handover.json", result)
        return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Original private host selection JSON.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "build", "start", "bootstrap", "status", "stop", "handover"):
        sub.add_parser(name)
    snap = sub.add_parser("snapshot")
    snap.add_argument("--out", required=True)
    snap.add_argument("--include-images", action="store_true")
    restore = sub.add_parser("restore")
    restore.add_argument("--snapshot", required=True)
    args = parser.parse_args(argv)
    os.umask(0o077)
    host = Host(load_json(args.config)).enter()
    try:
        if args.command == "status":
            result = {"operation": host.s, "containers": host.containers()}
        elif args.command == "snapshot":
            result = host.snapshot(args.out, args.include_images)
        elif args.command == "restore":
            result = host.restore(args.snapshot)
        else:
            result = getattr(host, args.command)()
        # Public stdout excludes the private journal and secret files.
        if args.command == "status":
            result = {"operation_id": host.c["operation_id"], "phase": host.s["phase"],
                      "source": SOURCE, "containers": result["containers"],
                      "last_command": {k: host.s["commands"][-1].get(k) for k in ("id", "status", "exit_code", "ended_at")}
                      if host.s["commands"] else None}
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except BaseException as exc:
        host.save(last_error={"type": type(exc).__name__, "message": str(exc), "at": now()})
        print(json.dumps({"operation_id": host.c["operation_id"], "error": type(exc).__name__,
                          "message": str(exc), "private_record": str(host.state_path)}), file=sys.stderr)
        return 1
    finally:
        host.close()

if __name__ == "__main__":
    raise SystemExit(main())
