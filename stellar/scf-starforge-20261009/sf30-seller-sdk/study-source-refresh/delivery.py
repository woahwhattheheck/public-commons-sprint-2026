"""Complete reviewed source packets and independent receiving without a new fetch."""
from __future__ import annotations

import csv
import io
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import zipfile

from model import SCHEMA, clone, dump, encoded, fail, hash_id, identity, member, now, parse, private_directory, read, sync_directory, text
from workspace import DDL, Workspace, file_identity, source_identity, unpack, verify_source

DELIVERY_SCHEMA = "stellar-forge.study-source-refresh.delivery.v1"


def copy_private(source, destination):
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    before = file_identity(source)
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with source.open("rb") as old, os.fdopen(fd, "wb") as new:
        shutil.copyfileobj(old, new, 65536)
        new.flush()
        os.fsync(new.fileno())
    if file_identity(source) != before or file_identity(destination) != before:
        fail("DELIVERY_COPY_CHANGED")
    return before


def copy_tree(source, destination):
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        if path.is_symlink():
            fail("DELIVERY_SOURCE_SYMLINK")
        if path.is_dir():
            (destination / relative).mkdir(mode=0o700, exist_ok=True)
        else:
            copy_private(path, destination / relative)


def inventory(directory):
    return [{"path": str(path.relative_to(directory)), **file_identity(path)}
            for path in sorted(directory.rglob("*")) if path.is_file()]


def _snapshot(workspace, destination, spec, source_ids):
    target = sqlite3.connect(destination)
    os.chmod(destination, 0o600)
    target.executescript(DDL)
    target.execute("INSERT INTO meta VALUES('schema',?)", (SCHEMA,))
    edition_ids = [eid for eid in (spec["baseline_id"], spec["candidate_id"]) if eid]
    revision_ids = set()
    for eid in edition_ids:
        edition = workspace.record("editions", eid)
        revision_ids.update((edition["portfolio_id"], edition["mapping_id"]))
    selections = {
        "sources": ("id", source_ids), "source_rows": ("source_id", source_ids),
        "revisions": ("id", sorted(revision_ids)), "editions": ("id", edition_ids),
        "edition_rows": ("edition_id", edition_ids), "comparisons": ("id", [spec["id"]]),
        "differences": ("comparison_id", [spec["id"]]), "decisions": ("comparison_id", [spec["id"]]),
    }
    for table, (key, values) in selections.items():
        query = "SELECT * FROM " + table + " WHERE " + key + " IN (" + ",".join("?" for _ in values) + ")"
        for row in workspace.connection.execute(query, values):
            target.execute("INSERT INTO " + table + " VALUES(" + ",".join("?" for _ in row) + ")", tuple(row))
    for row in workspace.connection.execute("SELECT * FROM acquisitions WHERE source_id IN (" + ",".join("?" for _ in source_ids) + ")", source_ids):
        target.execute("INSERT INTO acquisitions VALUES(?,?,?,?)", tuple(row))
    references = set(source_ids) | revision_ids | set(edition_ids) | {spec["id"]}
    for row in workspace.connection.execute("SELECT * FROM events ORDER BY id"):
        if row["reference"] in references:
            target.execute("INSERT INTO events VALUES(?,?,?,?,?)", tuple(row))
    target.commit()
    if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        fail("DELIVERY_SNAPSHOT_INVALID")
    target.close()


def export_package(workspace, comparison_id, *, expected_version, operator, label, destination=None):
    text(operator, "operator", maximum=200)
    text(label, "label", maximum=200)
    with workspace.mutation():
        spec = workspace.comparison(comparison_id, limit=1)
        if spec["review_version"] != expected_version:
            fail("REVIEW_CHANGED", current_version=spec["review_version"])
        if spec["pending"] or spec["global_issues"]:
            fail("REVIEW_INCOMPLETE", pending=spec["pending"], global_issues=spec["global_issues"])
        candidate = workspace.record("editions", spec["candidate_id"])
        baseline = workspace.record("editions", spec["baseline_id"]) if spec["baseline_id"] else None
        source_ids = sorted(set(candidate["source_ids"]) | set(baseline["source_ids"] if baseline else []))
        sources = [{"id": sid, **workspace.record("sources", sid)} for sid in source_ids]
        for source in sources:
            verify_source(workspace.directory / "sources" / source["id"], source["descriptor"])
        decisions = [dict(row, body=unpack(row["body"])) for row in workspace.connection.execute(
            "SELECT key,action,body FROM decisions WHERE comparison_id=? ORDER BY key", (comparison_id,))]
        request = {"comparison_id": comparison_id, "review_version": expected_version,
                   "operator": operator, "label": label, "decisions_sha256": identity(decisions)}
        operation_id = identity(request)
        out = Path(destination).expanduser().absolute() if destination else workspace.directory / "deliveries" / operation_id
        parent = private_directory(out.parent)
        if parent != out.parent:
            fail("DELIVERY_OUTPUT_CANONICAL_REQUIRED")
        if out.exists():
            manifest = verify_package(out)
            if manifest["operation_id"] != operation_id:
                fail("DELIVERY_DESTINATION_CONFLICT")
            return {"id": manifest["package_id"], "directory": str(out), "reopened": True, **manifest}
        stage = Path(tempfile.mkdtemp(prefix=".delivery-", dir=parent))
        try:
            for source in sources:
                copy_tree(workspace.directory / "sources" / source["id"], stage / "originals" / source["id"])
            acquisition_records = []
            for row in workspace.connection.execute("SELECT * FROM acquisitions WHERE source_id IN (" + ",".join("?" for _ in source_ids) + ")", source_ids):
                body = unpack(row["body"])
                copy_tree(workspace.directory / "acquisitions" / row["id"], stage / "acquisitions" / row["id"])
                acquisition_records.append({"id": row["id"], "source_id": row["source_id"], **body})
            dump(stage / "source-manifest.json", {"schema": "stellar-forge.study-source-inventory.v1",
                  "sources": sources, "acquisitions": acquisition_records})
            dump(stage / "portfolio.json", workspace.record("revisions", candidate["portfolio_id"]))
            mapping = workspace.record("revisions", candidate["mapping_id"])
            dump(stage / "mapping.json", mapping)
            dump(stage / "editions.json", {"candidate": candidate, "baseline": baseline})
            dump(stage / "review-decisions.json", {"comparison_id": comparison_id, "review_version": expected_version,
                  "unchanged_policy": spec["unchanged"], "decisions": decisions})
            private_directory(stage / "release-comparison")
            dump(stage / "release-comparison" / "summary.json", {k: v for k, v in spec.items() if k not in {"rows", "next", "offset", "total"}})
            private_directory(stage / "observations")
            private_directory(stage / "mapped-export")
            accepted_ids, excluded_ids = [], []
            differences = stage / "release-comparison" / "rows.jsonl"
            with differences.open("x", encoding="utf-8") as output:
                os.chmod(differences, 0o600)
                for record in workspace.connection.execute("SELECT key,body FROM differences WHERE comparison_id=? ORDER BY key", (comparison_id,)):
                    body = unpack(record["body"])
                    decision = workspace.connection.execute("SELECT action,body FROM decisions WHERE comparison_id=? AND key=?", (comparison_id, record["key"])).fetchone()
                    action = decision["action"] if decision else "accept"
                    (accepted_ids if action == "accept" else excluded_ids).extend(body["after_rows"])
                    full = {"key": record["key"], **body, "action": action,
                            "decision": unpack(decision["body"]) if decision else {"automatic": True, "policy": "unchanged"},
                            "before": [workspace.edition_row(spec["baseline_id"], rid) for rid in body["before_rows"]],
                            "after": [workspace.edition_row(spec["candidate_id"], rid) for rid in body["after_rows"]]}
                    output.write(encoded(full).decode() + "\n")
            if len(set(accepted_ids + excluded_ids)) != candidate["counts"]["selected"]:
                fail("DELIVERY_SELECTION_RECONCILIATION_FAILED")
            columns = [column["name"] for column in mapping["columns"]]
            jsonl = stage / "mapped-export" / "rows.jsonl"
            csv_path = stage / "mapped-export" / "table.csv"
            with jsonl.open("x", encoding="utf-8") as records, csv_path.open("x", encoding="utf-8", newline="") as csv_file:
                os.chmod(jsonl, 0o600)
                os.chmod(csv_path, 0o600)
                writer = csv.DictWriter(csv_file, fieldnames=columns, lineterminator="\r\n")
                writer.writeheader()
                for rid in sorted(accepted_ids):
                    row = workspace.edition_row(spec["candidate_id"], rid)
                    if row["issues"]:
                        fail("DELIVERY_MAPPING_ISSUE", row_id=rid)
                    records.write(encoded(row["mapped"]).decode() + "\n")
                    writer.writerow({name: "" if row["mapped"][name] is None else
                                     encoded(row["mapped"][name]).decode() if isinstance(row["mapped"][name], (dict, list))
                                     else row["mapped"][name] for name in columns})
            for name, eid in (("candidate", spec["candidate_id"]), ("baseline", spec["baseline_id"])):
                if eid:
                    path = stage / "observations" / (name + ".jsonl")
                    with path.open("x", encoding="utf-8") as output:
                        os.chmod(path, 0o600)
                        for record in workspace.connection.execute("SELECT body FROM edition_rows WHERE edition_id=? ORDER BY row_id", (eid,)):
                            output.write(record["body"] + "\n")
            acceptance = {
                "schema": "stellar-forge.study-export-review.v1", "operator": operator, "label": label,
                "review": request, "source_inventory_verified": True,
                "candidate_rows": candidate["counts"]["selected"], "exported_rows": len(accepted_ids),
                "excluded_rows": len(excluded_ids), "excluded_row_ids": sorted(excluded_ids),
                "pending_reviews": 0, "mapping_issues_in_export": 0,
                "null_encoding": {"jsonl": "JSON null", "csv": "empty cell; use the frozen mapping nullability"},
                "decimal_encoding": "Exact decimal strings", "csv_formula_policy": "Exact values; import columns using the declared schema",
                "comparison_mode": spec["mode"],
            }
            dump(stage / "acceptance.json", acceptance)
            _snapshot(workspace, stage / "workspace.sqlite3", spec, source_ids)
            from model import write
            write(stage / "OPERATE.md", (
                "# Retained study source refresh\n\n"
                "Run the installed study-source-refresh CLI verify command on this directory to check every member. "
                "Run receive with a new private workspace to reopen the exact sources, frozen mappings, editions and saved reviews. "
                "The receive step reads the retained packet and does not retrieve public data.\n\n"
                "The mapped-export directory contains the agreed frozen column mapping. Decimal values are strings in JSONL; "
                "CSV nulls are empty cells. Import CSV with the declared column types so spreadsheet formula interpretation is not applied "
                "to exact original text. Every excluded row and its operator note remains in release-comparison.\n\n"
                "Original provider files, HTTP receipts, native projections and source declarations are under originals. "
                "Acquisitions retains original SF88/SF100 delivery manifests and output identities when a completed acquisition was received. "
                "The original buyer session continues to own payment and page recovery.\n\n"
                "Use the reopened workspace to import a later retained release, freeze a new edition and compare it. "
                "Geography crosswalks, units and source periods remain explicit. "
                "A successive-release difference is not a statistical significance test.\n"
            ).encode())
            core = {"schema": DELIVERY_SCHEMA, "operation_id": operation_id, "comparison_id": comparison_id,
                    "candidate_id": spec["candidate_id"], "baseline_id": spec["baseline_id"],
                    "review_version": expected_version, "label": label, "operator": operator,
                    "source_ids": source_ids, "rows": len(accepted_ids), "excluded_rows": len(excluded_ids),
                    "files": inventory(stage)}
            manifest = {**core, "package_id": identity(core)}
            dump(stage / "manifest.json", manifest)
            verify_package(stage)
            os.rename(stage, out)
            stage = None
            sync_directory(parent)
            body = {"directory": str(out), **manifest}
            workspace.connection.execute("INSERT OR IGNORE INTO exports VALUES(?,?,?)",
                                         (manifest["package_id"], encoded(body).decode(), now()))
            workspace.event("export.create", manifest["package_id"], {"comparison_id": comparison_id, "rows": len(accepted_ids)})
            return {"id": manifest["package_id"], "reopened": False, **body}
        finally:
            if stage is not None:
                shutil.rmtree(stage)


def verify_package(directory):
    directory = Path(directory).expanduser().resolve(strict=True)
    manifest = parse(read(directory / "manifest.json", 16 * 1024 * 1024))
    if manifest.get("schema") != DELIVERY_SCHEMA or not isinstance(manifest.get("files"), list):
        fail("STUDY_DELIVERY_MANIFEST_REQUIRED")
    if len(manifest["files"]) > 50000:
        fail("DELIVERY_INVENTORY_LIMIT")
    core = {key: value for key, value in manifest.items() if key != "package_id"}
    if identity(core) != manifest.get("package_id"):
        fail("DELIVERY_MANIFEST_CHANGED")
    expected, size = {}, 0
    for item in manifest["files"]:
        name = member(item["path"])
        if name == "manifest.json" or name in expected:
            fail("DELIVERY_DUPLICATE_MEMBER")
        size += item["bytes"]
        if size > 2 * 1024**3:
            fail("DELIVERY_BYTE_LIMIT")
        path = directory / name
        if path.resolve(strict=True) != path or file_identity(path) != {key: item[key] for key in ("bytes", "sha256")}:
            fail("DELIVERY_MEMBER_CHANGED", path=name)
        expected[name] = item
    actual = {str(path.relative_to(directory)) for path in directory.rglob("*") if not path.is_dir()}
    if actual != set(expected) | {"manifest.json"}:
        fail("DELIVERY_INVENTORY_CHANGED")
    for sid in manifest["source_ids"]:
        descriptor = verify_source(directory / "originals" / hash_id(sid))
        if source_identity(descriptor) != sid:
            fail("DELIVERY_SOURCE_ID_CHANGED")
    database = sqlite3.connect("file:" + str(directory / "workspace.sqlite3") + "?mode=ro", uri=True)
    try:
        database.execute("PRAGMA trusted_schema=OFF")
        expected_tables = {"meta", "sources", "source_rows", "revisions", "editions", "edition_rows",
                           "comparisons", "differences", "decisions", "exports", "events", "acquisitions", "sqlite_sequence"}
        schema = database.execute("SELECT name,type FROM sqlite_master WHERE type IN ('table','view','trigger')").fetchall()
        if {name for name, kind in schema if kind == "table"} != expected_tables or any(kind != "table" for _, kind in schema):
            fail("DELIVERY_WORKSPACE_SCHEMA_CHANGED")
        if database.execute("SELECT value FROM meta WHERE key='schema'").fetchone() != (SCHEMA,):
            fail("DELIVERY_WORKSPACE_SCHEMA_CHANGED")
        if {row[0] for row in database.execute("SELECT id FROM sources")} != set(manifest["source_ids"]):
            fail("DELIVERY_WORKSPACE_SOURCE_CHANGED")
        comparison = database.execute("SELECT body,review_version FROM comparisons WHERE id=?", (manifest["comparison_id"],)).fetchone()
        if not comparison or comparison[1] != manifest["review_version"] or unpack(comparison[0])["candidate_id"] != manifest["candidate_id"]:
            fail("DELIVERY_WORKSPACE_REVIEW_CHANGED")
        if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            fail("DELIVERY_WORKSPACE_INVALID")
    finally:
        database.close()
    rows = 0
    with (directory / "mapped-export" / "rows.jsonl").open("rb") as stream:
        for raw in stream:
            if not raw.endswith(b"\n") or not isinstance(parse(raw), dict):
                fail("DELIVERY_MAPPED_ROW_INVALID")
            rows += 1
    if rows != manifest["rows"]:
        fail("DELIVERY_ROW_COUNT_CHANGED")
    return manifest


def receive_package(package, destination):
    source = Path(package).expanduser().resolve(strict=True)
    manifest = verify_package(source)
    out = Path(destination).expanduser().absolute()
    parent = private_directory(out.parent)
    if parent != out.parent:
        fail("RECEIVE_CANONICAL_PARENT_REQUIRED")
    receipt = {"schema": "stellar-forge.study-received.v1", "package_id": manifest["package_id"],
               "comparison_id": manifest["comparison_id"], "source_ids": manifest["source_ids"]}
    if out.exists():
        saved = parse(read(out / "received-package.json", 16384))
        if saved != receipt:
            fail("RECEIVE_WORKSPACE_CONFLICT")
        workspace = Workspace(out)
        try:
            for sid in manifest["source_ids"]:
                verify_source(out / "sources" / sid, workspace.record("sources", sid)["descriptor"])
            return {**receipt, "directory": str(out), "reopened": True,
                    "comparison": workspace.comparison(manifest["comparison_id"], limit=1)}
        finally:
            workspace.close()
    stage = Path(tempfile.mkdtemp(prefix=".receive-", dir=parent))
    try:
        copy_private(source / "workspace.sqlite3", stage / "workspace.sqlite3")
        private_directory(stage / "sources")
        for sid in manifest["source_ids"]:
            copy_tree(source / "originals" / sid, stage / "sources" / sid)
        if (source / "acquisitions").exists():
            copy_tree(source / "acquisitions", stage / "acquisitions")
        dump(stage / "received-package.json", receipt)
        workspace = Workspace(stage)
        try:
            overview = workspace.comparison(manifest["comparison_id"], limit=1)
            if overview["pending"] or overview["global_issues"]:
                fail("RECEIVED_REVIEW_INCOMPLETE")
        finally:
            workspace.close()
        os.rename(stage, out)
        stage = None
        sync_directory(parent)
        return {**receipt, "directory": str(out), "reopened": False, "comparison": overview}
    finally:
        if stage is not None:
            shutil.rmtree(stage)


def archive_package(directory, destination):
    manifest = verify_package(directory)
    destination = Path(destination)
    private_directory(destination.parent)
    if destination.exists():
        fail("ARCHIVE_DESTINATION_EXISTS")
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "wb") as raw, zipfile.ZipFile(raw, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name in ["manifest.json", *[item["path"] for item in manifest["files"]]]:
                archive.write(Path(directory) / name, name)
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return {"path": str(destination), "package_id": manifest["package_id"], **file_identity(destination)}


def import_package(workspace, package):
    """Merge an unchanged retained packet into the open operator workspace."""
    source = Path(package).expanduser().resolve(strict=True)
    manifest = verify_package(source)
    packed = sqlite3.connect("file:" + str(source / "workspace.sqlite3") + "?mode=ro", uri=True)
    packed.row_factory = sqlite3.Row
    try:
        packed.execute("PRAGMA trusted_schema=OFF")
        with workspace.mutation():
            for sid in manifest["source_ids"]:
                destination = workspace.directory / "sources" / sid
                if destination.exists():
                    descriptor = verify_source(destination)
                    if source_identity(descriptor) != sid:
                        fail("RECEIVED_SOURCE_CONFLICT")
                else:
                    copy_tree(source / "originals" / sid, destination)
            tables = ("sources", "source_rows", "revisions", "editions", "edition_rows",
                      "comparisons", "differences", "decisions", "acquisitions")
            primary = {
                "source_rows": ("source_id", "row_id"), "edition_rows": ("edition_id", "row_id"),
                "differences": ("comparison_id", "key"), "decisions": ("comparison_id", "key"),
            }
            for table in tables:
                keys = primary.get(table, ("id",))
                for row in packed.execute("SELECT * FROM " + table):
                    values = dict(row)
                    existing = workspace.connection.execute("SELECT * FROM " + table + " WHERE " + " AND ".join(key + "=?" for key in keys),
                                                            [values[key] for key in keys]).fetchone()
                    if existing:
                        # Creation times may differ after an independent import of identical source bytes.
                        compare_keys = [key for key in values if key != "created"]
                        if table == "sources":
                            if source_identity(unpack(existing["body"])["descriptor"]) != values["id"]:
                                fail("RECEIVED_SOURCE_CONFLICT")
                        elif any(existing[key] != values[key] for key in compare_keys):
                            fail("RECEIVED_RECORD_CONFLICT", kind=table, identity=[values[key] for key in keys])
                    else:
                        workspace.connection.execute("INSERT INTO " + table + " VALUES(" + ",".join("?" for _ in row) + ")", tuple(row))
            for row in packed.execute("SELECT id FROM acquisitions"):
                destination = workspace.directory / "acquisitions" / row["id"]
                if not destination.exists():
                    copy_tree(source / "acquisitions" / row["id"], destination)
            private_directory(workspace.directory / "received")
            receipt = workspace.directory / "received" / (manifest["package_id"] + ".json")
            if not receipt.exists():
                dump(receipt, manifest, exclusive=True)
            workspace.event("package.receive", manifest["package_id"], {"comparison_id": manifest["comparison_id"]})
        return {"package_id": manifest["package_id"], "source_ids": manifest["source_ids"],
                "comparison": workspace.comparison(manifest["comparison_id"], limit=1)}
    finally:
        packed.close()


def extract_package(archive_path, destination):
    """Extract an operator-selected packet with bounded, declared local members."""
    destination = private_directory(destination)
    total = 0
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        if not 1 <= len(entries) <= 50000:
            fail("DELIVERY_ARCHIVE_MEMBER_LIMIT")
        seen = set()
        for info in entries:
            name = member(info.filename)
            if name in seen or info.is_dir() or info.flag_bits & 1 or (info.external_attr >> 16) & 0o170000 == 0o120000:
                fail("DELIVERY_ARCHIVE_MEMBER_INVALID")
            seen.add(name)
            total += info.file_size
            if total > 2 * 1024**3 or info.file_size > 1024**3:
                fail("DELIVERY_ARCHIVE_BYTE_LIMIT")
            path = destination / name
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            count = 0
            with archive.open(info) as old, os.fdopen(fd, "wb") as new:
                while raw := old.read(65536):
                    count += len(raw)
                    if count > info.file_size:
                        fail("DELIVERY_ARCHIVE_SIZE_CHANGED")
                    new.write(raw)
            if count != info.file_size:
                fail("DELIVERY_ARCHIVE_SIZE_CHANGED")
    return verify_package(destination)
