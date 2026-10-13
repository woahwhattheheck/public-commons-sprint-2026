"""Receive an unchanged archived Parameter result as an ordinary scientific source.

The archived producer owns every numerical value. No native study, run, profile
or grid is constructed in the receiving Workspace. Shared Parameter sections,
figures and the normal observed-source renderer present the preserved rows.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, now, read_json, verify_file)
from . import ensemble_scientific_source as shared
from . import parameter_report_source as live
from . import parameter_scientific_figures as figures

SCHEMA = "upstate.parameter-result-archive-source/v1"
DIRECTORY = "parameter-archive-sources"
SOURCE_ID = "archived-parameter-result"
SOURCE_BASIS = "saved_parameter_result_archive"
RESULT_SCHEMA = "upstate.parameter-experiment-results/v1"
MASS_FIELDS = ("baseline_mass", "case_mass", "change", "percent_change",
               "baseline_full_mass", "case_full_mass")
COUNT_FIELDS = ("baseline_valid_cells", "case_valid_cells", "paired_valid_cells")
CSV_FIELDS = ("case_id", "case", "run_id", "profile_id", "area_id", "area",
              "pollutant", "units", *MASS_FIELDS, *COUNT_FIELDS, "paired_area_ha",
              "support_changed", "parameter", "baseline_parameter", "case_parameter",
              "response_per_parameter_unit", "elasticity", "pixel_area_ha",
              "baseline_valid_area_ha", "case_valid_area_ha", "overrides")


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate original JSON key: " + key)
        result[key] = value
    return result


def _nonfinite(value):
    raise ValueError("The original result contains a non-finite JSON number: " + value)


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("The archived result needs its original " + label)
    return value


def _number(value, label, *, nullable=False, nonnegative=False):
    if value is None and nullable:
        return
    if (type(value) not in (int, float) or not math.isfinite(value) or
            (nonnegative and value < 0)):
        raise ValueError("The archived result has invalid " + label)


def _index(values, label, field="id"):
    if not isinstance(values, list) or not values:
        raise ValueError("The archived result needs original " + label)
    result = {}
    for row in values:
        if not isinstance(row, dict):
            raise ValueError("Invalid original " + label + " record")
        key = _text(row.get(field), label + " identity")
        if key in result:
            raise ValueError("Duplicate original " + label + " identity: " + key)
        result[key] = row
    return result


def _read(path, expected_sha256):
    expected = identifier(expected_sha256)
    raw = Path(path).read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != expected:
        raise ValueError("The original Parameter result bytes differ from the supplied SHA256")
    result = json.loads(raw.decode("utf-8"), object_pairs_hook=_object,
                        parse_constant=_nonfinite)
    if not isinstance(result, dict) or result.get("schema") != RESULT_SCHEMA:
        raise ValueError("Select an original Parameter experiment result JSON")
    _text(result.get("workspace_id"), "donor Workspace identity")
    identifier(result.get("experiment_id"))
    _text(result.get("title"), "study title")
    _text(result.get("purpose"), "study purpose")
    selection = result.get("selection")
    baseline = result.get("baseline_selection")
    if not isinstance(selection, dict) or not isinstance(baseline, dict):
        raise ValueError("Retain the original study and baseline selections")
    identifier(selection.get("baseline_run_id"))
    for name in ("profile_id", "scenario_id", "grid_id"):
        identifier(baseline.get(name))
    cases = _index(result.get("cases"), "case")
    areas = _index(result.get("areas"), "area")
    pollutants = result.get("pollutants")
    if (not isinstance(pollutants, list) or not pollutants or
            any(not isinstance(item, str) or not item for item in pollutants) or
            len(set(pollutants)) != len(pollutants)):
        raise ValueError("Retain distinct original pollutant names")
    if (not isinstance(result.get("models"), list) or not result["models"] or
            any(not isinstance(item, str) or not item for item in result["models"])):
        raise ValueError("Retain the original model scope")
    completed = {key: row for key, row in cases.items() if row.get("state") == "complete"}
    for name in ("completed_cases", "total_cases"):
        if type(result.get(name)) is not int or result[name] < 0:
            raise ValueError("Retain the original " + name)
    if (len(completed) != result["completed_cases"] or not completed or
            result["total_cases"] < len(cases)):
        raise ValueError("Original case states disagree with the saved design counts")
    for case in cases.values():
        identifier(case.get("run_id"))
        identifier(case.get("profile_id"))
        _text(case.get("label"), "case label")
        if not isinstance(case.get("overrides"), dict):
            raise ValueError("Retain the original case overrides")
    reference_cases = [row for row in cases.values()
                       if row["run_id"] == selection["baseline_run_id"]]
    if len(reference_cases) != 1 or reference_cases[0]["profile_id"] != baseline["profile_id"]:
        raise ValueError("The archived baseline identity differs from its original case")
    for area in areas.values():
        _text(area.get("name"), "area name")
    rows = result.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("The original result has no completed numeric rows")
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid original numeric row")
        key = (row.get("case_id"), row.get("area_id"), row.get("pollutant"))
        if key in seen or key[0] not in completed or key[1] not in areas or key[2] not in pollutants:
            raise ValueError("Original result rows do not identify distinct completed cases and areas")
        seen.add(key)
        case = completed[key[0]]
        if any(row.get(name) != case[name] for name in ("run_id", "profile_id", "overrides")):
            raise ValueError("An original result row differs from its case selection")
        if row.get("case") != case["label"] or row.get("area") != areas[key[1]]["name"]:
            raise ValueError("An original numeric row differs from its case or area label")
        _text(row.get("units"), "physical units")
        for name in MASS_FIELDS:
            if name not in row:
                raise ValueError("Original numeric row omits " + name)
            _number(row[name], name, nullable=True)
        for name in COUNT_FIELDS:
            if type(row.get(name)) is not int or row[name] < 0:
                raise ValueError("Original valid-cell count is invalid: " + name)
        paired = row["paired_valid_cells"]
        if paired > min(row["baseline_valid_cells"], row["case_valid_cells"]):
            raise ValueError("Original paired cells exceed independent valid-cell support")
        changed = paired != row["baseline_valid_cells"] or paired != row["case_valid_cells"]
        if type(row.get("support_changed")) is not bool or row["support_changed"] != changed:
            raise ValueError("Original support flag differs from its valid-cell counts")
        _number(row.get("paired_area_ha"), "paired area", nonnegative=True)
        if not paired and any(row[name] is not None for name in
                              ("baseline_mass", "case_mass", "change", "percent_change")):
            raise ValueError("Original finite paired quantities have no common valid cells")
        if paired and any(row[name] is None for name in ("baseline_mass", "case_mass", "change")):
            raise ValueError("Original supported pair omits its stored mass or change")
        if row["baseline_mass"] == 0 and row["percent_change"] is not None:
            raise ValueError("Original percentage has a zero paired baseline")
        for name, count in (("baseline_full_mass", "baseline_valid_cells"),
                            ("case_full_mass", "case_valid_cells")):
            if (row[name] is None) != (row[count] == 0):
                raise ValueError("Original own-valid mass disagrees with its valid-cell support")
    expected_rows = {(case, area, pollutant) for case in completed for area in areas
                     for pollutant in pollutants}
    if seen != expected_rows:
        raise ValueError("The archive omits part of its declared completed result matrix")
    return raw, result


def _selection(workspace, result, value, actual_sha256):
    cases = [row for row in result["cases"] if row["state"] == "complete"]
    case_ids = live._choices(value.get("case_ids"), [row["id"] for row in cases], "archived cases")
    area_ids = live._choices(value.get("area_ids"), [row["id"] for row in result["areas"]], "archived areas")
    pollutants = live._choices(value.get("pollutants"), result["pollutants"], "archived pollutants")
    title = _text(value.get("title") or ("Archived Parameter study: " + result["title"]), "report title")
    selected = {
        "selection": {"edition": 1, "source_basis": SOURCE_BASIS,
                      "experiment_id": result["experiment_id"],
                      "workspace_id": result["workspace_id"],
                      "receiving_workspace_id": workspace.project["id"], "title": title,
                      "expected_artifact_sha256": actual_sha256, "case_ids": case_ids,
                      "area_ids": area_ids, "pollutants": pollutants},
        "cases": deepcopy([row for row in cases if row["id"] in case_ids]),
        "areas": deepcopy([row for row in result["areas"] if row["id"] in area_ids]),
        "models": deepcopy(result["models"]), "pollutants": pollutants,
        "completed_cases": result["completed_cases"], "total_cases": result["total_cases"],
        "includes_all_completed_cases": len(case_ids) == len(cases),
        "reference": {"run_id": result["selection"]["baseline_run_id"],
                      **{name: result["baseline_selection"][name]
                         for name in ("profile_id", "scenario_id", "grid_id")},
                      "run_selection": deepcopy(result["baseline_selection"])},
        "comparison_basis": _text(result.get("comparison_basis"), "comparison basis"),
        "range_basis": (
            "Historical range records remain unchanged in original-result.json and historical-ranges.json. "
            "They are not displayed as current completed-case ranges. This archived intake does not "
            "recalculate them or assume that their producer included the reference case."),
    }
    rows = deepcopy([row for row in result["rows"] if row["case_id"] in case_ids and
                     row["area_id"] in area_ids and row["pollutant"] in pollutants])
    selected["selected_rows"] = len(rows)
    return selected, rows


def _sections(result, selected, rows, origin_uri, original_bytes):
    sections = live._sections(selected, rows, [])
    # Reuse the maintained scientific tables, replacing only its live-export claim.
    expected = "Original files and spatial interpretation"
    if not sections or sections[-1][0] != expected:
        raise ValueError("The maintained Parameter report sections changed; review the archive integration")
    sections.pop()
    runtime = result.get("native_versions")
    runtime_labels = result.get("native_version_labels")
    prefix = [["Archived original result and source interpretation", [
        "This source receives the unchanged output of an original saved Parameter study. "
        "Its case rows retain the donor Workspace, native run, profile, scenario and grid identities. "
        "The receiving Workspace edits report selection and presentation while the original bytes remain frozen.",
        live._table(["Original identity", "Retained value"], [
            ["Donor Workspace", result["workspace_id"]],
            ["Receiving Workspace", selected["selection"]["receiving_workspace_id"]],
            ["Study", result["experiment_id"]],
            ["Original result SHA256", selected["selection"]["expected_artifact_sha256"]],
            ["Original result bytes", original_bytes],
            ["Original source location", origin_uri or "Unspecified"],
            ["Original requested InVEST version", result["baseline_selection"].get("invest_version")],
            ["Original actual runtime versions", runtime if runtime else "Not retained in this archived result"],
            ["Original actual runtime labels", runtime_labels if runtime_labels else "Not retained in this archived result"],
            ["Original requested difference maps", result["selection"].get("difference_maps", "Unspecified")],
        ]),
        "The requested version and embedded versions in coefficient-source references are different kinds "
        "of provenance. Missing executed-runtime records remain explicitly missing. Native model inputs, "
        "rasters and editable donor studies remain with their original owners; this package retains the "
        "exact numeric result and its recorded provenance.",
        live._table(["Original method", "Retained description"], [
            [key, result.get(key)] for key in
            ("mass_basis", "aggregation_extent", "comparison_basis", "range_basis", "design")]),
        live._table(["Original coefficient-source provenance", "Retained value"], [
            [key, value] for key, value in result.get("coefficient_source", {}).items()]),
    ]]]
    methods = [section for section in sections if section[0] in {
        "Saved Parameter result selection", "Original fixed baseline and case key",
        "Reporting geography", "Original completed-case range selection"}]
    findings = [section for section in sections if section not in methods]
    overview = [[result["title"] + " — scientific findings", [
        result["purpose"],
        str(result["completed_cases"]) + " of " + str(result["total_cases"]) +
        " original cases are complete; " + str(len(selected["selection"]["case_ids"])) +
        " completed cases are selected here. Each constituent retains its original annual-mass unit.",
        "The values below are original modeled annual export. Signed change is case minus baseline "
        "on the cells valid in both runs. Negative change means lower modeled export. "
        "This is a parameter/routing comparison with the original land-cover scenario held fixed.",
    ]]]
    for area in selected["areas"]:
        for pollutant in selected["selection"]["pollutants"]:
            values = [row for row in rows if row["area_id"] == area["id"] and
                      row["pollutant"] == pollutant]
            overview.append([area["name"] + " / " + pollutant.replace("_export", "") +
                             " — original paired comparison", [
                live._table(["Original case", "Units", "Paired change", "Change (%)",
                             "Common area (ha)", "Support changed"], [
                    [row["case"], row["units"], row["change"],
                     row["percent_change"] if row["percent_change"] is not None else
                     ("Undefined: no paired cells" if not row["paired_valid_cells"] else
                      "Undefined: zero paired baseline" if row["baseline_mass"] == 0 else
                      "Undefined in original result"),
                     row["paired_area_ha"], row["support_changed"]] for row in values]),
            ]])
    reversal = next((row for row in rows if row["support_changed"] and
                     row["change"] is not None and row["baseline_full_mass"] is not None and
                     row["case_full_mass"] is not None and
                     ((row["change"] < 0 and row["case_full_mass"] > row["baseline_full_mass"]) or
                      (row["change"] > 0 and row["case_full_mass"] < row["baseline_full_mass"]))), None)
    if reversal:
        overview.append(["Read the comparison on its original common support", [
            "The original " + reversal["case"] + " / " + reversal["pollutant"] +
            " row illustrates why independent full totals and paired effects can point in different directions.",
            live._table(["Original quantity", "Stored value"], [
                ["Paired signed change (" + reversal["units"] + ")", reversal["change"]],
                ["Paired percent change", reversal["percent_change"]],
                ["Baseline own-valid total (" + reversal["units"] + ")", reversal["baseline_full_mass"]],
                ["Case own-valid total (" + reversal["units"] + ")", reversal["case_full_mass"]],
                ["Common valid cells", reversal["paired_valid_cells"]],
                ["Baseline own-valid cells", reversal["baseline_valid_cells"]],
                ["Case own-valid cells", reversal["case_valid_cells"]],
            ]),
            "The independent totals cover different cells. The original paired change compares the "
            "same cells in both runs and is the appropriate value for this particular spatial comparison. "
            "No subtraction of those independent totals replaces the retained common-cell result.",
        ]])
    sections = overview + findings + [["Methods, original selection and source provenance", [
        "The following appendix retains the original identities, selections, source editions, "
        "geographic methods and historical-range policy used for the figures and numeric tables."
    ]]] + methods + prefix
    sections.append(["Original archive, selected rows and figure provenance", [
        "The original complete JSON is attached byte for byte. Selected row values are copied unchanged; "
        "each selected row maps to its original JSON row index in archive-provenance.json. "
        "Historical range rows are retained verbatim as a companion, with their original stated basis. "
        "Original map requests are reported above; this receiving operation does not create a missing raster.",
        {"kind": "links", "items": [
            {"title": "Complete unchanged original result", "path": "original-result.json"},
            {"title": "Original identity, source basis and row mapping", "path": "archive-provenance.json"},
            {"title": "Selected original numeric rows", "path": "selected-results.json"},
            {"title": "Selected rows for working analysis", "path": "selected-results.csv"},
            {"title": "Historical original ranges and stated basis", "path": "historical-ranges.json"},
        ]},
    ]])
    return sections


def _package(directory, raw, result, selected, rows, origin_uri):
    atomic_bytes(directory / "original-result.json", raw, immutable=True)
    atomic_json(directory / "selection.json", selected, immutable=True)
    atomic_json(directory / "selected-results.json", {
        "schema": "upstate.selected-parameter-results/v1", "selection": selected["selection"],
        "rows": rows, "ranges": [], "range_basis": selected["range_basis"]}, immutable=True)
    shared._csv(directory, "selected-results.csv", rows, CSV_FIELDS)
    atomic_json(directory / "historical-ranges.json", {
        "source_basis": SOURCE_BASIS, "original_result_sha256": selected["selection"]["expected_artifact_sha256"],
        "range_basis": result.get("range_basis"), "ranges": result.get("ranges", []),
        "display_policy": selected["range_basis"]}, immutable=True)
    indices = {(row["case_id"], row["area_id"], row["pollutant"]): index
               for index, row in enumerate(result["rows"])}
    provenance = {
        "schema": "upstate.parameter-result-archive-provenance/v1", "source_basis": SOURCE_BASIS,
        "donor_workspace_id": result["workspace_id"], "experiment_id": result["experiment_id"],
        "original_sha256": selected["selection"]["expected_artifact_sha256"],
        "original_bytes": len(raw), "origin_uri": origin_uri,
        "original_selection": deepcopy(result["selection"]),
        "original_baseline_selection": deepcopy(result["baseline_selection"]),
        "native_runtime_metadata_present": {
            name: name in result for name in ("native_versions", "native_version_labels", "native_run_selections")},
        "row_mapping": [{"selected_row": index, "original_row": indices[
            (row["case_id"], row["area_id"], row["pollutant"])],
            "case_id": row["case_id"], "area_id": row["area_id"], "pollutant": row["pollutant"]}
            for index, row in enumerate(rows)],
    }
    atomic_json(directory / "archive-provenance.json", provenance, immutable=True)
    records = [{"id": SOURCE_ID, "title": result["title"], "uri": origin_uri,
                "vintage": "Original archived result " + provenance["original_sha256"],
                "body_sha256": provenance["original_sha256"]}]
    atomic_json(directory / "original-source-editions.json", records, immutable=True)
    graphics = figures.write(directory, selected, rows)
    sections = _sections(result, selected, rows, origin_uri, len(raw))
    sections.append(["Original figure coverage", [
        "Every physical coordinate is copied from a selected original row. Undefined values remain "
        "in the coverage inventory. Case positions are presentation keys, not parameter magnitudes.",
        live._table(["Selected rows", "Figures", "Plotted values", "Undefined values"], [[
            graphics["coverage"][name] for name in
            ("selected_rows", "figure_count", "plotted_values", "undefined_values")]]),
        {"kind": "links", "items": [
            {"title": "Figure specification", "path": figures.SPEC},
            {"title": "Original numeric coordinates", "path": figures.COORDINATES},
            {"title": "Figure coverage", "path": figures.COVERAGE}]},
    ]])
    members = [describe_file(directory, path) for path in sorted(directory.rglob("*"))
               if path.is_file() and path not in
               {directory / "sources.json", directory / "scientific-report.json"}]
    recipe = {"schema": shared.RECIPE_SCHEMA, "title": selected["selection"]["title"],
              "edition": selected["selection"]["expected_artifact_sha256"], "basis": selected,
              "sections": sections, "figure_spec": graphics["figure_spec"],
              "figures": graphics["figures"], "figure_coverage": graphics["coverage"],
              "inputs": members, "source_links": [row["path"] for row in members]}
    atomic_json(directory / "scientific-report.json", recipe, immutable=True)
    atomic_json(directory / "sources.json", {
        "schema": "upstate.sources/v1", "title": recipe["title"], "entries": [{
            "id": SOURCE_ID, "kind": "document", "role": shared.ROLE, "title": recipe["title"],
            "path": "scientific-report.json", "sha256": file_digest(directory / "scientific-report.json"),
            "uri": "urn:upstate:parameter-result-archive:" + provenance["original_sha256"],
            "vintage": records[0]["vintage"], "units": "Original annual mass and paired valid-cell support",
            "metadata": {"report_schema": shared.RECIPE_SCHEMA, "source_basis": SOURCE_BASIS,
                         "donor_workspace_id": result["workspace_id"],
                         "experiment_id": result["experiment_id"],
                         "original_result_sha256": provenance["original_sha256"]},
            "companions": [{"path": row["path"], "sha256": row["sha256"]} for row in members],
        }]}, immutable=True)
    return records


def get(workspace, operation_id):
    key = identifier(operation_id)
    directory = workspace.root / DIRECTORY / key
    operation = read_json(directory / "operation.json")
    if (operation.get("schema") != SCHEMA or operation.get("id") != key or
            operation.get("workspace_id") != workspace.project["id"] or
            digest(operation.get("identity")) != key or
            operation.get("selection") != operation["identity"].get("selection")):
        raise ValueError("The archived scientific source belongs to another receiving selection")
    for descriptor in operation.get("files", {}).values():
        verify_file(workspace.root, descriptor)
    if operation.get("source"):
        workspace.source_file(operation["source"]["source_collection_id"], SOURCE_ID)
    return operation


def prepare(workspace, result_path, *, expected_sha256, selection=None, origin_uri="", render=True):
    """Import exact original bytes, preserve donor identities and optionally render."""
    if type(render) is not bool or (selection is not None and not isinstance(selection, dict)):
        raise ValueError("Choose an archived result selection and boolean render option")
    if not isinstance(origin_uri, str):
        raise ValueError("Original source location must be text")
    raw, original = _read(result_path, expected_sha256)
    selected, rows = _selection(workspace, original, selection or {}, expected_sha256)
    identity = {"schema": SCHEMA, "selection": selected["selection"], "origin_uri": origin_uri,
                "producer_sha256": file_digest(Path(__file__)),
                "sections_sha256": file_digest(Path(live.__file__)),
                "figure_helper_sha256": file_digest(Path(figures.__file__)),
                "figure_svg_helper_sha256": file_digest(Path(figures.drawing.__file__))}
    key = digest(identity)
    directory = workspace.root / DIRECTORY / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock", blocking=False):
        record = directory / "operation.json"
        operation = read_json(record) if record.exists() else {
            "schema": SCHEMA, "id": key, "identity": identity,
            "workspace_id": workspace.project["id"], "donor_workspace_id": original["workspace_id"],
            "experiment_id": original["experiment_id"], "selection": selected["selection"],
            "source_basis": SOURCE_BASIS, "title": selected["selection"]["title"],
            "created_at": now(), "state": "preparing", "files": {}}
        if operation.get("identity") != identity:
            raise ValueError("Existing archive operation has another original selection")
        source = directory / "source"
        source.mkdir(parents=True, exist_ok=True)
        try:
            if not (source / "sources.json").exists():
                _package(source, raw, original, selected, rows, origin_uri)
            recipe = read_json(source / "scientific-report.json")
            if recipe.get("basis") != selected:
                raise ValueError("Existing archive recipe has another original selection")
            for member in recipe["inputs"]:
                verify_file(source, member)
            if not operation.get("source"):
                collection = workspace.import_sources(source / "sources.json")
                operation["source"] = {"source_collection_id": collection["id"], "source_id": SOURCE_ID}
                operation["state"] = "source_ready"
                atomic_json(record, operation)
            else:
                workspace.source_file(operation["source"]["source_collection_id"], SOURCE_ID)
            if render:
                operation["report"] = shared._render(workspace, directory, operation,
                    read_json(source / "original-source-editions.json"))
                operation["files"].update(operation["report"]["files"])
                operation["state"] = "complete"
            for name in ("sources.json", "scientific-report.json", "original-result.json",
                         "selected-results.json", "selected-results.csv", "archive-provenance.json",
                         "historical-ranges.json", figures.SPEC, figures.COORDINATES, figures.COVERAGE):
                operation["files"][name] = describe_file(workspace.root, source / name)
            operation["delivery_selection"] = shared.delivery_selection(operation["source"])
            operation["figure_count"] = len(recipe.get("figures", []))
            operation.pop("error", None)
            operation["updated_at"] = now()
            atomic_json(record, operation)
            return get(workspace, key)
        except BaseException as error:
            operation.update(state="source_ready" if operation.get("source") else "failed",
                             error={"type": type(error).__name__, "message": str(error)}, updated_at=now())
            atomic_json(record, operation)
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--origin-uri", default="")
    parser.add_argument("--selection", help="Optional JSON containing case_ids, area_ids, pollutants or title")
    parser.add_argument("--source-only", action="store_true")
    parser.add_argument("--output", help="Write the completed operation record at this path")
    args = parser.parse_args(argv)
    from .workspace import Workspace
    result = prepare(Workspace(args.workspace), args.result, expected_sha256=args.expected_sha256,
                     selection=read_json(Path(args.selection)) if args.selection else None,
                     origin_uri=args.origin_uri, render=not args.source_only)
    if args.output:
        atomic_json(Path(args.output), result)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
