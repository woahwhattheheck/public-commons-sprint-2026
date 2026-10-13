"""CLI for the existing-grid land-cover accounting consumer."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

from .landcover_ledger import LedgerError, Options, RasterInput, run_ledger, run_native_workspace
from .landcover_exports import export_report, make_portable, receive_portable


def mapping_args(values: list[str], parser: argparse.ArgumentParser) -> dict[str, str]:
    result = {}
    for entry in values:
        if "=" not in entry:
            parser.error("Scenario selection must be NAME=PATH")
        name, path = entry.split("=", 1)
        if not name.strip() or not path or name in result:
            parser.error("Scenario names must be nonempty and unique; paths are required")
        result[name] = path
    return result



def _workspace_command(args):
    """Use the original retained Workspace, reducer and portable readers."""
    import os
    import subprocess
    from .workspace import Workspace
    from . import landcover_workspace
    from .common import atomic_json, file_digest, read_json, verify_file
    from .portable import backup, inspect_archive, restore

    workspace = Workspace(args.workspace)
    result_path = args.result.expanduser().resolve() if args.result else None
    if result_path and result_path.is_relative_to(workspace.root):
        raise LedgerError("Save the operation result outside the original Workspace")
    selection_path = getattr(args, "selection", None)
    if result_path and selection_path and result_path == selection_path.expanduser().resolve():
        raise LedgerError("Keep the exact input selection JSON separate from the operation result")
    receive_root = getattr(args, "receive_report", None)
    restore_root = getattr(args, "restore", None)
    archive_path = getattr(args, "archive", None)
    targets = [path.expanduser().resolve() for path in (receive_root, restore_root) if path]
    if any(path.is_relative_to(workspace.root) or workspace.root.is_relative_to(path) for path in targets):
        raise LedgerError("Receiving destinations must be separate from the original Workspace and its ancestors")
    if len(targets) == 2 and (targets[0].is_relative_to(targets[1]) or targets[1].is_relative_to(targets[0])):
        raise LedgerError("Choose separate report and Workspace receiving directories")
    if result_path and any(result_path.is_relative_to(path) for path in targets):
        raise LedgerError("Save operation JSON outside the verified receiving directories")
    if archive_path:
        archive_path = archive_path.expanduser().resolve()
        if result_path == archive_path or any(archive_path.is_relative_to(path) for path in targets):
            raise LedgerError("Keep archive and operation JSON separate from receiving directories")
    if args.workspace_command == "catalog":
        result = landcover_workspace.catalog(workspace)
    elif args.workspace_command == "preview":
        selection = json.loads(args.selection.read_text(encoding="utf-8-sig"))
        result = landcover_workspace.preview_inputs(workspace, selection)
    else:
        if args.workspace_command == "build":
            selection = json.loads(args.selection.read_text(encoding="utf-8-sig"))
            def progress(status):
                print(json.dumps(status, separators=(",", ":")), file=sys.stderr, flush=True)
            edition = landcover_workspace.build(workspace, selection, progress=progress)
            inspected = landcover_workspace.inspect(workspace, edition["id"])
        else:
            inspected = landcover_workspace.inspect(workspace, args.id)
            edition = inspected["edition"]
        directory = workspace.root / landcover_workspace.KIND / edition["id"]
        result = {
            "schema": "upstate.landcover-workspace-operation/v1",
            "workspace": str(workspace.root), "project": workspace.project,
            "edition": edition, "binding": inspected["binding"],
            "report": {"path": str(directory / edition["files"]["ledger.json"]["path"]),
                       "signature": inspected["report"]["signature"],
                       "rows": len(inspected["report"]["rows"]),
                       "source_editions": inspected["report"].get("source_editions")},
            "report_archive": {"path": str(directory / edition["files"]["archive"]["path"]),
                               **{key: edition["files"]["archive"][key] for key in ("bytes", "sha256")}},
        }

        if args.receive_report:
            report_root = args.receive_report.expanduser().resolve()
            archive = verify_file(directory, edition["files"]["archive"])
            if report_root.exists():
                # A retry reopens the exact already-received native export.
                manifest = read_json(report_root / "export-manifest.json")
                original_manifest = read_json(
                    verify_file(directory, edition["files"]["export-manifest.json"]))
                if manifest != original_manifest:
                    raise LedgerError("Existing report destination belongs to another export")
                expected = {row["path"] for row in manifest["files"]} | {"export-manifest.json"}
                if {path.name for path in report_root.iterdir()} != expected:
                    raise LedgerError("Existing received report has a different member inventory")
                for descriptor in manifest["files"]:
                    verify_file(report_root, descriptor)
                received_report = {"path": str(report_root), "signature": manifest["signature"],
                                   "files": len(expected), "reused": True}
            else:
                received_report = {**receive_portable(archive, report_root), "reused": False}
            received = read_json(report_root / "ledger.json")
            if received != inspected["report"]:
                raise LedgerError("Received report differs from the original computed ledger")
            if inspected["binding"].get("schema") == "upstate.landcover-source-binding/v1":
                if read_json(report_root / "input-editions.json") != inspected["binding"]:
                    raise LedgerError("Received report changed its original annual source binding")
            result["received_report"] = received_report

        if args.archive:
            archive = args.archive.expanduser().resolve()
            destination = args.restore.expanduser().resolve()
            if archive.is_relative_to(workspace.root) or destination.is_relative_to(workspace.root):
                raise LedgerError("Place the portable archive and restored project outside the original Workspace")
            if archive.is_relative_to(destination):
                raise LedgerError("Keep the portable archive outside its receiving destination")
            if archive.exists():
                manifest = inspect_archive(archive, verify=True)
                archive_reused = True
            else:
                backup(workspace, archive)
                manifest = inspect_archive(archive, verify=True)
                archive_reused = False
            if manifest["project"] != workspace.project:
                raise LedgerError("Existing archive belongs to another original project")
            member = "workspace/" + landcover_workspace.KIND + "/" + edition["id"] + "/edition.json"
            descriptor = manifest["members"].get(member)
            edition_path = directory / "edition.json"
            if (not descriptor or descriptor["bytes"] != edition_path.stat().st_size
                    or descriptor["sha256"] != file_digest(edition_path)):
                raise LedgerError("Workspace archive does not retain this exact complete ledger edition")
            if destination.exists():
                restored = Workspace(destination / "workspace")
                restoration = {"workspace": str(restored.root),
                               "application": str(destination / "application"), "reused": True}
            else:
                restoration = {**restore(archive, destination), "reused": False}
                restored = Workspace(restoration["workspace"])
            if restored.project != workspace.project:
                raise LedgerError("Restored Workspace changed the original project identity")
            reopened = landcover_workspace.inspect(restored, edition["id"])
            if reopened != inspected:
                raise LedgerError("Restored original sources or computed ledger differ from the archived edition")
            application = destination / "application"
            command = [sys.executable, "-B", "-m", "model.landcover_cli", "workspace",
                       "--workspace", str(restored.root), "inspect", edition["id"]]
            environment = dict(os.environ)
            # Resolve the transferred application's modules from its own cwd.
            environment.pop("PYTHONPATH", None)
            cold = subprocess.run(command, cwd=application, env=environment,
                                  capture_output=True, text=True, check=False)
            if cold.returncode:
                detail = (cold.stderr or cold.stdout or "No process diagnostic").strip()
                raise LedgerError("Restored application inspect exited "
                                  + str(cold.returncode) + ": " + detail)
            try:
                native_result = json.loads(cold.stdout)
            except (TypeError, ValueError) as exc:
                raise LedgerError("Restored application returned invalid inspection JSON: "
                                  + cold.stderr.strip()) from exc
            if (native_result.get("schema") != "upstate.landcover-workspace-operation/v1"
                    or native_result.get("project") != workspace.project
                    or native_result.get("edition") != edition
                    or native_result.get("binding") != inspected["binding"]
                    or native_result.get("report", {}).get("signature") != inspected["report"]["signature"]
                    or native_result.get("report", {}).get("source_editions") != inspected["report"].get("source_editions")):
                raise LedgerError("Restored application changed the retained edition or its source interpretation")
            result["workspace_archive"] = {"path": str(archive), "bytes": archive.stat().st_size,
                                           "sha256": file_digest(archive), "reused": archive_reused,
                                           "members": len(manifest["members"])}
            result["restored"] = {**restoration, "project": restored.project,
                                  "edition_id": reopened["edition"]["id"],
                                  "binding_sha256": reopened["edition"]["binding_sha256"],
                                  "signature": reopened["report"]["signature"],
                                  "source_identity": "MATCH",
                                  "application_inspection": {"command": command,
                                                             "application": str(application),
                                                             "returncode": cold.returncode,
                                                             "stderr": cold.stderr,
                                                             "edition_id": native_result["edition"]["id"],
                                                             "binding_sha256": native_result["edition"]["binding_sha256"],
                                                             "signature": native_result["report"]["signature"]}}

    if args.result:
        target = args.result.expanduser().resolve()
        if target.is_relative_to(workspace.root):
            raise LedgerError("Save the operation result outside the original Workspace")
        target.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(target, result)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Account against original aligned raster files")
    source = run.add_mutually_exclusive_group(required=True)
    source.add_argument("--workspace", type=Path, help="Native root with rasters/landcover.tif and huc12.geojson")
    source.add_argument("--baseline", type=Path)
    run.add_argument("--zones", type=Path, help="Required with --baseline")
    run.add_argument("--scenario", action="append", default=[], metavar="NAME=PATH", required=True)
    run.add_argument("--baseline-band", type=int, default=1)
    run.add_argument("--scenario-band", action="append", default=[], metavar="NAME=BAND")
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--context", action="append", type=Path, default=[])
    run.add_argument("--id-field", default="huc12")
    run.add_argument("--name-field", default="name")
    run.add_argument("--zone-crs")
    run.add_argument("--tile-size", type=int, default=512)
    run.add_argument("--support", choices=("all", "pair"), default="all")
    run.add_argument("--unknown-policy", choices=("error", "exclude"), default="error")
    run.add_argument("--allow-overlap", action="store_true")
    run.add_argument("--allow-projected-area", action="store_true")
    run.add_argument("--no-rasters", action="store_true")
    run.add_argument("--resume", action="store_true")
    run.add_argument("--title", default="Land-cover change ledger")
    report = commands.add_parser("report", help="Regenerate exports from a retained complete ledger")
    report.add_argument("output", type=Path)
    pack = commands.add_parser("pack", help="Export a complete portable report and raster edition")
    pack.add_argument("output", type=Path); pack.add_argument("destination", type=Path)
    receive = commands.add_parser("receive", help="Verify and receive a portable edition create-only")
    receive.add_argument("archive", type=Path); receive.add_argument("destination", type=Path)
    native = commands.add_parser("workspace", help="Use original imported sources, saved runs and portable Workspace editions")
    native.add_argument("--workspace", type=Path, required=True)
    native_commands = native.add_subparsers(dest="workspace_command", required=True)
    for operation, help_text in (
            ("catalog", "List original raster sources, reporting polygons, runs and editions"),
            ("preview", "Inspect exact source bands, grid compatibility and reporting selection"),
            ("build", "Build and reopen the complete original Workspace ledger"),
            ("inspect", "Verify and reopen an existing complete Workspace ledger")):
        command = native_commands.add_parser(operation, help=help_text)
        command.add_argument("--result", type=Path, help="Save complete operation JSON outside the original Workspace")
        if operation in ("preview", "build"):
            command.add_argument("--selection", type=Path, required=True,
                                 help="Original exact source-mode or run-mode selection JSON")
        if operation == "inspect":
            command.add_argument("id", help="Original retained land-cover edition ID")
        if operation in ("build", "inspect"):
            command.add_argument("--receive-report", type=Path, help="Create or verify the original portable report directory")
            command.add_argument("--archive", type=Path, help="Create or verify a complete original Workspace ZIP")
            command.add_argument("--restore", type=Path, help="Create or verify its separately restored project directory")
    args = parser.parse_args(argv)
    try:
        if args.command == "workspace":
            if args.workspace_command in ("build", "inspect") and bool(args.archive) != bool(args.restore):
                parser.error("--archive and --restore must be supplied together")
            return _workspace_command(args)
        if args.command == "run":
            selections = mapping_args(args.scenario, parser)
            bands = mapping_args(args.scenario_band, parser)
            if set(bands) - set(selections):
                parser.error("Scenario band selection names must match --scenario names")
            try:
                specs = {name: RasterInput(path, int(bands.get(name, "1"))) for name, path in selections.items()}
            except ValueError:
                parser.error("Scenario band values must be integers")
            options = Options(tile_size=args.tile_size, support_scope=args.support,
                              unknown_policy=args.unknown_policy, allow_overlap=args.allow_overlap,
                              allow_projected_area=args.allow_projected_area, write_rasters=not args.no_rasters,
                              resume=args.resume, title=args.title)
            contexts = list(args.context)
            if args.workspace:
                if args.zones:
                    parser.error("Use --baseline with an explicit --zones override")
                baseline_path = args.workspace / "rasters" / "landcover.tif"
                zones_path = args.workspace / "huc12.geojson"
                contexts.extend(args.workspace / p for p in ("run_manifest.json", "grid.json", "scenario_set.json") if (args.workspace / p).is_file())
            else:
                if not args.zones:
                    parser.error("--baseline requires --zones")
                baseline_path, zones_path = args.baseline, args.zones
            def progress(status):
                print(json.dumps(status, separators=(",", ":")), file=sys.stderr, flush=True)
            result = run_ledger(RasterInput(baseline_path, args.baseline_band), specs, zones_path, args.output,
                                options=options, id_field=args.id_field, name_field=args.name_field,
                                zone_crs=args.zone_crs, context_files=contexts, progress=progress)
            export_report(args.output)
            print(json.dumps({"output": str(args.output), "signature": result["signature"],
                              "watersheds": len(result["zones"])-1, "scenarios": len(result["scenarios"])}))
        elif args.command == "report":
            print(json.dumps(export_report(args.output)))
        elif args.command == "pack":
            print(json.dumps(make_portable(args.output, args.destination)))
        elif args.command == "receive":
            print(json.dumps(receive_portable(args.archive, args.destination)))
        return 0
    except KeyboardInterrupt:
        print("Interrupted. Committed windows remain in the ledger; rerun with --resume.", file=sys.stderr)
        return 130
    except (LedgerError, OSError, ValueError) as exc:
        print(f"Land-cover ledger: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
