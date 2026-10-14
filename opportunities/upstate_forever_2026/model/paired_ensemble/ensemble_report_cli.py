"""Capture, receive, import and render original paired-ensemble scientific sources.

Capture/inspect/export/receive use bootstrap Python and retained original files.
Workspace import and document rendering use the installed application services.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
import zipfile
from .ensemble_report_source import capture, export_source, inspect, prepare


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    command = sub.add_parser('capture', help='Retain a complete result directory as an importable scientific source')
    command.add_argument('--project', required=True)
    command.add_argument('--out', required=True)
    command.add_argument('--title')
    command.add_argument('--zip', dest='archive')
    for name in ('prepare', 'render'):
        command = sub.add_parser(name, help='Use the original Workspace and scientific report renderer')
        command.add_argument('--workspace', required=True)
        command.add_argument('--ensemble-id', required=True)
        command.add_argument('--title')
        if name == 'render':
            command.add_argument('--out', required=True)
    command = sub.add_parser('inspect', help='Verify every member of a complete report source')
    command.add_argument('--source', required=True)
    command = sub.add_parser('export', help='Export a complete source for the original source importer')
    command.add_argument('--source', required=True)
    command.add_argument('--out', required=True)
    command = sub.add_parser('receive', help='Receive an original source ZIP into a new movable directory')
    command.add_argument('--archive', required=True)
    command.add_argument('--out', required=True)
    command.add_argument('--max-bytes', type=int, help='Optional complete uncompressed receiving allowance')
    for name in ('import', 'render-source'):
        command = sub.add_parser(name, help='Import a received source with its complete original companions')
        command.add_argument('--workspace', required=True)
        command.add_argument('--source', required=True)
        if name == 'render-source':
            command.add_argument('--out', required=True)
            command.add_argument('--title')
    args = parser.parse_args(argv)
    try:
        if args.command == 'capture':
            result = capture(args.project, args.out, title=args.title)
            if args.archive:
                result['archive'] = export_source(result['directory'], args.archive)
        elif args.command == 'inspect':
            result = inspect(args.source)
        elif args.command == 'export':
            result = export_source(args.source, args.out)
        elif args.command == 'receive':
            from .ensemble_source_receiving import receive_source
            result = receive_source(args.archive, args.out, max_bytes=args.max_bytes)
        else:
            from model.workspace import Workspace
            workspace = Workspace(Path(args.workspace))
            if args.command in ('import', 'render-source'):
                from .ensemble_source_receiving import import_source
                result = import_source(workspace, args.source)
            else:
                selected = {'ensemble_id': args.ensemble_id}
                if args.title is not None:
                    selected['title'] = args.title
                result = prepare(workspace, selected)
            if args.command in ('render', 'render-source'):
                from model import observed_report_render
                title = args.title if args.title is not None else result['title']
                preview = observed_report_render.prepare(workspace, [result['source_choice']], title=title)
                result['rendered'] = observed_report_render.render(workspace, preview, args.out)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError, ImportError, EOFError, zipfile.BadZipFile) as error:
        print(json.dumps({'error': type(error).__name__, 'message': str(error)}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
