#!/usr/bin/env python3
"""Continue one regional Workspace through original scientific desks and receiving."""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import traceback

APP = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(APP), str(APP / "operator")]
from model.common import atomic_bytes, atomic_json, describe_file, digest, held, now, read_json
from model.workspace import Workspace
from model.model_selection import run_models
from model import source_refresh
from source_tools import open_regional_workflow as regional

SCHEMA = "upstate.regional-receiving-progression/v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def item(path):
    return read_json(path) if Path(path).is_file() else None


class Progression:
    def __init__(self, args, regional_args):
        self.args = args
        self.workspace = args.workspace.resolve()
        self.operator_state = args.operator_state.resolve()
        self.output = args.output.resolve()
        for path in (self.output, self.operator_state):
            require(not path.is_relative_to(self.workspace),
                    "Keep receiving output and operator state outside the original Workspace")
        require(not self.output.is_relative_to(self.operator_state),
                "Keep receiving output separate from the operator's state directory")
        self.output.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.output / "progression.json"
        self.regional_args = regional_args
        existing = item(self.path)
        documents = {}
        for key in ("opening", "run_selection", "chemistry_selection", "monitoring_selection"):
            path = getattr(args, key)
            if path:
                resolved = str(path.resolve(strict=True))
                previous = ((existing or {}).get("request", {}).get("documents", {}).get(key))
                # Our final opening replaces the Workspace's current opening. Resume
                # from the frozen original copy, not from that deliberate postimage.
                if key == "opening" and previous and previous.get("path") == resolved and (existing or {}).get("steps", {}).get("opening"):
                    documents[key] = previous
                else:
                    documents[key] = {"path": resolved,
                                      "sha256": describe_file(path.parent, path)["sha256"]}
        if args.chemistry_selection:
            chemical_choice = read_json(args.chemistry_selection)
            require(isinstance(chemical_choice, dict), "Chemistry selection must be an object")
            references = {}
            for field in ("edited-project", "request"):
                value = chemical_choice.get(field)
                if value:
                    require(isinstance(value, str), "Use the actual file path for chemistry " + field)
                    path = (args.chemistry_selection.parent / value).resolve(strict=True)
                    references[field] = {"path": str(path),
                                         "sha256": describe_file(path.parent, path)["sha256"]}
            documents["chemistry_references"] = references
        self.request = {"schema": SCHEMA, "workspace": str(self.workspace),
                        "operator_state": str(self.operator_state),
                        "regional_arguments": regional_args,
                        "documents": documents, "run_models": not args.prepare_only}
        require(existing is None or existing.get("request") == self.request,
                "This receiving directory retains another selection; continue its exact original command")
        self.state = existing or {"schema": SCHEMA, "request": self.request,
                    "operation_id": digest(self.request), "created_at": now(),
                    "status": "running", "steps": {}, "history": []}
        self.server = None
        self.operator = None
        self.worker = None
        self.key = None
        self.secret = ""
        self.current_step = "opening"
        self.node = shutil.which(args.node)
        require(self.node, "Use the existing Node executable with Playwright and Chromium")
        self.private_url = self.output / "operator-private-url.txt"

    def write(self):
        self.state["updated_at"] = now()
        atomic_json(self.path, self.state)

    def record(self, name, value):
        self.state["steps"][name] = value
        self.state["history"].append({"at": now(), "step": name})
        self.write()
        print(json.dumps({"stage": name, "status": "complete",
                          "operation_id": self.state["operation_id"]}), flush=True)
        return value

    def redact(self, text):
        for value in (self.secret, self.secret.split("#token=")[-1] if self.secret else ""):
            if value:
                text = text.replace(value, "[private operator]")
        return text

    def command(self, name, command):
        self.current_step = name
        attempt = sum(row.get("step") == name + "_started"
                      for row in self.state["history"]) + 1
        self.state["history"].append({"at": now(), "step": name + "_started",
                                     "attempt": attempt})
        self.write()
        log = self.output / (name + "-" + str(attempt) + ".log")
        with log.open("wb") as stream:
            os.chmod(log, 0o600)
            result = subprocess.run(command, cwd=APP, stdout=stream, stderr=subprocess.STDOUT)
        if result.returncode:
            body = log.read_text(encoding="utf-8", errors="replace")
            raise RuntimeError(name + " returned " + str(result.returncode) +
                               "; original output: " + str(log) + "\n" +
                               self.redact(body[-12000:]))
        return {"log": describe_file(self.output, log), "exit_code": result.returncode}

    def open(self):
        opening_file = self.output / "original-opening.json"
        if "opening" not in self.state["steps"]:
            if "original_saved_view" not in self.state:
                self.state["original_saved_view"] = item(self.workspace / "operator-session.json")
                self.write()
            if self.args.opening:
                original = self.frozen_input(self.request["documents"]["opening"], "regional-opening.json")
                opening = read_json(original)
                atomic_json(opening_file, opening, immutable=True)
            else:
                forbidden = {"--workspace", "--operator-state", "--opening-output",
                             "--transfer-output", "--save-view", "--prepare-only", "--port"}
                require(not any(value.split("=", 1)[0] in forbidden
                                for value in self.regional_args),
                        "The continuation owns Workspace, output and server arguments; pass only original regional source/science choices")
                command = [sys.executable, "-B", str(APP / "source_tools/open_regional_workflow.py"),
                           "--workspace", str(self.workspace),
                           "--operator-state", str(self.operator_state),
                           "--opening-output", str(opening_file), "--save-view", "--prepare-only",
                           *self.regional_args]
                self.command("regional_opening", command)
                opening = read_json(opening_file)
            workspace = Workspace(self.workspace)
            require(opening.get("schema") == regional.SCHEMA and
                    opening.get("workspace_id") == workspace.project["id"],
                    "Open the retained regional selection in its original scientific project")
            self.record("opening", {"file": describe_file(self.output, opening_file),
                                   "project_id": workspace.project["id"]})
        opening = read_json(opening_file)
        require(describe_file(self.output, opening_file) == self.state["steps"]["opening"]["file"],
                "The retained original opening changed")
        module = regional.load_operator()
        self.server, receipt = module.start_server(
            self.workspace, state_directory=self.operator_state, port=self.args.port)
        self.operator = self.server.operator
        self.key = receipt["workspace_key"]
        self.secret = receipt["operator_url"]
        require(receipt["project"]["id"] == opening["workspace_id"],
                "The original server opened another project")
        self.private_url.write_text(self.secret + "\n", encoding="utf-8")
        os.chmod(self.private_url, 0o600)
        self.worker = threading.Thread(target=self.server.serve_forever,
                                       kwargs={"poll_interval": 0.2}, daemon=True)
        self.worker.start()
        self.state["operator_workspace_key"] = self.key
        self.write()
        for method, path in (("GET", "/api/profile-workbench/inspect"),
                             ("POST", "/api/source-refresh/preview"),
                             ("GET", "/api/watershed-context/export")):
            require(self.operator.extensions.has_route(method, path),
                    "Install the current registered scientific route " + path)
        self.operator.extensions.read("GET", "/api/watershed-context/export",
                                      self.key, {"export_id": opening["watershed_export_id"]})
        return opening

    def queued(self, name, action, payload):
        self.current_step = name
        operation = "regional_progression_" + digest({
            "operation": self.state["operation_id"], "stage": name,
            "action": action, "payload": payload})
        task = regional.queued(self.operator, self.key, action, payload, operation,
                               self.args.timeout)
        self.record(name, {"task_id": task["id"], "action": action,
                           "result": task["result"]})
        return task["result"]

    def baseline(self, opening):
        if self.args.prepare_only:
            return None
        workspace = self.operator.ws(self.key)
        retained_run = None
        if self.args.run_selection:
            selected = read_json(self.frozen_input(
                self.request["documents"]["run_selection"], "native-run-selection.json"))
        else:
            previous = (self.state.get("original_saved_view") or {}).get("journey", {}).get("selection", {})
            # The original baseline remains the reference when a saved opening
            # also carries a land-cover alternative. Never promote that
            # alternative to baseline or substitute another profile silently.
            run_id = opening.get("baseline_run_id") or previous.get("baseline_run_id")
            run_id = run_id or opening.get("alternative_run_id") or previous.get("run_id")
            retained_run = workspace.inspect_run(run_id) if run_id else None
            selected = retained_run["selection"] if retained_run else previous
        require(isinstance(selected, dict) and selected.get("grid_id") and selected.get("scenario_id"),
                "Choose an actual retained grid/scenario through --run-selection or the original saved view/run selection")
        if retained_run is not None:
            # Reopening an existing run also preserves its exact legacy/native
            # selection identity; prepare_run belongs to an explicit new selection.
            run_id = retained_run["id"]
        else:
            payload = {key: selected[key] for key in ("grid_id", "scenario_id")}
            payload["profile_id"] = selected.get("profile_id") or opening["profile_id"]
            if selected.get("models"):
                payload["models"] = deepcopy(selected["models"])
            prepared = self.queued("baseline_prepare", "run.prepare", payload)
            run_id = prepared["id"]
        if workspace.inspect_run(run_id)["state"] != "complete":
            self.queued("baseline_run", "run.start", {"run_id": run_id})
        run = workspace.inspect_run(run_id)
        require(run["state"] == "complete", "The original native baseline is still " + run["state"])
        self.record("baseline", {"run_id": run_id, "selection": run["selection"]})
        return run_id

    def browser_identity(self, name, script, arguments, workspace, journal, bound):
        """Bind a finished original browser journal to this receiving stage."""
        require(journal.get("status") == "complete" and not journal.get("browser_errors"),
                "Open a completed original browser journal without application errors")
        choices = {arguments[index]: arguments[index + 1]
                   for index in range(len(arguments) - 1)
                   if arguments[index].startswith("--") and
                   not arguments[index + 1].startswith("--")}
        if script == "source/run_profile_workbench_browser.mjs":
            require(journal.get("schema") == "upstate.profile-workbench-journey/v1"
                    and journal.get("workspace_id") == workspace
                    and journal.get("baseline_profile_id") == choices.get("--profile")
                    and journal.get("title") ==
                        "Working source alternative · Cape Fear corn C=0.25 · " + choices["--run-label"],
                    "The completed profile browser belongs to another original selection")
            require(journal.get("saved_profile_id") and journal.get("save_task_id"),
                    "The completed profile browser has no retained save identity")
            for profile_id, field in (
                    (journal["baseline_profile_id"], "baseline_table_sha256"),
                    (journal["saved_profile_id"], "saved_table_sha256")):
                actual = self.operator.extensions.read(
                    "GET", "/api/profile-workbench/inspect", workspace,
                    {"profile_id": profile_id})
                require(actual["table"]["sha256"] == journal.get(field),
                        "The completed profile browser differs from its retained table")
        elif script == "source/run_source_updates_browser.mjs":
            require(journal.get("schema") == "upstate.source-updates-browser/v1"
                    and journal.get("workspace_key") == workspace and journal.get("plan_id"),
                    "The completed source browser belongs to another Workspace or plan")
            expected = {"from_collection_id": choices["--from-collection"],
                        "to_collection_id": choices["--to-collection"],
                        "source_id_map": read_json(choices["--mapping"]),
                        "title": choices["--title"]}
            plan = source_refresh.get_plan(self.operator.ws(workspace), journal["plan_id"])
            require(plan["selection"] == expected,
                    "The completed source browser selected other retained source editions")
            require(plan.get("state", {}).get("state") ==
                    ("complete" if "--run-models" in arguments else "prepared"),
                    "The completed source browser has unfinished original native work")
        elif script == "source/run_saved_regional_view_browser.mjs":
            opening = read_json(choices["--opening"])
            require(journal.get("schema") == "upstate.regional-saved-view-browser-journey/v1"
                    and journal.get("operator_workspace_key") == workspace
                    and journal.get("workspace_id") == self.operator.ws(workspace).project["id"]
                    and journal.get("opening") == opening,
                    "The completed saved-view browser belongs to another retained opening")
        elif script == "source/run_chemistry_browser.mjs":
            if not bound:
                return False
            require(journal.get("schema") == "upstate.chemistry-browser/v1"
                    and journal.get("workspace_key") == workspace,
                    "The completed chemistry browser belongs to another retained request")
        else:
            # Optional browser integrations retain the exact invocation before
            # dispatch; older unbound journals keep their original retry path.
            if not bound:
                return False
        task_ids = {row.get("task_id") for row in journal.get("steps", [])
                    if row.get("task_id")}
        if journal.get("save_task_id"):
            task_ids.add(journal["save_task_id"])
        for task_id in task_ids:
            task = self.operator.task(task_id)
            require(task["workspace"] == workspace and task["state"] == "complete",
                    "The completed browser journal has an unfinished or foreign task")
        return True

    def browser(self, name, script, arguments, *, workspace=None):
        self.current_step = name
        report_path = self.output / name / "journey.json"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        key = workspace or self.key
        intent = {"operation_id": self.state["operation_id"], "script": script,
                  "workspace_key": key, "project_id": self.operator.ws(key).project["id"],
                  "arguments": arguments}
        intent_path = report_path.parent / "request.json"
        previous_intent = item(intent_path)
        require(previous_intent is None or previous_intent == intent,
                "This browser output retains another native request: " + name)
        if name in self.state["steps"]:
            saved = self.state["steps"][name]
            require(describe_file(self.output, report_path) == saved["journal"],
                    "The retained browser journal changed: " + name)
            return read_json(report_path)
        # Resume the same native queue requests recorded before a prior browser exit.
        previous = item(report_path) or {}
        if previous.get("status") == "complete" and self.browser_identity(
                name, script, arguments, key, previous, previous_intent == intent):
            atomic_json(intent_path, intent, immutable=True)
            self.record(name, {"adopted_completed_journal": True,
                               "journal": describe_file(self.output, report_path)})
            return previous
        if previous.get("status") == "complete":
            # An unbound completed journal cannot acquire this new request's
            # provenance if we stop before the browser replaces it. Preserve
            # its exact bytes first, then vacate the active journal path.
            original = report_path.read_bytes()
            require(json.loads(original) == previous,
                    "The completed browser journal changed during recovery: " + name)
            retained = report_path.with_name(
                "journey-unbound-" + hashlib.sha256(original).hexdigest() + ".json")
            atomic_bytes(retained, original, immutable=True)
            require(report_path.read_bytes() == original,
                    "The browser journal changed while retaining its original bytes: " + name)
            report_path.unlink()
        atomic_json(intent_path, intent, immutable=True)
        task_ids = {row.get("task_id") for row in previous.get("steps", []) if row.get("task_id")}
        if previous.get("save_task_id"):
            task_ids.add(previous["save_task_id"])
        for task_id in sorted(task_ids):
            task = self.operator.task(task_id)
            require(task["workspace"] == (workspace or self.key),
                    "The browser journal references another Workspace")
            if task["state"] != "complete":
                regional.queued(self.operator, task["workspace"], task["action"], task["payload"],
                                task["operation_id"], self.args.timeout)
        command = [self.node, str(APP / script), "--url-file", str(self.private_url),
                   "--workspace", workspace or self.key, "--output", str(report_path.parent),
                   *arguments]
        if name == "chemistry" and (report_path.parent / "request-state.json").is_file():
            command.append("--resume")
        if self.args.video:
            command.append("--video")
        if self.args.headed:
            command.append("--headed")
        if self.args.browser_channel:
            command.extend(["--browser-channel", self.args.browser_channel])
        result = self.command(name, command)
        journal = read_json(report_path)
        require(journal.get("status") == "complete",
                name + " retained an incomplete journey: " + str(report_path))
        require(self.browser_identity(name, script, arguments, key, journal, True),
                "The completed browser did not retain its original selection")
        self.record(name, {**result, "journal": describe_file(self.output, report_path)})
        return journal

    def revise(self, opening):
        journal = self.browser("profile-browser", "source/run_profile_workbench_browser.mjs",
            ["--profile", opening["profile_id"], "--run-label", self.state["operation_id"]])
        require(journal.get("baseline_profile_id") == opening["profile_id"],
                "The profile journey edited another baseline")
        new_id = journal.get("saved_profile_id")
        require(new_id and new_id != opening["profile_id"], "Open the saved immutable profile revision")
        before = self.operator.extensions.read("GET", "/api/profile-workbench/inspect",
                     self.key, {"profile_id": opening["profile_id"]})
        after = self.operator.extensions.read("GET", "/api/profile-workbench/inspect",
                     self.key, {"profile_id": new_id})
        require(before["table"]["sha256"] == journal["baseline_table_sha256"] and
                after["table"]["sha256"] == journal["saved_table_sha256"],
                "The reopened profile source differs from the original browser selection")
        left, right = before["profile"], after["profile"]
        mapping = {left["biophysical_source_id"]: right["biophysical_source_id"]}
        selection = {"from_collection_id": left["source_collection_id"],
                     "to_collection_id": right["source_collection_id"],
                     "source_id_map": mapping,
                     "title": "Regional profile source continuation " + self.state["operation_id"][:16]}
        require(selection["from_collection_id"] != selection["to_collection_id"],
                "The saved profile needs its distinct retained source edition")
        preview = self.operator.extensions.read("POST", "/api/source-refresh/preview",
                                                self.key, {"selection": selection})
        atomic_json(self.output / "source-preview.json", preview)
        require(not preview.get("problems"),
                "Original source preview: " + json.dumps(preview.get("problems")))
        require(any(row["id"] == opening["profile_id"] for row in preview["affected"]["profiles"]),
                "The original source preview does not contain the selected baseline profile")
        atomic_json(self.output / "source-id-map.json", mapping, immutable=True)
        self.record("source_selection", {"selection": selection, "saved_profile_id": new_id,
                    "preview": describe_file(self.output, self.output / "source-preview.json")})
        return selection

    def refresh(self, selection):
        preview = self.operator.extensions.read("POST", "/api/source-refresh/preview",
                                                self.key, {"selection": selection})
        atomic_json(self.output / "source-preview.json", preview)
        require(not preview.get("problems"),
                "Original source preview: " + json.dumps(preview.get("problems")))
        if not self.args.prepare_only:
            baseline = self.state["steps"]["baseline"]["run_id"]
            require(any(row["id"] == baseline and row["requires_native_rerun"]
                        for row in preview["affected"]["runs"]),
                    "The original full-domain source preview does not require the selected native baseline")
        arguments = ["--from-collection", selection["from_collection_id"],
                     "--to-collection", selection["to_collection_id"],
                     "--mapping", str(self.output / "source-id-map.json"),
                     "--title", selection["title"],
                     "--task-timeout-seconds", str(self.args.timeout)]
        if not self.args.prepare_only:
            arguments.append("--run-models")
        journal = self.browser("source-updates", "source/run_source_updates_browser.mjs", arguments)
        plan = source_refresh.get_plan(self.operator.ws(self.key), journal["plan_id"])
        require(plan["selection"] == selection, "The native source plan changed the selected original editions")
        state = plan.get("state") or {}
        expected = "prepared" if self.args.prepare_only else "complete"
        require(state.get("state") == expected,
                "The retained source update is " + str(state.get("state")) + ": " +
                json.dumps(state.get("errors", [])))
        if not self.args.prepare_only:
            baseline = self.state["steps"]["baseline"]["run_id"]
            target = state["mappings"]["runs"].get(baseline)
            require(target and self.operator.ws(self.key).inspect_run(target)["state"] == "complete",
                    "The original selected baseline has no complete refreshed native run")
        self.record("source_refresh", {"plan_id": plan["id"], "state": state})
        return plan

    def updated_opening(self, opening, plan):
        retained = self.state["steps"].get("refreshed_view")
        opening_path = self.output / "refreshed-opening.json"
        if retained:
            require(describe_file(self.output, opening_path) == retained["opening"],
                    "The retained refreshed opening changed")
            result = read_json(opening_path)
            require(result["source_update_plan_id"] == plan["id"],
                    "The retained opening belongs to another source update")
            return result
        state = plan["state"]
        profile_id = state["mappings"]["profiles"].get(opening["profile_id"])
        require(profile_id, "The original plan has no mapped regional scientific profile")
        inspected = self.operator.extensions.read("GET", "/api/profile-workbench/inspect",
                                                   self.key, {"profile_id": profile_id})
        profile = inspected["profile"]
        result = deepcopy(opening)
        result.update(profile_id=profile_id,
                      profile_source_collection_id=profile["source_collection_id"],
                      biophysical_source_id=profile["biophysical_source_id"],
                      profile_table_sha256=inspected["table"]["sha256"])
        result["source_update_plan_id"] = plan["id"]
        result["working_profile_revision_id"] = self.state["steps"]["source_selection"]["saved_profile_id"]
        original_fields = ("baseline_run_id", "alternative_run_id",
                           "baseline_run_selection", "alternative_run_selection")
        result["source_update_original_native_selection"] = {
            key: deepcopy(opening[key]) for key in original_fields if key in opening}
        for key in original_fields:
            result.pop(key, None)
        if not self.args.prepare_only:
            baseline = self.state["steps"]["baseline"]["run_id"]
            refreshed = state["mappings"]["runs"][baseline]
            before = self.operator.ws(self.key).inspect_run(baseline)
            after = self.operator.ws(self.key).inspect_run(refreshed)
            original_alternative = opening.get("alternative_run_id")
            if (opening.get("baseline_run_id") == baseline and original_alternative
                    and original_alternative != baseline):
                # Source updates already retain all affected runs. Keep the
                # selected scenario comparison as a pair at its mapped source
                # editions; its separate old/new-source comparisons remain in
                # the original source-update plan and reports.
                original_pair = {"baseline": baseline, "alternative": original_alternative}
                mapped_pair = {}
                lineage = {}
                for role, original_id in original_pair.items():
                    original_run = self.operator.ws(self.key).inspect_run(original_id)
                    mapped_id = state["mappings"]["runs"].get(original_id, original_id)
                    mapped_run = self.operator.ws(self.key).inspect_run(mapped_id)
                    require(mapped_run["state"] == "complete",
                            "The selected " + role + " has no complete mapped native run")
                    expected = {}
                    for kind in ("grids", "profiles", "scenarios"):
                        field = kind[:-1] + "_id"
                        original_value = original_run["selection"][field]
                        expected[field] = state["mappings"][kind].get(original_value, original_value)
                    require(all(mapped_run["selection"].get(field) == value
                                for field, value in expected.items()) and
                            run_models(mapped_run) == run_models(original_run),
                            "The selected " + role + " changed its original model scope or source mapping")
                    mapped_pair[role] = mapped_run
                    lineage[role] = {"from_run_id": original_id, "to_run_id": mapped_id}
                require(mapped_pair["baseline"]["selection"]["grid_id"] ==
                        mapped_pair["alternative"]["selection"]["grid_id"],
                        "The mapped scenario pair requires its original common grid")
                result.update(
                    baseline_run_id=mapped_pair["baseline"]["id"],
                    baseline_run_selection=mapped_pair["baseline"]["selection"],
                    alternative_run_id=mapped_pair["alternative"]["id"],
                    alternative_run_selection=mapped_pair["alternative"]["selection"],
                    source_update_selected_run_mappings=lineage)
            elif before["selection"]["grid_id"] == after["selection"]["grid_id"]:
                result.update(baseline_run_id=baseline,
                              baseline_run_selection=before["selection"],
                              alternative_run_id=refreshed,
                              alternative_run_selection=after["selection"])
            else:
                result.update(baseline_run_id=refreshed,
                              baseline_run_selection=after["selection"],
                              previous_baseline_run_id=baseline)
        atomic_json(self.workspace / "regional-workflow-opening.json", result)
        atomic_json(self.output / "refreshed-opening.json", result)
        saved = regional.save_native_view(self.operator, self.key, result)
        self.record("refreshed_view", {"profile_id": profile_id,
                                      "opening": describe_file(self.output, opening_path),
                                      "saved_view_revision": saved["revision"]})
        return result

    def frozen_input(self, descriptor, filename):
        source = Path(descriptor["path"])
        body = source.read_bytes()
        require(hashlib.sha256(body).hexdigest() == descriptor["sha256"],
                "The selected scientific input changed: " + str(source))
        target = self.output / "inputs" / filename
        atomic_bytes(target, body, immutable=True)
        return target

    def chemistry(self):
        if not self.args.chemistry_selection:
            return
        document = self.request["documents"]["chemistry_selection"]
        choice = read_json(self.frozen_input(document, "chemistry-selection.json"))
        allowed = {"case-id", "source-collection", "source-id", "edited-project",
                   "reason", "request", "receive"}
        require(isinstance(choice, dict) and not set(choice) - allowed,
                "Chemistry selection uses the original driver's declared scientific inputs")
        require(bool(choice.get("case-id")) != bool(choice.get("source-collection") and choice.get("source-id")),
                "Choose one retained chemical case or one actual retained project source")
        arguments = []
        for name, value in choice.items():
            if name == "receive":
                require(isinstance(value, bool), "Chemistry receive must be true or false")
                if value:
                    arguments.append("--receive")
            else:
                require(isinstance(value, str) and value, "Use an original chemistry selection for " + name)
                if name in {"edited-project", "request"}:
                    descriptor = self.request["documents"]["chemistry_references"][name]
                    value = str(self.frozen_input(descriptor, "chemistry-" + name + ".json"))
                arguments.extend(["--" + name, value])
        self.browser("chemistry", "source/run_chemistry_browser.mjs", arguments)

    def monitoring(self):
        if not self.args.monitoring_selection:
            return
        report = self.output / "monitoring" / "receiving.json"
        previous = self.state["steps"].get("monitoring")
        if previous:
            require(describe_file(self.output, report) == previous["journal"],
                    "The retained monitoring continuation changed")
            result = {key: value for key, value in previous.items()
                      if key not in {"journal", "outcome"}}
        else:
            selected = self.frozen_input(self.request["documents"]["monitoring_selection"],
                                         "monitoring-selection.json")
            result = self.command("monitoring", [
                sys.executable, "-B", str(APP / "operator/monitoring_receiving.py"),
                "--workspace", str(self.workspace), "--selection", str(selected),
                "--output", str(report.parent)])
        require(report.is_file(), "Open the original monitoring receiving result")
        retained = read_json(report)
        if (retained.get("summary") or {}).get("complete") is True:
            require(retained.get("campaign_id") and retained.get("received")
                    and retained.get("independent_revision"),
                    "The monitoring campaign has no complete independent receiving record")
            outcome = {"kind": "campaign_received", "campaign_created": True,
                       "network_id": retained["network_id"], "plan_id": retained["plan_id"],
                       "campaign_id": retained["campaign_id"],
                       "independent_revision": retained["independent_revision"]}
        else:
            design = retained.get("design_outcome")
            require(isinstance(design, dict) and design.get("status")
                    and design["status"] not in {"optimal", "feasible"},
                    "The monitoring result has neither a received campaign nor its original design diagnostic")
            outcome = {"kind": "design_diagnostic", "design_status": design["status"],
                       "network_id": retained["network_id"], "plan_id": retained["plan_id"],
                       "campaign_created": False}
        if not previous or previous.get("outcome") != outcome:
            self.record("monitoring", {**result, "journal": describe_file(self.output, report),
                                      "outcome": outcome})
        return outcome

    def completed_transfer(self, opening, saved_view, plan):
        """Reopen a finished receiving task without staging its archive again."""
        output = self.output / "complete-transfer"
        outcome = item(output / "received-project.json")
        if outcome is None:
            return None
        original = self.operator.ws(self.key)
        intent = {"schema": "upstate.regional-opening-transfer/v1",
                  "workspace_id": original.project["id"],
                  "opening": {name: value for name, value in opening.items()
                              if name not in {"operator_workspace_key", "workspace"}},
                  "saved_view_revision": saved_view["revision"]}
        require(item(output / "selection.json") == intent,
                "The retained complete transfer belongs to another opening")
        require(outcome.get("schema") == "upstate.regional-opening-received/v1"
                and outcome.get("opening") == opening
                and outcome.get("saved_view_revision") == saved_view["revision"],
                "The completed receiving receipt differs from this original saved view")
        operation = "regional_transfer_" + digest({
            "destination": str(output.resolve()), "selection": intent})
        backup = self.operator.task(outcome["backup_task_id"])
        restored = self.operator.task(outcome["receive_task_id"])
        for task, action, suffix in ((backup, "workspace.backup", "_backup"),
                                     (restored, "workspace.restore", "_receive")):
            require(task["workspace"] == self.key and task["action"] == action
                    and task["operation_id"] == operation + suffix
                    and task["state"] == "complete",
                    "The original archive/receiving task is not this completed transfer")
        archive = outcome["archive"]
        require(backup["payload"] == {"include_intermediates": True}
                and {key: backup["result"][key] for key in ("bytes", "sha256")} == archive,
                "The retained receiving archive differs from its complete backup")
        result = outcome["receiving"]
        require(restored["result"] == result and result.get("identity") == "MATCH"
                and result.get("archive_sha256") == archive["sha256"]
                and result.get("workspace_key") != self.key,
                "The completed restore task identifies another receiving project")
        received = self.operator.ws(result["workspace_key"])
        require(received.project == original.project and received.root != original.root,
                "Open the original independent receiving project")
        require(read_json(received.root / "regional-workflow-opening.json") == opening,
                "The receiving project's retained opening changed")
        inspected = self.operator.extensions.read(
            "GET", "/api/watershed-context/export", result["workspace_key"],
            {"export_id": opening["watershed_export_id"]})
        require(inspected["report_id"] == opening["watershed_report_id"]
                and inspected["report_sha256"] == opening["watershed_report_sha256"]
                and sorted(inspected["huc12s"]) == opening["selected_huc12s"],
                "The receiving project selected different original watersheds")
        profile = self.operator.extensions.read(
            "GET", "/api/profile-workbench/inspect", result["workspace_key"],
            {"profile_id": opening["profile_id"]})
        require(profile["profile_id"] == opening["profile_id"]
                and profile["table"]["sha256"] == opening["profile_table_sha256"],
                "The receiving project's retained scientific profile changed")
        reopened_view = self.operator.operator_session(result["workspace_key"])
        require(reopened_view is not None and reopened_view.get("journey") == saved_view["journey"],
                "The receiving project's saved scientific view or notes changed")
        reopened = source_refresh.get_plan(received, plan["id"])
        require(reopened["selection"] == plan["selection"] and reopened["state"] == plan["state"],
                "The received source plan or native execution state differs")
        return result

    def run(self):
        if self.state.get("status") == "complete":
            return self.state["result"]
        self.state["status"] = "running"
        self.state.pop("error", None)
        self.write()
        opening = self.open()
        selection = self.revise(opening)
        self.baseline(opening)
        plan = self.refresh(selection)
        refreshed = self.updated_opening(opening, plan)
        self.chemistry()
        monitoring_outcome = self.monitoring()
        self.browser("saved-view", "source/run_saved_regional_view_browser.mjs",
            ["--opening", str(self.output / "refreshed-opening.json"), "--skip-transfer",
             "--task-timeout-seconds", str(self.args.timeout)])
        saved_view = self.operator.operator_session(self.key)
        require(saved_view and saved_view["journey"]["selection"]["profile_id"] == refreshed["profile_id"],
                "The original saved view lost its refreshed scientific profile")
        self.current_step = "complete_transfer"
        if "complete_transfer" in self.state["steps"]:
            receiving = self.state["steps"]["complete_transfer"]
        else:
            view_path = self.output / "transfer-view.json"
            if view_path.exists():
                frozen_view = read_json(view_path)
                require(frozen_view == saved_view,
                        "The native saved view changed during this retained transfer; inspect its original task before continuing")
            else:
                atomic_json(view_path, saved_view, immutable=True)
            receiving = self.completed_transfer(refreshed, saved_view, plan)
            if receiving is None:
                receiving = regional.transfer(self.operator, self.key, refreshed,
                                              self.output / "complete-transfer",
                                              self.args.timeout, saved_view)
            self.record("complete_transfer", receiving)
        received = self.operator.ws(receiving["workspace_key"])
        reopened = source_refresh.get_plan(received, plan["id"])
        require(reopened["selection"] == plan["selection"] and reopened["state"] == plan["state"],
                "The received source plan or native execution state differs")
        self.browser("received-view", "source/run_saved_regional_view_browser.mjs",
            ["--opening", str(self.output / "refreshed-opening.json"), "--skip-transfer",
             "--task-timeout-seconds", str(self.args.timeout)],
            workspace=receiving["workspace_key"])
        result = {"status": "complete", "operation_id": self.state["operation_id"],
                  "journal": str(self.path), "workspace_key": self.key,
                  "source_update_plan_id": plan["id"],
                  "receiving_workspace_key": receiving["workspace_key"]}
        if monitoring_outcome is not None:
            result["monitoring_outcome"] = monitoring_outcome
        self.state["status"] = "complete"
        self.state["result"] = result
        self.state.pop("error", None)
        self.state["completed_at"] = now()
        self.write()
        return result

    def close(self):
        if self.server:
            if self.worker:
                self.server.shutdown()
                self.worker.join()
            self.server.server_close()
            self.server.operator.close()
        if self.private_url.exists():
            self.private_url.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--operator-state", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--opening", type=Path, help="Retained regional opening; otherwise pass original regional arguments after --")
    parser.add_argument("--run-selection", type=Path, help="Actual native grid/scenario/models JSON; otherwise reuse the opening's run or original saved view")
    parser.add_argument("--chemistry-selection", type=Path, help="Original chemistry driver case/source/request selection JSON")
    parser.add_argument("--monitoring-selection", type=Path, help="Original monitoring receiver network/cost/calendar selection JSON")
    parser.add_argument("--prepare-only", action="store_true", help="Prepare source dependencies without executing native models")
    parser.add_argument("--node", default="node")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--timeout", type=float, default=7200)
    parser.add_argument("--video", action="store_true")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--browser-channel")
    known, separator, regional_args = list(argv if argv is not None else sys.argv[1:]), None, []
    if "--" in known:
        separator = known.index("--")
        known, regional_args = known[:separator], known[separator + 1:]
    args = parser.parse_args(known)
    require(bool(args.opening) != bool(regional_args),
            "Supply either --opening or the original regional preparation arguments after --")
    require(0 <= args.port <= 65535 and 0 < args.timeout <= 86400,
            "Choose a valid port and a native operation timeout up to 86400 seconds")
    workspace = args.workspace.resolve()
    require(not args.output.resolve().is_relative_to(workspace) and
            not args.operator_state.resolve().is_relative_to(workspace),
            "Keep receiving output and operator state outside the original Workspace")
    require(not args.output.resolve().is_relative_to(args.operator_state.resolve()),
            "Keep receiving output separate from operator state")
    args.output.resolve().mkdir(parents=True, exist_ok=True, mode=0o700)
    with held(args.output.resolve() / ".progression.lock", blocking=False):
        operation = Progression(args, regional_args)
        try:
            result = operation.run()
            print(json.dumps(result), flush=True)
            return 0
        except BaseException as error:
            operation.state["status"] = "failed"
            operation.state["error"] = {"stage": operation.current_step,
                "type": type(error).__name__, "message": operation.redact(str(error)),
                "traceback": operation.redact(traceback.format_exc())}
            operation.write()
            print(json.dumps({"status": "failed", "stage": operation.current_step,
                              "journal": str(operation.path),
                              "error": operation.redact(str(error))}), flush=True)
            return 1
        finally:
            operation.close()


if __name__ == "__main__":
    raise SystemExit(main())
