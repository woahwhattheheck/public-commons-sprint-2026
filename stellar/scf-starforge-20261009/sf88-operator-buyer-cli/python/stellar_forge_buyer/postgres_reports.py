"""Export both complete PostgreSQL periods and every keyed row change."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal
import csv
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile
import zipfile

from .dataset_semantics import same_json
from .postgres_delivery import (
    DatasetMapping, WarehouseError, _identifier, _driver, _database_row,
    _ORDINAL, _ORIGINAL, _SEMANTICS,
)
from .storage import digest, dump, parse, private_directory, read, sync_directory, unique_object

SELECTION_SCHEMA = "stellar-forge.postgres-period-selection.v1"
REPORT_SCHEMA = "stellar-forge.postgres-period-report.v1"
BUNDLE_SCHEMA = "stellar-forge.postgres-period-bundle.v1"
_HEX = re.compile(r"[a-f0-9]{64}")
_ID = re.compile(r"[a-f0-9]{32}")
_META_LIMIT = 8 * 1024 * 1024
_ENCODING = "Each CSV cell is one JSON value, including headers; parse CSV then JSON per cell."


def need(value, code):
    if not value:
        raise WarehouseError(code)


def selection(value):
    keys = {"schema", "previous_version", "current_version", "previous_label", "current_label", "title"}
    need(isinstance(value, dict) and set(value) == keys and value["schema"] == SELECTION_SCHEMA,
         "DATASET_PG_REPORT_SELECTION_INVALID")
    for key in ("previous_version", "current_version"):
        need(isinstance(value[key], str) and _HEX.fullmatch(value[key]),
             "DATASET_PG_REPORT_VERSION_REQUIRED")
    for key in ("previous_label", "current_label", "title"):
        text = value[key]
        need(isinstance(text, str) and text.strip() and len(text.encode()) <= 1000
             and all(ord(char) >= 32 and ord(char) != 127 for char in text),
             "DATASET_PG_REPORT_LABEL_REQUIRED")
    return dict(value)


def _json(value):
    """Retain finite Decimal tokens and original scalar types in exported JSON."""
    if isinstance(value, Decimal):
        need(value.is_finite(), "DATASET_PG_REPORT_NUMBER_INVALID")
        return str(value)
    if isinstance(value, (date, datetime)):
        return json.dumps(value.isoformat(), ensure_ascii=False)
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + _json(item)
                              for key, item in value.items()) + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_json(item) for item in value) + "]"
    if isinstance(value, float):
        need(math.isfinite(value), "DATASET_PG_REPORT_NUMBER_INVALID")
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _raw_json(value):
    return (_json(value) + "\n").encode()


def _original(raw):
    return json.loads(raw, parse_float=Decimal, object_pairs_hook=unique_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))


def _meaning_comparison(before, after):
    def columns(version):
        meanings = {item["name"]: item for item in
                    (version.get("semantic_dictionary") or {}).get("columns", [])}
        keys = set(version["mapping"]["keys"])
        return {item["source"]: {"sql_column": item["column"], "sql_type": item["type"],
                  "nullable": item["nullable"], "receiving_key": item["source"] in keys,
                  "meaning": meanings.get(item["source"])}
                for item in version["mapping"]["columns"]}
    left, right = columns(before), columns(after)
    first, second = before.get("semantics") or {}, after.get("semantics") or {}
    return {"schema": "stellar-forge.python-semantic-comparison.v1",
            "before_version": before["version_id"], "after_version": after["version_id"],
            "before": before.get("semantics"), "after": after.get("semantics"),
            "definition_changed": first.get("definition_sha256") != second.get("definition_sha256"),
            "capture_changed": first.get("capture_manifest_sha256") != second.get("capture_manifest_sha256"),
            "mapping_changed": not same_json(before["mapping"], after["mapping"]),
            "before_mapping": before["mapping"], "after_mapping": after["mapping"],
            "columns": [{"source": name, "before": left.get(name), "after": right.get(name)}
                        for name in sorted(set(left) | set(right))
                        if not same_json(left.get(name), right.get(name))],
            "before_document": before.get("semantic_dictionary"),
            "after_document": after.get("semantic_dictionary")}


def _comparison(warehouse, before, after):
    first = DatasetMapping.from_record(before["mapping"])
    second = DatasetMapping.from_record(after["mapping"])
    need(first.keys and first.keys == second.keys, "DATASET_PG_REPORT_SAME_NATIVE_KEYS_REQUIRED")
    left, right = ({column.source: column for column in mapping.columns}
                   for mapping in (first, second))
    need(all(left[key].type == right[key].type for key in first.keys),
         "DATASET_PG_REPORT_NATIVE_KEY_TYPES_CHANGED")
    joins = [f"a.{_identifier(left[key].column)} = b.{_identifier(right[key].column)}"
             for key in first.keys]
    different = []
    for source in sorted(set(left) | set(right)):
        old, new = left.get(source), right.get(source)
        if old is None or new is None or old.type != new.type:
            different.append("true")
            continue
        suffix = "::text" if old.type == "json" else ""
        different.append(f"a.{_identifier(old.column)}{suffix} IS DISTINCT FROM "
                         f"b.{_identifier(new.column)}{suffix}")
    changed = " OR ".join("(" + term + ")" for term in different)
    old, new = f"a.{_identifier(_ORDINAL)}", f"b.{_identifier(_ORDINAL)}"
    kind = (f"CASE WHEN {old} IS NULL THEN 'ADDED' WHEN {new} IS NULL THEN 'REMOVED' "
            f"WHEN ({changed}) THEN 'CHANGED' ELSE 'UNCHANGED' END")
    joined = (f"FROM {warehouse._table(before['table'])} a FULL OUTER JOIN "
              f"{warehouse._table(after['table'])} b ON " + " AND ".join(joins))
    order = ",".join(f"COALESCE(a.{_identifier(left[key].column)},"
                     f"b.{_identifier(right[key].column)})" for key in first.keys)
    changed_rows = (f"SELECT {kind},{old},{new},a.{_identifier(_ORIGINAL)}::text,"
                    f"b.{_identifier(_ORIGINAL)}::text {joined} "
                    f"WHERE {old} IS NULL OR {new} IS NULL OR ({changed}) ORDER BY {order}")
    counts = f"SELECT {kind} AS kind,count(*) {joined} GROUP BY 1"
    return {"counts": counts, "changes": changed_rows, "keys": list(first.keys),
            "field_changes": [name for name in sorted(set(left) | set(right))
                              if name not in left or name not in right or left[name].type != right[name].type]}


@contextmanager
def _server_rows(cursor, query):
    # psycopg's regular cursor retains the full result on the client. The
    # original connection's named cursor fetches small batches in one snapshot.
    _, _, tuple_row = _driver()
    with cursor.connection.cursor(name="period_" + secrets.token_hex(12),
                                   row_factory=tuple_row) as reader:
        reader.itersize = 16
        reader.execute(query)
        def rows():
            while batch := reader.fetchmany(16):
                yield from batch
        yield rows()


class _Bundle:
    def __init__(self, archive):
        self.archive, self.files = archive, []

    def stream(self, name, chunks, *, rows=None, encoding=None):
        checksum, size = hashlib.sha256(), 0
        with self.archive.open(name, "w", force_zip64=True) as target:
            for raw in chunks:
                need(isinstance(raw, bytes), "DATASET_PG_REPORT_BYTES_REQUIRED")
                target.write(raw)
                checksum.update(raw)
                size += len(raw)
        item = {"path": name, "bytes": size, "sha256": checksum.hexdigest()}
        if rows is not None:
            item["rows"] = rows
        if encoding is not None:
            item["encoding"] = encoding
        self.files.append(item)
        return item

    def bytes(self, name, raw):
        return self.stream(name, (raw,))

    def json(self, name, value):
        return self.bytes(name, _raw_json(value))


def _csv_line(values):
    output = io.StringIO(newline="")
    csv.writer(output, lineterminator="\n").writerow([_json(value) for value in values])
    return output.getvalue().encode()


def _export_period(bundle, cursor, warehouse, version, prefix):
    mapping = DatasetMapping.from_record(version["mapping"])
    table, ordinal = warehouse._table(version["table"]), _identifier(_ORDINAL)
    query = f"SELECT {_identifier(_ORIGINAL)}::text FROM {table} ORDER BY {ordinal}"
    count = 0
    def original_rows():
        nonlocal count
        with _server_rows(cursor, query) as rows:
            for row in rows:
                count += 1
                yield (row[0] + "\n").encode()
    saved = bundle.stream(prefix + "/dataset.jsonl", original_rows(), rows=version["row_count"])
    need(count == version["row_count"] and all(saved[key] == version["jsonl"][key]
         for key in ("bytes", "sha256")), "DATASET_PG_REPORT_ORIGINAL_ROWS_CHANGED")
    typed_query = f"SELECT row_to_json(t)::text FROM {table} t ORDER BY {ordinal}"
    typed_count = 0
    def typed_rows():
        nonlocal typed_count
        yield _csv_line([_ORDINAL, *(column.column for column in mapping.columns)])
        with _server_rows(cursor, typed_query) as rows:
            for row in rows:
                raw = _original(row[0])
                typed = _database_row(row[0], mapping)
                typed_count += 1
                yield _csv_line([raw[_ORDINAL], *(typed[column.column] for column in mapping.columns)])
    bundle.stream(prefix + "/columns.csv", typed_rows(), rows=version["row_count"], encoding=_ENCODING)
    need(typed_count == version["row_count"], "DATASET_PG_REPORT_ROW_COUNT_CHANGED")
    manifest = warehouse._retained_manifest(cursor, version)
    bundle.bytes(prefix + "/manifest.json", manifest)
    bundle.json(prefix + "/mapping.json", version["mapping"])
    bundle.json(prefix + "/edition.json", version)
    if version.get("semantics") is not None:
        cursor.execute(f"SELECT document FROM {warehouse._table(_SEMANTICS)} WHERE version_id=%s",
                       (version["version_id"],))
        raw = bytes(cursor.fetchone()[0])
        expected = parse(manifest)["outputs"]["semantics.json"]
        need(len(raw) == expected["bytes"] and digest(raw) == expected["sha256"],
             "DATASET_PG_REPORT_DICTIONARY_CHANGED")
        bundle.bytes(prefix + "/semantics.json", raw)
    return {"original_rows": query, "typed_rows": typed_query}


def _export_changes(bundle, cursor, query, expected):
    def changes():
        with _server_rows(cursor, query) as rows:
            for kind, previous, current, before, after in rows:
                yield {"kind": kind, "previous_row": previous, "current_row": current,
                       "before": _original(before) if previous is not None else None,
                       "after": _original(after) if current is not None else None}
    count = 0
    def jsonl():
        nonlocal count
        for row in changes():
            count += 1
            yield _raw_json(row)
    bundle.stream("changes.jsonl", jsonl(), rows=expected)
    need(count == expected, "DATASET_PG_REPORT_CHANGE_COUNT_CHANGED")
    count = 0
    def csv_rows():
        nonlocal count
        yield _csv_line(["kind", "previous_row", "current_row", "before", "after"])
        for row in changes():
            count += 1
            yield _csv_line(list(row.values()))
    bundle.stream("changes.csv", csv_rows(), rows=expected, encoding=_ENCODING)
    need(count == expected, "DATASET_PG_REPORT_CHANGE_COUNT_CHANGED")

def _html_report(report, meanings):
    def escape(value):
        return html.escape(str(value), quote=True)
    chosen, totals = report["selection"], report["totals"]
    facts = [
        ("Previous period", chosen["previous_label"]),
        ("Current period", chosen["current_label"]),
        ("Previous rows", report["previous"]["row_count"]),
        ("Current rows", report["current"]["row_count"]),
        ("Added rows", totals["ADDED"]), ("Removed rows", totals["REMOVED"]),
        ("Changed rows", totals["CHANGED"]), ("Unchanged rows", totals["UNCHANGED"]),
        ("Source keys", ", ".join(report["keys"])),
        ("Generated at", report["generated_at"]),
    ]
    fact_rows = "".join("<tr><th>" + escape(key) + "</th><td>" + escape(value) + "</td></tr>"
                        for key, value in facts)
    meaning_rows = "".join(
        "<tr><th>" + escape(row["source"]) + "</th><td><pre>" +
        escape(_json(row["before"])) + "</pre></td><td><pre>" +
        escape(_json(row["after"])) + "</pre></td></tr>" for row in meanings["columns"])
    if not meaning_rows:
        meaning_rows = '<tr><td colspan="3">Field definitions and receiving mappings are unchanged.</td></tr>'
    return ("""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>""" + escape(chosen["title"]) + """</title><style>
*{box-sizing:border-box}body{font:15px/1.55 system-ui,sans-serif;color:#202124;background:#fff;margin:0}
main{max-width:1120px;margin:auto;padding:40px 24px}h1{font-size:28px;line-height:1.25}h2{margin-top:32px;font-size:20px}
p{max-width:90ch}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #d1d3d5;padding:10px;text-align:left;vertical-align:top}
th{background:#f3f4f4;font-weight:600}pre,code{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}
.note{color:#5b5e62}a{color:#202124;text-underline-offset:3px}.scroll{overflow:auto}
@media print{main{max-width:none;padding:0}tr{break-inside:avoid}h2{break-after:avoid}}
</style></head><body><main><p class="note">STELLAR FORGE · POSTGRESQL PERIOD REPORT</p><h1>""" +
        escape(chosen["title"]) + "</h1><table><tbody>" + fact_rows + """</tbody></table>
<h2>Complete data</h2><p>This bundle contains every original received row from both selected editions,
typed database columns, every added, removed and changed row, and each retained source manifest,
dictionary and mapping. All database reads used the same read-only repeatable-read transaction.</p>
<ul><li><a href="previous/dataset.jsonl">Previous original rows</a> ·
<a href="previous/columns.csv">Previous typed columns</a></li><li>
<a href="current/dataset.jsonl">Current original rows</a> ·
<a href="current/columns.csv">Current typed columns</a></li><li>
<a href="changes.jsonl">All row changes as JSONL</a> ·
<a href="changes.csv">All row changes as CSV</a></li><li>
<a href="meaning-changes.json">Complete field-meaning comparison</a> ·
<a href="report.json">Machine-readable report</a> · <a href="README.md">File and encoding guide</a></li></ul>
<p class="note">CSV cells use JSON encoding so database nulls, empty strings, exact numbers and strings
remain distinguishable. Read the guide before importing them into another application.</p>
<h2>Field meanings and mappings</h2><div class="scroll"><table><thead><tr><th>Source field</th>
<th>Previous definition</th><th>Current definition</th></tr></thead><tbody>""" +
        meaning_rows + "</tbody></table></div></main></body></html>\n").encode()


def _guide(report):
    chosen = report["selection"]
    return (
        "# " + chosen["title"] + "\n\n"
        "Previous period: " + chosen["previous_label"] + "\n\n"
        "Current period: " + chosen["current_label"] + "\n\n"
        "Open report.html for the report and report.json for the machine-readable selection and totals.\n\n"
        "## Complete contents\n\n"
        "Each previous/ and current/ directory contains every original received dataset.jsonl row, "
        "typed columns.csv, the full edition.json, reviewed mapping.json, exact retained manifest.json "
        "and, when available, exact original semantics.json. The exported original JSONL bytes are "
        "checked against the immutable edition's original byte count and SHA-256.\n\n"
        "changes.jsonl and changes.csv contain every ADDED, REMOVED and CHANGED row, with the original "
        "before/after objects and retained row ordinals. A missing side of the join is null. "
        "UNCHANGED rows remain in their full period datasets. The comparison joins identical ordered "
        "reviewed source keys with matching SQL key types. Aliases may differ. Adding/removing a source "
        "field or changing its SQL type marks a matched row CHANGED. Other fields use PostgreSQL "
        "IS DISTINCT FROM; explicitly mapped json scalars compare their retained JSON text.\n\n"
        "meaning-changes.json compares full original field meanings and SQL mappings. A changed "
        "dictionary or capture identity is shown separately from changed row values.\n\n"
        "## Exact CSV encoding\n\n" + _ENCODING + "\n\n"
        "For example, the decoded CSV cell null is a database NULL; \"\" is an empty string; "
        "\"null\" is the literal string null. Date and timestamp values are ISO strings. "
        "Decimal values are JSON number tokens; parse them with an exact decimal reader. Strings "
        "are always JSON-quoted, including formula-like values and column names. Python example:\n\n"
        "    import csv, json\n"
        "    from decimal import Decimal\n"
        "    with open('current/columns.csv', newline='', encoding='utf-8') as source:\n"
        "        rows = ([json.loads(cell, parse_float=Decimal) for cell in row]\n"
        "                for row in csv.reader(source))\n"
        "        headers = next(rows)\n"
        "        for row in rows:\n"
        "            record = dict(zip(headers, row))\n\n"
        "## Receiving and reproducibility\n\n"
        "comparison.sql records the exact SQL queries over the retained original tables. Every database "
        "read in this report occurred in one read-only repeatable-read transaction on the selected "
        "warehouse. Rows are streamed through named cursors and written directly into the ZIP. "
        "manifest.json records the byte count and SHA-256 of every other file.\n\n"
        "The report preserves the original selected edition IDs, labels and request ID. Reopen the "
        "saved operator request to retrieve this same complete report after a lost response. "
        "The source Central workspace and its complete native captures remain part of the original "
        "commissioning delivery; their approved warehouse projections are bound by each retained manifest.\n"
    ).encode()


def _write_archive(warehouse, target, request_id, chosen, selection_sha):
    with warehouse._transaction(readonly=True) as cursor:
        previous = warehouse._version(cursor, chosen["previous_version"], include_semantics=True)
        current = warehouse._version(cursor, chosen["current_version"], include_semantics=True)
        need(all(version["semantics_status"] != "SOURCE_REQUIRED" for version in (previous, current)),
             "DATASET_PG_REIMPORT_ORIGINAL_DICTIONARY_REQUIRED")
        queries = _comparison(warehouse, previous, current)
        cursor.execute(queries["counts"])
        totals = {key: 0 for key in ("ADDED", "REMOVED", "CHANGED", "UNCHANGED")}
        totals.update({kind: count for kind, count in cursor.fetchall()})
        need(totals["REMOVED"] + totals["CHANGED"] + totals["UNCHANGED"] == previous["row_count"]
             and totals["ADDED"] + totals["CHANGED"] + totals["UNCHANGED"] == current["row_count"],
             "DATASET_PG_REPORT_JOIN_COUNT_CHANGED")
        cursor.execute("SELECT transaction_timestamp()")
        timestamp = cursor.fetchone()[0].isoformat()
        report = {
            "schema": REPORT_SCHEMA, "request_id": request_id, "selection": chosen,
            "selection_sha256": selection_sha, "generated_at": timestamp,
            "warehouse_id": warehouse.warehouse_id, "warehouse_schema": warehouse.schema,
            "snapshot": "READ ONLY REPEATABLE READ", "keys": queries["keys"], "totals": totals,
            "schema_changed_fields": queries["field_changes"],
            "previous": {key: previous[key] for key in
                         ("version_id", "row_count", "jsonl", "manifestSha256", "sourceBindingSha256")},
            "current": {key: current[key] for key in
                        ("version_id", "row_count", "jsonl", "manifestSha256", "sourceBindingSha256")},
            "csv_encoding": _ENCODING,
        }
        meanings = _meaning_comparison(previous, current)
        report["meanings"] = {key: meanings[key] for key in
                             ("definition_changed", "capture_changed", "mapping_changed")}
        report["meanings"]["changed_columns"] = len(meanings["columns"])
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=6, allowZip64=True) as archive:
            bundle = _Bundle(archive)
            before_queries = _export_period(bundle, cursor, warehouse, previous, "previous")
            after_queries = _export_period(bundle, cursor, warehouse, current, "current")
            _export_changes(bundle, cursor, queries["changes"],
                            totals["ADDED"] + totals["REMOVED"] + totals["CHANGED"])
            bundle.json("meaning-changes.json", meanings)
            bundle.json("report.json", report)
            bundle.bytes("report.html", _html_report(report, meanings))
            bundle.bytes("README.md", _guide(report))
            query_source = "\n\n".join("-- " + label + "\n" + query + ";" for label, query in [
                ("Previous original rows", before_queries["original_rows"]),
                ("Previous typed rows", before_queries["typed_rows"]),
                ("Current original rows", after_queries["original_rows"]),
                ("Current typed rows", after_queries["typed_rows"]),
                ("Complete keyed counts", queries["counts"]),
                ("Every added, removed and changed row", queries["changes"]),
            ])
            bundle.bytes("comparison.sql", (query_source + "\n").encode())
            manifest = {"schema": BUNDLE_SCHEMA, "request_id": request_id,
                        "selection_sha256": selection_sha, "files": list(bundle.files)}
            bundle.json("manifest.json", manifest)

@contextmanager
def _archive_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077,
             "DATASET_PG_REPORT_PRIVATE_ARCHIVE_REQUIRED")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            yield stream
        after = os.fstat(fd)
        need((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
             "DATASET_PG_REPORT_ARCHIVE_CHANGED")
    finally:
        os.close(fd)


def _archive_identity(stream):
    size, checksum = 0, hashlib.sha256()
    while raw := stream.read(1024 * 1024):
        size += len(raw)
        checksum.update(raw)
    stream.seek(0)
    return {"bytes": size, "sha256": checksum.hexdigest()}


def _verify_archive(path, request_id, chosen, selected_sha, warehouse):
    required = {"changes.jsonl", "changes.csv", "meaning-changes.json", "report.json",
                "report.html", "README.md", "comparison.sql"}
    required.update(prefix + "/" + name for prefix in ("previous", "current")
                    for name in ("dataset.jsonl", "columns.csv", "edition.json", "mapping.json", "manifest.json"))
    optional = {"previous/semantics.json", "current/semantics.json"}
    try:
        with _archive_file(path) as stream:
            artifact = _archive_identity(stream)
            with zipfile.ZipFile(stream) as archive:
                names = archive.namelist()
                need(len(names) == len(set(names)) and set(names) >= required | {"manifest.json"}
                     and set(names) <= required | optional | {"manifest.json"},
                     "DATASET_PG_REPORT_ARCHIVE_MEMBERS_CHANGED")
                need(all(archive.getinfo(name).file_size <= _META_LIMIT
                         for name in ("manifest.json", "report.json")),
                     "DATASET_PG_REPORT_METADATA_TOO_LARGE")
                manifest, report = (parse(archive.read(name)) for name in ("manifest.json", "report.json"))
                need(manifest.get("schema") == BUNDLE_SCHEMA and manifest.get("request_id") == request_id
                     and manifest.get("selection_sha256") == selected_sha
                     and isinstance(manifest.get("files"), list),
                     "DATASET_PG_REPORT_MANIFEST_CHANGED")
                inventory = manifest["files"]
                need(all(isinstance(item, dict) and isinstance(item.get("path"), str)
                         and type(item.get("bytes")) is int and 0 <= item["bytes"] <= 1024**4
                         and isinstance(item.get("sha256"), str) and _HEX.fullmatch(item["sha256"])
                         for item in inventory),
                     "DATASET_PG_REPORT_MANIFEST_CHANGED")
                need(len(inventory) == len({item["path"] for item in inventory})
                     and {item["path"] for item in inventory} == set(names) - {"manifest.json"},
                     "DATASET_PG_REPORT_MANIFEST_CHANGED")
                for item in inventory:
                    need(archive.getinfo(item["path"]).file_size == item["bytes"],
                         "DATASET_PG_REPORT_ARCHIVE_CHANGED")
                    with archive.open(item["path"]) as member:
                        actual = _archive_identity(member)
                    need(actual == {key: item[key] for key in ("bytes", "sha256")},
                         "DATASET_PG_REPORT_ARCHIVE_CHANGED")
                need(report.get("schema") == REPORT_SCHEMA and report.get("request_id") == request_id
                     and report.get("selection") == chosen and report.get("selection_sha256") == selected_sha
                     and report.get("warehouse_id") == warehouse.warehouse_id
                     and report.get("warehouse_schema") == warehouse.schema,
                     "DATASET_PG_REPORT_SELECTION_CHANGED")
                manifest_raw = archive.read("manifest.json")
                files = inventory + [{"path": "manifest.json", "bytes": len(manifest_raw),
                                      "sha256": digest(manifest_raw)}]
        return {"state": "COMPLETE", "request_id": request_id, "selection_sha256": selected_sha,
                "report": report, "artifact": {**artifact, "path": str(path),
                    "filename": "PostgreSQL_Period_Report_" + request_id + ".zip"}, "files": files}
    except (zipfile.BadZipFile, KeyError, UnicodeError, ValueError):
        raise WarehouseError("DATASET_PG_REPORT_ARCHIVE_INVALID") from None


def build_report(warehouse, directory, request_id, selected):
    """Create or reopen the same complete report under the original operator."""
    need(isinstance(request_id, str) and _ID.fullmatch(request_id),
         "DATASET_PG_REPORT_REQUEST_ID_REQUIRED")
    chosen = selection(selected)
    selected_sha = digest(json.dumps(chosen, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode())
    destination = private_directory(private_directory(Path(directory)) / request_id)
    intent_path, result_path = destination / "selection.json", destination / "result.json"
    path = destination / "report.zip"
    intent = {"selection": chosen, "selection_sha256": selected_sha,
              "warehouse_id": warehouse.warehouse_id, "warehouse_schema": warehouse.schema}
    if intent_path.exists():
        need(parse(read(intent_path, _META_LIMIT)) == intent, "DATASET_PG_REPORT_REQUEST_ID_REUSED")
    else:
        dump(intent_path, intent, exclusive=True)
    if not path.exists():
        need(not result_path.exists(), "DATASET_PG_REPORT_ARCHIVE_UNAVAILABLE")
        fd, temporary = tempfile.mkstemp(prefix=".report-", suffix=".zip", dir=destination)
        try:
            with os.fdopen(fd, "w+b") as output:
                _write_archive(warehouse, output, request_id, chosen, selected_sha)
                output.flush()
                os.fsync(output.fileno())
            # Publish only the complete archive. A lost response reopens this
            # exact ZIP and reconstructs its result instead of running another
            # comparison or replacing an existing report.
            os.link(temporary, path)
            sync_directory(destination)
        finally:
            Path(temporary).unlink(missing_ok=True)
    result = _verify_archive(path, request_id, chosen, selected_sha, warehouse)
    if result_path.exists():
        previous = parse(read(result_path, _META_LIMIT))
        # Restoring the same operator archive can relocate only the file path.
        # Complete report identity, rows and bytes must remain identical.
        previous_artifact = dict(previous.get("artifact") or {})
        previous_artifact["path"] = str(path)
        need({**previous, "artifact": previous_artifact} == result,
             "DATASET_PG_REPORT_RECORD_CHANGED")
        if previous != result:
            dump(result_path, result)
    else:
        dump(result_path, result, exclusive=True)
    return result


@contextmanager
def open_report(directory, request_id, expected_artifact):
    """Stream only the original completed private report selected by its ID."""
    need(isinstance(request_id, str) and _ID.fullmatch(request_id),
         "DATASET_PG_REPORT_REQUEST_ID_REQUIRED")
    root = private_directory(Path(directory), create=False)
    destination = private_directory(root / request_id, create=False)
    result = parse(read(destination / "result.json", _META_LIMIT))
    path = destination / "report.zip"
    need(result.get("state") == "COMPLETE" and result.get("request_id") == request_id
         and result.get("artifact") == expected_artifact
         and expected_artifact.get("path") == str(path),
         "DATASET_PG_REPORT_COMPLETE_REQUEST_REQUIRED")
    with _archive_file(path) as stream:
        actual = _archive_identity(stream)
        need(actual == {key: expected_artifact[key] for key in ("bytes", "sha256")},
             "DATASET_PG_REPORT_ARCHIVE_CHANGED")
        yield stream, expected_artifact
