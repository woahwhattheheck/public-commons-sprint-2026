#!/usr/bin/env python3
"""Run the original Timescale product on a private, pinned Ubuntu 24.04 runtime.

This is a native demonstration using the explicit example inputs in native-demo.mjs.
Select an existing complete source checkout and existing compatible Node dependency
roots. Run this command under the existing host/swarm_cloud_job.py capacity controls;
the script does not create a scheduler, install a system service, or reserve capacity.
"""
from __future__ import annotations
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import shlex
import socket
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request

PACKAGES = [
    ("postgresql-17", "17.11-1.pgdg24.04+2",
     "https://apt.postgresql.org/pub/repos/apt/pool/main/p/postgresql-17/postgresql-17_17.11-1.pgdg24.04+2_amd64.deb",
     16949784, "d5b58058a82a3f344f832aea2cc54badc4f6265c25c960752cb1f5df5d2180ee"),
    ("postgresql-client-17", "17.11-1.pgdg24.04+2",
     "https://apt.postgresql.org/pub/repos/apt/pool/main/p/postgresql-17/postgresql-client-17_17.11-1.pgdg24.04+2_amd64.deb",
     2052656, "b3b071b67a814a382516d6f6241b529c52f909672457e2f48083acce047b634f"),
    ("libpq5", "18.6-1.pgdg24.04+2",
     "https://apt.postgresql.org/pub/repos/apt/pool/main/p/postgresql-18/libpq5_18.6-1.pgdg24.04+2_amd64.deb",
     264072, "b487c5ed2ceb9244c6a9d6ae65818ed6707c3c44a2e14488394ae4194c52c53b"),
    ("timescaledb-2-loader-postgresql-17", "2.30.2~ubuntu24.04-1711",
     "https://packagecloud.io/timescale/timescaledb/ubuntu/pool/noble/main/t/timescaledb-2-2.30.2-postgresql-17/timescaledb-2-loader-postgresql-17_2.30.2~ubuntu24.04-1711_amd64.deb",
     117574, "f78f16ad56310f874c53d39584d7bbb74aff6aff0e96d5c897c8959f4c275f35"),
    ("timescaledb-2-postgresql-17", "2.30.2~ubuntu24.04-1711",
     "https://packagecloud.io/timescale/timescaledb/ubuntu/pool/noble/main/t/timescaledb-2-postgresql-17/timescaledb-2-postgresql-17_2.30.2~ubuntu24.04-1711_amd64.deb",
     60125092, "b9d52ed9b841ea9d52122a1342391561fc3093ed52eb2b585121b61ce34580b0"),
]
DEPENDENCIES = {
    "pg": "8.23.1", "pg-cursor": "2.22.1",
    "@modelcontextprotocol/sdk": "1.32.1",
    "@x402/core": "2.28.0", "@x402/extensions": "2.28.0",
    "@x402/mcp": "2.28.0", "@x402/stellar": "2.28.0",
    "@stellar/stellar-sdk": "16.3.1", "jose": "6.2.12",
    "re2js": "2.8.6", "yaml": "2.9.1", "graphql": "16.14.2",
}
CORE = "stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale"
MERCHANT = "stellar-forge/mcp-merchant-operator"

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def file_hash(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with Path(path).open("rb") as src:
        for block in iter(lambda: src.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def atomic_json(path, value):
    path = Path(path)
    data = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def member_path(name):
    if name.startswith("./"):
        name = name[2:]
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError("Archive member is outside its selected private root")
    return path

def selected_runtime(name):
    if name in (".", "./"):
        return False
    name = str(member_path(name))
    if name.startswith("usr/lib/postgresql/17/bin/"):
        return True
    if name.startswith("usr/lib/postgresql/17/lib/"):
        tail = name[len("usr/lib/postgresql/17/lib/"):]
        if "/" in tail or tail.startswith("llvmjit"):
            return False
        if tail.startswith("timescaledb"):
            return tail in ("timescaledb.so", "timescaledb-2.30.2.so",
                            "timescaledb-tsl-2.30.2.so")
        return ".so" in tail
    if name.startswith("usr/share/postgresql/17/"):
        tail = name[len("usr/share/postgresql/17/"):]
        if tail.startswith("extension/timescaledb"):
            return tail in ("extension/timescaledb.control",
                            "extension/timescaledb--2.30.2.sql")
        return True
    if name.startswith("usr/lib/x86_64-linux-gnu/libpq.so"):
        return True
    return name.startswith("usr/share/doc/") and name.endswith("/copyright")

def extract_member(archive, member, destination, relative):
    """Extract only a selected ordinary file/link, contained in our own sysroot."""
    relative = member_path(str(relative))
    root = destination.resolve()
    target = destination.joinpath(*relative.parts)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    if not target.parent.resolve().is_relative_to(root):
        raise ValueError("Archive parent resolves outside the private runtime")
    for parent in [target.parent, *target.parent.parents]:
        if not parent.is_relative_to(root):
            break
        parent.chmod(0o755)
    if target.exists() or target.is_symlink():
        if member.isdir() and target.is_dir():
            return None
        raise ValueError("Selected package members overlap: " + str(relative))
    if member.isdir():
        target.mkdir(mode=0o755)
        target.chmod(0o755)
        return None
    if member.isfile():
        src = archive.extractfile(member)
        if src is None:
            raise ValueError("Selected archive file has no body")
        h = hashlib.sha256()
        size = 0
        with src, target.open("xb") as out:
            for block in iter(lambda: src.read(1024 * 1024), b""):
                out.write(block)
                h.update(block)
                size += len(block)
        if size != member.size:
            raise ValueError("Selected archive member is incomplete")
        target.chmod(member.mode & 0o755)
        return {"path": str(relative), "bytes": size, "sha256": h.hexdigest()}
    if member.issym():
        link = member.linkname
        if link.startswith("/"):
            link = os.path.relpath(destination / link.lstrip("/"), target.parent)
        resolved = (target.parent / link).resolve()
        if not resolved.is_relative_to(root):
            raise ValueError("Archive link resolves outside the private runtime")
        target.symlink_to(link)
        return {"path": str(relative), "symlink": link}
    raise ValueError("Unsupported selected runtime archive member: " + str(relative))

def download(url, path, expected_bytes=None, expected_sha256=None):
    h = hashlib.sha256()
    size = 0
    with urllib.request.urlopen(url, timeout=90) as response, path.open("xb") as out:
        for block in iter(lambda: response.read(1024 * 1024), b""):
            out.write(block)
            h.update(block)
            size += len(block)
    if ((expected_bytes is not None and size != expected_bytes) or
            (expected_sha256 is not None and h.hexdigest() != expected_sha256)):
        raise ValueError("Official package size or hash differs")
    return {"bytes": size, "sha256": h.hexdigest()}

def graphql_package(runtime):
    """Fetch only this dependency when absent; no npm install or package scripts."""
    name, version = "graphql", DEPENDENCIES["graphql"]
    metadata_url = "https://registry.npmjs.org/graphql/" + version
    with urllib.request.urlopen(metadata_url, timeout=60) as response:
        metadata = json.load(response)
    if metadata.get("name") != name or metadata.get("version") != version:
        raise ValueError("The selected GraphQL registry version differs")
    distribution = metadata["dist"]
    url = distribution["tarball"]
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "registry.npmjs.org":
        raise ValueError("GraphQL archive must use the original npm registry")
    integrity = distribution.get("integrity", "")
    sha512 = next((v[7:] for v in integrity.split() if v.startswith("sha512-")), None)
    if not sha512:
        raise ValueError("Original GraphQL registry SHA-512 is required")
    archive_path = runtime / "downloads" / "graphql.tgz"
    observed = download(url, archive_path)
    if base64.b64encode(bytes.fromhex(file_hash(archive_path, "sha512"))).decode() != sha512:
        raise ValueError("GraphQL archive integrity differs")
    destination = runtime / "graphql"
    destination.mkdir(mode=0o755)
    members = []
    with tarfile.open(archive_path, "r|gz") as archive:
        for member in archive:
            path = member_path(member.name)
            if not path.parts or path.parts[0] != "package":
                raise ValueError("GraphQL archive has an unexpected root")
            if len(path.parts) == 1:
                continue
            result = extract_member(archive, member, destination,
                                    PurePosixPath(*path.parts[1:]))
            if result:
                members.append(result)
    package = json.loads((destination / "package.json").read_text())
    if package.get("name") != name or package.get("version") != version:
        raise ValueError("Extracted GraphQL identity differs")
    archive_path.unlink()
    return destination, {"registry": metadata_url, "url": url, "integrity": integrity,
                         **observed, "members": members}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True, type=Path)
    parser.add_argument("--source", required=True, help="Exact current checkout commit")
    parser.add_argument("--directory", required=True, type=Path, help="Owned persistent operation directory")
    parser.add_argument("--runtime-directory", required=True, type=Path,
                        help="New private runtime; include its complete growth in admission")
    parser.add_argument("--operation-id", default="TIMESCALE-NATIVE-DBA55-20261012")
    parser.add_argument("--dependency-root", action="append", required=True, type=Path,
                        help="Existing complete compatible node_modules; repeated roots may supply packages")
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--playwright", required=True, type=Path)
    parser.add_argument("--chromium", required=True, type=Path)
    parser.add_argument("--remediation-receiver", type=Path,
                        help="Original complete receiving CLI relative to repository")
    args = parser.parse_args()
    repo = args.repository.resolve(strict=True)
    persist = args.directory.resolve(strict=True)
    runtime = args.runtime_directory.absolute()
    if not repo.is_dir() or not persist.is_dir():
        raise ValueError("Select an existing complete checkout and owned operation directory")
    actual = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    if actual != args.source:
        raise ValueError("Source checkout differs from the selected immutable commit")
    if os.geteuid() != 0:
        raise ValueError("This private Ubuntu bootstrap needs root to run PostgreSQL as uid65534")
    if os.uname().machine != "x86_64":
        raise ValueError("The selected official Ubuntu packages require x86_64")
    release = dict(line.split("=", 1) for line in Path("/etc/os-release").read_text().splitlines()
                   if "=" in line)
    if release.get("ID", "").strip('"') != "ubuntu" or release.get("VERSION_ID", "").strip('"') != "24.04":
        raise ValueError("The pinned native runtime selects Ubuntu 24.04")
    for path in [args.node, args.chromium, repo / CORE / "native-demo.mjs",
                 repo / MERCHANT / "timescale-workspace-native-receiving.mjs"]:
        if not path.is_file():
            raise ValueError("Required original executable is absent: " + str(path))
    if not args.playwright.exists():
        raise ValueError("Select the existing Playwright installation")
    if args.remediation_receiver:
        receiving = (repo / args.remediation_receiver).resolve(strict=True)
        if not receiving.is_relative_to(repo) or not receiving.is_file():
            raise ValueError("Receiving continuation must be an original file in this checkout")
    else:
        receiving = None
    record_path = persist / "host.json"
    prior = json.loads(record_path.read_text()) if record_path.exists() else None
    if prior:
        if prior.get("operation") != args.operation_id:
            raise ValueError("Operation directory belongs to another original request")
        if prior.get("complete"):
            checkpoint = prior.get("checkpoint", {})
            retained = Path(checkpoint.get("path", ""))
            if (prior.get("source") != args.source or
                    prior.get("remediationReceiver") != (str(args.remediation_receiver) if args.remediation_receiver else None)):
                raise ValueError("Original completed source or receiving intent differs")
            if (not retained.is_file() or retained.stat().st_size != checkpoint.get("bytes") or
                    file_hash(retained) != checkpoint.get("sha256")):
                raise ValueError("Original completed checkpoint is absent or changed")
            print(json.dumps({"phase": "ORIGINAL_RESULT_REUSED", "record": str(record_path),
                              "checkpoint": checkpoint}), flush=True)
            return 0
        if prior.get("nativeStarted") or prior.get("nativeDatabaseCreated") or prior.get("checkpoint"):
            raise ValueError("Preserve and restore the original database/checkpoint before continuing its native phases")
        previous_path = persist / ("host-before-setup-" + file_hash(record_path) + ".json")
        if not previous_path.exists():
            with previous_path.open("xb") as out:
                out.write(record_path.read_bytes())
            previous_path.chmod(0o600)
    node_version = subprocess.check_output([str(args.node), "--version"], text=True).strip()
    if not node_version.startswith("v24."):
        raise ValueError("The original source selects installed Node24")
    dependency_selection = {}
    for name, version in DEPENDENCIES.items():
        for dependency_root in args.dependency_root:
            path = dependency_root.resolve(strict=True) / name
            manifest = path / "package.json"
            if manifest.is_file():
                package = json.loads(manifest.read_text())
                if package.get("name") == name and package.get("version") == version:
                    dependency_selection[name] = path.resolve(strict=True)
                    break
        if name not in dependency_selection and name != "graphql":
            raise ValueError("Existing complete dependency is required: " + name + "@" + version)
    if (repo / "node_modules").exists() or (repo / "node_modules").is_symlink():
        raise ValueError("Select an owned checkout without an existing node_modules entry")
    runtime.mkdir(mode=0o755)
    runtime.chmod(0o755)
    for name in ["downloads", "sysroot", "logs", "temporary"]:
        mode = 0o700 if name != "sysroot" else 0o755
        (runtime / name).mkdir(mode=mode)
        (runtime / name).chmod(mode)
    record = {"schema": "stellar-forge.timescale-ubuntu-native-host.v1",
              "operation": args.operation_id, "source": args.source,
              "repository": str(repo), "runtime": str(runtime), "nodeVersion": node_version,
              "remediationReceiver": str(args.remediation_receiver) if args.remediation_receiver else None,
              "createdAt": now(), "packages": [], "dependencies": [],
              "stages": [], "complete": False}
    if prior:
        record["priorSetup"] = {"path": str(previous_path), "sha256": file_hash(previous_path)}
    env = dict(os.environ, TMPDIR=str(runtime / "temporary"))
    prefix = runtime / "sysroot"
    pgbin = prefix / "usr/lib/postgresql/17/bin"
    pg = runtime / "postgres"
    data = pg / "data"
    started = False
    created = False
    port = None
    success = False
    linked_modules = False

    def save():
        atomic_json(runtime / "host.json", record)
        atomic_json(record_path, record)

    def stage(name, state, **details):
        record["stages"].append({"name": name, "state": state, "at": now(), **details})
        save()
        print(json.dumps({"phase": name, "state": state, **details}), flush=True)

    def call(argv, name, timeout=120, **kw):
        log = runtime / "logs" / (name + ".log")
        stage(name, "RUNNING", log=str(log))
        with log.open("wb") as out:
            completed = subprocess.run([str(v) for v in argv], stdout=out,
                                       stderr=subprocess.STDOUT, env=env,
                                       timeout=timeout, **kw)
        stage(name, "COMPLETE" if completed.returncode == 0 else "FAILED",
              exitCode=completed.returncode, log=str(log))
        if completed.returncode:
            with log.open("rb") as src:
                src.seek(max(0, log.stat().st_size - 8000))
                print(src.read().decode(errors="replace"), flush=True)
            raise RuntimeError(name + " failed")

    try:
        save()
        for name, version, url, size, expected in PACKAGES:
            archive_path = runtime / "downloads" / (name + ".deb")
            stage("download-" + name, "RUNNING")
            observed = download(url, archive_path, size, expected)
            item = {"name": name, "version": version, "url": url, **observed, "members": []}
            record["packages"].append(item)
            stage("download-" + name, "COMPLETE", bytes=size, sha256=expected)
            stage("extract-" + name, "RUNNING")
            log = runtime / "logs" / ("extract-" + name + ".log")
            with log.open("wb") as err:
                process = subprocess.Popen(["dpkg-deb", "--fsys-tarfile", str(archive_path)],
                                           stdout=subprocess.PIPE, stderr=err, env=env)
                try:
                    with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
                        for member in archive:
                            if selected_runtime(member.name):
                                value = extract_member(archive, member, prefix, member_path(member.name))
                                if value:
                                    item["members"].append(value)
                    code = process.wait(timeout=120)
                    if code:
                        raise RuntimeError("Official archive stream failed: " + name)
                finally:
                    if process.stdout:
                        process.stdout.close()
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
            archive_path.unlink()
            stage("extract-" + name, "COMPLETE",
                  files=len(item["members"]),
                  extractedBytes=sum(v.get("bytes", 0) for v in item["members"]))
        for relative in ["usr/lib/postgresql/17/lib/timescaledb.so",
                         "usr/lib/postgresql/17/lib/timescaledb-2.30.2.so",
                         "usr/lib/postgresql/17/lib/timescaledb-tsl-2.30.2.so",
                         "usr/share/postgresql/17/extension/timescaledb.control",
                         "usr/share/postgresql/17/extension/timescaledb--2.30.2.sql"]:
            if not (prefix / relative).is_file():
                raise ValueError("Selected official runtime is incomplete: " + relative)
        env["LD_LIBRARY_PATH"] = str(prefix / "usr/lib/x86_64-linux-gnu") + (
            ":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        for name in ["postgres", "psql", "initdb", "pg_ctl"]:
            observed = subprocess.run(["ldd", str(pgbin / name)], capture_output=True,
                                      text=True, env=env, check=True)
            if "not found" in observed.stdout:
                raise ValueError("A native system dependency is missing for " + name)
        call([pgbin / "postgres", "--version"], "postgres-version")
        bridge = runtime / "node_modules"
        bridge.mkdir(mode=0o755)
        stage("existing-dependencies", "RUNNING")
        for name, version in DEPENDENCIES.items():
            selected = dependency_selection.get(name)
            metadata = {}
            if selected is None and name == "graphql":
                selected, metadata = graphql_package(runtime)
            if selected is None:
                raise ValueError("Existing complete dependency is required: " + name + "@" + version)
            link = bridge / name
            link.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            link.symlink_to(selected, target_is_directory=True)
            record["dependencies"].append({"name": name, "version": version,
                "path": str(selected), "manifestSha256": file_hash(selected / "package.json"), **metadata})
        if (repo / "node_modules").exists() or (repo / "node_modules").is_symlink():
            raise ValueError("Select an owned checkout without an existing node_modules entry")
        (repo / "node_modules").symlink_to(bridge, target_is_directory=True)
        linked_modules = True
        stage("existing-dependencies", "COMPLETE", packages=len(record["dependencies"]))
        pg.mkdir(mode=0o700)
        os.chown(pg, 65534, 65534)
        sockets = pg / "socket"
        sockets.mkdir(mode=0o700)
        os.chown(sockets, 65534, 65534)
        password = secrets.token_urlsafe(40)
        pwfile = pg / "password"
        pwfile.write_text(password + "\n")
        pwfile.chmod(0o600)
        os.chown(pwfile, 65534, 65534)
        call([pgbin / "initdb", "-D", data, "-L", prefix / "usr/share/postgresql/17",
              "--username=postgres", "--locale=C.UTF-8", "--encoding=UTF8",
              "--auth-local=trust", "--auth-host=scram-sha-256", "--pwfile=" + str(pwfile)],
             "database-init", user=65534, group=65534)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        options = "-h 127.0.0.1 -p " + str(port) + " -k " + shlex.quote(str(sockets)) + (
            " -c shared_preload_libraries=timescaledb -c shared_buffers=32MB"
            " -c max_connections=20 -c jit=off -c timescaledb.telemetry_level=off")
        call([pgbin / "pg_ctl", "-D", data, "-l", pg / "postgres.log", "-o", options, "-w", "start"],
             "database-start", user=65534, group=65534)
        started = True
        env["PGPASSWORD"] = password
        env["TIMESCALE_NATIVE_DEMO_PASSWORD"] = password
        connection_args = ["-h", "127.0.0.1", "-p", str(port), "-U", "postgres"]
        call([pgbin / "createdb", *connection_args, "timescale_demo"], "database-create")
        created = True
        record.update(port=port, postgresData=str(data), postgresBin=str(pgbin), nativeDatabaseCreated=True)
        save()
        call([pgbin / "psql", "-X", "-v", "ON_ERROR_STOP=1", *connection_args,
              "-d", "timescale_demo", "-c", "CREATE EXTENSION timescaledb VERSION '2.30.2';"],
             "extension-create")
        operation = runtime / "operation"
        operation.mkdir(mode=0o700)
        connection = operation / "native-connection.json"
        atomic_json(connection, {"schema": "stellar-forge.postgres-source.v1",
            "connection": {"host": "127.0.0.1", "port": port, "database": "timescale_demo",
                "user": "postgres", "passwordEnv": "TIMESCALE_NATIVE_DEMO_PASSWORD", "tls": "local-plaintext"},
            "queries": {"database_identity": {"sql": "SELECT current_database()::text AS database_name",
                "parameters": {}, "columns": ["database_name"], "maxRows": 1, "maxBytes": 4096, "timeoutMs": 5000}}})
        record.update(port=port, postgresData=str(data), postgresBin=str(pgbin),
                      connectionFile=str(connection), nativeDatabaseCreated=True)
        save()
        record["nativeStarted"] = True
        save()
        native_result = operation / "native-demo/native-demo.json"
        call([args.node, repo / CORE / "native-demo.mjs",
              "--directory", operation / "native-demo", "--connection", connection],
             "native-demo", timeout=None, cwd=repo)
        record["nativeComplete"] = True
        save()
        merchant = runtime / "merchant-receiving"
        call([args.node, repo / MERCHANT / "timescale-workspace-native-receiving.mjs",
              "--native-result", native_result, "--directory", merchant,
              "--playwright", args.playwright, "--chromium", args.chromium],
             "merchant-receiving", timeout=None, cwd=repo)
        record["receivingComplete"] = True
        save()
        if receiving:
            call([args.node, receiving, "--native-result", native_result,
                  "--config", merchant / "merchant/merchant-mcp.json",
                  "--workspace", "usage", "--directory", runtime / "remediation-receiving"],
                 "remediation-receiving", timeout=None, cwd=repo)
            record["remediationComplete"] = True
            save()
        success = True
    except BaseException as error:
        record["error"] = {"type": type(error).__name__, "message": str(error), "at": now()}
        try:
            stage("native-host", "FAILED", errorType=type(error).__name__, message=str(error))
        except OSError:
            print(json.dumps({"phase": "native-host", "state": "FAILED",
                              "errorType": type(error).__name__, "message": str(error)}), flush=True)
    finally:
        if started or (data / "postmaster.pid").exists():
            try:
                if created:
                    call([pgbin / "pg_dump", "-h", "127.0.0.1", "-p", str(port), "-U", "postgres",
                          "-d", "timescale_demo", "-Fc", "-f", runtime / "native-database.dump"],
                         "native-database-dump")
            except BaseException as error:
                success = False
                record["databaseDumpError"] = {"type": type(error).__name__, "message": str(error)}
            try:
                # Stopping our database must still execute when the journal or log disk is full.
                try:
                    stage("database-stop", "RUNNING")
                except OSError:
                    pass
                stopped = subprocess.run([str(pgbin / "pg_ctl"), "-D", str(data),
                    "-m", "fast", "-w", "stop"], env=env, user=65534, group=65534,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
                record["databaseStopOutput"] = stopped.stdout[-8000:].decode(errors="replace")
                record["databaseStopped"] = stopped.returncode == 0
                try:
                    stage("database-stop", "COMPLETE" if stopped.returncode == 0 else "FAILED",
                          exitCode=stopped.returncode)
                except OSError:
                    print(json.dumps({"phase": "database-stop", "exitCode": stopped.returncode,
                                      "journalUnavailable": True}), flush=True)
                if stopped.returncode:
                    raise RuntimeError("Owned PostgreSQL stop failed")
            except BaseException as error:
                success = False
                record["databaseStopError"] = {"type": type(error).__name__, "message": str(error)}
        record["complete"] = False
        record["journeyComplete"] = success
        record["endedAt"] = now()
        try:
            save()
            checkpoint = persist / "Timescale_Native_Host_Checkpoint_20261012.tar.gz"
            if checkpoint.exists():
                raise ValueError("Preserve the existing original checkpoint before selecting another output")
            fd = os.open(checkpoint, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as out:
                with tarfile.open(fileobj=out, mode="w:gz", compresslevel=3) as archive:
                    for name in ["host.json", "operation", "merchant-receiving",
                                 "remediation-receiving", "postgres", "logs", "native-database.dump"]:
                        path = runtime / name
                        if path.exists():
                            archive.add(path, arcname=name, recursive=True)
                out.flush()
                os.fsync(out.fileno())
            record["checkpoint"] = {"path": str(checkpoint), "bytes": checkpoint.stat().st_size,
                                    "sha256": file_hash(checkpoint)}
            record["complete"] = success
            save()
            print(json.dumps({"phase": "NATIVE_CHECKPOINT_RETAINED", "complete": success,
                              "record": str(record_path), "checkpoint": record["checkpoint"]}), flush=True)
        except BaseException as error:
            success = False
            record["complete"] = False
            record["checkpointError"] = {"type": type(error).__name__, "message": str(error)}
            try:
                save()
            except OSError:
                pass
            print(json.dumps({"phase": "NATIVE_CHECKPOINT_SAVE_FAILED", "runtime": str(runtime),
                              "errorType": type(error).__name__, "message": str(error)}), flush=True)
        # Remove only the exact temporary checkout link created by this invocation.
        # Donor packages and any subsequently changed/peer-owned entry stay untouched.
        if linked_modules:
            link = repo / "node_modules"
            try:
                if link.is_symlink() and os.readlink(link) == str(runtime / "node_modules"):
                    link.unlink()
            except OSError as error:
                print(json.dumps({"phase": "owned-dependency-link-retained",
                                  "errorType": type(error).__name__}), flush=True)
    return 0 if success else 1

if __name__ == "__main__":
    raise SystemExit(main())
