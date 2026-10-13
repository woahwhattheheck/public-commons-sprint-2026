"""Operate the whole original five-family exchange in one retained customer case.

Run on a received project copy. Existing definitions, publications, source
workbooks, native jobs and reports are retained; the programme appends exchange
respondents and editions through the same normal application operations.
"""
from __future__ import annotations
import argparse,base64,copy,hashlib,io,json,sqlite3,time,zipfile
from decimal import Decimal
from pathlib import Path

from questionnaire_workspace import Workspace,encoded,is_calculated,table_rows
from whole_family_programme import enter,bound_field,check_value,METRICS
from WORKBOOK_EXCHANGE_EXERCISE import editable_original_cells
from workbook_exchange import semantic_workbook

PREFIX='atssc-original-whole-workbook-exchange-20261013'

def sha(raw):return hashlib.sha256(raw).hexdigest()

def save(path,value,binary=False):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    raw=value if binary else (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
    if path.exists() and path.read_bytes()!=raw:
        history=path.parent/'history';history.mkdir(exist_ok=True)
        previous=path.read_bytes();kept=history/(path.stem+'-'+sha(previous)+path.suffix)
        if not kept.exists():kept.write_bytes(previous)
    staged=path.with_name(path.name+'.pending');staged.write_bytes(raw);staged.replace(path)
    return {'path':str(path),'bytes':len(raw),'sha256':sha(raw)}

def retain_download(result,path):
    raw=base64.b64decode(result['data_base64'],validate=True)
    if len(raw)!=result['bytes'] or sha(raw)!=result['sha256']:raise RuntimeError('The original download identity differs')
    return save(path,raw,True)

def original_rows(workspace):
    result={}
    with workspace.connection() as db:
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        for table in tables:
            records=[]
            for row in db.execute('SELECT * FROM "'+table+'" ORDER BY rowid'):
                values={key:({'bytes':len(value),'sha256':sha(value)} if isinstance(value,bytes) else value) for key,value in dict(row).items()}
                records.append(sha(encoded(values).encode()))
            result[table]=records
    return result

def assert_originals(workspace,baseline,source_successors):
    current=original_rows(workspace)
    declared={x['original_row_sha256']:x['successor_row_sha256'] for x in source_successors.values()}
    for table,rows in baseline.items():
        expected=[declared.get(value,value) if table=='questionnaires' else value for value in rows]
        if current.get(table,[])[:len(rows)]!=expected:raise RuntimeError('The original retained records changed: '+table)
    return {table:len(rows) for table,rows in baseline.items()}

def source_answers(definition,answers):
    questions={q['id']:q for q in definition['questions']}
    result={}
    for key,value in answers.items():
        field=questions[key]
        if is_calculated(field):continue
        if field['kind']!='table':result[key]=value;continue
        rows=table_rows(field['source'])
        result[key]=[{'source_row':rows[index],'values':row} for index,row in enumerate(value)]
    return result

def run(directory):
    started=time.monotonic();workspace=Workspace(directory)
    root=workspace.directory/'source-evidence'/'workbook-exchange-customer';root.mkdir(parents=True,exist_ok=True)
    original_programme=json.loads((workspace.directory/'source-evidence/whole-family-programme/complete-family-programme.json').read_text())
    plan=json.loads((workspace.directory/'source-evidence/whole-family-programme/entered-plan.json').read_text())
    baseline_path=root/'original-records.json'
    if baseline_path.exists():baseline=json.loads(baseline_path.read_text())
    else:baseline=original_rows(workspace);save(baseline_path,baseline)
    successor_path=root/'source-kind-successors.json'
    source_successors=json.loads(successor_path.read_text()) if successor_path.exists() else {}
    samples={x['role']:x for x in plan['workbooks']};completed=[]
    totals={'sheets':0,'cells':0,'formulas':0,'hidden_sheets':0,'mapped_source_cells':0,'questions':0,'computed_questions':0,'typed_cells':0,'native_formula_results':0}
    for family in original_programme['families']:
        role=family['role'];source=family['source_sha256'];prefix=PREFIX+'-'+role;out=root/role;out.mkdir(exist_ok=True)
        definition=workspace.invoke('get_definition',{'questionnaire_id':family['questionnaire_id'],'version':family['definition_version']})['definition']
        book=workspace.workbook(source);sheets={s['name']:s for s in book['sheets']};findings=[]
        for question in definition['questions']:
            binding=question.get('source')
            if not binding or is_calculated(question):continue
            fields=[(column,column['source_column']+str(row)) for row in table_rows(binding) for column in question['columns']] if question['kind']=='table' else [(question,binding['cell'])]
            for field,address in fields:
                cell=sheets[binding['sheet']]['cells'].get(address,{})
                if field['kind'] in {'number','integer'} and cell.get('kind') in {'s','str','inlineStr'} and cell.get('value') not in {None,''}:
                    try:Decimal(cell['value']);continue
                    except Exception:pass
                    findings.append({'question_id':question['id'],'column_id':field.get('id') if question['kind']=='table' else None,'sheet':binding['sheet'],'cell':address,'original_kind':cell['kind'],'original_text':cell['value'],'prior_question_kind':field['kind']})
        if findings:
            prefix+='-original-text-kind5'
            if role not in source_successors:
                current=next(q for q in workspace.invoke('status')['questionnaires'] if q['id']==family['questionnaire_id'])
                original_row_sha=sha(encoded(current).encode())
                if original_row_sha not in baseline['questionnaires']:raise RuntimeError('The original source questionnaire is not the retained baseline')
            corrected=workspace.invoke('import_workbook_definition',{'workbook_sha256':source,'questionnaire_id':family['questionnaire_id'],'expected_version':family['definition_version'],'request_id':prefix+'-intake'})
            if [q['id'] for q in definition['questions']]!=[q['id'] for q in corrected['definition']['questions']]:raise RuntimeError('The original type successor changed stable input/metric IDs')
            definition=corrected['definition']
            publication=workspace.invoke('publish',{'questionnaire_id':family['questionnaire_id'],'expected_version':corrected['version'],'request_id':prefix+'-publish'})
            if role not in source_successors:
                latest=next(q for q in workspace.invoke('status')['questionnaires'] if q['id']==family['questionnaire_id'])
                if {k:v for k,v in current.items() if k!='version'}!={k:v for k,v in latest.items() if k!='version'}:raise RuntimeError('A source type successor changed original questionnaire metadata')
                source_successors[role]={'original_row':current,'original_row_sha256':original_row_sha,'successor_row_sha256':sha(encoded(latest).encode()),'source_findings':findings,'prior_publication_id':family['publication_id'],'publication_id':publication['publication_id'],'definition_version':corrected['version']}
                save(successor_path,source_successors)
            family={**family,'publication_id':publication['publication_id'],'definition_version':corrected['version']}
        selector={'publication_id':family['publication_id'],'template_sha256':source}
        original=workspace.invoke('exchange_download_original',{'sha256':source})
        retain_download(original,out/'original.xlsx')
        inspection=workspace.invoke('exchange_inspect',{'sha256':source});save(out/'original-inspection.json',inspection)
        for key in ('cells','formulas','hidden_sheets'):totals[key]+=inspection['counts'][key]
        totals['sheets']+=len(inspection['sheets'])
        mapping=workspace.invoke('exchange_mapping',selector);save(out/'source-mapping.json',mapping)
        if [q['question_id'] for q in mapping['questions']]!=[q['id'] for q in definition['questions']]:raise RuntimeError('The complete source mapping changed stable question order')
        raw=workspace.get_workbook_bytes(source);cells=editable_original_cells(raw,workspace.workbook(source))
        changes=[{**cell,'kind':kind,'value':value} for cell,(kind,value) in zip(cells,[('number','0'),('text',''),('blank',None),('absent',None)])]
        typed_params={'sha256':source,'changes':changes,'request_id':prefix+'-typed'}
        typed=workspace.invoke('exchange_export',typed_params)
        if typed!=workspace.invoke('exchange_export',typed_params):raise RuntimeError('The original typed successor replay changed')
        retain_download(typed,out/'typed-states.xlsx');save(out/'typed-states-manifest.json',typed['metadata'])
        typed_read=workspace.invoke('exchange_inspect',{'sha256':typed['sha256'],'sheet':cells[0]['sheet'],'cells':[x['cell'] for x in cells if x['sheet']==cells[0]['sheet']]})
        exact=semantic_workbook(base64.b64decode(typed['data_base64']),{s:[x['cell'] for x in cells if x['sheet']==s] for s in {x['sheet'] for x in cells}})
        states={(s['name'],a):c for s in exact['sheets'] for a,c in s['cells'].items()}
        for cell,(kind,value) in zip(cells,[('number','0'),('text',''),('blank',None),('absent',None)]):
            state=states[cell['sheet'],cell['cell']]
            if state['state']!=kind or state['value']!=value:raise RuntimeError('A typed original cell lost zero, empty, blank or absence')
        if exact['counts']['formulas']!=inspection['counts']['formulas'] or exact['counts']['errors']!=inspection['counts']['errors']:raise RuntimeError('Typed input exchange changed original formula/error cells')
        save(out/'typed-states-inspection.json',exact);totals['typed_cells']+=len(cells)
        answers={};selected=[]
        for edit in samples[role]['edits']:
            qid=enter(answers,definition,edit['sheet'],edit['cell'],edit['value'])
            if qid not in selected:selected.append(qid)
        exported_params={**selector,'answers':source_answers(definition,answers),'request_id':prefix+'-bound-answers'}
        exported=workspace.invoke('exchange_export_answers',exported_params)
        if exported!=workspace.invoke('exchange_export_answers',exported_params):raise RuntimeError('The bound original answer edition replay changed')
        retain_download(exported,out/'entered-answers.xlsx');save(out/'entered-answers-manifest.json',exported['metadata'])
        reimported=workspace.invoke('import_workbook',{'name':role+'-exchange-input.xlsx','data_base64':exported['data_base64'],'expected_sha256':exported['sha256'],'request_id':prefix+'-receive-workbook'})
        if reimported['sha256']!=exported['sha256']:raise RuntimeError('Original-format workbook receiving changed its identity')
        invitation=workspace.invoke('invite',{'publication_id':family['publication_id'],'name':'Original Workbook Exchange — '+role,'request_id':prefix+'-invite'})
        rid=invitation['respondent_id']
        sealed_params={'respondent_id':rid,'expected_version':0,'workbook_sha256':exported['sha256'],'source_binding_sha256':source,'public_confirmed':True,'request_id':prefix+'-seal'}
        revision=workspace.invoke('submit_revision',sealed_params)
        if not revision['validation']['valid'] or revision['validation'].get('native_calculation_pending'):raise RuntimeError('The complete source exchange did not seal its native edition: '+json.dumps(revision['validation']['issues']))
        if revision!=workspace.invoke('submit_revision',sealed_params):raise RuntimeError('The exact source-native revision replay changed')
        save(out/'sealed-revision.json',revision)
        native=revision['validation']['native_calculation'];binding=next(b for b in native['source_successor_bindings'] if b['source_sha256']==source)
        job=workspace.invoke('get_calculation',{'calculation_id':binding['calculation_id']})['result']
        input_manifest=json.loads((workspace.directory/binding['original_input_manifest']).read_text())
        if input_manifest.get('retained_uploaded_sha256')!=exported['sha256']:raise RuntimeError('Native response calculation discarded its actual exchange input package')
        totals['native_formula_results']+=len(job['cache_manifest']['formula_results'])
        retain_download(workspace.invoke('exchange_download_original',{'sha256':binding['calculated_sha256']}),out/'calculated-answers.xlsx')
        extract_params={'respondent_id':rid,'sha256':binding['calculated_sha256'],'template_sha256':source,'formula_values':'cached'}
        extracted=workspace.invoke('exchange_extract',extract_params);save(out/'complete-extraction.json',extracted)
        if not extracted['validation']['valid']:raise RuntimeError('The complete extracted native input is invalid: '+json.dumps(extracted['validation']['issues']))
        for qid,value in extracted['computed_values'].items():
            if value!=revision['validation']['values'].get(qid):raise RuntimeError('Original exchanged/native computed value differs: '+qid)
        totals['mapped_source_cells']+=len(extracted['cells']);totals['questions']+=len(mapping['questions']);totals['computed_questions']+=len(extracted['computed_values'])
        register=workspace.invoke('exchange_extract_package',extract_params);register_path=out/'complete-source-register.zip';retain_download(register,register_path)
        with zipfile.ZipFile(register_path) as archive:
            descriptor=json.loads(archive.read('manifest.json'))
            for member in descriptor['files']:
                body=archive.read(member['path'])
                if len(body)!=member['bytes'] or sha(body)!=member['sha256']:raise RuntimeError('The original complete register member differs')
                save(out/member['path'],body,True)
            if json.loads(archive.read('Source_Extraction.json'))!=extracted:raise RuntimeError('The register and full extraction data are not the same edition')
        checks=[]
        for sheet,cell,expected in METRICS[role]:
            field,_,_=bound_field(definition,sheet,cell);qid=field['id'];value=revision['validation']['values'][qid]
            check_value(value,expected,sheet+'!'+cell)
            if qid not in selected:selected.append(qid)
            if revision['validation']['public_values'].get(qid) is not None:raise RuntimeError('A native protected precedent became public')
            checks.append({'sheet':sheet,'cell':cell,'question_id':qid,'value':value,'public_value':revision['validation']['public_values'].get(qid)})
        reviewed=workspace.invoke('review_revision',{'revision_id':revision['revision_id'],'expected_version':revision['number'],'decision':'accept','note':'Complete original source exchange, typed states, actual native outputs and protected precedents reviewed.','request_id':prefix+'-accept'})
        report=workspace.invoke('create_report',{'publication_id':family['publication_id'],'respondent_ids':[rid],'question_ids':selected,'refresh_source_context':True,'request_id':prefix+'-report'})
        released=workspace.invoke('release_report',{'report_id':report['report_id'],'note':'Original entered exchange report; source context and respective public/protected values reviewed.','request_id':prefix+'-release'})
        report_path=out/'report'
        if not report_path.exists():workspace.invoke('export_report',{'report_id':report['report_id'],'directory':str(report_path)})
        result={'role':role,'source_sha256':source,'publication_id':family['publication_id'],'questionnaire_id':family['questionnaire_id'],'respondent_id':rid,'revision_id':revision['revision_id'],'review_id':reviewed['review_id'],'report_id':report['report_id'],'original_counts':inspection['counts'],'questions':len(mapping['questions']),'mapped_source_cells':len(extracted['cells']),'computed_questions':len(extracted['computed_values']),'typed_cell_states':changes,'entered_source_sha256':exported['sha256'],'native_binding':binding,'native_result_checks':checks,'input_valid':True,'original_formula_issue_count':len(extracted['validation']['formula_issues']),'register':{k:register[k] for k in ('name','bytes','sha256')},'report_directory':report_path.relative_to(workspace.directory).as_posix()}
        save(out/'completed-family.json',result);completed.append(result)
        save(root/'progress.json',{'workspace_id':workspace.invoke('status')['workspace_id'],'families':completed})
        print(json.dumps({'role':role,'state':'whole-native-exchange-complete','source_cells':result['mapped_source_cells'],'report_id':report['report_id']}),flush=True)
    if any(totals[key]!=value for key,value in {'sheets':79,'cells':71717,'formulas':7661,'hidden_sheets':21,'questions':3514,'computed_questions':1531,'typed_cells':20,'native_formula_results':7661}.items()):raise RuntimeError('The complete original family scope differs: '+json.dumps(totals))
    retained=assert_originals(workspace,baseline,source_successors)
    result={'schema':'atssc.whole-original-workbook-exchange.v1','workspace_id':workspace.invoke('status')['workspace_id'],'source_packet_git_blob':'bf27235e7b4cf79a35c41e2fc9a308bdec3d0995','original_project_sha256':'78baac019dc64cad2374e3a5b165b77e0c97eceae5844c053b26ffc57d5b90f3','families':completed,'totals':totals,'retained_original_record_counts':retained,'source_kind_successors':source_successors,'elapsed_seconds':time.monotonic()-started,'state':'complete'}
    save(root/'complete-programme.json',result);print(json.dumps({k:v for k,v in result.items() if k!='families'}),flush=True);return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--workspace',required=True,type=Path);args=parser.parse_args();run(args.workspace.resolve())
