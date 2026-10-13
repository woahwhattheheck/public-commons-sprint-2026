"""Original selected-HUC comparisons inside the maintained received-Study view.

All values come from the saved source report. The selected Study resolver remains
the source and dependency authority; this reader adds navigation and file tickets.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier

CONTEXT = "observed_landcover_selection"
KIND = "observed-landcover-selections"
SCHEMA = "upstate.received-observed-landcover/v1"


def summary(identity):
    rows = [row for row in identity.get("scientific_report_sources", [])
            if row.get("report_context_kind") == CONTEXT]
    return {
        "observed_landcover_source_count": len(rows),
        "editable_observed_landcover_count": len({
            row["observed_landcover_selection_id"] for row in rows
            if row.get("relationship") == "same_project"}),
    }


def _files(closure, descriptors):
    rows = {}
    for item in descriptors:
        path = item["path"]
        closure.add_file(path, item)
        retained = closure.files[path]
        label = item.get("label") or PurePosixPath(path).name
        rows[(path, label)] = {"path": path, "bytes": retained["bytes"],
                              "sha256": retained["sha256"], "label": label}
    return [rows[key] for key in sorted(rows)]


def _small_summary(value):
    # The native 16 x 16 matrix stays in the original files and saved desk.
    # Retain support, areas and ratios exactly; do not recompute their denominator.
    return {key: deepcopy(item) for key, item in value.items()
            if key not in ("classes", "transitions", "huc12", "properties")}


def _source(closure, captured):
    collection_id = identifier(captured["source_collection_id"])
    collection = closure.read("sources/" + collection_id + ".json")
    if digest(collection) != collection_id:
        raise ValueError("The received land-cover source collection changed.")
    matches = [row for row in collection.get("entries", [])
               if row.get("id") == captured["source_id"]]
    if len(matches) != 1 or matches[0]["body"]["sha256"] != captured["source_body_sha256"]:
        raise ValueError("The received land-cover report lost its exact original source.")
    entry = matches[0]
    if (entry.get("metadata") or {}).get("source_kind") != KIND:
        raise ValueError("Choose an original selected-watershed land-cover source.")
    companions = {}
    for item in entry.get("companions", []):
        name = item.get("view_path", item["filename"])
        if name in companions:
            raise ValueError("The received land-cover source repeats a companion.")
        companions[name] = item
    descriptor = companions.get("selection.json")
    if descriptor is None:
        raise ValueError("The received land-cover source lacks its complete saved selection.")
    closure.add_file(descriptor["object"], descriptor)
    report = closure.read(descriptor["object"])
    if (report.get("schema") != "upstate.observed-landcover-selection/v1"
            or report.get("selection") != captured["selection"]):
        raise ValueError("The received land-cover report changed its selected watersheds.")
    return entry, report


def augment(closure, retained, result):
    """Add exact captured sources after receipt verification, before final recheck."""
    identity = retained["identity"]
    captured_rows = [row for row in identity.get("scientific_report_sources", [])
                     if row.get("report_context_kind") == CONTEXT]
    resolved = getattr(closure, "report_source_records", {})
    result.update(summary(identity))
    result["observed_landcover_sources"] = []
    for captured in captured_rows:
        token = (captured["source_collection_id"], captured["source_id"])
        if resolved.get(token) != captured:
            raise ValueError("The received Study changed its selected-watershed source lineage.")
        entry, report = _source(closure, captured)
        source = {"source_collection_id": token[0], "source_id": token[1]}
        binding = report["binding"]
        row = {
            "schema": SCHEMA, "title": report["title"], "source": source,
            "source_project_id": captured["source_project_id"],
            "relationship": captured["relationship"],
            "source_body_sha256": captured["source_body_sha256"],
            "selection_id": captured["observed_landcover_selection_id"],
            "selection": deepcopy(report["selection"]),
            "source_binding": {name: deepcopy(binding[name]) for name in
                               ("analysis_sha256", "source_domain_sha256", "rasters", "grid", "method")},
            "summary": _small_summary(report["summary"]),
            "watersheds": [{"huc12": item["huc12"],
                            "properties": deepcopy(item.get("properties", {})),
                            "summary": _small_summary(item)}
                           for item in report["watersheds"]],
            "interpretation": report["interpretation"],
            "lineage": deepcopy(captured), "native": None,
            "report_ids": [item["id"] for item in result.get("reports", [])
                           if source in item.get("source_choices", [])],
        }
        # Keep original logical filenames even when CAS bodies share bytes.
        row["source_members"] = _files(closure, [
            {**item, "path": item["object"],
             "label": item.get("view_path", item["filename"])}
            for item in [entry["body"], *entry.get("companions", [])]
        ])
        if captured["relationship"] == "same_project":
            if captured["source_project_id"] != closure.workspace.project["id"]:
                raise ValueError("Editable watershed selection belongs to another project.")
            from . import observed_landcover
            key = identifier(captured["observed_landcover_selection_id"])
            inspected = observed_landcover.inspect(closure.workspace, key)
            edition = inspected["edition"]
            if inspected["report"] != report or edition["huc12s"] != report["selection"]["huc12s"]:
                raise ValueError("The original editable watershed comparison changed.")
            prefix = KIND + "/" + key + "/"
            members = [{**item, "label": name} for name, item in edition["files"].items()]
            closure.read(prefix + "receipt.json")
            original = closure.files[prefix + "receipt.json"]
            members.append({"path": prefix + "receipt.json", "bytes": original["bytes"],
                            "sha256": original["sha256"], "label": "receipt.json"})
            row["native"] = {
                "id": key, "title": edition["title"], "source": deepcopy(edition["source"]),
                "huc12s": deepcopy(edition["huc12s"]), "members": _files(closure, members),
            }
        elif captured["relationship"] != "external_project":
            raise ValueError("Choose a supported original watershed source relationship.")
        result["observed_landcover_sources"].append(row)
    return result
