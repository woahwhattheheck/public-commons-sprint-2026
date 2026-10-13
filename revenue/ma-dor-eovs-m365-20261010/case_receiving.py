#!/usr/bin/env python3
"""Receive the complete case migration workflow on supplied original workspaces and files."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

from migration_store import MigrationError, canonical, identity, identifier, file_hash, parse_json, regular
from migration_workspace import MigrationWorkspace
from migration_cli import _file_path, _publish, _binary_chunks, _stage
from migration_portable import (APPLICATION_FILES, ordinary_directory, publish_bytes,
    canonical as encoded, inspect_delivery, receive_delivery, PortableService, digest, sync_parent, member_name)
from migration_reports import build_reports, case_pages, case_records

SCHEMA = "commons.case-migration-receiving/v1"
PHASES = ("01-original-input", "02-original-case-actions", "03-complete-reports",
          "04-producer-delivery", "05-customer-receive", "06-customer-actions",
          "07-older-receiving-replay", "08-customer-return", "09-return-reopen",
          "10-original-request-replay")
INPUT_LIMIT = 16 * 1024 * 1024
RECEIPT_LIMIT = 96 * 1024 * 1024
SOURCE_ROOT = Path(__file__).resolve().parent
CASE_KINDS = ("dataset", "plan", "rehearsal", "review", "cutover")
ALLOWED = {"source.import", "case.dataset.create", "case.plan.create",
           "case.rehearsal.create", "case.review.create", "case.cutover.create",
           "workspace.update"}


def need(value, message):
    if not value:
        raise MigrationError("CASE_RECEIVING", message)


def json_file(path, limit=RECEIPT_LIMIT):
    actual = _file_path(path)
    with actual.open("rb") as stream:
        raw = stream.read(limit + 1)
    need(len(raw) <= limit, "The complete selected JSON exceeds its documented input bound")
    return raw, parse_json(raw.decode("utf-8"))


def pointer(value, selected):
    need(isinstance(selected, str) and (selected == "" or selected.startswith("/")),
         "Use an explicit JSON pointer into the original accepted result")
    for part in selected.split("/")[1:]:
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict):
            need(part in value, "The selected original result field is absent")
            value = value[part]
        elif isinstance(value, list):
            need(part.isdecimal() and (part == "0" or not part.startswith("0")),
                 "Use an exact original result array index")
            index = int(part)
            need(index < len(value), "The selected original result index is absent")
            value = value[index]
        else:
            raise MigrationError("CASE_RECEIVING", "Cannot traverse the selected original result")
    return value


class Receiving:
    schema = SCHEMA
    phases = PHASES
    kinds = CASE_KINDS
    allowed = ALLOWED
    domain = "case"
    catalog_key = "case_entities"
    records = staticmethod(case_records)
    meaning = "Supplied original case workflow, retained decisions and portable customer continuation; no tenant write or inferred approval."
    def __init__(self, source_input, out):
        self.out = ordinary_directory(out, create=True)
        need(not (self.out.stat().st_mode & 0o077), "Keep the receiving directory private")
        self.lock = os.open(self.out / "operation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        info = os.fstat(self.lock)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077,
             "Keep an ordinary private operation lock")
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.owned = []
        self.results = {}
        self.files = {}
        self.artifacts = {}
        self.action_receipts = []
        self.stage_receipts = []
        self.raw, self.input = json_file(source_input, INPUT_LIMIT)
        value = self.input
        need(isinstance(value, dict) and value.get("schema") == self.schema, "Select the complete receiving input")
        self.operation_id = identifier(value.get("operation_id"))
        need(len(self.operation_id) <= 80, "Keep the original receiving ID within 80 characters")
        operation_ids, source_keys = set(), set()
        for lane, field in (("producer", "steps"), ("customer", "customer_steps")):
            need(isinstance(value.get(field), list) and value[field], "Supply complete original " + field)
            keys = set()
            for step in value[field]:
                need(isinstance(step, dict), "Select complete original action objects")
                key, operation_id = identifier(step.get("key")), identifier(step.get("operation_id"))
                need(key not in keys and operation_id not in operation_ids and len(operation_id) <= 100,
                     "Keep action keys distinct per lane and original operation IDs distinct within 100 characters")
                need(step.get("operation") in self.allowed and isinstance(step.get("payload"), dict),
                     "Select the actual complete case/source action")
                keys.add(key)
                operation_ids.add(operation_id)
        reserved = {self.operation_id + "-" + lane + "-delivery" for lane in ("producer", "customer")}
        controls = {item + "-continue" for item in operation_ids | reserved}
        need(not (operation_ids & (reserved | controls)), "Original action and continuation identities overlap")
        need(isinstance(value.get("source_files", []), list), "Select complete original source files")
        for item in value.get("source_files", []):
            need(isinstance(item, dict), "Select a complete source-file receipt")
            key = identifier(item.get("key"))
            need(key not in source_keys, "Keep every original source-file key distinct")
            source_keys.add(key)
        comparison = value.get("comparison")
        need(isinstance(comparison, dict) and set(comparison) == {"before_id", "after_id"},
             "Select both actual rehearsal editions for the complete correction comparison")
        need(isinstance(value.get("authorization"), str) and value["authorization"].strip(),
             "Retain the actual authority for this original case operation")
        need(isinstance(value.get("actor"), str) and value["actor"].strip(), "Select the recorded operator")
        self.input_sha = hashlib.sha256(self.raw).hexdigest()
        self.put("original-input.json", self.raw)
        source_selection = []
        for name in APPLICATION_FILES:
            path = SOURCE_ROOT / name
            regular(path)
            source_selection.append({"path": name, **file_hash(path)})
        wanted = value.get("application")
        need(isinstance(wanted, list) and wanted == source_selection,
             "Select every complete current application body before the original case is opened")
        runtime = Path(sys.executable).resolve()
        selection = {"schema": self.schema + "/selection", "operation_id": self.operation_id,
                     "input_sha256": self.input_sha, "application": source_selection,
                     "runtime": {"path": str(runtime), "version": sys.version, **file_hash(runtime)}}
        self.put("selection.json", encoded(selection))
        self.selection = selection

    def put(self, relative, data):
        relative = member_name(relative)
        need(not relative.endswith(".json") or len(data) <= RECEIPT_LIMIT,
             "Keep each complete retained JSON receipt within the documented 96 MiB bound")
        path = self.out / relative
        need(path.is_relative_to(self.out), "Retain artifacts inside the original operation")
        ordinary_directory(path.parent, create=True)
        publish_bytes(path, data)
        receipt = {"path": relative, **file_hash(path)}
        self.artifacts[relative] = receipt
        return receipt

    def remember(self, path):
        path = Path(path)
        relative = path.relative_to(self.out).as_posix()
        ordinary_directory(path.parent)
        regular(path)
        receipt = {"path": relative, **file_hash(path)}
        sync_parent(path)
        self.artifacts[relative] = receipt
        return receipt

    def verify(self, receipt):
        path = self.out / member_name(receipt["path"])
        need(path.is_relative_to(self.out), "Retained artifact path escaped the original output")
        regular(path)
        need(file_hash(path) == {key:receipt[key] for key in ("bytes", "sha256")},
             "A complete retained artifact differs: " + receipt["path"])
        need(self.remember(path) == receipt, "The original artifact changed during exact adoption")

    def open(self, path):
        workspace = MigrationWorkspace.__new__(MigrationWorkspace)
        self.owned.append(workspace)
        workspace.__init__(path, create=False)
        return workspace

    def close(self, workspace):
        workspace.close()
        self.owned.remove(workspace)

    def close_all(self):
        errors = []
        for workspace in list(reversed(self.owned)):
            try:
                self.close(workspace)
            except BaseException as error:
                errors.append(str(error))
        if errors:
            raise MigrationError("CASE_RECEIVING_CLOSE", "Original workspace closure is unresolved", {"errors": errors})

    def resolve(self, value):
        if isinstance(value, dict):
            if set(value) == {"$result", "pointer"}:
                need(value["$result"] in self.results, "Select an already accepted original action")
                return pointer(self.results[value["$result"]], value["pointer"])
            if set(value) == {"$file", "field"}:
                need(value["$file"] in self.files, "Select a retained complete original source")
                need(value["field"] in ("sha256", "bytes", "filename"), "Select an original file identity field")
                return self.files[value["$file"]][value["field"]]
            return {key:self.resolve(item) for key,item in value.items()}
        if isinstance(value, list):
            return [self.resolve(item) for item in value]
        return value

    def action(self, workspace, step, lane):
        need(isinstance(step, dict), "Use a complete original action")
        key = identifier(step.get("key"))
        operation = step.get("operation")
        need(operation in self.allowed, "Use one advertised case/source operation")
        operation_id = identifier(step.get("operation_id"))
        actor = step.get("actor", self.input["actor"])
        payload = self.resolve(step.get("payload"))
        need(isinstance(payload, dict) and not (set(payload) & {"operation_id", "actor", "expected_revision"}),
             "Keep the original operation envelope separate from the supplied action fields")
        folder = "actions/" + lane + "/" + key
        request_path = self.out / folder / "request.json"
        semantic = {"operation": operation, "payload": {**payload, "actor": actor}}
        semantic_sha = identity(semantic)
        if request_path.exists():
            _, saved = json_file(request_path)
            request = saved["request"]
            need(saved["workspace_id"] == workspace.project["id"] and saved["operation"] == operation and
                 request["operation_id"] == operation_id and
                 identity({"operation": operation, "payload": {k:v for k,v in request.items()
                     if k not in ("operation_id", "expected_revision")}}) == semantic_sha,
                 "The original action request or selected workspace changed")
        else:
            request = {**payload, "operation_id": operation_id, "actor": actor,
                       "expected_revision": workspace.project["revision"]}
            self.put(folder + "/request.json", encoded({"operation": operation,
                "workspace_id":workspace.project["id"], "request": request}))
        self.remember(request_path)
        before = workspace.dispatch("operation.get", {"id": operation_id})
        if before["found"]:
            original = before["operation"]
            need(original["operation"] == operation and original["request_sha256"] == semantic_sha,
                 "The selected original operation has another request")
            if original["status"] != "SUCCEEDED":
                # Continuing an incomplete native operation needs the operator's
                # explicit original reason, retained as its own control request.
                reason = step.get("resume_reason")
                need(isinstance(reason, str) and reason.strip(),
                     "Retain the original interrupted operation; use its predeclared resume_reason or resume it through the original CLI")
                control = {"target_operation_id":operation_id, "reason":reason,
                           "operation_id":operation_id + "-continue", "actor":actor,
                           "expected_revision":workspace.project["revision"]}
                control_path = self.out / folder / "resume-control.json"
                if control_path.exists():
                    _, prior_control = json_file(control_path)
                    need(prior_control["target_operation_id"] == operation_id and
                         prior_control["reason"] == reason and prior_control["actor"] == actor,
                         "The original continuation reason changed")
                    control = prior_control
                self.put(folder + "/resume-control.json", encoded(control))
                workspace.dispatch("operation.resume", control)
        try:
            returned = workspace.dispatch(operation, request)
        except BaseException as error:
            observed = workspace.dispatch("operation.get", {"id": operation_id})
            self.put(folder + "/observed-" + identity(observed) + ".json", encoded(observed))
            raise
        original = workspace.dispatch("operation.get", {"id": operation_id})["operation"]
        need(original["status"] == "SUCCEEDED" and original["request_sha256"] == semantic_sha,
             "The original operation did not reach its recorded complete result")
        # Reused is transport state. Acceptance binds the original stored result,
        # not a later replay's reused flag or current workspace revision.
        accepted = {"operation": operation, "operation_id":operation_id,
                    "workspace_id":workspace.project["id"], "request_sha256":semantic_sha,
                    "original_result":original["result"], "key":key, "lane":lane}
        self.put(folder + "/accepted.json", encoded(accepted))
        self.accept_action(accepted)
        return original["result"]["result"]

    def stage(self, name, callback):
        selected = self.out / "phases" / (name + ".json")
        if selected.exists():
            _, receipt = json_file(selected)
            need(receipt["schema"] == self.schema + "/phase" and receipt["phase"] == name and
                 receipt["input_sha256"] == self.input_sha, "Original completed phase changed")
            for artifact in receipt["artifacts"]:
                self.verify(artifact)
            self.remember(selected)
            self.stage_receipts.append(receipt)
            return receipt["result"]
        result = callback()
        receipt = {"schema":self.schema + "/phase", "phase":name, "input_sha256":self.input_sha,
                   "result":result, "artifacts":list(self.artifacts.values())}
        self.put("phases/" + name + ".json", encoded(receipt))
        self.stage_receipts.append(receipt)
        return result

    def stage_files(self, workspace):
        results = []
        for item in self.input.get("source_files", []):
            key = identifier(item.get("key"))
            need(key not in self.files, "Every selected source key must be unique")
            need(isinstance(item.get("bytes"), int) and not isinstance(item["bytes"], bool) and item["bytes"] >= 0,
                 "Select the complete original source byte length")
            need(isinstance(item.get("sha256"), str) and len(item["sha256"]) == 64,
                 "Select the complete original source hash")
            target = self.out / "inputs" / (item["sha256"] + ".bin")
            if not target.exists():
                with _file_path(item["path"]).open("rb") as source:
                    _publish(_binary_chunks(source), str(target))
            receipt = self.remember(target)
            need(receipt["sha256"] == item["sha256"] and receipt["bytes"] == item["bytes"],
                 "The complete retained source differs from its selected identity")
            received = _stage(workspace, target, item["filename"], item["sha256"], item["bytes"])
            self.files[key] = received
            results.append({"key":key, **received, "artifact":receipt})
        return results

    def catalog(self, workspace, label):
        # A resumed incomplete read keeps each observed revision under its own
        # original name. Completed phase adoption never overwrites an earlier view.
        revision = workspace.project["revision"]
        prefix = label + "/revision-" + str(revision)
        case_entities = {}
        for kind in self.kinds:
            records = list(self.records(workspace, kind))
            case_entities[kind] = records
            self.put(prefix + "/" + kind + ".json", encoded(records))
            for record in records:
                for fmt in ("ndjson", "csv"):
                    path = self.out / prefix / (record["id"] + "." + fmt)
                    ordinary_directory(path.parent, create=True)
                    _publish(workspace.iter_export(self.domain + "." + kind, record["id"], format=fmt), str(path))
                    self.remember(path)
        events = list(case_pages(workspace, "events", {}))
        self.put(prefix + "/events.json", encoded(events))
        operations = []
        for operation_id in dict.fromkeys(event.get("operation_id") for event in events if event.get("operation_id")):
            operations.append(workspace.dispatch("operation.get", {"id": operation_id}))
        self.put(prefix + "/operations.json", encoded(operations))
        need(workspace.project["revision"] == revision, "The owned catalogue changed during capture")
        result = {"workspace_id":workspace.project["id"], "revision":revision,
                  self.catalog_key:case_entities, "events":events, "operations":operations}
        self.put(prefix + "/catalog.json", encoded(result))
        return result

    def frozen_catalog(self, workspace, relative, label):
        path = self.out / relative
        if path.exists():
            _, retained = json_file(path)
            for artifact in retained["artifacts"]:
                self.verify(artifact)
            self.remember(path)
            catalog = retained["catalog"]
            need(workspace.project["id"] == catalog["workspace_id"] and
                 workspace.project["revision"] >= catalog["revision"],
                 "The original frozen catalogue no longer belongs to this workspace")
            for kind, records in catalog[self.catalog_key].items():
                for record in records:
                    need(workspace.dispatch(self.domain + "." + kind + ".get", {"id":record["id"]}) == record,
                         "A frozen original case edition changed during continuation")
            return catalog
        catalog = self.catalog(workspace, label)
        self.put(relative, encoded({"catalog":catalog, "artifacts":list(self.artifacts.values())}))
        return catalog

    def receive(self, archive, destination, label):
        observed = receive_delivery(archive, destination)
        self.put(label + "-observed-" + identity(observed) + ".json", encoded(observed))
        selected = self.out / (label + ".json")
        stable = lambda value: {key:item for key,item in value.items() if key != "reopened"}
        if selected.exists():
            _, original = json_file(selected)
            need(stable(original) == stable(observed),
                 "Original receiving destination/archive acceptance changed")
            self.remember(selected)
            return original
        self.put(label + ".json", encoded(observed))
        return observed

    def delivery(self, workspace, lane):
        operation_id = identifier(self.operation_id + "-" + lane + "-delivery")
        folder = "deliveries/" + lane
        catalog = self.frozen_catalog(workspace, folder + "/basis.json", lane + "-delivery-basis")
        request_path = self.out / folder / "request.json"
        if request_path.exists():
            _, payload = json_file(request_path)
        else:
            payload = {"operation_id":operation_id, "expected_revision":catalog["revision"],
                       "actor":self.input["actor"], "title":self.input.get("title", "Case migration handover"),
                       "note":"Original selected receiving operation " + self.operation_id + " / " + lane}
            self.put(folder + "/request.json", encoded(payload))
        need(payload["expected_revision"] == catalog["revision"],
             "The original delivery request differs from its frozen complete case catalogue")
        self.remember(request_path)
        original = workspace.dispatch("operation.get", {"id":operation_id})
        if original["found"] and original["operation"]["status"] != "SUCCEEDED":
            reason = self.input.get("delivery_resume_reason")
            need(isinstance(reason, str) and reason.strip(),
                 "Keep the interrupted original delivery; use its predeclared reason or the original CLI resume")
            control_path = self.out / folder / "resume-control.json"
            if control_path.exists():
                _, control = json_file(control_path)
                need(control["reason"] == reason, "The original delivery continuation reason changed")
            else:
                control = {"operation_id":identifier(operation_id + "-continue"), "actor":self.input["actor"],
                           "expected_revision":workspace.project["revision"],
                           "target_operation_id":operation_id, "reason":reason}
                self.put(folder + "/resume-control.json", encoded(control))
            workspace.dispatch("operation.resume", control)
        response = workspace.dispatch("delivery.prepare", payload)
        record = response["result"]
        service = PortableService(workspace, workspace.root, SOURCE_ROOT)
        actual, handle = service.open_delivery(record["id"])
        target = self.out / folder / "complete.zip"
        ordinary_directory(target.parent, create=True)
        with handle:
            _publish(_binary_chunks(handle), str(target))
        archive = self.remember(target)
        need(archive["sha256"] == record["archive_sha256"] and archive["bytes"] == record["archive_bytes"],
             "The full original delivery differs")
        inspected = inspect_delivery(target)
        need(inspected["manifest"]["workspace_id"] == catalog["workspace_id"] and
             inspected["manifest"]["revision"] == catalog["revision"],
             "The actual archive snapshot differs from its frozen original case catalogue")
        self.put(folder + "/inspection.json", encoded(inspected))
        accepted = {"record":record, "archive":archive, "manifest_sha256":inspected["manifest_sha256"],
                    "catalog":catalog}
        self.put(folder + "/accepted.json", encoded(accepted))
        return accepted

    def compare_entities(self, original, following, *, exact=False):
        need(original["workspace_id"] == following["workspace_id"], "Portable receiving changed the original project ID")
        for kind in self.kinds:
            old = {row["id"]:row for row in original[self.catalog_key][kind]}
            new = {row["id"]:row for row in following[self.catalog_key][kind]}
            need(not (set(old) - set(new)), "Receiving omitted an original case edition")
            need(all(new[key] == value for key,value in old.items()), "Receiving changed original case evidence")
            if exact:
                need(old == new, "Independent receiving case editions differ from the selected delivery")

    def accept_action(self, accepted):
        need(isinstance(accepted, dict) and accepted.get("lane") in ("producer", "customer") and
             isinstance(accepted.get("original_result"), dict) and "result" in accepted["original_result"],
             "Retain a complete original accepted action")
        selected = accepted["lane"] + ":" + accepted["key"]
        prior = next((item for item in self.action_receipts
                      if item["lane"] == accepted["lane"] and item["key"] == accepted["key"]), None)
        need(prior is None or prior == accepted, "The retained original action acceptance changed")
        if prior is None:
            self.action_receipts.append(accepted)
        self.results[selected] = accepted["original_result"]["result"]

    def adopt_actions(self):
        for lane, key in (("producer","steps"),("customer","customer_steps")):
            for step in self.input.get(key, []):
                path = self.out / "actions" / lane / step["key"] / "accepted.json"
                if path.exists():
                    _, accepted = json_file(path)
                    need(accepted.get("lane") == lane and accepted.get("key") == step["key"] and
                         accepted.get("operation_id") == step["operation_id"] and
                         accepted.get("operation") == step["operation"],
                         "The accepted action is not the selected original input")
                    self.accept_action(accepted)
                    self.remember(path)

    def verify_action_history(self, workspace, lane):
        for accepted in self.action_receipts:
            if accepted["lane"] != lane:
                continue
            found = workspace.dispatch("operation.get", {"id":accepted["operation_id"]})
            need(found["found"] and found["operation"]["status"] == "SUCCEEDED" and
                 found["operation"]["request_sha256"] == accepted["request_sha256"] and
                 found["operation"]["result"] == accepted["original_result"],
                 "The original accepted operation/history is not retained")

    def comparison(self, workspace):
        selected = self.resolve(self.input["comparison"])
        need(selected["before_id"] != selected["after_id"], "Select two distinct actual rehearsal editions")
        revision = workspace.project["revision"]
        prefix = "rehearsal-comparison/revision-" + str(revision)
        rows, seen, offset, total = [], set(), 0, None
        while True:
            page = workspace.dispatch(self.domain + ".rehearsal.compare", {**selected, "offset":offset, "limit":250})
            current = page.get("total")
            need(isinstance(current, int) and not isinstance(current, bool) and current >= 0 and
                 isinstance(page.get("rows"), list) and page.get("offset") == offset and
                 page.get("before_id") == selected["before_id"] and page.get("after_id") == selected["after_id"],
                 "Retain the complete original rehearsal comparison page")
            if total is None:
                total = current
            need(current == total and len(page["rows"]) <= 250 and offset + len(page["rows"]) <= total,
                 "The original rehearsal comparison population changed")
            for row in page["rows"]:
                key = canonical([row["kind"], row.get("register"), row["key"]])
                need(key not in seen, "The original comparison repeated an identity")
                seen.add(key)
                rows.append(row)
            offset += len(page["rows"])
            need(workspace.project["revision"] == revision, "The comparison changed from its original revision")
            if offset == total:
                break
            need(page["rows"], "The original comparison ended before its complete population")
        value = {"selection":selected, "workspace_id":workspace.project["id"], "revision":revision,
                 "rows":rows, "total":total}
        self.put(prefix + "/complete.json", encoded(value))
        return value

    def run(self):
        source = self.input.get("workspace")
        need(isinstance(source, dict), "Select the actual original workspace")
        producer = self.open(source["path"])
        need(producer.project["id"] == source["id"], "The selected original case identity differs")
        self.adopt_actions()
        complete = self.out / "COMPLETE.json"
        if complete.exists():
            _, saved = json_file(complete)
            need(saved.get("schema") == self.schema and saved.get("state") == "COMPLETE" and
                 saved.get("operation_id") == self.operation_id and saved.get("input_sha256") == self.input_sha and
                 saved.get("selection") == self.selection and saved.get("lifetimes") ==
                 {"workspaces":"CLOSED","children":"NONE_CREATED"} and
                 [phase["phase"] for phase in saved["phases"]] == list(self.phases) and
                 all(phase.get("schema") == self.schema + "/phase" and
                     phase.get("input_sha256") == self.input_sha for phase in saved["phases"]),
                 "The completed original operation/source selection differs")
            for artifact in saved["artifacts"]:
                self.verify(artifact)
            self.verify_action_history(producer, "producer")
            recipient = self.open(self.out / "customer" / "workspace")
            returned = self.open(self.out / "returned" / "workspace")
            self.verify_action_history(recipient, "customer")
            self.verify_action_history(recipient, "producer")
            self.verify_action_history(returned, "customer")
            self.verify_action_history(returned, "producer")
            for index, workspace in ((1, producer), (5, recipient), (8, returned)):
                recorded = saved["phases"][index]["result"]
                catalog = recorded["catalog"] if index != 5 else recorded["after"]
                need(workspace.project["revision"] >= catalog["revision"],
                     "A received workspace lost its original recorded revision")
                for kind, records in catalog[self.catalog_key].items():
                    for record in records:
                        need(workspace.dispatch(self.domain + "." + kind + ".get", {"id":record["id"]}) == record,
                             "A received workspace changed an original immutable case edition")
            need(all(w.project["id"] == source["id"] for w in (recipient, returned)),
                 "An independently received project identity differs")
            self.close_all()
            return saved
        first = self.out / "phases" / (self.phases[0] + ".json")
        if not first.exists() and not self.action_receipts:
            need(producer.project["revision"] == source["expected_revision"],
                 "Select the current original case revision before its first intake")
        self.stage(self.phases[0], lambda: {"project":producer.project, "files":self.stage_files(producer)})
        # The originals remain available after completed first-phase adoption.
        if not self.files:
            for item in self.input.get("source_files", []):
                self.files[item["key"]] = {key:item[key] for key in ("sha256","bytes","filename")}
        def actions():
            need(isinstance(self.input.get("steps"), list) and self.input["steps"],
                 "Supply the reviewed source, projection, plan, rehearsal, response and cutover actions")
            values = [self.action(producer, step, "producer") for step in self.input["steps"]]
            catalog = self.catalog(producer, "producer-after-actions")
            need(all(catalog[self.catalog_key][kind] for kind in self.kinds),
                 "The whole receiving claim requires an actual edition in every case register")
            return {"actions":values, "catalog":catalog}
        original_actions = self.stage(self.phases[1], actions)
        self.adopt_actions()
        self.verify_action_history(producer, "producer")
        def reports():
            revision = producer.project["revision"]
            directory = self.out / "reports" / ("revision-" + str(revision))
            ordinary_directory(directory, create=True)
            names = build_reports(producer, directory, source_revision=revision,
                                  title=self.input.get("title", "Case migration handover"), note=self.input["authorization"])
            return {"revision":revision, "files":[self.remember(directory / name) for name in names]}
        self.stage(self.phases[2], reports)
        producer_delivery = self.stage(self.phases[3], lambda:self.delivery(producer, "producer"))
        archive = self.out / producer_delivery["archive"]["path"]
        def receive():
            return self.receive(archive, self.out / "customer", "customer-receive")
        self.stage(self.phases[4], receive)
        customer = self.open(self.out / "customer" / "workspace")
        def customer_actions():
            before = self.frozen_catalog(customer, "customer-baseline.json", "customer-before")
            self.compare_entities(producer_delivery["catalog"], before, exact=True)
            steps = self.input.get("customer_steps")
            need(isinstance(steps,list) and steps, "Supply the actual recipient's reviewed follow-on action")
            values = [self.action(customer, step, "customer") for step in steps]
            after = self.catalog(customer, "customer-after")
            self.compare_entities(before, after)
            comparison = self.comparison(customer)
            return {"before":before, "actions":values, "after":after, "comparison":comparison}
        customer_result = self.stage(self.phases[5], customer_actions)
        self.adopt_actions()
        self.verify_action_history(customer, "producer")
        self.verify_action_history(customer, "customer")
        def older_receiving():
            before = customer.project
            self.close(customer)
            receipt = self.receive(archive, self.out / "customer", "older-receiving-replay")
            current = self.open(self.out / "customer" / "workspace")
            try:
                need(current.project == before, "Earlier delivery receiving overwrote a later recipient edit")
                self.verify_action_history(current, "customer")
            finally:
                self.close(current)
            return {"before":before, "after":before, "receipt":receipt}
        if not (self.out / "phases" / (self.phases[6] + ".json")).exists():
            self.stage(self.phases[6], older_receiving)
            customer = self.open(self.out / "customer" / "workspace")
        else:
            self.stage(self.phases[6], older_receiving)
        customer_delivery = self.stage(self.phases[7], lambda:self.delivery(customer, "customer"))
        def return_receive():
            receipt = self.receive(self.out / customer_delivery["archive"]["path"],
                                   self.out / "returned", "return-receive")
            returned = self.open(self.out / "returned" / "workspace")
            try:
                catalog = self.catalog(returned, "returned")
                self.compare_entities(customer_delivery["catalog"], catalog, exact=True)
                self.verify_action_history(returned, "customer")
                self.verify_action_history(returned, "producer")
            finally:
                self.close(returned)
            return {"receipt":receipt, "catalog":catalog}
        self.stage(self.phases[8], return_receive)
        def replays():
            values = []
            for lane,workspace in (("producer",producer),("customer",customer)):
                before = workspace.project
                for accepted in self.action_receipts:
                    if accepted["lane"] != lane:
                        continue
                    _, request = json_file(self.out / "actions" / lane / accepted["key"] / "request.json")
                    result = workspace.dispatch(accepted["operation"], request["request"])
                    need(result["reused"] is True and result["result"] == accepted["original_result"]["result"],
                         "The exact original request did not return its original accepted result")
                    values.append({"lane":lane, "operation_id":accepted["operation_id"], "original_revision":result["revision"]})
                need(workspace.project == before, "Original request replay changed the actual later project head")
                self.verify_action_history(workspace, lane)
            return values
        self.stage(self.phases[9], replays)
        self.close_all()
        need([phase["phase"] for phase in self.stage_receipts] == list(self.phases), "Keep all ten ordered original phases")
        report = {"schema":self.schema, "state":"COMPLETE", "operation_id":self.operation_id,
                  "input_sha256":self.input_sha, "selection":self.selection, "phases":self.stage_receipts,
                  "actions":self.action_receipts, "artifacts":list(self.artifacts.values()),
                  "lifetimes":{"workspaces":"CLOSED","children":"NONE_CREATED"},
                  "meaning":self.meaning}
        self.put("COMPLETE.json", encoded(report))
        return report


def main(runner_type=Receiving):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Complete actual source/case/action selection")
    parser.add_argument("--out", required=True, help="Private original operation directory")
    args = parser.parse_args()
    runner = None
    try:
        runner = runner_type.__new__(runner_type)
        runner.owned = []
        runner.lock = None
        runner.__init__(args.input,args.out)
        report = runner.run()
        print(canonical({"state":report["state"],"operation_id":report["operation_id"],
                         "report":str(runner.out / "COMPLETE.json"),"phases":len(report["phases"])}))
        return 0
    except BaseException as error:
        if runner is not None:
            try:
                runner.close_all()
            except BaseException as close_error:
                print(canonical({"state":"INTERRUPTED","error":str(error),"close_error":str(close_error)}),file=sys.stderr)
                # Keep the original kernel lease until actual process exit when
                # resource closure cannot be acknowledged.
                return 2
        print(canonical({"state":"INTERRUPTED","error":type(error).__name__,"message":str(error)}),file=sys.stderr)
        return 2
    finally:
        if runner is not None and not runner.owned and runner.lock is not None:
            fcntl.flock(runner.lock,fcntl.LOCK_UN)
            os.close(runner.lock)
            runner.lock = None


if __name__ == "__main__":
    raise SystemExit(main())
