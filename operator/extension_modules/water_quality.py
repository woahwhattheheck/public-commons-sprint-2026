"""Water-quality context adapter for the maintained operator extension registry."""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path
from typing import Any
from types import SimpleNamespace

from model.common import describe_file, verify_file
from source_tools.water_quality_context import (
    FOCUS, acquire_catalog, build_workspace_context, inspect_table, read_json, utcnow,
    _classification_identity,
)

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "source" / "water-quality-context" / "catalog.json"
INVENTORY = ROOT / "source" / "water-quality-context" / "inventory.json"
CONTEXTS = "water-quality-contexts"
ACQUISITIONS = "water-quality-acquisitions"


def _query(query: dict, key: str, default: Any = None) -> Any:
    value = query.get(key, default)
    return value[0] if isinstance(value, (list, tuple)) and value else value


def _reference(value: dict) -> dict:
    if not isinstance(value, dict):
        raise ValueError("Select an original source collection and source.")
    result = dict(value)
    for key in ("collection_id", "source_id"):
        if not isinstance(result.get(key), str) or not result[key].strip():
            raise ValueError("Select an original source collection and source.")
    return result


def _choice(collection: dict, entry: dict) -> dict:
    body = entry.get("body", {})
    name = body.get("filename", entry["id"])
    suffix = Path(name).suffix.lower()
    declared_format = entry.get("format")
    if declared_format in {"table", "tmdl_pdf", "normalized"}:
        suggested = declared_format
    elif entry.get("evidence_kind") == "tmdl_attainment" and suffix == ".pdf":
        suggested = "tmdl_pdf"
    elif suffix == ".json" and "assessment" in name.lower():
        suggested = "normalized"
    else:
        suggested = "table"
    return {
        "collection_id": collection["id"], "collection_title": collection.get("title", collection["id"]),
        "source_id": entry["id"], "title": entry.get("title", entry["id"]),
        "kind": entry.get("kind"), "role": entry.get("role"), "uri": entry.get("uri"),
        "vintage": entry.get("vintage"), "publication_status": entry.get("publication_status", "unspecified"),
        "classification_status": entry.get("classification_status", entry.get("mapped_classification_status")),
        "assessment_period": entry.get("assessment_period"), "status_date": entry.get("status_date"),
        "evidence_kind": entry.get("evidence_kind"), "filename": name,
        "original_source_id": entry.get("original_source_id", entry["id"]),
        "original_source_sha256": entry.get("original_source_sha256", body.get("sha256")),
        "bytes": body.get("bytes"), "sha256": body.get("sha256"),
        "layer": entry.get("layer"), "field_hints": entry.get("source_fields", {}),
        "object_id_field": entry.get("object_id_field"),
        "class_field": entry.get("class_field", entry.get("classification_field")),
        "suggested_format": suggested,
        "companion_names": [c.get("filename", c.get("source_path", "")) for c in entry.get("companions", [])],
    }


def _topology_companions(path: Path, entry: dict, root: Path) -> list[dict]:
    candidates = []
    for companion in entry.get("companions", []):
        filename = companion.get("filename", "")
        if "binding" not in filename.lower() and "topology" not in filename.lower():
            continue
        possible = []
        if companion.get("view_path"):
            possible.append(root / companion["view_path"])
        if companion.get("source_path"):
            source_parent = Path(entry.get("body", {}).get("source_path", "")).parent
            try:
                relative = Path(companion["source_path"]).relative_to(source_parent)
                possible.append(path.parent / relative)
            except ValueError:
                pass
        if filename and Path(filename).name == filename:
            possible.append(path.parent / filename)
        for candidate in possible:
            try:
                relative = candidate.resolve().relative_to(path.parent.resolve())
            except ValueError:
                continue
            if candidate.is_file():
                candidates.append({"path": relative.as_posix(), "filename": filename,
                                   "sha256": companion.get("sha256")})
                break
    return list({c["path"]: c for c in candidates}.values())


def _inspect_vector(path: Path, entry: dict, root: Path, layer: str | None) -> dict:
    import fiona
    from model.rasters import native_vector_path, vector_environment

    target = native_vector_path(path)
    with vector_environment():
        layers = list(fiona.listlayers(target))
        chosen = layer or entry.get("layer") or (layers[0] if layers else None)
        options = {"layer": chosen} if chosen is not None else {}
        with fiona.open(target, **options) as source:
            sample = []
            for index, feature in enumerate(source):
                if index == 5:
                    break
                sample.append({"native_feature_id": str(feature.id),
                               "properties": dict(feature["properties"])})
            fields = [{"name": name, "type": kind}
                      for name, kind in source.schema["properties"].items()]
            identity = None
            if (entry.get("role") in {"WATER_CLASSIFICATION", "HIGH_QUALITY_WATERS"}
                    or entry.get("classification_field")
                    or entry.get("source_fields", {}).get("class")):
                rows, identity = _classification_identity(
                    [{"id": row["native_feature_id"], "properties": row["properties"]}
                     for row in sample], path, entry)
                sample = [{"native_feature_id": row["id"], "properties": row["properties"]}
                          for row in rows]
                definition = identity.get("field_definition") or {}
                native_name = identity["object_id_field"]
                if native_name not in {field["name"] for field in fields}:
                    fields.insert(0, {
                        "name": native_name, "type": definition.get("type", "native source ID"),
                        "alias": definition.get("alias"), "native_identity": True,
                    })
                for field in fields:
                    if field["name"] == native_name:
                        field["native_identity"] = True
                        field["alias"] = definition.get("alias")
            return {
                "kind": "vector", "layers": layers, "selected_layer": chosen,
                "fields": fields, "identity_binding": identity,
                "geometry_type": source.schema.get("geometry"),
                "crs": source.crs_wkt or str(source.crs),
                "feature_count": len(source), "preview": sample,
                "topology_companions": _topology_companions(path, entry, root),
            }


def create(operator, fault):
    """Create the provider bound by the maintained ECSA extension registry."""
    Fault = fault

    def sources(workspace_key):
        workspace = operator.ws(workspace_key)
        return [_choice(collection, entry) for collection in workspace.sources()
                for entry in collection.get("entries", [])]

    def source(workspace_key, reference):
        reference = _reference(reference)
        workspace = operator.ws(workspace_key)
        path, entry = workspace.source_file(reference["collection_id"], reference["source_id"])
        collection = workspace._get("sources", reference["collection_id"])
        return workspace, Path(path), entry, _choice(collection, entry)

    def catalog_read(workspace_key, query):
        catalog, inventory = read_json(CATALOG), read_json(INVENTORY)
        choices = sources(workspace_key)
        preferred_domain = next((c for c in choices if c["source_id"] == "upstate-wbd-upstream-domain-20261012"), None)
        preferred_class = next((c for identifier in (
            "scdes-classified-streams-upper-savannah-20261012",
            "scdes-water-classification-provisional-20261012",
        ) for c in choices if c["source_id"] == identifier), None)
        return {
            "catalog": catalog, "inventory": inventory, "sources": choices,
            "focus_watersheds": [{"huc12": key, **value} for key, value in FOCUS.items()],
            "defaults": {"domain": preferred_domain, "classifications": preferred_class},
        }

    def inspect_read(workspace_key, query):
        reference = {
            "collection_id": _query(query, "collection_id"),
            "source_id": _query(query, "source_id"),
        }
        workspace, path, entry, selected = source(workspace_key, reference)
        fmt = _query(query, "format") or ("vector" if entry.get("kind") == "vector" else selected["suggested_format"])
        if fmt == "vector":
            if entry.get("kind") != "vector":
                raise Fault("water_quality_source_kind", "Choose a vector source for the watershed or classification layer.")
            inspection = _inspect_vector(path, entry, workspace.root, _query(query, "layer"))
        elif fmt == "table":
            if path.suffix.lower() not in {".xlsx", ".xlsm", ".csv"}:
                raise Fault("water_quality_table_format", "Choose an XLSX or CSV table, or select its PDF/normalized-data format.")
            inspection = {"kind": "table", "suffix": path.suffix.lower(), **inspect_table(path, max_rows=30)}
        elif fmt == "tmdl_pdf":
            import fitz
            with fitz.open(path) as document:
                preview = [document[i].get_text("text") for i in range(min(2, len(document)))]
                inspection = {
                    "kind": "tmdl_pdf", "page_count": len(document), "preview": preview,
                    "status_date_candidates": sorted(set(
                        re.findall(r"as of\s+(\d{1,2}/\d{1,2}/\d{4})", " ".join(preview), re.I)
                    )),
                }
        elif fmt == "normalized":
            bank = read_json(path)
            if bank.get("schema") != "upstate.water-quality-assessments/v1":
                raise Fault("water_quality_assessment_schema", "Choose a normalized water-quality assessment source.")
            inspection = {
                "kind": "normalized", "complete": bank.get("complete", False),
                "row_count": len(bank.get("records", [])), "source": bank.get("source"),
                "preview": bank.get("records", [])[:8], "unparsed_rows": len(bank.get("unparsed_rows", [])),
            }
        else:
            raise Fault("water_quality_source_format", "Select table, TMDL PDF, normalized assessment data, or vector.")
        return {"source": selected, "inspection": inspection}

    def downloads(workspace_key, record):
        result = dict(record)
        result["_downloads"] = operator._files(workspace_key, result, operator.ws(workspace_key).root)
        return result

    def context_item(workspace_key, item_id):
        workspace = operator.ws(workspace_key)
        record = downloads(workspace_key, workspace._get(CONTEXTS, item_id))
        descriptor = record.get("files", {}).get("context.json")
        if not descriptor:
            raise Fault("water_quality_context_artifact", "This context does not contain its complete watershed data.")
        record["context"] = read_json(verify_file(workspace.root, descriptor))
        classified = record.get("files", {}).get("classified-reaches.geojson")
        if classified:
            geojson = read_json(verify_file(workspace.root, classified))
            record["classified_reaches"] = [
                {"id": str(feature["id"]), **feature["properties"]}
                for feature in geojson.get("features", [])
            ]
        return record

    def acquisition_item(workspace_key, item_id):
        return downloads(workspace_key, operator.ws(workspace_key)._get(ACQUISITIONS, item_id))

    def build(task):
        selection = task["payload"].get("selection")
        if not isinstance(selection, dict):
            raise Fault("water_quality_selection", "Provide a watershed domain and the selected assessment/classification sources.")
        selection = dict(selection)
        selection["domain"] = _reference(selection.get("domain"))
        if selection.get("classifications"):
            selection["classifications"] = _reference(selection["classifications"])
        references = selection.get("assessments", [])
        if not isinstance(references, list):
            raise Fault("water_quality_assessments", "Assessment sources must be a list.")
        selection["assessments"] = [_reference(value) for value in references]
        if not references and not selection.get("classifications"):
            raise Fault("water_quality_evidence", "Choose at least one assessment source or the classified-water layer.")
        for reference in selection["assessments"]:
            if reference.get("format", "table") == "table":
                if not {"site", "huc12", "cause"}.issubset(reference.get("bindings", {})):
                    raise Fault("water_quality_bindings", "Select the actual site, HUC12 and cause columns in each assessment table.")
                _, path, _, _ = source(task["workspace"], reference)
                if path.suffix.lower() == ".csv" and int(reference.get("header_row", 1)) != 1:
                    raise Fault("water_quality_csv_header", "CSV sources use their first row as the header.")
        record = build_workspace_context(operator.ws(task["workspace"]), selection)
        return downloads(task["workspace"], record)

    def acquire(task):
        selected = task["payload"].get("source_ids")
        if not isinstance(selected, list) or not selected or any(not isinstance(value, str) for value in selected):
            raise Fault("water_quality_acquisition_selection", "Choose the official source documents to acquire.")
        catalog = read_json(CATALOG)
        known = {entry["id"] for entry in catalog["entries"]}
        if set(selected) - known:
            raise Fault("water_quality_acquisition_selection", "One selected source is absent from the installed publisher catalogue.")
        operation = task["operation_id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation):
            raise Fault("water_quality_operation_id", "The original task operation identifier is invalid.")
        workspace = operator.ws(task["workspace"])
        output = workspace.root / "water-quality-acquisitions" / operation
        manifest = acquire_catalog(CATALOG, output, selected_ids=list(dict.fromkeys(selected)))
        imported = workspace.import_sources(str(output / "sources.json"))
        collection_id = imported.get("id") if isinstance(imported, dict) else imported
        record = {
            "schema": "upstate.water-quality-acquisition/v1", "title": "Official water-quality source documents",
            "created_at": utcnow(), "operation_id": operation,
            "source_collection_id": collection_id, "source_ids": list(dict.fromkeys(selected)),
            "entries": [{key: entry.get(key) for key in (
                "id", "title", "uri", "vintage", "kind", "publication_status", "status_date",
                "assessment_period", "evidence_kind", "sha256",
            )} for entry in manifest["entries"]],
            "files": {
                path.relative_to(output).as_posix(): describe_file(workspace.root, path, title=path.name)
                for path in sorted(output.rglob("*")) if path.is_file() and not path.name.endswith(".partial")
            },
        }
        saved = workspace._save(ACQUISITIONS, record)
        record["id"] = saved.get("id") if isinstance(saved, dict) else saved
        return downloads(task["workspace"], record)

    def state(workspace_key):
        workspace = operator.ws(workspace_key)
        return {
            "water_quality_contexts": [
                {key: record.get(key) for key in (
                    "id", "title", "created_at", "selection_id", "summary", "domain_source",
                    "assessment_sources", "classification_source",
                )} for record in workspace._list(CONTEXTS)
            ],
            "water_quality_acquisitions": [
                {key: record.get(key) for key in ("id", "title", "created_at", "source_collection_id", "entries")}
                for record in workspace._list(ACQUISITIONS)
            ],
        }

    def decorate_task(task):
        action = task.get("action")
        if action not in {"water.quality.context.build", "water.quality.sources.acquire"}:
            return task
        result = task.get("result")
        if isinstance(result, dict) and result.get("files"):
            task = dict(task)
            task["result"] = downloads(task["workspace"], result)
            task["_downloads"] = list(task.get("_downloads", [])) + task["result"]["_downloads"]
        return task

    actions = {"water.quality.context.build": build, "water.quality.sources.acquire": acquire}
    reads = {"catalog": catalog_read, "inspect": inspect_read}

    def invoke(task):
        handler = actions.get(task.get("action"))
        if handler is None:
            raise Fault("water_quality_action", "This water-quality task action is not registered.", 404)
        return handler(task)

    def read(workspace_key, operation, payload):
        handler = reads.get(operation)
        if handler is None:
            raise Fault("water_quality_read", "This water-quality read is not registered.", 404)
        return handler(workspace_key, payload or {})

    def item_context(workspace_key, payload):
        return context_item(workspace_key, payload["id"])

    def item_acquisition(workspace_key, payload):
        return acquisition_item(workspace_key, payload["id"])

    return SimpleNamespace(
        invoke=invoke, read=read, state=state,
        item_context=item_context, item_acquisition=item_acquisition,
        decorate_task=decorate_task,
    )
