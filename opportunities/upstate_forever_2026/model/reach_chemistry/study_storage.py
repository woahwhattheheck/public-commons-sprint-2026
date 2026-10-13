"""Native physical receiving study for the original variable-storage engine.

Run from the existing Upper Savannah source:
    python -m model.reach_chemistry.study_storage --output /absolute/new/study

This course compares original numerical outputs with closed-form physical cases
and independently perturbed parameter sensitivities. Observed source studies are
separate original cases supplied by the receiving-water source builder.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import math
from pathlib import Path
import platform
import sys
import numpy as np
import scipy
from .model import Project, canonical_bytes
from .solver import simulate, attribute_sources
from .inference import Parameters, sensitivity, observation_components
from .io import atomic_write, json_write, write_outputs

REFERENCE = {"kind": "analytical-physical-case",
             "reference": "Original variable-storage receiving study; declared conservation equations"}


def item(**values):
    return {**values, "provenance": deepcopy(REFERENCE)}


def single(title, inflow, outflow, *, water_only=False, decay=0.0, inverse=False):
    project = {"schema": "reach-chemistry/1", "title": title,
        "hydrology": {"mode": "variable-storage"}, "provenance": deepcopy(REFERENCE),
        "species": [item(id="tracer", basis="tracer")],
        "reaches": [item(id="reservoir", volume_m3=1000.0)],
        "flows": [item(id="in", source=None, target="reservoir", m3_day=inflow,
                       concentration_mg_l={}),
                  item(id="out", source="reservoir", target=None, m3_day=outflow,
                       solute_transport=not water_only)],
        "initial": [item(id="initial", reach="reservoir", species="tracer", kg=10.0)],
        "phases": [{"until_day": 5.0}], "loads": [], "reactions": []}
    if decay:
        project["reactions"] = [item(id="removal", source="tracer", rate_day=decay,
            products={}, sink_label="declared physical removal",
            volume_scaling="inverse" if inverse else "constant")]
    return project


def check_close(label, actual, expected, *, rtol=2e-8, atol=1e-9):
    if not math.isfinite(actual) or abs(actual-expected) > atol + rtol*abs(expected):
        raise ArithmeticError(f"{label}: actual {actual}, expected {expected}")
    return {"quantity": label, "actual": float(actual), "expected": float(expected),
            "absolute_error": float(abs(actual-expected)), "rtol": rtol, "atol": atol}


def network():
    return {"schema": "reach-chemistry/1", "title": "Two-reach changing-storage nitrogen network",
        "hydrology": {"mode": "variable-storage"}, "provenance": deepcopy(REFERENCE),
        "species": [item(id="ammonium", basis="N"), item(id="nitrate", basis="N")],
        "reaches": [item(id="upstream", volume_m3=1000.0),
                    item(id="reservoir", volume_m3=500.0)],
        "flows": [item(id="inflow", source=None, target="upstream", m3_day=100.0,
                       concentration_mg_l={"ammonium": 3.0}, source_tag="upstream-boundary"),
                  item(id="transfer", source="upstream", target="reservoir", m3_day=60.0),
                  item(id="outflow", source="reservoir", target=None, m3_day=80.0)],
        "loads": [item(id="catchment", reach="upstream", species="ammonium",
                       kg_day=6.0, source_tag="catchment-load")],
        "initial": [item(id="upstream-initial", reach="upstream", species="ammonium", kg=2.0),
                    item(id="reservoir-initial", reach="reservoir", species="nitrate", kg=1.0)],
        "reactions": [item(id="nitrification", source="ammonium", products={"nitrate": 1.0},
                           rate_day=0.2),
                      item(id="removal", source="nitrate", products={}, rate_day=0.015,
                           reach_ids=["reservoir"], volume_scaling="inverse",
                           sink_label="declared settling removal")],
        "phases": [{"until_day": 3.0},
                   {"until_day": 8.0, "flow_multipliers": {"inflow": 1.5, "outflow": 0.75},
                    "load_multipliers": {"catchment": 0.6}}]}


def run_course(directory):
    directory = Path(directory).resolve()
    if directory.exists() and any(directory.iterdir()):
        raise ValueError("Use an empty study output; preserve complete earlier runs")
    directory.mkdir(parents=True, exist_ok=True)
    rows, identities = [], []
    times = [0.0, 0.25, 1.0, 2.5, 5.0]
    cases = [
        ("filling", single("Clean-water filling", 100.0, 0.0),
         lambda t: 10.0, lambda t: 0.0),
        ("drawdown", single("Well-mixed drawdown", 0.0, 100.0),
         lambda t: 10.0*(1000.0-100.0*t)/1000.0,
         lambda t: 10.0*100.0*t/1000.0),
        ("evaporation", single("Water-only evaporation", 0.0, 100.0, water_only=True),
         lambda t: 10.0, lambda t: 0.0),
        ("decay-filling", single("First-order decay during filling", 100.0, 0.0, decay=0.15),
         lambda t: 10.0*math.exp(-0.15*t), None),
        ("inverse-removal", single("Fixed-area inverse-volume removal during drawdown",
                                  0.0, 100.0, decay=0.1, inverse=True),
         lambda t: 10.0*((1000.0-100.0*t)/1000.0)**2,
         lambda t: 10.0/2*(1-((1000.0-100.0*t)/1000.0)**2)),
    ]
    for name, raw, expected_mass, expected_export in cases:
        project = Project(raw)
        result = simulate(project, times).result()
        write_outputs(directory/name, project, result, {"mode":"simulate","sample_days":times})
        checks = []
        for sample in result["samples"]:
            day = sample["day"]
            expected_volume = 1000.0 + (raw["flows"][0]["m3_day"]-raw["flows"][1]["m3_day"])*day
            checks.append(check_close(name+" mass at "+str(day), sample["values"][0]["kg"], expected_mass(day)))
            checks.append(check_close(name+" concentration at "+str(day), sample["values"][0]["mg_l"],
                                      1000.0*expected_mass(day)/expected_volume))
            checks.append(check_close(name+" volume at "+str(day), sample["storage"][0]["volume_m3"],
                                      expected_volume))
        if expected_export is not None:
            checks.append(check_close(name+" integrated export", result["budgets"][0]["boundary_export_kg"],
                                      expected_export(project.end_day)))
        rows.append({"case": name, "project_sha256": project.fingerprint, "checks": checks,
                     "budgets": result["budgets"], "storage_budgets": result["storage_budgets"]})
        identities.append({"case":name,"project_sha256":project.fingerprint})

    # The two numerical paths must agree when the new storage option has no
    # changing volume. This checks integrated export/reactions, not only a final concentration.
    balanced = single("Constant-volume path equivalence", 100.0, 100.0, decay=0.15)
    balanced["flows"][0]["concentration_mg_l"] = {"tracer": 4.0}
    variable = simulate(balanced, times).result()
    fixed_raw = deepcopy(balanced); fixed_raw.pop("hydrology")
    fixed = simulate(fixed_raw, times).result()
    write_outputs(directory/"balanced-variable", balanced, variable, {"mode":"simulate","sample_days":times})
    write_outputs(directory/"balanced-fixed", fixed_raw, fixed, {"mode":"simulate","sample_days":times})
    checks = [check_close("balanced "+key, variable["budgets"][0][key], fixed["budgets"][0][key])
              for key in ("input_kg","final_storage_kg","boundary_export_kg","untracked_reaction_sink_kg")]
    rows.append({"case":"balanced-path-equivalence","checks":checks})

    raw = network(); project = Project(raw)
    attributed = attribute_sources(project, [0.0, 1.0, 3.0, 5.0, 8.0])
    write_outputs(directory/"network-attribution", project, attributed,
                  {"mode":"attribute","sample_days":[0.0,1.0,3.0,5.0,8.0]})
    parameter_rows = [
        {"id":"decay","kind":"reaction_rate_day","target":"nitrification","lower":0.05,"upper":0.6},
        {"id":"settling","kind":"reaction_rate_day","target":"removal","lower":0.001,"upper":0.08},
        {"id":"load","kind":"load_kg_day","target":"catchment","lower":1.0,"upper":10.0},
        {"id":"boundary","kind":"boundary_mg_l","target":"inflow","species":"ammonium","lower":0.1,"upper":10.0},
        {"id":"initial","kind":"initial_kg","target":"reservoir-initial","lower":0.1,"upper":5.0}]
    observations = [{"id":f"nitrate-{day}", "reach":"reservoir","species":"nitrate","day":day}
                    for day in (1.0,3.0,5.0,8.0)]
    observations.append({"id":"total-N","reach":"reservoir","measurement":"total dissolved N",
                         "basis":"N","components":[{"species":"ammonium","weight":1.0},
                                                    {"species":"nitrate","weight":1.0}],"day":8.0})
    request = {"mode":"sensitivity","parameters":parameter_rows,"observations":observations}
    tangent = sensitivity(project, parameter_rows, observations)
    write_outputs(directory/"network-sensitivity", project, tangent, request)
    parameters = Parameters.parse(project, parameter_rows)
    checks = []
    def predictions(values):
        result = simulate(parameters.assign(values), [1.0,3.0,5.0,8.0]).result()
        lookup = {(sample["day"], row["reach"], row["species"]):row["mg_l"]
                  for sample in result["samples"] for row in sample["values"]}
        return np.asarray([sum(weight*lookup[(o["day"],o["reach"],sid)]
                               for sid,weight in observation_components(project,o)) for o in observations])
    for j, parameter in enumerate(parameters.rows):
        delta = max(abs(parameters.values[j]), 0.01)*1e-4
        low, high = parameters.values.copy(), parameters.values.copy()
        low[j] -= delta; high[j] += delta
        derivative = (predictions(high)-predictions(low))/(2*delta)
        for i, row in enumerate(tangent["rows"]):
            checks.append(check_close("tangent "+parameter["id"]+" / "+observations[i]["id"],
                          row["derivatives"][j]["mg_l_per_parameter_unit"], float(derivative[i]),
                          rtol=2e-5, atol=2e-7))
    rows.append({"case":"network-source-attribution","closure":attributed["closure"],
                 "budgets":attributed["baseline"]["budgets"],
                 "storage_budgets":attributed["baseline"]["storage_budgets"]})
    rows.append({"case":"network-forward-tangents","checks":checks})
    # Checkpoint receiving exercises one original intermediate event, then resumes
    # the same immutable selection to its actual final mass and integrated ledgers.
    checkpoints = []
    complete = simulate(project, [0.0,1.0,3.0,5.0,8.0], checkpoint=checkpoints.append).result()
    resumed = simulate(project, [0.0,1.0,3.0,5.0,8.0], resume=checkpoints[1]).result()
    checks = []
    for i, state in enumerate(complete["final"]):
        checks.append(check_close("resumed "+state["reach"]+"/"+state["species"],
                                  resumed["final"][i]["kg"], state["kg"], rtol=1e-10, atol=1e-10))
    for i, budget in enumerate(complete["budgets"]):
        for key in ("final_storage_kg","boundary_export_kg","untracked_reaction_sink_kg"):
            checks.append(check_close("resumed "+budget["basis"]+"/"+key,
                                      resumed["budgets"][i][key], budget[key], rtol=1e-10, atol=1e-10))
    json_write(directory/"original-checkpoints.json", {"checkpoints":checkpoints})
    write_outputs(directory/"network-resumed", project, resumed,
                  {"mode":"simulate","sample_days":[0.0,1.0,3.0,5.0,8.0]})
    rows.append({"case":"original-checkpoint-resume","checks":checks})
    summary = {"schema":"reach-chemistry-variable-storage-study/1", "state":"COMPLETE",
               "python":sys.version,"platform":platform.platform(),
               "numpy":np.__version__,"scipy":scipy.__version__,
               "analytical_cases":identities,"results":rows}
    json_write(directory/"study.json", summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not args.output.is_absolute():
        parser.error("--output must be an absolute path")
    result = run_course(args.output)
    print(canonical_bytes(result).decode("utf-8"))


if __name__ == "__main__":
    main()
