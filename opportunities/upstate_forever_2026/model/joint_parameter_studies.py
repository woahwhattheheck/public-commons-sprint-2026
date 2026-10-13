"""Sourced Latin-hypercube designs using the existing native experiment engine.

The frozen design is the scientific input. Native runs, paired support and
resume semantics remain in model.experiments and the original Workspace.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import math
from pathlib import Path

from .common import atomic_json, canonical, digest, held, identifier, now, read_json
from . import experiments
from .profiles import checked_parameters
from .model_selection import selected, validate_completed_run

SCHEMA = "upstate.joint-parameter-study/v1"
SPEC_SCHEMA = "upstate.joint-parameter-design/v1"
DEFINITION_SCHEMA = "upstate.joint-parameter-definition/v1"
METHOD = "scipy-latin-hypercube-independent-marginals/1"
DIRECTORY = "joint-parameter-studies"
METHOD_REFERENCE = "https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.qmc.LatinHypercube.html"


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + " must be nonempty text")
    return value.strip()


def _integer(value, label, minimum=0):
    if type(value) is not int or value < minimum:
        raise ValueError(label + " must be an integer at least " + str(minimum))
    return value


def _number(value, label):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(label + " must be a finite number")
    return float(value)


def _binding(workspace, selection):
    clean, run, profile, scenario = experiments._normalise(workspace, selection)
    validate_completed_run(run)
    if run.get("state") != "complete":
        raise ValueError("Select a completed original baseline before preparing a joint study")
    grid = workspace.get_grid(run["selection"]["grid_id"])
    return clean, run, profile, {
        "workspace_id": workspace.project["id"],
        "baseline_run_id": run["id"],
        "baseline_run_selection": deepcopy(run["selection"]),
        "baseline_profile_id": profile["id"],
        "baseline_profile_sha256": digest(profile),
        "biophysical_sha256": profile["table_summary"]["sha256"],
        "baseline_scenario_id": scenario["id"],
        "grid_id": grid["id"],
        "models": list(selected(run["selection"])),
    }


def _normalise(workspace, value):
    if not isinstance(value, dict):
        raise ValueError("Supply a complete joint parameter design")
    allowed = {"schema", "title", "reason", "baseline_run_id", "scenario_ids",
               "source_run_ids", "axes", "replicates"}
    if set(value) - allowed or value.get("schema", SPEC_SCHEMA) != SPEC_SCHEMA:
        raise ValueError("Select an upstate.joint-parameter-design/v1 document")
    selection = {
        "schema": experiments.SELECTION_SCHEMA,
        "title": _text(value.get("title"), "Study title"),
        "reason": _text(value.get("reason"), "Scientific question"),
        "baseline_run_id": identifier(value.get("baseline_run_id")),
        "scenario_ids": value.get("scenario_ids", []),
        "profile_ids": [], "axes": [], "design": "factorial",
    }
    if value.get("source_run_ids"):
        selection["source_run_ids"] = value["source_run_ids"]
    selection, baseline, base, binding = _binding(workspace, selection)
    available = experiments.supported_axes(binding["models"])
    raw_axes = value.get("axes")
    if not isinstance(raw_axes, list) or not raw_axes:
        raise ValueError("Select at least one sourced numeric parameter axis")
    axes, names, paths_seen = [], set(), set()
    for raw in raw_axes:
        if not isinstance(raw, dict) or set(raw) != {
                "id", "label", "paths", "distribution", "lower", "upper",
                "units", "reason", "references"}:
            raise ValueError("Each axis needs its ID, label, paths, distribution, bounds, units, reason and references")
        axis_id = _text(raw["id"], "Axis ID")
        if axis_id in names:
            raise ValueError("Give every ordered axis a distinct ID")
        names.add(axis_id)
        paths = raw["paths"]
        if (not isinstance(paths, list) or not paths
                or any(not isinstance(p, str) for p in paths)
                or len(paths) != len(set(paths))):
            raise ValueError("List each coupled native parameter once")
        for path in paths:
            if path not in available or path.endswith(".flow_dir_algorithm"):
                raise ValueError("Choose a supported numeric native parameter: " + path)
            if path in paths_seen:
                raise ValueError("A native parameter can belong to only one axis")
        units = _text(raw["units"], "Axis units")
        if any(available[path]["units"] != units for path in paths):
            raise ValueError("Coupled parameter units must match the native catalog exactly")
        distribution = raw["distribution"]
        if distribution not in {"uniform", "log-uniform"}:
            raise ValueError("Select an explicitly sourced uniform or log-uniform exploratory marginal")
        lower, upper = _number(raw["lower"], "Lower bound"), _number(raw["upper"], "Upper bound")
        if lower >= upper or (distribution == "log-uniform" and lower <= 0):
            raise ValueError("Use increasing finite bounds, positive for log-uniform")
        if not math.isfinite(upper - lower):
            raise ValueError("The native parameter interval must have finite width")
        # Endpoint validation also checks every coupled native constraint.
        for bound in (lower, upper):
            experiments._apply(base, {path: bound for path in paths})
        references = raw["references"]
        if (not isinstance(references, list) or not references
                or any(not isinstance(ref, str) or not ref.strip() for ref in references)):
            raise ValueError("Retain original source references for every chosen range")
        axes.append({"id": axis_id, "label": _text(raw["label"], "Axis label"),
                     "paths": paths[:], "distribution": distribution,
                     "lower": lower, "upper": upper, "units": units,
                     "reason": _text(raw["reason"], "Range rationale"),
                     "references": list(dict.fromkeys(ref.strip() for ref in references))})
        paths_seen.update(paths)
    raw_replicates = value.get("replicates")
    if not isinstance(raw_replicates, list) or not raw_replicates:
        raise ValueError("Select explicit sample counts and seeds for one or more independent designs")
    replicates, ids, seeds = [], set(), set()
    for raw in raw_replicates:
        if not isinstance(raw, dict) or set(raw) != {"id", "samples", "seed"}:
            raise ValueError("Each replicate needs an ID, sample count and seed")
        key = _text(raw["id"], "Replicate ID")
        n = _integer(raw["samples"], "Sample count", 1)
        seed = _integer(raw["seed"], "Random seed")
        if key in ids or seed in seeds:
            raise ValueError("Replicate IDs and independent design seeds must be distinct")
        ids.add(key); seeds.add(seed)
        replicates.append({"id": key, "samples": n, "seed": seed})
    spec = {"schema": SPEC_SCHEMA, "title": selection["title"],
            "reason": selection["reason"], "baseline_run_id": baseline["id"],
            "scenario_ids": selection["scenario_ids"], "axes": axes,
            "replicates": replicates}
    if selection.get("source_run_ids"):
        spec["source_run_ids"] = selection["source_run_ids"]
    canonical(spec)
    return spec, selection, base, binding


def _physical(axis, coordinate):
    if axis["distribution"] == "uniform":
        value = axis["lower"] + coordinate * (axis["upper"] - axis["lower"])
    else:
        value = math.exp(math.log(axis["lower"]) +
                         coordinate * (math.log(axis["upper"]) - math.log(axis["lower"])))
    # Floating-point transforms may land exactly on a bound, never outside it.
    return min(axis["upper"], max(axis["lower"], value))


def preview(workspace, specification):
    """Generate a complete immutable candidate without saving any profile/run."""
    import numpy
    import scipy
    from scipy.stats import qmc

    spec, selection, base, binding = _normalise(workspace, specification)
    samples = []
    for replicate in spec["replicates"]:
        # The legacy seed keyword remains supported across the installed SciPy
        # QMC versions. The actual versions and complete coordinates are retained.
        sampler = qmc.LatinHypercube(d=len(spec["axes"]), scramble=True,
                                    strength=1, optimization=None, seed=replicate["seed"])
        coordinates = sampler.random(n=replicate["samples"])
        for ordinal, raw in enumerate(coordinates.tolist()):
            values = {axis["id"]: _physical(axis, coordinate)
                      for axis, coordinate in zip(spec["axes"], raw)}
            overrides = {path: values[axis["id"]]
                         for axis in spec["axes"] for path in axis["paths"]}
            normalized = experiments._apply(base, overrides)
            overrides = {path: normalized[path.split(".")[0]][path.split(".")[1]]
                         for path in overrides}
            samples.append({
                "id": digest({"replicate_id": replicate["id"], "ordinal": ordinal}),
                "replicate_id": replicate["id"], "ordinal": ordinal,
                "coordinates": raw, "values": values, "overrides": overrides,
            })
    definition = {
        "schema": DEFINITION_SCHEMA, "method": METHOD,
        "specification": spec, "baseline": binding,
        "experiment_selection": selection,
        "sampler": {"implementation": "scipy.stats.qmc.LatinHypercube",
                    "scipy_version": scipy.__version__, "numpy_version": numpy.__version__,
                    "scramble": True, "strength": 1, "optimization": None,
                    "seed_keyword": "seed", "reference": METHOD_REFERENCE},
        "samples": samples,
        "interpretation": {
            "marginals": "Independent exploratory parameter ranges; not inferred environmental probability distributions.",
            "coupling": "Paths within an axis receive the same physical value.",
            "routing": "The original baseline routing remains fixed; use a separate explicit routing stratum.",
            "replicates": "Each explicit seed produces a separate Latin hypercube; additional replicates are separate scientific selections.",
            "support": "Analyze actual native results within identical per-scenario spatial support and units.",
        },
    }
    _validate_definition(workspace, definition)
    return {"schema": SCHEMA, "id": digest(definition), "definition": definition,
            "sample_count": len(samples),
            "requested_native_cases": (len(samples) + 1) * (len(spec["scenario_ids"]) + 1),
            "note": "The exact unique-profile count is retained after profile preparation; completed native stages can be reused by the original engine."}


def _validate_definition(workspace, definition):
    if (not isinstance(definition, dict)
            or definition.get("schema") != DEFINITION_SCHEMA
            or definition.get("method") != METHOD):
        raise ValueError("Receive the complete original joint-study definition")
    spec, selection, base, binding = _normalise(workspace, definition.get("specification"))
    if (definition["specification"] != spec or definition.get("baseline") != binding
            or definition.get("experiment_selection") != selection):
        raise ValueError("The frozen design differs from its original native baseline or sources")
    samples = definition.get("samples")
    if not isinstance(samples, list) or len(samples) != sum(r["samples"] for r in spec["replicates"]):
        raise ValueError("Retain every original sample, including repeated physical profiles")
    offset = 0
    for replicate in spec["replicates"]:
        count = replicate["samples"]
        strata = [set() for _ in spec["axes"]]
        for ordinal, sample in enumerate(samples[offset:offset + count]):
            if (not isinstance(sample, dict) or set(sample) != {
                    "id", "replicate_id", "ordinal", "coordinates", "values", "overrides"}
                    or sample["replicate_id"] != replicate["id"]
                    or sample["ordinal"] != ordinal
                    or sample["id"] != digest({"replicate_id": replicate["id"], "ordinal": ordinal})):
                raise ValueError("The frozen sample order or identity changed")
            coordinates = sample["coordinates"]
            if not isinstance(coordinates, list) or len(coordinates) != len(spec["axes"]):
                raise ValueError("Keep every ordered unit-cube coordinate")
            values = {}
            for column, (axis, raw) in enumerate(zip(spec["axes"], coordinates)):
                coordinate = _number(raw, "Unit-cube coordinate")
                if not 0 <= coordinate < 1:
                    raise ValueError("A unit-cube coordinate is outside [0,1)")
                strata[column].add(min(count - 1, math.floor(coordinate * count)))
                values[axis["id"]] = _physical(axis, coordinate)
            overrides = {path: values[axis["id"]]
                         for axis in spec["axes"] for path in axis["paths"]}
            normalized = experiments._apply(base, overrides)
            overrides = {path: normalized[path.split(".")[0]][path.split(".")[1]]
                         for path in overrides}
            if values != sample["values"] or overrides != sample["overrides"]:
                raise ValueError("A physical parameter differs from its frozen coordinate and transformation")
        if any(len(column) != count for column in strata):
            raise ValueError("Each Latin-hypercube marginal must contain exactly one sample in each stratum")
        offset += count
    canonical(definition)
    return spec, base


def _directory(workspace, study_id):
    return workspace.root / DIRECTORY / identifier(study_id)


def _definition(workspace, study_id):
    study_id = identifier(study_id)
    value = read_json(_directory(workspace, study_id) / "definition.json")
    if digest(value) != study_id:
        raise ValueError("The retained complete joint design changed")
    _validate_definition(workspace, value)
    return value


def _profile(base, definition, study_id, sample):
    result = deepcopy(base)
    for field in ("id", "schema", "table_summary", "approved", "approved_at",
                  "approved_by", "approval", "approvals", "scientific_approval",
                  "scientific_signoff", "review_status", "calibration_results",
                  "calibration_status"):
        result.pop(field, None)
    physical_id = digest(sample["overrides"])
    references = base["references"] if isinstance(base["references"], list) else [base["references"]]
    references = deepcopy(references)
    for axis in definition["specification"]["axes"]:
        for ref in axis["references"]:
            if ref not in references:
                references.append(ref)
    result.update(title=definition["specification"]["title"] + " / joint " + physical_id[:12],
                  status="working", scientific_status="working", references=references,
                  joint_parameter_derivation={
                      "study_id": study_id, "baseline_profile_id": base["id"],
                      "physical_id": physical_id, "overrides": deepcopy(sample["overrides"]),
                  })
    for path, value in sample["overrides"].items():
        model, name = path.split(".")
        result[model][name] = value
    result.update(checked_parameters(result))
    return result


def prepare(workspace, definition):
    """Retain the whole design before invoking the existing profile/run APIs."""
    spec, base = _validate_definition(workspace, definition)
    study_id = digest(definition)
    directory = _directory(workspace, study_id)
    path = directory / "definition.json"
    if path.exists():
        if read_json(path) != definition:
            raise ValueError("Preserve the already-retained original design")
    else:
        # A first saved selection must be exactly the current native preview,
        # including its actual sampler versions, seed and complete coordinates.
        if preview(workspace, spec)["definition"] != definition:
            raise ValueError("The generated design or sampler changed; preview this source edition before saving")
    # Publish the directory under the same gate used by portable inventory.
    with held(workspace.root / ".workspace.lock", blocking=False):
        directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".joint-study.lock", blocking=False):
        atomic_json(path, definition, immutable=True)
        state_path = directory / "state.json"
        state = read_json(state_path) if state_path.is_file() else {
            "schema": SCHEMA, "id": study_id, "workspace_id": workspace.project["id"],
            "state": "preparing", "created_at": now(), "samples": [],
        }
        if (state.get("schema") != SCHEMA or state.get("id") != study_id
                or state.get("workspace_id") != workspace.project["id"]):
            raise ValueError("The retained preparation belongs to another study")
        if state.get("experiment_id"):
            # A fully prepared design is immutable on replay. Inspection checks
            # every profile, sample and original experiment before reuse.
            return inspect(workspace, study_id)
        state.update(state="preparing", updated_at=now())
        state.pop("error", None)
        atomic_json(state_path, state)
        try:
            prior = {row["sample_id"]: row for row in state["samples"]}
            saved_profiles, rows = {}, []
            for sample in definition["samples"]:
                signature = digest(sample["overrides"])
                profile = saved_profiles.get(signature)
                if profile is None:
                    payload = _profile(base, definition, study_id, sample)
                    profile = workspace.save_profile(payload)
                    saved_profiles[signature] = profile
                item = {"sample_id": sample["id"], "replicate_id": sample["replicate_id"],
                        "ordinal": sample["ordinal"], "profile_id": profile["id"]}
                if sample["id"] in prior and prior[sample["id"]] != item:
                    raise ValueError("A resumed sample differs from its retained native profile")
                rows.append(item)
                state["samples"] = rows[:]
                state["updated_at"] = now()
                atomic_json(state_path, state)
            selection = deepcopy(definition["experiment_selection"])
            selection["profile_ids"] = list(dict.fromkeys(row["profile_id"] for row in rows))
            experiment = experiments.prepare(workspace, selection)
            marker = {"schema": "upstate.joint-parameter-experiment/v1",
                      "study_id": study_id, "experiment_id": experiment["id"],
                      "definition_sha256": study_id}
            experiment_root = workspace.root / "experiments" / experiment["id"]
            with held(experiment_root / ".experiment.lock", blocking=False):
                atomic_json(experiment_root / "joint-parameter-study.json", marker, immutable=True)
            state.update(state="prepared", experiment_id=experiment["id"],
                         profile_ids=selection["profile_ids"], updated_at=now())
            atomic_json(state_path, state)
            return inspect(workspace, study_id)
        except BaseException as error:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(error).__name__, "message": str(error)})
            atomic_json(state_path, state)
            raise


def inspect(workspace, study_id):
    definition = _definition(workspace, study_id)
    state = read_json(_directory(workspace, study_id) / "state.json")
    if (state.get("schema") != SCHEMA or state.get("id") != study_id
            or state.get("workspace_id") != workspace.project["id"]):
        raise ValueError("The retained joint-study state changed identity")
    samples = {row["id"]: row for row in definition["samples"]}
    base = workspace._get("profiles", definition["baseline"]["baseline_profile_id"])
    seen = set()
    if [row.get("sample_id") for row in state.get("samples", [])] != [row["id"] for row in definition["samples"][:len(state.get("samples", []))]]:
        raise ValueError("The retained sample map differs from its original ordered design")
    for row in state.get("samples", []):
        sample = samples.get(row.get("sample_id"))
        if sample is None or row["sample_id"] in seen:
            raise ValueError("The retained profile map differs from the original complete design")
        seen.add(row["sample_id"])
        if (row.get("replicate_id") != sample["replicate_id"]
                or row.get("ordinal") != sample["ordinal"]):
            raise ValueError("The retained profile map changed sample order")
        profile = workspace._get("profiles", identifier(row.get("profile_id")))
        expected = _profile(base, definition, study_id, sample)
        expected["schema"] = "upstate.profiles/v1"
        expected["table_summary"] = deepcopy(base["table_summary"])
        if profile["id"] != digest(expected):
            raise ValueError("The saved native profile differs from every frozen sampled parameter")
        if profile.get("joint_parameter_derivation") != {
                "study_id": study_id, "baseline_profile_id": definition["baseline"]["baseline_profile_id"],
                "physical_id": digest(sample["overrides"]), "overrides": sample["overrides"]}:
            raise ValueError("The original native profile has a different sample derivation")
    result = {**state, "definition": definition,
              "sample_count": len(definition["samples"]),
              "prepared_samples": len(state.get("samples", []))}
    if state.get("experiment_id"):
        experiment = experiments.inspect(workspace, state["experiment_id"], offset=0, limit=1)
        selection = deepcopy(definition["experiment_selection"])
        selection["profile_ids"] = list(dict.fromkeys(row["profile_id"] for row in state["samples"]))
        if (len(seen) != len(samples) or state["profile_ids"] != selection["profile_ids"]
                or experiment["selection"] != selection):
            raise ValueError("The joint study points to another native experiment or incomplete sample map")
        marker = read_json(workspace.root / "experiments" / state["experiment_id"] / "joint-parameter-study.json")
        if marker != {"schema": "upstate.joint-parameter-experiment/v1", "study_id": study_id,
                      "experiment_id": state["experiment_id"], "definition_sha256": study_id}:
            raise ValueError("The native experiment has a different joint-study binding")
        result["experiment"] = experiment
        result["state"] = experiment["state"]
    return result


def catalog(workspace):
    root = workspace.root / DIRECTORY
    result = []
    if not root.is_dir():
        return result
    for path in sorted(root.iterdir()):
        if path.is_dir() and (path / "state.json").is_file():
            value = inspect(workspace, path.name)
            result.append({key: value.get(key) for key in (
                "id", "state", "sample_count", "prepared_samples", "experiment_id", "created_at", "updated_at")})
            result[-1]["title"] = value["definition"]["specification"]["title"]
    return result


def execute(workspace, study_id):
    """Run the original experiment; keep its native stage and recovery behavior."""
    current = inspect(workspace, study_id)
    if not current.get("experiment_id"):
        current = prepare(workspace, current["definition"])
    result = experiments.execute(workspace, current["experiment_id"])
    return {"study": inspect(workspace, study_id), "execution": result,
            "summary": experiments.read_summary(workspace, current["experiment_id"])}


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    commands = parser.add_subparsers(dest="action", required=True)
    for action in ("preview", "prepare"):
        command = commands.add_parser(action)
        command.add_argument("input", type=Path)
        command.add_argument("--output", type=Path, required=True)
    for action in ("inspect", "run"):
        command = commands.add_parser(action)
        command.add_argument("study_id")
        command.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    ws = Workspace(args.workspace)
    if args.action == "preview":
        result = preview(ws, read_json(args.input))
    elif args.action == "prepare":
        value = read_json(args.input)
        result = prepare(ws, value.get("definition", value))
    elif args.action == "inspect":
        result = inspect(ws, args.study_id)
    else:
        result = execute(ws, args.study_id)
    atomic_json(args.output, result)
    print(json.dumps({"action": args.action, "study_id": result.get("id", args.study_id if hasattr(args, "study_id") else None),
                      "output": str(args.output)}, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
