"""Native combination analysis in the existing Upper Savannah operator."""
from __future__ import annotations
import csv
import html
import io
import json
import math
from model import native_interactions
from copy import deepcopy
from model.common import identifier, read_json, relative_file, describe_file

ACTIONS = {"interaction.plan", "interaction.apply", "interaction.analyze"}


def one(payload, name, default=None):
    value = payload.get(name, default)
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError("Choose one " + name)
        return value[0]
    return value


def selection(payload):
    value = payload.get("selection")
    if not isinstance(value, dict):
        raise ValueError("Choose the retained baseline and ordered conservation actions")
    return value


def invoke(operator, task):
    workspace = operator.ws(task["workspace"])
    payload = task["payload"]
    action = task["action"]
    if action == "interaction.plan":
        return native_interactions.save_plan(workspace, selection(payload))
    plan_id = identifier(payload.get("plan_id"))
    if action == "interaction.apply":
        execute = payload.get("run_models", False)
        if type(execute) is not bool:
            raise ValueError("Choose whether to execute the retained native cases")
        workers = payload.get("workers", 1)
        if type(workers) is not int or workers < 1:
            raise ValueError("Choose a positive whole number of parallel native runs")
        state = native_interactions.apply_plan(workspace, plan_id, run_models=execute, workers=workers)
        if state.get("state") in {"failed", "interrupted"}:
            errors = state.get("errors", [])
            detail = errors[0].get("message", "Open the retained study for details") if errors else "Open the retained study for details"
            raise RuntimeError(str(len(errors)) + " native case error(s): " + str(detail))
        return state
    if action == "interaction.analyze":
        return native_interactions.analyze_plan(workspace, plan_id)
    raise ValueError("Choose a registered native combination action")


def native_version_rows(result):
    """Expose only the version provenance saved with this exact result."""
    cohort = result.get("native_versions")
    if not isinstance(cohort, dict):
        return []
    models, runs = cohort.get("models"), cohort.get("runs")
    if not isinstance(models, list) or not isinstance(runs, dict):
        return []
    coalitions = {}
    for record in result.get("runs", []):
        coalitions.setdefault(record.get("run_id"), []).append(record.get("key"))
    rows = []
    for run_id, versions in runs.items():
        if not isinstance(versions, dict):
            continue
        for model in models:
            provenance = versions.get(model)
            if not isinstance(provenance, dict):
                continue
            reused = provenance.get("reused_from")
            reused = reused if isinstance(reused, dict) else {}
            rows.append({
                "run_id": run_id, "native_model": model,
                "coalition_keys": coalitions.get(run_id, []),
                "comparison_version": provenance.get("comparison_version"),
                "version_basis": provenance.get("basis"),
                "observed_stage_version": provenance.get("observed_stage_version"),
                "observed_run_version": provenance.get("observed_run_version"),
                "requested_version": provenance.get("requested_version"),
                "differs_from_requested": provenance.get("differs_from_requested"),
                "stage_completed_at": provenance.get("stage_completed_at"),
                "reused_from_run_id": reused.get("run_id"),
                "reused_from_model": reused.get("model"),
                "reused_from": provenance.get("reused_from"),
            })
    return rows


def report(result):
    sections = (
        ("Combination totals", "summaries"),
        ("Action attribution", "action_attribution"),
        ("Pair interactions", "pair_interactions"),
        ("Native coalition outcomes", "coalition_outcomes"),
    )
    version_rows = native_version_rows(result)
    section_rows = [(title, result.get(member, [])) for title, member in sections]
    if version_rows:
        section_rows.append(("Executed model provenance", version_rows))
    fields = sorted({key for _, rows in section_rows for row in rows for key in row})
    preferred = ["scope_id", "zone_id", "metric", "units", "action_id",
                 "coalition_key", "common_valid_cells", "common_area_ha"]
    fields = [key for key in preferred if key in fields] + [key for key in fields if key not in preferred]
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["section"] + fields)

    def plain(value):
        return json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (dict, list)) else value

    def csv_value(value):
        value = plain(value)
        if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
            return "'" + value
        return value

    def number(value):
        if type(value) not in (int, float) or not math.isfinite(value):
            return "Unavailable"
        return format(value, ".8g")

    esc = lambda value: html.escape(str(plain(value) if value is not None else "—"), quote=True)

    def table(headers, rows):
        return ("<div class='table-scroll'><table><thead><tr>"
                + "".join("<th>" + esc(value) + "</th>" for value in headers)
                + "</tr></thead><tbody>"
                + "".join("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in row) + "</tr>"
                          for row in rows)
                + "</tbody></table></div>")

    titles = {"nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
              "sediment_export": "Sediment", "n_export": "Nitrogen",
              "p_export": "Phosphorus", "sed_export": "Sediment"}
    summaries = result.get("summaries", [])
    documents = []
    for summary in summaries:
        area = "Zone " + str(summary["zone_id"]) if summary.get("zone_id") is not None else "Whole reporting area"
        metric = titles.get(summary["metric"], summary["metric"].replace("_", " "))
        units = summary.get("units", "").replace("metric_tonnes", "metric tonnes")
        supported = summary.get("common_valid_cells", 0) > 0 and summary.get("common_area_ha", 0) > 0
        benefit, baseline = summary.get("combined_benefit"), summary.get("baseline_annual_export")
        percentage = (100 * benefit / baseline
                      if supported and type(benefit) in (int, float) and type(baseline) in (int, float)
                      and math.isfinite(benefit) and math.isfinite(baseline) and baseline > 0 else None)
        filtered = lambda member: [row for row in result.get(member, [])
                                   if (row.get("scope_id"), row.get("zone_id"), row.get("metric"))
                                   == (summary.get("scope_id"), summary.get("zone_id"), summary.get("metric"))]
        actions, pairs = filtered("action_attribution"), filtered("pair_interactions")
        names = {row["action_id"]: row.get("action_title") or row["action_id"] for row in actions}
        overview = [
            ("Baseline annual export", number(baseline) + " " + units if supported else "Unavailable"),
            ("Combined annual export", number(summary.get("combined_annual_export")) + " " + units if supported else "Unavailable"),
            ("Annual reduction", number(benefit) + " " + units if supported else "Unavailable"),
            ("Reduction relative to baseline", number(percentage) + "%" if percentage is not None else "Unavailable"),
            ("Shared reporting area", number(summary.get("common_area_ha")) + " ha"),
            ("Common finite cells", summary.get("common_valid_cells", 0)),
        ]
        documents.append("<section><h2>" + esc(area + " — " + metric) + "</h2>" + table(["Measure", "Value"], overview))
        if not supported:
            documents.append("<p>No finite cells are shared by every modeled combination and selected pollutant in this reporting area.</p>")
        elif type(benefit) in (int, float) and math.isfinite(benefit):
            direction = "reduce" if benefit > 0 else "increase" if benefit < 0 else "leave unchanged"
            documents.append("<p>The combined actions " + direction + " modeled annual export"
                             + (" by " + esc(number(abs(benefit)) + " " + units) if benefit else "")
                             + " relative to the baseline.</p>")
        sampled = result.get("estimator") == "permutation" or any(row.get("allocation_method") == "sampled_permutation_shapley" for row in actions)
        headers = ["Conservation action", "Action alone (" + units + ")", "Allocated reduction (" + units + ")"]
        if sampled:
            headers.append("Sampling standard error (" + units + ")")
        documents.append("<h3>Contributions of the actions</h3><p>Allocated reductions account for each action alongside the others. Negative values represent increased export.</p>"
                         + table(headers, [[names[row["action_id"]], number(row.get("standalone_benefit")),
                                            number(row.get("shapley_benefit"))]
                                           + ([number(row.get("permutation_sampling_standard_error"))] if sampled else [])
                                           for row in actions]))
        documents.append("<p>" + ("The standard error describes sampled attribution paths; it does not represent model or field-measurement uncertainty."
                                 if sampled else "Exact attribution uses every combination of the selected actions.") + "</p>")
        if pairs:
            documents.append("<h3>Interactions between pairs</h3><p>Additional reduction compares the pair with the sum of its standalone reductions.</p>"
                             + table(["First action", "Second action", "Pair reduction (" + units + ")", "Additional reduction (" + units + ")"],
                                     [[names.get(row["action_a"], row["action_a"]), names.get(row["action_b"], row["action_b"]),
                                       number(row.get("pair_benefit")), number(row.get("pair_nonadditivity"))] for row in pairs]))
        documents.append("<details><summary>Allocation and interaction balance</summary>"
                         + table(["Measure", units], [
                             ["Sum of standalone reductions", number(summary.get("sum_standalone_benefit"))],
                             ["Additional combined reduction", number(summary.get("combined_nonadditivity"))],
                             ["Sum of pair interactions", number(summary.get("sum_pair_nonadditivity"))],
                             ["Remainder beyond pair interactions", number(summary.get("higher_order_remainder"))],
                             ["Sum allocated to actions", number(summary.get("sum_allocated_benefit"))],
                             ["Allocation residual", number(summary.get("allocation_efficiency_residual"))],
                         ]) + "</details></section>")
    if not summaries:
        documents.append("<p>This retained result has no reporting-area summaries.</p>")
    source_tables = []
    for title, rows in section_rows:
        for row in rows:
            writer.writerow([title] + [csv_value(row.get(key)) for key in fields])
        columns = [key for key in fields if any(key in row for row in rows)]
        source_tables.append("<details><summary>" + esc(title) + " — complete source table (" + str(len(rows)) + " rows)</summary>"
                             + table([key.replace("_", " ") for key in columns],
                                     [[plain(row.get(key)) for key in columns] for row in rows]) + "</details>")
    cohort = result.get("native_versions") or {}
    version_document = "<section><h2>Executed model versions</h2>"
    if version_rows:
        basis_labels = {
            "completed_stage_runtime": "Completed native stage",
            "observed_run_fallback": "Observed run metadata",
            "requested_legacy": "Requested version (legacy)",
            "unavailable": "Unavailable",
        }
        versions = cohort.get("versions") or {}
        version_document += (
            "<p>Each selected model uses a consistent comparison version across the retained combinations. "
            "Different selected models can have different versions. The source column identifies how each "
            "run's version was recorded.</p>"
            + table(["Native model", "Comparison version"],
                    [[str(model).upper(), versions.get(model)] for model in cohort.get("models", [])])
            + "<p>Completed-stage records describe the executed stage, including a reused stage's origin. "
              "Observed-run fallback uses the retained run metadata. A requested legacy version is the "
              "saved request and is labeled separately from observed execution.</p>"
            + table(["Run", "Model", "Comparison version", "Version source", "Requested version",
                     "Stage completed", "Reused stage origin"],
                    [[row["run_id"], str(row["native_model"]).upper(), row["comparison_version"],
                      basis_labels.get(row["version_basis"], row["version_basis"] or "Not recorded"),
                      row["requested_version"], row["stage_completed_at"],
                      ((str(row["reused_from_run_id"]) + " / " + str(row["reused_from_model"] or row["native_model"]))
                       if row["reused_from_run_id"] else "")]
                     for row in version_rows])
            + "<p>The complete source table and JSON retain observed stage/run versions, requested-version "
              "differences and the original nested stage-reuse record.</p>")
    else:
        version_document += (
            "<p>No per-model execution provenance was recorded in this saved result. "
            "Its original run identities and native output records remain in the retained selection.</p>")
    version_document += "</section>"
    title = result.get("title") or "Native combination analysis"
    metadata = {key: value for key, value in result.items()
                if key not in {member for _, member in sections}}
    document = (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'><title>" + esc(title)
        + "</title><style>body{font:14px system-ui;color:#171717;background:white;margin:28px;max-width:1100px}"
          "h1{font-size:24px}h2{font-size:19px;margin-top:28px}h3{font-size:16px;margin-top:22px}"
          ".table-scroll{overflow:auto}table{border-collapse:collapse;font-size:12px;width:100%;margin:12px 0}"
          "th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}"
          "th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:16px 0}"
          "summary{cursor:pointer;font-weight:600}section{border-top:1px solid #bbb;margin-top:24px}"
          "@media print{body{margin:0;max-width:none}tr{break-inside:avoid}.table-scroll{overflow:visible}h2,h3{break-after:avoid}}</style></head><body><h1>" + esc(title)
        + "</h1><p>Benefits are reductions in modeled annual export on the finite reporting area shared by every combination and selected pollutant. "
          "Nitrogen and phosphorus remain kg/year; sediment remains metric tonnes/year.</p>"
        + "<p>Saved action order: " + esc(" → ".join(result.get("application_order", [])))
        + ". Each modeled combination applies its selected actions in this order.</p>"
        + "".join(documents) + version_document + "<h2>Complete scientific tables</h2>" + "".join(source_tables)
        + "<details><summary>Retained selection and method</summary><pre>"
        + esc(json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2))
        + "</pre></details></body></html>")
    return {"json": result, "csv": stream.getvalue(), "html": document}


def result_downloads(operator, workspace_key, result):
    workspace = operator.ws(workspace_key)
    directory = workspace.root / native_interactions.RESULT_KIND / result["id"]
    downloads = []
    for name, item in result.get("artifacts", {}).items():
        path = relative_file(directory, item["path"])
        ticket = operator._ticket(workspace_key, path, item, name.replace("_", " "))
        ticket["artifact_id"] = name
        downloads.append(ticket)
    path = directory / "result.json"
    ticket = operator._ticket(workspace_key, path, describe_file(directory, path), "Retained combination result")
    ticket["artifact_id"] = "retained_result"
    downloads.append(ticket)
    return downloads


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "preview":
        return native_interactions.preview(workspace, selection(payload))
    if operation == "plan":
        return native_interactions.get_plan(workspace, identifier(one(payload, "id")))
    if operation == "result":
        result = native_interactions.get_result(workspace, identifier(one(payload, "id")), verify=False)
        value = deepcopy(result)
        value["_downloads"] = result_downloads(operator, workspace_key, result)
        return value
    if operation == "report":
        return report(native_interactions.get_result(workspace, identifier(one(payload, "id")), verify=False))
    if operation != "catalog":
        raise ValueError("Choose a native combination catalogue, plan or result")
    offset = int(one(payload, "offset", 0))
    limit = int(one(payload, "limit", 100))
    if offset < 0 or not 1 <= limit <= 200:
        raise ValueError("Choose a valid page of retained native runs")
    profiles = {row["id"]: row["title"] for row in workspace._list("profiles")}
    scenarios = workspace._list("scenarios")
    scenario_titles = {row["id"]: row["title"] for row in scenarios}
    runs = []
    for path in sorted((workspace.root / "runs").glob("*/run.json")):
        run = read_json(path)
        selected = run["selection"]
        runs.append({"id": run["id"], "state": run["state"], "selection": selected,
                     "profile_title": profiles.get(selected["profile_id"], selected["profile_id"]),
                     "scenario_title": scenario_titles.get(selected["scenario_id"], selected["scenario_id"])})
    actions = [{"id": row["id"], "title": row["title"], "kind": row["kind"],
                "source_collection_id": row["source_collection_id"],
                "patch_count": len(row.get("patches", [])),
                "patches": deepcopy(row.get("patches", []))}
               for row in scenarios if row.get("patches")]
    zones = [{"collection_id": collection["id"], "collection_title": collection["title"],
              "source_id": entry["id"], "title": entry.get("title", entry["id"]),
              "layer": entry.get("layer")}
             for collection in workspace.sources() for entry in collection["entries"]
             if entry.get("kind") == "vector"]
    return {"runs": runs[offset:offset + limit], "offset": offset, "total": len(runs),
            "next_offset": offset + limit if offset + limit < len(runs) else None,
            "actions": actions, "zones": zones, "plans": native_interactions.list_plans(workspace)}


def updates(workspace):
    return {"plans": native_interactions.list_plans(workspace)}


def decorate_task(operator, task):
    if task.get("action") in {"interaction.apply", "interaction.analyze"} and task.get("state") == "complete":
        result_id = task.get("result", {}).get("result_id")
        if result_id:
            result = native_interactions.get_result(operator.ws(task["workspace"]), result_id, verify=False)
            task["_downloads"] = result_downloads(operator, task["workspace"], result)
    return task


def verify_workspace(workspace):
    rows = native_interactions.list_plans(workspace)
    result_ids = set()
    for row in rows:
        plan = native_interactions.get_plan(workspace, row["id"])
        state = plan.get("state") or {}
        for result_id in [state.get("result_id"), state.get("last_result_id"), *state.get("result_history", [])]:
            if result_id:
                result_ids.add(result_id)
    for result_id in sorted(result_ids):
        native_interactions.get_result(workspace, result_id)
    return {"native_combination_plans": len(rows), "native_combination_results": len(result_ids)}
