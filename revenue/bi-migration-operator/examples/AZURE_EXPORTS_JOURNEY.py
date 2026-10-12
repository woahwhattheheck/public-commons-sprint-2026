#!/usr/bin/env python3
"""Operate the complete Azure-source billing and receiving example in new workspaces."""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import csv
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import re
import sys
import threading
from urllib.parse import parse_qs, unquote, urlsplit
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bi_operator.archive import backup, restore
from bi_operator.azure_transfer import month_bounds
from bi_operator.billing_example import load_billing_example
from bi_operator.host import WorkspaceLease
from bi_operator.service import Service
from bi_operator.store import digest, encoded, now

SCOPE = "/subscriptions/11111111-1111-1111-1111-111111111111"
EXPORT = SCOPE + "/providers/Microsoft.CostManagement/exports/commons-authored-monthly"
RUN = EXPORT + "/Run/22222222-2222-2222-2222-222222222222"
NATIVE_ROOT = "authored/commons-monthly/20260901-20260930/22222222-2222-2222-2222-222222222222"
MANIFEST_PATH = NATIVE_ROOT + "/manifest.json"
ACTOR = "Commons authored Azure receiving journey"


def file_body(data, filename):
    return {"filename": filename, "base64": base64.b64encode(data).decode()}


def record_ref(record):
    return {key: record[key] for key in ("kind", "id", "revision")}


def next_body(record, **extra):
    return {"id": record["id"], "expected": record["revision"], **extra}


class OriginalCostCarrier:
    """An explicit loopback protocol carrier for the original Commons-authored input."""
    def __init__(self):
        self.requests, self.submissions, self.interruption_delivered = [], [], False
        original = (ROOT / "examples/billing/costs.csv").read_bytes()
        reader = csv.DictReader(io.StringIO(original.decode("utf-8-sig"), newline=""))
        self.headers, rows = reader.fieldnames, list(reader)
        self.period = rows[0]["BillingPeriodStartDate"][:7]
        self.bounds = month_bounds(self.period)
        self.original = {"path": "examples/billing/costs.csv", "bytes": len(original),
                         "sha256": digest(original), "rows": len(rows)}
        self.files, entries = {}, []
        for index, values in enumerate((rows[:42], rows[42:])):
            out = io.StringIO(newline="")
            writer = csv.DictWriter(out, fieldnames=self.headers, lineterminator="\r\n", quoting=csv.QUOTE_ALL)
            writer.writeheader()
            writer.writerows(values)
            body = gzip.compress(out.getvalue().encode(), mtime=0)
            name = NATIVE_ROOT + "/part" + str(index) + ".csv.gz"
            self.files[name] = body
            entries.append({"blobName": name, "byteCount": len(body), "dataRowCount": len(values)})
        self.manifest = {
            "manifestVersion": "2024-04-01",
            "byteCount": sum(item["byteCount"] for item in entries), "blobCount": len(entries),
            "dataRowCount": len(rows),
            "exportConfig": {"exportName": "Commons authored monthly source", "resourceId": EXPORT,
                "dataVersion": "2023-05-01", "apiVersion": "2025-03-01",
                "type": "ActualCost", "timeFrame": "Custom", "granularity": "Daily"},
            "deliveryConfig": {"partitionData": True, "dataOverwriteBehavior": "OverwritePreviousReport",
                "fileFormat": "Csv", "compressionMode": "Gzip",
                "containerUri": SCOPE + "/resourceGroups/authored/providers/Microsoft.Storage/storageAccounts/authoring",
                "rootFolderPath": "authored"},
            "runInfo": {"executionType": "OnDemand", "submittedTime": "2026-10-01T00:00:00Z",
                "runId": RUN.rsplit("/", 1)[-1], "startDate": self.bounds["from"], "endDate": self.bounds["to"]},
            "blobs": entries,
        }
        self.files[MANIFEST_PATH] = (encoded(self.manifest) + "\n").encode()
        self.definition = {"id": EXPORT, "name": "commons-authored-monthly",
            "type": "Microsoft.CostManagement/exports", "eTag": '"authored-export-v1"',
            "properties": {"format": "Csv", "compressionMode": "Gzip", "partitionData": True,
                "dataOverwriteBehavior": "OverwritePreviousReport",
                "definition": {"type": "ActualCost", "timeframe": "Custom", "timePeriod": self.bounds,
                    "dataSet": {"granularity": "Daily", "configuration": {"dataVersion": "2023-05-01"}}},
                "deliveryInfo": {"destination": {"container": "costexports",
                    "resourceId": SCOPE + "/resourceGroups/authored/providers/Microsoft.Storage/storageAccounts/authoring",
                    "rootFolderPath": "authored"}}}}

    @contextmanager
    def running(self):
        carrier = self
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_):
                pass

            def respond(self, status, body=b"", headers=None, short=False):
                carrier.requests.append({"method": self.command, "path": self.path,
                    "range": self.headers.get("Range"), "if_match": self.headers.get("If-Match"),
                    "status": status, "deliberate_short_response": short})
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body[:len(body)//2] if short else body)
                    self.wfile.flush()
                self.close_connection = True

            def document(self, value):
                self.respond(200, encoded(value).encode(), {"Content-Type": "application/json"})

            def do_POST(self):
                parsed = urlsplit(self.path)
                raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                body = json.loads(raw or b"{}")
                if parsed.path != EXPORT + "/run":
                    return self.respond(404)
                if body != {"timePeriod": carrier.bounds} or carrier.submissions:
                    return self.respond(409, b'{"error":{"code":"ExampleAlreadyExecutedOrWrongPeriod"}}')
                carrier.submissions.append(body)
                self.respond(200)

            def do_HEAD(self):
                return self.do_GET()

            def do_GET(self):
                parsed = urlsplit(self.path)
                path, query = unquote(parsed.path), parse_qs(parsed.query)
                if path == SCOPE + "/providers/Microsoft.CostManagement/exports":
                    return self.document({"value": []} if query.get("cursor") else {
                        "value": [carrier.definition],
                        "nextLink": carrier.origin + path + "?api-version=2025-03-01&cursor=exports-page-2"})
                if path == EXPORT:
                    return self.document(carrier.definition)
                if path == EXPORT + "/runHistory":
                    values = [] if not carrier.submissions else [{"id": RUN, "name": RUN.rsplit("/", 1)[-1],
                        "type": "Microsoft.CostManagement/exports/run", "properties": {
                            "executionType": "OnDemand", "submittedTime": "2026-10-01T00:00:00Z",
                            "startDate": carrier.bounds["from"], "endDate": carrier.bounds["to"],
                            "status": "Completed", "manifestFile": MANIFEST_PATH,
                            "runSettings": carrier.definition["properties"]}}]
                    return self.document({"value": values})
                if path == "/storage/costexports" and query.get("comp") == ["list"]:
                    from xml.sax.saxutils import escape
                    names = sorted(carrier.files)
                    selected = names[2:] if query.get("marker") else names[:2]
                    marker = "" if query.get("marker") else "original-marker-two"
                    elements = "".join("<Blob><Name>" + escape(name) + "</Name><Properties><Content-Length>"
                        + str(len(carrier.files[name])) + "</Content-Length><Etag>&quot;" + digest(carrier.files[name])
                        + "&quot;</Etag></Properties></Blob>" for name in selected)
                    body = ("<?xml version='1.0'?><EnumerationResults><Blobs>" + elements
                        + "</Blobs><NextMarker>" + marker + "</NextMarker></EnumerationResults>").encode()
                    return self.respond(200, body, {"Content-Type": "application/xml"})
                if not path.startswith("/storage/costexports/"):
                    return self.respond(404)
                name = path[len("/storage/costexports/"):]
                if name not in carrier.files:
                    return self.respond(404)
                body = carrier.files[name]
                etag = '"' + digest(body) + '"'
                if self.headers.get("If-Match") and self.headers["If-Match"] != etag:
                    return self.respond(412, b"<Error><Code>ConditionNotMet</Code></Error>")
                headers = {"ETag": etag, "Content-Type": "application/octet-stream"}
                selected_range = self.headers.get("Range")
                if selected_range:
                    match = re.fullmatch(r"bytes=(\d+)-(\d+)", selected_range)
                    if not match:
                        return self.respond(416)
                    start, end = map(int, match.groups())
                    if start > end or end >= len(body):
                        return self.respond(416)
                    headers["Content-Range"] = f"bytes {start}-{end}/{len(body)}"
                    short = name.endswith("part0.csv.gz") and start > 0 and not carrier.interruption_delivered
                    if short:
                        carrier.interruption_delivered = True
                    return self.respond(206, body[start:end+1], headers, short=short)
                self.respond(200, body, headers)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = "http://127.0.0.1:" + str(server.server_address[1])
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield self
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=3)


class Journey:
    def __init__(self, output):
        self.output, self.service = output, None
        self.events = []

    def save(self):
        (self.output / "journey.json").write_text(json.dumps({
            "schema": "commons-bi-azure-authored-journey/1",
            "input_role": "Original Commons-authored 12-agency billing inputs",
            "updated": now(), "events": self.events}, indent=2), encoding="utf-8")

    def action(self, name, key, body):
        request = {**body, "operation_id": "azure-journey-" + key, "actor": ACTOR}
        result = self.service.dispatch(name, request)
        record = result["record"]
        self.events.append({"action": name, "operation_id": request["operation_id"],
            "record": record_ref(record), "state": record["payload"].get("state") or record["payload"].get("status"),
            "replayed": result.get("replayed", False)})
        self.save()
        return record

    def complete(self, kind, action, record, stem):
        count = 0
        while record["payload"]["state"] != "complete":
            count += 1
            if count > 1000:
                raise ValueError("Reopen the saved source to continue this long example operation.")
            record = self.action(action, stem + "-" + str(count), next_body(record,
                **({"chunk_bytes": 512} if kind == "azure_source" else {})))
            if record["payload"]["state"] in {"attention", "waiting", "source_changed", "canceled"}:
                raise ValueError(record["payload"].get("error") or "Reopen the saved source.")
        return record


def run(output):
    output = Path(output).expanduser().resolve()
    if output.exists():
        raise ValueError("Choose a new output directory. Reopen an existing journey with the original BI Operator.")
    output.mkdir(parents=True, mode=0o700)
    delivery = output / "delivery"
    delivery.mkdir()
    journey = Journey(output)
    carrier = OriginalCostCarrier()
    workspace = output / "workspace"
    with carrier.running(), WorkspaceLease(workspace):
        journey.service = service = Service(workspace)
        try:
            original_period = load_billing_example(service)
            original_cost = service.store.get("billing_import", original_period["payload"]["cost_imports"][0]["id"])
            profile = journey.action("azure.profile.save", "profile", {
                "label": "Original authored monthly Azure export", "scope": SCOPE,
                "container_url": carrier.origin + "/storage/costexports", "prefix": "authored",
                "local_endpoint": carrier.origin, "credential": "environment"})
            discovery = journey.action("azure.discovery.start", "discover-exports",
                {"profile_id": profile["id"], "category": "exports"})
            discovery = journey.complete("azure_discovery", "azure.discovery.advance", discovery, "exports-page")
            listing = journey.action("azure.discovery.start", "discover-blobs",
                {"profile_id": profile["id"], "category": "blobs"})
            listing = journey.complete("azure_discovery", "azure.discovery.advance", listing, "blobs-page")
            run_record = journey.action("azure.run.prepare", "prepare-run", {
                "profile_id": profile["id"], "export_id": EXPORT, "period": carrier.period})
            run_record = journey.action("azure.run.submit", "execute-run", next_body(run_record))
            run_record = journey.action("azure.run.refresh", "original-run-history", next_body(run_record))
            run_record = journey.action("azure.run.select", "select-original-run",
                next_body(run_record, native_run_id=RUN))
            source = journey.action("azure.source.select", "select-original-manifest", {
                "profile_id": profile["id"], "run_id": run_record["id"], "run_revision": run_record["revision"]})
            source = journey.action("azure.source.advance", "first-range", next_body(source, chunk_bytes=512))
            checkpoint = {"record": record_ref(source), "bytes": source["payload"]["received_bytes"],
                "chunks": source["payload"]["parts"][0]["chunks"]}
            source = journey.action("azure.source.advance", "interrupted-range", next_body(source, chunk_bytes=512))
            if not carrier.interruption_delivered or source["payload"]["received_bytes"] != checkpoint["bytes"]:
                raise ValueError("The interrupted range did not preserve its committed original checkpoint.")
            source = journey.action("azure.source.cancel", "cancel-at-checkpoint", next_body(source))
            canceled = record_ref(source)
            service.close()
            journey.service = service = Service(workspace)
            reopened = service.store.get("azure_source", canceled["id"])
            source = journey.action("azure.source.resume", "reopen-original-checkpoint", next_body(reopened))
            source = journey.complete("azure_source", "azure.source.advance", source, "remaining-range")
            preview = service.azure.preview({"id": source["id"], "partition": 0, "limit": 5})
            settings = {"period": carrier.period, "basis": "actual", "allocation_view": "supplier",
                "invoice_status": "closed", "invoice_id": "EXAMPLE-2026-09", "date_format": "iso",
                "columns": {field: header for field, header in preview["suggested"].items() if header}}
            initial = {**settings, "columns": {**settings["columns"], "description": "ResourceGroup"}}
            first_review = journey.action("azure.source.review", "initial-description-mapping", {
                "source_id": source["id"], "source_revision": source["revision"], **initial,
                "note": "Initial staff source description selected from ResourceGroup."})
            review = journey.action("azure.source.review", "correct-description-mapping", {
                "source_id": source["id"], "source_revision": source["revision"], **settings,
                "note": "Staff correction: use the original ProductName description while retaining native resource-group selection."})
            plan = journey.action("azure.import.prepare", "prepare-billing-import", {"review_id": review["id"]})
            plan = journey.complete("azure_import", "azure.import.advance", plan, "billing-input")
            replay = service.dispatch("azure.import.prepare", {
                "operation_id": "azure-journey-prepare-billing-import", "actor": ACTOR, "review_id": review["id"]})
            if not replay.get("replayed"):
                raise ValueError("The original import preparation did not reopen.")
            period = journey.action("billing.period.prepare", "prepare-acquired-period", {
                "label": "Azure acquired original authored 12-agency allocation", "period": carrier.period,
                "policy_id": original_period["payload"]["policy"]["id"],
                "policy_revision": original_period["payload"]["policy"]["revision"],
                "cost_import_ids": [item["billing"]["id"] for item in plan["payload"]["imports"]],
                "usage_import_ids": [item["id"] for item in original_period["payload"]["usage_imports"]],
                "minor_units": 2, "adjustments": [], "notes": "Original Commons authored source through native Azure receiving."})
            period = journey.action("billing.period.review", "review-agency-period",
                next_body(period, note="Reviewed complete source, mapping, supplier view and original agency allocation."))
            period = journey.action("billing.period.finalize", "finalize-agency-period",
                next_body(period, note="Finalize the original authored operating period."))
            statements = journey.action("billing.period.export", "export-original-statements",
                {"id": period["id"], "revision": period["revision"]})
            archive_meta = statements["payload"]["archive"]
            statement_bytes = service.store.bytes(archive_meta["digest"])
            (delivery / archive_meta["name"]).write_bytes(statement_bytes)
            with zipfile.ZipFile(io.BytesIO(statement_bytes)) as package:
                prefix = "sources/azure/" + source["payload"]["manifest"]["digest"] + "/"
                if package.read(prefix + "manifest.json") != carrier.files[MANIFEST_PATH]:
                    raise ValueError("The finalized statement lost its original native manifest.")
                for part in source["payload"]["parts"]:
                    name = prefix + "parts/" + str(part["index"]).zfill(4) + "/" + part["name"]
                    if package.read(name) != carrier.files[part["name"]]:
                        raise ValueError("The finalized statement changed an original native partition.")
            handoff = journey.action("azure.handoff.prepare", "prepare-portable-source", {
                "source_id": source["id"], "source_revision": source["revision"],
                "review_id": review["id"], "review_revision": review["revision"]})
            handoff = journey.complete("azure_delivery", "azure.handoff.advance", handoff, "portable-volume")
            volumes = []
            for item in handoff["payload"]["volumes"]:
                path = delivery / item["name"]
                path.write_bytes(service.store.bytes(item["digest"]))
                volumes.append({**item, "path": str(path)})
            backup_path = delivery / "Azure-Authored-Workspace.bi-backup"
            password = "Commons authored Azure receiving example"
            backed_up = backup(service.store, backup_path, password)
            outcome = {"workspace_id": service.store.setting("workspace_id"), "workspace": str(workspace),
                "original_cost": record_ref(original_cost), "original_period": record_ref(original_period),
                "input": carrier.original, "profile": record_ref(profile), "export_pages": len(discovery["payload"]["pages"]),
                "blob_pages": len(listing["payload"]["pages"]), "native_run": record_ref(run_record),
                "provider_executions": len(carrier.submissions), "checkpoint": checkpoint,
                "canceled": canceled, "source": record_ref(source), "first_review": record_ref(first_review),
                "review": record_ref(review), "import": record_ref(plan), "prepare_replayed": replay.get("replayed"),
                "period": record_ref(period), "totals": period["payload"]["totals"],
                "statements": {**archive_meta, "path": str(delivery / archive_meta["name"])},
                "handoff": record_ref(handoff), "volumes": volumes, "backup": backed_up}
        finally:
            service.close()
    receiver = output / "receiver"
    with WorkspaceLease(receiver):
        journey.service = service = Service(receiver)
        try:
            for index, volume in enumerate(reversed(volumes)):
                receipt = journey.action("azure.handoff.receive", "receive-volume-" + str(index),
                    file_body(Path(volume["path"]).read_bytes(), volume["name"]))
            repeated = journey.action("azure.handoff.receive", "receive-original-volume-again",
                file_body(Path(volumes[0]["path"]).read_bytes(), volumes[0]["name"]))
            if receipt["payload"]["state"] != "complete" or record_ref(repeated) != record_ref(receipt):
                raise ValueError("The complete source did not reopen on repeated receiving.")
            received = service.store.get("azure_source", receipt["payload"]["source"]["id"])
            saved_review = received["payload"]["received_review"]
            received_review = journey.action("azure.source.review", "restore-received-mapping", {
                "source_id": received["id"], "source_revision": received["revision"],
                **saved_review["payload"]["settings"], "note": saved_review["payload"]["note"]})
            received_plan = journey.action("azure.import.prepare", "prepare-received-billing-inputs",
                {"review_id": received_review["id"]})
            received_plan = journey.complete("azure_import", "azure.import.advance", received_plan, "received-billing-input")
            outcome["receiving"] = {"workspace": str(receiver), "receipt": record_ref(receipt),
                "source": record_ref(received), "review": record_ref(received_review), "import": record_ref(received_plan)}
        finally:
            service.close()
    restored = output / "restored-workspace"
    restored_result = restore(backup_path, restored, password)
    with WorkspaceLease(restored):
        service = Service(restored)
        try:
            restored_source = service.store.get("azure_source", source["id"])
            restored_period = service.store.get("billing_period", period["id"])
            restored_delivery = service.store.get("billing_delivery", statements["id"])
            if (record_ref(restored_source) != record_ref(source) or record_ref(restored_period) != record_ref(period)
                    or service.store.bytes(restored_delivery["payload"]["archive"]["digest"]) != statement_bytes):
                raise ValueError("The restored original source or statement edition changed.")
            outcome["restored"] = {**restored_result, "source": record_ref(restored_source),
                "period": record_ref(restored_period), "statement_sha256": digest(statement_bytes)}
        finally:
            service.close()
    (output / "native-protocol.json").write_text(json.dumps({
        "input_role": "Original Commons-authored billing example", "manifest": carrier.manifest,
        "submissions": carrier.submissions, "requests": carrier.requests}, indent=2), encoding="utf-8")
    outcome.update({"complete": True, "completed": now()})
    (output / "outcome.json").write_text(json.dumps(outcome, indent=2), encoding="utf-8")
    (output / "OPEN_FIRST.md").write_text(
        "# Complete Azure source receiving example\n\n"
        "Open the existing Commons BI Operator with --workspace " + str(workspace) + " serve.\n\n"
        "Azure exports contains the acquired original authored source, retained interruption checkpoint, two staff "
        "mapping reviews and original billing import. Agency billing contains its finalized 12-agency period. "
        "The receiver directory contains the independently received source and rebuilt billing mapping. "
        "restored-workspace reopens the original workspace identity and byte-identical statement package.\n\n"
        "delivery/ contains every portable source volume, the complete original statement package and an encrypted "
        "full-workspace backup. Its example-only passphrase is: " + password + ".\n\n"
        "outcome.json names all retained original records, files and complete amounts. native-protocol.json "
        "contains the actual local protocol exchanges over examples/billing/costs.csv. "
        "Source role: Commons-authored operating inputs.\n", encoding="utf-8")
    return outcome


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="New directory for the complete saved operating example")
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.output), indent=2))
    except (ValueError, KeyError, OSError) as error:
        print(json.dumps({"error": str(error), "saved_output": str(Path(args.output).resolve())}), file=sys.stderr)
        raise SystemExit(1)
