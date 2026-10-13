"""Source recipe editions and uses on the original operator action queue."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from model.common import (atomic_json, describe_file, digest, held, identifier,
                          now, read_json, relative_file, retain_file, verify_file)
from model.client_source_files import need
from model.client_source_recipes import (append_event, build_definition, build_use, edition,
                                         plan_use, validate_record, validate_use, definition_descriptors,
                                         use_descriptors, applied_descriptors, validate_custody,
                                         validate_use_custody, validate_applied, validate_applied_custody,
                                         validate_operation)
from client_source_intake import ClientSourceIntake

ACTIONS = {"client-source-recipe.create", "client-source-recipe.revise",
           "client-source-recipe.prepare-use", "client-source-recipe.attach-result",
           "client-source-recipe.export", "client-source-recipe.receive"}


class ClientSourceRecipes:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault
        self.intake = ClientSourceIntake(operator, fault)

    @staticmethod
    def root(ws):
        return ws.root / "client-source-recipes"

    @classmethod
    def recipe_directory(cls, ws, recipe_id):
        return cls.root(ws) / "recipes" / identifier(recipe_id)

    @classmethod
    def use_directory(cls, ws, use_id):
        return cls.root(ws) / "uses" / identifier(use_id)

    @classmethod
    def operation_directory(cls, ws, request_id):
        return cls.root(ws) / "operations" / identifier(request_id)

    def _load_recipe(self, ws, recipe_id):
        value = validate_record(read_json(self.recipe_directory(ws, recipe_id) / "record.json"))
        need(value["id"] == recipe_id, "The retained recipe path selects another record.")
        return value

    def _load_use(self, ws, use_id):
        value = validate_use(read_json(self.use_directory(ws, use_id) / "use.json"))
        need(value["id"] == use_id, "The retained source-use path selects another request.")
        return self._verify_use(ws, value)

    def _capture(self, ws, commit_id, name, description):
        commit = self.intake._load(ws, identifier(commit_id))
        need(commit["state"] == "complete" and commit["action"] == "client-source.commit",
             "Select an actual completed scientific source commit.")
        inspection = self.intake._load(ws, identifier(commit["inspection_id"]))
        selection = read_json(verify_file(ws.root, commit["selection_file"]))
        collection = ws._get("sources", commit["source_collection_id"])
        return build_definition(name=name, description=description, inspection=inspection,
                                selection=selection, commit=commit, collection=collection)

    def _retain_descriptors(self, ws, descriptors):
        objects = {}
        for selected in descriptors:
            cas = {"object": "objects/" + selected["sha256"], "sha256": selected["sha256"], "bytes": selected["bytes"]}
            if (ws.root / cas["object"]).exists():
                source = self.intake._raw(ws, cas)
            else:
                source = relative_file(ws.root, selected["object"]) if "object" in selected else verify_file(ws.root, selected)
            body = retain_file(ws.root, source, selected["sha256"])
            need(body["bytes"] == selected["bytes"], "The complete recipe source file changed.")
            need(body["sha256"] not in objects or objects[body["sha256"]]["bytes"] == body["bytes"],
                 "An original source digest has conflicting sizes.")
            objects[body["sha256"]] = body
        return [objects[key] for key in sorted(objects)]

    def _retain_definition(self, ws, definition):
        return self._retain_descriptors(ws, definition_descriptors(definition))

    def _verify_objects(self, ws, custody):
        for body in custody["objects"]:
            self.intake._raw(ws, body)
        return custody

    def _record_custody(self, ws, record, objects):
        directory = self.recipe_directory(ws, record["id"])
        current = record["events"][-1]
        value = {"schema": "upstate.client-source-recipe-custody/v1", "recipe_id": record["id"],
                 "revision": current["revision"], "event_sha256": current["sha256"],
                 "definition_sha256": digest(current["definition"]), "objects": objects}
        path = directory / "custody" / (str(current["revision"]) + ".json")
        atomic_json(path, value, immutable=True)
        return value

    def _verify_custody(self, ws, record):
        for event in record["events"]:
            path = self.recipe_directory(ws, record["id"]) / "custody" / (str(event["revision"]) + ".json")
            self._verify_objects(ws, validate_custody(record, event, read_json(path)))
        return True

    def _verify_use(self, ws, use):
        directory = self.use_directory(ws, use["id"])
        self._verify_objects(ws, validate_use_custody(use, read_json(directory / "custody.json")))
        applied_path = directory / "applied.json"
        if applied_path.exists():
            applied = validate_applied(read_json(applied_path), use)
            self._verify_objects(ws, validate_applied_custody(applied, use, read_json(directory / "applied-custody.json")))
        return use

    def _validate_saved(self, ws, value):
        selected = value.get("result", value)
        use = self._load_use(ws, selected["use_id"]) if selected["request"]["action"] == "client-source-recipe.attach-result" else None
        validate_operation(value, use)
        if value.get("schema") == "upstate.client-source-recipe-publication/v1" and "custody" in value:
            self._verify_objects(ws, value["custody"])
        if "record" in selected:
            if value.get("schema") == "upstate.client-source-recipe-publication/v1":
                self._verify_objects(ws, {"objects": value["objects"]})
                previous = deepcopy(selected["record"])
                previous["events"] = previous["events"][:-1]
                if previous["events"]:
                    self._verify_custody(ws, previous)
            else:
                self._verify_custody(ws, selected["record"])
        elif "use" in selected and (self.use_directory(ws, selected["use_id"]) / "use.json").exists():
            self._verify_use(ws, selected["use"])
        elif use is not None:
            self._verify_use(ws, use)
        return value

    def _downloads(self, workspace_key, ws, paths):
        return [self.operator._ticket(workspace_key, path, describe_file(ws.root, path), label)
                for label, path in paths if path.exists()]

    def read(self, workspace_key, operation, payload):
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            recipes = []
            for path in sorted((self.root(ws) / "recipes").glob("*/record.json")):
                record = self._load_recipe(ws, path.parent.name)
                latest = record["events"][-1]
                recipes.append({"id": record["id"], "name": latest["definition"]["name"],
                    "description": latest["definition"]["description"], "revision": latest["revision"],
                    "sha256": latest["sha256"], "origin_project_id": record["origin_project_id"],
                    "local": record["origin_project_id"] == ws.project["id"],
                    "selections": len(latest["definition"]["slots"])})
            uses = []
            for path in sorted((self.root(ws) / "uses").glob("*/use.json")):
                value = self._load_use(ws, path.parent.name)
                uses.append({"id": value["id"], "project_id": value["project_id"],
                    "recipe_id": value["review"]["recipe_id"], "revision": value["review"]["recipe_revision"],
                    "sha256": value["sha256"], "attached": (path.parent / "applied.json").exists(),
                    "local": value["project_id"] == ws.project["id"] and value["workspace_key"] == workspace_key})
            return {"workspace_key": workspace_key, "project_id": ws.project["id"], "recipes": recipes, "uses": uses}
        if operation in {"result", "plan"}:
            record = self._load_recipe(ws, identifier(payload["recipe_id"]))
            self._verify_custody(ws, record)
            if operation == "result":
                return {"record": record, "_downloads": self._downloads(workspace_key, ws, [
                    ("Complete source recipe and history", self.recipe_directory(ws, record["id"]) / "record.json")])}
            inspection = self.intake._load(ws, identifier(payload["inspection_id"]))
            return plan_use(record, payload["revision"], inspection, payload.get("bindings", []))
        need(operation == "use", "Choose a saved recipe, use or remapping plan.")
        value = self._load_use(ws, identifier(payload["use_id"]))
        applied_path = self.use_directory(ws, value["id"]) / "applied.json"
        applied = read_json(applied_path) if applied_path.exists() else None
        return {"use": value, "applied": applied, "_downloads": self._downloads(workspace_key, ws, [
            ("Complete prepared source use", self.use_directory(ws, value["id"]) / "use.json"),
            ("Original attached source commit", applied_path)])}

    def _native_commit(self, ws, value, commit_id):
        request = value["commit_request"]
        need(value["project_id"] == ws.project["id"], "Only the receiving project's own prepared use can attach a native commit.")
        task = self.operator.task(identifier(commit_id))
        expected_sha = digest({key: request[key] for key in ("workspace", "action", "payload")})
        need(task.get("workspace") == request["workspace"] and task.get("action") == request["action"] and
             task.get("payload") == request["payload"] and task.get("request_sha256") == expected_sha,
             "Attach only the exact prepared original scientific request.")
        expected_id = digest({"workspace": request["workspace"], "operation_id": request["operation_id"]})
        alias = None
        if task["id"] != expected_id:
            alias = read_json(self.operator.root / "task-operation-aliases" / (expected_id + ".json"))
            need(alias.get("schema") == "upstate.operator-operation-alias/v1" and
                 alias.get("workspace") == request["workspace"] and alias.get("operation_id") == request["operation_id"] and
                 alias.get("request_sha256") == expected_sha and alias.get("task_id") == task["id"],
                 "Retain the original queue's exact operation alias.")
        else:
            need(task.get("operation_id") == request["operation_id"], "Keep the original commit operation identity.")
        commit = self.intake._load(ws, task["id"])
        need(task["state"] == "complete" and commit["state"] == "complete" and
             commit["request_sha256"] == expected_sha and commit["action"] == request["action"],
             "Finish or resume the actual original scientific task before attaching its result.")
        inspected = value["review"]["inspection"]
        selection = read_json(verify_file(ws.root, commit["selection_file"]))
        expected_selection = {"schema": "upstate.client-source-selection/v1", "inspection_id": inspected["id"],
            "inspection_sha256": digest(inspected), "project_id": ws.project["id"],
            "title": request["payload"]["title"], "selections": request["payload"]["selections"],
            "originals": [{"filename": row["filename"], "sha256": row["original"]["sha256"],
                           "bytes": row["original"]["bytes"]} for row in inspected["files"]]}
        need(selection == expected_selection and commit["inspection_id"] == inspected["id"],
             "The complete original reviewed source selection differs from the prepared recipe use.")
        collection = ws._get("sources", commit["source_collection_id"])
        return {"schema": "upstate.client-source-recipe-applied/v1", "use_id": value["id"],
                "use_sha256": value["sha256"], "project_id": ws.project["id"],
                "commit_request": deepcopy(request), "task": deepcopy(task), "operation_alias": alias,
                "commit": deepcopy(commit), "reviewed_selection": selection, "collection": collection}

    def invoke(self, task):
        need(task["action"] in ACTIONS, "Choose an original recipe action.")
        ws = self.operator.ws(task["workspace"])
        request_id = identifier(task["id"])
        payload = deepcopy(task["payload"])
        request_sha = digest({key: task[key] for key in ("workspace", "action", "payload")})
        need(task["request_sha256"] == request_sha, "Keep the original complete queued recipe request.")
        directory = self.operation_directory(ws, request_id)
        directory.mkdir(parents=True, exist_ok=True)
        if task["action"] in {"client-source-recipe.export", "client-source-recipe.receive"}:
            return self._portable_invoke(ws, task, directory)
        # One recipe metadata writer; original scientific commit remains a separate
        # explicit native action and never runs from this lock.
        with held(self.root(ws) / ".writer.lock", blocking=False):
            selected = {"id": request_id, "workspace": task["workspace"], "project_id": ws.project["id"],
                        "action": task["action"], "payload": payload, "request_sha256": request_sha}
            atomic_json(directory / "request.json", selected, immutable=True)
            result_path = directory / "result.json"
            if result_path.exists():
                result = read_json(result_path)
                need(result["request"] == selected, "The original saved recipe operation changed.")
                return self._validate_saved(ws, result)
            candidate_path = directory / "candidate.json"
            if candidate_path.exists():
                candidate = read_json(candidate_path)
                need(candidate["request"] == selected, "The original pending recipe request changed.")
            else:
                candidate = self._prepare(ws, task, selected)
                atomic_json(candidate_path, candidate, immutable=True)
            self._validate_saved(ws, candidate)
            self._publish(ws, candidate)
            atomic_json(result_path, candidate["result"], immutable=True)
            return read_json(result_path)

    def _portable_invoke(self, ws, task, directory):
        # Portable functions own the same recipe writer; do not nest that flock.
        from model.client_source_recipe_portable import export_recipe, receive_recipe
        payload = task["payload"]
        selected = {"id": task["id"], "workspace": task["workspace"], "project_id": ws.project["id"],
                    "action": task["action"], "payload": deepcopy(payload), "request_sha256": task["request_sha256"]}
        with held(directory / ".operation.lock", blocking=False):
            atomic_json(directory / "request.json", selected, immutable=True)
            path = directory / "result.json"
            if path.exists():
                value = read_json(path)
                need(value.get("request") == selected, "The retained portable recipe operation differs.")
                if value.get("archive"):
                    verify_file(ws.root, value["archive"])
                return value
            if task["action"] == "client-source-recipe.export":
                need(set(payload) == {"recipe_id"}, "Select one complete saved recipe for export.")
                portable = export_recipe(ws, identifier(payload["recipe_id"]),
                    self.root(ws) / "exports" / (task["id"] + ".zip"), operation_id=task["id"])
            else:
                need(set(payload) == {"upload_id"}, "Select the complete original uploaded recipe archive.")
                uploaded = self.operator.upload(payload["upload_id"])
                portable = receive_recipe(ws, uploaded["path"], operation_id=task["id"])
            value = {"schema": "upstate.client-source-recipe-portable-operation/v1", "state": "complete",
                     "request": selected, "created_at": task["created_at"], "portable": portable,
                     "recipe_id": portable["recipe_id"]}
            if portable.get("archive", {}).get("path"):
                value["archive"] = portable["archive"]
                verify_file(ws.root, value["archive"])
            atomic_json(path, value, immutable=True)
            return read_json(path)

    def _prepare(self, ws, task, selected):
        action, payload = task["action"], task["payload"]
        request_id, stamp = task["id"], task["created_at"]
        result = {"schema": "upstate.client-source-recipe-operation/v1", "state": "complete",
                  "request": selected, "created_at": stamp}
        candidate = {"schema": "upstate.client-source-recipe-publication/v1", "request": selected, "result": result}
        if action in {"client-source-recipe.create", "client-source-recipe.revise"}:
            allowed = {"name", "description", "commit_id"}
            if action.endswith(".revise"):
                allowed |= {"recipe_id", "expected_revision", "expected_sha256"}
            need(set(payload).issubset(allowed) and {"name", "commit_id"}.issubset(payload),
                 "Use the complete declared recipe capture request.")
            recipe_id = request_id if action.endswith(".create") else identifier(payload["recipe_id"])
            previous = None if action.endswith(".create") else self._load_recipe(ws, recipe_id)
            if previous:
                self._verify_custody(ws, previous)
            definition = self._capture(ws, payload["commit_id"], payload["name"], payload.get("description", ""))
            record, event = append_event(previous, recipe_id=recipe_id, project_id=ws.project["id"],
                request_id=request_id, request_sha256=task["request_sha256"], action=action,
                payload=payload, definition=definition, created_at=stamp)
            objects = self._retain_definition(ws, definition)
            candidate.update(recipe_record=record, objects=objects)
            result.update(recipe_id=recipe_id, revision=event["revision"], sha256=event["sha256"], record=record)
        elif action == "client-source-recipe.prepare-use":
            record = self._load_recipe(ws, identifier(payload["recipe_id"]))
            self._verify_custody(ws, record)
            inspection = self.intake._load(ws, identifier(payload["inspection_id"]))
            value = build_use(record, request_id=request_id, request_sha256=task["request_sha256"],
                workspace_key=task["workspace"], project_id=ws.project["id"],
                payload=payload, inspection=inspection, created_at=stamp)
            custody = {"schema": "upstate.client-source-recipe-use-custody/v1", "use_id": value["id"],
                       "use_sha256": value["sha256"], "objects": self._retain_descriptors(ws, use_descriptors(value))}
            validate_use_custody(value, custody)
            candidate["use"], candidate["custody"] = value, custody
            result.update(use_id=request_id, use_sha256=value["sha256"], use=value,
                          commit_request=value["commit_request"])
        else:
            need(set(payload) == {"use_id", "use_sha256", "commit_id"}, "Attach one exact prepared use and original commit.")
            value = self._load_use(ws, identifier(payload["use_id"]))
            need(value["sha256"] == payload["use_sha256"] and value["workspace_key"] == task["workspace"],
                 "Attach the exact local prepared use.")
            applied = self._native_commit(ws, value, payload["commit_id"])
            applied["sha256"] = digest(applied)
            validate_applied(applied, value)
            custody = {"schema": "upstate.client-source-recipe-applied-custody/v1", "use_id": value["id"],
                       "applied_sha256": applied["sha256"], "objects": self._retain_descriptors(ws, applied_descriptors(applied))}
            validate_applied_custody(applied, value, custody)
            candidate["applied"], candidate["custody"] = applied, custody
            result.update(use_id=value["id"], use_sha256=value["sha256"], applied=applied)
        return candidate

    def _publish(self, ws, candidate):
        need(candidate["result"]["request"] == candidate["request"], "Keep the complete original publication.")
        if "recipe_record" in candidate:
            value = validate_record(candidate["recipe_record"])
            path = self.recipe_directory(ws, value["id"]) / "record.json"
            if path.exists():
                current = self._load_recipe(ws, value["id"])
                common = min(len(current["events"]), len(value["events"]))
                need(current["events"][:common] == value["events"][:common] and
                     {k: v for k, v in current.items() if k != "events"} == {k: v for k, v in value.items() if k != "events"},
                     "The retained recipe history diverged; keep both selections for review.")
                if len(current["events"]) >= len(value["events"]):
                    self._verify_custody(ws, current)
                    return
            self._record_custody(ws, value, candidate["objects"])
            self._verify_custody(ws, value)
            atomic_json(path, value)
        elif "use" in candidate:
            value = validate_use(candidate["use"])
            custody = validate_use_custody(value, candidate["custody"])
            self._verify_objects(ws, custody)
            atomic_json(self.use_directory(ws, value["id"]) / "custody.json", custody, immutable=True)
            atomic_json(self.use_directory(ws, value["id"]) / "use.json", value, immutable=True)
        elif "applied" in candidate:
            value = candidate["applied"]
            need(value["sha256"] == digest({key: item for key, item in value.items() if key != "sha256"}),
                 "The original complete attached commit changed.")
            use = self._load_use(ws, identifier(value["use_id"]))
            need(use["sha256"] == value["use_sha256"], "The attached commit selects another prepared use.")
            validate_applied(value, use)
            custody = validate_applied_custody(value, use, candidate["custody"])
            self._verify_objects(ws, custody)
            atomic_json(self.use_directory(ws, value["use_id"]) / "applied-custody.json", custody, immutable=True)
            atomic_json(self.use_directory(ws, value["use_id"]) / "applied.json", value, immutable=True)
        else:
            raise ValueError("The pending recipe operation has no complete publication.")

    def decorate_task(self, task):
        if task.get("action") in ACTIONS:
            ws = self.operator.ws(task["workspace"])
            path = self.operation_directory(ws, task["id"]) / "result.json"
            if path.exists():
                result = read_json(path)
                task["_client_source_recipe"] = result
                files = [("Complete source recipe operation", path)]
                if result.get("archive"):
                    files.append(("Complete portable recipe and original files", verify_file(ws.root, result["archive"])))
                task.setdefault("_downloads", []).extend(self._downloads(task["workspace"], ws, files))
        return task

    def verify_workspace(self, workspace):
        for path in (self.root(workspace) / "recipes").glob("*/record.json"):
            record = self._load_recipe(workspace, path.parent.name)
            self._verify_custody(workspace, record)
        for path in (self.root(workspace) / "uses").glob("*/use.json"):
            self._load_use(workspace, path.parent.name)
        return True
