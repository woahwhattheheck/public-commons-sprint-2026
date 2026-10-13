"""MIT. Native returned-procedure reviews over the original OperatingPlan model.

Complete original histories and decisions remain retained files. A completed
review is durable before the existing native plan receiver is invoked. This
mixin never runs an authored command or starts a provider acquisition.
"""
from __future__ import annotations
import copy
import os
from pathlib import Path
import shutil
import subprocess
from directory_runtime import InputError, ConflictError, source, safe_read, original_workspace
import directory_schema as schema
from directory_operating_plans import MAX_DOCUMENT, MAX_BASIS, _body_sha

HERE = Path(__file__).resolve().parent
RETURN_KIND = "operatingPlanReturns"
RETURN_SCHEMA = "stellar-forge.directory-operating-return-record.v1"
MODEL_SCHEMA = "stellar-forge.operating-plan-return.v1"
MAX_REQUEST = 192 * 1024 * 1024
MAX_REVIEW = 128 * 1024 * 1024
MAX_COMPARISON = 256 * 1024 * 1024
MAX_BRIDGE = 512 * 1024 * 1024
FILE_KEYS = {"review", "comparison", "input"}
STAGES = {"prepared", "reviewed", "completed", "applied"}

def return_catalogue():
    return source.json_value((HERE / "directory-operating-returns-schema.json").read_bytes())

def return_input(name, raw):
    value = copy.deepcopy(schema.validate(raw, return_catalogue()["inputSchemas"][name], name))
    if len(source.jbytes(value)) > MAX_REQUEST:
        raise InputError("The complete returned-procedure request exceeds 192 MiB")
    if "actor" in value:
        if not value["actor"].strip():
            raise InputError("Record the actual reviewing or receiving operator")
        value.setdefault("note", "")
    if name == "operating_return_prepare":
        value.setdefault("reviewer", ""); value.setdefault("notes", "")
    if name == "operating_return_revise":
        value.setdefault("updates", {}); value.setdefault("decisions", [])
        keys = [d["key"] for d in value["decisions"]]
        if len(keys) != len(set(keys)):
            raise InputError("Make one explicit current choice for each change in this request")
    return value

def retained_return_files(record):
    if not isinstance(record.get("files"), dict) or set(record["files"]) != FILE_KEYS:
        raise InputError("A returned procedure retains its complete review, comparison and accepted input")
    return list(record["files"].values())

class DirectoryOperatingReturns:
    def _return_model(self, action, payload):
        node = (os.environ.get("SF30_DIRECTORY_NODE") or os.environ.get("SF30_REFERRAL_NODE")
                or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node"))
        if not node:
            raise InputError("Select the existing Node runtime for the original returned OperatingPlan")
        raw = source.jbytes({"action": action, "payload": payload})
        if len(raw) > MAX_BRIDGE:
            raise InputError("The complete original-model return request exceeds 512 MiB")
        with self.scratch() as temp:
            inp, out, err = [Path(temp) / p for p in ("return-input.json", "return-output.json", "return-stderr.txt")]
            original_workspace.private_write(inp, raw)
            with os.fdopen(os.open(err, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as stderr:
                try:
                    done = subprocess.run([node, str(HERE / "directory_operating_return_bridge.mjs"), str(inp), str(out)],
                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=stderr,
                        timeout=180, check=False)
                except subprocess.TimeoutExpired as exc:
                    raise InputError("The original returned-plan model did not finish within 180 seconds; retain the original request") from exc
            if not out.exists():
                reason = safe_read(err, 1024 * 1024).decode("utf-8", "replace")
                raise InputError("The original return model did not produce its result: " + reason[-4000:])
            response = source.json_value(safe_read(out, MAX_BRIDGE))
            if response.get("ok") is not True:
                error = response.get("error", {})
                message = error.get("message", "The original return model rejected this request")
                if error.get("code") in {"RETURN_CURRENT_ADVANCED", "RETURN_ORIGIN_CONFLICT",
                        "RETURN_ANCESTOR_MISSING", "RETURN_COPY_HISTORY_CHANGED"}:
                    raise ConflictError(message)
                raise InputError(message)
            if done.returncode:
                raise InputError("The original return model returned an inconsistent completion")
            return response["value"]

    def _return_record(self, ident):
        record = self.directory_record(RETURN_KIND, ident)
        if record.get("schema") != RETURN_SCHEMA or record.get("workspaceId") != self.workspace_id or record.get("stage") not in STAGES:
            raise InputError("Select an original Directory returned-procedure record")
        retained_return_files(record)
        return record

    def _return_json(self, descriptor, maximum):
        return self._operating_json(descriptor, maximum)

    def _return_request(self, action, value):
        return _body_sha({"schema": RETURN_SCHEMA, "workspaceId": self.workspace_id, "action": action, "input": value})

    def _return_replay(self, action, request_sha):
        with self.mutex:
            rows = self.db.execute("SELECT id FROM directory_records WHERE kind=? AND json_extract(body,'$.action')=? "
                "AND json_extract(body,'$.requestSha256')=? ORDER BY created,id LIMIT 2",
                (RETURN_KIND, action, request_sha)).fetchall()
        if len(rows) > 1:
            raise ConflictError("The original returned-procedure request has conflicting retained results")
        return self._return_record(rows[0][0]) if rows else None

    def _return_basis(self, current_id):
        current = self._operating_record(current_id, saved=True)
        basis = self._operating_json(current["files"]["basis"], MAX_BASIS)
        self._verify_operating_basis(basis)
        return current

    def _return_parts(self, value, result):
        return {
            "review": self._retain_operating_json(result["review"], "complete-original-operating-plan-return", MAX_REVIEW),
            "comparison": self._retain_operating_json(result["comparison"], "complete-original-operating-return-comparison", MAX_COMPARISON),
            "input": self._retain_operating_json(value, "complete-original-operating-return-input", MAX_REQUEST),
        }

    def _return_value(self, action, request_sha, value, result, files, current, stage, *,
                      predecessor=None, applied=None, added=None, already=None):
        return {"schema": RETURN_SCHEMA, "workspaceId": self.workspace_id, "stage": stage,
            "action": action, "requestSha256": request_sha, "reviewId": result["review"]["id"],
            "planId": current["planId"], "currentRecordId": current["id"],
            "predecessorRecordId": predecessor, "appliedPlanRecordId": applied,
            "addedRevisions": added, "alreadyPresent": already,
            "summary": result["summary"], "reviewDetails": {k: result["review"][k] for k in ("reviewer", "notes", "createdAt")}, "files": files,
            "basisSha256": current["files"]["basis"]["sha256"],
            "catalogSha256": current["files"]["catalog"]["sha256"],
            "actor": value["actor"], "note": value.get("note", "")}

    def _return_save(self, action, request_sha, record, current_head=None):
        with self._operating_commit():
            old = self._return_replay(action, request_sha)
            if old:
                return {"record": old, "reused": True}
            if current_head is not None:
                head = self._operating_head(record["planId"])
                if not head or head["id"] != current_head:
                    raise ConflictError("The current procedure advanced before this return was prepared; retain the incoming file and reopen its actual history")
            saved = self._directory_store(RETURN_KIND, record)
        return {"record": saved, "reused": False}

    def directory_operating_return_review(self, ident):
        return self._return_json(self._return_record(ident)["files"]["review"], MAX_REVIEW)

    def directory_operating_return_comparison(self, ident):
        return self._return_json(self._return_record(ident)["files"]["comparison"], MAX_COMPARISON)

    def directory_operating_return_input(self, ident):
        return self._return_json(self._return_record(ident)["files"]["input"], MAX_REQUEST)

    def directory_operating_return_file(self, ident, kind="review"):
        if kind not in FILE_KEYS:
            raise InputError("Choose the complete original review, comparison or accepted input")
        record = self._return_record(ident); descriptor = record["files"][kind]
        return self._directory_file_path(descriptor), {**descriptor,
            "filename": "Operating_Return_" + kind + "_" + ident + ".json", "contentType": "application/json"}

    def directory_operating_return_rows(self, ident, offset=0, limit=50, kind=None, conflict=None, unresolved=None):
        value = {"offset": offset, "limit": limit}
        for key, item in (("kind", kind), ("conflict", conflict), ("unresolved", unresolved)):
            if item is not None:
                value[key] = item
        value = return_input("operating_return_rows", value)
        compared = self.directory_operating_return_comparison(ident)
        missing = set(compared["unresolved"])
        rows = []
        for row in compared["rows"]:
            if kind is not None and row["kind"] != kind: continue
            if conflict is not None and row["conflict"] != conflict: continue
            if unresolved is not None and (row["key"] in missing) != unresolved: continue
            rows.append(row)
        page = self._directory_rows_page(rows, offset, limit)
        return {"recordId": ident, "reviewId": compared["reviewId"], **page,
            "summary": compared["summary"], "ready": compared["ready"], "issues": compared["issues"]}

    def prepare_directory_operating_return(self, raw):
        value = return_input("operating_return_prepare", raw)
        request_sha = self._return_request("prepare", value)
        old = self._return_replay("prepare", request_sha)
        if old: return {"record": old, "reused": True}
        current = self._return_basis(value["recordId"])
        result = self._return_model("prepare", {
            "current": self.directory_operating_plan_document(current["id"]), "incoming": value["incoming"],
            "options": {k: value[k] for k in ("id", "reviewer", "notes", "createdAt")}})
        files = self._return_parts(value, result)
        record = self._return_value("prepare", request_sha, value, result, files, current, "prepared")
        return self._return_save("prepare", request_sha, record, current_head=current["id"])

    def revise_directory_operating_return(self, raw):
        value = return_input("operating_return_revise", raw)
        request_sha = self._return_request("revise", value)
        old = self._return_replay("revise", request_sha)
        if old: return {"record": old, "reused": True}
        prior = self._return_record(value["recordId"])
        current = self._return_basis(prior["currentRecordId"])
        review = self.directory_operating_return_review(prior["id"])
        result = self._return_model("revise", {"review": review, "updates": value["updates"], "decisions": value["decisions"]})
        files = self._return_parts(value, result)
        return self._return_save("revise", request_sha, self._return_value("revise", request_sha, value,
            result, files, current, "reviewed", predecessor=prior["id"]))

    def complete_directory_operating_return(self, raw):
        value = return_input("operating_return_complete", raw)
        request_sha = self._return_request("complete", value)
        old = self._return_replay("complete", request_sha)
        if old: return {"record": old, "reused": True}
        prior = self._return_record(value["recordId"])
        review = self.directory_operating_return_review(prior["id"])
        if review["completion"] is not None:
            return {"record": prior, "reused": True}
        current = self._return_basis(prior["currentRecordId"])
        result = self._return_model("complete", {"review": review, "savedAt": value["savedAt"]})
        files = self._return_parts(value, result)
        return self._return_save("complete", request_sha, self._return_value("complete", request_sha, value,
            result, files, current, "completed", predecessor=prior["id"]))

    def receive_directory_operating_return(self, raw):
        value = return_input("operating_return_receive", raw)
        request_sha = self._return_request("receive", value)
        old = self._return_replay("receive", request_sha)
        if old: return {"record": old, "reused": True}
        current = self._return_basis(value["currentRecordId"])
        result = self._return_model("inspect", {"review": value["review"]})
        if result["review"]["current"] != self.directory_operating_plan_document(current["id"]):
            raise ConflictError("Bind the returned review to its exact original saved current procedure")
        files = self._return_parts(value, result)
        return self._return_save("receive", request_sha, self._return_value("receive", request_sha, value,
            result, files, current, "completed" if result["review"]["completion"] is not None else "reviewed"))

    def apply_directory_operating_return(self, raw):
        value = return_input("operating_return_apply", raw)
        request_sha = self._return_request("apply", value)
        old = self._return_replay("apply", request_sha)
        if old: return {"record": old, "plan": self._operating_record(old["appliedPlanRecordId"], saved=True), "reused": True}
        intent = self._return_record(value["recordId"])
        review = self.directory_operating_return_review(intent["id"])
        if intent["stage"] not in {"completed", "applied"} or review["completion"] is None:
            raise InputError("Complete and retain this original return review before applying its result")
        current = self._return_basis(intent["currentRecordId"])
        expected = self._operating_record(value["expectedRecordId"], saved=True)
        if expected["planId"] != current["planId"] or any(expected["files"][key] != current["files"][key] for key in ("basis", "catalog")):
            raise ConflictError("The selected destination belongs to another original plan or native basis")
        receive_input = {"document": review["completion"]["plan"], "expectedRecordId": expected["id"],
            "actor": value["actor"], "note": value["note"]}
        receive_sha = self._operating_request("receive", receive_input)
        received = self._operating_replay("receive", receive_sha, "saved")
        head = self._operating_head(current["planId"])
        if not head:
            raise ConflictError("The original destination plan is missing")
        if any(head["files"][key] != current["files"][key] for key in ("basis", "catalog")):
            raise ConflictError("The original destination plan changed its complete native basis")
        actual = self.directory_operating_plan_document(head["id"])
        applied = self._return_model("apply", {"review": review, "current": actual})
        if received:
            # The exact original receive may have committed before this return
            # receipt. Validate its complete result, even if later edits exist.
            verified = self._return_model("apply", {"review": review,
                "current": self.directory_operating_plan_document(received["id"])})
            if not verified["alreadyPresent"]:
                raise ConflictError("The retained native receiving result does not contain this completed review")
            plan, added, already = received, received["revision"] - expected["revision"], False
        elif applied["alreadyPresent"]:
            # Read-only successful recovery: the original full result is an
            # exact prefix of the current history, and no new revision is made.
            plan, added, already = head, 0, True
        else:
            if head["id"] != expected["id"]:
                raise ConflictError("The actual saved procedure changed; preserve this completed review and reopen the current head")
            joined = self.receive_directory_operating_plan(receive_input)
            plan, added, already = joined["record"], joined["addedRevisions"], joined["reused"]
        result = self._return_model("inspect", {"review": review})
        files = {**intent["files"],
            "input": self._retain_operating_json(value, "complete-original-operating-return-input", MAX_REQUEST)}
        record = self._return_value("apply", request_sha, value, result, files, current, "applied",
            predecessor=intent["id"], applied=plan["id"], added=added, already=already)
        saved = self._return_save("apply", request_sha, record)
        return {**saved, "plan": self._operating_record(saved["record"]["appliedPlanRecordId"], saved=True)}

    def export_directory_operating_return(self, raw):
        value = return_input("operating_return_export", raw)
        request_sha = self._return_request("export", value)
        with self.mutex:
            row = self.db.execute("SELECT id FROM directory_records WHERE kind='exports' AND json_extract(body,'$.requestSha256')=? LIMIT 1",
                (request_sha,)).fetchone()
        if row:
            saved = self.directory_record("exports", row[0]); self._directory_file_path(saved["file"]); return saved
        record = self._return_record(value["recordId"])
        review = self.directory_operating_return_review(record["id"])
        if value["format"] == "html":
            rendered = self._return_model("html", {"review": review})
            raw_file, name, media = rendered["content"].encode(), rendered["filename"], rendered["contentType"]
        elif value["format"] == "plan":
            if review["completion"] is None:
                raise InputError("Complete the original review before exporting its reviewed plan")
            raw_file, name, media = source.jbytes(review["completion"]["plan"]), "Reviewed_Operating_Plan.json", "application/json"
        else:
            raw_file, name, media = source.jbytes(review), "Operating_Plan_Return.json", "application/json"
        if len(raw_file) > MAX_BRIDGE:
            raise InputError("The complete readable or editable returned procedure exceeds 512 MiB")
        with self.scratch() as temp:
            path = Path(temp) / name; original_workspace.private_write(path, raw_file)
            descriptor = self._directory_retain_file(path, "complete-operating-return-" + value["format"])
        return self._directory_store("exports", {"kind": "operating-return", "recordId": record["id"],
            "requestSha256": request_sha, "label": value.get("label", record["summary"]["title"]),
            "actor": value["actor"], "note": value["note"], "name": name, "contentType": media,
            "file": descriptor, "result": {"reviewId": record["reviewId"], "planId": record["planId"],
                "stage": record["stage"], "format": value["format"], "completeHistories": value["format"] != "plan"}})

    def _verify_operating_returns_received(self, registry):
        records = registry["records"].get(RETURN_KIND, [])
        by_id = {r["id"]: r for r in records}
        if len(by_id) != len(records):
            raise InputError("The returned-procedure registry repeats an original record")
        checked = []
        for record in records:
            if self._return_record(record["id"]) != record:
                raise InputError("The received return record changed")
            for descriptor in retained_return_files(record):
                self._directory_file_path(descriptor)
            current = self._return_basis(record["currentRecordId"])
            if current["planId"] != record["planId"] or current["files"]["basis"]["sha256"] != record["basisSha256"] or current["files"]["catalog"]["sha256"] != record["catalogSha256"]:
                raise InputError("The received return lost its original saved procedure basis")
            accepted = self.directory_operating_return_input(record["id"])
            action = record["action"]
            if action not in {"prepare", "revise", "complete", "receive", "apply"}:
                raise InputError("The returned procedure has an unknown original action")
            if return_input("operating_return_" + action, accepted) != accepted or self._return_request(action, accepted) != record["requestSha256"]:
                raise InputError("The complete accepted returned-procedure request changed")
            if accepted["actor"] != record["actor"] or accepted["note"] != record["note"]:
                raise InputError("The original returned-procedure author changed")
            review = self.directory_operating_return_review(record["id"])
            original = self._return_model("inspect", {"review": review})
            if review["current"] != self.directory_operating_plan_document(current["id"]):
                raise InputError("The return no longer retains its complete original current history")
            if original["summary"] != record["summary"] or original["comparison"] != self.directory_operating_return_comparison(record["id"]):
                raise InputError("The received comparison differs from the original model")
            if record.get("reviewDetails") != {k: review[k] for k in ("reviewer", "notes", "createdAt")}:
                raise InputError("The retained reviewer details differ from the complete original review")
            if original["review"]["id"] != record["reviewId"]:
                raise InputError("The returned review identity changed")
            parent_id = record.get("predecessorRecordId")
            parent = by_id.get(parent_id) if parent_id else None
            if parent_id and (parent is None or parent["currentRecordId"] != current["id"]):
                raise InputError("The return is missing its complete original review predecessor")
            if action == "prepare":
                if parent or record["stage"] != "prepared" or accepted["recordId"] != current["id"]:
                    raise InputError("The prepared return has conflicting original bindings")
                expected = self._return_model("prepare", {"current": review["current"], "incoming": accepted["incoming"],
                    "options": {k: accepted[k] for k in ("id", "createdAt", "reviewer", "notes")}})["review"]
            elif action == "receive":
                if parent or accepted["currentRecordId"] != current["id"]:
                    raise InputError("The received review lost its original binding")
                expected = self._return_model("inspect", {"review": accepted["review"]})["review"]
                if record["stage"] != ("completed" if expected["completion"] is not None else "reviewed"):
                    raise InputError("The received review stage differs from its original completion")
            else:
                if not parent or accepted["recordId"] != parent["id"]:
                    raise InputError("The accepted return request lost its original review predecessor")
                previous = self.directory_operating_return_review(parent["id"])
                if action == "revise":
                    expected = self._return_model("revise", {"review": previous,
                        "updates": accepted["updates"], "decisions": accepted["decisions"]})["review"]
                    if record["stage"] != "reviewed": raise InputError("The reviewed return stage changed")
                elif action == "complete":
                    expected = self._return_model("complete", {"review": previous, "savedAt": accepted["savedAt"]})["review"]
                    if record["stage"] != "completed": raise InputError("The completed return stage changed")
                else:
                    expected = previous
                    if record["stage"] != "applied" or expected["completion"] is None:
                        raise InputError("The applied return has no complete saved review intent")
                    plan = self._operating_record(record["appliedPlanRecordId"], saved=True)
                    selected = self._operating_record(accepted["expectedRecordId"], saved=True)
                    for item in (plan, selected):
                        if item["planId"] != current["planId"] or any(item["files"][k] != current["files"][k] for k in ("basis", "catalog")):
                            raise InputError("The applied return belongs to another original plan basis")
                    applied = self._return_model("apply", {"review": expected,
                        "current": self.directory_operating_plan_document(plan["id"])})
                    if not applied["alreadyPresent"]:
                        raise InputError("The restored native plan does not contain the exact reviewed result")
                    if not isinstance(record["alreadyPresent"], bool) or type(record["addedRevisions"]) is not int or record["addedRevisions"] < 0:
                        raise InputError("The original return receiving counts are invalid")
                    if record["alreadyPresent"]:
                        if record["addedRevisions"] != 0: raise InputError("A reused return cannot append revisions")
                    else:
                        native_input = {"document": expected["completion"]["plan"], "expectedRecordId": selected["id"],
                            "actor": accepted["actor"], "note": accepted["note"]}
                        if plan.get("action") != "receive" or plan.get("requestSha256") != self._operating_request("receive", native_input) or plan["predecessorRecordId"] != selected["id"]:
                            raise InputError("The applied review lost the original native receiving request")
                        if record["addedRevisions"] != plan["revision"] - selected["revision"]:
                            raise InputError("The original return receiving revision count changed")
            if expected != review:
                raise InputError("The retained review differs from its original accepted input and decisions")
            if action != "apply" and any(record.get(k) is not None for k in ("appliedPlanRecordId", "addedRevisions", "alreadyPresent")):
                raise InputError("An unapplied review cannot claim a native saved outcome")
            visited, node = set(), record
            while node.get("predecessorRecordId"):
                if node["id"] in visited: raise InputError("The original return history contains a cycle")
                visited.add(node["id"]); node = by_id.get(node["predecessorRecordId"])
                if node is None: raise InputError("The complete return history is missing an original predecessor")
            checked.append({"recordId": record["id"], "reviewId": record["reviewId"], "stage": record["stage"],
                "currentRecordId": current["id"], "appliedPlanRecordId": record.get("appliedPlanRecordId")})
        return {"count": len(checked), "checked": checked}
