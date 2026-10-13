"""Native implementation adapter for the existing local operator.

HTTP authentication, task queuing, workspace identities and download tickets
remain owned by operator/server.py. This module has no HTTP framework dependency.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import uuid

from model.implementation import (
    ImplementationError, ImplementationStore, RevisionConflict, ValidationError,
    MAX_JSON_BYTES, canonical_bytes, document_digest, load_json, make_plan,
    read_document, schedule_plan, summarize_plan, validate_plan,
)
from model.implementation import _atomic_bytes, _same_json
from model.implementation_schema import _safe_id, _integer, _date

ACTIONS = frozenset({
    "implementation.plan.create", "implementation.plan.import",
    "implementation.plan.save", "implementation.plan.report",
    "implementation.records.append", "implementation.source.attach",
    "implementation.source.import", "implementation.selection.import",
    "implementation.observations.import", "implementation.lab.import", "implementation.briefing.import",
    "implementation.lab.dispatch", "implementation.lab.dispatch-report",
})
READS = frozenset({"list", "detail", "history", "schedule", "summary", "catalog", "selections", "observations-preview", "lab-inspect", "lab-preview", "dispatch-preview", "dispatches", "dispatch-detail", "dispatch-reconcile", "dispatch-report-preview", "briefing-catalog", "briefing-preview"})
WRITE_ROUTES = {
    "create": "implementation.plan.create",
    "import": "implementation.plan.import",
    "save": "implementation.plan.save",
    "report": "implementation.plan.report",
    "append": "implementation.records.append",
    "attach": "implementation.source.attach",
    "source-import": "implementation.source.import",
    "selection-import": "implementation.selection.import",
    "observations-import": "implementation.observations.import",
    "lab-import": "implementation.lab.import",
    "briefing-import": "implementation.briefing.import",
    "dispatch": "implementation.lab.dispatch",
    "dispatch-report": "implementation.lab.dispatch-report",
}


def implementation_error(error):
    """Return the operator's (structured error, HTTP status), or None."""
    if isinstance(error, RevisionConflict):
        value = dict(
            code="IMPLEMENTATION_REVISION_CONFLICT", message=str(error),
            plan_id=error.plan_id, expected_revision=error.expected_revision,
            current_revision=error.current_revision, conflict_ref=error.conflict_ref,
        )
        if getattr(error, "conflict_download", None):
            value["conflict_download"] = error.conflict_download
        return value, 409
    if isinstance(error, ValidationError):
        return dict(code="IMPLEMENTATION_INVALID", message=str(error),
                    issues=error.issues), 422
    if isinstance(error, ImplementationError):
        return dict(code="IMPLEMENTATION_INPUT", message=str(error)), 422
    return None


def _digest_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ImplementationOperator:
    def __init__(self, operator, fault_type):
        self.operator = operator
        self.Fault = fault_type
        self.stores = {}

    def store(self, workspace):
        ws = self.operator.ws(workspace)
        with self.operator.lock:
            if workspace not in self.stores:
                self.stores[workspace] = ImplementationStore(ws)
            return self.stores[workspace]

    def _integer(self, value, name, *, optional=False):
        if optional and value is None:
            return None
        if isinstance(value, str) and re.fullmatch(r"\d+", value):
            value = int(value)
        if not _integer(value, 1):
            raise self.Fault("IMPLEMENTATION_REVISION",
                             name + " must be a positive whole revision.")
        return value

    def _id(self, value):
        try:
            return _safe_id(value, "plan_id")
        except ImplementationError as error:
            raise self.Fault("IMPLEMENTATION_PLAN_ID", str(error)) from error

    def _ticket(self, workspace, path, label=None, expected=None):
        path = Path(path)
        if path.is_symlink() or not path.is_file():
            raise self.Fault("IMPLEMENTATION_FILE_MISSING",
                             "The retained implementation file is unavailable.", 404)
        observed = dict(bytes=path.stat().st_size, sha256=_digest_file(path))
        if expected:
            size = expected.get("bytes", expected.get("size_bytes"))
            if size != observed["bytes"] or expected.get("sha256") != observed["sha256"]:
                raise self.Fault("IMPLEMENTATION_FILE_CHANGED",
                                 "The retained implementation file differs from its recorded bytes.", 409)
        return self.operator._ticket(workspace, path, observed, label)

    def _snapshot_download(self, workspace, plan):
        store = self.store(workspace)
        content = canonical_bytes(plan) + b"\n"
        digest = hashlib.sha256(content).hexdigest()
        directory = store.base / plan["id"] / "exports"
        if directory.is_symlink():
            raise self.Fault("IMPLEMENTATION_EXPORT_PATH",
                             "The plan export directory must be an ordinary directory.")
        target = directory / f"{plan['revision']:016d}-{digest}.json"
        try:
            _atomic_bytes(target, content)
        except FileExistsError:
            if target.is_symlink() or target.read_bytes() != content:
                raise self.Fault("IMPLEMENTATION_EXPORT_CHANGED",
                                 "The retained plan export changed.", 409)
        return self._ticket(workspace, target, "Portable implementation plan JSON")

    def overview(self, workspace):
        """Registry state contribution: original plan summaries under one data key."""
        return self.store(workspace).list_plans()

    def read_item(self, workspace, payload):
        return self.item(workspace, payload.get("id"))

    def queue(self, workspace, operation, value):
        """Queue POST aliases through the original operation/task protocol."""
        if operation not in WRITE_ROUTES or not isinstance(value, dict):
            raise self.Fault("IMPLEMENTATION_ACTION", "Choose a supported implementation action.")
        operation_id = value.get("operation_id")
        payload = value.get("payload")
        if payload is None:
            payload = {key: item for key, item in value.items()
                       if key not in ("workspace", "operation_id")}
        if not isinstance(payload, dict):
            raise self.Fault("IMPLEMENTATION_INPUT", "Supply a JSON action payload.")
        return self.operator.submit(workspace, WRITE_ROUTES[operation], payload, operation_id)

    def verify_workspace(self, workspace):
        """Verify retained revision chains during the host's original restore flow."""
        root = Path(workspace.root)
        if not (root / "implementation" / "plans").exists():
            return dict(plans=0, revisions=0)
        from model.portable_implementation import verify_implementation
        summary = verify_implementation(workspace.root)
        return dict(plans=summary["plan_count"], revisions=summary["revision_count"],
                    implementation=summary)

    def list(self, workspace):
        return dict(workspace_key=workspace, plans=self.store(workspace).list_plans())

    def selections(self, workspace):
        """List original saved selections for the authenticated source chooser."""
        from model import conservation

        ws = self.operator.ws(workspace)

        def choices(rows):
            return sorted(
                (dict(id=row["id"], title=row.get("title") or row["id"])
                 for row in rows),
                key=lambda row: (row["title"].casefold(), row["id"]),
            )

        return dict(
            community_plans=choices(ws.overview()["community_plans"]),
            conservation_portfolios=choices(
                row for row in conservation.overview(ws)["plans"]
                if row.get("state") == "complete"
            ),
        )

    def detail(self, workspace, plan_id, *, revision=None, as_of=None):
        store = self.store(workspace)
        plan_id = self._id(plan_id)
        revision = self._integer(revision, "revision", optional=True)
        plan = store.get(plan_id, revision)
        downloads = [self._snapshot_download(workspace, plan)]
        for source in plan["source_links"]:
            if source.get("kind") != "local_file" or not source.get("reference"):
                continue
            path = (store.root / source["reference"]).resolve()
            bank = (store.base / plan_id / "attachments").resolve()
            if not path.is_relative_to(bank):
                continue
            if path.is_file():
                downloads.append(self._ticket(
                    workspace, path, source["label"],
                    dict(bytes=source.get("size_bytes"), sha256=source.get("sha256")),
                ))
        reports = []
        for edition in store.list_reports(plan_id):
            report = self._report_result(
                workspace, edition["directory"], expected_plan=plan_id,
                expected_revision=edition["revision"],
            )
            reports.append({
                "id": edition["id"], "revision": edition["revision"], "as_of": edition["as_of"],
                "files": edition["files"], "_downloads": report["_downloads"],
            })
        return dict(
            workspace_key=workspace, plan=plan, document_digest=document_digest(plan),
            summary=summarize_plan(plan, as_of),
            history=store.history(plan_id), _downloads=downloads, reports=reports,
        )

    def item(self, workspace, plan_id):
        detail = self.detail(workspace, plan_id)
        return dict(detail["plan"], _downloads=detail["_downloads"],
                    _implementation_summary=detail["summary"])

    def read(self, workspace, operation, payload=None):
        payload = payload or {}
        if not isinstance(payload, dict):
            raise self.Fault("IMPLEMENTATION_INPUT", "Supply implementation read parameters.")
        if operation == "briefing-catalog":
            from model.briefing_implementation import delivery_catalog
            return delivery_catalog(self.operator.ws(workspace))
        if operation == "briefing-preview":
            return self._briefing(workspace, payload, preview=True)
        if operation == "list":
            return self.list(workspace)
        if operation == "selections":
            return self.selections(workspace)
        if operation == "dispatch-report-preview":
            return self._dispatch_report(workspace, payload, preview=True)
        if operation in ("dispatch-preview", "dispatches", "dispatch-detail", "dispatch-reconcile"):
            return self._dispatch(workspace, payload, operation=operation)
        if operation in ("lab-inspect", "lab-preview"):
            return self._lab(workspace, payload, operation=operation)
        if operation == "observations-preview":
            return self._observations(workspace, payload, preview=True)
        if operation == "catalog":
            self.operator.ws(workspace)
            path = Path(__file__).resolve().parent / "web" / "implementation_catalog.json"
            with path.open("rb") as handle:
                return load_json(handle.read(MAX_JSON_BYTES + 1))
        if operation not in READS:
            raise self.Fault("IMPLEMENTATION_READ", "Choose a supported implementation read.", 404)
        plan_id = self._id(payload.get("id", payload.get("plan_id")))
        revision = self._integer(payload.get("revision"), "revision", optional=True)
        as_of = payload.get("as_of")
        if operation == "detail":
            return self.detail(workspace, plan_id, revision=revision, as_of=as_of)
        store = self.store(workspace)
        if operation == "history":
            return dict(workspace_key=workspace, plan_id=plan_id, history=store.history(plan_id))
        document = store.get(plan_id, revision)
        if operation == "schedule":
            return dict(workspace_key=workspace, plan_id=plan_id,
                        revision=document["revision"], schedule=schedule_plan(document, as_of))
        return dict(workspace_key=workspace, plan_id=plan_id,
                    revision=document["revision"], summary=summarize_plan(document, as_of))

    def _uploaded_json(self, upload_id):
        uploaded = self.operator.upload(upload_id)
        with Path(uploaded["path"]).open("rb") as handle:
            return load_json(handle.read(MAX_JSON_BYTES + 1))

    def _document(self, value):
        supplied = [name for name in ("document", "upload_id") if value.get(name) is not None]
        if len(supplied) != 1:
            raise self.Fault("IMPLEMENTATION_DOCUMENT",
                             "Supply either a document object or one retained upload_id.")
        document = (self._uploaded_json(value["upload_id"]) if "upload_id" in supplied
                    else value["document"])
        return validate_plan(document)

    def _actor(self, task):
        label = task["payload"].get("actor", "")
        if not isinstance(label, str) or len(label) > 800:
            raise self.Fault("IMPLEMENTATION_ACTOR", "actor must be text of at most 800 characters.")
        return ((label + " | ") if label else "") + "operator-task:" + task["id"]

    def _plan_result(self, workspace, plan, *, status="saved", **extra):
        return dict(
            id=plan["id"], plan_id=plan["id"], revision=plan["revision"],
            workspace_key=workspace, status=status, plan=plan,
            summary=summarize_plan(plan), **extra,
        )

    def _replay(self, store, plan_id, actor):
        """An operation committed before its task receipt can resume by its event."""
        directory = store.base / self._id(plan_id)
        if not directory.exists():
            return None
        for event in reversed(store.history(plan_id)):
            if event.get("actor") == actor:
                return store.get(plan_id, event["revision"])
        return None

    def _create_document(self, value, task):
        if value.get("document") is not None or value.get("upload_id") is not None:
            return self._document(value)
        plan_id = value.get("id") or value.get("plan_id") or ("impl_" + task["id"][:24])
        title = value.get("title")
        start = value.get("start_date")
        if not isinstance(title, str) or not title.strip() or not isinstance(start, str):
            raise self.Fault("IMPLEMENTATION_CREATE", "Supply the plan title and project start date.")
        document = make_plan(
            self._id(plan_id), title, start, description=value.get("description", ""),
            target_date=value.get("target_date"), working_days=value.get("working_days"),
            holidays=value.get("holidays"),
        )
        # Stable across a retry of the same retained operator task.
        document["created_at"] = task["created_at"]
        document["updated_at"] = task["created_at"]
        return validate_plan(document)

    def _report_path(self, workspace, task_id):
        self.operator.ws(workspace)
        if not isinstance(task_id, str) or not re.fullmatch(r"[0-9a-f]{64}", task_id):
            raise self.Fault("IMPLEMENTATION_TASK", "Use the retained operator task identity.")
        return self.operator.root / "outputs" / "implementation" / workspace / task_id

    def _report_selection(self, store, task, plan_id):
        """Persist the selected revision before publishing any report member."""
        value = task["payload"]
        requested = self._integer(value.get("revision", value.get("expected_revision")),
                                  "revision", optional=True)
        as_of = value.get("as_of") or task["created_at"][:10]
        try:
            _date(as_of)
        except (ValueError, TypeError) as error:
            raise self.Fault("IMPLEMENTATION_AS_OF", "Use YYYY-MM-DD for as_of.") from error
        directory = self._report_path(task["workspace"], task["id"])
        directory.parent.mkdir(parents=True, exist_ok=True)
        if directory.parent.resolve() != directory.parent or directory.is_symlink():
            raise self.Fault("IMPLEMENTATION_REPORT_PATH", "The report path must be an ordinary directory.")
        selection_path = directory.with_name(directory.name + ".selection.json")
        if selection_path.is_symlink():
            raise self.Fault("IMPLEMENTATION_REPORT_PATH", "The retained report selection path changed.", 409)
        if selection_path.exists():
            with selection_path.open("rb") as handle:
                selected = load_json(handle.read(MAX_JSON_BYTES + 1))
        else:
            revision = requested if requested is not None else store.get(plan_id)["revision"]
            selected = dict(
                schema="upstate.implementation-report-selection/v1",
                task_id=task["id"], workspace_key=task["workspace"],
                plan_id=plan_id, revision=revision, as_of=as_of,
            )
            try:
                _atomic_bytes(selection_path, canonical_bytes(selected) + b"\n")
            except FileExistsError:
                with selection_path.open("rb") as handle:
                    selected = load_json(handle.read(MAX_JSON_BYTES + 1))
        if (selected.get("schema") != "upstate.implementation-report-selection/v1"
                or selected.get("task_id") != task["id"]
                or selected.get("workspace_key") != task["workspace"]
                or selected.get("plan_id") != plan_id or selected.get("as_of") != as_of
                or (requested is not None and selected.get("revision") != requested)):
            raise self.Fault("IMPLEMENTATION_REPORT_SELECTION",
                             "The retained report request differs from this task.", 409)
        self._integer(selected.get("revision"), "retained report revision")
        # Load the exact historical document now; a later edit cannot change this selection.
        store.get(plan_id, selected["revision"])
        return directory, selected

    def _report(self, store, task, plan_id):
        directory, selected = self._report_selection(store, task, plan_id)
        recovered = None
        if directory.exists() and not (directory / "manifest.json").exists():
            if not directory.is_dir():
                raise self.Fault("IMPLEMENTATION_REPORT_PATH", "The retained report path is not a directory.", 409)
            recovered = directory.with_name(directory.name + ".incomplete-" + uuid.uuid4().hex)
            os.rename(directory, recovered)
        if not directory.exists():
            store.report(plan_id, directory, as_of=selected["as_of"], revision=selected["revision"])
        result = self._report_result(
            task["workspace"], directory, expected_plan=plan_id,
            expected_revision=selected["revision"],
        )
        if result["as_of"] != selected["as_of"]:
            raise self.Fault("IMPLEMENTATION_REPORT_SELECTION",
                             "The retained report uses another as_of date.", 409)
        if recovered is not None:
            result["recovered_partial_ref"] = str(recovered)
        return result

    def _report_result(self, workspace, directory, *, expected_plan=None, expected_revision=None):
        # A report remains reopenable after the host/task store is replaced.
        # Keep its exact original members beside the saved native plan revisions.
        retained = self.store(workspace).retain_report(directory)
        directory = Path(retained["directory"])
        manifest_path = directory / "manifest.json"
        if not manifest_path.is_file():
            raise self.Fault("IMPLEMENTATION_REPORT_INCOMPLETE",
                             "The retained report has not published its final manifest.", 409)
        with manifest_path.open("rb") as handle:
            manifest = load_json(handle.read(MAX_JSON_BYTES + 1))
        if manifest.get("schema") != "upstate.implementation-report/v1":
            raise self.Fault("IMPLEMENTATION_REPORT_MANIFEST", "The report manifest is not recognized.")
        if expected_plan is not None and manifest.get("plan_id") != expected_plan:
            raise self.Fault("IMPLEMENTATION_REPORT_SELECTION", "The report names another plan.", 409)
        if expected_revision is not None and manifest.get("revision") != expected_revision:
            raise self.Fault("IMPLEMENTATION_REPORT_SELECTION", "The report names another revision.", 409)
        downloads = []
        for entry in manifest.get("files", []):
            name = entry.get("name")
            if not isinstance(name, str) or Path(name).name != name or "/" in name or "\\" in name:
                raise self.Fault("IMPLEMENTATION_REPORT_MEMBER", "The report member name is invalid.")
            downloads.append(self._ticket(workspace, directory / name, name, entry))
        downloads.append(self._ticket(workspace, manifest_path, "Report manifest"))
        return dict(
            id=manifest["plan_id"], plan_id=manifest["plan_id"], revision=manifest["revision"],
            workspace_key=workspace, as_of=manifest["as_of"], status="reported",
            directory=str(directory), manifest_ref=str(manifest_path),
            report_id=retained["id"], _downloads=downloads,
        )

    def _attach(self, store, task, plan_id, expected, actor):
        value = task["payload"]
        uploaded = self.operator.upload(value.get("upload_id"))
        filename = uploaded.get("filename") or Path(uploaded["path"]).name
        if (not isinstance(filename, str) or Path(filename).name != filename or
                "/" in filename or "\\" in filename):
            raise self.Fault("IMPLEMENTATION_FILENAME", "The retained upload filename is invalid.")
        staging = self.operator.root / "staging" / ("implementation-" + task["id"])
        staging.mkdir(exist_ok=True)
        named_source = staging / filename
        if named_source.is_symlink():
            raise self.Fault("IMPLEMENTATION_SOURCE_PATH", "The source staging path changed.", 409)
        try:
            os.link(uploaded["path"], named_source)
        except FileExistsError:
            if (not named_source.is_file() or named_source.stat().st_size != uploaded["bytes"]
                    or _digest_file(named_source) != uploaded["sha256"]):
                raise self.Fault("IMPLEMENTATION_UPLOAD_CHANGED",
                                 "The retained named source differs from the original upload.", 409)
        result = store.attach_file(
            plan_id, named_source, expected, actor=actor,
            label=value.get("label") or filename,
        )
        return self._plan_result(
            task["workspace"], result["plan"], status="attached",
            source_link=result["source_link"], file_ref=result["file_ref"],
        )


    def _dispatch_report_downloads(self, workspace, result):
        """Refresh verified files of one immutable report-source operation."""
        from model import observed_context
        if (not isinstance(result, dict)
                or result.get("schema") != "upstate.implementation-lab-dispatch-report/v1"
                or result.get("state") != "imported"
                or result.get("workspace_key") not in (None, workspace)):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT",
                             "The retained scientific report source is unavailable.")
        operation_id = result.get("operation_id")
        if not isinstance(operation_id, str) or not re.fullmatch(r"[0-9a-f]{64}", operation_id):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT", "The report operation identity changed.")
        ws = self.operator.ws(workspace)
        root = ws.root.resolve()
        directory = root / "implementation" / "laboratory-reports" / operation_id
        if directory.is_symlink() or not directory.resolve().is_relative_to(root):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT", "The original report directory changed.")
        report = result.get("report_source")
        if (not isinstance(report, dict)
                or result.get("source_collection_id") != report.get("source_collection_id")
                or result.get("delivery_selection") != report.get("delivery_selection")
                or observed_context.bind(ws, report["delivery_selection"]) != report.get("binding")):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT", "The original report source binding changed.", 409)
        ws._get("sources", result["source_collection_id"])
        files = result.get("files")
        if not isinstance(files, list):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT", "The report source file inventory is unavailable.")
        downloads = []
        for descriptor in files:
            if not isinstance(descriptor, dict):
                raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT", "The report source descriptor is invalid.")
            path = root / observed_context._relative(descriptor.get("path"))
            if not path.resolve().is_relative_to(directory.resolve()):
                raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT", "A report member leaves its original operation.")
            downloads.append(self._ticket(workspace, path, descriptor["path"], descriptor))
        return dict(result, workspace_key=workspace, _downloads=downloads)

    def _dispatch_report(self, workspace, value, *, preview=False):
        """Compose the exact dispatch/current revision into the existing report source."""
        from model.implementation_dispatch_report import (
            preview_dispatch_report, import_dispatch_report,
        )
        if not isinstance(value, dict) or any(key in value for key in
                ("path", "directory", "document", "source_document", "upload_id")):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT", "Choose the retained laboratory request and saved plan revision.")
        if value.get("workspace_key") not in (None, workspace):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT", "Reopen the source in its original workspace.")
        plan_id = self._id(value.get("plan_id", value.get("id")))
        revision = self._integer(value.get("revision"), "revision")
        dispatch_id = value.get("dispatch_id")
        if not isinstance(dispatch_id, str) or not re.fullmatch(r"[0-9a-f]{64}", dispatch_id):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT", "Choose an original laboratory package.")
        document = self.store(workspace).get(plan_id, revision)
        checksum = document_digest(document)
        supplied = value.get("document_digest")
        if ((supplied is not None and supplied != checksum) or (not preview and supplied != checksum)):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT_BINDING", "Review this exact saved plan revision first.", 409)
        selection = value.get("existing_report_selection")
        if selection is not None and not isinstance(selection, dict):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT", "The preceding report selection must be its original JSON object.")
        ws = self.operator.ws(workspace)
        if preview:
            result = preview_dispatch_report(ws, document, dispatch_id, existing_report_selection=selection)
        else:
            operation_id = value.get("report_operation_id")
            if not isinstance(operation_id, str) or not re.fullmatch(r"[0-9a-f]{64}", operation_id):
                raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT_BINDING", "Review the original scientific source operation first.")
            result = import_dispatch_report(ws, document, dispatch_id, expected_operation_id=operation_id,
                                            existing_report_selection=selection)
        if (not isinstance(result, dict)
                or result.get("schema") != "upstate.implementation-lab-dispatch-report/v1"
                or result.get("dispatch_id") != dispatch_id
                or result.get("plan", {}).get("id") != plan_id
                or result["plan"].get("revision") != revision
                or result["plan"].get("document_digest") != checksum
                or result.get("state") != ("preview" if preview else "imported")
                or (not preview and result.get("operation_id") != operation_id)):
            raise self.Fault("IMPLEMENTATION_DISPATCH_REPORT_RESULT", "The scientific source differs from the reviewed original operation.", 409)
        result = dict(result, workspace_key=workspace, plan_id=plan_id,
                      revision=revision, document_digest=checksum)
        return result if preview else self._dispatch_report_downloads(workspace, result)

    def _dispatch_result(self, workspace, plan_id, dispatch_id):
        from model.implementation_lab_dispatch import dispatch_files
        result, files = dispatch_files(self.operator.ws(workspace), plan_id, dispatch_id)
        downloads = [self._ticket(workspace, path, entry["path"], entry)
                     for entry, path in files]
        return dict(result, workspace_key=workspace, _downloads=downloads)

    def _dispatch(self, workspace, value, *, operation, actor=""):
        from model.implementation_lab_dispatch import (
            preview_dispatch, prepare_dispatch, list_dispatches, reconcile_dispatch,
        )
        if not isinstance(value, dict):
            raise self.Fault("IMPLEMENTATION_DISPATCH_INPUT",
                             "Supply the original saved plan and explicit laboratory request.")
        if any(key in value for key in ("path", "directory", "document", "source_document", "csv_path")):
            raise self.Fault("IMPLEMENTATION_DISPATCH_INPUT",
                             "Choose original saved records and source IDs.")
        if value.get("workspace_key") not in (None, workspace):
            raise self.Fault("IMPLEMENTATION_DISPATCH_WORKSPACE",
                             "Reopen the request in its original workspace.")
        ws = self.operator.ws(workspace)
        plan_id = self._id(value.get("plan_id", value.get("id")))
        if operation == "dispatches":
            self.store(workspace).get(plan_id)
            return dict(list_dispatches(ws, plan_id), workspace_key=workspace)
        dispatch_id = value.get("dispatch_id")
        if operation == "dispatch-detail":
            return self._dispatch_result(workspace, plan_id, dispatch_id)
        revision = self._integer(value.get("revision"), "revision")
        document = self.store(workspace).get(plan_id, revision)
        checksum = document_digest(document)
        supplied = value.get("document_digest")
        if supplied is not None and supplied != checksum:
            raise self.Fault("IMPLEMENTATION_DISPATCH_BINDING",
                             "The original saved plan differs from the reviewed revision.", 409)
        if operation == "dispatch-reconcile":
            result = reconcile_dispatch(ws, document, dispatch_id)
            return dict(result, workspace_key=workspace, plan_id=plan_id,
                        revision=revision, document_digest=checksum)
        selection = value.get("selection")
        if operation == "dispatch-preview":
            result = preview_dispatch(ws, document, selection)
            return dict(result, workspace_key=workspace, plan_id=plan_id,
                        revision=revision, document_digest=checksum)
        if operation != "dispatch":
            raise self.Fault("IMPLEMENTATION_DISPATCH_ACTION",
                             "Choose a supported original laboratory request operation.")
        operation_id = value.get("dispatch_operation_id")
        if (supplied != checksum or not isinstance(operation_id, str)
                or not re.fullmatch(r"[0-9a-f]{64}", operation_id)):
            raise self.Fault("IMPLEMENTATION_DISPATCH_BINDING",
                             "Review the exact original samples and analysis request before preparing.", 409)
        result = prepare_dispatch(ws, document, selection,
                                  expected_operation_id=operation_id, actor=actor)
        if (result.get("schema") != "upstate.implementation-lab-dispatch/v1"
                or result.get("operation_id") != operation_id
                or result.get("dispatch_id") != operation_id
                or result.get("plan_id") != plan_id or result.get("revision") != revision
                or result.get("document_digest") != checksum):
            raise self.Fault("IMPLEMENTATION_DISPATCH_RESULT",
                             "The retained request differs from the reviewed original operation.", 409)
        return dict(self._dispatch_result(workspace, plan_id, operation_id),
                    status=result["status"])

    def _briefing(self, workspace, value, *, preview=False, actor=""):
        from model import briefing_implementation
        if not isinstance(value, dict):
            raise self.Fault("IMPLEMENTATION_BRIEFING", "Select the original meeting notes and saved plan.")
        ws = self.operator.ws(workspace)
        notes_id = value.get("notes_upload_id")
        if not isinstance(notes_id, str) or not notes_id:
            raise self.Fault("IMPLEMENTATION_BRIEFING", "Upload the original meeting notes JSON.")
        notes = self.operator.upload(notes_id)
        if value.get("delivery_id"):
            if value.get("report_upload_id") or value.get("index_upload_id"):
                raise self.Fault("IMPLEMENTATION_BRIEFING", "Choose a saved report or an exported report pair.")
            paths = briefing_implementation.delivery_sources(ws, value["delivery_id"])
        else:
            report = self.operator.upload(value.get("report_upload_id"))
            index = self.operator.upload(value.get("index_upload_id"))
            paths = {"report": report["path"], "index": index["path"]}
        plan_id = self._id(value.get("plan_id"))
        revision = self._integer(value.get("revision"), "revision")
        document = self.store(workspace).get(plan_id, revision)
        digest = document_digest(document)
        supplied = value.get("document_digest")
        if supplied is not None and supplied != digest or not preview and supplied != digest:
            raise self.Fault("IMPLEMENTATION_BRIEFING", "Preview the exact saved working revision.", 409)
        arguments = {"selected_entry_ids": value.get("selected_entry_ids")}
        if preview:
            result = briefing_implementation.preview(ws, document, paths["report"], paths["index"], notes["path"], **arguments)
        else:
            result = briefing_implementation.receive(
                ws, document, paths["report"], paths["index"], notes["path"],
                expected_operation_id=value.get("briefing_operation_id"), actor=actor, **arguments)
        if not preview:
            result = {**result, "revision": result["applied_revision"]}
        return {**result, "workspace_key": workspace,
                "notes_upload_id": notes_id,
                "delivery_id": value.get("delivery_id")}

    def _lab(self, workspace, value, *, operation, actor=""):
        """Receive original CSV bytes through the host's verified upload ticket."""
        from model.implementation_lab_results import (
            inspect_lab_csv, preview_lab_results, import_lab_results,
        )
        if not isinstance(value, dict):
            raise self.Fault("IMPLEMENTATION_LAB_INPUT", "Supply the selected CSV and mapping.")
        if any(key in value for key in ("path", "csv_path", "document", "source_document")):
            raise self.Fault("IMPLEMENTATION_LAB_INPUT",
                             "Use an original upload ticket and saved plan revision.")
        ws = self.operator.ws(workspace)
        upload_id = value.get("upload_id")
        if not isinstance(upload_id, str) or not upload_id:
            raise self.Fault("IMPLEMENTATION_LAB_UPLOAD", "Upload the original laboratory CSV.")
        upload = self.operator.upload(upload_id)
        path = Path(upload["path"])
        filename = upload["filename"]
        if operation == "lab-inspect":
            result = inspect_lab_csv(path, delimiter=value.get("delimiter", ","),
                                     encoding=value.get("encoding", "utf-8-sig"),
                                     filename=filename)
            return dict(result, workspace_key=workspace, upload_id=upload_id)
        plan_id = self._id(value.get("plan_id"))
        revision = self._integer(value.get("revision"), "revision")
        document = self.store(workspace).get(plan_id, revision)
        digest = document_digest(document)
        supplied = value.get("document_digest")
        if supplied is not None and supplied != digest:
            raise self.Fault("IMPLEMENTATION_LAB_BINDING",
                             "The saved plan differs from the reviewed laboratory revision.", 409)
        mapping = value.get("mapping")
        if not isinstance(mapping, dict):
            raise self.Fault("IMPLEMENTATION_LAB_MAPPING", "Map the original CSV columns explicitly.")
        if operation == "lab-preview":
            result = preview_lab_results(ws, document, path, mapping, filename=filename)
            return dict(result, workspace_key=workspace, upload_id=upload_id,
                        plan_id=plan_id, revision=revision, document_digest=digest)
        operation_id = value.get("lab_operation_id")
        if supplied != digest or not isinstance(operation_id, str) or not re.fullmatch(r"[0-9a-f]{64}", operation_id):
            raise self.Fault("IMPLEMENTATION_LAB_BINDING",
                             "Preview the exact saved plan, original CSV and mapping before importing.", 409)
        result = import_lab_results(
            ws, document, path, mapping, expected_operation_id=operation_id,
            actor=actor, filename=filename,
        )
        if (not isinstance(result, dict)
                or result.get("schema") != "upstate.implementation-lab-import/v1"
                or result.get("operation_id") != operation_id
                or result.get("plan", {}).get("id") != plan_id):
            raise self.Fault("IMPLEMENTATION_LAB_RESULT",
                             "The saved laboratory result differs from the selected operation.", 409)
        return dict(result, workspace_key=workspace, upload_id=upload_id,
                    plan_id=plan_id, revision=result["applied_revision"],
                    base_revision=revision, base_document_digest=digest)

    def _observations(self, workspace, value, *, preview=False):
        """Register an exact saved field revision through the original registry."""
        from model.implementation_observations import (
            preview_observation_context, import_observation_context,
        )

        if not isinstance(value, dict):
            raise self.Fault("IMPLEMENTATION_OBSERVATIONS", "Choose a saved plan revision.")
        if any(key in value for key in
               ("document", "upload_id", "source_document", "field_mapping")):
            raise self.Fault("IMPLEMENTATION_OBSERVATIONS",
                             "Use the original saved plan; receive browser edits as a revision first.")
        plan_id = self._id(value.get("plan_id", value.get("id")))
        revision = self._integer(value.get("revision"), "revision")
        document = self.store(workspace).get(plan_id, revision)
        digest = document_digest(document)
        supplied = value.get("document_digest")
        if not preview and (not isinstance(supplied, str) or supplied != digest):
            raise self.Fault("IMPLEMENTATION_OBSERVATION_BINDING",
                             "Review the exact saved field revision before registering it.", 409)
        if preview and supplied is not None and supplied != digest:
            raise self.Fault("IMPLEMENTATION_OBSERVATION_BINDING",
                             "The requested field revision differs from the retained document.", 409)
        ws = self.operator.ws(workspace)
        if preview:
            result = preview_observation_context(ws, document)
        else:
            operation_id = value.get("observation_operation_id")
            if not isinstance(operation_id, str) or not re.fullmatch(r"[0-9a-f]{64}", operation_id):
                raise self.Fault("IMPLEMENTATION_OBSERVATION_BINDING",
                                 "Review the original field source selection before registering it.")
            result = import_observation_context(ws, document, expected_operation_id=operation_id)
        if not isinstance(result, dict):
            raise self.Fault("IMPLEMENTATION_OBSERVATION_RESULT",
                             "The observation adapter returned an invalid result.")
        # Operator binding is authored here from the original revision, never
        # accepted from the browser or an unverified imported source document.
        return dict(result, workspace_key=workspace, plan_id=plan_id,
                    revision=revision, document_digest=digest,
                    status="preview" if preview else "observations_imported")

    def _economic_import(self, task):
        """Read the saved authored edition; the browser supplies identities only."""
        import importlib.util
        from model.implementation_economics import import_economic_selection
        from model.implementation_sources import SourceImportError

        value = task["payload"]
        if any(value.get(key) is not None for key in
               ("source_document", "upload_id", "field_mapping", "method_mapping")):
            raise self.Fault("IMPLEMENTATION_ECONOMIC_SOURCE",
                             "Select the retained economic edition and one original run.")
        if value.get("workspace_key") != task["workspace"]:
            raise self.Fault("IMPLEMENTATION_ECONOMIC_WORKSPACE",
                             "Reopen this selection in its original workspace.")
        run_id = value.get("run_id")
        if value.get("selected_ids") != [run_id]:
            raise self.Fault("IMPLEMENTATION_ECONOMIC_SELECTION",
                             "Choose exactly one whole economic scenario.")
        if value.get("source_id") != value.get("edition_id"):
            raise self.Fault("IMPLEMENTATION_ECONOMIC_SOURCE",
                             "The source ID must be the selected economic edition.")
        # This optional extension is loaded from a fixed authored sibling path.
        # Importing operator as a package would collide with Python's stdlib.
        path = Path(__file__).with_name("economic_workbench.py")
        if not path.is_file():
            raise self.Fault("IMPLEMENTATION_ECONOMIC_UNAVAILABLE",
                             "Install the economic desk companion before importing this edition.")
        spec = importlib.util.spec_from_file_location(
            "_upstate_implementation_economic_workbench", path)
        if spec is None or spec.loader is None:
            raise self.Fault("IMPLEMENTATION_ECONOMIC_UNAVAILABLE",
                             "The installed economic desk module cannot be loaded.")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        try:
            ws = self.operator.ws(task["workspace"])
            root, edition, report = module.EconomicWorkbench(
                self.operator, self.Fault)._edition(ws, value.get("edition_id"), full=True)

            def original(descriptor):
                source_path = module._checked(root, descriptor)
                with source_path.open("rb") as stream:
                    body = stream.read(MAX_JSON_BYTES + 1)
                if (len(body) != descriptor["bytes"]
                        or hashlib.sha256(body).hexdigest() != descriptor["sha256"]):
                    raise ValueError("The retained source changed while importing it.")
                return load_json(body)

            manifest = original(edition["files"]["manifest"])
            native = original(edition["files"]["original_native_report"])
            return import_economic_selection(edition, report, manifest, native, value)
        except (SourceImportError, OSError, ValueError, KeyError, TypeError) as error:
            raise self.Fault("IMPLEMENTATION_ECONOMIC_SOURCE", str(error)) from error

    def _source_import(self, store, task, plan_id, expected, actor):
        from model.implementation_sources import SourceImportError, import_selection
        value = task["payload"]
        kind = value.get("kind", value.get("source_kind", "community_plan"))
        source_id = value.get("source_id")
        imported = None
        if kind == "economic_scenario":
            imported = self._economic_import(task)
        elif (kind in ("community_plan", "community_plans")
                and value.get("source_document") is None and value.get("upload_id") is None):
            if not isinstance(source_id, str):
                raise self.Fault("IMPLEMENTATION_SOURCE_ID", "Choose a retained community plan.")
            document = self.operator.item(task["workspace"], "community_plans", source_id)
            source_ref = str(self.operator.ws(task["workspace"]).root /
                             "community-plans" / (source_id + ".json"))
            kind = "community_plan"
        elif (kind == "conservation_portfolio"
              and value.get("source_document") is None and value.get("upload_id") is None):
            from model import conservation, conservation_bindings
            ws = self.operator.ws(task["workspace"])
            binding = conservation_bindings.bind_plan(ws, source_id, include_geometry=False)
            original_plan = binding["plan"]
            if original_plan.get("state") != "complete":
                raise self.Fault("IMPLEMENTATION_SOURCE_RESULT",
                                 "Choose a completed conservation portfolio with retained output files.")
            portfolio_path = conservation.verify_file(ws.root, original_plan["files"]["portfolio"])
            selection_path = conservation.verify_file(ws.root, original_plan["files"]["selection"])
            document = dict(
                schema="upstate.implementation-conservation-source/v1",
                plan=original_plan, portfolio=conservation.read_json(portfolio_path),
                selection=conservation.read_json(selection_path), binding=binding,
            )
            source_ref = str(ws.root / "conservation-plans" / original_plan["id"] / "plan.json")
        else:
            supplied = [name for name in ("source_document", "upload_id")
                        if value.get(name) is not None]
            if len(supplied) != 1:
                raise self.Fault("IMPLEMENTATION_SOURCE",
                                 "Supply source_document or a retained upload_id.")
            document = (self._uploaded_json(value["upload_id"]) if "upload_id" in supplied
                        else value["source_document"])
            source_ref = value.get("source_ref")
            if "upload_id" in supplied:
                source_ref = self.operator.upload(value["upload_id"])["path"]
        if imported is None:
            try:
                imported = import_selection(
                    document, source_id, kind, source_ref=source_ref,
                    selected_ids=value.get("selected_ids"), field_mapping=value.get("field_mapping"),
                    method_mapping=value.get("method_mapping"),
                )
            except SourceImportError as error:
                raise self.Fault("IMPLEMENTATION_SOURCE_INVALID", str(error)) from error
        plan = store.get(plan_id)
        if plan["revision"] != expected:
            raise RevisionConflict(plan_id, expected, plan["revision"])
        protected = {
            "candidates": ("source", "modeled_benefits", "area_ha"),
            "source_links": ("kind", "reference", "snapshot", "source_digest",
                             "source_id", "source_schema", "field_mapping",
                             "sha256", "size_bytes"),
        }
        for collection, fields in protected.items():
            index = {row["id"]: row for row in plan[collection]}
            for row in imported[collection]:
                old = index.get(row["id"])
                if old is not None:
                    if any(not _same_json(old.get(key), row.get(key)) for key in fields):
                        raise self.Fault("IMPLEMENTATION_SOURCE_COLLISION",
                                         "The retained source ID already has different frozen content.", 409)
                    # Keep labels and additive operator metadata from the saved row.
                    continue
                plan[collection].append(copy.deepcopy(row))
                index[row["id"]] = row
        saved = store.save(plan, expected, actor=actor)
        return self._plan_result(
            task["workspace"], saved, status="source_imported",
            source_digest=imported["source_digest"],
            proposed_task_inputs=imported.get("proposed_task_inputs", []),
            selection=imported.get("selection", {}),
        )

    def invoke(self, task):
        if task["action"] not in ACTIONS:
            raise self.Fault("IMPLEMENTATION_ACTION", "Choose a supported implementation action.")
        workspace = task["workspace"]
        store = self.store(workspace)
        value = task["payload"]
        actor = self._actor(task)
        action = task["action"]
        if action == "implementation.plan.create":
            document = self._create_document(value, task)
            plan_id = document["id"]
        elif action in ("implementation.plan.import", "implementation.plan.save"):
            document = self._document(value)
            plan_id = document["id"]
        else:
            document = None
            plan_id = self._id(value.get("plan_id", value.get("id")))
        if (action not in ("implementation.plan.report", "implementation.observations.import",
                           "implementation.lab.import", "implementation.lab.dispatch",
                           "implementation.lab.dispatch-report", "implementation.briefing.import")
                and (not task.get("attempts") or len(task["attempts"]) > 1)):
            replay = self._replay(store, plan_id, actor)
            if replay is not None:
                return self._plan_result(
                    workspace, replay, status="reused", reused_completed_output=True,
                )
        try:
            if action == "implementation.plan.create":
                return self._plan_result(workspace, store.create(document, actor=actor),
                                         status="created")
            if action == "implementation.plan.import":
                expected = value.get("expected_revision")
                if expected is not None:
                    if isinstance(expected, str) and re.fullmatch(r"\d+", expected):
                        expected = int(expected)
                    if not _integer(expected):
                        raise self.Fault("IMPLEMENTATION_REVISION",
                                         "expected_revision must be a nonnegative whole number.")
                result = store.import_document(document, expected_revision=expected, actor=actor)
                extra = {key: item for key, item in result.items() if key not in ("plan", "status")}
                return self._plan_result(workspace, result["plan"], status=result["status"], **extra)
            if action == "implementation.plan.save":
                expected = self._integer(value.get("expected_revision"), "expected_revision")
                return self._plan_result(workspace, store.save(document, expected, actor=actor))
            if action == "implementation.records.append":
                expected = self._integer(value.get("expected_revision"), "expected_revision")
                saved = store.add_records(
                    plan_id, value.get("collection"), value.get("records"), expected, actor=actor,
                )
                return self._plan_result(workspace, saved, status="appended")
            if action == "implementation.source.attach":
                expected = self._integer(value.get("expected_revision"), "expected_revision")
                return self._attach(store, task, plan_id, expected, actor)
            if action in ("implementation.source.import", "implementation.selection.import"):
                expected = self._integer(value.get("expected_revision"), "expected_revision")
                return self._source_import(store, task, plan_id, expected, actor)
            if action == "implementation.plan.report":
                return self._report(store, task, plan_id)
            if action == "implementation.lab.dispatch-report":
                return self._dispatch_report(workspace, value)
            if action == "implementation.briefing.import":
                return self._briefing(workspace, value, actor=actor)
            if action == "implementation.lab.dispatch":
                return self._dispatch(workspace, value, operation="dispatch", actor=actor)
            if action == "implementation.lab.import":
                return self._lab(workspace, value, operation="lab-import", actor=actor)
            if action == "implementation.observations.import":
                return self._observations(workspace, value)
        except RevisionConflict as error:
            if error.conflict_ref:
                error.conflict_download = self._ticket(
                    workspace, error.conflict_ref, "Preserved incoming implementation conflict",
                )
            raise
        raise self.Fault("IMPLEMENTATION_ACTION", "The implementation action is unavailable.")

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        workspace = task["workspace"]
        if task.get("state") == "complete":
            result = task.get("result", {})
            if task["action"] == "implementation.lab.dispatch-report":
                refreshed = self._dispatch_report_downloads(workspace, result)
                task["result"] = refreshed
                task["_downloads"] = refreshed["_downloads"]
            elif task["action"] == "implementation.lab.dispatch":
                refreshed = self._dispatch_result(workspace, result["plan_id"], result["dispatch_id"])
                task["result"] = dict(refreshed, status=result.get("status", refreshed["status"]))
                task["_downloads"] = refreshed["_downloads"]
            elif task["action"] == "implementation.plan.report":
                directory = (self.store(workspace).base / self._id(result["plan_id"]) /
                             "reports" / result["report_id"]
                             if result.get("report_id") else Path(result["directory"]))
                refreshed = self._report_result(
                    workspace, directory, expected_plan=result["plan_id"],
                    expected_revision=result["revision"],
                )
                task["_downloads"] = refreshed["_downloads"]
            elif result.get("plan_id") and result.get("revision"):
                plan = self.store(workspace).get(result["plan_id"], result["revision"])
                task["_downloads"] = [self._snapshot_download(workspace, plan)]
        elif task.get("error", {}).get("conflict_ref"):
            path = Path(task["error"]["conflict_ref"])
            plan_id = task["error"].get("plan_id")
            if plan_id:
                expected_directory = (self.store(workspace).base / self._id(plan_id) / "conflicts").resolve()
                if path.resolve().is_relative_to(expected_directory) and path.is_file():
                    task["error"]["conflict_download"] = self._ticket(
                        workspace, path, "Preserved incoming implementation conflict",
                    )
        return task
