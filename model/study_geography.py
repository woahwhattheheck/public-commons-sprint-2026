"""Join completed watershed context to the exact selected study geography.

Published whole-HUC and state-portion acres retain their original source basis.
The native reporting raster, valid support and buffered routing domain keep
their own identities and areas.
"""
from __future__ import annotations

import base64
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
import tempfile

from .common import describe_file, read_json, verify_file
from .watershed_context import selected_watershed_export

SCHEMA = "upstate.study-geography/v1"
APPLICATION = Path(__file__).resolve().parents[1]


def _huc(value):
    text = str(value).strip()
    return text if re.fullmatch(r"[0-9]{12}", text) else None


def _properties(path, *, layer=None):
    """Read original features, retaining source property names and selections."""
    path = Path(path)
    with path.open("rb") as handle:
        prefix = handle.read(2)
    opener = gzip.open if prefix == b"\x1f\x8b" else open
    with opener(path, "rb") as handle:
        lead = handle.read(128).lstrip()
    if lead.startswith(b"{") and layer is None:
        with opener(path, "rt", encoding="utf-8-sig") as handle:
            value = json.load(handle)
        features = value.get("features")
        if isinstance(features, list):
            for feature in features:
                geometry = feature.get("geometry")
                if geometry and (geometry.get("coordinates") or geometry.get("rings")
                                 or geometry.get("paths") or geometry.get("geometries")):
                    yield feature.get("properties", feature.get("attributes", {}))
            return
    from .rasters import native_vector_path, vector_environment
    import fiona
    with vector_environment(), fiona.open(native_vector_path(path), layer=layer) as source:
        for feature in source:
            if feature.get("geometry"):
                yield dict(feature["properties"])


def _selection(workspace, collection_id, selection):
    path, entry = workspace.source_file(collection_id, selection["source_id"])
    where = selection.get("where") or {}
    layer = selection.get("layer") or entry.get("layer")
    identifiers, count, field_names = set(), 0, set()
    for properties in _properties(path, layer=layer):
        if any(properties.get(key) != value for key, value in where.items()):
            continue
        count += 1
        fields = [name for name in properties
                  if name.casefold().replace("_", "") in {"huc12", "huc12code"}]
        codes = {_huc(properties[name]) for name in fields}
        if not fields or None in codes or len(codes) != 1:
            return None
        identifiers.update(codes)
        field_names.update(fields)
    if not identifiers:
        return None
    return {
        "huc12s": sorted(identifiers), "feature_count": count,
        "huc_fields": sorted(field_names), "selection": dict(selection),
        "source_collection_id": collection_id, "source_id": entry["id"],
        "body": entry["body"],
        "companions": entry.get("companions", []),
    }


def _saved_contexts(workspace):
    for path in sorted((workspace.root / "watershed-context").glob("*/operator-report.json")):
        record = read_json(path)
        if (record.get("schema") != "upstate.operator-watershed-context/v1"
                or record.get("state") != "complete"):
            continue
        descriptor = record.get("files", {}).get("watershed-context.json")
        if descriptor is None:
            continue
        body = verify_file(path.parent, descriptor).read_bytes()
        report = json.loads(body)
        if record.get("id") != report.get("id") or path.parent.name != report.get("id"):
            raise ValueError("The saved watershed context identity changed")
        yield report, {
            "location": "workspace", "record": describe_file(workspace.root, path),
            "report": {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()},
            "completed_at": record.get("completed_at"),
            "native_receiving": record.get("native_receiving"),
        }


def _published_contexts():
    """Reuse the existing complete native-result verifier, without a model rerun."""
    from source_tools.receive_watershed_context import _native_receiver, _matches
    receiver = None
    for path in sorted((APPLICATION / "source" / "water_context").glob("*/completed-run.package.json")):
        package = read_json(path)
        if package.get("schema") != "commons.artifact-base64/v1":
            continue
        archive = base64.b64decode(package["content_base64"], validate=True)
        _matches(archive, package, package["filename"])
        if receiver is None:
            receiver = _native_receiver()
        with tempfile.TemporaryDirectory(prefix="upstate-study-geography-") as temporary:
            original = Path(temporary) / "original-completed-result.zip"
            original.write_bytes(archive)
            bundle = receiver.receive_bundle(original, package["sha256"], package["operation_id"])
        report_body = bundle["files"]["watershed-context.json"]
        yield bundle["report"], {
            "location": "published original completed result",
            "package": describe_file(APPLICATION, path),
            "archive": {"bytes": len(archive), "sha256": package["sha256"]},
            "report": {"bytes": len(report_body), "sha256": hashlib.sha256(report_body).hexdigest()},
            "operation_id": package["operation_id"],
            "completed_at": bundle["run"]["completed_at"],
            "source_inputs": bundle["source_inputs"],
        }


def _state_areas(rows):
    states = sorted({state for row in rows for state in row["state_portions_acres"]})
    return {state: math.fsum(row["state_portions_acres"].get(state, 0.0) for row in rows)
            for state in states}


def from_report(report, domain_huc12s, reporting_huc12s, *, provenance=None):
    """Bind one actual completed context by exact native-domain HUC membership."""
    domain, reporting = set(domain_huc12s), set(reporting_huc12s)
    if any(_huc(value) != value for value in domain | reporting):
        raise ValueError("Use original twelve-digit watershed identifiers")
    if not reporting or not reporting <= domain:
        raise ValueError("The reporting HUC membership must be a nonempty subset of the native domain")
    if domain != set(report["model_domain_huc12s"]):
        return None
    if (len(report["hucs"]) != len(domain)
            or {row["huc12"] for row in report["hucs"]} != domain):
        raise ValueError("The completed context does not contain one row per domain HUC")
    groups = []
    for role, title, members in (
            ("reporting", "Selected reporting HUCs", reporting),
            ("contributing", "Other contributing HUCs", domain - reporting),
            ("domain", "Unbuffered native HUC domain", domain)):
        selected = selected_watershed_export(report, sorted(members))
        groups.append({
            "role": role, "title": title, "huc12s": selected["selected_huc12s"],
            "summary": selected["summary"], "state_portion_acres": _state_areas(selected["hucs"]),
        })
    hucs = []
    for row in sorted(report["hucs"], key=lambda item: item["huc12"]):
        hucs.append({
            "huc12": row["huc12"], "name": row["name"], "huc8": row["huc8"],
            "role": "reporting" if row["huc12"] in reporting else "contributing",
            "whole_huc_area_acres": row["area_acres"], "states": row["states"],
            "state_portion_acres": row["state_portions_acres"],
            "priority": row["priority"], "priority_states": row["priority_states"],
            "priority_reasons": row.get("priority_reasons"),
            "priority_state_portion_acres": row["priority_state_portion_acres"],
            "class_counts": row["class_counts"],
            "selected_classification_count": row["selected_classification_count"],
            "classification_query_coverage": row["classification_query_coverage"],
            "classification_scope": row["classification_scope"],
            "classification_assignment": row["classification_assignment"],
        })
    return {
        "context_id": report["id"], "title": report["title"],
        "provenance": provenance or {}, "groups": groups, "hucs": hucs,
        "sources": report["sources"], "methods": report["methods"],
        "classification_source_jurisdiction": report["classification_coverage"].get("source_jurisdiction"),
        "membership_basis": "Exact selected native-domain HUC12 membership; published context areas retain their original geometry edition.",
    }


def collect(workspace, summary):
    """Join matching saved or published context to the original grid selectors."""
    if not summary.get("grid_id"):
        return None
    grid = workspace.get_grid(summary["grid_id"])
    spec = grid["spec"]
    collection_id = spec["source_collection_id"]
    domain = _selection(workspace, collection_id, spec["model_domain"])
    reporting = _selection(workspace, collection_id, spec["reporting_area"])
    if domain is None or reporting is None:
        return None
    if not set(reporting["huc12s"]) <= set(domain["huc12s"]):
        raise ValueError("The original reporting source has HUCs outside the selected native domain")
    contexts, identities = [], set()
    for provider in (_saved_contexts, lambda unused: _published_contexts()):
        for report, provenance in provider(workspace):
            identity = report.get("id"), provenance["report"]["sha256"]
            if identity in identities:
                continue
            context = from_report(report, domain["huc12s"], reporting["huc12s"],
                                  provenance=provenance)
            if context is not None:
                identities.add(identity)
                contexts.append(context)
        # A saved completed context is authoritative for this Workspace.
        if contexts:
            break
    if not contexts:
        return None
    cells = sorted({metric["reporting_cells"] for row in summary.get("rows", [])
                    if row.get("state") == "complete"
                    for metric in row.get("metrics", {}).values()
                    if isinstance(metric.get("reporting_cells"), int)
                    and not isinstance(metric["reporting_cells"], bool)
                    and metric["reporting_cells"] >= 0})
    pixel_area = grid["grid"]["pixel_area_ha"]
    if not isinstance(pixel_area, (int, float)) or not math.isfinite(pixel_area) or pixel_area <= 0:
        raise ValueError("The completed native grid requires a positive finite pixel area")
    return {
        "schema": SCHEMA, "workspace_id": summary["workspace_id"],
        "experiment_id": summary["id"], "grid_id": grid["id"],
        "grid": grid["grid"], "upstream_buffer_m": spec["upstream_buffer_m"],
        "model_domain": domain, "reporting_area": reporting,
        "reporting_mask": grid.get("files", {}).get("reporting_mask"),
        "recorded_reporting_cells": cells,
        "raster_reporting_area_ha": cells[0] * pixel_area if len(cells) == 1 else None,
        "contexts": contexts,
        "definitions": {
            "reporting_membership": "HUC identifiers come from the exact original reporting source, including its layer and property filter. Membership alone does not establish whether polygons were clipped.",
            "whole_huc_area": "Published NRCS whole-HUC acres, counted once per selected HUC; they are not an area measurement of the native reporting mask.",
            "state_portion_area": "Published NRCS state portions, retaining their original rounding and geometry edition.",
            "raster_area": "Recorded reporting cells multiplied by this native grid's actual pixel area; paired valid support remains pollutant and comparison specific.",
            "routing": "The unbuffered native-domain HUC membership plus the retained geometric buffer supports routing; other contributing HUCs are not additional management scenarios.",
            "classification": "Counts of retained selected-class source features assigned by publisher HUC12; a complete zero records none of those selected classes, rather than absence of streams.",
            "priority": "FY26 source-water priority is a retained planning attribute; it does not represent a computed native nutrient or sediment export.",
            "editions": "Multiple matching retained context editions remain separate; their quantities are not added together.",
        },
    }


def csv_bytes(value):
    columns = ("context_id", "huc12", "name", "role", "huc8", "whole_huc_area_acres",
               "state", "state_portion_acres", "priority", "priority_states",
               "priority_state_portion_acres", "selected_classification_count",
               "class_counts", "classification_query_coverage", "classification_scope",
               "classification_assignment")
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for context in (value or {}).get("contexts", []):
        for row in context["hucs"]:
            # One row per HUC. Keep state quantities in a labeled JSON object,
            # so whole-HUC acres and source-feature counts cannot be double summed.
            record = {name: row.get(name) for name in columns}
            record.update(context_id=context["context_id"], state=" | ".join(row["states"]),
                          state_portion_acres=json.dumps(row["state_portion_acres"], sort_keys=True),
                          class_counts=json.dumps(row["class_counts"], sort_keys=True),
                          priority_states=" | ".join(row["priority_states"]))
            for name, item in record.items():
                if isinstance(item, str) and item.startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
                    record[name] = "'" + item
            writer.writerow(record)
    return output.getvalue().encode("utf-8-sig")
