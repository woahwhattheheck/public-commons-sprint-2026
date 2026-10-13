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
