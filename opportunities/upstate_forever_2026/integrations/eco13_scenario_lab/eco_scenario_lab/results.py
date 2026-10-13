"""Native table bindings and matched watershed comparisons; no pixel attribution."""
from __future__ import annotations
import copy
import csv
import html
import io
import json
import math
from pathlib import Path
from typing import Any
from .store import ScenarioError, atomic_bytes, atomic_json, digest, dataset_hash, file_hash, inside, read_json

# Native InVEST 3.15.0 and 3.20.0 fields verified from the upstream model source. Inputs
# retain caller-specified watershed IDs, so the ID field is always explicit.
BINDINGS = {
    "ndr": {
        "path": "watershed_results_ndr.gpkg",
        "metrics": {
            "nitrogen_export": {"field": "n_total_export", "unit": "kg/year", "direction": "minimize"},
            "phosphorus_export": {"field": "p_surface_export", "unit": "kg/year", "direction": "minimize"},
        },
    },
    "sdr": {
        "path": "watershed_results_sdr.shp",
        "metrics": {
            "sediment_export": {"field": "sed_export", "unit": "tonne/year", "direction": "minimize"},
        },
    },
    "annual_water_yield": {
        "path": "output/watershed_results_wyield.shp",
        "metrics": {
            "annual_water_yield_volume": {"field": "wyield_vol", "unit": "m3/year", "direction": "neutral"},
            "annual_water_yield_depth": {"field": "wyield_mn", "unit": "mm/year", "direction": "neutral"},
        },
    },
}


def binding_for(model: str, entry: dict) -> dict:
    binding = {**BINDINGS[model], **entry.get("result", {})}
    binding["id_field"] = entry.get("result", {}).get("id_field", "ws_id")
    if model == "ndr" and "metrics" not in entry.get("result", {}):
        binding["metrics"] = {k: v for k, v in BINDINGS[model]["metrics"].items()
                              if entry["args"].get("calc_n" if k.startswith("nitrogen") else "calc_p", False)}
    if not binding["metrics"]:
        raise ScenarioError(f"No selected result metrics for {model}")
    for name, metric in binding["metrics"].items():
        if metric.get("direction") not in {"minimize", "maximize", "neutral"} or not metric.get("unit"):
            raise ScenarioError(f"Metric {name} needs a unit and explicit direction")
        if model == "annual_water_yield" and metric.get("direction") != "neutral":
            raise ScenarioError("Annual water yield is a trade-off, not an automatic benefit ranking")
    return binding


def inspect_table(path: Path, layer: str | None = None) -> dict:
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as source:
            reader = csv.DictReader(source)
            return {"fields": reader.fieldnames, "rows": sum(1 for _ in reader), "format": "csv"}
    import fiona
    layers = fiona.listlayers(path)
    if layer is None and len(layers) != 1:
        return {"layers": layers, "instruction": "Choose an explicit layer"}
    with fiona.open(path, layer=layer or layers[0]) as source:
        return {"layers": layers, "fields": dict(source.schema["properties"]),
                "rows": len(source), "crs": source.crs.to_string(), "format": source.driver}


def read_results(path: Path, binding: dict, *, watershed_source_sha256: str) -> dict:
    rows: dict[str, dict] = {}
    spatial: dict[str, str] = {}
    if path.suffix.lower() == ".csv":
        handle = path.open(newline="", encoding="utf-8-sig")
        collection = csv.DictReader(handle)
        fields = collection.fieldnames or []
        crs = None
        features = ((row, None) for row in collection)
    else:
        import fiona
        from shapely.geometry import shape
        from shapely import normalize, to_wkb
        layers = fiona.listlayers(path)
        layer = binding.get("layer")
        if layer is None and len(layers) != 1:
            raise ScenarioError(f"Choose the result layer from {layers}")
        handle = fiona.open(path, layer=layer or layers[0])
        fields = list(handle.schema["properties"])
        crs = handle.crs.to_string()
        features = ((dict(f["properties"]), f["geometry"]) for f in handle)
    try:
        required = {binding["id_field"]} | {m["field"] for m in binding["metrics"].values()}
        if not required.issubset(fields):
            raise ScenarioError(f"Missing native result fields {sorted(required-set(fields))}; available: {fields}")
        for props, geometry in features:
            raw_id = props[binding["id_field"]]
            if raw_id is None or str(raw_id).strip() == "":
                raise ScenarioError("Native watershed ID is null or empty")
            identifier = str(raw_id)
            if identifier in rows:
                raise ScenarioError(f"Duplicate native watershed identifier: {identifier}")
            metrics = {}
            for name, metric in binding["metrics"].items():
                value = props[metric["field"]]
                if value is None or isinstance(value, bool):
                    raise ScenarioError(f"Missing native value: {identifier}/{name}")
                try:
                    numeric = float(value)
                except (ValueError, TypeError) as exc:
                    raise ScenarioError(f"Nonnumeric native value: {identifier}/{name}") from exc
                if not math.isfinite(numeric):
                    raise ScenarioError(f"Nonfinite native value: {identifier}/{name}")
                metrics[name] = numeric
            rows[identifier] = metrics
            if geometry is not None:
                geom = shape(geometry)
                if geom.is_empty or not geom.is_valid:
                    raise ScenarioError(f"Invalid result watershed geometry: {identifier}")
                spatial[identifier] = digest({"crs": crs, "geometry": to_wkb(normalize(geom), hex=True)})
    finally:
        handle.close()
    if not rows:
        raise ScenarioError("Native output contains no watershed records")
    return {"dataset_sha256": dataset_hash(path), "binding": binding, "rows": rows,
            "geometry": spatial, "watershed_source_sha256": watershed_source_sha256}


def compare_pair(baseline: dict, alternative: dict) -> list[dict]:
    if baseline["binding"] != alternative["binding"]:
        raise ScenarioError("Comparison uses different result fields or units")
    if baseline["watershed_source_sha256"] != alternative["watershed_source_sha256"]:
        raise ScenarioError("Comparison uses different original watershed inputs")
    if baseline["geometry"] != alternative["geometry"]:
        raise ScenarioError("Comparison watershed geometry or CRS changed")
    if set(baseline["rows"]) != set(alternative["rows"]):
        raise ScenarioError("Comparison must contain exactly the same watershed IDs")
    output = []
    for watershed in sorted(baseline["rows"]):
        for metric, meta in baseline["binding"]["metrics"].items():
            b = baseline["rows"][watershed][metric]
            a = alternative["rows"][watershed][metric]
            change = a - b
            benefit = -change if meta["direction"] == "minimize" else change if meta["direction"] == "maximize" else None
            output.append({"watershed_id": watershed, "metric": metric, "unit": meta["unit"],
                           "baseline": b, "scenario": a, "change": change,
                           "percent_change": 100 * change / abs(b) if b != 0 else None,
                           "benefit": benefit, "direction": meta["direction"]})
    return output


def build_comparison(root: Path) -> dict:
    root = Path(root)
    plan = read_json(root / "plan.json")
    if plan.get("mode") == "adopted-upstate-experiment":
        from .upstate_intake import build_comparison as build_upstate_comparison
        return write_comparison(root, build_upstate_comparison(root))
    state = read_json(root / "state.json")
    active = (state["jobs"][jid] for jid in state.get("active_jobs", {}).values())
    jobs = {(j["case_id"], j["scenario_id"], j["model"]): j for j in active}
    rows = []
    incomplete = []
    scenarios = {s["id"]: s for s in [{"id": "baseline", "cost_cents": 0}] + plan["scenarios"]}
    for case in plan["cases"]:
        for scenario_id, scenario in scenarios.items():
            for model in plan["models"]:
                wanted = [(case["id"], "baseline", model), (case["id"], scenario_id, model)]
                pair = [jobs.get(key) for key in wanted]
                if any(job is None or job["status"] != "complete" for job in pair):
                    incomplete.append({"case_id": case["id"], "scenario_id": scenario_id, "model": model})
                    continue
                base, alt = pair
                if base["comparison_key"] != alt["comparison_key"]:
                    raise ScenarioError("Matched scenario case has inconsistent unchanged inputs/parameters")
                values = []
                for job in pair:
                    path = inside(root, job["result_path"])
                    if file_hash(path) != job["result_sha256"]:
                        raise ScenarioError("A retained comparison input was modified")
                    native = inside(root, job["native_table_path"])
                    if dataset_hash(native) != job["native_dataset_sha256"]:
                        raise ScenarioError("A retained original native table was modified")
                    values.append(read_json(path))
                for row in compare_pair(*values):
                    rows.append({"project_id": plan["project_id"], "setup_id": plan["setup_id"],
                                 "plan_sha256": plan["plan_sha256"], "case_id": case["id"],
                                 "scenario_id": scenario_id, "model": model,
                                 "cost_cents": scenario["cost_cents"],
                                 "currency": plan["currency"], "baseline_job": base["id"],
                                 "scenario_job": alt["id"], "execution_engine": alt["engine_identity"],
                                 **({"original_baseline_job": base["original_job_key"],
                                     "original_scenario_job": alt["original_job_key"],
                                     "original_experiment_key": alt["original_experiment_key"]}
                                    if "original_job_key" in alt else {}), **row})
    output = {"schema": 1, "project_id": plan["project_id"], "setup_id": plan["setup_id"],
              "plan_sha256": plan["plan_sha256"], "currency": plan["currency"],
              "rows": rows, "incomplete": incomplete,
              "case_ids": [c["id"] for c in plan["cases"]],
              "scenarios": [{"id": s["id"], "cost_cents": s["cost_cents"]} for s in scenarios.values()],
              "interpretation": "Paired complete-watershed scenario changes. Annual water yield is interpreted at watershed scale. Each combination is independently executed; isolated parcel effects are never added to predict a combination."}
    return write_comparison(root, output)



def write_comparison(root: Path, comparison: dict) -> dict:
    """Retain the complete result and consistent tabular exports."""
    atomic_json(root / "reports" / "comparisons.json", comparison)
    for key, filename in (("rows", "comparisons.csv"),
                          ("parameter_rows", "parameter-effects.csv"),
                          ("incomplete", "incomplete.csv")):
        records = comparison.get(key, [])
        target = root / "reports" / filename
        if not records:
            target.unlink(missing_ok=True)
            continue
        columns = list(dict.fromkeys(k for record in records for k in record))
        if not columns:
            target.unlink(missing_ok=True)
            continue
        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=columns)
        writer.writeheader()
        for record in records:
            cells = {k: (json.dumps(v, ensure_ascii=False, allow_nan=False)
                         if isinstance(v, (dict, list)) else v)
                     for k, v in record.items()}
            writer.writerow({k: ("'" + v if isinstance(v, str)
                                  and v.startswith(("=", "+", "-", "@", "\t", "\r", "\n"))
                                  else v) for k, v in cells.items()})
        atomic_bytes(target, buffer.getvalue().encode("utf-8"))
    return comparison


def apply_scenario_costs(root: Path, comparison: dict, scenario_costs: dict) -> dict:
    """Save an explicit cost edition while preserving every physical result."""
    if not isinstance(scenario_costs, dict):
        raise ScenarioError("Scenario costs must map original scenario IDs to integer cents")
    scenarios = {s["id"]: s for s in comparison["scenarios"]}
    unknown = set(scenario_costs) - set(scenarios)
    if unknown:
        raise ScenarioError(f"Costs name unknown alternatives: {sorted(unknown)}")
    for identifier, value in scenario_costs.items():
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ScenarioError(f"Cost for {identifier} must be a nonnegative integer in cents")
        if identifier == "baseline" and value != 0:
            raise ScenarioError("The reference baseline retains its zero intervention cost")
    result = copy.deepcopy(comparison)
    for scenario in result["scenarios"]:
        if scenario["id"] in scenario_costs:
            scenario["cost_cents"] = scenario_costs[scenario["id"]]
            scenario["cost_status"] = "declared"
    costs = {s["id"]: s.get("cost_cents") for s in result["scenarios"]}
    for key in ("rows", "parameter_rows"):
        for row in result.get(key, []):
            if row["scenario_id"] in costs:
                row["cost_cents"] = costs[row["scenario_id"]]
    result["cost_inputs"] = {"currency": result["currency"],
                             "scenario_costs": scenario_costs,
                             "sha256": digest(scenario_costs)}
    atomic_json(root / "reports" / "scenario-costs.json", result["cost_inputs"])
    return write_comparison(root, result)



def rank(comparison: dict, objectives: list[dict], budget_cents: int | None = None) -> dict:
    """Screen executed alternatives on each selected outcome and parameter set.

    Cost and physical effects remain separate objectives. Native grid results
    compare only within identical spatial support and reference-run populations.
    """
    if budget_cents is not None and (isinstance(budget_cents, bool)
            or not isinstance(budget_cents, int) or budget_cents < 0):
        raise ScenarioError("Budget must be a nonnegative integer in cents")
    if not isinstance(objectives, list) or not objectives:
        raise ScenarioError("Select explicit spatial-unit/metric objectives")
    pairs = []
    for item in objectives:
        if not isinstance(item, dict):
            raise ScenarioError("Each objective needs a spatial unit and metric")
        unit = item.get("spatial_unit_id", item.get("watershed_id"))
        if unit is None or not str(unit) or not item.get("metric"):
            raise ScenarioError("Each objective needs spatial_unit_id or watershed_id, and metric")
        if ("spatial_unit_id" in item and "watershed_id" in item
                and str(item["spatial_unit_id"]) != str(item["watershed_id"])):
            raise ScenarioError("An objective names two different spatial units")
        pairs.append((str(unit), str(item["metric"])))
    if len(set(pairs)) != len(pairs):
        raise ScenarioError("Select unique spatial-unit/metric objectives")
    all_cases = sorted(comparison["case_ids"])
    if not all_cases or len(all_cases) != len(set(all_cases)):
        raise ScenarioError("Comparison needs a unique original parameter-set population")
    scenarios = {s["id"]: s for s in comparison["scenarios"]}
    if len(scenarios) != len(comparison["scenarios"]):
        raise ScenarioError("Duplicate original scenario IDs")
    native = comparison.get("source_kind") == "upstate.experiment/v1"
    population, excluded = [], []
    for scenario_id, scenario in sorted(scenarios.items()):
        cost = scenario.get("cost_cents")
        if cost is None:
            excluded.append({"scenario_id": scenario_id, "reason": "cost_not_set"})
            continue
        if isinstance(cost, bool) or not isinstance(cost, int) or cost < 0:
            raise ScenarioError(f"Invalid declared intervention cost for {scenario_id}")
        available = [r for r in comparison["rows"] if r["scenario_id"] == scenario_id]
        if any(r.get("cost_cents") != cost for r in available):
            raise ScenarioError("Scenario costs differ across its comparison rows")
        if budget_cents is not None and cost > budget_cents:
            excluded.append({"scenario_id": scenario_id, "reason": "over_budget"})
            continue
        vector, bounds, support = [], [], []
        missing = None
        for spatial_unit, metric in pairs:
            selected = [r for r in available
                        if str(r["watershed_id"]) == spatial_unit and r["metric"] == metric]
            if (len(selected) != len(all_cases)
                    or {r["case_id"] for r in selected} != set(all_cases)):
                missing = {"scenario_id": scenario_id,
                           "reason": "incomplete_objective_population",
                           "spatial_unit_id": spatial_unit, "metric": metric,
                           "available_cases": sorted({r["case_id"] for r in selected}),
                           "required_cases": all_cases}
                break
            if any(r.get("direction") == "neutral" for r in selected):
                raise ScenarioError("Choose directed outcomes; neutral water-yield metrics stay in the report")
            unavailable = [r for r in selected if r.get("benefit") is None]
            if unavailable:
                missing = {"scenario_id": scenario_id,
                           "reason": "selected_outcome_unavailable",
                           "spatial_unit_id": spatial_unit, "metric": metric,
                           "unavailable_cases": sorted({r["case_id"] for r in unavailable}),
                           "original_case_ids": sorted({r.get("original_case_id", r["case_id"])
                                                        for r in unavailable})}
                break
            benefits = [r["benefit"] for r in selected]
            if any(isinstance(v, bool) or not isinstance(v, (int, float))
                   or not math.isfinite(v) for v in benefits):
                raise ScenarioError("A selected physical effect is not a finite number")
            if len({r["unit"] for r in selected}) != 1 or len({r["direction"] for r in selected}) != 1:
                raise ScenarioError("Objective units or directions differ across parameter sets")
            for row in sorted(selected, key=lambda r: r["case_id"]):
                entry = [row["case_id"], spatial_unit, metric, row["unit"], row["direction"]]
                if native:
                    area = row.get("support_sha256")
                    grid = row.get("grid_id")
                    baseline = row.get("original_baseline_run_id", row.get("baseline_job"))
                    if not all(isinstance(v, str) and v for v in (area, grid, baseline)):
                        missing = {"scenario_id": scenario_id,
                                   "reason": "spatial_support_unavailable",
                                   "spatial_unit_id": spatial_unit, "metric": metric}
                        break
                    entry.extend([grid, area, baseline])
                support.append(entry)
                vector.append(row["benefit"])
            if missing:
                break
            bounds.append({"watershed_id": spatial_unit, "spatial_unit_id": spatial_unit,
                           "metric": metric, "unit": selected[0]["unit"],
                           "minimum_benefit": min(benefits),
                           "maximum_benefit": max(benefits),
                           "sign_changes": min(benefits) < 0 < max(benefits)})
        if missing:
            excluded.append(missing)
            continue
        population.append({"scenario_id": scenario_id, "cost_cents": cost,
                           "bounds": bounds, "vector": vector,
                           "comparison_group": digest(support),
                           "dominated_by": []})
    groups = {}
    for item in population:
        groups.setdefault(item["comparison_group"], []).append(item)
    for members in groups.values():
        for a in members:
            for b in members:
                if a is b:
                    continue
                weak = b["cost_cents"] <= a["cost_cents"] and all(
                    x >= y for x, y in zip(b["vector"], a["vector"]))
                strict = b["cost_cents"] < a["cost_cents"] or any(
                    x > y for x, y in zip(b["vector"], a["vector"]))
                if weak and strict:
                    a["dominated_by"].append(b["scenario_id"])
            a["pareto"] = not a["dominated_by"]
            a["comparable_alternatives"] = len(members)
    for item in population:
        del item["vector"]
    return {"schema": 1, "budget_cents": budget_cents,
            "currency": comparison["currency"], "cases": all_cases,
            "objectives": objectives, "scenarios": population, "excluded": excluded,
            "comparison_groups": len(groups),
            "method": ("An alternative is dominated when another costs no more, is at least as good "
                       "on every selected outcome and parameter set, and improves cost or at least one outcome. "
                       "Each native comparison group retains identical grid cells and reference runs. "
                       "The displayed ranges describe the selected parameter sets.")}

def render_report(root: Path, comparison: dict, ranking: dict | None = None) -> Path:
    """Render a complete offline explorer with readable scientific context."""
    def esc(value):
        return html.escape(str(value), quote=True)
    def num(value):
        return "—" if value is None else f"{value:,.6g}"
    def title(value):
        return str(value).replace("_", " ").replace("-", " ").strip().capitalize()
    native = comparison.get("source_kind") == "upstate.experiment/v1"
    rows = comparison["rows"]
    parameter_rows = comparison.get("parameter_rows", [])
    spatial_label = comparison.get("spatial_label", "Reporting grid" if native else "Watershed")
    case_label = "Parameter set" if native else "Case"
    scenario_labels = dict(comparison.get("scenario_labels", {}))
    case_labels = dict(comparison.get("case_labels", {}))
    all_records = rows + parameter_rows + comparison["incomplete"]
    for row in all_records:
        if row.get("scenario_label"):
            scenario_labels[row["scenario_id"]] = row["scenario_label"]
        if row.get("case_label"):
            case_labels[row["case_id"]] = row["case_label"]
    scenario_ids = sorted({s["id"] for s in comparison["scenarios"]}
                          | {r["scenario_id"] for r in all_records if r.get("scenario_id") is not None})
    case_ids = sorted({r["case_id"] for r in all_records if r.get("case_id") is not None}
                      | set(comparison.get("case_ids", [])))
    metrics = sorted({r["metric"] for r in all_records if r.get("metric")})
    def options(values, labels=None):
        labels = labels or {}
        return "".join(f'<option value="{esc(v)}">{esc(labels.get(v, v))}</option>'
                       for v in values)
    metric_labels = {"nitrogen_export": "Nitrogen export",
                     "phosphorus_export": "Phosphorus export",
                     "sediment_export": "Sediment export",
                     "annual_water_yield_volume": "Annual water yield, volume",
                     "annual_water_yield_depth": "Annual water yield, depth"}
    metric_labels.update({v: title(v) for v in metrics if v not in metric_labels})
    downloads = ['<a href="comparisons.json">Complete JSON</a>']
    if rows:
        downloads.append('<a href="comparisons.csv">Alternative results CSV</a>')
    if parameter_rows:
        downloads.append('<a href="parameter-effects.csv">Parameter results CSV</a>')
    if comparison["incomplete"]:
        downloads.append('<a href="incomplete.csv">Incomplete results CSV</a>')
    if ranking is not None:
        downloads.append('<a href="ranking.json">Saved cost comparison</a>')
    def result_section(key, heading, detail):
        return f'''<section aria-labelledby="{key}-heading">
<h2 id="{key}-heading">{esc(heading)}</h2><p>{esc(detail)}</p>
<p id="{key}-count" class="status" aria-live="polite"></p>
<div class="scroll" tabindex="0" aria-label="{esc(heading)} table">
<table id="{key}-table"><thead><tr><th scope="col">Alternative</th><th scope="col">{esc(case_label)}</th><th scope="col">{esc(spatial_label)}</th><th scope="col">Outcome</th><th scope="col">Unit</th><th scope="col">Baseline</th><th scope="col">Alternative</th><th scope="col">Change</th><th scope="col">Change %</th><th scope="col">Improvement</th><th scope="col">Source</th></tr></thead><tbody></tbody></table></div>
<div class="pager" data-kind="{key}"><button type="button" data-step="first">First</button><button type="button" data-step="previous">Previous</button><span id="{key}-page"></span><button type="button" data-step="next">Next</button><button type="button" data-step="last">Last</button></div>
</section>'''
    result_html = result_section("rows", "Land-cover alternatives" if native else "Matched alternatives",
                                "Each row retains one original paired outcome. Select filters to browse the full result population.")
    if parameter_rows:
        result_html += result_section("parameter_rows", "Parameter sensitivity",
                                     "These original reference and parameter runs remain available for scientific interpretation. The cost comparison uses land-cover alternatives.")
    incomplete_html = ""
    if comparison["incomplete"]:
        incomplete_html = f'''<section id="incomplete" aria-labelledby="incomplete-heading">
<h2 id="incomplete-heading">Model results to continue</h2>
<p>Continue these cases in the original experiment. Finished results can be received as a new comparison edition. Original states and available model files remain attached to each record.</p>
<p id="incomplete-count" class="status" aria-live="polite"></p>
<div class="scroll" tabindex="0" aria-label="Incomplete model results table">
<table id="incomplete-table"><thead><tr><th scope="col">Alternative</th><th scope="col">{esc(case_label)}</th><th scope="col">Model</th><th scope="col">Current state</th><th scope="col">Source</th></tr></thead><tbody></tbody></table></div>
<div class="pager" data-kind="incomplete"><button type="button" data-step="first">First</button><button type="button" data-step="previous">Previous</button><span id="incomplete-page"></span><button type="button" data-step="next">Next</button><button type="button" data-step="last">Last</button></div></section>'''
    ranking_html = ""
    if ranking is not None:
        group_ids = sorted({r.get("comparison_group", "") for r in ranking["scenarios"]})
        group_names = {v: f"Coverage group {i+1}" for i, v in enumerate(group_ids)}
        rankrows = []
        for item in ranking["scenarios"]:
            count = item.get("comparable_alternatives", len(ranking["scenarios"]))
            if count == 1:
                outcome = "One complete alternative in this group"
            elif item["pareto"]:
                outcome = "Efficient for the selected costs and outcomes"
            else:
                outcome = "Dominated by " + ", ".join(scenario_labels.get(v, v) for v in item["dominated_by"])
            bounds = "; ".join(
                f'{metric_labels.get(b["metric"], b["metric"])}: '
                f'{num(b["minimum_benefit"])} to {num(b["maximum_benefit"])} {b["unit"]}'
                for b in item.get("bounds", []))
            rankrows.append(f'<tr><td>{esc(scenario_labels.get(item["scenario_id"], item["scenario_id"]))}</td><td>{item["cost_cents"]/100:,.2f}</td><td>{esc(group_names.get(item.get("comparison_group", ""), "Matched outcomes"))}</td><td>{esc(outcome)}</td><td>{esc(bounds)}</td></tr>')
        reasons = {"cost_not_set": "Enter an intervention cost",
                   "over_budget": "Above the selected budget",
                   "incomplete_objective_population": "A selected outcome is missing from one or more parameter sets",
                   "spatial_support_unavailable": "Source grid-cell support needs to be received",
                   "selected_outcome_unavailable": "A selected outcome has no usable paired result",
                   "incomplete_native_runs": "Continue the incomplete original model runs"}
        excluded = "".join(f'<li><strong>{esc(scenario_labels.get(v["scenario_id"], v["scenario_id"]))}</strong>: {esc(reasons.get(v["reason"], title(v["reason"])))}</li>' for v in ranking["excluded"])
        budget = ("No budget ceiling selected" if ranking["budget_cents"] is None else
                  f'Budget ceiling: {ranking["budget_cents"]/100:,.2f} {ranking["currency"]}')
        ranking_html = f'''<section id="costs"><h2>Intervention cost and outcome comparison</h2>
<p>{esc(budget)}. {esc(ranking["method"])}</p>
<div class="scroll"><table><thead><tr><th>Alternative</th><th>Cost ({esc(ranking["currency"])})</th><th>Compared population</th><th>Outcome</th><th>Improvement across parameter sets</th></tr></thead><tbody>{"".join(rankrows)}</tbody></table></div>'''
        if excluded:
            ranking_html += f'<h3>Alternatives outside this cost screen</h3><ul>{excluded}</ul>'
        ranking_html += '<p>Declared costs can be revised independently of the saved physical model outputs. Alternatives in different coverage groups describe different source populations.</p></section>'
    unknown_costs = [s for s in comparison["scenarios"] if s.get("cost_cents") is None]
    costs_note = (f'<p>{len(unknown_costs):,} alternative costs remain to be entered. Their physical outcomes are included below.</p>'
                  if unknown_costs else "")
    original_id = (comparison.get("original_experiment_key")
                   or comparison.get("original_experiment_id")
                   or comparison.get("experiment_id"))
    original_html = f'<p>Original experiment: <code>{esc(original_id)}</code></p>' if original_id else ""
    source_kind = comparison.get("source_kind", "native watershed tables")
    model_labels = ", ".join(sorted({str(r["model"]).upper() for r in all_records if r.get("model")}
                                    | {str(v).upper() for v in comparison.get("selected_models", [])}))
    model_html = f'<p>Selected models: {esc(model_labels)}</p>' if model_labels else ""
    water_note = (" Annual water yield remains a watershed-scale trade-off."
                  if any(metric.startswith("annual_water_yield") for metric in metrics) else "")
    source_html = f'''<section><details><summary>Original experiment and comparison edition</summary>
{original_html}<p>Result source: {esc(source_kind)}</p>
<p>Project <code>{esc(comparison["project_id"])}</code> · Edition <code>{esc(comparison["setup_id"])}</code></p>
<p class="meta">Retained plan: {esc(comparison["plan_sha256"])}</p>
<p>Complete downloads preserve original case, run, grid and support identities for continued scientific work.</p></details></section>'''
    data = {"rows": rows, "parameter_rows": parameter_rows,
            "incomplete": comparison["incomplete"],
            "scenario_labels": scenario_labels, "case_labels": case_labels,
            "metric_labels": metric_labels}
    serialized = json.dumps(data, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
    serialized = serialized.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    style = """
*{box-sizing:border-box}body{margin:0;background:#eee;color:#161616;font:15px/1.5 system-ui,sans-serif}
main{max-width:1600px;margin:auto;padding:28px}header,section,.filters{background:#fff;border:1px solid #aaa;padding:22px;margin-bottom:18px}
h1{font-size:28px;line-height:1.2;margin:0 0 10px}h2{font-size:20px;margin-top:0}h3{font-size:16px}
p{max-width:110ch}a{color:#171717;text-underline-offset:3px}button,select{font:inherit;background:#fff;color:#161616;border:1px solid #666;border-radius:2px;padding:7px 10px}
button{cursor:pointer}button:disabled{cursor:default;color:#777;border-color:#bbb}button:hover:enabled{background:#eee}
:focus-visible{outline:3px solid #222;outline-offset:2px}.toolbar,.filter-fields,.pager{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.toolbar{margin-top:18px}.filter-fields{gap:14px;align-items:flex-end}
label{display:flex;flex-direction:column;gap:5px}select{max-width:30ch}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid #ccc;padding:9px 11px;text-align:right;vertical-align:top;white-space:nowrap}th{background:#eee;text-align:left;position:sticky;top:0}
th:nth-child(n+6):nth-child(-n+10){text-align:right}td:nth-child(-n+5){text-align:left;white-space:normal;min-width:10ch;max-width:28ch;overflow-wrap:anywhere}
td:last-child{text-align:left}td details{min-width:10ch;max-width:45ch;white-space:normal;overflow-wrap:anywhere}
summary{cursor:pointer}dl{display:grid;grid-template-columns:minmax(8rem,1fr) 2fr;gap:6px;font-size:12px}dt{font-weight:600}dd{margin:0}
.pager{justify-content:flex-end;margin-top:12px}.pager span{min-width:9rem;text-align:center}.meta,code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}.meta{font-size:12px;color:#555}
.status{font-size:13px;color:#444}.summary-line{font-size:16px}.note{background:#f5f5f5;border-left:3px solid #666;padding:10px 14px}
@media(max-width:640px){main{padding:12px}header,section,.filters{padding:15px}h1{font-size:24px}.filter-fields label{width:100%}select{max-width:none;width:100%}.pager{justify-content:flex-start}}
@media print{body{background:#fff}main{max-width:none;padding:0}header,section{border:0;padding:0;margin-bottom:20px}.filters,.pager,.toolbar button{display:none}.scroll{overflow:visible}table{font-size:9px}th,td{padding:4px;white-space:normal}thead{display:table-header-group}th{position:static}tr{break-inside:avoid}#rows-table td:last-child dl,#parameter_rows-table td:last-child dl,#incomplete-table td:last-child dl{display:none}td details{min-width:0;max-width:20ch}td summary{font-size:8px;list-style:none}a{color:#000;text-decoration:none}}
"""
    script = """
(function(){
'use strict';
const data=JSON.parse(document.getElementById('comparison-data').textContent);
const controls={scenario:document.getElementById('scenario-filter'),case:document.getElementById('case-filter'),metric:document.getElementById('metric-filter'),size:document.getElementById('page-size')};
const pages={rows:0,parameter_rows:0,incomplete:0};let printing=false;
const number=new Intl.NumberFormat(undefined,{maximumSignificantDigits:6});
function numeric(value){return value===null||value===undefined?'—':typeof value==='number'&&Number.isFinite(value)?number.format(value):'—';}
function addCell(tr,value){const cell=document.createElement('td');cell.textContent=value===null||value===undefined?'—':String(value);tr.appendChild(cell);return cell;}
function label(map,id,fallback){return map[id]||fallback||id;}
function selected(kind){return(data[kind]||[]).filter(function(r){return(!controls.scenario.value||r.scenario_id===controls.scenario.value)&&(!controls.case.value||r.case_id===controls.case.value)&&(!controls.metric.value||r.metric===controls.metric.value||(kind==='incomplete'&&!r.metric));});}
function sourceCell(tr,row){
const cell=addCell(tr,'');const details=document.createElement('details');const summary=document.createElement('summary');
summary.textContent=typeof row.paired_cells==='number'?(numeric(row.paired_cells)+' paired cells'+(typeof row.coverage_fraction==='number'?' · '+numeric(row.coverage_fraction*100)+'% grid':'')):'Original result';
details.appendChild(summary);const list=document.createElement('dl');
const fields=[['Scenario ID',row.scenario_id],['Case ID',row.case_id],['Original case',row.original_case_id],['Model',row.model],['Original experiment',row.original_experiment_key||row.original_experiment_id],['Baseline run',row.original_baseline_run_id||row.original_baseline_job||row.baseline_job],['Alternative run',row.original_scenario_run_id||row.original_scenario_job||row.original_run_id||row.scenario_job],['Native state',row.native_status],['Reporting grid',row.grid_id],['Paired cells',row.paired_cells],['Grid coverage',typeof row.coverage_fraction==='number'?numeric(row.coverage_fraction*100)+'%':null],['Spatial support',row.support_sha256]];
for(const field of fields){if(field[1]===undefined||field[1]===null||field[1]==='')continue;const dt=document.createElement('dt');dt.textContent=field[0];const dd=document.createElement('dd');dd.textContent=String(field[1]);list.appendChild(dt);list.appendChild(dd);}
details.appendChild(list);cell.appendChild(details);
}
function stateText(row){let reason=row.reason||row.status||row.native_status||'Awaiting complete paired results';if(typeof reason==='object')reason=JSON.stringify(reason);reason=String(reason).replace(/[_-]/g,' ');reason=reason.charAt(0).toUpperCase()+reason.slice(1);if(row.native_model_retained)reason+=' · completed model files retained';return reason;}
function render(kind){
const table=document.getElementById(kind+'-table');if(!table)return;const rows=selected(kind),size=printing?Math.max(1,rows.length):Number(controls.size.value),totalPages=Math.max(1,Math.ceil(rows.length/size));pages[kind]=Math.min(pages[kind],totalPages-1);const start=printing?0:pages[kind]*size,end=Math.min(rows.length,start+size),body=table.tBodies[0],fragment=document.createDocumentFragment(),unfinished=kind==='incomplete';
for(let i=start;i<end;i++){const row=rows[i],tr=document.createElement('tr');addCell(tr,label(data.scenario_labels,row.scenario_id,row.scenario_label));addCell(tr,label(data.case_labels,row.case_id,row.case_label));if(unfinished){addCell(tr,String(row.model||'—').toUpperCase());addCell(tr,stateText(row));sourceCell(tr,row);}else{addCell(tr,row.watershed_id);addCell(tr,label(data.metric_labels,row.metric));addCell(tr,row.unit);addCell(tr,numeric(row.baseline));addCell(tr,numeric(row.scenario));addCell(tr,numeric(row.change));addCell(tr,numeric(row.percent_change));addCell(tr,numeric(row.benefit));sourceCell(tr,row);}fragment.appendChild(tr);}
if(!rows.length){const tr=document.createElement('tr'),td=addCell(tr,unfinished?'No unfinished results match these filters.':'No paired outcomes match these filters. Review the current model states or choose another filter.');td.colSpan=unfinished?5:11;fragment.appendChild(tr);}
body.replaceChildren(fragment);const noun=unfinished?'unfinished results':'matched outcomes';document.getElementById(kind+'-count').textContent=rows.length?('Showing '+(start+1).toLocaleString()+'–'+end.toLocaleString()+' of '+rows.length.toLocaleString()+' '+noun):('0 '+noun);document.getElementById(kind+'-page').textContent='Page '+(pages[kind]+1)+' of '+totalPages;
const pager=document.querySelector('.pager[data-kind="'+kind+'"]');for(const button of pager.querySelectorAll('button'))button.disabled=(button.dataset.step==='first'||button.dataset.step==='previous')?pages[kind]===0:pages[kind]>=totalPages-1;
}
function renderAll(reset){for(const kind of Object.keys(pages)){if(reset)pages[kind]=0;render(kind);}}
for(const control of Object.values(controls))control.addEventListener('change',function(){renderAll(true);});
document.getElementById('clear-filters').addEventListener('click',function(){controls.scenario.value='';controls.case.value='';controls.metric.value='';renderAll(true);});
for(const pager of document.querySelectorAll('.pager'))pager.addEventListener('click',function(event){const button=event.target.closest('button');if(!button||button.disabled)return;const kind=pager.dataset.kind,last=Math.max(0,Math.ceil(selected(kind).length/Number(controls.size.value))-1),step=button.dataset.step;if(step==='first')pages[kind]=0;else if(step==='previous')pages[kind]=Math.max(0,pages[kind]-1);else if(step==='next')pages[kind]=Math.min(last,pages[kind]+1);else pages[kind]=last;render(kind);});
let savedPages=null;
window.addEventListener('beforeprint',function(){savedPages={...pages};printing=true;renderAll(false);});
window.addEventListener('afterprint',function(){printing=false;if(savedPages)Object.assign(pages,savedPages);renderAll(false);});
document.getElementById('print-report').addEventListener('click',function(){window.print();});
renderAll(false);
})();
"""
    document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'">
<title>Scenario comparison — {esc(comparison["project_id"])}</title><style>{style}</style></head>
<body><main><header><h1>Scenario comparison</h1><p>{esc(comparison["project_id"])} · {esc(comparison["setup_id"])}</p>
<p class="summary-line">{len(rows):,} alternative outcome records · {len(parameter_rows):,} parameter outcome records · {len(comparison["incomplete"]):,} incomplete result records</p>{model_html}
<p class="note">{esc(comparison.get("interpretation", ""))}</p>{costs_note}
<div class="toolbar"><button id="print-report" type="button">Print filtered report</button>{" · ".join(downloads)}</div></header>
{ranking_html}
<div class="filters"><div class="filter-fields">
<label>Alternative<select id="scenario-filter"><option value="">All alternatives</option>{options(scenario_ids, scenario_labels)}</select></label>
<label>{esc(case_label)}<select id="case-filter"><option value="">All cases</option>{options(case_ids, case_labels)}</select></label>
<label>Outcome<select id="metric-filter"><option value="">All outcomes</option>{options(metrics, metric_labels)}</select></label>
<label>Rows per page<select id="page-size"><option>50</option><option selected>100</option><option>250</option><option>500</option></select></label>
<button id="clear-filters" type="button">Clear filters</button></div>
<p class="status">Filters apply to outcome tables and unfinished cases, including their printed rows. Saved cost comparisons retain their selected population. Complete downloads include every retained row.</p></div>
<noscript><p>Open the complete CSV or JSON downloads to read all results. The table explorer uses JavaScript.</p></noscript>
{result_html}<section><h2>Reading the outcomes</h2>
<p>Change is alternative minus baseline. Improvement reverses the sign for nutrient and sediment export, so a positive improvement indicates less exported mass. Units and percentages follow the original model result.</p>
<p>A dash preserves an unavailable or neutral value.{water_note} Costs are entered intervention estimates.</p></section>
{incomplete_html}{source_html}</main>
<script id="comparison-data" type="application/json">{serialized}</script><script>{script}</script></body></html>'''
    target = root / "reports" / "index.html"
    atomic_bytes(target, document.encode("utf-8"))
    return target
