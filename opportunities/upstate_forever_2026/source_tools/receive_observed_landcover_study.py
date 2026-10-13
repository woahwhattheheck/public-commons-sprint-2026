"""Continue the existing selected-HUC course through an editable selected Study.

The original comparison and scientific report are reused. The existing operator
queue, selected-Study archive, upload and Workspace restore remain authoritative.
"""
from __future__ import annotations

import argparse
import json
import os
from copy import deepcopy
from pathlib import Path
import subprocess
import sys

APPLICATION = Path(__file__).resolve().parents[1]
for directory in (APPLICATION, APPLICATION / "operator"):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

from model.common import atomic_json, describe_file, digest, read_json
from model import observed_landcover, study_transfer
from server import Operator
from source_tools.receive_observed_landcover import Course, check_products, download, required

SCHEMA = "upstate.selected-huc-study-continuation/v1"
PRODUCT_FIELDS = ("project_id", "selection_id", "scientific_report_edition_id", "huc12s",
                  "source", "source_binding", "summary", "report_file_hashes",
                  "selection_file_hashes")


def _check(operator, workspace_key, selection_id, report_id, study_id=None):
    workspace = operator.ws(workspace_key)
    products = check_products(operator, workspace_key, selection_id, report_id)
    saved = observed_landcover.inspect(workspace, selection_id)
    # Reopen the actual original inputs as well as the contained report files.
    # This validates the native desk's editable source binding after relocation.
    original = observed_landcover.load_inputs(workspace, saved["report"]["selection"])
    required(original["binding"] == saved["report"]["binding"],
             "Received native selected-HUC inputs differ from the saved comparison")
    if study_id is not None:
        received = study_transfer.verify_received_studies(workspace)
        matches = [row for row in received if row["id"] == study_id]
        required(len(matches) == 1 and matches[0]["identity"] == "MATCH",
                 "The received selected Study lost its original dependency closure")
        products["selected_study"] = matches[0]
        detail = operator.extensions.read("GET", "/api/study-transfer/received-detail",
                                          workspace_key, {"study_id": study_id})
        cards = [row for row in detail.get("observed_landcover_sources", [])
                 if row.get("selection_id") == selection_id and row.get("source") == saved["edition"]["source"]]
        required(detail.get("id") == study_id and detail.get("workspace_key") == workspace_key
                 and len(cards) == 1 and (cards[0].get("native") or {}).get("id") == selection_id
                 and cards[0]["selection"] == saved["report"]["selection"],
                 "The received Study source card lost its exact editable comparison")
        card = cards[0]
        required(all(card["summary"].get(name) == value for name, value in products["summary"].items()),
                 "The received Study source card changed original support or quantities")
        ticket = next(row for row in card["native"]["_downloads"]
                      if row["filename"] == "selection.json")
        received_selection = download(operator, ticket)
        required(received_selection["sha256"] == saved["edition"]["files"]["selection.json"]["sha256"],
                 "The received source card downloads another saved comparison")
        products["receiving_view"] = {"study_id": study_id, "selection_id": selection_id,
                                      "source": card["source"], "huc12s": card["selection"]["huc12s"],
                                      "source_card_count": len(detail["observed_landcover_sources"]),
                                      "selection_download": received_selection}
    return products


def _same_products(first, second):
    for name in PRODUCT_FIELDS:
        required(first[name] == second[name],
                 "The original selected-HUC product changed during Study receiving: " + name)


def _implementation():
    names = (
        "source_tools/receive_observed_landcover_study.py",
        "source_tools/receive_observed_landcover.py",
        "model/observed_landcover.py", "operator/observed_landcover_operator.py",
        "model/observed_landcover_study_transfer.py",
        "model/scientific_report_study_transfer.py", "model/study_transfer.py",
        "operator/study_transfer.py", "model/portable.py",
        "model/study_receiving.py", "operator/study_receiving.py",
        "model/observed_landcover_receiving.py", "operator/observed_landcover_receiving.py",
        "operator/web/received_studies.mjs", "operator/web/observed_landcover_received.mjs",
        "operator/web/observed_landcover_received.css", "operator/extensions/study-transfer.json",
    )
    return {name: describe_file(APPLICATION, APPLICATION / name) for name in names}


def run_selected_study(args):
    """Append one selected-Study course to the existing original receiving record."""
    record_path = args.output / "selected-huc-receiving.json"
    required(record_path.is_file(), "Complete the original selected-HUC receiving course first")
    retained = read_json(record_path)
    configuration = retained.get("configuration", {})
    required(retained.get("complete") is True and retained.get("native_products"),
             "Finish the original selected comparison/report receiving before its Study continuation")
    for name in ("workspace", "state_directory"):
        required(configuration.get(name) == str(getattr(args, name).resolve()),
                 "Continue the original selected-HUC course in its retained " + name)
    required(configuration.get("operation_id") == args.operation_id,
             "Continue the original selected-HUC operation identity")
    course = Course(record_path, configuration)
    expected = course.value["native_products"]
    identity = {"schema": SCHEMA, "operation_id": configuration["operation_id"],
                "project_id": expected["project_id"], "selection_id": expected["selection_id"],
                "scientific_report_edition_id": expected["scientific_report_edition_id"],
                "source": expected["source"], "source_binding": expected["source_binding"],
                "huc12s": expected["huc12s"]}
    continuation = course.value.setdefault("selected_study", {
        "schema": SCHEMA, "identity": identity, "state": "preparing",
        "implementation_revisions": [],
    })
    required(continuation.get("schema") == SCHEMA and continuation.get("identity") == identity,
             "The Study continuation belongs to another original scientific selection")
    current = _implementation()
    revisions = continuation["implementation_revisions"]
    if not revisions or revisions[-1]["files"] != current:
        revision = args.reviewed_source_revision
        required(isinstance(revision, str) and bool(revision.strip()),
                 "Name this explicit Study continuation with --reviewed-source-revision")
        required(not any(row["revision"] == revision.strip() and row["files"] != current
                         for row in revisions),
                 "The reviewed continuation revision already names another implementation")
        revisions.append({"revision": revision.strip(), "files": current,
                          "application_sha256": digest(current)})
    continuation["state"] = "running"
    course.write()
    operator = None
    try:
        operator = Operator(args.workspace, args.state_directory,
                            restore_directory=args.restore_directory)
        workspace_key = operator.primary
        required(operator.ws(workspace_key).project["id"] == identity["project_id"],
                 "The original selected-HUC Workspace changed project")
        current_products = _check(operator, workspace_key, identity["selection_id"],
                                  identity["scientific_report_edition_id"])
        _same_products(current_products, expected)
        required(operator.extensions.handles_action("study.export"),
                 "Install the maintained Study transfer action in this original application")
        selection = {
            "schema": study_transfer.SELECTION_SCHEMA,
            "title": "Editable selected watershed study: " + configuration["title"],
            "roots": [{"kind": "scientific-report-editions",
                       "id": identity["scientific_report_edition_id"]}],
            "include_related_results": False,
        }
        preview = operator.extensions.read("POST", "/api/study-transfer/preview",
                                           workspace_key, {"selection": selection})
        continuation["preview"] = preview
        course.write()

        def task(phase, action, payload):
            return course.task(operator, workspace_key, phase, action, payload,
                               timeout=args.timeout_seconds, resume_failed=args.resume_failed)

        exported = task("selected-study-export", "study.export", selection)
        exported_result = exported["result"]
        study_id = exported_result["id"]
        inspected = study_transfer.inspect_transfer_archive(exported_result["path"], verify=True)
        required(inspected["study"]["id"] == study_id
                 and inspected["manifest"]["project"]["id"] == identity["project_id"],
                 "Selected Study archive differs from the original comparison project")
        member = "workspace/" + observed_landcover.KIND + "/" + identity["selection_id"] + "/receipt.json"
        required(member in inspected["manifest"]["members"],
                 "The selected Study archive lacks the actual editable comparison receipt")
        continuation["cold_source_expectation"] = {
            "archive_sha256": exported_result["sha256"],
            "application_model": deepcopy(inspected["manifest"]["members"]["application/model/observed_landcover.py"]),
        }
        course.write()
        ticket = operator.task_view(exported["id"])["_downloads"][0]
        continuation["archive_download"] = download(
            operator, ticket, args.output / "selected-huc-editable-study.zip")
        required(continuation["archive_download"]["sha256"] == exported_result["sha256"],
                 "Selected Study ticket differs from the native export")
        stream, item = operator.open_download(ticket["id"])
        try:
            upload = operator.receive_upload(stream, item["bytes"], item["filename"], "application/zip")
        finally:
            stream.close()
        required(upload["sha256"] == exported_result["sha256"],
                 "Original selected Study changed while entering native upload storage")
        restored = task("selected-study-restore", "workspace.restore", {"upload_id": upload["id"]})["result"]
        required(restored["identity"] == "MATCH" and restored["project"]["id"] == identity["project_id"],
                 "Selected Study restore changed the original scientific project")
        restored_products = _check(operator, restored["workspace_key"], identity["selection_id"],
                                   identity["scientific_report_edition_id"], study_id)
        _same_products(restored_products, expected)
        continuation.update(study_id=study_id, archive=exported_result,
                            restore=restored, products=restored_products, upload=upload)
        course.write()
        operator.close()
        operator = None

        # Reopen the same accepted restore and queue identities after operator restart.
        operator = Operator(args.workspace, args.state_directory,
                            restore_directory=args.restore_directory)
        reopened = _check(operator, restored["workspace_key"], identity["selection_id"],
                          identity["scientific_report_edition_id"], study_id)
        _same_products(reopened, expected)
        for phase in ("selected-study-export", "selected-study-restore"):
            original = course.value["phases"][phase]
            actual = operator.task(original["task_id"])
            required(actual["state"] == "complete"
                     and actual["payload"] == original["request"]["payload"]
                     and actual["operation_id"] == original["accepted_operation_id"],
                     "The original selected-Study queue request did not reopen")
        operator.close()
        operator = None

        restored_application = Path(restored["application"]).resolve(strict=True)
        driver = restored_application / "source_tools/receive_observed_landcover_study.py"
        required(driver.is_file(), "The transferred application omitted its original Study continuation")
        cold_output = args.output / "selected-study-cold"
        cold_output.mkdir(exist_ok=True)
        command = [sys.executable, "-B", str(driver), "--cold-reopen",
                   "--workspace", restored["workspace"],
                   "--state-directory", str(args.output / "selected-study-cold-state"),
                   "--output", str(cold_output), "--selection-id", identity["selection_id"],
                   "--report-id", identity["scientific_report_edition_id"], "--study-id", study_id,
                   "--expected-project-id", identity["project_id"]]
        continuation["cold_command"] = command
        course.write()
        environment = dict(os.environ)
        environment.pop("PYTHONPATH", None)
        result = subprocess.run(command, cwd=restored_application, env=environment,
                                capture_output=True, text=True, timeout=args.timeout_seconds, check=False)
        (args.output / "selected-study-cold-stdout.json").write_text(result.stdout, encoding="utf-8")
        (args.output / "selected-study-cold-stderr.txt").write_text(result.stderr, encoding="utf-8")
        required(result.returncode == 0,
                 "The actual transferred application failed selected-Study reopening: " + result.stderr[-4000:])
        cold = read_json(cold_output / "selected-study-cold.json")
        required(cold["application"] == str(restored_application)
                 and cold["selected_study"]["id"] == study_id
                 and cold["application_model_sha256"] == inspected["manifest"]["members"]["application/model/observed_landcover.py"]["sha256"],
                 "The cold receiving process opened another application or selected Study")
        _same_products(cold, expected)
        continuation.update(state="complete", cold_reopen=cold)
        continuation.pop("error", None)
        course.write()
        print(json.dumps(continuation, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    except Exception as error:
        continuation.update(state="failed", error={"type": type(error).__name__, "message": str(error)})
        course.write()
        raise
    finally:
        if operator is not None:
            operator.close()



HANDOVER_SCHEMA = "upstate.selected-huc-recipient-continuation/v1"


def _handover_implementation():
    names = (
        "source_tools/receive_observed_landcover_study.py",
        "source_tools/receive_observed_landcover.py",
        "model/observed_landcover_handover.py",
        "source_tools/deliver_observed_report.py",
        "model/observed_landcover.py", "model/observed_landcover_study_transfer.py",
        "model/scientific_report_editions.py", "model/study_transfer.py",
        "model/portable.py", "operator/observed_landcover_operator.py",
        "operator/extensions/observed-landcover.json",
        "CURRENT_OWNER_DIRECTION.md", "AGENTS.md",
    )
    return {name: describe_file(APPLICATION, APPLICATION / name) for name in names}


def _package_members(archive_path, directory, receipt):
    """Verify and extract every declared original member with bounded memory."""
    import hashlib
    import stat
    import zipfile
    from pathlib import PurePosixPath
    from model.common import file_digest

    expected = {**receipt["members"],
                "Package_Manifest.json": receipt["files"]["Package_Manifest.json"]}
    directory = Path(directory)
    required(not directory.is_symlink(), "Keep the recipient package in an ordinary receiving directory")
    directory.mkdir(parents=True, exist_ok=True)
    root = directory.resolve(strict=True)
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        required(len(names) == len(set(names)) and set(names) == set(expected),
                 "The recipient ZIP inventory differs from every declared original member")
        for name, descriptor in sorted(expected.items()):
            part = PurePosixPath(name)
            required(bool(name) and not part.is_absolute() and str(part) == name
                     and ".." not in part.parts and "\\" not in name
                     and all(ord(char) >= 32 for char in name),
                     "The recipient ZIP contains an invalid original member path")
            info = archive.getinfo(name)
            mode = info.external_attr >> 16
            required(not info.is_dir() and stat.S_IFMT(mode) in (0, stat.S_IFREG)
                     and info.file_size == descriptor["bytes"],
                     "The recipient ZIP member kind or length differs: " + name)
            target = root.joinpath(*part.parts)
            for parent in (target, *target.parents):
                if parent == root:
                    break
                required(not parent.is_symlink(), "The recipient destination contains a file alias")
            required(target.resolve().is_relative_to(root),
                     "Keep each recipient member in its original receiving folder")
            target.parent.mkdir(parents=True, exist_ok=True)
            pending = target.with_name("." + target.name + ".receiving")
            required(not pending.is_symlink(), "The recipient staging member is an alias")
            checksum, count = hashlib.sha256(), 0
            try:
                with archive.open(info) as source, pending.open("wb") as output:
                    while chunk := source.read(1024 * 1024):
                        count += len(chunk)
                        required(count <= descriptor["bytes"], "Recipient member exceeds its declared length")
                        checksum.update(chunk)
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                required(count == descriptor["bytes"] and checksum.hexdigest() == descriptor["sha256"],
                         "Recipient member differs from its original descriptor: " + name)
                if target.exists():
                    required(target.is_file() and target.stat().st_size == count
                             and file_digest(target) == checksum.hexdigest(),
                             "An already received original member differs: " + name)
                else:
                    os.link(pending, target)
            finally:
                pending.unlink(missing_ok=True)
    actual = set()
    for path in root.rglob("*"):
        required(not path.is_symlink(), "The received package contains a file alias")
        if path.is_file():
            actual.add(path.relative_to(root).as_posix())
    required(actual == set(expected), "The received package directory has another file inventory")
    manifest = read_json(root / "Package_Manifest.json")
    required(manifest.get("schema") == receipt["schema"]
             and manifest.get("id") == receipt["id"]
             and manifest.get("identity") == receipt["identity"]
             and manifest.get("study") == receipt["study"]
             and manifest.get("members") == receipt["members"]
             and manifest.get("ordered_report_sources") == receipt["ordered_report_sources"],
             "The extracted recipient manifest changed its retained selection or source order")
    return {"directory": str(root), "members": len(expected),
            "bytes": sum(item["bytes"] for item in expected.values()),
            "manifest": describe_file(root, root / "Package_Manifest.json")}


def run_recipient_handover(args):
    """Receive a new recipient package from this completed original native course."""
    from model import observed_landcover_handover
    record_path = args.output / "selected-huc-receiving.json"
    required(record_path.is_file(), "Complete the original selected-HUC receiving course first")
    retained = read_json(record_path)
    configuration = retained.get("configuration", {})
    required(retained.get("complete") is True and retained.get("native_products"),
             "Finish the original comparison/report before its recipient handover")
    for name in ("workspace", "state_directory"):
        required(configuration.get(name) == str(getattr(args, name).resolve()),
                 "Continue the original receiving course in its retained " + name)
    required(configuration.get("operation_id") == args.operation_id,
             "Continue the original selected-HUC operation identity")
    course = Course(record_path, configuration)
    expected = course.value["native_products"]
    identity = {"schema": HANDOVER_SCHEMA, "operation_id": configuration["operation_id"],
                **{name: expected[name] for name in ("project_id", "selection_id",
                    "scientific_report_edition_id", "source", "source_binding", "huc12s")}}
    continuation = course.value.setdefault("recipient_handover", {
        "schema": HANDOVER_SCHEMA, "identity": identity, "state": "preparing",
        "implementation_revisions": []})
    required(continuation.get("schema") == HANDOVER_SCHEMA and continuation.get("identity") == identity,
             "This handover continuation belongs to another original scientific product")
    current = _handover_implementation()
    revisions = continuation["implementation_revisions"]
    if not revisions or revisions[-1]["files"] != current:
        revision = args.reviewed_source_revision
        required(isinstance(revision, str) and bool(revision.strip()),
                 "Name the handover implementation with --reviewed-source-revision")
        required(not any(row["revision"] == revision.strip() and row["files"] != current for row in revisions),
                 "This handover revision already identifies another implementation")
        revisions.append({"revision": revision.strip(), "files": current,
                          "application_sha256": digest(current)})
    continuation["state"] = "running"
    course.write()
    operator = None
    try:
        operator = Operator(args.workspace, args.state_directory,
                            restore_directory=args.restore_directory)
        key = operator.primary
        required(operator.ws(key).project["id"] == identity["project_id"],
                 "The recipient handover opened another original Workspace")
        original = _check(operator, key, identity["selection_id"], identity["scientific_report_edition_id"])
        _same_products(original, expected)
        required(operator.extensions.handles_action("observed.landcover.handover"),
                 "Install the original recipient handover action in this application")
        def task(phase, action, payload):
            return course.task(operator, key, phase, action, payload,
                               timeout=args.timeout_seconds, resume_failed=args.resume_failed)
        completed = task("recipient-handover-build", "observed.landcover.handover", {
            "comparison_id": identity["selection_id"], "report_id": identity["scientific_report_edition_id"]})
        receipt = completed["result"]
        required(receipt.get("schema") == observed_landcover_handover.SCHEMA
                 and receipt.get("state") == "complete"
                 and receipt.get("project_id") == identity["project_id"]
                 and receipt.get("comparison_id") == identity["selection_id"]
                 and receipt.get("report_id") == identity["scientific_report_edition_id"]
                 and receipt.get("huc12s") == identity["huc12s"],
                 "The completed recipient package differs from the original selected product")
        public = operator.extensions.read("GET", "/api/observed-landcover/handover", key,
                                          {"id": receipt["id"]})
        required(all(public.get(name) == receipt[name] for name in
                     ("id", "identity", "study", "members", "files", "ordered_report_sources")),
                 "The public recipient reader changed the exact saved package")
        destination = args.output / "recipient-handover" / receipt["id"]
        destination.mkdir(parents=True, exist_ok=True)
        tickets = operator.task_view(completed["id"]).get("_downloads", [])
        downloads = {}
        primary = {
            "Recipient_Package.zip", "Report/Watershed_Scientific_Report.pdf",
            "Report/Watershed_Offline_Reader.html", "Editable_Study.zip",
            "Report/Original_Saved_Report.zip", "Comparison/selected-huc-landcover.zip",
            "Package_Manifest.json",
        }
        required(len(tickets) == len(primary) and {row.get("member") for row in tickets} == primary,
                 "The native task omitted an original primary recipient download")
        for ticket in tickets:
            name = ticket["member"]
            descriptor = receipt["files"][name]
            required(ticket["bytes"] == descriptor["bytes"] and ticket["sha256"] == descriptor["sha256"]
                     and ticket["filename"] == Path(name).name,
                     "The native recipient ticket differs from its exact package member: " + name)
            downloads[name] = download(operator, ticket)
        required(receipt["identity"]["comparison_source"] == identity["source"]
                 and receipt["files"]["Report/Watershed_Scientific_Report.pdf"]["sha256"] ==
                     expected["report_file_hashes"]["report_pdf"]
                 and receipt["files"]["Comparison/selected-huc-landcover.zip"]["sha256"] ==
                     expected["selection_zip"]["sha256"]
                 and receipt["files"]["Report/Original_Saved_Report.zip"]["sha256"] ==
                     course.value["report_download"]["sha256"],
                 "The recipient package changed an original comparison or completed scientific output")
        bundle_ticket = next(row for row in tickets if row["member"] == "Recipient_Package.zip")
        bundle_path = destination / "Recipient_Package.zip"
        bundle = download(operator, bundle_ticket, bundle_path)
        extracted = _package_members(bundle_path, destination / "package", receipt)
        package_root = Path(extracted["directory"])
        study_path = package_root / "Editable_Study.zip"
        required(describe_file(package_root, study_path)["sha256"] == receipt["study"]["sha256"]
                 and study_path.stat().st_size == receipt["study"]["bytes"],
                 "The complete package carries another editable Study archive")
        inspected = study_transfer.inspect_transfer_archive(study_path, verify=True)
        required(inspected["study"]["id"] == receipt["study"]["id"]
                 and inspected["manifest"]["project"]["id"] == identity["project_id"]
                 and inspected["study"]["identity"]["selection"]["roots"] == [
                     {"kind": "scientific-report-editions", "id": identity["scientific_report_edition_id"]}],
                 "The recipient Study changed its exact original report root or project")
        required("workspace/" + observed_landcover.KIND + "/" + identity["selection_id"] + "/receipt.json"
                 in inspected["manifest"]["members"],
                 "The recipient Study omitted its original editable watershed comparison")
        continuation.update(handover_id=receipt["id"], receipt=receipt, downloads=downloads,
                            package_download=bundle, extracted=extracted,
                            cold_source_expectation={
                                "archive_sha256": receipt["study"]["sha256"],
                                "application_model": deepcopy(inspected["manifest"]["members"][
                                    "application/model/observed_landcover.py"])})
        course.write()
        # Upload the exact inner archive that a recipient obtains from the package.
        with study_path.open("rb") as stream:
            upload = operator.receive_upload(stream, receipt["study"]["bytes"],
                                             "Editable_Study.zip", "application/zip")
        required(upload["sha256"] == receipt["study"]["sha256"],
                 "The recipient Study changed during the original upload")
        restored = task("recipient-handover-restore", "workspace.restore", {"upload_id": upload["id"]})["result"]
        required(restored["identity"] == "MATCH" and restored["project"]["id"] == identity["project_id"],
                 "The recipient Study restore changed its original project")
        received = _check(operator, restored["workspace_key"], identity["selection_id"],
                          identity["scientific_report_edition_id"], receipt["study"]["id"])
        _same_products(received, expected)
        continuation.update(upload=upload, restore=restored, products=received)
        course.write()
        operator.close()
        operator = None
        operator = Operator(args.workspace, args.state_directory,
                            restore_directory=args.restore_directory)
        reopened = _check(operator, restored["workspace_key"], identity["selection_id"],
                          identity["scientific_report_edition_id"], receipt["study"]["id"])
        _same_products(reopened, expected)
        current_receipt = operator.extensions.read("GET", "/api/observed-landcover/handover", key,
                                                  {"id": receipt["id"]})
        required(current_receipt["identity"] == receipt["identity"]
                 and current_receipt["files"] == receipt["files"],
                 "The original recipient package did not reopen after operator restart")
        for phase in ("recipient-handover-build", "recipient-handover-restore"):
            saved = course.value["phases"][phase]
            actual = operator.task(saved["task_id"])
            required(actual["state"] == "complete" and actual["payload"] == saved["request"]["payload"]
                     and actual["operation_id"] == saved["accepted_operation_id"],
                     "The original recipient queue identity did not survive restart")
        operator.close()
        operator = None
        application = Path(restored["application"]).resolve(strict=True)
        driver = application / "source_tools/receive_observed_landcover_study.py"
        required(driver.is_file(), "The recipient application omitted its original cold reader")
        source_members = inspected["manifest"]["members"]
        for relative in ("source_tools/receive_observed_landcover_study.py",
                         "source_tools/receive_observed_landcover.py",
                         "model/observed_landcover.py"):
            archived = source_members["application/" + relative]
            actual_source = describe_file(application, application / relative)
            required(all(actual_source[name] == archived[name] for name in ("bytes", "sha256")),
                     "The recipient cold reader differs from its captured application: " + relative)
        continuation["cold_source_expectation"]["receiver_sources"] = {
            relative: deepcopy(source_members["application/" + relative])
            for relative in ("source_tools/receive_observed_landcover_study.py",
                             "source_tools/receive_observed_landcover.py",
                             "model/observed_landcover.py")}
        cold_root = destination / "cold"
        cold_root.mkdir(exist_ok=True)
        command = [sys.executable, "-I", "-B", str(driver), "--cold-reopen",
                   "--workspace", restored["workspace"], "--state-directory", str(destination / "cold-state"),
                   "--output", str(cold_root), "--selection-id", identity["selection_id"],
                   "--report-id", identity["scientific_report_edition_id"],
                   "--study-id", receipt["study"]["id"], "--expected-project-id", identity["project_id"]]
        continuation["cold_command"] = command
        course.write()
        environment = dict(os.environ)
        environment.pop("PYTHONPATH", None)
        result = subprocess.run(command, cwd=application, env=environment,
                                capture_output=True, text=True, timeout=args.timeout_seconds, check=False)
        (destination / "cold-stdout.json").write_text(result.stdout, encoding="utf-8")
        (destination / "cold-stderr.txt").write_text(result.stderr, encoding="utf-8")
        required(result.returncode == 0,
                 "The packaged application failed native cold reopening: " + result.stderr[-4000:])
        cold = read_json(cold_root / "selected-study-cold.json")
        required(cold["application"] == str(application)
                 and cold["selected_study"]["id"] == receipt["study"]["id"]
                 and cold["application_model_sha256"] == inspected["manifest"]["members"][
                     "application/model/observed_landcover.py"]["sha256"],
                 "Recipient cold reopening used another archived application or Study")
        _same_products(cold, expected)
        continuation.update(state="complete", cold_reopen=cold,
                            recipient_start_page=str(package_root / "START_HERE.html"),
                            recipient_report=str(package_root / "Report/Watershed_Offline_Reader.html"))
        continuation.pop("error", None)
        course.write()
        print(json.dumps(continuation, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    except Exception as error:
        continuation.update(state="failed", error={"type": type(error).__name__, "message": str(error)})
        course.write()
        raise
    finally:
        if operator is not None:
            operator.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cold-reopen", action="store_true", required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--selection-id", required=True)
    parser.add_argument("--report-id", required=True)
    parser.add_argument("--study-id", required=True)
    parser.add_argument("--expected-project-id", required=True)
    args = parser.parse_args(argv)
    args.output.mkdir(parents=True, exist_ok=True)
    operator = Operator(args.workspace, args.state_directory)
    try:
        required(operator.ws(operator.primary).project["id"] == args.expected_project_id,
                 "The cold Study application opened another original project")
        value = _check(operator, operator.primary, args.selection_id, args.report_id, args.study_id)
        value["application"] = str(APPLICATION.resolve())
        value["application_model_sha256"] = describe_file(APPLICATION, APPLICATION / "model/observed_landcover.py")["sha256"]
        atomic_json(args.output / "selected-study-cold.json", value)
        print(json.dumps(value, ensure_ascii=False, sort_keys=True))
        return 0
    finally:
        operator.close()


if __name__ == "__main__":
    raise SystemExit(main())
