#!/usr/bin/env python3
"""MIT. One original Kafka customer operation, native dataset receiving and browser delivery."""
from __future__ import annotations
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import zipfile

SCHEMA = "stellar-forge.kafka-native-customer-receiving.v1"
OPERATION = "SCF-KAFKA-MERCHANT-8F43-20261012"
SOURCE_PIN = "d6938e1f333d92670a653f47d136b7d7cfb3abfa"


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def plain(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def atomic(path, data, same=False):
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.chmod(temporary, 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        if same:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.is_symlink() or path.read_bytes() != data:
                    raise RuntimeError("The retained original receiving input differs: " + path.name)
        else:
            os.replace(temporary, path)
        handle = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(handle)
        finally:
            os.close(handle)
    finally:
        temporary.unlink(missing_ok=True)


def private_directory(path):
    path = Path(path).expanduser().absolute()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.resolve() != path or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("Use the same real private receiving directory")
    return path


def read_request(path):
    path = Path(path).expanduser().absolute()
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 1048576:
        raise RuntimeError("Select the original broker reference request")
    return json.loads(path.read_bytes())


def inspect_sources(source_root, inventory):
    observed = {}
    for name, expected in inventory.items():
        path = source_root / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError("The complete original source is missing: " + name)
        data = path.read_bytes()
        blob = hashlib.sha1(("blob " + str(len(data)) + "\0").encode() + data).hexdigest()
        if blob != expected:
            raise RuntimeError("The original source pin changed: " + name)
        observed[name] = sha(data)
    return observed


def archive_selection(path):
    with zipfile.ZipFile(path) as archive:
        info = archive.getinfo("manifest.json")
        if info.file_size > 16384:
            raise RuntimeError("Original project manifest exceeds its receiving limit")
        return json.loads(archive.read(info))



class ReceivingInterrupted(Exception):
    def __init__(self, number):
        super().__init__("The original customer receiving is closing")
        self.number = number


def consumer_selection(args, root):
    selected = [args.consumer_driver, args.consumer_product_root, args.consumer_source_inventory]
    if not any(selected):
        return None
    if not all(selected):
        raise RuntimeError("Select the complete original client/MCP driver and its source inventory together")
    driver = Path(args.consumer_driver).expanduser().absolute()
    inventory_path = Path(args.consumer_source_inventory).expanduser().absolute()
    product_root = Path(args.consumer_product_root).expanduser().absolute()
    if product_root.resolve(strict=True) != product_root or not product_root.is_dir():
        raise RuntimeError("Retain the actual original client/MCP product source directory")
    for path in (driver, inventory_path):
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or path.resolve(strict=True) != path
                or info.st_uid != os.getuid()):
            raise RuntimeError("Retain the selected original client/MCP source file")
    inventory_bytes = inventory_path.read_bytes()
    if len(inventory_bytes) > 1048576:
        raise RuntimeError("The original client/MCP source inventory exceeds its declared size")
    inventory = json.loads(inventory_bytes)
    if (not isinstance(inventory, dict)
            or inventory.get("schema") != "stellar-forge.kafka-native-consumer-source.v1"
            or inventory.get("operation") != OPERATION
            or inventory.get("originalSourcePin") != SOURCE_PIN
            or re.fullmatch(r"[0-9a-f]{40}", inventory.get("sourcePin", "")) is None
            or not isinstance(inventory.get("files"), dict) or not inventory["files"]
            or not isinstance(inventory.get("driver"), dict)
            or set(inventory["driver"]) != {"name", "gitBlob"}
            or inventory["driver"]["name"] != driver.name
            or not isinstance(inventory.get("result"), dict)
            or set(inventory["result"]) != {"filename", "schema"}
            or inventory["result"]["filename"] != "result.json"
            or not isinstance(inventory["result"]["schema"], str)):
        raise RuntimeError("Select this operation's complete retained client/MCP source contract")
    for name, expected in inventory["files"].items():
        if (not isinstance(name, str) or Path(name).is_absolute() or "\\" in name
                or Path(name).as_posix() != name or ".." in Path(name).parts
                or re.fullmatch(r"[0-9a-f]{40}", expected or "") is None):
            raise RuntimeError("The original client/MCP source inventory contains an invalid member")
        path = product_root / name
        if path.resolve(strict=True) != path:
            raise RuntimeError("Retain every original client/MCP source member in its selected directory")
    observed = inspect_sources(product_root, inventory["files"])
    driver_bytes = driver.read_bytes()
    driver_blob = hashlib.sha1(b"blob " + str(len(driver_bytes)).encode() + b"\0" + driver_bytes).hexdigest()
    if driver_blob != inventory["driver"]["gitBlob"]:
        raise RuntimeError("The original client/MCP receiving driver differs from its retained source")
    retained = {"schema": "stellar-forge.kafka-native-consumer-input.v1",
        "operation": OPERATION, "originalSourcePin": SOURCE_PIN,
        "sourcePin": inventory["sourcePin"], "source": observed,
        "sourceInventorySha256": sha(inventory_bytes), "productRoot": str(product_root),
        "driver": {"file": str(driver), "gitBlob": driver_blob, "sha256": sha(driver_bytes)},
        "result": inventory["result"]}
    atomic(root / "consumer-input.json", plain(retained), same=True)
    return retained


def main():
    parser = argparse.ArgumentParser(description="Complete one real Kafka source and original customer receiving")
    parser.add_argument("--root", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--source-inventory", required=True)
    parser.add_argument("--connection-request", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--browser-driver", required=True)
    parser.add_argument("--playwright-module", required=True)
    parser.add_argument("--browser-executable")
    parser.add_argument("--ranges-file")
    parser.add_argument("--merchant-request", required=True)
    parser.add_argument("--merchant-driver", required=True)
    parser.add_argument("--consumer-driver")
    parser.add_argument("--consumer-product-root")
    parser.add_argument("--consumer-source-inventory")
    parser.add_argument("--capture-only", action="store_true", help="Retain the same COMPLETE capture, then close its broker phase before dataset/browser receiving")
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        raise RuntimeError("Use the selected Python 3.11 or newer")
    root = private_directory(args.root)
    with os.fdopen(os.open(root / "operation.lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600), "r+b") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        source_root = Path(args.source_root).resolve(strict=True)
        inventory = read_request(args.source_inventory)
        if inventory.get("sourcePin") != SOURCE_PIN or not isinstance(inventory.get("files"), dict) or len(inventory["files"]) != 26:
            raise RuntimeError("Use this operation's exact 26-file original source inventory")
        sources = inspect_sources(source_root, inventory["files"])
        merchant_inventory = inventory.get("merchantFiles")
        if not isinstance(merchant_inventory, dict) or not merchant_inventory:
            raise RuntimeError("Retain the original merchant preparation source closure")
        merchant_sources = inspect_sources(source_root.parents[2], merchant_inventory)
        merchant_request = read_request(args.merchant_request)
        if not isinstance(merchant_request, dict) or set(merchant_request) != {"origin", "path", "payment"}:
            raise RuntimeError("Select the actual original merchant origin, route and public payment terms")
        node = Path(args.node).expanduser().resolve(strict=True)
        version = subprocess.run([str(node), "--version"], check=True, capture_output=True, text=True).stdout.strip()
        parts = [int(value) for value in version.lstrip("v").split(".")[:2]]
        if parts < [22, 16]:
            raise RuntimeError("Use the selected Node 22.16 or newer")
        os.environ["SF30_XML_NODE"] = str(node)
        sys.path.insert(0, str(source_root / "kafka"))
        from shared import InputError, load_json, json_bytes, file_digest
        from contract import api_bytes, config as validate_config
        from model import Workspace
        from managed import inspect_binding, published_connection, startup, regular
        from httpd import OperatorServer

        request = read_request(args.connection_request)
        if set(request) != {"connection", "expectedRevision", "operation", "config"} or request["expectedRevision"] != 0:
            raise RuntimeError("Begin with the original named connection's first immutable revision")
        request["config"] = validate_config(request["config"])
        ranges_input = read_request(args.ranges_file) if args.ranges_file else None
        if ranges_input is not None and not isinstance(ranges_input, list):
            raise RuntimeError("Supply a JSON array of the explicit original partition ranges")
        input_value = {"schema": SCHEMA, "operation": OPERATION, "sourcePin": SOURCE_PIN,
            "source": sources, "merchantSource": merchant_sources, "merchant": merchant_request,
            "latestKeyPartitions": [0],
            "connection": request, "ranges": ranges_input,
            "python": {"executable": sys.executable, "version": list(sys.version_info[:3])},
            "node": {"executable": str(node), "version": version}}
        atomic(root / "receiving-input.json", plain(input_value), same=True)
        consumer_input = consumer_selection(args, root)
        consumer_result = None
        receipts = private_directory(root / "receipts")
        delivery = private_directory(root / "delivery")
        seller_path, customer_path = root / "seller", root / "customer"

        def record(name, value):
            encoded = api_bytes(value)
            atomic(receipts / (name + ".json"), encoded)
            return value

        def project_and_build(ws, capture, suffix, delete_policy, view="events"):
            projected = ws.project({"operation": OPERATION + ":" + suffix,
                "captures": [{"id": capture["id"], "revision": capture["revision"]}],
                "view": view, "decode": "json", "deletePolicy": delete_policy,
                "acceptIncomplete": False, "label": "Native Kafka customer source"})
            plan = ws.save_plan(projected["defaultPlan"])
            build = ws.build(projected["source"], plan["id"])
            query = ws.query(build["id"], {"limit": "50"})
            if query["response"]["status"] != 200 or query["dataset"]["rowCount"] != projected["records"]:
                raise RuntimeError("The original dataset did not receive every selected projected row")
            record(suffix + "-projection", projected)
            record(suffix + "-mapping", plan)
            record(suffix + "-build", build)
            record(suffix + "-query", query)
            return projected, build, query

        with Workspace(seller_path, create=not seller_path.exists()) as seller:
            connection = record("connection", seller.save_connection(request))
            inspection = record("inspection", seller.inspect_connection({
                "connection": connection["id"], "revision": connection["revision"],
                "operation": OPERATION + ":inspection"}))
            ranges = ranges_input if ranges_input is not None else [
                {"partition": row["partition"], "start": row["low"], "end": row["end"]}
                for row in inspection["partitions"]]
            capture = seller.prepare_capture({"inspection": inspection["id"],
                "operation": OPERATION + ":capture", "ranges": ranges})
            record("prepared-capture", capture)
            if capture["status"] != "COMPLETE":
                cancelled = threading.Event()
                signals = []
                def interrupt(number, _frame):
                    if not signals:
                        signals.append(number)
                    cancelled.set()
                previous = {number: signal.signal(number, interrupt) for number in (signal.SIGINT, signal.SIGTERM)}
                try:
                    capture = seller.run_capture(capture["id"], capture["revision"], cancel_event=cancelled)
                finally:
                    for number, handler in previous.items():
                        signal.signal(number, handler)
                record("capture", capture)
                if signals:
                    return 130 if signals[0] == signal.SIGINT else 143
            else:
                record("capture", capture)
            if capture["status"] != "COMPLETE":
                raise RuntimeError("Resume this exact retained native capture after its reported " + capture["status"] + " outcome")
            if capture["records"] < 1:
                raise RuntimeError("The selected original topic has no committed source records for customer receiving")
            keyed_ranges = [row for row in ranges if row["partition"] == 0]
            if len(keyed_ranges) != 1:
                raise RuntimeError("Retain the owned source's explicit partition 0 range for its latest-key edition")
            keyed_capture = seller.prepare_capture({"inspection": inspection["id"],
                "operation": OPERATION + ":keyed-capture", "ranges": keyed_ranges})
            record("prepared-keyed-capture", keyed_capture)
            if keyed_capture["status"] != "COMPLETE":
                cancelled = threading.Event()
                signals = []
                def interrupt_keyed(number, _frame):
                    if not signals:
                        signals.append(number)
                    cancelled.set()
                previous = {number: signal.signal(number, interrupt_keyed) for number in (signal.SIGINT, signal.SIGTERM)}
                try:
                    keyed_capture = seller.run_capture(keyed_capture["id"], keyed_capture["revision"], cancel_event=cancelled)
                finally:
                    for number, handler in previous.items():
                        signal.signal(number, handler)
                record("keyed-capture", keyed_capture)
                if signals:
                    return 130 if signals[0] == signal.SIGINT else 143
            else:
                record("keyed-capture", keyed_capture)
            if keyed_capture["status"] != "COMPLETE":
                raise RuntimeError("Resume the same original keyed capture after " + keyed_capture["status"])
            if args.capture_only:
                checkpoint = {"schema": SCHEMA, "operation": OPERATION, "status": "CAPTURED",
                    "sourcePin": SOURCE_PIN, "capture": capture, "keyedCapture": keyed_capture, "inspection": inspection,
                    "retainedAt": stamp(), "resume": "Run this same command without --capture-only after closing the owned broker"}
                record("native-capture-checkpoint", checkpoint)
                print(json.dumps({"operation": OPERATION, "status": "CAPTURED",
                    "capture": capture["id"], "records": capture["records"], "sourcePin": SOURCE_PIN}), flush=True)
                return 0
            audit, audit_build, audit_query = project_and_build(seller, capture, "audit", "retain")
            current, current_build, current_query = project_and_build(seller, keyed_capture, "current", "tombstone-or-goldsky", "latest-per-partition-key")
            comparison = record("comparison", seller.compare(audit_build["id"], current_build["id"]))
            record("changes", seller.comparison_page(comparison["id"], 0, 200))
            archives = []
            for label, projection, build in [("audit", audit, audit_build), ("current", current, current_build)]:
                archive = delivery / (label + "-kafka-project.zip")
                if archive.exists():
                    retained = archive_selection(archive)
                    if any(retained.get(key) != value for key, value in {
                            "schema": "stellar-forge.kafka-project.v1", "projection": projection["id"],
                            "source": projection["source"], "build": build["id"]}.items()):
                        raise RuntimeError("The retained customer archive belongs to another original edition")
                    exported = {"file": str(archive), "bytes": archive.stat().st_size,
                        "sha256": file_digest(archive, 6 * 256 * 1024 * 1024 + 32 * 1024 * 1024),
                        "projection": projection["id"], "source": projection["source"], "build": build["id"]}
                else:
                    exported = seller.export_kafka(build["id"], archive, projection["id"])
                record(label + "-export", exported)
                archives.append(exported)
            record("seller-state", seller.state())

        with Workspace(seller_path) as reopened:
            actual = reopened.capture(capture["id"])
            if actual != capture or reopened.capture(keyed_capture["id"]) != keyed_capture or reopened.build_view(audit_build["id"]) != audit_build:
                raise RuntimeError("Original seller reopening changed its capture or native edition")
            record("seller-reopen", {"capture": actual, "build": reopened.build_view(audit_build["id"]),
                                     "projection": reopened.projection(audit["id"]), "keyedCapture": reopened.capture(keyed_capture["id"])})
        with Workspace(customer_path, create=not customer_path.exists()) as customer:
            received = []
            for label, archive in zip(("audit", "current"), archives):
                value = customer.import_kafka(Path(archive["file"]))
                if value["source"] != archive["source"] or value["build"]["id"] != archive["build"]:
                    raise RuntimeError("The original customer received another source or build")
                record(label + "-received", value)
                repeated = customer.import_kafka(Path(archive["file"]))
                if not repeated.get("reopened") or repeated["id"] != value["id"]:
                    raise RuntimeError("The original customer receiving did not reopen the same operation")
                record(label + "-received-reopen", repeated)
                received.append(value)
            received_query = record("customer-query", customer.query(audit_build["id"], {"limit": "50"}))
            if received_query["response"] != audit_query["response"] or received_query["dataset"] != audit_query["dataset"]:
                raise RuntimeError("The original customer query differs from its complete source edition")
            record("customer-state", customer.state())

        with Workspace(customer_path) as customer:
            if customer.capture(capture["id"]) != capture or customer.capture(keyed_capture["id"]) != keyed_capture:
                raise RuntimeError("The original customer capture changed on reopening")
            full_path = receipts / "received-wire-messages.jsonl"
            descriptor, temporary = tempfile.mkstemp(prefix=".wire-", dir=receipts)
            first_event = first_json = None
            message_count = 0
            try:
                with os.fdopen(descriptor, "wb") as output:
                    os.chmod(temporary, 0o600)
                    cursor = 0
                    while True:
                        page = customer.messages(capture["id"], cursor, 100)
                        if any(any(key in item for key in ("valueBase64", "value", "valueJson", "headers")) for item in page["messages"]):
                            raise RuntimeError("The original history page unexpectedly expanded complete values")
                        for summary in page["messages"]:
                            event = customer.message(summary["id"])
                            if event["id"] != summary["id"] or event["sha256"] != summary["sha256"]:
                                raise RuntimeError("Message selection changed its retained source identity")
                            output.write(api_bytes(event))
                            message_count += 1
                            first_event = first_event or event
                            if first_json is None and event["valueState"] == "json":
                                first_json = event
                        cursor += len(page["messages"])
                        if cursor >= page["total"]:
                            break
                        if not page["messages"]:
                            raise RuntimeError("Original history pagination stopped before its declared source ended")
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, full_path)
            finally:
                Path(temporary).unlink(missing_ok=True)
            if message_count != capture["records"]:
                raise RuntimeError("The customer did not retain the complete original captured message count")
            selected = first_json or first_event
            record("browser-selected-event", selected)
            binding = record("customer-managed-binding", inspect_binding(customer_path))
            server = OperatorServer(customer, 0)
            connection_file = root / "customer-console.connection"
            owner_path = root / "customer-console-owner.json"
            def process_birth(pid):
                try:
                    return Path("/proc/" + str(pid) + "/stat").read_text().rsplit(")", 1)[1].split()[19]
                except (FileNotFoundError, IndexError, OSError):
                    return None
            if connection_file.exists():
                regular(connection_file, private=True, limit=1024)
                previous_owner = read_request(owner_path)
                old_pid = previous_owner.get("pid")
                old_birth = previous_owner.get("processBirth")
                if (previous_owner.get("schema") != "stellar-forge.kafka-receiving-console-owner.v1"
                        or previous_owner.get("workspace") != str(customer_path)
                        or previous_owner.get("sourcePin") != SOURCE_PIN
                        or not isinstance(old_pid, int)
                        or connection_file.read_bytes() != (previous_owner.get("console", "") + "\n").encode()):
                    raise RuntimeError("The retained console connection belongs to a different original owner")
                try:
                    os.kill(old_pid, 0)
                    alive = old_birth is None or process_birth(old_pid) == old_birth
                except ProcessLookupError:
                    alive = False
                if alive:
                    raise RuntimeError("The original receiving console process is still closing")
                connection_file.unlink()
            atomic(owner_path, plain({"schema": "stellar-forge.kafka-receiving-console-owner.v1",
                "workspace": str(customer_path), "sourcePin": SOURCE_PIN,
                "pid": os.getpid(), "processBirth": process_birth(os.getpid()), "console": server.url}))
            browser = None
            consumer = None
            with published_connection(connection_file, server.url) as connection:
                closing_signals = {}
                active_child = [None]
                forwarded_signals = {}
                previous_signals = {}
                server_thread = None
                server_started = False

                def forward_child_signal(child, number):
                    if child is None or child.poll() is not None:
                        return
                    # setdefault is one atomic publication in the main Python
                    # thread: a signal arriving while registration runs cannot
                    # send the first cancellation twice to the same owner.
                    token = object()
                    if forwarded_signals.setdefault(child, token) is not token:
                        return
                    try:
                        child.send_signal(number)
                    except ProcessLookupError:
                        pass

                def register_child(child):
                    active_child[0] = child
                    number = closing_signals.get("first")
                    if number is not None:
                        forward_child_signal(child, number)
                    return child

                def stop_receiving(number, _frame):
                    first = closing_signals.setdefault("first", number)
                    forward_child_signal(active_child[0], first)

                def check_receiving_cancelled():
                    number = closing_signals.get("first")
                    if number is not None:
                        raise ReceivingInterrupted(number)

                try:
                    # All setup after starting the original non-daemon console
                    # belongs to this same cleanup, including retained input I/O.
                    for number in (signal.SIGINT, signal.SIGTERM):
                        previous_signals[number] = signal.getsignal(number)
                        signal.signal(number, stop_receiving)
                    server.launch = startup(server, binding, connection)
                    server_thread = threading.Thread(target=server.serve_forever,
                        kwargs={"poll_interval": 0.2}, daemon=False)
                    server_thread.start()
                    server_started = True
                    browser_input = {"schema": SCHEMA, "operation": OPERATION, "sourcePin": SOURCE_PIN,
                        "connectionFile": connection, "workspace": str(customer_path),
                        "bindingSha256": binding["sha256"], "capture": capture["id"],
                        "projection": audit["id"], "build": audit_build["id"], "source": audit["source"],
                        "expectedEvent": str(receipts / "browser-selected-event.json"),
                        "expectedQuery": str(receipts / "audit-query.json"),
                        "outputDirectory": str(private_directory(root / "browser")),
                        "playwrightModule": str(Path(args.playwright_module).expanduser().absolute()),
                        "merchant": merchant_request}
                    if args.browser_executable:
                        browser_input["browserExecutable"] = str(Path(args.browser_executable).expanduser().absolute())
                    atomic(root / "browser-input.json", plain(browser_input))
                    check_receiving_cancelled()
                    with (root / "browser" / "stdout.log").open("ab") as out, (root / "browser" / "stderr.log").open("ab") as err:
                        out_path, err_path = root / "browser" / "stdout.log", root / "browser" / "stderr.log"
                        out_path.chmod(0o600); err_path.chmod(0o600)
                        browser = subprocess.Popen([str(node), str(Path(args.browser_driver).resolve(strict=True)),
                            "--input", str(root / "browser-input.json")], stdout=out, stderr=err)
                        register_child(browser)
                        code = browser.wait(timeout=180)
                        active_child[0] = None
                    check_receiving_cancelled()
                    if code != 0:
                        raise RuntimeError("The original customer browser returned exit " + str(code) + "; retain browser logs and the same workspace")
                    if consumer_input is not None:
                        consumer_out = private_directory(root / "client-mcp")
                        check_receiving_cancelled()
                        out_path, err_path = consumer_out / "stdout.log", consumer_out / "stderr.log"
                        with out_path.open("ab") as out, err_path.open("ab") as err:
                            out_path.chmod(0o600); err_path.chmod(0o600)
                            consumer = subprocess.Popen([str(node), consumer_input["driver"]["file"],
                                "--input", str(root / "browser-input.json"),
                                "--receipts", str(receipts),
                                "--product-root", consumer_input["productRoot"],
                                "--out", str(consumer_out)], stdout=out, stderr=err)
                            register_child(consumer)
                            consumer_code = consumer.wait()
                            active_child[0] = None
                        check_receiving_cancelled()
                        if consumer_code != 0:
                            raise RuntimeError("The original client/MCP receiving returned exit " + str(consumer_code)
                                + "; retain its same source, console workspace and customer receipts")
                        consumer_result = read_request(consumer_out / consumer_input["result"]["filename"])
                        if (consumer_result.get("schema") != consumer_input["result"]["schema"]
                                or consumer_result.get("operation") != OPERATION
                                or consumer_result.get("status") != "COMPLETED"):
                            raise RuntimeError("Retain the actual completed original client/MCP receiving result")
                finally:
                    # The original consumer retains failed-close resources for
                    # same-owner retry. Keep the console and SQLite writer until
                    # that actual drain finishes, including repeated Stop input.
                    try:
                        if consumer is not None and consumer.poll() is None:
                            register_child(consumer)
                            forward_child_signal(consumer, closing_signals.get("first", signal.SIGTERM))
                            consumer.wait()
                        if browser is not None and browser.poll() is None:
                            register_child(browser)
                            forward_child_signal(browser, closing_signals.get("first", signal.SIGTERM))
                            try:
                                browser.wait(timeout=15)
                            except subprocess.TimeoutExpired:
                                browser.kill()
                                browser.wait()
                        active_child[0] = None
                        server.launch = None
                        try:
                            if server_started:
                                server.shutdown()
                                server_thread.join()
                        finally:
                            server.server_close()
                    finally:
                        for number, handler in previous_signals.items():
                            signal.signal(number, handler)
            browser_result = read_request(root / "browser" / "result.json")
            downloaded = root / "browser" / browser_result["archive"]["filename"]
            if downloaded.parent != root / "browser" or downloaded.is_symlink():
                raise RuntimeError("The original browser archive left its retained receiving directory")
            browser_received = record("browser-download-received", customer.import_kafka(downloaded))
            if browser_received["source"] != audit["source"] or browser_received["build"]["id"] != audit_build["id"]:
                raise RuntimeError("The actual browser download did not reconstruct its selected original dataset")
            merchant_zip = root / "browser" / browser_result["merchantArchive"]["filename"]
            if (merchant_zip.parent != root / "browser" or merchant_zip.is_symlink()
                    or merchant_zip.stat().st_size != browser_result["merchantArchive"]["bytes"]
                    or file_digest(merchant_zip, 6 * 256 * 1024 * 1024) != browser_result["merchantArchive"]["sha256"]):
                raise RuntimeError("Retain the actual original browser merchant download")
            merchant_directory = private_directory(delivery / "browser-merchant")
            atomic(receipts / "merchant-receiving-input.json", plain({"operation": OPERATION,
                "sourcePin": SOURCE_PIN, "build": audit_build["id"], "source": audit["source"],
                "request": merchant_request, "archive": browser_result["merchantArchive"]}), same=True)
            with zipfile.ZipFile(merchant_zip) as archive:
                members = archive.infolist()
                names = [member.filename for member in members]
                if len(names) != len(set(names)) or not 1 <= len(names) <= 32 or "merchant.json" not in names:
                    raise RuntimeError("The original merchant download has an invalid file set")
                manifest_info = archive.getinfo("merchant.json")
                if manifest_info.file_size > 1048576:
                    raise RuntimeError("The original merchant manifest exceeds its native size")
                manifest = json.loads(archive.read(manifest_info))
                if manifest.get("schema") != "stellar-forge.ndjson-merchant.v1" or not isinstance(manifest.get("files"), dict) or set(names) != set(manifest["files"]) | {"merchant.json"}:
                    raise RuntimeError("The merchant archive differs from its original file manifest")
                for member in members:
                    parts = Path(member.filename).parts
                    if (member.filename.startswith("/") or ".." in parts or not parts
                            or member.is_dir() or stat.S_ISLNK(member.external_attr >> 16)
                            or member.flag_bits & 1 or member.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                            or member.file_size > 256 * 1024 * 1024):
                        raise RuntimeError("The original merchant archive contains an invalid member")
                for member in members:
                    destination = merchant_directory / member.filename
                    parent = private_directory(destination.parent)
                    descriptor, temporary = tempfile.mkstemp(prefix=".native-merchant-", dir=parent)
                    try:
                        with archive.open(member) as incoming, os.fdopen(descriptor, "wb") as output:
                            os.chmod(temporary, 0o600)
                            used = 0
                            while block := incoming.read(1048576):
                                used += len(block)
                                if used > member.file_size:
                                    raise RuntimeError("The original merchant archive member changed size")
                                output.write(block)
                            if used != member.file_size:
                                raise RuntimeError("The original merchant archive member is incomplete")
                            output.flush(); os.fsync(output.fileno())
                        if destination.exists():
                            if destination.is_symlink() or file_digest(destination) != file_digest(Path(temporary)):
                                raise RuntimeError("The retained original merchant file changed: " + member.filename)
                        else:
                            os.link(temporary, destination)
                    finally:
                        Path(temporary).unlink(missing_ok=True)
            merchant_run = subprocess.run([str(node), str(Path(args.merchant_driver).resolve(strict=True)),
                "--prepared", str(merchant_directory), "--source-root", str(source_root),
                "--request", str(Path(args.merchant_request).resolve(strict=True)),
                "--build", audit_build["id"], "--source", audit["source"]],
                capture_output=True, timeout=90, check=False)
            atomic(receipts / "merchant-native-status.stderr", merchant_run.stderr)
            if merchant_run.returncode:
                raise RuntimeError("The original merchant receiver returned exit " + str(merchant_run.returncode))
            merchant_received = record("merchant-native-received", load_json(merchant_run.stdout))
            if merchant_received.get("status") != "COMPLETE":
                raise RuntimeError("Retain the original generated customer SDK receiving result")
            final_state = record("customer-final-state", customer.state())

        with Workspace(customer_path) as final:
            final_query = record("customer-final-reopen", final.query(audit_build["id"], {"limit": "50"}))
            if final_query["response"] != audit_query["response"]:
                raise RuntimeError("Customer source changed after its native browser and receiving closed")
        result = {"schema": SCHEMA, "operation": OPERATION, "status": "COMPLETE",
            "sourcePin": SOURCE_PIN, "completedAt": stamp(),
            "sourceKind": "actual-native-kafka", "topic": inspection["topic"],
            "clusterId": inspection["clusterId"], "topicId": inspection["topicId"],
            "client": inspection["client"], "capture": capture["id"], "captureRevision": capture["revision"],
            "ranges": capture["ranges"], "records": capture["records"],
            "keyedCapture": keyed_capture["id"], "keyedCaptureRevision": keyed_capture["revision"],
            "keyedRanges": keyed_capture["ranges"], "currentRecords": current["records"],
            "retainedBytes": capture["retainedBytes"], "auditProjection": audit["id"],
            "currentProjection": current["id"], "auditBuild": audit_build["id"],
            "currentBuild": current_build["id"], "comparison": comparison["id"],
            "receiving": [item["id"] for item in received], "wireMessages": {
                "file": str(full_path), "records": message_count, "sha256": file_digest(full_path, 6 * 256 * 1024 * 1024)},
            "archives": archives, "browser": browser_result, "merchant": merchant_received,
            "customerWorkspace": str(customer_path), "receipts": str(receipts),
            "source": sources, "merchantSource": merchant_sources, "closed": {"browser": True, "console": True, "nativeDataset": True, "workspace": True}}
        if consumer_input is not None:
            result["clientMcp"] = {"input": consumer_input, "result": consumer_result}
            result["closed"]["clientMcp"] = True
        atomic(root / "result.json", api_bytes(result))
        print(json.dumps({key: result[key] for key in ("schema", "operation", "status", "sourcePin",
            "topic", "records", "auditBuild", "currentBuild", "receiving", "completedAt")}), flush=True)
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ReceivingInterrupted as error:
        sys.exit(130 if error.number == signal.SIGINT else 143)
    except Exception as error:
        print("Kafka original receiving: " + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
