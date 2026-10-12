"""Streaming original report readers and explicit nullable normalization."""
from __future__ import annotations
import codecs
import csv
from datetime import datetime
from decimal import Decimal, InvalidOperation
import io
import json
import re

from migration_store import MigrationError, canonical, identity, parse_json, text, file_hash
from pathlib import Path

NORMALIZER_VERSION = "ma-dor.original-report-normalizer/1"
ROW_BYTES_LIMIT = 8 * 1024 * 1024
NORMALIZED_INTEGER_DIGITS = 1000
csv.field_size_limit(ROW_BYTES_LIMIT)

ITEM = ["Source","Destination","File name","Extension","File size","Content type","Status","Result category","Message","Source item ID","Destination item ID","Package number","Migration job ID","Incremental round","Task ID","Device name"]
FAILURE = ["Source","Destination","Item name","Extension","Item size","Content type","Status","Result category","Message","Error code","Source item ID","Destination item ID","Package number","Migration job ID","Incremental Round","Task ID","Device name"]
ITEM_SUMMARY = ["Incremental round","Scanned","Item scan failures","Filtered out items","Expected migrated file count","Read","Packaged","Uploaded","Reuploaded","Submitted","Resubmitted","Migrated","Failed reading","Failed packing","Failed uploading","Failed submitting","Failed querying","Device name"]
TASK_SUMMARY = ["Task name","Status","Source","Destination","Total scanned items","Total to be migrated items","Migrated items","Items not migrated","Total bytes","Total GB","Migrated bytes","Migrated GB","Agent","Duration","TaskID","Task failure reason","Agent group"]
SCAN_SUMMARY = ["Incremental round","Total scanned items","Total scanned folders","Total scanned list items","Total scanned files","Folders with issues","Items with issues","Items filtered out","Folders to be migrated","Items to be migrated","Total items to be migrated","Device name"]
STRUCTURE = ["Structure type","Structure title","Operation","Status","Details","Source structure URL","Destination structure URL","Source structure ID","Destination structure ID","Time stamp"]

FORMATS = {
 "mm_item_report":{"role":"migration_items","kind":"csv","headers":ITEM,"meaning":"Original list of attempted items. No content SHA, ACL or Purview label is supplied by this report."},
 "mm_item_failure_report":{"role":"migration_failures","kind":"csv","headers":FAILURE,"meaning":"Original failure subset. Absence from it does not prove success or target presence."},
 "mm_item_summary":{"role":"summary","kind":"csv","headers":ITEM_SUMMARY,"meaning":"Original pipeline counts for each received incremental-round row. Counts have different denominators."},
 "mm_task_summary":{"role":"summary","kind":"csv","headers":TASK_SUMMARY,"meaning":"Original received task/aggregate rows. No assumed single-row shape."},
 "mm_scan_summary":{"role":"summary","kind":"csv","headers":SCAN_SUMMARY,"meaning":"Original scanning, filtering and expected-migration counts kept separately."},
 "mm_structure_report":{"role":"structure","kind":"csv","headers":STRUCTURE,"meaning":"Original structure operations; task/round context can come from the report set."},
 "mm_structure_failure_report":{"role":"structure","kind":"csv","headers":STRUCTURE,"meaning":"Original structure failure subset, not a complete target inventory."},
 "mm_structure_failure_summary":{"role":"structure","kind":"csv","headers":STRUCTURE,"meaning":"Original received structure failure-summary rows, with no inventory completeness inference."},
 "inventory_jsonl":{"role":None,"kind":"jsonl","meaning":"Explicit source or target inventory with nullable fields; original JSON lexemes remain in the retained raw line."},
 "inventory_csv":{"role":None,"kind":"csv","meaning":"Explicit canonical-field to original-header mapping required."},
 "purview_csv":{"role":"purview","kind":"csv","meaning":"Explicit original column map. Policy-only or incremental reports do not establish complete classification coverage."},
 "user_mapping_csv":{"role":"mapping","kind":"headerless_csv","meaning":"Exactly three headerless original columns: source principal, destination UPN, TRUE/FALSE AD-group flag."},
 "identity_mapping_jsonl":{"role":"mapping","kind":"jsonl","meaning":"Reviewed exact source-row and target-row occurrence links."},
 "evidence_mapping_jsonl":{"role":"mapping","kind":"jsonl","meaning":"Explicit subject-row to evidence-row field links, retaining original occurrence identities."},
 "status_mapping_jsonl":{"role":"mapping","kind":"jsonl","meaning":"Reviewed explicit original status vocabulary, separate from field verification."},
 "attachment":{"role":"attachment","kind":"binary","meaning":"Uninterpreted original supporting file. No automated evidence conclusion."}
}
FIELDS = ["source_id","target_id","path","expected_target_path","size_bytes","content_sha256","principals","label","classified_at","migrated_at","reported_source","reported_destination","name","extension","content_type","status","result_category","message","error_code","package_number","task_id","round_label","job_id","device_name","scan_job_id","scan_cycle_id"]
ALIASES = {"source_id":"sourceId","target_id":"targetId","expected_target_path":"expectedTargetPath","size_bytes":"sizeBytes","content_sha256":"contentSha256","classified_at":"classifiedAt","migrated_at":"migratedAt"}
TEXT_FIELDS = set(FIELDS) - {"size_bytes","content_sha256","principals","classified_at","migrated_at"}
COUNT_FIELDS = {
 "mm_item_summary": {h for h in ITEM_SUMMARY if h not in ("Incremental round","Device name")},
 "mm_task_summary": {"Total scanned items","Total to be migrated items","Migrated items","Items not migrated","Total bytes","Migrated bytes"},
 "mm_scan_summary": {h for h in SCAN_SUMMARY if h not in ("Incremental round","Device name")}
}
BASIC = {
 "Source":"reported_source","Destination":"reported_destination","File name":"name","Item name":"name","Extension":"extension",
 "File size":"size_bytes","Item size":"size_bytes","Content type":"content_type","Status":"status","Result category":"result_category",
 "Message":"message","Error code":"error_code","Source item ID":"source_id","Destination item ID":"target_id",
 "Package number":"package_number","Migration job ID":"job_id","Incremental round":"round_label","Incremental Round":"round_label",
 "Task ID":"task_id","TaskID":"task_id","Device name":"device_name"
}
CLASSIFICATIONS = {"reported_success","reported_failure","reported_filtered","reported_in_progress"}
ROLE_SET = {"source_inventory","target_inventory","migration_items","migration_failures","summary","structure","purview","mapping","attachment"}

def validate_context(fmt, context, columns=None, mapping_note=None, header_mapping=None):
    if fmt not in FORMATS:
        raise MigrationError("UNKNOWN_FORMAT", "Choose an advertised original input format")
    if not isinstance(context, dict):
        raise MigrationError("SOURCE_CONTEXT", "Source context must be an object")
    context = dict(context)
    for key in ("scope_id", "identity_namespace"):
        text(context.get(key), key, max_length=1024)
    if context.get("role") not in ROLE_SET:
        raise MigrationError("SOURCE_ROLE", "Choose the explicit source role")
    expected_role = FORMATS[fmt]["role"]
    if expected_role and context["role"] != expected_role:
        raise MigrationError("SOURCE_ROLE", "Format and declared source role differ", {"expected_role": expected_role})
    if fmt.startswith("inventory_") and context["role"] not in ("source_inventory","target_inventory"):
        raise MigrationError("SOURCE_ROLE", "Inventory must be explicitly source or target inventory")
    if context.get("capture_kind") not in ("customer_export","local_reference","public_reference"):
        raise MigrationError("CAPTURE_KIND", "Declare customer_export, local_reference or public_reference")
    coverage = context.get("coverage")
    if not isinstance(coverage, dict) or coverage.get("mode") not in ("complete","partial","failure_only","unknown"):
        raise MigrationError("SOURCE_COVERAGE", "Declare the capture coverage mode")
    text(coverage.get("description"), "coverage.description")
    if "expected_rows" in coverage:
        n = coverage["expected_rows"]
        if isinstance(n, bool) or not isinstance(n, int) or n < 0:
            raise MigrationError("SOURCE_COVERAGE", "expected_rows must be a nonnegative integer")
    if context.get("scan_mode", "unknown") not in ("full","incremental","unknown"):
        raise MigrationError("SCAN_MODE", "Declare full, incremental or unknown scan mode")
    if "policy_only" in context and not isinstance(context["policy_only"], bool):
        raise MigrationError("SOURCE_CONTEXT", "policy_only must be boolean when supplied")
    for key in ("task_id","round_label","job_id","snapshot_id","producer","observed_at","scan_job_id","scan_cycle_id","note"):
        if key in context and context[key] is not None:
            text(context[key], key)
    delimiter = context.get("delimiter", ",")
    if not isinstance(delimiter,str) or len(delimiter)!=1 or delimiter in ("\x00","\r","\n",'"'):
        raise MigrationError("CSV_DIALECT", "Declare one ordinary delimiter character")
    if fmt=="user_mapping_csv" and delimiter!=",":
        raise MigrationError("CSV_DIALECT", "Official user mapping CSV is comma-delimited")
    encoding = context.get("encoding")
    if encoding is not None and encoding not in ("utf-8","utf-8-sig","utf-16","utf-16-le","utf-16-be"):
        raise MigrationError("ENCODING", "Supported declared encodings are UTF-8 or UTF-16 variants")
    if not isinstance(columns or {}, dict) or not isinstance(header_mapping or {}, dict):
        raise MigrationError("COLUMN_MAPPING", "Column maps must be objects")
    for key, value in (columns or {}).items():
        if key not in FIELDS:
            raise MigrationError("COLUMN_MAPPING", "Unknown canonical field", {"field": key})
        text(value, "column header")
    for key, value in (header_mapping or {}).items():
        if key not in FORMATS[fmt].get("headers", []):
            raise MigrationError("HEADER_MAPPING", "A provider header alias must name an advertised documented heading", {"header": key})
        text(value, "original header")
    if columns or header_mapping:
        text(mapping_note, "column_mapping_note")
    if fmt in ("inventory_csv","purview_csv") and not columns:
        raise MigrationError("COLUMN_MAPPING", "This format requires an explicit canonical-field to exact-header map")
    return context

def _field(value, kind, present=True):
    if not present:
        return None, "missing", None
    if value is None:
        return None, "null", None
    if isinstance(value, str) and not value.strip():
        return None, "empty", None
    if kind in TEXT_FIELDS:
        if isinstance(value, str):
            return value, "value", None
        return None, "invalid", "expected_text"
    if kind == "size_bytes":
        try:
            if isinstance(value, bool):
                raise ValueError()
            number = Decimal(str(value).strip())
            if not number.is_finite() or number < 0 or number != number.to_integral_value():
                raise ValueError()
            if number.is_zero():
                return "0", "value", None
            if number.adjusted() + 1 > NORMALIZED_INTEGER_DIGITS:
                return None, "invalid", "expanded_integer_exceeds_normalizer_digit_budget"
            return format(number, "f").split(".")[0], "value", None
        except (InvalidOperation, ValueError):
            return None, "invalid", "expected_nonnegative_integer_bytes"
    if kind == "content_sha256":
        if isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{64}", value):
            return value.lower(), "value", None
        return None, "invalid", "expected_explicit_sha256"
    if kind == "principals":
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (ValueError, TypeError):
                return None, "invalid", "expected_json_principal_array"
        if not isinstance(value, list) or not all(isinstance(v, str) and v and not any(ord(c) < 32 for c in v) for v in value):
            return None, "invalid", "expected_principal_array"
        # Original order/duplicates remain in raw source. Comparison uses the declared set only.
        return value, "value", ("duplicate_principal_declarations" if len(set(value)) != len(value) else None)
    if kind in ("classified_at","migrated_at"):
        try:
            if not isinstance(value, str):
                raise ValueError()
            stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if stamp.tzinfo is None or stamp.utcoffset() is None:
                raise ValueError()
            return value, "value", None
        except ValueError:
            return None, "invalid", "timestamp_requires_explicit_offset"
    raise MigrationError("FIELD_KIND", "Unsupported field kind")

def _normal(raw, fmt, context, columns, header_mapping, source_ref):
    values, presence, issues, basis = {}, {}, [], {}
    for field in FIELDS:
        values[field], presence[field] = None, "missing"
    provider = {}
    if raw["kind"] == "csv":
        headers, cells = raw["headers"], raw["cells"]
        original_provider = {name: cells[index] if index < len(cells) else None for index, name in enumerate(headers)}
        provider = dict(original_provider)
        if len(cells) != len(headers):
            issues.append({"code":"column_count_mismatch","expected":len(headers),"actual":len(cells)})
        if len(cells) > len(headers):
            issues.append({"code":"extra_original_cells_retained","count":len(cells)-len(headers)})
        for documented in FORMATS[fmt].get("headers", []):
            original = (header_mapping or {}).get(documented, documented)
            if original in original_provider:
                provider[documented] = original_provider[original]
        documented_headers = set(FORMATS[fmt].get("headers", []))
        assigned = {canonical_name: provider[header] for header, canonical_name in BASIC.items() if header in provider and header in documented_headers}
        if fmt.startswith("mm_structure"):
            assigned.update({canonical_name: provider[header] for header, canonical_name in {
                "Source structure ID":"source_id","Destination structure ID":"target_id",
                "Source structure URL":"reported_source","Destination structure URL":"reported_destination",
                "Structure title":"name","Status":"status","Details":"message"}.items() if header in provider})
        for field, header in (columns or {}).items():
            if header not in original_provider:
                raise MigrationError("COLUMN_MAPPING", "Mapped original column is absent", {"field":field,"header":header})
            assigned[field] = original_provider[header]
            basis[field] = "explicit_reviewed_column_mapping"
        for header in COUNT_FIELDS.get(fmt, set()):
            v, p, issue = _field(provider.get(header), "size_bytes", header in provider)
            values.setdefault("reported_counts", {})[header] = {"value":v,"presence":p,"original":provider.get(header)}
            if issue:
                issues.append({"code":issue,"field":header})
    else:
        obj = raw["parsed"]
        if not isinstance(obj, dict):
            issues.append({"code":"jsonl_record_not_object"})
            obj = {}
        assigned = {}
        for field in FIELDS:
            legacy = ALIASES.get(field)
            if field in obj and legacy and legacy in obj and obj[field] != obj[legacy]:
                issues.append({"code":"canonical_legacy_alias_conflict","field":field,"legacy":legacy})
                presence[field] = "invalid"
                continue
            if field in obj:
                assigned[field] = obj[field]
            elif legacy and legacy in obj:
                assigned[field] = obj[legacy]
        if fmt == "identity_mapping_jsonl":
            values["mapping_entry"] = {k: obj.get(k) if isinstance(obj.get(k),str) else None for k in ("source_row_id","target_row_id","reason")}
        if fmt == "evidence_mapping_jsonl":
            values["mapping_entry"] = {k: obj.get(k) if isinstance(obj.get(k),str) else None for k in ("subject_row_id","evidence_row_id","reason")}
            values["mapping_entry"]["fields"] = obj.get("fields") if isinstance(obj.get("fields"),list) and all(isinstance(x,str) for x in obj["fields"]) else None
        if fmt == "status_mapping_jsonl":
            values["mapping_entry"] = {k: obj.get(k) if isinstance(obj.get(k),str) else None for k in ("raw_status","classification","reason")}
    for field, value in assigned.items():
        v, p, issue = _field(value, field)
        values[field], presence[field] = v, p
        if issue:
            issues.append({"code":issue,"field":field})
        basis.setdefault(field, "original_declared_inventory" if fmt.startswith("inventory") else "original_report_field")
    for field in ("task_id","round_label","job_id","scan_job_id","scan_cycle_id"):
        if context.get(field) is not None:
            if presence[field] in ("missing","null","empty"):
                values[field] = context[field]
                presence[field] = "value"
                basis[field] = "explicit_report_set_context"
            elif values[field] != context[field]:
                issues.append({"code":"reported_context_conflict","field":field,"reported":values[field],"context":context[field]})
    if fmt.startswith("mm_item"):
        if presence["size_bytes"] == "value":
            basis["size_bytes"] = "reported_item_size_not_retained_target_byte_verification"
        # Destination is a reported location. It is not assumed to be a full target object path.
        if "path" not in (columns or {}):
            values["path"], presence["path"] = None, "missing"
        for field in ("content_sha256","principals","label","classified_at","migrated_at"):
            if field not in (columns or {}):
                values[field], presence[field] = None, "missing"
    if fmt == "purview_csv":
        basis["classification_scope"] = "reported_scan_evidence_not_policy_effectiveness_or_compliance"
    values["field_basis"] = basis
    return {"values": values, "presence": presence, "issues": issues, "source_ref": source_ref}

def _encoding(handle, context):
    declared = context.get("encoding")
    prefix = handle.read(4)
    handle.seek(0)
    if declared:
        return declared
    if prefix.startswith(codecs.BOM_UTF16_LE) or prefix.startswith(codecs.BOM_UTF16_BE):
        return "utf-16"
    return "utf-8-sig"

def iter_original_rows(handle, fmt, context, columns=None, header_mapping=None):
    """Yields one record at a time. Original retained bytes are never rewritten."""
    spec = FORMATS[fmt]
    if spec["kind"] == "binary":
        return
    if spec["kind"] == "jsonl":
        if context.get("encoding") not in (None,"utf-8","utf-8-sig"):
            raise MigrationError("ENCODING", "JSONL needs UTF-8 for exact line byte locators")
        line_number, ordinal, offset = 0, 0, 0
        while True:
            line = handle.readline(ROW_BYTES_LIMIT + 1)
            if not line:
                break
            start = offset
            offset += len(line)
            line_number += 1
            if len(line) > ROW_BYTES_LIMIT:
                raise MigrationError("ROW_BUDGET", "Original JSONL row exceeds the 8 MiB parser budget", {"physical_line":line_number})
            try:
                original_text = line.decode("utf-8-sig" if line_number == 1 else "utf-8")
            except UnicodeDecodeError as exc:
                raise MigrationError("ENCODING", "Original JSONL is not valid UTF-8", {"physical_line":line_number}) from exc
            if not original_text.strip():
                continue
            ordinal += 1
            locator = {"record_ordinal":ordinal,"physical_line_start":line_number,"physical_line_end":line_number,"byte_offset":start,"bytes":len(line)}
            try:
                parsed = json.loads(original_text, parse_float=Decimal, parse_int=int,
                                    parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
            except (ValueError, TypeError) as exc:
                # Keep malformed records as original occurrences, not missing rows.
                raw = {"kind":"jsonl","text":original_text,"parsed":{}}
                norm = _normal(raw, fmt, context, columns, header_mapping, locator)
                norm["issues"].append({"code":"invalid_json_record","message":str(exc)})
            else:
                raw = {"kind":"jsonl","text":original_text,"parsed":parsed}
                norm = _normal(raw, fmt, context, columns, header_mapping, locator)
            raw.pop("parsed", None)
            yield ordinal, raw, norm, locator
        return
    wrapper = io.TextIOWrapper(handle, encoding=_encoding(handle, context), newline="")
    previous_end, ordinal = 0, 0
    try:
        reader = csv.reader(wrapper, strict=True, delimiter=context.get("delimiter", ","))
        if spec["kind"] == "headerless_csv":
            headers = ["source_principal","target_principal","is_group"]
        else:
            try:
                headers = next(reader)
            except StopIteration:
                raise MigrationError("EMPTY_CSV", "Original CSV has no header")
            previous_end = reader.line_num
            if not headers or any(not h for h in headers) or len(set(headers)) != len(headers):
                raise MigrationError("CSV_HEADERS", "Original CSV needs nonempty unique headers; original bytes are retained")
            required = [(header_mapping or {}).get(h, h) for h in spec.get("headers", [])]
            missing = [h for h in required if h not in headers]
            if missing:
                raise MigrationError("REPORT_HEADERS", "Documented report headings are missing; declare exact header_mapping for variants", {"missing":missing,"received":headers})
            if len(set(required)) != len(required):
                raise MigrationError("HEADER_MAPPING", "Two documented headings cannot silently use the same original column")
        for cells in reader:
            ordinal += 1
            locator = {"record_ordinal":ordinal,"physical_line_start":previous_end + 1,"physical_line_end":reader.line_num,"encoding":wrapper.encoding}
            previous_end = reader.line_num
            raw = {"kind":"csv","headers":headers,"cells":cells}
            if len(canonical(raw).encode("utf-8")) > ROW_BYTES_LIMIT:
                raise MigrationError("ROW_BUDGET", "Original CSV row exceeds the 8 MiB parser budget", locator)
            norm = _normal(raw, fmt, context, columns, header_mapping, locator)
            if spec["kind"] == "headerless_csv":
                entry = {"source_principal":cells[0] if len(cells)>0 else None,
                         "target_principal":cells[1] if len(cells)>1 else None,
                         "is_group":True if len(cells)>2 and cells[2]=="TRUE" else False if len(cells)>2 and cells[2]=="FALSE" else None}
                norm["values"]["mapping_entry"] = entry
                if len(cells) != 3 or entry["is_group"] is None or not entry["source_principal"] or not entry["target_principal"]:
                    norm["issues"].append({"code":"invalid_official_user_mapping_row","expected":"three headerless columns with TRUE or FALSE"})
            yield ordinal, raw, norm, locator
    except (csv.Error, UnicodeDecodeError) as exc:
        raise MigrationError("CSV_PARSE", "Original CSV could not be parsed completely", {"physical_line":getattr(reader,"line_num",None),"error":str(exc)}) from exc
    finally:
        # The caller owns the original held file.
        wrapper.detach()

def import_source(store, op):
    p = op["request"]
    fmt = p.get("format")
    columns, header_mapping = p.get("columns", {}), p.get("header_mapping", {})
    context = validate_context(fmt, p.get("context"), columns, p.get("column_mapping_note"), header_mapping)
    info = store.file_info(p.get("file_sha256"))
    if p.get("bytes") != info["bytes"] or isinstance(p.get("bytes"), bool) or not isinstance(p.get("bytes"),int):
        raise MigrationError("FILE_IDENTITY", "source.import bytes do not match staged original")
    from migration_store import basename
    filename = basename(p.get("filename"))
    source_id = "source-" + identity({"operation":op["id"],"request":op["request_sha256"]})[:40]
    implementation = {"module":"migration_formats.py","sha256":file_hash(Path(__file__))["sha256"]}
    prior = store.conn.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
    if prior and prior["status"] == "READY":
        return source_description(store, source_id)
    if prior and (prior["normalizer_version"] != NORMALIZER_VERSION or parse_json(prior["columns_json"]).get("implementation") != implementation):
        raise MigrationError("NORMALIZER_VERSION", "Original incomplete import belongs to a different normalizer")
    with store.transaction():
        store.conn.execute("INSERT OR IGNORE INTO sources(id,file_sha256,filename,format,context_json,columns_json,normalizer_version,status,created_revision,created_at) VALUES(?,?,?,?,?,?,?,'IMPORTING',?,?)",
                           (source_id,p["file_sha256"],filename,fmt,canonical(context),
                            canonical({"columns":columns,"header_mapping":header_mapping,"note":p.get("column_mapping_note"),"implementation":implementation}),
                            NORMALIZER_VERSION,op["reserved_revision"],op["created_at"]))
        store.conn.execute("UPDATE sources SET status='IMPORTING',error_json=NULL WHERE id=?", (source_id,))
    rows_seen, issue_count, batch_count, batch_bytes = 0, 0, 0, 0
    active = False
    status_counts = {}
    status_counts_other = 0
    try:
        with store.open_file(p["file_sha256"]) as handle:
            iterator = iter_original_rows(handle, fmt, context, columns, header_mapping)
            for ordinal, raw, norm, locator in iterator:
                rows_seen = ordinal
                values, presence, issues = norm["values"], norm["presence"], norm["issues"]
                issue_count += len(issues)
                status = values.get("status")
                if status is not None:
                    if status in status_counts or len(status_counts) < 100:
                        status_counts[status] = status_counts.get(status,0)+1
                    else:
                        status_counts_other += 1
                row_id = "row-" + identity({"source_id":source_id,"ordinal":ordinal})[:40]
                raw_json, values_json, presence_json = canonical(raw), canonical(values), canonical(presence)
                issues_json, locator_json = canonical(issues), canonical(locator)
                expected = (row_id,source_id,ordinal,context["role"],context["identity_namespace"],
                            values.get("source_id"),values.get("target_id"),values.get("task_id"),values.get("round_label"),values.get("job_id"),
                            raw_json,values_json,presence_json,issues_json,locator_json)
                old = store.conn.execute("SELECT * FROM rows WHERE source_id=? AND ordinal=?", (source_id,ordinal)).fetchone()
                if old:
                    if tuple(old) != expected:
                        raise MigrationError("IMPORT_PREFIX_CHANGED", "Retained original import row differs on continuation", {"ordinal":ordinal})
                    continue
                if not active:
                    store.conn.execute("BEGIN IMMEDIATE")
                    active = True
                store.conn.execute("INSERT INTO rows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", expected)
                batch_count += 1
                batch_bytes += len(raw_json) + len(values_json)
                if batch_count >= 250 or batch_bytes >= 1024*1024:
                    checkpoint = {"source_id":source_id,"records_retained":ordinal,"phase":"importing","last_locator":locator}
                    store.conn.execute("UPDATE sources SET row_count=?,issue_count=? WHERE id=?", (rows_seen,issue_count,source_id))
                    store.conn.execute("UPDATE operations SET checkpoint_json=? WHERE id=?", (canonical(checkpoint),op["id"]))
                    store.conn.execute("COMMIT")
                    active, batch_count, batch_bytes = False, 0, 0
            if active:
                store.conn.execute("COMMIT")
                active = False
        existing_count = store.conn.execute("SELECT count(*) FROM rows WHERE source_id=?", (source_id,)).fetchone()[0]
        if existing_count != rows_seen:
            raise MigrationError("IMPORT_PREFIX_CHANGED", "Original source ends before retained import rows")
        expected_rows = context["coverage"].get("expected_rows")
        summary_issues = []
        if expected_rows is not None and rows_seen != expected_rows:
            summary_issues.append({"code":"declared_row_count_mismatch","expected_rows":expected_rows,"actual_rows":rows_seen})
        effective = context["coverage"]["mode"]
        if fmt in ("mm_item_failure_report","mm_structure_failure_report","mm_structure_failure_summary"):
            effective = "failure_only"
        elif fmt == "purview_csv" and context.get("policy_only"):
            effective = "policy_matches_only"
        elif fmt == "purview_csv" and context.get("scan_mode") == "incremental":
            effective = "new_or_modified_only"
        summary = {"row_count":rows_seen,"normalization_issue_count":issue_count,"status_counts":status_counts,"additional_status_rows":status_counts_other,
                   "declared_coverage":context["coverage"],"effective_coverage":effective,"issues":summary_issues,
                   "meaning":FORMATS[fmt]["meaning"],"normalizer":NORMALIZER_VERSION}
        with store.transaction():
            store.conn.execute("UPDATE sources SET status='READY',row_count=?,issue_count=?,summary_json=?,error_json=NULL WHERE id=?",
                               (rows_seen,issue_count,canonical(summary),source_id))
            store.conn.execute("UPDATE operations SET checkpoint_json=? WHERE id=?",
                               (canonical({"source_id":source_id,"records_retained":rows_seen,"phase":"complete"}),op["id"]))
        return source_description(store, source_id)
    except BaseException as exc:
        if active and store.conn.in_transaction:
            store.conn.execute("ROLLBACK")
        error = exc.as_dict() if isinstance(exc, MigrationError) else {"code":type(exc).__name__,"message":str(exc)}
        with store.transaction():
            count = store.conn.execute("SELECT count(*) FROM rows WHERE source_id=?", (source_id,)).fetchone()[0]
            store.conn.execute("UPDATE sources SET status='INCOMPLETE',row_count=?,error_json=? WHERE id=?", (count,canonical(error),source_id))
        raise

def source_description(store, source_id):
    row = store.conn.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
    if not row:
        raise MigrationError("SOURCE_NOT_FOUND", "Original source import not found", {"id":source_id})
    out = dict(row)
    for key in ("context","columns","summary","error"):
        value = out.pop(key+"_json")
        out[key] = parse_json(value) if value is not None else None
    out["bytes"] = store.file_info(out["file_sha256"])["bytes"]
    return out

def row_description(store, row):
    if isinstance(row, str):
        row = store.conn.execute("SELECT * FROM rows WHERE id=?", (row,)).fetchone()
    if not row:
        raise MigrationError("ROW_NOT_FOUND", "Retained source occurrence not found")
    out = dict(row)
    for key in ("raw","values","presence","issues","locator"):
        out[key] = parse_json(out.pop(key+"_json"))
    source = store.conn.execute("SELECT file_sha256,filename,format,status,context_json FROM sources WHERE id=?", (out["source_id"],)).fetchone()
    out["source_ref"] = {"source_id":out["source_id"],"sha256":source["file_sha256"],"filename":source["filename"],
                         "format":source["format"],"source_status":source["status"],**out["locator"]}
    out["source_context"] = parse_json(source["context_json"])
    return out
