"""Scientific result interpretation over retained Upper Savannah runs.

TokenJunkieLabs. This adapter composes the original operator queue, workspace
selection and authenticated downloads with model.experiment_diagnostics.
"""
from __future__ import annotations
import json
import importlib
from model.common import identifier, relative_file, verify_file
from model import experiment_diagnostics as diagnostics

ACTIONS = frozenset({"diagnostics.analyze", "diagnostics.report.prepare"})
READS = frozenset({"catalog", "item", "experiment"})


class ExperimentDiagnostics:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def summaries(self, workspace):
        return diagnostics.listing(self.operator.ws(workspace))

    def _id(self, value):
        try:
            return identifier(value.get("diagnostic_id"))
        except (TypeError, ValueError) as error:
            raise self.Fault("DIAGNOSTIC_SELECTION",
                             "Select a saved scientific analysis.") from error

    def _decorate(self, workspace, result):
        value = json.loads(json.dumps(result))
        ws = self.operator.ws(workspace)
        identifier(value["id"])
        downloads = []
        for name, item in value.get("artifacts", {}).items():
            if not isinstance(item, dict) or "path" not in item:
                continue
            path = relative_file(ws.root, item["path"])
            ticket = self.operator._ticket(
                workspace, path, {**item, "filename": path.name},
                name.replace("_", " ").capitalize())
            # Reuse the original descriptor-based verifier and unchanged-file
            # cache, so polling a saved task does not rehash its entire archive.
            retained, _ = self.operator.open_download(ticket["id"])
            retained.close()
            downloads.append({**ticket, "artifact_key": name})
        value["_downloads"] = downloads
        return value

    def _programmes(self):
        try:
            module = importlib.import_module("model.experiments")
        except ModuleNotFoundError as error:
            if error.name == "model.experiments":
                return None
            raise
        if not all(callable(getattr(module, name, None))
                   for name in ("list_experiments", "inspect")):
            raise self.Fault("DIAGNOSTIC_PROGRAMME",
                             "The experiment programme needs its current source adapter.")
        return module

    def _experiment_selection(self, ws, experiment_id):
        key = identifier(experiment_id)
        module = self._programmes()
        if module is None:
            raise self.Fault("DIAGNOSTIC_PROGRAMME",
                             "Install the experiment programme to select its retained cases.", 404)
        cases, offset, seen_offsets, initial = [], 0, set(), None
        while offset is not None:
            if offset in seen_offsets:
                raise ValueError("The experiment case cursor stopped advancing")
            seen_offsets.add(offset)
            page = module.inspect(ws, key, offset=offset, limit=250)
            if initial is None:
                initial = page
            cases.extend(page["cases"])
            next_offset = page.get("next_offset")
            if next_offset is not None and next_offset <= offset:
                raise ValueError("The experiment case cursor must advance")
            offset = next_offset
        if len(cases) != initial["total_cases"]:
            raise ValueError("The retained experiment case enumeration is incomplete")
        baseline = ws.inspect_run(initial["selection"]["baseline_run_id"])
        reference = baseline["selection"]["profile_id"]
        baseline_scenario = baseline["selection"]["scenario_id"]
        expected_profiles = sorted({reference, *(row["profile_id"] for row in cases)})
        scenarios = sorted({baseline_scenario, *(row["scenario_id"] for row in cases)})
        original_ids = sorted({baseline["id"], *(row["run_id"] for row in cases)})
        retained_ids = [run_id for run_id in original_ids
                        if (ws.root / "runs" / run_id / "run.json").is_file()]
        return {
            "selection": {
                "title": initial.get("title", "Experiment") + " — scientific interpretation",
                "purpose": "", "campaign_id": key,
                "run_ids": retained_ids, "expected_profile_ids": expected_profiles,
                "scenario_ids": scenarios,
                "baseline_scenario_id": baseline_scenario,
                "reference_profile_id": reference,
                "design": {"factorial": "full_factorial",
                           "one_at_a_time": "one_at_a_time"}.get(
                               initial["selection"].get("design"), "explicit_run_set"),
                "observations": [], "top_k": 1,
                "tolerances": {"nitrogen_export": 0, "phosphorus_export": 0,
                               "sediment_export": 0},
            },
            "programme": {
                "id": key, "title": initial.get("title"), "state": initial.get("state"),
                "expected_cases": len(cases), "retained_runs": len(retained_ids),
                "unprepared_run_ids": [run_id for run_id in original_ids
                                       if run_id not in retained_ids],
            },
        }

    def read(self, workspace, operation, value=None):
        value = value or {}
        ws = self.operator.ws(workspace)
        if operation == "experiment":
            return self._experiment_selection(ws, value.get("experiment_id"))
        if operation == "item":
            return self._decorate(workspace, diagnostics.inspect(ws, self._id(value)))
        if operation != "catalog":
            raise self.Fault("DIAGNOSTIC_ROUTE", "Select an existing diagnostic view.", 404)
        overview = ws.overview()
        programmes, programme_error = [], None
        try:
            module = self._programmes()
            if module is not None:
                programmes = [
                    {key: row.get(key) for key in ("id", "title", "state", "counts", "progress")}
                    for row in module.list_experiments(ws)
                ]
        except (ImportError, SyntaxError, AttributeError, ValueError, OSError, TypeError, self.Fault) as error:
            programme_error = str(error)
        contexts = {}
        for record in overview.get("observation_comparisons", []):
            selection = {
                "observation_id": record["observation_id"],
                "catchments": record["catchment_selection"],
            }
            context_key = json.dumps(selection, sort_keys=True, separators=(",", ":"))
            contexts.setdefault(context_key, {
                **selection, "comparison_id": record["id"],
                "method": record.get("observation_method", {}),
                "source": record.get("catchment_source", {}),
            })
        profiles = [
            {key: row[key] for key in (
                "id", "title", "ndr", "sdr", "references", "source_collection_id",
                "biophysical_source_id", "table_summary", "model_period",
                "scientific_status", "experimental",
            ) if key in row}
            for row in overview.get("profiles", [])
        ]
        runs = []
        for row in overview.get("runs", []):
            runs.append({
                "id": row["id"], "selection": row["selection"], "state": row["state"],
                "created_at": row.get("created_at"),
                "completed_at": row.get("completed_at"), "error": row.get("error"),
                "outputs": {
                    name: {key: item.get(key) for key in (
                        "sum", "sum_units", "units", "valid_cells", "sha256",
                    )}
                    for name, item in row.get("artifacts", {}).items()
                },
            })
        return {
            "workspace_key": workspace, "project": ws.project,
            "diagnostics": diagnostics.listing(ws),
            "deliveries": [{"id": row["id"], "title": row.get("title") or row.get("selection", {}).get("title") or row["id"],
                            "state": row.get("state")} for row in overview.get("deliveries", [])],
            "experiment_programmes": programmes,
            "experiment_programme_error": programme_error,
            "grids": [
                {"id": row["id"], "title": row.get("spec", {}).get("title", row["id"][:12]),
                 "state": row.get("state"), "grid": row.get("grid"),
                 "spec": row.get("spec", {})}
                for row in overview.get("grids", [])
            ],
            "profiles": profiles,
            "scenarios": overview.get("scenarios", []),
            "runs": runs,
            "observations": [
                {"id": row["id"], "title": row.get("metadata", {}).get("title", row["id"][:12]),
                 "metadata": row.get("metadata", {}), "row_count": len(row.get("rows", []))}
                for row in overview.get("observations", [])
            ],
            "observation_contexts": list(contexts.values()),
            "source_vectors": [
                {"collection_id": collection["id"], "collection_title": collection.get("title"),
                 "source_id": row["id"], "title": row["title"], "layer": row.get("layer"),
                 "uri": row["uri"], "vintage": row["vintage"]}
                for collection in overview.get("sources", [])
                for row in collection.get("entries", []) if row.get("kind") == "vector"
            ],
        }

    def invoke(self, task):
        if task["action"] not in ACTIONS:
            raise self.Fault("DIAGNOSTIC_ACTION", "Select the scientific analysis action.", 404)
        if task["action"] == "diagnostics.report.prepare":
            from model import diagnostic_report_context
            value = task.get("payload") or {}
            return diagnostic_report_context.prepare(
                self.operator.ws(task["workspace"]), self._id(value),
                report_sha256=identifier(value.get("report_sha256")),
                delivery_id=value.get("delivery_id") or None)
        return diagnostics.analyze(self.operator.ws(task["workspace"]), task["payload"])

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        result = task.get("result", {})
        if task["action"] == "diagnostics.report.prepare":
            if task.get("state") == "complete" and result.get("source"):
                ws = self.operator.ws(task["workspace"])
                task["_diagnostic_report"] = {
                    "diagnostic_id": result["diagnostic_id"], "report_sha256": result["report_sha256"],
                    "title": result["title"], "source": result["source"]}
                task["_downloads"] = [
                    self.operator._ticket(task["workspace"], verify_file(ws.root, item),
                                          item, item["path"].rsplit("/", 1)[-1])
                    for item in result.get("files", [])]
            return task
        if result.get("id"):
            task["_diagnostic"] = {"id": result["id"], "title": result.get("title") or
                                   result.get("selection", {}).get("title", "Scientific analysis")}
            if task.get("state") == "complete":
                task["_downloads"] = self._decorate(task["workspace"], result)["_downloads"]
        return task
