"""Materialize published Upstate coefficients through the maintained profile engine."""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import sys

DATA_DIRECTORY = Path(__file__).resolve().parents[1] / "source" / "regional-studies-20261013"
TABLE_COLUMNS = ("load_n", "eff_n", "load_p", "eff_p",
                 "crit_len_p", "crit_len_n", "usle_c", "usle_p")
NDR_REFERENCE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html"
SDR_REFERENCE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"
LEGACY_NDR = "https://github.com/natcap/invest/blob/3.9.0/src/natcap/invest/ndr/ndr.py"
CURRENT_NDR = "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py"


def read_definitions(directory=None):
    """Read the transcribed source table and its separately attributed study rules."""
    directory = Path(directory or DATA_DIRECTORY).resolve(strict=True)
    definition_path = directory / "study-definitions.json"
    definition_bytes = definition_path.read_bytes()
    definitions = json.loads(definition_bytes)
    if definitions.get("schema") != "upstate.published-study-programme/v1":
        raise ValueError("Select the retained Upstate study definitions")
    table_path = directory / definitions["albright_2023"]["table"]["path"]
    table_bytes = table_path.read_bytes()
    identity = hashlib.sha256(table_bytes).hexdigest()
    if identity != definitions["albright_2023"]["table"]["sha256"]:
        raise ValueError("The retained published coefficient table changed")
    rows = list(csv.DictReader(io.StringIO(table_bytes.decode("utf-8-sig"))))
    codes = [int(row["lucode"]) for row in rows]
    if codes != definitions["albright_2023"]["table"]["lucodes"] or len(set(codes)) != len(codes):
        raise ValueError("Retain the fifteen published land-cover rows in their original order")
    for row in rows:
        for column in TABLE_COLUMNS:
            value = float(row[column])
            if not math.isfinite(value) or value < 0:
                raise ValueError("Published coefficients must be finite and nonnegative")
            if column in ("crit_len_n", "crit_len_p") and value <= 0:
                raise ValueError("Use the published positive retention lengths")
            if column in ("eff_n", "eff_p", "usle_c", "usle_p") and value > 1:
                raise ValueError("A coefficient lies outside its native ratio range")
    return definitions, rows, {
        "definition_sha256": hashlib.sha256(definition_bytes).hexdigest(),
        "table_sha256": identity, "table_bytes": len(table_bytes),
        "definition_path": str(definition_path), "table_path": str(table_path),
    }


def specifications(baseline_profile_id, *, directory=None):
    """Build two complete source choices; each factor has one joined source level."""
    definitions, rows, _ = read_definitions(directory)
    citation = definitions["albright_2023"]["reference"]["url"]
    factors = []
    for column in TABLE_COLUMNS:
        groups = {}
        for row in rows:
            groups.setdefault(float(row[column]), []).append(int(row["lucode"]))
        for value, codes in sorted(groups.items()):
            native_reference = SDR_REFERENCE if column.startswith("usle_") else NDR_REFERENCE
            factors.append({
                "name": column + " / " + ",".join(map(str, codes)),
                "target": "table." + column, "lucodes": codes,
                "levels": [{
                    "label": format(value, ".12g"), "value": value,
                    "references": [citation, native_reference],
                    "reason": "Albright et al. 2023 Appendix 1, biophysical table; apply the published values together to the retained regional source table.",
                }],
            })
    for nutrient in ("n", "p"):
        factors.append({
            "name": nutrient.upper() + " load interpretation",
            "target": "table.load_type_" + nutrient,
            "lucodes": [int(row["lucode"]) for row in rows],
            "levels": [{
                "label": "Legacy direct load", "value": "measured-runoff",
                "references": [citation, LEGACY_NDR, CURRENT_NDR, NDR_REFERENCE],
                "reason": "The paper used InVEST 3.9.0, whose load mapping applies the published rate directly. InVEST 3.20 measured-runoff preserves that interpretation without adding the application-rate (1-efficiency) multiplier.",
            }],
        })
    base = {
        "title": "Albright 2023 Upstate biophysical coefficients",
        "reason": "Compare the original retained regional profile with the complete published Upstate table. Preserve the baseline's explicit native parameters and nitrogen subsurface proportion.",
        "baseline_profile_id": baseline_profile_id,
        "design": "factorial", "factors": factors,
    }
    combined = copy.deepcopy(base)
    combined.update(
        title="Upstate coefficients and Vickery–Quinn 2023 native parameters",
        reason="Apply the Albright 2023 Upstate table together with the eight reported native settings from Vickery and Quinn 2023 Appendix 1; retain all other explicit baseline choices.",
    )
    combined["factors"].extend(copy.deepcopy(
        definitions["vickery_quinn_2023"]["native_profile"]["factors"]))
    return {"albright_2023": base, "albright_vickery_2023": combined}


def prepare_profiles(workspace, baseline_profile_id, *, directory=None, additional_specs=None):
    """Use the existing Workspace importer, lineage and native profile identities."""
    from model import experiment_profiles
    from model.common import atomic_json, digest, held, now, read_json

    definitions, _, sources = read_definitions(directory)
    baseline = workspace._get("profiles", baseline_profile_id)
    specs = specifications(baseline["id"], directory=directory)
    for key, original in (additional_specs or {}).items():
        if key in specs:
            raise ValueError("Give each additional published profile a distinct name")
        extra = copy.deepcopy(original)
        extra["baseline_profile_id"] = baseline["id"]
        specs[key] = extra
    selection = {
        "schema": "upstate.published-study-profiles/v1",
        "workspace_id": workspace.project["id"],
        "baseline_profile_id": baseline["id"],
        "definition_sha256": sources["definition_sha256"],
        "table_sha256": sources["table_sha256"], "specifications": specs,
    }
    operation_id = digest(selection)
    operation = workspace.root / "study-programmes" / operation_id
    operation.mkdir(parents=True, exist_ok=True)
    with held(operation / ".profiles.lock", blocking=False):
        atomic_json(operation / "selection.json", selection, immutable=True)
        state_path = operation / "profiles.json"
        result = read_json(state_path) if state_path.exists() else {
            "schema": selection["schema"], "id": operation_id,
            "workspace_id": workspace.project["id"],
            "baseline_profile_id": baseline["id"],
            "created_at": now(), "profiles": {},
        }
        if result["id"] != operation_id or result["workspace_id"] != workspace.project["id"]:
            raise ValueError("Resume the selected study programme in its original workspace")
        result.update(state="preparing", updated_at=now(), sources=sources)
        result.pop("error", None)
        atomic_json(state_path, result)
        try:
            all_ids = [baseline["id"]]
            for key, spec in specs.items():
                result.update(active_profile=key, updated_at=now())
                atomic_json(state_path, result)
                prepared = experiment_profiles.materialize(workspace, spec)
                if prepared["state"] != "complete":
                    raise RuntimeError("Published profile materialization did not complete")
                ids = list(prepared["profile_ids"])
                if len(ids) > 1:
                    raise ValueError("Each published source choice must create one joined profile")
                chosen = ids[0] if ids else baseline["id"]
                result["profiles"][key] = {
                    "title": spec["title"], "profile_id": chosen,
                    "profile_set_id": prepared["id"],
                    "references": list(dict.fromkeys(
                        reference for factor in spec["factors"] for level in factor["levels"]
                        for reference in level["references"])),
                }
                if key == "albright_vickery_2023":
                    result["profiles"][key]["references"].append(
                        definitions["vickery_quinn_2023"]["reference"]["url"])
                all_ids.append(chosen)
            result.update(
                state="complete", active_profile=None,
                profile_ids=list(dict.fromkeys(all_ids)),
                completed_at=result.get("completed_at") or now(), updated_at=now(),
            )
            atomic_json(state_path, result)
            return result
        except BaseException as exc:
            result.update(state="failed", updated_at=now(),
                          error={"type": type(exc).__name__, "message": str(exc)})
            atomic_json(state_path, result)
            raise


def compose_selection(workspace, selection, prepared):
    """Attach the whole published profiles to the existing experiment selection."""
    from model import experiments
    result = copy.deepcopy(selection)
    normalized, baseline, _, _ = experiments._normalise(workspace, result)
    if normalized["axes"]:
        raise ValueError("Keep native and table choices in the joined profiles; select axes=[]")
    if baseline["selection"]["profile_id"] != prepared["baseline_profile_id"]:
        raise ValueError("The experiment and study profiles must share their original baseline")
    result["profile_ids"] = list(dict.fromkeys(
        normalized["profile_ids"] + prepared["profile_ids"]))
    result["axes"] = []
    normalized, _, _, _ = experiments._normalise(workspace, result)
    return normalized


def run_programme(workspace, selection, profiles):
    """Execute the existing experiment and retain its link before native work starts."""
    from model import experiments, study_report
    from model.common import atomic_json, now
    composed = compose_selection(workspace, selection, profiles)
    plan = experiments.prepare(workspace, composed)
    directory = workspace.root / "study-programmes" / profiles["id"] / "experiments"
    directory.mkdir(parents=True, exist_ok=True)
    result_path = directory / (plan["id"] + ".json")
    result = {
        "experiment_id": plan["id"], "selection": composed,
        "state": "prepared", "updated_at": now(),
    }
    atomic_json(result_path, result)
    try:
        result["execution"] = experiments.execute(workspace, plan["id"])
        result["summary"] = experiments.read_summary(workspace, plan["id"])
        result["state"] = result["summary"]["state"]
        atomic_json(result_path, {**result, "updated_at": now()})
        result["report"] = study_report.build(workspace, plan["id"], profiles=profiles)
        result["updated_at"] = now()
        atomic_json(result_path, result)
        return result
    except BaseException as exc:
        result.update(state="failed", updated_at=now(),
                      error={"type": type(exc).__name__, "message": str(exc)})
        # The maintained engine writes partial summaries when an individual
        # native case fails. Preserve those completed results for the operator.
        try:
            result["summary"] = experiments.read_summary(workspace, plan["id"])
            result["report"] = study_report.build(workspace, plan["id"], profiles=profiles)
        except Exception as report_error:
            result["report_error"] = {
                "type": type(report_error).__name__, "message": str(report_error)}
        try:
            atomic_json(result_path, result)
        except OSError:
            pass
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path)
    parser.add_argument("--data-directory", type=Path)
    parser.add_argument("--workspace", type=Path, required=True)
    baseline = parser.add_mutually_exclusive_group()
    baseline.add_argument("--baseline-profile")
    baseline.add_argument("--baseline-run")
    baseline.add_argument("--core-result", type=Path,
                          help="Use the baseline from the completed regional_job result")
    parser.add_argument("--selection", type=Path)
    parser.add_argument("--scenario", action="append", default=[])
    parser.add_argument("--study-scenarios", action="store_true",
                        help="Prepare the seven published spatial alternatives on the actual 30 m grid")
    parser.add_argument("--scenario-programme", type=Path,
                        help="Use a previously completed retained spatial programme result")
    parser.add_argument("--fixed-runoff-reference", action="store_true",
                        help="Add profile variants using the actual native baseline masked-runoff mean")
    parser.add_argument("--profile-spec", action="append", default=[], metavar="NAME=PATH")
    parser.add_argument("--output", type=Path)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--preview", action="store_true")
    actions.add_argument("--run", action="store_true")
    args = parser.parse_args(argv)
    if args.application:
        sys.path.insert(0, str(args.application.resolve(strict=True)))
    from model.workspace import Workspace
    from model import experiment_profiles
    from model.common import atomic_json, read_json
    try:
        workspace = Workspace(args.workspace)
        selection = read_json(args.selection) if args.selection else None
        core = read_json(args.core_result) if args.core_result else None
        if core and (core.get("schema") != "upstate.regional-core-result/v1"
                     or core.get("workspace_id") != workspace.project["id"]):
            raise ValueError("Select the completed regional core result for this workspace")
        requested_run = core["baseline_run_id"] if core else args.baseline_run
        selected_run = selection["baseline_run_id"] if selection else requested_run
        if selection and requested_run and selected_run != requested_run:
            raise ValueError("Select the same original baseline in the command and experiment")
        if selected_run:
            profile_id = workspace.inspect_run(selected_run)["selection"]["profile_id"]
            if args.baseline_profile and args.baseline_profile != profile_id:
                raise ValueError("Select the original baseline's profile")
        elif args.baseline_profile:
            profile_id = args.baseline_profile
        else:
            raise ValueError("Supply an actual baseline run, baseline profile or experiment selection")
        additional = {}
        for token in args.profile_spec:
            name, separator, path = token.partition("=")
            if not separator or not name or not path or name in additional:
                raise ValueError("Additional profile specifications use unique NAME=PATH arguments")
            additional[name] = read_json(Path(path))
        if args.preview:
            if args.study_scenarios or args.fixed_runoff_reference:
                raise ValueError("Preview profile specifications separately from native scenario or runoff preparation")
            specs = specifications(profile_id, directory=args.data_directory)
            for name, value in additional.items():
                if name in specs:
                    raise ValueError("Give each additional published profile a distinct name")
                specs[name] = {**value, "baseline_profile_id": profile_id}
            result = {key: experiment_profiles.preview(workspace, spec)
                      for key, spec in specs.items()}
        else:
            result = prepare_profiles(
                workspace, profile_id, directory=args.data_directory,
                additional_specs=additional)
            spatial = None
            if args.study_scenarios or args.scenario_programme:
                if not selected_run:
                    raise ValueError("Select the original baseline run for spatial preparation")
                if args.study_scenarios:
                    from source_tools.upstate_study_scenarios import prepare as prepare_spatial
                    spatial = prepare_spatial(
                        workspace, selected_run, data_directory=args.data_directory)
                else:
                    spatial = read_json(args.scenario_programme)
                if (spatial.get("state") != "complete"
                        or spatial.get("workspace_id") != workspace.project["id"]
                        or spatial.get("baseline_run_id") != selected_run):
                    raise ValueError("Select the completed spatial programme for this workspace and baseline")
                for scenario_id in spatial["scenario_ids"]:
                    workspace._get("scenarios", scenario_id)
                result["spatial_programme"] = spatial
            if args.fixed_runoff_reference:
                if not selected_run:
                    raise ValueError("Select the original baseline run for its native masked-runoff average")
                from model import runoff_reference
                if args.run and "ndr" not in workspace.inspect_run(selected_run).get("stages", {}):
                    workspace.run(selected_run)
                reference = runoff_reference.from_run(workspace, selected_run)
                fixed = []
                names = {value["profile_id"]: value["title"]
                         for value in result["profiles"].values()}
                for source_profile_id in result["profile_ids"]:
                    chosen = workspace._get("profiles", source_profile_id)
                    derived = runoff_reference.save_profile(
                        workspace, source_profile_id, reference,
                        title=names.get(source_profile_id, chosen["title"]) + " / baseline runoff mean",
                        reason="Use the actual native baseline masked-runoff mean as a common reference for the selected comparison.",
                    )
                    fixed.append(derived["id"])
                result["profile_ids"] = list(dict.fromkeys(result["profile_ids"] + fixed))
                result["runoff_reference"] = reference
                result["fixed_reference_profile_ids"] = fixed
            if args.run or selection or args.scenario or spatial:
                if not selected_run:
                    raise ValueError("Select the actual baseline run for experiment execution")
                if selection is None:
                    selection = {
                        "schema": "upstate.experiment-selection/v1",
                        "title": "Upper Savannah published regional source comparison",
                        "reason": "Compare complete regional source profiles and retained spatial alternatives on the same original model grid.",
                        "baseline_run_id": selected_run, "scenario_ids": [],
                        "profile_ids": [], "design": "factorial", "axes": [],
                    }
                selection["scenario_ids"] = list(dict.fromkeys(
                    selection.get("scenario_ids", []) + args.scenario
                    + (spatial["scenario_ids"] if spatial else [])))
                if args.run:
                    result = {**result, "experiment": run_programme(
                        workspace, selection, result)}
                else:
                    result = {**result, "selection": compose_selection(
                        workspace, selection, result)}
        if args.output:
            # Profile/experiment progress timestamps change on resume.
            # Their immutable scientific selections live in the workspace.
            atomic_json(args.output, result)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, KeyError, OSError, RuntimeError) as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__,
                          "message": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
