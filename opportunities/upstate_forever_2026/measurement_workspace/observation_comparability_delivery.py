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

from model.common import atomic_json, describe_file, digest, file_digest, held, read_json, relative_file, verify_file
from model.workspace import Workspace
from model import observed_context, observed_report_render, portable

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
    # New exports capture their exact report selection through the maintained
    # portable delivery index. Legacy snapshots retain the original root marker.
    selected = (manifest.get("delivery") or {}).get("files", {}).get("report_selection")
    selection_member = (selected["path"] if selected is not None else
                        "workspace/" + relative_root + "/report-selection.json")
    selection_record = manifest["members"].get(selection_member)
    if selection_record is None:
        raise ValueError("The archive does not contain this exact selected comparison source")
    with zipfile.ZipFile(archive_path) as archive:
        state = json.loads(archive.read(selection_member))
        if (state.get("schema") != SCHEMA or state.get("state") != "complete"
                or state.get("project_id") != ws.project["id"]
                or state.get("source_id") != entry["id"]
                or state.get("source_recipe_sha256") != entry["sha256"]
                or not isinstance(state.get("report_path"), str)
                or not state["report_path"].startswith(relative_root + "/")):
            raise ValueError("The archive retains a different or incomplete original report selection")
        portable.member_name("workspace/" + state["report_path"])
        prefix = "workspace/" + state["report_path"] + "/"
        expected = {name[len(prefix):]: record for name, record in manifest["members"].items()
                    if name.startswith(prefix)}
        if not expected:
            raise ValueError("The completed archive lacks its original report files")
        for record in _report_files(state).values():
            retained = expected.get(record["path"])
            if retained is None or any(retained[key] != record[key] for key in ("bytes", "sha256")):
                raise ValueError("Saved report descriptor differs from its original archived member")
        selection_path = export_root / "native-selection.json"
        if selection_path.exists() and read_json(selection_path) != state:
            raise ValueError("Exported selection differs from the completed original archive")
        atomic_json(selection_path, state, immutable=True)
        exported_report = export_root / "native-report"
        for relative, record in expected.items():
            _retain_member(archive, prefix + relative, exported_report / relative, record)
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


def _report_files(state: dict) -> dict:
    """Include every formatter and observed-source descriptor in the saved edition."""
    files = state.get("files")
    required = {"report_html", "report_markdown", "report_data", "report_pdf"}
    if not isinstance(files, dict) or not required.issubset(files):
        raise ValueError("The completed original report lacks its PDF, HTML, Markdown or structured data descriptor")
    records = {}
    for name in ("files", "observed_source_files"):
        group = state.get(name, {})
        if not isinstance(group, dict):
            raise ValueError("The original completed report lacks its retained file descriptors")
        for record in group.values():
            if not isinstance(record, dict) or not isinstance(record.get("path"), str):
                raise ValueError("The original report file descriptor is incomplete")
            previous = records.get(record["path"])
            if previous and any(previous[key] != record[key] for key in ("bytes", "sha256")):
                raise ValueError("The original report has conflicting descriptors for one retained file")
            records[record["path"]] = record
    if not records:
        raise ValueError("The original completed report has no retained files")
    return records


def _verify_report(ws: Workspace, state: dict) -> Path:
    if state.get("state") != "complete":
        raise ValueError("Continue the original incomplete report operation")
    selection = state["selection"]
    bound = observed_context.bind(ws, selection)
    if bound is None or bound != selection.get("observed_context_binding"):
        raise ValueError("The original completed report source binding differs")
    records = _report_files(state)
    first = next(iter(records))
    member = relative_file(ws.root, state["report_path"] + "/" + first)
    report_root = ws.root / state["report_path"]
    if not member.is_relative_to(report_root.resolve()):
        raise ValueError("The report member leaves its original report directory")
    for record in records.values():
        verify_file(report_root, record)
    return report_root


def deliver(workspace: Path, manifest: Path, export_root: Path, *, new_rendering: bool = False) -> dict:
    ws = Workspace(workspace, create=False)
    export_root = export_root.resolve()
    export_root.mkdir(parents=True, exist_ok=True)
    # One original report writer per Workspace, and one writer per export.
    # portable.backup retains its own maintained Workspace/archive locks.
    workspace_lock = ws.root / ".observation-comparability.lock"
    export_lock = export_root / ".observation-comparability.lock"
    with held(workspace_lock, blocking=False):
        if workspace_lock.resolve() == export_lock.resolve():
            return _deliver_locked(ws, manifest, export_root, new_rendering=new_rendering)
        with held(export_lock, blocking=False):
            return _deliver_locked(ws, manifest, export_root, new_rendering=new_rendering)


def _deliver_locked(ws: Workspace, manifest: Path, export_root: Path, *, new_rendering: bool) -> dict:
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
        if new_rendering:
            raise ValueError("Keep the completed original export; choose a new output directory for a new rendering edition")
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
    prior = read_json(state_path) if state_path.exists() else None
    if prior is not None and any(prior.get(key) != value for key, value in state.items()):
        raise ValueError("The saved report belongs to a different original source selection")
    preview_path = export_root / "render-preview.json"
    if prior_selection_path.exists():
        # An interrupted export owns its exact saved edition. Another explicit
        # export may have advanced the shared Workspace marker in the meantime.
        captured = read_json(prior_selection_path)
        if any(captured.get(key) != value for key, value in state.items()):
            raise ValueError("The partial export changed its original report selection or source binding")
        report_root = _verify_report(ws, captured)
        state = captured
    elif prior is not None and not new_rendering and not preview_path.exists():
        # A completed legacy/current report is an immutable result, even when
        # its outer archive had not yet been published.
        report_root = _verify_report(ws, prior)
        state = prior
    else:
        if preview_path.exists():
            preview = read_json(preview_path)
            if preview.get("selection") != selection or preview.get("binding") != binding:
                raise ValueError("Resume the original selected rendering preview in this output")
        else:
            preview = observed_report_render.prepare(
                ws, [{"source_collection_id": collection["id"], "source_id": source_id}],
                title=recipe["title"], contact={"organization": "TokenJunkieLabs"},
                manifest_paths=[manifest])
            atomic_json(preview_path, preview, immutable=True)
        report_root = root / "renderings" / preview["operation_id"]
        rendered = observed_report_render.render(ws, preview, report_root)
        files = dict(rendered["files"])
        files["render_operation"] = describe_file(report_root, report_root / "operation.json")
        state.update(
            state="complete", files=files, observed_source_files={},
            report_path=report_root.relative_to(ws.root).as_posix(),
            rendering_operation_id=rendered["operation_id"],
            rendering_identity=preview["render_identity"])
        if prior is not None and prior != state:
            history = root / "retained-report-selections" / (digest(prior) + ".json")
            atomic_json(history, prior, immutable=True)
        atomic_json(state_path, state)
        _verify_report(ws, state)
    # Freeze the receiving selection before the first member copy, including
    # the report-complete / copy-incomplete interruption boundary.
    atomic_json(prior_selection_path, state, immutable=True)
    files = state["files"]
    exported_report = export_root / "native-report"
    for record in _report_files(state).values():
        original = relative_file(report_root, record["path"])
        observed_report_render._retain_original(original, exported_report / record["path"], record)
    retained_selection = exported_report / "native-selection.json"
    atomic_json(retained_selection, state, immutable=True)
    # The archive selects this export's original report, independently of any
    # later current report in the same Workspace. Use the ordinary portable
    # delivery file index so fresh receiving retains the same exact choice.
    capture = export_root / "report-snapshots" / digest(state)
    capture.mkdir(parents=True, exist_ok=True)
    captured_files = {str(index): item for index, item in enumerate(_report_files(state).values())}
    for item in captured_files.values():
        original = relative_file(exported_report, item["path"])
        observed_report_render._retain_original(original, capture / item["path"], item)
    atomic_json(capture / "native-selection.json", state, immutable=True)
    captured_files["report_selection"] = describe_file(capture, capture / "native-selection.json")
    archive_state = export_root / "workspace-export.json"
    record = portable.backup(ws, archive, delivery_root=capture, delivery_files=captured_files)
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
    parser.add_argument("--new-rendering", action="store_true",
                        help="Prepare an explicit new renderer-bound report edition in a new export directory")
    args = parser.parse_args(argv)
    result = deliver(args.workspace, args.manifest, args.output, new_rendering=args.new_rendering)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
