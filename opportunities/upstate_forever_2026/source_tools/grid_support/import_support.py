#!/usr/bin/env python3
"""Add the complete geographic support collection to an existing Science Workspace.

The collection is additive. Existing sources, recipes, results and project identity
are preserved. Source objects are retained by the application's normal importer.
"""
from __future__ import annotations
import argparse,json,sys
from pathlib import Path

def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application',type=Path,required=True)
    parser.add_argument('--workspace',type=Path,required=True)
    parser.add_argument('--manifest',type=Path,default=Path(__file__).resolve().parent.parent/'source-manifest.json')
    args=parser.parse_args()
    app=args.application.resolve(strict=True);ws_root=args.workspace.resolve(strict=True)
    if not (app/'model/workspace.py').is_file() or not (ws_root/'workspace.json').is_file():
        parser.error('Select the application root and an existing Science Workspace.')
    sys.path.insert(0,str(app))
    from model.workspace import Workspace
    ws=Workspace(ws_root);project_id=ws.project['id']
    manifest=json.loads(args.manifest.read_text());source_id=manifest['entries'][0]['id']
    collection=ws.import_sources(args.manifest.resolve(strict=True))
    # A fresh application object resolves and reopens the entire retained source family.
    reopened=Workspace(ws_root)
    view,entry=reopened.source_file(collection['id'],source_id)
    if reopened.project['id']!=project_id:
        raise RuntimeError('Unexpected change to project identity')
    print(json.dumps({'status':'GEOGRAPHIC_SUPPORT_IMPORTED','project_id':project_id,
      'collection_id':collection['id'],'source_id':source_id,
      'source_view':str(view),'source_count':len(reopened.sources()),'entries':len(collection['entries'])},indent=2))
if __name__=='__main__':main()
