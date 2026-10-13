#!/usr/bin/env python3
"""Continue a retained observation review through original report and Study transfer.

Called by receive_original_study.py after its saved-review continuation. The
existing scientific report receiver owns rendering, tasks, downloads and recovery.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

SCHEMA = "upstate.published-study-report-receiving/v1"


def identity(path):
    path = Path(path)
    checksum = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
            size += len(block)
    return {"bytes": size, "sha256": checksum.hexdigest()}


def _check(value, message):
    if not value:
        raise ValueError(message)


def _separate(first, second, label):
    first, second = Path(first).resolve(), Path(second).resolve()
    _check(not first.is_relative_to(second) and not second.is_relative_to(first),
           "Keep " + label + " in separate directories.")


def _read_spec(path):
    from model.common import read_json, identifier
    path = Path(path).resolve(strict=True)
    before = identity(path)
    spec = read_json(path)
    _check(identity(path) == before, "The report continuation selection changed while reading.")
    _check(isinstance(spec, dict) and set(spec) == {
        "schema", "title", "hydrology_version_id", "hydrology_sources"},
        "Select the exact title, hydrology study version and ordered original sources.")
    _check(spec["schema"] == SCHEMA, "Use the published-study-report-receiving/v1 specification.")
    _check(isinstance(spec["title"], str) and 0 < len(spec["title"].strip()) <= 200,
           "Use a nonempty report title up to 200 characters.")
    _check(isinstance(spec["hydrology_version_id"], str) and spec["hydrology_version_id"],
           "Name the explicit retained hydrology study edition.")
    sources = spec["hydrology_sources"]
    _check(isinstance(sources, list) and sources, "Select at least one original hydrology report source.")
    seen = set()
    for item in sources:
        _check(isinstance(item, dict) and set(item) == {
            "source_collection_id", "source_id", "body_sha256"},
            "Bind each original hydrology source to its collection, source ID and body SHA-256.")
        identifier(item["source_collection_id"])
        identifier(item["body_sha256"])
        _check(isinstance(item["source_id"], str) and item["source_id"],
               "Keep each original hydrology source identifier.")
        key = (item["source_collection_id"], item["source_id"])
        _check(key not in seen, "Each ordered hydrology source may occur only once.")
        seen.add(key)
    return spec, {"path": str(path), **before}


def _run(command, cwd, stdout_path, stderr_path):
    """Keep complete native output and report the actual first failing diagnostic."""
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    with Path(stdout_path).open("ab") as stdout, Path(stderr_path).open("ab") as stderr:
        completed = subprocess.run(command, cwd=str(cwd), env=env,
                                   stdout=stdout, stderr=stderr, check=False)
    if completed.returncode:
        with Path(stderr_path).open("rb") as stream:
            stream.seek(max(0, Path(stderr_path).stat().st_size - 32768))
            diagnostic = stream.read().decode("utf-8", errors="replace")
        raise RuntimeError("Original native command returned %s; complete logs: %s, %s\n%s" %
                           (completed.returncode, stdout_path, stderr_path, diagnostic))
    return {"command": list(command), "returncode": completed.returncode,
            "stdout": {"path": str(stdout_path), **identity(stdout_path)},
            "stderr": {"path": str(stderr_path), **identity(stderr_path)}}


def _review_snapshot(reviews, review_id):
    opened = reviews.get(review_id)
    value = opened["review"]
    return {"id": review_id, "record": value,
            "file": identity(reviews._path(review_id)),
            "binding": value["content"]["binding"],
            "selection": value["content"]["selection"]}



def _original_cohort(study):
    """Bind original NarrowResult cells and original metadata, without selectors."""
    from model.common import digest
    rows = study["observation_rows"]
    originals = {}
    for row in rows:
        key = row.get("original_result_identifier")
        raw = row.get("raw_cells")
        _check(isinstance(key, str) and key and key not in originals
               and isinstance(raw, dict) and raw,
               "Retain each distinct original result identifier and all original CSV cells.")
        _check(raw.get("ResultIdentifier", key) == key,
               "The original result identifier differs from its original CSV cells.")
        references = row.get("metadata_source_records", {})
        _check(isinstance(references, dict), "Retain the original observation metadata joins.")
        # get_study adds only the current native source selector to each
        # original metadata record. Its CSV cells, file hash, row and join
        # identity are preserved by the maintained NarrowResult parser.
        metadata = {}
        for role, reference in references.items():
            _check(isinstance(reference, dict) and isinstance(reference.get("raw_cells"), dict),
                   "Retain the original joined activity/reporting-limit cells.")
            metadata[role] = {name: value for name, value in reference.items()
                              if name != "source_selector"}
        originals[key] = {
            "raw_cells": raw, "source_file": row["source_file"],
            "source_csv_row": row["source_csv_row"],
            "original_source_sha256": row.get("original_source_sha256"),
            "metadata": metadata,
        }
    _check(bool(originals), "The original observation cohort is empty.")
    return {"records": len(rows), "distinct_results": len(originals),
            "original_cells_sha256": digest(originals),
            "basis": "Original result CSV cells/file hash/row and original joined metadata cells; native selectors excluded"}


def cold_inspect(workspace_path, expectation_path):
    """Read the received studies with this received application's original code."""
    from model.common import read_json, verify_file, file_digest
    from model.workspace import Workspace
    from model import study_transfer, published_review_report_source
    from model.scientific_report_study_transfer import _record
    from measurement_workspace.published_studies import PublishedStudyStore
    from measurement_workspace.study_reviews import PublishedStudyReviews
    app = Path(__file__).resolve().parents[1]
    _check(Path(study_transfer.__file__).resolve().is_relative_to(app),
           "Cold receiving imported a Study engine outside the received application.")
    expected = read_json(expectation_path)
    _check(expected.get("schema") == SCHEMA, "Use the original report continuation expectation.")
    workspace = Workspace(workspace_path)
    _check(workspace.project == expected["project"], "Cold receiving changed the original project.")
    for name, item in expected["required_application"].items():
        _check(identity(app / name) == item, "Cold receiving changed required source " + name)
    verified = study_transfer.verify_received_studies(workspace)
    _check(any(item["id"] == expected["transfer_id"] and item["identity"] == "MATCH"
               for item in verified), "Cold receiving did not reopen the original selected Study.")
    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    reviews = PublishedStudyReviews(store)
    seen_versions = []
    for selected in expected["reviews"]:
        actual = _review_snapshot(reviews, selected["id"])
        _check(actual == selected, "Cold receiving changed a saved review or its exact source selection.")
        binding = actual["binding"]
        native = store.get_study(binding["study_id"], binding["version_id"])
        _check(native["record"]["source_collection_id"] == binding["source_collection_id"],
               "Cold receiving changed the original study source collection.")
        _check(_original_cohort(native) == expected["original_cohort"],
               "Cold receiving changed original observation cells or joined metadata.")
        seen_versions.append({"study_id": binding["study_id"], "version_id": binding["version_id"],
                              "source_collection_id": binding["source_collection_id"],
                              "original_results": len(native["observation_rows"])})
    sources = []
    for selected in expected["review_sources"]:
        result = published_review_report_source.inspect(workspace, selected["id"])
        _check(result["identity"] == selected["identity"] and result["source_choice"] == selected["source_choice"],
               "Cold receiving changed a captured review source.")
        sources.append({"id": result["id"], "source_choice": result["source_choice"]})
    reports = []
    for selected in expected["reports"]:
        directory = workspace.root / "scientific-report-editions" / selected["id"]
        record = read_json(directory / "edition.json")
        _record(workspace, selected["id"], record)
        _check(file_digest(directory / "edition.json") == selected["record_sha256"]
               and record["render_identity"] == selected["render_identity"],
               "Cold receiving changed a saved report's original identity.")
        for descriptor in record["files"].values():
            verify_file(directory, descriptor)
        reports.append({"id": selected["id"], "sources": record["sources"],
                        "record_sha256": selected["record_sha256"]})
    return {"schema": SCHEMA, "state": "complete", "identity": "MATCH",
            "project_id": workspace.project["id"], "workspace": str(workspace.root),
            "application": str(app), "interpreter": sys.executable,
            "transfer_id": expected["transfer_id"],
            "review_ids": [row["id"] for row in expected["reviews"]],
            "study_versions": seen_versions, "review_sources": sources, "reports": reports}


def continue_report(workspace, output, state, state_path, specification):
    from model.common import atomic_json, digest, held, read_json, file_digest
    from model.portable import restore, resume_restore
    from model import published_review_report_source, study_transfer, observed_context
    from measurement_workspace.published_studies import PublishedStudyStore
    from measurement_workspace.study_reviews import PublishedStudyReviews

    app = Path(__file__).resolve().parents[1]
    output = Path(output).resolve()
    state_path = Path(state_path).resolve()
    spec, spec_file = _read_spec(specification)
    _separate(output, workspace.root, "the receiving output and original Workspace")
    _separate(output, app, "the receiving output and application")
    _check(Path(spec_file["path"]) != state_path, "Keep the report request separate from operation.json.")
    saved = state.get("continuations", {}).get("saved_review", {})
    _check(saved.get("status") == "complete",
           "Finish the same operation's exact original saved-review continuation first.")
    _check(state["request"]["workspace_id"] == workspace.project["id"],
           "Continue the original receiving project.")
    original_id = saved["phases"]["save"]["review_id"]
    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    reviews = PublishedStudyReviews(store)
    original = _review_snapshot(reviews, original_id)
    _check(original["record"]["content"] == saved["phases"]["save"]["content"],
           "The original saved review changed after its completed receiving phase.")
    imported = state["phases"]["import"]
    _check(original["binding"]["study_id"] == imported["study_id"]
           and original["binding"]["version_id"] == imported["version_id"]
           and original["binding"]["source_collection_id"] == imported["source_collection_id"],
           "The original review does not match the retained intake edition.")
    _check(spec["hydrology_version_id"] != imported["version_id"],
           "Select the separate, explicitly retained hydrology study edition.")
    study = store.get_study(imported["study_id"], spec["hydrology_version_id"])
    original_study = store.get_study(imported["study_id"], imported["version_id"])
    original_cohort = _original_cohort(original_study)
    _check(original_cohort["records"] == state["phases"]["original_rows"]["result_identifiers"],
           "The original observations differ from the completed intake's result count.")
    _check(_original_cohort(study) == original_cohort,
           "The hydrology edition changed original result cells, source rows or activity/limit metadata.")
    choices = []
    for selected in spec["hydrology_sources"]:
        choice = {name: selected[name] for name in ("source_collection_id", "source_id")}
        original_source, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        _check(entry["body"]["sha256"] == selected["body_sha256"]
               and file_digest(original_source) == selected["body_sha256"],
               "The selected original hydrology recipe differs from its retained body.")
        recipe = read_json(original_source)
        _check(entry["kind"] == "document" and recipe.get("schema") == observed_context.SCHEMA,
               "Select the existing original typed hydrology report document.")
        choices.append(choice)
    observed_context.bind(workspace, {
        "source_roles": {"OBSERVED_CONTEXT": choices[0]},
        "observed_context_sources": choices,
    })
    request = {"specification": spec, "original_review_id": original_id,
               "original_review_sha256": original["file"]["sha256"],
               "project_id": workspace.project["id"],
               "hydrology_source_collection_id": study["record"]["source_collection_id"],
               "selection": deepcopy(original["selection"]),
               "original_cohort": original_cohort}
    courses = state.setdefault("continuations", {})
    course = courses.setdefault("scientific_report", {
        "schema": SCHEMA, "request": request, "phases": {},
    })
    _check(course.get("request") == request,
           "Resume the exact original study/report continuation selection.")
    root = output / ("scientific-review-" + digest(request)[:24])
    root.mkdir(parents=True, exist_ok=True)
    _check(not Path(spec_file["path"]).is_relative_to(root),
           "Keep the original report specification outside generated report outputs.")
    phases = course["phases"]
    course.update(status="running", pid=os.getpid(), interpreter=sys.executable,
                  updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    course.pop("error", None)

    def checkpoint(name, value):
        phases[name] = value
        course["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        atomic_json(state_path, state)
        print(json.dumps({"operation_id": state["operation_id"],
                          "continuation": "scientific_report", "phase": name, "result": value},
                         ensure_ascii=False, allow_nan=False), flush=True)

    atomic_json(root / "request.json", request, immutable=True)
    atomic_json(state_path, state)
    try:
        prior = phases.get("hydrology_review")
        if prior:
            hydrology = _review_snapshot(reviews, prior["id"])
            _check(hydrology == prior, "The saved hydrology review changed after its checkpoint.")
        else:
            value = reviews.save({
                "study_id": imported["study_id"], "version_id": spec["hydrology_version_id"],
                "selection": original["selection"], "table": original["record"]["content"]["table"],
                "title": (spec["title"] + " — selected observations with hydrology context")[:200],
                "notes": "Separate explicit source edition for original receiving operation " +
                         state["operation_id"] + ". Original observation selection is retained from " +
                         original_id + "; this is a new review, not a revision of that source edition.",
            })["review"]
            hydrology = _review_snapshot(reviews, value["id"])
        _check(hydrology["binding"]["version_id"] == spec["hydrology_version_id"]
               and hydrology["selection"] == original["selection"],
               "The new review changed the explicit hydrology edition or original selection.")
        checkpoint("hydrology_review", hydrology)

        sources = []
        for name, selected in (("original_review_source", original), ("hydrology_review_source", hydrology)):
            prior = phases.get(name)
            if prior:
                source = published_review_report_source.inspect(workspace, prior["id"])
                _check(source["identity"] == prior["identity"]
                       and source["source_choice"] == prior["source_choice"],
                       "A captured review source changed during resume.")
            else:
                preview = published_review_report_source.preview(workspace, selected["id"])
                with held(workspace.root / ".workspace.lock", blocking=False):
                    source = published_review_report_source.prepare(
                        workspace, selected["id"], expected_preview_id=preview["id"],
                        expected_review_sha256=selected["file"]["sha256"])
            retained = {"id": source["id"], "identity": source["identity"],
                        "source_choice": source["source_choice"], "review_id": source["review_id"]}
            checkpoint(name, retained)
            sources.append(retained)

        report_requests = [
            {"id": "original-observation-review",
             "selection": {"title": spec["title"] + " — original selected observation review",
                           "sources": [sources[0]["source_choice"]]}},
            {"id": "hydrology-and-observation-review",
             "selection": {"title": spec["title"] + " — hydrology and selected observations",
                           "sources": choices + [sources[1]["source_choice"]]}},
        ]
        manifest = {"schema": "upstate.scientific-report-receiving-course/v1",
                    "operation_id": state["operation_id"] + "-review-reports",
                    "project_id": workspace.project["id"],
                    "steps": [{"id": item["id"], "origin": state["operation_id"],
                               "output": str(root / ("report-" + item["id"])),
                               "selection": item["selection"], "selected_study": False}
                              for item in report_requests]}
        course_file = root / "report-course.json"
        atomic_json(course_file, manifest, immutable=True)
        receiver = app / "source/observed-report-20261013/receive_operator.py"
        _check(receiver.is_file(), "Receive the maintained original scientific report receiver.")
        receiver_root = root / "report-course"
        command = [sys.executable, "-B", str(receiver), "--workspace", str(workspace.root),
                   "--course", str(course_file), "--output", str(receiver_root)]
        if receiver_root.exists():
            command.append("--resume")
        # A completed course is reopened through its original receiver too: it
        # verifies saved queues, files and source-bound scientific editions.
        checkpoint("report_course_process", _run(
            command, app, root / "report-course.stdout.log", root / "report-course.stderr.log"))
        course_receipt = read_json(receiver_root / "scientific-report-course.json")
        _check(course_receipt["state"] == "complete",
               "The original report course has an unfinished report; resume its retained task.")
        reports = []
        for selected in report_requests:
            receipt_path = root / ("report-" + selected["id"]) / "scientific-report-receiving.json"
            receipt = read_json(receipt_path)
            _check(receipt["state"] == "complete" and receipt["project_id"] == workspace.project["id"]
                   and receipt["sources"] == selected["selection"]["sources"],
                   "The original receiver changed the selected project or ordered report sources.")
            key = receipt["edition_id"]
            edition_path = workspace.root / "scientific-report-editions" / key / "edition.json"
            edition = read_json(edition_path)
            _check(edition == receipt["edition"], "The completed native edition differs from its receipt.")
            reports.append({"id": key, "record_sha256": file_digest(edition_path),
                            "render_identity": edition["render_identity"],
                            "receipt": {"path": str(receipt_path), **identity(receipt_path)}})
        checkpoint("reports", reports)

        selection = {"title": spec["title"] + " — original and hydrology reviews",
                     "roots": [{"kind": "scientific-report-editions", "id": row["id"]} for row in reports],
                     "include_related_results": True}
        selected_path = root / "editable-study-selection.json"
        if selected_path.exists():
            selected = read_json(selected_path)
            _check({key: value for key, value in selected.items() if key != "preview_token"} == selection,
                   "Resume the original selected editable Study.")
            selection = selected
        else:
            selection["preview_token"] = study_transfer.preview(workspace, selection)["preview_token"]
            atomic_json(selected_path, selection, immutable=True)
        archive = root / "observation-hydrology-reviews-study.zip"
        exported = study_transfer.export_study(workspace, archive, selection)
        inspected = study_transfer.inspect_transfer_archive(archive, verify=True)
        _check(inspected["manifest"]["project"] == workspace.project,
               "The selected editable Study changed the original project.")
        members = inspected["manifest"]["members"]
        snapshots = [original, hydrology]
        for review in snapshots:
            member = "workspace/published_studies/reviews/" + review["id"] + ".json"
            _check(member in members and all(
                members[member][field] == review["file"][field] for field in ("bytes", "sha256")),
                "The editable Study omitted an exact original review.")
        required_application = {}
        for name in (
            "source_tools/continue_study_report.py",
            "measurement_workspace/study_reviews.py",
            "measurement_workspace/published_studies.py",
            "model/published_review_report_source.py",
            "model/published_review_study_transfer.py",
            "model/scientific_report_study_transfer.py",
        ):
            item = members.get("application/" + name)
            _check(item is not None, "The editable Study omitted required application source " + name)
            required_application[name] = {field: item[field] for field in ("bytes", "sha256")}
        expectation = {"schema": SCHEMA, "project": workspace.project,
                       "transfer_id": exported["id"], "reviews": snapshots,
                       "original_cohort": original_cohort,
                       "review_sources": sources,
                       "reports": [{key: row[key] for key in ("id", "record_sha256", "render_identity")}
                                   for row in reports],
                       "required_application": required_application}
        expectation_path = root / "cold-reopen-expectation.json"
        atomic_json(expectation_path, expectation, immutable=True)
        checkpoint("editable_study", {"id": exported["id"], "path": str(archive),
                                     **identity(archive), "members": len(members),
                                     "selection": inspected["study"]["identity"]["selection"]})
        receiving = root / "cold-reopened-study"
        if receiving.exists():
            # Native restore can register delivery roles and derived navigation.
            # Reconcile the original receive through that maintained producer;
            # cold_inspect below still verifies our selected scientific records.
            restored = resume_restore(
                archive, receiving, expected_archive_sha256=identity(archive)["sha256"])
        else:
            restored = restore(archive, receiving)
        restored_app = Path(restored["application"]).resolve(strict=True)
        child = restored_app / "source_tools/continue_study_report.py"
        child_result = root / "cold-reopen.json"
        command = [sys.executable, "-B", str(child), "--cold-inspect", str(expectation_path),
                   "--workspace", str(restored["workspace"]), "--result", str(child_result)]
        process = _run(command, restored_app, root / "cold-reopen.stdout.log", root / "cold-reopen.stderr.log")
        cold = read_json(child_result)
        _check(cold["identity"] == "MATCH" and cold["transfer_id"] == exported["id"]
               and cold["review_ids"] == [row["id"] for row in snapshots],
               "The cold native receiving result differs from the original selected study.")
        checkpoint("cold_reopen", {**cold, "process": process,
                                   "result": {"path": str(child_result), **identity(child_result)}})
        course.update(status="complete", completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        atomic_json(state_path, state)
        print(json.dumps({"operation_id": state["operation_id"], "continuation": "scientific_report",
                          "status": "complete", "review_ids": cold["review_ids"],
                          "report_ids": [row["id"] for row in reports],
                          "study_archive": str(archive), "received_workspace": cold["workspace"]},
                         ensure_ascii=False, allow_nan=False), flush=True)
        return 0
    except BaseException as error:
        course.update(status="failed" if isinstance(error, Exception) else "interrupted",
                      error={"type": type(error).__name__, "message": str(error)})
        atomic_json(state_path, state)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cold-inspect", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args(argv)
    app = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(app))
    expected = args.cold_inspect.resolve(strict=True)
    result = args.result.resolve()
    _check(result != expected, "Keep the immutable expectation separate from its returned result.")
    _check(not result.is_relative_to(args.workspace.resolve()) and not result.is_relative_to(app),
           "Keep the cold receiving result outside the received application and Workspace.")
    from model.common import atomic_json
    value = cold_inspect(args.workspace.resolve(strict=True), expected)
    atomic_json(result, value, immutable=True)
    print(json.dumps(value, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
