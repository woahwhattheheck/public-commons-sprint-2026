#!/usr/bin/env python3
"""Import and reopen the complete field-support source in the original project."""
from __future__ import annotations
import argparse,hashlib,json,sys
from pathlib import Path

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--application',type=Path,required=True);p.add_argument('--workspace',type=Path,required=True)
 p.add_argument('--package',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
 a=p.parse_args();app=a.application.resolve(strict=True);root=a.package.resolve(strict=True)
 sys.path.insert(0,str(app))
 from model.workspace import Workspace
 import model.workspace
 if not Path(model.workspace.__file__).resolve().is_relative_to(app):raise ValueError('Use the selected application producer')
 data=json.loads((root/'field-support.json').read_text());ws=Workspace(a.workspace.resolve(strict=True),create=False)
 if ws.project['id']!=data['project_id']:raise ValueError('Receive this study into its retained original project')
 from model.monitoring_workspace import MonitoringWorkspace
 service=MonitoringWorkspace(ws)
 def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
 if digest(service.get('networks',data['network_id']))!=data['network_sha256']:raise ValueError('The retained original network differs')
 for identity,expected in data['plans_sha256'].items():
  if digest(service.get('plans',identity))!=expected:raise ValueError('An original saved plan differs')
 manifest=root/'source-manifest.json';collection=ws.import_sources(manifest)
 opened=[]
 for entry in collection['entries']:
  path,saved=ws.source_file(collection['id'],entry['id']);body=path.read_bytes()
  if len(body)!=saved['body']['bytes'] or hashlib.sha256(body).hexdigest()!=saved['body']['sha256']:
   raise ValueError('Native source reopening differs from the delivered member')
  opened.append({'source_id':entry['id'],'path':str(path),'bytes':len(body),'sha256':saved['body']['sha256'],'companions':len(saved['companions'])})
 result={'state':'complete','application':str(app),'workspace':str(ws.root),'loaded_workspace_module':model.workspace.__file__,
         'project_id':ws.project['id'],'source_collection_id':collection['id'],'field_support_id':data['id'],
         'opened':opened,'manifest_sha256':hashlib.sha256(manifest.read_bytes()).hexdigest()}
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
