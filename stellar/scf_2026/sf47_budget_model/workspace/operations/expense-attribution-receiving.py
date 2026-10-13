#!/usr/bin/env python3
"""Continue one original issued-buyer and SF47 case through the full expense workflow."""
from __future__ import annotations
import argparse
import base64
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import threading
import traceback
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
import zipfile

OPERATION = "grant-issued-expense-attribution-f232-20261012"
SCHEMA = "stellar-forge.grant-expense-receiving.v1"
ACTOR = "F232 original grant receiving"
MAX_ARCHIVE = 64 * 1024 * 1024

def stamp():
    return datetime.now(timezone.utc).isoformat()

def packed(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def raw_json(value):
    return (packed(value) + "\n").encode()

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def save(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def descriptor(path):
    path = Path(path)
    raw = path.read_bytes()
    return {"path": str(path), "bytes": len(raw), "sha256": digest(raw)}

def checked(path, expected_sha):
    raw = Path(path).read_bytes()
    if len(raw) > MAX_ARCHIVE or digest(raw) != expected_sha:
        raise ValueError("The selected complete input differs: " + str(path))
    return raw

def archive(raw):
    result = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as source:
        entries = source.infolist()
        if len(entries) > 2000 or sum(x.file_size for x in entries) > MAX_ARCHIVE:
            raise ValueError("The selected complete input exceeds its receiving bound")
        for item in entries:
            name = item.filename
            path = PurePosixPath(name)
            mode = item.external_attr >> 16
            if (name in result or not name or "\\" in name or path.is_absolute()
                    or ".." in path.parts or name != path.as_posix()
                    or item.is_dir() or stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                raise ValueError("The selected archive requires distinct plain file members: " + name)
            value = source.read(item)
            if len(value) != item.file_size:
                raise ValueError("The selected archive member is incomplete: " + name)
            result[name] = value
    return result

BUYER_EXPORT = r"""
import hashlib,json,sys
from pathlib import Path
root,output,node,selected_close=map(str,sys.argv[1:5])
root,output=Path(root),Path(output)
sys.path.insert(0,str(root/'app/sf36-spend-governor/expense-workspace'))
from store import Store
store=Store(root/'project',node_executable=node)
try:
    before=store.revision()
    closes=[r[0] for r in store.connection.execute('SELECT id FROM closes ORDER BY id')]
    if selected_close:
        if selected_close not in closes:raise ValueError('The selected original close is not retained')
    elif len(closes)==1:selected_close=closes[0]
    else:raise ValueError('Select one original issued close with --close-id')
    source=store.accountant_source(selected_close)
    complete=store.accountant_delivery(selected_close,expected_revision=before)
    value=json.loads(source)
    if store.revision()!=before:raise AssertionError('Reading the original accountant delivery advanced its revision')
    output.mkdir(parents=True,exist_ok=True,mode=0o700)
    for filename,raw in [('issued-buyer-source.json',source),('buyer-accountant-delivery.zip',complete)]:
        target=output/filename
        if target.exists() and target.read_bytes()!=raw:
            # The original ZIP exporter may retain a new transport timestamp.
            # Reuse the already selected complete original bytes for this operation.
            if filename.endswith('.json'):raise ValueError('The retained original issued source changed')
        else:target.write_bytes(raw);target.chmod(0o600)
    print(json.dumps({'workspaceId':value['workspaceId'],'closeId':selected_close,'revision':before,
        'source':{'path':str(output/'issued-buyer-source.json'),'bytes':len(source),'sha256':hashlib.sha256(source).hexdigest()},
        'delivery':{'path':str(output/'buyer-accountant-delivery.zip'),'bytes':(output/'buyer-accountant-delivery.zip').stat().st_size,
                    'sha256':hashlib.sha256((output/'buyer-accountant-delivery.zip').read_bytes()).hexdigest()},
        'returns':store.connection.execute('SELECT COUNT(*) FROM accountant_returns WHERE close_id=?',(selected_close,)).fetchone()[0]}))
finally:store.close()
"""

def prepare_buyer(work, raw, node, close_id):
    directory = work / "original-buyer"
    marker = directory / "selected-archive.json"
    selection = {"sha256": digest(raw), "bytes": len(raw)}
    if marker.exists():
        if json.loads(marker.read_text()) != selection:
            raise ValueError("The retained original buyer input changed")
    else:
        if directory.exists() and any(directory.iterdir()):
            raise ValueError("The original buyer materialization is incomplete; retain it before recovering")
        for name, value in archive(raw).items():
            save(directory / name, value)
        save(marker, raw_json(selection))
    output = work / "issued-inputs"
    result = subprocess.run([sys.executable, "-I", "-B", "-c", BUYER_EXPORT,
        str(directory), str(output), node, close_id or ""], text=True, capture_output=True, timeout=90)
    save(work / "original-buyer-export.log", (result.stdout + result.stderr).encode())
    if result.returncode != 0:
        raise RuntimeError("The original Buyer Expenses exporter failed: " + result.stderr[-4000:])
    value = json.loads(result.stdout)
    if value["returns"] < 1:
        raise ValueError("Select the complete original buyer project with accepted accountant returns")
    return value

def package(work):
    destination = work.with_name(work.name + ".zip")
    temporary = destination.with_suffix(".zip.writing")
    entries = []
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for path in sorted(work.rglob("*")):
            if path.is_symlink():
                raise ValueError("The retained case contains a symlink: " + str(path))
            if not path.is_file():
                continue
            name = path.relative_to(work).as_posix()
            output.write(path, name)
            entries.append(name)
    os.replace(temporary, destination)
    result = descriptor(destination) | {"files": len(entries)}
    save(destination.with_suffix(".zip.sha256"), (result["sha256"] + "  " + destination.name + "\n").encode())
    return result

def run(args):
    os.umask(0o077)
    source = Path(args.source).resolve()
    work = Path(args.work).resolve()
    work.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = work / "tmp"; temporary.mkdir(mode=0o700, exist_ok=True)
    os.environ.update({name: str(temporary) for name in ("TMPDIR", "TMP", "TEMP")})
    os.environ["SF47_BUYER_NODE"] = args.node
    sys.path.insert(0, str(source))
    from model import Workspace, canonical
    from operations import Operations
    import operations_expenses as expenses
    import managed_launch
    import server as original_server
    config = {"operationId": OPERATION, "buyerSha256": args.buyer_sha256,
              "operationsSha256": args.operations_sha256, "closeId": args.close_id}
    record_path = work / "operation.json"
    if record_path.exists():
        record = json.loads(record_path.read_text())
        if record.get("selection") != config:
            raise ValueError("Continue the same original selected inputs and issued close")
    else:
        record = {"schema": SCHEMA, "selection": config, "startedAt": stamp(), "status": "RUNNING",
                  "phases": [], "requests": [], "sourceEditions": []}
    record["status"] = "RUNNING"; record.pop("error", None)
    def persist():
        save(record_path, raw_json(record))
    def phase(name, operation):
        previous = next((x for x in record["phases"] if x["name"] == name and x["status"] == "PASS"), None)
        if previous:
            return previous["result"]
        record["activePhase"] = name; persist()
        print(packed({"type": "GRANT_EXPENSE_PHASE", "name": name, "status": "RUNNING"}), flush=True)
        value = operation()
        record["phases"].append({"name": name, "status": "PASS", "at": stamp(), "result": value})
        persist()
        print(packed({"type": "GRANT_EXPENSE_PHASE", "name": name, "status": "PASS"}), flush=True)
        return value
    persist()
    service = None; thread = None
    try:
        buyer_raw = checked(args.buyer_project, args.buyer_sha256)
        operations_raw = checked(args.operations_case, args.operations_sha256)
        selected_files = {}
        repository_root = source.parents[3]
        members = list(managed_launch.BOOT_FILES) + [
            "EXPENSE_ATTRIBUTION.md", "agent-client.d.mts", "operations/expense-attribution-receiving.py",
            "operations/expense-attribution-browser.mjs"]
        for name in members:
            path = (source / name).resolve()
            if not path.is_relative_to(repository_root) or not path.is_file():
                raise ValueError("The original executable source closure is incomplete: " + name)
            raw = path.read_bytes()
            selected_files[path.relative_to(repository_root).as_posix()] = raw
        if args.source_manifest:
            additional = json.loads(Path(args.source_manifest).read_text())
            if not isinstance(additional, dict) or len(additional) > 1000:
                raise ValueError("Select the original complete source map")
            for name, selected in additional.items():
                relative = PurePosixPath(name)
                path = (repository_root / name).resolve()
                if (relative.is_absolute() or ".." in relative.parts or name != relative.as_posix()
                        or not path.is_relative_to(repository_root) or not path.is_file()
                        or not isinstance(selected, dict)):
                    raise ValueError("The original complete source map contains an invalid member")
                raw = path.read_bytes()
                if len(raw) != selected.get("bytes") or digest(raw) != selected.get("sha256"):
                    raise ValueError("The original complete source member changed: " + name)
                selected_files[name] = raw
            if sum(len(raw) for raw in selected_files.values()) > MAX_ARCHIVE:
                raise ValueError("The original complete source exceeds its receiving archive bound")
        selection = {name: {"bytes": len(raw), "sha256": digest(raw)} for name, raw in selected_files.items()}
        source_sha = digest(raw_json(selection))
        source_destination = work / "source" / source_sha
        if not any(x["sha256"] == source_sha for x in record["sourceEditions"]):
            for name, raw in selected_files.items(): save(source_destination / name, raw)
            save(source_destination / "SOURCE.json", raw_json(selection))
            record["sourceEditions"].append({"at": stamp(), "sha256": source_sha, "files": len(selection)})
            persist()
        save(work / "input" / "original-buyer-project.zip", buyer_raw)
        save(work / "input" / "original-operations-case.zip", operations_raw)
        buyer = phase("original-issued-close-and-accountant-exports",
                      lambda: prepare_buyer(work, buyer_raw, args.node, args.close_id))
        source_file = work / "issued-inputs/issued-buyer-source.json"
        delivery_file = work / "issued-inputs/buyer-accountant-delivery.zip"
        if digest(source_file.read_bytes()) != buyer["source"]["sha256"]:
            raise ValueError("The retained issued source changed")
        if digest(delivery_file.read_bytes()) != buyer["delivery"]["sha256"]:
            raise ValueError("The retained accountant delivery changed")
        original_case = archive(operations_raw)
        original_doc = json.loads(original_case["operations.json"])
        native_planning = archive(original_case["planning.zip"])
        scenario = work / "input" / "original-scenario.json"
        save(scenario, native_planning["scenario.json"])
        native_directory = work / "workspace"
        service = original_server.create_server(native_directory, scenario, port=0)
        ops = Operations(service.workspace)
        original_counts = {key: len(rows) for key, rows in original_doc["records"].items()}
        def import_original():
            receipt = ops.import_bundle(operations_raw, "Original issued expenses and grant cost receiving",
                OPERATION + "-original-case", ACTOR)
            current = ops.read(receipt["id"])
            assert current["program"]["origin"]["programId"] == original_doc["program"]["id"]
            assert current["program"]["version"] == original_doc["program"]["version"]
            assert {key: len(rows) for key, rows in current["records"].items()} == original_counts
            assert not current["expenseAttribution"]["sources"]
            return receipt
        imported = phase("original-grant-case-received", import_original)
        case_id = imported["id"]
        thread = threading.Thread(target=service.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        thread.start()
        sequence = len(record["requests"])
        def api(method, route, body=None, expected=200, raw_response=False, extra=None):
            nonlocal sequence
            sequence += 1
            raw = None if body is None else body if isinstance(body, bytes) else raw_json(body)
            headers = {"Authorization": "Bearer " + service.token, "Origin": service.origin}
            if raw is not None: headers["Content-Type"] = "application/zip" if isinstance(body, bytes) else "application/json"
            if extra: headers.update(extra)
            request = Request(service.origin + route, data=raw, method=method, headers=headers)
            try:
                with urlopen(request, timeout=90) as response:
                    status, data = response.status, response.read()
            except HTTPError as failure:
                status, data = failure.code, failure.read()
            observed = {"sequence": sequence, "at": stamp(), "method": method, "route": route,
                "status": status, "requestSha256": digest(raw) if raw is not None else None,
                "responseSha256": digest(data), "responseBytes": len(data)}
            record["requests"].append(observed)
            save(work / "http" / (str(sequence).zfill(4) + ".response"), data)
            if raw is not None: save(work / "http" / (str(sequence).zfill(4) + ".request"), raw)
            persist()
            if status != expected:
                raise AssertionError("Original HTTP operation failed: " + packed(observed) + "\n" + data[:3000].decode(errors="replace"))
            return data if raw_response else json.loads(data)
        def current():
            return api("GET", "/api/operations/" + case_id)
        def command(label, action, data, note):
            request_path = work / "requests" / (label + ".json")
            if request_path.exists():
                body = json.loads(request_path.read_text())
                if body["action"] != action:
                    raise ValueError("The retained native step changed its original action")
            else:
                body = {"expectedVersion": current()["program"]["version"], "actor": ACTOR, "note": note,
                    "requestId": OPERATION + "-" + label, "action": action, "data": data}
                save(request_path, raw_json(body))
            return api("POST", "/api/operations/" + case_id + "/command", body)
        def retained_step(label, operation):
            path = work / "checkpoints" / (label + ".json")
            if path.exists():
                return json.loads(path.read_text())
            value = operation()
            save(path, raw_json(value))
            return value
        def original_after(label, receipt):
            body = json.loads((work / "requests" / (label + ".json")).read_text())
            history = api("GET", "/api/operations/" + case_id + "/history?after=" +
                          str(receipt["version"] - 1) + "&limit=1")
            event = next((value for value in history["events"] if value["version"] == receipt["version"]), None)
            if (event is None or event["requestId"] != body["requestId"]
                    or event["action"] != body["action"] or event["recordId"] != receipt["recordId"]):
                raise AssertionError("The original committed operation event differs from its receipt")
            return event["after"]
        def row_by_id(ident):
            return next(x for x in current()["expenseAttribution"]["attributions"] if x["id"] == ident)
        def transition(label, action, ident, note):
            row = row_by_id(ident)
            return command(label, action, {"id": ident, "expectedContentSha256": row["contentSha256"]}, note)
        def browser():
            options = {"origin": service.origin, "token": service.token, "caseId": case_id,
                "planId": imported["planId"], "sourceFile": str(source_file), "sourceName": source_file.name,
                "work": str(work), "chromiumExecutable": args.chromium}
            if args.playwright_module: options["playwrightModule"] = args.playwright_module
            input_path = work / "browser-input.json"; save(input_path, raw_json(options))
            log_path = work / "browser.log"
            with log_path.open("a", encoding="utf-8") as log:
                child = subprocess.Popen([args.node, str(source / "operations/expense-attribution-browser.mjs"), str(input_path)],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=os.environ.copy())
                try:
                    for line in child.stdout:
                        log.write(line); log.flush()
                        print(line, end="", flush=True)
                    code = child.wait()
                except BaseException:
                    child.terminate()
                    try: child.wait(timeout=10)
                    except subprocess.TimeoutExpired: child.kill(); child.wait()
                    raise
            report_path = work / "expense-attribution-browser/browser-receiving.json"
            if code != 0:
                raise RuntimeError("The original browser stage stopped; retain " + str(report_path))
            result = json.loads(report_path.read_text())
            assert result["status"] == "PASS" and result["caseId"] == case_id
            assert result["source"]["sha256"] == buyer["source"]["sha256"]
            return {"report": descriptor(report_path), "attributionId": result["attributionId"],
                    "lostResponse": result["lostResponse"], "sourceReceipt": result["sourceReceipt"],
                    "reviewReceipt": result["reviewReceipt"], "selectedLines": result["selectedLines"]}
        browser_result = phase("original-browser-receive-save-recovery-review", browser)
        primary_id = browser_result["attributionId"]
        def accept_accountant():
            raw = delivery_file.read_bytes()
            data = {"expectedVersion": current()["program"]["version"], "filename": delivery_file.name,
                    "contentBase64": base64.b64encode(raw).decode()}
            preview = api("POST", "/api/operations/" + case_id + "/expense-preview", data)
            assert preview["inspection"]["bookkeeping"]["returns"]
            received = command("accountant-source", "expense.receive",
                {"filename": data["filename"], "contentBase64": data["contentBase64"],
                 "expectedPreviewSha256": preview["previewSha256"]},
                "Retain the same issued close with its original accepted accountant history")
            live = current()
            row = next(x for x in live["expenseAttribution"]["attributions"] if x["id"] == primary_id)
            assert row["bookkeepingChanged"]
            body = json.loads((work / "requests/accountant-source.json").read_text())
            replay = api("POST", "/api/operations/" + case_id + "/command", body)
            assert replay == received
            receipt = api("POST", "/api/operations/" + case_id + "/expense-request", body)
            assert receipt["status"] == "COMMITTED" and receipt["receipt"] == received
            assert receipt["currentVersion"] == live["program"]["version"]
            altered = deepcopy(body); altered["note"] += " changed"
            rejected = api("POST", "/api/operations/" + case_id + "/expense-request", altered, expected=409)
            assert rejected["error"]["code"] == "REQUEST_CONFLICT"
            return {"receipt": received, "bookkeepingChanged": row["bookkeepingChanged"],
                "acceptedReturns": len(preview["inspection"]["bookkeeping"]["returns"])}
        accountant = phase("original-accountant-edition-and-receipt-continuity", accept_accountant)
        def adopt_current():
            previous = retained_step("primary-before-current-edition", lambda: row_by_id(primary_id))
            reopened_receipt = transition("primary-reopen", "expense.reopen", primary_id,
                "Review the later accepted accountant references")
            reopened = original_after("primary-reopen", reopened_receipt)
            def obsolete_selection():
                obsolete = expenses.allocation_input(reopened)
                body = {"expectedVersion": current()["program"]["version"], "actor": ACTOR,
                    "note": "Inspect retained earlier source selection", "requestId": OPERATION + "-old-source-refused",
                    "action": "expense.save", "data": obsolete}
                rejected = api("POST", "/api/operations/" + case_id + "/command", body, expected=409)
                assert rejected["error"]["code"] == "EXPENSE_CURRENT_EDITION_REQUIRED"
                return {"body": body, "response": rejected}
            retained_step("obsolete-source-selection-refused", obsolete_selection)
            live = current()
            line = next(x for x in live["expenseAttribution"]["lines"]
                if x["workspaceId"] == previous["source"]["workspaceId"] and x["sourceLineId"] == previous["source"]["sourceLineId"])
            selected = expenses.allocation_input(reopened)
            selected.update({"intakeId": line["intakeId"], "expectedSourceRowSha256": line["sourceRowSha256"]})
            saved = command("primary-current-save", "expense.save", selected,
                "Keep the original work allocation and receive its current accepted accountant references")
            changed = original_after("primary-current-save", saved)
            assert not row_by_id(primary_id)["bookkeepingChanged"]
            assert changed["source"]["sourceSha256"] == previous["source"]["sourceSha256"]
            assert changed["source"]["bindingSha256"] != previous["source"]["bindingSha256"]
            transition("primary-current-review", "expense.review", primary_id,
                "Reviewed the same issued amount against the current original accountant edition")
            return {"id": primary_id, "originalBinding": previous["source"]["bindingSha256"],
                "currentBinding": changed["source"]["bindingSha256"]}
        phase("retained-attribution-current-accountant-review", adopt_current)
        def credits():
            live = current(); desk = live["expenseAttribution"]
            candidates = [x for x in desk["lines"] if x["kind"] == "CREDIT" and int(x["original"]["amount"]) > 0]
            if not candidates:
                raise ValueError("The original selected issued close must retain its credit allocations")
            output = []
            for index, line in enumerate(candidates):
                data = {"intakeId": line["intakeId"], "sourceLineId": line["sourceLineId"],
                    "expectedSourceRowSha256": line["sourceRowSha256"],
                    "allocations": [{"costId": desk["costs"][0]["id"], "fundingBasis": "GRANT",
                        "nativeAmount": line["original"]["amount"], "memo": "Original issued buyer credit"}],
                    "valuation": None, "unattributedReason": "", "linkedInvoiceIds": [],
                    "linkedPurchaseIds": [], "linkedWorkIds": []}
                receipt = command("credit-" + str(index) + "-save", "expense.save", data,
                    "Attribute this original issued credit without replacing its expense")
                ident = receipt["recordId"]
                transition("credit-" + str(index) + "-review", "expense.review", ident,
                    "Reviewed the original credit and its complete source")
                output.append({"id": ident, "sourceLineId": line["sourceLineId"], "amount": line["original"]["amount"]})
            report = current()["expenseAttribution"]["summary"]
            assert sum(int(x["credit"]) for x in report["nativeAmounts"]) == sum(int(x["amount"]) for x in output)
            return {"credits": output, "summary": report}
        credit_result = phase("original-credits-attributed-and-reviewed", credits)
        def valuation():
            original = retained_step("primary-before-valuation", lambda: row_by_id(primary_id))
            source_note = {"schema": SCHEMA + ".valuation-input",
                "purpose": "Explicit receiving calculation only; original native expense quantities are preserved",
                "usd": {"currency": "USD", "decimals": 7},
                "precision": {"currency": "XTS", "decimals": 18},
                "rate": "1.234567890123456789", "basis": "PLANNING_ASSUMPTION"}
            receipt = command("valuation-source", "source.add", {"filename": "receiving-unit-and-rate.json",
                "contentBase64": base64.b64encode(raw_json(source_note)).decode(),
                "kind": "other", "mediaType": "application/json", "sourceUrl": "", "observedAt": "2026-10-12T00:00:00Z"},
                "Retain explicit receiving unit assumptions for the original cent allocator")
            source_id = receipt["recordId"]
            transition("precision-reopen", "expense.reopen", primary_id, "Check exact native-unit calculation in this retained draft")
            selected = expenses.allocation_input(original)
            total = sum(int(x["nativeAmount"]) for x in selected["allocations"])
            for part in selected["allocations"]: part.pop("usdValue", None)
            selected["valuation"] = {"mode": "RETAINED_RATE", "date": "2026-10-12", "sourceIds": [source_id],
                "note": "Explicit receiving calculation; restore the source-only allocation before final cost review",
                "nativeUnit": {"currency": "USD", "decimals": 7}, "rate": None}
            saved_usd = command("usd-atomic-save", "expense.save", selected,
                "Use exact sub-cent original units in the selected draft")
            usd = original_after("usd-atomic-save", saved_usd)
            with localcontext() as arithmetic:
                arithmetic.prec = 120
                expected_usd_units = Decimal(total).scaleb(-7)
            assert Decimal(usd["valuation"]["originalMoney"]["amount"]) == expected_usd_units
            selected["valuation"].update({"nativeUnit": {"currency": "XTS", "decimals": 18},
                "rate": {"id": "receiving-precision-rate", "baseCurrency": "XTS", "quoteCurrency": "USD",
                    "rate": source_note["rate"], "observationDate": "2026-10-12", "publicationDate": None,
                    "basis": "PLANNING_ASSUMPTION", "rounding": "HALF_EVEN", "sourceUrl": "",
                    "sourceIds": [source_id], "sourceReference": "Retained receiving unit assumption",
                    "note": "Calculation coverage in the original operation; excluded from operational USD"}})
            saved_rate = command("precision-rate-save", "expense.save", selected,
                "Preserve eighteen decimal places through the original allocator")
            precise = original_after("precision-rate-save", saved_rate)
            with localcontext() as arithmetic:
                arithmetic.prec = 120
                expected_units = Decimal(total).scaleb(-18)
                converted = sum(Decimal(x["usdValue"]) for x in precise["allocations"])
            assert Decimal(precise["valuation"]["originalMoney"]["amount"]) == expected_units
            assert converted == Decimal(precise["valuation"]["calculation"]["amountUsd"])
            def reviewed_calculation():
                accepted = transition("precision-review", "expense.review", primary_id,
                    "Review the explicitly labeled retained planning calculation")
                summary = current()["expenseAttribution"]["summary"]
                assert primary_id in summary["excludedOperationalIds"]
                return {"receipt": accepted, "summary": summary}
            retained_step("planning-calculation-excluded-from-operating-usd", reviewed_calculation)
            transition("source-only-reopen", "expense.reopen", primary_id,
                "Continue with original native quantities without an assumed valuation")
            selected = expenses.allocation_input(original)
            selected["valuation"] = None
            for part in selected["allocations"]: part["usdValue"] = None
            command("source-only-save", "expense.save", selected, "Retain the original native amount and current accountant source")
            transition("source-only-review", "expense.review", primary_id, "Accept the original source-only grant allocation")
            return {"sourceId": source_id, "nativeAmount": str(total),
                "usdUnits": str(expected_usd_units), "preciseUnits": str(expected_units),
                "calculation": precise["valuation"]["calculation"], "finalValuation": None}
        phase("original-currency-precision-and-explicit-review", valuation)
        def final_review():
            def duplicate_selection():
                live = current()
                duplicate = expenses.allocation_input(next(x for x in live["expenseAttribution"]["attributions"] if x["id"] == primary_id))
                duplicate.pop("id")
                body = {"expectedVersion": live["program"]["version"], "actor": ACTOR,
                    "note": "Inspect the existing original allocation identity",
                    "requestId": OPERATION + "-duplicate-original-refused", "action": "expense.save", "data": duplicate}
                rejected = api("POST", "/api/operations/" + case_id + "/command", body, expected=409)
                assert rejected["error"]["code"] == "EXPENSE_ORIGINAL_ATTRIBUTION_REQUIRED"
                return {"body": body, "response": rejected}
            retained_step("duplicate-original-selection-refused", duplicate_selection)
            assert current()["records"]["cash"] == original_doc["records"]["cash"]
            assert current()["records"]["invoices"] == original_doc["records"]["invoices"]
            reviewed = command("complete-case-review", "review", {}, "Review complete original buyer expenses, credits and accountant sources")
            review = ops.review(case_id, reviewed["recordId"])
            closed = command("complete-case-close", "close", {"reviewId": review["id"], "expectedReviewSha256": review["businessSha256"]},
                "Close the selected complete expense-attribution review")
            return {"review": reviewed, "close": closed}
        closed = phase("original-operating-review-and-close", final_review)
        def export_complete():
            document = current()
            assert document["program"]["state"] == "CLOSED"
            outputs = []
            for filename in ("expense-attributions.csv", "expense-sources.csv", "expense-attribution.html", "export.zip"):
                raw = api("GET", "/api/operations/" + case_id + "/" + filename, raw_response=True)
                target = work / "exports" / ("complete-operations.zip" if filename == "export.zip" else filename)
                save(target, raw); outputs.append(descriptor(target))
            members = archive((work / "exports/complete-operations.zip").read_bytes())
            exported = json.loads(members["operations.json"])
            assert exported["expenseRecords"] == document["expenseRecords"]
            retained = {digest(value) for name, value in members.items() if name.startswith("sources/")}
            assert buyer["source"]["sha256"] in retained and buyer["delivery"]["sha256"] in retained
            return {"outputs": outputs, "caseId": case_id, "version": document["program"]["version"],
                    "expenseRecordsSha256": digest(raw_json(document["expenseRecords"]))}
        exported = phase("complete-original-sources-and-case-export", export_complete)
        def receive_complete():
            destination = work / "received-workspace"
            receiving = Workspace(destination, scenario)
            try:
                receiver = Operations(receiving)
                raw = (work / "exports/complete-operations.zip").read_bytes()
                receipt = receiver.import_bundle(raw, "Received complete grant expense attribution",
                    OPERATION + "-complete-case-receive", ACTOR)
                read = receiver.read(receipt["id"])
                assert read["program"]["origin"]["programId"] == case_id
                assert digest(raw_json(read["expenseRecords"])) == exported["expenseRecordsSha256"]
                assert receiver.import_bundle(raw, "Received complete grant expense attribution",
                    OPERATION + "-complete-case-receive", ACTOR) == receipt
                body_file = work / "requests/received-reopen.json"
                if body_file.exists(): body = json.loads(body_file.read_text())
                else:
                    body = {"expectedVersion": read["program"]["version"], "actor": ACTOR,
                        "note": "Second operator continues the complete original financial source and review",
                        "requestId": OPERATION + "-received-reopen", "action": "reopen", "data": {}}
                    save(body_file, raw_json(body))
                opened = receiver.command(receipt["id"], body)
                assert receiver.command(receipt["id"], body) == opened
                live = receiver.read(receipt["id"])
                assert live["program"]["state"] == "OPEN"
                assert live["expenseAttribution"]["summary"] == current()["expenseAttribution"]["summary"]
                complete = receiver.export(receipt["id"]); save(work / "exports/received-open-operations.zip", complete)
                with receiving.mutex:
                    backup = sqlite3.connect(work / "received-workspace.sqlite3")
                    try: receiving.db.backup(backup)
                    finally: backup.close()
                return {"import": receipt, "reopen": opened, "summary": live["expenseAttribution"]["summary"],
                    "originalCreditIds": [x["id"] for x in credit_result["credits"]],
                    "export": descriptor(work / "exports/received-open-operations.zip"),
                    "database": descriptor(work / "received-workspace.sqlite3")}
            finally: receiving.close()
        received = phase("complete-source-native-receive-and-reopen", receive_complete)
        record.update({"status": "PASS", "completedAt": stamp(), "caseId": case_id,
            "originalCaseId": original_doc["program"]["id"], "originalVersion": original_doc["program"]["version"],
            "sourceSha256": source_sha, "buyer": buyer, "receivedCaseId": received["import"]["id"],
            "finalVersion": current()["program"]["version"], "httpOperations": len(record["requests"])})
        record.pop("activePhase", None); persist()
    except BaseException as error:
        record.update({"status": "FAILED", "completedAt": stamp(), "error": traceback.format_exc()})
        persist()
        raise
    finally:
        if service is not None:
            if thread is not None:
                service.shutdown(); thread.join(timeout=10)
            try: service.server_close()
            finally: service.workspace.close()
    return record

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Exact original SF47 workspace source directory")
    parser.add_argument("--work", required=True, help="Private retained directory for this same original operation")
    parser.add_argument("--source-manifest", help="Original complete source map using SOURCE.json path/bytes/sha256 entries")
    parser.add_argument("--buyer-project", required=True, help="Complete original Buyer Expenses project ZIP")
    parser.add_argument("--buyer-sha256", required=True)
    parser.add_argument("--operations-case", required=True, help="Complete original SF47 Operations ZIP")
    parser.add_argument("--operations-sha256", required=True)
    parser.add_argument("--close-id", default="")
    parser.add_argument("--node", required=True, help="Absolute installed Node executable")
    parser.add_argument("--chromium", required=True, help="Absolute installed Chromium executable")
    parser.add_argument("--playwright-module", help="Existing Playwright module entry")
    args = parser.parse_args()
    status, result = 1, None
    try:
        result = run(args); status = 0
    except BaseException as error:
        print(packed({"type": "GRANT_EXPENSE_RECEIVING_FAILURE", "message": str(error),
            "record": str(Path(args.work).resolve() / "operation.json")}), flush=True)
    finally:
        work = Path(args.work).resolve()
        if (work / "operation.json").exists():
            try:
                output = package(work)
                save(work / "archive-receipt.json", raw_json(output))
                print(packed({"type": "GRANT_EXPENSE_RECEIVING_ARCHIVE", **output}), flush=True)
            except BaseException as error:
                print(packed({"type": "GRANT_EXPENSE_PACKAGING_FAILURE", "message": str(error)}), flush=True)
                status = 1
    if result:
        print(packed({"type": "GRANT_EXPENSE_RECEIVING_RESULT", **result}), flush=True)
    return status

if __name__ == "__main__":
    raise SystemExit(main())
