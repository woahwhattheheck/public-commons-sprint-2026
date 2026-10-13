"""A completed source update as an original Scientific Reports source.

The immutable capture describes actual source selections, completed model stages
and retained comparisons. Mutable apply history remains a separate attachment.
The existing composer, customer review and Study writers consume this source.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

from . import observed_context, source_refresh
from .common import atomic_json, describe_file, digest, file_digest, held, identifier, now, read_json, verify_file
from .native_versions import model_versions, validate_run_comparison
from .source_refresh_receiving import _Receiving

SCHEMA = "upstate.source-refresh-report-source/v1"
EDITION = "saved-source-refresh-report/1"
DIRECTORY = "source-refresh-report-sources"
SOURCE_KIND = "saved_source_refresh"
SNAPSHOT_SCHEMA = "upstate.source-refresh-scientific-snapshot/v1"


def _text(value, name, limit, *, required=True):
    if value is None and not required:
        return ""
    if not isinstance(value, str) or "\0" in value or len(value) > limit:
        raise ValueError(name + " must be plain text of at most " + str(limit) + " characters")
    value = value.strip()
    if required and not value:
        raise ValueError("Supply " + name)
    return value


def _spec(value):
    if not isinstance(value, dict) or set(value) - {"plan_id", "title", "rationale", "notes"}:
        raise ValueError("Choose a completed source-update plan, title, rationale and optional notes")
    notes = value.get("notes", [])
    if not isinstance(notes, list):
        raise ValueError("Report notes must be a list of text")
    return {"plan_id": identifier(value.get("plan_id")),
            "title": _text(value.get("title"), "report source title", 300),
            "rationale": _text(value.get("rationale"), "scientific update rationale", 20000),
            "notes": [_text(item, "report note", 20000) for item in notes]}


def native_snapshot(kind, value):
    """Only retained scientific fields participate in the report identity."""
    if kind != "runs":
        return deepcopy(value)
    result = {key: deepcopy(value.get(key)) for key in
              ("id", "selection", "state", "completed_at", "runtime", "artifacts")}
    result["stages"] = {}
    for model, stage in sorted((value.get("stages") or {}).items()):
        if model not in ("ndr", "sdr"):
            continue
        result["stages"][model] = {
            key: deepcopy(stage.get(key)) for key in
            ("completed_at", "input_signature", "runtime", "reused_from", "artifacts")}
    if value.get("state") == "complete":
        result["native_versions"] = model_versions(value)
    return result


def _scientific_snapshot(workspace, plan_id):
    raw = source_refresh.validate_plan(workspace, plan_id)
    view = source_refresh.get_plan(workspace, plan_id)
    state = view.get("state") or {}
    if state.get("state") != "complete":
        raise ValueError("Finish this source update, including its selected native runs, before preparing a report source")
    receiver = _Receiving(workspace)
    if view["engine"] == "roots":
        receiver.roots(raw)
        from_id, to_id = raw["from_collection_id"], raw["to_collection_id"]
        changes = deepcopy(raw["changes"])
        wanted = {kind: [] for kind in ("profiles", "scenarios", "grids", "runs")}
        for node in raw["nodes"]:
            wanted[node["kind"]].append(node["old_id"])
    else:
        receiver.edition(raw)
        from_id = raw["selection"]["from_collection_id"]
        to_id = raw["selection"]["to_collection_id"]
        changes = deepcopy(raw["preview"]["changes"])
        wanted = {kind: [row["id"] for row in rows]
                  for kind, rows in raw["preview"]["affected"].items()}
    mappings = deepcopy(state.get("mappings") or {})
    run_rows = []
    for kind, originals in sorted(wanted.items()):
        for old_id in sorted(originals):
            new_id = (mappings.get(kind) or {}).get(old_id)
            if not new_id:
                raise ValueError("The completed update has no retained successor for " + kind + "/" + old_id)
            original = receiver.native(kind, old_id)
            target = receiver.native(kind, identifier(new_id))
            if kind == "runs":
                if target.get("state") != "complete":
                    raise ValueError("Finish the actual refreshed native run " + new_id)
                run_rows.append({"from_run_id": old_id, "to_run_id": new_id,
                                 "original_state": original.get("state"),
                                 "state": target["state"]})
    for key in (from_id, to_id):
        receiver.collection(key)
    comparisons = {}
    comparison_results = []
    for row in (state.get("comparison_results") or {}).values():
        selected = {key: deepcopy(row[key]) for key in
                    ("from_run_id", "to_run_id", "state", "reason", "comparison_id") if key in row}
        comparison_results.append(selected)
    for row in state.get("comparisons", []):
        key = identifier(row["comparison_id"])
        path = workspace.root / "comparisons" / key / "comparison.json"
        value = read_json(path)
        validate_run_comparison(workspace, value, expected_id=key)
        allowed = {(row["from_run_id"], row["to_run_id"]) for row in run_rows}
        alternatives = value.get("alternatives") or []
        if (len(alternatives) != 1 or
                (value.get("baseline_run_id"), alternatives[0].get("run_id")) not in allowed):
            raise ValueError("The retained comparison is outside this source-update run mapping")
        for alternative in alternatives:
            receiver.files(path.parent, alternative.get("artifacts", {}).values())
        comparisons[key] = value
    reported = {(row.get("from_run_id"), row.get("to_run_id")) for row in comparison_results}
    for row in run_rows:
        pair = (row["from_run_id"], row["to_run_id"])
        if pair not in reported:
            comparison_results.append({**row, "state": "unavailable",
                "reason": "This original plan has no retained comparison for this run pair"})
    snapshot = {
        "schema": SNAPSHOT_SCHEMA, "project_id": workspace.project["id"],
        "plan_id": plan_id, "engine": view["engine"], "format": view["format"],
        "plan": deepcopy(raw), "from_collection_id": from_id, "to_collection_id": to_id,
        "changes": changes, "mappings": mappings, "run_results": run_rows,
        "comparison_results": sorted(comparison_results,
            key=lambda row: (row.get("from_run_id", ""), row.get("to_run_id", ""))),
        "comparisons": {key: deepcopy(comparisons[key]) for key in sorted(comparisons)},
        "sources": {key: deepcopy(value) for key, value in sorted(receiver.source_cache.items())},
        "native": {kind: {key: native_snapshot(kind, value)
                         for (item_kind, key), value in sorted(receiver.native_cache.items())
                         if item_kind == kind}
                   for kind in ("profiles", "scenarios", "grids", "runs")},
    }
    # The facade's roots view is intentionally distinct from its original journal.
    raw_state = (source_refresh.SourceRefresh(workspace).state(plan_id)
                 if view["engine"] == "roots" else deepcopy(state))
    return snapshot, {"engine": view["engine"], "format": view["format"],
                      "plan_id": plan_id, "captured_checkpoint": raw_state}


def _cell(value):
    if value is None:
        return "Not available"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return str(value)


def _table(columns, rows):
    return {"kind": "table", "columns": columns,
            "rows": [[_cell(cell) for cell in row] for row in rows]}


def _sections(spec, snapshot):
    old = snapshot["sources"][snapshot["from_collection_id"]]
    new = snapshot["sources"][snapshot["to_collection_id"]]
    sections = [["Source update and scientific purpose", [
        spec["rationale"],
        _table(["Retained selection", "Value"], [
            ["Plan", snapshot["plan_id"]], ["Plan engine", snapshot["engine"]],
            ["Previous source edition", old.get("title") or old["id"]],
            ["Previous collection ID", old["id"]],
            ["Replacement source edition", new.get("title") or new["id"]],
            ["Replacement collection ID", new["id"]],
            ["Completed successor runs", len(snapshot["run_results"])],
        ]),
        "The source update preserves the original scientific selections. Each successor run below "
        "was read from its actual saved native result. Reuse describes completed model stages; "
        "an input-change assessment alone does not establish native completion.",
    ]]]
    if spec["notes"]:
        sections.append(["Preparation notes", list(spec["notes"])])
    changes = []
    for row in snapshot["changes"]:
        changes.append([
            row.get("from_source_id", row.get("source_id")),
            row.get("to_source_id", row.get("replacement_id")),
            row.get("status", row.get("change")),
            row.get("reasons", row.get("reason")),
            row.get("requires_native_rerun")])
    sections.append(["Original and replacement sources", [
        _table(["Previous source ID", "Replacement source ID", "Change", "Reason", "Physical input impact"],
               changes),
        "Source identifiers, original metadata, complete body and companion hashes are retained in "
        "scientific-snapshot.json. The editable Study follows the original source collections and "
        "their full retained objects; document metadata does not substitute for original input bytes.",
    ]])
    mappings = [[kind, old_id, new_id] for kind, rows in sorted(snapshot["mappings"].items())
                for old_id, new_id in sorted(rows.items())]
    sections.append(["Saved scientific selections", [
        _table(["Kind", "Original ID", "Successor ID"], mappings),
        "Each new profile retains its own scientific review history. This source does not inherit "
        "approval from a predecessor profile.",
    ]])
    stage_rows, output_rows = [], []
    for ordinal, mapping in enumerate(snapshot["run_results"], 1):
        run = snapshot["native"]["runs"][mapping["to_run_id"]]
        scenario = snapshot["native"]["scenarios"].get(run["selection"]["scenario_id"], {})
        case_label = "Case " + str(ordinal) + ": " + str(scenario.get("title") or "Saved scenario")
        for model, info in sorted(run.get("native_versions", {}).items()):
            stage = run["stages"].get(model, {})
            reused = stage.get("reused_from") or {}
            mode = ("Reused from " + str(reused.get("run_id", ""))[:12] if reused else
                    "Completed native stage" if stage.get("completed_at") else
                    "Completed run; stage provenance unavailable")
            stage_rows.append([case_label, model.upper(), mode,
                               stage.get("completed_at") or run.get("completed_at"),
                               info.get("comparison_version"), info.get("basis")])
        for name, item in sorted((run.get("artifacts") or {}).items()):
            output_rows.append([case_label, name, item.get("units"), item.get("bytes")])
    sections.append(["Completed native model results", [
        _table(["Case", "Model", "Stage provenance", "Completed", "InVEST version", "Version basis"], stage_rows),
        _table(["Case", "Output", "Native units", "Bytes"], output_rows),
        "NDR and SDR retain their own executed or reused stages and runtime versions. Raster artifact "
        "units remain those declared by the completed native result; this report does not apply a second conversion. "
        "The complete run IDs, input signatures, stage origin IDs and output SHA-256 values are retained in the linked scientific snapshot.",
    ]])
    comparison_rows = [[row.get("from_run_id"), row.get("to_run_id"), row.get("state"),
                        row.get("comparison_id"), row.get("reason")]
                       for row in snapshot["comparison_results"]]
    sections.append(["Comparison availability", [
        _table(["Original run", "Successor run", "State", "Comparison ID", "Explanation"], comparison_rows),
        "Incompatible or unavailable comparisons retain an explicit explanation. Missing quantities "
        "are not zeros. Every reported difference is successor minus original.",
    ]])
    for key, comparison in snapshot["comparisons"].items():
        quantities = []
        coverage_rows, excluded_mass_rows = [], []
        for alternative in comparison["alternatives"]:
            for name, item in sorted(alternative["artifacts"].items()):
                quantities.append([name, item.get("sum_change"),
                                   str(item.get("units", "")).replace("/pixel", ""),
                                   item.get("valid_cells"), item.get("units")])
                cov = item.get("coverage") or {}
                if cov:
                    coverage_rows.append([name, cov.get("scope"), cov.get("common_valid_cells"),
                        cov.get("baseline_only_cells"), cov.get("alternative_only_cells"),
                        cov.get("neither_valid_cells")])
                    excluded_mass_rows.append([name, cov.get("baseline_only_mass"),
                        cov.get("alternative_only_mass"), cov.get("summed_mass_units")])
        sections.append(["Retained native comparison " + key, [
            _table(["Output", "Sum of differences", "Summed mass units", "Common valid cells",
                    "Declared raster units"], quantities),
            _table(["Output", "Coverage scope", "Common cells", "Original-only cells",
                    "Successor-only cells", "Neither valid"], coverage_rows),
            _table(["Output", "Excluded original mass", "Excluded successor mass",
                    "Summed mass units"], excluded_mass_rows),
            "Differences are evaluated on the comparison's retained finite support. A raster cell quantity "
            "and its sum have different spatial denominators. The exact descriptors, coverage areas, "
            "native version provenance and spatial checks remain in scientific-snapshot.json. "
            "These sums cover valid cells of the aligned native output raster; a reporting-area-only "
            "total requires its own saved spatial selection. A source-edition difference describes the effect "
            "of the retained input update on this modeled case; interpreting it as a management intervention "
            "requires an explicit intervention comparison.",
        ]])
    sections.append(["Original record and editable continuation", [
        {"kind": "links", "items": [
            {"title": "Complete scientific snapshot and original bindings", "path": "scientific-snapshot.json"},
            {"title": "Original immutable source-update plan", "path": "original-plan.json"},
            {"title": "Checkpoint at this report capture", "path": "captured-checkpoint.json"},
        ]},
        "This report source is immutable. A later update can create another source edition. Its original "
        "checkpoint remains attached here; an editable Study also retains the current coherent checkpoint "
        "of this same saved plan, so later valid progress is preserved without changing this report.",
    ]])
    return sections


def get(workspace, key):
    key = identifier(key)
    directory = workspace.root / DIRECTORY / key
    result = read_json(directory / "receipt.json")
    if (result.get("schema") != SCHEMA or result.get("id") != key
            or result.get("state") != "complete" or digest(result.get("selection")) != key
            or result["selection"].get("project_id") != workspace.project["id"]):
        raise ValueError("The retained source-update report identity changed")
    for descriptor in [*result["files"].values(), *result["members"].values()]:
        verify_file(workspace.root, descriptor)
    capture = read_json(directory / "capture.json")
    if capture.get("selection") != result["selection"]:
        raise ValueError("The retained report capture differs from its source identity")
    choice = result["source"]
    unused, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    if any(entry["body"].get(field) != result["files"]["recipe"].get(field)
           for field in ("bytes", "sha256")):
        raise ValueError("The imported report recipe differs from its original capture")
    observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
    return result


def list_sources(workspace, plan_id=None):
    result = []
    for path in sorted((workspace.root / DIRECTORY).glob("*/receipt.json")):
        row = get(workspace, path.parent.name)
        if plan_id is None or row["plan_id"] == plan_id:
            result.append({key: deepcopy(row[key]) for key in
                           ("id", "plan_id", "title", "created_at", "source", "state")})
    return result


def prepare(workspace, value):
    spec = _spec(value)
    with source_refresh.export_lock(workspace, spec["plan_id"]):
        snapshot, checkpoint = _scientific_snapshot(workspace, spec["plan_id"])
        identity = {"edition": EDITION, "producer_sha256": file_digest(__file__),
                    "project_id": workspace.project["id"], "selection": spec,
                    "scientific": snapshot}
        key = digest(identity)
        directory = workspace.root / DIRECTORY / key
        with held(directory / ".source.lock", blocking=False):
            if (directory / "receipt.json").is_file():
                return {**get(workspace, key), "reused": True}
            capture_path = directory / "capture.json"
            if capture_path.is_file():
                capture = read_json(capture_path)
                if capture.get("selection") != identity:
                    raise ValueError("An interrupted report capture has different scientific inputs")
            else:
                capture = {"schema": SCHEMA, "id": key, "selection": identity,
                           "created_at": now(), "checkpoint": checkpoint}
                atomic_json(capture_path, capture, immutable=True)
            members = {}
            for name, data in (
                    ("scientific-snapshot.json", snapshot),
                    ("original-plan.json", snapshot["plan"]),
                    ("captured-checkpoint.json", capture["checkpoint"]),
                    ("capture.json", capture)):
                path = directory / name
                atomic_json(path, data, immutable=True)
                members[name] = describe_file(directory, path)
            recipe = {
                "schema": observed_context.SCHEMA, "edition": EDITION, "title": spec["title"],
                "origin": {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
                           "plan_id": spec["plan_id"], "engine": snapshot["engine"],
                           "format": snapshot["format"], "scientific_sha256": digest(snapshot)},
                "inputs": [members[name] for name in sorted(members)],
                "sections": _sections(spec, snapshot), "source_links": list(sorted(members)),
            }
            recipe_path = directory / "source-refresh-report.json"
            atomic_json(recipe_path, recipe, immutable=True)
            source_id = "source-refresh-" + key
            manifest = {"schema": "upstate.sources/v1", "title": spec["title"],
                        "captured_at": capture["created_at"],
                        "scope": "Completed source-update report with original scientific bindings",
                        "entries": [{"id": source_id, "kind": "document", "role": observed_context.ROLE,
                                     "title": spec["title"], "vintage": capture["created_at"],
                                     "uri": "workspace://" + str(workspace.project["id"]) +
                                            "/source-refresh-plans/" + spec["plan_id"],
                                     **describe_file(directory, recipe_path),
                                     "companions": [members[name] for name in sorted(members)],
                                     "metadata": {"source_kind": SOURCE_KIND, "origin": recipe["origin"],
                                                  "report_schema": observed_context.SCHEMA}}]}
            manifest_path = directory / "sources.json"
            atomic_json(manifest_path, manifest, immutable=True)
            # Workspace source import is intentionally inside the original publication guard.
            with held(workspace.root / ".workspace.lock", blocking=False):
                collection = workspace.import_sources(manifest_path)
                choice = {"source_collection_id": collection["id"], "source_id": source_id}
                binding = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
                result = {"schema": SCHEMA, "edition": EDITION, "id": key, "state": "complete",
                          "plan_id": spec["plan_id"], "title": spec["title"], "selection": identity,
                          "created_at": capture["created_at"], "source": choice, "observed_binding": binding,
                          "files": {"recipe": describe_file(workspace.root, recipe_path),
                                    "manifest": describe_file(workspace.root, manifest_path)},
                          "members": {name: describe_file(workspace.root, directory / name)
                                      for name in sorted(members)}}
                atomic_json(directory / "receipt.json", result, immutable=True)
            return get(workspace, key)


def verify_all(workspace):
    return [{"id": row["id"], "plan_id": row["plan_id"], "source": row["source"]}
            for row in (get(workspace, path.parent.name)
                        for path in sorted((workspace.root / DIRECTORY).glob("*/receipt.json")))]


def verify_workspace(workspace):
    from .source_refresh_receiving import verify_all as verify_plans
    return {**verify_plans(workspace), "report_sources": len(verify_all(workspace))}
