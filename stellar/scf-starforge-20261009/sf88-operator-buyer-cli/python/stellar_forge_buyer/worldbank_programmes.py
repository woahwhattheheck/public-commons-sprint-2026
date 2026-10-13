"""Named customer programmes around the original WorldBankRecurring operation.

Programme definitions and exact continuation JSON live in the original SQLite
workspace, so its existing portable snapshot carries their identities/history.
The separate coordinator sequences existing Analysis jobs without occupying
their single executor. Source acquisition and workbook/report writers stay with
their original owners.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import threading

from .errors import StateError
from .storage import digest
from .response_documents import document_path, validate_manifest, _delivery
from .worldbank_analysis import encoded, regular, write, MAX_DOCUMENT

SCHEMA = "stellar-forge.worldbank-programmes.v1"
_CONTINUATIONS = (
    "operation.json", "intent.json", "recurring-intent.json",
    "recurring-review.json", "recurring-selection-intent.json",
    "workbook-proposal.json", "workbook-choice.json",
)
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}")
_ID = re.compile(r"[a-f0-9]{32}")


def _need(condition, code):
    if not condition:
        raise StateError("WORLDBANK_PROGRAMME_" + code)


def _name(value):
    _need(isinstance(value, str) and _NAME.fullmatch(value), "NAME_INVALID")
    return value


def _id(value):
    _need(isinstance(value, str) and _ID.fullmatch(value), "OPERATION_ID_INVALID")
    return value


def _now():
    return datetime.now(timezone.utc).isoformat()


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _revision(value):
    _need(type(value) is int and value >= 0, "EXPECTED_REVISION_REQUIRED")
    return value


def _page(before, limit, *, text=False):
    _need(type(limit) is int and 1 <= limit <= 100, "PAGE_INVALID")
    _need(before is None or (isinstance(before, str) if text else type(before) is int and before > 0),
          "PAGE_INVALID")


class WorldBankProgrammes:
    def __init__(self, workspace, *, core=None):
        self.workspace = workspace
        self.database = workspace.database
        self.core = Path(core).expanduser().absolute() if core else (
            Path(__file__).resolve().parents[3] / "sf30-seller-sdk" / "worldbank" / "core.py")
        self._mutex = threading.RLock()
        self._closed = False
        self._active = None
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE IF NOT EXISTS sf_worldbank_programmes(name TEXT PRIMARY KEY,revision INTEGER NOT NULL,record TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_worldbank_programme_history(name TEXT NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(name,revision))")
            db.execute("CREATE TABLE IF NOT EXISTS sf_worldbank_programme_requests(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,record TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_worldbank_operations(sequence INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,record TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_worldbank_operation_files(operation_id TEXT NOT NULL,name TEXT NOT NULL,raw TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(operation_id,name))")
            for row in db.execute("SELECT id,record FROM sf_worldbank_operations").fetchall():
                value = json.loads(row["record"])
                if value["status"] == "RUNNING":
                    value.update(status="INTERRUPTED", error="Continue this original operation with resume enabled.",
                                 updated_at=_now())
                    db.execute("UPDATE sf_worldbank_operations SET record=? WHERE id=?", (_json(value), row["id"]))
            db.commit()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="worldbank-programmes")

    def close(self):
        # AnalysisWorkspace must call this before marking itself closed and
        # without holding its job mutex: an active coordinator uses start().
        with self._mutex:
            self._closed = True
        self._executor.shutdown(wait=True)

    def _definition(self, db, name):
        row = db.execute("SELECT record FROM sf_worldbank_programmes WHERE name=?", (_name(name),)).fetchone()
        _need(row is not None, "NOT_FOUND")
        return json.loads(row[0])

    def definition(self, name):
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            value = self._definition(db, name)
            history = [json.loads(row[0]) for row in db.execute(
                "SELECT record FROM sf_worldbank_programme_history WHERE name=? ORDER BY revision DESC", (name,))]
        page = self.history(name)
        return {**value, "history": history, "operations": page["operations"],
                "operation_next_before": page["next_before"]}

    def list(self, *, before=None, limit=50):
        _page(before, limit, text=True)
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT name,record FROM sf_worldbank_programmes WHERE (? IS NULL OR name>?) ORDER BY name LIMIT ?",
                              (before, before, limit + 1)).fetchall()
            recent = db.execute("SELECT record FROM sf_worldbank_operations ORDER BY sequence DESC LIMIT 50").fetchall()
        source_page = self.sources()
        return {"schema": SCHEMA, "workspace_id": self.workspace.identity,
                "programmes": [json.loads(row["record"]) for row in rows[:limit]],
                "next_before": rows[limit-1]["name"] if len(rows) > limit else None,
                "sources": source_page["sources"], "source_next_before": source_page["next_before"],
                "operations": [self._public(json.loads(row[0])) for row in recent]}

    def history(self, name, *, before=None, limit=50):
        _page(before, limit)
        with self.database._connection(readonly=True) as db:
            self._definition(db, name)
            rows = db.execute("SELECT sequence,record FROM sf_worldbank_operations WHERE name=? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                              (name, before, before, limit + 1)).fetchall()
        return {"operations": [self._public(json.loads(row["record"])) for row in rows[:limit]],
                "next_before": rows[limit-1]["sequence"] if len(rows) > limit else None}

    def _selected_source(self, source):
        _need(isinstance(source, dict), "SOURCE_REQUIRED")
        name, revision = _name(source.get("name")), source.get("revision")
        _need(type(revision) is int and revision > 0, "SOURCE_REVISION_REQUIRED")
        with self.database._connection(readonly=True) as db:
            retained = self.workspace.responses._source(db, name, revision)
        return self._document(retained, required=True)

    def _document(self, source, *, required=False):
        if source.get("input_kind") != "document":
            _need(not required, "RETAINED_WORLDBANK_DOCUMENT_REQUIRED")
            return None
        path = document_path(self.database.directory, source.get("document_id"))
        raw = regular(path, 1024 * 1024)
        _need(digest(raw) == source["document_id"], "DOCUMENT_CHANGED")
        manifest = validate_manifest(json.loads(raw))
        originals = {item["role"]: item for item in manifest["originals"]}
        if "original-worldbank-handover" not in originals:
            _need(not required, "RETAINED_WORLDBANK_DOCUMENT_REQUIRED")
            return None
        _need({"original-source.json", "original-review.json"} <= originals.keys(),
              "COMPLETE_ORIGINAL_SOURCE_REQUIRED")
        values = {}
        for role in ("original-source.json", "original-review.json"):
            with _delivery(path.parent, originals[role]).open() as stream:
                values[role] = json.loads(stream.read())
        handover = originals["original-worldbank-handover"]
        # Opening the original delivery checks its exact content-addressed bytes.
        if required:
            with _delivery(path.parent, handover).open():
                pass
        return {"name": source["name"], "revision": source["revision"], "title": manifest["title"],
                "document_id": source["document_id"],
                "handover": {"bytes": handover["bytes"], "sha256": handover["sha256"]},
                "source_metadata": values["original-source.json"],
                "review": values["original-review.json"],
                "_handover_path": str(path.parent / handover["path"])}

    def sources(self, *, before=None, limit=50):
        _page(before, limit)
        # Continue through unrelated retained documents; pagination is over the
        # source history, never a first-page assumption about World Bank rows.
        output, cursor = [], before
        while len(output) < limit:
            with self.database._connection(readonly=True) as db:
                rows = db.execute("SELECT rowid AS sequence,record FROM sf_analysis_response_sources WHERE (? IS NULL OR rowid<?) ORDER BY rowid DESC LIMIT ?",
                                  (cursor, cursor, limit)).fetchall()
            if not rows:
                return {"sources": output, "next_before": None}
            for row in rows:
                cursor = row["sequence"]
                selected = self._document(json.loads(row["record"]))
                if selected:
                    output.append({key: value for key, value in selected.items() if not key.startswith("_")})
                if len(output) == limit:
                    return {"sources": output, "next_before": cursor}
            if len(rows) < limit:
                return {"sources": output, "next_before": None}
        return {"sources": output, "next_before": cursor}

    def save(self, name, payload):
        name, request_id = _name(name), _id(payload.get("id"))
        _need(name != "sources", "RESERVED_NAME")
        expected = _revision(payload.get("expected_revision"))
        spec = payload.get("definition")
        _need(isinstance(spec, dict), "DEFINITION_REQUIRED")
        title = spec.get("title")
        _need(isinstance(title, str) and title.strip() and len(title) <= 200, "TITLE_REQUIRED")
        definition = {key: _name(spec.get(key)) for key in ("view", "report", "workbook")}
        keys = spec.get("keys")
        _need(isinstance(keys, list) and 1 <= len(keys) <= 16 and
              all(isinstance(key, str) and key and len(key) <= 200 for key in keys) and
              len(keys) == len(set(keys)), "EXPLICIT_SOURCE_KEYS_REQUIRED")
        prefix = spec.get("prefix", "worldbank")
        _need(isinstance(prefix, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,20}", prefix), "PREFIX_INVALID")
        definition.update(title=title, keys=keys, prefix=prefix)
        request_sha = digest(encoded({"name": name, "expected_revision": expected, "definition": definition}))
        with self._mutex, self.database._connection() as db:
            _need(not self._closed, "CLOSED")
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT sha256,record FROM sf_worldbank_programme_requests WHERE id=?", (request_id,)).fetchone()
            if old:
                _need(old["sha256"] == request_sha, "SAVE_ID_REUSED")
                return json.loads(old["record"])
            row = db.execute("SELECT revision FROM sf_worldbank_programmes WHERE name=?", (name,)).fetchone()
            _need((row[0] if row else 0) == expected, "DEFINITION_CHANGED")
            # Resolve actual customer identities, without saving generated SQL
            # or rewriting their report and workbook definitions.
            current = self.workspace.database.current(definition["view"])
            _need(current["version"] is not None, "EXISTING_VIEW_REQUIRED")
            self.workspace.reports.definition(definition["report"])
            self.workspace.workbooks.definition(definition["workbook"])
            value = {"name": name, "revision": expected + 1, "definition": definition,
                     "definition_sha256": digest(encoded(definition)), "saved_at": _now()}
            raw = _json(value)
            db.execute("INSERT INTO sf_worldbank_programmes VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,record=excluded.record",
                       (name, value["revision"], raw))
            db.execute("INSERT INTO sf_worldbank_programme_history VALUES(?,?,?)", (name, value["revision"], raw))
            db.execute("INSERT INTO sf_worldbank_programme_requests VALUES(?,?,?)", (request_id, request_sha, raw))
            db.commit()
        return value

    def _operation(self, name, operation_id):
        with self.database._connection(readonly=True) as db:
            row = db.execute("SELECT name,record FROM sf_worldbank_operations WHERE id=?", (_id(operation_id),)).fetchone()
        _need(row is not None and row["name"] == _name(name), "OPERATION_NOT_FOUND")
        return json.loads(row["record"])

    def _store(self, value):
        value["updated_at"] = _now()
        with self.database._connection() as db:
            db.execute("UPDATE sf_worldbank_operations SET record=? WHERE id=?", (_json(value), value["operation_id"]))

    def _public(self, value):
        return {key: item for key, item in value.items() if key not in ("core",)}

    def _files(self, operation_id):
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT name,raw,sha256 FROM sf_worldbank_operation_files WHERE operation_id=?", (operation_id,)).fetchall()
        result = {}
        for row in rows:
            _need(row["name"] in _CONTINUATIONS and digest(row["raw"].encode()) == row["sha256"],
                  "CONTINUATION_CHANGED")
            result[row["name"]] = row["raw"]
        return result

    def _accepted_binding(self, value):
        """Resolve accepted business outputs independently of ZIP assembly."""
        accepted_id = value.get("accepted_operation_id", value["operation_id"])
        files = self._files(accepted_id)
        if not {"operation.json", "recurring-review.json"} <= files.keys():
            return None
        original = json.loads(files["operation.json"])
        review = json.loads(files["recurring-review.json"])
        needed = {"recurring_selection", "recurring_workbook", "publication", "version_id", "source", "view"}
        if not needed <= original.keys() or not original.get("jobs", {}).get("WORKBOOK"):
            return None
        from .worldbank_recurring import review_digest
        _need(original["operation_id"] == accepted_id and review["operation_id"] == accepted_id and
              review["workspace_id"] == self.workspace.identity and
              review["review_sha256"] == review_digest(review), "ACCEPTED_REVIEW_CHANGED")
        selected = self.workspace.changes.page(review["comparison"]["id"], limit=1)
        _need(selected["selection"] == original["recurring_selection"] and
              selected["report"]["result_sha256"] == review["comparison"]["result_sha256"],
              "ACCEPTED_SELECTION_CHANGED")
        version_id = original["version_id"]
        _need(version_id == review["candidate_version_id"] ==
              original["recurring_selection"]["activation"]["version"]["version_id"],
              "ACCEPTED_VERSION_CHANGED")
        self.workspace.database.version(version_id)
        publication = original["publication"]
        self.workspace.workbooks.source({"kind": "report", "id": publication["id"],
                                         "section": 0, "sha256": publication["sha256"]})
        job_id = original["jobs"]["WORKBOOK"][-1]["id"]
        try:
            workbook = self.workspace.job(job_id)
        except StateError as error:
            if (getattr(error, "code", None) or str(error)) == "ANALYSIS_JOB_NOT_FOUND":
                # The original adapter saves its attempt before start() commits
                # the native job. Preserve that resumable preparation boundary.
                return None
            raise
        if workbook["status"] != "COMPLETE":
            return None
        _need(workbook["kind"] == "workbook" and
              all(workbook["request"][key] == original["recurring_workbook"][key]
                  for key in ("name", "revision", "definition_sha256")), "ACCEPTED_WORKBOOK_CHANGED")
        binding = {"operation_id": accepted_id, "workspace_id": self.workspace.identity,
                   "review_sha256": review["review_sha256"], "version_id": version_id,
                   "source": original["source"], "view": original["view"], "publication": publication,
                   "selection_sha256": selected["selection_sha256"],
                   "workbook": {"job_id": job_id, "manifest_sha256": workbook["result"]["manifest_sha256"],
                                "definition": original["recurring_workbook"]}}
        return {**binding, "binding_sha256": digest(encoded(binding))}

    def status(self, name, operation_id):
        value = self._public(self._operation(name, operation_id))
        files = self._files(operation_id)
        if "recurring-review.json" in files:
            value["review"] = json.loads(files["recurring-review.json"])
        if "workbook-proposal.json" in files:
            value["proposal"] = json.loads(files["workbook-proposal.json"])
        value["accepted_edition"] = self._accepted_binding(value)
        value["can_reopen"] = value["accepted_edition"] is not None and value["status"] in ("ERROR", "INTERRUPTED", "COMPLETE")
        if value["status"] == "COMPLETE":
            root = self.database.directory / "worldbank-analysis" / operation_id / "delivery"
            value["downloads"] = [{**item, "available": (root / item["filename"]).is_file()}
                                  for item in value["result"]["files"]]
        return value

    def review(self, name, operation_id):
        value = self.status(name, operation_id)
        _need("review" in value, "REVIEW_NOT_READY")
        return value["review"]

    def prepare(self, name, payload):
        name, operation_id = _name(name), _id(payload.get("id"))
        expected = _revision(payload.get("expected_revision"))
        source = payload.get("source")
        _need(isinstance(source, dict), "SOURCE_REQUIRED")
        request = {"id": operation_id, "expected_revision": expected,
                   "source": {"name": _name(source.get("name")), "revision": source.get("revision")}}
        resume = payload.get("resume", False)
        _need(type(resume) is bool, "RESUME_INVALID")
        with self._mutex:
            _need(not self._closed, "CLOSED")
            with self.database._connection(readonly=True) as db:
                old = db.execute("SELECT name,record FROM sf_worldbank_operations WHERE id=?", (operation_id,)).fetchone()
                definition = self._definition(db, name)
            if old:
                _need(old["name"] == name, "OPERATION_ID_REUSED")
                value = json.loads(old["record"])
                _need(value["prepare_request"] == request, "OPERATION_ID_REUSED")
                if value["status"] in ("RUNNING", "REVIEW_READY", "WORKBOOK_COLUMN_CHOICES_REQUIRED", "COMPLETE"):
                    return self.status(name, operation_id)
                _need(value["action"] == "prepare" and resume, "ORIGINAL_CONTINUATION_REQUIRED")
            else:
                _need(definition["revision"] == expected, "DEFINITION_CHANGED")
                _need(self._active is None, "BUSY")
                selected = self._selected_source(request["source"])
                # Core comes from the installed original package/explicit launch
                # configuration. A browser-selected source never supplies code.
                core = self.core.resolve(strict=True)
                _need(core.name == "core.py", "ORIGINAL_CORE_REQUIRED")
                core_identity = {"core_sha256": digest(regular(core)),
                                 "source_sha256": digest(regular(core.parent / "source.py"))}
                value = {"schema": SCHEMA, "name": name, "operation_id": operation_id,
                         "workspace_id": self.workspace.identity, "programme": definition,
                         "prepare_request": request, "publish_request": None,
                         "source": {k: v for k, v in selected.items() if not k.startswith("_")},
                         "core": core_identity, "status": "RUNNING", "phase": "SOURCE_REVIEW",
                         "action": "prepare", "created_at": _now(), "updated_at": _now(), "error": None}
                with self.database._connection() as db:
                    db.execute("INSERT INTO sf_worldbank_operations(id,name,record) VALUES(?,?,?)",
                               (operation_id, name, _json(value)))
            self._launch(value, "prepare", resume)
        return self.status(name, operation_id)

    def publish(self, name, payload):
        operation_id = _id(payload.get("id"))
        note = payload.get("note")
        _need(isinstance(note, str) and note.strip() and len(note.encode()) <= 8000, "REVIEW_NOTE_REQUIRED")
        selected = payload.get("review_sha256")
        _need(isinstance(selected, str) and re.fullmatch(r"[a-f0-9]{64}", selected), "REVIEW_DIGEST_REQUIRED")
        columns = payload.get("columns")
        _need(columns is None or isinstance(columns, dict), "COLUMNS_INVALID")
        resume = payload.get("resume", False)
        _need(type(resume) is bool, "RESUME_INVALID")
        request = {"id": operation_id, "review_sha256": selected, "note": note, "columns": columns}
        with self._mutex:
            _need(not self._closed, "CLOSED")
            value = self._operation(name, operation_id)
            review = self.review(name, operation_id)
            _need(review["review_sha256"] == selected, "REVIEW_CHANGED")
            previous = value.get("publish_request")
            if previous:
                _need(all(previous[key] == request[key] for key in ("id", "review_sha256", "note")),
                      "SELECTION_INTENT_CHANGED")
            if value["status"] in ("RUNNING", "COMPLETE"):
                _need(previous == request, "PUBLISH_ID_REUSED")
                return self.status(name, operation_id)
            _need(value["status"] in ("REVIEW_READY", "WORKBOOK_COLUMN_CHOICES_REQUIRED", "ERROR", "INTERRUPTED"),
                  "REVIEW_NOT_READY")
            if value["status"] in ("ERROR", "INTERRUPTED"):
                _need(value["action"] == "publish" and resume, "ORIGINAL_CONTINUATION_REQUIRED")
            value["publish_request"] = request
            self._launch(value, "publish", resume)
        return self.status(name, operation_id)

    def reopen(self, name, payload):
        """Create a fresh portable delivery of an accepted immutable edition.

        Its new snapshot includes later customer edits. The original report
        publication/workbook build are reused, and the parent delivery remains
        a distinct immutable operation. This avoids nested old workspace ZIPs.
        """
        name, operation_id = _name(name), _id(payload.get("id"))
        parent_id = _id(payload.get("operation_id"))
        _need(operation_id != parent_id, "NEW_DELIVERY_ID_REQUIRED")
        resume = payload.get("resume", False)
        _need(type(resume) is bool, "RESUME_INVALID")
        request = {"id": operation_id, "operation_id": parent_id}
        with self._mutex:
            _need(not self._closed, "CLOSED")
            with self.database._connection(readonly=True) as db:
                old = db.execute("SELECT name,record FROM sf_worldbank_operations WHERE id=?", (operation_id,)).fetchone()
            if old:
                value = json.loads(old["record"])
                _need(old["name"] == name and value.get("reopen_request") == request, "OPERATION_ID_REUSED")
                if value["status"] in ("RUNNING", "COMPLETE"):
                    return self.status(name, operation_id)
                _need(resume and value["action"] == "reopen", "ORIGINAL_CONTINUATION_REQUIRED")
            else:
                _need(self._active is None, "BUSY")
                parent = self._operation(name, parent_id)
                _need(parent["status"] in ("ERROR", "INTERRUPTED", "COMPLETE"), "ACCEPTED_EDITION_REQUIRED")
                # Reopening another delivered copy resolves the actual original
                # accepted source/review, without rewriting either parent.
                accepted_id = parent.get("accepted_operation_id", parent_id)
                accepted = self._operation(name, accepted_id)
                binding = self._accepted_binding(accepted)
                _need(binding is not None and accepted["status"] in ("ERROR", "INTERRUPTED", "COMPLETE"),
                      "ACCEPTED_EDITION_REQUIRED")
                value = {"schema": SCHEMA, "name": name, "operation_id": operation_id,
                         "workspace_id": self.workspace.identity, "programme": accepted["programme"],
                         "prepare_request": None, "publish_request": None, "reopen_request": request,
                         "parent_operation_id": parent_id, "accepted_operation_id": accepted_id,
                         "accepted_binding_sha256": binding["binding_sha256"],
                         "source": accepted["source"], "core": accepted["core"],
                         "status": "RUNNING", "phase": "PORTABLE_DELIVERY", "action": "reopen",
                         "created_at": _now(), "updated_at": _now(), "error": None}
                with self.database._connection() as db:
                    db.execute("INSERT INTO sf_worldbank_operations(id,name,record) VALUES(?,?,?)",
                               (operation_id, name, _json(value)))
            self._launch(value, "reopen", resume)
        return self.status(name, operation_id)

    def _reopen_delivery(self, current, value, *, resume):
        from .worldbank_analysis import describe
        accepted = self._operation(value["name"], value["accepted_operation_id"])
        binding = self._accepted_binding(accepted)
        _need(binding is not None and binding["binding_sha256"] == value["accepted_binding_sha256"],
              "ACCEPTED_EDITION_CHANGED")
        files = self._files(value["accepted_operation_id"])
        original = json.loads(files["operation.json"])
        review = json.loads(files["recurring-review.json"])
        _need(original["operation_id"] == accepted["operation_id"], "ORIGINAL_OPERATION_CHANGED")
        # The original recurring delivery writer renders its guide from these
        # exact accepted inputs. A new linked delivery has its own operation
        # record but must carry the unchanged guide context from its parent.
        # Retain both before starting any export so a restored receiver does
        # not finish its archive and then fail on a producer-only file path.
        for filename in ("recurring-review.json", "workbook-proposal.json"):
            _need(filename in files, "ACCEPTED_GUIDE_INPUT_MISSING")
            write(current.directory / filename, files[filename].encode("utf-8"), exact=True)
        for key in ("source", "view", "publication", "version_id"):
            current.record[key] = original[key]
        current.record["parent_operation_id"] = value["parent_operation_id"]
        current.record["accepted_operation_id"] = value["accepted_operation_id"]
        current.record["accepted_binding_sha256"] = value["accepted_binding_sha256"]
        current.save()
        workbook = self.workspace.job(binding["workbook"]["job_id"])
        _need(workbook["status"] == "COMPLETE" and
              workbook["result"]["manifest_sha256"] == binding["workbook"]["manifest_sha256"],
              "ACCEPTED_WORKBOOK_CHANGED")
        extra = []
        destination = current.directory / "delivery"
        for format in ("json", "csv"):
            export = current.job(self.workspace, "CHANGES_" + format.upper(), "change-export", {
                "comparison_id": review["comparison"]["id"],
                "result_sha256": review["comparison"]["result_sha256"],
                "selection_sha256": binding["selection_sha256"], "format": format}, resume=resume)
            path, descriptor = self.workspace.change_export_file(export["id"])
            body = regular(path, 1024 * 1024 * 1024)
            _need(len(body) == descriptor["bytes"] and digest(body) == descriptor["sha256"],
                  "ACCEPTED_COMPARISON_CHANGED")
            target = destination / ("WorldBank_Source_Changes." + format)
            write(target, body, exact=True)
            extra.append(describe(target))
        # This receipt binds the original accepted comparison/report/workbook
        # and the separately requested new snapshot, without copying an old ZIP.
        receipt = {
            "schema": SCHEMA, "operation_id": value["operation_id"],
            "parent_operation_id": value["parent_operation_id"],
            "accepted_operation_id": value["accepted_operation_id"],
            "accepted_binding_sha256": value["accepted_binding_sha256"],
            "review_sha256": review["review_sha256"],
            "selection": original["recurring_selection"],
            "customer_report": {"name": review["target"]["report"],
                                "revision": review["report"]["definition"]["revision"],
                                "sha256": review["report"]["sha256"]},
            "customer_workbook": original["recurring_workbook"],
            "snapshot": "Current customer workspace; accepted report and workbook editions remain unchanged.",
        }
        target = destination / "WorldBank_Recurring_Selection.json"
        write(target, encoded(receipt), exact=True)
        extra.append(describe(target))
        publication = original["publication"]
        return current._deliver(
            self.workspace, review["source_metadata"], review["original_review"],
            review["source"]["observations"],
            self.workspace.database.version(binding["version_id"]),
            publication, publication["sha256"], workbook, resume=resume, extra_files=extra)

    def _launch(self, value, action, resume):
        _need(self._active is None, "BUSY")
        self._active = value["operation_id"]
        value.update(status="RUNNING", action=action, error=None)
        try:
            self._store(value)
            self._executor.submit(self._run, value["name"], value["operation_id"], action, resume)
        except BaseException:
            self._active = None
            value.update(status="INTERRUPTED", error="Continue the retained operation.")
            self._store(value)
            raise

    def _capture(self, operation_id, directory):
        contents = []
        for name in _CONTINUATIONS:
            path = directory / name
            if path.exists():
                raw = regular(path, MAX_DOCUMENT).decode("utf-8")
                json.loads(raw)
                contents.append((operation_id, name, raw, digest(raw.encode())))
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.executemany("INSERT INTO sf_worldbank_operation_files VALUES(?,?,?,?) ON CONFLICT(operation_id,name) DO UPDATE SET raw=excluded.raw,sha256=excluded.sha256", contents)
            db.commit()

    def _run(self, name, operation_id, action, resume):
        # Import lazily: the original engine itself imports AnalysisWorkspace.
        current = None
        try:
            from .worldbank_recurring import WorldBankRecurring
            value = self._operation(name, operation_id)
            _need(value["workspace_id"] == self.workspace.identity, "WORKSPACE_CHANGED")
            core = None
            if action != "reopen":
                core = self.core.resolve(strict=True)
                _need(value["core"] == {"core_sha256": digest(regular(core)),
                                       "source_sha256": digest(regular(core.parent / "source.py"))},
                      "ORIGINAL_CORE_CHANGED")
            root = self.database.directory / "worldbank-analysis" / operation_id
            for filename, raw in self._files(operation_id).items():
                # Original immutable intents/review retain exact bytes, even
                # after a workspace restore; never rehash a rewritten review.
                path = root / filename
                if path.exists():
                    local = regular(path, MAX_DOCUMENT).decode("utf-8")
                    json.loads(local)
                    if filename not in ("operation.json", "workbook-proposal.json"):
                        _need(local == raw, "LOCAL_CONTINUATION_CHANGED")
                    # Mutable original engine records can have advanced before
                    # a process stopped between the file write and DB mirror.
                    # Keep their actual progress and checkpoint it below.
                else:
                    write(path, raw.encode(), exact=True)

            def progress(event):
                state = self._operation(name, operation_id)
                state["phase"] = event.get("phase", state["phase"])
                state["progress"] = event
                self._store(state)
                if current is not None:
                    self._capture(operation_id, current.directory)

            current = WorldBankRecurring(self.database.directory, operation_id=operation_id,
                                         progress=progress, active_workspace=self.workspace)
            original_save = current.save

            def save():
                original_save()
                self._capture(operation_id, current.directory)

            current.save = save
            if action == "prepare":
                selected = self._selected_source(value["prepare_request"]["source"])
                _need(selected["handover"] == value["source"]["handover"] and
                      selected["document_id"] == value["source"]["document_id"], "SOURCE_CHANGED")
                definition = value["programme"]["definition"]
                result = current.review(selected["_handover_path"], core,
                                        view=definition["view"], report=definition["report"],
                                        workbook=definition["workbook"], keys=definition["keys"],
                                        prefix=definition["prefix"], resume=resume)
                status = "REVIEW_READY"
            elif action == "reopen":
                result = self._reopen_delivery(current, value, resume=resume)
                status = "COMPLETE"
            else:
                request = value["publish_request"]
                result = current.refresh(request["review_sha256"], note=request["note"],
                                         columns=request["columns"], resume=resume)
                status = result.get("status", "COMPLETE")
            self._capture(operation_id, current.directory)
            state = self._operation(name, operation_id)
            state.update(status=status, result=result, error=None)
            self._store(state)
        except Exception as error:
            state = self._operation(name, operation_id)
            state.update(status="ERROR", error=str(error))
            self._store(state)
        finally:
            try:
                if current is not None:
                    try:
                        self._capture(operation_id, current.directory)
                    except Exception as error:
                        state = self._operation(name, operation_id)
                        state.update(status="ERROR", error="Continuation checkpoint: " + str(error))
                        self._store(state)
            finally:
                with self._mutex:
                    if self._active == operation_id:
                        self._active = None

    def download(self, name, operation_id, filename):
        value = self._operation(name, operation_id)
        _need(value["status"] == "COMPLETE", "DELIVERY_NOT_COMPLETE")
        record = next((item for item in value["result"]["files"] if item["filename"] == filename), None)
        _need(record is not None and Path(filename).name == filename, "FILE_NOT_FOUND")
        path = self.database.directory / "worldbank-analysis" / operation_id / "delivery" / filename
        # The existing HTTP _file_reply verifies and streams one open
        # descriptor; avoid a second whole-archive read in this adapter.
        return path, {**record, "name": filename,
                      "mime": "application/zip" if filename.endswith(".zip") else
                                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if filename.endswith(".xlsx") else
                                      "application/json" if filename.endswith(".json") else
                                      "text/html; charset=utf-8" if filename.endswith(".html") else
                                      "text/plain; charset=utf-8"}
