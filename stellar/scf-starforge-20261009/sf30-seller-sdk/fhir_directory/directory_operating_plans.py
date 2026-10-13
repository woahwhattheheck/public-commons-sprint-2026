"""MIT. Complete original OperatingPlan histories in the native Directory store.

The unchanged source-owned JavaScript model owns plan validation, revisions,
prefix receiving, copy, registration comparison and readable exports. This
mixin only joins original Directory records and its existing private file store.
It never executes a plan step or starts a provider acquisition.
"""
from __future__ import annotations
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from contextlib import contextmanager
from directory_runtime import InputError, ConflictError, source, now, safe_read, original_workspace
import directory_schema as schema

HERE = Path(__file__).resolve().parent
PLAN_KIND = "operatingPlans"
PLAN_SCHEMA = "stellar-forge.operating-plan.v1"
BASIS_SCHEMA = "stellar-forge.directory-operating-basis.v1"
RECORD_SCHEMA = "stellar-forge.directory-operating-plan-record.v1"
PREVIEW_SCHEMA = "stellar-forge.directory-operating-preview.v1"
MAX_DOCUMENT = 32 * 1024 * 1024
MAX_REQUEST = 64 * 1024 * 1024
MAX_BRIDGE = 128 * 1024 * 1024
MAX_BASIS = 4 * 1024 * 1024
MAX_REFS = 1000
FILE_KEYS = {"document", "basis", "catalog", "input"}
SELECTED = {
    "editionId": "editions", "mappingId": "mappings",
    "previewId": "mappingPreviews", "conversionId": "sourceConversions",
    "selectionId": "selections", "referralJoinId": "referralJoins",
    "handoffId": "handoffs",
}
LABELS = {
    "sources": "Read the complete original directory source",
    "editions": "Reopen the selected original source edition",
    "comparisons": "Review the exact original edition comparison",
    "mappings": "Read the reviewed field and identity mapping",
    "mappingPreviews": "Review the complete mapped preview and its findings",
    "sourceConversions": "Read the retained FHIR conversion and original field links",
    "selections": "Review the actual saved service choice",
    "referralJoins": "Read the original referral and selected service assignment",
    "handoffs": "Read the frozen complete receiving handoff",
    "receivingReviews": "Read the actual receiving observation",
    "conformancePlans": "Read the selected publisher conformance scope",
    "conformanceAssessments": "Read the retained conformance assessment",
}

def operating_catalogue():
    return source.json_value((HERE / "directory-operating-plans-schema.json").read_bytes())

def typed(name, raw):
    value = copy.deepcopy(schema.validate(raw, operating_catalogue()["inputSchemas"][name], name))
    if len(source.jbytes(value)) > MAX_REQUEST:
        raise InputError("The complete Operating Plans request exceeds 64 MiB")
    if "actor" in value and not value["actor"].strip():
        raise InputError("Record the actual procedure author or receiving owner")
    if "actor" in value:
        value.setdefault("note", "")
    if name == "operating_plan_create":
        value.setdefault("recorded", True)
        value.setdefault("continuations", [])
    return value

def _body_sha(value):
    return source.sha(source.jbytes(value))

def _absolute(value, label):
    if not isinstance(value, str) or not value.startswith("/") or len(value) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise InputError(label + " requires an explicit absolute private operating path")
    return str(Path(value))

def _short(value, original):
    # Large original summaries remain in the complete native record. The plan
    # carries an explicit original-record reference rather than partial JSON.
    return value if len(source.jbytes(value)) <= 8192 else {
        "completeSummary": original, "summaryBytes": len(source.jbytes(value)),
        "instruction": "Read the complete original record for this summary."}

def retained_operating_files(record):
    files = record.get("files")
    if not isinstance(files, dict) or set(files) != FILE_KEYS:
        raise InputError("A procedure retains its complete document, basis, catalog and input")
    return list(files.values())

class DirectoryOperatingPlans:
    def _operating_model(self, action, payload=None):
        node = (os.environ.get("SF30_DIRECTORY_NODE") or os.environ.get("SF30_REFERRAL_NODE")
                or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node"))
        if not node:
            raise InputError("Select the existing Node runtime for the original OperatingPlan model")
        request = {"action": action, "payload": payload or {}}
        raw = source.jbytes(request)
        if len(raw) > MAX_BRIDGE:
            raise InputError("The complete internal original-model request exceeds 128 MiB")
        with self.scratch() as temp:
            inp, out, err = [Path(temp) / name for name in ("plan-request.json", "plan-result.json", "plan-stderr.txt")]
            original_workspace.private_write(inp, raw)
            with os.fdopen(os.open(err, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as stderr:
                try:
                    completed = subprocess.run([node, str(HERE / "directory_operating_plan_bridge.mjs"), str(inp), str(out)],
                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=stderr, timeout=180, check=False)
                except subprocess.TimeoutExpired as exc:
                    raise InputError("The original OperatingPlan model did not finish within 180 seconds; the native plan was not committed") from exc
            if not out.exists():
                message = safe_read(err, 1024 * 1024).decode("utf-8", "replace")
                raise InputError("Original OperatingPlan model failed before returning: " + message[-4000:])
            result = source.json_value(safe_read(out, MAX_BRIDGE))
            if result.get("ok") is not True:
                error = result.get("error", {})
                message = error.get("message", "The original OperatingPlan rejected this document")
                if error.get("code") in {"PLAN_REVISION_CONFLICT", "PLAN_ORIGIN_CONFLICT", "PLAN_HISTORY_DIVERGED"}:
                    raise ConflictError(message)
                raise InputError(message)
            if completed.returncode != 0:
                raise InputError("The original OperatingPlan process returned an inconsistent completion")
            return result["value"]

    def directory_operating_catalogue(self):
        return self._operating_model("catalog")

    def directory_operating_step(self, raw):
        return self._operating_model("step", typed("operating_plan_step", raw))

    def _operating_json(self, descriptor, maximum=MAX_DOCUMENT):
        if descriptor.get("bytes", maximum + 1) > maximum:
            raise InputError("The complete procedure file exceeds its declared receiving limit")
        return source.json_value(safe_read(self._directory_file_path(descriptor), maximum))

    def _retain_operating_json(self, value, role, maximum=MAX_DOCUMENT):
        raw = source.jbytes(value)
        if len(raw) > maximum:
            raise InputError("The complete " + role + " exceeds its declared byte limit")
        with self.scratch() as temp:
            path = Path(temp) / "complete.json"
            original_workspace.private_write(path, raw)
            return self._directory_retain_file(path, role)

    def _operating_record(self, ident, saved=False):
        record = self.directory_record(PLAN_KIND, ident)
        if record.get("schema") != RECORD_SCHEMA or record.get("workspaceId") != self.workspace_id or record.get("stage") not in {"prepared", "saved"}:
            raise InputError("Choose an original Operating Plans record in this workspace")
        if saved and record["stage"] != "saved":
            raise InputError("Select the saved procedure record, or accept its exact prepared preview first")
        retained_operating_files(record)
        return record

    def _operating_request(self, action, value):
        return _body_sha({"schema": RECORD_SCHEMA, "workspaceId": self.workspace_id,
                          "action": action, "input": value})

    def _operating_replay(self, action, request_sha, stage=None):
        args = [PLAN_KIND, action, request_sha]
        condition = ""
        if stage is not None:
            condition = " AND json_extract(body,'$.stage')=?"
            args.append(stage)
        with self.mutex:
            rows = self.db.execute("SELECT id FROM directory_records WHERE kind=? AND json_extract(body,'$.action')=? "
                "AND json_extract(body,'$.requestSha256')=?" + condition + " ORDER BY created,id LIMIT 2", args).fetchall()
        if len(rows) > 1:
            raise ConflictError("The original procedure request has more than one retained result")
        return self._operating_record(rows[0][0]) if rows else None

    def _operating_head(self, plan_id):
        # SQLite reads only native metadata. Complete histories remain in the
        # retained-file store and are opened only for the chosen procedure.
        with self.mutex:
            rows = self.db.execute("""SELECT r.id FROM directory_records r
                WHERE r.kind=? AND json_extract(r.body,'$.stage')='saved'
                AND json_extract(r.body,'$.planId')=?
                AND NOT EXISTS(SELECT 1 FROM directory_records child WHERE child.kind=r.kind
                    AND json_extract(child.body,'$.stage')='saved'
                    AND json_extract(child.body,'$.predecessorRecordId')=r.id)
                ORDER BY r.created,r.id LIMIT 2""", (PLAN_KIND, plan_id)).fetchall()
        if len(rows) > 1:
            raise ConflictError("This saved procedure has divergent native heads; preserve both original histories")
        return self._operating_record(rows[0][0], saved=True) if rows else None

    @contextmanager
    def _operating_commit(self):
        # BEGIN IMMEDIATE gives the existing database one cross-process
        # compare-and-save boundary, in addition to its original local mutex.
        with self.mutex:
            if self.db.in_transaction:
                raise ConflictError("Finish the existing native database transaction before saving a procedure")
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise

    def _operating_basis(self, raw):
        selected = copy.deepcopy(raw)
        refs, records = {}, {}
        def add(kind, ident):
            source.identity(ident)
            key = kind + "/" + ident
            if key not in records:
                if len(records) >= MAX_REFS:
                    raise InputError("Choose at most 1,000 complete original records for this procedure")
                r = self.directory_record(kind, ident)
                refs[key] = {"kind": kind, "id": ident, "sha256": _body_sha(r)}
                records[key] = r
            return records[key]
        def select(field, ident):
            if not ident:
                return None
            if selected.get(field) and selected[field] != ident:
                raise InputError("The selected procedure records disagree about " + field)
            selected[field] = ident
            return add(SELECTED[field], ident)
        select("editionId", selected["editionId"])
        # Only real parent links complete an omitted selection. An explicit
        # conflicting choice is rejected; no matching-name inference occurs.
        for _ in range(len(SELECTED) + 1):
            before = dict(selected)
            for field in SELECTED:
                if selected.get(field):
                    r = select(field, selected[field])
                    links = {
                        "handoffId": ["selectionId", "conversionId", "referralJoinId"],
                        "referralJoinId": ["selectionId", "conversionId"],
                        "selectionId": ["editionId", "conversionId"],
                        "conversionId": ["editionId", "mappingId", "previewId"],
                        "previewId": ["editionId", "mappingId"],
                        "mappingId": ["editionId"],
                    }.get(field, [])
                    for link in links:
                        if r.get(link):
                            select(link, r[link])
            if selected == before:
                break
        selected_edition = add("editions", selected["editionId"])
        for ident in selected_edition["sourceIds"]:
            add("sources", ident)
        for ident in selected.get("contextSourceIds", []):
            add("sources", ident)
        for ident in selected.get("comparisonIds", []):
            r = add("comparisons", ident)
            for key in ("beforeEditionId", "afterEditionId"):
                edition = add("editions", r[key])
                for sid in edition["sourceIds"]:
                    add("sources", sid)
        for ident in selected.get("conformanceAssessmentIds", []):
            r = add("conformanceAssessments", ident)
            plan = add("conformancePlans", r["planId"])
            if r["subjectKind"] != plan["subjectKind"] or r["subjectId"] != plan["subjectId"]:
                raise InputError("The original conformance assessment and its selected scope differ")
            if r["subjectKind"] == "editions" and r["subjectId"] != selected["editionId"]:
                raise InputError("Select conformance for this exact directory edition")
            if r["subjectKind"] == "sources" and r["subjectId"] not in selected_edition["sourceIds"]:
                raise InputError("Select conformance for an original source in this directory edition")
        for ident in selected.get("receivingReviewIds", []):
            r = add("receivingReviews", ident)
            if r.get("handoffId"):
                select("handoffId", r["handoffId"])
        # Receiving observations may introduce the one explicit handoff and
        # its parent links; resolve through the same exact selectors once.
        if selected.get("handoffId"):
            h = select("handoffId", selected["handoffId"])
            for field in ("selectionId", "conversionId", "referralJoinId"):
                if h.get(field):
                    select(field, h[field])
            if selected.get("referralJoinId"):
                j = select("referralJoinId", selected["referralJoinId"])
                select("selectionId", j["selectionId"]); select("conversionId", j["conversionId"])
            if selected.get("selectionId"):
                s = select("selectionId", selected["selectionId"])
                select("editionId", s["editionId"])
                if s.get("conversionId"): select("conversionId", s["conversionId"])
            if selected.get("conversionId"):
                c = select("conversionId", selected["conversionId"])
                select("editionId", c["editionId"]); select("mappingId", c["mappingId"]); select("previewId", c["previewId"])
            if selected.get("previewId"):
                p = select("previewId", selected["previewId"]); select("mappingId", p["mappingId"])
            if selected.get("mappingId"):
                m = select("mappingId", selected["mappingId"]); select("editionId", m["editionId"])
        observations, findings = [], []
        order = list(LABELS)
        for key in sorted(records, key=lambda k: (order.index(k.split("/")[0]), k)):
            r, ref = records[key], refs[key]
            kind, ident = ref["kind"], ref["id"]
            files = {}
            for name, value in r.items():
                if isinstance(value, dict) and {"sha256", "bytes", "role"} <= set(value):
                    files[name] = copy.deepcopy(value)
            if isinstance(r.get("files"), dict):
                for name, value in r["files"].items():
                    if isinstance(value, dict) and {"sha256", "bytes", "role"} <= set(value):
                        files["files/" + name] = copy.deepcopy(value)
            for descriptor in files.values():
                self._directory_file_path(descriptor)
            links = {k: v for k, v in r.items() if k != "id" and (k.endswith("Id") or k in {"sourceIds", "chosenRefs"})}
            observed = {k: r[k] for k in ("label", "inventory", "summary", "disposition", "scope", "createdAt") if k in r}
            observations.append({
                "key": kind + "-" + ident[:24], "title": LABELS[kind],
                "kind": kind, "id": ident, "status": "completed",
                "summary": _short(observed, ref), "files": _short(files, ref),
                "links": _short(links, ref),
                "recordedResult": "This complete immutable record and its selected file descriptors were read from the native workspace at the basis observation time. This records saved local state only.",
            })
            if kind == "mappingPreviews":
                s = r.get("summary", {})
                findings.append("Mapping preview " + ident + " retains " + str(s.get("errors", "unreported")) +
                    " errors and " + str(s.get("warnings", "unreported")) +
                    " warnings. Read its complete original report before recording a disposition.")
            if kind == "conformanceAssessments":
                findings.append("Conformance assessment " + ident + " retains its selected publisher profile, full findings and original rule scope. Read the complete report; a recorded assessment is not a claim of universal conformance.")
            if kind == "receivingReviews":
                detail = r.get("findings", "")
                findings.append("Receiving review " + ident + " recorded disposition " + str(r.get("disposition")) +
                    (": " + detail if isinstance(detail, str) and len(detail) <= 2000 else ". Its complete original findings remain in that exact native record."))
        if len("\n\n".join(findings)) > 20000:
            findings = ["Read all " + str(len(findings)) + " original mapping, conformance and receiving summaries through the retained basis references. Their complete records remain authoritative; this procedure does not close those findings."]
        ordered_refs = [refs[k] for k in sorted(refs)]
        basis = {"schema": BASIS_SCHEMA, "workspaceId": self.workspace_id, "workspace": str(self.root),
            "observedAt": now(), "selection": selected, "recordRefs": ordered_refs,
            "recordRefsSha256": _body_sha(ordered_refs), "observations": observations, "findings": findings}
        if len(source.jbytes(basis)) > MAX_BASIS:
            raise InputError("The complete selected procedure basis exceeds 4 MiB; select a smaller explicit scope")
        return basis

    def _verify_operating_basis(self, basis, strict=True):
        if basis.get("schema") != BASIS_SCHEMA or basis.get("workspaceId") != self.workspace_id:
            raise InputError("The procedure basis belongs to another original workspace")
        refs = basis.get("recordRefs")
        if not isinstance(refs, list) or not refs or len(refs) > MAX_REFS or _body_sha(refs) != basis.get("recordRefsSha256"):
            raise InputError("The complete original procedure record-reference inventory changed")
        seen, observations = set(), []
        for ref in refs:
            if not isinstance(ref, dict) or set(ref) != {"kind", "id", "sha256"} or ref["kind"] not in LABELS:
                raise InputError("The procedure basis contains an unsupported original record reference")
            source.identity(ref["id"]); source.identity(ref["sha256"])
            key = (ref["kind"], ref["id"])
            if key in seen:
                raise InputError("The original procedure basis repeats a record")
            seen.add(key)
            record = self.directory_record(ref["kind"], ref["id"], required=False)
            actual = _body_sha(record) if record else None
            state = "unchanged" if actual == ref["sha256"] else "missing" if record is None else "changed"
            if strict and state != "unchanged":
                raise ConflictError("The original procedure basis record is " + state + ": " + "/".join(key))
            observations.append({"kind": key[0], "id": key[1], "state": state, "originalSha256": ref["sha256"], "currentSha256": actual})
        if ("editions", basis.get("selection", {}).get("editionId")) not in seen:
            raise InputError("The complete original directory edition is absent from the procedure basis")
        return {"workspaceId": self.workspace_id, "originalWorkspace": basis.get("workspace"),
            "currentWorkspace": str(self.root), "relocated": str(self.root) != basis.get("workspace"),
            "observedAt": now(), "records": observations}

    def directory_operating_plan_document(self, ident):
        record = self._operating_record(ident)
        return self._operating_json(record["files"]["document"])

    def directory_operating_plan_input(self, ident):
        record = self._operating_record(ident)
        return self._operating_json(record["files"]["input"], MAX_REQUEST)

    def directory_operating_plan_basis(self, ident):
        record = self._operating_record(ident)
        return self._operating_json(record["files"]["basis"], MAX_BASIS)

    def directory_operating_plan_draft(self, ident, revision=None):
        record = self._operating_record(ident, saved=True)
        return self._operating_model("draft", {"document": self._operating_json(record["files"]["document"]), "revision": revision})

    def _operating_result(self, record, reused=False, added=None):
        return {"record": record, "reused": reused,
                "addedRevisions": (0 if reused else record["revision"]) if added is None else added}

    def _operating_value(self, action, request_sha, value, document, summary, files, *,
                         stage="saved", predecessor=None, prepared=None, origin=None):
        return {"schema": RECORD_SCHEMA, "workspaceId": self.workspace_id, "stage": stage,
            "planId": document["id"], "revision": len(document["revisions"]),
            "predecessorRecordId": predecessor, "preparedFromId": prepared, "originRecordId": origin,
            "action": action, "requestSha256": request_sha, "summary": summary, "files": files,
            "actor": value["actor"], "note": value.get("note", "")}

    def preview_directory_operating_plan(self, raw):
        value = typed("operating_plan_create", raw)
        value.pop("previewRecordId", None)
        _absolute(value["outputDirectory"], "Procedure output directory")
        request_sha = self._operating_request("preview", value)
        old = self._operating_replay("preview", request_sha, "prepared")
        if old is None:
            basis = self._operating_basis(value["basis"])
            prepared = self._operating_model("create", {"input": value, "basis": basis})
            document = prepared["document"]
            files = {
                "document": self._retain_operating_json(document, "complete-original-operating-plan"),
                "basis": self._retain_operating_json(basis, "complete-directory-operating-basis", MAX_BASIS),
                "catalog": self._retain_operating_json(prepared["catalog"], "complete-original-command-catalog", MAX_DOCUMENT),
                "input": self._retain_operating_json(value, "complete-original-procedure-input", MAX_REQUEST),
            }
            with self._operating_commit():
                old = self._operating_replay("preview", request_sha, "prepared")
                if old is None:
                    old = self._directory_store(PLAN_KIND, self._operating_value("preview", request_sha,
                        value, document, prepared["summary"], files, stage="prepared"))
        return {"schema": PREVIEW_SCHEMA, "workspaceId": self.workspace_id, "record": old,
            "basis": self._operating_json(old["files"]["basis"], MAX_BASIS),
            "document": self._operating_json(old["files"]["document"]), "summary": old["summary"]}

    def create_directory_operating_plan(self, raw):
        value = typed("operating_plan_create", raw)
        accepted = copy.deepcopy(value)
        request_sha = self._operating_request("create", accepted)
        old = self._operating_replay("create", request_sha, "saved")
        if old:
            return self._operating_result(old, True)
        preview_id = value.pop("previewRecordId", None)
        preview = self._operating_record(preview_id) if preview_id else self.preview_directory_operating_plan(value)["record"]
        if preview["stage"] != "prepared" or preview["action"] != "preview":
            raise InputError("Accept the exact original prepared preview")
        if self._operating_json(preview["files"]["input"], MAX_REQUEST) != value:
            raise ConflictError("The reviewed procedure input differs from this prepared preview; preserve it and prepare the edited input")
        basis = self._operating_json(preview["files"]["basis"], MAX_BASIS)
        self._verify_operating_basis(basis)
        document = self._operating_json(preview["files"]["document"])
        comparison = self._operating_model("compare", {"document": document})
        if any(step["status"] in {"changed", "missing"} or step.get("packageChanged") for step in comparison["steps"]):
            raise ConflictError("The original command registrations changed after preview; prepare a new reviewed procedure")
        files = {**preview["files"],
            "input": self._retain_operating_json(accepted, "complete-original-procedure-input", MAX_REQUEST)}
        with self._operating_commit():
            old = self._operating_replay("create", request_sha, "saved")
            if old:
                return self._operating_result(old, True)
            head = self._operating_head(document["id"])
            if head:
                if head.get("preparedFromId") == preview["id"] and head["files"]["document"] == preview["files"]["document"]:
                    return self._operating_result(head, True)
                raise ConflictError("This procedure ID already has a saved history; save its current draft or choose a new copy ID")
            saved = self._directory_store(PLAN_KIND, self._operating_value("create", request_sha, accepted,
                document, preview["summary"], files, prepared=preview["id"]))
        return self._operating_result(saved)

    def save_directory_operating_plan(self, raw):
        value = typed("operating_plan_save", raw)
        request_sha = self._operating_request("save", value)
        old = self._operating_replay("save", request_sha, "saved")
        if old:
            return self._operating_result(old, True)
        before = self._operating_record(value["recordId"], saved=True)
        document = self._operating_json(before["files"]["document"])
        saved = self._operating_model("save", {"document": document, "draft": value["draft"], "savedAt": value["savedAt"]})
        if saved["document"] == document:
            # A no-change draft does not create another history record.
            with self._operating_commit():
                head = self._operating_head(before["planId"])
                if head["id"] != before["id"]:
                    raise ConflictError("The procedure advanced; reopen its current complete draft")
                return self._operating_result(before, True, 0)
        files = {**before["files"], "document": self._retain_operating_json(saved["document"], "complete-original-operating-plan"),
            "input": self._retain_operating_json(value, "complete-original-procedure-input", MAX_REQUEST)}
        with self._operating_commit():
            old = self._operating_replay("save", request_sha, "saved")
            if old:
                return self._operating_result(old, True)
            head = self._operating_head(before["planId"])
            if not head or head["id"] != before["id"]:
                raise ConflictError("The saved procedure advanced; preserve this draft and reopen the current head")
            record = self._directory_store(PLAN_KIND, self._operating_value("save", request_sha, value,
                saved["document"], saved["summary"], files, predecessor=before["id"]))
        return self._operating_result(record, False, len(saved["document"]["revisions"]) - len(document["revisions"]))

    def receive_directory_operating_plan(self, raw):
        value = typed("operating_plan_receive", raw)
        request_sha = self._operating_request("receive", value)
        old = self._operating_replay("receive", request_sha, "saved")
        if old:
            return self._operating_result(old, True)
        incoming = self._operating_model("inspect", {"document": value["document"]})["document"]
        before = self._operating_head(incoming["id"])
        expected = value["expectedRecordId"]
        if (before["id"] if before else None) != expected:
            raise ConflictError("Receive against the actual current saved procedure record")
        if before:
            if "basis" in value:
                original_basis = self._operating_json(before["files"]["basis"], MAX_BASIS)
                candidate_basis = self._operating_basis(value["basis"])
                if candidate_basis["selection"] != original_basis["selection"] or candidate_basis["recordRefs"] != original_basis["recordRefs"]:
                    raise ConflictError("This procedure history remains bound to its original native basis; choose an explicit new copy for a new basis")
            files = copy.deepcopy(before["files"])
            existing = self._operating_json(files["document"])
        else:
            if "basis" not in value:
                raise InputError("A newly received procedure requires an explicit original Directory basis")
            basis = self._operating_basis(value["basis"])
            files = {
                "basis": self._retain_operating_json(basis, "complete-directory-operating-basis", MAX_BASIS),
                "catalog": self._retain_operating_json(self.directory_operating_catalogue(), "complete-original-command-catalog"),
            }
            existing = None
        joined = self._operating_model("receive", {"incoming": incoming, "existing": existing})
        if joined["reused"]:
            with self._operating_commit():
                head = self._operating_head(incoming["id"])
                if (head["id"] if head else None) != expected:
                    raise ConflictError("The procedure advanced during prefix receiving; reopen its complete current history")
                return self._operating_result(before, True, 0)
        files["document"] = self._retain_operating_json(joined["document"], "complete-original-operating-plan")
        files["input"] = self._retain_operating_json(value, "complete-original-procedure-input", MAX_REQUEST)
        with self._operating_commit():
            old = self._operating_replay("receive", request_sha, "saved")
            if old:
                return self._operating_result(old, True)
            head = self._operating_head(incoming["id"])
            if (head["id"] if head else None) != expected:
                raise ConflictError("The original procedure advanced during receiving; keep the complete incoming history")
            record = self._directory_store(PLAN_KIND, self._operating_value("receive", request_sha, value,
                joined["document"], joined["summary"], files, predecessor=expected))
        return self._operating_result(record, False, joined["addedRevisions"])

    def copy_directory_operating_plan(self, raw):
        value = typed("operating_plan_copy", raw)
        request_sha = self._operating_request("copy", value)
        old = self._operating_replay("copy", request_sha, "saved")
        if old:
            return self._operating_result(old, True)
        before = self._operating_record(value["recordId"], saved=True)
        copied = self._operating_model("copy", {"document": self._operating_json(before["files"]["document"]),
            "id": value["id"], "savedAt": value["savedAt"], **({"title": value["title"]} if "title" in value else {})})
        files = {**before["files"],
            "document": self._retain_operating_json(copied["document"], "complete-original-operating-plan"),
            "input": self._retain_operating_json(value, "complete-original-procedure-input", MAX_REQUEST)}
        with self._operating_commit():
            old = self._operating_replay("copy", request_sha, "saved")
            if old:
                return self._operating_result(old, True)
            if self._operating_head(value["id"]):
                raise ConflictError("The selected copy ID already has a complete saved history")
            record = self._directory_store(PLAN_KIND, self._operating_value("copy", request_sha, value,
                copied["document"], copied["summary"], files, origin=before["id"]))
        return self._operating_result(record)

    def compare_directory_operating_plan(self, raw):
        value = typed("operating_plan_compare", raw)
        record = self._operating_record(value["recordId"])
        result = self._operating_model("compare", {"document": self._operating_json(record["files"]["document"]),
            **({"revision": value["revision"]} if "revision" in value else {})})
        result["directoryBinding"] = self._verify_operating_basis(self._operating_json(record["files"]["basis"], MAX_BASIS), strict=False)
        result["recordId"] = record["id"]
        return result

    def export_directory_operating_plan(self, raw):
        value = typed("operating_plan_export", raw)
        request_sha = self._operating_request("export", value)
        with self.mutex:
            row = self.db.execute("SELECT id FROM directory_records WHERE kind='exports' AND json_extract(body,'$.requestSha256')=? LIMIT 1",
                (request_sha,)).fetchone()
        if row:
            record = self.directory_record("exports", row[0]); self._directory_file_path(record["file"]); return record
        plan = self._operating_record(value["recordId"])
        rendered = self._operating_model("export", {"document": self._operating_json(plan["files"]["document"]),
            "format": value["format"], **({"revision": value["revision"]} if "revision" in value else {})})
        raw_file = rendered["content"].encode("utf-8")
        if len(raw_file) > MAX_BRIDGE:
            raise InputError("The complete readable procedure exceeds 128 MiB")
        with self.scratch() as temp:
            path = Path(temp) / ("Operating_Plan." + rendered["extension"])
            original_workspace.private_write(path, raw_file)
            descriptor = self._directory_retain_file(path, "complete-operating-plan-" + value["format"])
        return self._directory_store("exports", {
            "kind": "operating-plan", "recordId": plan["id"], "requestSha256": request_sha,
            "label": value.get("label", rendered["summary"]["title"]), "actor": value["actor"], "note": value.get("note", ""),
            "name": plan["planId"] + "-r" + str(rendered["summary"]["revision"]) + "." + rendered["extension"],
            "contentType": rendered["contentType"], "file": descriptor,
            "result": {"planId": plan["planId"], "revision": rendered["summary"]["revision"],
                "revisions": plan["revision"], "format": value["format"], "completeHistory": value["format"] == "json"},
        })

    def _verify_operating_plans_received(self, registry):
        records = registry["records"].get(PLAN_KIND, [])
        by_id = {r["id"]: r for r in records}
        if len(by_id) != len(records):
            raise InputError("The complete procedure inventory repeats an original native record")
        verification, heads = [], {}
        for record in records:
            original = self._operating_record(record["id"])
            if original != record:
                raise InputError("The restored procedure record differs from its original body")
            for descriptor in retained_operating_files(record):
                self._directory_file_path(descriptor)
            basis = self._operating_json(record["files"]["basis"], MAX_BASIS)
            self._verify_operating_basis(basis)
            self._operating_json(record["files"]["catalog"], MAX_DOCUMENT)
            accepted = self._operating_json(record["files"]["input"], MAX_REQUEST)
            action = record.get("action")
            input_name = "operating_plan_create" if action in {"preview", "create"} else "operating_plan_" + str(action)
            if action not in {"preview", "create", "save", "receive", "copy"} or typed(input_name, accepted) != accepted:
                raise InputError("The retained procedure input is not its complete normalized original request")
            if self._operating_request(action, accepted) != record.get("requestSha256"):
                raise InputError("The retained complete procedure input differs from its original request hash")
            if accepted["actor"] != record.get("actor") or accepted.get("note", "") != record.get("note"):
                raise InputError("The retained procedure author differs from the complete original request")
            item = {"id": record["id"], "planId": record["planId"], "revision": record["revision"],
                "document": str(self._directory_file_path(record["files"]["document"])),
                "summary": record.get("summary")}
            previous = record.get("predecessorRecordId")
            prepared = record.get("preparedFromId")
            origin = record.get("originRecordId")
            if record["stage"] == "prepared" and (previous or prepared or origin):
                raise InputError("A prepared preview cannot alter a saved procedure chain")
            for field, ident in (("predecessorRecordId", previous), ("preparedFromId", prepared), ("originRecordId", origin)):
                if ident and ident not in by_id:
                    raise InputError("The complete received procedure is missing its " + field)
            if previous:
                p = by_id[previous]
                if p["stage"] != "saved" or p["planId"] != record["planId"] or p["revision"] >= record["revision"]:
                    raise InputError("The original saved procedure predecessor has conflicting identity or revision")
                item["predecessorDocument"] = str(self._directory_file_path(p["files"]["document"]))
            if prepared:
                p = by_id[prepared]
                if p["stage"] != "prepared" or p["planId"] != record["planId"]:
                    raise InputError("The accepted preview belongs to another original procedure")
                for key in ("document", "basis", "catalog"):
                    if p["files"][key] != record["files"][key]:
                        raise InputError("Accepting a preview must preserve its complete original document, basis and catalog")
                reviewed = self._operating_json(p["files"]["input"], MAX_REQUEST)
                received_input = copy.deepcopy(accepted)
                explicit_preview = received_input.pop("previewRecordId", None)
                if action != "create" or (explicit_preview is not None and explicit_preview != prepared) or received_input != reviewed:
                    raise InputError("The accepted create input must exactly retain its prepared input and optional selected preview record")
                item["preparedDocument"] = str(self._directory_file_path(p["files"]["document"]))
            if origin:
                item["originDocument"] = str(self._directory_file_path(by_id[origin]["files"]["document"]))
            if record["stage"] == "saved":
                heads.setdefault(record["planId"], set()).add(record["id"])
            verification.append(item)
        for record in records:
            if record.get("predecessorRecordId"):
                heads[record["planId"]].discard(record["predecessorRecordId"])
        if any(len(ids) != 1 for ids in heads.values()):
            raise InputError("The received procedure has divergent original saved histories")
        return self._operating_model("verify-files", {"records": verification}) if verification else {"checked": [], "count": 0}
