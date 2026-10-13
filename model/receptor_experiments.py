"""Join retained native experiments to upstream source-water area inventories.

Each land-cover alternative stays paired with its own parameter-profile baseline.
The command reads existing case records and physical outputs; native execution
remains with the scientific workspace's experiment queue.
"""
from __future__ import annotations

import csv
from html import escape
import io
import math
from pathlib import Path
import statistics

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     held, identifier, now, read_json, verify_file)
from . import experiments, receptor_execution
from .receptor_cli import build as build_inventory

SCHEMA = "upstate.receptor-experiment/v1"
SELECTION_SCHEMA = "upstate.receptor-experiment-selection/v1"
SNAPSHOT_SCHEMA = "upstate.receptor-experiment-snapshot/v1"
EXPORT_FIELDS = (
    "experiment_id", "group_id", "case_id", "profile_id", "profile_title",
    "baseline_run_id", "alternative_run_id", "scenario_id", "scenario_title",
    "receptor_id", "receptor_title", "role", "pollutant", "unit",
    "baseline_export", "alternative_export", "common_baseline_export",
    "common_alternative_export", "alternative_minus_baseline", "reduction",
    "change_percent", "selected_cells", "baseline_valid_cells",
    "alternative_valid_cells", "common_valid_cells", "coverage_fraction",
    "baseline_only_cells", "alternative_only_cells", "profile_changed",
    "basin_baseline_export", "basin_alternative_export", "basin_change",
    "basin_change_percent", "basin_common_valid_cells", "basin_coverage_fraction",
    "basin_support_sha256", "inventory_id", "inventory_report",
    *receptor_execution.CSV_FIELDS,
)
RANGE_FIELDS = (
    "receptor_id", "receptor_title", "role", "scenario_id", "scenario_title",
    "pollutant", "unit", "evaluated_profiles", "profiles_with_quantities",
    "minimum_change", "median_change", "maximum_change", "reduced_profiles",
    "unchanged_profiles", "increased_profiles", "minimum_coverage_fraction",
    "maximum_coverage_fraction", "same_basin_support", "native_model", "native_version",
)


def _ids(value, name):
    if not isinstance(value, list):
        raise ValueError(name + " must be a list of retained IDs")
    return sorted({identifier(item) for item in value})


def _selection(value):
    if not isinstance(value, dict):
        raise ValueError("Supply a receptor experiment selection object")
    allowed = {"schema", "title", "experiment_id", "receptor_spec",
               "profile_ids", "scenario_ids", "delivery_ids_by_baseline"}
    unknown = set(value) - allowed
    if unknown:
        raise ValueError("Unknown receptor experiment fields: " + ", ".join(sorted(unknown)))
    if value.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError("Select an upstate.receptor-experiment-selection/v1 document")
    title = value.get("title", "Source-water scenario comparisons")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Give the comparison a title")
    receptor_spec = value.get("receptor_spec")
    if not isinstance(receptor_spec, dict) or not receptor_spec.get("receptors"):
        raise ValueError("Select the complete receptor specification")
    deliveries = value.get("delivery_ids_by_baseline", {})
    if not isinstance(deliveries, dict):
        raise ValueError("delivery_ids_by_baseline must map baseline IDs to delivery IDs")
    result = {
        "schema": SELECTION_SCHEMA, "title": title.strip(),
        "experiment_id": identifier(value.get("experiment_id")),
        "receptor_spec": receptor_spec,
        "profile_ids": _ids(value.get("profile_ids", []), "Profile IDs"),
        "scenario_ids": _ids(value.get("scenario_ids", []), "Scenario IDs"),
        "delivery_ids_by_baseline": {identifier(key): identifier(item)
                                     for key, item in sorted(deliveries.items())},
    }
    # Copy the JSON data so a caller cannot mutate an active selection.
    import json
    return json.loads(canonical(result))


def snapshot(workspace, experiment_id, *, page_size=100):
    """Read every case via the engine's original offset/next_offset interface."""
    if type(page_size) is not int or page_size <= 0:
        raise ValueError("Use a positive experiment page size")
    experiment_id = identifier(experiment_id)
    offset, cases, seen, total, header = 0, [], set(), None, None
    while True:
        page = experiments.inspect(workspace, experiment_id, offset=offset, limit=page_size)
        if page["id"] != experiment_id or page["workspace_id"] != workspace.project["id"]:
            raise ValueError("Experiment page belongs to a different workspace")
        if page["offset"] != offset or type(page["total_cases"]) is not int:
            raise ValueError("Experiment pagination differs from the original contract")
        if total is None:
            total = page["total_cases"]
            header = {key: page[key] for key in ("id", "workspace_id", "title", "selection", "counts")}
        if page["total_cases"] != total or page["selection"] != header["selection"]:
            raise ValueError("Experiment plan changed during case discovery")
        rows = page["cases"]
        if not isinstance(rows, list) or len(rows) > page_size or offset + len(rows) > total:
            raise ValueError("Experiment returned an invalid case page")
        for row in rows:
            key = identifier(row["id"])
            if key in seen or row["ordinal"] != len(cases):
                raise ValueError("Experiment pages overlap or omit a case")
            seen.add(key)
            cases.append(row)
        next_offset = page["next_offset"]
        if next_offset is None:
            if len(cases) != total:
                raise ValueError("Experiment pagination ended before every case was read")
            break
        if type(next_offset) is not int or next_offset != offset + len(rows) or next_offset <= offset:
            raise ValueError("Experiment next_offset does not advance to the next case")
        offset = next_offset
    return {"schema": SNAPSHOT_SCHEMA, **header, "captured_at": now(),
            "total_cases": total, "cases": cases,
            "last_observed_experiment_state": page["state"],
            "capture_method": "Complete immutable case order; each retained case is read atomically."}


def _group_cases(source, selected):
    landcover = [row for row in source["cases"] if row["kind"] == "landcover"]
    for field, available in (
            ("profile_ids", {row["profile_id"] for row in landcover}),
            ("scenario_ids", {row["scenario_id"] for row in landcover})):
        missing = set(selected[field]) - available
        if missing:
            raise ValueError(field + " contains IDs outside this experiment: " + ", ".join(sorted(missing)))
    chosen = [row for row in landcover
              if (not selected["profile_ids"] or row["profile_id"] in selected["profile_ids"])
              and (not selected["scenario_ids"] or row["scenario_id"] in selected["scenario_ids"])]
    if not chosen:
        raise ValueError("Select an experiment containing land-cover alternatives")
    groups, baseline_by_profile = {}, {}
    for row in chosen:
        baseline = identifier(row["baseline_run_id"])
        profile = identifier(row["profile_id"])
        previous = baseline_by_profile.setdefault(profile, baseline)
        if previous != baseline:
            raise ValueError("One parameter profile has conflicting land-cover baselines")
        if row["state"] != "complete":
            continue
        if row["run_id"] == baseline or row["selection"]["profile_id"] != profile:
            raise ValueError("A completed land-cover case has inconsistent run identity")
        key = (profile, baseline)
        group = groups.setdefault(key, {"profile_id": profile,
            "profile_title": row["profile_title"], "baseline_run_id": baseline,
            "grid_id": row["selection"]["grid_id"], "cases": []})
        if row["selection"]["grid_id"] != group["grid_id"]:
            raise ValueError("A profile group contains different native grids")
        if any(item["run_id"] == row["run_id"] for item in group["cases"]):
            raise ValueError("An alternative native run occurs twice in one profile group")
        group["cases"].append(row)
    extra_deliveries = set(selected["delivery_ids_by_baseline"]) - set(baseline_by_profile.values())
    if extra_deliveries:
        raise ValueError("Priority deliveries must belong to selected experiment baselines")
    grids = {row["selection"]["grid_id"] for row in chosen}
    if len(grids) != 1:
        raise ValueError("Selected experiment cases must share the original reporting grid")
    ordered = []
    for key in sorted(groups):
        group = groups[key]
        group["cases"].sort(key=lambda row: (row["scenario_id"], row["run_id"]))
        group["id"] = digest({"profile_id": group["profile_id"],
            "baseline_run_id": group["baseline_run_id"],
            "case_ids": [row["id"] for row in group["cases"]]})
        ordered.append(group)
    return chosen, ordered, next(iter(grids))


def plan(workspace, selection, *, page_size=100):
    """Resolve all selected native cases without creating receptor products."""
    selected = _selection(selection)
    captured = snapshot(workspace, selected["experiment_id"], page_size=page_size)
    chosen, groups, grid_id = _group_cases(captured, selected)
    # Resolve the complete selected cohort before validating producing versions.
    # A profile group may have extra outputs; the shared cohort is kept explicit.
    native_runs = {}
    for group in groups:
        for run_id in [group["baseline_run_id"], *[case["run_id"] for case in group["cases"]]]:
            if run_id not in native_runs:
                native_runs[run_id] = workspace.inspect_run(run_id)
    execution = (receptor_execution.bind(list(native_runs.values()), grid_id=grid_id)
                 if native_runs else None)
    for group in groups:
        group["native_execution"] = receptor_execution.bind(
            [native_runs[key] for key in [group["baseline_run_id"],
                                         *[case["run_id"] for case in group["cases"]]]],
            grid_id=grid_id, pollutants=execution["pollutants"])
    # Retained products remain immutable as case progress or native sources change.
    identity = {"schema": SCHEMA, "workspace_id": workspace.project["id"],
                "product_version": receptor_execution.PRODUCT_VERSION,
                "selection": selected, "cases": chosen,
                "execution_signature": receptor_execution.signature(execution) if execution else None}
    key = digest(identity)
    return {"schema": SCHEMA, "id": key, "workspace_id": workspace.project["id"],
            "selection": selected, "grid_id": grid_id, "snapshot": captured,
            "identity": identity, "native_execution": execution,
            "chosen_cases": chosen, "groups": groups,
            "pending_cases": [row for row in chosen if row["state"] != "complete"]}


def _csv_value(value):
    if value is None:
        return ""
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def _write_csv(path, fields, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: _csv_value(row.get(key)) for key in fields})
    atomic_bytes(path, stream.getvalue().encode("utf-8"))


def _inventory_references(workspace, inventory):
    relative = Path("receptor-inventories") / identifier(inventory["id"])
    directory = workspace.root / relative
    items = dict(inventory["files"])
    for name in ("inventory", "result"):
        items[name] = describe_file(directory, directory / (name + ".json"))
    result = {}
    for name, item in items.items():
        verify_file(directory, item)
        result[name] = {**item, "path": (relative / item["path"]).as_posix()}
    return result


def _build_group(workspace, selected, group):
    baseline = workspace.inspect_run(group["baseline_run_id"])
    if baseline["state"] != "complete":
        raise ValueError("Selected profile baseline has not completed")
    if baseline["selection"]["profile_id"] != group["profile_id"]:
        raise ValueError("The group's baseline uses a different parameter profile")
    if baseline["selection"]["grid_id"] != group["grid_id"]:
        raise ValueError("The group's baseline uses a different native grid")
    baseline_scenario = workspace._get("scenarios", baseline["selection"]["scenario_id"])
    if baseline_scenario["kind"] != "baseline":
        raise ValueError("The profile baseline must use original land cover")
    for case in group["cases"]:
        run = workspace.inspect_run(case["run_id"])
        if (run["state"] != "complete" or run["selection"] != case["selection"]
                or run["selection"]["profile_id"] != group["profile_id"]):
            raise ValueError("The completed alternative differs from its experiment case")
    inventory_selection = {"baseline_run_id": group["baseline_run_id"],
        "scenario_run_ids": [row["run_id"] for row in group["cases"]],
        "receptor_spec": selected["receptor_spec"],
        "comparison_pollutants": group["native_execution"]["pollutants"]}
    delivery_id = selected["delivery_ids_by_baseline"].get(group["baseline_run_id"])
    if delivery_id:
        inventory_selection["delivery_id"] = delivery_id
    inventory = build_inventory(workspace, inventory_selection)
    if inventory["baseline_run_id"] != group["baseline_run_id"] or inventory["grid_id"] != group["grid_id"]:
        raise ValueError("Retained inventory differs from its profile group")
    if inventory.get("native_execution") != group["native_execution"]:
        raise ValueError("The producing native outputs changed after experiment comparison planning")
    references = _inventory_references(workspace, inventory)
    return {"id": group["id"], "state": "complete", "profile_id": group["profile_id"],
        "profile_title": group["profile_title"], "baseline_run_id": group["baseline_run_id"],
        "inventory_id": inventory["id"], "case_ids": [row["id"] for row in group["cases"]],
        "alternative_run_ids": [row["run_id"] for row in group["cases"]],
        "files": references, "areas": inventory["areas"],
        "pollutants": inventory.get("pollutants", sorted({row["pollutant"] for row in inventory["scenario_exports"]})),
        "run_pollutants": inventory.get("run_pollutants", {}),
        "native_execution": inventory["native_execution"],
        "execution_signature": inventory["execution_signature"],
        "scenario_exports": inventory["scenario_exports"]}


def _joined_rows(experiment_id, group, product):
    cases = {row["run_id"]: row for row in group["cases"]}
    rows, seen = [], set()
    for item in product["scenario_exports"]:
        case = cases.get(item["alternative_run_id"])
        if case is None or item["baseline_run_id"] != group["baseline_run_id"] or item["profile_changed"]:
            raise ValueError("Inventory row is not the selected within-profile land-cover comparison")
        identity = (item["receptor_id"], item["alternative_run_id"], item["pollutant"])
        if identity in seen:
            raise ValueError("Inventory contains a duplicate receiving-area quantity")
        seen.add(identity)
        basin = case["metrics"].get(item["pollutant"], {})
        if basin and basin["units"] != item["unit"]:
            raise ValueError("Basin and receiving-area physical units differ")
        selected_cells = item["selected_cells"]
        row = {**item, "experiment_id": experiment_id, "group_id": group["id"],
            "case_id": case["id"], "profile_id": group["profile_id"],
            "profile_title": group["profile_title"], "scenario_id": case["scenario_id"],
            "reduction": -item["alternative_minus_baseline"]
                         if item["alternative_minus_baseline"] is not None else None,
            "coverage_fraction": item["common_valid_cells"] / selected_cells if selected_cells else None,
            "basin_baseline_export": basin.get("baseline_total"),
            "basin_alternative_export": basin.get("alternative_total"),
            "basin_change": basin.get("delta"), "basin_change_percent": basin.get("relative_change_pct"),
            "basin_common_valid_cells": basin.get("paired_cells"),
            "basin_coverage_fraction": basin.get("coverage_fraction"),
            "basin_support_sha256": basin.get("support_sha256"),
            "inventory_id": product["inventory_id"],
            "inventory_report": product["files"]["report"]["path"]}
        rows.append(row)
    expected = {(area["id"], case["run_id"], pollutant)
                for area in product["areas"] for case in group["cases"]
                for pollutant in product.get("pollutants", sorted({row["pollutant"] for row in product["scenario_exports"]}))}
    if seen != expected:
        raise ValueError("Inventory omits a selected area, alternative or pollutant")
    return rows


def _ranges(rows):
    groups = {}
    for row in rows:
        key = (row["receptor_id"], row["scenario_id"], row["pollutant"], row["unit"],
               row.get("native_model"), row.get("native_version"))
        groups.setdefault(key, []).append(row)
    result = []
    for key in sorted(groups):
        selected = groups[key]
        changes = [row["alternative_minus_baseline"] for row in selected
                   if row["alternative_minus_baseline"] is not None
                   and math.isfinite(row["alternative_minus_baseline"])]
        coverage = [row["coverage_fraction"] for row in selected if row["coverage_fraction"] is not None]
        support = [row["basin_support_sha256"] for row in selected]
        result.append({**{name: selected[0][name] for name in
                          ("receptor_id", "receptor_title", "role", "scenario_id",
                           "scenario_title", "pollutant", "unit")},
            "native_model": selected[0].get("native_model"),
            "native_version": selected[0].get("native_version"),
            "evaluated_profiles": len(selected), "profiles_with_quantities": len(changes),
            "minimum_change": min(changes) if changes else None,
            "median_change": statistics.median(changes) if changes else None,
            "maximum_change": max(changes) if changes else None,
            "reduced_profiles": sum(value < 0 for value in changes),
            "unchanged_profiles": sum(value == 0 for value in changes),
            "increased_profiles": sum(value > 0 for value in changes),
            "minimum_coverage_fraction": min(coverage) if coverage else None,
            "maximum_coverage_fraction": max(coverage) if coverage else None,
            "same_basin_support": bool(support) and all(support) and len(set(support)) == 1})
    return result


def _report(path, result):
    def value(item):
        if item is None:
            return "—"
        return format(item, ",.6g") if isinstance(item, (float, int)) else str(item)

    def cells(values):
        return "".join("<td>" + escape(value(item)) + "</td>" for item in values)

    def options(field):
        choices = sorted({row[field] for row in result["rows"]})
        return '<option value="">All</option>' + "".join(
            '<option value="' + escape(item, quote=True) + '">' + escape(item) + "</option>" for item in choices)

    groups = ""
    for group in result["groups"]:
        if group["state"] == "complete":
            links = " · ".join(
                '<a href="../../' + escape(group["files"][key]["path"], quote=True) + '">' + label + "</a>"
                for key, label in (("report", "Maps and area report"), ("geopackage", "Editable GIS"),
                                   ("scenario_exports", "Profile quantities")))
            groups += "<tr>" + cells((group["profile_title"], len(group["case_ids"]), len(group["areas"]))) + "<td>" + links + "</td></tr>"
        else:
            groups += "<tr>" + cells((group["profile_title"], "Pending", "—", group["error"]["message"])) + "</tr>"
    detailed = ""
    for row in result["rows"]:
        attrs = " ".join('data-' + key + '="' + escape(row[field], quote=True) + '"' for key, field in
                         (("profile", "profile_title"), ("scenario", "scenario_title"), ("receptor", "receptor_title"), ("pollutant", "pollutant")))
        detailed += "<tr " + attrs + ">" + cells((
            row["profile_title"], row["receptor_title"], row["scenario_title"],
            row["pollutant"].replace("_", " "), row["native_model"].upper() + " " + row["native_version"],
            row["common_baseline_export"],
            row["common_alternative_export"], row["alternative_minus_baseline"],
            row["change_percent"], row["unit"], str(row["common_valid_cells"]) + " / " + str(row["selected_cells"]))) + "</tr>"
    ranges = "".join("<tr>" + cells((
        row["receptor_title"], row["scenario_title"], row["pollutant"].replace("_", " "),
        row["native_model"].upper() + " " + row["native_version"], row["minimum_change"], row["median_change"], row["maximum_change"], row["unit"],
        str(row["profiles_with_quantities"]) + " / " + str(row["evaluated_profiles"]),
        str(row["reduced_profiles"]) + " / " + str(row["unchanged_profiles"]) + " / " + str(row["increased_profiles"]),
        "Same" if row["same_basin_support"] else "Varies")) + "</tr>" for row in result["profile_ranges"])
    pending = "".join("<tr>" + cells((row["profile_title"], row["scenario_title"], row["state"])) + "</tr>"
                      for row in result["pending_cases"])
    filter_controls = "".join('<label>' + label + '<select data-filter="' + key + '">' + options(field) + "</select></label>"
                              for label, key, field in (("Profile", "profile", "profile_title"), ("Scenario", "scenario", "scenario_title"),
                                                        ("Receiving area", "receptor", "receptor_title"), ("Pollutant", "pollutant", "pollutant")))
    html = (
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>" + escape(result["title"]) + "</title><style>"
        "body{font:15px system-ui,sans-serif;color:#222;background:#fff;max-width:1440px;margin:28px auto;padding:0 24px}"
        "h1{font-size:27px}h2{font-size:20px;margin-top:30px}p{line-height:1.5}a{color:inherit}"
        "table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;margin:12px 0}"
        "th,td{text-align:left;border:1px solid #bbb;padding:8px;vertical-align:top}th{background:#eee}"
        "section{overflow-x:auto}code{overflow-wrap:anywhere}.filters{display:flex;gap:16px;flex-wrap:wrap}"
        "label{display:grid;gap:4px}select{font:inherit;background:white;color:#222;border:1px solid #888;padding:6px;max-width:340px}"
        "footer{border-top:1px solid #999;padding-top:16px;margin-top:32px}tr[hidden]{display:none}"
        "@media print{body{margin:8mm;font-size:9pt;padding:0;max-width:none}.filters{display:none}th,td{padding:5px}tr{break-inside:avoid}a{word-break:break-word}}</style><body>"
        "<h1>" + escape(result["title"]) + "</h1><p>"
        + str(result["counts"]["complete_groups"]) + " completed profile groups · "
        + str(result["counts"]["export_rows"]) + " receiving-area comparisons · "
        + str(len(result["pending_cases"])) + " native cases still progressing.</p>"
        "<p>Each land-cover alternative is compared with the original land cover under its own parameter profile. "
        "Positive change means higher annual export. Change and percentage use the same finite valid pixels in each pair.</p>"
        '<p><a href="scenario-exports.csv">Complete joined quantities</a> · <a href="profile-ranges.csv">Profile ranges</a> · '
        '<a href="cases.csv">All selected cases</a> · <a href="result.json">Saved comparison</a></p>'
        "<section><h2>Profile products</h2><table><thead><tr><th>Profile</th><th>Alternatives</th><th>Areas</th><th>Open retained product</th></tr></thead><tbody>"
        + groups + "</tbody></table></section>"
        "<section><h2>Range across evaluated profiles</h2><p>These ranges describe the explicitly evaluated profile choices. "
        "The footprint column compares the original whole-basin valid-pixel signatures; per-area coverage is retained with each detailed comparison. "
        "Each receiving area is evaluated independently because upstream areas can overlap.</p>"
        "<table><thead><tr><th>Area</th><th>Scenario</th><th>Pollutant</th><th>Native version</th><th>Minimum change</th><th>Median change</th><th>Maximum change</th><th>Unit</th>"
        "<th>Profiles with quantities / evaluated</th><th>Lower / unchanged / higher</th><th>Native pair footprint</th></tr></thead><tbody>" + ranges + "</tbody></table></section>"
        + receptor_execution.report_section(result.get("native_execution"))
        + "<h2>Receiving-area comparisons</h2><div class=\"filters\">" + filter_controls + '</div><p id="visible-count"></p><section>'
        '<table id="comparisons"><thead><tr><th>Profile</th><th>Receiving area</th><th>Scenario</th><th>Pollutant</th><th>Native version</th><th>Baseline</th>'
        "<th>Alternative</th><th>Change</th><th>Change, %</th><th>Unit</th><th>Compared / selected pixels</th></tr></thead><tbody>"
        + detailed + "</tbody></table></section>"
        + ("<section><h2>Native cases progressing</h2><table><thead><tr><th>Profile</th><th>Scenario</th><th>State</th></tr></thead><tbody>" + pending + "</tbody></table></section>" if pending else "")
        + "<footer><p>Experiment: <code>" + escape(result["experiment_id"]) + "</code><br>Comparison: <code>" + escape(result["id"]) + "</code>"
        "<br>Saved: " + escape(result["created_at"]) + "</p><p>Quantity basis: annual land-origin nutrient and sediment export from upstream-connected land inside the reporting basin. "
        "Blank quantities indicate absent common valid pixels; blank percentages include zero baselines. "
        "The workspace archive carries this report, its profile products and original case records together.</p></footer>"
        '<script>const controls=[...document.querySelectorAll("[data-filter]")];'
        'const rows=[...document.querySelectorAll("#comparisons tbody tr")];'
        'function apply(){let count=0;for(const row of rows){row.hidden=controls.some(c=>c.value&&row.dataset[c.dataset.filter]!==c.value);if(!row.hidden)count++;}'
        'document.getElementById("visible-count").textContent=count+" comparisons shown";}'
        'for(const control of controls)control.addEventListener("change",apply);apply();</script></body></html>\n'
    )
    atomic_bytes(path, html.encode("utf-8"))


def _verify_group(workspace, group):
    for item in group["files"].values():
        verify_file(workspace.root, item)


def build(workspace, selection, *, page_size=100):
    """Build all completed profile groups and retain progress after each one."""
    proposed = plan(workspace, selection, page_size=page_size)
    selected, key = proposed["selection"], proposed["id"]
    directory = workspace.root / "receptor-experiments" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".batch.lock", blocking=False):
        saved_path = directory / "result.json"
        if saved_path.exists():
            previous = read_json(saved_path)
            if previous["id"] != key or previous["workspace_id"] != workspace.project["id"]:
                raise ValueError("Saved receptor comparison belongs to another selection")
            if previous.get("native_execution") != proposed["native_execution"]:
                raise ValueError("Saved comparison differs from its producing native outputs")
            if previous["state"] == "complete":
                for item in previous["files"].values():
                    verify_file(directory, item)
                for group in previous["groups"]:
                    _verify_group(workspace, group)
                return {**previous, "reused": True}
        captured = proposed["snapshot"]
        atomic_json(directory / "snapshot.json", captured)
        pending_path = directory / "progress.json"
        previous_groups = {}
        if pending_path.exists():
            progress = read_json(pending_path)
            if progress["id"] != key:
                raise ValueError("Retained group progress belongs to another comparison")
            previous_groups = {group["id"]: group for group in progress["groups"] if group["state"] == "complete"}
        products, rows = [], []
        for group in proposed["groups"]:
            try:
                product = previous_groups.get(group["id"])
                if product is None:
                    product = _build_group(workspace, selected, group)
                else:
                    _verify_group(workspace, product)
                joined = _joined_rows(selected["experiment_id"], group, product)
                rows.extend(joined)
                products.append(product)
            except Exception as exc:
                products.append({"id": group["id"], "profile_id": group["profile_id"],
                    "profile_title": group["profile_title"], "baseline_run_id": group["baseline_run_id"],
                    "state": "failed", "case_ids": [row["id"] for row in group["cases"]],
                    "error": {"type": type(exc).__name__, "message": str(exc)}})
            atomic_json(pending_path, {"id": key, "updated_at": now(), "groups": products})
        rows.sort(key=lambda row: (row["receptor_title"], row["scenario_title"], row["pollutant"], row["profile_id"]))
        complete = sum(group["state"] == "complete" for group in products)
        failed = len(products) - complete
        unfinished = proposed["pending_cases"]
        state = ("failed" if failed and not complete else "partial" if failed or unfinished
                 else "complete")
        if not products:
            state = "awaiting_completed_cases"
        result = {"schema": SCHEMA, "id": key, "workspace_id": workspace.project["id"],
            "experiment_id": selected["experiment_id"], "grid_id": proposed["grid_id"],
            "title": selected["title"], "created_at": now(), "state": state,
            "selection": selected, "snapshot_sha256": describe_file(directory, directory / "snapshot.json")["sha256"],
            "identity": proposed["identity"], "native_execution": proposed["native_execution"],
            "product_version": receptor_execution.PRODUCT_VERSION,
            "groups": products, "rows": rows, "profile_ranges": _ranges(rows),
            "pending_cases": [{name: row[name] for name in ("id", "profile_id", "profile_title", "scenario_id", "scenario_title", "state")}
                              for row in unfinished],
            "counts": {"selected_cases": len(proposed["chosen_cases"]), "complete_cases": len(proposed["chosen_cases"]) - len(unfinished),
                       "complete_groups": complete, "failed_groups": failed, "export_rows": len(rows)},
            "interpretation": {"grouping": "Each profile retains its own original-land-cover baseline.",
                "change": "Alternative minus baseline on the common valid receiving-area pixels.",
                "ranges": "Range across the selected evaluated profiles; each pair's coverage is retained.",
                "shared_areas": "Receiving areas can overlap; their totals are evaluated independently.",
                "resuming": "Repeat this selection after further native cases complete; unchanged inventories are reused."},
            "files": {}}
        _write_csv(directory / "cases.csv",
                   ("id", "ordinal", "kind", "state", "profile_id", "profile_title", "baseline_run_id", "run_id", "scenario_id", "scenario_title"),
                   proposed["chosen_cases"])
        _write_csv(directory / "scenario-exports.csv", EXPORT_FIELDS, rows)
        _write_csv(directory / "profile-ranges.csv", RANGE_FIELDS, result["profile_ranges"])
        atomic_json(directory / "groups.json", products)
        atomic_json(directory / "native-execution.json", proposed["native_execution"])
        _report(directory / "index.html", result)
        for name, filename in (("snapshot", "snapshot.json"), ("cases", "cases.csv"),
                               ("groups", "groups.json"), ("scenario_exports", "scenario-exports.csv"),
                               ("profile_ranges", "profile-ranges.csv"), ("report", "index.html"),
                               ("native_execution", "native-execution.json")):
            result["files"][name] = describe_file(directory, directory / filename)
        atomic_json(saved_path, result)
        return result


def inspect(workspace, comparison_id):
    directory = workspace.root / "receptor-experiments" / identifier(comparison_id)
    result = read_json(directory / "result.json")
    if result["schema"] != SCHEMA or result["id"] != comparison_id or result["workspace_id"] != workspace.project["id"]:
        raise ValueError("Select an original receptor experiment comparison")
    if result.get("identity") is not None and digest(result["identity"]) != comparison_id:
        raise ValueError("The retained receptor comparison identity changed")
    for item in result["files"].values():
        verify_file(directory, item)
    for group in result["groups"]:
        if group["state"] == "complete":
            _verify_group(workspace, group)
    return {**result, "files": {**result["files"],
                               "result": describe_file(directory, directory / "result.json")}}
