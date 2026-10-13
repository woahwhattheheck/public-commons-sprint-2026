"""ECSA retained native run CLI. All execution is foreground and interruptible."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
from .gateway import RunGateway
from .archive import export_workspace, receive_workspace
from .bindings import repair_bc10_source
from . import codec


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace',default='.ecsa-runs')
    sub=p.add_subparsers(dest='command',required=True)
    c=sub.add_parser('configure');c.add_argument('provider');c.add_argument('data');c.add_argument('--code-root')
    c=sub.add_parser('submit');c.add_argument('family');c.add_argument('inputs',help='JSON file');c.add_argument('--name',default='Baseline')
    c.add_argument('--scenario',action='store_true');c.add_argument('--file-field',action='append');c.add_argument('--result-file-field',action='append',default=[])
    c.add_argument('--request-key');c.add_argument('--timeout',type=float)
    c=sub.add_parser('submit-manifest');c.add_argument('manifest');c.add_argument('--asset-root');c.add_argument('--request-key');c.add_argument('--result-file-field',action='append',default=[])
    c=sub.add_parser('run');c.add_argument('--workers',type=int,default=2);c.add_argument('--job',action='append')
    c=sub.add_parser('list');c.add_argument('--state');c.add_argument('--family');c.add_argument('--offset',type=int,default=0);c.add_argument('--limit',type=int,default=100)
    for cmd in ('inspect','cancel','retry','select'):
        c=sub.add_parser(cmd);c.add_argument('job')
    c=sub.add_parser('result');c.add_argument('job');c.add_argument('output',help='Complete typed JSON output file')
    c=sub.add_parser('compare');c.add_argument('baseline');c.add_argument('candidate');c.add_argument('output');c.add_argument('--spatial-key',action='append')
    c=sub.add_parser('report');c.add_argument('directory');c.add_argument('--baseline');c.add_argument('--candidate');c.add_argument('--spatial-key',action='append')
    c=sub.add_parser('export');c.add_argument('output')
    c=sub.add_parser('receive');c.add_argument('archive');c.add_argument('destination')
    c=sub.add_parser('repair-bc10');c.add_argument('source');c.add_argument('--write',action='store_true')
    c=sub.add_parser('integrate-upstate');c.add_argument('source');c.add_argument('--write',action='store_true')
    sub.add_parser('recover')
    a=p.parse_args(argv)
    if a.command=='integrate-upstate':
        from .upstate import integrate_operator
        out=integrate_operator(a.source,write=a.write)
    elif a.command=='repair-bc10': out=repair_bc10_source(a.source,write=a.write)
    elif a.command=='receive': out={'workspace':str(receive_workspace(a.archive,a.destination).root)}
    else:
        g=RunGateway(a.workspace)
        if a.command=='configure': out={'snapshot_sha':g.configure(a.provider,a.data,a.code_root)}
        elif a.command=='submit': out=g.submit(a.family,json.loads(Path(a.inputs).read_text()),name=a.name,
            kind='scenario' if a.scenario else 'baseline',file_fields=a.file_field if a.file_field is not None else ['/weather_csv'],
            result_file_fields=a.result_file_field,request_key=a.request_key,timeout_seconds=a.timeout)
        elif a.command=='submit-manifest': out=g.submit_manifest(json.loads(Path(a.manifest).read_text()),asset_root=a.asset_root,
            request_key=a.request_key,result_file_fields=a.result_file_field)
        elif a.command=='run':
            out=g.execute(a.job,workers=a.workers,progress=lambda r:print(json.dumps({'event':'state','job_id':r['id'],'state':r['state'],'attempt':r['attempt']}),flush=True))
        elif a.command=='list': out=g.store.list(a.state,a.family,a.limit,a.offset)
        elif a.command=='inspect':
            row=g.store.get(a.job);out={'job':row,'events':g.store.events(a.job),'spec':codec.pack(g.store.read(row['spec_sha']))}
        elif a.command=='cancel': out=g.store.cancel(a.job)
        elif a.command=='retry': out=g.store.retry(a.job)
        elif a.command=='select':
            g.select(a.job);out={'active_job_id':a.job}
        elif a.command=='result':
            with Path(a.output).open('xb') as f:f.write(codec.dumps(g.packet(a.job)))
            out={'path':a.output}
        elif a.command=='compare':
            value=g.comparison(a.baseline,a.candidate,tuple(a.spatial_key or ['source_cell_id']))
            with Path(a.output).open('xb') as f:f.write(codec.dumps(value))
            out={'path':a.output}
        elif a.command=='report': out=g.export_report(a.directory,a.baseline,a.candidate,tuple(a.spatial_key or ['source_cell_id']))
        elif a.command=='export':
            manifest=export_workspace(g.store,a.output);out={'path':a.output,'files':len(manifest['files'])}
        elif a.command=='recover': out=g.store.recover()
    print(json.dumps(out,ensure_ascii=False,sort_keys=True,default=str))
    return 1 if a.command=='run' and out.get('failed',0) else 0

if __name__=='__main__':
    try: raise SystemExit(main())
    except (ValueError,KeyError,OSError,RuntimeError) as e:
        print(f'{type(e).__name__}: {e}',file=sys.stderr);raise SystemExit(2)
