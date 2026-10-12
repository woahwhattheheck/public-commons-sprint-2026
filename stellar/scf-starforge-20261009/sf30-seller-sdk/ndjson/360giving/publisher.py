#!/usr/bin/env python3
"""Prepare, review and receive complete 360Giving publisher editions."""
from __future__ import annotations
import argparse
import datetime as dt
from decimal import Decimal
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile

FORMAT = "stellar-forge.360giving-publisher.v1"
DECISIONS = "stellar-forge.360giving-decisions.v1"
HERE = Path(__file__).resolve().parent
MAX_BYTES = 256 * 1024 * 1024

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

def write_exact(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        need(raw_file(path) == data, "Existing edition has different bytes: " + str(path))
        return
    with path.open("xb") as handle:
        handle.write(data)

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
    selected = None
    for row in index["schemas"]:
        data = raw_file(Path(schema_root) / row["file"])
        need(blob_id(data) == row["gitBlob"], "Official schema bytes changed: " + row["file"])
        document = json.loads(data)
        resource = Resource(contents=document, specification=DRAFT202012)
        resources.append((document["$id"], resource))
        for alias in row.get("aliases", []):
            resources.append((alias, resource))
        if row["role"] == "package":
            selected = document
    need(selected is not None, "Package schema is missing")
    number_types = Draft202012Validator.TYPE_CHECKER.redefine(
        "integer", lambda checker, value: (
            isinstance(value, int) and not isinstance(value, bool)) or (
            isinstance(value, Decimal) and value.is_finite() and value == value.to_integral_value()))
    Validator = validators.extend(Draft202012Validator, type_checker=number_types)
    validator = Validator(selected, registry=Registry().with_resources(resources),
                          format_checker=FormatChecker())
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
            if relative == "manifest.json":
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
    for relative in ["publisher.py", "review.html", "review.js", "review.css", "README.md", "requirements.txt", "ATTRIBUTION.md"]:
        write_exact(directory / "operator" / relative, raw_file(HERE / relative))
    for path in sorted(schema_root.iterdir()):
        if path.is_file():
            write_exact(directory / "operator/schemas" / path.name, raw_file(path))
    html = raw_file(HERE / "review.html").decode("utf-8")
    payload = exact({"report": report, "template": decisions}).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    html = html.replace("__PUBLISHER_DATA__", payload)
    html = html.replace("__PUBLISHER_CSS__", raw_file(HERE / "review.css").decode("utf-8"))
    html = html.replace("__PUBLISHER_JS__", raw_file(HERE / "review.js").decode("utf-8"))
    write_exact(directory / "review.html", html.encode("utf-8"))
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
    manifest = verify_workspace(directory)
    destination = Path(args.out).resolve()
    need(not destination.exists(), "Choose a new complete receiving ZIP path")
    need(directory not in destination.parents, "Export outside the retained source edition")
    with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for row in manifest["files"]:
            archive.writestr(row["path"], raw_file(directory / row["path"]))
        archive.writestr("manifest.json", raw_file(directory / "manifest.json"))
    data = raw_file(destination)
    print(exact({"file": str(destination), "bytes": len(data), "sha256": digest(data),
                 "members": len(manifest["files"]) + 1, "sourceSha256": manifest["sourceSha256"]}))
    return 0

def receive(args):
    archive_path = Path(args.file).resolve()
    directory = Path(args.out).resolve()
    need(not directory.exists(), "Receive into a new operator directory")
    payload = raw_file(archive_path)
    with zipfile.ZipFile(archive_path) as archive:
        members = archive.infolist()
        names = [row.filename for row in members]
        need(len(names) == len(set(names)) and "manifest.json" in names, "Invalid complete receiving member list")
        need(sum(row.file_size for row in members) <= MAX_BYTES, "Receiving package exceeds the original limit")
        for row in members:
            p = PurePosixPath(row.filename)
            need(not p.is_absolute() and all(part not in ("", ".", "..") for part in p.parts) and "\\" not in row.filename,
                 "Invalid receiving member path")
            need(not row.is_dir() and (row.external_attr >> 16) & 0o170000 != 0o120000, "Receiving package contains a non-file")
        manifest = parse(archive.read("manifest.json").decode("utf-8"))
        need(manifest.get("schema") == FORMAT, "Unsupported receiving package schema")
        expected = {row["path"]: row for row in manifest["files"]}
        need(set(names) == set(expected) | {"manifest.json"}, "Receiving package has missing or undeclared files")
        for name, row in expected.items():
            data = archive.read(name)
            need(len(data) == row["bytes"] and digest(data) == row["sha256"], "Receiving content differs: " + name)
        directory.mkdir(parents=True)
        for name in names:
            write_exact(directory / name, archive.read(name))
    reopened = verify_workspace(directory)
    print(exact({"directory": str(directory), "archiveSha256": digest(payload),
                 "sourceSha256": reopened["sourceSha256"], "grantCount": reopened["grantCount"],
                 "files": len(reopened["files"]), "nativeInputReady": reopened["nativeInputReady"]}))
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
