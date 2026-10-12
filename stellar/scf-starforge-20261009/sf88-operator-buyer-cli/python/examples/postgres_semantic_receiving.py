#!/usr/bin/env python3
"""Receive an original semantic delivery through PostgreSQL, then reopen it.

This operating example consumes the caller's complete original delivery. It
retains two reviewed SQL mappings of that same input, opens the customer browser,
downloads original files and checks the same editions after a database restart.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

from stellar_forge_buyer.postgres_delivery import PostgresWarehouse, load_delivery_report
from stellar_forge_buyer.postgres_http import serve
from stellar_forge_buyer.storage import dump, parse, private_directory, read, write


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def exact_file(path, raw):
    private_directory(path.parent)
    if path.exists():
        require(read(path, max(len(raw), 1)) == raw, "Existing received file differs: " + str(path))
    else:
        write(path, raw, exclusive=True)
    return {"path": str(path), "bytes": len(raw), "sha256": sha(raw)}


@contextmanager
def opened(warehouse, directory):
    server, _, launch = serve(warehouse, directory)
    thread = threading.Thread(target=server.serve_forever, daemon=False)
    thread.start()
    address = urlsplit(launch)
    origin = address.scheme + "://" + address.netloc

    def request(path, body=None, *, raw=False):
        headers = {"X-Postgres-Capability": address.fragment, "Origin": origin}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        with urlopen(Request(origin + path, data=data, headers=headers), timeout=300) as response:
            value = response.read()
            if raw:
                return value, dict(response.headers)
            return parse(value)

    try:
        yield request, launch
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def receive_review(request, inspected, mapping, reviewer, *, record_id=None):
    note = "Receive original source meanings with this complete SQL mapping."

    def matches(review):
        return (review["source_sha256"] == inspected["source_sha256"]
                and review["mapping"] == mapping and review["reviewer"] == reviewer
                and review["note"] == note)

    if record_id is not None:
        review = request("/api/reviews/" + record_id)
        require(matches(review), "The original receiving review differs from this source, mapping or reviewer.")
        return review
    before = None
    while True:
        suffix = "" if before is None else "&before=" + quote(before, safe="")
        page = request("/api/reviews?limit=100" + suffix)
        for item in page["reviews"]:
            review = request("/api/reviews/" + item["record_id"])
            if matches(review):
                return review
        before = page["next_before"]
        if before is None:
            break
    return request("/api/reviews", {
        "report_path": inspected["source_path"], "mapping": mapping, "reviewer": reviewer,
        "expected_report_sha256": inspected["source_sha256"], "note": note,
    })


def retained_request(request, request_id):
    # An unavailable record file is not an absent request. Use the native index
    # to distinguish absence before opening the exact retained request body.
    before = None
    while True:
        suffix = "" if before is None else "&before=" + quote(before, safe="")
        page = request("/api/requests?limit=100" + suffix)
        for item in page["requests"]:
            if item["record_id"] == request_id:
                return request("/api/requests/" + request_id)
        before = page["next_before"]
        if before is None:
            return None


def prepare_import(request, inspected, mapping, reviewer, checkpoint):
    review = None
    if checkpoint is None:
        review = receive_review(request, inspected, mapping, reviewer)
        request_id = sha(("semantic-import/" + review["version_id"]).encode())[:32]
    else:
        request_id = checkpoint["request_id"]
    original = retained_request(request, request_id)
    if original is not None:
        body = original["body"]
        require(original["route"] == "/api/import"
                and set(body) == {"review_id", "request_id"} and body["request_id"] == request_id,
                "The retained request is not this original dataset import.")
        # The version can have several named reviews. An existing request owns
        # its first review, including when an earlier client lost its response.
        review = receive_review(request, inspected, mapping, reviewer, record_id=body["review_id"])
    else:
        if checkpoint is not None:
            review = receive_review(request, inspected, mapping, reviewer, record_id=checkpoint["review_id"])
        body = {"review_id": review["record_id"], "request_id": request_id}
    if checkpoint is not None:
        require(checkpoint["review_id"] == review["record_id"]
                and checkpoint["version_id"] == review["version_id"],
                "The original receiving checkpoint and retained import differ.")
    return review, body


def read_rows(request, version_id):
    after, rows, pages = 0, [], 0
    while True:
        page = request("/api/rows?version_id=" + version_id + "&limit=13&include_original=true&after=" + str(after))
        rows.extend(page["rows"])
        pages += 1
        after = page["next_after"]
        if after is None:
            break
    return rows, pages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--schema", default="sf_semantic_receiving")
    parser.add_argument("--connection-env", default="SF_BUYER_POSTGRES_DSN")
    parser.add_argument("--reviewer", default="Dataset receiving operator")
    parser.add_argument("--phase", choices=("receive", "reopen"), default="receive")
    parser.add_argument("--node", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node"))
    parser.add_argument("--node-modules", type=Path)
    parser.add_argument("--chromium", type=Path)
    args = parser.parse_args()
    args.reviewer = args.reviewer.strip()
    require(args.reviewer and len(args.reviewer.encode()) <= 160 and "\x00" not in args.reviewer,
            "Provide a reviewer name of at most 160 UTF-8 bytes.")
    os.umask(0o077)
    directory = private_directory(args.directory)
    result_path = directory / "receiving.json"
    original_report = read(args.report, 8 * 1024 * 1024)
    report_sha = sha(original_report)
    result = parse(read(result_path, 16 * 1024 * 1024)) if result_path.exists() else {
        "schema": "stellar-forge.postgres-semantic-receiving.v1",
        "report_sha256": report_sha, "report_path": str(args.report.resolve()),
        "warehouse_schema": args.schema, "state": "PREPARED", "editions": [],
    }
    require(result["report_sha256"] == report_sha and result["warehouse_schema"] == args.schema,
            "Continue the original delivery and warehouse schema.")

    def save():
        dump(result_path, result)

    expected = result.get("warehouse_id")
    warehouse = PostgresWarehouse.from_environment(
        args.connection_env, schema=args.schema, create=expected is None,
        expected_warehouse=expected)
    result["warehouse_id"] = warehouse.warehouse_id
    save()

    if result.get("state") == "COMPLETE":
        args.phase = "reopen"
    if args.phase == "reopen":
        require(result.get("state") in {"RECEIVED", "COMPLETE"} and len(result["editions"]) == 2,
                "Finish the original receiving operation before database reopen.")
        with opened(warehouse, directory / "operator") as (request, _):
            state = request("/api/state")
            require(state["identity"]["warehouse_id"] == result["warehouse_id"], "Warehouse identity changed.")
            for item in result["editions"]:
                edition = request("/api/versions/" + item["version_id"])
                original, _ = request("/api/semantics-file?version_id=" + item["version_id"], raw=True)
                require(edition["semantics_status"] == "RETAINED" and
                        sha(original) == result["dictionary"]["sha256"], "Reopened original dictionary differs.")
                saved = request("/api/requests/" + item["request_id"])
                require(saved["state"] == "COMPLETE", "Original import request did not reopen.")
                rows, pages = read_rows(request, item["version_id"])
                require(sha(("".join(row["original_json"] + "\n" for row in rows)).encode()) ==
                        result["original_rows_sha256"], "Reopened original row bytes differ.")
                item["reopened_pages"] = pages
            current = request("/api/current?name=source_data")
            require(current["revision"] == result["selection"]["revision"] and
                    current["version"]["version_id"] == result["editions"][0]["version_id"],
                    "Original selected application view changed.")
        result["state"] = "COMPLETE"
        result["reopened_at"] = datetime.now(timezone.utc).isoformat()
        save()
        print(json.dumps({"state": result["state"], "result": str(result_path),
                          "warehouse_id": result["warehouse_id"], "editions": len(result["editions"])}))
        return 0

    require(args.node_modules is not None and args.chromium is not None,
            "Select the receiving host's existing Playwright node_modules and Chromium.")
    delivery = load_delivery_report(args.report)
    source_dictionary = delivery.file("semantics.json").read_bytes(limit=2 * 1024 * 1024)
    source_rows = delivery.file("dataset.jsonl").read_bytes(limit=128 * 1024 * 1024)
    result["dictionary"] = exact_file(directory / "source" / "semantics.json", source_dictionary)
    result["original_rows_sha256"] = sha(source_rows)
    result["state"] = "RECEIVING"
    save()
    with opened(warehouse, directory / "operator") as (request, launch):
        inspected = request("/api/inspect-delivery", {"report_path": str(args.report.resolve())})
        require(inspected["semantics_status"] == "AVAILABLE", "The original semantic delivery is required.")
        mapping = json.loads(json.dumps(inspected["mapping"]))
        primary = inspected["semantic_dictionary"]["primaryKey"]
        source_keys = primary["projected"]
        by_source = {column["source"]: column for column in mapping["columns"]}
        if (primary["complete"] and source_keys and all(name in by_source and
                not by_source[name]["nullable"] and by_source[name]["type"] != "json" for name in source_keys)):
            mapping["keys"] = list(source_keys)
        following = json.loads(json.dumps(mapping))
        used = {column["column"].casefold() for column in mapping["columns"]}
        number = 1
        while "received_field_" + str(number) in used:
            number += 1
        following["columns"][0]["column"] = "received_field_" + str(number)
        labels = ("original", "alternate-alias")
        received = {item["label"]: item for item in result["editions"]}
        require(len(received) == len(result["editions"]) and set(received) <= set(labels),
                "The original receiving checkpoints have unexpected edition labels.")
        for label, chosen in (("original", mapping), ("alternate-alias", following)):
            checkpoint = received.get(label)
            review, import_body = prepare_import(request, inspected, chosen, args.reviewer, checkpoint)
            item = dict(checkpoint or {})
            item.update(label=label, version_id=review["version_id"],
                        request_id=import_body["request_id"], review_id=review["record_id"])
            received[label] = item
            result["editions"] = [received[name] for name in labels if name in received]
            # Save the chosen original review and request before the import can
            # commit. Keep both editions' previous rows and downloads on retry.
            save()
            imported = request("/api/import", import_body)
            edition = imported["result"]
            require(imported["state"] == "COMPLETE" and edition["semantics_status"] == "RETAINED"
                    and edition["version_id"] == item["version_id"],
                    "The full original dictionary and row import did not complete.")
            version_id = edition["version_id"]
            rows, pages = read_rows(request, version_id)
            require(len(rows) == inspected["row_count"] and
                    ("".join(row["original_json"] + "\n" for row in rows)).encode() == source_rows,
                    "The complete received original rows differ.")
            downloads = []
            for route, filename in (("semantics-file", "semantics.json"), ("manifest", "manifest.json"),
                                    ("mapping", "mapping.json"), ("edition", "edition.json")):
                raw, headers = request("/api/" + route + "?version_id=" + version_id, raw=True)
                require(headers.get("X-Content-SHA256") == sha(raw), "Native download identity differs.")
                if route == "semantics-file":
                    require(raw == source_dictionary, "The retained dictionary bytes changed.")
                downloads.append(exact_file(directory / label / filename, raw))
            item.update(rows=len(rows), pages=pages, downloads=downloads)
            save()
        first_id, second_id = (received[label]["version_id"] for label in labels)
        current = request("/api/current?name=source_data")
        selection_id = sha(("semantic-select/" + first_id).encode())[:32]
        baseline = result.get("selection_body")
        if baseline is None:
            baseline = {"name": "source_data", "version_id": first_id,
                        "expected_revision": current["revision"], "request_id": selection_id}
            result["selection_body"] = baseline
            save()
        selection = request("/api/activate", baseline)
        result["selection"] = {"revision": selection["result"]["revision"],
                               "version_id": first_id, "request_id": selection_id}
        comparison = request("/api/semantic-compare?previous=" + first_id + "&current=" + second_id)
        require(comparison["mapping_changed"] and not comparison["definition_changed"] and
                not comparison["capture_changed"] and len(comparison["columns"]) == 1,
                "The original dictionary/changed SQL alias comparison differs.")
        result["comparison"] = exact_file(directory / "meaning-comparison.json",
            (json.dumps(comparison, ensure_ascii=False, indent=2) + "\n").encode())
        config = {"url": launch, "report": str(args.report.resolve()), "version_ids": [first_id, second_id],
                  "directory": str(directory / "browser"), "node_modules": str(args.node_modules.resolve()),
                  "chromium": str(args.chromium.resolve()), "dictionary_sha256": sha(source_dictionary),
                  "rows": inspected["row_count"]}
        config_path = directory / "browser-input.private.json"
        dump(config_path, config)
        driver = Path(__file__).with_name("postgres_semantic_browser.mjs")
        browser = subprocess.run([args.node, str(driver), str(config_path)],
                                  capture_output=True, text=True, timeout=300)
        write(directory / "browser.log", browser.stdout.encode() + browser.stderr.encode())
        require(browser.returncode == 0, "Open the original browser log for the receiving failure.")
        result["browser"] = parse(read(directory / "browser" / "receiving.json", 4 * 1024 * 1024))
        require(result["browser"]["state"] == "COMPLETE", "Original browser receiving is incomplete.")
        config_path.unlink()
        # Exercise the installed CLI against the same committed PostgreSQL state.
        cli_output = directory / "cli-semantics.json"
        command = [sys.executable, "-m", "stellar_forge_buyer.postgres_cli",
                   "--connection-env", args.connection_env, "--schema", args.schema,
                   "--expect-warehouse", warehouse.warehouse_id, "semantics", first_id]
        cli = subprocess.run(command, capture_output=True, timeout=60)
        require(cli.returncode == 0, "The original dictionary CLI did not complete.")
        context = parse(cli.stdout)
        require(context["file"]["sha256"] == sha(source_dictionary), "CLI source dictionary differs.")
        exact_file(cli_output, cli.stdout)
        result["cli"] = {"version_id": first_id, "path": str(cli_output), "sha256": sha(cli.stdout)}
    result["state"] = "RECEIVED"
    result["received_at"] = datetime.now(timezone.utc).isoformat()
    save()
    print(json.dumps({"state": result["state"], "result": str(result_path),
                      "warehouse_id": result["warehouse_id"], "rows_per_edition": inspected["row_count"],
                      "reopen": "After the existing database runtime restarts, run the same command with --phase reopen."}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
