"""Import an original comparison source and deliver it through native report APIs.

Use an owned receiving Workspace. Completed stages are reused by source identity;
a portable archive can be restored independently without access to this machine.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

from model.common import atomic_json, describe_file, file_digest, held, read_json
from model.workspace import Workspace
from model import observed_context, portable, scientific_report

SCHEMA = "upstate.observation-comparability-delivery/v1"


def _archive_name(entry: dict) -> str:
    prefix = entry.get("metadata", {}).get("cohort", {}).get("source_prefix")
    if prefix is None or prefix == "sv833-observation-comparability":
        return "sv833-comparable-period-workspace.zip"
    if not isinstance(prefix, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,79}", prefix):
        raise ValueError("The retained cohort has an invalid source prefix")
    return prefix + "-workspace.zip"


def _retain_member(archive: zipfile.ZipFile, name: str, target: Path, record: dict) -> None:
    """Restore an original completed report member without replacing other bytes."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != record["bytes"] or file_digest(target) != record["sha256"]:
            raise ValueError("Existing exported report differs from its retained archive: " + str(target))
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".receiving-", delete=False) as output:
            temporary = Path(output.name)
            with archive.open(name) as original:
                shutil.copyfileobj(original, output, length=1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        if temporary.stat().st_size != record["bytes"] or file_digest(temporary) != record["sha256"]:
            raise ValueError("Retained archive member changed during receiving: " + name)
        try:
            os.link(temporary, target)
        except FileExistsError:
            if target.stat().st_size != record["bytes"] or file_digest(target) != record["sha256"]:
                raise ValueError("A different report member appeared during receiving: " + str(target))
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _completed_export(ws: Workspace, entry: dict, export_root: Path, archive_path: Path) -> dict:
    """Resume the original verified snapshot, including interruption after backup."""
    archive_sha256 = file_digest(archive_path)
    manifest = portable.inspect_archive(archive_path, verify=True)
    if manifest["project"]["id"] != ws.project["id"]:
        raise ValueError("The existing archive belongs to a different original project")
    relative_root = "observation-comparability/" + entry["sha256"]
    selection_member = "workspace/" + relative_root + "/report-selection.json"
    selection_record = manifest["members"].get(selection_member)
    if selection_record is None:
        raise ValueError("The archive does not contain this exact selected comparison source")
    with zipfile.ZipFile(archive_path) as archive:
        state = json.loads(archive.read(selection_member))
        if (state.get("schema") != SCHEMA or state.get("state") != "complete"
                or state.get("project_id") != ws.project["id"]
                or state.get("source_id") != entry["id"]
                or state.get("source_recipe_sha256") != entry["sha256"]
                or state.get("report_path") != relative_root + "/report"):
            raise ValueError("The archive retains a different or incomplete original report selection")
        prefix = "workspace/" + state["report_path"] + "/"
        expected = {name[len(prefix):]: record for name, record in manifest["members"].items()
                    if name.startswith(prefix)}
        if not expected:
            raise ValueError("The completed archive lacks its original report files")
        for record in state.get("files", {}).values():
            retained = expected.get(record["path"])
            if retained is None or any(retained[key] != record[key] for key in ("bytes", "sha256")):
                raise ValueError("Saved report descriptor differs from its original archived member")
        exported_report = export_root / "native-report"
        for relative, record in expected.items():
            _retain_member(archive, prefix + relative, exported_report / relative, record)
    selection_path = export_root / "native-selection.json"
    if selection_path.exists() and read_json(selection_path) != state:
        raise ValueError("Exported selection differs from the completed original archive")
    atomic_json(selection_path, state)
    if file_digest(archive_path) != archive_sha256:
        raise ValueError("Original archive changed during report receiving")
    record = {
        "schema": manifest["schema"], "project_id": ws.project["id"],
        "path": str(archive_path), "bytes": archive_path.stat().st_size,
        "sha256": archive_sha256, "members": len(manifest["members"]),
        "selection": manifest["selection"], "database_snapshots": manifest.get("database_snapshots", []),
        "source_acquisitions": manifest.get("source_acquisitions", []),
        "implementation": manifest.get("implementation"),
        "parameter_studies": manifest.get("parameter_studies"),
    }
    previous_archive = export_root / "workspace-export.json"
    if previous_archive.exists():
        previous = read_json(previous_archive)
        if any(previous.get(key) != record[key] for key in ("project_id", "bytes", "sha256")):
            raise ValueError("Existing archive receipt differs from the retained completed snapshot")
    atomic_json(previous_archive, record)
    result = {
        "schema": SCHEMA, "project_id": ws.project["id"], "source_id": entry["id"],
        "source_collection_id": state["source_collection_id"], "recipe_sha256": entry["sha256"],
        "report_selection": str(selection_path), "report_directory": str(exported_report),
        "archive": record, "report_files": state["files"],
    }
    atomic_json(export_root / "delivery.json", result)
    return result


def deliver(workspace: Path, manifest: Path, export_root: Path) -> dict:
    ws = Workspace(workspace, create=False)
    export_root = export_root.resolve()
    export_root.mkdir(parents=True, exist_ok=True)
    # One original report writer per Workspace, and one writer per export.
    # portable.backup retains its own maintained Workspace/archive locks.
    workspace_lock = ws.root / ".observation-comparability.lock"
    export_lock = export_root / ".observation-comparability.lock"
    with held(workspace_lock, blocking=False):
        if workspace_lock.resolve() == export_lock.resolve():
            return _deliver_locked(ws, manifest, export_root)
        with held(export_lock, blocking=False):
            return _deliver_locked(ws, manifest, export_root)


def _deliver_locked(ws: Workspace, manifest: Path, export_root: Path) -> dict:
    manifest = manifest.resolve(strict=True)
    source = read_json(manifest)
    if len(source.get("entries", [])) != 1:
        raise ValueError("Select the complete single observation-comparability source")
    entry = source["entries"][0]
    if entry.get("metadata", {}).get("source_kind") != "upstate.observation-comparability/v1":
        raise ValueError("Select the source produced by observation_comparability")
    recipe = read_json(manifest.parent / entry["path"])
    if file_digest(manifest.parent / entry["path"]) != entry["sha256"]:
        raise ValueError("Retain the selected original comparison recipe unchanged")
    source_id = entry["id"]
    export_root = export_root.resolve()
    export_binding = {
        "project_id": ws.project["id"], "source_id": source_id,
        "recipe_sha256": entry["sha256"],
    }
    # An existing export belongs to its exact original receiving selection.
    # Check before changing the Workspace report or replacing any export file.
    prior_result_path = export_root / "delivery.json"
    prior_selection_path = export_root / "native-selection.json"
    if prior_result_path.is_file():
        previous = read_json(prior_result_path)
        if any(previous.get(key) != value for key, value in export_binding.items()):
            raise ValueError("This export contains a different selected source edition; choose a new output directory")
    elif prior_selection_path.is_file():
        previous = read_json(prior_selection_path)
        if (previous.get("project_id") != export_binding["project_id"]
                or previous.get("source_id") != export_binding["source_id"]
                or previous.get("source_recipe_sha256") != export_binding["recipe_sha256"]):
            raise ValueError("This partial export belongs to a different selected source edition; choose a new output directory")
    archive = export_root / _archive_name(entry)
    if archive.exists():
        return _completed_export(ws, entry, export_root, archive)
    if prior_result_path.exists():
        raise ValueError("The completed export is missing its retained archive; restore that original file before continuing")
    collection = ws.import_sources(manifest)
    selection = {"source_roles": {observed_context.ROLE: {
        "source_collection_id": collection["id"], "source_id": source_id}}}
    binding = observed_context.bind(ws, selection)
    selection["observed_context_binding"] = binding
    root = ws.root / "observation-comparability" / entry["sha256"]
    root.mkdir(parents=True, exist_ok=True)
    state_path = root / "report-selection.json"
    state = {"schema": SCHEMA, "project_id": ws.project["id"], "source_id": source_id,
             "source_collection_id": collection["id"], "selection": selection,
             "source_recipe_sha256": entry["sha256"]}
    if state_path.exists():
        prior = read_json(state_path)
        if any(prior.get(key) != value for key, value in state.items()):
            raise ValueError("The saved report belongs to a different original source selection")
    report_root = root / "report"
    report_root.mkdir(exist_ok=True)
    product = observed_context.collect(ws, selection, report_root, state)
    source_records = [{"id": observed_context.ROLE, "source_id": source_id,
        "title": entry["title"], "vintage": entry["vintage"], "uri": entry["uri"]}]
    contact = {"organization": "TokenJunkieLabs"}
    files = scientific_report.write_companions(report_root, recipe["title"], product["sections"],
        contact=contact, source_records=source_records, binding=binding)
    # Use the native composition, with the correct observation-only cover label.
    html = report_root / "report.html"
    body = html.read_text(encoding="utf-8").replace(
        "Scientific model results, scenario changes and retained source editions.",
        "Observed water-quality measurements, matched calendar periods and retained source editions.")
    html.write_text(body, encoding="utf-8")
    files["report_html"] = describe_file(report_root, html)
    scientific_report.report_pdf(report_root / "report.pdf", recipe["title"], product["sections"],
        contact=contact, source_records=source_records)
    files["report_pdf"] = describe_file(report_root, report_root / "report.pdf")
    state.update(state="complete", files=files, report_path=report_root.relative_to(ws.root).as_posix(),
                 observed_source_files=product["files"])
    atomic_json(state_path, state)
    export_root.mkdir(parents=True, exist_ok=True)
    exported_report = export_root / "native-report"
    if exported_report.exists():
        # Preserve any differently named customer files in a destination rather
        # than deleting or silently overwriting the receiving folder.
        for path in report_root.rglob("*"):
            if path.is_file():
                target = exported_report / path.relative_to(report_root)
                if target.exists() and file_digest(target) != file_digest(path):
                    raise ValueError("Existing exported report differs: " + str(target))
    shutil.copytree(report_root, exported_report, dirs_exist_ok=True)
    atomic_json(export_root / "native-selection.json", state)
    archive_state = export_root / "workspace-export.json"
    record = portable.backup(ws, archive)
    atomic_json(archive_state, record)
    result = {"schema": SCHEMA, "project_id": ws.project["id"],
        "source_id": source_id, "source_collection_id": collection["id"],
        "recipe_sha256": entry["sha256"], "report_selection": str(export_root / "native-selection.json"),
        "report_directory": str(exported_report), "archive": record,
        "report_files": files}
    atomic_json(export_root / "delivery.json", result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    result = deliver(args.workspace, args.manifest, args.output)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
