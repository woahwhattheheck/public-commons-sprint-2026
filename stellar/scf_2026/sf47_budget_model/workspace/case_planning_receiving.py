#!/usr/bin/env python3
"""Continue an original calendar case through workbook planning, amendment and delivery."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import quote
from urllib.request import Request, urlopen
import zipfile

SCHEMA = "stellar-forge.sf47-case-workbook-receiving.v1"
OPERATION = "SCF-CASE-WORKBOOK-AMENDMENT-CEDAR-8047-20261013"
HERE = Path(__file__).resolve().parent
LIMIT = 256 * 1024 * 1024
CASE = re.compile(r"^operation-[a-f0-9]{32}$")


def stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def private_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, pending = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, path)
    finally:
        if os.path.exists(pending):
            os.unlink(pending)


def identity(path):
    path = Path(path)
    raw = path.read_bytes()
    return {"filename": path.name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def safe_members(archive):
    seen, total = set(), 0
    members = []
    for info in archive.infolist():
        path = PurePosixPath(info.filename)
        if (not info.filename or path.is_absolute() or "\\" in info.filename
                or any(part in {"..", ""} for part in path.parts)
                or info.filename in seen or (info.external_attr >> 16) & 0o170000 == 0o120000):
            raise ValueError("The complete input has an unsafe or duplicate archive member.")
        seen.add(info.filename)
        total += info.file_size
        if total > LIMIT or len(seen) > 12000:
            raise ValueError("The complete retained input exceeds this receiving programme's 256 MiB capacity.")
        members.append(info)
    return members


def unpack_original(archive_path, target):
    target = Path(target)
    if target.exists():
        raise ValueError("Choose a new private extraction target for the original retained input.")
    target.mkdir(parents=True, mode=0o700)
    with zipfile.ZipFile(archive_path) as archive:
        for info in safe_members(archive):
            destination = target.joinpath(*PurePosixPath(info.filename).parts)
            if info.is_dir():
                destination.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                private_write(destination, archive.read(info))
    return target


def database_candidates(directory):
    found = []
    for path in directory.rglob("*"):
        if not path.is_file() or path.suffix not in {".sqlite3", ".sqlite", ".db"}:
            continue
        try:
            connection = sqlite3.connect("file:" + quote(str(path)) + "?mode=ro", uri=True)
            try:
                tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if {"plans", "ops_programs", "revisions"} <= tables:
                    cases = connection.execute("SELECT id,name,mode,version FROM ops_programs ORDER BY id").fetchall()
                    found.append({"path": path, "cases": cases})
            finally:
                connection.close()
        except sqlite3.DatabaseError:
            continue
    return found


def original_database(directory, case_id=None):
    candidates = database_candidates(directory)
    if not candidates:
        # Some original complete receiving deliveries keep the whole native workspace in
        # a named inner ZIP. Preserve the outer input and extract those native carriers.
        for path in sorted(directory.rglob("*.zip")):
            with zipfile.ZipFile(path) as archive:
                infos = safe_members(archive)
                if not any(info.filename.endswith((".sqlite3", ".sqlite", ".db")) for info in infos):
                    continue
            inner = directory / ("received-" + hashlib.sha256(path.read_bytes()).hexdigest()[:16])
            if not inner.exists():
                unpack_original(path, inner)
        candidates = database_candidates(directory)
    if case_id:
        candidates = [row for row in candidates if any(case[0] == case_id for case in row["cases"])]
    preferred = [row for row in candidates if row["path"].name == "calendar-workspace.sqlite3"]
    if len(preferred) == 1:
        return preferred[0]
    if len(candidates) == 1:
        return candidates[0]
    # Choose the uniquely retained most complete calendar database by original case
    # versions. Multiple distinct, equally complete candidates require explicit selection.
    calendar = [row for row in candidates if any("calendar" in case[1].lower() for case in row["cases"])]
    if len(calendar) == 1:
        return calendar[0]
    if calendar:
        ranked = sorted(calendar, key=lambda row: (len(row["cases"]), sum(case[3] for case in row["cases"])), reverse=True)
        score = lambda row: (len(row["cases"]), sum(case[3] for case in row["cases"]))
        if len(ranked) == 1 or score(ranked[0]) > score(ranked[1]):
            return ranked[0]
    raise ValueError("Select the original complete calendar database with --database; its original input remains intact.")


def copy_database(source, target):
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    source_connection = sqlite3.connect("file:" + quote(str(source)) + "?mode=ro", uri=True)
    destination = sqlite3.connect(target)
    try:
        source_connection.backup(destination)
        if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("The original complete database did not pass SQLite recovery.")
    finally:
        destination.close()
        source_connection.close()
    os.chmod(target, 0o600)


def request(base, token, path, *, binary=False):
    with urlopen(Request(base + path, headers={"Authorization": "Bearer " + token}), timeout=120) as response:
        raw = response.read()
    return raw if binary else json.loads(raw)


def unchanged_business(before, after):
    # The original amendment changes the selected plan and proposal history.
    # All existing operating records and attachment metadata stay complete.
    result = {}
    original_records, received_records = before.get("records", {}), after.get("records", {})
    if set(original_records) != set(received_records):
        raise ValueError("The original operating record collections changed during planning.")
    for name in sorted(original_records):
        left, right = original_records[name], received_records[name]
        if left != right:
            raise ValueError("The original " + name + " records changed during the planning amendment.")
        result[name] = len(left) if isinstance(left, (list, dict)) else True
    if before.get("sources") != after.get("sources"):
        raise ValueError("The original case attachment identities changed during planning.")
    result["sources"] = len(before.get("sources", []))
    return result


def selected_case(cases, requested):
    if requested:
        rows = [row for row in cases if row["id"] == requested]
    else:
        rows = [row for row in cases if row["mode"] == "WALKTHROUGH"
                and row["name"] == "SCF delivery calendar walkthrough - original grant plan"]
    if len(rows) != 1 or not CASE.fullmatch(rows[0]["id"]):
        raise ValueError("Use --case-id to select the exact original operated calendar walkthrough.")
    if rows[0]["mode"] != "WALKTHROUGH":
        raise ValueError("The receiving workbook edits belong to the original labelled walkthrough case.")
    return rows[0]


def retained_date(directory, case):
    selected = case["program"]["id"]
    readings = []
    for path in directory.rglob("*.json"):
        if path.stat().st_size > 2 * 1024 * 1024:
            continue
        if path.name not in {"native-result.json", "calendar.json", "browser-calendar.json", "HANDOVER.json"}:
            continue
        try:
            value = read_json(path)
        except (ValueError, UnicodeError):
            continue
        original = None
        if value.get("schema") == "stellar-forge.sf47-delivery-calendar.v1" and value.get("case", {}).get("id") == selected:
            original = value.get("asOfDate")
        elif path.name == "native-result.json" and value.get("demoCaseId") == selected:
            original = value.get("asOfDate")
        elif path.name == "HANDOVER.json" and value.get("calendarCase", {}).get("id") == selected:
            original = value["calendarCase"].get("asOfDate")
        if isinstance(original, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", original):
            readings.append({"path": str(path.relative_to(directory)), "caseId": selected, "asOfDate": original})
    dates = {row["asOfDate"] for row in readings}
    if len(dates) != 1:
        raise ValueError("Supply --as-of-date from the selected original case's calendar result; no unrelated result or anchor chooses this clock.")
    return dates.pop()


def run_browser(node, context_path, root, mode="operate"):
    command = [str(node), str(HERE / "case_planning_browser.mjs"), "--context", str(context_path), "--mode", mode]
    output = root / ("browser-" + mode + ".stdout")
    error = root / ("browser-" + mode + ".stderr")
    with open(output, "ab") as out, open(error, "ab") as err:
        completed = subprocess.run(command, cwd=HERE, stdout=out, stderr=err, timeout=1800, check=False)
    os.chmod(output, 0o600)
    os.chmod(error, 0o600)
    if completed.returncode:
        raise RuntimeError("The original browser continuation remains at " + str(root / "browser-progress.json")
                           + "; native browser returned " + str(completed.returncode))
    return read_json(root / ("browser-cold-result.json" if mode == "cold" else "browser-result.json"))


@contextmanager
def opened_server(workspace, port=0):
    from server import create_server
    server = create_server(workspace, port=port)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1})
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        thread.join(timeout=30)
        server.server_close()
        server.workspace.close()


def cold_receive(installation_archive, root, result, node):
    from staff_installation import restore_installation
    cold = root / "cold-workspace"
    if not cold.exists():
        restored = restore_installation(installation_archive.read_bytes(), cold)
        private_write(root / "cold-restoration.json", encode(restored))
    elif not (cold / "INSTALLATION.json").exists():
        raise ValueError("The interrupted cold target has no complete original restoration record.")
    source = cold / "source" / "stellar" / "scf_2026" / "sf47_budget_model" / "workspace"
    child_program = r'''
import json,sys,threading
from pathlib import Path
root=Path(sys.argv[1]);source=root/"source/stellar/scf_2026/sf47_budget_model/workspace"
sys.path.insert(0,str(source))
from server import create_server
server=create_server(root,root/"scenario.json",0)
print(json.dumps({"origin":server.origin}),flush=True)
try:server.serve_forever(poll_interval=0.1)
finally:server.server_close();server.workspace.close()
'''
    process = subprocess.Popen([sys.executable, "-u", "-c", child_program, str(cold)], stdout=subprocess.PIPE,
                               stderr=open(root / "cold-server.stderr", "ab"), text=True, cwd=source)
    try:
        line = process.stdout.readline()
        if not line:
            raise RuntimeError("The complete restored source did not open its original native server.")
        opened = json.loads(line)
        token = (cold / "access.key").read_text().strip()
        case = request(opened["origin"], token, "/api/operations/" + result["caseId"])
        plan = request(opened["origin"], token, "/api/plans/" + result["planId"] + "/revision/" + str(result["savedRevision"]))
        if (case["program"]["id"] != result["caseId"] or case["plan"]["revision"] != result["savedRevision"]
                or case["plan"]["contentSha256"] != result["savedContentSha256"]
                or plan["contentSha256"] != result["savedContentSha256"]):
            raise ValueError("The cold restored original case selected another planning revision.")
        private_write(root / "cold-case.json", encode(case))
        private_write(root / "cold-plan.json", encode(plan))
        private_write(root / "cold-calendar.json", encode(request(opened["origin"], token,
            "/api/operations/" + result["caseId"] + "/delivery-calendar?asOfDate=" + result["asOfDate"])))
        ctx = {"schema": SCHEMA, "operationId": OPERATION, "baseUrl": opened["origin"], "ownerKey": token,
               "caseId": result["caseId"], "planId": result["planId"], "asOfDate": result["asOfDate"],
               "directory": str(root), "workingDraft": str(root / "browser" / "exports" / "case-planning-final.json"),
               "selectedRevision": result["savedRevision"], "selectedContentSha256": result["savedContentSha256"]}
        private_write(root / "cold-browser-context.json", encode(ctx))
        browser = run_browser(node, root / "cold-browser-context.json", root, "cold")
        return {"restoration": read_json(root / "cold-restoration.json"), "caseId": case["program"]["id"],
                "caseVersion": case["program"]["version"], "planId": plan["id"], "revision": plan["revision"],
                "contentSha256": plan["contentSha256"], "browser": browser}
    finally:
        process.terminate()
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def complete_archive(root, result):
    path = root / "SCF_Case_Workbook_Amendment_Complete_Delivery.zip"
    members = []
    skipped = {"browser-profile", "cold-browser-profile", "tmp"}
    with tempfile.NamedTemporaryFile(prefix=".case-delivery.", suffix=".zip", dir=root, delete=False) as temporary:
        pending = Path(temporary.name)
    try:
        with zipfile.ZipFile(pending, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for source in sorted(root.rglob("*")):
                relative = source.relative_to(root)
                if (not source.is_file() or source in {path, pending}
                        or any(part in skipped for part in relative.parts)
                        or (relative.parts[0] in {"browser", "browser-cold"} and source.suffix.lower() == ".png")
                        or source.name.endswith(("-wal", "-shm")) or source.name == "workspace.lock"):
                    continue
                data = source.read_bytes()
                archive.writestr(relative.as_posix(), data)
                members.append({"path": relative.as_posix(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            manifest = {"schema": SCHEMA, "operationId": OPERATION, "createdAt": stamp(),
                        "caseId": result["caseId"], "selectedPlan": {"id": result["planId"], "revision": result["savedRevision"],
                        "contentSha256": result["savedContentSha256"]}, "files": members}
            archive.writestr("CASE_WORKBOOK_MANIFEST.json", encode(manifest))
        os.replace(pending, path)
        os.chmod(path, 0o600)
    finally:
        if pending.exists():
            pending.unlink()
    return {**identity(path), "path": str(path), "members": len(members) + 1}


def operate(args):
    root = args.directory.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    record_path = root / "CASE_WORKBOOK_RECEIVING.json"
    continuation_path = root / "private-continuation.json"
    if record_path.exists() and read_json(record_path).get("complete"):
        completed = read_json(record_path)
        delivery = completed.get("delivery")
        if delivery and Path(delivery["path"]).exists():
            actual = identity(delivery["path"])
            if all(actual[key] == delivery[key] for key in ("bytes", "sha256")):
                return completed
        completed["delivery"] = complete_archive(root, completed)
        private_write(record_path, encode(completed))
        return completed
    source_archive = args.archive.expanduser().resolve()
    original_id = identity(source_archive)
    original = root / "original-input" / source_archive.name
    if original.exists() and identity(original) != original_id:
        raise ValueError("Continue with the exact original input archive already selected for this operation.")
    if not original.exists():
        private_write(original, source_archive.read_bytes())
    extracted = root / "original-delivery"
    if not extracted.exists():
        unpack_original(original, extracted)
    workspace = root / "operated-workspace"
    prior = read_json(continuation_path) if continuation_path.exists() else None
    if prior and (prior["operationId"] != OPERATION or prior["originalArchive"] != original_id):
        raise ValueError("The retained continuation belongs to a different original input or operation.")
    if not (workspace / "planning.sqlite3").exists():
        selected = {"path": args.database.resolve()} if args.database else original_database(extracted, args.case_id)
        copy_database(selected["path"], workspace / "planning.sqlite3")
        private_write(root / "original-database.json", encode({"path": str(selected["path"]), **identity(selected["path"])}))
    result = read_json(record_path) if record_path.exists() else {
        "schema": SCHEMA, "operationId": OPERATION, "startedAt": stamp(), "complete": False,
        "originalArchive": original_id, "sourceDirectory": str(HERE)}
    private_write(record_path, encode(result))
    try:
        with opened_server(workspace, int(prior["port"]) if prior else 0) as server:
            cases = request(server.origin, server.token, "/api/operations")["cases"]
            case_row = selected_case(cases, prior["caseId"] if prior else args.case_id)
            case = request(server.origin, server.token, "/api/operations/" + case_row["id"])
            as_of = prior["asOfDate"] if prior else args.as_of_date or retained_date(extracted, case)
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of):
                raise ValueError("Retain the original native comparison date.")
            continuation = {"schema": SCHEMA, "operationId": OPERATION, "originalArchive": original_id,
                            "port": server.server_port, "caseId": case_row["id"], "asOfDate": as_of,
                            "workspace": str(workspace), "createdAt": prior["createdAt"] if prior else stamp()}
            private_write(continuation_path, encode(continuation))
            before_path = root / "original-case-before.json"
            if not before_path.exists():
                private_write(before_path, encode(case))
                private_write(root / "original-plan-before.json", encode(request(server.origin, server.token,
                    "/api/plans/" + case["program"]["planId"])))
                private_write(root / "original-calendar-before.json", encode(request(server.origin, server.token,
                    "/api/operations/" + case_row["id"] + "/delivery-calendar?asOfDate=" + as_of)))
            context = {"schema": SCHEMA, "operationId": OPERATION, "baseUrl": server.origin, "ownerKey": server.token,
                       "caseId": case_row["id"], "planId": case["program"]["planId"], "asOfDate": as_of,
                       "directory": str(root), "workspace": str(workspace), "sourceDirectory": str(HERE), "python": sys.executable}
            private_write(root / "browser-context.json", encode(context))
            browser = run_browser(args.node, root / "browser-context.json", root)
            after = request(server.origin, server.token, "/api/operations/" + case_row["id"])
            if (after["plan"]["revision"] != browser["savedRevision"]
                    or after["plan"]["contentSha256"] != browser["savedContentSha256"]):
                raise ValueError("Receive the exact original amendment application before completing delivery.")
            preserved = unchanged_business(read_json(before_path), after)
            result.update({"caseId": case_row["id"], "caseVersion": after["program"]["version"],
                           "planId": after["program"]["planId"], "asOfDate": as_of,
                           "savedRevision": browser["savedRevision"], "savedContentSha256": browser["savedContentSha256"],
                           "preservedOriginalRecords": preserved, "browser": browser})
            private_write(root / "case-after.json", encode(after))
            private_write(root / "original-case-complete.zip", request(server.origin, server.token,
                "/api/operations/" + case_row["id"] + "/export.zip", binary=True))
            from staff_installation import export_installation
            archive, manifest = export_installation(server.workspace)
            private_write(root / "whole-installation.zip", archive)
            private_write(root / "installation-manifest.json", encode(manifest))
            result["wholeInstallation"] = identity(root / "whole-installation.zip")
            private_write(record_path, encode(result))
        agenda_command = [str(args.node), str(HERE / "case_planning_agenda_receiving.mjs"),
                          "--context", str(root / "browser-context.json")]
        with open(root / "agenda-native.stdout", "ab") as out, open(root / "agenda-native.stderr", "ab") as err:
            agenda_run = subprocess.run(agenda_command, cwd=HERE, stdout=out, stderr=err, timeout=600, check=False)
        if agenda_run.returncode:
            raise RuntimeError("Continue the original managed agenda receiving; native return " + str(agenda_run.returncode))
        result["agendaNative"] = read_json(root / "AGENDA_NATIVE_RECEIVING.json")
        private_write(record_path, encode(result))
        result["coldReceiving"] = cold_receive(root / "whole-installation.zip", root, result, args.node)
        result["complete"] = True
        result["completedAt"] = stamp()
        private_write(record_path, encode(result))
        result["delivery"] = complete_archive(root, result)
        private_write(record_path, encode(result))
        return result
    except BaseException as error:
        result["lastInterruption"] = {"at": stamp(), "type": type(error).__name__, "message": str(error)}
        private_write(record_path, encode(result))
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True, help="Complete original calendar/customer case ZIP")
    parser.add_argument("--directory", type=Path, required=True, help="Private receiving directory, reused for continuation")
    parser.add_argument("--node", type=Path, required=True, help="Existing installed Node executable")
    parser.add_argument("--database", type=Path, help="Exact original complete SQLite database when the archive contains several")
    parser.add_argument("--case-id", help="Exact retained walkthrough case")
    parser.add_argument("--as-of-date", help="Original operator's calendar comparison date")
    args = parser.parse_args()
    result = operate(args)
    print(json.dumps({"operationId": OPERATION, "caseId": result["caseId"], "caseVersion": result["caseVersion"],
                      "planId": result["planId"], "savedRevision": result["savedRevision"],
                      "savedContentSha256": result["savedContentSha256"], "complete": result["complete"],
                      "delivery": result.get("delivery")}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
