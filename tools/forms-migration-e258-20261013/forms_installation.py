"""Read-only Forms project to native Customer Installation preparation.

The original Forms verifier/archive contract and original Operations writer
remain authoritative. Large originals stay in the complete Forms handover;
this small source selection is explicitly not a substitute for that archive.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import zipfile

import forms_workbench as forms

SCHEMA = "tjlabs.forms-workspace.installation-source.v1"
PREPARATION = "tjlabs.forms-workspace.installation-preparation.v1"
MAX_SOURCE = 8 * 1024 * 1024
SHA = re.compile(r"[a-f0-9]{64}")
SOURCE_ID = re.compile(r"source-[a-f0-9]{32}")
CLASSES = ("definitions", "settings", "responses", "uploads", "workflow", "downstream")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def identity(value, label):
    require(isinstance(value, str) and SHA.fullmatch(value) is not None, "Keep the exact " + label + " SHA-256.")
    return value


def _regular(path):
    path = Path(path).absolute()
    value = path.lstat()
    require(stat.S_ISREG(value.st_mode) and not path.is_symlink(), "Select a complete regular original file.")
    return path


def _stable_stat(value):
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def inspect_project(project_directory, archive_path, workspace_binding):
    """Verify complete original project/archive; return a portable selection.

    workspace_binding must come from the caller's actual retained Workspace
    read under its original operation lease. It is retained in full, never
    inferred from a path or replaced by the current/latest selection.
    """
    require(isinstance(workspace_binding, dict) and bool(workspace_binding),
            "Select the exact retained workspace/run binding.")
    binding = json.loads(canonical(workspace_binding))
    requested = Path(project_directory).absolute()
    require(not requested.is_symlink(), "Select the original physical project directory.")
    root, result = forms.verify_project(requested)
    original_intake = forms.parse_json_bytes((root / "intake.original.json").read_bytes())
    archive_path = _regular(archive_path)
    project_entries = {}
    for entry in forms.inventory_files(root, exclude=("archive-manifest.json",)):
        if not entry["path"].startswith("workbench/"):
            project_entries[entry["path"]] = entry
    for entry in result["source_files"]:
        name = "workbench/" + entry["path"]
        project_entries[name] = dict(entry, path=name)
    fd = os.open(archive_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), "Select the complete original project ZIP.")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            archive_hash = hashlib.sha256()
            while True:
                block = stream.read(1024 * 1024)
                if not block:
                    break
                archive_hash.update(block)
            stream.seek(0)
            with zipfile.ZipFile(stream) as archive:
                members, declaration, entries = forms.archive_members(archive)
                require(declaration["project_identity"] == result["project_identity"],
                        "The selected ZIP belongs to another original project.")
                require(entries == project_entries,
                        "The complete ZIP member declaration differs from the selected original project and source.")
                for member in members:
                    if member.filename == "archive-manifest.json":
                        continue
                    h, count = hashlib.sha256(), 0
                    with archive.open(member) as body:
                        while True:
                            block = body.read(1024 * 1024)
                            if not block:
                                break
                            h.update(block)
                            count += len(block)
                            require(count <= member.file_size, "An original ZIP member exceeds its declared size.")
                    expected = entries[member.filename]
                    require(count == expected["bytes"] and h.hexdigest() == expected["sha256"],
                            "The complete project ZIP member differs: " + member.filename)
            after = os.fstat(fd)
            named = archive_path.lstat()
            require(_stable_stat(before) == _stable_stat(after) and
                    (named.st_dev, named.st_ino) == (after.st_dev, after.st_ino),
                    "The selected project ZIP changed during full verification.")
        # Reverify after the streamed archive read. The caller also retains the
        # original Workspace lease throughout selection and preparation.
        _, later = forms.verify_project(root)
        require(canonical(later) == canonical(result), "The original project changed during preparation.")
        current_entries = {x["path"]: x for x in forms.inventory_files(root, exclude=("archive-manifest.json",))
                           if not x["path"].startswith("workbench/")}
        require(current_entries == {k: v for k, v in project_entries.items() if not k.startswith("workbench/")},
                "The complete original project inventory changed during preparation.")
        selected = {
            "schema": SCHEMA,
            "workspace": binding,
            "project": {
                "identity": result["project_identity"], "label": result["label"],
                "edition": result["edition"], "data_class": result["data_class"],
                "interpretation_reference": original_intake["interpretation_reference"],
                "source_run_identity": result["migration"]["source_run_identity"],
                "migration_selection_sha256": result["migration"]["selection_sha256"],
                "result": {"path": "result.json", "bytes": (root/"result.json").stat().st_size,
                           "sha256": forms.file_digest(root/"result.json")},
                "delivery": {"path": "delivery.json", "bytes": (root/"delivery.json").stat().st_size,
                             "sha256": forms.file_digest(root/"delivery.json")},
                "classes": deepcopy(result["classes"]),
                "assets": deepcopy(result["assets"]), "attachments": deepcopy(result["attachments"]),
                "findings": deepcopy(result["findings"]), "migration": deepcopy(result["migration"])
            },
            "archive": {"filename": archive_path.name, "bytes": before.st_size,
                        "sha256": archive_hash.hexdigest(), "members": len(members),
                        "complete": True},
            "application": {"files": deepcopy(result["source_files"]),
                            "selection_sha256": digest(canonical(result["source_files"]).encode("utf-8"))},
            "meaning": "This is the exact native selection and complete handover identity. Original files, results and application source remain in the separately retained full project ZIP. This selection does not itself contain those originals.",
            "acceptance": "Native comparisons, source availability and coverage remain separate. No vendor import, live workflow replay, human acceptance, commercial agreement or payment is inferred."
        }
        require(len(canonical(selected).encode("utf-8")) <= MAX_SOURCE,
                "The complete source selection exceeds its supported native attachment extent.")
        return selected
    finally:
        os.close(fd)


def source_bytes(selection):
    require(isinstance(selection, dict) and selection.get("schema") == SCHEMA,
            "Use the complete verified Forms Installation source.")
    raw = (json.dumps(selection, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")
    require(len(raw) <= MAX_SOURCE, "Retain the complete Forms selection within its declared size.")
    return raw



def inspect_workspace(workspace, run_id):
    """Read and verify one existing immutable run under its original owner.

    The caller passes the already-owned Workspace, never a browser-supplied
    host path. Later unrelated draft revisions do not change this selection.
    """
    with workspace.mutex:
        described = workspace.dispatch("workspace.describe")
        run_response = workspace.dispatch("run.show", {"run_id": run_id})
        run = run_response["value"]
        workspace_id = described["workspace_id"]
        require(run_response["workspace_id"] == workspace_id,
                "The selected run belongs to another original workspace.")
        original = workspace.dispatch("request.show", {"request_id": run["original_request_id"]})["value"]
        require(original["method"] == "run.create" and original["status"] == "COMPLETE",
                "Recover the original native run request before selecting its Installation source.")
        receipt = original["result"]
        require(receipt["workspace_id"] == workspace_id and canonical(receipt["value"]) == canonical(run),
                "The saved run differs from its exact original completed request.")
        draft = workspace.dispatch("draft.show", {"draft_id": run["draft_id"],
                                   "revision": run["draft_revision"]})["value"]
        capture = workspace.dispatch("capture.show", {"capture_id": run["capture_id"]})["value"]
        require(draft["capture_id"] == capture["id"] and
                digest(draft["raw"].encode("utf-8")) == run["project_identity"],
                "The saved native run no longer binds its exact original draft and captured source.")
        require(original["params"] == {"draft_id": run["draft_id"], "expected_revision": run["draft_revision"]},
                "The selected run's original request parameters differ.")
        selected = {
            "schema": "tjlabs.forms-workspace.selected-run.v1",
            "workspace_id": workspace_id,
            "run_id": run["id"],
            "draft_id": run["draft_id"],
            "draft_revision": run["draft_revision"],
            "capture_id": capture["id"],
            "capture_selection_sha256": capture["selection_sha256"],
            "original_request_id": run["original_request_id"],
            "original_workspace_revision": receipt["workspace_revision"],
            "project_identity": run["project_identity"],
            "source_run_identity": run["source_run_identity"],
            "project_archive": {k: run["archive"][k] for k in ("bytes", "sha256")},
            "workspace_source_files": deepcopy(described["value"]["source_files"])
        }
        project = workspace.root / forms.relative(run["project"])
        current = workspace.root
        for part in forms.relative(run["project"]).parts:
            current = current / part
            require(current.is_dir() and not current.is_symlink(),
                    "The selected original native project directory changed.")
        archive = forms.regular_under(workspace.root, run["archive"]["path"])
        result = inspect_project(project, archive, selected)
        require(result["project"]["identity"] == run["project_identity"] and
                result["project"]["source_run_identity"] == run["source_run_identity"] and
                {k: result["archive"][k] for k in ("bytes", "sha256")} == selected["project_archive"],
                "The verified project/archive differs from the original selected run.")
        return result


def prepare_operations(operations, case_id, body, *, workspace, run_id):
    """Prepare the original Installation from an actual Workspace-owned run.

    No side effect is performed. Call the original Operations.command with
    the exact returned save only after explicit operator selection.
    """
    with workspace.mutex:
        selected = inspect_workspace(workspace, run_id)
        return _prepare_operations(operations, case_id, body, selected)

def _prepare_operations(operations, case_id, body, selected):
    """Read-only native preparation. Never opens another case or saves it.

    The public wrapper retains the original Workspace lease while obtaining
    this exact selected native run. Attach source_bytes(inspect_workspace(...))
    through the original Operations source.add before this preparation.
    """
    import operations_installations as installations
    import operations_workshare_installations as workshares

    allowed = {"expectedVersion", "sourceId", "expectedSourceSha256",
               "installationId", "expectedRevision", "document"}
    require(isinstance(body, dict) and not set(body) - allowed,
            "Use the complete original Installation preparation request.")
    source_id = body.get("sourceId")
    require(isinstance(source_id, str) and SOURCE_ID.fullmatch(source_id),
            "Select the retained original Forms source attachment.")
    expected_source = identity(body.get("expectedSourceSha256"), "Forms selection")
    with operations._snapshot():
        context = operations._context(case_id)
        installations._current(context, body.get("expectedVersion"))
        metadata, raw = operations.source(case_id, source_id)
        require(metadata["sha256"] == expected_source and len(raw) == metadata["bytes"] and
                digest(raw) == expected_source, "The attached original Forms selection changed.")
        require(len(raw) <= MAX_SOURCE, "The complete Forms source attachment exceeds its declared extent.")
        try:
            retained = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError) as error:
            raise ValueError("Receive the complete original Forms source selection.") from error
        require(canonical(retained) == canonical(selected),
                "The attached selection does not bind this exact complete workspace, project and archive.")
        ident, revision = body.get("installationId"), body.get("expectedRevision", 0)
        if body.get("document") is not None:
            document = installations.normalized(context, body["document"])
        elif ident is not None:
            previous = installations.get(operations, case_id, ident)
            require(previous["revision"] == revision, "Reopen the actual current Installation edition.")
            document = deepcopy(previous["preview"]["document"])
        else:
            require(revision == 0, "A new original Installation starts at revision zero.")
            document = installations.seed(context)
        # Preserve actual commercial terms/payment/deployments and any existing
        # native Workshare binding; no fictitious zero-fee Workshare is created.
        if document.get("workshare"):
            workshares.verify_document(operations, context, document)
        project, archive = selected["project"], selected["archive"]
        source = document["source"]
        source["sourceIds"] = list(dict.fromkeys([*source["sourceIds"], source_id]))
        source["mode"] = "MIXED" if source["mode"] in ("LIVE", "MIXED") else "SNAPSHOT"
        def append_source(key, value):
            original_text = source[key]
            if value not in original_text.split("\n\n"):
                source[key] = original_text + ("\n\n" if original_text else "") + value
        append_source("reference", "Forms project " + project["identity"] + " / complete ZIP " + archive["sha256"])
        population = ("Complete selected " + str(project["assets"]["count"]) +
            " original assets; " + str(project["attachments"]["count"]) + " explicit attachment entries; " +
            str(project["migration"]["comparison_records"]) + " original comparison records. " +
            "All six original class dispositions and coverage remain in the retained selection and full project.")
        append_source("population", population)
        append_source("meaning", "Forms project " + project["identity"] + ": original intake, declared table keys/types/crosswalks, field semantics, attachment parent records and byte identities remain authoritative. " +
            "Interpretation: " + str(project["interpretation_reference"]))
        document["receiving"]["sourceIds"] = list(dict.fromkeys([*document["receiving"]["sourceIds"], source_id]))
        if not document["receiving"]["application"]:
            document["receiving"]["application"] = "Forms source-selection workspace and original Forms reconciliation inspector"
        if not document["receiving"]["recovery"]:
            document["receiving"]["recovery"] = ("Reopen the exact complete Forms workspace and selected project ZIP; verify all original members and application sources. " +
                "Recover the original saved run and request before issuing any new action.")
        if not document["task"]["name"]:
            document["task"]["name"] = str(project["label"])[:300]
        if not document["task"]["completeOutput"]:
            document["task"]["completeOutput"] = "Complete selected original sources, mapping decisions, all reconciliation/attachment findings, original application source and independently reopenable full workspace/project archives."
        # A later project gets new required source-bound checks. Prior checks and
        # their actual observations remain unchanged in this document/history.
        prefix = "forms-" + digest(canonical(selected).encode("utf-8"))[:32] + "-"
        existing = {x["id"]: x for x in document["checks"]}
        checks = [
            ("sources", "Complete selected source and scope", "Inspect every selected original and each of the six asset-class dispositions, availability, content state and unexamined-asset findings."),
            ("mapping", "Original mapping and source interpretation", "Review exact tables, keys, crosswalks, fields, units/nulls and attachment parent records against the retained original sources."),
            ("results", "Complete native comparison findings", "Inspect the full selected comparison and attachment populations, unresolved rows and unknown coverage; retain explicit owner dispositions without inferring vendor or customer acceptance."),
            ("receiving", "Independent complete receiving", "Open the exact complete project/workspace archives with all original bodies and source, inspect actual rendered outputs and preserve original native request/history on cold reopen.")
        ]
        for suffix, title, criterion in checks:
            check_id = prefix + suffix
            if check_id in existing:
                old = existing[check_id]
                require(old["title"] == title and old["criterion"] == criterion and old["required"] is True and source_id in old["sourceIds"],
                        "An existing acceptance identity belongs to another source selection.")
                continue
            document["checks"].append({"id": check_id, "title": title, "criterion": criterion,
                "tranche": None, "required": True, "state": "OPEN", "operator": "",
                "observedAt": None, "note": "Prepared from original Forms project " + project["identity"] +
                ". Actual observations remain the selected operator's responsibility.",
                "sourceIds": [source_id], "workIds": [], "purchaseIds": [], "outcomeIds": []})
        document = installations.normalized(context, document)
        preview = installations.preview(operations, context, {
            "expectedVersion": body["expectedVersion"], "installationId": ident,
            "expectedRevision": revision, "document": document})
        return {"schema": PREPARATION, "forms": selected, "source": metadata,
                "nativePreview": preview, "save": {"action": "installation.save",
                    "expectedVersion": body["expectedVersion"], "data": {
                        "installationId": ident, "expectedRevision": revision,
                        "document": document, "expectedPreviewSha256": preview["previewSha256"]}},
                "meaning": "Read-only preparation. The original Operations command and its exact actor/request/note perform any later explicit save. Original acceptance and payment remain unchanged."}
