#!/usr/bin/env python3
"""MIT. Original IRIS XML projection, acknowledgment correlation and lineage.

Public contracts: IRS Publication 5718 sections 2.2/3/5/6, the August 2026
prior-system correction update, and the October 7, 2026 schema clarification.
The existing conversion service owns comparison jobs, reviews and replay.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import xml.etree.ElementTree as ET

MAX_XML = 100 * 1024 * 1024
UTID = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}:IRIS:[A-Z0-9]{5}::A\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
ACCEPTED = {"Accepted", "Accepted with Errors"}
STATUSES = ACCEPTED | {"Rejected", "Processing", "Partially Accepted", "Not Found"}


class IrisError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def need(condition, code, message):
    if not condition:
        raise IrisError(code, message)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def original_file(path, limit=MAX_XML):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= limit,
             "INPUT_SIZE", "Choose a nonempty regular file within the configured input limit.")
        data = stream.read(limit + 1)
        need(len(data) == info.st_size and len(data) <= limit,
             "INPUT_CHANGED", "The source file changed during capture.")
    return data, {"sha256": digest(data), "bytes": len(data)}


def local(tag):
    return tag.rsplit("}", 1)[-1]


def children(node, name):
    return [item for item in node if local(item.tag) == name]


def descendants(node, name):
    return [item for item in node.iter() if local(item.tag) == name]


def value(node):
    need(len(node) == 0, "XML_LEAF_REQUIRED", "A selected field must identify one XML leaf.")
    return node.text or ""


def field(node, name, required=False, deep=True):
    found = descendants(node, name) if deep else children(node, name)
    need(len(found) <= 1, "XML_FIELD_AMBIGUOUS", f"Field {name} occurs more than once in its selected scope.")
    need(found or not required, "XML_FIELD_REQUIRED", f"Field {name} is required in this scope.")
    return value(found[0]).strip() if found else None


def alternative(node, names, required=False):
    found = [(name, field(node, name)) for name in names]
    present = [(name, text) for name, text in found if text is not None]
    need(len(present) <= 1, "XML_FIELD_AMBIGUOUS", "The response includes competing identity fields.")
    need(present or not required, "XML_FIELD_REQUIRED", f"Expected field {' or '.join(names)}.")
    return present[0][1] if present else None


def identifier(text, label):
    need(isinstance(text, str) and 0 < len(text) <= 160 and
         not any(ord(char) < 33 or char == "|" for char in text),
         "IDENTIFIER_INVALID", f"{label} must be a nonempty native identifier without a pipe separator.")
    return text


def xml_source(path, xsd=None, schema_root=None):
    raw, source = original_file(path)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise IrisError("XML_ENCODING", "IRIS XML input must be UTF-8.") from None
    need(not re.search(r"<!\s*(DOCTYPE|ENTITY)\b", text, re.I),
         "XML_DECLARATION_REFUSED", "Use XML without a DTD or entity declaration.")
    declaration = re.match(r"\s*<\?xml\s+[^?]*encoding=['\"]([^'\"]+)", text)
    need(not declaration or declaration[1].lower() in {"utf-8", "utf8"},
         "XML_ENCODING", "The declared XML encoding must be UTF-8.")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise IrisError("XML_INVALID", f"XML syntax error at line {error.position[0]}, column {error.position[1]}.") from None
    validation = {"mode": "xml-structure", "valid": True}
    if xsd:
        validation = validate_xsd(raw, xsd, schema_root)
    return root, source, validation


def validate_xsd(raw, xsd, schema_root):
    try:
        from lxml import etree
    except ImportError:
        raise IrisError("XSD_RUNTIME_REQUIRED", "Install lxml in the selected Python runtime to validate a supplied XSD package.") from None
    entry = Path(xsd).resolve(strict=True)
    base = Path(schema_root).resolve(strict=True) if schema_root else entry.parent
    need(entry.is_relative_to(base), "SCHEMA_LOCATION", "The XSD entry must be inside the supplied schema root.")
    consumed = {}

    class PackageResolver(etree.Resolver):
        def resolve(self, url, public_id, context):
            from urllib.parse import unquote, urlsplit
            parsed = urlsplit(url)
            need(parsed.scheme in {"", "file"} and not parsed.netloc,
                 "SCHEMA_REMOTE_REFERENCE", "Schema imports must resolve inside the supplied local package.")
            selected = Path(unquote(parsed.path))
            selected = (base / selected).resolve() if not selected.is_absolute() else selected.resolve()
            need(selected.is_relative_to(base), "SCHEMA_LOCATION", "A schema import leaves the supplied package root.")
            data, info = original_file(selected, 16 * 1024 * 1024)
            need(not re.search(br"<!\s*(DOCTYPE|ENTITY)\b", data, re.I),
                 "SCHEMA_DECLARATION_REFUSED", "Use XSD files without DTD or entity declarations.")
            consumed[str(selected.relative_to(base))] = info
            return self.resolve_string(data, context, base_url=selected.as_uri())

    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    parser.resolvers.add(PackageResolver())
    try:
        schema = etree.XMLSchema(etree.parse(str(entry), parser))
        schema.assertValid(etree.fromstring(raw, parser))
    except (etree.XMLSyntaxError, etree.XMLSchemaParseError, etree.DocumentInvalid) as error:
        last = error.error_log.last_error
        location = f"line {last.line}, type {last.type_name}" if last is not None else "the supplied schema"
        raise IrisError("XSD_VALIDATION_FAILED", f"XML/schema validation failed at {location}.") from None
    return {"mode": "xsd", "valid": True, "entry": str(entry.relative_to(base)),
            "files": [{"path": name, **consumed[name]} for name in sorted(consumed)]}


def transmission(path, xsd=None, schema_root=None):
    root, source, validation = xml_source(path, xsd, schema_root)
    utid = field(root, "UniqueTransmissionId", True)
    need(UTID.fullmatch(utid), "UTID_INVALID", "Use the native UUID:IRIS:TCC::A transmission identity.")
    kind = field(root, "TransmissionTypeCd", True)
    need(kind in {"O", "C", "R"}, "TRANSMISSION_TYPE", "Use original, correction or replacement transmission type O, C or R.")
    version = field(root, "SchemaVersionNum")
    years = sorted({value(item).strip() for item in descendants(root, "TaxYr")})
    need(years and all(re.fullmatch(r"20[0-9]{2}", year) for year in years),
         "TAX_YEAR_REQUIRED", "Retain the actual TaxYr fields from the prepared transmission.")
    need(len(years) == 1, "MIXED_TAX_YEARS", "A transmission must contain one tax year.")
    if 2022 <= int(years[0]) <= 2026:
        need(version == "5.0.7", "SCHEMA_VERSION", "The October 7, 2026 clarification requires SchemaVersionNum 5.0.7 for tax years 2022–2026.")
    submissions = []
    for group in root.iter():
        if not re.fullmatch(r"IRSubmission[1-3]Grp", local(group.tag)):
            continue
        sid = identifier(field(group, "SubmissionId", True), "SubmissionId")
        records = []
        for item in group.iter():
            if not re.fullmatch(r"Form[0-9A-Za-z]+Detail", local(item.tag)):
                continue
            rid = identifier(field(item, "RecordId", True, deep=False), "RecordId")
            previous = descendants(item, "PrevSubmittedRecRecipientGrp")
            need(len(previous) <= 1, "PREVIOUS_RECIPIENT_AMBIGUOUS", "Each record needs one previous-recipient group.")
            prior = previous[0] if previous else None
            other = None
            if prior is not None and field(prior, "OtherIntakeSystemInd") in {"true", "1"}:
                other = field(prior, "OtherIntakeSystemNm", True)
                need(other in {"FIRE", "Third Party"}, "PRIOR_SYSTEM", "Use the native prior-system enumeration.")
            records.append({"recordId": rid, "form": local(item.tag),
                            "corrected": field(item, "CorrectedInd", deep=False) in {"1", "true"},
                            "previousUniqueRecordId": field(prior, "UniqueRecordId") if prior is not None else None,
                            "otherIntakeSystem": other,
                            "hasPreviousTin": bool(field(prior, "TIN")) if prior is not None else False,
                            "hasPreviousName": bool(descendants(prior, "PersonName") or descendants(prior, "BusinessName")) if prior is not None else False})
        need(records, "SUBMISSION_EMPTY", "The selected submission contains no form records.")
        need(len({row["form"] for row in records}) == 1,
             "MIXED_SUBMISSION_FORMS", "Each submission must contain one form type.")
        need(len({row["recordId"] for row in records}) == len(records),
             "DUPLICATE_RECORD_ID", "RecordId must be unique within each submission.")
        submissions.append({"submissionId": sid, "originalUniqueSubmissionId": field(group, "OriginalUniqueSubmissionId"),
                            "recordCount": len(records), "records": records})
    need(submissions, "SUBMISSION_REQUIRED", "The transmission contains no supported IRSubmission group.")
    need(len({row["submissionId"] for row in submissions}) == len(submissions),
         "DUPLICATE_SUBMISSION_ID", "SubmissionId must be unique within the transmission.")
    return {"schema": "ers-iris.transmission.v1", "source": source,
            "namespace": root.tag[1:].split("}")[0] if root.tag.startswith("{") else "",
            "schemaValidation": validation,
            "manifest": {"utid": utid, "type": kind, "schemaVersion": version, "taxYears": years,
                         "originalReceiptId": field(root, "OriginalReceiptId")},
            "recordCount": sum(row["recordCount"] for row in submissions), "submissions": submissions}


def path_parts(path):
    need(isinstance(path, str) and len(path) <= 1024, "MAPPING_PATH", "Choose a direct XML child path.")
    parts = re.findall(r"(?:\{[^{}]+\})?[A-Za-z_][A-Za-z0-9_.-]*", path)
    need(parts and "/".join(parts) == path, "MAPPING_PATH", "Use direct child names separated by slashes.")
    return parts


def selected_text(node, parts, required):
    for part in parts:
        matches = [child for child in node if child.tag == part] if part.startswith("{") else children(node, part)
        need(len(matches) <= 1, "MAPPING_AMBIGUOUS", "The selected XML path repeats. Choose an explicit record grain.")
        if not matches:
            need(not required, "MAPPING_FIELD_MISSING", f"A required XML field is absent at {part}.")
            return ""
        node = matches[0]
    return value(node)


def extract(path, mapping_path, destination, xsd=None, schema_root=None):
    root, source, validation = xml_source(path, xsd, schema_root)
    raw_map, map_identity = original_file(mapping_path, 256 * 1024)
    config = json.loads(raw_map)
    need(config.get("schema") == "ers-iris.xml-map.v1" and isinstance(config.get("fields"), list),
         "MAPPING_SCHEMA", "Use an ers-iris.xml-map.v1 field mapping.")
    record_tag, submission_tag = config.get("recordTag"), config.get("submissionTag")
    need(isinstance(record_tag, str) and len(path_parts(record_tag)) == 1 and
         isinstance(submission_tag, str) and len(path_parts(submission_tag)) == 1,
         "MAPPING_GRAIN", "Select the actual record and submission element names.")
    fields = []
    for item in config["fields"]:
        need(isinstance(item, dict) and set(item) <= {"name", "scope", "path", "required"},
             "MAPPING_FIELDS", "A field uses name, scope, path and optional required.")
        name, scope, required = item.get("name"), item.get("scope"), item.get("required", True)
        need(isinstance(name, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,95}", name),
             "MAPPING_COLUMN", "Choose a unique logical CSV field name.")
        need(scope in {"record", "form", "submission", "transmission"} and isinstance(required, bool),
             "MAPPING_SCOPE", "Use record, form, submission or transmission scope and a Boolean required flag.")
        fields.append((name, scope, path_parts(item.get("path")), required))
    columns = [row[0] for row in fields]
    need(1 <= len(columns) <= 256 and len(set(columns)) == len(columns),
         "MAPPING_COLUMNS", "Select one to 256 distinct logical CSV columns.")
    match = lambda node, name: node.tag == name if name.startswith("{") else local(node.tag) == name
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    count = 0
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as output:
            writer = csv.writer(output, lineterminator="\n")
            writer.writerow(columns)
            stack = [(root, None, None, 0)]
            while stack:
                item, submission, form, depth = stack.pop()
                need(depth <= 64, "XML_DEPTH", "XML nesting exceeds the supported filing depth.")
                if match(item, submission_tag):
                    submission = item
                if re.fullmatch(r"Form[0-9A-Za-z]+Detail", local(item.tag)):
                    form = item
                if match(item, record_tag):
                    need(submission is not None, "MAPPING_SUBMISSION", "A selected record is outside the selected submission group.")
                    scopes = {"record": item, "form": form, "submission": submission, "transmission": root}
                    row = []
                    for _, scope, parts, required in fields:
                        need(scopes[scope] is not None, "MAPPING_SCOPE", "A selected scope is absent for this record.")
                        row.append(selected_text(scopes[scope], parts, required))
                    writer.writerow(row)
                    count += 1
                stack.extend((child, submission, form, depth + 1) for child in reversed(item))
            need(count > 0, "MAPPING_EMPTY", "The selected XML record grain matched no records.")
            output.flush()
            os.fsync(output.fileno())
        _, identity = original_file(destination)
        return {"schema": "ers-iris.projection.v1", "source": source, "mapping": map_identity,
                "output": identity, "recordCount": count, "columns": columns, "schemaValidation": validation}
    except BaseException:
        Path(destination).unlink(missing_ok=True)
        raise


def native_errors(node):
    return [{"code": field(item, "ErrorMessageCd"), "path": field(item, "ElementPathTxt")}
            for item in children(node, "ErrorInformationGrp")]


def acknowledgment(path, utid, receipt_id=None):
    need(UTID.fullmatch(utid), "UTID_INVALID", "Choose the original transmission's native UTID.")
    root, source, _ = xml_source(path)
    identity = {"rootQName": root.tag,
                "namespace": root.tag[1:].split("}")[0] if root.tag.startswith("{") else ""}
    if local(root.tag) == "IntakeA2AResponse":
        receipt = alternative(root, ["receiptId", "ReceiptId"], True)
        identifier(receipt, "ReceiptId")
        need(not receipt_id or receipt_id == receipt, "RECEIPT_CONFLICT", "The intake response differs from the retained receipt.")
        returned = alternative(root, ["UniqueTransmissionId", "TransmissionId"])
        need(not returned or returned == utid, "TRANSMISSION_CONFLICT", "The intake response belongs to another transmission.")
        return {"schema": "ers-iris.ack.v1", "source": source, **identity, "kind": "intake", "utid": utid,
                "receiptId": receipt, "status": "Received", "submissions": [], "errors": []}
    need(local(root.tag) in {"TransStatusOrAckResponse", "TransStatusOrAckResponseType"},
         "ACK_ROOT", "Choose the original IRIS intake or status/acknowledgment XML response.")
    groups = descendants(root, "ResultGrp")
    candidates = [group for group in groups if field(group, "SearchId", deep=False) in {utid, receipt_id} - {None}]
    need(len(candidates) == 1, "ACK_SEARCH_CONFLICT", "The acknowledgment must contain one result for the retained UTID or receipt.")
    result = candidates[0]
    transmissions = children(result, "TransmissionResultGrp")
    need(len(transmissions) == 1, "ACK_TRANSMISSION", "Choose a response with one transmission result.")
    trans = transmissions[0]
    status = field(trans, "TransmissionStatusCd", True)
    need(status in STATUSES, "ACK_STATUS", "The response contains an unsupported native transmission status.")
    returned = alternative(trans, ["UniqueTransmissionId", "TransmissionId"])
    need(status == "Not Found" or returned == utid, "TRANSMISSION_CONFLICT", "The acknowledgment belongs to another transmission.")
    receipt = field(trans, "ReceiptId") or receipt_id
    if receipt_id and field(trans, "ReceiptId"):
        need(receipt_id == field(trans, "ReceiptId"), "RECEIPT_CONFLICT", "The acknowledgment changed the retained receipt identity.")
    if receipt:
        identifier(receipt, "ReceiptId")
    submissions = []
    for submission in children(result, "SubmissionResultGrp"):
        sid = identifier(field(submission, "SubmissionId", True, deep=False), "SubmissionId")
        state = field(submission, "SubmissionStatusCd", True, deep=False)
        need(state in STATUSES, "ACK_STATUS", "The response contains an unsupported native submission status.")
        records = []
        for record in children(submission, "RecordResultGrp"):
            rid = identifier(field(record, "RecordId", True, deep=False), "RecordId")
            record_status = field(record, "RecordStatusCd", deep=False)
            need(record_status is None or record_status in STATUSES, "ACK_STATUS", "The response contains an unsupported native record status.")
            records.append({"recordId": rid, "status": record_status, "errors": native_errors(record)})
        need(len({row["recordId"] for row in records}) == len(records), "ACK_DUPLICATE_RECORD", "The acknowledgment repeats a record result.")
        submissions.append({"submissionId": sid, "status": state, "records": records, "errors": native_errors(submission)})
    need(len({row["submissionId"] for row in submissions}) == len(submissions), "ACK_DUPLICATE_SUBMISSION", "The acknowledgment repeats a submission result.")
    return {"schema": "ers-iris.ack.v1", "source": source, **identity, "kind": "acknowledgment", "utid": utid,
            "receiptId": receipt, "status": status, "submissions": submissions,
            "errors": native_errors(trans) + native_errors(result)}


def paired(trans, ack):
    need(isinstance(trans, dict) and trans.get("schema") == "ers-iris.transmission.v1" and
         isinstance(ack, dict) and ack.get("schema") == "ers-iris.ack.v1" and
         trans.get("manifest", {}).get("utid") == ack.get("utid"),
         "LINEAGE_BINDING", "Use a captured transmission and its correlated acknowledgment.")
    return {"transmission": trans, "ack": ack}


def failure_response(path, utid, http_status, operation):
    need(UTID.fullmatch(utid), "UTID_INVALID", "Choose the original transmission's native UTID.")
    need(400 <= http_status <= 599 or http_status == 200,
         "FAILURE_HTTP_STATUS", "Retain the actual HTTP response status.")
    raw, source = original_file(path, 8 * 1024 * 1024)
    messages, errors, receipt = [], [], None
    if raw.lstrip().startswith(b"{"):
        data = json.loads(raw)
        need(isinstance(data, dict) and ("status" not in data or data["status"] == http_status),
             "FAILURE_HTTP_CONFLICT", "The native response status differs from its captured HTTP status.")
        messages = [data[key] for key in ("error", "message") if isinstance(data.get(key), str)]
    else:
        root, _, _ = xml_source(path)
        errors = [{"code": field(item, "ErrorMessageCd"), "path": field(item, "ElementPathTxt")}
                  for item in descendants(root, "ErrorInformationGrp")]
        messages = [value(item) for item in descendants(root, "ErrorMessageTxt")]
        receipt = alternative(root, ["ReceiptId", "receiptId"])
        returned = alternative(root, ["UniqueTransmissionId", "TransmissionId"])
        need(not returned or returned == utid, "TRANSMISSION_CONFLICT", "The failure response belongs to another transmission.")
        statuses = [value(item).strip() for item in descendants(root, "TransmissionStatusCd")]
        need(not statuses or statuses == ["Rejected"], "FAILURE_STATUS", "Use the rejected response for a failure decision.")
    schema_error = any(re.search(r"\bXML\s+Schema\s+Validation\s+Error\b", message, re.I) for message in messages)
    classification = "xml-schema" if schema_error else "intake-client-error" if operation == "intake" and http_status == 400 else "outcome-unknown"
    return {"schema": "ers-iris.failure.v1", "source": source, "utid": utid,
            "httpStatus": http_status, "operation": operation, "receiptId": receipt,
            "classification": classification, "errors": errors,
            "lookupRequired": classification != "xml-schema"}


def state_for(pair, sid, rid=None):
    ack = pair["ack"]
    if ack["status"] == "Rejected":
        return "Rejected"
    if ack["status"] not in ACCEPTED | {"Partially Accepted"}:
        return None
    submission = next((row for row in ack["submissions"] if row["submissionId"] == sid), None)
    if submission:
        if submission["status"] == "Rejected":
            return "Rejected"
        record = next((row for row in submission.get("records", []) if row["recordId"] == rid), None)
        return (record or {}).get("status") or submission["status"]
    if ack["status"] in ACCEPTED:
        return ack["status"]
    return None


def record_rows(pair):
    for submission in pair["transmission"]["submissions"]:
        for record in submission["records"]:
            yield submission["submissionId"], record


def plan_decision(request):
    action = request.get("action")
    trans = request.get("transmission", {})
    need(trans.get("schema") == "ers-iris.transmission.v1", "LINEAGE_TRANSMISSION", "Choose a captured original transmission.")
    utid = trans["manifest"]["utid"]
    result = {"schema": "ers-iris.decision.v1", "action": action, "fromUtid": utid}
    if action == "recover-receipt":
        return {**result, "lookup": {"SearchParameterTypeCd": "UTID", "SearchId": utid},
                "requirements": ["Retrieve the original acknowledgment and retain its returned receipt."]}
    if action == "resend":
        need(request.get("reason") in {"pre-receipt", "xml-schema"}, "RESEND_REASON", "Retain the pre-receipt or XML-schema failure response before preparing a resend.")
        failure = request.get("failure", {})
        need(failure.get("schema") == "ers-iris.failure.v1" and failure.get("utid") == utid and
             SHA.fullmatch(failure.get("source", {}).get("sha256", "")),
             "RESEND_FAILURE_REQUIRED", "Bind the resend to its captured native failure response.")
        if request["reason"] == "xml-schema":
            need(failure.get("classification") == "xml-schema", "RESEND_REASON_CONFLICT", "Use the actual XML Schema Validation Error response.")
        else:
            observation = paired(trans, request.get("ack"))["ack"]
            need(failure.get("classification") == "intake-client-error" and observation["status"] == "Not Found",
                 "RESEND_LOOKUP_REQUIRED", "Retrieve the original UTID acknowledgment after the intake error and retain its Not Found result before preparing a new transmission.")
        return {**result, "transmissionType": trans["manifest"]["type"],
                "originalReceiptId": trans["manifest"].get("originalReceiptId"), "submissions": trans["submissions"],
                "requirements": ["Fix the recorded format/reception error.", "Allocate a new UniqueTransmissionId.", "Keep the same transmission type and complete intended records."]}
    if action == "legacy-correction":
        need(trans["manifest"]["type"] == "C" and SHA.fullmatch(request.get("legacyEvidenceSha256", "")),
             "LEGACY_EVIDENCE", "Bind the prepared correction to retained original-system evidence.")
        selected = request.get("selection")
        need(isinstance(selected, list) and selected, "CORRECTION_SELECTION", "Select the complete prepared correction records.")
        records = []
        for chosen in selected:
            matches = [(sid, row) for sid, row in record_rows({"transmission": trans})
                       if sid == chosen.get("submissionId") and row["recordId"] == chosen.get("recordId")]
            need(len(matches) == 1, "RECORD_SELECTION", "A selected record is absent from the retained transmission.")
            sid, row = matches[0]
            need(row["corrected"] and row["otherIntakeSystem"] in {"FIRE", "Third Party"},
                 "LEGACY_LINKAGE", "Retain the prior-system indicator/name for each selected corrected record and apply the current package's recipient-field rules.")
            records.append({"submissionId": sid, "recordId": row["recordId"], "OtherIntakeSystemInd": True,
                            "OtherIntakeSystemNm": row["otherIntakeSystem"],
                            "hasPreviousTin": row["hasPreviousTin"], "hasPreviousName": row["hasPreviousName"]})
        return {**result, "transmissionType": "C", "records": records, "legacyEvidenceSha256": request["legacyEvidenceSha256"],
                "requirements": ["Retain the complete previous recipient group and current schema validation with the corrected records."]}
    current = paired(trans, request.get("ack"))
    history = [paired(row.get("transmission"), row.get("ack")) for row in request.get("history", [])]
    by_utid = {}
    for pair in history + [current]:
        key = pair["ack"]["utid"]
        previous = by_utid.get(key)
        need(not previous or previous["transmission"]["source"] == pair["transmission"]["source"],
             "TRANSMISSION_CHANGED", "One UTID cannot identify different retained XML bytes.")
        by_utid[key] = pair
    history = list(by_utid.values())
    if action == "refile-original":
        need(trans["manifest"]["type"] in {"O", "R"} and current["ack"]["status"] in {"Rejected", "Partially Accepted"},
             "REFILE_STATUS", "A new original may contain only rejected original or replacement submissions.")
        selected_ids = request.get("submissionIds")
        if selected_ids is None:
            selected_ids = [row["submissionId"] for row in trans["submissions"]
                            if state_for(current, row["submissionId"]) == "Rejected"]
        need(isinstance(selected_ids, list) and selected_ids and len(set(selected_ids)) == len(selected_ids),
             "SUBMISSION_SELECTION", "Select distinct rejected submissions to file as a new original.")
        selected = [row for row in trans["submissions"] if row["submissionId"] in selected_ids]
        need(len(selected) == len(selected_ids) and all(state_for(current, row["submissionId"]) == "Rejected" for row in selected),
             "REFILE_ACCEPTED", "Include only submissions whose selected native acknowledgment is Rejected.")
        need(all(not row["corrected"] and not row.get("previousUniqueRecordId") and not row.get("otherIntakeSystem")
                 for group in selected for row in group["records"]),
             "REFILE_CORRECTION", "Rejected corrections retain type C and their prior accepted-record linkage.")
        return {**result, "transmissionType": "O", "filingDateTreatment": "new-original",
                "submissions": [{**row, "originalUniqueSubmissionId": None} for row in selected],
                "requirements": ["Allocate a new UniqueTransmissionId and remove replacement references.",
                                 "Include only the selected rejected submissions with their complete intended records.",
                                 "Treat this as a new original filing date; the replacement's 60-day original-date treatment does not apply."]}
    if action in {"correct", "wrong-form"}:
        selected = request.get("selection")
        need(isinstance(selected, list) and selected, "CORRECTION_SELECTION", "Select complete accepted records to correct.")
        need(current["ack"].get("receiptId"), "RECEIPT_REQUIRED", "Recover and retain the original receipt first.")
        records = []
        for chosen in selected:
            sid, rid = chosen.get("submissionId"), chosen.get("recordId")
            need(any(s == sid and row["recordId"] == rid for s, row in record_rows(current)),
                 "RECORD_SELECTION", "A selected record is absent from the retained transmission.")
            need(state_for(current, sid, rid) in ACCEPTED, "CORRECTION_STATUS", "Select an accepted record; rejected work follows replacement or resend.")
            link = f'{current["ack"]["receiptId"]}|{sid}|{rid}'
            selected_form = next(row["form"] for s, row in record_rows(current)
                                 if s == sid and row["recordId"] == rid)
            latest = {"utid": utid, "submissionId": sid, "recordId": rid,
                      "sourceSha256": trans["source"]["sha256"], "form": selected_form}
            visited = set()
            while True:
                need(link not in visited, "LINEAGE_CYCLE", "The retained accepted-correction chain contains a cycle.")
                visited.add(link)
                candidates = {}
                for pair in history:
                    if pair["transmission"]["manifest"]["type"] != "C":
                        continue
                    for next_sid, row in record_rows(pair):
                        if row.get("corrected") and row.get("previousUniqueRecordId") == link and state_for(pair, next_sid, row["recordId"]) in ACCEPTED:
                            need(pair["ack"].get("receiptId"), "RECEIPT_REQUIRED", "Recover the accepted correction's receipt.")
                            candidate = f'{pair["ack"]["receiptId"]}|{next_sid}|{row["recordId"]}'
                            candidates[candidate] = {"utid": pair["ack"]["utid"], "submissionId": next_sid,
                                                     "recordId": row["recordId"],
                                                     "form": row["form"],
                                                     "sourceSha256": pair["transmission"]["source"]["sha256"]}
                need(len(candidates) <= 1, "LINEAGE_BRANCH", "Reconcile competing accepted corrections before selecting their successor.")
                if not candidates:
                    break
                link, latest = next(iter(candidates.items()))
            records.append({"submissionId": sid, "recordId": rid, "UniqueRecordId": link,
                            "CorrectedInd": "1", "latestAcceptedSource": latest})
        need(len({row["UniqueRecordId"] for row in records}) == len(records), "DUPLICATE_SELECTION", "Select each accepted record once.")
        result.update(transmissionType="C", records=records, requirements=["Allocate a new UniqueTransmissionId.", "Prepare each complete corrected record and previous recipient group."])
        if action == "wrong-form":
            result["steps"] = [{"transmissionType": "C", "paymentAmounts": "0", "records": records},
                               {"afterStatus": "Accepted", "transmissionType": "O", "form": "correct form"}]
        return result
    need(action == "replace", "DECISION_ACTION", "Choose a supported recovery, resend, replacement or correction action.")
    need(current["ack"]["status"] in {"Rejected", "Partially Accepted"},
         "REPLACEMENT_STATUS", "A replacement requires a rejected original transmission or rejected submissions in a partially accepted transmission.")
    if trans["manifest"]["type"] == "C":
        selected_ids = request.get("submissionIds")
        if selected_ids is None:
            selected_ids = [row["submissionId"] for row in trans["submissions"]
                            if state_for(current, row["submissionId"]) == "Rejected"]
        need(isinstance(selected_ids, list) and selected_ids and len(set(selected_ids)) == len(selected_ids),
             "SUBMISSION_SELECTION", "Select distinct rejected correction submissions.")
        selected = [row for row in trans["submissions"] if row["submissionId"] in selected_ids]
        need(len(selected) == len(selected_ids) and all(state_for(current, row["submissionId"]) == "Rejected" for row in selected),
             "SUBMISSION_STATUS", "Resend only the rejected correction submissions.")
        return {**result, "transmissionType": "C", "submissions": selected,
                "requirements": ["Fix the selected rejected corrections and retain their accepted-record linkage.", "Allocate a new UniqueTransmissionId."]}
    receipts = {pair["ack"]["receiptId"]: pair for pair in history if pair["ack"].get("receiptId")}
    origin = current
    visited = set()
    while origin["transmission"]["manifest"].get("originalReceiptId"):
        ref = origin["transmission"]["manifest"]["originalReceiptId"]
        need(ref not in visited and ref in receipts, "REPLACEMENT_ORIGIN", "Retain the earliest rejected original transmission and its receipt.")
        visited.add(ref)
        origin = receipts[ref]
    if origin["ack"]["status"] == "Rejected" and not any(row.get("originalUniqueSubmissionId") for row in origin["transmission"]["submissions"]):
        need(origin["transmission"]["manifest"]["type"] == "O" and origin["ack"].get("receiptId"),
             "REPLACEMENT_ORIGIN", "Whole-transmission replacement must refer to the earliest rejected original.")
        ref = origin["ack"]["receiptId"]
        replacements = [pair for pair in history if pair["transmission"]["manifest"].get("originalReceiptId") == ref]
        need(not any(pair["ack"]["status"] in ACCEPTED for pair in replacements),
             "ALREADY_REPLACED", "This original transmission already has an accepted replacement.")
        partial = [pair for pair in replacements if pair["ack"]["status"] == "Partially Accepted"]
        need(not partial, "PARTIAL_REPLACEMENT_SCOPE",
             "A replacement already has accepted submissions. Select that partially accepted filing and choose refile-original for its rejected submissions, with new-original filing-date treatment.")
        return {**result, "transmissionType": "R", "originalReceiptId": ref,
                "submissions": origin["transmission"]["submissions"],
                "requirements": ["Allocate a new UniqueTransmissionId.", "Keep every original record and submission; omit OriginalUniqueSubmissionId."]}
    selected_ids = request.get("submissionIds")
    if selected_ids is None:
        selected_ids = [row["submissionId"] for row in trans["submissions"] if state_for(current, row["submissionId"]) == "Rejected"]
    need(isinstance(selected_ids, list) and selected_ids and len(set(selected_ids)) == len(selected_ids),
         "SUBMISSION_SELECTION", "Select distinct explicitly rejected submissions from the acknowledgment.")
    planned = []
    for sid in selected_ids:
        pair = current
        selected = next((row for row in pair["transmission"]["submissions"] if row["submissionId"] == sid), None)
        need(selected is not None and state_for(pair, sid) == "Rejected", "SUBMISSION_STATUS", "Select a rejected submission from the retained transmission.")
        visited = set()
        while selected.get("originalUniqueSubmissionId"):
            ref = selected["originalUniqueSubmissionId"]
            parts = ref.split("|")
            need(len(parts) == 2 and ref not in visited and parts[0] in receipts,
                 "SUBMISSION_ORIGIN", "Retain the earliest rejected original submission and acknowledgment.")
            visited.add(ref)
            pair = receipts[parts[0]]
            selected = next((row for row in pair["transmission"]["submissions"] if row["submissionId"] == parts[1]), None)
            need(selected is not None, "SUBMISSION_ORIGIN", "The original submission is absent from its retained transmission.")
        need(pair["transmission"]["manifest"]["type"] == "O" and pair["ack"]["status"] == "Partially Accepted" and
             state_for(pair, selected["submissionId"]) == "Rejected" and pair["ack"].get("receiptId"),
             "SUBMISSION_ORIGIN", "A submission replacement must trace to a rejected submission within a partially accepted original.")
        ref = f'{pair["ack"]["receiptId"]}|{selected["submissionId"]}'
        need(not any(row.get("originalUniqueSubmissionId") == ref and state_for(item, row["submissionId"]) in ACCEPTED
                     for item in history for row in item["transmission"]["submissions"]),
             "ALREADY_REPLACED", "This original submission already has an accepted replacement.")
        planned.append({**selected, "originalUniqueSubmissionId": ref})
    need(len({row["originalUniqueSubmissionId"] for row in planned}) == len(planned), "DUPLICATE_SELECTION", "Select each original rejected submission once.")
    return {**result, "transmissionType": "R", "submissions": planned,
            "requirements": ["Allocate a new UniqueTransmissionId.", "Retain every record of each selected original submission; omit OriginalReceiptId and new submissions."]}


def validate_prepared(request, planned, prepared):
    need(isinstance(prepared, dict) and prepared.get("schema") == "ers-iris.transmission.v1",
         "PREPARED_TRANSMISSION", "Capture the complete prepared child XML before validating its decision.")
    manifest = prepared["manifest"]
    need(planned.get("transmissionType") and manifest["type"] == planned["transmissionType"],
         "PREPARED_TYPE", "The prepared XML must use the decision's transmission type.")
    known = {request["transmission"]["manifest"]["utid"]} | {
        row["transmission"]["manifest"]["utid"] for row in request.get("history", [])}
    if planned["action"] != "legacy-correction":
        need(manifest["utid"] not in known, "PREPARED_UTID", "Allocate a new UTID for the prepared transmission.")
    need(manifest["taxYears"] == request["transmission"]["manifest"]["taxYears"],
         "PREPARED_TAX_YEAR", "The prepared XML must retain the selected filing's tax year.")
    need(manifest.get("originalReceiptId") == planned.get("originalReceiptId"),
         "PREPARED_RECEIPT", "The prepared XML must use exactly the decision's whole-transmission reference.")
    checks = ["transmission type", "transmission identity", "tax year", "whole-transmission reference"]
    if "submissions" in planned:
        expected = {}
        for group in planned["submissions"]:
            reference = group.get("originalUniqueSubmissionId") or group["submissionId"]
            for row in group["records"]:
                expected[(reference, row["recordId"])] = row
        mapping = request.get("preparedRecordMap", [])
        need(isinstance(mapping, list), "PREPARED_RECORD_MAP", "Use explicit child-to-source record mappings when renumbering records.")
        renamed = {}
        for item in mapping:
            key = (item.get("submissionId"), item.get("recordId"))
            source_key = (item.get("sourceSubmission"), item.get("sourceRecordId"))
            need(key not in renamed and source_key in expected, "PREPARED_RECORD_MAP", "Map each renumbered child record to one selected source record.")
            renamed[key] = source_key
        actual, visited_mapping, covered_groups = {}, set(), set()
        expected_refs = {group.get("originalUniqueSubmissionId") for group in planned["submissions"]} - {None}
        child_refs = {group.get("originalUniqueSubmissionId") for group in prepared["submissions"]} - {None}
        need(child_refs == expected_refs and (not expected_refs or all(group.get("originalUniqueSubmissionId") for group in prepared["submissions"])),
             "PREPARED_SUBMISSION_REFERENCE", "Retain exactly the selected original-submission references.")
        for group in prepared["submissions"]:
            reference = group.get("originalUniqueSubmissionId") or group["submissionId"]
            group_sources = set()
            for row in group["records"]:
                key = (group["submissionId"], row["recordId"])
                source_key = renamed.get(key, (reference, row["recordId"]))
                if key in renamed:
                    visited_mapping.add(key)
                need(source_key in expected and source_key not in actual,
                     "PREPARED_MEMBERSHIP", "The prepared XML must contain each selected source record exactly once.")
                original = expected[source_key]
                need(row["form"] == original["form"] and row["corrected"] == original["corrected"] and
                     row.get("previousUniqueRecordId") == original.get("previousUniqueRecordId") and
                     row.get("otherIntakeSystem") == original.get("otherIntakeSystem"),
                     "PREPARED_RECORD_LINKAGE", "Retain each selected record's form, correction flag and prior-record or system reference.")
                if expected_refs:
                    need(group.get("originalUniqueSubmissionId") == source_key[0],
                         "PREPARED_SUBMISSION_REFERENCE", "Keep each record in its selected original-submission replacement.")
                actual[source_key] = row
                group_sources.add(source_key[0])
            need(len(group_sources) == 1 and not (group_sources & covered_groups),
                 "PREPARED_SUBMISSION_MEMBERSHIP", "Preserve one complete selected source submission in each child submission.")
            covered_groups.update(group_sources)
        need(set(actual) == set(expected) and visited_mapping == set(renamed),
             "PREPARED_MEMBERSHIP", "The prepared XML and renumbering map must cover every selected source record exactly once.")
        checks += ["submission references", "record and form membership", "record correction references"]
    elif planned["action"] in {"correct", "wrong-form"}:
        expected = {row["UniqueRecordId"]: row for row in planned["records"]}
        actual = {}
        for group in prepared["submissions"]:
            need(not group.get("originalUniqueSubmissionId"), "PREPARED_SUBMISSION_REFERENCE", "A correction does not use replacement-submission references.")
            for row in group["records"]:
                key = row.get("previousUniqueRecordId")
                need(row["corrected"] and key in expected and key not in actual and not row.get("otherIntakeSystem"),
                     "PREPARED_CORRECTION_REFERENCE", "Correct each selected latest accepted IRIS record exactly once.")
                need(row["form"] == expected[key]["latestAcceptedSource"]["form"],
                     "PREPARED_CORRECTION_FORM", "Retain the accepted record's form type in the correction.")
                actual[key] = row
        need(set(actual) == set(expected), "PREPARED_MEMBERSHIP", "Include every selected correction record.")
        checks += ["latest accepted record references", "correction flags", "record and form membership"]
    elif planned["action"] == "legacy-correction":
        expected = {(row["submissionId"], row["recordId"]): row for row in planned["records"]}
        actual = {(sid, row["recordId"]): row for sid, row in record_rows({"transmission": prepared})}
        need(set(actual) == set(expected), "PREPARED_MEMBERSHIP", "Include exactly the selected prior-system correction records.")
        need(all(actual[key]["corrected"] and actual[key]["otherIntakeSystem"] == row["OtherIntakeSystemNm"]
                 for key, row in expected.items()), "PREPARED_LEGACY_REFERENCE", "Retain the selected prior-system correction linkage.")
        checks += ["prior-system references", "correction flags", "selected record membership"]
    return {"utid": manifest["utid"], "source": prepared["source"],
            "schemaValidation": prepared["schemaValidation"], "checks": checks,
            "recordCount": prepared["recordCount"]}


def decision(request):
    planned = plan_decision(request)
    if request.get("preparedTransmission") is not None:
        planned["preparedValidation"] = validate_prepared(request, planned, request["preparedTransmission"])
    return planned


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("transmission", "extract", "ack", "failure", "plan"):
        current = sub.add_parser(command)
        current.add_argument("--input", required=True)
        if command in {"transmission", "extract"}:
            current.add_argument("--xsd")
            current.add_argument("--schema-root")
        if command == "extract":
            current.add_argument("--mapping", required=True)
            current.add_argument("--output", required=True)
        if command in {"ack", "failure"}:
            current.add_argument("--utid", required=True)
        if command == "ack":
            current.add_argument("--receipt-id")
        if command == "failure":
            current.add_argument("--http-status", required=True, type=int)
            current.add_argument("--operation", required=True, choices=("intake", "acknowledgment"))
    args = parser.parse_args(argv)
    try:
        if args.command == "transmission":
            result = transmission(args.input, args.xsd, args.schema_root)
        elif args.command == "extract":
            result = extract(args.input, args.mapping, args.output, args.xsd, args.schema_root)
        elif args.command == "ack":
            result = acknowledgment(args.input, args.utid, args.receipt_id)
        elif args.command == "failure":
            result = failure_response(args.input, args.utid, args.http_status, args.operation)
        else:
            raw, _ = original_file(args.input, 128 * 1024 * 1024)
            result = decision(json.loads(raw))
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except IrisError as error:
        result = {"error": {"code": error.code, "message": str(error)}}
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RecursionError):
        result = {"error": {"code": "INPUT_INVALID", "message": "Check the original file, mapping and retained domain input structure."}}
    print(json.dumps(result))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
