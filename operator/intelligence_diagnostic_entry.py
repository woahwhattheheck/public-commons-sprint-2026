"""Open a saved diagnostic in the original investigations engine.

Authored by TokenJunkieLabs. This entry uses the original serial Operator task,
Workspace resolver, repository, Store and evidence inspection. The retained
association contains original identities and relative members so restored
workspaces can reopen the same investigation through their current public key.
"""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import fcntl
import hashlib
import re

from eco_intelligence.common import IntelligenceError
from eco_intelligence.schemas import Inspect, SessionCreate
from model.common import atomic_bytes, atomic_json, identifier, read_json, verify_file

_SCHEMA = "upstate.diagnostic-investigation/v1"
_SESSION = re.compile(r"^(?:[0-9a-f]{32}|[0-9a-f]{64})$")
_EVIDENCE = re.compile(r"^E[0-9a-f]{24}$")


@contextmanager
def _association_guard(index_path):
    index_path.parent.mkdir(parents=True, exist_ok=True)
    with index_path.with_suffix(".lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _retain_revision(ws, task, diagnostic_id, dataset_id, source_path, source):
    root = ws.root.resolve()
    sha = identifier(source["sha256"])
    revision_id = "es26:" + diagnostic_id + ":report_revision_" + sha
    folder = root / "intelligence" / "diagnostic-revisions" / diagnostic_id / sha
    if not folder.resolve().is_relative_to(root):
        raise IntelligenceError("The report revision leaves this workspace.", 409)
    report_path, manifest_path = folder / "report.json", folder / "manifest.json"
    descriptor = {
        "path": report_path.relative_to(root).as_posix(),
        "bytes": Path(source_path).stat().st_size, "sha256": sha,
    }
    if manifest_path.is_file():
        manifest = read_json(manifest_path)
        if (
            manifest.get("schema") != "upstate.diagnostic-report-revision/v1"
            or manifest.get("project_id") != ws.project["id"]
            or manifest.get("diagnostic_id") != diagnostic_id
            or manifest.get("dataset_id") != revision_id
            or manifest.get("source_dataset_id") != dataset_id
            or manifest.get("source_sha256") != sha
            or manifest.get("report") != descriptor
        ):
            raise IntelligenceError("The retained report revision has another identity.", 409)
        verify_file(root, descriptor)
    else:
        body = Path(source_path).read_bytes()
        if hashlib.sha256(body).hexdigest() != sha or len(body) != descriptor["bytes"]:
            raise IntelligenceError("The saved report changed during opening.", 409)
        if report_path.exists():
            verify_file(root, descriptor)
        else:
            atomic_bytes(report_path, body, immutable=True)
        manifest = {
            "schema": "upstate.diagnostic-report-revision/v1",
            "project_id": ws.project["id"], "diagnostic_id": diagnostic_id,
            "dataset_id": revision_id, "source_dataset_id": dataset_id,
            "source_sha256": sha, "report": descriptor,
            "metadata": source.get("metadata") or {}, "created_at": task["created_at"],
        }
        atomic_json(manifest_path, manifest, immutable=True)
    return {"kind": "dataset", "id": revision_id}


def _matches_evidence(evidence, reference, source_sha256):
    operation = evidence.get("operation") or {}
    return (
        operation.get("operation") == "profile"
        and operation.get("ref") == reference
        and any(
            item.get("ref") == reference
            and item.get("sha256") == source_sha256
            for item in evidence.get("sources", [])
            if isinstance(item, dict)
        )
    )


def _diagnostic_context(engine, workspace, sid):
    session = engine.store.session(workspace, sid)
    contexts = [
        event.get("body") or {} for event in session.get("events", [])
        if event.get("kind") == "diagnostic_context"
    ]
    if not contexts:
        return None
    identities = {
        (row.get("diagnostic_id"), row.get("report_dataset_id"),
         row.get("source_sha256"), row.get("evidence_id"))
        for row in contexts
    }
    if len(identities) != 1:
        raise IntelligenceError("This investigation has conflicting report revisions.", 409)
    context = contexts[0]
    diagnostic_id = identifier(context.get("diagnostic_id"))
    sha = identifier(context.get("source_sha256"))
    reference = {"kind": "dataset", "id": "es26:" + diagnostic_id + ":report_revision_" + sha}
    if context.get("report_dataset_id") != reference["id"]:
        raise IntelligenceError("The investigation report revision is invalid.", 409)
    evidence = engine.store.get_evidence(workspace, sid, context.get("evidence_id"))
    if not _matches_evidence(evidence, reference, sha):
        raise IntelligenceError("The investigation source differs from its saved evidence.", 409)
    return context


def contextualize_diagnostic_question(engine, workspace, sid, question):
    """Use this session's immutable report even when its current analysis advances."""
    context = _diagnostic_context(engine, workspace, sid)
    if context is None:
        return question
    reference = {"kind": "dataset", "id": context["report_dataset_id"]}
    _, source = engine.repo.source(workspace, reference)
    if source["sha256"] != context["source_sha256"]:
        raise IntelligenceError("The saved investigation report revision changed.", 409)
    result = (
        "Use the retained report " + context["report_dataset_id"]
        + " (SHA-256 " + context["source_sha256"]
        + "; existing evidence " + context["evidence_id"] + "). "
        "Answer from this captured revision and its recorded design, model applicability, "
        "shared spatial support and observation cohorts.\n\n" + question
    )
    if len(result) > 24000:
        raise IntelligenceError("Shorten the question to include its saved source context.", 422)
    return result


def open_diagnostic(operator, engine, task):
    """Keep the original Store and its project-local association consistent."""
    guard = getattr(engine.store, "workspace_guard", None)
    if not callable(guard):
        raise IntelligenceError("Install the original project investigation Store.", 503)
    with guard():
        return _open_diagnostic(operator, engine, task)


def _open_diagnostic(operator, engine, task):
    """Create or reopen the report's retained session within the original task."""
    value, workspace = task["payload"], task["workspace"]
    if not isinstance(value, dict) or set(value) - {
        "diagnostic_id", "dataset_id", "title", "report_sha256"
    }:
        raise IntelligenceError("Choose a saved scientific analysis.", 422)
    try:
        diagnostic_id = identifier(value.get("diagnostic_id"))
    except (TypeError, ValueError) as error:
        raise IntelligenceError("Choose a saved scientific analysis.", 422) from error
    dataset_id = "es26:" + diagnostic_id + ":report_json"
    if value.get("dataset_id", dataset_id) != dataset_id:
        raise IntelligenceError("The selected dataset belongs to another analysis.", 409)
    reference = {"kind": "dataset", "id": dataset_id}

    ws = operator.ws(workspace)
    root = ws.root.resolve()
    expected = root / "experiment-diagnostics" / diagnostic_id / "report.json"
    original_report_member = expected.relative_to(root).as_posix()
    requested_sha = value.get("report_sha256")
    if requested_sha is not None:
        try:
            requested_sha = identifier(requested_sha)
        except (TypeError, ValueError) as error:
            raise IntelligenceError("Choose an original saved report revision.", 422) from error
        retained = root / "intelligence" / "diagnostic-revisions" / diagnostic_id / requested_sha
        if (retained / "manifest.json").is_file():
            # Resume an already captured original operation even when its live
            # diagnostic has advanced before the queue receipt was committed.
            reference = {
                "kind": "dataset",
                "id": "es26:" + diagnostic_id + ":report_revision_" + requested_sha,
            }
            expected = retained / "report.json"
    path, source = engine.repo.source(workspace, reference)
    metadata = source.get("metadata") or {}
    if (
        Path(path).resolve() != expected.resolve()
        or not expected.resolve().is_relative_to(root)
        or metadata.get("diagnostic_id") != diagnostic_id
        or metadata.get("artifact_key") != "report_json"
    ):
        raise IntelligenceError("The selected source is not this saved report.", 409)
    source_sha256 = identifier(source["sha256"])
    if value.get("report_sha256", source_sha256) != source_sha256:
        raise IntelligenceError("The saved report changed. Reopen its current revision.", 409)
    title = value.get("title") or metadata.get("diagnostic_title") or "Scientific analysis"
    title = SessionCreate.model_validate({"title": title}).title
    member = (Path("intelligence") / "diagnostic-sessions" / diagnostic_id
              / (source_sha256 + ".json"))
    index_path = root / member
    if not index_path.resolve().is_relative_to(root):
        raise IntelligenceError("The investigation index must belong to this workspace.", 409)

    with _association_guard(index_path):
        revision_reference = _retain_revision(
            ws, task, diagnostic_id, dataset_id, path, source,
        )
        record = read_json(index_path) if index_path.is_file() else None
        reopened = False
        if record is not None:
            if (
                record.get("schema") != _SCHEMA
                or record.get("project_id") != ws.project["id"]
                or record.get("diagnostic_id") != diagnostic_id
                or record.get("dataset_id") != dataset_id
                or record.get("source_sha256") != source_sha256
                or record.get("report_dataset_id") != revision_reference["id"]
                or not isinstance(record.get("session_id"), str)
                or not _SESSION.fullmatch(record["session_id"])
            ):
                raise IntelligenceError("The retained association does not match this report.", 409)
            sid = record["session_id"]
            engine.store.authorize(workspace, sid)
            eid = record.get("evidence_id")
            if eid:
                if not isinstance(eid, str) or not _EVIDENCE.fullmatch(eid):
                    raise IntelligenceError("The retained evidence identity is invalid.", 409)
                evidence = engine.store.get_evidence(workspace, sid, eid)
                if not _matches_evidence(evidence, revision_reference, source_sha256):
                    raise IntelligenceError("The retained evidence belongs to another source.", 409)
                reopened = True
            else:
                evidence = None
        else:
            # A66A's existing OperationStore derives this session from the original
            # task ID. Resuming that task preserves the session after interruption.
            session = engine.store.create_session(workspace, title)
            sid = session["id"]
            record = {
                "schema": _SCHEMA, "project_id": ws.project["id"],
                "diagnostic_id": diagnostic_id, "dataset_id": dataset_id,
                "source_sha256": source_sha256, "report_member": original_report_member,
                "report_dataset_id": revision_reference["id"],
                "session_id": sid, "evidence_id": None, "title": session["title"],
                "created_at": task["created_at"], "original_task_id": task["id"],
                "original_operation_id": task["operation_id"],
            }
            # Retain the chosen session before inspection. An interrupted inspection
            # reopens this exact session through the same original Store.
            atomic_json(index_path, record)
            evidence = None

        if evidence is None:
            request = Inspect.model_validate({"operation": "profile", "ref": revision_reference})
            evidence = engine.inspect(workspace, sid, request)
            if not _matches_evidence(evidence, revision_reference, source_sha256):
                raise IntelligenceError("The retained inspection does not match the saved source.", 409)
            engine.repo.assert_unchanged(workspace, source)
            record = {**record, "evidence_id": evidence["id"]}
            atomic_json(index_path, record)
        else:
            # Compare current bytes through the restored repository, while preserving
            # the historical evidence's original metadata and source identities.
            engine.repo.assert_unchanged(workspace, source)
        context = _diagnostic_context(engine, workspace, sid)
        if context is None:
            engine.store.event(workspace, sid, "diagnostic_context", {
                "diagnostic_id": diagnostic_id, "dataset_id": dataset_id,
                "report_dataset_id": revision_reference["id"],
                "source_sha256": source_sha256, "evidence_id": evidence["id"],
                "title": record["title"],
            })
        elif (context["report_dataset_id"] != revision_reference["id"]
                or context["source_sha256"] != source_sha256
                or context["evidence_id"] != evidence["id"]):
            raise IntelligenceError("The saved conversation belongs to another report revision.", 409)
        return {
            "kind": "diagnostic", "session_id": sid, "evidence_id": evidence["id"],
            "diagnostic_id": diagnostic_id, "dataset_id": dataset_id,
            "report_dataset_id": revision_reference["id"],
            "source_sha256": source_sha256, "association_member": member.as_posix(),
            "reopened": reopened,
        }
