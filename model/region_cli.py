"""Command-line access to the same original native region calculation."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

from .common import file_digest
from .spatial import SpatialReview
from .spatial_regions import SpatialRegions, csv_exports
from .workspace import Workspace


def _write(path, data):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Choose an original export path, not a file alias")
    if path.exists():
        if path.read_bytes() == data:
            return
        raise ValueError("An unrelated export already exists: " + str(path))
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".region-export-", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        # Publish without replacing a file created concurrently.
        os.link(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def export(workspace, result, directory):
    folder = Path(directory).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    original = workspace.root / "spatial-regions" / (result["id"] + ".json")
    bodies = {result["id"] + ".json": original.read_bytes(),
              **{name: content.encode("utf-8") for name, content in csv_exports(result).items()}}
    # Inspect all existing destinations before publishing any new members.
    for name, data in bodies.items():
        target = folder / name
        if target.is_symlink() or target.exists() and target.read_bytes() != data:
            raise ValueError("Choose a new export directory; existing member differs: " + name)
    for name, data in bodies.items():
        _write(folder / name, data)
    return [{"filename": name, "path": str(folder / name), "bytes": len(data),
             "sha256": file_digest(folder / name)} for name, data in bodies.items()]


def _plan(path):
    def invalid(value):
        raise ValueError("Region plan numbers must be finite: " + value)
    if path == "-":
        result = json.load(sys.stdin, parse_constant=invalid)
    else:
        with Path(path).open(encoding="utf-8") as stream:
            result = json.load(stream, parse_constant=invalid)
    if not isinstance(result, dict):
        raise ValueError("The region plan must be an object")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description="Native retained raster region measurements")
    sub = parser.add_subparsers(dest="command", required=True)
    catalog = sub.add_parser("catalog", help="List actual retained spatial layers and region analyses")
    catalog.add_argument("workspace")
    catalog.add_argument("--describe", action="store_true", help="Read original native band1descriptions for raster layers")
    describe = sub.add_parser("describe", help="Describe one retained native layer")
    describe.add_argument("workspace")
    describe.add_argument("layer_id")
    describe.add_argument("--band", type=int, default=1)
    analyze = sub.add_parser("analyze", help="Run the same native analysis from an operator-shaped JSON plan")
    analyze.add_argument("workspace")
    analyze.add_argument("plan", help="JSON plan path or - for standard input")
    full = sub.add_parser("analyze-source", help="Measure one original raster's full native footprint")
    full.add_argument("workspace")
    full.add_argument("layer_id")
    full.add_argument("--band", type=int, default=1)
    full.add_argument("--comparison")
    full.add_argument("--comparison-band", type=int, default=1)
    full.add_argument("--title", default="Original native raster extent")
    full.add_argument("--notes", default="")
    full.add_argument("--bins", type=int, default=32)
    full.add_argument("--all-touched", action="store_true")
    inspect = sub.add_parser("inspect", help="Reopen an original saved region analysis")
    inspect.add_argument("workspace")
    inspect.add_argument("id")
    for command in (analyze, full, inspect):
        command.add_argument("--export", help="Write original analysis JSON and numeric CSV tables")
    for command in (analyze, full):
        command.add_argument("--quiet-progress", action="store_true")
    args = parser.parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        spatial = SpatialReview(workspace)
        regions = SpatialRegions(workspace, spatial=spatial)
        def progress(value):
            if not args.quiet_progress:
                print(json.dumps({"schema": "upstate.region-progress/v1", **value},
                                 sort_keys=True, allow_nan=False), file=sys.stderr, flush=True)
        if args.command == "catalog":
            result = spatial.catalog()
            result["region_analyses"] = regions.catalog()
            if args.describe:
                result["native_rasters"] = [
                    spatial.describe({"selection": {"layer_id": row["id"], "band": 1}})
                    for row in result["layers"] if row["kind"] == "raster"]
        elif args.command == "describe":
            rows = spatial.catalog()["layers"]
            row = next((item for item in rows if item["id"] == args.layer_id), None)
            if row is None:
                raise ValueError("The original layer is absent from this Workspace")
            selection = {"layer_id": args.layer_id}
            if row["kind"] == "raster":
                selection["band"] = args.band
            result = spatial.describe({"selection": selection})
        elif args.command == "analyze":
            result = regions.analyze(_plan(args.plan), progress=progress)
        elif args.command == "analyze-source":
            primary = {"layer_id": args.layer_id, "band": args.band}
            native = spatial.describe({"selection": primary})["native"]
            if native["kind"] != "raster":
                raise ValueError("Full-source analysis requires an original raster")
            payload = {"title": args.title, "notes": args.notes, "primary": primary,
                       "comparison": {"layer_id": args.comparison, "band": args.comparison_band} if args.comparison else None,
                       "region": {"crs": native["crs"], "bounds": native["bounds"]},
                       "histogram_bins": args.bins, "all_touched": args.all_touched}
            result = regions.analyze(payload, progress=progress)
        else:
            result = regions.inspect(args.id)
        if getattr(args, "export", None):
            result = {**result, "exported_files": export(workspace, result, args.export)}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError, ImportError) as error:
        print(json.dumps({"schema": "upstate.region-error/v1", "error": str(error),
                          "type": type(error).__name__}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
