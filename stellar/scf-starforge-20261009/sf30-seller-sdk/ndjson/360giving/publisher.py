#!/usr/bin/env python3
"""Prepare, review and receive complete 360Giving publisher editions."""
from __future__ import annotations
import argparse
import datetime as dt
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile
import zipfile

FORMAT = "stellar-forge.360giving-publisher.v1"
DECISIONS = "stellar-forge.360giving-decisions.v1"
HERE = Path(__file__).resolve().parent
MAX_BYTES = 256 * 1024 * 1024
PENDING_PREFIX = ".360giving-pending-"
RECEIVING_INTENT = ".360giving-receiving.json"

class PublisherError(Exception):
    pass

class ExactNumber(Decimal):
    def __new__(cls, token):
        value = super().__new__(cls, token)
        value.token = token
        return value

def fail(message):
    raise PublisherError(message)

def need(value, message):
    if not value:
        fail(message)

def pairs(values):
    result = {}
    for key, value in values:
        need(key not in result, "Duplicate JSON member: " + key)
        result[key] = value
    return result

def reject_constant(value):
    fail("Non-finite JSON number: " + value)

def parse(text):
    return json.loads(text, parse_int=ExactNumber, parse_float=ExactNumber,
                      object_pairs_hook=pairs, parse_constant=reject_constant)

def exact(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, ExactNumber):
        need(value.is_finite(), "Non-finite number")
        return value.token
    if isinstance(value, Decimal):
        need(value.is_finite(), "Non-finite number")
        return str(value)
    if isinstance(value, (int, float)):
        return json.dumps(value, allow_nan=False)
    if isinstance(value, str):
        value.encode("utf-8")
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(exact(item) for item in value) + "]"
    if isinstance(value, dict):
        need(all(isinstance(k, str) for k in value), "JSON object keys must be strings")
        return "{" + ",".join(exact(k) + ":" + exact(v) for k, v in value.items()) + "}"
    fail("Unsupported value: " + type(value).__name__)

def raw_file(path):
    path = Path(path)
    need(path.is_file() and not path.is_symlink(), "Use a regular local file: " + str(path))
    need(path.stat().st_size <= MAX_BYTES, "File exceeds the 256 MiB input limit")
    data = path.read_bytes()
    need(len(data) <= MAX_BYTES, "File exceeds the 256 MiB input limit")
    return data

def json_file(path):
    return parse(raw_file(path).decode("utf-8-sig"))

def digest(data):
    return hashlib.sha256(data).hexdigest()

def blob_id(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()

def publish_file(path, write):
    """Publish one fully synced original file without replacing a final path."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=PENDING_PREFIX, dir=path.parent)
    try:
        with os.fdopen(descriptor, "w+b") as handle:
            write(handle)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            need(raw_file(path) == raw_file(temporary),
                 "Existing edition has different bytes: " + str(path))
        if os.name == "posix":
            directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)

def write_exact(path, data):
    path = Path(path)
    if path.exists():
        need(raw_file(path) == data, "Existing edition has different bytes: " + str(path))
        return
    publish_file(path, lambda handle: handle.write(data))

def write_json(path, value):
    write_exact(path, (exact(value) + "\n").encode("utf-8"))

def pointer(parts):
    return "/" + "/".join(str(p).replace("~", "~0").replace("/", "~1") for p in parts)

def schema_errors(package, schema_root):
    try:
        from jsonschema import Draft202012Validator, FormatChecker, validators
        from referencing import Registry, Resource
        from referencing.jsonschema import DRAFT202012
    except ImportError as error:
        fail("Install this profile's requirements.txt with the selected Python: " + str(error))
    index = json_file(Path(schema_root) / "schema-sources.json")
    resources = []
    required_formats = set()
    selected = None
    for row in index["schemas"]:
        data = raw_file(Path(schema_root) / row["file"])
        need(blob_id(data) == row["gitBlob"], "Official schema bytes changed: " + row["file"])
        document = json.loads(data)
        pending = [document]
        while pending:
            value = pending.pop()
            if isinstance(value, dict):
                if isinstance(value.get("format"), str):
                    required_formats.add(value["format"])
                pending.extend(value.values())
            elif isinstance(value, list):
                pending.extend(value)
        resource = Resource(contents=document, specification=DRAFT202012)
        # The official 1.4.2 document has no $id; its captured URL is still its URI.
        resources.append((row["url"], resource))
        identifier = resource.id()
        if identifier is not None:
            resources.append((identifier, resource))
        for alias in row.get("aliases", []):
            resources.append((alias, resource))
        if row["role"] == "package":
            selected = document
    need(selected is not None, "Package schema is missing")
    format_checker = FormatChecker()
    missing_formats = sorted(required_formats.difference(format_checker.checkers))
    need(not missing_formats,
         "The selected Python is missing official schema format checkers: "
         + ", ".join(missing_formats)
         + ". Install the declared jsonschema[format-nongpl] extra with the same interpreter: "
         + json.dumps([sys.executable, "-m", "pip", "install", "-r", str(HERE / "requirements.txt")])
         + "; then repeat the original command.")
    number_types = Draft202012Validator.TYPE_CHECKER.redefine(
        "integer", lambda checker, value: (
            isinstance(value, int) and not isinstance(value, bool)) or (
            isinstance(value, Decimal) and value.is_finite() and value == value.to_integral_value()))
    Validator = validators.extend(Draft202012Validator, type_checker=number_types)
    validator = Validator(selected, registry=Registry().with_resources(resources),
                          format_checker=format_checker)
    errors = sorted(validator.iter_errors(package), key=lambda e: (pointer(e.absolute_path), e.message))
    return [{"path": pointer(e.absolute_path), "rule": str(e.validator),
             "message": e.message, "schemaPath": pointer(e.absolute_schema_path)}
            for e in errors]

def number_text(value):
    return value.token if isinstance(value, ExactNumber) else str(value)

def registry_metadata(registry):
    publisher = registry.get("publisher", {})
    distribution = registry.get("distribution", [{}])[0]
    result = {
        "title": registry.get("title"),
        "description": registry.get("description"),
        "publisher": {"name": publisher.get("name"), "identifier": publisher.get("org_id"),
                      "website": publisher.get("website")},
        "license": registry.get("license"),
        "downloadURL": distribution.get("downloadURL"),
        "accessURL": distribution.get("accessURL")
    }
    result["publisher"] = {k: v for k, v in result["publisher"].items() if v}
    return {k: v for k, v in result.items() if v}

def make_report(package, registry, receipt, errors):
    need(isinstance(package, dict) and isinstance(package.get("grants"), list),
         "The source must be a complete JSON package with a grants array")
    grants = package["grants"]
    need(all(isinstance(g, dict) for g in grants), "Every grants entry must be an object")
    findings, rows, counts, totals = [], [], {}, {}
    prefix = registry.get("publisher", {}).get("prefix", "")
    def finding(code, index, grant, path, message):
        key = code + "\0" + str(grant.get("id", index)) + "\0" + path
        findings.append({"id": hashlib.sha256(key.encode("utf-8")).hexdigest()[:24],
                         "code": code, "grantId": grant.get("id"), "path": path,
                         "message": message})
    for index, grant in enumerate(grants):
        identifier = grant.get("id")
        counts[str(identifier)] = counts.get(str(identifier), 0) + 1
        if prefix and isinstance(identifier, str) and not identifier.startswith(prefix + "-"):
            finding("GRANT_PREFIX", index, grant, pointer(["grants", index, "id"]),
                    "Confirm the original grant identifier against the registered publisher prefix " + prefix + ".")
        award, modified = grant.get("awardDate"), grant.get("dateModified")
        if isinstance(award, str) and isinstance(modified, str) and award[:10] > modified[:10]:
            finding("DATE_SEQUENCE", index, grant, pointer(["grants", index, "awardDate"]),
                    "The award date is later than the record's modification date. Confirm the publisher's dates; retain the source until an explicit correction is supplied.")
        organizations = grant.get("recipientOrganization", [])
        for oi, organization in enumerate(organizations):
            org_id = organization.get("id") if isinstance(organization, dict) else None
            if isinstance(org_id, str) and not re.match(r"^(?:[A-Z]{2}-[A-Za-z0-9]+-.+|360G-.+)$", org_id):
                finding("ORGANIZATION_IDENTIFIER", index, grant,
                        pointer(["grants", index, "recipientOrganization", oi, "id"]),
                        "Confirm the identifier scheme for " + org_id + " against the publisher's organisation mapping.")
        currency, amount = grant.get("currency"), grant.get("amountAwarded")
        if isinstance(currency, str) and isinstance(amount, (int, Decimal)) and not isinstance(amount, bool):
            totals[currency] = totals.get(currency, Decimal(0)) + amount
        recipient = organizations[0] if organizations and isinstance(organizations[0], dict) else {}
        rows.append({"id": str(identifier), "title": str(grant.get("title", "")),
                     "recipient": str(recipient.get("name", "")),
                     "recipientId": str(recipient.get("id", "")),
                     "currency": str(currency or ""), "amountAwarded": number_text(amount) if amount is not None else "",
                     "amountAppliedFor": number_text(grant["amountAppliedFor"]) if "amountAppliedFor" in grant else "",
                     "awardDate": str(award or ""), "dateModified": str(modified or ""),
                     "rawJson": exact(grant)})
    duplicate_ids = [key for key, count in counts.items() if count > 1]
    for identifier in duplicate_ids:
        findings.append({"id": hashlib.sha256(("DUPLICATE_GRANT_ID\0" + identifier).encode()).hexdigest()[:24],
                         "code": "DUPLICATE_GRANT_ID", "grantId": identifier, "path": "/grants",
                         "message": "This grant identifier occurs more than once. Resolve the publisher identity before keyed edition comparison."})
    return {"schema": FORMAT, "source": receipt, "datasetTitle": registry.get("title", "360Giving publisher edition"),
            "publisher": registry.get("publisher", {}), "license": registry.get("license"),
            "grantCount": len(grants), "currencyTotals": {k: str(v) for k, v in sorted(totals.items())},
            "schemaErrors": errors, "findings": findings, "duplicateGrantIds": duplicate_ids,
            "nativeInputReady": not errors and not duplicate_ids,
            "registryMetadata": registry_metadata(registry), "rows": rows}

def mapping(registry):
    def col(name, path, **extra):
        return {"name": name, "path": path, "type": "string", **extra}
    columns = [
        col("grant_id", ["id"]), col("title", ["title"]), col("description", ["description"]),
        col("currency", ["currency"]), col("amount_awarded", ["amountAwarded"]),
        col("amount_applied_for", ["amountAppliedFor"], nullable=True, missing="null"),
        col("amount_applied_state", ["amountAppliedFor"], mode="state"),
        col("award_date", ["awardDate"]),
        col("modified_at", ["dateModified"], nullable=True, missing="null"),
        col("modified_state", ["dateModified"], mode="state"),
        col("recipient_name", ["recipientOrganization", 0, "name"], nullable=True, missing="null"),
        col("recipient_name_state", ["recipientOrganization", 0, "name"], mode="state"),
        col("recipient_id", ["recipientOrganization", 0, "id"], nullable=True, missing="null"),
        col("recipient_id_state", ["recipientOrganization", 0, "id"], mode="state"),
        col("recipients", ["recipientOrganization"], mode="json", missing="null"),
        col("recipients_state", ["recipientOrganization"], mode="state"),
        col("recipient_individual", ["recipientIndividual"], mode="json", missing="null"),
        col("recipient_individual_state", ["recipientIndividual"], mode="state"),
        col("funders", ["fundingOrganization"], mode="json"),
        col("programmes", ["grantProgramme"], mode="json", missing="null"),
        col("programmes_state", ["grantProgramme"], mode="state"),
        col("locations", ["beneficiaryLocation"], mode="json", missing="null"),
        col("locations_state", ["beneficiaryLocation"], mode="state"),
        col("source_url", ["dataSource"], nullable=True, missing="null"),
        col("source_url_state", ["dataSource"], mode="state"),
        col("original_grant", [], mode="json")
    ]
    return {"schema": "stellar-forge.ndjson-mapping.v1",
            "name": registry.get("title", "360Giving grants")[:128], "recordPath": [],
            "columns": columns, "filters": ["grant_id", "currency", "recipient_id"],
            "ranges": ["award_date"], "sorts": ["grant_id", "award_date", "title"],
            "keys": ["grant_id"], "allowEmpty": False}

def artifact_files(directory):
    result = []
    for path in sorted(Path(directory).rglob("*")):
        if path.is_file():
            need(not path.is_symlink(), "Receiving source must contain regular files")
            relative = path.relative_to(directory).as_posix()
            if relative in ("manifest.json", RECEIVING_INTENT) or path.name.startswith(PENDING_PREFIX):
                continue
            data = raw_file(path)
            result.append({"path": relative, "bytes": len(data), "sha256": digest(data)})
    return result

def verify_workspace(directory):
    directory = Path(directory)
    manifest = json_file(directory / "manifest.json")
    need(manifest.get("schema") == FORMAT, "Unsupported publisher receiving manifest")
    expected = manifest["files"]
    actual = artifact_files(directory)
    need(exact(expected) == exact(actual), "Receiving file inventory or bytes differ from the original manifest")
    return manifest

def render_review(report, decisions, operator_root):
    operator_root = Path(operator_root)
    html = raw_file(operator_root / "review.html").decode("utf-8")
    payload = exact({"report": report, "template": decisions}).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    html = html.replace("__PUBLISHER_DATA__", payload)
    html = html.replace("__PUBLISHER_CSS__", raw_file(operator_root / "review.css").decode("utf-8"))
    html = html.replace("__PUBLISHER_JS__", raw_file(operator_root / "review.js").decode("utf-8"))
    return html.encode("utf-8")

def prepare(args):
    source = raw_file(args.source)
    package = parse(source.decode("utf-8-sig"))
    registry = json_file(args.registry)
    capture = json_file(args.capture) if args.capture else {}
    directory = Path(args.out).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    previous = json_file(directory / "source.json") if (directory / "source.json").exists() else None
    receipt = {"schema": FORMAT, "sourceUrl": args.source_url, "sha256": digest(source), "bytes": len(source),
               "captured": capture, "preparedAt": previous["preparedAt"] if previous else dt.datetime.now(dt.timezone.utc).isoformat()}
    if args.transport:
        transport = raw_file(args.transport)
        receipt["transport"] = {"file": "source/transport.bin", "sha256": digest(transport), "bytes": len(transport)}
        write_exact(directory / "source/transport.bin", transport)
    write_exact(directory / "source/original-package.json", source)
    write_json(directory / "source.json", receipt)
    write_json(directory / "registry.json", registry)
    schema_root = HERE / "schemas"
    errors = schema_errors(package, schema_root)
    report = make_report(package, registry, receipt, errors)
    write_json(directory / "report.json", report)
    write_json(directory / "mapping.json", mapping(registry))
    write_exact(directory / "grants.ndjson", ("\n".join(exact(g) for g in package["grants"]) + "\n").encode("utf-8"))
    decisions = {"schema": DECISIONS, "sourceSha256": receipt["sha256"], "reviewer": "",
                 "reviewedAt": "", "reviews": [], "metadataFromRegistry": [], "changes": []}
    write_json(directory / "decisions-template.json", decisions)
    for relative in ["publisher.py", "cli.mjs", "review.html", "review.js", "review.css", "README.md", "requirements.txt", "ATTRIBUTION.md"]:
        write_exact(directory / "operator" / relative, raw_file(HERE / relative))
    for path in sorted(schema_root.iterdir()):
        if path.is_file():
            write_exact(directory / "operator/schemas" / path.name, raw_file(path))
    write_exact(directory / "review.html", render_review(report, decisions, HERE))
    manifest = {"schema": FORMAT, "sourceSha256": receipt["sha256"], "grantCount": len(package["grants"]),
                "nativeInputReady": report["nativeInputReady"], "files": artifact_files(directory)}
    write_json(directory / "manifest.json", manifest)
    print(exact({"directory": str(directory), "sourceSha256": receipt["sha256"],
                 "grantCount": report["grantCount"], "currencyTotals": report["currencyTotals"],
                 "schemaErrors": len(errors), "reviewQuestions": len(report["findings"]),
                 "nativeInputReady": report["nativeInputReady"], "files": len(manifest["files"])}))
    return 0 if report["nativeInputReady"] else 2

def resolve_parent(grant, path):
    need(isinstance(path, str) and path.startswith("/") and path != "/", "A correction requires a non-root JSON pointer")
    tokens = [token.replace("~1", "/").replace("~0", "~") for token in path[1:].split("/")]
    target = grant
    for token in tokens[:-1]:
        if isinstance(target, list):
            need(token.isdigit() and int(token) < len(target), "Correction array path does not exist")
            target = target[int(token)]
        else:
            need(isinstance(target, dict) and token in target, "Correction object path does not exist")
            target = target[token]
    key = tokens[-1]
    if isinstance(target, list):
        need(key.isdigit() and int(key) < len(target), "Correction array item does not exist")
        return target, int(key)
    need(isinstance(target, dict), "Correction parent is not an object")
    return target, key

def candidate(args):
    original = Path(args.workspace).resolve()
    manifest = verify_workspace(original)
    decisions = json_file(args.decisions)
    need(decisions.get("schema") == DECISIONS and decisions.get("sourceSha256") == manifest["sourceSha256"],
         "Review decisions must select this exact source edition")
    need(isinstance(decisions.get("reviewer"), str) and decisions["reviewer"].strip(), "Name the operator making these review decisions")
    package = json_file(original / "source/original-package.json")
    registry = json_file(original / "registry.json")
    grant_index = {}
    for grant in package["grants"]:
        need(grant.get("id") not in grant_index, "Resolve duplicate grant identifiers in the original source before applying keyed changes")
        grant_index[grant.get("id")] = grant
    applied = []
    for change in decisions.get("changes", []):
        need(change.get("grantId") in grant_index, "Correction selects an unknown original grant")
        need(isinstance(change.get("reason"), str) and change["reason"].strip(), "Every correction requires a reason")
        need(isinstance(change.get("sourceReference"), str) and change["sourceReference"].strip(), "Every correction requires its publisher/source reference")
        target, key = resolve_parent(grant_index[change["grantId"]], change["path"])
        operation = change.get("operation", "replace")
        exists = key < len(target) if isinstance(target, list) else key in target
        need(operation in ("add", "replace", "remove"), "Unsupported correction operation")
        if operation == "add":
            need(not isinstance(target, list) and not exists, "Add requires a missing object member")
        else:
            need(exists and isinstance(change.get("expectedJson"), str), "Supply the original expected JSON value")
            need(exact(target[key]) == exact(parse(change["expectedJson"])), "Correction's original value differs from this edition")
        if operation == "remove":
            del target[key]
        else:
            need(isinstance(change.get("replacementJson"), str), "Supply replacementJson as an exact JSON text string")
            target[key] = parse(change["replacementJson"])
        applied.append(change)
    metadata = registry_metadata(registry)
    selected_metadata = decisions.get("metadataFromRegistry", [])
    need(isinstance(selected_metadata, list) and all(k in metadata for k in selected_metadata),
         "Select only metadata present in the retained original registry record")
    for key in selected_metadata:
        need(key not in package or exact(package[key]) == exact(metadata[key]),
             "Existing package metadata differs; retain it or supply an explicit publisher correction")
        package[key] = metadata[key]
    errors = schema_errors(package, original / "operator/schemas")
    need(not errors, "Candidate fails the original official schema: " + exact(errors))
    directory = Path(args.out).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    need(directory != original and original not in directory.parents, "Create the candidate outside the retained original edition")
    candidate_bytes = (exact(package) + "\n").encode("utf-8")
    write_exact(directory / "candidate-package.json", candidate_bytes)
    write_exact(directory / "grants.ndjson", ("\n".join(exact(g) for g in package["grants"]) + "\n").encode("utf-8"))
    write_exact(directory / "mapping.json", raw_file(original / "mapping.json"))
    write_exact(directory / "decisions.json", raw_file(args.decisions))
    write_json(directory / "candidate.json", {"schema": FORMAT, "parentSourceSha256": manifest["sourceSha256"],
               "candidateSha256": digest(candidate_bytes), "candidateBytes": len(candidate_bytes),
               "reviewer": decisions["reviewer"], "metadataFromRegistry": selected_metadata,
               "grantCorrections": len(applied), "grantCount": len(package["grants"]),
               "sourceWorkspace": str(original)})
    print(exact({"directory": str(directory), "candidateSha256": digest(candidate_bytes),
                 "grantCount": len(package["grants"]), "grantCorrections": len(applied),
                 "metadataFields": selected_metadata, "schemaErrors": 0}))
    return 0

def export(args):
    directory = Path(args.workspace).resolve()
    original_manifest = verify_workspace(directory)
    destination = Path(args.out).resolve()
    need(directory not in destination.parents, "Export outside the retained source edition")
    content = {row["path"]: raw_file(directory / row["path"])
               for row in original_manifest["files"]}
    manifest = {key: value for key, value in original_manifest.items() if key != "files"}
    decisions_path = getattr(args, "decisions", None)
    candidate_path = getattr(args, "candidate", None)
    need(not candidate_path or decisions_path, "Include the original decisions with the selected candidate")
    if decisions_path:
        decision_bytes = raw_file(decisions_path)
        decisions = parse(decision_bytes.decode("utf-8-sig"))
        need(decisions.get("schema") == DECISIONS and
             decisions.get("sourceSha256") == manifest["sourceSha256"],
             "Receiving decisions must select this original source edition")
        need(isinstance(decisions.get("reviewer"), str) and decisions["reviewer"].strip(),
             "Name the operator whose review is being handed over")
        content["review/decisions.json"] = decision_bytes
        content["review.html"] = render_review(json_file(directory / "report.json"),
                                              decisions, directory / "operator")
        manifest["review"] = {"decisions": "review/decisions.json",
                              "reviewer": decisions["reviewer"],
                              "sha256": digest(decision_bytes)}
        if candidate_path:
            selected = Path(candidate_path).resolve()
            candidate_identity = json_file(selected / "candidate.json")
            candidate_bytes = raw_file(selected / "candidate-package.json")
            need(candidate_identity.get("schema") == FORMAT and
                 candidate_identity.get("parentSourceSha256") == manifest["sourceSha256"] and
                 candidate_identity.get("candidateSha256") == digest(candidate_bytes) and
                 candidate_identity.get("candidateBytes") == len(candidate_bytes),
                 "Receiving candidate differs from its original source and saved identity")
            need(raw_file(selected / "decisions.json") == decision_bytes,
                 "Receiving candidate and selected operator decisions differ")
            need(raw_file(selected / "mapping.json") == content["mapping.json"],
                 "Receiving candidate must retain the original native mapping")
            candidate_package = parse(candidate_bytes.decode("utf-8-sig"))
            need(len(candidate_package["grants"]) == candidate_identity["grantCount"],
                 "Receiving candidate grant count differs")
            expected_lines = ("\n".join(exact(g) for g in candidate_package["grants"]) + "\n").encode("utf-8")
            need(raw_file(selected / "grants.ndjson") == expected_lines,
                 "Receiving candidate JSON Lines differ from the complete package")
            for row in artifact_files(selected):
                content["candidate/" + row["path"]] = raw_file(selected / row["path"])
            manifest["review"]["candidate"] = "candidate/candidate-package.json"
            manifest["review"]["candidateSha256"] = digest(candidate_bytes)
    manifest["files"] = [{"path": name, "bytes": len(data), "sha256": digest(data)}
                         for name, data in sorted(content.items())]
    manifest_bytes = (exact(manifest) + "\n").encode("utf-8")
    need(sum(len(data) for data in content.values()) + len(manifest_bytes) <= MAX_BYTES,
         "Complete receiving package exceeds the 256 MiB input limit")
    complete = {**content, "manifest.json": manifest_bytes}
    if destination.exists():
        data = raw_file(destination)
        _, previous = archive_content(data)
        need(previous == complete, "Existing receiving ZIP contains a different original edition or review")
    else:
        def write_archive(handle):
            with zipfile.ZipFile(handle, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for name, data in sorted(complete.items()):
                    entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    entry.create_system = 3
                    entry.external_attr = (0o100600 << 16)
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(entry, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        publish_file(destination, write_archive)
        data = raw_file(destination)
    print(exact({"file": str(destination), "bytes": len(data), "sha256": digest(data),
                 "members": len(manifest["files"]) + 1, "sourceSha256": manifest["sourceSha256"],
                 "review": manifest.get("review")}))
    return 0

def archive_content(payload):
    """Validate the exact captured archive bytes before changing a receiver."""
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        members = archive.infolist()
        names = [row.filename for row in members]
        need(len(names) == len(set(names)) and "manifest.json" in names,
             "Invalid complete receiving member list")
        need(sum(row.file_size for row in members) <= MAX_BYTES,
             "Receiving package exceeds the original limit")
        for row in members:
            path = PurePosixPath(row.filename)
            need(not path.is_absolute() and path.as_posix() == row.filename and
                 all(part not in ("", ".", "..") for part in path.parts) and "\\" not in row.filename,
                 "Invalid receiving member path")
            need(row.filename != RECEIVING_INTENT and
                 not any(part.startswith(PENDING_PREFIX) for part in path.parts),
                 "Receiving package uses a reserved operation path")
            need(not row.is_dir() and (row.external_attr >> 16) & 0o170000 != 0o120000
                 and not row.flag_bits & 1, "Receiving package contains an unsupported member")
        manifest_bytes = archive.read("manifest.json")
        manifest = parse(manifest_bytes.decode("utf-8"))
        need(manifest.get("schema") == FORMAT and isinstance(manifest.get("files"), list),
             "Unsupported receiving package schema")
        expected = {row["path"]: row for row in manifest["files"]}
        need(len(expected) == len(manifest["files"]) and "manifest.json" not in expected and
             set(names) == set(expected) | {"manifest.json"},
             "Receiving package has missing, repeated or undeclared files")
        content = {"manifest.json": manifest_bytes}
        for name, row in expected.items():
            data = archive.read(name)
            need(len(data) == row["bytes"] and digest(data) == row["sha256"],
                 "Receiving content differs: " + name)
            content[name] = data
        return manifest, content

def receive(args):
    archive_path = Path(args.file).resolve()
    directory = Path(args.out).resolve()
    payload = raw_file(archive_path)
    manifest, content = archive_content(payload)
    intent = {"schema": FORMAT + ".receiving", "archiveSha256": digest(payload),
              "archiveBytes": len(payload), "sourceSha256": manifest["sourceSha256"]}
    reused = False
    if directory.exists():
        need(directory.is_dir() and not directory.is_symlink(), "Use the original receiving directory")
        retained_intent = (directory / RECEIVING_INTENT).exists()
        if retained_intent:
            need(exact(json_file(directory / RECEIVING_INTENT)) == exact(intent),
                 "Continue the original archive selected for this receiving directory")
        if (directory / "manifest.json").exists():
            verify_workspace(directory)
            need(all(raw_file(directory / name) == data for name, data in content.items()),
                 "The completed receiver contains a different original archive")
            reused = True
        elif not retained_intent:
            need(all(path.name.startswith(PENDING_PREFIX) and path.is_file() and not path.is_symlink()
                     for path in directory.iterdir()),
                 "Select a new directory or the same original receiving operation")
    else:
        directory.mkdir(parents=True)
    if not reused:
        write_json(directory / RECEIVING_INTENT, intent)
        for name, data in content.items():
            if name != "manifest.json":
                write_exact(directory / name, data)
        # The complete manifest is published after every original member.
        write_exact(directory / "manifest.json", content["manifest.json"])
    reopened = verify_workspace(directory)
    print(exact({"directory": str(directory), "archiveSha256": digest(payload),
                 "sourceSha256": reopened["sourceSha256"], "grantCount": reopened["grantCount"],
                 "files": len(reopened["files"]), "nativeInputReady": reopened["nativeInputReady"],
                 "reused": reused}))
    return 0

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--source", required=True)
    p.add_argument("--source-url", required=True)
    p.add_argument("--registry", required=True)
    p.add_argument("--capture")
    p.add_argument("--transport")
    p.add_argument("--out", required=True)
    p = sub.add_parser("candidate")
    p.add_argument("--workspace", required=True)
    p.add_argument("--decisions", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("export")
    p.add_argument("--workspace", required=True)
    p.add_argument("--decisions")
    p.add_argument("--candidate")
    p.add_argument("--out", required=True)
    p = sub.add_parser("receive")
    p.add_argument("--file", required=True)
    p.add_argument("--out", required=True)
    args = parser.parse_args()
    try:
        return {"prepare": prepare, "candidate": candidate, "export": export, "receive": receive}[args.command](args)
    except (PublisherError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(exact({"error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
