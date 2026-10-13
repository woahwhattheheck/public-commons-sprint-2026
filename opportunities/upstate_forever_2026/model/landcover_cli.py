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
    args = parser.parse_args(argv)
    try:
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
