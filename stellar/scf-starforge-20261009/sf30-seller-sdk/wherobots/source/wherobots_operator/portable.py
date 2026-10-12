"""Complete, editable Wherobots workflow handovers using the original object store."""
from __future__ import annotations

import csv
import hashlib
import json
import os
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path

from .editions import (EDITION_SCHEMA, _canonical, _dataset, _digest, _file_hash,
                       _lossless_json, _object, _record_body, _relative,
                       edition_rows, fail, iter_edition_rows, now)
from .storage import identifier, sync_directory

HANDOVER_SCHEMA = "stellar-forge.wherobots-handover.v1"
RECEIVING_SCHEMA = "stellar-forge.wherobots-receiving.v1"
SOURCE_SUFFIXES = {".py", ".md", ".html", ".js", ".mjs", ".css", ".txt", ".json",
                   ".csv", ".ndjson", ".jsonl", ".geojson", ".parquet", ".geoparquet"}
KINDS = ("workflow", "operation", "capture", "edition")
MANIFEST_BYTES = 32 * 1024 * 1024


def _directory(workspace):
    return Path(workspace.directory).resolve()


def _private_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".writing-" + os.urandom(8).hex())
    try:
        with open(temporary, "xb") as stream:
            os.chmod(temporary, 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False).encode("utf-8") + b"\n"


def _record_id(value):
    return identifier(value, "original record ID")


REFERENCE_FIELDS = {
    "object", "source_object", "source_objects", "listing_object", "row_index_object",
    "changes_object", "report_object", "run_object", "run_objects", "listing_objects",
    "retained_listing_pages", "retained_pages", "original_input", "pages",
}
DATA_FIELDS = {
    "provider", "native_payload", "preview", "row", "rows", "key", "metadata",
    "file_metadata_base64", "geometry", "columns", "response", "listing", "data", "body",
}
INTERNAL_MANIFEST_SCHEMAS = {
    "starforge.wherobots.output-listing.v1",
    "starforge.wherobots.object-references.v1",
}


def _objects(value, result=None):
    """Follow named internal references, never arbitrary data-shaped digest pairs."""
    result = {} if result is None else result
    def visit(node, reference=False):
        if isinstance(node, dict):
            if reference and set(("sha256", "bytes")).issubset(node):
                sha, size = node["sha256"], node["bytes"]
                if (not isinstance(sha, str) or len(sha) != 64 or
                    any(char not in "0123456789abcdef" for char in sha) or
                    type(size) is not int or size < 0):
                    fail("OUTPUT_OBJECT_DESCRIPTOR", "An internal object reference is malformed.")
                descriptor = {"sha256": sha, "bytes": size}
                if sha in result and result[sha] != descriptor:
                    fail("OUTPUT_OBJECT_DESCRIPTOR", "One retained object has inconsistent sizes.")
                result[sha] = descriptor
                return
            for key, item in node.items():
                if key not in DATA_FIELDS:
                    visit(item, key in REFERENCE_FIELDS)
        elif isinstance(node, list):
            for item in node:
                visit(item, reference)
    visit(value)
    return result


def _nested_objects(data):
    if len(data) > MANIFEST_BYTES or not data.lstrip().startswith(b"{"):
        return {}
    try:
        manifest = json.loads(data)
    except (UnicodeError, json.JSONDecodeError):
        return {}
    if not isinstance(manifest, dict) or manifest.get("schema") not in INTERNAL_MANIFEST_SCHEMAS:
        return {}
    return _objects(manifest)


def _workflow_records(workspace, workflow_id):
    workflow = workspace.get_record("workflow", workflow_id)
    if workflow.get("id") != workflow_id or workflow.get("workflow_id") != workflow_id:
        fail("OUTPUT_WORKFLOW", "Select the original retained workflow.")
    records = [("workflow", workflow)]
    records.extend((kind, record) for kind in KINDS[1:]
                   for record in workspace.records(kind) if record.get("workflow_id") == workflow_id)
    ids = {(kind, record["id"]) for kind, record in records}
    for kind, record in records:
        if kind in {"capture", "edition"} and ("operation", record.get("operation_id")) not in ids:
            fail("OUTPUT_CLOSURE", "An edition is missing its original operation record.")
    return sorted(records, key=lambda item: (KINDS.index(item[0]), item[1]["id"]))


def _source_files():
    root = Path(__file__).resolve().parent.parent
    result = {}
    for path in sorted(root.rglob("*")):
        if (path.is_file() and not path.is_symlink() and "__pycache__" not in path.parts and
            (path.suffix in SOURCE_SUFFIXES or path.name.upper() in {"LICENSE", "NOTICE", "COPYING"})):
            relative = path.relative_to(root).as_posix()
            if any(part.startswith(".") for part in Path(relative).parts):
                continue
            result["source/" + relative] = path
    return result


def _start_here(workflow, editions):
    lines = [
        "# Wherobots workflow and complete receiving", "",
        "This package contains the original workflow, operation and capture records, every retained source/run/log/listing/output object, the complete inspected datasets, and editable operator source.", "",
        "Open index.html for the dataset overview. Open manifest.json for exact file and record identities. Output part files are stored unchanged under objects/ using their original SHA256; every edition lists its source-relative paths and corresponding objects.", "",
        "## Reopen the workflow", "",
        "Install the pinned dependencies from the included source requirements, then use the original operator CLI to receive this archive into a selected private workspace. Receiving keeps that destination workspace identity and imports the original workflow, operation, native run and edition identities.", "",
        "The Python receiving entry point is:", "",
        "~~~python",
        "from pathlib import Path",
        "from wherobots_operator.storage import Workspace",
        "from wherobots_operator.portable import import_handover",
        "workspace = Workspace('/absolute/customer-workspace', create=True, title='Received workflow')",
        "receipt = import_handover(workspace, Path('/absolute/this-handover.zip'))",
        "~~~", "",
        "The original storage lifecycle applies. Original runtime/account configuration is required when continuing a provider run or submitting a newly reviewed job. Received rows, geometry, source files, comparisons and operator source remain available independently of a provider connection.", "",
        "## Exact values and geometry", "",
        "The row preview uses explicit number/decimal/integer/binary/temporal tags where ordinary browser JSON values would lose precision. Original JSON, CSV and Parquet bytes remain unchanged. GeoParquet metadata distinguishes an absent CRS (the format default) from an explicit null CRS (unknown). Envelopes use original coordinates without reprojection or axis changes.", "",
        "CSV values retain source text. Every CSV definition declares whether its parts have headers; headerless parts retain reviewed column names. GeoJSON output is received as complete Feature records, using its observed newline or RFC 8142 record-separator framing.", "",
        "## Complete comparisons", "",
        "A reviewed primary key gives added, removed, changed and unchanged row identities. Without a shared key definition, the exact row multiset gives complete added/removed counts including duplicates. Full changes.ndjson and comparison report objects remain attached to the corrected edition.", "",
        "## Receiving a corrected handover", "",
        "Repeating the same archive reuses its original objects and records. A later archive from the same source workspace can advance records last written by the previous receiving operation. Locally edited records are preserved and identified as conflicts before another source revision is installed.", "",
        "## Retained editions", ""
    ]
    for edition in editions:
        lines.extend(["### " + edition["id"], "", "Native run: " + str(edition.get("native_run_id")),
                      "Source binding: " + edition["source_binding_sha256"], ""])
        for dataset in edition["datasets"]:
            lines.append("- " + dataset["id"] + ": " + str(dataset["row_count"]) + " rows in " +
                         str(sum(item["role"] == "data" for item in dataset["files"])) + " data parts; " +
                         str(sum(item["role"] == "auxiliary" for item in dataset["files"])) + " retained auxiliary objects.")
        lines.append("")
    return "\n".join(lines).encode("utf-8")


def _offline_index(workflow, editions, previews):
    data = {"workflow": _record_body(workflow), "editions": editions, "previews": previews}
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    template = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wherobots workflow receiving</title><style>
:root{font:14px/1.5 Arial,Helvetica,sans-serif;color:#24272b;background:#f0f1f2}*{box-sizing:border-box}body{margin:0}header,main{padding:26px 32px;max-width:1500px;margin:auto}header{background:white;border-bottom:1px solid #bdc2c7;max-width:none}h1{font-size:25px;margin:0 0 8px}h2{font-size:19px}h3{font-size:15px}p{color:#555d64}a{color:#303840}section{padding:22px;background:white;border:1px solid #c6cbd0;margin-bottom:20px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px 11px;text-align:left;vertical-align:top;border-bottom:1px solid #dce0e3}th{background:#edf0f2}td{max-width:360px;overflow-wrap:anywhere}.scroll{overflow:auto}.meta{font-size:12px;display:flex;gap:20px;flex-wrap:wrap}code,pre{font:12px/1.5 ui-monospace,Consolas,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;padding:12px;background:#f2f3f4}details{margin-top:16px}summary{cursor:pointer;font-weight:bold}nav{display:flex;gap:18px;margin-top:16px}@media(max-width:650px){header,main{padding:18px 12px}section{padding:15px}}</style>
<header><h1>Wherobots workflow receiving</h1><p id="title"></p><nav><a href="START_HERE.md">Receiving guide</a><a href="manifest.json">Complete manifest</a><a href="source/">Editable source</a></nav></header><main id="content"></main><script>
const data=__DATA__,escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.getElementById('title').textContent=data.workflow.definition?.title||data.workflow.id;
const table=(head,rows)=>'<div class="scroll"><table><thead><tr>'+head.map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
let output='';
for(const edition of data.editions){output+='<section><h2>'+escape(edition.id)+'</h2><div class="meta"><span>Native run '+escape(edition.native_run_id??'')+'</span><span>'+escape(edition.native_status??'')+'</span></div><p><code>'+escape(edition.source_binding_sha256)+'</code></p>';
for(const dataset of edition.datasets){const preview=data.previews[edition.id+'/'+dataset.id],names=dataset.columns.map(x=>x.name);
output+='<h3>'+escape(dataset.id)+' · '+dataset.row_count+' rows</h3>'+table(['Column','Observed values','Source type','Null','Absent'],dataset.columns.map(c=>[escape(c.name),escape(c.types.join(', ')),escape(c.source_types.join(', ')),String(c.null),String(c.missing)]));
output+='<details><summary>Original parts and markers</summary>'+table(['Source path','Role','Rows','Original object'],dataset.files.map(f=>[escape(f.relative_path),escape(f.role),String(f.row_count),'<a href="objects/'+escape(f.object.sha256)+'">'+escape(f.object.sha256.slice(0,16))+' · '+f.object.bytes+' bytes</a>']))+'</details>';
if(Object.keys(dataset.geometry).length)output+='<details><summary>Original geometry and CRS</summary><pre>'+escape(JSON.stringify(dataset.geometry,null,2))+'</pre></details>';
output+='<details><summary>First '+preview.rows.length+' of '+dataset.row_count+' retained rows</summary>'+table(names,preview.rows.map(row=>names.map(name=>escape(typeof row[name]==='object'?JSON.stringify(row[name]):row[name]))))+'</details>';
}
for(const comparison of edition.comparisons||[])output+='<details><summary>Complete comparison '+escape(comparison.id.slice(0,16))+'</summary><pre>'+escape(JSON.stringify(comparison.datasets,null,2))+'</pre><p><a href="objects/'+escape(comparison.changes_object.sha256)+'">Complete change records</a> · <a href="objects/'+escape(comparison.report_object.sha256)+'">Comparison report</a></p></details>';
output+='</section>';}document.getElementById('content').innerHTML=output;
</script></html>"""
    return template.replace("__DATA__", encoded).encode("utf-8")


def _zip_member(archive, name, content):
    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (stat.S_IFREG | 0o600) << 16
    with archive.open(info, "w", force_zip64=True) as output:
        if isinstance(content, Path):
            with open(content, "rb") as source:
                shutil.copyfileobj(source, output, 1024 * 1024)
        else:
            output.write(content)


def export_handover(workspace, workflow_id, destination):
    records = _workflow_records(workspace, workflow_id)
    workflow = next(record for kind, record in records if kind == "workflow")
    editions = [record for kind, record in records if kind == "edition"]
    files, descriptors, object_refs = {}, [], {}
    for kind, record in records:
        path = "records/" + kind + "/" + _record_id(record["id"]) + ".json"
        files[path] = _json_bytes(_record_body(record))
        descriptors.append({"kind": kind, "id": record["id"], "path": path,
                            "revision_sha256": record["revision_sha256"]})
        _objects(record, object_refs)
    visited = set()
    while pending := [sha for sha in object_refs if sha not in visited]:
        for sha in pending:
            descriptor = object_refs[sha]
            path = _object(workspace, descriptor)
            files["objects/" + sha] = path
            visited.add(sha)
            if descriptor["bytes"] <= MANIFEST_BYTES:
                for nested_sha, nested in _nested_objects(path.read_bytes()).items():
                    if nested_sha in object_refs and object_refs[nested_sha] != nested:
                        fail("OUTPUT_OBJECT_DESCRIPTOR", "A nested manifest changes an original object size.")
                    object_refs[nested_sha] = nested
    files.update(_source_files())
    previews = {edition["id"] + "/" + dataset["id"]: edition_rows(workspace, edition["id"], dataset["id"], 0, 20)
                for edition in editions for dataset in edition["datasets"]}
    files["START_HERE.md"] = _start_here(workflow, editions)
    files["index.html"] = _offline_index(workflow, editions, previews)
    inventory = []
    for name, content in sorted(files.items()):
        receipt = _file_hash(content) if isinstance(content, Path) else {"sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}
        inventory.append({"path": name, **receipt})
    payload = {"schema": HANDOVER_SCHEMA, "source_workspace_id": workspace.workspace_id,
               "workflow_id": workflow_id, "records": descriptors,
               "objects": [object_refs[sha] for sha in sorted(object_refs)],
               "files": inventory, "created_at": workflow.get("created_at")}
    manifest = {**payload, "package_id": _digest(payload)}
    destination = Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_name(destination.name + ".writing-" + os.urandom(8).hex())
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            _zip_member(archive, "manifest.json", _json_bytes(manifest))
            for name, content in sorted(files.items()):
                _zip_member(archive, name, content)
        with open(temporary, "rb") as stream:
            os.fsync(stream.fileno())
        if destination.exists():
            with zipfile.ZipFile(destination) as existing:
                original = json.loads(existing.read("manifest.json"))
            if original.get("package_id") != manifest["package_id"]:
                fail("OUTPUT_DESTINATION_EXISTS", "The destination contains a different retained handover; choose its own filename.")
            if _file_hash(destination) != _file_hash(temporary):
                fail("OUTPUT_ARCHIVE_CHANGED", "An existing handover differs from its original deterministic package.")
        else:
            try:
                os.link(temporary, destination)
            except FileExistsError:
                if _file_hash(destination) != _file_hash(temporary):
                    fail("OUTPUT_ARCHIVE_CONFLICT", "Another handover now occupies that filename.")
            sync_directory(destination.parent)
        return {"schema": HANDOVER_SCHEMA, "package_id": manifest["package_id"], "workflow_id": workflow_id,
                "source_workspace_id": workspace.workspace_id, "path": str(destination),
                **_file_hash(destination), "records": len(descriptors), "objects": len(object_refs),
                "files": len(inventory) + 1, "editions": [edition["id"] for edition in editions]}
    finally:
        temporary.unlink(missing_ok=True)


def _archive_manifest(archive):
    infos = archive.infolist()
    names = [info.filename for info in infos]
    if len(names) != len(set(names)) or "manifest.json" not in names:
        fail("OUTPUT_ARCHIVE_MEMBERS", "The handover requires one manifest and unique declared files.")
    for info in infos:
        _relative(info.filename)
        if info.is_dir() or stat.S_IFMT(info.external_attr >> 16) not in (0, stat.S_IFREG):
            fail("OUTPUT_ARCHIVE_MEMBER", "A handover member must be an original regular file.")
    manifest_info = archive.getinfo("manifest.json")
    if manifest_info.file_size > MANIFEST_BYTES:
        fail("OUTPUT_MANIFEST_SIZE", "The handover manifest exceeds its 32 MiB metadata budget.")
    manifest = json.loads(archive.read(manifest_info))
    if not isinstance(manifest, dict) or manifest.get("schema") != HANDOVER_SCHEMA:
        fail("OUTPUT_HANDOVER_SCHEMA", "Use the original Wherobots handover schema.")
    payload = {key: value for key, value in manifest.items() if key != "package_id"}
    if manifest.get("package_id") != _digest(payload):
        fail("OUTPUT_HANDOVER_IDENTITY", "The original handover manifest identity changed.")
    file_records = manifest.get("files")
    if not isinstance(file_records, list):
        fail("OUTPUT_HANDOVER_FILES", "The handover requires its complete file inventory.")
    expected = {item["path"]: item for item in file_records}
    if len(expected) != len(file_records) or set(names) != set(expected) | {"manifest.json"}:
        fail("OUTPUT_HANDOVER_FILES", "The archive file set differs from its original manifest.")
    for name, record in expected.items():
        _relative(name)
        if type(record.get("bytes")) is not int or record["bytes"] < 0 or archive.getinfo(name).file_size != record["bytes"]:
            fail("OUTPUT_HANDOVER_SIZE", "A handover member has a different original length.")
        digest = hashlib.sha256()
        with archive.open(name) as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        if digest.hexdigest() != record.get("sha256"):
            fail("OUTPUT_HANDOVER_DIGEST", "A handover member differs from its original digest: " + name)
    return manifest, expected


def import_handover(workspace, source):
    source = Path(source).resolve()
    original_archive = _file_hash(source)
    root = _directory(workspace)
    with zipfile.ZipFile(source) as archive:
        manifest, inventory = _archive_manifest(archive)
        workflow_id = _record_id(manifest["workflow_id"])
        receiving = root / "receiving" / "wherobots" / workflow_id
        state_path = receiving / "state.json"
        previous = json.loads(state_path.read_text()) if state_path.exists() else None
        if previous and previous.get("source_workspace_id") != manifest["source_workspace_id"]:
            fail("OUTPUT_RECEIVING_SOURCE", "This receiving workflow belongs to a different original source workspace.")
        supplied_records = manifest.get("records")
        if not isinstance(supplied_records, list) or not supplied_records:
            fail("OUTPUT_HANDOVER_RECORDS", "The handover requires its original workflow records.")
        records, identities, referenced_objects = [], set(), {}
        for item in supplied_records:
            if item.get("kind") not in KINDS:
                fail("OUTPUT_HANDOVER_RECORD", "Unknown original workspace record kind.")
            identity = (item["kind"], _record_id(item["id"]))
            if identity in identities:
                fail("OUTPUT_HANDOVER_RECORD", "The handover repeats an original record.")
            identities.add(identity)
            expected_path = "records/" + item["kind"] + "/" + item["id"] + ".json"
            if item.get("path") != expected_path or expected_path not in inventory:
                fail("OUTPUT_HANDOVER_RECORD", "The record path differs from its original identity.")
            body = json.loads(archive.read(expected_path))
            if body.get("id") != item["id"] or body.get("workflow_id") != workflow_id or "revision_sha256" in body:
                fail("OUTPUT_HANDOVER_RECORD", "Original record and workflow identities differ.")
            if _digest(body) != item.get("revision_sha256"):
                fail("OUTPUT_HANDOVER_REVISION", "An original record revision differs from its body.")
            _objects(body, referenced_objects)
            records.append((item, body))
        if ("workflow", workflow_id) not in identities:
            fail("OUTPUT_HANDOVER_WORKFLOW", "The handover omits its original workflow.")
        for item, body in records:
            if item["kind"] in {"capture", "edition"} and ("operation", body.get("operation_id")) not in identities:
                fail("OUTPUT_HANDOVER_CLOSURE", "An edition is missing its original operation.")
        supplied_objects = {item["sha256"]: item for item in manifest.get("objects", [])}
        visited = set()
        while pending := [sha for sha in referenced_objects if sha not in visited]:
            for sha in pending:
                descriptor = referenced_objects[sha]
                file = inventory.get("objects/" + sha)
                if file is None or file["sha256"] != sha or file["bytes"] != descriptor["bytes"]:
                    fail("OUTPUT_HANDOVER_CLOSURE", "A retained source object is missing or changed.")
                visited.add(sha)
                if descriptor["bytes"] <= MANIFEST_BYTES:
                    for nested_sha, nested in _nested_objects(archive.read("objects/" + sha)).items():
                        if nested_sha in referenced_objects and referenced_objects[nested_sha] != nested:
                            fail("OUTPUT_HANDOVER_CLOSURE", "A nested object has an inconsistent size.")
                        referenced_objects[nested_sha] = nested
        if supplied_objects != referenced_objects:
            fail("OUTPUT_HANDOVER_CLOSURE", "The archive differs from the full record/manifest/object closure.")
        plan = []
        current_records = {(kind, item["id"]): item for kind in KINDS for item in workspace.records(kind)}
        prior = previous.get("records", {}) if previous else {}
        for item, body in sorted(records, key=lambda pair: (KINDS.index(pair[0]["kind"]), pair[0]["id"])):
            key = item["kind"] + "/" + item["id"]
            current = current_records.get((item["kind"], item["id"]))
            if current is None:
                action, expected_revision = "create", None
            elif _canonical(_record_body(current)) == _canonical(body):
                action, expected_revision = "reuse", current["revision_sha256"]
            elif prior.get(key, {}).get("received_revision_sha256") == current["revision_sha256"]:
                action, expected_revision = "advance", current["revision_sha256"]
            else:
                fail("OUTPUT_RECEIVING_CONFLICT", "The destination has its own changed record: " + key)
            plan.append({"descriptor": item, "body": body, "action": action, "expected_revision": expected_revision})
        journal_path = receiving / (manifest["package_id"] + ".json")
        journal = {"schema": RECEIVING_SCHEMA, "package_id": manifest["package_id"], "workflow_id": workflow_id,
                   "source_workspace_id": manifest["source_workspace_id"], "receiving_workspace_id": workspace.workspace_id,
                   "source_archive": original_archive, "status": "RECEIVING",
                   "records": [{"kind": part["descriptor"]["kind"], "id": part["descriptor"]["id"],
                                "action": part["action"], "source_revision_sha256": part["descriptor"]["revision_sha256"]}
                               for part in plan], "started_at": now()}
        _private_write(journal_path, _json_bytes(journal))
        with tempfile.TemporaryDirectory(prefix="objects-", dir=receiving) as temporary:
            for sha, descriptor in sorted(supplied_objects.items()):
                staged = Path(temporary) / sha
                with archive.open("objects/" + sha) as input_stream, open(staged, "xb") as output:
                    shutil.copyfileobj(input_stream, output, 1024 * 1024)
                retained = workspace.put_object(staged)
                if retained != descriptor:
                    fail("OUTPUT_RECEIVING_OBJECT", "The destination returned a different object identity.")
        source_root = receiving / manifest["package_id"] / "source"
        for path in sorted(inventory):
            if not path.startswith("source/"):
                continue
            target = source_root / path[len("source/"):]
            data = archive.read(path)
            if target.exists() and _file_hash(target) != {"sha256": inventory[path]["sha256"], "bytes": inventory[path]["bytes"]}:
                fail("OUTPUT_RECEIVING_SOURCE_EDIT", "An existing editable source file changed: " + path)
            if not target.exists():
                _private_write(target, data)
        received_records = {}
        counts = {"created": 0, "advanced": 0, "reused": 0}
        for part in plan:
            item, body = part["descriptor"], part["body"]
            if part["action"] == "reuse":
                received = workspace.get_record(item["kind"], item["id"])
                if _canonical(_record_body(received)) != _canonical(body):
                    fail("OUTPUT_RECEIVING_CONCURRENT_CHANGE", "A record changed during receiving.")
                counts["reused"] += 1
            else:
                received = workspace.save_record(item["kind"], item["id"], body, expected_revision=part["expected_revision"])
                counts["created" if part["action"] == "create" else "advanced"] += 1
            if received["revision_sha256"] != item["revision_sha256"]:
                fail("OUTPUT_RECEIVING_REVISION", "The receiver did not preserve the original record revision.")
            key = item["kind"] + "/" + item["id"]
            received_records[key] = {"source_revision_sha256": item["revision_sha256"],
                                     "received_revision_sha256": received["revision_sha256"]}
        if _file_hash(source) != original_archive:
            fail("OUTPUT_RECEIVING_ARCHIVE_CHANGED", "The original archive changed while it was received.")
        final = {**journal, "status": "COMPLETE", "completed_at": now(), **counts,
                 "objects": len(supplied_objects), "source_directory": str(source_root),
                 "records": received_records}
        _private_write(state_path, _json_bytes({"schema": RECEIVING_SCHEMA,
                      "source_workspace_id": manifest["source_workspace_id"], "workflow_id": workflow_id,
                      "package_id": manifest["package_id"], "records": received_records}))
        _private_write(journal_path, _json_bytes(final))
        return final


def export_dataset_handover(workspace, edition_id, dataset_id, destination):
    """Prepare the complete source-bound CSV and originals for the existing SF30 loader."""
    edition, dataset = _dataset(workspace, edition_id, dataset_id)
    columns = [column["name"] for column in dataset["columns"]]
    if not columns or len(columns) > 32:
        fail("OUTPUT_DATASET_COLUMNS", "The original SF30 value/state handover requires 1–32 complete source columns.")
    destination = Path(destination).absolute()
    if destination.is_symlink():
        fail("OUTPUT_DATASET_DESTINATION", "Use an ordinary receiving directory.")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    binding = {"edition_id": edition_id, "dataset_id": dataset_id,
               "source_binding_sha256": edition["source_binding_sha256"]}
    if destination.exists() and any(destination.iterdir()):
        marker = destination / "source.json"
        if marker.is_file():
            original = json.loads(marker.read_text())
            if all(original.get(key) == value for key, value in binding.items()):
                inventory_path = destination / "package.json"
                if not inventory_path.is_file():
                    fail("OUTPUT_DATASET_INCOMPLETE", "The original dataset package is missing its complete inventory.")
                receipt = json.loads(inventory_path.read_text())
                payload = {key: value for key, value in receipt.items() if key != "package_id"}
                if receipt.get("package_id") != _digest(payload):
                    fail("OUTPUT_DATASET_CHANGED", "The original dataset package manifest changed.")
                for file in receipt["files"]:
                    path = destination / _relative(file["path"])
                    if not path.is_file() or _file_hash(path) != {key: file[key] for key in ("sha256", "bytes")}:
                        fail("OUTPUT_DATASET_CHANGED", "An original dataset package member changed: " + file["path"])
                return {**receipt, **binding, "directory": str(destination), "source": original, "reused": True}
        fail("OUTPUT_DATASET_DESTINATION", "Use a separate destination for a different original dataset package.")
    used, mapping = set(), []
    for original in columns:
        candidate = "".join(char if char.isascii() and (char.isalnum() or char == "_") else "_" for char in original)
        if not candidate or not candidate[0].isalpha() or candidate in {"constructor", "prototype", "__proto__"}:
            candidate = "field_" + candidate
        candidate = candidate[:35]
        if candidate in used or candidate + "_state" in used:
            candidate = candidate[:25] + "_" + hashlib.sha256(original.encode()).hexdigest()[:8]
        if candidate in used or candidate + "_state" in used:
            fail("OUTPUT_DATASET_COLUMN_COLLISION", "Two original fields have ambiguous receiving names.")
        used.update((candidate, candidate + "_state"))
        mapping.append({"source_field": original, "name": candidate, "state_column": candidate + "_state",
                        "encoding": "source-text-or-lossless-json"})
    rows, maximum_cell = 0, 1
    with tempfile.TemporaryDirectory(prefix="dataset-", dir=destination.parent) as temporary:
        staged = Path(temporary)
        with open(staged / "dataset.csv", "w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream, lineterminator="\n")
            physical = [name for item in mapping for name in (item["name"], item["state_column"])]
            writer.writerow(physical)
            for row in iter_edition_rows(workspace, dataset):
                values = []
                for item in mapping:
                    if item["source_field"] not in row:
                        values.extend(("", "missing"))
                    elif row[item["source_field"]] is None:
                        values.extend(("", "null"))
                    else:
                        value = row[item["source_field"]]
                        text = str(value) if isinstance(value, str) else _lossless_json(value)
                        # SF30's JavaScript parser counts UTF-16 code units.
                        cell_chars = len(text.encode("utf-16-le")) // 2
                        if cell_chars > 1024 * 1024:
                            fail("OUTPUT_DATASET_ENGINE_LIMIT", "A complete cell exceeds the original SF30 1 MiB text capacity.")
                        maximum_cell = max(maximum_cell, cell_chars)
                        values.extend((text, "value"))
                if len(_canonical(dict(zip(physical, values)))) > 800 * 1024:
                    fail("OUTPUT_DATASET_ENGINE_LIMIT", "A complete row exceeds the original SF30 response capacity.")
                writer.writerow(values)
                rows += 1
                if rows > 1000000 or stream.tell() > 256 * 1024 * 1024:
                    fail("OUTPUT_DATASET_ENGINE_LIMIT", "This complete CSV exceeds the original SF30 capacity; use the full workflow handover.")
            stream.flush()
            os.fsync(stream.fileno())
        if rows != dataset["row_count"]:
            fail("OUTPUT_DATASET_COUNT", "The complete dataset export differs from its original edition count.")
        size = (staged / "dataset.csv").stat().st_size
        if size > 256 * 1024 * 1024:
            fail("OUTPUT_DATASET_ENGINE_LIMIT", "This complete CSV exceeds the original SF30 capacity; use the full workflow handover.")
        title = str(dataset["definition"].get("title") or dataset_id)
        title = "".join(char if ord(char) >= 32 and ord(char) != 127 else " " for char in title).strip()[:128] or "Wherobots output"
        config = {"schema": "stellar-forge.csv-dataset.v1", "name": title,
                  "file": "dataset.csv", "columns": {name: "string" for name in physical},
                  "filters": [item["name"] for item in mapping[:8]], "ranges": [],
                  "sorts": [item["name"] for item in mapping[:8]],
                  "defaultLimit": 50, "maxLimit": 250, "maxBytes": max(1, size),
                  "maxRows": max(1, rows), "maxCellChars": maximum_cell}
        operation = workspace.get_record("operation", edition["operation_id"])
        original_objects = _objects([dataset, _record_body(operation)])
        visited = set()
        while pending := [sha for sha in original_objects if sha not in visited]:
            for sha in pending:
                descriptor = original_objects[sha]
                path = _object(workspace, descriptor)
                target = staged / "originals" / sha
                target.parent.mkdir(mode=0o700, exist_ok=True)
                with open(path, "rb") as source_stream, open(target, "xb") as output:
                    shutil.copyfileobj(source_stream, output, 1024 * 1024)
                    output.flush(); os.fsync(output.fileno())
                if _file_hash(target) != descriptor:
                    fail("OUTPUT_DATASET_CHANGED", "An original source object changed during dataset receiving.")
                visited.add(sha)
                if descriptor["bytes"] <= MANIFEST_BYTES:
                    for nested_sha, nested in _nested_objects(path.read_bytes()).items():
                        if nested_sha in original_objects and original_objects[nested_sha] != nested:
                            fail("OUTPUT_OBJECT_DESCRIPTOR", "A nested original has inconsistent sizes.")
                        original_objects[nested_sha] = nested
        source = {"schema": "stellar-forge.wherobots-dataset-source.v1", **binding,
                  "workflow_id": edition["workflow_id"], "operation_id": edition["operation_id"],
                  "native_run_id": edition.get("native_run_id"), "row_count": rows,
                  "content_sha256": dataset["content_sha256"], "mapping": mapping,
                  "columns": dataset["columns"], "geometry": dataset["geometry"],
                  "listing_object": dataset["listing_object"], "original_operation": _record_body(operation),
                  "original_parts": dataset["files"],
                  "original_objects": [{"path": "originals/" + sha, **original_objects[sha]} for sha in sorted(original_objects)],
                  "dataset_csv": _file_hash(staged / "dataset.csv")}
        _private_write(staged / "dataset.json", _json_bytes(config))
        _private_write(staged / "source.json", _json_bytes(source))
        files = [{"path": path.relative_to(staged).as_posix(), **_file_hash(path)}
                 for path in sorted(staged.rglob("*")) if path.is_file()]
        payload = {"schema": "stellar-forge.wherobots-dataset-package.v1", **binding,
                   "workflow_id": edition["workflow_id"], "operation_id": edition["operation_id"],
                   "dataset_config": "dataset.json", "source_manifest": "source.json", "files": files}
        receipt = {**payload, "package_id": _digest(payload)}
        _private_write(staged / "package.json", _json_bytes(receipt))
        # The complete directory is installed at once; an interrupted staging write is disposable.
        os.rename(staged, destination)
        sync_directory(destination.parent)
    return {**receipt, "directory": str(destination), "source": source, "reused": False}
