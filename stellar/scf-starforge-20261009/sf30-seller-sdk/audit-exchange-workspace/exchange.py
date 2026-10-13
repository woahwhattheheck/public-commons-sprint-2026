"""Reviewed turnover projection and complete editable archive exchange."""
from __future__ import annotations
import csv
import html
import io
import json
import stat
import zipfile
from pathlib import Path, PurePosixPath

from common import AuditError, canonical, digest, key, now, require, text
from model import ASSET_DIRECTORY, NAMESPACE, asset_catalog

PACKAGE_FORMAT = "commons.audit-exchange.package.v1"
SNAPSHOT_FORMAT = "commons.audit-exchange.snapshot.v1"
MAX_PACKAGE_BYTES = 1024 * 1024 * 1024
APPLICATION_ROOT = Path(__file__).resolve().parent

def ordered_rows(table, rows):
    spec = asset_catalog()["consumerTables"][table]
    columns = spec["columns"]
    result = []
    for row in rows:
        require(set(row).issubset(columns), "projection_column", "The projection has a column outside the consumer contract", {"table": table})
        clean = {column: row.get(column, "") for column in columns}
        require(all(isinstance(value, str) for value in clean.values()), "projection_value", "Every consumer cell must remain a string")
        for column, rule in spec["rowProperties"].items():
            if "enum" in rule:
                require(clean[column] in rule["enum"], "projection_enum", "The projected review value is not accepted by the original consumer", {"table": table, "column": column})
        result.append(clean)
    return result

def csv_bytes(columns, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="raise", lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")

def source_locator(detail, entity):
    return canonical({"sourceId": detail["source"]["id"], "revisionId": detail["revision"]["id"],
                      "sha256": detail["revision"]["sha256"], "path": entity["path"], "xmlId": entity["xmlId"]})

def projection(detail, inputs):
    entities = {entity["key"]: entity for entity in detail["model"]["entities"]}
    selections = {}
    for argument in ("assetEntityKeys", "documentEntityKeys", "requirementEntityKeys"):
        values = inputs.get(argument, [])
        require(isinstance(values, list) and all(isinstance(x, str) for x in values) and len(set(values)) == len(values),
                "invalid_projection", "Projection selections must contain distinct original entity keys")
        require(all(value in entities for value in values), "invalid_projection", "A selected entity is absent from this exact source revision")
        selections[argument] = list(values)
    tables = {name: [] for name in asset_catalog()["consumerTables"]}
    source = detail["source"]
    revision = detail["revision"]
    source_id = "audit:" + revision["sha256"]
    relative_path = "sources/" + source["id"] + "/revision-" + str(revision["number"]).zfill(4) + ".xml"
    tables["sources"].append({"source_id": source_id, "relative_path": relative_path, "sha256": revision["sha256"],
        "bytes": str(revision["bytes"]), "supplied_mime": "application/xml", "received_at": source["importedAt"],
        "document_type": "BuildingSync audit XML", "status": "retained"})
    fields = detail["model"]["fields"]
    def one_value(entity, *names):
        for name in names:
            matches = [f for f in fields if f["entityKey"] == entity["key"] and f["kind"] == "text" and f["name"] == name and f.get("namespace") == NAMESPACE]
            if len(matches) == 1:
                return matches[0]["value"], matches[0]
        return "", None
    mapping_rows = []
    def mapping(entity, field, table, column, rule="Exact retained native value"):
        mapping_rows.append({"mapping_id": "map-" + key(source_id, entity["key"], table, column)[:32],
            "source_id": source_id, "source_field": field["path"] if field else entity["path"],
            "source_type": "native XML scalar" if field else "native XML entity identity",
            "target_table": table, "target_field": column, "empty_value_treatment": "Preserve blank",
            "normalization": "None", "relationship_rule": rule})
    for identity in selections["assetEntityKeys"]:
        entity = entities[identity]
        physical = entity.get("semanticKind") in {"facility", "site", "building", "section", "thermal-zone", "space", "system"}
        require(physical, "projection_subject", "Only an explicitly selected native physical asset/system can become a turnover asset",
                {"entityKey": identity, "kind": entity["kind"]})
        asset_id = "audit-asset-" + key(source_id, identity)[:32]
        row = {"asset_id": asset_id, "provider_namespace": "BuildingSync:" + revision["sha256"],
               "provider_id": entity["xmlId"], "display_name": entity["label"], "source_id": source_id,
               "source_locator": source_locator(detail, entity), "review_state": "unreviewed"}
        for target, original in (
            ("equipment_tag", ("EquipmentID", "EquipmentTag")),
            ("manufacturer", ("Manufacturer", "ManufacturerName")),
            ("model", ("ModelNumber", "ModelName")), ("serial_number", ("SerialNumber",))):
            value, field = one_value(entity, *original)
            row[target] = value
            if field:
                mapping(entity, field, "assets", target)
        tables["assets"].append(row)
        mapping(entity, None, "assets", "asset_id", "Source hash and exact native entity key; source-local identity")
        mapping(entity, None, "assets", "display_name", "Original native name or literal ID; fallback is the native element type")
        tables["document-links"].append({"link_id": "audit-link-" + key(source_id, identity, "asset")[:32],
            "subject_type": "asset", "subject_id": asset_id, "relationship": "native audit source",
            "source_id": source_id, "source_locator": source_locator(detail, entity), "review_state": "unreviewed"})
    for identity in selections["documentEntityKeys"]:
        entity = entities[identity]
        tables["document-links"].append({"link_id": "audit-link-" + key(source_id, identity, "document")[:32],
            "subject_type": "source", "subject_id": source_id, "relationship": "selected native audit record",
            "source_id": source_id, "source_locator": source_locator(detail, entity), "review_state": "unreviewed"})
        mapping(entity, None, "document-links", "source_locator")
    for identity in selections["requirementEntityKeys"]:
        entity = entities[identity]
        tables["turnover-requirements"].append({
            "requirement_id": "audit-review-" + key(source_id, identity)[:32], "subject_type": "source",
            "requirement_name": "Review native " + entity["kind"] + ": " + entity["label"],
            "applicability": "Proposed audit handover review", "source_id": source_id,
            "source_locator": source_locator(detail, entity) if "source_locator" in asset_catalog()["consumerTables"]["turnover-requirements"]["columns"] else "",
            "disposition": "proposed"})
        mapping(entity, None, "turnover-requirements", "requirement_name", "Explicit proposed operator review; does not assert a native contractual requirement")
    findings = detail["model"]["diagnostics"] + detail["validation"]["xsd"]["diagnostics"]
    for profile in detail["validation"]["profiles"]:
        findings += profile["diagnostics"]
    for index, finding in enumerate(findings):
        tables["discrepancies"].append({"issue_id": "audit-finding-" + key(source_id, str(index), finding.get("id", ""), finding["message"])[:32],
            "subject_type": "source", "subject_id": source_id, "issue_type": finding["code"],
            "observed_value": finding["message"], "source_id": source_id,
            "source_locator": finding.get("path", ""),
            "expected_requirement": "Selected native schema/use-case: " + finding.get("profileId", detail["revision"]["selectedSchema"]),
            "state": "open" if finding.get("severity") == "error" else "review"})
    tables["field-mapping"] = mapping_rows
    tables = {name: ordered_rows(name, rows) for name, rows in tables.items()}
    value = {"sourceId": source["id"], "revisionId": revision["id"], "selection": selections,
             "tables": tables, "diagnostics": [], "sourcePath": relative_path}
    value["selectionSha256"] = digest(canonical(value).encode())
    return value

def checked_name(name):
    require(isinstance(name, str) and name and "\\" not in name, "package_path", "An archive member has an invalid portable path")
    path = PurePosixPath(name)
    require(not path.is_absolute() and all(part not in ("", ".", "..") for part in name.split("/")),
            "package_path", "An archive member leaves its portable package")
    return name

def package_bytes(members, *, kind, summary):
    prepared = {checked_name(name): raw for name, raw in members.items()}
    require("manifest.json" not in prepared, "package_manifest", "The outer manifest is created by the exporter")
    manifest = {"format": PACKAGE_FORMAT, "kind": kind, "createdAt": now(), "summary": summary,
                "members": [{"path": name, "bytes": len(raw), "sha256": digest(raw)} for name, raw in sorted(prepared.items())]}
    prepared["manifest.json"] = (canonical(manifest) + "\n").encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(prepared.items()):
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(info, raw)
    return output.getvalue()

def unpack_package(raw):
    require(len(raw) <= MAX_PACKAGE_BYTES, "package_too_large", "The selected package exceeds this workspace's configured capacity")
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as error:
        raise AuditError("invalid_package", "The selected file is not a complete ZIP package") from error
    with archive:
        entries = archive.infolist()
        require(len(entries) <= 100000 and sum(e.file_size for e in entries) <= MAX_PACKAGE_BYTES,
                "package_too_large", "The expanded package exceeds this workspace's configured capacity")
        names = [checked_name(entry.filename) for entry in entries]
        require(len(names) == len(set(names)), "package_duplicate", "The package repeats an archive member")
        require(all(not stat.S_ISLNK(entry.external_attr >> 16) and not entry.is_dir() for entry in entries),
                "package_member", "The package must contain ordinary complete files")
        require("manifest.json" in names, "package_manifest", "The package has no complete source manifest")
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except (ValueError, KeyError) as error:
            raise AuditError("package_manifest", "The package manifest is unreadable") from error
        require(manifest.get("format") == PACKAGE_FORMAT and isinstance(manifest.get("members"), list),
                "package_manifest", "This is not an Audit Exchange package")
        inventory = manifest["members"]
        require(len(inventory) == len(names) - 1 and {row.get("path") for row in inventory} == set(names) - {"manifest.json"},
                "package_manifest", "The complete package inventory does not match its members")
        result = {}
        for entry in inventory:
            name = checked_name(entry["path"])
            data = archive.read(name)
            require(len(data) == entry["bytes"] and digest(data) == entry["sha256"],
                    "package_changed", "An original package member differs", {"path": name})
            result[name] = data
        return manifest, result

def projection_package(detail, raw_xml, preview):
    require(digest(raw_xml) == detail["revision"]["sha256"], "source_changed", "The selected original XML bytes have changed")
    members = {preview["sourcePath"]: raw_xml, "projection.json": (canonical(preview) + "\n").encode(),
               "audit/source-model.json": (canonical(detail["model"]) + "\n").encode(),
               "audit/validation.json": (canonical(detail["validation"]) + "\n").encode(),
               "README.md": b"# Audit turnover projection\n\nImport all eight CSV files using the consumer's exact columns. Retain the full XML as a document source. Review fields are unreviewed; all native measures, scenarios and readings remain in the complete XML and audit view.\n"}
    for table, rows in preview["tables"].items():
        members["registers/" + table + ".csv"] = csv_bytes(asset_catalog()["consumerTables"][table]["columns"], rows)
    for profile in detail["validation"]["profiles"]:
        if profile.get("svrl"):
            members["audit/" + profile["id"] + ".svrl.xml"] = profile["svrl"].encode()
    return package_bytes(members, kind="turnover-projection",
                         summary={"sourceId": detail["source"]["id"], "revisionId": detail["revision"]["id"],
                                  "selectionSha256": preview["selectionSha256"]})

def review_html(state, details):
    def e(value): return html.escape(str(value), quote=True)
    sections = []
    for detail in details:
        source, revision, model = detail["source"], detail["revision"], detail["model"]
        findings = model["diagnostics"] + detail["validation"]["xsd"]["diagnostics"]
        for profile in detail["validation"]["profiles"]:
            findings += profile["diagnostics"]
        sections.append("<section><h2>" + e(source["name"]) + "</h2><p>Revision " + e(revision["number"]) +
            " · XML version " + e(revision["declaredVersion"]) + " · selected schema " + e(revision["selectedSchema"]) +
            "</p><dl><dt>Original SHA-256</dt><dd>" + e(source["originalSha256"]) + "</dd><dt>Selected SHA-256</dt><dd>" +
            e(revision["sha256"]) + "</dd></dl><h3>Native records</h3><table><thead><tr><th>Type</th><th>ID</th><th>Name</th><th>Location</th></tr></thead><tbody>" +
            "".join("<tr><td>" + e(row["kind"]) + "</td><td>" + e(row["xmlId"]) + "</td><td>" + e(row["label"]) +
                    "</td><td><code>" + e(row["path"]) + "</code></td></tr>" for row in model["entities"]) +
            "</tbody></table><h3>Validation findings</h3><table><thead><tr><th>Severity</th><th>Rule</th><th>Finding</th><th>Location</th></tr></thead><tbody>" +
            "".join("<tr><td>" + e(row.get("severity", "")) + "</td><td>" + e(row.get("profileId", row["code"])) +
                    "</td><td>" + e(row["message"]) + "</td><td><code>" + e(row.get("path", "")) + "</code></td></tr>" for row in findings) +
            "</tbody></table></section>")
    sections.append("<section><h2>Reviews and assigned actions</h2><table><thead><tr><th>Status</th><th>Title</th><th>Owner</th><th>Due</th><th>Note</th></tr></thead><tbody>" +
        "".join("<tr><td>" + e(r["status"]) + "</td><td>" + e(r["title"]) + "</td><td>" + e(r["assignee"]) +
                "</td><td>" + e(r["dueDate"]) + "</td><td>" + e(r["note"]) + "</td></tr>" for r in state["reviews"]) +
        "</tbody></table></section>")
    body = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Audit Exchange review</title><style>body{font:15px system-ui,sans-serif;max-width:1200px;margin:32px auto;padding:0 20px;color:#202124;background:#fff}h1,h2,h3{font-weight:600}section{margin:32px 0}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f3f3f3}code,dd{overflow-wrap:anywhere}dt{font-weight:600}dd{margin:4px 0 12px}p{line-height:1.5}</style><h1>" + e(state["name"]) + "</h1><p>Saved Audit Exchange review · workspace version " + e(state["version"]) + " · " + e(now()) + "</p>" + "".join(sections) + "</html>"
    return body.encode("utf-8")

def application_members():
    manifest_path = APPLICATION_ROOT / "SOURCE_FILES.json"
    require(manifest_path.is_file(), "application_source", "The complete application source inventory is unavailable")
    names = json.loads(manifest_path.read_text("utf-8"))["files"]
    result = {}
    for name in names:
        checked_name(name)
        path = APPLICATION_ROOT / name
        require(path.is_file() and not path.is_symlink(), "application_source", "A complete application source member is unavailable", {"path": name})
        result["application/" + name] = path.read_bytes()
    return result
