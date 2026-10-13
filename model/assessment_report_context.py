"""Publish saved assessment and parcel geography through the existing report loader."""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile

from . import assessment_context, observed_context
from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, read_json, verify_file)

VERSION = "1.0.0"
SCHEMA = "upstate.assessment-report-context/v1"
RECIPE = "assessment-report.json"
MANIFEST = "assessment-report.sources.json"


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Assessment report members need canonical relative paths")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts or path.as_posix() != value:
        raise ValueError("Assessment report members must remain inside their saved package")
    return path


def _copy(source, target, item):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != item["bytes"] or file_digest(target) != item["sha256"]:
            raise ValueError("Existing assessment report member differs: " + target.name)
        return
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".source-", delete=False) as stream:
            pending = Path(stream.name)
            with Path(source).open("rb") as original:
                shutil.copyfileobj(original, stream, 1024 * 1024)
            stream.flush()
            os.fsync(stream.fileno())
        if pending.stat().st_size != item["bytes"] or file_digest(pending) != item["sha256"]:
            raise ValueError("Original assessment member changed during report intake")
        os.replace(pending, target)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _saved_members(workspace, edition, *, parcels=False):
    indexed = {}
    package_item = next((item for item in edition["files"]
                         if Path(item["path"]).name == "package.json"), None)
    if package_item is None:
        raise ValueError("Choose an assessment edition with its complete original package")
    package_path = verify_file(workspace.root, package_item)
    package = read_json(package_path)
    expected = "upstate.assessment-parcel-context-package/v1" if parcels else assessment_context.PACKAGE
    if package.get("schema") != expected:
        raise ValueError("The saved assessment package uses another schema")
    if parcels:
        if (package.get("context_id") != edition.get("received_from", {}).get("original_context_id", edition["context_id"])
                or package.get("study_id") != edition["study_id"]):
            raise ValueError("Parcel report package differs from its saved context and study")
    elif package.get("selection") != edition["selection"]:
        raise ValueError("Assessment report package differs from its original selection")
    root = package_path.parent
    for item in package.get("files", []):
        name = _relative(item["path"]).as_posix()
        if name in indexed:
            raise ValueError("Original assessment package repeats a member: " + name)
        path = verify_file(root, item)
        indexed[name] = (path, {"path": name, "bytes": item["bytes"], "sha256": item["sha256"]})
    for item in edition["files"]:
        path = verify_file(workspace.root, item)
        if not path.is_relative_to(root):
            received = edition.get("received_from", {})
            if not (parcels and path.name == "parcel-context.zip"
                    and item["sha256"] == received.get("archive_sha256")):
                raise ValueError("Saved assessment output is outside its original package")
            name = "parcel-context.zip"
        else:
            name = _relative(path.relative_to(root).as_posix()).as_posix()
        descriptor = {"path": name, "bytes": item["bytes"], "sha256": item["sha256"]}
        if name in indexed and indexed[name][1] != descriptor:
            raise ValueError("Saved assessment output differs from its original package")
        indexed[name] = (path, descriptor)
    return indexed


def _text(value):
    if value is None or value == "":
        return "Not recorded"
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return str(value)


def _table(columns, rows):
    return {"kind": "table", "columns": columns,
            "rows": [[_text(value) for value in row] for row in rows]}


def _links(items):
    return {"kind": "links", "items": [{"title": title, "path": path} for title, path in items]}


def _sections(context, parcel=None):
    result, summary = context["result"], context["summary"]
    groups = result["assessment_groups"]
    editions = []
    seen = set()
    for group in groups:
        assessment = group["assessment"]
        values = [assessment["title"], assessment["status"], assessment["vintage"],
                  group["edition"], assessment["reference"]]
        key = tuple(_text(value) for value in values)
        if key not in seen:
            seen.add(key)
            editions.append(values)
    rows = result["rows"]
    comparisons = [row for row in rows if row.get("association_status") != "both_resolved_agree"]
    sections = [
        ["Assessment geographic context — " + context["title"], [
            result["relation"],
            "This is the exact saved assessment inventory selection. Source editions, causes, uses and "
            "support stay attached to each original record. These geographic associations do not replace "
            "the delivery's selected native model runs, observed concentrations, load estimates or parcel scores.",
            _table(["Original context", "Distinct stations", "Assessment records", "Watersheds",
                    "Relationship basis"],
                   [[context["id"], summary["station_count"], summary["assessment_row_count"],
                     summary["watershed_count"], result["relationship_basis"]]]),
            "Original selection and filters: " + json.dumps(context["selection"],
                ensure_ascii=False, sort_keys=True, allow_nan=False),
        ]],
        ["Original assessment editions and source references", [
            _table(["Source title", "Publication status", "Source vintage", "Record edition",
                    "Original reference"], editions),
            _table(["Edition", "Source title", "Publication", "Cause", "Use", "Original support",
                    "Records", "Distinct stations"],
                   [[group["edition"], group["assessment"]["title"], group["assessment"]["status"],
                     group["cause"], group["impaired_use"], group.get("use_support"),
                     group["assessment_row_count"], group["station_count"]] for group in groups]),
            "Missing support is shown as Not recorded. Combined original uses remain literal. "
            "A supported cause/use in one edition does not change another cause/use or source edition.",
        ]],
        ["Saved watershed associations", [
            _table(["Original watershed", "Distinct stations", "Distinct assessment records", "Causes", "Uses"],
                   [[row["watershed_id"], row["station_count"], row["assessment_row_count"],
                     row["causes"], row["uses"]] for row in result["watersheds"]]),
            "The original publisher watershed label and computed station point/polygon membership are "
            "separate relationships. A selected watershed is assessment geographic context; absence of "
            "selected records remains unknown. Counts in overlapping polygons must not be added as "
            "independent original records.",
        ]],
        ["Publisher and computed geography — unresolved or differing relationships", [
            _table(["Station", "Original row ID", "Edition", "Cause", "Use", "Support",
                    "Original publisher watershed", "Publisher polygons", "Computed polygons",
                    "Comparison"],
                   [[row["station_id"], row.get("assessment_row_id") or assessment_context._row_id(row),
                     row.get("assessment_edition"), row["cause"], row["impaired_use"],
                     row.get("use_support"), row.get("original_watershed_value"),
                     row.get("published_polygon_ids"), row.get("computed_polygon_ids"),
                     row.get("association_status")] for row in comparisons]),
            "An unresolved side is not a geographic disagreement. Original row dictionaries, "
            "native publisher identity, normalized source-body identity and original array pointer "
            "or CSV row remain in the complete linked JSON and CSV.",
        ]],
    ]
    if parcel is not None:
        result_parcel = parcel["result"]
        sections.append(["Original parcel geographic associations — " + parcel["title"], [
            result_parcel["relation"],
            result_parcel["score_effect"],
            result_parcel["method"],
            "Original parcel study " + parcel["study_id"] + ". Areas use its retained metric CRS. "
            "Positive overlaps are unioned within each reporting-clipped parcel; boundary-only "
            "contacts are separate. Overlapping source parcels remain independent, so their areas "
            "must not be added into a regional union.",
            _table(["Original parcel", "Label", "Association", "Reporting area ha",
                    "Context union ha", "Reporting fraction", "Distinct stations", "Distinct records"],
                   [[row["parcel_id"], row.get("label"), row["association_status"],
                     row["reporting_parcel_area_ha"], row["context_overlap_area_ha"],
                     row["reporting_context_fraction"], row["station_count"],
                     row["assessment_row_count"]] for row in result_parcel["rows"]]),
            _links([
                ("Original parcel report", "parcels/OPEN_PARCEL_CONTEXT.html"),
                ("Complete parcel rows, source attributes and relationships", "parcels/parcel-context.json"),
                ("Original parcel/context GeoJSON", "parcels/parcel-context.geojson"),
                ("Original parcel CSV", "parcels/parcel-context.csv"),
                ("Original polygon relationship CSV", "parcels/parcel-context-relationships.csv"),
                ("Complete parcel, reporting boundary and context package", "parcels/parcel-context.zip"),
                ("Original parcel package manifest", "parcels/package.json"),
            ]),
        ]])
    sections.append(["Complete source selection, maps and original packages", [
        _links([
            ("Original assessment context report and source links", "context/OPEN_ASSESSMENT_CONTEXT.html"),
            ("Complete assessment rows and original dictionaries", "context/context.json"),
            ("Saved watershed context geometry", "context/context.geojson"),
            ("Original assessment record CSV", "context/assessment-rows.csv"),
            ("Original watershed context CSV", "context/watershed-context.csv"),
            ("Exact original selection", "context/selection.json"),
            ("Complete context source and independent reopening ZIP", "context/assessment-context.zip"),
            ("Original station geography and input package", "context/original-station-geography.zip"),
            ("Original assessment package manifest", "context/package.json"),
        ]),
        "These files preserve the complete saved context and original source package. The scientific "
        "delivery carries them as the selected study's native companions. Receiver imports verify "
        "each body and companion before the existing report collector uses them.",
    ]])
    return sections


def delivery_selection(workspace, source, delivery_id=None):
    if delivery_id:
        original = workspace.retained_item("deliveries", identifier(delivery_id))
        selection = copy.deepcopy(original.get("selection"))
        if not isinstance(selection, dict):
            raise ValueError("Choose a saved delivery with its retained source selection")
    else:
        selection = {}
    choices = observed_context.source_choices(selection)
    if source not in choices:
        choices.append(dict(source))
    selection["observed_context_sources"] = choices
    selection.setdefault("source_roles", {})[observed_context.ROLE] = dict(choices[0])
    selection.pop("observed_context_binding", None)
    return selection


def prepare(workspace, context_id, *, parcel_id=None, import_source=True, delivery_id=None):
    context = assessment_context.inspect(workspace, identifier(context_id),
                                         verify=True, include_result=True)
    if context["result"].get("schema") != assessment_context.SCHEMA:
        raise ValueError("Choose a retained assessment geographic context")
    if context["result"].get("selection") != context["selection"]:
        raise ValueError("The saved context and its original selection differ")
    parcel = None
    originals = {"context": _saved_members(workspace, context)}
    if parcel_id:
        parcel = assessment_context.inspect_parcels(workspace, identifier(parcel_id),
                                                    verify=True, include_result=True)
        original_context_id = parcel.get("received_from", {}).get("original_context_id", context["id"])
        if parcel["context_id"] != context["id"] or parcel["result"].get("context_id") != original_context_id:
            raise ValueError("Choose a parcel association from this exact saved assessment context")
        expected_rows = {assessment_context._row_id(row) for row in context["result"]["rows"]}
        retained_rows = {assessment_context._row_id(row) for row in parcel["result"]["assessment_rows"]}
        if expected_rows != retained_rows:
            raise ValueError("Parcel associations retain another original assessment record selection")
        if parcel["result"].get("schema") != "upstate.assessment-parcel-context/v1":
            raise ValueError("Choose a retained assessment parcel association")
        originals["parcels"] = _saved_members(workspace, parcel, parcels=True)
    identity = {"version": VERSION, "report_loader_edition": observed_context.EDITION,
        "workspace_id": workspace.project["id"], "context_id": context["id"],
        "parcel_id": parcel["id"] if parcel else None,
        "members": {group: [item for unused, item in sorted(members.values(),
                    key=lambda pair: pair[1]["path"])] for group, members in originals.items()}}
    operation_id = digest(identity)
    directory = workspace.root / "assessment-report-context" / operation_id
    with held(workspace.root / "locks" / ("assessment-report-" + operation_id + ".lock")):
        directory.mkdir(parents=True, exist_ok=True)
        inputs = []
        for group, members in originals.items():
            for name, (path, item) in sorted(members.items()):
                target = directory / group / _relative(name)
                _copy(path, target, item)
                inputs.append(describe_file(directory, target))
        recipe = {"schema": observed_context.SCHEMA, "title": parcel["title"] if parcel else context["title"],
            "edition": "assessment-geographic-context-report-" + VERSION,
            "report_context_kind": "assessment_geographic_context",
            "project_id": workspace.project["id"], "context_id": context["id"],
            "parcel_id": parcel["id"] if parcel else None, "summary": context["summary"],
            "parcel_received_from": parcel.get("received_from") if parcel else None,
            "original_selection": context["selection"], "assessment_groups": context["result"]["assessment_groups"],
            "original_source_references": assessment_context._source_references(context["result"]),
            "inputs": inputs, "sections": _sections(context, parcel),
            "source_links": ["context/context.json", "context/assessment-context.zip",
                "context/original-station-geography.zip", "context/context.geojson",
                "context/OPEN_ASSESSMENT_CONTEXT.html", "context/package.json"] +
                (["parcels/parcel-context.zip", "parcels/parcel-context.json",
                  "parcels/OPEN_PARCEL_CONTEXT.html"] if parcel else []),
            "figures": []}
        atomic_json(directory / RECIPE, recipe, immutable=True)
        source_id = "assessment-context-report-" + operation_id[:20]
        manifest = {"schema": "upstate.sources/v1", "title": recipe["title"],
            "captured_at": context["created_at"],
            "scope": {"project_id": workspace.project["id"], "context_id": context["id"],
                      "parcel_id": parcel["id"] if parcel else None,
                      "relation": assessment_context.RELATION},
            "entries": [{"id": source_id, "kind": "document", "title": recipe["title"],
                "role": "assessment-geographic-report-context", "path": RECIPE,
                "uri": "workspace://" + workspace.project["id"] + "/assessment-context/" + context["id"],
                "vintage": context["created_at"], "sha256": file_digest(directory / RECIPE),
                "metadata": {"report_schema": observed_context.SCHEMA,
                    "report_context_kind": "assessment_geographic_context",
                    "context_id": context["id"], "parcel_id": parcel["id"] if parcel else None,
                    "original_source_references": recipe["original_source_references"]},
                "companions": inputs}]}
        atomic_json(directory / MANIFEST, manifest, immutable=True)
        result = {"schema": SCHEMA, "version": VERSION, "operation_id": operation_id,
            "workspace_id": workspace.project["id"], "context_id": context["id"],
            "parcel_id": parcel["id"] if parcel else None, "title": recipe["title"],
            "summary": context["summary"], "member_count": len(inputs) + 1,
            "source_id": source_id, "manifest": describe_file(workspace.root, directory / MANIFEST),
            "recipe": describe_file(workspace.root, directory / RECIPE),
            "files": [describe_file(workspace.root, directory / name) for name in
                (MANIFEST, RECIPE, "context/assessment-context.zip")] +
                ([describe_file(workspace.root, directory / "parcels/parcel-context.zip")] if parcel else [])}
        if import_source:
            collection = workspace.import_sources(directory / MANIFEST)
            source = {"source_collection_id": collection["id"], "source_id": source_id}
            binding = observed_context.bind(workspace, {"observed_context_sources": [source]})
            result.update(source=source, observed_context_binding=binding)
            atomic_json(directory / "registered-context.json", result, immutable=True)
            result["delivery_selection"] = delivery_selection(workspace, source, delivery_id)
            result["selected_delivery_id"] = delivery_id
        return result


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--context-id", required=True)
    parser.add_argument("--parcel-id")
    parser.add_argument("--delivery-id")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args(argv)
    if args.prepare_only and args.delivery_id:
        parser.error("--delivery-id requires native source import")
    result = prepare(Workspace(args.workspace), args.context_id, parcel_id=args.parcel_id,
                     delivery_id=args.delivery_id, import_source=not args.prepare_only)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
