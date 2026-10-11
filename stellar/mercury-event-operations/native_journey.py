"""One joined HTTP/CLI operating journey using Mercury's published wire contract.

The local provider serves controlled event rows; the real application and customer
SQLite/HTTP adapters perform every operation. Outputs identify that input origin.
"""
from __future__ import annotations

import argparse
import base64
from dataclasses import replace
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import resource
import secrets
import sqlite3
import struct
import subprocess
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

from mercury_ops.config import load_config
from mercury_ops.delivery import deliver_sqlite
from mercury_ops.engine import Engine
from mercury_ops.web import make_server


ROOT = Path(__file__).resolve().parent
CONTRACT = "CDVNV4HBU5WBEQO5K7YZW7NULFLHOTYMUMYUGSPAU2QOADZRIJYTYMM6"
TX = hashlib.sha256(b"mercury-documentation-contract-example-transaction").hexdigest()
TX2 = hashlib.sha256(b"mercury-documentation-contract-example-next-transaction").hexdigest()


def canonical_rows():
    # SCV_SYMBOL=15 and SCV_I128=10 are from Stellar-contract.x. Preserve
    # the encoded values through the provider, operations store and destination.
    symbol = base64.b64encode(struct.pack(">iI", 15, 7) + b"deposit\0").decode()
    data = base64.b64encode(struct.pack(">iqQ", 10, 0, 100000)).decode()
    result = []
    for row_id, transaction, index in ((4201, TX, 0), (4202, TX, 1), (4203, TX2, None)):
        result.append({"id": row_id, "contract_id": CONTRACT, "tx": transaction,
            "event_index": index, "data": data,
            **{f"topic{i}": symbol if i == 1 else None for i in range(1, 11)}})
    other = dict(result[-1], id=4204, event_index=2)
    other["topic1"] = base64.b64encode(struct.pack(">iI", 15, 8) + b"withdraw").decode()
    result.append(other)
    return result


def start_server(server):
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    thread.start()
    return thread


def stop_server(server, thread):
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def http(url, *, token=None, body=None, raw=None, headers=None):
    outgoing = dict(headers or {})
    if token:
        outgoing["Authorization"] = "Bearer " + token
    if body is not None:
        raw = json.dumps(body, separators=(",", ":")).encode()
        outgoing["Content-Type"] = "application/json"
    request = Request(url, data=raw, headers=outgoing, method="POST" if raw is not None else "GET")
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, response.read(), response.headers
    except HTTPError as error:
        return error.code, error.read(), error.headers


def run(output):
    started = time.monotonic()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    workspace = output / "workspace"
    process = subprocess.run([sys.executable, "-B", "-m", "mercury_ops", "init", str(workspace), "--network", "testnet"],
        cwd=ROOT, capture_output=True, text=True, check=True)
    initial = json.loads(process.stdout)
    operator_token = initial["operator_token"]
    provider_token = secrets.token_urlsafe(32)
    webhook_secret = secrets.token_urlsafe(32)
    destination_secret = secrets.token_urlsafe(32)
    env = {
        "MERCURY_NATIVE_PROVIDER": provider_token, "MERCURY_NATIVE_WEBHOOK": webhook_secret,
        "MERCURY_NATIVE_OPERATOR": operator_token, "MERCURY_NATIVE_DESTINATION": destination_secret,
    }
    for key, value in env.items():
        os.environ[key] = value
    rows = canonical_rows()
    requests = []
    deliveries = []
    provider_errors = []
    customer_errors = []
    customer_config = None

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            parsed = urlsplit(self.path)
            if self.headers.get("Authorization") != "Bearer " + provider_token:
                self.send_error(401)
                return
            try:
                query = parse_qs(parsed.query)
                if parsed.path.startswith("/rest/events/by-tx/"):
                    transaction = parsed.path.rsplit("/", 1)[1]
                    response = [row for row in rows if row["tx"] == transaction]
                elif parsed.path == "/rest/events/by-ledger/contracts":
                    assert query["contracts"] == [CONTRACT]
                    assert query["from"] == ["400000"] and query["to"] == ["400003"]
                    cursor = int(query.get("cursor", ["0"])[0])
                    response = [row for row in rows if row["id"] > cursor][:int(query["limit"][0])]
                else:
                    self.send_error(404)
                    return
                requests.append({"path": self.path, "row_ids": [row["id"] for row in response]})
                raw = json.dumps(response, separators=(",", ":")).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except Exception as error:
                provider_errors.append(type(error).__name__)
                self.send_error(500)

    class Customer(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            try:
                assert self.path == "/events"
                raw = self.rfile.read(int(self.headers["Content-Length"]))
                assert hmac.compare_digest(self.headers["X-Mercury-Ops-Signature"], hmac.new(destination_secret.encode(), raw, hashlib.sha256).hexdigest())
                assert self.headers["X-Mercury-Ops-Payload-SHA256"] == hashlib.sha256(raw).hexdigest()
                envelope = json.loads(raw)
                key = self.headers["Idempotency-Key"]
                result = deliver_sqlite(customer_config, envelope, key)
                assert result.status == "delivered", result.detail
                deliveries.append({"event_id": key, "provider_row_id": envelope["provider_row_id"], "reused": result.receipt["reused"]})
                # The first customer commit succeeds, but the HTTP acknowledgement
                # fails. Retrying must find the same event in the destination.
                status = 500 if len(deliveries) == 1 else 200
                self.send_response(status)
                self.send_header("Content-Length", "0")
                self.send_header("Retry-After", "0.1")
                self.end_headers()
            except Exception as error:
                customer_errors.append(type(error).__name__)
                self.send_error(500)

    provider = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    customer = ThreadingHTTPServer(("127.0.0.1", 0), Customer)
    provider_thread, customer_thread = start_server(provider), start_server(customer)
    operator = operator_thread = None
    try:
        config_data = json.loads(Path(initial["config_path"]).read_text())
        config_data.update({"network": "documented-local-journey", "provider_scope": "source-contract-example",
            "api_base": f"http://127.0.0.1:{provider.server_port}/rest", "contracts": [CONTRACT],
            "topic_filters": {"topic1": rows[0]["topic1"]},
            "allow_local_http": True, "provider_token_env": "MERCURY_NATIVE_PROVIDER",
            "webhook_secret_env": "MERCURY_NATIVE_WEBHOOK", "operator_token_env": "MERCURY_NATIVE_OPERATOR",
            "retry_base_seconds": 0.1, "retry_max_seconds": 1, "worker_poll_seconds": 0.1,
            "destination": {"kind": "http", "url": f"http://127.0.0.1:{customer.server_port}/events",
                "hmac_secret_env": "MERCURY_NATIVE_DESTINATION", "idempotency_supported": True}})
        Path(initial["config_path"]).write_text(json.dumps(config_data, indent=2) + "\n")
        config = load_config(initial["config_path"])
        customer_config = replace(config, destination={"kind": "sqlite", "path": str(output / "customer.sqlite3"), "table": "mercury_events"})
        engine = Engine(config)
        operator = make_server(config, engine, port=0)
        operator_thread = start_server(operator)
        origin = f"http://127.0.0.1:{operator.server_port}"
        assert http(origin + "/api/status")[0] == 401
        assert http(origin + "/api/status", token=operator_token)[0] == 200
        notification = {"event": {"ext": "v0", "contract_id": CONTRACT, "type_": "contract",
            "body": {"v0": {"topics": [{"symbol": "deposit"}], "data": {"i128": "100000"}}}}, "tx_hash": TX}
        raw = json.dumps(notification, indent=1).encode()
        signature = hmac.new(webhook_secret.encode(), raw, hashlib.sha256).hexdigest()
        headers = {"Content-Type": "application/json", "X-Mercury-Signature": signature,
                   "X-Mercury-Timestamp": str(int(time.time()))}
        assert http(origin + "/webhooks/mercury", raw=raw + b" ", headers=headers)[0] == 401
        first = http(origin + "/webhooks/mercury", raw=raw, headers=headers)
        repeated = http(origin + "/webhooks/mercury", raw=raw, headers=headers)
        assert first[0] == repeated[0] == 202
        first_id, repeat_id = json.loads(first[1]), json.loads(repeated[1])
        assert first_id["notification_id"] == repeat_id["notification_id"] and repeat_id["reused"]
        catchup = {"job_id": "native-cursor-catchup", "ledger_from": 400000, "ledger_to": 400003, "page_size": 2}
        assert http(origin + "/api/catchups", token=operator_token, body=catchup)[0] == 201
        assert http(origin + "/api/catchups", token=operator_token, body=catchup | {"ledger_to": 400004})[0] == 409
        stop_server(operator, operator_thread)
        operator = operator_thread = None
        # Restart after acknowledged ingress and job creation, before the worker.
        engine = Engine(load_config(initial["config_path"]))
        recovery = engine.recover()
        operator = make_server(config, engine, port=0)
        operator_thread = start_server(operator)
        origin = f"http://127.0.0.1:{operator.server_port}"
        assert engine.get_notification(first_id["notification_id"])["arrivals"] == 2
        operations = []
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            operation = engine.run_once()
            if operation.get("worked"):
                operations.append(operation)
            current = engine.list_deliveries()["items"]
            if len(current) == 3 and all(item["state"] == "delivered" for item in current) and engine.get_job(catchup["job_id"])["state"] in {"complete", "completed", "succeeded"}:
                break
            if not operation.get("worked"):
                time.sleep(0.02)
        else:
            raise AssertionError({"tasks": engine.list_tasks(), "deliveries": engine.list_deliveries(), "job": engine.get_job(catchup["job_id"])})
        assert not provider_errors and not customer_errors
        with sqlite3.connect(output / "customer.sqlite3") as db:
            applied = db.execute("SELECT provider_row_id,tx_hash,event_index,envelope_json FROM mercury_events ORDER BY provider_row_id").fetchall()
        assert [row[0] for row in applied] == [4201, 4202, 4203]
        assert applied[0][1] == applied[1][1] == TX and [applied[0][2], applied[1][2]] == [0, 1]
        assert len(deliveries) == 4 and sum(item["reused"] for item in deliveries) == 1
        for row, source in zip(applied, rows):
            assert json.loads(row[3])["canonical"] == source
        status, export, export_headers = http(origin + "/api/export", token=operator_token)
        assert status == 200 and export_headers["X-Content-SHA256"] == hashlib.sha256(export).hexdigest()
        export_path = output / "http-operations.ndjson"
        export_path.write_bytes(export)
        export_path.chmod(0o600)
        command = [sys.executable, "-B", "-m", "mercury_ops", "--config", initial["config_path"], "export", "--out", str(output / "cli-operations.ndjson")]
        cli = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=True)
        cli_result = json.loads(cli.stdout)
        cli_raw = (output / "cli-operations.ndjson").read_bytes()
        assert hashlib.sha256(cli_raw).hexdigest() == cli_result["sha256"]
        assert len(cli_raw.splitlines()) == len(export.splitlines())
        backup_command = [sys.executable, "-B", "-m", "mercury_ops", "--config", initial["config_path"], "backup", "--out", str(output / "operations-backup.zip")]
        backup_process = subprocess.run(backup_command, cwd=ROOT, capture_output=True, text=True, check=True)
        backup_result = json.loads(backup_process.stdout)
        restore_command = [sys.executable, "-B", "-m", "mercury_ops", "restore", "--from", str(output / "operations-backup.zip"), "--into", str(output / "restored")]
        restored_process = subprocess.run(restore_command, cwd=ROOT, capture_output=True, text=True, check=True)
        restore_result = json.loads(restored_process.stdout)
        restored_engine = Engine(load_config(restore_result["config_path"]))
        assert len(restored_engine.list_events()["items"]) == 3
        assert all(item["state"] == "delivered" for item in restored_engine.list_deliveries()["items"])
        assert restored_engine.get_notification(first_id["notification_id"])["arrivals"] == 2
        assert list(restored_engine.iter_event_export()) == list(engine.iter_event_export())
        event_response = http(origin + "/api/events?limit=2", token=operator_token)
        page = json.loads(event_response[1])
        assert len(page["items"]) == 2 and page["next_cursor"]
        next_page = http(origin + "/api/events?limit=2&after=" + page["next_cursor"], token=operator_token)
        assert len(json.loads(next_page[1])["items"]) == 1
        result = {"schema": "mercury-ops.native-journey.v1", "state": "passed",
            "input_origin": "controlled local provider implementing the published Mercury Classic wire contract",
            "native_components": ["CLI init", "production HTTP operator", "raw-body webhook authentication", "durable SQLite operations store", "Mercury REST client", "customer signed HTTP adapter", "customer SQLite transaction", "CLI export"],
            "notification_reused": repeat_id["reused"], "restart_after_intake": True,
            "provider_requests": requests, "canonical_rows": len(applied),
            "same_transaction_events": 2, "customer_http_attempts": len(deliveries),
            "customer_insertions": len(applied), "customer_replayed_after_commit": 1,
            "topic_family": {"observed_rows": len(rows), "retained_events": len(applied), "excluded_provider_row": 4204},
            "catchup": engine.get_job(catchup["job_id"]), "recovery": recovery,
            "operations_export": {"bytes": len(export), "sha256": hashlib.sha256(export).hexdigest(), "records": len(export.splitlines())},
            "cli_export": cli_result, "event_pagination": [2, 1],
            "backup": backup_result, "restore": restore_result, "restored_event_bytes_identical": True,
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
            "source_sha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted((ROOT / "mercury_ops").rglob("*")) if path.is_file() and "__pycache__" not in path.parts},
        }
        result_path = output / "result.json"
        result_path.write_text(json.dumps(result, indent=2) + "\n")
        result_path.chmod(0o600)
        return result
    finally:
        if operator is not None:
            stop_server(operator, operator_thread)
        stop_server(provider, provider_thread)
        stop_server(customer, customer_thread)
        for key in env:
            os.environ.pop(key, None)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(run(args.output.resolve()), indent=2))
