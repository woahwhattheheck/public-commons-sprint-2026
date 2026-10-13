"""Queue prepared-input composition through the original native run workflow."""
from __future__ import annotations

import inspect
import importlib.util

from model.common import identifier

COMPOSE_ACTION = "run.assembly.compose"


class RunAssemblyOperations:
    def __init__(self, operator, fault):
        self.operator = operator
        self.fault = fault

    def read(self, workspace_key, operation, payload):
        if operation != "catalog":
            raise self.fault("RUN_ASSEMBLY_ROUTE",
                             "Choose the native run assembly catalogue.", 404)
        workspace = self.operator.ws(workspace_key)
        available, reason = False, ""
        try:
            from ecsa_runs import upstate
            capabilities = getattr(upstate, "ORIGINAL_RUN_CAPABILITIES", {})
            declared = (isinstance(capabilities, dict) and
                        isinstance(capabilities.get("run.start"), dict) and
                        capabilities["run.start"].get("source_runs") is True)
            if not declared:
                reason = "Install the current original run.start source-runs helper."
            elif not callable(getattr(workspace, "combine_runs", None)):
                reason = "Install the selected-model Workspace assembly method."
            else:
                source = inspect.getsourcefile(type(self.operator))
                if not source:
                    reason = "Open the original operator from its installed source."
                else:
                    # The maintained integrator examines the actual original
                    # Operator._invoke run.start branch. This read never writes.
                    joined = upstate.integrate_operator(source, write=False)
                    available = joined.get("state") == "already_integrated"
                    if not available:
                        reason = "Join the original run.start helper in this operator."
        except ImportError as error:
            reason = "Install the original native retention and assembly modules: " + str(error)
        except (OSError, TypeError, ValueError, SyntaxError, AttributeError) as error:
            reason = str(error) or type(error).__name__
        composition_available, composition_reason = False, reason
        if available:
            try:
                # Discovery leaves native modules unloaded on the request thread.
                composition_available = (
                    importlib.util.find_spec("model.completed_run_join") is not None and
                    self.operator.extensions.handles_action(COMPOSE_ACTION))
                if not composition_available:
                    composition_reason = "Install the prepared-grid composition action."
            except ImportError as error:
                composition_reason = "Install the prepared-grid composition source: " + str(error)
        return {
            "schema": "upstate.native-run-assembly-capabilities/v1",
            "available": available,
            "action": "run.start",
            "source_runs": available,
            "prepared_grid_composition": composition_available,
            "composition_action": COMPOSE_ACTION if composition_available else None,
            "composition_preview_queued": composition_available,
            "composition_reason": composition_reason,
            "source_models": ["ndr", "sdr"],
            "helper": "ecsa_runs.upstate.invoke_original_run",
            "result": "original_complete_native_run",
            "reason": reason,
        }

    def invoke(self, task):
        """Compose inside the original serialized queue, then retain run.start."""
        if task.get("action") != COMPOSE_ACTION:
            raise self.fault("RUN_ASSEMBLY_ACTION", "Choose prepared input composition.")
        value = task.get("payload")
        allowed = {"source_runs", "profile_id", "scenario_id", "preview_only"}
        if not isinstance(value, dict) or set(value) - allowed:
            raise self.fault("RUN_ASSEMBLY_SELECTION", "Choose the original completed models and target profile.")
        sources = value.get("source_runs")
        if not isinstance(sources, dict) or set(sources) != {"ndr", "sdr"}:
            raise self.fault("RUN_ASSEMBLY_SOURCES", "Choose one completed NDR run and one completed SDR run.")
        sources = {name: identifier(sources[name]) for name in ("ndr", "sdr")}
        preview_only = value.get("preview_only", False)
        if not isinstance(preview_only, bool):
            raise self.fault("RUN_ASSEMBLY_PREVIEW", "Choose whether to check the selected inputs only.")
        options = {}
        for name in ("profile_id", "scenario_id"):
            if value.get(name) is not None:
                options[name] = identifier(value[name])
        from model.completed_run_join import join_runs, preview
        workspace = self.operator.ws(task["workspace"])
        pair = [sources["ndr"], sources["sdr"]]
        if preview_only:
            return preview(workspace, pair, **options)

        # Native transfers and physical comparisons belong to this retained
        # task, never to the HTTP request thread. The adapter retains progress.
        prepared = join_runs(workspace, pair, execute=False, **options)
        result = {"schema": "upstate.native-run-composition/v1",
                  "id": prepared["id"], "selection": prepared["selection"],
                  "source_runs": sources, "state": "prepared",
                  "composition_task_id": task["id"]}
        # A later continuation-submission failure still exposes the prepared
        # ordinary run through the original task's retained result.
        task["result"] = result
        operation_id = "stage-grid-" + identifier(task["id"])
        continuation = self.operator.submit(
            task["workspace"], "run.start",
            {"run_id": prepared["id"], "source_runs": sources}, operation_id)
        result["native_task"] = {"id": continuation["id"],
                                 "action": continuation["action"],
                                 "state": continuation["state"]}
        result["state"] = "native_submitted"
        return result

    def decorate_task(self, task):
        if task.get("action") != COMPOSE_ACTION:
            return task
        result = task.get("result") or {}
        if result.get("schema") != "upstate.native-run-composition/v1":
            return task
        run_id = identifier(result["id"])
        task["_item"] = {"kind": "runs", "id": run_id}
        task["native_run_id"] = run_id
        selected = result.get("native_task")
        if isinstance(selected, dict) and selected.get("id"):
            original = self.operator.task(identifier(selected["id"]))
            if (original.get("workspace") != task["workspace"] or
                    original.get("action") != "run.start" or
                    original.get("payload", {}).get("run_id") != run_id):
                raise ValueError("The retained native continuation belongs to another selection")
            task["native_task"] = {
                "id": original["id"], "state": original["state"],
                "run_id": run_id, "error": original.get("error"),
                "started_at": original.get("started_at"),
                "ended_at": original.get("ended_at")}
        return task
