"""Receive original Gauge sources, publish a saved report, and reopen editable studies."""
from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import sys
import stat
import subprocess
import zipfile
from pathlib import Path

from model import gauge_support, portable
from model.common import atomic_bytes, atomic_json, describe_file, file_digest, read_json, now, digest, held, verify_file
from model.workspace import Workspace

DAILY_FILES = (
    "original/usgs-stations-expanded.tsv",
    "original/usgs-discharge-series-catalog.tsv",
    *(f"original/usgs-huc05-07-daily-discharge-{year}.tsv" for year in range(2020, 2026)),
    "source-manifest.json", "derived/daily-discharge.csv",
    "derived/station-year-coverage.csv", "derived/station-year-coverage.json",
    "derive-discharge.mjs", "README.md",
)
COVERAGE_PATH = "derived/station-year-coverage.json"
COVERAGE_ID = "usgs-huc05-07-daily-flow-coverage-20261013"
POINT_ID = "nldi-daily-flow-gauge-locations-20261013"
CATCHMENT_ID = "nldi-daily-flow-whole-catchments-20261013"


def _path(root, member):
    if not isinstance(member, str) or not member or "\\" in member:
        raise ValueError("Use a canonical original source member")
    relative = Path(member)
    if relative.is_absolute() or any(part in ("", ".", "..") for part in member.split("/")):
        raise ValueError("Original source member leaves its edition")
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("Original source member leaves its edition: " + member)
    return path


def prepare_coverage(source_root, output):
    """Retain all original14 members and register only their exact coverage array."""
    source_root = Path(source_root).resolve(strict=True)
    output = Path(output).resolve()
    if output == source_root or output.is_relative_to(source_root):
        raise ValueError("Use a separate prepared output directory for the original coverage")
    original = read_json(source_root / "source-manifest.json")
    if original.get("schema") != "upstate.original-discharge-source/v1":
        raise ValueError("Choose the maintained original-discharge-source/v1 edition")
    originals = original.get("originals")
    if not isinstance(originals, list) or len(originals) != 8:
        raise ValueError("Retain the original station inventory, series catalogue and six annual bodies")
    for item in originals:
        path = _path(source_root, item["path"])
        if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
            raise ValueError("An original discharge member differs from its captured manifest: " + item["path"])
    descriptors = {}
    for member in DAILY_FILES:
        path = _path(source_root, member)
        body = path.read_bytes()
        atomic_bytes(output / member, body, immutable=True)
        descriptors[member] = {"path": member, "bytes": len(body), "sha256": file_digest(path)}
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "Original USGS HUC05–07 daily-flow calendar coverage, 2020–2025",
        "captured_at": original.get("captured_at") or "2026-10-13",
        "notes": [
            "The primary file is the unchanged original derived coverage array.",
            "The complete original14 source family is retained, including six original annual responses and the original derivation.",
            "Approved, estimated and provisional qualifier flags can overlap.",
            "Daily observed-water measurement import remains the original maintained flow intake.",
        ],
        "entries": [{
            "id": COVERAGE_ID, "title": "Original gauge / series / calendar-year flow coverage",
            "kind": "table", "role": "daily-flow-coverage", "format": "json",
            "uri": original["source_request"] if isinstance(original.get("source_request"), str)
                and original["source_request"].startswith(("https://", "http://")) else
                "https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791863575555249",
            "vintage": "USGS-original-daily-2020-2025-captured-20261013",
            **descriptors[COVERAGE_PATH],
            "companions": [descriptors[member] for member in DAILY_FILES if member != COVERAGE_PATH],
        }],
    }
    atomic_json(output / "model-sources.json", manifest, immutable=True)
    return output / "model-sources.json"


def _reference(collection, source_id):
    entry = next((row for row in collection["entries"] if row["id"] == source_id), None)
    if entry is None:
        raise ValueError("The imported original edition omits " + source_id)
    return {"collection_id": collection["id"], "source_id": source_id,
            "source_sha256": entry["body"]["sha256"]}



def _same_file(record, expected):
    return all(record.get(key) == expected.get(key) for key in ("path", "bytes", "sha256"))


def _selection_matches(edition, selection):
    actual = edition["selection"]
    for key, value in selection.items():
        if key == "reporting_huc12s":
            value = sorted(value)
        if actual.get(key) != value:
            raise ValueError("The saved gauge edition belongs to another source selection: " + key)


def _selected_members(workspace, edition):
    """Exact existing records needed to reopen this original report and source choice."""
    selected = {}
    def keep(path):
        path = Path(path)
        relative = path.relative_to(workspace.root).as_posix()
        selected["workspace/" + relative] = describe_file(workspace.root, path)
    keep(workspace.root / "workspace.json")
    keep(workspace.root / gauge_support.KIND / (edition["id"] + ".json"))
    station = gauge_support.geography.inspect(workspace, edition["station_edition_id"], verify=True)
    keep(workspace.root / gauge_support.geography.KIND / (station["id"] + ".json"))
    collections = set()
    def keep_collection(key):
        if key in collections:
            return
        collection = workspace._get("sources", key)
        keep(workspace.root / "sources" / (key + ".json"))
        for entry in collection["entries"]:
            for item in [entry["body"], *entry.get("companions", [])]:
                keep(workspace.root / item["object"])
        collections.add(key)
    for row in (edition, station):
        for item in row["files"]:
            keep(workspace.root / item["path"])
        for binding in row["sources"]:
            gauge_support.geography._source(workspace, binding)
            keep_collection(binding["collection_id"])
    if station.get("source_collection_id"):
        keep_collection(station["source_collection_id"])
    for key in station.get("observation_ids", []):
        observation = workspace._get("observations", key)
        keep(workspace.root / "observations" / (key + ".json"))
        keep(workspace.root / observation["original"]["object"])
    regional = workspace.root / "watershed-context" / edition["regional"]["report_id"]
    for path in sorted(regional.rglob("*")):
        if path.is_file() and not path.name.endswith((".lock", ".pyc", ".pyo")):
            keep(path)
    return selected


def _archive_snapshot(path, output, workspace, edition, previous, *, extra_members=None):
    """Verify the ZIP and its SHA using the maintained same-opened-file reader."""
    if path.is_symlink() or not path.is_file():
        raise ValueError("Select the original retained regular Workspace archive")
    selected = _selected_members(workspace, edition)
    selected.update(extra_members or {})
    with path.open("rb") as source:
        before = portable._archive_identity(source)
        with zipfile.ZipFile(source) as archive:
            manifest = portable._inspect_archive(archive, verify=True)
        sha256 = portable._archive_digest(source, before)
        after = path.lstat()
        if (not stat.S_ISREG(after.st_mode)
                or (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) != before):
            raise ValueError("Archive pathname changed during receiving")
    descriptor = {"path": path.relative_to(output).as_posix(), "bytes": before[2], "sha256": sha256}
    if previous and not _same_file(previous["archive"], descriptor):
        raise ValueError("The saved Workspace archive changed; preserve the original receiving state")
    if manifest["project"] != workspace.project:
        raise ValueError("The Workspace archive belongs to another original project")
    for name, expected in selected.items():
        actual = manifest["members"].get(name, {})
        if any(actual.get(key) != expected[key] for key in ("bytes", "sha256")):
            raise ValueError("The Workspace archive differs from the saved gauge source or report: " + name)
    application = {name[len("application/"):]: {key: row[key] for key in ("bytes", "sha256")}
        for name, row in manifest["members"].items() if name.startswith("application/")}
    return manifest, descriptor, digest(application)


def _verify_reopened(root, manifest):
    """Bind a retained restore, including a lost checkpoint, to every archived member."""
    if root.is_symlink():
        raise ValueError("Use the original regular receiving directory")
    root = root.resolve(strict=True)
    for name, record in manifest["members"].items():
        relative = portable.member_name(name)
        path = root.joinpath(*relative.parts)
        if (path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root)
                or path.stat().st_size != record["bytes"] or file_digest(path) != record["sha256"]):
            raise ValueError("The reopened Workspace differs from its original archive: " + name)


def _scientific_members(workspace, source_capture, report_id):
    """Original source capture and saved scientific edition needed by this release."""
    from model import scientific_report_editions
    selected = {}
    def keep(path):
        path = Path(path)
        selected["workspace/" + path.relative_to(workspace.root).as_posix()] = describe_file(workspace.root, path)
    source = source_capture["source"]
    collection = workspace._get("sources", source["source_collection_id"])
    keep(workspace.root / "sources" / (collection["id"] + ".json"))
    for entry in collection["entries"]:
        for item in [entry["body"], *entry.get("companions", [])]:
            keep(workspace.root / item["object"])
    capture_root = (workspace.root / source_capture["manifest"]["path"]).parent
    for path in sorted(capture_root.rglob("*")):
        if path.is_file() and not path.name.endswith((".lock", ".pyc", ".pyo")):
            keep(path)
    record, directory, unused = scientific_report_editions.inspect(workspace, report_id)
    for item in scientific_report_editions.files(record, directory).values():
        keep(directory / item["path"])
    return selected


def _prepare_scientific(workspace, edition, output, receipt, checkpoint):
    """Register the original Gauge source and save one actual composer edition."""
    from model import gauge_report_context, observed_context, scientific_report_editions
    previous = receipt["phases"].get("scientific_source")
    if previous:
        path = verify_file(workspace.root, previous["capture"])
    else:
        prepared = gauge_report_context.prepare(workspace, edition["id"], render=False)
        path = verify_file(workspace.root, prepared["manifest"]).parent / "registered-context.json"
    captured = read_json(path)
    if (captured.get("schema") != gauge_report_context.SCHEMA
            or captured.get("workspace_id") != workspace.project["id"]
            or captured.get("gauge_support_id") != edition["id"]
            or captured.get("gauge_build_id") != edition["build_id"]
            or captured.get("regional_report_id") != edition["regional"]["report_id"]):
        raise ValueError("The retained scientific source belongs to another original Gauge edition")
    for item in captured["files"]:
        verify_file(workspace.root, item)
    source = captured["source"]
    if observed_context.bind(workspace, {"observed_context_sources": [source]}) != captured["observed_context_binding"]:
        raise ValueError("The original Gauge scientific source binding changed")
    capture_descriptor = describe_file(workspace.root, path)
    if previous and (previous.get("source") != source
                     or previous.get("operation_id") != captured["operation_id"]
                     or not _same_file(previous["capture"], capture_descriptor)):
        raise ValueError("The saved Gauge scientific source capture changed")
    checkpoint("scientific_source", capture=capture_descriptor,
               operation_id=captured["operation_id"], source=source,
               gauge_support_id=edition["id"], regional_report_id=edition["regional"]["report_id"])

    preview_path = output / "selected-report-preview.json"
    previous_preview = receipt["phases"].get("scientific_preview")
    if preview_path.exists():
        prepared = read_json(preview_path)
    else:
        if previous_preview:
            raise ValueError("The saved scientific preview is missing")
        prepared = scientific_report_editions.preview(workspace,
            {"sources": [source], "title": edition["title"] + " — gauge and catchment support"})
        atomic_json(preview_path, prepared, immutable=True)
    expected_choices = [source]
    choices = observed_context.source_choices(prepared["selection"])
    if (choices != expected_choices
            or prepared.get("id") != digest(prepared.get("render_identity"))
            or prepared.get("binding") != captured["observed_context_binding"]):
        raise ValueError("The retained scientific preview has another original source selection")
    preview_descriptor = describe_file(output, preview_path)
    if previous_preview and (previous_preview.get("id") != prepared["id"]
                             or not _same_file(previous_preview["preview"], preview_descriptor)):
        raise ValueError("The original scientific preview changed")
    checkpoint("scientific_preview", id=prepared["id"], preview=preview_descriptor)

    saved = scientific_report_editions.render_prepared(workspace, prepared)
    report_id = saved["scientific_report_edition_id"]
    record, directory, unused = scientific_report_editions.inspect(workspace, report_id)
    descriptor = describe_file(workspace.root, directory / "edition.json")
    previous_report = receipt["phases"].get("scientific_report")
    if previous_report and (previous_report.get("id") != report_id
                            or not _same_file(previous_report["record"], descriptor)):
        raise ValueError("The saved scientific report edition changed")
    checkpoint("scientific_report", **saved, id=report_id, record=descriptor,
               source=source, files=record["files"])
    return captured, report_id, record


def _contains_members(manifest, expected):
    """Missing new editions allow a new snapshot; changed same-path bytes do not."""
    missing = False
    for name, item in expected.items():
        actual = manifest["members"].get(name)
        if actual is None:
            missing = True
        elif any(actual.get(key) != item[key] for key in ("bytes", "sha256")):
            raise ValueError("An existing archive changed the same original report member: " + name)
    return not missing


def _scientific_workspace(workspace, edition, source_capture, report_id, output,
                          original_archive, original_manifest, receipt, checkpoint):
    """Keep older complete snapshots and explicitly retain the current report."""
    extras = _scientific_members(workspace, source_capture, report_id)
    current = _contains_members(original_manifest, extras)
    archive = original_archive if current else output / (
        "gauge-support-workspace-" + edition["id"] + "-scientific-" + report_id + ".zip")
    previous = receipt["phases"].get("scientific_workspace_backup")
    if not archive.exists():
        if previous:
            raise ValueError("The saved current scientific Workspace archive is missing")
        portable.backup(workspace, archive)
    manifest, descriptor, app_sha = _archive_snapshot(
        archive, output, workspace, edition, previous, extra_members=extras)
    checkpoint("scientific_workspace_backup", archive=descriptor, report_id=report_id,
               application_sha256=app_sha, members=len(manifest["members"]),
               reuses_original_snapshot=current,
               original_snapshot_path=original_archive.relative_to(output).as_posix())
    root = output / ("reopened-" + edition["id"]) if current else output / (
        "reopened-scientific-" + report_id)
    previous_reopen = receipt["phases"].get("scientific_workspace_reopen")
    if previous_reopen and (previous_reopen.get("archive_sha256") != descriptor["sha256"]
                           or Path(previous_reopen["workspace"]).resolve() != (root / "workspace").resolve()):
        raise ValueError("The saved scientific Workspace reopening belongs to another archive")
    if not root.exists():
        if previous_reopen:
            raise ValueError("The saved scientific Workspace reopening is missing")
        result = portable.restore(archive, root)
        if result["archive_sha256"] != descriptor["sha256"]:
            raise ValueError("The current scientific Workspace archive changed during restore")
    _verify_reopened(root, manifest)
    from model import scientific_report_editions
    reopened = Workspace(root / "workspace")
    if reopened.project != workspace.project:
        raise ValueError("The scientific Workspace reopening changed its original project")
    record, unused, operation = scientific_report_editions.inspect(reopened, report_id)
    if record["id"] != report_id or operation["state"] != "complete":
        raise ValueError("The scientific Workspace lost its selected report")
    checkpoint("scientific_workspace_reopen", workspace=str(reopened.root),
               project_id=reopened.project["id"], report_id=report_id,
               archive_sha256=descriptor["sha256"], verified_members=len(manifest["members"]))


def _verify_selected_report(workspace, expected):
    """Run from the selected archive's application in the independent child."""
    from model import scientific_report_editions, study_transfer
    if workspace.project != expected["project"]:
        raise ValueError("Selected-report receiving changed the original project")
    transferred = read_json(workspace.root / "study-transfers" / (expected["study"]["id"] + ".json"))
    if transferred != expected["study"]:
        raise ValueError("Selected-report receiving changed the original Study receipt")
    checks = study_transfer.verify_received_studies(workspace)
    matches = [row for row in checks if row["id"] == transferred["id"] and row["identity"] == "MATCH"]
    if len(matches) != 1:
        raise ValueError("The exact selected Study did not pass its native lineage verifier")
    edition = gauge_support.inspect(workspace, expected["gauge_support_id"], verify=True, include_result=True)
    if (edition["build_id"] != expected["gauge_build_id"]
            or edition["station_edition_id"] != expected["station_edition_id"]
            or edition["regional"] != expected["regional"]
            or edition["selection"] != expected["selection"]
            or edition["summary"] != expected["summary"]
            or edition["sources"] != expected["original_sources"]):
        raise ValueError("The selected Study changed its original Gauge selection or sources")
    station = gauge_support.geography.inspect(workspace, expected["station_edition_id"], verify=True)
    if station["build_id"] != expected["station_build_id"]:
        raise ValueError("The selected Study changed its original Station Geography")
    record, directory, unused = scientific_report_editions.inspect(workspace, expected["report_id"])
    if record != expected["report_record"]:
        raise ValueError("The selected Study changed the original scientific report edition")
    source = expected["source"]
    source_path, entry = workspace.source_file(source["source_collection_id"], source["source_id"])
    if entry["body"]["sha256"] != expected["source_body_sha256"]:
        raise ValueError("The selected Study changed the Gauge report's native source")
    recipe = read_json(source_path)
    if (recipe.get("gauge_support_id") != edition["id"]
            or recipe.get("station_edition_id") != station["id"]
            or recipe.get("regional") != edition["regional"]):
        raise ValueError("The received report recipe lost its editable Gauge lineage")
    return {"schema": "upstate.gauge-selected-report-reopen/v1", "identity": "MATCH",
        "project_id": workspace.project["id"], "study_id": transferred["id"],
        "report_id": record["id"], "report_operation_id": record["operation_id"],
        "gauge_support_id": edition["id"], "gauge_build_id": edition["build_id"],
        "station_edition_id": station["id"], "station_build_id": station["build_id"],
        "regional_report_id": edition["regional"]["report_id"], "source": source,
        "source_body_sha256": entry["body"]["sha256"],
        "original_source_choices": [{"collection_id": row["collection_id"],
            "source_id": row["source_id"], "source_sha256": row["source_sha256"]}
            for row in edition["sources"]],
        "verified_study": matches[0], "report_directory": str(directory)}


_COLD_SELECTED = """
import json, os, platform, socket, sys
from pathlib import Path
application = Path(sys.argv[1]).resolve(strict=True)
sys.path.insert(0, str(application))
from model.workspace import Workspace
from model.common import atomic_json, read_json
from source_tools import receive_gauge_support as receiver
if Path(receiver.__file__).resolve() != application / "source_tools/receive_gauge_support.py":
    raise ValueError("Cold receiving imported a different application")
result = receiver._verify_selected_report(Workspace(sys.argv[2]), read_json(sys.argv[3]))
result["process"] = {"pid": os.getpid(), "hostname": socket.gethostname(),
                     "interpreter": sys.executable, "python": platform.python_version(),
                     "application": str(application)}
atomic_json(Path(sys.argv[4]), result)
print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
"""


def _selected_report(workspace, edition, source_capture, report_id, report_record,
                     output, receipt, checkpoint):
    """Export just the saved report and reopen its original editable dependency closure."""
    from model import study_transfer
    selection = {"schema": study_transfer.SELECTION_SCHEMA,
        "title": edition["title"] + " — editable scientific report",
        "roots": [{"kind": "scientific-report-editions", "id": report_id}],
        "include_related_results": False}
    archive = output / ("gauge-selected-report-" + report_id + ".zip")
    previous = receipt["phases"].get("selected_report_archive")
    if previous and not archive.exists():
        raise ValueError("The retained selected-report archive is missing")
    def progress(value):
        checkpoint("selected_report_progress", progress=value)
    exported = study_transfer.export_study(workspace, archive, selection, progress=progress)
    inspected = study_transfer.inspect_transfer_archive(archive, verify=True)
    study = inspected["study"]
    if exported["id"] != study["id"] or exported["study"] != study:
        raise ValueError("Selected Study export differs from its original archive")
    source = source_capture["source"]
    unused, entry = workspace.source_file(source["source_collection_id"], source["source_id"])
    lineage = [row for row in study["identity"].get("scientific_report_sources", [])
        if row.get("report_context_kind") == "gauge_support"
        and row.get("source_collection_id") == source["source_collection_id"]
        and row.get("source_id") == source["source_id"]]
    required = {("gauge-support", edition["id"]),
                ("station-geographies", edition["station_edition_id"]),
                ("watershed-context", edition["regional"]["report_id"])}
    if (len(lineage) != 1 or lineage[0].get("relationship") != "same_project"
            or lineage[0].get("gauge_support_id") != edition["id"]
            or lineage[0].get("gauge_build_id") != edition["build_id"]
            or lineage[0].get("source_body_sha256") != entry["body"]["sha256"]
            or not required.issubset({(row["kind"], row["id"])
                for row in lineage[0].get("required_records", [])})):
        raise ValueError("The saved report did not capture its original editable Gauge lineage")
    reports = study["identity"].get("scientific_report_editions", [])
    if len(reports) != 1 or reports[0]["id"] != report_id:
        raise ValueError("The selected archive must retain the exact saved scientific report")
    manifest, descriptor, app_sha = _archive_snapshot(
        archive, output, workspace, edition, previous)
    if manifest != inspected["manifest"] or descriptor["sha256"] != exported["sha256"]:
        raise ValueError("The selected archive changed during original receiving")
    checkpoint("selected_report_archive", id=study["id"], archive=descriptor,
        report_id=report_id, application_sha256=app_sha, members=len(manifest["members"]),
        lineage=lineage[0], scientific_report=reports[0])
    station = gauge_support.geography.inspect(workspace, edition["station_edition_id"], verify=True)
    expected = {"schema": "upstate.gauge-selected-report-expectation/v1",
        "project": workspace.project, "study": study, "source": source,
        "source_body_sha256": entry["body"]["sha256"], "report_id": report_id,
        "report_record": report_record, "gauge_support_id": edition["id"],
        "gauge_build_id": edition["build_id"], "station_edition_id": station["id"],
        "station_build_id": station["build_id"], "regional": edition["regional"],
        "selection": edition["selection"], "summary": edition["summary"],
        "original_sources": edition["sources"]}
    expected_path = output / ("selected-report-" + report_id + ".expected.json")
    atomic_json(expected_path, expected, immutable=True)
    root = output / ("selected-report-reopened-" + report_id)
    previous_reopen = receipt["phases"].get("selected_report_cold_reopen")
    if previous_reopen and (previous_reopen.get("archive_sha256") != descriptor["sha256"]
                           or Path(previous_reopen["workspace"]).resolve() != (root / "workspace").resolve()):
        raise ValueError("The retained selected-report reopen belongs to another original archive")
    if not root.exists():
        if previous_reopen:
            raise ValueError("The saved selected-report reopening is missing")
        restored = portable.restore(archive, root)
        if restored["archive_sha256"] != descriptor["sha256"]:
            raise ValueError("The selected Study archive changed during restore")
    _verify_reopened(root, manifest)
    result_path = output / ("selected-report-" + report_id + ".cold-reopen.json")
    log_path = output / ("selected-report-" + report_id + ".cold-reopen.log")
    application = root / "application"
    command = [sys.executable, "-I", "-B", "-c", _COLD_SELECTED, str(application),
               str(root / "workspace"), str(expected_path), str(result_path)]
    if previous_reopen:
        result = read_json(verify_file(output, previous_reopen["result"]))
    else:
        environment = {key: value for key, value in os.environ.items()
                       if key not in ("PYTHONPATH", "PYTHONHOME")}
        with log_path.open("wb") as log:
            process = subprocess.run(command, cwd=application, env=environment,
                                     stdout=log, stderr=subprocess.STDOUT, check=False)
        if process.returncode:
            raise RuntimeError("Selected-report cold receiving exited %s; retained log: %s"
                               % (process.returncode, log_path))
        result = read_json(result_path)
    if (result.get("identity") != "MATCH" or result.get("study_id") != study["id"]
            or result.get("report_id") != report_id
            or result.get("gauge_support_id") != edition["id"]
            or result.get("station_edition_id") != edition["station_edition_id"]
            or result.get("regional_report_id") != edition["regional"]["report_id"]
            or result.get("source") != source
            or result.get("process", {}).get("application") != str(application.resolve())):
        raise ValueError("The cold receiver returned another scientific report identity")
    checkpoint("selected_report_cold_reopen", workspace=str(root / "workspace"),
        project_id=workspace.project["id"], report_id=report_id, study_id=study["id"],
        gauge_support_id=edition["id"], station_edition_id=edition["station_edition_id"],
        regional_report_id=edition["regional"]["report_id"], source=source,
        archive_sha256=descriptor["sha256"], application_sha256=app_sha,
        verified_members=len(manifest["members"]), process=result["process"],
        result=describe_file(output, result_path), log=describe_file(output, log_path))


def receive(args):
    application = Path(__file__).resolve().parents[1]
    output = Path(args.output).resolve()
    workspace_root = Path(args.workspace).resolve()
    if output.is_relative_to(workspace_root) or output.is_relative_to(application):
        raise ValueError("Choose a receiving output directory outside the application and Workspace")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".receiving.lock", blocking=False):
        return _receive(args)


def _receive(args):
    application = Path(__file__).resolve().parents[1]
    workspace = Workspace(args.workspace)
    output = Path(args.output).resolve()
    if output.is_relative_to(workspace.root.resolve()) or output.is_relative_to(application):
        raise ValueError("Choose a receiving output directory outside the application and Workspace")
    output.mkdir(parents=True, exist_ok=True)
    receipt_path = output / "receiving-gauge-support.json"
    identity = {"workspace": str(workspace.root.resolve()), "project_id": workspace.project["id"],
        "application": str(application), "report_id": args.report_id, "title": args.title,
        "daily_source": str(Path(args.daily_source).resolve()),
        "nldi_manifest": str(Path(args.nldi_manifest).resolve()),
        "huc_manifest": str(Path(args.huc_manifest).resolve()) if args.huc_manifest else None,
        "huc_collection": args.huc_collection, "huc_source_id": args.huc_source_id,
        "huc_id_field": args.huc_id_field, "reporting_huc12s": sorted(args.reporting_huc12 or []),
        "utility_selection": str(Path(args.utility_selection).resolve()) if args.utility_selection else None}
    # Original whole-source receipts keep their exact selection identity.
    if args.catchment_manifest or args.catchment_collection or args.catchment_source_id != CATCHMENT_ID:
        identity["catchment_selection"] = {
            "manifest": str(Path(args.catchment_manifest).resolve()) if args.catchment_manifest else None,
            "collection_id": args.catchment_collection, "source_id": args.catchment_source_id}
    if args.support_kind:
        identity["support_kind"] = args.support_kind
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        if receipt.get("identity") != identity:
            raise ValueError("This receiving output belongs to another saved source selection")
    else:
        receipt = {"schema": "upstate.gauge-support-receiving/v1", "identity": identity,
            "started_at": now(), "phases": {}, "state": "running"}
    receipt["state"] = "running"
    receipt.pop("error", None)
    receipt["process"] = {"hostname": socket.gethostname(), "pid": os.getpid(),
        "interpreter": sys.executable, "python": platform.python_version(), "started_at": now()}
    def checkpoint(phase, **value):
        receipt["phases"][phase] = value
        receipt["updated_at"] = now()
        atomic_json(receipt_path, receipt)
        print(json.dumps({"phase": phase, **value}, ensure_ascii=False, allow_nan=False), flush=True)
    atomic_json(receipt_path, receipt)
    try:
        # Source preparation is independent of the original native model/GIS job queue.
        manifest = prepare_coverage(args.daily_source, output / "daily-coverage-source")
        def imported(name, manifest_path):
            previous = receipt["phases"].get(name)
            if previous:
                collection = workspace._get("sources", previous["collection_id"])
                if previous["manifest_sha256"] != file_digest(manifest_path):
                    raise ValueError("The original manifest changed during receiving: " + name)
            else:
                collection = workspace.import_sources(manifest_path)
            checkpoint(name, collection_id=collection["id"], manifest_sha256=file_digest(manifest_path))
            return collection
        daily = imported("coverage_import", manifest)
        nldi = imported("nldi_import", Path(args.nldi_manifest).resolve(strict=True))
        if args.catchment_manifest:
            catchment = imported("catchment_import", Path(args.catchment_manifest).resolve(strict=True))
        elif args.catchment_collection:
            catchment = workspace._get("sources", args.catchment_collection)
        else:
            catchment = nldi
        if args.huc_manifest:
            huc = imported("huc_import", Path(args.huc_manifest).resolve(strict=True))
        else:
            if not args.huc_collection:
                raise ValueError("Select the original HUC polygon source by --huc-manifest or --huc-collection")
            huc = workspace._get("sources", args.huc_collection)
        huc_ref = {**_reference(huc, args.huc_source_id), "id_field": args.huc_id_field}
        selection = {"title": args.title, "report_id": args.report_id,
            "huc_sources": [huc_ref], "point_source": {
                **_reference(nldi, POINT_ID), "station_id_field": "station_id"},
            "catchment_source": _reference(catchment, args.catchment_source_id),
            "coverage_source": _reference(daily, COVERAGE_ID)}
        if args.support_kind:
            selection["support_kind"] = args.support_kind
        if args.reporting_huc12:
            selection["reporting_huc12s"] = args.reporting_huc12
        if args.utility_selection:
            utility = read_json(args.utility_selection)
            if not isinstance(utility, list):
                raise ValueError("Utility selection is a list of original polygon source references")
            selection["utility_sources"] = utility
        atomic_json(output / "gauge-support-selection.json", selection, immutable=True)
        checkpoint("selection", path=str(output / "gauge-support-selection.json"),
            report_id=args.report_id, huc_source_id=args.huc_source_id,
            catchment_source=selection["catchment_source"],
            declared_support_kind=selection.get("support_kind"))
        if args.prepare_only:
            receipt["state"] = "prepared"
            atomic_json(receipt_path, receipt)
            return receipt
        previous_build = receipt["phases"].get("support_build")
        if previous_build:
            edition = gauge_support.inspect(workspace, previous_build["edition_id"], verify=True)
            _selection_matches(edition, selection)
            if any(previous_build.get(key) != edition[key]
                   for key in ("station_edition_id", "build_id", "summary")):
                raise ValueError("The retained completed gauge build changed")
        else:
            edition = gauge_support.build(workspace, selection)
            gauge_support.inspect(workspace, edition["id"], verify=True)
        checkpoint("support_build", edition_id=edition["id"], station_edition_id=edition["station_edition_id"],
            build_id=edition["build_id"], summary=edition["summary"],
            support=gauge_support.support_for_result(gauge_support.inspect(workspace,
                edition["id"], verify=True, include_result=True)["result"]))
        # Keep original receiving identities stable; the added scientific phase is versioned separately.
        receipt["receiving_edition"] = "gauge-scientific-study-receiving-v2"
        source_capture, report_id, report_record = _prepare_scientific(
            workspace, edition, output, receipt, checkpoint)
        archive = output / ("gauge-support-workspace-" + edition["id"] + ".zip")
        previous_backup = receipt["phases"].get("workspace_backup")
        if not archive.exists():
            if previous_backup:
                raise ValueError("The saved Workspace archive is missing; preserve its original descriptor")
            portable.backup(workspace, archive)
        manifest, archive_descriptor, application_sha256 = _archive_snapshot(
            archive, output, workspace, edition, previous_backup)
        checkpoint("workspace_backup", archive=archive_descriptor,
            application_sha256=application_sha256, members=len(manifest["members"]))
        restored_root = output / ("reopened-" + edition["id"])
        previous_reopen = receipt["phases"].get("independent_reopen")
        if previous_reopen:
            if (previous_reopen.get("archive_sha256") not in (None, archive_descriptor["sha256"])
                    or Path(previous_reopen["workspace"]).resolve() != (restored_root / "workspace").resolve()):
                raise ValueError("The retained reopening belongs to another archive or receiving directory")
        if not restored_root.exists():
            if previous_reopen:
                raise ValueError("The saved reopened Workspace is missing; preserve its original receipt")
            restored = portable.restore(archive, restored_root)
            if restored["archive_sha256"] != archive_descriptor["sha256"]:
                raise ValueError("The archive changed between verification and original restore")
        _verify_reopened(restored_root, manifest)
        reopened = Workspace(restored_root / "workspace")
        if reopened.project["id"] != workspace.project["id"]:
            raise ValueError("Reopened Workspace project identity differs")
        reopened_edition = gauge_support.inspect(reopened, edition["id"], verify=True, include_result=True)
        if reopened_edition["build_id"] != edition["build_id"] or reopened_edition["summary"] != edition["summary"]:
            raise ValueError("Reopened support report differs from its original selection")
        checkpoint("independent_reopen", workspace=str(reopened.root), project_id=reopened.project["id"],
            edition_id=reopened_edition["id"], station_edition_id=reopened_edition["station_edition_id"],
            regional_report_id=reopened_edition["regional"]["report_id"],
            archive_sha256=archive_descriptor["sha256"],
            application_sha256=application_sha256, verified_members=len(manifest["members"]))
        _scientific_workspace(workspace, edition, source_capture, report_id, output,
                              archive, manifest, receipt, checkpoint)
        _selected_report(workspace, edition, source_capture, report_id, report_record,
                         output, receipt, checkpoint)
        receipt["state"], receipt["completed_at"] = "complete", now()
        atomic_json(receipt_path, receipt)
        return receipt
    except BaseException as error:
        receipt["state"] = "interrupted" if isinstance(error, KeyboardInterrupt) else "failed"
        receipt["error"] = {"type": type(error).__name__, "message": str(error)}
        receipt["updated_at"] = now()
        atomic_json(receipt_path, receipt)
        raise


def main(argv=None):
    application = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Existing regional Workspace")
    parser.add_argument("--output", required=True)
    parser.add_argument("--report-id", required=True)
    parser.add_argument("--title", default="Upper Savannah original gauge and catchment support")
    parser.add_argument("--daily-source", default=str(application / "source/hydrology-huc05-07-20261013"))
    parser.add_argument("--nldi-manifest", default=str(application / "source/hydrology-huc05-07-20261013/nldi/model-sources.json"))
    catchment = parser.add_mutually_exclusive_group()
    catchment.add_argument("--catchment-manifest", help="Exact completed source edition model-sources.json")
    catchment.add_argument("--catchment-collection", help="Already retained catchment source collection")
    parser.add_argument("--catchment-source-id", default=CATCHMENT_ID,
        help="Exact source ID in the selected whole or split edition")
    parser.add_argument("--support-kind", choices=sorted(gauge_support.SUPPORT_DEFINITIONS),
        help="Optional explicit expected method, verified against every original feature")
    parser.add_argument("--huc-manifest")
    parser.add_argument("--huc-collection")
    parser.add_argument("--huc-source-id", default="upstate-wbd-upstream-domain-20261012")
    parser.add_argument("--huc-id-field", default="huc12")
    parser.add_argument("--reporting-huc12", action="append")
    parser.add_argument("--utility-selection", help="JSON list of actual Workspace polygon source references")
    parser.add_argument("--prepare-only", action="store_true", help="Retain originals and a selection before the geometry runtime is ready")
    args = parser.parse_args(argv)
    print(json.dumps(receive(args), ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
