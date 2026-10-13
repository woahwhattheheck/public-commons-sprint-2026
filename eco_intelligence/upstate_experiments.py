"""Join saved original scenario experiments to the native Investigations binding.

Every selected design, case index, native execution and result file belongs to
model.experiments and the existing ExperimentOperator. This module only prepares
an investigation plan and submits that saved experiment through the original queue.
"""
from __future__ import annotations

from model import experiments
from model.common import digest as native_digest, file_digest, identifier, read_json

from .common import IntelligenceError, digest, public_metadata
from .schemas import Action
from .upstate import NativeAction, _copy, _dataset_id, _identity, _inside, _member


class OriginalExperiments:
    """The installed original programme, selected explicitly by the server."""
    def __init__(self, operator):
        feature = getattr(operator, "experiments", None)
        if feature is None or not all(callable(getattr(feature, name, None))
                                      for name in ("catalog", "read", "invoke", "preview")):
            raise TypeError("Install the original ExperimentOperator before joining saved experiments.")
        for name in ("_plan", "_state", "preview", "inspect", "list_experiments"):
            if not callable(getattr(experiments, name, None)):
                raise TypeError("The installed original experiment engine is missing " + name)
        self.operator, self.feature = operator, feature
        self.method = NativeAction(
            "ensemble", "experiment.run",
            "Original saved Scenario experiment: every retained profile/scenario case, "
            "same-profile native baselines, original parameter references and completed-stage reuse.",
            self.payload, self.catalog,
        )

    def original_plan(self, workspace, experiment_id):
        """Exact retained selection; the native resolved view may add recovery fields."""
        key = identifier(experiment_id)
        path = _inside(workspace.root, workspace.root / "experiments" / key / "plan.json",
                       existing=True)
        original = read_json(path)
        if (native_digest(original) != key
                or original.get("workspace_id") != workspace.project["id"]):
            raise IntelligenceError("The original experiment selection differs from its ID or project.", 409)
        return _copy(original)

    def selected(self, workspace, experiment_id):
        key = identifier(experiment_id)
        self.original_plan(workspace, key)
        # The original producer validates its schema, source/run binding and model
        # selection. Its current legacy recovery can add resolved model/case fields
        # in memory while the immutable plan.json and original ID remain unchanged.
        return _copy(experiments._plan(workspace, key))

    def catalog(self, tenant, workspace):
        for state in experiments.list_experiments(workspace):
            key = identifier(state["id"])
            plan = self.selected(workspace, key)
            yield {
                "id": key, "tenant_id": tenant,
                "job_id": plan["baseline"]["run_id"],
                "title": plan["selection"]["title"], "status": state["state"],
                "created_at": state.get("created_at"), "updated_at": state.get("updated_at"),
                "selection_sha256": key, "selection": plan["selection"],
                "counts": plan["counts"], "progress": state["progress"],
                "metadata": {"native_kind": "scenario_experiment", "baseline": plan["baseline"],
                             "native_state": state, "original_plan": self.original_plan(workspace, key),
                             "resolved_native_plan": plan},
            }

    def _file(self, tenant, workspace, key, plan, member, body, role):
        member = str(_member(member))
        size, sha = _identity(body)
        path = _inside(workspace.root, workspace.root / "experiments" / key / member)
        return {
            "id": _dataset_id("experiment", {"experiment_id": key, "member": member}),
            "tenant_id": tenant,
            "title": plan["selection"]["title"] + " / " + member,
            "path": str(path), "bytes": size, "sha256": sha,
            "metadata": {"native_kind": "scenario_experiment", "experiment_id": key,
                         "selection_sha256": key, "member": member, "role": role,
                         "original_selection": plan["selection"],
                         "baseline": plan["baseline"], "counts": plan["counts"],
                         "file": body},
        }

    def records(self, tenant, workspace):
        """Original immutable plans and all currently registered result files."""
        for state in experiments.list_experiments(workspace):
            key = identifier(state["id"])
            plan = self.selected(workspace, key)
            root = workspace.root / "experiments" / key
            plan_path = _inside(workspace.root, root / "plan.json", existing=True)
            plan_body = {"path": "plan.json", "bytes": plan_path.stat().st_size,
                         "sha256": file_digest(plan_path)}
            yield self._file(tenant, workspace, key, plan, "plan.json", plan_body, "selection")
            members = {"plan.json"}
            for body in state.get("files", {}).values():
                member = str(_member(body["path"]))
                if member in members:
                    raise IntelligenceError("The original experiment has duplicate result members.", 409)
                members.add(member)
                yield self._file(tenant, workspace, key, plan, member, body, "native_result")
            marker_path = root / "operator-report.json"
            if marker_path.is_file():
                marker = read_json(_inside(workspace.root, marker_path, existing=True))
                summary = state.get("files", {}).get("json")
                if summary and marker.get("summary_sha256") == summary.get("sha256"):
                    body = marker["report"]
                    member = str(_member(body["path"]))
                    if member not in members:
                        yield self._file(tenant, workspace, key, plan, member, body, "native_report")

    def prepare(self, engine, tenant, sid, action):
        engine.store.authorize(tenant, sid)
        engine.gateway.check("ensemble")
        if not action.native_experiment_id:
            raise IntelligenceError("Choose the saved Scenario experiment for this guided native plan.", 422)
        workspace = self.operator.ws(tenant)
        key = identifier(action.native_experiment_id)
        plan = self.selected(workspace, key)
        preview = experiments.preview(workspace, plan["selection"])
        for name in ("selection", "baseline", "counts"):
            if preview[name] != plan[name]:
                raise IntelligenceError("The retained native experiment selection changed.", 409)
        if action.job_id is not None and action.job_id != plan["baseline"]["run_id"]:
            raise IntelligenceError("The selected experiment uses a different original baseline run.", 409)
        grid = {axis["path"]: axis["values"] for axis in plan["selection"]["axes"]}
        if action.parameter_grid and action.parameter_grid != grid:
            raise IntelligenceError("Edit the saved Scenario experiment to change its selected parameter values.", 409)
        if not action.retain_member_rasters:
            raise IntelligenceError("The original saved experiment retains its native case outputs.", 422)
        count = plan["counts"]["cases"]
        if type(count) is not int or count < 1:
            raise IntelligenceError("The original experiment has an invalid native case count.", 409)
        selected_action = Action.model_validate({
            **action.model_dump(exclude_none=True),
            "job_id": plan["baseline"]["run_id"], "native_experiment_id": key,
            "parameter_grid": grid, "max_members": count, "retain_member_rasters": True,
        })
        job = public_metadata(engine.repo.row(tenant, "job", selected_action.job_id))
        selection_ref = {"kind": "dataset", "id": _dataset_id(
            "experiment", {"experiment_id": key, "member": "plan.json"})}
        _, selection_source = engine.repo.source(tenant, selection_ref)
        sources = [
            engine.registry_source(tenant, "job", job),
            selection_source,
        ]
        for ref in action.refs:
            _, source = engine.repo.source(tenant, ref.model_dump(exclude_none=True))
            sources.append(source)
        context = {
            "job": job, "members": count,
            "native_cases": count, "native_profiles": plan["counts"]["profiles"],
            "method": engine.gateway.method("ensemble"),
            "native_experiment": {"id": key, "selection_sha256": key,
                                  "plan": plan, "original_plan": self.original_plan(workspace, key),
                                  "preview": public_metadata(preview)},
        }
        result = engine.store.put_plan(tenant, sid, {
            "action": selected_action.model_dump(exclude_none=True),
            "sources": sources, "context": context,
        })
        engine.store.event(tenant, sid, "plan_prepared", {
            "plan_id": result["id"], "kind": "ensemble", "experiment_id": key,
            "native_cases": count, "selection_sha256": key,
        })
        return result

    def payload(self, workspace, action, paired, context):
        selected = context.get("native_experiment")
        if not isinstance(selected, dict) or not action.native_experiment_id:
            raise IntelligenceError("Prepare the original saved experiment through Investigations first.", 409)
        key = identifier(action.native_experiment_id)
        plan = self.selected(workspace, key)
        if (selected.get("id") != key or selected.get("selection_sha256") != key
                or selected.get("plan") != plan
                or (selected.get("original_plan") is not None
                    and selected["original_plan"] != self.original_plan(workspace, key))
                or action.job_id != plan["baseline"]["run_id"]):
            raise IntelligenceError("The native experiment differs from the retained guided plan.", 409)
        return {"experiment_id": key}

    def receive(self, tenant, experiment_id):
        workspace = self.operator.ws(tenant)
        key = identifier(experiment_id)
        plan = self.selected(workspace, key)
        state = experiments._state(workspace, key)
        return {
            "id": key, "selection_sha256": key, "state": state["state"],
            "counts": plan["counts"], "progress": state["progress"],
            "selection": plan["selection"], "baseline": plan["baseline"],
            "registered_files": state.get("files", {}),
            "read": {"operation": "inspect", "experiment_id": key, "offset": 0, "limit": 100},
        }

    def page(self, tenant, experiment_id, *, offset=0, limit=100):
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 1000:
            raise IntelligenceError("Choose a nonnegative case offset and a page size of 1–1000.", 422)
        return self.feature.read(tenant, "inspect", {
            "experiment_id": identifier(experiment_id), "offset": offset, "limit": limit,
        })
