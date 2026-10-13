"""Review saved FIELD12 expenses in the original native Economic Workbench.

One queued operation retains the saved plan, reviewed allocations, original
evidence and unchanged physical source, then saves a new draft and edition.
Completed operations reopen their recorded edition after later field edits.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile

import economic_workbench as economic
from model.common import (
    canonical, digest, atomic_json, read_json, held, file_digest, describe_file,
    verify_file,
)
from model.implementation import ImplementationStore, document_digest
from model.implementation_schema import ImplementationError, _safe_id
from model.implementation_cost_review import cost_context, preview_cost_review, _attachments
from model.implementation_evidence import (
    _links, _safe_name, _ordinary_directory, _publish_stream, _verify_file,
)

ACTION = "implementation.cost-review.apply"
SCHEMA = "upstate.implementation-cost-review-result/v1"
INTENT_SCHEMA = "upstate.implementation-cost-review-intent/v1"
HEX = re.compile(r"^[0-9a-f]{64}$")


def _require(condition, message):
    if not condition:
        raise ImplementationError(message)


def _hex(value, name):
    _require(isinstance(value, str) and HEX.fullmatch(value),
             name + " must retain its original SHA256 identity.")
    return value


def _inside(root, *parts):
    root = Path(root).resolve()
    path = root.joinpath(*parts)
    _require(path.resolve().is_relative_to(root),
             "Cost review storage must remain in its original Workspace.")
    current = root
    for part in path.relative_to(root).parts:
        current = current / part
        _require(not current.is_symlink(),
                 "Cost review storage must not traverse a symlink.")
    return path


def _immutable(path, value):
    _require(not path.is_symlink(), "Retained cost review files must be ordinary files.")
    atomic_json(path, value, immutable=True)


def _input_identity(value):
    return {key: deepcopy(value[key]) for key in
            ("plan_id", "revision", "document_digest", "candidate_id", "review",
             "expected_operation_id")}


class ImplementationCostReview:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault
        self.economic = economic.EconomicWorkbench(operator, fault)

    def _base(self, workspace, payload):
        _require(isinstance(payload, dict), "Select the saved implementation plan.")
        _require(payload.get("workspace_key") in (None, workspace),
                 "Open the cost review in its original Workspace.")
        _require(not any(key in payload for key in
                         ("path", "directory", "document", "upload_id", "input")),
                 "Choose the original saved revision and its economic candidate.")
        plan_id = _safe_id(payload.get("plan_id"), "plan_id")
        revision = payload.get("revision")
        if isinstance(revision, str) and revision.isdigit():
            revision = int(revision)
        _require(type(revision) is int and 0 < revision <= 9007199254740991,
                 "Choose a positive saved plan revision.")
        expected = _hex(payload.get("document_digest"), "Saved plan")
        ws = self.operator.ws(workspace)
        store = ImplementationStore(ws)
        plan = store.get(plan_id, revision)
        _require(document_digest(plan) == expected,
                 "The saved plan differs from the reviewed document identity.")
        meta = {"id": plan_id, "revision": revision, "sha256": expected,
                "document_digest": expected, "title": plan["title"]}
        return ws, store, plan, meta

    def _context(self, workspace, payload):
        ws, store, plan, meta = self._base(workspace, payload)
        result = cost_context(plan, payload.get("candidate_id"))
        result.update(workspace_key=workspace, plan={**result["plan"], **meta},
                      current_revision=store.get(plan["id"])["revision"])
        return result

    def _preview(self, workspace, payload):
        ws, store, plan, meta = self._base(workspace, payload)
        result = preview_cost_review(plan, payload.get("candidate_id"), payload.get("review"))
        result.update(workspace_key=workspace, plan=meta,
                      current_revision=store.get(plan["id"])["revision"])
        if result["can_apply"]:
            try:
                retained, _, _, report = self.economic._input(ws, result["proposed_input"])
                _require(retained == result["proposed_input"],
                         "The native economic selection changed during review.")
                result["economic_preview"] = {
                    "report_id": report["id"], "title": report["title"],
                    "baseline": report["baseline"],
                    "alternatives": report["alternatives"],
                    "frontier": report["frontier"],
                }
                result["evidence"] = self._evidence(ws, plan, result["source_audit"])
            except (OSError, ValueError, KeyError, TypeError) as error:
                result["issues"].append({"code": "native_cost_source", "severity": "error",
                                         "message": str(error)})
                result["can_apply"] = False
        return result

    def _evidence(self, ws, plan, audit, destination=None):
        """Copy exact declared associations; a free-text reference is never a file."""
        requested = audit.get("associated_source_links", [])
        _require(isinstance(requested, list), "Cost evidence associations must be explicit source links.")
        known = _links({"id": plan["id"], "source_links": requested})
        companions = audit.get("companions") or {}
        expected_directory = "implementation/cost-reviews/" + _hex(audit.get("operation_id"), "Cost evidence operation")
        _require(companions.get("directory") == expected_directory
                 and companions.get("files") == _attachments(plan, requested),
                 "The cost evidence companions differ from their exported source audit.")
        if destination is not None:
            _require(Path(destination).relative_to(ws.root).as_posix() == expected_directory,
                     "Cost evidence must remain in its original reviewed directory.")
        result = []
        for link in requested:
            _require(isinstance(link, dict) and link.get("id") in
                     {row["id"] for row in plan["source_links"]},
                     "Cost review names an unknown original source link.")
            original = next(row for row in plan["source_links"] if row["id"] == link["id"])
            _require(original == link, "Cost evidence differs from its saved source link.")
            if link["kind"] != "local_file":
                continue
            _require(known.get(link["id"]) == link, "Cost evidence must retain its original file descriptor.")
            member = "evidence/" + link["sha256"] + "/" + _safe_name(link["original_filename"])
            target = _inside(destination, member) if destination is not None else None
            if target is not None and target.exists():
                _verify_file(target, link["size_bytes"], link["sha256"])
            else:
                source = _inside(ws.root, link["reference"])
                _verify_file(source, link["size_bytes"], link["sha256"])
                if target is not None:
                    _ordinary_directory(target.parent, destination)
                    with source.open("rb") as handle:
                        _publish_stream(target, handle, link["size_bytes"], link["sha256"])
            result.append({
                "source_id": link["id"], "path": member,
                "source_ref": link["reference"], "original_filename": link["original_filename"],
                "bytes": link["size_bytes"], "sha256": link["sha256"],
                "media_type": link.get("media_type") or "application/octet-stream",
            })
        return result

    def _directory(self, ws, operation_id, *, create=False):
        operation_id = _hex(operation_id, "Cost review operation")
        directory = _inside(ws.root, "implementation", "cost-reviews", operation_id)
        if create:
            _ordinary_directory(directory, ws.root)
        return directory

    def _draft(self, ws, key, expected):
        path = _inside(ws.root, economic.DRAFT_KIND, _hex(key, "Economic draft") + ".json")
        record = read_json(path)
        _require(record.get("schema") == economic.DRAFT_SCHEMA
                 and record.get("id") == key and record.get("input") == expected
                 and digest(record["input"]) == key,
                 "The saved economic draft differs from this reviewed input.")
        return path, record

    def _attempt(self, ws, directory, reviewed_input):
        """Reconnect a completed prior edition before choosing the current engine."""
        attempts = _inside(directory, "attempts")
        _ordinary_directory(attempts, directory)
        for path in sorted(attempts.glob("*.json")):
            _require(not path.is_symlink(), "An economic attempt must be an ordinary file.")
            item = read_json(path)
            key = _hex(item.get("edition_id"), "Economic edition")
            _require(path.stem == key and item.get("input_digest") == digest(reviewed_input)
                     and digest({"input": reviewed_input, "implementation": item["implementation"]}) == key,
                     "A retained economic attempt differs from its original reviewed input.")
            if _inside(ws.root, economic.EDITION_KIND, key, "edition.json").is_file():
                root, record, _ = self.economic._edition(ws, key, full=True)
                _require(record["input"] == reviewed_input,
                         "The original completed economic edition contains another input.")
                return key, root, record
        implementation = {
            "decision_analysis_sha256": file_digest(Path(economic.decision.__file__)),
            "decision_desk_sha256": file_digest(Path(economic.decision.__file__).with_name("decision_desk.html")),
            "economic_workbench_sha256": file_digest(Path(economic.__file__)),
        }
        key = digest({"input": reviewed_input, "implementation": implementation})
        _immutable(attempts / (key + ".json"), {
            "schema": "upstate.implementation-cost-review-attempt/v1",
            "edition_id": key, "input_digest": digest(reviewed_input),
            "implementation": implementation,
        })
        return key, None, None

    def _package(self, ws, directory, record, edition_root, edition):
        """Retain a complete review with invoices and the native economic package."""
        names = ["intent.json", "plan.json", "preview.json", "review.json", "source-audit.json",
                 "economic-input.json", "evidence.json", "draft.json", "edition.json"]
        names.extend(path.relative_to(directory).as_posix()
                     for path in sorted((directory / "attempts").glob("*.json")))
        members = [describe_file(directory, _inside(directory, name)) for name in names]
        for item in record["evidence"]:
            path = _inside(directory, item["path"])
            _verify_file(path, item["bytes"], item["sha256"])
            if item["path"] not in {row["path"] for row in members}:
                members.append(describe_file(directory, path))
        package = economic._checked(edition_root, edition["files"]["complete_package"])
        members.append({"path": "economic/decision-package.zip",
                        "bytes": package.stat().st_size, "sha256": file_digest(package)})
        manifest = {
            "schema": "upstate.implementation-cost-review-package/v1",
            "operation_id": record["operation_id"], "binding": record["binding"],
            "draft_id": record["draft_id"], "edition_id": record["edition_id"],
            "members": members, "evidence": record["evidence"],
        }
        _immutable(directory / "manifest.json", manifest)
        output = directory / "cost-review-package.zip"
        if not output.exists():
            descriptor, pending_name = tempfile.mkstemp(prefix=".cost-review-", dir=directory)
            os.close(descriptor)
            pending = Path(pending_name)
            try:
                with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_STORED) as archive:
                    for item in members:
                        source = package if item["path"] == "economic/decision-package.zip" else _inside(directory, item["path"])
                        _verify_file(source, item["bytes"], item["sha256"])
                        archive.write(source, item["path"])
                    archive.write(directory / "manifest.json", "manifest.json")
                with pending.open("rb") as handle:
                    os.fsync(handle.fileno())
                os.link(pending, output)
                if os.name != "nt":
                    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
            finally:
                pending.unlink(missing_ok=True)
        with zipfile.ZipFile(output) as archive:
            expected = {item["path"]: item for item in members}
            expected["manifest.json"] = describe_file(directory, directory / "manifest.json")
            _require(len(archive.infolist()) == len(expected)
                     and set(archive.namelist()) == set(expected),
                     "The retained cost-review package has different members.")
            for name, item in expected.items():
                checksum, count = hashlib.sha256(), 0
                with archive.open(name) as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        count += len(chunk)
                        checksum.update(chunk)
                _require(count == item["bytes"] and checksum.hexdigest() == item["sha256"],
                         "A retained cost-review package member changed: " + name)
        return members + [describe_file(directory, directory / "manifest.json"),
                          describe_file(directory, output)]

    def _apply(self, workspace, payload):
        ws, store, plan, meta = self._base(workspace, payload)
        key = _hex(payload.get("expected_operation_id"), "Reviewed operation")
        directory = self._directory(ws, key, create=True)
        requested = _input_identity(dict(payload, revision=plan["revision"]))
        with held(directory / ".lock"):
            receipt_path = directory / "receipt.json"
            intent_path = directory / "intent.json"
            if intent_path.exists():
                intent = read_json(intent_path)
                _require(intent.get("schema") == INTENT_SCHEMA and intent.get("request") == requested,
                         "This operation retains another original cost-review selection.")
            else:
                result = self._preview(workspace, payload)
                _require(result["can_apply"],
                         "; ".join(item["message"] for item in result["issues"] if item["severity"] == "error"))
                _require(result["operation_id"] == key,
                         "Review the current saved cost selection before saving its economic edition.")
                frozen = {name: deepcopy(result[name]) for name in
                          ("schema", "operation_id", "binding", "review", "summary", "issues",
                           "proposed_input", "source_audit")}
                intent = {"schema": INTENT_SCHEMA, "operation_id": key,
                          "request": requested, "preview": frozen, "plan": meta}
                _immutable(intent_path, intent)
            _require(intent.get("operation_id") == key, "The retained cost-review operation has another identity.")
            if receipt_path.exists():
                return self._public(workspace, key)
            result = intent["preview"]
            _require(result["operation_id"] == key and result["binding"]["document_digest"] == meta["sha256"],
                     "The retained cost review differs from this exact saved revision.")
            _immutable(directory / "plan.json", plan)
            _immutable(directory / "preview.json", result)
            _immutable(directory / "review.json", result["review"])
            _immutable(directory / "source-audit.json", result["source_audit"])
            reviewed_input = result["proposed_input"]
            _immutable(directory / "economic-input.json", reviewed_input)
            evidence = self._evidence(ws, plan, result["source_audit"], destination=directory)
            _immutable(directory / "evidence.json", evidence)
            draft_id = digest(reviewed_input)
            draft_path = _inside(ws.root, economic.DRAFT_KIND, draft_id + ".json")
            if not draft_path.exists():
                self.economic.invoke({"workspace": workspace, "action": "economic.draft.save",
                                      "payload": reviewed_input})
            draft_path, draft = self._draft(ws, draft_id, reviewed_input)
            _immutable(directory / "draft.json", draft)
            edition_id, edition_root, edition = self._attempt(ws, directory, reviewed_input)
            if edition is None:
                built = self.economic.invoke({"workspace": workspace, "action": "economic.edition.build",
                                              "payload": reviewed_input})
                _require(built["id"] == edition_id,
                         "The installed economic engine changed while building this reviewed edition.")
                edition_root, edition, _ = self.economic._edition(ws, edition_id, full=True)
            _require(edition["input"] == reviewed_input,
                     "The completed economic edition differs from the reviewed saved input.")
            _immutable(directory / "edition.json", edition)
            record = {
                "schema": SCHEMA, "operation_id": key, "plan": meta,
                "candidate_id": result["binding"]["candidate_id"],
                "binding": result["binding"], "summary": result["summary"],
                "draft_id": draft_id, "edition_id": edition_id, "evidence": evidence,
            }
            members = self._package(ws, directory, record, edition_root, edition)
            # The nested native package is already described in the economic edition.
            record["files"] = [dict(item, path=directory.relative_to(ws.root).as_posix() + "/" + item["path"])
                               for item in members if item["path"] != "economic/decision-package.zip"]
            _immutable(receipt_path, record)
            return self._public(workspace, key)

    def _public(self, workspace, operation_id):
        ws = self.operator.ws(workspace)
        directory = self._directory(ws, operation_id)
        record = read_json(_inside(directory, "receipt.json"))
        _require(record.get("schema") == SCHEMA and record.get("operation_id") == operation_id,
                 "The completed review receipt has another operation identity.")
        intent = read_json(_inside(directory, "intent.json"))
        _require(intent.get("operation_id") == operation_id and intent.get("plan") == record["plan"],
                 "The review receipt differs from its retained saved plan.")
        original = ImplementationStore(ws).get(record["plan"]["id"], record["plan"]["revision"])
        _require(document_digest(original) == record["plan"]["sha256"],
                 "The original saved field revision changed.")
        reviewed_input = intent["preview"]["proposed_input"]
        draft_path, draft = self._draft(ws, record["draft_id"], reviewed_input)
        edition_root, edition, _ = self.economic._edition(ws, record["edition_id"], full=True)
        _require(edition["input"] == reviewed_input and record["binding"] == intent["preview"]["binding"],
                 "The completed edition differs from the original reviewed selection.")
        downloads = []
        for item in record["files"]:
            path = verify_file(ws.root, item)
            downloads.append(self.operator._ticket(workspace, path, item, Path(item["path"]).name))
        downloads.append(self.operator._ticket(workspace, draft_path,
                         describe_file(ws.root, draft_path), "Reviewed economic draft"))
        current = ImplementationStore(ws).get(record["plan"]["id"])["revision"]
        return dict(record, workspace_key=workspace, current_revision=current,
                    draft=draft, edition=self.economic._with_files(workspace, edition, edition_root),
                    _downloads=downloads)

    def verify_workspace(self, workspace):
        root = _inside(workspace.root, "implementation", "cost-reviews")
        completed, unfinished = 0, 0
        if not root.exists():
            return {"completed": 0, "unfinished": 0}
        for directory in sorted(root.iterdir()):
            _require(directory.is_dir() and not directory.is_symlink()
                     and HEX.fullmatch(directory.name),
                     "A retained cost review needs its original operation directory.")
            receipt = directory / "receipt.json"
            if not receipt.exists():
                unfinished += 1
                continue
            record = read_json(receipt)
            intent = read_json(_inside(directory, "intent.json"))
            _require(record.get("schema") == SCHEMA
                     and record.get("operation_id") == directory.name
                     and intent.get("operation_id") == directory.name
                     and record.get("plan") == intent.get("plan")
                     and record.get("binding") == intent["preview"]["binding"],
                     "A retained cost review has inconsistent saved identities.")
            plan = ImplementationStore(workspace).get(record["plan"]["id"], record["plan"]["revision"])
            _require(document_digest(plan) == record["plan"]["sha256"],
                     "A reviewed original field revision changed.")
            reviewed_input = intent["preview"]["proposed_input"]
            self._draft(workspace, record["draft_id"], reviewed_input)
            _, edition, _ = self.economic._edition(workspace, record["edition_id"], full=True)
            _require(edition["input"] == reviewed_input,
                     "The restored Economic edition differs from its original cost review.")
            for item in record["files"]:
                verify_file(workspace.root, item)
            completed += 1
        return {"completed": completed, "unfinished": unfinished}

    def read(self, workspace, operation, payload):
        payload = payload or {}
        if operation == "catalog":
            ws, store, plan, meta = self._base(workspace, payload)
            candidates, issues = [], []
            links = {row["id"]: row for row in plan["source_links"]}
            for candidate in plan["candidates"]:
                link = links.get((candidate.get("source") or {}).get("source_link_id"), {})
                if (link.get("snapshot") or {}).get("schema") != "upstate.implementation-economic-source/v1":
                    continue
                try:
                    context = cost_context(plan, candidate["id"])
                    candidates.append({"id": candidate["id"], "label": candidate["label"],
                                       "binding": context["binding"], "original_cost": context["original_cost"]})
                except (ValueError, KeyError, TypeError) as error:
                    issues.append({"candidate_id": candidate["id"], "message": str(error)})
            return {"schema": "upstate.implementation-cost-catalog/v1",
                    "workspace_key": workspace, "plan": meta,
                    "current_revision": store.get(plan["id"])["revision"],
                    "candidates": candidates, "issues": issues}
        if operation == "context":
            return self._context(workspace, payload)
        if operation == "preview":
            return self._preview(workspace, payload)
        if operation == "detail":
            return self._public(workspace, _hex(payload.get("operation_id"), "Cost review operation"))
        raise self.Fault("IMPLEMENTATION_COST_READ", "Choose a registered cost review operation.", 404)

    def queue(self, workspace, payload):
        _require(isinstance(payload, dict), "Submit the reviewed economic selection.")
        operation_id = payload.get("operation_id")
        value = payload.get("payload") or {key: item for key, item in payload.items()
                                          if key not in ("workspace", "operation_id")}
        return self.operator.submit(workspace, ACTION, value, operation_id)

    def invoke(self, task):
        _require(task.get("action") == ACTION, "Choose the original cost review action.")
        return self._apply(task["workspace"], task["payload"])

    def decorate_task(self, task):
        if task.get("action") != ACTION or task.get("state") != "complete":
            return task
        public = deepcopy(task)
        public["result"] = self._public(task["workspace"], task["result"]["operation_id"])
        public["_downloads"] = public["result"]["_downloads"]
        return public
