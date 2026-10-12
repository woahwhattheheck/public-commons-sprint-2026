"""MIT. Operate and reopen the complete original 169-record Islandora preparation.

From oai-pmh:
  python3 examples/islandora_ciim.py --archive /path/CIIM-OpenAlex-receiving-case.zip \
    --case /private/islandora-case --operator "Repository operator" --serve

The immutable source archive is the completed original OAI/OpenAlex receiving
case. This command performs source preparation. Use the resulting console or
islandora_cli.py to operate the configured native Workbench on the actual target.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import py_compile
import shutil
import sys
import tempfile
import zipfile

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from workspace import Workspace
from islandora import IslandoraDesk, file_sha, host_url, put_file
from harvest import InputError, decode, jbytes, stamp

SCHEMA = "stellar-forge.islandora-ciim-case.v1"
REFERENCE_TARGET = "https://radar.auctr.edu"
LABEL = "Original scholarly metadata — Islandora commissioning"
ORIGINAL = {
    "name": "CIIM-OpenAlex-receiving-case.zip",
    "libraryFileId": "libfile_92629f9464e4819187121d891884cca1",
    "fileId": "file_000000002de481f58b4abd84c9c2541d",
    "bytes": 1302912,
    "sha256": "d90b84fb410c7540c4782be6f2b35b4b04a242684160e96401054d40d260279d",
}
SOURCE_FILES = (
    "islandora.py", "islandora_cli.py", "islandora_io.py",
    "server.py", "browser.mjs", "islandora.mjs", "islandora.css",
    "cli.mjs", "islandora_cli.mjs", "managed.py",
    "ISLANDORA_OPERATOR_GUIDE.md", "examples/islandora_ciim.py",
)

def emit(stage, **value):
    print(json.dumps({"stage": stage, **value}, ensure_ascii=False), flush=True)

def saved(path):
    return decode(Path(path).read_bytes())

def archive_member(archive, basename):
    names = [name for name in archive.namelist() if Path(name).name == basename]
    if len(names) != 1:
        raise InputError("The original case must contain exactly one " + basename)
    return archive.read(names[0])

def source_files(cache):
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    result = []
    for name in SOURCE_FILES:
        path = HERE / name
        if not path.is_file():
            raise InputError("Install the complete application source, including " + name)
        result.append({"file": name, "bytes": path.stat().st_size, "sha256": file_sha(path)})
        if path.suffix == ".py":
            py_compile.compile(str(path), cfile=str(cache / (file_sha(path) + ".pyc")), doraise=True)
    return result

def retain_input(case, selected):
    inputs = case / "input"
    inputs.mkdir(mode=0o700, exist_ok=True)
    original = inputs / ORIGINAL["name"]
    if not original.exists():
        if not selected:
            raise InputError("Supply the original completed receiving archive with --archive")
        source = Path(selected).resolve()
        if source.stat().st_size != ORIGINAL["bytes"] or file_sha(source) != ORIGINAL["sha256"]:
            raise InputError("Use the unchanged original 169-record receiving archive")
        with source.open("rb") as incoming, original.open("xb") as output:
            shutil.copyfileobj(incoming, output, 65536)
        os.chmod(original, 0o600)
    if original.stat().st_size != ORIGINAL["bytes"] or file_sha(original) != ORIGINAL["sha256"]:
        raise InputError("The retained original receiving archive changed")
    with zipfile.ZipFile(original) as archive:
        if len(set(archive.namelist())) != len(archive.namelist()):
            raise InputError("The original archive contains duplicate members")
        source_case = decode(archive_member(archive, "receiving-case.json"))
        backup_body = archive_member(archive, "receiving-workspace.zip")
    expected = source_case["workspaceBackup"]
    if len(backup_body) != expected["bytes"] or hashlib.sha256(backup_body).hexdigest() != expected["sha256"]:
        raise InputError("The original receiving backup differs from its source case")
    if source_case["status"] != "COMPLETE" or source_case["restoration"]["rows"] != 169:
        raise InputError("Continue the complete original 169-record restoration")
    backup = inputs / "original-receiving-workspace.zip"
    if backup.exists():
        if file_sha(backup) != expected["sha256"]:
            raise InputError("The retained source backup changed")
    else:
        put_file(backup, backup_body)
    put_file(inputs / "original-receiving-case.json", jbytes(source_case))
    return source_case, backup, original

def native_rows(ws, build):
    result, cursor, seen, pages = [], None, set(), 0
    while True:
        query = {"limit": "47"}
        if cursor:
            query["cursor"] = cursor
        response = ws.query(build["id"], query)["response"]
        if response["status"] != 200:
            raise InputError("The original native dataset could not return its complete selection")
        body = response["body"]
        result.extend(row if isinstance(row, dict) else dict(zip(body["fields"], row))
                      for row in body["rows"])
        pages += 1
        cursor = body["page"]["nextCursor"]
        if cursor is None:
            return result, pages
        if cursor in seen:
            raise InputError("The original native dataset repeated a continuation")
        seen.add(cursor)

def all_records(desk, identity):
    rows, offset = [], 0
    while True:
        page = desk.records(identity, offset, 200)
        rows.extend(page["items"])
        if page["next"] is None:
            return rows
        offset = page["next"]

def produce(case, archive_path, target, config, operator, note, out):
    case.mkdir(mode=0o700, parents=True, exist_ok=True)
    checkpoint = case / "operation.json"
    previous = saved(checkpoint) if checkpoint.exists() else {}
    if previous and previous.get("schema") != SCHEMA:
        raise InputError("Use this command's retained case directory")
    source_case, backup, original = retain_input(case, archive_path)
    receiver = case / "receiving"
    if not receiver.exists():
        current_backup = case / previous["workspaceBackup"]["file"] if previous.get("workspaceBackup") else backup
        if previous.get("workspaceBackup") and file_sha(current_backup) != previous["workspaceBackup"]["sha256"]:
            raise InputError("The operated workspace backup changed")
        Workspace.restore(current_backup, receiver)
    metadata = {**previous, "schema": SCHEMA, "sourceArchive": ORIGINAL, "startedAt": previous.get("startedAt", stamp()),
                "sourceFiles": source_files(case / "compile")}
    ws = Workspace(receiver)
    try:
        original_build = ws._get("oai_builds", source_case["restoration"]["buildId"])
        if original_build["rowCount"] != 169:
            raise InputError("The original source cohort changed")
        plan = ws.xml.plan(original_build["planId"])
        plan["name"] = "islandora_original_169_records"
        mapping = ws.save_mapping(plan)
        build = ws.build(original_build["editionId"], mapping["id"])
        original_data = ws._build_file(original_build, "data.csv")
        data = ws._build_file(build, "data.csv")
        if data.read_bytes() != original_data.read_bytes():
            raise InputError("The new source projection changed an original metadata cell")
        source_rows = list(csv.DictReader(io.StringIO(data.read_text(encoding="utf-8"))))
        actual, pages = native_rows(ws, build)
        if len(actual) != 169 or [r["identifier"] for r in actual] != [r["identifier"] for r in source_rows]:
            raise InputError("The native projection differs from the complete original source")
        for returned, original_row in zip(actual, source_rows):
            for column in plan["columns"]:
                if column["type"] == "string" and not column.get("nullable"):
                    if returned[column["name"]] != original_row[column["name"]]:
                        raise InputError("The native projection changed an original metadata value")
        metadata["projection"] = {"sourceBuildId": original_build["id"], "buildId": build["id"],
            "editionId": build["editionId"], "rows": len(actual), "pages": pages,
            "dataSha256": file_sha(data), "columns": list(source_rows[0])}
        emit("original_projection", **metadata["projection"])
        desk = IslandoraDesk(ws)
        if previous.get("jobId"):
            job = desk.job(previous["jobId"])
        else:
            matching = [item for item in desk.state()["items"]
                        if item["buildId"] == build["id"] and item["label"] == LABEL]
            if len(matching) > 1:
                raise InputError("This case has more than one matching migration; continue the saved job in its console")
            job = matching[0] if matching else desk.create(
                build["id"], LABEL, target or REFERENCE_TARGET,
                config=config, plan=desk.default_plan(build["id"]))
        if job["buildId"] != build["id"]:
            raise InputError("The saved migration belongs to another source build")
        metadata.update(jobId=job["id"], target=job["target"]["host"], status="PREPARING")
        put_file(checkpoint, jbytes(metadata))
        if (target and host_url(target) != job["target"]["host"]) or config:
            job = desk.configure(job["id"], target, config)
        rows = all_records(desk, job["id"])
        if len(rows) != 169 or [r["identifier"] for r in rows] != [r["identifier"] for r in source_rows]:
            raise InputError("The migration omitted or changed an original source identity")
        issues = [{"identifier": r["identifier"], "mappingErrors": r["mappingErrors"],
                   "conflicts": r["conflicts"], "state": r["state"]}
                  for r in rows if r["state"] in {"REVIEW", "READ_TARGET"}]
        written = any(not run["check"] and run["task"] != "export_csv" for run in job.get("runs", []))
        if not issues and not written and job["status"] != "COMPLETE":
            job = desk.review(job["id"], operator, note)
        prepared = desk.prepare(job["id"])
        job = desk.job(job["id"])
        rows = all_records(desk, job["id"])
        snapshot = hashlib.sha256(jbytes(job) + b"".join(jbytes(row) for row in rows)).hexdigest()
        edition = case / "snapshots" / snapshot
        edition.mkdir(mode=0o700, parents=True, exist_ok=True)
        migration_zip = edition / "islandora-migration.zip"
        if not migration_zip.exists():
            migration = desk.export(job["id"], migration_zip)
        else:
            migration = {"path": str(migration_zip), "sha256": file_sha(migration_zip), "bytes": migration_zip.stat().st_size}
        backup_zip = edition / "islandora-workspace.zip"
        if not backup_zip.exists():
            workspace_backup = ws.backup(backup_zip)
        else:
            workspace_backup = {"path": str(backup_zip), "sha256": file_sha(backup_zip), "bytes": backup_zip.stat().st_size}
        metadata.update(status="REVIEW_REQUIRED" if issues else "PREPARED", target=job["target"]["host"],
            counts=job["counts"], review=job.get("review"), sourceReviewIssues=issues,
            batches=prepared["batches"], migrationState=job["status"],
            migrationPackage={"file": migration_zip.relative_to(case).as_posix(),
                              "bytes": migration["bytes"], "sha256": migration["sha256"]},
            workspaceBackup={"file": backup_zip.relative_to(case).as_posix(),
                             "bytes": workspace_backup["bytes"], "sha256": workspace_backup["sha256"]})
        expected_job, expected_rows = job, rows
    finally:
        ws.close()
    with tempfile.TemporaryDirectory(prefix="reopen-", dir=case) as temporary:
        restored = Path(temporary) / "workspace"
        Workspace.restore(backup_zip, restored)
        reopened = Workspace(restored)
        try:
            received = IslandoraDesk(reopened)
            if received.job(job["id"]) != expected_job or all_records(received, job["id"]) != expected_rows:
                raise InputError("The reopened migration differs from its complete saved state")
            native = reopened.query(build["id"], {"limit": "1"})
            if native["dataset"]["rowCount"] != 169:
                raise InputError("The reopened native dataset changed")
            metadata["reopened"] = {"records": len(expected_rows), "jobId": job["id"],
                                   "workspaceBackupSha256": file_sha(backup_zip)}
        finally:
            reopened.close()
    with zipfile.ZipFile(migration_zip) as archive:
        manifest = decode(archive.read("package.json"))
        for entry in manifest["files"]:
            body = archive.read(entry["file"])
            if len(body) != entry["bytes"] or hashlib.sha256(body).hexdigest() != entry["sha256"]:
                raise InputError("The operated migration package changed a retained member")
        metadata["migrationPackage"]["files"] = len(manifest["files"])
    metadata["completedAt"] = stamp()
    put_file(checkpoint, jbytes(metadata))
    human_state = {"READY": "Reviewed", "PREPARED": "Prepared", "REVIEW": "Needs review",
                   "READ_TARGET": "Receive current target", "COMPLETE": "Complete",
                   "CONTINUE": "Continue saved work"}.get(job["status"], job["status"].replace("_", " ").title())
    readme = f"""# Original 169-record Islandora preparation

This saved case contains the complete original receiving archive, an operated
Islandora migration package, its full reopening workspace backup, and the
operator guide. The source records and their OAI identities are retained.

Current migration: {job['label']}
State: {human_state}
Target configuration: {job['target']['host']}
Records: {len(expected_rows)}

Extract this complete archive into a private directory. From the installed
oai-pmh application directory, open that same saved case:

    python3 examples/islandora_ciim.py --case /absolute/extracted-case --open-only --serve

The command restores the included workspace backup and opens the retained
migration. The archive keeps the original input and snapshot paths referenced
by operation.json, so the same case can also continue through this producer.

Select Islandora in the console. The complete crosswalk, records, native inputs,
review, original responses, and current receiving state reopen together.
Use Save target settings to configure the actual installation before native
writes. The operator guide explains Workbench operation and target receiving.

To restore the backup directly into another private workspace, use:

    python3 cli.py --workspace /absolute/new-workspace restore --archive /absolute/extracted-case/{metadata['workspaceBackup']['file']}
    python3 cli.py --workspace /absolute/new-workspace serve
"""
    put_file(edition / "README.md", readme.encode())
    put_file(edition / "operation.json", jbytes(metadata))
    guide = HERE / "ISLANDORA_OPERATOR_GUIDE.md"
    out = Path(out).absolute() if out else case / "Islandora_Original_169_Operated_Case.zip"
    if out.exists() and file_sha(out) != previous.get("bundle", {}).get("sha256"):
        raise InputError("Choose a new --out path or the original produced case archive")
    out.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix="." + out.name + ".", suffix=".tmp", dir=out.parent)
    os.close(handle)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            # Keep the same paths used by the saved operation and --open-only.
            for path in (original, migration_zip, backup_zip):
                archive.write(path, path.relative_to(case).as_posix())
            for path in (edition / "README.md", edition / "operation.json"):
                archive.write(path, path.name)
            archive.write(guide, guide.name)
        os.chmod(temporary, 0o600)
        os.replace(temporary, out)
    finally:
        if temporary.exists():
            temporary.unlink()
    metadata["bundle"] = {"path": str(out), "bytes": out.stat().st_size, "sha256": file_sha(out)}
    put_file(checkpoint, jbytes(metadata))
    emit("case_saved", status=metadata["status"], migrationState=job["status"],
         rows=len(expected_rows), unresolved=len(issues), **metadata["bundle"])
    return receiver, metadata

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", required=True, help="Private directory for this complete retained case")
    parser.add_argument("--archive", help="Exact original CIIM-OpenAlex-receiving-case.zip")
    parser.add_argument("--target", help="Actual target base URL; a new case defaults to the vendor-linked RADAR reference")
    parser.add_argument("--config", help="Supported Workbench target settings JSON file")
    parser.add_argument("--operator", default="Repository operator")
    parser.add_argument("--note", default="Prepared and reviewed all 169 original projected source records and their complete title, description, identifier, and rights mapping for target commissioning.")
    parser.add_argument("--out", help="New delivery ZIP, or this case's earlier produced ZIP")
    parser.add_argument("--open-only", action="store_true", help="Reopen the existing operated case without another preparation")
    parser.add_argument("--serve", action="store_true", help="Open the same full console after preparing or reopening")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    os.umask(0o077)
    case = Path(args.case).absolute()
    if args.open_only:
        metadata = saved(case / "operation.json")
        if metadata.get("schema") != SCHEMA or not metadata.get("workspaceBackup"):
            raise InputError("Open an existing complete operated case")
        receiver = case / "receiving"
        if not receiver.exists():
            backup = case / metadata["workspaceBackup"]["file"]
            if file_sha(backup) != metadata["workspaceBackup"]["sha256"]:
                raise InputError("The saved operated backup changed")
            Workspace.restore(backup, receiver)
        emit("case_opened", jobId=metadata["jobId"], directory=str(receiver))
    else:
        receiver, metadata = produce(case, args.archive, args.target,
            saved(args.config) if args.config else None, args.operator, args.note, args.out)
    if args.serve:
        from server import serve
        serve(receiver, args.port)
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (InputError, OSError, ValueError, KeyError, zipfile.BadZipFile, py_compile.PyCompileError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
