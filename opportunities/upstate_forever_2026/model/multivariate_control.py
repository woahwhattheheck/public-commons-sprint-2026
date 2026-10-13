"""Saved multivariate control designs over original Workspace native inputs.

The matching producer owns cell selection. This module owns explicit saved
choices, original-source custody, scenario/experiment adoption and reopening.
No catalogue, preview or inspect call executes a native model.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import io
import math
from pathlib import Path

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, now, read_json, relative_file,
                     selected_models, verify_file)
from . import experiments, scenario_footprint

SELECTION_SCHEMA = "upstate.multivariate-control-selection/v1"
DESIGN_SCHEMA = "upstate.multivariate-control-design/v1"
ROOT = "multivariate-controls"
VERSION = "2026-10-13.1"
EXTERNAL_ROLES = ("SLOPE", "CONNECTIVITY")
SCALAR_UNITS = {"DEM": "m", "K_FACTOR": "t*ha*h/(ha*MJ*mm)",
                "R_FACTOR": "MJ*mm/(ha*h*year)"}
INTERPRETATION = [
    "This is a designed model contrast, not an observational causal estimate.",
    "Original compiled final land-cover changes define every treatment cell; a design never silently drops targets.",
    "Exact source-grid cells, original class/transition and declared covariate strata define admissible controls.",
    "DEM is elevation, not slope or hydrologic connectivity. Within-bin covariate differences remain reported.",
    "The original prepared precipitation field is an NDR runoff proxy; its actual units and profile normalization remain unchanged.",
    "Runoff-proxy matching within strata does not establish globally optimal multivariate balance.",
    "Existing native runs and earlier controls remain unchanged. Adopting creates a new original scenario and experiment.",
]


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + " must be nonempty text")
    return value.strip()


def _number(value, label, *, nonnegative=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(label + " must be finite numeric")
    value = float(value)
    if not math.isfinite(value) or (nonnegative and value < 0):
        raise ValueError(label + " is outside its declared range")
    return value


def normalize(selection):
    if not isinstance(selection, dict):
        raise ValueError("Use a multivariate-control selection object")
    allowed = {"schema", "title", "reason", "baseline_run_id",
               "restoration_footprint_id", "strata", "precipitation_caliper",
               "exclusion_source", "max_working_bytes"}
    if set(selection) - allowed:
        raise ValueError("Unknown control selection fields: " +
                         ", ".join(sorted(set(selection) - allowed)))
    if selection.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError("Use the original multivariate-control selection schema")
    strata = selection.get("strata")
    if not isinstance(strata, list) or not strata:
        raise ValueError("Declare at least one original DEM/K/R covariate stratum")
    seen, normalized = set(), []
    for item in strata:
        if not isinstance(item, dict) or set(item) not in ({"role", "boundaries", "units"},
                {"role", "boundaries", "units", "source", "definition"}):
            raise ValueError("Each stratum needs role, boundaries and original units")
        role = item["role"]
        if role not in (*SCALAR_UNITS, *EXTERNAL_ROLES) or role in seen:
            raise ValueError("Select each original DEM/K_FACTOR/R_FACTOR role at most once")
        seen.add(role)
        edges = item["boundaries"]
        if not isinstance(edges, list):
            raise ValueError("Covariate boundaries must be an ordered list")
        edges = [_number(v, role + " boundary") for v in edges]
        if any(a >= b for a, b in zip(edges, edges[1:])):
            raise ValueError("Covariate boundaries must be strictly increasing")
        if role in SCALAR_UNITS and item["units"] != SCALAR_UNITS[role]:
            raise ValueError("Use the exact original prepared " + role + " units")
        row = {"role": role, "boundaries": edges, "units": _text(item["units"], "Original covariate units")}
        if role in EXTERNAL_ROLES:
            if set(item) != {"role", "boundaries", "units", "source", "definition"}:
                raise ValueError("Slope/connectivity strata require an exact original source and definition")
            source = item["source"]
            if not isinstance(source, dict) or set(source) != {"source_collection_id", "source_id", "source_sha256"}:
                raise ValueError("Use a complete covariate source binding")
            row["source"] = {"source_collection_id": identifier(source["source_collection_id"]),
                             "source_id": _text(source["source_id"], "Covariate source ID"),
                             "source_sha256": identifier(source["source_sha256"])}
            row["definition"] = _text(item["definition"], "Covariate definition")
        elif "source" in item:
            raise ValueError("DEM/K/R use the original prepared grid, not alternate source overrides")
        normalized.append(row)
    order = {role: index for index, role in enumerate((*SCALAR_UNITS, *EXTERNAL_ROLES))}
    normalized.sort(key=lambda row: order[row["role"]])
    caliper = selection.get("precipitation_caliper")
    if caliper is not None:
        caliper = _number(caliper, "Precipitation caliper", nonnegative=True)
    excluded = selection.get("exclusion_source")
    if excluded is not None:
        if not isinstance(excluded, dict) or set(excluded) != {
                "source_collection_id", "source_id", "source_sha256"}:
            raise ValueError("Select the complete original exclusion source binding")
        excluded = {"source_collection_id": identifier(excluded["source_collection_id"]),
                    "source_id": _text(excluded["source_id"], "Exclusion source ID"),
                    "source_sha256": identifier(excluded["source_sha256"])}
    memory = selection.get("max_working_bytes")
    if type(memory) is not int or memory <= 0:
        raise ValueError("Declare positive integer admitted working bytes")
    return {"schema": SELECTION_SCHEMA, "title": _text(selection.get("title"), "Title"),
            "reason": _text(selection.get("reason"), "Reason"),
            "baseline_run_id": identifier(selection.get("baseline_run_id")),
            "restoration_footprint_id": identifier(selection.get("restoration_footprint_id")),
            "strata": normalized, "precipitation_caliper": caliper,
            "exclusion_source": excluded, "max_working_bytes": memory}


def _grid_file(ws, grid, role):
    if role not in grid.get("files", {}):
        raise ValueError("The original prepared grid lacks " + role)
    descriptor = deepcopy(grid["files"][role])
    directory = ws.root / "grids" / grid["id"]
    verify_file(directory, descriptor)
    descriptor["path"] = relative_file(directory, descriptor["path"]).relative_to(ws.root).as_posix()
    return descriptor


def _source(ws, selected):
    collection = ws._get("sources", selected["source_collection_id"])
    rows = [e for e in collection["entries"] if e["id"] == selected["source_id"]]
    if len(rows) != 1:
        raise ValueError("Select one original retained source entry")
    entry = rows[0]
    if entry["kind"] != "raster" or entry["body"]["sha256"] != selected["source_sha256"]:
        raise ValueError("The selected exclusion raster/source hash differs")
    # Read original CAS directly: read-only admission does not materialize views.
    for body in [entry["body"], *entry.get("companions", [])]:
        verify_file(ws.root, {**body, "path": body["object"]})
    return {"selection": deepcopy(selected), "entry": deepcopy(entry),
            "collection_sha256": file_digest(ws.root / "sources" / (collection["id"] + ".json"))}


def binding(ws, selection):
    """Bind exact immutable/native inputs, without compiling or materializing views."""
    chosen = normalize(selection)
    baseline = ws.inspect_run(chosen["baseline_run_id"])
    base = baseline["selection"]
    if baseline["id"] != chosen["baseline_run_id"] or digest(base) != baseline["id"]:
        raise ValueError("The original baseline run selection changed")
    if ws._get("scenarios", base["scenario_id"])["kind"] != "baseline":
        raise ValueError("Select an original baseline scenario run")
    footprint = scenario_footprint.get_footprint(ws, chosen["restoration_footprint_id"])
    restoration = ws.inspect_run(footprint["run_id"])
    other = restoration["selection"]
    if footprint["selection"] != other or digest(other) != restoration["id"]:
        raise ValueError("The retained restoration footprint/run selection differs")
    if (any(base[k] != other[k] for k in ("grid_id", "profile_id"))
            or selected_models(base) != selected_models(other)):
        raise ValueError("Baseline and restoration must share the exact original grid/profile/model scope")
    if ws._get("scenarios", other["scenario_id"])["kind"] != "landcover":
        raise ValueError("Select a compiled original land-cover restoration")
    if int(footprint["summary"]["net_changed_cells"]) <= 0:
        raise ValueError("The original restoration has no final categorical changes")
    grid = ws.get_grid(base["grid_id"])
    roles = ["NLCD", "reporting_mask", "PRECIPITATION"] + [r for r in SCALAR_UNITS if r in grid.get("files", {})]
    for row in chosen["strata"]:
        if row["role"] in SCALAR_UNITS and row["role"] not in roles:
            raise ValueError("The original prepared grid lacks selected " + row["role"])
    files = {role: _grid_file(ws, grid, role) for role in roles}
    for role in SCALAR_UNITS:
        if role in files and files[role].get("units") != SCALAR_UNITS[role]:
            raise ValueError("The prepared " + role + " units differ from the declared strata")
    if not files["PRECIPITATION"].get("units"):
        raise ValueError("The original prepared runoff proxy must declare its actual units")
    external = {}
    for row in chosen["strata"]:
        if row["role"] in EXTERNAL_ROLES:
            source = _source(ws, row["source"])
            if source["entry"].get("conversion"):
                raise ValueError("Select an already-prepared original optional covariate; raw conversion metadata is not applied")
            if source["entry"].get("units") != row["units"]:
                raise ValueError("Covariate units differ from the exact original source")
            external[row["role"]] = source
            files[row["role"]] = {**deepcopy(source["entry"]["body"]),
                                  "path": source["entry"]["body"]["object"], "units": row["units"]}
    stage = restoration.get("stages", {}).get("landcover", {}).get("artifact")
    native_landcover = None
    if stage:
        verify_file(ws.root / "runs" / restoration["id"], stage)
        native_landcover = {**deepcopy(stage),
                            "path": "runs/" + restoration["id"] + "/" + stage["path"]}
    elif restoration.get("state") == "complete":
        raise ValueError("Completed restoration lacks its actual executed land-cover artifact")
    original_collection = ws._get("sources", grid["spec"]["source_collection_id"])
    original_entries = {entry["id"]: entry for entry in original_collection["entries"]}
    grid_sources = {}
    for role in roles:
        if role == "reporting_mask":
            continue
        source_id = grid["spec"]["input_sources"][role]
        entry = original_entries[source_id]
        source = _source(ws, {"source_collection_id": original_collection["id"],
                              "source_id": source_id, "source_sha256": entry["body"]["sha256"]})
        native_input = grid.get("inputs", {}).get(role, {})
        if native_input.get("source_sha256") != entry["body"]["sha256"]:
            raise ValueError("Prepared input and original source collection disagree for " + role)
        grid_sources[role] = source
    native = {"baseline": deepcopy(base), "restoration": deepcopy(other)}
    descriptors = {
        "grid": describe_file(ws.root, ws.root / "grids" / grid["id"] / "grid.json"),
        "profile": describe_file(ws.root, ws.root / "profiles" / (base["profile_id"] + ".json")),
        "baseline_scenario": describe_file(ws.root, ws.root / "scenarios" / (base["scenario_id"] + ".json")),
        "restoration_scenario": describe_file(ws.root, ws.root / "scenarios" / (other["scenario_id"] + ".json")),
        "restoration_footprint": describe_file(ws.root, ws.root / "scenario-footprints" / (footprint["id"] + ".json")),
    }
    # grid.json may gain additional prepared model roles later. Bind the retained
    # grid definition and selected files below; keep this descriptor as original evidence.
    result = {"schema": "upstate.multivariate-control-binding/v1",
              "project_id": ws.project["id"], "grid_id": grid["id"],
              "profile_id": base["profile_id"], "baseline_run_id": baseline["id"],
              "restoration_run_id": restoration["id"], "restoration_footprint_id": footprint["id"],
              "native_selections": native, "grid": deepcopy(grid["grid"]),
              "grid_spec": deepcopy(grid["spec"]),
              "grid_inputs": {role: deepcopy(grid.get("inputs", {}).get(role))
                              for role in roles if role != "reporting_mask"},
              "files": files, "original_records": descriptors,
              "restoration_files": deepcopy(footprint["files"]),
              "restoration_summary": deepcopy(footprint["summary"]),
              "native_landcover": native_landcover, "external_covariates": external, "grid_sources": grid_sources,
              "restoration_transitions": deepcopy(footprint["transitions"]),
              "exclusion_source": _source(ws, chosen["exclusion_source"]) if chosen["exclusion_source"] else None}
    return chosen, result


def _folder(ws, key):
    return ws.root / ROOT / identifier(key)


def _identity(ws, selected, bound, producer):
    return {"schema": DESIGN_SCHEMA, "version": VERSION,
            "project_id": ws.project["id"], "selection": selected, "binding": bound,
            "implementation": {"workspace": file_digest(Path(__file__)), **producer}}


def catalog(ws):
    """Original IDs and saved designs; no default scientific selection."""
    baselines, restorations, issues = [], [], []
    for path in sorted((ws.root / "runs").glob("*/run.json")):
        try:
            run = ws.inspect_run(path.parent.name)
            scenario = ws._get("scenarios", run["selection"]["scenario_id"])
            if scenario["kind"] == "baseline":
                baselines.append({"id": run["id"], "state": run["state"],
                                  "selection": run["selection"], "title": scenario["title"]})
        except (ValueError, KeyError, OSError) as error:
            issues.append({"kind": "run", "id": path.parent.name, "error": str(error)})
    for footprint in scenario_footprint.list_footprints(ws):
        try:
            run = ws.inspect_run(footprint["run_id"])
            if (ws._get("scenarios", run["selection"]["scenario_id"])["kind"] == "landcover"
                    and footprint["summary"]["net_changed_cells"] > 0):
                grid = ws.get_grid(run["selection"]["grid_id"])
                restorations.append({"id": footprint["id"], "run_id": run["id"],
                    "title": footprint["title"], "selection": run["selection"],
                    "summary": footprint["summary"], "transitions": footprint["transitions"],
                    "scalars": {role: {"units": grid["files"][role].get("units"),
                                      "minimum": grid.get("inputs", {}).get(role, {}).get("minimum"),
                                      "maximum": grid.get("inputs", {}).get(role, {}).get("maximum")}
                                for role in ["PRECIPITATION", *SCALAR_UNITS]
                                if role in grid.get("files", {})}})
        except (ValueError, KeyError, OSError) as error:
            issues.append({"kind": "footprint", "id": footprint["id"], "error": str(error)})
    saved = []
    for path in sorted((ws.root / ROOT).glob("*/design.json")):
        try:
            value = inspect(ws, path.parent.name)
            saved.append({k: value[k] for k in ("id", "state", "selection", "summary")})
            if value.get("adoption"):
                saved[-1]["adoption"] = value["adoption"]
        except (ValueError, KeyError, OSError) as error:
            issues.append({"kind": "design", "id": path.parent.name, "error": str(error)})
    sources = []
    for collection in ws._list("sources"):
        for entry in collection["entries"]:
            if entry.get("kind") == "raster":
                sources.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                                "source_sha256": entry["body"]["sha256"], "title": entry["title"],
                                "units": entry.get("units"), "role": entry.get("role"),
                                "uri": entry.get("uri"), "vintage": entry.get("vintage")})
    return {"schema": "upstate.multivariate-control-catalog/v1",
            "project_id": ws.project["id"], "baselines": baselines,
            "restorations": restorations, "designs": saved, "issues": issues,
            "exclusions": sources, "covariate_sources": sources, "external_roles": list(EXTERNAL_ROLES),
            "strata_roles": deepcopy(SCALAR_UNITS), "interpretation": INTERPRETATION}


def _producer():
    from . import multivariate_control_design as design
    from . import multivariate_control_report as report
    from source_tools import precipitation_matching
    return {"design": file_digest(Path(design.__file__)),
            "report": file_digest(Path(report.__file__)),
            "exact_matcher": file_digest(Path(precipitation_matching.__file__))}


def preview(ws, selection):
    selected, bound = binding(ws, selection)
    identity = _identity(ws, selected, bound, _producer())
    key = digest(identity)
    result = {"id": key, "state": "ready", "selection": selected, "binding": bound,
              "summary": {"original_changed_cells": bound["restoration_summary"]["net_changed_cells"],
                          "original_changed_hectares": bound["restoration_summary"]["net_changed_hectares"]},
              "interpretation": INTERPRETATION}
    if (_folder(ws, key) / "design.json").exists():
        result.update(state="existing", existing=inspect(ws, key))
    return result


def _verify_binding(ws, bound):
    if bound["project_id"] != ws.project["id"]:
        raise ValueError("This design belongs to another original Workspace")
    grid = ws.get_grid(bound["grid_id"])
    if grid["grid"] != bound["grid"] or grid["spec"] != bound["grid_spec"]:
        raise ValueError("The original native grid definition changed")
    for name, descriptor in bound["original_records"].items():
        if name != "grid":
            verify_file(ws.root, descriptor)
    for descriptor in [*bound["files"].values(), *bound["restoration_files"].values()]:
        verify_file(ws.root, descriptor)
    if bound.get("native_landcover"):
        verify_file(ws.root, bound["native_landcover"])
    for role, run_id in (("baseline", bound["baseline_run_id"]),
                         ("restoration", bound["restoration_run_id"])):
        run = ws.inspect_run(run_id)
        if run["selection"] != bound["native_selections"][role]:
            raise ValueError("The original " + role + " native selection changed")
    source_bindings = list(bound.get("external_covariates", {}).values()) + list(bound.get("grid_sources", {}).values())
    if bound.get("exclusion_source"):
        source_bindings.append(bound["exclusion_source"])
    for source in source_bindings:
        actual = _source(ws, source["selection"])
        if actual != source:
            raise ValueError("The original selected raster source binding changed")


def _source_matches(ws, root, record):
    choice = record["source"]
    collection = ws._get("sources", choice["source_collection_id"])
    manifest = read_json(root / "sources.json")
    rows = {e["id"]: e for e in collection["entries"]}
    if set(rows) != {e["id"] for e in manifest["entries"]}:
        raise ValueError("The complete control source roster changed")
    for expected in manifest["entries"]:
        actual = rows[expected["id"]]
        if any(actual.get(k) != expected.get(k) for k in ("kind", "role", "uri", "metadata")):
            raise ValueError("Control source metadata changed")
        want = {e["path"]: (e["bytes"], e["sha256"])
                for e in [expected, *expected.get("companions", [])]}
        bodies = [actual["body"], *actual.get("companions", [])]
        found = {e.get("source_path", e["filename"]): (e["bytes"], e["sha256"]) for e in bodies}
        if len(found) != len(bodies) or found != want:
            raise ValueError("Control source body/companion inventory changed")
        for body in bodies:
            verify_file(ws.root, {**body, "path": body["object"]})


def inspect(ws, key):
    key = identifier(key)
    root = _folder(ws, key)
    value = read_json(root / "design.json")
    if value.get("schema") != DESIGN_SCHEMA or value.get("id") != key or digest(value["identity"]) != key:
        raise ValueError("Saved control design identity changed")
    if value["selection"] != value["identity"]["selection"] or value["binding"] != value["identity"]["binding"]:
        raise ValueError("Saved design selection/source identity changed")
    if value["state"] not in ("prepared", "infeasible", "threshold_not_met"):
        raise ValueError("Finish the original design assessment")
    for item in value["files"]:
        verify_file(ws.root, item)
    _verify_binding(ws, value["binding"])
    _source_matches(ws, root, value)
    assessment = read_json(root / "assessment.json")
    for name in ("id", "state", "selection", "binding", "summary", "strata", "balance", "masks"):
        if assessment[name] != value[name]:
            raise ValueError("Saved assessment differs from design record: " + name)
    receipt = root / "adoption.json"
    if receipt.exists():
        adoption = read_json(receipt)
        _verify_adoption(ws, value, adoption)
        value["adoption"] = adoption
    return value


def prepare(ws, selection, progress=None):
    from . import multivariate_control_design as design
    from . import multivariate_control_report as report
    selected, bound = binding(ws, selection)
    identity = _identity(ws, selected, bound, _producer())
    key = digest(identity)
    root = _folder(ws, key)
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".design.lock", blocking=False):
        if (root / "design.json").exists():
            return inspect(ws, key)
        atomic_json(root / "selection.json", selected, immutable=True)
        atomic_json(root / "input-binding.json", bound, immutable=True)
        atomic_json(root / "identity.json", identity, immutable=True)
        for name, descriptor in bound["original_records"].items():
            source = verify_file(ws.root, descriptor)
            atomic_bytes(root / "originals" / (name + ".json"), source.read_bytes(), immutable=True)
        retained = {"multivariate_control.py": Path(__file__),
                    "multivariate_control_design.py": Path(design.__file__),
                    "multivariate_control_report.py": Path(report.__file__)}
        from source_tools import precipitation_matching
        retained["precipitation_matching.py"] = Path(precipitation_matching.__file__)
        for name, path in retained.items():
            atomic_bytes(root / "implementation" / name, path.read_bytes(), immutable=True)

        def emit(event):
            atomic_json(root / "progress.json", {"design_id": key, **event})
            if progress:
                progress({"design_id": key, **event})

        result = design.compute(ws, selected, bound, root, progress=emit)
        assessment = {"schema": DESIGN_SCHEMA, "id": key, "identity": identity,
                      "selection": selected, "binding": bound, **result}
        atomic_json(root / "assessment.json", assessment, immutable=True)
        sections = report.write(root, assessment, INTERPRETATION)
        # The source edition is complete even for a scientifically rejected design.
        members = [describe_file(root, path) for path in sorted(root.rglob("*"))
                   if path.is_file() and "work" not in path.relative_to(root).parts
                   and path.name not in (".design.lock", "progress.json", "sources.json", "report-source.json", "design.json", "adoption.json", ".adopt.lock")]
        recipe = {"schema": "upstate.observed-report/v1", "edition": "multivariate-control-v1",
                  "title": selected["title"], "project_id": ws.project["id"],
                  "inputs": members, "sections": sections,
                  "source_links": list(report.LINKS) + ["report.html"]}
        atomic_json(root / "report-source.json", recipe, immutable=True)
        recipe_member = describe_file(root, root / "report-source.json")
        source_id = "multivariate-control-report-" + key
        metadata = {"report_schema": "upstate.observed-report/v1", "project_id": ws.project["id"],
                    "multivariate_control_id": key, "classification": "explicit designed native-model control",
                    "native_calculation": False}
        entries = [{"id": source_id, "kind": "document", "role": "OBSERVED_CONTEXT",
                    "title": selected["title"], "uri": "urn:upstate:multivariate-control:" + key,
                    "vintage": VERSION, **recipe_member, "companions": members, "metadata": metadata}]
        for mask in result["masks"]:
            file = mask["file"]
            entries.append({"id": "multivariate-control-mask-" + key + "-" + str(mask["from_code"]) + "-" + str(mask["to_code"]),
                "kind": "raster", "role": "MATCHED_CONTROL_MASK", "units": "mask", "resampling": "nearest",
                "title": selected["title"] + ": " + str(mask["from_code"]) + " to " + str(mask["to_code"]),
                "uri": "urn:upstate:multivariate-control-mask:" + key + ":" + str(mask["from_code"]) + ":" + str(mask["to_code"]),
                "vintage": VERSION, **file,
                "companions": [m for m in members if m["path"] != file["path"]] + [recipe_member],
                "metadata": {**metadata, "from_code": mask["from_code"], "to_code": mask["to_code"]}})
        atomic_json(root / "sources.json", {"schema": "upstate.sources/v1", "title": selected["title"], "entries": entries}, immutable=True)
        _verify_binding(ws, bound)
        collection = ws.import_sources(root / "sources.json")
        files = [describe_file(ws.root, root / m["path"]) for m in members]
        files += [describe_file(ws.root, root / name) for name in ("report-source.json", "sources.json")]
        value = {**assessment, "source": {"source_collection_id": collection["id"], "source_id": source_id},
                 "directory": root.relative_to(ws.root).as_posix(), "files": files}
        atomic_json(root / "design.json", value, immutable=True)
        emit({"stage": "complete", "state": value["state"]})
        return inspect(ws, key)


def _verify_adoption(ws, value, receipt):
    if (receipt.get("schema") != "upstate.multivariate-control-adoption/v1"
            or receipt.get("design_id") != value["id"]
            or receipt.get("project_id") != ws.project["id"]
            or receipt.get("design_sha256") != file_digest(_folder(ws, value["id"]) / "design.json")
            or receipt.get("source_collection_id") != value["source"]["source_collection_id"]):
        raise ValueError("Original control adoption receipt changed")
    run = ws.inspect_run(receipt["run_id"])
    bound = value["binding"]
    if (run["selection"]["grid_id"] != bound["grid_id"]
            or run["selection"]["profile_id"] != bound["profile_id"]
            or run["selection"]["scenario_id"] != receipt["scenario_id"]
            or selected_models(run["selection"]) != selected_models(bound["native_selections"]["baseline"])):
        raise ValueError("Adopted control left the original native cohort")
    footprint = scenario_footprint.get_footprint(ws, receipt["footprint_id"])
    if footprint["run_id"] != run["id"] or footprint["summary"] != receipt["footprint_summary"]:
        raise ValueError("Adopted control footprint changed")
    state = experiments.inspect(ws, receipt["experiment_id"])
    if state["selection"] != receipt["experiment_selection"]:
        raise ValueError("Original adopted experiment selection changed")
    return receipt


def adopt(ws, key):
    key = identifier(key)
    root = _folder(ws, key)
    with held(root / ".adopt.lock", blocking=False):
        value = inspect(ws, key)
        if value["state"] != "prepared":
            raise ValueError("Only an accepted complete control design can be adopted")
        if value.get("adoption"):
            return value
        bound = value["binding"]
        collection = value["source"]["source_collection_id"]
        patches = [{"mask_source_id": "multivariate-control-mask-" + key + "-" + str(m["from_code"]) + "-" + str(m["to_code"]),
                    "from_codes": [m["from_code"]], "to_code": m["to_code"],
                    "reason": value["selection"]["reason"]} for m in value["masks"]]
        scenario = ws.save_scenario({"title": value["selection"]["title"], "kind": "landcover",
                    "reason": value["selection"]["reason"], "source_collection_id": collection,
                    "patches": patches, "multivariate_control_id": key})
        selection = {"grid_id": bound["grid_id"], "profile_id": bound["profile_id"],
                     "scenario_id": scenario["id"], "models": selected_models(bound["native_selections"]["baseline"])}
        run = ws.prepare_run(selection)
        footprint = scenario_footprint.preview_run(ws, run["id"])
        expected = {(m["from_code"], m["to_code"]): m["cells"] for m in value["masks"]}
        actual = {(int(r["from_code"]), int(r["to_code"])): int(r["cells"])
                  for r in footprint["transitions"] if r["from_code"] != r["to_code"] and r["cells"]}
        if (actual != expected or footprint["summary"]["net_changed_cells"] != value["summary"]["original_changed_cells"]
                or not math.isclose(footprint["summary"]["net_changed_hectares"], value["summary"]["original_changed_hectares"],
                                    rel_tol=0, abs_tol=1e-6)):
            raise ValueError("Actual original scenario compiler differs from the complete designed transitions")
        proposed = {"schema": experiments.SELECTION_SCHEMA, "title": value["selection"]["title"],
                    "reason": value["selection"]["reason"], "baseline_run_id": bound["baseline_run_id"],
                    "scenario_ids": [bound["native_selections"]["restoration"]["scenario_id"], scenario["id"]],
                    "profile_ids": [], "design": "one_at_a_time", "axes": [],
                    "source_run_ids": [bound["baseline_run_id"], bound["restoration_run_id"], run["id"]]}
        experiment = experiments.prepare(ws, proposed)
        receipt = {"schema": "upstate.multivariate-control-adoption/v1", "design_id": key,
                   "design_sha256": file_digest(root / "design.json"), "project_id": ws.project["id"],
                   "source_collection_id": collection, "scenario_id": scenario["id"], "run_id": run["id"],
                   "footprint_id": footprint["id"], "footprint_summary": footprint["summary"],
                   "experiment_id": experiment["id"], "experiment_selection": experiment["selection"]}
        _verify_adoption(ws, value, receipt)
        atomic_json(root / "adoption.json", receipt, immutable=True)
        return {**value, "adoption": receipt}


def execute(ws, key):
    value = inspect(ws, identifier(key))
    if not value.get("adoption"):
        raise ValueError("Adopt this accepted design through the original experiment first")
    state = experiments.execute(ws, value["adoption"]["experiment_id"])
    return {**state, "kind": "experiment", "design_id": value["id"]}


def files(ws, key):
    value = inspect(ws, key)
    return deepcopy(value["files"])
