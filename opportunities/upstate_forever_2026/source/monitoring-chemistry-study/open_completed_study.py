#!/usr/bin/env python3
"""Open the completed study using the delivered application's own source files."""
from pathlib import Path
import argparse, json, subprocess, sys

_CHILD = r'''
import json,sys
from pathlib import Path
app,root,reports_path,comparison_path=map(Path,sys.argv[1:])
sys.path.insert(0,str(app))
from model import workspace,chemistry,chemistry_reports,chemistry_report_source,monitoring_workspace
modules=(workspace,chemistry,chemistry_reports,chemistry_report_source,monitoring_workspace)
loaded={m.__name__:str(Path(m.__file__).resolve()) for m in modules}
if any(not Path(path).is_relative_to(app) for path in loaded.values()):
    raise ValueError('A selected producer was imported from outside the delivered application')
reports=json.loads(reports_path.read_text());comparison=json.loads(comparison_path.read_text())
ws=workspace.Workspace(root,create=False);service=chemistry.Chemistry(ws)
result={'schema':'upstate.archived-application-reopen/v1','application':str(app),
        'workspace':str(root),'interpreter':sys.executable,'python_version':sys.version,
        'loaded_source':loaded,'project_id':ws.project['id'],'analyses':{}}
for mode in ('calibration','sensitivity','uncertainty','monitoring'):
    run=service.get_run(reports['analyses'][mode]['run_id'])
    if run['state']!='complete':raise ValueError('Received native analysis is incomplete')
    report=chemistry_reports.inspect(ws,reports['reports'][mode]['id'])
    source=chemistry_report_source.inspect(ws,reports['sources'][mode]['id'])
    result['analyses'][mode]={'run_id':run['id'],'report_id':report['id'],'source_id':source['id'],'state':run['state']}
monitor=monitoring_workspace.MonitoringWorkspace(ws)
frontier=monitor.get('frontiers',comparison['frontier_id'])
result['plans']=[{'plan_id':pid,'state':monitor.get('plans',pid)['status']} for pid in frontier['plan_ids']]
record=ws._get('monitoring_frontier_comparisons',comparison['id'])
if record!=comparison:raise ValueError('Received comparison changed')
result.update(comparison_id=record['id'],state='complete')
print(json.dumps(result,ensure_ascii=False,indent=2))
'''


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--application',type=Path,required=True);p.add_argument('--workspace',type=Path,required=True)
    p.add_argument('--reports',type=Path,required=True);p.add_argument('--comparison',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();paths=[path.resolve(strict=True) for path in (a.application,a.workspace,a.reports,a.comparison)]
    # Isolated startup ignores PYTHONPATH and user site customizations. The child
    # imports only the explicitly selected archived application before its reads.
    run=subprocess.run([sys.executable,'-I','-c',_CHILD,*map(str,paths)],cwd=paths[0],capture_output=True,text=True)
    if run.returncode:
        sys.stderr.write(run.stderr);raise SystemExit(run.returncode)
    result=json.loads(run.stdout);a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'state':result['state'],'application':result['application'],'opened_analyses':len(result['analyses']),'opened_plans':len(result['plans'])}))

if __name__=='__main__':main()
