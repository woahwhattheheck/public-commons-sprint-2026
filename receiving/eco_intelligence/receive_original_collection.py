#!/usr/bin/env python3
"""Receive selected originals through the installed Operator queue and downloads."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import time
import zipfile


def file_sha(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def run(application, workspace, state_directory, selected_refs=None, timeout=180,
        require_declared_companions=False):
    application, workspace = Path(application).resolve(), Path(workspace).resolve()
    state_directory = Path(state_directory).resolve()
    state_directory.mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(application / "operator"), str(application)]
    from server import Operator, Fault
    from intelligence import IntelligenceFeature
    from eco_intelligence.adapters import CatalogRepository
    from science_catalog_delivery import bundle, verify_delivery

    def complete(operator, task):
        deadline = time.monotonic() + timeout
        while task["state"] in {"queued", "running"}:
            if time.monotonic() >= deadline:
                raise TimeoutError("Original task still active: " + task["id"])
            time.sleep(0.1)
            task = operator.task(task["id"])
        if task["state"] != "complete":
            raise RuntimeError(json.dumps(task, ensure_ascii=False))
        return task

    def controller(operator):
        if not operator.extensions.handles_action("intelligence.collection.export"):
            raise RuntimeError("Receive the current registry and selected-source overlay in this application.")
        return IntelligenceFeature(operator, Fault)

    operator = Operator(workspace, state_directory)
    try:
        key, feature = operator.primary, controller(operator)
        project = operator.ws(key).project["id"]
        source_rows = list(feature.integration.engine(key).repo.read_records(key, "dataset"))
        source_by_id = {row["id"]: row for row in source_rows}
        selection_path = state_directory / "original-collection-selection.json"
        if selection_path.is_file():
            selection = json.loads(selection_path.read_text(encoding="utf-8"))
            if selection["project_id"] != project:
                raise RuntimeError("The retained receiving selection belongs to another original project.")
            refs = selection["refs"]
            if selected_refs is not None and selected_refs != refs:
                raise ValueError("Use the retained receiving references or a separate receiving state.")
        else:
            choices = feature.read(key, "collection_sources", {})["sources"]
            if selected_refs is None:
                datasets = [row for row in choices if row["ref"]["kind"] == "dataset"]
                def rank(row):
                    label = str(row.get("label", "")) + " " + str(row.get("filename", ""))
                    water = any(word in label.lower() for word in ("drinking", "water", "county"))
                    metadata = row.get("metadata") or {}
                    binding = metadata.get("source_binding") or {}
                    declared = (binding.get("role") == "primary"
                                and bool((metadata.get("source") or {}).get("companions")))
                    return (not declared, not water, json.dumps(row["ref"], sort_keys=True))
                refs = [row["ref"] for row in sorted(datasets, key=rank)[:2]]
            else:
                refs = selected_refs
            known = {json.dumps(row["ref"], sort_keys=True) for row in choices}
            if not refs or any(json.dumps(ref, sort_keys=True) not in known for ref in refs):
                raise ValueError("Choose actual registered original references in this Workspace.")
            selection = {"project_id": project, "refs": refs}
            selection_path.write_text(json.dumps(selection, ensure_ascii=False, indent=2) + "\n",
                                      encoding="utf-8")

        if "expected_companions" not in selection:
            expected_companions = []
            for ref in refs:
                if ref["kind"] != "dataset":
                    continue
                row = source_by_id[ref["id"]]
                metadata = row.get("metadata") or {}
                binding = metadata.get("source_binding") or {}
                if metadata.get("native_kind") != "retained_source" or binding.get("role") != "primary":
                    continue
                for body in (metadata.get("source") or {}).get("companions", []):
                    member = body.get("view_path", body["filename"])
                    matches = [candidate for candidate in source_rows
                               if (candidate.get("metadata") or {}).get("source_binding") == {
                                   "collection_id": binding["collection_id"],
                                   "source_id": binding["source_id"],
                                   "member": member, "role": "companion"}]
                    if len(matches) != 1:
                        raise AssertionError("An original declared companion has no unique native binding.")
                    companion = matches[0]
                    path = Path(companion["path"])
                    path = (path if path.is_absolute() else workspace / path).resolve()
                    expected_companions.append({
                        "primary_id": ref["id"], "source_dataset_id": companion["id"],
                        "member": member, "path": path.relative_to(workspace).as_posix(),
                        "bytes": body["bytes"], "sha256": body["sha256"],
                    })
            selection["expected_companions"] = expected_companions
            selection_path.write_text(json.dumps(selection, ensure_ascii=False, indent=2) + "\n",
                                      encoding="utf-8")
        expected_companions = selection["expected_companions"]
        if require_declared_companions and not expected_companions:
            raise ValueError("Select an actual retained source primary with declared companions in this Workspace.")

        creation_body = {"title": "Original source collection receiving"}
        create_op = "eco264b_original_collection_create"
        creation = complete(operator, operator.submit(
            key, "intelligence.session.create", creation_body, create_op))
        sid = creation["result"]["session_id"]
        payload = {"session_id": sid, "title": "Original scientific source collection", "refs": refs}
        export_op = "eco264b_original_collection_export"
        exported = complete(operator, operator.submit(
            key, "intelligence.collection.export", payload, export_op))
        replay = operator.submit(key, "intelligence.collection.export", payload, export_op)
        if replay["id"] != exported["id"]:
            raise AssertionError("The original operation produced another task.")
        collection_id = exported["result"]["collection_id"]
        original_view = feature.read(key, "collection", {
            "session_id": sid, "collection_id": collection_id})
        ticket = next(item for item in original_view["files"] if item["format"] == "zip")
        archive_path = state_directory / "original-source-collection.zip"
        original_file, item = operator.open_download(ticket["id"])
        try:
            with archive_path.open("wb") as output:
                for block in iter(lambda: original_file.read(1024 * 1024), b""):
                    output.write(block)
        finally:
            original_file.close()
        if archive_path.stat().st_size != ticket["bytes"] or file_sha(archive_path) != ticket["sha256"]:
            raise AssertionError("The downloaded archive differs from the original native ticket.")
    finally:
        operator.close()

    extracted = state_directory / "received-original-collection"
    extracted.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            path = PurePosixPath(member.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in member.filename:
                raise ValueError("Unexpected archive member.")
        archive.extractall(extracted)
    received = verify_delivery(extracted)
    if not (extracted / "START.html").is_file():
        raise AssertionError("The original-file browser was not included.")
    catalog = json.loads((extracted / "catalog.json").read_text(encoding="utf-8"))
    repository = CatalogRepository(extracted / "catalog.json", extracted)
    original_tenant = next(iter(catalog["tenants"]))
    reopened_files = []
    for ref in refs:
        path, metadata = repository.path(original_tenant, ref)
        reopened_files.append({"ref": ref, "filename": path.name,
                               "bytes": path.stat().st_size, "sha256": file_sha(path)})

    if received["files"] != original_view["copied_files"]:
        raise AssertionError("The received collection did not retain its full original file set.")
    tenant = catalog["tenants"][original_tenant]
    required_files = []
    for expected in expected_companions:
        path = extracted / tenant["root"] / expected["path"]
        if path.stat().st_size != expected["bytes"] or file_sha(path) != expected["sha256"]:
            raise AssertionError("A declared original companion was omitted or changed during transfer.")
        primary = next(row for row in tenant["datasets"] if row["id"] == expected["primary_id"])
        retained = [item for item in primary["metadata"]["retained_companions"]
                    if item.get("source_dataset_id") == expected["source_dataset_id"]]
        if len(retained) != 1 or any(retained[0].get(field) != expected[field]
                                     for field in ("path", "bytes", "sha256")):
            raise AssertionError("The received companion lost its original dataset identity.")
        required_files.append({**expected, "verified": True})
    portable_continuation = None
    if required_files:
        continuation = state_directory / "reexported-original-collection"
        continued = bundle(catalog, extracted, continuation,
                           [{"tenant_id": original_tenant, **ref} for ref in refs])
        portable_continuation = verify_delivery(continuation)
        if (continued["selected_records"] != len({json.dumps(ref, sort_keys=True) for ref in refs})
                or continued["files"] != json.loads(
                    (extracted / "delivery.json").read_text(encoding="utf-8"))["files"]):
            raise AssertionError("Portable continuation changed selected records or their required originals.")

    operator = Operator(workspace, state_directory)
    try:
        key, feature = operator.primary, controller(operator)
        reopened = feature.read(key, "collection", {
            "session_id": sid, "collection_id": collection_id})
        new_ticket = next(item for item in reopened["files"] if item["format"] == "zip")
        if (new_ticket["id"], new_ticket["sha256"], reopened["catalog_sha256"]) != (
                ticket["id"], ticket["sha256"], original_view["catalog_sha256"]):
            raise AssertionError("Restart changed the retained collection identity.")
        resumed = operator.submit(key, "intelligence.collection.export", payload, export_op)
        if resumed["id"] != exported["id"] or resumed["result"]["collection_id"] != collection_id:
            raise AssertionError("Restart replay changed the original collection.")
        decorated = operator.task_view(exported["id"])
        if not any(row["id"] == new_ticket["id"] for row in decorated.get("_downloads", [])):
            raise AssertionError("The original task did not reopen its collection download.")
        original_file, _ = operator.open_download(new_ticket["id"])
        original_file.close()
        result = {"status": "passed", "project_id": project,
                  "workspace_key": key, "session_id": sid, "task_id": exported["id"],
                  "collection_id": collection_id, "selected_original_refs": refs,
                  "zip": {"bytes": ticket["bytes"], "sha256": ticket["sha256"]},
                  "received": received, "reopened_files": reopened_files,
                  "declared_companions": required_files,
                  "portable_companion_continuation": portable_continuation,
                  "replay_same_task": True, "restart_same_collection": True,
                  "native_task_download_reopened": True}
        (state_directory / "collection-receiving-result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return result
    finally:
        operator.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--selected-refs", type=Path)
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--require-declared-companions", action="store_true")
    args = parser.parse_args()
    selected = json.loads(args.selected_refs.read_text(encoding="utf-8")) if args.selected_refs else None
    print(json.dumps(run(args.application, args.workspace, args.state_directory,
                         selected, args.timeout, args.require_declared_companions),
                     ensure_ascii=False, indent=2))
