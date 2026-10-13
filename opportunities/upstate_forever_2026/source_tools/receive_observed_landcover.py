#!/usr/bin/env python3
"""Receive original selected-HUC changes through the native queue, report and Workspace transport."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

APPLICATION = Path(__file__).resolve().parents[1]
for directory in (APPLICATION, APPLICATION / "operator"):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

from model.common import atomic_json, canonical, describe_file, digest, file_digest, read_json, verify_file
from model import observed_landcover, scientific_report_editions, portable
from server import Operator, Fault
from source_report_editions import ScientificReportEditions

SCHEMA = "upstate.selected-huc-native-receiving/v1"
DEFAULT_HUCS = ["030601010703", "030601010704", "030601020502", "030601020507"]


def required(condition, message):
    if not condition:
        raise ValueError(message)


def download(operator, ticket, destination=None):
    """Consume the actual original native ticket and independently hash its stream."""
    stream, item = operator.open_download(ticket["id"])
    checksum, count = hashlib.sha256(), 0
    pending = Path(str(destination) + ".partial") if destination else None
    target = None
    try:
        if pending:
            pending.parent.mkdir(parents=True, exist_ok=True)
            target = pending.open("wb")
        while block := stream.read(1024 * 1024):
            checksum.update(block)
            count += len(block)
            if target:
                target.write(block)
    finally:
        stream.close()
        if target:
            target.close()
    required(count == ticket["bytes"] == item["bytes"] and
             checksum.hexdigest() == ticket["sha256"] == item["sha256"],
             "Original native download differs from its retained ticket")
    if destination:
        destination = Path(destination)
        if destination.exists():
            required(destination.stat().st_size == count and file_digest(destination) == checksum.hexdigest(),
                     "Previously received output differs from the same native download")
            pending.unlink()
        else:
            pending.replace(destination)
    return {"filename": item["filename"], "bytes": count, "sha256": checksum.hexdigest(),
            **({"path": str(Path(destination).resolve())} if destination else {})}


def check_products(operator, workspace_key, selection_id, report_id):
    workspace = operator.ws(workspace_key)
    selected = observed_landcover.inspect(workspace, selection_id)
    edition, report = selected["edition"], selected["report"]
    public = operator.extensions.read("GET", "/api/observed-landcover/edition", workspace_key,
                                      {"id": selection_id})
    required(public["edition"]["id"] == selection_id, "Original desk cannot reopen the saved selection")
    native_report, report_directory, operation = scientific_report_editions.inspect(workspace, report_id)
    required(native_report["project_id"] == workspace.project["id"], "Saved report project differs")
    choices = native_report["render_identity"]["selection"]["source_roles"]["OBSERVED_CONTEXT"]
    required(choices == edition["source"], "Rendered report binds another selected-HUC source")
    report_adapter = ScientificReportEditions(operator, Fault)
    detail = report_adapter.detail(workspace_key, report_id)
    pdf = verify_file(report_directory, operation["files"]["report_pdf"])
    with pdf.open("rb") as source:
        required(source.read(5) == b"%PDF-", "The retained scientific report has no native PDF")
    pdf_ticket = next(row for row in detail["_downloads"] if row["sha256"] == operation["files"]["report_pdf"]["sha256"])
    pdf_received = download(operator, pdf_ticket)
    selection_ticket = next(row for row in public["_downloads"] if row["filename"] == "selected-huc-landcover.zip")
    source_received = download(operator, selection_ticket)
    # These are exact preserved original inputs, not new raster computations.
    required(len(report["summary"]["transitions"]) == 256
             and all(len(row["transitions"]) == 256 for row in report["watersheds"]),
             "The reopened comparison lost directional matrix rows")
    required(report["selection"]["huc12s"] == edition["huc12s"], "The reopened HUC selection differs")
    return {"project_id": workspace.project["id"], "workspace_key": workspace_key,
            "selection_id": selection_id, "scientific_report_edition_id": report_id,
            "huc12s": edition["huc12s"], "source": edition["source"],
            "source_binding": edition["observed_binding"],
            "summary": {name: report["summary"][name] for name in
                        (*observed_landcover.SUPPORT, "paired_valid_area_ha", "changed_area_ha",
                         "changed_percent_of_paired_valid")},
            "selection_zip": source_received, "report_pdf": pdf_received,
            "report_file_hashes": {key: item["sha256"] for key, item in operation["files"].items()},
            "selection_file_hashes": {key: item["sha256"] for key, item in edition["files"].items()},
            "native_report_sections": operation["section_count"]}


class Course:
    def __init__(self, path, configuration):
        self.path = path
        self.value = read_json(path) if path.exists() else {
            "schema": SCHEMA, "configuration": configuration, "phases": {}, "complete": False}
        required(self.value.get("schema") == SCHEMA and self.value.get("configuration") == configuration,
                 "Resume this original receiving course with its saved configuration")
        self.write()

    def write(self):
        atomic_json(self.path, self.value)

    def task(self, operator, workspace, phase, action, payload, *, timeout, resume_failed=False):
        frozen = json.loads(canonical(payload))
        wanted = {"workspace": workspace, "action": action, "payload": frozen}
        request = digest(wanted)
        original = self.value["phases"].get(phase)
        if original:
            required(original["request_sha256"] == request,
                     "A saved receiving phase has another original selection: " + phase)
        else:
            original = {"request_sha256": request, "request": wanted,
                        "operation_id": "huc-" + digest({"operation": self.value["configuration"]["operation_id"],
                                                      "phase": phase})[:56]}
            self.value["phases"][phase] = original
            self.write()
        if original.get("task_id"):
            task = operator.task(original["task_id"])
        else:
            task = operator.submit(workspace, action, frozen, original["operation_id"])
            # The native queue may coalesce an identical active request owned by
            # another operation. Preserve the actual accepted identity before waiting.
            original["task_id"] = task["id"]
            original["accepted_operation_id"] = task["operation_id"]
            self.write()
        required(task["workspace"] == workspace and task["action"] == action
                 and task["payload"] == frozen, "The original queue returned another receiving selection")
        if task["state"] == "interrupted" or (resume_failed and task["state"] in ("failed", "cancelled")):
            task = operator.resume(task["id"])
        deadline = time.monotonic() + timeout
        while task["state"] in ("queued", "running"):
            original["state"] = task["state"]
            self.write()
            if time.monotonic() >= deadline:
                raise TimeoutError("The original task remains " + task["state"] + ": " + task["id"])
            time.sleep(0.5)
            task = operator.task(task["id"])
        original["state"] = task["state"]
        if task["state"] != "complete":
            original["error"] = task.get("error")
            self.write()
            raise RuntimeError("Original " + phase + " task ended " + task["state"] + ": " + json.dumps(task.get("error")))
        if "result" in original:
            required(original["result"] == task["result"],
                     "The saved complete native result changed: " + phase)
        original["result"] = task["result"]
        original.pop("error", None)
        self.write()
        return task

    def application(self, current, *, reviewed_revision=None, resume_failed=False):
        """Retain explicit implementation repairs without changing scientific selection."""
        prior = self.value.get("application_files")
        history = self.value.setdefault("application_revisions", [])
        if prior is not None and not history:
            history.append({"revision": self.value["configuration"]["source_revision"],
                            "files": prior, "application_sha256": digest(prior), "kind": "original"})
        if prior is None:
            history.append({"revision": self.value["configuration"]["source_revision"],
                            "files": current, "application_sha256": digest(current),
                            "kind": "original"})
        elif prior != current:
            required(not self.value.get("complete") and resume_failed
                     and isinstance(reviewed_revision, str) and reviewed_revision.strip(),
                     "Resume the incomplete original course with --resume-failed and "
                     "--reviewed-source-revision naming the repaired source edition")
            revision = reviewed_revision.strip()
            required(not any(row["revision"] == revision and row["files"] != current for row in history),
                     "This reviewed source revision already identifies another implementation")
            history.append({"revision": revision, "files": current,
                            "application_sha256": digest(current), "kind": "implementation-repair",
                            "previous_application_sha256": digest(prior),
                            "retained_phases": {phase: {key: row.get(key) for key in
                                ("task_id", "operation_id", "accepted_operation_id", "state", "request_sha256")}
                                for phase, row in self.value["phases"].items()}})
        elif reviewed_revision:
            required(any(row["revision"] == reviewed_revision.strip() and row["files"] == current
                         for row in history),
                     "The reviewed revision must name the actual recorded implementation repair")
        self.value["application_files"] = current
        self.write()

    def report_payload(self, operator, workspace, payload, prepared, *, reviewed_revision=None):
        """Use the original request, or explicitly supersede an incomplete old preview."""
        phase = "scientific-report"
        original = self.value["phases"].get(phase)
        if not original:
            return {**payload, "preview_id": prepared["id"]}
        saved = original["request"]
        required(saved["workspace"] == workspace and saved["action"] == "source-reports.render"
                 and {key: value for key, value in saved["payload"].items() if key != "preview_id"} == payload,
                 "The original scientific report phase has another source selection or title")
        if saved["payload"]["preview_id"] == prepared["id"]:
            return saved["payload"]
        if original.get("task_id"):
            task = operator.task(original["task_id"])
        else:
            # Reconcile a lost original admission before considering another preview.
            task = operator.submit(workspace, saved["action"], saved["payload"], original["operation_id"])
            original.update(task_id=task["id"], accepted_operation_id=task["operation_id"])
            self.write()
        required(task["workspace"] == workspace and task["action"] == saved["action"]
                 and task["payload"] == saved["payload"], "The original report task selection changed")
        output = scientific_report_editions.directory(operator.ws(workspace), saved["payload"]["preview_id"])
        if task["state"] in ("complete", "queued", "running") or (output / "operation.json").is_file():
            # Completed native effects are reconciled by the original report renderer.
            return saved["payload"]
        required(task["state"] in ("failed", "interrupted", "cancelled"),
                 "Resolve the original native report task before reviewing its successor")
        history = self.value.get("application_revisions", [])
        required(reviewed_revision and history and history[-1]["kind"] == "implementation-repair"
                 and history[-1]["revision"] == reviewed_revision.strip()
                 and history[-1]["files"] == self.value["application_files"],
                 "The renderer changed before completing this report; resume with its recorded "
                 "--reviewed-source-revision and --resume-failed")
        # The source/title/contact are unchanged. The renderer's new preview is the
        # authority for a new report identity; the prior request/task remain intact.
        old = {**original, "state": task["state"], "error": task.get("error")}
        predecessors = list(old.pop("predecessors", []))
        predecessors.append(old)
        replacement = {**payload, "preview_id": prepared["id"]}
        wanted = {"workspace": workspace, "action": saved["action"], "payload": replacement}
        operation_id = "huc-" + digest({
            "operation": self.value["configuration"]["operation_id"], "phase": phase,
            "reviewed_preview_id": prepared["id"], "source_revision": reviewed_revision.strip()})[:56]
        self.value["phases"][phase] = {
            "request_sha256": digest(wanted), "request": wanted, "operation_id": operation_id,
            "predecessors": predecessors, "repair": {
                "source_revision": reviewed_revision.strip(), "previous_preview_id": saved["payload"]["preview_id"],
                "reviewed_preview_id": prepared["id"], "previous_task_id": task["id"],
                "scientific_sources": payload["sources"], "title": payload["title"]}}
        self.write()
        return replacement


def original_source_intake(args, course):
    """Bind explicit existing sources without changing the original course configuration."""
    manifest = getattr(args, "source_manifest", None)
    collection_id = getattr(args, "source_collection_id", None)
    analysis_id = getattr(args, "analysis_source_id", None)
    requested = None
    if manifest:
        manifest = manifest.resolve(strict=True)
        required(manifest.is_file(), "Choose the original source manifest file")
        requested = {"mode": "registered-manifest", "manifest": {
            "path": str(manifest), "bytes": manifest.stat().st_size, "sha256": file_digest(manifest)}}
    elif collection_id:
        requested = {"mode": "existing-collection", "source_collection_id": collection_id}
    if requested is not None and analysis_id:
        requested["analysis_source_id"] = analysis_id
    saved = course.value.get("original_source_intake")
    if saved:
        required(isinstance(saved, dict) and isinstance(saved.get("request"), dict),
                 "The original source-intake record is incomplete")
        if requested is not None:
            required(saved["request"] == requested, "Resume with the same original source-intake choice")
        return saved["request"]
    if requested is not None:
        required(not course.value["phases"].get("original-source-import")
                 and not course.value["phases"].get("selected-comparison")
                 and not course.value.get("native_products"),
                 "Keep the original accepted import/selection; explicit intake must precede its admission")
        course.value["original_source_intake"] = {"request": requested}
        course.write()
    return requested


def registered_manifests(intake, course):
    """Register only an unfinished original manifest import; retained sources reopen independently."""
    if not intake or intake["mode"] != "registered-manifest":
        return ()
    phase = course.value["phases"].get("original-source-import")
    if phase and phase.get("state") == "complete" and "result" in phase:
        return ()
    original = intake["manifest"]
    path = Path(original["path"]).resolve(strict=True)
    required(path.is_file() and path.stat().st_size == original["bytes"]
             and file_digest(path) == original["sha256"],
             "The original staged source manifest changed before its import completed")
    return (path,)


def select_original_source(operator, workspace_key, intake, course, task):
    if intake is None:
        return task("original-source-import", "observed.landcover.import", {})["result"]
    if intake["mode"] == "registered-manifest":
        prior = course.value["phases"].get("original-source-import")
        if prior:
            required(prior["request"]["action"] == "source.import",
                     "The retained source-intake phase uses another original action")
            payload = prior["request"]["payload"]
        else:
            original = intake["manifest"]
            matches = [item for item in operator.registered.values()
                       if item["path"] == original["path"] and item["sha256"] == original["sha256"]]
            required(len(matches) == 1, "Register the exact original staged manifest before import")
            preview = operator.preview_source({"registered_id": matches[0]["id"]})
            payload = {"preview_id": preview["id"]}
        collection = task("original-source-import", "source.import", payload)["result"]
        collection_id = collection["id"]
    else:
        required(intake["mode"] == "existing-collection", "Unknown original source-intake mode")
        collection_id = intake["source_collection_id"]
    candidates = [row for row in observed_landcover.catalog(operator.ws(workspace_key))["sources"]
                  if row["source_collection_id"] == collection_id
                  and (not intake.get("analysis_source_id")
                       or row["analysis_source_id"] == intake["analysis_source_id"])]
    required(len(candidates) == 1,
             "Choose the unique original analysis-run source in the exact imported collection; "
             "use --analysis-source-id when that collection contains several analyses")
    choice = {name: candidates[0][name] for name in
              ("source_collection_id", "analysis_source_id", "analysis_sha256")}
    saved = course.value["original_source_intake"].get("selection")
    required(saved is None or saved == choice, "The retained original source-intake identity changed")
    return choice


def cold_reopen(args):
    required(args.selection_id and args.report_id and args.expected_project_id,
             "Cold reopening needs the actual saved selection, report and project identities")
    operator = Operator(args.workspace, args.state_directory)
    try:
        required(operator.ws(operator.primary).project["id"] == args.expected_project_id,
                 "The restored application opened another project")
        operator.extensions.verify_workspace(operator.ws(operator.primary))
        result = check_products(operator, operator.primary, args.selection_id, args.report_id)
        result["application"] = str(APPLICATION.resolve())
        result["application_model_sha256"] = file_digest(APPLICATION / "model/observed_landcover.py")
        atomic_json(args.output / "cold-reopen.json", result)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    finally:
        operator.close()


def run(args):
    args.output.mkdir(parents=True, exist_ok=True)
    if args.cold_reopen:
        return cold_reopen(args)
    if args.recipient_handover:
        from source_tools.receive_observed_landcover_study import run_recipient_handover
        return run_recipient_handover(args)
    if args.selected_study:
        from source_tools.receive_observed_landcover_study import run_selected_study
        return run_selected_study(args)
    configuration = {
        "operation_id": args.operation_id, "application": str(APPLICATION.resolve()),
        "workspace": str(args.workspace.resolve()), "state_directory": str(args.state_directory.resolve()),
        "huc12s": sorted(args.huc12 or DEFAULT_HUCS), "title": args.title,
        "source_revision": args.source_revision,
    }
    required(len(configuration["huc12s"]) == len(set(configuration["huc12s"])), "Select each original HUC once")
    course = Course(args.output / "selected-huc-receiving.json", configuration)
    intake = original_source_intake(args, course)
    app_members = ("model/observed_landcover.py", "model/observed_landcover_report.py",
                   "model/observed_landcover_provenance.py", "CURRENT_OWNER_DIRECTION.md", "AGENTS.md",
                   "operator/observed_landcover_operator.py",
                   "operator/extensions/observed-landcover.json", "operator/web/observed_landcover.mjs",
                   "operator/source_report_editions.py", "model/scientific_report_editions.py",
                   "model/observed_report_render.py", "model/observed_context.py",
                   "model/scientific_report.py", "model/scientific_figures.py",
                   "model/landcover_report_source.py", "model/reuse.py", "model/workspace.py",
                   "operator/server.py", "operator/extension_registry.py",
                   "source_tools/receive_observed_landcover.py")
    if intake is None:
        app_members += ("observations/landcover_2023_2025/model-sources.json",)
    current_application = {name: describe_file(APPLICATION, APPLICATION / name) for name in app_members}
    for name in ("model/scientific_map_figures.py",):
        if (APPLICATION / name).is_file():
            current_application[name] = describe_file(APPLICATION, APPLICATION / name)
    course.application(current_application, reviewed_revision=args.reviewed_source_revision,
                       resume_failed=args.resume_failed)
    operator = None
    try:
        operator = Operator(args.workspace, args.state_directory, create=args.create, title=args.title,
                            restore_directory=args.restore_directory,
                            source_manifests=registered_manifests(intake, course))
        key = operator.primary
        project = operator.ws(key).project["id"]
        required(course.value.get("project_id", project) == project, "The original receiving project changed")
        course.value.update(project_id=project, original_workspace_key=key)
        course.write()
        actions = ("observed.landcover.save", "source-reports.render", "source-reports.export")
        if intake is None:
            actions += ("observed.landcover.import",)
        for action in actions:
            required(operator.extensions.handles_action(action), "The current original operator has not registered " + action)
        def task(phase, action, payload):
            return course.task(operator, key, phase, action, payload, timeout=args.timeout_seconds,
                               resume_failed=args.resume_failed)
        imported = select_original_source(operator, key, intake, course, task)
        inputs = operator.extensions.read("POST", "/api/observed-landcover/inputs", key, {"selection": imported})
        if intake is not None:
            # The maintained reader verifies every original result, grid, domain and matrix before publication.
            course.value["original_source_intake"]["selection"] = imported
            course.write()
        available = {row["huc12"] for row in inputs["watersheds"]}
        required(set(configuration["huc12s"]) <= available, "Selected HUCs are absent from the actual native original inventory")
        selection = {**imported, "huc12s": configuration["huc12s"], "title": args.title}
        selected_task = task("selected-comparison", "observed.landcover.save", selection)
        edition = selected_task["result"]
        selected = observed_landcover.inspect(operator.ws(key), edition["id"])
        required(selected["report"]["selection"]["huc12s"] == configuration["huc12s"],
                 "The completed original comparison differs from the receiving selection")
        source_payload = {"sources": [edition["source"]], "title": args.title}
        report_adapter = ScientificReportEditions(operator, Fault)
        prepared = report_adapter.preview(key, source_payload)
        source_payload = course.report_payload(operator, key, source_payload, prepared,
                                               reviewed_revision=args.reviewed_source_revision
                                               if args.resume_failed else None)
        report_task = task("scientific-report", "source-reports.render", source_payload)
        report_id = report_task["result"]["scientific_report_edition_id"]
        exported_task = task("scientific-report-export", "source-reports.export", {"id": report_id})
        current_products = check_products(operator, key, edition["id"], report_id)
        prior_products = course.value.get("native_products")
        if prior_products:
            for name in ("project_id", "selection_id", "scientific_report_edition_id", "huc12s",
                         "source", "source_binding", "summary", "report_file_hashes", "selection_file_hashes"):
                required(prior_products[name] == current_products[name],
                         "A completed original scientific product changed during recovery: " + name)
        course.value["native_products"] = current_products
        products = operator.task_view(selected_task["id"])["_downloads"]
        selected_zip = next(row for row in products if row["filename"] == "selected-huc-landcover.zip")
        course.value["comparison_download"] = download(operator, selected_zip, args.output / "selected-huc-landcover.zip")
        course.value["report_download"] = download(operator, exported_task["result"]["download"],
                                                  args.output / "selected-huc-scientific-report.zip")
        report_detail = report_adapter.detail(key, report_id)
        pdf_ticket = next(row for row in report_detail["_downloads"] if row["filename"] == "report.pdf")
        course.value["pdf_download"] = download(operator, pdf_ticket, args.output / "selected-huc-scientific-report.pdf")
        course.write()
        backup_task = task("workspace-backup", "workspace.backup", {"include_intermediates": False})
        backup_result = backup_task["result"]
        archive_path = Path(backup_result["path"])
        backup_ticket = operator.task_view(backup_task["id"])["_downloads"][0]
        course.value["backup_download"] = download(operator, backup_ticket)
        original_manifest = portable.inspect_archive(archive_path, verify=True)
        required(original_manifest["project"]["id"] == project, "Native Workspace archive has another project identity")
        # Receive the actual native ticket stream through the existing upload CAS.
        archive_stream, archive_item = operator.open_download(backup_ticket["id"])
        try:
            upload = operator.receive_upload(archive_stream, archive_item["bytes"], archive_item["filename"], "application/zip")
        finally:
            archive_stream.close()
        required(upload["sha256"] == backup_result["sha256"], "Received native archive differs from the original backup")
        received_task = task("workspace-restore", "workspace.restore", {"upload_id": upload["id"]})
        received = received_task["result"]
        required(received["identity"] == "MATCH" and received["project"]["id"] == project,
                 "Original Workspace restoration did not preserve project identity")
        restored_key = received["workspace_key"]
        restored = check_products(operator, restored_key, edition["id"], report_id)
        for name in ("huc12s", "source", "source_binding", "summary", "report_file_hashes", "selection_file_hashes"):
            required(restored[name] == course.value["native_products"][name], "Restored original product differs: " + name)
        course.value["restore"] = {"result": received, "products": restored, "upload": upload}
        course.write()
        operator.close()
        operator = None
        # Original task registry and restored Workspace must survive an operator restart.
        operator = Operator(args.workspace, args.state_directory, restore_directory=args.restore_directory)
        restarted = check_products(operator, restored_key, edition["id"], report_id)
        required(restarted["selection_file_hashes"] == restored["selection_file_hashes"]
                 and restarted["report_file_hashes"] == restored["report_file_hashes"],
                 "Restarted native files differ")
        for phase in course.value["phases"].values():
            saved = operator.task_view(phase["task_id"])
            required(saved["state"] == "complete" and saved["payload"] == phase["request"]["payload"],
                     "The original completed queue operation did not reopen")
        for phase in course.value["phases"].values():
            for prior in phase.get("predecessors", []):
                saved = operator.task(prior["task_id"])
                required(saved["workspace"] == prior["request"]["workspace"]
                         and saved["action"] == prior["request"]["action"]
                         and saved["payload"] == prior["request"]["payload"]
                         and saved["operation_id"] == prior["accepted_operation_id"],
                         "The earlier reviewed report attempt did not retain its original native request")
        course.value["restart"] = restarted
        course.write()
        operator.close()
        operator = None
        restored_application = Path(received["application"]).resolve(strict=True)
        restored_driver = restored_application / "source_tools/receive_observed_landcover.py"
        required(restored_driver.is_file(), "The complete restored application did not retain this native receiver")
        cold_output = args.output / "cold"
        cold_output.mkdir(exist_ok=True)
        command = [sys.executable, str(restored_driver), "--workspace", received["workspace"],
                   "--state-directory", str(args.output / "cold-operator-state"), "--output", str(cold_output),
                   "--cold-reopen", "--selection-id", edition["id"], "--report-id", report_id,
                   "--expected-project-id", project]
        course.value["cold_command"] = command
        course.write()
        result = subprocess.run(command, cwd=restored_application, capture_output=True, text=True,
                                timeout=args.timeout_seconds, check=False)
        (args.output / "cold-stdout.json").write_text(result.stdout, encoding="utf-8")
        (args.output / "cold-stderr.txt").write_text(result.stderr, encoding="utf-8")
        required(result.returncode == 0, "The actual restored application failed cold reopening: " + result.stderr[-4000:])
        cold = read_json(cold_output / "cold-reopen.json")
        required(cold["application"] == str(restored_application)
                 and cold["selection_file_hashes"] == restored["selection_file_hashes"]
                 and cold["report_file_hashes"] == restored["report_file_hashes"]
                 and cold["application_model_sha256"] == current_application["model/observed_landcover.py"]["sha256"],
                 "Actual restored application/product identities differ")
        course.value.update(cold_reopen=cold, complete=True)
        course.value.pop("error", None)
        course.write()
        print(json.dumps(course.value, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Exception as error:
        course.value.update(complete=False, error={"type": type(error).__name__, "message": str(error)})
        course.write()
        raise
    finally:
        if operator is not None:
            operator.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--state-directory", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--restore-directory", type=Path)
    parser.add_argument("--create", action="store_true", help="Create this receiving Workspace if it does not yet exist")
    parser.add_argument("--operation-id", default="ECO-264B-SELECTED-HUC-20261013")
    parser.add_argument("--source-revision", default="installed-current-application")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--source-manifest", type=Path,
                        help="Register and queue-import an already staged original source manifest")
    source.add_argument("--source-collection-id",
                        help="Use this existing original source collection in the receiving Workspace")
    parser.add_argument("--analysis-source-id",
                        help="Exact analysis-run source ID when the chosen manifest/collection has several analyses")
    parser.add_argument("--huc12", action="append", help="Actual original HUC12; repeat for selected watersheds")
    parser.add_argument("--title", default="Selected Upper Savannah watershed annual land-cover changes")
    parser.add_argument("--timeout-seconds", type=float, default=1800)
    parser.add_argument("--resume-failed", action="store_true", help="Resume the saved course after repairing its failed phase")
    parser.add_argument("--reviewed-source-revision",
                        help="Reviewed repaired implementation revision; keeps original selection, task and product history")
    parser.add_argument("--recipient-handover", action="store_true",
                        help="Receive the complete recipient package for the completed original comparison/report")
    parser.add_argument("--selected-study", action="store_true",
                        help="Continue the completed original selection/report through editable selected-Study receiving")
    parser.add_argument("--cold-reopen", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--selection-id", help=argparse.SUPPRESS)
    parser.add_argument("--report-id", help=argparse.SUPPRESS)
    parser.add_argument("--expected-project-id", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    required(not (args.recipient_handover and (args.selected_study or args.cold_reopen)),
             "Choose one original receiving continuation at a time")
    required(not args.analysis_source_id or args.source_manifest or args.source_collection_id,
             "--analysis-source-id requires an explicit original source manifest or collection")
    required(not (args.source_manifest or args.source_collection_id) or not (
        args.selected_study or args.recipient_handover or args.cold_reopen),
        "The completed Study/handover/reopen continuations retain their original source; "
        "use explicit intake only for the initial comparison/report course")
    required(args.timeout_seconds > 0, "Use a positive original task timeout")
    return run(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, RuntimeError, TimeoutError) as error:
        print(json.dumps({"error": {"type": type(error).__name__, "message": str(error)}}), file=sys.stderr)
        raise SystemExit(1)
