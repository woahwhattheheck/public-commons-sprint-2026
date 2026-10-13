#!/usr/bin/env python3
"""Receive an original WQP study through native Workspace import and transfer.

Run from the complete maintained application. A new Workspace is created only
when --create-workspace is explicit. Existing study/source identities are reused.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import time


def file_identity(path):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return {"path": str(path.resolve()), "bytes": path.stat().st_size, "sha256": digest.hexdigest()}




def reconcile_receiving_locations(workspace, output, state_path, specification):
    """Bind explicitly relocated originals without changing the saved request."""
    from model.common import atomic_json
    from model.portable import inspect_archive
    from measurement_workspace.published_studies import PublishedStudyStore
    import tempfile

    specification = Path(specification).expanduser().resolve(strict=True)
    spec_bytes = specification.read_bytes()
    spec = json.loads(spec_bytes.decode("utf-8-sig"))
    if (not isinstance(spec, dict)
            or spec.get("schema") != "upstate.published-study-receiving-relocation/v1"
            or set(spec) != {"schema", "operation", "archives"}):
        raise ValueError("Use an explicit original-operation and archive relocation specification.")
    descriptor = spec["operation"]
    if (not isinstance(descriptor, dict) or set(descriptor) != {"path", "bytes", "sha256"}
            or not isinstance(descriptor["path"], str)
            or isinstance(descriptor["bytes"], bool) or not isinstance(descriptor["bytes"], int)
            or descriptor["bytes"] < 1 or not isinstance(descriptor["sha256"], str)):
        raise ValueError("Retain the original operation file path, byte length and SHA-256.")
    original_path = Path(descriptor["path"]).expanduser().resolve(strict=True)
    if original_path == state_path.resolve() or specification == state_path.resolve():
        raise ValueError("Keep the immutable original operation and relocation specification separate from operation.json.")
    original_bytes = original_path.read_bytes()
    if (len(original_bytes) != descriptor["bytes"]
            or hashlib.sha256(original_bytes).hexdigest() != descriptor["sha256"]):
        raise ValueError("The relocated original operation differs from its published bytes or SHA-256.")
    original = json.loads(original_bytes.decode("utf-8-sig"))
    if (not isinstance(original, dict) or original.get("schema") != "upstate.published-study-receiving/v1"
            or not isinstance(original.get("operation_id"), str)
            or not isinstance(original.get("request"), dict)):
        raise ValueError("Select the complete original native receiving operation.")
    request, phases = original["request"], original.get("phases", {})
    required = ("import", "original_rows", "selected_report", "complete_study",
                "study_reopen", "project_archive", "project_reopen")
    if not isinstance(phases, dict) or any(name not in phases for name in required):
        raise ValueError("Relocation requires the original completed study and project receiving phases.")
    if request.get("workspace_id") != workspace.project["id"]:
        raise ValueError("The relocated Workspace has a different original project identity.")
    old_workspace = Path(request.get("workspace", ""))
    old_archive = Path(phases["project_archive"].get("path", ""))
    if not old_workspace.is_absolute() or not old_archive.is_absolute():
        raise ValueError("The original operation must retain its original absolute Workspace and archive paths.")
    # Historical paths describe the original host; do not resolve its symlinks
    # through this receiving host's unrelated filesystem.
    old_workspace = Path(os.path.normpath(str(old_workspace)))
    old_output = Path(os.path.normpath(str(old_archive))).parent
    current_roots = (workspace.root.resolve(), output.resolve())
    original_roots = (old_workspace, old_output)
    if any(a != b and (a.is_relative_to(b) or b.is_relative_to(a))
           for a in current_roots for b in original_roots):
        raise ValueError("Relocated Workspace/output roots must be identical to or disjoint from original roots.")
    if (workspace.root.is_relative_to(output) or output.is_relative_to(workspace.root)
            or current_roots[0] == old_output or current_roots[1] == old_workspace):
        raise ValueError("Keep the relocated Workspace and receiving output in separate, corresponding directories.")
    mappings = spec["archives"]
    if not isinstance(mappings, dict) or set(mappings) != {"complete_study", "project_archive"}:
        raise ValueError("Explicitly locate both original complete-study and full-Workspace archives.")
    archives = {}
    for phase in ("complete_study", "project_archive"):
        if not isinstance(mappings[phase], str):
            raise ValueError("Each relocated archive path must be an explicit string.")
        actual = file_identity(Path(mappings[phase]).expanduser().resolve(strict=True))
        expected = phases[phase]
        if any(actual[key] != expected[key] for key in ("bytes", "sha256")):
            raise ValueError("The relocated original archive changed: " + phase)
        archives[phase] = actual
    manifest = inspect_archive(archives["project_archive"]["path"], verify=True)
    if manifest["project"] != workspace.project:
        raise ValueError("The original archive and relocated Workspace describe different projects.")
    imported = phases["import"]
    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    retained = store.get_study(imported["study_id"], imported["version_id"])
    record = retained["record"]
    version_root = store._version_root(imported["study_id"], imported["version_id"])
    expected_manifest = phases["original_rows"]["source_manifest"]
    actual_manifest = file_identity(version_root / "sources.json")
    # The original store rebinds the source-manifest path to this Workspace.
    # Its content identity, not the former host's absolute path, is immutable.
    if (record["source_collection_id"] != imported["source_collection_id"]
            or any(record["source_manifest"].get(key) != value
                   for key, value in expected_manifest.items() if key != "path")
            or any(actual_manifest[key] != expected_manifest[key] for key in ("bytes", "sha256"))
            or len({row["original_result_identifier"] for row in retained["observation_rows"]})
            != phases["original_rows"]["result_identifiers"]):
        raise ValueError("The relocated Workspace does not retain the exact original study source and result cohort.")
    preserved = [
        workspace.root / "sources" / (imported["source_collection_id"] + ".json"),
        version_root / "record.json", version_root / "sources.json",
    ]
    for path in preserved:
        actual = file_identity(path)
        member = "workspace/" + path.relative_to(workspace.root).as_posix()
        expected = manifest["members"].get(member)
        if not expected or any(actual[key] != expected[key] for key in ("bytes", "sha256")):
            raise ValueError("The relocated source identity differs from the original full archive: " + member)

    if state_path.is_file():
        state = json.loads(state_path.read_text(encoding="utf-8-sig"))
        if any(state.get(key) != original.get(key) for key in ("schema", "operation_id", "request", "phases", "source_sha256")):
            raise ValueError("This receiving directory already contains a different original operation.")
    else:
        state = original
    frozen = output / "relocation-original-operation.json"
    if frozen.exists():
        if frozen.read_bytes() != original_bytes:
            raise ValueError("This destination already retains a different original operation snapshot.")
    else:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=output, prefix=".relocation-", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(original_bytes)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, frozen)
            except FileExistsError:
                if frozen.read_bytes() != original_bytes:
                    raise ValueError("A different original operation appeared during relocation.")
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    location = {
        "schema": spec["schema"], "operation_id": original["operation_id"],
        "original_operation": {**file_identity(frozen), "source_path": str(original_path)},
        "specification": {"path": str(specification), "bytes": len(spec_bytes),
                          "sha256": hashlib.sha256(spec_bytes).hexdigest()},
        "original_workspace": str(old_workspace), "workspace": str(workspace.root),
        "original_output": str(old_output), "output": str(output),
        "archives": archives,
        "source_binding": {"study_id": record["study_id"], "version_id": record["version_id"],
                           "source_collection_id": record["source_collection_id"],
                           "source_manifest": record["source_manifest"]},
    }
    history = state.setdefault("receiving_locations", [])
    if not isinstance(history, list):
        raise ValueError("Original receiving location history must remain a list.")
    if location not in history:
        history.append(location)
    atomic_json(state_path, state)
    return state, location


def located_artifact(expected, location):
    """Resolve only the two explicit originals or paths within their saved roots."""
    if location is None:
        return expected["path"]
    source = Path(os.path.normpath(str(Path(expected["path"]).expanduser())))
    if not source.is_absolute():
        raise ValueError("Retained receiving artifacts need their original absolute paths.")
    for archive in location["archives"].values():
        if (expected.get("bytes"), expected.get("sha256")) == (archive["bytes"], archive["sha256"]):
            return archive["path"]
    old_roots = [(Path(location["original_workspace"]), Path(location["workspace"])),
                 (Path(location["original_output"]), Path(location["output"]))]
    for original, received in old_roots:
        if source.is_relative_to(received):
            return str(source)
    for original, received in sorted(old_roots, key=lambda pair: len(pair[0].parts), reverse=True):
        if source.is_relative_to(original):
            return str(received / source.relative_to(original))
    raise ValueError("The retained continuation artifact is outside the explicit original receiving roots: " + str(source))


def continue_saved_review(workspace, output, state, state_path, *, profile="sv833", location=None):
    """Continue a completed native intake using its retained source and selection."""
    from model.common import atomic_json
    from model.portable import backup, restore, inspect_archive
    from model.workspace import Workspace
    from measurement_workspace.published_studies import PublishedStudyStore
    from measurement_workspace.study_reviews import PublishedStudyReviews
    import zipfile

    required = ("import", "original_rows", "selected_report", "complete_study",
                "study_reopen", "project_archive", "project_reopen")
    if any(name not in state.get("phases", {}) for name in required):
        raise ValueError("--saved-review requires the original completed study and project receiving phases.")
    request = state["request"]
    if not state["operation_id"].startswith(profile + "-native-"):
        raise ValueError("Use the original study profile's receiving command for this retained operation.")
    original_workspace = Path(os.path.normpath(request.get("workspace", "")))
    same_path = original_workspace == workspace.root.resolve()
    relocated = (location is not None and location["operation_id"] == state["operation_id"]
                 and Path(location["original_workspace"]) == original_workspace
                 and Path(location["workspace"]) == workspace.root.resolve())
    if request.get("workspace_id") != workspace.project["id"] or not (same_path or relocated):
        raise ValueError("The retained original operation belongs to another Workspace; use explicit verified relocation for a moved original.")
    imported = state["phases"]["import"]
    study_id, version_id = imported["study_id"], imported["version_id"]
    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    reviews = PublishedStudyReviews(store)
    complete = store.get_study(study_id, version_id)
    record = complete["record"]
    if record["source_collection_id"] != imported["source_collection_id"]:
        raise ValueError("The retained native source collection differs from the completed operation.")
    identifiers = {row["original_result_identifier"] for row in complete["observation_rows"]}
    if len(identifiers) != state["phases"]["original_rows"]["result_identifiers"]:
        raise ValueError("The retained source no longer has the completed operation's original result IDs.")
    selection = request["selection"]
    context = store.context(study_id, version_id, **selection)
    # Existing archives are immutable originals; the review has separate paths below.
    for phase in ("complete_study", "project_archive"):
        expected = state["phases"][phase]
        actual = file_identity(located_artifact(expected, location))
        if any(actual[key] != expected[key] for key in ("bytes", "sha256")):
            raise ValueError("The original completed archive changed: " + phase)

    review_request = {
        "study_id": study_id, "version_id": version_id,
        "source_collection_id": record["source_collection_id"],
        "selection": context["selection"], "table": "observed",
        "title": (complete["study"]["title"] + " — selected source review")[:200],
        "notes": "Retained original selection from native receiving operation " + state["operation_id"] + ".",
    }
    course = state.setdefault("continuations", {}).setdefault("saved_review", {
        "schema": "upstate.published-study-review-receiving/v1",
        "request": review_request, "phases": {},
    })
    if course.get("request") != review_request:
        raise ValueError("The saved-review continuation belongs to another original source or selection.")
    course.update(status="running", pid=os.getpid(), interpreter=sys.executable,
                  updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    course.pop("error", None)

    def checkpoint(phase, result):
        course["phases"][phase] = result
        course["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        atomic_json(state_path, state)
        print(json.dumps({"operation_id": state["operation_id"],
                          "continuation": "saved_review", "phase": phase, "result": result},
                         ensure_ascii=False), flush=True)

    def validate_review(value):
        body = value["content"]
        if (body["binding"]["study_id"] != study_id
                or body["binding"]["version_id"] != version_id
                or body["binding"]["source_collection_id"] != record["source_collection_id"]
                or body["selection"] != context["selection"]):
            raise ValueError("The saved review changed its original source edition or selected cohort.")

    def checked_file(expected):
        actual = file_identity(located_artifact(expected, location))
        if any(actual[key] != expected[key] for key in ("bytes", "sha256")):
            raise ValueError("A retained review continuation artifact changed: " + expected["path"])
        return actual

    atomic_json(state_path, state)
    try:
        previous = course["phases"].get("save")
        if previous:
            value = reviews.get(previous["review_id"])["review"]
            if value["content"] != previous["content"]:
                raise ValueError("The saved native review differs from its completed checkpoint.")
            saved = {"review": value, "reused": True}
        else:
            saved = reviews.save({key: value for key, value in review_request.items()
                                  if key != "source_collection_id"})
        value = saved["review"]
        validate_review(value)
        review_id = value["id"]
        checkpoint("save", {"review_id": review_id, "content": value["content"],
                            "saved_at": value["saved_at"], "reused": saved["reused"]})
        reopened = reviews.get(review_id)
        if reopened["review"] != value:
            raise ValueError("Opening the review changed its immutable original record.")
        checkpoint("reopen", {"review_id": review_id,
                              "binding": value["content"]["binding"],
                              "selection": reopened["context"]["selection"],
                              "interpretation_matches_snapshot": reopened["interpretation_matches_snapshot"]})

        export_root = workspace.root / "published_study_exports" / state["operation_id"] / review_id
        previous = course["phases"].get("export")
        if previous:
            export_files = [checked_file(item) for item in previous["files"]]
        else:
            exported = reviews.export(review_id, export_root)
            export_files = [file_identity(path) for path in exported["files"]]
        checkpoint("export", {"review_id": review_id, "files": export_files})
        archives = [item for item in export_files if Path(item["path"]).name == "saved-review.zip"]
        if len(archives) != 1:
            raise ValueError("The original review export must include its complete saved-review.zip.")
        current_path = store.root / study_id / "current.json"
        before = current_path.read_bytes() if current_path.is_file() else None
        received = reviews.receive(Path(archives[0]["path"]),
                                   operation_id=state["operation_id"] + "-saved-review")
        after = current_path.read_bytes() if current_path.is_file() else None
        if before is not None and after != before:
            raise ValueError("Receiving the original saved review changed the workspace's selected study edition.")
        if received["review"] != value:
            raise ValueError("Receiving the review changed its original identity or metadata.")
        selected_head = json.loads(after) if after is not None else None
        checkpoint("receive", {
            "review_id": review_id, "reused": received["reused"],
            "study_reused": received["study_reused"],
            "selected_edition_before": json.loads(before) if before is not None else None,
            "selected_edition_after": selected_head,
            "existing_selected_edition_preserved": before is not None and before == after,
            "selected_edition_differs_from_review": bool(selected_head and selected_head["version_id"] != version_id),
        })

        project_zip = output / (profile + "-" + review_id + "-workspace.zip")
        previous = course["phases"].get("project_archive")
        if previous:
            project = checked_file(previous)
        elif project_zip.is_file():
            project = file_identity(project_zip)
        else:
            project = backup(workspace, project_zip)
        # Verify an interrupted archive before adopting it, including this exact review.
        manifest = inspect_archive(project_zip, verify=previous is None)
        if manifest["project"] != workspace.project:
            raise ValueError("The review-containing archive belongs to another original Workspace.")
        member = "workspace/published_studies/reviews/" + review_id + ".json"
        expected_review = file_identity(reviews._path(review_id))
        if (member not in manifest["members"]
                or any(manifest["members"][member][key] != expected_review[key]
                       for key in ("bytes", "sha256"))):
            raise ValueError("The archive does not retain this exact saved review.")
        head_member = "workspace/published_studies/" + study_id + "/current.json"
        with zipfile.ZipFile(project_zip) as archive:
            archived_head = archive.read(head_member) if head_member in manifest["members"] else None
        project = {**project, "project_id": workspace.project["id"],
                   "members": len(manifest["members"]), "review_id": review_id,
                   "review_member": member,
                   "selected_edition": json.loads(archived_head) if archived_head is not None else None}
        checkpoint("project_archive", project)

        receiving = output / ("reopened-" + review_id)
        previous = course["phases"].get("project_reopen")
        if receiving.exists():
            restored_workspace = Workspace(receiving / "workspace")
            if restored_workspace.project != workspace.project:
                raise ValueError("The saved-review receiving directory belongs to another Workspace.")
            restored = {"workspace": str(restored_workspace.root),
                        "application": str(receiving / "application"),
                        "directory": str(receiving), "project": restored_workspace.project,
                        "archive_sha256": project["sha256"]}
            if previous and previous.get("archive_sha256") != project["sha256"]:
                raise ValueError("The restored review checkpoint belongs to another archive.")
        else:
            restored = restore(project_zip, receiving)
            restored_workspace = Workspace(restored["workspace"])
        restored_store = PublishedStudyStore(restored_workspace, restored_workspace.root / "published_studies")
        restored_review = PublishedStudyReviews(restored_store).get(review_id)
        if restored_review["review"] != value:
            raise ValueError("Workspace restoration changed the original saved review.")
        retained = restored_store.get_study(study_id, version_id)
        if (retained["record"]["source_collection_id"] != record["source_collection_id"]
                or {row["original_result_identifier"] for row in retained["observation_rows"]} != identifiers):
            raise ValueError("Review restoration changed the original source collection or result identifiers.")
        restored_head = restored_store.root / study_id / "current.json"
        if archived_head is not None and restored_head.read_bytes() != archived_head:
            raise ValueError("Workspace restoration changed the archived selected study edition.")
        first = retained["observation_rows"][0]
        native_file, unused = restored_workspace.source_file(
            first["source_selector"]["source_collection_id"], first["source_selector"]["source_id"])
        checkpoint("project_reopen", {
            **restored, "archive_sha256": project["sha256"], "review_id": review_id,
            "binding": value["content"]["binding"], "selection": restored_review["context"]["selection"],
            "original_result_ids": len(identifiers), "first_native_original": file_identity(native_file),
            "selected_edition": project["selected_edition"],
        })
        course.update(status="complete", completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        atomic_json(state_path, state)
        print(json.dumps({"operation_id": state["operation_id"], "continuation": "saved_review",
                          "status": "complete", "review_id": review_id,
                          "operation": file_identity(state_path), "project": project,
                          "receiving": str(receiving)}, ensure_ascii=False), flush=True)
        return 0
    except Exception as error:
        course.update(status="failed", error={"type": type(error).__name__, "message": str(error)})
        atomic_json(state_path, state)
        raise


PROFILES = {
    "three_twenty_2026": {
        "module": "three_twenty_observations", "site_id": "SV-833",
        "title": "Three and Twenty Creek original 2026 observations",
        "results": 242, "activities": 15, "limits": 242,
        "parameter": "Escherichia coli", "year": 2026, "measurements": 142,
    },
    "sv833": {
        "module": "sv833_observations", "site_id": "SV-833",
        "title": "SV-833 original observations and scientific reports",
        "results": 610, "activities": 56, "limits": 606, "measurements": 575,
        "parameter": "Escherichia coli",
    },
    "rl18151": {
        "module": "rl18151_observations", "site_id": "RL-18151",
        "title": "RL-18151 original observations and scientific reports",
        "results": 498, "activities": 40, "limits": 447, "parameter": "Phosphorus",
    },
}



def main(argv=None, *, profile="sv833"):
    expected = PROFILES[profile]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--create-workspace", action="store_true")
    parser.add_argument("--saved-review", action="store_true",
                        help="Continue an existing completed operation with its exact saved source and review transfer.")
    parser.add_argument("--relocate-receiving", type=Path,
                        help="With --saved-review, verify an explicit original-operation and archive location specification.")
    parser.add_argument("--scientific-report", type=Path,
                        help="After --saved-review, continue exact original and hydrology reviews through scientific reports and editable Study receiving.")
    parser.add_argument("--year", type=int, default=expected.get("year", 2025))
    parser.add_argument("--parameter", default=expected["parameter"])
    args = parser.parse_args(argv)
    if args.relocate_receiving and (not args.saved_review or args.create_workspace):
        parser.error("--relocate-receiving requires --saved-review and an already restored original Workspace.")
    if args.scientific_report and (not args.saved_review or args.create_workspace):
        parser.error("--scientific-report requires --saved-review and the original completed Workspace.")
    application = args.application.expanduser().resolve(strict=True)
    workspace_path = args.workspace.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if workspace_path == application or workspace_path.is_relative_to(application):
        parser.error("--workspace must be outside the application source tree.")
    if output == workspace_path or output.is_relative_to(workspace_path):
        parser.error("--output must be outside the Workspace so its project archive cannot include itself.")
    if output == application or output.is_relative_to(application):
        parser.error("--output must be outside the application source tree.")
    sys.path.insert(0, str(application))
    from model.common import atomic_json, held
    from model.workspace import Workspace
    from model.portable import backup, restore, inspect_archive
    from measurement_workspace.published_studies import PublishedStudyStore
    adapter = importlib.import_module("measurement_workspace." + expected["module"])

    manifest_exists = (workspace_path / "workspace.json").is_file()
    if not manifest_exists and not args.create_workspace:
        parser.error("Select an existing Workspace or explicitly use --create-workspace.")
    if args.saved_review and not manifest_exists:
        parser.error("--saved-review requires the original completed Workspace.")
    workspace = Workspace(workspace_path, create=not manifest_exists,
                          title=expected["title"])
    output.mkdir(parents=True, exist_ok=True)
    selection = {"site_ids": [expected["site_id"]], "year": args.year,
                 "parameters": [args.parameter], "strata": [], "months": []}
    state_path = output / "operation.json"
    request = {"workspace_id": workspace.project["id"], "workspace": str(workspace_path),
               "application": str(application), "selection": selection,
               "study_id": adapter.BUILTIN_ID}
    operation_id = profile + "-native-" + hashlib.sha256(
        json.dumps(request, sort_keys=True).encode("utf-8")).hexdigest()[:24]
    with held(output / ("." + profile + "-receiving.lock"), blocking=False):
        if args.saved_review:
            location = None
            if args.relocate_receiving:
                state, location = reconcile_receiving_locations(workspace, output, state_path,
                                                                 args.relocate_receiving)
            else:
                if not state_path.is_file():
                    parser.error("--saved-review requires the original receiving/operation.json.")
                state = json.loads(state_path.read_text(encoding="utf-8"))
            result = continue_saved_review(workspace, output, state, state_path,
                                           profile=profile, location=location)
            if args.scientific_report:
                from source_tools.continue_study_report import continue_report
                return continue_report(workspace, output, state, state_path, args.scientific_report)
            return result
        if state_path.is_file():
            state = json.loads(state_path.read_text(encoding="utf-8"))
            if state.get("request") != request:
                raise ValueError("This receiving directory belongs to another original Workspace or selection.")
        else:
            state = {"schema": "upstate.published-study-receiving/v1",
                     "operation_id": operation_id, "request": request, "phases": {}}
        state.update(pid=os.getpid(), interpreter=sys.executable, status="running",
                     updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

        def checkpoint(phase, result):
            state["phases"][phase] = result
            state["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            atomic_json(state_path, state)
            print(json.dumps({"operation_id": operation_id, "phase": phase, "result": result},
                             ensure_ascii=False), flush=True)

        atomic_json(state_path, state)
        print(json.dumps({"operation_id": operation_id, "pid": os.getpid(),
                          "workspace_id": workspace.project["id"],
                          "workspace": str(workspace_path), "output": str(output)}), flush=True)
        try:
            source, evidence = adapter.builtin_companion(application)
            source_hash = hashlib.sha256(source).hexdigest()
            previous_source = state.get("source_sha256")
            if previous_source is not None and previous_source != source_hash:
                raise ValueError("The installed source edition changed; receive it in a new output directory.")
            state["source_sha256"] = source_hash
            store = PublishedStudyStore(workspace, workspace.root / "published_studies")
            imported = store.import_source(source, evidence=evidence, operation_id=operation_id)
            record = imported["record"]
            study_id, version_id = record["study_id"], record["version_id"]
            checkpoint("import", {
                "study_id": study_id, "version_id": version_id,
                "source_collection_id": record["source_collection_id"],
                "source_files": len(record["source_files"]), "counts": record["counts"],
            })
            complete = store.get_study(study_id, version_id)
            rows = complete["observation_rows"]
            original_ids = {row["original_result_identifier"] for row in rows}
            if len(rows) != expected["results"] or len(original_ids) != expected["results"]:
                raise ValueError("Native intake did not retain every distinct original result identifier.")
            if len({row["activity_id"] for row in rows}) != expected["activities"]:
                raise ValueError("Native intake changed the original activity cohort.")
            if any(not row.get("metadata_source_records", {}).get("activity", {}).get("source_selector")
                   for row in rows):
                raise ValueError("An original activity metadata join lost its native source selector.")
            limits = sum("reporting_limit" in row.get("metadata_source_records", {}) for row in rows)
            if limits != expected["limits"]:
                raise ValueError("Native intake changed the original reporting-limit coverage.")
            checkpoint("original_rows", {
                "result_identifiers": len(original_ids), "activities": expected["activities"], "reporting_limit_records": limits,
                "quantified": sum(row["value"] is not None and not row["censored"] for row in rows),
                "below_limit": sum(row["censor_direction"] == "below" for row in rows),
                "above_limit": sum(row["censor_direction"] == "above" for row in rows),
                "source_manifest": record["source_manifest"],
            })
            if "measurements" in expected:
                all_context = store.context(study_id, version_id)
                original_count = len(all_context["observations"]["rows"])
                weighted = all_context["observations"].get("statistics_rows", [])
                if original_count != expected["results"] or len(weighted) != expected["measurements"]:
                    raise ValueError("The original-ID and activity-weighted native cohort differ.")
                checkpoint("activity_weighting", {
                    "original_result_ids": original_count, "activity_measurements": len(weighted),
                    "statistic_basis": all_context["observations"]["statistic_basis"],
                })
            export_root = workspace.root / "published_study_exports" / operation_id
            prior_selected = state["phases"].get("selected_report")
            if prior_selected is not None:
                for artifact in prior_selected["files"]:
                    identity = file_identity(artifact["path"])
                    if any(identity[key] != artifact[key] for key in ("bytes", "sha256")):
                        raise ValueError("A saved selected-report member differs from its original operation.")
                selected = prior_selected
            else:
                selected = store.export_context(study_id, export_root / "selected", version_id, **selection)
            checkpoint("selected_report", selected)
            study_zip = export_root / (profile + "-study.zip")
            prior_export = state["phases"].get("complete_study")
            if study_zip.is_file() and prior_export is not None:
                identity = file_identity(study_zip)
                if any(identity[key] != prior_export[key] for key in ("bytes", "sha256")):
                    raise ValueError("The existing complete study archive differs from its retained operation.")
                exported = prior_export
            else:
                exported = store.export_study(study_id, study_zip, version_id)
            checkpoint("complete_study", exported)
            reopened = store.import_source(study_zip)["record"]
            if (reopened["study_id"], reopened["version_id"], reopened["source_collection_id"]) != (
                    study_id, version_id, record["source_collection_id"]):
                raise ValueError("Complete-study reopening changed its native source or edition identity.")
            checkpoint("study_reopen", {key: reopened[key] for key in
                                      ("study_id", "version_id", "source_collection_id")})
            project_zip = output / (profile + "-scientific-workspace.zip")
            prior_project = state["phases"].get("project_archive")
            if project_zip.is_file():
                if prior_project is None:
                    manifest = inspect_archive(project_zip, verify=True)
                    if manifest["project"] != workspace.project:
                        raise ValueError("The existing project archive belongs to another Workspace.")
                    project = {**file_identity(project_zip), "project_id": workspace.project["id"],
                               "members": len(manifest["members"])}
                else:
                    identity = file_identity(project_zip)
                    if any(identity[key] != prior_project[key] for key in ("bytes", "sha256")):
                        raise ValueError("The existing project archive differs from its retained operation.")
                    project = prior_project
            else:
                project = backup(workspace, project_zip)
            checkpoint("project_archive", project)
            receiving = output / "reopened-project"
            if receiving.exists():
                restored_workspace = Workspace(receiving / "workspace")
                if restored_workspace.project != workspace.project:
                    raise ValueError("The receiving directory belongs to a different original Workspace.")
                restored = {"workspace": str(restored_workspace.root),
                            "application": str(receiving / "application"),
                            "directory": str(receiving), "project": restored_workspace.project,
                            "archive_sha256": project["sha256"], "identity": "MATCH"}
            else:
                restored = restore(project_zip, receiving)
                restored_workspace = Workspace(restored["workspace"])
            restored_store = PublishedStudyStore(restored_workspace,
                                                  restored_workspace.root / "published_studies")
            retained = restored_store.get_study(study_id, version_id)
            if (retained["record"]["source_collection_id"] != record["source_collection_id"]
                    or {row["original_result_identifier"] for row in retained["observation_rows"]} != original_ids):
                raise ValueError("Project reopening changed the original study source or result identifiers.")
            # This source file read resolves through the restored native collection,
            # rebuilding its original source view and checking the retained body.
            first = retained["observation_rows"][0]
            native_file, unused = restored_workspace.source_file(
                first["source_selector"]["source_collection_id"], first["source_selector"]["source_id"])
            checkpoint("project_reopen", {
                **restored, "study_id": study_id, "version_id": version_id,
                "source_collection_id": record["source_collection_id"], "original_result_ids": expected["results"],
                "first_native_original": file_identity(native_file),
            })
            state["status"] = "complete"
            state["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            atomic_json(state_path, state)
            print(json.dumps({"operation_id": operation_id, "status": "complete",
                              "operation": file_identity(state_path),
                              "workspace": str(workspace.root), "project": project,
                              "receiving": str(receiving)}, ensure_ascii=False), flush=True)
        except Exception as error:
            state.update(status="failed", error={"type": type(error).__name__, "message": str(error)})
            atomic_json(state_path, state)
            raise


if __name__ == "__main__":
    main()
