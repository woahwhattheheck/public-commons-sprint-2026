#!/usr/bin/env python3
"""Import, compose and independently receive one complete monitoring source."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys
from model.workspace import Workspace
from model import observed_context, scientific_report
from utility_monitoring_coverage import SOURCE_ID,compact_report_links,read_json,write_json


def import_and_compose(root:Path,workspace:Workspace,output:Path):
    imported=workspace.import_sources(root/'sources.json')
    choice={'source_collection_id':imported['id'],'source_id':SOURCE_ID}
    selection={'source_roles':{'OBSERVED_CONTEXT':choice}}
    binding=observed_context.bind(workspace,selection)
    selection['observed_context_binding']=binding
    output.mkdir(parents=True,exist_ok=True)
    product=observed_context.collect(workspace,selection,output,{})
    data=read_json(root/'report-data.json')
    sections=compact_report_links(product['sections'])
    scientific_report.write_companions(output,data['title'],sections,contact=data['contact'],
                                    source_records=data['source_records'],binding=binding)
    scientific_report.report_pdf(output/'report.pdf',data['title'],sections,
                                contact=data['contact'],source_records=data['source_records'])
    recipe_path,entry=workspace.source_file(imported['id'],SOURCE_ID)
    return {'project_id':workspace.project['id'],'collection_id':imported['id'],
        'source_id':SOURCE_ID,'body_sha256':hashlib.sha256(Path(recipe_path).read_bytes()).hexdigest(),
        'binding':binding,'selected_source_body':entry['body'],
        'composed_sections':len(product['sections']),'composed_files':len(product['files'])}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package',type=Path,required=True)
    p.add_argument('--workspace',type=Path,required=True)
    p.add_argument('--receiving-workspace',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    try:
        first=import_and_compose(args.package,Workspace(args.workspace),args.output/'original-composition')
        second=import_and_compose(args.package,Workspace(args.receiving_workspace,create=True,
                  title='Utility monitoring coverage independent receiving'),args.output/'received-composition')
        if first['body_sha256']!=second['body_sha256'] or first['binding']['member_sha256']!=second['binding']['member_sha256']:
            raise ValueError('Independent source receiving changed report or original member identities')
        result={'schema':'upstate.utility-monitoring-receiving/v1','state':'complete',
          'original':first,'independent':second,'same_source_body':True,'same_member_hashes':True}
        write_json(args.output/'receiving-result.json',result)
        print(json.dumps({'state':'complete','original_collection':first['collection_id'],
            'independent_collection':second['collection_id'],'retained_members':len(first['binding']['member_sha256']),
            'composed_sections':first['composed_sections'],'result':str(args.output/'receiving-result.json')},indent=2))
    except (ValueError,OSError,KeyError,ImportError) as error:
        print(json.dumps({'state':'error','error':str(error),'type':type(error).__name__}),file=sys.stderr)
        return 2
    return 0

if __name__=='__main__':raise SystemExit(main())
