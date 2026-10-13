"""Complete authored-edition receiving course; does not run watershed models."""
from __future__ import annotations
import argparse, copy, json, os, shutil, sys, time
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from model import report_changes as rc


def make_edition(root, title, rows, *, note='Original authored software exercise.', reverse=False, duplicate=False):
    root.mkdir(parents=True,exist_ok=True)
    sources=[{'source_collection_id':'a'*64,'source_id':'station-results','title':'Authored station results','vintage':'2026 exercise','uri':'urn:software-exercise:stations','body_bytes':12,'body_sha256':'b'*64},
             {'source_collection_id':'c'*64,'source_id':'method','title':'Authored method','vintage':'2026 exercise','uri':'urn:software-exercise:method','body_bytes':13,'body_sha256':'d'*64}]
    if reverse:sources.reverse()
    table={'kind':'table','caption':'Complete authored records; values are test data','columns':['Station ID','Value','Unit','Note'], 'rows':copy.deepcopy(rows)}
    sections=[{'heading':'Methods','blocks':[note]}, {'heading':'Station results','blocks':[table]},
              {'heading':'Duplicates','blocks':[{'kind':'table','columns':['Code','Value'], 'rows':[['same',1],['same',1]]+([['same',1]] if duplicate else [])}]}]
    identity={'schema':'upstate.observed-report-native/v1','workspace':'/original/software-exercise','selection':{'source_roles':{'OBSERVED_CONTEXT':{'source_collection_id':'a'*64,'source_id':'station-results'}}},'binding':{'exercise':'retained'},'contact':{'name':'Software exercise'},'report_version':'upstate.scientific-report/v1','title':title}
    key=rc.digest(identity)
    document={'schema':'upstate.scientific-report/v1','title':title,'binding':identity['binding'],'sections':sections,'source_records':sources,'contact':identity['contact'],'display_precision':'Original authored values'}
    rc._write_json(root/'report-data.json',document)
    rc._write(root/'report.html',('<!doctype html><html><title>'+title+'</title><h1>'+title+'</h1><p>'+note+'</p><p>Complete rows are in report-data.json.</p></html>').encode())
    rc._write(root/'source.bin',bytes(range(256))*16)
    rc._write_json(root/'selection.json',identity)
    files={role:rc._descriptor(root,root/name) for role,name in [('report_data','report-data.json'),('report_html','report.html'),('selection','selection.json'),('original','source.bin')]}
    extra={'state':'complete','operation_id':'observed-report-'+key[:20],'sources':sources,'source_count':len(sources),'section_count':len(sections),'figure_count':0,'files':files}
    operation={**identity,**extra,'output':str(root)}
    record={'schema':rc.EDITION_SCHEMA,'id':key,'project_id':'software-exercise-project','title':title,'render_identity':identity,**extra}
    rc._write_json(root/'operation.json',operation)
    rc._write_json(root/'edition.json',record)
    return record


def journey(destination, count=12000):
    began=time.perf_counter()
    destination.mkdir(parents=True,exist_ok=False)
    originals=destination/'originals'
    before=[[f'S{i:07d}',i/10,'mg/L','original'] for i in range(count)]
    before[15][1]=9007199254740993
    after=copy.deepcopy(before)
    after[15][1]+=1
    for i in range(0,count,11):after[i][1]+=0.125
    for i in range(0,count,37):after[i][2]='ug/L'
    after=after[10:]+[[f'NEW{i:05d}',i,'mg/L','added'] for i in range(12)]
    after.reverse()
    make_edition(originals/'left','Earlier authored report',before)
    make_edition(originals/'right','Later authored report',after,note='Updated method, original source values retained.',reverse=True,duplicate=True)
    saved={side:rc.edition(originals/side)['fingerprint'] for side in ('left','right')}
    preview=rc.preview(originals/'left',originals/'right')
    station=next(t for t in preview['tables'] if t['heading']=='Station results')
    plan={'row_keys':{station['id']:[0]},'include_positions':False}
    expected=rc.identity_for(originals/'left',originals/'right',plan)
    checkpoint={'raised':False}
    def interrupt(value):
        if value['stage']=='table complete' and not checkpoint['raised']:
            checkpoint['raised']=True
            raise InterruptedError('Authored process interruption after first committed table')
    try:rc.build(originals/'left',originals/'right',destination/'comparison',plan=plan,progress=interrupt)
    except InterruptedError:pass
    else:raise AssertionError('Interruption was not exercised')
    record=rc.build(originals/'left',originals/'right',destination/'comparison',plan=plan,expected_id=expected)
    table=next(t for t in record['tables'] if t['id']==station['id'])
    assert table['counts']['removed']==10 and table['counts']['added']==12,table
    remaining={row[0]:row for row in before[10:]}
    nchanged=sum(row[0] in remaining and rc.canonical(row)!=rc.canonical(remaining[row[0]]) for row in after)
    assert table['counts'].get('changed',0)==nchanged,table
    assert next(t for t in record['tables'] if t['heading']=='Duplicates')['counts']['added']==1
    counts=0;cursor=0;seen=set();verified={}
    while True:
        page=rc.rows(destination/'comparison',after=cursor,limit=211,cache=verified)
        for row in page['rows']:
            if row['category']=='row' and row['left'] and row['left'][0]=='S0000015':
                assert row['left_cells'][1]=='9007199254740993'
                assert row['right_cells'][1]=='9007199254740994'
            assert row['seq'] not in seen
            seen.add(row['seq'])
        counts+=len(page['rows'])
        if page['next_after'] is None:break
        cursor=page['next_after']
    assert counts==record['change_count']
    archive=rc.export(destination/'comparison',destination/'complete-comparison.zip')
    assert rc.export(destination/'comparison',destination/'complete-comparison.zip')==archive
    shutil.rmtree(originals)
    received=rc.receive(destination/'complete-comparison.zip',destination/'received')
    assert received==record
    assert rc.receive(destination/'complete-comparison.zip',destination/'received')==record
    for side in ('left','right'):
        assert rc.edition(destination/'received'/side)['fingerprint']==saved[side]
    second=rc.build(destination/'received'/'left',destination/'received'/'right',destination/'recompared',plan=plan)
    assert second==record
    # The same original pair supports a deliberate alternative matching plan.
    alternate=rc.build(destination/'received'/'left',destination/'received'/'right',destination/'exact-rows')
    assert alternate['id']!=record['id']
    duplicate_table=next(t for t in preview['tables'] if t['heading']=='Duplicates')
    try:rc.build(destination/'received'/'left',destination/'received'/'right',destination/'invalid-key',plan={'row_keys':{duplicate_table['id']:[0]}})
    except ValueError as e:assert 'repeat' in str(e)
    else:raise AssertionError('Repeated key accepted')
    # Process death between complete marker and atomic directory publication.
    real_rename=rc.os.rename
    def fail_final(source,target):
        if Path(target)==destination/'rename-recovery':raise InterruptedError('after completion marker')
        return real_rename(source,target)
    with patch.object(rc.os,'rename',fail_final):
        try:rc.build(destination/'received'/'left',destination/'received'/'right',destination/'rename-recovery',plan=plan)
        except InterruptedError:pass
        else:raise AssertionError('Rename interruption not exercised')
    assert rc.build(destination/'received'/'left',destination/'received'/'right',destination/'rename-recovery',plan=plan)==record
    # Snapshot mutation and portable path protection.
    rc._write(destination/'received'/'left'/'source.bin',b'changed')
    try:rc.inspect(destination/'received')
    except ValueError:pass
    else:raise AssertionError('Mutation was not detected')
    for name in ('../outside','a\\b','CON.txt','a/../b','a?b'):
        try:rc._name(name)
        except ValueError:pass
        else:raise AssertionError('Unsafe name accepted '+name)
    d=lambda n:{'path':n,'bytes':0,'sha256':'a'*64}
    try:rc._validate_members({'A/a':d('A/a'),'a/b':d('a/b')})
    except ValueError:pass
    else:raise AssertionError('Directory alias accepted')
    shutil.rmtree(destination/'received')
    rc.receive(destination/'complete-comparison.zip',destination/'received')
    result={'case':'complete authored report edition course','rows_per_primary_table':count,'matched_record_changes':nchanged,'recorded_changes':record['change_count'],'complete_pages':record['page_count'],'archive':archive,'comparison_id':record['id'],'seconds':round(time.perf_counter()-began,3),'checks':['complete-keyed-comparison','default-multiset','duplicate-key-rejection','table-interruption-resume','post-completion-rename-recovery','all-page-read','complete-export','sender-deletion','independent-receive','independent-recompare','mutation-rejection','portable-paths']}
    rc._write_json(destination/'journey.json',result)
    print(json.dumps(result,indent=2))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination',type=Path)
    parser.add_argument('--rows',type=int,default=12000)
    args=parser.parse_args()
    journey(args.destination,args.rows)
