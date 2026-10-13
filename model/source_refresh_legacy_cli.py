"""Source-refresh CLI for an existing Upper Savannah workspace."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

from .common import atomic_json, canonical, read_json
from .source_refresh import SourceRefresh
from .workspace import Workspace


def parser():
    shared = argparse.ArgumentParser(add_help=False)
    shared.add_argument('--workspace', required=False, default=argparse.SUPPRESS,
                        help='Original workspace directory (before or after the command)')
    p = argparse.ArgumentParser(description=__doc__, parents=[shared])
    subs = p.add_subparsers(dest='command', required=True)
    for command in ('diff', 'plan'):
        q = subs.add_parser(command, parents=[shared])
        q.add_argument('--from', dest='old', required=True, help='Retained source collection ID')
        q.add_argument('--to', dest='new', required=True, help='Replacement retained source collection ID')
        q.add_argument('--mapping', type=Path, help='JSON object: old source ID to replacement source ID')
        if command == 'plan':
            q.add_argument('--roots', type=Path, help='JSON object of original grids/profiles/scenarios/runs IDs')
            q.add_argument('--title', default='Source refresh')
    for command in ('show', 'status', 'apply', 'report', 'export'):
        q = subs.add_parser(command, parents=[shared]); q.add_argument('plan_id')
        if command == 'apply':
            q.add_argument('--prepare-only', action='store_true', help='Prepare changed selections without running InVEST')
            q.add_argument('--progress', action='store_true', help='Emit compact progress JSON to stderr')
        if command == 'report':
            q.add_argument('--format', choices=('json', 'csv', 'html'), default='json')
            q.add_argument('--output', type=Path)
        if command == 'export':
            q.add_argument('--output', type=Path, required=True, help='Destination for the original complete workspace backup')
    subs.add_parser('list', parents=[shared])
    return p


def main(argv=None):
    p = parser(); args = p.parse_args(argv)
    if not getattr(args, 'workspace', None):
        p.error('--workspace is required')
    try:
        refresh = SourceRefresh(Workspace(args.workspace))
        if args.command in ('diff', 'plan'):
            mapping = read_json(args.mapping) if args.mapping else None
            if args.command == 'diff':
                value = refresh.source_diff(args.old, args.new, mapping)
            else:
                value = refresh.plan(args.old, args.new, mapping=mapping,
                    roots=read_json(args.roots) if args.roots else None, title=args.title)
        elif args.command == 'show': value = refresh.get(args.plan_id)
        elif args.command == 'status': value = refresh.state(args.plan_id)
        elif args.command == 'list': value = refresh.list()
        elif args.command == 'apply':
            def progress(state):
                key = state.get('active_step')
                event = {'plan_id': state['plan_id'], 'status': state['status'], 'step': key,
                         'native': state.get('steps', {}).get(key), 'updated_at': state['updated_at']}
                print(canonical(event).decode().rstrip(), file=sys.stderr, flush=True)
            value = refresh.apply(args.plan_id, execute_runs=not args.prepare_only,
                                  progress=progress if args.progress else None).state
        elif args.command == 'export': value = refresh.export(args.plan_id, args.output)
        else:
            value = refresh.report(args.plan_id)[args.format]
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                if args.format == 'json': atomic_json(args.output, value)
                else: args.output.write_text(value, encoding='utf-8', newline='')
                value = {'output': str(args.output), 'format': args.format, 'plan_id': args.plan_id}
            elif args.format != 'json':
                sys.stdout.write(value); return 0
        sys.stdout.write(canonical(value).decode()); return 0
    except KeyboardInterrupt:
        print(json.dumps({'error': 'Interrupted; reopen the same plan to resume.'}), file=sys.stderr)
        return 130
    except (ValueError, OSError, RuntimeError, KeyError) as exc:
        print(json.dumps({'error': str(exc), 'type': type(exc).__name__}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
