"""Receive the whole composition source into an existing scientific Workspace.

Builds an application-layout package, then uses the maintained original observed
report renderer. The application supplies model.workspace and scientific_report;
this file does not implement another source importer or report formatter.
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path
from build import build

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--application-root',type=Path,required=True)
p.add_argument('--workspace',type=Path,required=True)
p.add_argument('--package',type=Path,required=True,help='New full source package directory')
p.add_argument('--report',type=Path,required=True,help='New native PDF/HTML/Markdown/data directory')
p.add_argument('--create-workspace',action='store_true')
a=p.parse_args()
app=a.application_root.resolve(strict=True)
renderer=app/'source/observed-report-20261013/render.py'
if not renderer.is_file():raise FileNotFoundError('The current application must supply the maintained observed-report renderer')
if a.report.exists():raise FileExistsError('Choose a new report directory')
result=build(app,a.package.resolve())
command=[sys.executable,'-B',str(renderer),'--app-root',str(app),'--workspace',str(a.workspace.resolve()),'--manifest',result['manifest'],'--output',str(a.report.resolve())]
if a.create_workspace:command.append('--create-workspace')
completed=subprocess.run(command,check=True,text=True,capture_output=True)
try:native=json.loads(completed.stdout)
except json.JSONDecodeError as exc:raise RuntimeError('Native formatter returned a non-JSON result: '+completed.stdout[:2000]) from exc
print(json.dumps({'source':result,'native':native},ensure_ascii=False,indent=2))
