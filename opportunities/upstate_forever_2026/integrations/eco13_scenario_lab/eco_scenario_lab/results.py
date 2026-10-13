"""Native table bindings and matched watershed comparisons; no pixel attribution."""
from __future__ import annotations
import csv
import html
import io
import math
from pathlib import Path
from typing import Any
import fiona
from shapely.geometry import shape
from shapely import normalize, to_wkb
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
    plan = read_json(root / "plan.json")
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
    atomic_json(root / "reports" / "comparisons.json", output)
    if rows:
        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
        atomic_bytes(root / "reports" / "comparisons.csv", buffer.getvalue().encode("utf-8"))
    else:
        (root / "reports" / "comparisons.csv").unlink(missing_ok=True)
    return output


def rank(comparison: dict, objectives: list[dict], budget_cents: int | None = None) -> dict:
    """Pareto screen entire executed alternatives across all specified cases.

    Each objective is an explicit watershed/metric pair. This intentionally
    avoids double counting nested/overlapping watersheds or summing AWY means.
    Cost is a minimization objective. No arbitrary dollar valuation or weights.
    """
    if budget_cents is not None and (isinstance(budget_cents, bool) or not isinstance(budget_cents, int) or budget_cents < 0):
        raise ScenarioError("Budget must be a nonnegative integer in minor currency units")
    pairs = [(str(o["watershed_id"]), str(o["metric"])) for o in objectives]
    if not pairs or len(set(pairs)) != len(pairs):
        raise ScenarioError("Select unique, explicit watershed/metric objectives")
    rows = comparison["rows"]
    all_scenarios = sorted(s["id"] for s in comparison["scenarios"])
    all_cases = sorted(comparison["case_ids"])
    scenario_costs = {s["id"]: s["cost_cents"] for s in comparison["scenarios"]}
    population = []
    excluded = []
    for scenario in all_scenarios:
        available = [r for r in rows if r["scenario_id"] == scenario]
        costs = {r["cost_cents"] for r in available}
        cost = scenario_costs[scenario]
        if costs - {cost}:
            raise ScenarioError("Scenario costs differ across its comparison rows")
        if budget_cents is not None and cost > budget_cents:
            excluded.append({"scenario_id": scenario, "reason": "over_budget"})
            continue
        if any(i["scenario_id"] == scenario for i in comparison["incomplete"]):
            excluded.append({"scenario_id": scenario, "reason": "incomplete_native_runs"})
            continue
        vectors = []
        bounds = []
        for watershed, metric in pairs:
            selected = [r for r in available if r["watershed_id"] == watershed and r["metric"] == metric]
            if len(selected) != len(all_cases) or {r["case_id"] for r in selected} != set(all_cases):
                raise ScenarioError(f"Objective missing from complete case population: {watershed}/{metric}")
            if any(r["benefit"] is None for r in selected):
                raise ScenarioError("Neutral metrics, including AWY, cannot be benefit objectives")
            benefits = [r["benefit"] for r in selected]
            if len({r["unit"] for r in selected}) != 1:
                raise ScenarioError("Objective units differ across cases")
            vectors.extend(r["benefit"] for r in sorted(selected, key=lambda r: r["case_id"]))
            bounds.append({"watershed_id": watershed, "metric": metric, "unit": selected[0]["unit"],
                           "minimum_benefit": min(benefits), "maximum_benefit": max(benefits),
                           "sign_changes": min(benefits) < 0 < max(benefits)})
        population.append({"scenario_id": scenario, "cost_cents": cost, "bounds": bounds,
                           "vector": vectors, "dominated_by": []})
    for a in population:
        for b in population:
            if a is b:
                continue
            weak = b["cost_cents"] <= a["cost_cents"] and all(x >= y for x, y in zip(b["vector"], a["vector"]))
            strict = b["cost_cents"] < a["cost_cents"] or any(x > y for x, y in zip(b["vector"], a["vector"]))
            if weak and strict:
                a["dominated_by"].append(b["scenario_id"])
        a["pareto"] = not a["dominated_by"]
    for item in population:
        del item["vector"]
    return {"schema": 1, "budget_cents": budget_cents, "currency": comparison["currency"],
            "cases": all_cases, "objectives": objectives, "scenarios": population, "excluded": excluded,
            "method": "Cost and benefit Pareto dominance across every matched case; sensitivity bounds are not confidence intervals."}


def render_report(root: Path, comparison: dict, ranking: dict | None = None) -> Path:
    def esc(value):
        return html.escape(str(value), quote=True)
    def num(value):
        return "—" if value is None else f"{value:,.6g}"
    rows = comparison["rows"]
    scenario_ids = sorted({r["scenario_id"] for r in rows})
    engines = ", ".join(sorted({r["execution_engine"] for r in rows})) or "No completed runs"
    filters = "".join(f'<option value="{esc(s)}">{esc(s)}</option>' for s in scenario_ids)
    table = "".join(f'<tr data-scenario="{esc(r["scenario_id"])}"><td>{esc(r["scenario_id"])}</td><td>{esc(r["case_id"])}</td><td>{esc(r["watershed_id"])}</td><td>{esc(r["metric"])}</td><td>{esc(r["unit"])}</td><td>{num(r["baseline"])}</td><td>{num(r["scenario"])}</td><td>{num(r["change"])}</td><td>{num(r["benefit"])}</td></tr>' for r in rows)
    ranking_html = ""
    if ranking:
        rankrows = "".join(f'<tr><td>{esc(r["scenario_id"])}</td><td>{r["cost_cents"]/100:,.2f}</td><td>{"Non-dominated" if r["pareto"] else "Dominated by " + esc(", ".join(r["dominated_by"]))}</td></tr>' for r in ranking["scenarios"])
        ranking_html = f'<section><h2>Executed alternatives / budget trade-offs</h2><p>{esc(ranking["method"])}</p><table><thead><tr><th>Scenario</th><th>Cost ({esc(ranking["currency"])})</th><th>Comparison</th></tr></thead><tbody>{rankrows}</tbody></table></section>'
    document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'"><title>Scenario comparison — {esc(comparison['project_id'])}</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#eee;color:#171717;font:15px/1.5 system-ui,sans-serif}}main{{max-width:1500px;margin:auto;padding:32px}}header,section{{background:#fff;border:1px solid #aaa;padding:24px;margin-bottom:20px}}h1{{font-size:28px;margin:0 0 10px}}h2{{font-size:20px}}.meta{{font-family:monospace;overflow-wrap:anywhere;color:#444}}.scroll{{overflow:auto}}table{{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}}td,th{{border-bottom:1px solid #bbb;padding:10px;text-align:right;white-space:nowrap}}td:first-child,th:first-child{{text-align:left}}th{{background:#eee}}select,button{{font:inherit;padding:7px 12px;background:white;color:#111;border:1px solid #555}}label{{display:block;margin:12px 0}}.note{{border-left:4px solid #666;padding:12px;background:#f5f5f5}}a{{color:#111}}@media print{{body{{background:white}}main{{padding:0}}header,section{{border:0;padding:0}}button,select,label{{display:none}}table{{font-size:10px}}th{{position:static}}tr{{break-inside:avoid}}.scroll{{overflow:visible}}}}</style></head><body><main>
<header><h1>Watershed scenario comparison</h1><p>{esc(comparison['project_id'])} · Setup {esc(comparison['setup_id'])}</p><p>Execution engine: {esc(engines)}</p><p class="meta">Retained plan: {esc(comparison['plan_sha256'])}</p><p>{len(rows):,} paired metric records · {len(comparison['incomplete']):,} incomplete model/scenario pairs</p><p class="note">{esc(comparison['interpretation'])}</p><button onclick="window.print()">Print report</button> <a href="comparisons.csv">Complete CSV</a> · <a href="comparisons.json">Complete JSON</a></header>{ranking_html}
<section><h2>Complete matched results</h2><label>Scenario <select id="scenario"><option value="">All scenarios</option>{filters}</select></label><div class="scroll"><table id="results"><thead><tr><th>Scenario</th><th>Case</th><th>Watershed</th><th>Metric</th><th>Unit</th><th>Baseline</th><th>Scenario</th><th>Change</th><th>Benefit</th></tr></thead><tbody>{table}</tbody></table></div><p>Change = scenario − baseline. Benefit reverses the sign for exports to water. A dash indicates a neutral metric or undefined percentage; it never substitutes a zero. Costs are declared scenario inputs, not model valuations.</p></section>
</main><script>document.getElementById('scenario').addEventListener('change',function(){{for(const row of document.querySelectorAll('#results tbody tr'))row.hidden=!!this.value&&row.dataset.scenario!==this.value;}});</script></body></html>'''
    target = root / "reports" / "index.html"
    atomic_bytes(target, document.encode("utf-8"))
    return target
