"""Bind the original Chattooga annual reference to retained retrospective inputs."""
from __future__ import annotations
import argparse
import copy
import json
from pathlib import Path

from model.common import atomic_json, describe_file, file_digest, read_json, verify_file
from . import compose, sparrow_reference

ROOT = Path(__file__).resolve().parents[1]
STUDY = ROOT/"source"/"chattooga-retrospective-2012"
SELECTION = STUDY/"chattooga-2012-reference-selection.json"
DOMAIN = ROOT/"source"/"usgs-southeast-sparrow-2012"/"nldi"/"basin-comid-6269342.json"
DOMAIN_SHA = "206b6a6654e538b188212914634a7fa1fcf11c3c55b13eca7ea124cad0b2bb62"


def reference(directory):
    """Use the retained complete release, original records and original geometry."""
    directory = Path(directory).resolve()
    sparrow_reference.receive(directory/"original")
    return sparrow_reference.prepare(directory/"prepared", original_root=directory/"original",
                                    selection_path=SELECTION)


def core_plan(base_plan, *, landcover_entry, precipitation_entry,
              output_manifest, output_plan):
    """Replace only historical inputs and the source-bound basin in a real core plan.

    All terrain/soil/erosivity/table and native parameter choices are inherited
    explicitly from the selected existing plan. Native entry bytes stay retained
    by the existing source composer; no run or quantity is fabricated here.
    """
    from model.regional_job import _plan
    from model.common import required_roles
    from model.reuse import copy_verified
    base_path = Path(base_plan).resolve(strict=True)
    selected, _, original_manifest, _, models = _plan(base_path)
    source_plan = copy.deepcopy(selected)
    output = Path(output_plan).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    lc_path, ppt_path = (Path(x).resolve(strict=True) for x in
                         (landcover_entry, precipitation_entry))
    lc, ppt = read_json(lc_path), read_json(ppt_path)
    for entry, path, role, units in ((lc, lc_path, "NLCD", "class"),
                                    (ppt, ppt_path, "PRECIPITATION", "mm/year")):
        if entry.get("kind") != "raster" or entry.get("role") != role or entry.get("units") != units:
            raise ValueError("Select the retained historical "+role+" raster source with "+units+" units")
        verify_file(path.parent, entry)
    lc_plan, ppt_plan = read_json(lc_path.parent/"plan.json"), read_json(ppt_path.parent/"plan.json")
    if (lc_plan.get("schema") != "upstate.legacy-nlcd2011-source/v1"
            or ppt_plan.get("schema") != "upstate.prism-period-source/v1"):
        raise ValueError("Select the retained legacy2011 and exact-period PRISM preparations")
    if (ppt_plan["start"], ppt_plan["end"], ppt_plan["years"]) != ("1999-10-01", "2014-10-01", 15):
        raise ValueError("The Chattooga reference selection uses the original WY2000–2014 horizon")
    if lc_plan["domain"] != ppt_plan["domain"]:
        raise ValueError("Historical land cover and climate must select the same original domain and buffer")
    domain = lc_plan["domain"]
    if (len(domain["files"]) != 1 or domain["files"][0]["sha256"] != DOMAIN_SHA
            or domain.get("where") is not None or domain.get("layer") is not None):
        raise ValueError("Retain the full original Chattooga contributing basin without another filter")
    source_domain = lc_path.parent/"domain"/domain["files"][0]["path"]
    verify_file(source_domain.parent, domain["files"][0])
    owned = output.parent/"chattooga-original-domain"
    owned.mkdir(exist_ok=True)
    descriptor = describe_file(source_domain.parent, source_domain)
    copy_verified(source_domain.parent, descriptor, owned)
    domain_entry = {"id": "chattooga-original-basin-"+DOMAIN_SHA[:24],
        "title": "Original retained NLDI full upstream basin for published COMID6269342",
        "kind": "vector", "role": "MODEL_DOMAIN",
        "uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6269342/basin?f=json&simplified=false&splitCatchment=false",
        "vintage": "Exact packaged NLDI geometry edition; SHA256 "+DOMAIN_SHA,
        **describe_file(owned, owned/descriptor["path"]), "companions": [],
        "use": "Full contributing reporting basin, separately buffered for native hydrologic context"}
    domain_entry_path = owned/"source-entry.json"
    atomic_json(domain_entry_path, domain_entry, immutable=True)
    combined = compose.compose(output_manifest, manifests=[original_manifest],
                               entries=[lc_path, ppt_path, domain_entry_path],
                               title="Chattooga legacy2011 / WY2000–2014 original retrospective sources",
                               scope={"reporting_area": "Original full Chattooga upstream basin",
                                      "model_context_buffer_m": domain["buffer_m"],
                                      "reference_selection_sha256": file_digest(SELECTION),
                                      "base_core_plan_sha256": file_digest(base_path)})
    manifest_path = Path(combined["manifest"]).resolve()
    if not manifest_path.is_relative_to(output.parent):
        raise ValueError("Place the core-plan output alongside or above its composed source manifest")
    selected["title"] = "Chattooga original annual reference — legacy2011 / WY2000–2014 native baseline"
    selected["sources"] = {"path": manifest_path.relative_to(output.parent).as_posix(),
                           "sha256": combined["sha256"]}
    grid = selected["grid"]
    grid["title"] = selected["title"]
    grid.pop("base_grid_id", None)
    grid["input_sources"]["NLCD"] = lc["id"]
    if "PRECIPITATION" in required_roles(models):
        grid["input_sources"]["PRECIPITATION"] = ppt["id"]
    grid["reporting_area"] = {"source_id": domain_entry["id"]}
    grid["model_domain"] = {"source_id": domain_entry["id"]}
    grid["upstream_buffer_m"] = domain["buffer_m"]
    grid["resolution_m"] = 30
    selected["baseline"]["title"] = "Original legacy NLCD2011 retrospective baseline"
    atomic_json(output, selected, immutable=True)
    # Re-read through the actual regional runner's contract before returning.
    _plan(output)
    result = {"schema": "upstate.chattooga-retrospective-plan/v1",
              "core_plan": describe_file(output.parent, output),
              "base_core_plan_sha256": file_digest(base_path),
              "original_models": models, "native_parameter_selection": source_plan["profile"],
              "reference_selection": describe_file(SELECTION.parent, SELECTION),
              "domain_sha256": DOMAIN_SHA, "landcover_source_id": lc["id"],
              "precipitation_source_id": ppt["id"], "source_manifest": combined}
    atomic_json(output.with_name(output.stem+".retrospective.json"), result, immutable=True)
    return result


def calibration_plan(workspace_path, *, prepared_reference, core_results, output):
    """Evaluate actual completed profile baselines on the one retained basin."""
    from model import calibration
    from model.workspace import Workspace
    from .usgs_annual import bind
    workspace = Workspace(workspace_path)
    binding = bind(workspace_path, prepared_reference)
    catalogue = calibration.catalog(workspace)
    wanted = []
    for path in core_results:
        value = read_json(path)
        if value.get("schema") != "upstate.regional-core-result/v1":
            raise ValueError("Select original completed regional core-result documents")
        if value.get("workspace_id") != workspace.project["id"]:
            raise ValueError("The completed core result belongs to another original Workspace")
        key = value["baseline_run_id"]
        run = workspace.inspect_run(key)
        if run.get("state") != "complete" or any(
                run["selection"][name] != value[name] for name in ("grid_id", "profile_id", "scenario_id")):
            raise ValueError("The retained core result differs from its original completed native run")
        grid = workspace.get_grid(value["grid_id"])
        collection = grid["spec"]["source_collection_id"]
        if collection != value["source_collection_id"]:
            raise ValueError("The completed core source collection differs from its retained grid")
        for domain_role in ("model_domain", "reporting_area"):
            choice = grid["spec"][domain_role]
            if choice.get("where") is not None or choice.get("layer") is not None:
                raise ValueError("The original full Chattooga basin cannot be narrowed by a layer or filter")
            domain_path, domain_entry = workspace.source_file(collection, choice["source_id"])
            if domain_entry.get("layer") is not None or file_digest(domain_path) != DOMAIN_SHA:
                raise ValueError("Choose the original full Chattooga basin for both reporting and native domain")
        _, lc = workspace.source_file(collection, grid["spec"]["input_sources"]["NLCD"])
        if lc.get("uri") != "https://edcftp.cr.usgs.gov/project/landcover/NLCD2011/nlcd_2011_landcover_2011_edition_2014_10_10.zip":
            raise ValueError("This reference plan selects the original legacy2011 baseline; evaluate Annual NLCD controls separately")
        if "PRECIPITATION" in grid["spec"]["input_sources"]:
            _, ppt = workspace.source_file(collection, grid["spec"]["input_sources"]["PRECIPITATION"])
            period = ppt.get("temporal_support", {})
            if (period.get("start"), period.get("end"), period.get("years")) != ("1999-10-01", "2014-10-01", 15):
                raise ValueError("Choose the actual retained WY2000–2014 precipitation source")
        if key not in wanted:
            wanted.append(key)
    if not wanted:
        raise ValueError("Select at least one actual completed retrospective baseline")
    groups = [g for g in catalogue["candidate_groups"]
              if set(wanted) <= {r["id"] for r in g["runs"]}]
    if len(groups) != 1:
        raise ValueError("Choose profile baselines on one original grid/scenario; evaluate land-cover products separately")
    chosen = [r for r in groups[0]["runs"] if r["id"] in wanted]
    common = set.intersection(*(set(r["available_parameters"]) for r in chosen))
    objective = {name: {"weight": 1} for name in ("nitrogen", "phosphorus", "sediment") if name in common}
    if not objective:
        raise ValueError("The actual selected native runs share no completed pollutant")
    selection = {"schema": calibration.SELECTION_SCHEMA,
                 "title": "Chattooga original annual reference evaluation",
                 "candidate_run_ids": wanted, "reference_run_id": wanted[0],
                 "observation_id": binding["observation_id"], "catchments": binding["catchments"],
                 "objective": objective, "temporal_weighting": "whole_years",
                 "validation_group_ids": [],
                 "notes": ["One complete original upstream catchment; no independent spatial holdout.",
                           "Empirical annual rates retain the source-global WY2000–2014 target horizon.",
                           "Station-specific estimator uncertainty is unavailable in this published mapper edition.",
                           "Native diffuse export, observed total load, TSS definition and in-stream transport differ."]}
    prepared = calibration.prepare(workspace, selection)
    atomic_json(Path(output), prepared, immutable=True)
    return prepared


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    ref = commands.add_parser("reference")
    ref.add_argument("--output", required=True)
    core = commands.add_parser("core-plan")
    core.add_argument("--base-plan", required=True)
    core.add_argument("--landcover-entry", required=True)
    core.add_argument("--precipitation-entry", required=True)
    core.add_argument("--manifest", required=True)
    core.add_argument("--output", required=True)
    cal = commands.add_parser("calibration-plan")
    cal.add_argument("--workspace", required=True)
    cal.add_argument("--prepared-reference", required=True)
    cal.add_argument("--core-result", action="append", required=True)
    cal.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if args.command == "reference":
        result = reference(args.output)
    elif args.command == "core-plan":
        result = core_plan(args.base_plan, landcover_entry=args.landcover_entry,
                           precipitation_entry=args.precipitation_entry,
                           output_manifest=args.manifest, output_plan=args.output)
    else:
        result = calibration_plan(args.workspace, prepared_reference=args.prepared_reference,
                                  core_results=args.core_result, output=args.output)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
