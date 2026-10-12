#!/usr/bin/env python3
"""Admit the one original MCC issued-source receiving operation."""
import argparse,json,sys,sysconfig
from pathlib import Path
ROOT=Path(__file__).resolve().parent
selection=json.loads((ROOT/'selection.json').read_text())
HOST=Path(selection['controller_host'])
if not HOST.is_absolute():raise RuntimeError('An absolute original native-controller directory is required')
sys.path.insert(0,str(HOST))
from native_foreground import load_native,ForegroundLaunch
native=load_native(str(HOST))
parser=argparse.ArgumentParser();native.launch_options(parser)
argv=['peer0C7A','--operation-id',selection['operation'],'--project',str(ROOT),
 '--memory-mib','1024','--memory-reserve-mib','256','--memory-reclaim','clean-cache','--memory-storage','included',
 '--disk-space',str(ROOT)+'=64','--disk-reserve-mib','16',
 '--temp-root',str(ROOT/'native-temp'),'--artifact','execution.json','--artifact','native-state.tar.gz',
 '--artifact-on-success','customer-handoff.zip','--artifact-on-success','customer-result.json',
 '--retain-artifacts','--report-format','summary']
for field,flag in (('memory_reservations_root','--memory-reservations-root'),
                   ('disk_reservations_root','--disk-reservations-root'),('worker_root','--worker-root')):
 if selection.get(field):argv.extend([flag,selection[field]])
python_libraries=sorted({str(Path(path).resolve()) for key in ('stdlib','platstdlib')
 for path in (sysconfig.get_path(key),) if path and Path(path).is_dir()})
for path in python_libraries+[str(HOST),sys.executable,str(ROOT/'run_native.py'),str(ROOT/'receive.mjs'),
 str(ROOT/'source.zip'),str(ROOT/'selection.json'),selection['node'],
 selection['project_update']['path'],selection['baseline_handoff']['path']]:
 argv.extend(['--runtime-path',path])
args=parser.parse_args(argv);args.action='run'
args.command=[sys.executable,'-B',str(ROOT/'run_native.py')]
args.records_root=str(ROOT/'native-records')
launch=ForegroundLaunch(native)
try:
 report=native.start(args,launcher=launch)
 print(json.dumps(native.report_value(report,'summary')),flush=True)
finally:
 if launch.root is not None:launch.handoff()
