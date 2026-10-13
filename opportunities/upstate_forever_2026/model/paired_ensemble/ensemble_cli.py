"""Command-line receiving and analysis of original completed Workspace runs.

Uses Rasterio and the finished native artifacts; InVEST is not needed again.
Copyright 2026 TokenJunkieLabs.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
from .ensemble_store import digest, identifier, read
from .ensemble_workspace import EnsembleWorkspace


class CompletedWorkspace:
    """Read the original immutable selections without importing model runtimes.

    This adapter does not prepare grids, edit profiles or execute native models.
    EnsembleWorkspace writes derived products only to ensemble-products/.
    """
    def __init__(self, root):
        self.root = Path(root).resolve(strict=True)
        self.project = read(self.root / 'workspace.json')
        if self.project.get('schema') != 'upstate.scientific-workbench/v1':
            raise ValueError('Select an original scientific Workspace')

    def _get(self, kind, key):
        if kind not in ('profiles', 'scenarios'):
            raise ValueError('This consumer reads original profile/scenario selections only')
        key = identifier(key)
        value = read(self.root / kind / (key + '.json'))
        if digest(value) != key:
            raise ValueError('Original retained selection changed')
        return {**value, 'id': key}

    def inspect_run(self, key):
        key = identifier(key)
        value = read(self.root / 'runs' / key / 'run.json')
        if value.get('id') != key or digest(value['selection']) != key:
            raise ValueError('Original native run selection changed')
        return value

    def get_grid(self, key):
        key = identifier(key)
        value = read(self.root / 'grids' / key / 'grid.json')
        if value.get('state') != 'complete' or value.get('id') != key or digest({'spec': value['spec'], 'grid': value['grid']}) != key:
            raise ValueError('Original grid definition changed or is incomplete')
        return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ('preview', 'build', 'resume', 'pause'):
        child = commands.add_parser(command)
        child.add_argument('--workspace', required=True)
        source = child.add_mutually_exclusive_group(required=True)
        source.add_argument('--selection', help='Native paired-run JSON selection')
        if command != 'pause':
            source.add_argument('--ensemble-id', help='Retained native analysis ID; recover its original pairs and execution controls')
    child = commands.add_parser('list')
    child.add_argument('--workspace', required=True)
    child = commands.add_parser('inspect')
    child.add_argument('--project', required=True, help='Completed analysis/result directory')
    child = commands.add_parser('report')
    child.add_argument('--project', required=True)
    child = commands.add_parser('export')
    child.add_argument('--project', required=True)
    child.add_argument('--out', required=True)
    child = commands.add_parser('receive')
    child.add_argument('--archive', required=True)
    child.add_argument('--out', required=True)
    child.add_argument('--max-bytes', type=int)
    child = commands.add_parser('analyze-rasters')
    child.add_argument('--selection', required=True, help='Explicit upstate.ensemble-input/v1 JSON with absolute file paths')
    child.add_argument('--out', required=True)
    child.add_argument('--memory-mb', type=float, default=256)
    child.add_argument('--tile-size', type=int, default=256)
    args = parser.parse_args(argv)
    progress = lambda value: print(json.dumps(value, allow_nan=False), file=sys.stderr, flush=True)
    try:
        if args.command in ('preview', 'build', 'resume', 'pause', 'list'):
            app = EnsembleWorkspace(CompletedWorkspace(args.workspace))
            if args.command == 'list':
                result = app.list()
            else:
                selection = (app.retained_selection(args.ensemble_id)
                             if getattr(args, 'ensemble_id', None) else read(args.selection))
                fn = getattr(app, 'cancel' if args.command == 'pause' else args.command)
                result = fn(selection, on_progress=progress) if args.command in ('build', 'resume') else fn(selection)
        elif args.command == 'receive':
            from .ensemble_portable import receive_project
            result = receive_project(args.archive, args.out, max_bytes=args.max_bytes)
        elif args.command == 'export':
            from .ensemble_portable import export_project
            result = export_project(args.project, args.out)
        elif args.command == 'report':
            from .ensemble_report import export_reports
            result = export_reports(args.project)
        elif args.command == 'inspect':
            from .ensemble_store import verify
            result = read(Path(args.project) / 'analysis.json')
            if result['id'] != digest(result['selection']):
                raise ValueError('Analysis identity changed')
            for artifact in result.get('artifacts', {}).values():
                verify(args.project, artifact)
            reports = read(Path(args.project) / 'reports.json')
            for artifact in reports['files']:
                verify(args.project, artifact)
        else:
            from .ensemble_rasters import analyze
            from .ensemble_report import export_reports
            result = analyze(read(args.selection), args.out, memory_mb=args.memory_mb,
                             tile_size=args.tile_size, on_progress=progress)
            result['reports'] = export_reports(result['directory'])
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({'error': type(exc).__name__, 'message': str(exc)}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
