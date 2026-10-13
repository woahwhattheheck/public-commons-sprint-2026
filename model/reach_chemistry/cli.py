"""Command-line operation with complete retained outputs and event checkpoints."""
from __future__ import annotations
import argparse
import contextlib
import fcntl
from hashlib import sha256
import json
from pathlib import Path
import signal
import sys
from .model import Project, ModelError, canonical_bytes
from .solver import Cancelled
from .service import execute
from .io import json_write, write_outputs

@contextlib.contextmanager
def exclusive(path):
    with path.open('a+') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield

def load(path):
    def invalid(value): raise ModelError('JSON contains a non-finite number: ' + value)
    return json.loads(Path(path).read_text(encoding='utf-8'), parse_constant=invalid)

def main(argv=None):
    parser = argparse.ArgumentParser(description='TokenJunkieLabs reach-network chemistry')
    sub = parser.add_subparsers(dest='command', required=True)
    check = sub.add_parser('inspect', help='Validate input, hydraulic continuity and chemistry basis')
    check.add_argument('project', type=Path)
    run = sub.add_parser('run', help='Run a saved analysis and retain complete editable files')
    run.add_argument('project', type=Path)
    run.add_argument('request', type=Path)
    run.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        project = Project(load(args.project))
        if args.command == 'inspect':
            print(json.dumps({'title':project.title, 'project_sha256':project.fingerprint,
                'reaches':project.nr,'species':project.ns,'states':project.n,
                'duration_days':project.end_day,
                'water_balances':[project.check_water(p) for p in project.phases]}, indent=2))
            return 0
        request = load(args.request)
        # Never silently mix two requests in the same saved operation directory.
        args.output.mkdir(parents=True, exist_ok=True)
        with exclusive(args.output/'.run.lock'):
            request_id = sha256(canonical_bytes({'project':project.fingerprint,'request':request})).hexdigest()
            identity = args.output/'operation.json'
            if identity.exists() and load(identity).get('id') != request_id:
                raise ModelError('output directory belongs to another analysis; choose a new directory')
            json_write(identity, {'id':request_id,'project_sha256':project.fingerprint,'request':request})
            status_file=args.output/'status.json'
            if status_file.exists() and load(status_file).get('state')=='complete':
                manifest=load(args.output/'artifacts/manifest.json')
                for item in manifest['files']:
                    file=(args.output/'artifacts'/item['path']).resolve(strict=True)
                    if not file.is_relative_to((args.output/'artifacts').resolve()):
                        raise ModelError('Retained artifact leaves its analysis directory')
                    data=file.read_bytes()
                    if len(data)!=item['bytes'] or sha256(data).hexdigest()!=item['sha256']:
                        raise ModelError('Retained analysis artifact changed: '+item['path'])
                print(json.dumps({'state':'complete','operation_id':request_id,'reopened':True,
                    'report':str(args.output/'artifacts/report.html'),'archive':str(args.output/'artifacts/results.zip')},indent=2))
                return 0
            stop = False
            def interrupt(*unused):
                nonlocal stop
                stop = True
            previous = signal.signal(signal.SIGINT, interrupt)
            checkpoint_file = args.output/'checkpoint.json'
            resume = load(checkpoint_file) if checkpoint_file.exists() and request.get('mode','simulate') == 'simulate' else None
            try:
                result = execute(project, request, cancelled=lambda:stop,
                    progress=lambda event: json_write(args.output/'progress.json',event),
                    checkpoint=lambda state:json_write(checkpoint_file,state), resume=resume)
                manifest = write_outputs(args.output/'artifacts',project,result,request)
                json_write(args.output/'status.json', {'state':'complete','id':request_id,
                            'artifacts':manifest,'archive':'artifacts/results.zip'})
            except BaseException as error:
                json_write(args.output/'status.json', {'state':'cancelled' if isinstance(error,Cancelled) else 'failed',
                            'id':request_id,'error':str(error)})
                raise
            finally:
                signal.signal(signal.SIGINT, previous)
            print(json.dumps({'state':'complete','operation_id':request_id,
                              'report':str(args.output/'artifacts/report.html'),
                              'archive':str(args.output/'artifacts/results.zip')},indent=2))
            return 0
    except (ValueError, TypeError, KeyError, ArithmeticError, OSError, Cancelled) as error:
        print(json.dumps({'error':type(error).__name__,'message':str(error)}),file=sys.stderr)
        return 130 if isinstance(error,Cancelled) else 2

if __name__ == '__main__': raise SystemExit(main())
