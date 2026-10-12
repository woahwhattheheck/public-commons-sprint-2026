#!/usr/bin/env python3
"""MIT. Run the retained Kafka customer operation with one owned broker lifetime."""
from __future__ import annotations
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

OPERATION = "SCF-KAFKA-MERCHANT-8F43-20261012"
PIN = "d6938e1f333d92670a653f47d136b7d7cfb3abfa"
ARCHIVE_URL = "https://downloads.apache.org/kafka/4.3.1/kafka_2.13-4.3.1.tgz"
ARCHIVE_SHA512 = "c7d7b2318cb51aa0c61d3246a51c349210073c5c9b754947ef965a439f2f939e8600f204e134a75ac31faf3829c9370960ef7c6a9886c8a1dbf0339a21f4c54c"
APACHE_CONFIG_SHA = "7f1773d354ea1c30e16de259fc87d4b6b389408f"

def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()

def atomic(path, data, same=False):
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.chmod(temporary, 0o600)
            output.write(data); output.flush(); os.fsync(output.fileno())
        if same:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.is_symlink() or path.read_bytes() != data:
                    raise RuntimeError("The retained native lifecycle input changed: " + path.name)
        else:
            os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)

def private(path):
    path = Path(path).expanduser().absolute()
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    value = path.lstat()
    if not stat.S_ISDIR(value.st_mode) or path.resolve() != path or value.st_uid != os.getuid() or value.st_mode & 0o077:
        raise RuntimeError("Select this operation's real private native directory")
    return path

def digest(path, algorithm="sha256"):
    value = hashlib.new(algorithm)
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1048576), b""):
            value.update(block)
    return value.hexdigest()

def birth(pid):
    try:
        return Path("/proc/" + str(pid) + "/stat").read_text().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None

def live(pid, expected):
    if type(pid) is not int or pid <= 1 or expected is None:
        return False
    try:
        state = Path("/proc/" + str(pid) + "/stat").read_text().rsplit(")", 1)[1].split()[0]
    except (OSError, IndexError):
        return False
    return state != "Z" and birth(pid) == expected

def main():
    parser = argparse.ArgumentParser(description="Complete the original owned Kafka source and customer receiving")
    parser.add_argument("--root", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright-module", help="Reuse an existing complete Playwright module; otherwise select the existing cache or acquire official playwright-core 1.64.0")
    parser.add_argument("--browser-executable", required=True)
    parser.add_argument("--apache-archive", help="Reuse this exact verified original Apache archive")
    parser.add_argument("--acquire-only", action="store_true", help="Retain official software before native capacity admission")
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        raise RuntimeError("Use the original selected Python 3.11 or newer")
    root = private(args.root)
    with os.fdopen(os.open(root / "lifecycle.lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600), "r+b") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        node = Path(args.node).resolve(strict=True)
        candidates = [Path(args.playwright_module)] if args.playwright_module else [
            Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs"),
            Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"),
            Path("/workspace/scratch/bc0850d7ba23/browser-runtime/node_modules/playwright-core/index.mjs"),
            root / "software/playwright-core-1.64.0/index.mjs"]
        playwright = next((item.resolve() for item in candidates if item.is_file()), candidates[-1].absolute())
        if args.playwright_module and not playwright.is_file():
            raise RuntimeError("Select the actual complete existing Playwright module")
        chrome = Path(args.browser_executable).resolve(strict=True)
        input_value = {"operation": OPERATION, "sourcePin": PIN, "python": sys.executable,
            "node": str(node), "playwrightModule": str(playwright), "browserExecutable": str(chrome)}
        atomic(root / "lifecycle-input.json", encode(input_value), same=True)
        software = private(root / "software")
        logs = private(root / "logs")
        private(root / "tmp")
        cancelled = []
        foreground = [None]
        def interrupt(number, _frame):
            if cancelled:
                return
            cancelled.append(number)
            child = foreground[0]
            if child is not None and child.poll() is None:
                os.killpg(child.pid, number)
        previous = {number: signal.signal(number, interrupt) for number in (signal.SIGINT, signal.SIGTERM)}
        def interrupted():
            if cancelled:
                raise InterruptedError("The original native lifecycle is closing")
        def run(command, label, environment=None, capture=False):
            interrupted()
            out_path, err_path = logs / (label + ".stdout"), logs / (label + ".stderr")
            with out_path.open("ab") as output, err_path.open("ab") as error:
                out_path.chmod(0o600); err_path.chmod(0o600)
                child = subprocess.Popen(command, stdout=subprocess.PIPE if capture else output, stderr=error,
                    env=environment, start_new_session=True)
                foreground[0] = child
                try:
                    value = child.communicate()[0] if capture else None
                    code = child.wait()
                finally:
                    if child.poll() is None:
                        os.killpg(child.pid, signal.SIGTERM)
                        try:
                            child.wait(timeout=30)
                        except subprocess.TimeoutExpired:
                            os.killpg(child.pid, signal.SIGKILL); child.wait()
                    foreground[0] = None
                if value is not None:
                    output.write(value); output.flush()
                interrupted()
                if code:
                    raise RuntimeError("Original native " + label + " returned " + str(code) + "; reopen its retained log and same operation")
                return value.decode().strip() if value is not None else None

        try:
            archive = Path(args.apache_archive).expanduser().resolve(strict=True) if args.apache_archive else software / "kafka_2.13-4.3.1.tgz"
            part = software / "kafka_2.13-4.3.1.tgz.part"
            if not archive.exists() and part.exists() and not part.is_symlink() and digest(part, "sha512") == ARCHIVE_SHA512:
                os.replace(part, archive)
            if not archive.exists():
                offset = part.stat().st_size if part.exists() else 0
                if part.is_symlink() or offset > 512 * 1024 * 1024:
                    raise RuntimeError("The retained official Apache download is invalid")
                request = urllib.request.Request(ARCHIVE_URL,
                    headers={"Range": "bytes=" + str(offset) + "-"} if offset else {})
                with urllib.request.urlopen(request, timeout=45) as response:
                    if not response.url.startswith("https://") or not response.url.split("/")[2].endswith(".apache.org"):
                        raise RuntimeError("The official Apache download changed authority")
                    if response.status == 206:
                        selected = re.fullmatch(r"bytes ([0-9]+)-([0-9]+)/([0-9]+)", response.headers.get("Content-Range", ""))
                        if selected is None or int(selected[1]) != offset:
                            raise RuntimeError("The official archive resume returned another byte range")
                        total = int(selected[3])
                    elif response.status == 200:
                        offset = 0
                        total = int(response.headers.get("Content-Length", "0"))
                    else:
                        raise RuntimeError("The official archive returned HTTP " + str(response.status))
                    if total > 512 * 1024 * 1024 or shutil.disk_usage(software).free < max(0, total - offset) + 16777216:
                        raise RuntimeError("Admit the actual remaining official archive storage before acquiring it")
                    with part.open("ab" if offset else "wb") as output:
                        part.chmod(0o600)
                        for block in iter(lambda: response.read(1048576), b""):
                            interrupted()
                            output.write(block)
                            if output.tell() > 512 * 1024 * 1024:
                                raise RuntimeError("The official archive exceeded its declared size")
                        output.flush(); os.fsync(output.fileno())
                if digest(part, "sha512") != ARCHIVE_SHA512:
                    raise RuntimeError("The retained Apache archive does not match its official SHA-512")
                os.replace(part, archive)
            if archive.is_symlink() or digest(archive, "sha512") != ARCHIVE_SHA512:
                raise RuntimeError("Select the exact original verified Apache Kafka 4.3.1 archive")
            kafka = software / "kafka_2.13-4.3.1"
            if not kafka.exists():
                staged = software / "apache-extract"
                private(staged)
                with tarfile.open(archive, "r:gz") as source:
                    members = source.getmembers()
                    total = sum(member.size for member in members if member.isfile())
                    remaining = sum(member.size for member in members if member.isfile() and not (
                        (staged / member.name).is_file() and not (staged / member.name).is_symlink()
                        and (staged / member.name).stat().st_size == member.size))
                    if total > 1024 * 1024 * 1024 or shutil.disk_usage(software).free < remaining + 16777216:
                        raise RuntimeError("Admit the complete original Apache distribution storage before extraction")
                    for member in members:
                        parts = Path(member.name).parts
                        if not parts or parts[0] != "kafka_2.13-4.3.1" or ".." in parts or member.name.startswith("/") or not (member.isfile() or member.isdir()):
                            raise RuntimeError("The original Apache distribution contains an unexpected archive member")
                    source.extractall(staged, members=members, filter="data")
                os.replace(staged / "kafka_2.13-4.3.1", kafka)
                staged.rmdir()
            original_config = root / "original-apache-server.properties"
            config_bytes = original_config.read_bytes()
            original_blob = hashlib.sha1(("blob " + str(len(config_bytes)) + "\0").encode() + config_bytes).hexdigest()
            if original_blob != APACHE_CONFIG_SHA or (kafka / "config/server.properties").read_bytes() != config_bytes:
                raise RuntimeError("The acquired Apache broker does not match the retained original release configuration")
            client = software / "python-client"
            report = software / "confluent-kafka-install.json"
            if not client.exists():
                staged_client = software / ("python-client-stage-" + str(os.getpid()))
                if staged_client.exists():
                    raise RuntimeError("Reconcile this existing original client installer before reuse")
                try:
                    run([sys.executable, "-m", "pip", "--isolated", "install", "--disable-pip-version-check",
                        "--no-cache-dir", "--no-deps", "--only-binary=:all:", "--index-url", "https://pypi.org/simple",
                        "--target", str(staged_client), "--report", str(report), "confluent-kafka==2.16.0"], "client-install")
                    report.chmod(0o600)
                    installed = json.loads(report.read_bytes())
                    entries = installed.get("install", [])
                    if len(entries) != 1 or entries[0]["metadata"]["name"].replace("_", "-") != "confluent-kafka" or entries[0]["metadata"]["version"] != "2.16.0":
                        raise RuntimeError("Retain the declared original Confluent native client only")
                    url = entries[0]["download_info"]["url"]
                    if not url.startswith("https://files.pythonhosted.org/") or not entries[0]["download_info"]["archive_info"].get("hashes", {}).get("sha256"):
                        raise RuntimeError("The original client installer did not retain its official wheel identity")
                    os.replace(staged_client, client)
                finally:
                    if staged_client.exists():
                        shutil.rmtree(staged_client)
            environment = os.environ.copy()
            environment["PYTHONPATH"] = str(client)
            environment["PYTHONDONTWRITEBYTECODE"] = "1"
            run([sys.executable, "-c", "import confluent_kafka as k; from confluent_kafka import Producer; from confluent_kafka.admin import AdminClient; assert k.__version__ == '2.16.0'; print(k.__version__, k.libversion()[0])"],
                "original-client-version", environment)
            if not playwright.exists():
                metadata_path = software / "playwright-core-1.64.0.registry.json"
                metadata_url = "https://registry.npmjs.org/playwright-core/1.64.0"
                if metadata_path.exists():
                    metadata = json.loads(metadata_path.read_bytes())
                else:
                    with urllib.request.urlopen(metadata_url, timeout=30) as response:
                        raw = response.read(1048577)
                    if len(raw) > 1048576:
                        raise RuntimeError("The original Playwright metadata exceeds its native size")
                    metadata = json.loads(raw)
                    atomic(metadata_path, raw, same=True)
                if metadata.get("name") != "playwright-core" or metadata.get("version") != "1.64.0" or metadata.get("dependencies"):
                    raise RuntimeError("Select the original standalone Playwright core package")
                distribution = metadata["dist"]
                archive_url = distribution["tarball"]
                integrity = distribution["integrity"]
                if archive_url != "https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0.tgz" or not re.fullmatch(r"sha512-[A-Za-z0-9+/]+={0,2}", integrity):
                    raise RuntimeError("The original Playwright archive identity changed")
                browser_archive = software / "playwright-core-1.64.0.tgz"
                if not browser_archive.exists():
                    descriptor, temporary = tempfile.mkstemp(prefix=".playwright-", dir=software)
                    try:
                        with os.fdopen(descriptor, "wb") as output, urllib.request.urlopen(archive_url, timeout=45) as response:
                            os.chmod(temporary, 0o600)
                            while block := response.read(1048576):
                                interrupted()
                                output.write(block)
                                if output.tell() > 64 * 1024 * 1024:
                                    raise RuntimeError("The original Playwright archive exceeded its size")
                            output.flush(); os.fsync(output.fileno())
                        actual = "sha512-" + base64.b64encode(bytes.fromhex(digest(Path(temporary), "sha512"))).decode()
                        if actual != integrity:
                            raise RuntimeError("The original Playwright archive failed its registry identity")
                        os.replace(temporary, browser_archive)
                    finally:
                        Path(temporary).unlink(missing_ok=True)
                if "sha512-" + base64.b64encode(bytes.fromhex(digest(browser_archive, "sha512"))).decode() != integrity:
                    raise RuntimeError("The retained Playwright package changed")
                unpack = private(software / "playwright-extract")
                with tarfile.open(browser_archive, "r:gz") as archive_file:
                    members = archive_file.getmembers()
                    if sum(member.size for member in members) > 128 * 1024 * 1024:
                        raise RuntimeError("The original Playwright package exceeds its native storage")
                    for member in members:
                        parts = Path(member.name).parts
                        if not parts or parts[0] != "package" or ".." in parts or member.name.startswith("/") or not (member.isfile() or member.isdir()):
                            raise RuntimeError("The original Playwright package contains an unexpected member")
                    archive_file.extractall(unpack, members=members, filter="data")
                package = json.loads((unpack / "package/package.json").read_bytes())
                if package.get("name") != "playwright-core" or package.get("version") != "1.64.0":
                    raise RuntimeError("The original Playwright package metadata changed")
                os.replace(unpack / "package", playwright.parent)
                unpack.rmdir()
            run([str(node), "--input-type=module", "-e",
                "const m=await import(process.argv[1]);if(!(m.chromium??m.default?.chromium))throw new Error('Use the full Playwright Chromium module');console.log('Original Chromium driver loaded')",
                playwright.as_uri()], "original-browser-module", environment)
            atomic(software / "software.json", encode({"operation": OPERATION, "archive": str(archive),
                "archiveUrl": ARCHIVE_URL, "archiveSha512": ARCHIVE_SHA512, "apacheConfigurationGitBlob": APACHE_CONFIG_SHA,
                "kafkaRoot": str(kafka), "client": str(client), "clientInstallReport": str(report),
                "playwrightModule": str(playwright), "browserExecutable": str(chrome)}))
            if args.acquire_only:
                print(json.dumps({"operation": OPERATION, "status": "SOFTWARE_RETAINED", "sourcePin": PIN}), flush=True)
                return 0

            broker_root = private(root / "broker")
            broker_input = broker_root / "input.json"
            broker_config = broker_root / "server.properties"
            broker_owner = broker_root / "owner.json"
            java_environment = environment | {"KAFKA_HEAP_OPTS": "-Xms96m -Xmx256m -Xss512k",
                "KAFKA_OPTS": "-XX:ActiveProcessorCount=2 -Djava.io.tmpdir=" + str(root / "tmp"),
                "LOG_DIR": str(logs), "EXTRA_ARGS": "-name kafkaServer"}
            if broker_input.exists():
                broker_value = json.loads(broker_input.read_bytes())
                if broker_value.get("operation") != OPERATION or broker_value.get("sourcePin") != PIN:
                    raise RuntimeError("Retain the original owned broker input")
            else:
                sockets = [socket.socket(), socket.socket()]
                try:
                    for selected in sockets:
                        selected.bind(("127.0.0.1", 0))
                    ports = [selected.getsockname()[1] for selected in sockets]
                    cluster_output = run([str(kafka / "bin/kafka-storage.sh"), "random-uuid"], "original-cluster-id", java_environment, capture=True)
                    clusters = [line for line in cluster_output.splitlines() if re.fullmatch(r"[A-Za-z0-9_-]{22}", line)]
                    if len(clusters) != 1:
                        raise RuntimeError("The original Kafka storage tool did not return its cluster UUID")
                    broker_value = {"operation": OPERATION, "sourcePin": PIN, "clusterId": clusters[0],
                        "brokerPort": ports[0], "controllerPort": ports[1]}
                    atomic(broker_input, encode(broker_value), same=True)
                finally:
                    for selected in sockets:
                        selected.close()
            replacements = {
                "controller.quorum.bootstrap.servers": "127.0.0.1:" + str(broker_value["controllerPort"]),
                "listeners": "PLAINTEXT://127.0.0.1:" + str(broker_value["brokerPort"]) + ",CONTROLLER://127.0.0.1:" + str(broker_value["controllerPort"]),
                "advertised.listeners": "PLAINTEXT://127.0.0.1:" + str(broker_value["brokerPort"]) + ",CONTROLLER://127.0.0.1:" + str(broker_value["controllerPort"]),
                "log.dirs": str(broker_root / "data"), "num.network.threads": "1", "num.io.threads": "2",
                "num.recovery.threads.per.data.dir": "1", "socket.request.max.bytes": "8388608",
                "log.segment.bytes": "16777216"}
            lines = []
            changed = set()
            for line in config_bytes.decode().splitlines():
                key = line.split("=", 1)[0]
                if key in replacements and not line.lstrip().startswith("#"):
                    lines.append(key + "=" + replacements[key]); changed.add(key)
                else:
                    lines.append(line)
            if changed != set(replacements):
                raise RuntimeError("The original Kafka configuration changed its declared resource keys")
            lines.extend(["", "# One owned native receiving operation; compact internal logs.",
                "offsets.topic.num.partitions=1", "transaction.state.log.num.partitions=1",
                "offsets.topic.segment.bytes=16777216", "transaction.state.log.segment.bytes=16777216",
                "share.coordinator.state.topic.num.partitions=1", "log.index.size.max.bytes=1048576",
                "metadata.log.segment.bytes=16777216", "background.threads=2",
                "log.cleaner.dedupe.buffer.size=8388608", "auto.create.topics.enable=false"])
            atomic(broker_config, ("\n".join(lines) + "\n").encode(), same=True)
            checkpoint = root / "receiving/receipts/native-capture-checkpoint.json"
            captured = False
            if checkpoint.exists():
                saved = json.loads(checkpoint.read_bytes())
                captured = saved.get("operation") == OPERATION and saved.get("sourcePin") == PIN and saved.get("capture", {}).get("status") == "COMPLETE" and saved.get("keyedCapture", {}).get("status") == "COMPLETE"
                if not captured:
                    raise RuntimeError("Reopen the original customer capture checkpoint")
            broker = None
            broker_stream = None
            def stop_broker():
                if broker is not None and broker.poll() is None:
                    broker.terminate()
                    try:
                        broker.wait(timeout=45)
                    except subprocess.TimeoutExpired:
                        broker.kill(); broker.wait()
                if broker_stream is not None:
                    broker_stream.close()
                if broker is not None:
                    atomic(broker_root / "closed.json", encode({"operation": OPERATION,
                        "pid": broker.pid, "exitCode": broker.returncode, "closed": True,
                        "captured": checkpoint.exists()}))
            if broker_owner.exists():
                owner = json.loads(broker_owner.read_bytes())
                if owner.get("operation") != OPERATION or owner.get("config") != str(broker_config):
                    raise RuntimeError("The saved Kafka process belongs to another operation")
                if live(owner.get("pid"), owner.get("processBirth")):
                    arguments = Path("/proc/" + str(owner["pid"]) + "/cmdline").read_bytes().split(b"\0")
                    if str(broker_config).encode() not in arguments:
                        raise RuntimeError("The saved Kafka process identity changed")
                    os.kill(owner["pid"], signal.SIGTERM)
                    deadline = time.monotonic() + 45
                    while live(owner["pid"], owner["processBirth"]) and time.monotonic() < deadline:
                        time.sleep(0.2)
                    if live(owner["pid"], owner["processBirth"]):
                        raise RuntimeError("The original broker is still closing; retain its same process")
            source_root = root / "source/stellar/scf-starforge-20261009/sf30-seller-sdk"
            base_customer = [sys.executable, str(root / "native-customer-receiving.py"),
                "--root", str(root / "receiving"), "--source-root", str(source_root),
                "--source-inventory", str(root / "source-inventory.json"),
                "--connection-request", str(root / "seed/connection-request.json"),
                "--node", str(node), "--browser-driver", str(root / "native-customer-browser.mjs"),
                "--playwright-module", str(playwright), "--browser-executable", str(chrome),
                "--merchant-request", str(root / "merchant-request.json"),
                "--merchant-driver", str(root / "native-merchant-receiving.mjs")]
            try:
                if not captured:
                    private(broker_root / "data")
                    meta = broker_root / "data/meta.properties"
                    if meta.exists():
                        values = dict(line.split("=", 1) for line in meta.read_text().splitlines() if "=" in line and not line.startswith("#"))
                        if values.get("cluster.id") != broker_value["clusterId"] or values.get("node.id") != "1":
                            raise RuntimeError("The retained original broker storage identity changed")
                    else:
                        run([str(kafka / "bin/kafka-storage.sh"), "format", "--standalone", "-t",
                            broker_value["clusterId"], "-c", str(broker_config)], "original-storage-format", java_environment)
                    broker_stream = (logs / "broker.log").open("ab"); (logs / "broker.log").chmod(0o600)
                    broker = subprocess.Popen([str(kafka / "bin/kafka-server-start.sh"), str(broker_config)],
                        stdout=broker_stream, stderr=broker_stream, env=java_environment, start_new_session=True)
                    atomic(broker_owner, encode({"operation": OPERATION, "sourcePin": PIN,
                        "config": str(broker_config), "pid": broker.pid, "processBirth": birth(broker.pid)}))
                    sys.path.insert(0, str(client))
                    from confluent_kafka.admin import AdminClient
                    admin = AdminClient({"bootstrap.servers": "127.0.0.1:" + str(broker_value["brokerPort"]), "log_level": 0})
                    deadline = time.monotonic() + 90
                    while True:
                        interrupted()
                        if broker.poll() is not None:
                            raise RuntimeError("The original Kafka broker closed during startup; retain broker.log")
                        try:
                            native_cluster = admin.describe_cluster(request_timeout=2).result(3)
                            if native_cluster.cluster_id != broker_value["clusterId"]:
                                raise RuntimeError("The live broker cluster differs from its original storage")
                            break
                        except Exception as issue:
                            if isinstance(issue, RuntimeError) or time.monotonic() >= deadline:
                                raise
                            time.sleep(0.2)
                    del admin
                    run([sys.executable, str(root / "native-owned-source.py"), "--root", str(root / "seed"),
                        "--source-root", str(source_root), "--broker", "127.0.0.1:" + str(broker_value["brokerPort"])],
                        "owned-source", environment)
                    run(base_customer + ["--capture-only"], "original-customer-capture", environment)
            finally:
                stop_broker()
            run(base_customer, "original-customer-receiving", environment)
            result = json.loads((root / "receiving/result.json").read_bytes())
            if result.get("status") != "COMPLETE" or result.get("sourcePin") != PIN:
                raise RuntimeError("Retain the actual original customer receiving outcome")
            atomic(root / "lifecycle-result.json", encode({"operation": OPERATION, "sourcePin": PIN,
                "status": "COMPLETE", "customerResult": str(root / "receiving/result.json"),
                "software": str(software / "software.json"), "brokerClosed": True,
                "sourceRecords": result["records"], "receiving": result["receiving"]}))
            print(json.dumps({"operation": OPERATION, "status": "COMPLETE", "records": result["records"],
                "brokerClosed": True, "sourcePin": PIN}), flush=True)
            return 0
        except InterruptedError:
            return 130 if cancelled[0] == signal.SIGINT else 143
        finally:
            for number, handler in previous.items():
                signal.signal(number, handler)

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as issue:
        print("Kafka original lifecycle: " + str(issue), file=sys.stderr, flush=True)
        sys.exit(1)
