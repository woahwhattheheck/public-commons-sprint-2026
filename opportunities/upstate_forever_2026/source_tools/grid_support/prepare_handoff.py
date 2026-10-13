#!/usr/bin/env python3
"""Finalize the readable source package and an additive Workspace import manifest."""
from __future__ import annotations
import argparse,hashlib,json,shutil
from datetime import datetime,timezone
from pathlib import Path
from render_support import render

def descriptor(path: Path,root: Path) -> dict:
    return {'path':path.relative_to(root).as_posix(),'bytes':path.stat().st_size,
      'sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest()}

def prepare(root: Path) -> dict:
    for name in ('import_support.py','prepare_handoff.py','render_support.py'):
        original=Path(__file__).parent/name;target=root/'source'/name
        if original.resolve()!=target.resolve():shutil.copy2(original,target)
    inventory=[descriptor(p,root) for p in sorted(root.rglob('*')) if p.is_file() and
      p.name not in ('OPEN_SUPPORT.html','SOURCE_FILES.json','source-manifest.json') and '__pycache__' not in p.parts]
    (root/'SOURCE_FILES.json').write_text(json.dumps({'schema':'upstate.source-file-inventory/v1','files':inventory},indent=2)+'\n')
    render(root)
    summary=json.loads((root/'support-summary.json').read_text())
    def entry(p:Path,key:str,title:str,kind:str,metadata:dict|None=None) -> dict:
        d=descriptor(p,root)
        return {'id':key,'title':title,'kind':kind,'role':'GEOGRAPHIC_SUPPORT',
          'uri':'urn:sha256:'+d['sha256'],'vintage':'Original retained source editions; compiled 2026-10-13',**d,
          'metadata':metadata or {}}
    primary=entry(root/'OPEN_SUPPORT.html','geographic-support-model-grid-20261013','Upper Savannah model-grid geographic supports','document',
      {'source_project_id':summary['source_project_id'],'grid':summary['grid'],'purpose':'Editable source support and independent memberships'})
    primary['companions']=[descriptor(p,root) for p in sorted(root.rglob('*')) if p.is_file() and
      p.name not in ('OPEN_SUPPORT.html','source-manifest.json') and '__pycache__' not in p.parts]
    rows={x['scope_id']:x for x in summary['scopes']}
    entries=[primary]
    for p in sorted((root/'rasters').glob('*.tif')):
        k=p.stem;entries.append(entry(p,'model-grid-'+k+'-20261013',rows.get(k,{}).get('title',k.replace('-',' ').replace('_',' ')),'raster',
          {'grid':summary['grid'],'scope':rows.get(k,{}),'values':'0 outside; 1 inside' if k not in ('huc12-zones','scope-membership') else 'See source inventory and crosswalk'}))
    entries.append(entry(root/'vectors/geographic-support.gpkg','geographic-support-vectors-20261013','Original and working geographic support layers','vector'))
    entries.append(entry(root/'tables/huc12-zones.csv','geographic-support-huc12-crosswalk-20261013','217 original HUC12 zone and scope crosswalk','table'))
    manifest={'schema':'upstate.sources/v1','title':'Upper Savannah 30 m geographic model support',
      'captured_at':datetime.now(timezone.utc).isoformat(),'entries':entries,
      'scope':{'source_project_id':summary['source_project_id'],'grid':summary['grid'],'masks':12,'original_huc12':217},
      'notes':['Independent source memberships on the retained HW13 grid.','Original sources and derived working repairs are retained separately.','Native quantities require this exact grid; source support does not supply model results.']}
    (root/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'status':'HANDOFF_READY','entries':len(entries),'files':len(primary['companions'])+2,
      'viewer_bytes':(root/'OPEN_SUPPORT.html').stat().st_size,'manifest':str(root/'source-manifest.json')}))
    return manifest
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('root',type=Path);args=parser.parse_args();prepare(args.root.resolve(strict=True))
