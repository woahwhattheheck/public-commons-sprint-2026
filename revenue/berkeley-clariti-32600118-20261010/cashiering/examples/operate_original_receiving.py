#!/usr/bin/env python3
"""Continue the original saved Berkeley worked example through row-level receiving."""
from __future__ import annotations
import argparse, base64, copy, csv, hashlib, io, json, os, shutil, sqlite3, subprocess, sys, tempfile, uuid, zipfile, zlib
from pathlib import Path

OPERATION_ID = "BERKELEY-ROW-RECEIVING-E9B2-20261012"
ORIGINAL_RUN = "run-62131e24a616406a929a353f491685c6"
ORIGINAL_EXPORT = "exchange-8428b0ce765a4955b6ccc8062ad31cfe"
ORIGINAL_SHA = "779c0015c88de904b01d0c5a0739176d1c4a69bda9d4b5c6f08e4d905fef24d6"
NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, OPERATION_ID + ":" + ORIGINAL_RUN + ":" + ORIGINAL_EXPORT)

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")

def hash_bytes(raw):
    return hashlib.sha256(raw).hexdigest()

def retain(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError("Retained output differs: " + str(path))
    else:
        descriptor, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            os.link(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally: temporary.unlink(missing_ok=True)
    return {"path": str(path), "bytes": len(raw), "sha256": hash_bytes(raw)}

def snapshot(conn):
    names = ("cash_runs", "cash_editions", "cash_profiles", "runs", "cases", "findings", "decisions", "decision_history")
    return {name: hash_bytes(encoded([dict(row) for row in conn.execute("SELECT * FROM " + name + " ORDER BY rowid")]))
            for name in names}

def run(args):
    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    source = Path(args.source_dir).resolve()
    sys.path.insert(0, str(source / "workspace")); sys.path.insert(0, str(source))
    from app import Workspace, Conflict, restore
    from cashiering.engine import Cashiering
    from cashiering import model as m
    from cashiering import receiving_model as rm
    from cashiering.receiving_cli import save_exact

    db = Path(args.db).resolve()
    if not db.is_file():
        raise ValueError("The original saved 82E4 database is required.")
    before_connection = sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)
    before_connection.row_factory = sqlite3.Row
    financial_before = snapshot(before_connection)
    original_editions = {row["id"]:dict(row) for row in before_connection.execute("SELECT * FROM cash_editions")}
    original_run = json.loads(before_connection.execute("SELECT body FROM cash_runs WHERE id=?", (ORIGINAL_RUN,)).fetchone()[0])
    original_export = next(e for e in original_run["interface_exports"] if e["id"] == ORIGINAL_EXPORT)
    artifact = before_connection.execute("SELECT raw,sha256 FROM cash_artifacts WHERE id=?", (original_export["artifact_id"],)).fetchone()
    prepared_raw = bytes(artifact["raw"])
    if artifact["sha256"] != ORIGINAL_SHA or hash_bytes(prepared_raw) != ORIGINAL_SHA or original_export["row_count"] != 2:
        raise ValueError("The selected original prepared exchange differs from the accepted source.")
    starting_revision = int(before_connection.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])
    before_connection.close()
    retain(root / "inputs" / "prepared-original.csv", prepared_raw)
    retain(root / "inputs" / "original-financial-run.json", encoded(original_run))
    workspace = Workspace(str(db)); cash = Cashiering(workspace, Conflict)
    if len(cash.source_files) != 29:
        raise ValueError("The complete original and receiving source requires all 29 curated files.")
    state = cash.read("/api/cashiering/receiving/state", {})[0]
    workspace_id = state["workspace_id"]
    operations = []
    receipts = []

    def read(resource, query=None):
        return cash.read("/api/cashiering/receiving/" + resource, query or {})[0]

    def step(name, action, fields):
        request_id = str(uuid.uuid5(NAMESPACE, name))
        previous = read("requests/" + request_id)
        payload = copy.deepcopy(fields)
        payload.update(request_id=request_id, receiving_workspace_id=workspace_id,
                       revision=previous["response"]["revision"] - 1 if previous["found"] else read("state")["revision"],
                       owner="Berkeley original worked-example operator")
        payload.setdefault("note", "Continue the retained 82E4 local worked example in its original cashiering database.")
        request = {"action": action, "payload": payload}
        digest = m.fingerprint(request)
        if previous["found"] and previous["request_sha256"] != digest:
            raise ValueError("This original operation step has different retained inputs: " + name)
        retain(root / "requests" / (name + ".json"), encoded(request))
        response = cash.write(action, payload)
        retained = read("requests/" + request_id)
        if not retained["found"] or retained["request_sha256"] != digest or retained["response"] != response:
            raise ValueError("The original cashiering request receipt differs: " + name)
        retain(root / "responses" / (name + ".json"), encoded(response))
        operations.append({"name": name, "action": action, "request_id": request_id, "request_sha256": digest,
                           "revision": response["revision"], "original_replay": previous["found"]})
        receipts.append((request, response))
        print(json.dumps({"stage": name, "request_id": request_id, "revision": response["revision"],
                          "result": response["result"] if action not in ("receiving-capture", "receiving-mapping") else
                                    {"source_id": response["result"]["source"]["id"],
                                     "mapping_version": response["result"]["source"]["mapping_version"]}}), flush=True)
        return response["result"]

    headers = ["date", "session", "currency", "receipt_status", "native_event_id",
               "applied_amount", "posted_ref", "error_code", "error_message"]
    def csv_bytes(rows):
        stream = io.StringIO(newline="")
        writer = csv.writer(stream, lineterminator="\r\n"); writer.writerow(headers); writer.writerows(rows)
        return stream.getvalue().encode("utf-8")
    usd_a = ["2026-10-11","EXAMPLE-CARD","USD","POSTED","EXAMPLE-EVENT-USD-0001","40.00","EXAMPLE-POST-001","",""]
    eur_a = ["2026-10-11","EXAMPLE-EUR","EUR","POSTED","EXAMPLE-EVENT-EUR-0001","3.10","EXAMPLE-POST-002","",""]
    usd_b = ["2026-10-11","EXAMPLE-CARD","USD","POSTED","EXAMPLE-EVENT-USD-0002","45.00","EXAMPLE-POST-003","",""]
    outside = ["2026-10-11","EXAMPLE-OTHER","USD","POSTED","EXAMPLE-EVENT-OUTSIDE-0001","0.50","EXAMPLE-POST-004","",""]
    snapshot_usd = ["2026-10-11","EXAMPLE-CARD","USD","POSTED","EXAMPLE-SNAPSHOT-USD","85.00","EXAMPLE-STATE-001","",""]
    snapshot_eur = ["2026-10-11","EXAMPLE-EUR","EUR","POSTED","EXAMPLE-SNAPSHOT-EUR","3.10","EXAMPLE-STATE-002","",""]
    input_specs = [
        ("event-return-a", csv_bytes([usd_a, eur_a]), "events", "2026-10-12T11:35:00Z"),
        ("event-return-b", csv_bytes([usd_a, usd_b, outside]), "events", "2026-10-12T11:45:00Z"),
        ("state-return-c", csv_bytes([snapshot_usd, snapshot_eur]), "snapshot", "2026-10-12T11:55:00Z"),
    ]
    original_files = []
    source_records = {}
    mapping = copy.deepcopy(rm.DEFAULT_MAPPING)
    mapping.update(keys=[{"prepared":k,"returned":k} for k in ("date","session","currency")],
                   status_column="receipt_status", status_map={"POSTED":"posted"},
                   event_id_column="native_event_id", reference_column="posted_ref",
                   error_code_column="error_code", error_message_column="error_message",
                   note="Original local receiving example: exact date/session/currency tuple, POSTED status and unique native events.")
    mapping["amount"] = {"prepared_column":"permit_amount","returned_column":"applied_amount",
                        "prepared_mode":"major","returned_mode":"major",
                        "prepared_currency":{"column":"currency"},"returned_currency":{"column":"currency"},
                        "value_basis":"incremental_events","included_statuses":["posted"]}

    for name, raw, mode, at in input_specs:
        original_files.append(retain(root / "inputs" / (name + ".csv"), raw))
        metadata = {"source_system":"LOCAL-WORKED-EXAMPLE", "report_family":"ACCOUNTING-RETURN",
                    "native_reference":"EXAMPLE-" + name.upper(), "observed_at":at, "mode":mode, "complete":True,
                    "note":"Explicit local worked-example return rows for the original 82E4 prepared CSV; retain exact native row text and report semantics."}
        result = step("capture-" + name, "receiving-capture", {"run_id":ORIGINAL_RUN, "export_id":ORIGINAL_EXPORT,
                      "filename":name + ".csv", "content_base64":base64.b64encode(raw).decode("ascii"),
                      "captured_at":at, "metadata":metadata})
        source_result = result["source"]
        mapped = step("map-" + name, "receiving-mapping", {"source_id":source_result["id"],
                      "mapping_version":source_result["mapping_version"],"mapping":mapping,"confirmed":True})
        source_records[name] = mapped["source"]
    bindings = [{"source_id":source_records[k]["id"],"mapping_version":source_records[k]["mapping_version"]}
                for k in ("event-return-a","event-return-b")]
    result = step("compare-native-events","receiving-compare",{"run_id":ORIGINAL_RUN,"export_id":ORIGINAL_EXPORT,
                  "sources":bindings,"label":"Original prepared exchange — complete local return receiving"})
    receiving_id = result["receiving_id"]
    first_id = result["edition_id"]
    first = read("editions/" + first_id + "/json")
    retain(root / "outputs" / "first-event-comparison.json", encoded(first))
    expected_amounts = {"USD":"8500","EUR":"310"}
    for prepared in first["prepared"]:
        family = prepared["families"][0]
        if family["returned_minor"] != expected_amounts[family["currency"]] or family["difference_minor"] != "0":
            raise ValueError("Successive native event files did not count the unchanged original event once.")
    if any(f["code"] == "conflicting_event_identity" for f in first["findings"]):
        raise ValueError("A report observation time was incorrectly used as native event meaning.")
    outside_row = next(r for r in first["observations"] if r["original"]["native_event_id"] == outside[4])
    result = step("dispose-outside-row","receiving-assign",{"receiving_id":receiving_id,
                  "receiving_version":result["version"],"observation_id":outside_row["id"],"excluded":True,
                  "note":"The supplied EXAMPLE-OTHER tuple is outside both original prepared rows; preserve it as an explicit excluded return."})
    current = read("editions/" + result["edition_id"] + "/json")
    for index, finding in enumerate(current["findings"]):
        result = step("review-original-finding-" + str(index+1),"receiving-review",{"receiving_id":receiving_id,
                      "receiving_version":result["version"],"finding_id":finding["id"],"status":"accepted_difference",
                      "note":"The complete original files repeat one byte-identical native event; count it once and retain both original observations."})
    result = step("record-original-decision","receiving-decision",{"receiving_id":receiving_id,
                  "receiving_version":result["version"],"status":"reviewed",
                  "statement":"Both original prepared currency rows reconcile exactly after the explicit out-of-exchange disposition.",
                  "note":"USD 85.00 and EUR 3.10 are the original local worked-example exchange amounts."})
    frozen_edition_id = result["edition_id"]
    frozen_before = read("editions/" + frozen_edition_id + "/json")
    retain(root / "outputs" / "reviewed-original-edition.json", encoded(frozen_before))

    source_a = source_records["event-return-a"]
    revised_mapping = copy.deepcopy(mapping)
    revised_mapping["note"] += " The source report timestamp is separate from native event identity; unchanged native events contribute once."
    mapped = step("refine-event-mapping","receiving-mapping",{"source_id":source_a["id"],
                  "mapping_version":source_a["mapping_version"],"mapping":revised_mapping,"confirmed":True})
    revised_bindings = [{"source_id":source_a["id"],"mapping_version":mapped["source"]["mapping_version"]},bindings[1]]
    mixed_bindings = revised_bindings + [{"source_id":source_records["state-return-c"]["id"],
                                         "mapping_version":source_records["state-return-c"]["mapping_version"]}]
    result = step("inspect-mixed-return-selection","receiving-refresh",{"receiving_id":receiving_id,
                  "receiving_version":result["version"],"sources":mixed_bindings,
                  "note":"Review the native snapshot alongside incremental event files; keep the incompatible family amount unavailable."})
    mixed = read("editions/" + result["edition_id"] + "/json")
    retain(root / "outputs" / "mixed-selection-original-edition.json", encoded(mixed))
    if not any(f["code"] == "mixed_source_modes" for f in mixed["findings"]):
        raise ValueError("The mixed original report semantics were not exposed.")
    for prepared in mixed["prepared"]:
        family = prepared["families"][0]
        if family["expected_minor"] != expected_amounts[family["currency"]] or family["returned_minor"] is not None or family["difference_minor"] is not None:
            raise ValueError("An incompatible snapshot/event family asserted a returned total.")

    result = step("resolve-original-selection","receiving-refresh",{"receiving_id":receiving_id,
                  "receiving_version":result["version"],"sources":revised_bindings,
                  "note":"Select only the original incremental-event family; preserve the inspected snapshot and every previous edition in history."})
    current = read("editions/" + result["edition_id"] + "/json")
    for index, finding in enumerate(current["findings"]):
        if finding["review"].get("status") in ("open","investigating"):
            result = step("review-refined-finding-" + str(index+1),"receiving-review",{"receiving_id":receiving_id,
                          "receiving_version":result["version"],"finding_id":finding["id"],"status":"accepted_difference",
                          "note":"The revised interpretation retains the same exact duplicate event and original exclusion; both native copies remain visible."})
    result = step("record-final-decision","receiving-decision",{"receiving_id":receiving_id,
                  "receiving_version":result["version"],"status":"reviewed",
                  "statement":"The selected complete native event returns match both exact prepared currency rows; previous mixed selection and mapping editions remain retained.",
                  "note":"Ready for staff receiving handoff on this explicitly labeled local worked example."})
    result = step("publish-complete-receiving","receiving-packet",{"receiving_id":receiving_id,
                  "receiving_version":result["version"],"label":"Berkeley original worked example — complete row receiving",
                  "note":"Complete prepared CSV, original returns, exact interpretations, all selected row histories and maintained source."})
    packet = result["packet"]
    packet_raw = cash.read("/api/cashiering/artifacts/" + packet["artifact_id"], {})[0]
    if not isinstance(packet_raw,bytes) or hash_bytes(packet_raw) != packet["sha256"]:
        raise ValueError("The complete original receiving artifact differs.")
    retain(root / "outputs" / "original-row-receiving.zip", packet_raw)
    with zipfile.ZipFile(io.BytesIO(packet_raw)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        for item in manifest["members"]:
            raw = archive.read(item["path"])
            if len(raw) != item["bytes"] or hash_bytes(raw) != item["sha256"]:
                raise ValueError("A receiving packet member differs: " + item["path"])
        if archive.read("prepared-original.csv") != prepared_raw:
            raise ValueError("The original prepared bytes changed in receiving.")
        source_members = [name for name in archive.namelist() if name.startswith("source/")]
        if len(source_members) != 29:
            raise ValueError("The complete maintained source is absent from the packet.")
        if len(json.loads(archive.read("originals.json"))) < 3:
            raise ValueError("A previous selected original source or mapping is missing from the full handover history.")
    final = read("editions/" + result["edition_id"] + "/json")
    for kind in ("prepared","observations","findings"):
        raw = read("editions/" + result["edition_id"] + "/" + kind + ".csv")
        retain(root / "outputs" / (kind + ".csv"), raw if isinstance(raw,bytes) else raw.encode("utf-8"))
    frozen_after = read("editions/" + frozen_edition_id + "/json")
    # Transport metadata deliberately describes the current mounted workspace.
    # All retained analytical rows, source/mapping/history and review content remain exact.
    def frozen_content(value):
        value = copy.deepcopy(value)
        value.pop("workspace_revision",None)
        value.get("export",{}).pop("current_financial_edition",None)
        return value
    if frozen_content(frozen_before) != frozen_content(frozen_after):
        raise ValueError("A later mapping or receiving action changed an original saved review edition.")

    workspace = Workspace(str(db)); cash = Cashiering(workspace, Conflict)
    for original_request, response in receipts:
        if cash.write(original_request["action"], original_request["payload"]) != response:
            raise ValueError("Reopening did not replay the complete original request result.")
    final_request_path = root / "requests" / "publish-complete-receiving.json"
    cli = source / "cashiering" / "receiving_cli.py"
    cli_result = subprocess.run([sys.executable,"-B",str(cli),"--db",str(db),"apply",str(final_request_path)],
                                text=True,capture_output=True)
    retain(root / "outputs" / "native-cli-replay.stdout.txt",cli_result.stdout.encode())
    retain(root / "outputs" / "native-cli-replay.stderr.txt",cli_result.stderr.encode())
    if cli_result.returncode or json.loads(cli_result.stdout) != receipts[-1][1]:
        raise ValueError("The installed CLI did not replay the original retained publication.")
    with workspace.db() as conn:
        financial_after = snapshot(conn)
        final_revision = int(conn.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])
    if financial_before != financial_after:
        raise ValueError("The original financial or permitting records changed during this receiving continuation.")
    financial_packet = step("publish-joined-financial-handover","packet",{"run_id":ORIGINAL_RUN,
                             "label":"Original daily cashiering with complete row receiving",
                             "note":"Include the complete saved return comparisons, original return bytes and historical mapping editions in the original financial handover."})
    if cash.write(receipts[-1][0]["action"],receipts[-1][0]["payload"]) != receipts[-1][1]:
        raise ValueError("The original financial handover request did not replay exactly.")
    joined_raw = cash.read("/api/cashiering/artifacts/" + financial_packet["artifact_id"],{})[0]
    if hash_bytes(joined_raw) != financial_packet["sha256"]:
        raise ValueError("The original joined financial packet differs from its stored artifact.")
    retain(root/"outputs"/"original-financial-and-row-receiving.zip",joined_raw)
    with zipfile.ZipFile(io.BytesIO(joined_raw)) as joined:
        joined_document = json.loads(joined.read("run.json"))
        joined_receiving = next(x for x in joined_document["row_receiving"] if x["id"] == receiving_id)
        if joined_receiving["version"] != result["version"] or len(joined_receiving["observations"]) != 5:
            raise ValueError("The original financial handover omitted its complete saved row receiving.")
    with workspace.db() as conn:
        final_body = json.loads(conn.execute("SELECT body FROM cash_runs WHERE id=?",(ORIGINAL_RUN,)).fetchone()[0])
        for key in ("run","settings","source_bindings","allocations","corrections","reviews","signoffs","closings","current_close_id","interface_exports"):
            if final_body.get(key) != original_run.get(key):
                raise ValueError("The joined packet altered an original financial field: " + key)
        for ident,original in original_editions.items():
            current = conn.execute("SELECT * FROM cash_editions WHERE id=?",(ident,)).fetchone()
            if current is None or dict(current) != original:
                raise ValueError("An original financial edition changed during the handover.")
        final_revision = int(conn.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])
    final = read("editions/" + result["edition_id"] + "/json")
    retain(root / "outputs" / "complete-receiving.json", encoded(final))
    backup = workspace.backup()
    retain(root / "outputs" / "complete-original-workspace.sqlite",backup)
    reopened = root / "reopened" / "workspace.sqlite"
    if not reopened.exists():
        restore(str(root / "outputs" / "complete-original-workspace.sqlite"),str(reopened))
    reopened_workspace = Workspace(str(reopened)); reopened_cash = Cashiering(reopened_workspace,Conflict)
    reopened_final = reopened_cash.read("/api/cashiering/receiving/editions/" + result["edition_id"] + "/json",{})[0]
    if reopened_final != final:
        raise ValueError("The complete original database handover did not reopen the same final receiving edition.")
    original_outputs = {
        "schema":"berkeley.cashiering.receiving-operation.v1","operation_id":OPERATION_ID,
        "status":"PASS","source_pin":args.source_pin,"database_path":str(db),"receiving_workspace_id":workspace_id,
        "run_id":ORIGINAL_RUN,"export_id":ORIGINAL_EXPORT,"prepared_sha256":ORIGINAL_SHA,
        "receiving_id":receiving_id,"final_edition_id":result["edition_id"],"final_version":result["version"],
        "starting_revision":starting_revision,"final_revision":final_revision,"financial_records_sha256":financial_after,
        "counts":final["counts"],"totals":final["totals"],"packet":packet,"joined_financial_packet":financial_packet,
        "original_financial_editions_preserved":len(original_editions),
        "original_requests":operations,"exact_replayed_requests":len(receipts),"original_return_files":original_files,
        "native_source_files":len(cash.source_files),"packet_source_files":len(source_members),
        "original_mapping_edition":source_a["mapping_version"],"revised_mapping_edition":mapped["source"]["mapping_version"],
        "frozen_review_edition_id":frozen_edition_id,"retained_frozen_review_equal":True,
        "same_event_repeated_across_reports_counted_once":True,"mixed_family_amount_unavailable":True,
        "original_database_backup":{"bytes":len(backup),"sha256":hash_bytes(backup),"reopened":str(reopened)},
        "example_basis":"The existing 82E4 local worked example and its exact original prepared CSV; the receiving inputs are supplied, labeled local example files.",
        "browser_owner":"82E4 original browser operation; the existing mounted operator consumes this same database and receiving ID."
    }
    retain(root / "result.json",encoded(original_outputs))
    raw_files=[]
    retain(root/"operate_original_receiving.py",Path(__file__).read_bytes())
    for path in sorted(root.rglob("*")):
        if path.is_file() and "reopened" not in path.parts and path.name != "Berkeley_Original_Row_Receiving_Workspace.zip" and not path.name.startswith("library-upload") and "library-upload-state" not in path.parts:
            raw=path.read_bytes();raw_files.append((path.relative_to(root).as_posix(),raw))
    manifest={"schema":"berkeley.receiving-complete-operation-package.v1","operation_id":OPERATION_ID,
              "members":[{"path":name,"bytes":len(raw),"sha256":hash_bytes(raw)} for name,raw in raw_files]}
    archive_path=root/"Berkeley_Original_Row_Receiving_Workspace.zip"
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name,raw in raw_files: archive.writestr(name,raw)
        archive.writestr("manifest.json",encoded(manifest))
    archive_receipt=retain(archive_path,buffer.getvalue())
    print(json.dumps({"stage":"complete-original-receiving","status":"PASS","result":original_outputs,
                      "archive":archive_receipt},ensure_ascii=False),flush=True)
    if args.helper_dir:
        helper=Path(args.helper_dir).resolve(); parent=root/"library-upload-state";parent.mkdir(parents=True,exist_ok=True)
        invocation = "import json,sys\nfrom pathlib import Path\nsys.path.insert(0," + repr(str(helper)) + ")\n" + \
            "from library_upload import LibraryUploadWorkflow,SignedUrlUploader\nfrom library_hosted_apps import HostedAppsClient\n" + \
            "from library_file_transfer import LibraryFileMaterializer\n" + \
            "workflow=LibraryUploadWorkflow(HostedAppsClient(),LibraryFileMaterializer(),SignedUrlUploader(),state_parent=Path(" + repr(str(parent)) + "))\n" + \
            "print(json.dumps(workflow.run(json.load(sys.stdin))))\n"
        batch={"uploads":[{"local_path":str(archive_path),"purpose":"create_library_file","library_artifact_type":"other"}]}
        save=subprocess.run([sys.executable,"-c",invocation],input=json.dumps(batch),text=True,capture_output=True)
        retain(root/"library-upload.stdout.json",save.stdout.encode());retain(root/"library-upload.stderr.txt",save.stderr.encode())
        print(json.dumps({"stage":"complete-artifact-save","returncode":save.returncode,"stdout":save.stdout,"stderr":save.stderr}),flush=True)
    return original_outputs

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db",required=True);parser.add_argument("--source-dir",required=True)
    parser.add_argument("--source-pin",required=True);parser.add_argument("--root",required=True)
    parser.add_argument("--helper-dir")
    args=parser.parse_args()
    try: run(args)
    except Exception as error:
        print(json.dumps({"stage":"original-receiving-interrupted","operation_id":OPERATION_ID,
                          "error":type(error).__name__,"message":str(error),"root":args.root}),flush=True)
        raise

if __name__=="__main__":main()
