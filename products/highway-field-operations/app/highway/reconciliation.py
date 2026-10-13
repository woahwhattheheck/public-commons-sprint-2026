"""Bridge the original paired dataset reconciler into the highway workbench.

The service borrows one caller-owned DuckDBWorkspace. Its original import,
comparison, decisions, report, package and receiving implementations own native
effects. The highway SQLite transaction only retains verified complete results.
"""
from __future__ import annotations
import copy
import fcntl
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import uuid

SCHEMA = "geocove.reconciliation.v1"
INPUT_SCHEMA = "geocove.reconciliation-input.v1"
RESULT_SCHEMA = "geocove.reconciliation-result.v1"
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_METADATA = 16 * 1024 * 1024
MAX_FILES = 100000


def _need(ok, message):
    if not ok:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _parse(raw, exact=False):
    def pairs(items):
        value = {}
        for key, item in items:
            _need(key not in value, "Duplicate JSON key in retained native evidence.")
            value[key] = item
        return value
    return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=pairs,
                      parse_float=Decimal if exact else float,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite native JSON.")))


def _hex(value, size=64):
    _need(isinstance(value, str) and re.fullmatch("[0-9a-f]{" + str(size) + "}", value),
          "Invalid original native identity.")
    return value


def _uuid(value):
    _need(isinstance(value, str), "Use the original request UUID.")
    _need(str(uuid.UUID(value)) == value, "Use a canonical original request UUID.")
    return value


def _path(value):
    _need(isinstance(value, str) and value and len(value) <= 2000
          and not value.startswith("/") and not re.search(r"[\\:\x00-\x1f\x7f]", value)
          and all(part not in ("", ".", "..") for part in value.split("/")),
          "Use an unambiguous relative retained path.")
    return value


def _fields(value, required, optional=()):
    _need(isinstance(value, dict) and set(required) <= set(value)
          and not set(value) - set(required) - set(optional), "Unexpected or missing bridge fields.")
    return value


def _descriptor(value):
    _fields(value, ("path", "sha256", "bytes", "mediaType"))
    _path(value["path"])
    _hex(value["sha256"])
    _need(type(value["bytes"]) is int and 0 <= value["bytes"] <= MAX_FILE,
          "A complete native member exceeds the highway handover capacity.")
    _need(isinstance(value["mediaType"], str) and 0 < len(value["mediaType"]) <= 200,
          "Retain the original member media type.")
    return value


def _read(descriptor, read_blob):
    _descriptor(descriptor)
    raw = read_blob(descriptor["sha256"])
    _need(isinstance(raw, bytes) and len(raw) == descriptor["bytes"] and _sha(raw) == descriptor["sha256"],
          "Complete retained native bytes changed or are absent.")
    return raw



def _private_directory(value):
    path = Path(os.path.abspath(os.fspath(value)))
    _need(path.resolve() == path and not path.is_symlink(), "Use a canonical private directory.")
    if not path.exists():
        _need(path.parent.is_dir() and not path.parent.is_symlink(), "Create the private parent first.")
        path.mkdir(mode=0o700)
        _sync(path.parent)
    _need(path.is_dir() and not path.stat().st_mode & 0o077, "The receiving directory must be private.")
    return path


def _sync(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _local_bytes(path, expected=None):
    path = Path(path)
    _need(path.is_absolute() and path.resolve() == path, "Native file path must be canonical.")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        _need(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_FILE, "Complete native file exceeds 64 MiB.")
        chunks, count = [], 0
        while chunk := os.read(fd, min(1024 * 1024, MAX_FILE + 1 - count)):
            count += len(chunk)
            _need(count <= MAX_FILE, "Complete native file exceeds 64 MiB.")
            chunks.append(chunk)
        after, named = os.fstat(fd), path.lstat()
        stamp = lambda row: (row.st_dev, row.st_ino, row.st_size, row.st_mtime_ns, row.st_ctime_ns)
        _need(stamp(before) == stamp(after) == stamp(named) and count == before.st_size,
              "Native bytes changed while retaining the same file.")
    finally:
        os.close(fd)
    raw = b"".join(chunks)
    if expected is not None:
        _need(len(raw) == expected["bytes"] and _sha(raw) == expected["sha256"], "Original native file changed.")
    return raw


def _retain(path, raw):
    """Publish whole bytes; a hash-named private prefix survives process loss."""
    _need(isinstance(raw, bytes) and len(raw) <= MAX_FILE, "Retained complete file exceeds capacity.")
    temporary = path.parent / (".reconciliation-" + _sha(raw) + ".partial")
    if path.exists():
        _need(_local_bytes(path) == raw, "The original retained file already has different bytes.")
        info = path.lstat()
        if temporary.exists():
            alias = temporary.lstat()
            if (info.st_dev, info.st_ino) == (alias.st_dev, alias.st_ino):
                _need(stat.S_ISREG(alias.st_mode) and info.st_nlink == 2 and not alias.st_mode & 0o077,
                      "The original publication has unexpected aliases.")
                _need(_local_bytes(temporary) == raw, "The retained publication alias changed.")
                _sync(path.parent)
                temporary.unlink()
                _sync(path.parent)
        _need(path.lstat().st_nlink == 1, "The complete native file still has an unrelated alias.")
        return
    fd = os.open(temporary, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        info = os.fstat(fd)
        _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077
              and info.st_size <= len(raw), "Invalid original retained-file prefix.")
        offset = 0
        while offset < info.st_size:
            chunk = os.read(fd, min(1024 * 1024, info.st_size - offset))
            _need(chunk and chunk == raw[offset:offset + len(chunk)], "Retained prefix differs from original bytes.")
            offset += len(chunk)
        while offset < len(raw):
            count = os.write(fd, raw[offset:offset + 1024 * 1024])
            _need(count > 0, "Could not persist the complete retained file.")
            offset += count
        os.fsync(fd)
        try:
            os.link(temporary, path)
        except FileExistsError:
            _need(_local_bytes(path) == raw, "Concurrent retained file has different bytes.")
        _sync(path.parent)
        temporary.unlink()
        _sync(path.parent)
    finally:
        os.close(fd)


def _equal(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if a is None or b is None:
        return a is b
    if isinstance(a, (int, Decimal)) and isinstance(b, (int, Decimal)):
        return a == b
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return set(a) == set(b) and all(_equal(a[key], b[key]) for key in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(_equal(x, y) for x, y in zip(a, b))
    return a == b


def _capture(state, capture_id):
    rows = [row for row in state["captures"] if row["id"] == capture_id]
    _need(len(rows) == 1, "Original highway capture is unavailable.")
    return rows[0]


def _selected_features(state, selection, read_blob):
    from .domain import Source, _check_seal, _proposal_records, _same
    capture = _capture(state, selection["captureId"])
    forms = [row for row in state["forms"] if row["id"] == selection["formId"]]
    _need(len(forms) == 1 and forms[0]["layerId"] == selection["layerId"],
          "Choose a saved form edition on the selected source layer.")
    form = forms[0]
    form_capture = _capture(state, form["captureId"])
    _need((form_capture["manifest"]["service"]["url"], form_capture["manifest"]["service"].get("itemId")) ==
          (capture["manifest"]["service"]["url"], capture["manifest"]["service"].get("itemId")),
          "The form and selected capture must identify the same original service.")
    source = Source(read_blob)
    dataset = source.dataset(capture, selection["layerId"])
    _need(dataset["entry"]["coverage"].get("complete") is True,
          "Paired source linkage requires complete captured feature coverage.")
    exact = {}
    for descriptor in dataset["entry"]["featurePages"]:
        page = _parse(source.raw(descriptor), exact=True)
        for feature in page["features"]:
            identity = feature["attributes"][dataset["objectIdField"]]
            _need(type(identity) is int and identity not in exact, "Duplicate or invalid original ObjectID.")
            exact[identity] = feature
    source_kind = selection.get("sourceKind", "captured")
    _need(source_kind in ("captured", "approved-proposal"), "Choose captured values or one actual approved proposal.")
    proposal = None
    if source_kind == "captured":
        _need("proposalId" not in selection and "proposalSha256" not in selection,
              "Captured source cannot claim a proposal overlay.")
    else:
        proposals = [row for row in state["proposals"] if row["id"] == selection.get("proposalId")]
        _need(len(proposals) == 1, "The original approved proposal is unavailable.")
        proposal = proposals[0]
        _check_seal(proposal, "Approved proposal")
        _need(proposal["sha256"] == selection.get("proposalSha256")
              and proposal["captureId"] == capture["id"]
              and proposal["captureSha256"] == capture["manifest"]["sha256"]
              and proposal["state"] == "prepared" and proposal["providerOperations"] == [],
              "Use the exact locally approved proposal; do not claim County application.")
        _need(len(proposal["inspectionIds"]) == len(proposal["candidates"]), "Proposal inspection inventory changed.")
        for identity, candidate in zip(proposal["inspectionIds"], proposal["candidates"]):
            inspections = [row for row in state["inspections"] if row["id"] == identity]
            _need(len(inspections) == 1, "Original proposal inspection is unavailable.")
            decisions = [row for row in inspections[0]["decisions"] if row["id"] == candidate["decisionId"]]
            _need(len(decisions) == 1 and decisions[0]["decision"] == "approve"
                  and _same(decisions[0]["candidate"], candidate), "Proposal differs from its original approval.")
        records, service = _proposal_records(state, proposal["candidates"], source)
        _need(_same(records, proposal["records"]) and service ==
              (capture["manifest"]["service"]["url"], capture["manifest"]["service"].get("itemId")),
              "Proposal records differ from their saved approved values.")
        for retained_item, item in zip(records, _parse(canonical(records), exact=True)):
            if item["layerId"] != selection["layerId"]:
                continue
            identity = item["objectId"]
            _need(identity in exact and item["source"]["captureId"] == capture["id"]
                  and _same(retained_item["source"]["feature"], dataset["records"][identity]),
                  "The approved proposal has a different captured base feature.")
            update = item["update"]
            if update is not None:
                _need(update["attributes"][dataset["objectIdField"]] == identity, "Proposal changes original ObjectID.")
                exact[identity]["attributes"].update(update["attributes"])
                if "geometry" in update:
                    exact[identity]["geometry"] = update["geometry"]
    return capture, form, dataset, exact, proposal


def _mapping(selection, dataset):
    maps = selection["fieldMap"]
    _need(isinstance(maps, list) and 1 <= len(maps) <= 1024, "Supply complete explicit native field mappings.")
    delivery_fields, source_fields = set(), set()
    for item in maps:
        _fields(item, ("captureField", "deliveryField"), ("encoding",))
        source_field, delivery_field = item["captureField"], item["deliveryField"]
        _need(isinstance(source_field, str) and (source_field in dataset["fields"] or source_field in ("@geometry", "@feature")),
              "Mapping names a field absent from the original capture.")
        _need(isinstance(delivery_field, str) and delivery_field and delivery_field not in delivery_fields,
              "Native delivery fields must be mapped once.")
        _need(item.get("encoding", "native") in ("native", "json-text"), "Choose native or exact JSON-text encoding.")
        _need(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,47}", delivery_field)
              and delivery_field not in ("constructor", "prototype", "__proto__"),
              "Use an explicit original CSV-compatible column alias.")
        delivery_fields.add(delivery_field)
        source_fields.add(source_field)
    _need(any(item["deliveryField"] == selection["objectIdColumn"] and
              item["captureField"] == dataset["objectIdField"] and item.get("encoding", "native") == "native" for item in maps),
          "Map the actual captured ObjectID field explicitly.")
    return maps, delivery_fields, source_fields



def _project_value(item, feature):
    name = item["captureField"]
    value = feature if name == "@feature" else feature.get("geometry") if name == "@geometry" else feature["attributes"].get(name)
    return _exact_text(value) if item.get("encoding", "native") == "json-text" else value


def validate_binding(state, binding, read_blob):
    """Verify every native row against captured values or an actual saved proposal."""
    _fields(binding, ("captureId", "captureSha256", "layerId", "formId", "formSha256",
                      "objectIdColumn", "fieldMap", "rows", "rowCount", "manifestSha256",
                      "sourceBindingSha256"), ("editionId", "reviewId", "sourceKind", "proposalId", "proposalSha256"))
    capture, form, dataset, exact, proposal = _selected_features(state, binding, read_blob)
    _need(capture["manifest"]["sha256"] == binding["captureSha256"] and form["sha256"] == binding["formSha256"],
          "Original capture or form edition changed.")
    maps, delivery_fields, source_fields = _mapping(binding, dataset)
    _hex(binding["manifestSha256"]); _hex(binding["sourceBindingSha256"])
    for key in ("editionId", "reviewId"):
        if key in binding:
            _hex(binding[key])
    raw = _read(binding["rows"], read_blob)
    _need(not raw or raw.endswith(b"\n"), "Original native JSONL is incomplete.")
    seen = set()
    for line in raw.splitlines(keepends=True):
        _need(len(line) <= 8 * 1024 * 1024 and line.endswith(b"\n"), "Original native row exceeds capacity or is incomplete.")
        row = _parse(line, exact=True)
        _need(isinstance(row, dict) and set(row) == delivery_fields, "Retain every original native delivery column.")
        identity = row.get(binding["objectIdColumn"])
        _need(type(identity) is int and identity not in seen and identity in exact,
              "Native ObjectIDs must exactly identify the captured original objects.")
        seen.add(identity)
        feature = exact[identity]
        for item in maps:
            expected = _project_value(item, feature)
            _need(_equal(row[item["deliveryField"]], expected), "Native value differs from the selected captured/proposed edition.")
    _need(seen == set(exact) and type(binding["rowCount"]) is int and len(seen) == binding["rowCount"],
          "Complete native edition and selected capture have different object coverage.")
    return {"captureId": capture["id"], "captureSha256": binding["captureSha256"],
            "layerId": binding["layerId"], "formId": binding["formId"], "formSha256": binding["formSha256"],
            "sourceKind": binding.get("sourceKind", "captured"), "proposalId": proposal["id"] if proposal else None,
            "proposalSha256": proposal["sha256"] if proposal else None, "rows": len(seen),
            "omittedCaptureFields": sorted(set(dataset["fields"]) - source_fields),
            "geometryMapped": bool({"@geometry", "@feature"} & source_fields),
            "fullFeatureMapped": "@feature" in source_fields}


def _exact_text(value):
    if isinstance(value, Decimal):
        _need(value.is_finite(), "Non-finite original number.")
        return str(value)
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + _exact_text(value[key])
                              for key in sorted(value)) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_exact_text(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def materialize_dataset(state, selection, read_blob, directory):
    """Write an exact reviewed projection for the original CSV→SF100 producer.

    json-text is explicit reversible serialization, including null, geometry,
    complete features and exact decimal tokens. It does not infer SQL meanings.
    This function creates no dataset delivery report or upstream observation.
    """
    _fields(selection, ("captureId", "layerId", "formId", "objectIdColumn", "fieldMap"),
            ("sourceKind", "proposalId", "proposalSha256"))
    capture, form, dataset, features, proposal = _selected_features(state, selection, read_blob)
    maps, fields, _ = _mapping(selection, dataset)
    _need(len(maps) <= 64, "Original dataset producer supports at most 64 explicit columns.")
    root = _private_directory(directory)
    row_target, csv_target = root / "selected-rows.jsonl", root / "selected-rows.csv"
    kinds = {item["deliveryField"]: set() for item in maps}
    nullable = {name: False for name in kinds}
    names = [item["deliveryField"] for item in maps]
    quote = lambda value: '"' + value.replace('"', '""') + '"'
    csv_lines = [(",".join(quote(name) for name in names) + "\n").encode("utf-8")]
    lines, count, csv_count = [], 0, len(csv_lines[0])
    for identity in sorted(features):
        feature = features[identity]
        row = {item["deliveryField"]: _project_value(item, feature) for item in maps}
        cells = []
        for name in names:
            value = row[name]
            if value is None:
                nullable[name] = True; cells.append(""); continue
            if isinstance(value, str):
                kind, cell = "string", value
            elif type(value) is bool:
                kind, cell = "boolean", "true" if value else "false"
            elif type(value) is int:
                _need(abs(value) <= 9_007_199_254_740_991, "Use json-text to preserve an integer beyond original JS exact range.")
                kind, cell = "integer", str(value)
            elif isinstance(value, Decimal):
                floating = float(value)
                _need(math.isfinite(floating) and Decimal(str(floating)) == value,
                      "Use json-text to preserve this exact original decimal.")
                kind, cell = "number", str(value)
            else:
                raise ValueError("Use explicit json-text encoding for a complete object, array or geometry.")
            _need(len(cell) <= 1024 * 1024, "Original dataset CSV cell exceeds 1 MiB.")
            kinds[name].add(kind); cells.append(quote(cell))
        line = (_exact_text(row) + "\n").encode("utf-8")
        csv_line = (",".join(cells) + "\n").encode("utf-8")
        count += len(line); csv_count += len(csv_line)
        _need(len(line) <= 8 * 1024 * 1024 and count <= MAX_FILE and csv_count <= MAX_FILE,
              "Complete selected dataset exceeds native/highway capacity.")
        lines.append(line); csv_lines.append(csv_line)
    columns = {}
    for item in maps:
        name, values = item["deliveryField"], kinds[item["deliveryField"]]
        _need(len(values) <= 1 or values <= {"integer", "number"},
              "Use json-text for mixed original field types.")
        kind = "number" if "number" in values else next(iter(values), "string")
        columns[name] = {"type": kind, "nullable": nullable[name] or not features}
    raw, csv_raw = b"".join(lines), b"".join(csv_lines)
    _retain(row_target, raw); _retain(csv_target, csv_raw)
    descriptor = {"schema": "geocove.paired-source-projection.v1",
                  "selection": copy.deepcopy(selection), "captureSha256": capture["manifest"]["sha256"],
                  "formSha256": form["sha256"], "rowCount": len(features), "columns": columns,
                  "csv": {"path": "selected-rows.csv", "bytes": len(csv_raw), "sha256": _sha(csv_raw), "mediaType": "text/csv"},
                  "rows": {"path": "selected-rows.jsonl", "bytes": len(raw), "sha256": _sha(raw), "mediaType": "application/x-ndjson"},
                  "sourceKind": selection.get("sourceKind", "captured"),
                  "meaning": "Local approved proposed values; not applied to County GIS." if proposal else
                             "Actual values from the retained complete County capture."}
    _retain(root / "projection.json", canonical(descriptor))
    return {**descriptor, "csvPath": str(csv_target), "rowsPath": str(row_target),
            "producerOptions": {"file": str(csv_target), "name": "Highway " + descriptor["sourceKind"],
                                "columns": columns, "nullEncoding": "unquoted-empty",
                                "maxBytes": MAX_FILE, "maxCellChars": 1024 * 1024}}


def _native_package(files, read_blob, expected_workspace_id):
    """Check the complete original native file inventory, never a locator."""
    by_path = {row["path"]: row for row in files}
    descriptor = by_path.get("package/manifest.json")
    _need(descriptor is not None, "Retain the whole original native package manifest.")
    manifest = _parse(_read(descriptor, read_blob))
    _need(manifest.get("schema") == "stellar-forge.duckdb-reconciliation.v1.export"
          and manifest.get("state") == "COMPLETE" and manifest.get("complete") is True
          and manifest.get("workspace_id") == expected_workspace_id,
          "Native package identity is incomplete or belongs to another workspace.")
    declared = manifest.get("files")
    _need(isinstance(declared, list) and len(declared) <= MAX_FILES, "Invalid original native file inventory.")
    names = set()
    for item in declared:
        name = _path(item.get("name"))
        _need(name not in names and name != "manifest.json", "Duplicate native package member.")
        names.add(name)
        actual = by_path.get("package/" + name)
        _need(actual is not None and actual["sha256"] == item.get("sha256") and actual["bytes"] == item.get("bytes"),
              "Original native package member is missing or changed.")
    _need({name.removeprefix("package/") for name in by_path if name.startswith("package/")} == names | {"manifest.json"},
          "Native package inventory has undeclared members.")
    required = {"report.json", "reconciliation-request.json", "OPERATING.md",
                "warehouse/warehouse.duckdb", "warehouse/handoff.json", "warehouse/handoff-request.json"}
    _need(required <= names, "The native warehouse/source handover is incomplete.")
    report = _parse(_read(by_path["package/report.json"], read_blob))
    request = _parse(_read(by_path["package/reconciliation-request.json"], read_blob))
    _need(report.get("report_id") == manifest.get("report_id")
          and _sha(canonical(report)) == manifest.get("report_digest")
          and request.get("report") == report and request.get("request_id") == manifest.get("request_id")
          and request.get("workspace_id") == manifest["workspace_id"]
          and request.get("export_id") == manifest.get("export_id"),
          "Original report and package binding disagree.")
    sources = manifest.get("sources")
    _need(isinstance(sources, list) and {row.get("edition_id") for row in sources} ==
          {report["source_edition"], report["target_edition"]}, "Package native source editions changed.")
    for item in sources:
        prefix = "sources/" + _hex(item["edition_id"]) + "/"
        _need(isinstance(item.get("files"), list) and item["files"]
              and all(prefix + _path(name) in names for name in item["files"]),
              "Complete package lacks an original native source member.")
    return manifest


def _record_value(state, command, read_blob):
    body = command["body"]
    _fields(body, ("id", "kind", "inputSha256", "resultSha256", "files", "captureIds", "nativeWorkspaceId"))
    _uuid(body["id"])
    _hex(body["inputSha256"])
    _hex(body["resultSha256"])
    _hex(body["nativeWorkspaceId"], 32)
    files = body["files"]
    _need(isinstance(files, list) and 2 <= len(files) <= MAX_FILES, "Retain the complete native input/result and files.")
    by_path, total = {}, 0
    for descriptor in files:
        _descriptor(descriptor)
        _need(descriptor["path"] not in by_path, "Duplicate retained bridge member.")
        by_path[descriptor["path"]] = descriptor
        total += descriptor["bytes"]
        _need(total <= MAX_TOTAL, "Complete native handover exceeds the explicit 256 MiB limit.")
        _read(descriptor, read_blob)
    _need("input.json" in by_path and "result.json" in by_path, "Original input and result bytes are required.")
    _need(by_path["input.json"]["sha256"] == body["inputSha256"]
          and by_path["result.json"]["sha256"] == body["resultSha256"], "Native input/result identity changed.")
    _need(by_path["input.json"]["bytes"] <= MAX_METADATA and by_path["result.json"]["bytes"] <= MAX_METADATA,
          "Complete native input/result metadata exceeds 16 MiB.")
    original = _parse(_read(by_path["input.json"], read_blob))
    result = _parse(_read(by_path["result.json"], read_blob))
    _need(original.get("schema") == INPUT_SCHEMA and result.get("schema") == RESULT_SCHEMA
          and original.get("operation") == body["kind"] == result.get("operation")
          and result.get("inputSha256") == body["inputSha256"]
          and original.get("nativeWorkspaceId") == result.get("nativeWorkspaceId") == body["nativeWorkspaceId"],
          "Original command/result/workspace binding changed.")
    returned_files = result.get("files")
    _need(isinstance(returned_files, list), "Retain the native result's full file inventory.")
    _need(len(returned_files) == len(by_path) - 2
          and {row["path"] for row in returned_files} == set(by_path) - {"input.json", "result.json"}
          and all(by_path.get(row["path"]) == row for row in returned_files),
          "The retained result lost an original native file.")
    bindings = result.get("bindings")
    _need(isinstance(bindings, list), "Original source bindings are required.")
    for binding in bindings:
        _need(by_path.get(binding.get("rows", {}).get("path")) == binding.get("rows"),
              "Original native row bytes must travel with the source binding.")
        validate_binding(state, binding, read_blob)
    captures = sorted({binding["captureId"] for binding in bindings})
    _need(isinstance(body["captureIds"], list) and sorted(body["captureIds"]) == captures
          and len(body["captureIds"]) == len(captures), "Capture inventory differs from actual source bindings.")
    if body["kind"] in ("save-pair", "run", "decision", "report", "resume", "export", "receive", "restore"):
        _need(bindings, "Retain actual original source linkage for this paired operation.")
    if any(path.startswith("package/") for path in by_path):
        manifest = _native_package(files, read_blob, body["nativeWorkspaceId"])
        report = _parse(_read(by_path["package/report.json"], read_blob))
        required_editions = {report["source_edition"], report["target_edition"]}
        _need(required_editions <= {row.get("editionId") for row in bindings},
              "Native package report is missing its captured/proposed edition bindings.")
        for binding in bindings:
            if binding.get("editionId") in required_editions:
                rows = by_path.get("package/sources/" + binding["editionId"] + "/dataset.jsonl")
                _need(rows is not None and (rows["bytes"], rows["sha256"]) ==
                      (binding["rows"]["bytes"], binding["rows"]["sha256"]),
                      "Packaged native edition differs from its captured/proposed row binding.")
    return {**copy.deepcopy(body), "at": command["at"], "actor": copy.deepcopy(command["actor"]),
            "requestId": command["requestId"], "bytes": total,
            "nativeResult": copy.deepcopy(result["result"]), "bindings": copy.deepcopy(bindings)}


def apply_reconciliation(state, command, read_blob):
    _need(command.get("kind") == "reconciliation.record", "Unknown reconciliation business command.")
    value = _record_value(state, command, read_blob)
    result = copy.deepcopy(state)
    current = result.setdefault("reconciliation", {"schema": SCHEMA, "records": []})
    _need(current.get("schema") == SCHEMA and isinstance(current.get("records"), list), "Unsupported reconciliation records.")
    old = next((row for row in current["records"] if row["id"] == value["id"]), None)
    if old is not None:
        _need(old == value, "This original bridge result ID already names another complete result.")
        return result, copy.deepcopy(old)
    _need(len(current["records"]) < 10000, "Retained reconciliation record capacity reached.")
    current["records"].append(value)
    return result, copy.deepcopy(value)


def validate_reconciliation(state, read_blob):
    current = state.get("reconciliation")
    if current is None:
        return {"records": 0, "files": 0, "bytes": 0}
    _need(current.get("schema") == SCHEMA and isinstance(current.get("records"), list), "Unsupported reconciliation records.")
    seen, files, total = set(), 0, 0
    for row in current["records"]:
        _need(row["id"] not in seen, "Duplicate original reconciliation result.")
        seen.add(row["id"])
        body = {key: copy.deepcopy(row[key]) for key in ("id", "kind", "inputSha256", "resultSha256", "files", "captureIds", "nativeWorkspaceId")}
        checked = _record_value(state, {"requestId": row["requestId"], "actor": row["actor"],
                                      "at": row["at"], "body": body}, read_blob)
        _need(checked == row, "Retained original reconciliation record changed.")
        files += len(row["files"])
        total += row["bytes"]
    return {"records": len(seen), "files": files, "bytes": total}


def reconciliation_view(state, read_blob):
    validation = validate_reconciliation(state, read_blob)
    return {"schema": SCHEMA, **validation, "records": copy.deepcopy(
        state.get("reconciliation", {}).get("records", []))}



def restore_input(state, record_id, package_directory, destination, request_id):
    """Persist this exact input before calling restore_native_package."""
    _uuid(request_id)
    records = state.get("reconciliation", {}).get("records", [])
    matches = [row for row in records if row["id"] == record_id]
    _need(len(matches) == 1, "Choose one saved complete native package record.")
    return {"schema": INPUT_SCHEMA, "operation": "restore", "nativeWorkspaceId": matches[0]["nativeWorkspaceId"],
            "body": {"recordId": record_id, "packageDirectory": str(Path(package_directory).absolute()),
                     "destination": str(Path(destination).absolute()), "requestId": request_id}}


def restore_native_package(state, record_id, read_blob, package_directory, destination, *, request_id):
    """Recreate exact complete files and invoke the maintained native receiver.

    The caller persists restore_input first and retains the full return before
    its Highway CAS. No source warehouse is opened or reconstructed here.
    """
    original = restore_input(state, record_id, package_directory, destination, request_id)
    record = next(row for row in state["reconciliation"]["records"] if row["id"] == record_id)
    body = {key: copy.deepcopy(record[key]) for key in
            ("id", "kind", "inputSha256", "resultSha256", "files", "captureIds", "nativeWorkspaceId")}
    _need(_record_value(state, {"body": body, "requestId": record["requestId"],
                              "at": record["at"], "actor": record["actor"]}, read_blob) == record,
          "Retained native package record changed.")
    manifest = _native_package(record["files"], read_blob, record["nativeWorkspaceId"])
    root = _private_directory(package_directory)
    target = Path(os.path.abspath(os.fspath(destination)))
    _need(target.resolve() == target and root != target and root not in target.parents
          and target not in root.parents, "Select distinct private package and working warehouse directories.")
    lock_path = root.parent / ("." + root.name + ".reconciliation-receiving.lock")
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        info = os.fstat(fd)
        _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077,
              "Original receiving lock is not private.")
        fcntl.flock(fd, fcntl.LOCK_EX)
        # The immutable intent prevents a changed target or request from
        # repurposing partially restored files after interruption.
        _retain(root.parent / ("." + root.name + ".reconciliation-receiving.json"), canonical(original))
        entries = [row for row in record["files"] if row["path"].startswith("package/")]
        allowed = {row["path"][8:] for row in entries}
        partials = {str(Path(row["path"][8:]).parent / (".reconciliation-" + row["sha256"] + ".partial"))
                    for row in entries}
        for path in root.rglob("*"):
            relative = path.relative_to(root).as_posix()
            _need(not path.is_symlink() and
                  (path.is_dir() and any(name.startswith(relative + "/") for name in allowed)
                   or path.is_file() and relative in allowed | partials),
                  "The selected package directory contains unrelated or unsafe files.")
        for descriptor in entries:
            path = root / descriptor["path"][8:]
            parent = root
            for part in path.relative_to(root).parts[:-1]:
                parent = _private_directory(parent / part)
            _retain(path, _read(descriptor, read_blob))
        from stellar_forge_buyer.reconciliation.package import inspect_package, receive_package
        selected = next(row for row in entries if row["path"] == "package/manifest.json")
        inspected = inspect_package(root, expected_manifest_sha256=selected["sha256"])
        _need(inspected["manifest"]["workspace_id"] == record["nativeWorkspaceId"],
              "Restored native workspace identity changed.")
        result = receive_package(root, target, expected_manifest_sha256=selected["sha256"],
                                 expected_workspace_id=record["nativeWorkspaceId"])
        files = [copy.deepcopy(row) for row in record["files"] if row["path"] not in ("input.json", "result.json")]
        return {"schema": RESULT_SCHEMA, "operation": "restore", "inputSha256": _sha(canonical(original)),
                "nativeWorkspaceId": record["nativeWorkspaceId"], "result": result,
                "bindings": copy.deepcopy(record["bindings"]), "files": files}
    finally:
        os.close(fd)


class ReconciliationAdapter:
    """Borrow an existing native owner; the caller retains intent, return and lock.

    The server must serialize dispatch calls with its own native-operation lock,
    persist input() BEFORE dispatch(), save the full result and every returned
    file BEFORE reconciliation.record, and close its native owner after handlers.
    """

    def __init__(self, native_workspace, state_provider, read_blob, directory):
        from stellar_forge_buyer.reconciliation.model import Reconciliation
        self.workspace = native_workspace
        self.native = Reconciliation(native_workspace)
        self.state_provider = state_provider
        self.read_blob = read_blob
        self.directory = Path(directory).absolute()
        _need(self.directory.resolve() == self.directory and self.directory.is_dir()
              and not self.directory.is_symlink() and not self.directory.stat().st_mode & 0o077,
              "Use the caller's existing private real bridge directory.")
        _need(self.directory != Path(native_workspace.directory)
              and self.directory not in Path(native_workspace.directory).parents
              and Path(native_workspace.directory) not in self.directory.parents,
              "Keep native export files separate from the working warehouse.")
        self.retained_files = {}
        for name in ("editions", "exports", "receiving"):
            _private_directory(self.directory / name)

    def input(self, operation, body):
        _need(isinstance(operation, str) and isinstance(body, dict), "Choose a complete bridge operation.")
        return {"schema": INPUT_SCHEMA, "operation": operation, "body": copy.deepcopy(body),
                "nativeWorkspaceId": self.workspace.identity()["workspace_id"]}

    def _file(self, path, name, expected=None):
        name = _path(name)
        path = Path(path)
        _need(path.is_absolute() and path.resolve() == path, "Native file path must remain canonical.")
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            before = os.fstat(fd)
            _need(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_FILE, "Complete native file exceeds 64 MiB.")
            checksum, length = hashlib.sha256(), 0
            with os.fdopen(fd, "rb", closefd=False) as stream:
                while chunk := stream.read(1024 * 1024):
                    length += len(chunk)
                    _need(length <= MAX_FILE, "Complete native file exceeds 64 MiB.")
                    checksum.update(chunk)
            after = os.fstat(fd)
            _need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                  (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                  and length == before.st_size, "Native file changed while retaining it.")
        finally:
            os.close(fd)
        descriptor = {"path": name, "bytes": length, "sha256": checksum.hexdigest(),
                      "mediaType": "application/json" if name.endswith(".json") else
                      "application/x-ndjson" if name.endswith(".jsonl") else
                      "text/plain" if name.endswith((".md", ".csv")) else "application/octet-stream"}
        if expected is not None:
            _need(descriptor["bytes"] == expected["bytes"] and descriptor["sha256"] == expected["sha256"],
                  "Original native file descriptor changed.")
        old = self.retained_files.get(name)
        _need(old is None or old["descriptor"] == descriptor, "Retained member name conflict.")
        self.retained_files[name] = {"descriptor": descriptor, "localPath": str(path)}
        _need(len(self.retained_files) <= MAX_FILES and sum(
            row["descriptor"]["bytes"] for row in self.retained_files.values()) <= MAX_TOTAL,
            "Complete native handover exceeds 256 MiB.")
        return descriptor

    def _resolve(self, identity):
        for item in self.retained_files.values():
            if item["descriptor"]["sha256"] == identity:
                descriptor = item["descriptor"]
                path = Path(item["localPath"])
                current = self._file(path, descriptor["path"], descriptor)
                raw = _local_bytes(path, current)
                _need(_sha(raw) == identity, "Native source changed after inspection.")
                return raw
        return self.read_blob(identity)

    def _selection(self, selection, native_source, rows, edition_id=None, review_id=None):
        _fields(selection, ("captureId", "layerId", "formId", "objectIdColumn", "fieldMap"),
                ("sourceKind", "proposalId", "proposalSha256"))
        state = self.state_provider()
        capture = _capture(state, selection["captureId"])
        forms = [row for row in state["forms"] if row["id"] == selection["formId"]]
        _need(len(forms) == 1, "Original form edition is unavailable.")
        binding = {**copy.deepcopy(selection), "captureSha256": capture["manifest"]["sha256"],
                   "formSha256": forms[0]["sha256"], "rows": rows,
                   "rowCount": native_source["row_count"], "manifestSha256": native_source["manifest_sha256"],
                   "sourceBindingSha256": native_source["source_binding_sha256"]}
        if edition_id:
            binding["editionId"] = edition_id
        if review_id:
            binding["reviewId"] = review_id
        validate_binding(state, binding, self._resolve)
        return binding

    def _edition(self, binding):
        _hex(binding.get("editionId"))
        edition = self.workspace.edition(binding["editionId"])
        _need(edition["manifest_sha256"] == binding["manifestSha256"]
              and edition["source"]["source_binding_sha256"] == binding["sourceBindingSha256"],
              "Original native edition/source identity changed.")
        native_rows = edition["source"]["native"]["outputs"]["dataset.jsonl"]
        _need(native_rows["sha256"] == binding["rows"]["sha256"]
              and native_rows["bytes"] == binding["rows"]["bytes"],
              "The original native edition has different retained rows.")
        exported = self.workspace.export_source(binding["editionId"], self.directory / "editions" / binding["editionId"])
        for item in exported["files"]:
            self._file(item["path"], "editions/" + binding["editionId"] + "/" + item["name"], item)
        rows = self.retained_files["editions/" + binding["editionId"] + "/dataset.jsonl"]["descriptor"]
        value = {**copy.deepcopy(binding), "rows": rows}
        validate_binding(self.state_provider(), value, self._resolve)
        return value

    def _bindings(self, values, expected=None):
        _need(isinstance(values, list) and len(values) <= 4, "Supply the complete selected native edition bindings.")
        out, seen = [], set()
        for value in values:
            _need(value.get("editionId") not in seen, "Duplicate original edition binding.")
            seen.add(value.get("editionId"))
            out.append(self._edition(value))
        if expected is not None:
            _need(seen == set(expected), "Bindings must cover exactly the selected native source and target editions.")
        return out

    def _expected_editions(self, kind, value):
        if kind == "pairs":
            return {value["definition"]["source_edition"], value["definition"]["target_edition"]}
        if kind == "run":
            pair = self.native.pair(value["pair_id"], value["expected_revision"])
            return {pair["definition"]["source_edition"], pair["definition"]["target_edition"]}
        run = self.native.run(value["run_id"])
        result = {run["source_edition"], run["target_edition"]}
        if kind == "report" and value.get("before_run_id") is not None:
            previous = self.native.run(value["before_run_id"])
            result.update((previous["source_edition"], previous["target_edition"]))
        return result

    def _report_editions(self, report):
        result = {report["source_edition"], report["target_edition"]}
        if report.get("before_run_id") is not None:
            previous = self.native.run(report["before_run_id"])
            result.update((previous["source_edition"], previous["target_edition"]))
        return result

    def _request(self, body, workspace_id):
        value = copy.deepcopy(body)
        identity = _uuid(value.pop("requestId"))
        _need("request_id" not in value and "workspace_id" not in value, "The bridge owns native request/workspace identity mapping.")
        return {**value, "request_id": identity.replace("-", ""), "workspace_id": workspace_id}

    def _package(self, directory, expected=None):
        from stellar_forge_buyer.reconciliation.package import inspect_package
        inspected = inspect_package(directory, expected_manifest_sha256=expected)
        for item in inspected["files"]:
            self._file(item["path"], "package/" + item["name"], item)
        return inspected

    def dispatch(self, operation, body):
        original = self.input(operation, body)
        workspace_id = original["nativeWorkspaceId"]
        self.retained_files = {}
        value = copy.deepcopy(body)
        bindings = []
        result = None
        if operation == "status":
            _fields(value, ())
            result = self.native.status()
        elif operation == "inspect-delivery":
            _fields(value, ("reportPath",))
            result = self.workspace.inspect_delivery(value["reportPath"])
        elif operation == "review-import":
            _fields(value, ("requestId", "reportPath", "selection"), ("columns", "keys"))
            _uuid(value["requestId"])
            inspected = self.workspace.inspect_delivery(value["reportPath"])
            # Use the original validated report resolver, never manufacture an
            # SF88/SF100 report around County feature JSON.
            delivery, _, source = self.workspace._delivery(value["reportPath"])
            for name in delivery.file_names():
                handle = delivery.file(name)
                self._file(handle.expected_destination, "delivery/" + name, delivery.native["outputs"].get(name) or delivery.native["archives"][name])
            self._file(value["reportPath"], "delivery/input-report.json",
                       {"bytes": Path(value["reportPath"]).stat().st_size, "sha256": source["input_report_sha256"]})
            rows = self.retained_files["delivery/dataset.jsonl"]["descriptor"]
            binding = self._selection(value["selection"], source, rows)
            result = self.workspace.review_import(value["reportPath"], value.get("columns"), value.get("keys"))
            _need(result["manifest_sha256"] == binding["manifestSha256"]
                  and result["source_binding_sha256"] == binding["sourceBindingSha256"],
                  "Original reviewed delivery changed.")
            binding["reviewId"] = result["review_id"]
            bindings = [binding]
        elif operation == "import":
            _fields(value, ("requestId", "binding"))
            _uuid(value["requestId"])
            binding = copy.deepcopy(value["binding"])
            validate_binding(self.state_provider(), binding, self.read_blob)
            review_id = _hex(binding.get("reviewId"))
            reviews = [row for row in self.workspace.reviews()["reviews"] if row["review_id"] == review_id]
            _need(len(reviews) == 1 and reviews[0]["manifest_sha256"] == binding["manifestSha256"]
                  and reviews[0]["source_binding_sha256"] == binding["sourceBindingSha256"],
                  "The selected original native import review changed.")
            result = self.workspace.import_review(review_id)
            binding["editionId"] = result["edition_id"]
            bindings = [self._edition(binding)]
        elif operation in ("review-pair", "save-pair"):
            required = ("definition", "bindings") if operation == "review-pair" else (
                "requestId", "definition", "bindings", "expected_revision", "review_sha256")
            _fields(value, required)
            definition = value["definition"]
            bindings = self._bindings(value.pop("bindings"), [definition["source_edition"], definition["target_edition"]])
            result = self.native.review(definition) if operation == "review-pair" else self.native.perform(
                "pairs", self._request(value, workspace_id))
        elif operation in ("run", "decision", "report"):
            required = {"run": ("requestId", "pair_id", "expected_revision", "definition_sha256", "bindings"),
                        "decision": ("requestId", "run_id", "expected_revision", "subject", "outcome", "actor", "reason", "bindings"),
                        "report": ("requestId", "run_id", "expected_revision", "bindings")}[operation]
            _fields(value, required, ("before_run_id",) if operation == "report" else ())
            bindings = self._bindings(value.pop("bindings"), self._expected_editions(operation, value))
            result = self.native.perform(operation, self._request(value, workspace_id))
        elif operation in ("request", "resume"):
            _fields(value, ("requestId",), ("bindings",))
            identity = _uuid(value["requestId"]).replace("-", "")
            prior = self.native.request(identity)
            _need(prior["body"]["workspace_id"] == workspace_id, "Original native request belongs to another workspace.")
            if operation == "resume":
                bindings = self._bindings(value.get("bindings", []), self._expected_editions(prior["kind"], prior["body"]))
                _need(bindings, "Retain the original edition source bindings before native resume.")
                result = self.native.resume(identity, workspace_id)
            else:
                result = prior
        elif operation == "read":
            _fields(value, ("kind", "id"), ("revision",))
            _need(value["kind"] in ("pair", "run", "report"), "Unknown native record kind.")
            result = self.native.pair(value["id"], value.get("revision")) if value["kind"] == "pair" else getattr(self.native, value["kind"])(value["id"])
        elif operation == "page":
            _fields(value, ("kind",), ("id", "offset", "limit", "pair_id", "run_id", "side", "status",
                                     "group_id", "category", "duplicates"))
            kind = value.pop("kind")
            if kind in ("pairs", "runs", "reports", "operations"):
                result = self.native.catalog(kind, **value)
            else:
                identity = value.pop("id", None)
                if kind in ("groups", "rows"):
                    result = self.native.grid(identity, kind, **value)
                elif kind in ("decisions", "changes"):
                    result = getattr(self.native, kind)(identity, **value)
                else:
                    raise ValueError("Unknown original native page kind.")
        elif operation == "row":
            _fields(value, ("runId", "side", "row"))
            result = self.native.row(value["runId"], value["side"], value["row"])
        elif operation == "export":
            _fields(value, ("requestId", "report_id", "bindings"))
            request_id = _uuid(value["requestId"]).replace("-", "")
            report = self.native.report(value["report_id"])
            bindings = self._bindings(value["bindings"], self._report_editions(report))
            from stellar_forge_buyer.reconciliation.package import export_report
            target = self.directory / "exports" / request_id
            result = export_report(self.workspace, {"request_id": request_id, "report_id": value["report_id"]}, target)
            self._package(target, result["manifest_sha256"])
        elif operation == "receive":
            _fields(value, ("requestId", "packageDirectory", "manifestSha256", "bindings"))
            request_id = _uuid(value["requestId"]).replace("-", "")
            bindings = self._bindings(value["bindings"])
            inspected = self._package(value["packageDirectory"], _hex(value["manifestSha256"]))
            manifest = inspected["manifest"]
            _need(manifest["workspace_id"] == workspace_id, "Receive the selected original native workspace package.")
            _need({row["editionId"] for row in bindings} == self._report_editions(inspected["report"]),
                  "Original receiving package lacks exact captured source linkage.")
            from stellar_forge_buyer.reconciliation.package import receive_package
            destination = self.directory / "receiving" / request_id
            result = receive_package(value["packageDirectory"], destination,
                expected_manifest_sha256=value["manifestSha256"], expected_workspace_id=workspace_id)
        else:
            raise ValueError("Unknown original reconciliation operation: " + str(operation))
        _need(self.workspace.identity()["workspace_id"] == workspace_id, "Original native workspace changed.")
        files = [row["descriptor"] for _, row in sorted(self.retained_files.items())]
        returned = {"schema": RESULT_SCHEMA, "operation": operation, "inputSha256": _sha(canonical(original)),
                    "nativeWorkspaceId": workspace_id, "result": result, "bindings": bindings, "files": files}
        _need(len(canonical(returned)) <= MAX_METADATA, "Complete native result exceeds the metadata limit.")
        return returned
