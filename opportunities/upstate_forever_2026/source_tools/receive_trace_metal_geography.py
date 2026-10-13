"""Receive the exact original trace-metal geography and independently reopen its sources."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import zipfile

from model.common import atomic_bytes, atomic_json, describe_file, digest, held, read_json, verify_file
from model.workspace import Workspace
from model import portable, station_geography
from model import trace_metal_geography as trace_geo
from measurement_workspace.published_studies import PublishedStudyStore
from measurement_workspace import trace_metal_observations as trace
from source_tools.receive_trace_metal_study import _original_source

SCHEMA = "upstate.trace-metal-geography-receiving/v1"


def _require(value, message):
    if not value:
        raise ValueError(message)


def _study(workspace, output, requested_version):
    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    path = output / "study-edition.json"
    if path.exists():
        binding = read_json(path)
        record = store._record(binding["study_id"], binding["version_id"])
    else:
        if requested_version:
            record = store._record(trace.BUILTIN_ID, requested_version)
        else:
            source, unused_capture = _original_source(output, Path(__file__).resolve().parents[1])
            imported = store.import_source(source, operation_id="trace-geography-" + digest({
                "project_id": workspace.project["id"], "output": str(output)}), make_current=False)
            record = imported["record"]
        binding = {key: record[key] for key in ("study_id", "version_id", "bundle_sha256", "source_collection_id")}
        atomic_json(path, binding, immutable=True)
    _require(all(record[key] == value for key, value in binding.items()),
             "Continue the exact retained trace study version and native source collection.")
    _require(requested_version is None or record["version_id"] == requested_version,
             "The requested study version differs from the retained operation.")
    return store, record


def _export_study(store, record, output):
    archive = output / "original-trace-study.zip"
    marker = output / "original-trace-study-export.json"
    if marker.exists():
        value = read_json(marker)
        verify_file(output, value["archive"])
    else:
        if not archive.exists():
            store.export_study(record["study_id"], archive, record["version_id"])
        # Recover an export completed before its outer checkpoint without re-zipping timestamps.
        with zipfile.ZipFile(archive) as saved:
            document = json.loads(saved.read("published-study-export.json"))
            original = document["record"]
            _require(original["study_id"] == record["study_id"]
                     and original["version_id"] == record["version_id"]
                     and original["bundle_sha256"] == record["bundle_sha256"]
                     and document["source_files"] == record["source_files"],
                     "The completed original study archive belongs to another source edition.")
            for item in record["source_files"]:
                raw = saved.read("source/" + item["path"])
                _require(len(raw) == item["bytes"] and trace._sha(raw) == item["sha256"],
                         "An original study archive member changed: " + item["path"])
        value = {"study_id": record["study_id"], "version_id": record["version_id"],
                 "bundle_sha256": record["bundle_sha256"],
                 "archive": describe_file(output, archive)}
        atomic_json(marker, value, immutable=True)
    return archive, value


def _original_package(workspace, operation, output):
    item = next(item for item in operation["files"] if Path(item["path"]).name == "station-geography.zip")
    path = verify_file(workspace.root, item)
    target = output / "original-station-geography.zip"
    atomic_bytes(target, path.read_bytes(), immutable=True)
    return target, describe_file(output, target)


def _check_original_study(store, record):
    restored = store.get_study(record["study_id"], record["version_id"])["record"]
    _require(restored["bundle_sha256"] == record["bundle_sha256"]
             and restored["source_files"] == record["source_files"],
             "Reopened trace source records differ from the original complete edition.")
    for item in record["source_files"]:
        path, unused = store.source_file(record["study_id"], item["path"], record["version_id"])
        _require(path.stat().st_size == item["bytes"] and trace._sha(path.read_bytes()) == item["sha256"],
                 "A reopened original source file changed: " + item["path"])
    return {key: restored[key] for key in ("study_id", "version_id", "bundle_sha256", "source_collection_id")}


def _receive_geography(output, geography_archive, study_archive, record, expected):
    root = output / "independent-geography" / "workspace"
    admission = output / "independent-geography-request.json"
    request = {"schema": SCHEMA, "original_project_id": None,
               "geography_archive": describe_file(output, geography_archive),
               "study_archive": describe_file(output, study_archive),
               "study_id": record["study_id"], "version_id": record["version_id"],
               "snapshot_sha256": digest(expected)}
    if admission.exists():
        _require(read_json(admission) == request, "Continue the same independent original-source receiving.")
    else:
        _require(not root.exists(), "Choose an unused independent geography Workspace.")
        atomic_json(admission, request, immutable=True)
    receiver = Workspace(root, create=True, title="Received original trace-metal station geography")
    store = PublishedStudyStore(receiver, receiver.root / "published_studies")
    with held(receiver.root / ".workspace.lock", blocking=False):
        store.import_source(study_archive, operation_id="trace-geography-receive-" + digest(request),
                            make_current=False)
        received = station_geography.receive(receiver, geography_archive)
        verified, snapshot = trace_geo.verify_edition(receiver, received["id"], expected=expected)
        original = _check_original_study(store, record)
    result = {"project_id": receiver.project["id"], "workspace": str(receiver.root),
              "station_geography_id": verified["id"], "build_id": verified["build_id"],
              "summary": verified["summary"], "snapshot_sha256": digest(snapshot),
              "original_study": original, "files": verified["files"]}
    atomic_json(output / "independent-geography.json", result, immutable=True)
    return result


def _receive_project(workspace, output, operation, record, expected):
    archive = output / "original-trace-geography-project.zip"
    marker = output / "project-archive.json"
    if marker.exists():
        metadata = read_json(marker)
        verify_file(output, metadata["archive"])
    else:
        if not archive.exists():
            portable.backup(workspace, archive)
        manifest = portable.inspect_archive(archive, verify=True)
        _require(manifest["project"]["id"] == workspace.project["id"],
                 "The completed project archive belongs to another original Workspace.")
        metadata = {"archive": describe_file(output, archive), "project_id": workspace.project["id"]}
        atomic_json(marker, metadata, immutable=True)
    destination = output / "received-project"
    received = (portable.resume_restore(archive, destination,
                    expected_archive_sha256=metadata["archive"]["sha256"])
                if destination.exists() else portable.restore(archive, destination))
    received = {key: value for key, value in received.items() if key != "reused_completed_output"}
    reopened = Workspace(received["workspace"])
    edition, snapshot = trace_geo.verify_edition(reopened, operation["station_geography_id"], expected=expected)
    source = _check_original_study(PublishedStudyStore(reopened, reopened.root / "published_studies"), record)
    _require(reopened.project["id"] == workspace.project["id"],
             "The full editable project identity changed during receiving.")
    result = {**received, "station_geography_id": edition["id"], "summary": edition["summary"],
              "snapshot_sha256": digest(snapshot), "original_study": source,
              "archive": metadata["archive"]}
    atomic_json(output / "received-project.json", result, immutable=True)
    return result


def receive(workspace, output, *, version_id=None, domain_mode="auto",
            resume=False, geography_only=False):
    workspace = workspace if isinstance(workspace, Workspace) else Workspace(workspace)
    output = Path(output).expanduser().resolve()
    application = Path(__file__).resolve().parents[1]
    _require(not output.is_relative_to(workspace.root) and not workspace.root.is_relative_to(output)
             and not output.is_relative_to(application),
             "Use a separate receiving directory outside the original Workspace and application.")
    _require(domain_mode in trace_geo.DOMAIN_MODES, "Choose point-only, optional or required original-domain support.")
    request = {"schema": SCHEMA, "project_id": workspace.project["id"], "workspace": str(workspace.root),
               "output": str(output), "version_id": version_id, "domain_mode": domain_mode,
               "geography_only": bool(geography_only)}
    output.mkdir(parents=True, exist_ok=True)
    owned = False
    try:
        with held(output / ".operation.lock", blocking=False):
            owned = True
            request_path = output / "request.json"
            if request_path.exists():
                _require(resume and read_json(request_path) == request,
                         "Resume with the exact original Workspace, source request and output.")
            else:
                _require(not resume, "Start the original receiving operation before requesting resume.")
                atomic_json(request_path, request, immutable=True)
            with held(workspace.root / ".workspace.lock", blocking=False):
                store, record = _study(workspace, output, version_id)
                preparation_path = output / "preparation.json"
                if preparation_path.exists():
                    preparation = read_json(preparation_path)
                    retained = trace_geo.inspect_preparation(workspace, preparation["id"])
                    _require(retained == preparation, "The frozen original geography selection changed.")
                else:
                    prepared = trace_geo.preview(workspace, version_id=record["version_id"],
                                                 domain_mode=domain_mode)
                    preparation = trace_geo.retain(workspace, prepared)
                    atomic_json(preparation_path, preparation, immutable=True)
                operation = trace_geo.build(workspace, preparation_id=preparation["id"],
                                            expected_preview_id=preparation["id"])
                edition, expected = trace_geo.verify_edition(workspace, operation["station_geography_id"])
                atomic_json(output / "original-geography-operation.json", operation, immutable=True)
                atomic_json(output / "original-science.json", expected, immutable=True)
                study_archive, study_export = _export_study(store, record, output)
                geography_archive, geography_export = _original_package(workspace, operation, output)
            independent = _receive_geography(output, geography_archive, study_archive, record, expected)
            project = None if geography_only else _receive_project(workspace, output, operation, record, expected)
            result = {"schema": SCHEMA, "state": "complete", "request": request,
                "project_id": workspace.project["id"], "original_study": {
                    key: record[key] for key in ("study_id", "version_id", "bundle_sha256", "source_collection_id")},
                "preparation_id": preparation["id"], "station_geography_id": operation["station_geography_id"],
                "summary": edition["summary"], "snapshot_sha256": digest(expected),
                "original_study_archive": study_export["archive"],
                "original_geography_archive": geography_export,
                "independent_geography": independent, "received_project": project,
                "browser_use": "Open the retained edition in Station geography; inspect original rows, map, watershed memberships, downloads and the Published studies station handoff."}
            atomic_json(output / "receiving.json", result, immutable=True)
            return result
    except Exception as error:
        if owned:
            try:
                atomic_json(output / "last-exception.json", {"schema": SCHEMA, "request": request,
                    "type": type(error).__name__, "message": str(error)})
            except OSError:
                pass
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--version-id")
    parser.add_argument("--domain-mode", choices=trace_geo.DOMAIN_MODES, default="auto")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--geography-only", action="store_true",
                        help="Receive the full native geography and original-study ZIPs without another whole-project archive")
    args = parser.parse_args(argv)
    result = receive(args.workspace, args.output, version_id=args.version_id, domain_mode=args.domain_mode,
                     resume=args.resume, geography_only=args.geography_only)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
