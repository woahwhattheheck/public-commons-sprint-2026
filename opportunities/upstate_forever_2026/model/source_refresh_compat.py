"""Keep both immutable source-refresh engines usable in one Workspace.

The original root-selective engine lives unchanged in source_refresh_legacy.
This facade discriminates saved bodies, never rewrites their IDs, and supplies
one operator view while retaining the original class/CLI/report interfaces.
"""
from __future__ import annotations

from contextvars import ContextVar
from copy import deepcopy
import csv
import html
import io
import json
from pathlib import Path

from .common import held, identifier, read_json

EDITION = "edition"
ROOTS = "roots"
FORMATS = {
    EDITION: "upstate.source-refresh-editions/v1",
    ROOTS: "upstate.source-refresh-roots/v1",
}
_hooks = ContextVar("source_refresh_callbacks", default=None)


class _Cancelled(BaseException):
    pass


def install_facade(namespace):
    if namespace.get("_COMPAT_INSTALLED"):
        return
    namespace["_COMPAT_INSTALLED"] = True
    edition_get = namespace["get_plan"]
    edition_apply = namespace["apply_plan"]
    edition_state = namespace["_read_state"]
    edition_state_path = namespace["_state_path"]
    edition_checkpoint = namespace["_checkpoint"]
    edition_check = namespace["_check_snapshot"]
    plan_kind = namespace["PLAN_KIND"]
    preview_schema = namespace["PREVIEW_SCHEMA"]

    def legacy(workspace):
        from .source_refresh_legacy import SourceRefresh as OriginalSourceRefresh
        return OriginalSourceRefresh(workspace)

    def engine(plan):
        if (isinstance(plan.get("preview"), dict)
                and plan["preview"].get("schema") == preview_schema
                and isinstance(plan.get("selection"), dict)
                and "from_collection_id" in plan["selection"]
                and "to_collection_id" in plan["selection"]):
            return EDITION
        if (plan.get("version") == 1
                and isinstance(plan.get("nodes"), list)
                and isinstance(plan.get("roots"), list)
                and isinstance(plan.get("mapping"), dict)
                and "workspace_id" in plan
                and "from_collection_id" in plan
                and "to_collection_id" in plan):
            return ROOTS
        return "unknown"

    def raw_plan(workspace, plan_id):
        return workspace._get(plan_kind, identifier(plan_id))

    def marked(value, selected_engine):
        return {**value, "engine": selected_engine,
                "format": FORMATS.get(selected_engine, "unknown")}

    def edition_view_state(state):
        if state is None:
            return None
        result = deepcopy(state)
        runs = list(result.get("run_results", {}).values())
        pending = sum(row.get("state") != "complete" for row in runs)
        result["run_completion"] = {
            "total": len(runs), "complete": len(runs) - pending, "pending": pending}
        # Earlier editions could call a lineage-only plan complete while its
        # successor runs remained prepared. Repair the presentation without
        # modifying that retained checkpoint or its immutable plan.
        if result.get("native_execution_requested") and pending and result.get("state") == "complete":
            result["state"] = "prepared"
            result["completion_note"] = (
                "The source selections are saved. Complete the prepared refreshed runs "
                "to retain their native outputs; equivalent native stages can be reused.")
        result["status"] = result.get("state", "planned")
        return marked(result, EDITION)

    def kind_name(value):
        aliases = {"profile": "profiles", "scenario": "scenarios",
                   "grid": "grids", "run": "runs"}
        return aliases.get(value, value)

    def root_state(workspace, plan, raw=None):
        owner = legacy(workspace)
        raw = owner.state(plan["id"]) if raw is None else raw
        result = deepcopy(raw)
        # The original engine gives an unstarted plan fresh timestamps on read.
        # Keep those timestamps out of the common view's change fingerprint.
        if not Path(owner._state_path(plan["id"])).exists():
            result["created_at"] = None
            result["updated_at"] = None
        result["state"] = raw.get("status", "planned")
        result["phase"] = raw.get("active_step") or raw.get("status", "planned")
        mappings = {key: {} for key in ("profiles", "scenarios", "grids", "runs")}
        run_results, run_ids = {}, []
        steps = raw.get("steps", {})
        for node in plan["nodes"]:
            kind = kind_name(node["kind"])
            step = steps.get(node["key"], {})
            new_id = step.get("new_id")
            if new_id:
                mappings.setdefault(kind, {})[node["old_id"]] = new_id
            if kind == "runs":
                if new_id and new_id not in run_ids:
                    run_ids.append(new_id)
                run_results[node["old_id"]] = {
                    "from_run_id": node["old_id"], "to_run_id": new_id,
                    "state": step.get("native_state") or step.get("status", "planned"),
                    "requires_native_rerun": node.get("action") == "derive",
                    "action": node.get("action"), "error": step.get("error"),
                }
        result["mappings"] = mappings
        result["run_ids"] = run_ids
        result["run_results"] = run_results
        result["comparisons"] = []
        result["comparison_results"] = {}
        result["errors"] = []
        if raw.get("error"):
            result["errors"].append({"phase": result["phase"], "message": str(raw["error"])})
        for key, step in steps.items():
            if step.get("error"):
                result["errors"].append({"phase": key, "message": str(step["error"])})
        return marked(result, ROOTS)

    def legacy_preview(workspace, plan):
        affected = {key: [] for key in ("profiles", "scenarios", "grids", "runs")}
        problems, physical_ids = [], set()
        for node in plan["nodes"]:
            if node.get("action") == "reuse":
                continue
            kind = kind_name(node["kind"])
            references = node.get("source_references", [])
            ids = [row["source_id"] for row in references if row.get("source_id")]
            if node.get("action") == "derive":
                physical_ids.update(ids)
            entry = {
                "id": node["old_id"], "key": node["key"], "action": node.get("action"),
                "source_ids": ids, "changed_source_ids": ids,
                "requires_native_rerun": node.get("action") == "derive",
                "reasons": deepcopy(node.get("reasons", [])),
                "dependencies": deepcopy(node.get("dependencies", [])),
            }
            affected.setdefault(kind, []).append(entry)
            if node.get("action") == "missing":
                problems.append({"code": "legacy_missing_dependency", "kind": kind,
                                 "id": node["old_id"],
                                 "message": "; ".join(node.get("reasons", []))
                                 or "The selected root has an unmapped source dependency"})
        changes = []
        for change in plan.get("changes", []):
            before = change.get("before") or {}
            after = change.get("after") or {}
            status = change.get("change", "unknown")
            before_body, after_body = before.get("body", {}), after.get("body", {})
            body_changed = (
                (before_body.get("sha256"), before_body.get("bytes"))
                != (after_body.get("sha256"), after_body.get("bytes")))
            detail = namespace["_change"](before, after or None) if before else {
                "from_source_id": None, "to_source_id": change.get("replacement_id"),
                "status": "added", "reasons": [],
                "body_changed": False, "companions_changed": False,
                "semantic_metadata_changed": False, "lineage_metadata_changed": False,
                "native_reader_layout_changed": False, "requires_native_rerun": False,
            }
            changes.append({
                **deepcopy(change), **detail, "legacy_change": status,
                "legacy_reason": change.get("reason"),
                "edition_requires_native_rerun": detail["requires_native_rerun"],
                "requires_native_rerun": change.get("source_id") in physical_ids,
                "engine_interpretation": ROOTS,
            })
        def collection(key):
            retained = workspace._get("sources", plan[key])
            return {"id": retained["id"], "title": retained.get("title")}
        counts = {name: sum(row["legacy_change"] == name for row in changes)
                  for name in ("added", "removed", "changed", "metadata", "unchanged")}
        summary = {
            "unchanged_count": counts["unchanged"], "added_count": counts["added"],
            "unmapped_count": counts["removed"], "content_changed_count": counts["changed"],
            "semantic_metadata_changed_count": sum(bool(row.get("semantic_metadata_changed")) for row in changes),
            "lineage_metadata_changed_count": sum(bool(row.get("lineage_metadata_changed")) for row in changes),
            "native_reader_layout_changed_count": sum(bool(row.get("native_reader_layout_changed")) for row in changes),
            "problem_count": len(problems), "selected_root_count": len(plan["roots"]),
            "native_rerun_count": sum(row.get("requires_native_rerun")
                                      for row in affected.get("runs", [])),
        }
        for kind in ("profiles", "scenarios", "grids", "runs"):
            summary["affected_" + kind[:-1] + "_count"] = len(affected[kind])
        return marked({
            "schema": preview_schema, "title": plan["title"],
            "selection": {
                "title": plan["title"], "from_collection_id": plan["from_collection_id"],
                "to_collection_id": plan["to_collection_id"],
                "source_id_map": deepcopy(plan["mapping"]), "roots": deepcopy(plan["roots"]),
            },
            "resolved_source_id_map": deepcopy(plan["mapping"]),
            "from_collection": collection("from_collection_id"),
            "to_collection": collection("to_collection_id"),
            "changes": changes, "affected": affected, "problems": problems,
            "summary": summary, "warnings": [], "roots": deepcopy(plan["roots"]),
            "source_counts": deepcopy(plan.get("source_counts", {})),
            "recompute_scope": "Original root-selective engine and retained dependency graph",
        }, ROOTS)

    def get_plan(workspace, plan_id):
        raw = raw_plan(workspace, plan_id)
        selected = engine(raw)
        if selected == EDITION:
            value = edition_get(workspace, raw["id"])
            value["state"] = edition_view_state(value.get("state"))
            return marked(value, EDITION)
        if selected == ROOTS:
            original = legacy(workspace).get(raw["id"])
            report = legacy_preview(workspace, original)
            return marked({
                **original, "immutable_plan": original,
                "selection": report["selection"], "preview": report,
                "state": root_state(workspace, original),
            }, ROOTS)
        return marked({
            **raw, "immutable_plan": raw,
            "state": {"state": "unsupported", "status": "unsupported",
                      "errors": [{"message": "Unrecognized retained source-refresh plan format"}]},
        }, "unknown")

    def list_plans(workspace):
        rows = []
        for raw in workspace._list(plan_kind):
            plan = get_plan(workspace, raw["id"])
            state = plan.get("state") or {}
            selection = plan.get("selection") or {}
            preview = plan.get("preview") or {}
            rows.append({
                "id": raw["id"], "title": raw.get("title", "Source refresh"),
                "engine": plan["engine"], "format": plan["format"],
                "from_collection_id": selection.get("from_collection_id", raw.get("from_collection_id")),
                "to_collection_id": selection.get("to_collection_id", raw.get("to_collection_id")),
                "summary": deepcopy(preview.get("summary", {})),
                "problem_count": len(preview.get("problems", [])),
                "state": state.get("state", "planned"),
                "status": state.get("status", state.get("state", "planned")),
                "phase": state.get("phase", "planned"), "updated_at": state.get("updated_at"),
                "error_count": len(state.get("errors", [])),
                "selected_root_count": len(raw["roots"]) if plan["engine"] == ROOTS else None,
            })
        return sorted(rows, key=lambda row: (str(row.get("updated_at") or ""), row["id"]), reverse=True)

    def checkpoint(workspace, state, phase=None):
        edition_checkpoint(workspace, state, phase)
        hooks = _hooks.get()
        if hooks is not None:
            if hooks.get("progress"):
                hooks["progress"](edition_view_state(state))
            if hooks.get("cancelled") and hooks["cancelled"]():
                raise _Cancelled()

    def apply_plan(workspace, plan_id, run_models=False, *, progress=None, cancelled=None):
        raw = raw_plan(workspace, plan_id)
        selected = engine(raw)
        if selected == ROOTS:
            result = legacy(workspace).apply(
                raw["id"], execute_runs=run_models, progress=progress, cancelled=cancelled)
            return root_state(workspace, result.plan, result.state)
        if selected != EDITION:
            raise ValueError("Unrecognized retained source-refresh plan format")
        token = _hooks.set({"progress": progress, "cancelled": cancelled})
        try:
            if cancelled and cancelled():
                raise _Cancelled()
            return edition_view_state(edition_apply(workspace, raw["id"], run_models=run_models))
        except _Cancelled:
            state = edition_state(workspace, raw["id"]) or namespace["_new_state"](raw)
            state["state"] = "cancelled"
            state["history"].append({"at": namespace["now"](), "event": "cancelled"})
            edition_checkpoint(workspace, state, "cancelled")
            raise InterruptedError("Source refresh was cancelled after retaining its current checkpoint")
        finally:
            _hooks.reset(token)

    def validate_plan(workspace, plan_id):
        raw = raw_plan(workspace, plan_id)
        selected = engine(raw)
        if selected == ROOTS:
            owner = legacy(workspace)
            owner._validate_plan(owner.get(raw["id"]))
        elif selected == EDITION:
            edition_check(workspace, raw)
        else:
            raise ValueError("Unrecognized retained source-refresh plan format")
        return raw

    def export_lock(workspace, plan_id):
        raw = raw_plan(workspace, plan_id)
        selected = engine(raw)
        if selected == ROOTS:
            path = legacy(workspace)._state_path(raw["id"])
        elif selected == EDITION:
            path = edition_state_path(workspace, raw["id"])
        else:
            raise ValueError("Unrecognized retained source-refresh plan format")
        return held(Path(path).parent / ".refresh.lock", blocking=False)

    def report_plan(workspace, plan_id):
        value = get_plan(workspace, plan_id)
        if value["engine"] == ROOTS:
            return {**legacy(workspace).report(value["id"]),
                    "engine": ROOTS, "format": FORMATS[ROOTS]}
        if value["engine"] != EDITION:
            raise ValueError("Unrecognized retained source-refresh plan format")
        raw = raw_plan(workspace, value["id"])
        state = value.get("state")
        data = {"plan": raw, "state": state, "engine": EDITION, "format": FORMATS[EDITION],
                "comparisons": []}
        for row in (state or {}).get("comparisons", []):
            key = identifier(row["comparison_id"])
            path = Path(workspace.root) / "comparisons" / key / "comparison.json"
            comparison = read_json(path)
            if comparison.get("id") != key:
                raise ValueError("Retained comparison identity differs from the refresh state")
            data["comparisons"].append(comparison)
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow(["record", "kind", "original_id", "replacement_id", "status",
                         "native_rerun", "details"])
        mappings = (state or {}).get("mappings", {})
        for kind, rows in raw["preview"]["affected"].items():
            for row in rows:
                replacement = mappings.get(kind, {}).get(row["id"])
                writer.writerow(["dependency", kind, row["id"], replacement or "",
                                 (state or {}).get("state", "planned"),
                                 bool(row.get("requires_native_rerun")),
                                 "; ".join(row.get("reasons", []))])
        for row in (state or {}).get("run_results", {}).values():
            writer.writerow(["run_completion", "runs", row.get("from_run_id"), row.get("to_run_id"),
                             row.get("state", "prepared"), bool(row.get("requires_native_rerun")),
                             json.dumps({"execution": row.get("execution"),
                                         "model_results": row.get("model_results", {}),
                                         "artifacts": row.get("artifacts", {})},
                                        sort_keys=True, ensure_ascii=False)])
        for row in (state or {}).get("comparison_results", {}).values():
            writer.writerow(["comparison", "runs", row.get("from_run_id"), row.get("to_run_id"),
                             row.get("state"), "", row.get("reason", row.get("comparison_id", ""))])
        for comparison in data["comparisons"]:
            for alternative in comparison.get("alternatives", []):
                for metric, artifact in alternative.get("artifacts", {}).items():
                    writer.writerow([
                        "native_difference", metric, comparison.get("baseline_run_id"),
                        alternative.get("run_id"), "complete", "",
                        json.dumps({key: item for key, item in artifact.items()
                                    if key not in ("path", "sha256", "bytes")},
                                   sort_keys=True, ensure_ascii=False),
                    ])
        csv_text = stream.getvalue()
        esc = lambda item: html.escape(str(item), quote=True)
        summary_rows = "".join("<tr><th>" + esc(key.replace("_", " ")) + "</th><td>"
                               + esc(item) + "</td></tr>"
                               for key, item in raw["preview"]["summary"].items())
        completion_rows = []
        for row in (state or {}).get("run_results", {}).values():
            models = "; ".join(
                name.upper() + ": " + value.get("mode", "retained") +
                (" from " + str(value["source_run_id"]) if value.get("source_run_id") else "")
                for name, value in sorted(row.get("model_results", {}).items()))
            completion_rows.append(
                "<tr><td>" + esc(row.get("from_run_id", "")) + "</td><td>" +
                esc(row.get("to_run_id", "")) + "</td><td>" +
                esc(row.get("state", "prepared")) + "</td><td>" +
                esc(row.get("execution", "prepared")) + "</td><td>" +
                esc(models or "Native outputs have not been recorded.") + "</td></tr>")
        comparison_rows = []
        for comparison in data["comparisons"]:
            for alternative in comparison.get("alternatives", []):
                for metric, artifact in alternative.get("artifacts", {}).items():
                    comparison_rows.append(
                        "<tr><td>" + esc(metric) + "</td><td>" + esc(artifact.get("sum_change", ""))
                        + "</td><td>" + esc(artifact.get("units", "").replace("/pixel", ""))
                        + "</td><td>" + esc(artifact.get("valid_cells", "")) + "</td></tr>")
        rendered = (
            "<!doctype html><html><head><meta charset='utf-8'><title>" + esc(raw["title"])
            + "</title><style>body{font:14px system-ui;color:#181818;max-width:1100px;"
              "margin:32px auto;padding:0 20px}table{border-collapse:collapse;width:100%;"
              "margin:18px 0}th,td{border:1px solid #bbb;padding:7px;text-align:left}"
              "th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;"
              "font:11px ui-monospace,monospace}@media print{body{margin:0;max-width:none}"
              "tr{break-inside:avoid}}</style></head><body><h1>" + esc(raw["title"])
            + "</h1><p>Retained source-edition refresh. State: "
            + esc((state or {}).get("state", "planned")) + "</p><p>Plan: "
            + esc(raw["id"]) + "</p><table>" + summary_rows
            + "</table><h2>Refreshed run completion</h2><p>"
            + esc((state or {}).get("completion_note", "Each completed successor retains its actual native model stages and outputs."))
            + "</p><table><thead><tr><th>Original run</th><th>Refreshed run</th>"
              "<th>State</th><th>Execution</th><th>Native stages</th></tr></thead><tbody>"
            + ("".join(completion_rows) or "<tr><td colspan='5'>No affected native runs.</td></tr>")
            + "</tbody></table><h2>Native annual export changes</h2>"
              "<p>Differences are alternative minus baseline on the retained common finite support. "
              "Excluded source coverage and annual mass remain in the detailed comparison data.</p>"
              "<table><thead><tr><th>Metric</th><th>Annual change</th><th>Summed units</th>"
              "<th>Common valid cells</th></tr></thead><tbody>"
            + ("".join(comparison_rows) or "<tr><td colspan='4'>No complete retained native comparison.</td></tr>")
            + "</tbody></table><h2>Retained operation and comparison details</h2><pre>"
            + esc(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True))
            + "</pre></body></html>")
        return {"json": data, "csv": csv_text, "html": rendered,
                "engine": EDITION, "format": FORMATS[EDITION]}

    class SourceRefresh:
        """Original class surface with both immutable formats visible and executable."""
        def __init__(self, workspace):
            self.ws = workspace

        def source_diff(self, old_id, new_id, mapping=None, *, verify=True):
            return legacy(self.ws).source_diff(old_id, new_id, mapping, verify=verify)

        def plan(self, old_id, new_id, *, mapping=None, roots=None, title="Source refresh"):
            return legacy(self.ws).plan(
                old_id, new_id, mapping=mapping, roots=roots, title=title)

        def get(self, plan_id):
            raw = raw_plan(self.ws, plan_id)
            return legacy(self.ws).get(raw["id"]) if engine(raw) == ROOTS else raw

        def state(self, plan_id):
            raw = raw_plan(self.ws, plan_id)
            if engine(raw) == ROOTS:
                return legacy(self.ws).state(raw["id"])
            if engine(raw) == EDITION:
                state = edition_state(self.ws, raw["id"])
                return edition_view_state(state) or marked({
                    "schema": "upstate.source-refresh-state/v1", "plan_id": raw["id"],
                    "state": "planned", "status": "planned", "created_at": None,
                    "updated_at": None,
                }, EDITION)
            return {"plan_id": raw["id"], "state": "unsupported", "status": "unsupported"}

        def list(self):
            return [{"plan": self.get(plan["id"]), "state": self.state(plan["id"]),
                     "engine": engine(plan), "format": FORMATS.get(engine(plan), "unknown")}
                    for plan in self.ws._list(plan_kind)]

        def apply(self, plan_id, execute_runs=True, progress=None, cancelled=None):
            raw = raw_plan(self.ws, plan_id)
            if engine(raw) == ROOTS:
                return legacy(self.ws).apply(
                    raw["id"], execute_runs=execute_runs, progress=progress, cancelled=cancelled)
            state = apply_plan(
                self.ws, raw["id"], run_models=execute_runs,
                progress=progress, cancelled=cancelled)
            from .source_refresh_legacy import RefreshResult
            return RefreshResult(raw, state)

        def report(self, plan_id):
            return report_plan(self.ws, plan_id)

        def _validate_plan(self, plan):
            retained = raw_plan(self.ws, plan["id"])
            if retained != plan:
                raise ValueError("Supply the exact immutable refresh plan for export validation")
            validate_plan(self.ws, retained["id"])

        def _state_path(self, plan_id):
            raw = raw_plan(self.ws, plan_id)
            if engine(raw) == ROOTS:
                return legacy(self.ws)._state_path(raw["id"])
            if engine(raw) == EDITION:
                return edition_state_path(self.ws, raw["id"])
            raise ValueError("Unrecognized retained source-refresh plan format")

        def export(self, plan_id, destination):
            raw = raw_plan(self.ws, plan_id)
            if engine(raw) == ROOTS:
                return legacy(self.ws).export(raw["id"], destination)
            validate_plan(self.ws, raw["id"])
            with export_lock(self.ws, raw["id"]):
                return self.ws.backup(destination, include_intermediates=True)

    namespace.update({
        "get_plan": get_plan, "list_plans": list_plans, "apply_plan": apply_plan,
        "report_plan": report_plan, "validate_plan": validate_plan,
        "export_lock": export_lock, "plan_engine": engine,
        "SourceRefresh": SourceRefresh, "_checkpoint": checkpoint,
    })
