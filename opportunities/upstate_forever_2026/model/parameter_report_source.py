"""Select a retained Parameter result edition for the shared SourceReports composer.

The original study owns every value, comparison and map. This adapter freezes its
complete exported inputs, then presents the explicitly selected original rows.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import io
from pathlib import Path

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, now, read_json, relative_file, verify_file)
from . import parameter_studies, ensemble_scientific_source as shared
from .parameter_result_query import DEFAULT_RESULTS
from .parameter_exports import member_descriptors, MEMBER_SCHEMA
from .parameter_views import DEFAULT_VIEWS
from . import parameter_scientific_figures as figures

DIRECTORY = "parameter-report-sources"
SCHEMA = "upstate.parameter-report-source/v1"
SOURCE_ID = "saved-parameter-study"
EDITION = 2


def _choices(value, available, label):
    if value is None:
        return list(available)
    if (not isinstance(value, list) or not value or
            any(not isinstance(item, str) or item not in available for item in value) or
            len(set(value)) != len(value)):
        raise ValueError("Choose original " + label + " from this saved result")
    chosen = set(value)
    return [item for item in available if item in chosen]


def _metadata(workspace, key):
    """Open one small indexed page; retain the original matrix as its authority."""
    return DEFAULT_RESULTS.read(workspace, key, limit=1, range_limit=1)


def catalog(workspace, experiment_id):
    key = identifier(experiment_id)
    result = _metadata(workspace, key)
    state = DEFAULT_VIEWS.record(workspace, key)
    available_runs = set(result.get("native_run_selections", {}))
    if not available_runs:
        raise ValueError("Refresh the saved native summary before preparing its scientific source")
    cases = [{name: deepcopy(case[name]) for name in (
        "id", "label", "run_id", "profile_id", "overrides", "axis_values") if name in case}
        for case in state["cases"] if case["run_id"] in available_runs]
    if not cases:
        raise ValueError("The saved result has no retained completed parameter case")
    original_cases = {row["id"]: row for row in state["cases"]}
    for case in cases:
        frozen = original_cases[case["id"]]
        selected = result["native_run_selections"][case["run_id"]]
        if (selected["profile_id"] != case["profile_id"] or
                any(selected[name] != state["baseline_selection"][name]
                    for name in ("grid_id", "scenario_id")) or
                ("run_selection" in frozen and frozen["run_selection"] != selected)):
            raise ValueError("The saved summary differs from its original case selection")
    return {
        "schema": "upstate.parameter-report-catalog/v1", "experiment_id": key,
        "workspace_id": workspace.project["id"], "title": result["title"],
        "purpose": result["purpose"], "artifact_sha256": result["artifact_sha256"],
        "artifact_bytes": result["artifact_bytes"], "cases": cases,
        "areas": deepcopy(result["areas"]), "pollutants": list(result["pollutants"]),
        "models": list(result["models"]), "completed_cases": result["completed_cases"],
        "total_cases": result["total_cases"], "selection": deepcopy(state["selection"]),
        "baseline_selection": deepcopy(state["baseline_selection"]),
        "comparison_id": state.get("comparison_id"),
        "latest": latest(workspace, key),
    }


def preview(workspace, value):
    if not isinstance(value, dict):
        raise ValueError("Choose a saved Parameter result and its report contents")
    packet = catalog(workspace, identifier(value.get("experiment_id")))
    if value.get("expected_artifact_sha256") != packet["artifact_sha256"]:
        raise ValueError("The saved result edition changed. Review its report selection again")
    case_ids = _choices(value.get("case_ids"), [row["id"] for row in packet["cases"]], "parameter cases")
    area_ids = _choices(value.get("area_ids"), [row["id"] for row in packet["areas"]], "reporting areas")
    pollutants = _choices(value.get("pollutants"), packet["pollutants"], "pollutants")
    title = str(value.get("title") or ("Parameter study: " + packet["title"])).strip()
    if not title:
        raise ValueError("Name the scientific report source")
    selection = {
        "edition": EDITION, "experiment_id": packet["experiment_id"],
        "workspace_id": workspace.project["id"], "title": title,
        "expected_artifact_sha256": packet["artifact_sha256"],
        "case_ids": case_ids, "area_ids": area_ids, "pollutants": pollutants,
    }
    return {"selection": selection, "cases": [row for row in packet["cases"] if row["id"] in case_ids],
            "areas": [row for row in packet["areas"] if row["id"] in area_ids],
            "models": packet["models"], "pollutants": pollutants,
            "selected_rows": len(case_ids) * len(area_ids) * len(pollutants),
            "includes_all_completed_cases": len(case_ids) == len(packet["cases"]),
            "completed_cases": packet["completed_cases"], "total_cases": packet["total_cases"],
            "comparison_id": packet["comparison_id"],
            "reference": {
                "run_id": packet["selection"].get("baseline_run_id"),
                "profile_id": packet["baseline_selection"].get("profile_id"),
                "scenario_id": packet["baseline_selection"].get("scenario_id"),
                "grid_id": packet["baseline_selection"].get("grid_id"),
                "run_selection": deepcopy(packet["baseline_selection"]),
            },
            "comparison_basis": "Original case minus baseline on paired valid cells, separately for each reporting area.",
            "range_basis": ("Original saved completed-case ranges appear only when every completed case is selected. "
                            "Selecting fewer cases does not recalculate or relabel those ranges.")}


def _table(columns, rows):
    return {"kind": "table", "columns": columns,
            "rows": [[shared._text(value) if value is not None else "Undefined"
                      for value in row] for row in rows]}


def _selected_rows(workspace, key, selection):
    """Page original byte spans; no native calculation or full-matrix parse."""
    rows, ranges = [], []
    chosen = set(selection["case_ids"])
    for area in selection["area_ids"]:
        for pollutant in selection["pollutants"]:
            offset = range_offset = 0
            while True:
                packet = DEFAULT_RESULTS.read(
                    workspace, key, area_id=area, pollutant=pollutant,
                    offset=offset, limit=500, range_offset=range_offset, range_limit=500,
                    expected_artifact_sha256=selection["expected_artifact_sha256"])
                if packet["edition_changed"]:
                    raise ValueError("The original Parameter result changed during source preparation")
                rows.extend(row for row in packet["rows"] if row["case_id"] in chosen)
                if offset == 0:
                    ranges.extend(packet["ranges"])
                offset += len(packet["rows"])
                if offset >= packet["filtered_rows"]:
                    break
                if not packet["rows"]:
                    raise ValueError("The original Parameter result page did not advance")
    identities = [(row["case_id"], row["area_id"], row["pollutant"]) for row in rows]
    expected = {(case, area, pollutant) for case in chosen for area in selection["area_ids"]
                for pollutant in selection["pollutants"]}
    if len(identities) != len(set(identities)) or set(identities) != expected:
        raise ValueError("The original result does not contain exactly the selected case/area/pollutant matrix")
    return rows, ranges


def _retain_source(workspace, directory, collection_id, source_id, records, bindings):
    identity = (identifier(collection_id), source_id)
    if identity in bindings:
        return
    source, entry = workspace.source_file(*identity)
    collection = workspace._get("sources", identity[0])
    prefix = directory / "original-sources" / identity[0] / digest(source_id)
    atomic_json(prefix / "entry.json", entry, immutable=True)
    shared._copy(workspace, collection["original_manifest"], prefix / "original-manifest.json")
    for item in [entry["body"], *entry.get("companions", [])]:
        shared._copy(workspace, item, prefix / "members" / shared._member(
            item.get("view_path", item["filename"])))
    bindings[identity] = {"source_collection_id": identity[0], "source_id": identity[1],
                          "entry": deepcopy(entry)}
    records.append({"id": "original-%04d" % len(records), "source_collection_id": identity[0],
                    "source_id": source_id, "title": entry.get("title", source_id),
                    "uri": entry.get("uri", ""), "vintage": entry.get("vintage", ""),
                    "body_sha256": entry["body"]["sha256"]})


def _freeze(workspace, key, directory, selected, state):
    original = workspace.root / "experiments" / key
    artifact = state["artifacts"]["results"]
    if artifact["sha256"] != selected["selection"]["expected_artifact_sha256"]:
        raise ValueError("The selected original summary changed before freezing its files")
    member = state["artifacts"].get("export_manifest")
    if not member:
        raise ValueError("Refresh completed results to retain the complete native export manifest")
    manifest = read_json(verify_file(original, member))
    if (manifest.get("schema") != MEMBER_SCHEMA or manifest.get("study_id") != key or
            manifest.get("workspace_id") != workspace.project["id"] or
            manifest.get("selection_sha256") != digest(state["selection"])):
        raise ValueError("The original export manifest belongs to another saved study")
    files = member_descriptors(original, manifest["files"])
    if files.get(artifact["path"]) != artifact:
        # Descriptors may carry presentation metadata; body identity is exact.
        body = files.get(artifact["path"], {})
        if any(body.get(name) != artifact.get(name) for name in ("path", "bytes", "sha256")):
            raise ValueError("The original export manifest does not bind the selected result")
    for item in [*files.values(), member]:
        source = relative_file(original, item["path"])
        shared._copy(workspace, {**item, "path": source.relative_to(workspace.root).as_posix()},
                     directory / "original-study" / shared._member(item["path"]))
    checkpoint = directory / "original-study" / "checkpoint.json"
    if checkpoint.exists():
        prior = read_json(checkpoint)
        if (prior.get("selection") != state["selection"] or
                prior.get("artifacts", {}).get("results") != state["artifacts"]["results"]):
            raise ValueError("The frozen original checkpoint selects another scientific result")
    else:
        atomic_json(checkpoint, state, immutable=True)
    atomic_json(directory / "selection.json", selected, immutable=True)
    rows, ranges = _selected_rows(workspace, key, selected["selection"])
    if not selected["includes_all_completed_cases"]:
        ranges = []
    atomic_json(directory / "selected-results.json", {
        "schema": "upstate.selected-parameter-results/v1",
        "selection": selected["selection"], "rows": rows, "ranges": ranges,
        "range_basis": selected["range_basis"]}, immutable=True)
    fields = ("case_id", "case", "run_id", "profile_id", "area_id", "area", "pollutant", "units",
              "baseline_mass", "case_mass", "change", "percent_change", "baseline_full_mass",
              "case_full_mass", "baseline_valid_cells", "case_valid_cells", "paired_valid_cells",
              "paired_area_ha", "support_changed", "parameter", "baseline_parameter",
              "case_parameter", "response_per_parameter_unit", "elasticity", "pixel_area_ha",
              "baseline_valid_area_ha", "case_valid_area_ha")
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({name: ("'" + value if isinstance(value, str) and
                               value.startswith(("=", "+", "-", "@", "\t", "\r")) else value)
                         for name, value in row.items()})
    atomic_bytes(directory / "selected-results.csv", buffer.getvalue().encode("utf-8"), immutable=True)
    records, bindings = [], {}
    for profile_id in dict.fromkeys([state["baseline_selection"]["profile_id"],
                                    *(row["profile_id"] for row in selected["cases"])]):
        profile = workspace._get("profiles", identifier(profile_id))
        atomic_json(directory / "profiles" / (profile_id + ".json"), profile, immutable=True)
        _retain_source(workspace, directory, profile["source_collection_id"],
                       profile["biophysical_source_id"], records, bindings)
    for area in selected["areas"]:
        original_selection = area.get("source", {}).get("selection")
        if original_selection:
            _retain_source(workspace, directory, original_selection["source_collection_id"],
                           original_selection["source_id"], records, bindings)
    grid = workspace.get_grid(state["baseline_selection"]["grid_id"])
    grid_root = workspace.root / "grids" / grid["id"]
    atomic_json(directory / "grid.json", grid, immutable=True)
    for name in ("reporting_area", "model_domain"):
        item = grid["files"].get(name)
        if item:
            shared._copy(workspace, {**item, "path": relative_file(
                grid_root, item["path"]).relative_to(workspace.root).as_posix()},
                         directory / "geography" / shared._member(item["path"]))
    atomic_json(directory / "original-source-editions.json", records, immutable=True)
    atomic_json(directory / "native-input-inventory.json", {
        "workspace_id": workspace.project["id"], "experiment_id": key,
        "baseline_selection": state["baseline_selection"], "grid": grid,
        "source_bindings": list(bindings.values()),
        "scope": "Complete original study exports, native arguments and aggregation context are retained. "
                 "The full Workspace archive retains the large original/aligned model-input and output rasters."
    }, immutable=True)
    return rows, ranges, records


def _sections(selected, rows, ranges):
    selection = selected["selection"]
    positions = {key: index + 1 for index, key in enumerate(selection["case_ids"])}
    reference = selected.get("reference", {})

    def percent_value(row):
        if row["percent_change"] is not None:
            return row["percent_change"]
        if not row["paired_valid_cells"]:
            return "Undefined: no paired valid cells"
        if row["baseline_mass"] == 0:
            return "Undefined: zero paired baseline"
        return "Undefined in original result"

    def mask_agreement(row):
        if not row["paired_valid_cells"]:
            return "No paired valid cells"
        return "No" if row["support_changed"] else "Yes"

    def response_value(row, name):
        if "parameter" not in row:
            return "Not applicable / not reported"
        if name == "elasticity" and row.get(name) is None:
            if row["baseline_mass"] in (None, 0):
                return "Undefined: zero or unavailable baseline mass"
            if row.get("baseline_parameter") == 0:
                return "Undefined: zero baseline parameter"
            return "Undefined in original result"
        return row.get(name)

    sections = [
        ["Saved Parameter result selection", [
            selected["comparison_basis"],
            "Every displayed physical value comes from the selected saved result edition. "
            "Changing report choices runs no model and changes no scientific value.",
            _table(["Original selection", "Retained value"], [
                ["Study", selection["experiment_id"]],
                ["Result SHA256", selection["expected_artifact_sha256"]],
                ["Completed original cases", selected["completed_cases"]],
                ["Cases in the original design", selected["total_cases"]],
                ["Completed cases selected for this report", len(selection["case_ids"])],
                ["Selected reporting areas", len(selection["area_ids"])],
                ["Selected pollutants", ", ".join(selection["pollutants"])],
            ]),
            "Completed-case counts include the native study's reference case when it is retained. "
            "A partial study preserves its completed results and the original design count; "
            "unfinished cases do not become zero responses. A report may explicitly select fewer "
            "completed cases than the study contains.",
        ]],
        ["Original fixed baseline and case key", [
            "Every parameter case is compared with this original baseline, including when the "
            "baseline case itself was excluded from the report selection. Land cover and grid "
            "remain the original study selections.",
            _table(["Reference selection", "Original identity"], [
                ["Baseline native run", reference.get("run_id") or "Unspecified in the original selection"],
                ["Baseline profile", reference.get("profile_id") or "Unspecified in the original selection"],
                ["Land-cover scenario", reference.get("scenario_id") or "Unspecified in the original selection"],
                ["Prepared grid", reference.get("grid_id") or "Unspecified in the original selection"],
            ]),
            "Case positions below match the existing figure ticks and coordinate exports for this "
            "retained report selection. They keep the same case across reporting areas and pollutants. "
            "They are display keys, not parameter values or persistent native case IDs.",
            _table(["Position", "Original case", "Native case ID"], [
                [positions[row["id"]], row["label"], row["id"]] for row in selected["cases"]
            ]),
            _table(["Position", "Original profile", "Native run", "Parameter assignments"], [
                [positions[row["id"]], row["profile_id"], row["run_id"], row.get("overrides", {})]
                for row in selected["cases"]
            ]),
        ]],
        ["Reporting geography", [
            "Each selected polygon is intersected with the original model reporting mask at pixel centres. "
            "Paired masses use cells valid in both the baseline and the case within that area. "
            "Own-valid full totals use each run's own valid cells inside the same area and reporting mask.",
            _table(["Area", "Area ID", "Original area (ha)", "Reporting intersection (ha)"], [
                [row["name"], row["id"], row.get("source_area_ha"), row.get("reporting_intersection_ha")]
                for row in selected["areas"]
            ]),
            _table(["Area", "Original source selection"], [
                [row["name"], row.get("source", {})] for row in selected["areas"]
            ]),
            "These original areas and paired hectare values retain the native grid's own area calculation. "
            "They are not derived from a fixed nominal pixel size in this report.",
        ]],
    ]
    for area in selected["areas"]:
        for pollutant in selection["pollutants"]:
            chosen = [row for row in rows if row["area_id"] == area["id"] and row["pollutant"] == pollutant]
            for offset in range(0, len(chosen), 80):
                page = chosen[offset:offset + 80]
                title = (area["name"] + " / " + pollutant.replace("_export", "") +
                         " / selected cases " + str(offset + 1) + "–" + str(offset + len(page)))
                sections.append([title + " — paired annual mass", [
                    "Change is the original selected case minus baseline on cells valid in both runs. "
                    "Negative change means lower modeled export. The position identifies the original "
                    "case in the fixed-baseline case key and figures.",
                    _table(["Position", "Units", "Baseline paired mass", "Case paired mass",
                            "Signed change", "Change (%)"], [
                        [positions[row["case_id"]], row["units"], row["baseline_mass"], row["case_mass"],
                         row["change"], percent_value(row)] for row in page
                    ]),
                    "No paired valid cells leaves both paired masses, change and percent undefined. "
                    "With paired cells present, a zero baseline mass leaves percent undefined even "
                    "when the stored mass change is defined. Original missing values do not become zero.",
                ]])
                sections.append([title + " — original geographic support", [
                    _table(["Position", "Baseline valid", "Case valid", "Paired valid",
                            "Paired area (ha)", "Pair masks identical"], [
                        [positions[row["case_id"]], row["baseline_valid_cells"], row["case_valid_cells"],
                         row["paired_valid_cells"], row["paired_area_ha"], mask_agreement(row)]
                        for row in page
                    ]),
                    "Pair masks identical means the original support_changed field is false with "
                    "paired cells present. Both runs can still share missing cells. Counts cover this "
                    "selected area inside the reporting mask; they do not establish whole-catchment "
                    "coverage. Changed-support pairs retain their own original intersection.",
                    _table(["Position", "Units", "Baseline own-valid full mass", "Case own-valid full mass"], [
                        [positions[row["case_id"]], row["units"], row["baseline_full_mass"],
                         row["case_full_mass"]] for row in page
                    ]),
                    "The two own-valid full totals can cover different cells. Their subtraction "
                    "does not replace the original paired change. A run without valid cells has an "
                    "undefined own-valid mass; a valid stored zero remains zero.",
                ]])
                if any("parameter" in row for row in page):
                    sections.append([title + " — finite parameter response", [
                        _table(["Position", "Varied parameter", "Baseline parameter", "Case parameter"], [
                            [positions[row["case_id"]], row.get("parameter", "Not applicable / not reported"),
                             response_value(row, "baseline_parameter"), response_value(row, "case_parameter")]
                            for row in page
                        ]),
                        _table(["Position", "Mass units", "Response per parameter unit", "Elasticity"], [
                            [positions[row["case_id"]], row["units"],
                             response_value(row, "response_per_parameter_unit"),
                             response_value(row, "elasticity")] for row in page
                        ]),
                        "The native producer reports a response only for a single numeric override, "
                        "a nonzero tested parameter step and a defined paired change. It is the saved "
                        "finite change per original parameter unit. Elasticity also needs nonzero "
                        "baseline mass and baseline parameter. Routing choices and multi-parameter "
                        "cases have no single-parameter response. These values describe the tested "
                        "step; they are not a fitted derivative, calibration or probability estimate.",
                    ]])
    if ranges:
        sections.append(["Original ranges over eligible completed cases", [
            selected["range_basis"],
            "The retained ranges describe completed original cases with paired data and unchanged "
            "baseline support in each area, including the native reference case. They do not describe "
            "unfinished cases or a probability distribution. Their values are copied from the saved "
            "producer; this report does not recalculate them.",
            _table(["Area", "Pollutant", "Units", "Eligible completed cases", "Minimum case mass",
                    "Maximum case mass"], [
                [row[name] for name in ("area", "pollutant", "units", "cases", "minimum_mass",
                                       "maximum_mass")] for row in ranges
            ]),
            _table(["Area / pollutant", "Minimum case ID", "Maximum case ID",
                    "Changed-support cases with paired data"], [
                [row["area"] + " / " + row["pollutant"], row["minimum_case_id"],
                 row["maximum_case_id"], row["support_changed_cases"]] for row in ranges
            ]),
            "Changed-support cases with paired data are excluded from these ranges and remain "
            "visible in the original paired/support tables. Cases without paired data are separate "
            "undefined rows and are not included in that changed-support count.",
        ]])
    else:
        sections.append(["Original completed-case range selection", [
            selected["range_basis"],
            "No original range rows are included in this source selection. Selecting only some "
            "completed cases does not create a new range. The original selected pair rows remain "
            "available with their own geographic support.",
        ]])
    sections.append(["Original files and spatial interpretation", [
        "The complete original report retains every case, area, pollutant, executed version and requested difference map. "
        "GIS rasters describe the original comparison extent; selecting a reporting polygon here does not clip or modify a raster. "
        "Undefined quantities remain undefined.",
        {"kind": "links", "items": [
            {"title": "Selected exact numeric rows (JSON)", "path": "selected-results.json"},
            {"title": "Selected rows (CSV)", "path": "selected-results.csv"},
            {"title": "Original complete scientific report", "path": "original-study/report.html"},
            {"title": "Complete original results", "path": "original-study/results.json"},
            {"title": "Original exported member identities", "path": "original-study/export-manifest.json"},
            {"title": "Native input inventory and source bindings", "path": "native-input-inventory.json"}]},
    ]])
    return sections


def _recipe(directory, selected, rows, ranges):
    graphics = figures.write(directory, selected, rows)
    sections = _sections(selected, rows, ranges)
    sections.append(["Original figure coverage", [
        "Figures preserve each original pair separately. Undefined quantities have no plotted point. "
        "Full geographic support and original case/profile/run keys accompany each figure.",
        _table(["Selected rows", "Figures", "Plotted values", "Undefined values"], [[
            graphics["coverage"][name] for name in (
                "selected_rows", "figure_count", "plotted_values", "undefined_values")]]),
        {"kind": "links", "items": [
            {"title": "Exact physical coordinates and original source pointers", "path": figures.COORDINATES},
            {"title": "Original figure specification and case keys", "path": figures.SPEC},
            {"title": "Undefined-value coverage and source rows", "path": figures.COVERAGE}]},
    ]])
    members = [describe_file(directory, path) for path in sorted(directory.rglob("*"))
               if path.is_file() and path not in {directory / "sources.json", directory / "scientific-report.json"}]
    recipe = {"schema": shared.RECIPE_SCHEMA, "title": selected["selection"]["title"],
              "edition": selected["selection"]["expected_artifact_sha256"],
              "basis": selected, "sections": sections,
              "figure_spec": graphics["figure_spec"], "figures": graphics["figures"],
              "figure_coverage": graphics["coverage"],
              "inputs": members, "source_links": [row["path"] for row in members]}
    atomic_json(directory / "scientific-report.json", recipe, immutable=True)
    atomic_json(directory / "sources.json", {
        "schema": "upstate.sources/v1", "title": recipe["title"], "entries": [{
            "id": SOURCE_ID, "kind": "document", "role": shared.ROLE, "title": recipe["title"],
            "path": "scientific-report.json", "sha256": file_digest(directory / "scientific-report.json"),
            "uri": "urn:upstate:parameter-study:" + selected["selection"]["experiment_id"] +
                   ":" + selected["selection"]["expected_artifact_sha256"],
            "vintage": "Retained Parameter result " + selected["selection"]["expected_artifact_sha256"],
            "units": "Original annual mass and coverage, separated by pollutant and reporting area",
            "metadata": {"report_schema": shared.RECIPE_SCHEMA, "source_basis": "saved_parameter_study",
                         "experiment_id": selected["selection"]["experiment_id"]},
            "companions": [{"path": row["path"], "sha256": row["sha256"]} for row in members],
        }]}, immutable=True)


def get(workspace, source_id):
    key = identifier(source_id)
    directory = workspace.root / DIRECTORY / key
    operation = read_json(directory / "operation.json")
    if (operation.get("schema") != SCHEMA or operation.get("id") != key or
            operation.get("workspace_id") != workspace.project["id"] or
            digest(operation["identity"]) != key or
            operation.get("selection") != operation["identity"].get("selection") or
            operation.get("experiment_id") != operation["selection"].get("experiment_id")):
        raise ValueError("The Parameter scientific source belongs to another original selection")
    state = DEFAULT_RESULTS.checkpoint(workspace, identifier(operation["experiment_id"]))
    current = state.get("artifacts", {}).get("results", {}).get("sha256")
    return {**operation, "source_state": (
        "current" if current == operation["selection"]["expected_artifact_sha256"] else "earlier-result")}


def summary(workspace, experiment_id, artifact_sha256=None):
    """Read the compact pointer without parsing the selected case/source inventory."""
    key = identifier(experiment_id)
    pointer = workspace.root / "experiments" / key / "latest-scientific-source.json"
    if not pointer.is_file():
        return None
    value = read_json(pointer)
    if value.get("experiment_id") != key:
        raise ValueError("The scientific source pointer belongs to another study")
    return {"id": identifier(value["source_operation_id"]), "experiment_id": key,
            "title": value.get("title"), "state": value.get("state"),
            "source_state": "current" if value.get("artifact_sha256") == artifact_sha256 else "earlier-result"}


def latest(workspace, experiment_id):
    key = identifier(experiment_id)
    pointer = workspace.root / "experiments" / key / "latest-scientific-source.json"
    if not pointer.is_file():
        return None
    value = read_json(pointer)
    result = get(workspace, identifier(value["source_operation_id"]))
    if result["experiment_id"] != key:
        raise ValueError("The scientific source pointer belongs to another study")
    return result


def prepare(workspace, value, *, render=True):
    if type(render) is not bool:
        raise ValueError("Choose whether to render the shared scientific report")
    selected = preview(workspace, value)
    key = selected["selection"]["experiment_id"]
    state = parameter_studies._read(workspace, key)
    identity = {"schema": SCHEMA, "selection": selected["selection"],
                "export_manifest": state.get("artifacts", {}).get("export_manifest"),
                "producer_sha256": file_digest(Path(__file__)),
                "figure_helper_sha256": file_digest(Path(figures.__file__)),
                "figure_svg_helper_sha256": file_digest(Path(figures.drawing.__file__))}
    operation_id = digest(identity)
    directory = workspace.root / DIRECTORY / operation_id
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock", blocking=False):
        record = directory / "operation.json"
        operation = read_json(record) if record.exists() else {
            "schema": SCHEMA, "id": operation_id, "identity": identity,
            "workspace_id": workspace.project["id"], "experiment_id": key,
            "selection": selected["selection"], "title": selected["selection"]["title"],
            "created_at": now(), "state": "preparing", "files": {}}
        if operation.get("identity") != identity:
            raise ValueError("The retained Parameter report has another original selection")
        source = directory / "source"
        source.mkdir(parents=True, exist_ok=True)
        try:
            if not operation.get("source"):
                if not (source / "sources.json").exists():
                    with held(workspace.root / "experiments" / key / ".experiment.lock", blocking=False):
                        state = parameter_studies._read(workspace, key)
                        if state.get("artifacts", {}).get("export_manifest") != identity["export_manifest"]:
                            raise ValueError("The original export edition changed during report preparation")
                        rows, ranges, records = _freeze(workspace, key, source, selected, state)
                    _recipe(source, selected, rows, ranges)
                recipe = read_json(source / "scientific-report.json")
                if recipe["basis"] != selected:
                    raise ValueError("The retained report recipe has another selected native result")
                for item in recipe["inputs"]:
                    verify_file(source, item)
                collection = workspace.import_sources(source / "sources.json")
                operation.update(source={"source_collection_id": collection["id"], "source_id": SOURCE_ID},
                                 state="source_ready", selected_cases=selected["cases"],
                                 selected_areas=selected["areas"], comparison_id=selected["comparison_id"])
                atomic_json(record, operation)
            else:
                workspace.source_file(operation["source"]["source_collection_id"], SOURCE_ID)
            if render:
                operation["report"] = shared._render(
                    workspace, directory, operation, read_json(source / "original-source-editions.json"))
                operation["files"].update(operation["report"]["files"])
                operation["state"] = "complete"
            for name, path in (("source_manifest", "sources.json"), ("selected_rows", "selected-results.json"),
                               ("selected_csv", "selected-results.csv"), ("report_recipe", "scientific-report.json"),
                               ("figure_specification", figures.SPEC), ("figure_coordinates", figures.COORDINATES),
                               ("figure_coordinates_json", "parameter-figure-coordinates.json"),
                               ("figure_coverage", figures.COVERAGE)):
                operation["files"][name] = describe_file(workspace.root, source / path)
            operation["delivery_selection"] = shared.delivery_selection(operation["source"])
            operation.pop("error", None)
            operation["updated_at"] = now()
            atomic_json(record, operation)
            atomic_json(workspace.root / "experiments" / key / "latest-scientific-source.json",
                        {"experiment_id": key, "source_operation_id": operation_id,
                         "title": operation["title"], "state": operation["state"],
                         "artifact_sha256": operation["selection"]["expected_artifact_sha256"]})
            return get(workspace, operation_id)
        except BaseException as error:
            operation.update(error={"type": type(error).__name__, "message": str(error)}, updated_at=now())
            atomic_json(record, operation)
            raise
