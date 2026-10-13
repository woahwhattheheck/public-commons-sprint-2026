"""Retain a completed land-cover ledger for the existing Scientific Reports composer.

All numerical tables consume the original computed ledger. Input rasters,
reporting geometry and the original interactive/export products remain attached.
"""
from __future__ import annotations
from copy import deepcopy
import json
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

from . import landcover_workspace, observed_context
from .landcover_exports import _source_edition_rows
from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, now, read_json, verify_file)
from .reuse import copy_verified, destination_file

SCHEMA = "upstate.landcover-report-source/v1"
EDITION = "saved-landcover-report/2"
DIRECTORY = "landcover-report-sources"


def _copy(value):
    return deepcopy(value)


def _title(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Supply a scientific report source title")
    return value.strip()


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Retained report members need canonical relative names")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or any(p in (".", "..") for p in path.parts)
            or path.as_posix() != value):
        raise ValueError("Report source members must remain inside their source")
    return path.as_posix()


def _same_file(actual, expected):
    return all(actual.get(key) == expected.get(key) for key in ("bytes", "sha256"))


def _text(value):
    if value is None:
        return "Not available"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    if isinstance(value, float):
        return format(value, ".10g")
    return str(value)


def _table(columns, rows):
    return {"kind": "table", "columns": list(columns),
            "rows": [[_text(cell) for cell in row] for row in rows]}


def _links(items):
    return {"kind": "links", "items": [
        {"title": title, "path": _relative(path)} for title, path in items
    ]}


def _original_sources(workspace, binding):
    references = [binding["zones"]["selection"]]
    if binding["selection"].get("input_mode") == "sources":
        references.extend(item["source_selection"] for item in binding["operands"])
    originals = {}
    for choice in references:
        key = (choice["source_collection_id"], choice["source_id"])
        if key not in originals:
            unused, entry = workspace.source_file(*key)
            originals[key] = {"source_collection_id": key[0], "source_id": key[1],
                              "entry": _copy(entry)}
    return [originals[key] for key in sorted(originals)]


def _run_members(workspace, binding, report):
    """Retain native run raster members using their current original Workspace paths."""
    if binding["selection"].get("input_mode") == "sources":
        return []
    import rasterio
    accepted = {(item["bytes"], item["sha256"]) for item in report["inputs"]
                if item["role"] == "baseline" or item["role"].startswith("scenario:")
                or item["role"] == "raster-companion"}
    members = {}
    for operand in binding["operands"]:
        path = verify_file(workspace.root, operand["raster"])
        with rasterio.open(path) as dataset:
            paths = list(dataset.files)
        if str(path) not in paths:
            paths.append(str(path))
        for name in paths:
            actual = Path(name).resolve(strict=True)
            if not actual.is_relative_to(workspace.root.resolve()):
                raise ValueError("A native land-cover member is outside its retained Workspace")
            item = describe_file(workspace.root, actual)
            if (item["bytes"], item["sha256"]) not in accepted:
                raise ValueError("Native raster bytes differ from the original computed ledger")
            members[item["path"]] = item
    return [members[name] for name in sorted(members)]


def _operands(binding, report):
    source_rows = _source_edition_rows(report)
    if source_rows:
        editions = report["source_editions"]
        return editions["baseline"], {row["key"]: row for row in editions["alternatives"]}
    values = []
    for index, operand in enumerate(binding["operands"]):
        values.append({"key": "baseline" if index == 0 else operand["run_id"],
                       "label": operand["scenario"].get("title") or operand["run_id"],
                       "source_time": "Saved native land-cover operand",
                       "source_id": operand["run_id"], "source_collection_id": "",
                       "source_uri": "workspace://runs/" + operand["run_id"],
                       "band": 1, "raster": operand["raster"]})
    if [item["key"] for item in values[1:]] != report["scenarios"]:
        raise ValueError("Original run operands differ from the saved ledger order")
    return values[0], {row["key"]: row for row in values[1:]}


def _sections(edition, binding, report, originals):
    baseline, alternatives = _operands(binding, report)
    options, grid = report["options"], report["grid"]
    rows = {(row["zone_id"], row["scenario"]): row for row in report["rows"]}
    expected = {(zone["id"], key) for zone in report["zones"] for key in report["scenarios"]}
    if len(rows) != len(report["rows"]) or set(rows) != expected:
        raise ValueError("The completed ledger row inventory differs from its zones and alternatives")
    if "__domain__" not in {zone["id"] for zone in report["zones"]}:
        raise ValueError("The completed ledger has no original unique study-area union")
    sections = [["Saved land-cover comparison", [
        "This report uses the completed land-cover ledger and its original reporting boundaries. "
        "The attached interactive report contains the geographic view and all class transitions. "
        "Areas measure categorical land-cover change; they do not estimate runoff or pollutant export.",
        _table(["Retained selection", "Value"], [
            ["Original ledger ID", edition["id"]],
            ["Original calculation signature", report["signature"]],
            ["Input mode", binding["selection"].get("input_mode", "runs")],
            ["Reference edition", baseline["label"]],
            ["Reference time or edition", baseline["source_time"]],
            ["Reference source or run ID", baseline["source_id"]],
            ["Original reporting polygons", edition["zone_count"]],
            ["Comparison editions", edition["alternative_count"]],
            ["Calculation completed", report.get("completed_at")],
            ["Coordinate system", grid["crs"]],
            ["Area basis", grid["area_basis"]],
            ["Projection method", grid.get("projection_method")],
            ["Native cell area (ha)", grid["cell_ha"]],
            ["Pixel attribution", "Fractional polygon/pixel intersection"],
            ["Common support choice", options["support_scope"]],
            ["Unknown-class choice", options["unknown_policy"]],
            ["Overlapping reporting polygons allowed", options["allow_overlap"]],
        ]),
        ("Every comparison uses the intersection of valid supported pixels across the reference "
         "and ALL selected alternatives. Pairwise support is retained separately."
         if options["support_scope"] == "all" else
         "Each comparison uses its own reference/alternative valid supported-pixel intersection. "
         "Different alternatives can therefore have different comparison support."),
        "The study-area row counts the unique polygon union once. Individual watershed rows retain "
        "their original polygons; overlapping watershed rows must not be added to obtain the union. "
        "A change quantity marked Not available means there was no supported comparison area.",
    ]]]
    sections.append(["Original input editions", [
        _table(["Role", "Original label", "Time or edition", "Band", "Source or run ID"],
               [["Reference", baseline["label"], baseline["source_time"], baseline["band"], baseline["source_id"]]]
               + [["Comparison", alternatives[key]["label"], alternatives[key]["source_time"],
                   alternatives[key]["band"], alternatives[key]["source_id"]] for key in report["scenarios"]]),
        _table(["Original label", "Original URI", "Raster bytes", "Raster SHA-256"],
               [[value["label"], value["source_uri"], value["raster"]["bytes"], value["raster"]["sha256"]]
                for value in [baseline, *[alternatives[key] for key in report["scenarios"]]]]),
        "Reference and comparison keep the explicitly selected order. Source labels and editions "
        "come from retained metadata; the report does not infer missing calendar years.",
    ]])
    zone_columns = ["Original polygon ID", "Name", "Geometry (ha)", "Inside raster (ha)", "Outside raster (ha)"]
    sections.append(["Complete reporting-area inventory", [
        _table(zone_columns, [[zone["id"], zone["name"], zone["geometry_ha"],
                              zone["inside_grid_ha"], zone["outside_grid_ha"]] for zone in report["zones"]]),
    ]])
    for key in report["scenarios"]:
        alternative = alternatives[key]
        domain = rows[("__domain__", key)]
        support = domain["support"]
        blocks = [
            "Reference: " + baseline["label"] + ". Comparison: " + alternative["label"] +
            ". Original comparison key: " + key + ".",
            _table(["Unique study-area comparison", "Retained value"], [
                ["Analysis support (ha)", support["analysis_valid_ha"]],
                ["Changed land cover (ha)", domain["changed_ha"]],
                ["Unchanged land cover (ha)", domain["unchanged_ha"]],
                ["Changed share of supported area (%)", domain["changed_pct_of_analysis"]],
                ["Analysis coverage of inside-grid area (%)", domain["analysis_coverage_pct"]],
            ]),
            _table(["Support quantity", "Area (ha)"], [
                ["Polygon covered by native grid", support["covered_ha"]],
                ["Reference raster-valid", support["baseline_raster_valid_ha"]],
                ["Comparison raster-valid", support["scenario_raster_valid_ha"]],
                ["Reference supported NLCD class", support["baseline_supported_ha"]],
                ["Comparison supported NLCD class", support["scenario_supported_ha"]],
                ["Pairwise supported intersection", support["pair_common_valid_ha"]],
                ["Selected analysis support", support["analysis_valid_ha"]],
                ["Reference supported only", support["baseline_only_ha"]],
                ["Comparison supported only", support["scenario_only_ha"]],
                ["Neither side supported", support["neither_valid_ha"]],
                ["Excluded by another selected alternative", support["excluded_by_other_scenarios_ha"]],
                ["Reference unknown class", support["baseline_unknown_class_ha"]],
                ["Comparison unknown class", support["scenario_unknown_class_ha"]],
            ]),
            "Raster-valid and supported-class areas are different quantities. Unknown categorical "
            "codes can be excluded by the selected policy; their areas remain explicit. "
            "The complete coverage.csv retains all support terms for every reporting polygon.",
            _table(["Land-cover group", "Reference (ha)", "Comparison (ha)",
                    "Gained (ha)", "Lost (ha)", "Net change (ha)"], [
                [name.replace("_", " "), value["baseline_ha"], value["scenario_ha"],
                 value["gained_ha"], value["lost_ha"], value["net_ha"]]
                for name, value in domain["groups"].items()]),
            "Group gains and losses describe changes into or out of each class group on selected "
            "common support. Net change is comparison minus reference.",
        ]
        changed = [row for row in domain["transitions"] if row["from_code"] != row["to_code"]]
        if changed:
            blocks.append(_table(["Reference class", "Comparison class", "Changed area (ha)"], [
                [str(row["from_code"]) + " / " + report["classes"][str(row["from_code"])],
                 str(row["to_code"]) + " / " + report["classes"][str(row["to_code"])], row["ha"]]
                for row in changed]))
        else:
            blocks.append("The retained unique-union transition table has no changed-class entries.")
        sections.append(["Study-area comparison: " + alternative["label"], blocks])
        zones = [zone for zone in report["zones"] if zone["id"] != "__domain__"]
        sections.append(["Every reporting polygon: " + alternative["label"], [
            _table(["Original polygon ID", "Name", "Valid analysis (ha)",
                    "Changed (ha)", "Changed (%)", "Coverage (%)"], [
                [zone["id"], zone["name"], rows[(zone["id"], key)]["support"]["analysis_valid_ha"],
                 rows[(zone["id"], key)]["changed_ha"],
                 rows[(zone["id"], key)]["changed_pct_of_analysis"],
                 rows[(zone["id"], key)]["analysis_coverage_pct"]] for zone in zones]),
            _table(["Original polygon ID", "Reference only (ha)", "Comparison only (ha)",
                    "Neither supported (ha)", "Excluded by other alternatives (ha)"], [
                [zone["id"], rows[(zone["id"], key)]["support"]["baseline_only_ha"],
                 rows[(zone["id"], key)]["support"]["scenario_only_ha"],
                 rows[(zone["id"], key)]["support"]["neither_valid_ha"],
                 rows[(zone["id"], key)]["support"]["excluded_by_other_scenarios_ha"]] for zone in zones]),
            "These tables include every original reporting polygon. Complete class-to-class "
            "transitions and group areas for each polygon remain in the attached CSV and JSON files.",
        ]])
    sections.append(["Original data and complete editable outputs", [
        _table(["Original source", "Edition", "URI", "Body SHA-256"],
               [[value["entry"]["title"], value["entry"]["vintage"], value["entry"]["uri"],
                 value["entry"]["body"]["sha256"]] for value in originals]),
        _links([
            ("Interactive land-cover map and full comparison report", "ledger/results/report.html"),
            ("Complete original land-cover report and GIS ZIP", "ledger/landcover-report.zip"),
            ("Full numerical ledger", "ledger/results/ledger.json"),
            ("Every watershed summary", "ledger/results/watershed-summary.csv"),
            ("Every class-to-class transition", "ledger/results/transitions.csv"),
            ("Every original support quantity", "ledger/results/coverage.csv"),
            ("Land-cover groups for every polygon", "ledger/results/landcover-groups.csv"),
            ("Full geographic reporting boundaries", "ledger/results/watersheds.geojson"),
            ("Original reporting geometry and properties", "ledger/zones-original.geojson"),
            ("Original input and method binding", "ledger/input-bindings.json"),
            ("Original retained source entries", "records/source-bindings.json"),
        ]),
        "Original input bodies, declared source companions, calculated raster outputs and saved "
        "selection are retained with this source. The full editable Workspace archive carries "
        "the application and native project for reopening the original analysis.",
    ]])
    return sections


def _write_bundle(directory, files, target):
    """Write the source manifest and every companion without extracting a packet."""
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".source-", suffix=".zip",
                                         delete=False) as temporary:
            pending = Path(temporary.name)
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=5, allowZip64=True) as archive:
            for name, descriptor in sorted(files.items()):
                source = verify_file(directory, descriptor)
                info = zipfile.ZipInfo(_relative(name), date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                with source.open("rb") as stream, archive.open(info, "w", force_zip64=True) as out:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        out.write(block)
                verify_file(directory, descriptor)
        if target.exists():
            if target.stat().st_size != pending.stat().st_size or file_digest(target) != file_digest(pending):
                raise ValueError("Retained report-source bundle differs")
            pending.unlink()
        else:
            pending.replace(target)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _verify_source(workspace, value):
    choice = value["source"]
    unused, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    if (entry.get("kind") != "document" or entry.get("role") != observed_context.ROLE
            or not _same_file(entry["body"], value["files"]["recipe"])):
        raise ValueError("The original report recipe source differs from its receipt")
    actual = {item.get("view_path", item["filename"]): item
              for item in entry.get("companions", [])}
    expected = value["members"]
    if len(actual) != len(entry.get("companions", [])) or set(actual) != set(expected):
        raise ValueError("Original report source companion membership differs")
    for name, item in expected.items():
        if not _same_file(actual[name], item):
            raise ValueError("Original report source companion differs: " + name)
    current = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
    if current != value["observed_binding"]:
        raise ValueError("Original scientific-report source binding differs")
    return value


def get(workspace, key):
    """Reopen the same completed imported source and verify all retained members."""
    key = identifier(key)
    value = read_json(workspace.root / DIRECTORY / key / "receipt.json")
    if (value.get("schema") != SCHEMA or value.get("state") != "complete"
            or value.get("id") != key or digest(value.get("selection")) != key
            or value["selection"].get("project_id") != workspace.project["id"]
            or value.get("ledger_id") != value["selection"].get("ledger_id")):
        raise ValueError("The retained Land-cover report-source identity differs")
    for item in value["files"].values():
        verify_file(workspace.root, item)
    for item in value["members"].values():
        verify_file(workspace.root, item)
    return _verify_source(workspace, value)


def list_sources(workspace, ledger_id=None):
    """Return completed receipt metadata without re-reading source bodies."""
    if ledger_id is not None:
        ledger_id = identifier(ledger_id)
    root = workspace.root / DIRECTORY
    if not root.exists():
        return []
    rows = []
    for path in sorted(root.glob("*/receipt.json")):
        value = read_json(path)
        if (value.get("schema") != SCHEMA or value.get("state") != "complete"
                or path.parent.name != value.get("id")
                or digest(value.get("selection")) != value["id"]
                or value["selection"].get("project_id") != workspace.project["id"]
                or value.get("ledger_id") != value["selection"].get("ledger_id")):
            raise ValueError("A Land-cover report-source receipt differs")
        if ledger_id is not None and value["ledger_id"] != ledger_id:
            continue
        rows.append({key: _copy(value[key]) for key in (
            "id", "ledger_id", "title", "state", "source", "created_at", "files",
        )})
    return rows


def prepare(workspace, spec):
    """Prepare the existing report composer source from one complete saved ledger."""
    if not isinstance(spec, dict) or set(spec) - {"ledger_id", "title"}:
        raise ValueError("Supply the original ledger_id and optional report-source title")
    state = landcover_workspace.inspect(workspace, identifier(spec.get("ledger_id")))
    edition, binding, report = state["edition"], state["binding"], state["report"]
    if edition.get("state") != "complete" or report.get("complete") is not True:
        raise ValueError("Choose a completed original land-cover ledger")
    from . import landcover_report_figures
    figure_implementation = {name: item["sha256"]
                             for name, item in landcover_report_figures.implementation().items()}
    title = _title(spec.get("title", edition["title"]))
    originals = _original_sources(workspace, binding)
    native_members = _run_members(workspace, binding, report)
    sections = _sections(edition, binding, report, originals)
    original_root = workspace.root / landcover_workspace.KIND / edition["id"]
    edition_file = describe_file(workspace.root, original_root / "edition.json")
    identity = {
        "edition": EDITION, "producer_sha256": file_digest(__file__),
        "project_id": workspace.project["id"], "ledger_id": edition["id"],
        "title": title, "ledger_edition": edition_file, "signature": report["signature"],
        "source_entries": originals, "native_raster_members": native_members,
        "figure_implementation": figure_implementation,
    }
    key = digest(identity)
    directory = workspace.root / DIRECTORY / key
    with held(directory / ".source.lock", blocking=False):
        receipt = directory / "receipt.json"
        if receipt.exists():
            return {**get(workspace, key), "reused": True}
        members = {}
        def retain(name, descriptor):
            name = _relative(name)
            if name in members:
                if not _same_file(members[name], descriptor):
                    raise ValueError("Report source members collide: " + name)
                return
            copied = copy_verified(workspace.root, descriptor, directory, path=name)
            members[name] = describe_file(directory, directory / copied["path"])
        def write(name, value):
            name = _relative(name)
            if name in members:
                raise ValueError("Report source member names collide")
            path = destination_file(directory, name)
            atomic_json(path, value, immutable=True)
            members[name] = describe_file(directory, path)
        retain("ledger/edition.json", edition_file)
        for role, item in sorted(edition["files"].items()):
            original_path = verify_file(original_root, item)
            retain("ledger/" + _relative(item["path"]),
                   describe_file(workspace.root, original_path))
        write("records/source-bindings.json", {"schema": "upstate.landcover-report-originals/v1",
                                              "ledger_id": edition["id"], "sources": originals,
                                              "native_raster_members": native_members})
        for original in originals:
            prefix = "originals/" + original["source_collection_id"] + "/" + digest(original["source_id"]) + "/"
            for item in [original["entry"]["body"]] + original["entry"].get("companions", []):
                native_name = _relative(item.get("view_path", item["filename"]))
                retain(prefix + native_name, {"path": item["object"], "bytes": item["bytes"],
                                              "sha256": item["sha256"]})
        for item in native_members:
            retain("run-rasters/" + _relative(item["path"]), item)
        reference, comparisons = _operands(binding, report)
        labels = {name: "Reference: " + reference["label"] + ". Comparison: " + comparisons[name]["label"]
                  for name in report["scenarios"]}
        figures = landcover_report_figures.prepare(directory, edition, report, labels, figure_implementation)
        for item in figures["files"]:
            name = _relative(item["path"])
            if name in members:
                raise ValueError("Land-cover figure collided with an original member")
            members[name] = item
        sections.append(["Saved geographic and numerical figures", [
            "The vector map retains the original reporting polygons. Numerical figures use the completed "
            "unique-union transition matrix and every reporting polygon on its selected common support. "
            "Full numerical values, unavailable quantities, original IDs and figure implementation are attached.",
            _links([("Complete land-cover figure specification", figures["figure_spec"]),
                    ("Every original figure quantity", "figures/landcover-figure-data.json")]),
        ]])
        recipe = {
            "schema": observed_context.SCHEMA, "edition": EDITION, "title": title,
            "origin": {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
                       "ledger_id": edition["id"], "signature": report["signature"],
                       "input_mode": binding["selection"].get("input_mode", "runs"),
                       "area_method": "fractional_polygon_overlap",
                       "area_basis": report["grid"]["area_basis"]},
            "inputs": [members[name] for name in sorted(members)], "sections": sections,
            "figure_spec": figures["figure_spec"], "figures": figures["figures"],
            "source_links": ["records/source-bindings.json", "ledger/input-bindings.json",
                             "ledger/edition.json", "ledger/results/ledger.json",
                             "ledger/landcover-report.zip", "ledger/results/report.html",
                             figures["figure_spec"], "figures/landcover-figure-data.json"],
        }
        # Check every link against the exact published inventory before import.
        for unused, blocks in sections:
            for block in blocks:
                if isinstance(block, dict) and block.get("kind") == "links":
                    for link in block["items"]:
                        if link["path"] not in members:
                            raise ValueError("A land-cover report link names a missing original member")
        recipe_path = directory / "landcover-report.json"
        atomic_json(recipe_path, recipe, immutable=True)
        recipe_file = describe_file(directory, recipe_path)
        source_id = "landcover-ledger-" + key
        manifest = {
            "schema": "upstate.sources/v1", "title": title,
            "scope": "Completed original land-cover ledger as a retained scientific-report source",
            "entries": [{
                "id": source_id, "kind": "document", "role": observed_context.ROLE,
                "title": title, "uri": "workspace://" + str(workspace.project["id"]) + "/landcover-ledgers/" + edition["id"],
                "vintage": str(report["completed_at"]), **recipe_file,
                "companions": [members[name] for name in sorted(members)],
                "metadata": {"origin": recipe["origin"], "source_kind": "saved_landcover_ledger",
                             "original_output_scope": "Original fractional polygon overlap and selected common raster support"},
            }],
        }
        manifest_path = directory / "sources.json"
        atomic_json(manifest_path, manifest, immutable=True)
        manifest_file = describe_file(directory, manifest_path)
        bundle = directory / "landcover-report-source.zip"
        _write_bundle(directory, {**members, recipe_file["path"]: recipe_file,
                                  manifest_file["path"]: manifest_file}, bundle)
        collection = workspace.import_sources(manifest_path)
        choice = {"source_collection_id": collection["id"], "source_id": source_id}
        bound = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
        result = {
            "schema": SCHEMA, "edition": EDITION, "id": key, "state": "complete",
            "ledger_id": edition["id"], "title": title, "selection": identity,
            "source": choice, "observed_binding": bound, "created_at": now(),
            "files": {"recipe": describe_file(workspace.root, recipe_path),
                      "manifest": describe_file(workspace.root, manifest_path),
                      "source_bundle": describe_file(workspace.root, bundle)},
            "members": {name: describe_file(workspace.root, directory / name)
                        for name in sorted(members)},
        }
        _verify_source(workspace, result)
        atomic_json(receipt, result, immutable=True)
        return result
