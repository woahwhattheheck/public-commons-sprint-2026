"""Native command-line operation of retained vector cohort measurements."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

from .common import file_digest
from .region_cli import _plan
from .spatial import _signature
from .spatial_cohorts import SpatialCohorts, SORTS
from .workspace import Workspace


def _copy(source, target):
    if target.is_symlink():
        raise ValueError("Choose an original cohort export path")
    before = _signature(source)
    if target.exists():
        if target.stat().st_size == source.stat().st_size and file_digest(target) == file_digest(source):
            return
        raise ValueError("An unrelated cohort export already exists: " + str(target))
    pending = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".cohort-export-", dir=target.parent, delete=False) as stream:
            pending = Path(stream.name)
            with source.open("rb") as original:
                shutil.copyfileobj(original, stream, length=1024 * 1024)
            stream.flush()
            os.fsync(stream.fileno())
        if _signature(source) != before:
            raise ValueError("The retained cohort artifact changed during export")
        os.link(pending, target)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def export(model, result, directory):
    folder = Path(directory).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    manifest = model.workspace.root / "spatial-cohorts" / (result["id"] + ".json")
    sources = [(manifest, manifest.name)]
    sources.extend((model._file(metadata), Path(metadata["path"]).name)
                   for metadata in [result["rows_file"], *result["files"]])
    # Resolve all conflicts before creating any export members.
    for source, name in sources:
        target = folder / name
        if target.is_symlink() or target.exists() and (
                target.stat().st_size != source.stat().st_size or file_digest(target) != file_digest(source)):
            raise ValueError("Choose a new export directory; an existing member differs: " + name)
    for source, name in sources:
        _copy(source, folder / name)
    return [{"filename": name, "path": str(folder / name), "bytes": (folder / name).stat().st_size,
             "sha256": file_digest(folder / name)} for _, name in sources]


def _finite_json(value):
    def invalid(number):
        raise ValueError("Original filter values must be finite: " + number)
    return json.loads(value, parse_constant=invalid)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Original vector collections to native per-feature raster measurements")
    commands = parser.add_subparsers(dest="command", required=True)
    catalog = commands.add_parser("catalog", help="List original source layers and retained cohorts")
    catalog.add_argument("workspace")
    catalog.add_argument("--describe", action="store_true")
    analyze = commands.add_parser("analyze", help="Run an original operator-shaped JSON cohort plan")
    analyze.add_argument("workspace")
    analyze.add_argument("plan")
    source = commands.add_parser("analyze-source", help="Measure the original polygons from one retained vector")
    source.add_argument("workspace")
    source.add_argument("vector_layer_id")
    source.add_argument("raster_layer_id")
    source.add_argument("--vector-layer")
    source.add_argument("--where", type=_finite_json, default={})
    source.add_argument("--feature-id", action="append", dest="feature_ids")
    source.add_argument("--label-field")
    source.add_argument("--band", type=int, default=1)
    source.add_argument("--comparison")
    source.add_argument("--comparison-band", type=int, default=1)
    source.add_argument("--title", default="Original feature cohort")
    source.add_argument("--notes", default="")
    source.add_argument("--bins", type=int, default=32)
    source.add_argument("--all-touched", action="store_true")
    inspect = commands.add_parser("inspect", help="Reopen an original completed cohort")
    inspect.add_argument("workspace")
    inspect.add_argument("id")
    page = commands.add_parser("page", help="Read a filtered, sorted page of original feature measurements")
    page.add_argument("workspace")
    page.add_argument("id")
    page.add_argument("--offset", type=int, default=0)
    page.add_argument("--limit", type=int, default=100)
    page.add_argument("--search", default="")
    page.add_argument("--sort", choices=sorted(SORTS), default="feature_id")
    page.add_argument("--descending", action="store_true")
    for command in (source, analyze, inspect):
        command.add_argument("--export")
    for command in (source, analyze):
        command.add_argument("--quiet-progress", action="store_true")
    args = parser.parse_args(argv)
    try:
        model = SpatialCohorts(Workspace(args.workspace))
        def progress(value):
            if not args.quiet_progress:
                print(json.dumps({"schema": "upstate.cohort-progress/v1", **value},
                                 sort_keys=True, allow_nan=False), file=sys.stderr, flush=True)
        if args.command == "catalog":
            result = {**model.spatial.catalog(), "cohorts": model.catalog()}
            if args.describe:
                result["native_layers"] = [model.spatial.describe({"selection": {"layer_id": row["id"]}})
                                          for row in result["layers"]]
        elif args.command == "analyze":
            result = model.analyze(_plan(args.plan), progress=progress)
        elif args.command == "analyze-source":
            selection = {"layer_id": args.vector_layer_id, "where": args.where}
            if args.vector_layer:
                selection["layer"] = args.vector_layer
            payload = {"title": args.title, "notes": args.notes, "source_selection": selection,
                       "feature_ids": args.feature_ids, "label_field": args.label_field,
                       "primary": {"layer_id": args.raster_layer_id, "band": args.band},
                       "comparison": {"layer_id": args.comparison, "band": args.comparison_band} if args.comparison else None,
                       "histogram_bins": args.bins, "all_touched": args.all_touched}
            result = model.analyze(payload, progress=progress)
        elif args.command == "page":
            result = model.page(args.id, **{key: getattr(args, key) for key in ("offset", "limit", "search", "sort", "descending")})
        else:
            result = model.inspect(args.id)
        if getattr(args, "export", None):
            result = {**result, "exported_files": export(model, result, args.export)}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError, ImportError, ArithmeticError, RuntimeError, sqlite3.Error) as error:
        print(json.dumps({"schema": "upstate.cohort-error/v1", "error": str(error),
                          "type": type(error).__name__}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
