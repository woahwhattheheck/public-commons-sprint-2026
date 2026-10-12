#!/usr/bin/env python3
"""Run the original Wherobots source, browser and customer receiving operation continuously."""
from __future__ import annotations
import argparse,hashlib,json,os,shutil,subprocess,sys,zipfile
from pathlib import Path,PurePosixPath
from datetime import datetime,timezone

def now():return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def sha(path):
 with open(path,'rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def git_sha(path):
 h=hashlib.sha1();h.update(b'blob '+str(path.stat().st_size).encode()+b'\0')
 with open(path,'rb') as stream:
  for chunk in iter(lambda:stream.read(1048576),b''):h.update(chunk)
 return h.hexdigest()
def atomic(path,data):
 path.parent.mkdir(parents=True,exist_ok=True);temporary=path.with_name(path.name+'.next')
 temporary.write_bytes(data);os.replace(temporary,path)
def json_file(path,value):atomic(path,(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode())
def clean(text):
 import re
 return re.sub(r'https?://[^\s]+','[address omitted]',str(text))
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--source',default='/workspace/scratch/bd9d5956e7a2/wherobots/source')
 parser.add_argument('--resume-archive',help='Exact retained complete receiving ZIP; restores the same original output path and workspace identities')
 parser.add_argument('--runtime-archive',default='/workspace/scratch/33e6fc23d61c/fleet_infra/capacity/whitebox-completed-20261012/Whitebox_Original_Runtime_Recovery_20261012.zip')
 parser.add_argument('--python',default='/workspace/scratch/bd9d5956e7a2/wherobots/runtime/bin/python3')
 parser.add_argument('--host',default='/dev/dce4-wherobots-host-20261012')
 parser.add_argument('--out',default='/dev/dce4-wherobots-source-receiving-20261012')
 parser.add_argument('--node',default='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node')
 parser.add_argument('--arrow-mode',choices=['archive','existing'],default='archive',help='Use the pinned retained CPython3.12 archive or an already installed native Arrow26 runtime')
 parser.add_argument('--consumer-mode',choices=['merchant','archive'],default='merchant',help='Use every native SF30/SF82 dataset from the same complete merchant receiving operation; archive preserves the earlier explicitly selected consumer route')
 parser.add_argument('--consumer-archive',help='Optional existing retained c287 source carrier; used only with --consumer-mode archive')
 parser.add_argument('--consumer-node-modules',help='Existing complete native consumer dependency root')
 parser.add_argument('--playwright-node-modules',help='Existing installed Playwright node_modules root')
 parser.add_argument('--merchant-driver',help='Exact selected merchant_receiving.mjs in its complete original repository; defaults to the selected --source directory')
 parser.add_argument('--managed-driver',help='Exact selected examples/managed-receiving.mjs beside source/; defaults to the same original repository')
 parser.add_argument('--library-helper',help='Explicit existing official Library upload helper; required only for save-mode library')
 parser.add_argument('--save-mode',choices=['library','local'],default='local')
 parser.add_argument('--chromium',default='/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell')
 args=parser.parse_args()
 helper=Path(args.library_helper).resolve() if args.library_helper else None
 if args.save_mode=='library' and (helper is None or not helper.is_file()):parser.error('--save-mode library requires an explicit existing --library-helper')
 prepared=Path(__file__).resolve().parent;manifest=json.loads((prepared/'source-selection.json').read_text())
 host=Path(args.host);host.mkdir(parents=True,mode=0o700,exist_ok=True)
 out=Path(args.out);out.mkdir(parents=True,mode=0o700,exist_ok=True)
 source=host/'source';source.mkdir(exist_ok=True)
 restored_from=None
 if args.resume_archive:
  resume=Path(args.resume_archive).resolve()
  with zipfile.ZipFile(resume) as retained:
   listing=retained.namelist()
   if len(listing)!=len(set(listing)):raise RuntimeError('Repeated member in the retained receiving package')
   original=json.loads(retained.read('receiving-manifest.json'))
   if original.get('schema')!='starforge.wherobots.receiving-package.v1' or original.get('source')!=manifest:raise RuntimeError('Retained receiving package belongs to another source selection')
   if 'operation/operation.json' in listing:
    original_result=json.loads(retained.read('operation/operation.json'))
    original_out=Path(original_result['sf30_package']['directory']).parent
    if original_out!=out:raise RuntimeError('Resume must retain the original output path: '+str(original_out))
   expected={row['path']:row for row in original['files']}
   if set(listing)!=set(expected)|{'receiving-manifest.json'}:raise RuntimeError('Retained package inventory differs')
   for relative,row in expected.items():
    member=PurePosixPath(relative)
    if member.is_absolute() or '..' in member.parts:raise RuntimeError('Invalid retained package member')
    payload=retained.read(relative)
    if len(payload)!=row['bytes'] or hashlib.sha256(payload).hexdigest()!=row['sha256']:raise RuntimeError('Retained package body differs: '+relative)
    if relative.startswith('source/'):
     target=source/relative[len('source/'):]
    elif relative.startswith('operation/'):
     target=out/relative[len('operation/'):]
    else:continue
    if target.exists() and target.read_bytes()!=payload:raise RuntimeError('Existing original receiving file differs: '+relative)
    atomic(target,payload)
  restored_from={'path':str(resume),'bytes':resume.stat().st_size,'sha256':sha(resume),'files':len(expected)}
 site=host/'runtime/lib/python3.12/site-packages';site.mkdir(parents=True,exist_ok=True)
 delivery=host/'delivery';delivery.mkdir(exist_ok=True)
 report={'schema':'starforge.wherobots.continuous-receiving.v1','operation':'WHEROBOTS-SOURCE-RECEIVING-BD9D-20261012','started_at':now(),'source':manifest,'phases':[],'native_complete':False,'browser_complete':False,'publisher_complete':False,'merchant_complete':False,'managed_complete':False,'publisher_mode':args.consumer_mode,'saved':[],'resumed_from':restored_from}
 if (out/'receiving-progress.json').exists():
  previous=(out/'receiving-progress.json').read_bytes();atomic(out/'receiving-attempt-history'/(hashlib.sha256(previous).hexdigest()+'.json'),previous)
 def phase(name,**values):
  report['phases'].append({'name':name,'at':now(),**values});json_file(out/'receiving-progress.json',report)
  print(json.dumps({'phase':name,**values}),flush=True)
 environment=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',TMPDIR=str(host),OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1',MKL_NUM_THREADS='1')
 if args.playwright_node_modules:environment['PLAYWRIGHT_NODE_MODULES']=args.playwright_node_modules
 environment['PYTHONPATH']=str(site)+os.pathsep+str(source)+os.pathsep+os.environ.get('PYTHONPATH','')
 def command(label,argv,cwd=source):
  phase(label+'_started')
  p=subprocess.Popen(argv,cwd=cwd,env=environment,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
  transcript=[]
  for line in p.stdout:transcript.append(line);print(clean(line.rstrip()),flush=True)
  code=p.wait();atomic(out/(label+'.log'),''.join(transcript).encode())
  phase(label+'_closed',exit_code=code)
  if code:raise RuntimeError(label+' returned '+str(code))
  return ''.join(transcript)
 base_source=Path(args.source)
 for final in manifest['files']:
  original=(source if restored_from else base_source)/final['path'];candidate=prepared/'overrides'/final['path']
  target=source/final['path'];target.parent.mkdir(parents=True,exist_ok=True)
  if original.is_file() and git_sha(original)==final['sha']:
   if original.resolve()!=target.resolve():shutil.copy2(original,target)
  elif candidate.is_file() and git_sha(candidate)==final['sha']:shutil.copy2(candidate,target)
  else:raise RuntimeError('Exact selected source body is missing: '+final['path'])
  if target.stat().st_size!=final['size'] or git_sha(target)!=final['sha']:raise RuntimeError('Source postimage changed: '+final['path'])
 json_file(out/'selected-source.json',manifest)
 phase('all_original_source_selected',files=len(manifest['files']),bytes=sum(x['size'] for x in manifest['files']))
 merchant_driver=Path(args.merchant_driver).resolve() if args.merchant_driver else (base_source/'interoperability/merchant_receiving.mjs').resolve()
 merchant_source=merchant_driver.parents[1]
 application_source=host/'application';application_source.mkdir(exist_ok=True)
 managed_driver=Path(args.managed_driver).resolve() if args.managed_driver else merchant_source.parent/'examples/managed-receiving.mjs'
 if not manifest.get('managed_files'):raise RuntimeError('Select the complete original managed application source in source-selection.json')
 for item in manifest['managed_files']:
  original_file=merchant_source.parent/item['path']
  if not original_file.is_file() or original_file.stat().st_size!=item['size'] or git_sha(original_file)!=item['sha']:raise RuntimeError('The original managed application source differs: '+item['path'])
  target=application_source/item['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(original_file,target)
 expected_managed=next(x for x in manifest['managed_files'] if x['path']=='examples/managed-receiving.mjs')
 if not managed_driver.is_file() or git_sha(managed_driver)!=expected_managed['sha']:raise RuntimeError('The selected managed receiving driver differs')
 phase('original_managed_source_selected',files=len(manifest['managed_files']),bytes=sum(x['size'] for x in manifest['managed_files']))
 if args.arrow_mode=='archive':
  native_profile=json.loads((prepared/'arrow-original-files.json').read_text())
  archive=Path(args.runtime_archive)
  if archive.stat().st_size!=69974302 or sha(archive)!='a0dc466626c0af47bbcdec4a8fabff005a483ff253bc4fb258cc127d2f201989':raise RuntimeError('Original Arrow recovery archive differs')
  memory={}
  for name in ['memory.current','memory.max','memory.events']:
   file=Path('/sys/fs/cgroup')/name
   if file.exists():memory[name]=file.read_text()
  phase('original_arrow_archive_selected',bytes=archive.stat().st_size,sha256=sha(archive),memory=memory)
  unique={}
  for row in native_profile:unique.setdefault(row['sha256'],row)
  retired={x['relative'] for x in native_profile};canonical={x['relative'] for x in unique.values()}
  restored=[]
  with zipfile.ZipFile(archive) as bundle:
   for item in bundle.infolist():
    marker='lib/python3.12/site-packages/'
    start=item.filename.find(marker)
    if start<0 or item.is_dir():continue
    relative=item.filename[start:];leaf=relative[len(marker):]
    if not (leaf.startswith('pyarrow/') or leaf.startswith('pyarrow-26.0.0.dist-info/')):continue
    path=PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts:raise RuntimeError('Original archive member has an invalid path')
    if relative in retired and relative not in canonical:continue
    target=host/'runtime'/relative;target.parent.mkdir(parents=True,exist_ok=True)
    with bundle.open(item) as src,open(target,'wb') as dst:shutil.copyfileobj(src,dst,1024*1024)
    restored.append(relative)
    if relative in canonical:phase('original_arrow_body_restored',path=relative,bytes=target.stat().st_size)
  for row in native_profile:
   target=host/'runtime'/row['relative'];actual=host/'runtime'/unique[row['sha256']]['relative']
   if target!=actual:
    if target.exists():target.unlink()
    os.link(actual,target)
   if not target.is_file() or target.stat().st_size!=row['bytes'] or sha(target)!=row['sha256']:raise RuntimeError('Original native Arrow body changed: '+row['relative'])
  json_file(out/'runtime-originals.json',{'archive':{'bytes':69974302,'sha256':'a0dc466626c0af47bbcdec4a8fabff005a483ff253bc4fb258cc127d2f201989'},'native_files':native_profile,'restored_file_count':len(restored)})
  phase('original_arrow_runtime_restored',files=len(restored),original_native_bytes=sum(x['bytes'] for x in unique.values()))
 else:
  phase('existing_original_arrow_runtime_selected')
 version_program="import json,sys,pyarrow,pyarrow.parquet,importlib.metadata as m; print(json.dumps({'python':sys.version,'pyarrow':pyarrow.__version__,'sdk':m.version('wherobots-python-sdk'),'boto3':m.version('boto3'),'requests':m.version('requests')}))"
 versions=json.loads(command('native_runtime',[args.python,'-B','-c',version_program]).strip().splitlines()[-1])
 if versions['pyarrow']!='26.0.0' or versions['sdk']!='0.5.0':raise RuntimeError('Selected original engine versions differ')
 report['versions']=versions
 if args.arrow_mode=='existing':
  original_program="import json,hashlib,pathlib,pyarrow,pyarrow.lib,pyarrow.parquet,importlib.metadata as m; files=[pathlib.Path(pyarrow.__file__),pathlib.Path(pyarrow.lib.__file__)]; print(json.dumps({'mode':'existing','distribution':m.metadata('pyarrow')['Name'],'version':pyarrow.__version__,'native_files':[{'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()} for p in files]}))"
  native_identity=json.loads(command('existing_arrow_identity',[args.python,'-B','-c',original_program]).strip().splitlines()[-1]);json_file(out/'runtime-originals.json',native_identity)
 command('original_source_receiving',[args.python,'-B',str(source/'interoperability/native_receiving.py'),'--out',str(out)])
 native=json.loads((out/'operation.json').read_text());report['native_complete']=True
 phase('original_native_receiving_complete',workspace=native['source_workspace_id'],customer=native['customer_workspace_id'],datasets={x['id']:x['rows'] for x in native['datasets']},reopened=native['reopened'])
 archive_path=delivery/'Wherobots_Source_Receiving.zip'
 def package():
  candidates=[]
  for root,prefix in [(source,'source'),(application_source,'application'),(out,'operation')]:
   for file in root.rglob('*'):
    if not file.is_file():continue
    if '__pycache__' in file.parts or file.name.startswith('internal-') or file.suffix in {'.png','.log'} or file.name.endswith(('-wal','-shm','.lock')):continue
    candidates.append((file,prefix+'/'+file.relative_to(root).as_posix()))
  for name in ['browser-receiving.cjs','run_once.py','source-selection.json','arrow-original-files.json','stage-consumer.py','native-consumer.mjs','consumer-selection.json','README.md']:
   candidates.append((prepared/name,'receiving/'+name))
  listing=[{'path':relative,'bytes':file.stat().st_size,'sha256':sha(file)} for file,relative in candidates]
  temporary=archive_path.with_suffix('.next')
  with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,6) as z:
   for file,relative in candidates:z.write(file,relative)
   z.writestr('receiving-manifest.json',json.dumps({'schema':'starforge.wherobots.receiving-package.v1','created_at':now(),'source':manifest,'files':listing,'native_complete':report['native_complete'],'browser_complete':report['browser_complete'],'publisher_complete':report['publisher_complete'],'merchant_complete':report['merchant_complete'],'managed_complete':report['managed_complete']},indent=2)+'\n')
  os.replace(temporary,archive_path)
  record={'path':str(archive_path),'bytes':archive_path.stat().st_size,'sha256':sha(archive_path),'files':len(listing)+1};report['archive']=record
  shared=Path('/dev/shm/dce4-wherobots-source-receiving.zip')
  if shutil.disk_usage(shared.parent).free>archive_path.stat().st_size+65536:
   tmp=shared.with_suffix('.next');shutil.copy2(archive_path,tmp);os.replace(tmp,shared);record['shared_path']=str(shared)
  return record
 def upload(items):
  p=subprocess.run([sys.executable,str(helper)],input=json.dumps({'uploads':items}),text=True,capture_output=True,cwd=host,env=environment)
  atomic(host/'last-library-response.json',(p.stdout or '{}').encode())
  if p.returncode:raise RuntimeError('Original prepared save failed: '+clean(p.stderr[-1500:]))
  saved=json.loads(p.stdout);report['saved'].append(saved);json_file(out/'library-receiving.json',report['saved'])
  print(json.dumps({'saved':saved}),flush=True);results=saved.get('results',[])
  if len(results)!=len(items) or any(x.get('status')!='succeeded' for x in results):raise RuntimeError('One original save item did not complete')
  return results
 checkpoint=package()
 first=None
 if args.save_mode=='library':
  first=upload([{'local_path':str(archive_path),'purpose':'create_library_file','library_artifact_type':'other'}])[0]
  report['library_file_id']=first['library_file_id']
  phase('native_source_and_customer_checkpoint_saved',archive=checkpoint,library_file_id=first['library_file_id'])
 else:phase('native_source_and_customer_checkpoint_retained',archive=checkpoint)
 publisher_failure=None
 if args.consumer_mode=='archive':
  try:
   consumer_selection=json.loads((prepared/'consumer-selection.json').read_text())
   if args.consumer_archive:consumer_selection['path']=args.consumer_archive
   if args.consumer_node_modules:consumer_selection['node_modules']=args.consumer_node_modules
   json_file(host/'consumer-selection.json',consumer_selection)
   command('original_consumer_source',[args.python,'-B',str(prepared/'stage-consumer.py'),'--selection',str(host/'consumer-selection.json'),'--out',str(host/'consumer')])
   command('original_sf30_sf82_receiving',[args.node,'--max-old-space-size=192',str(prepared/'native-consumer.mjs'),native['sf30_package']['directory'],str(host/'consumer/consumer-source.json'),str(out/'native-publisher-receiving.json')])
   report['publisher_complete']=True
  except Exception as error:publisher_failure=clean(error);report['publisher_error']=publisher_failure
 merchant_failure=None
 connection=out/'merchant-connection.json'
 try:
  merchant_expected=next(x for x in manifest['files'] if x['path']=='interoperability/merchant_receiving.mjs')
  for item in manifest['files']:
   original_file=merchant_source/item['path']
   if not original_file.is_file() or original_file.stat().st_size!=item['size'] or git_sha(original_file)!=item['sha']:raise RuntimeError('The merchant host product source differs: '+item['path'])
  if git_sha(merchant_driver)!=merchant_expected['sha']:raise RuntimeError('The selected original merchant receiving driver differs')
  def workspace_entry(label,directory,workspace_id):
   return {'label':label,'directory':str(directory),'workspaceId':workspace_id,'python':str(Path(args.python).absolute()),'pythonPath':[str(site),str(source)],'inputs':{}}
  connection_value={'schema':'stellar-forge.wherobots-workspace-connection.v1','workspaces':{
   'reference':workspace_entry('Original Wherobots source receiving',out/'source-workspace',native['source_workspace_id']),
   'customer':workspace_entry('Original independently received Wherobots customer',out/'customer-workspace',native['customer_workspace_id'])}}
  if connection.exists() and json.loads(connection.read_text())!=connection_value:raise RuntimeError('Retain the original merchant connection and runtime paths for this continuation')
  json_file(connection,connection_value);os.chmod(connection,0o600)
  command('original_whole_merchant_receiving',[args.node,'--max-old-space-size=256',str(merchant_driver),'--connection',str(connection),'--workspace','reference','--workflow-id',native['workflow_id'],'--edition-id',native['after_edition_id'],'--out',str(out/'merchant-receiving'),'--python',args.python],cwd=merchant_source)
  merchant_result=json.loads((out/'merchant-receiving/operation.json').read_text())
  if merchant_result.get('state')!='COMPLETE' or merchant_result.get('selection',{}).get('workspace_id')!=native['source_workspace_id'] or merchant_result.get('edition_id')!=native['after_edition_id']:raise RuntimeError('The complete merchant receiving result does not bind to the original operation')
  report['merchant_complete']=True
  if args.consumer_mode=='merchant':
   expected_datasets={x['id']:x['rows'] for x in native['datasets']}
   actual_datasets={x['dataset_id']:x for x in merchant_result['dataset_packages']}
   if set(expected_datasets)!=set(actual_datasets):raise RuntimeError('Native publisher receiving must include every original dataset')
   for dataset_id,row_count in expected_datasets.items():
    dataset=actual_datasets[dataset_id];received=dataset.get('sf30',{});page_receipt=received.get('result',{});page_file=Path(page_receipt.get('path',''))
    if received.get('state')!='COMPLETE' or received.get('rows')!=row_count or not page_file.is_file() or page_file.stat().st_size!=page_receipt.get('bytes') or sha(page_file)!=page_receipt.get('sha256'):raise RuntimeError('The full native SF30 page result differs: '+dataset_id)
   json_file(out/'native-publisher-receiving.json',{'schema':'starforge.wherobots.native-publisher-receiving.v2','mode':'original-merchant','completed_at':now(),'workflow_id':native['workflow_id'],'edition_id':native['after_edition_id'],'source_workspace_id':native['source_workspace_id'],'datasets':merchant_result['dataset_packages']})
   report['publisher_complete']=True
  phase('original_whole_merchant_receiving_complete',customer=merchant_result['independent_receiving']['workspace_id'],datasets=len(merchant_result['dataset_packages']),edition_id=merchant_result['edition_id'],original_tools=len(merchant_result['tools']),publisher_complete=report['publisher_complete'])
  phase('complete_native_merchant_checkpoint_retained',archive=package())
 except Exception as error:
  merchant_failure=clean(error);report['merchant_error']=merchant_failure
  if args.consumer_mode=='merchant' and not report['publisher_complete']:publisher_failure=merchant_failure;report['publisher_error']=merchant_failure
 browser_failure=None
 try:
  command('original_browser_receiving',[args.node,'--max-old-space-size=192',str(prepared/'browser-receiving.cjs'),str(source),str(out),args.python,args.chromium])
  browser=json.loads((out/'browser/browser-receiving.json').read_text())
  if not browser.get('complete'):raise RuntimeError('Original full browser result is incomplete')
  report['browser_complete']=True
 except Exception as error:browser_failure=clean(error);report['browser_error']=browser_failure
 managed_failure=None
 try:
  if not connection.is_file():raise RuntimeError('The original source/customer workspace connection has not been retained')
  command('original_managed_customer_receiving',[args.node,'--max-old-space-size=256',str(managed_driver),'--connection',str(connection),'--workspace','customer','--workflow-id',native['workflow_id'],'--out',str(out/'managed-receiving'),'--python',args.python],cwd=merchant_source.parent)
  managed_result=json.loads((out/'managed-receiving/receiving.json').read_text())
  if managed_result.get('state')!='COMPLETE' or managed_result.get('workspace_id')!=native['customer_workspace_id'] or managed_result.get('workflow_id')!=native['workflow_id']:raise RuntimeError('The complete managed receiving result differs from the original customer')
  report['managed_complete']=True
  phase('original_managed_customer_receiving_complete',customer=managed_result['workspace_id'],datasets=len(managed_result['datasets']),rows=sum(x['rows'] for x in managed_result['datasets']),files=managed_result['files'])
 except Exception as error:managed_failure=clean(error);report['managed_error']=managed_failure
 report['completed_at']=now();phase('original_receiving_finalized',native_complete=True,browser_complete=report['browser_complete'],publisher_complete=report['publisher_complete'],merchant_complete=report['merchant_complete'],managed_complete=report['managed_complete'])
 summary=delivery/'Wherobots_Operated_Receiving.json';json_file(summary,report)
 guide=delivery/'Wherobots_Receiving_Guide.md'
 rows='\n'.join('| '+x['id']+' | '+str(x['rows'])+' | '+str(len(x['columns']))+' |' for x in native['datasets'])
 text=f"""# Wherobots original-source receiving

The included application operates the retained GeoParquet project originals through PyArrow 26.0.0 and Wherobots Python SDK 0.5.0. Its original source collection, versioned output editions, complete comparisons, portable handovers and independent customer workspace are retained together.

## Operated data

| Dataset | Complete rows | Columns |
| --- | ---: | ---: |
{rows}

The two original editions are {native['before_edition_id']} and {native['after_edition_id']}. Source workspace {native['source_workspace_id']} and independent customer {native['customer_workspace_id']} preserve those same identities. The native operation reopened the independent customer and checked its source bindings, complete rows and comparison.

Exact input URLs, bytes and Git identities are retained in source/interoperability/fixtures/manifest.json. Complete original input bodies remain in that directory and in the original workspace objects.

## Open and receive the product

Extract the package into a working directory. Install the exact source/requirements.txt dependencies in the intended Python 3.12 environment. From source/, open the already operated customer:

    python operate.py --workspace ../operation/customer-workspace serve --host 127.0.0.1 --port 0

Open the ephemeral local address printed by that command. Select the retained collection to read its original transformation, every source file, four dataset definitions and both editions. Select an edition and dataset to read every row. The comparison view downloads the complete report and every changed row. Export complete handover retains the original source/run/output collection for the next operator.

operation/first-handover.zip retains the first edition. operation/complete-handover.zip adds the corrected edition and its comparison. A new customer can use Import handover in the application or the original CLI:

    python operate.py --workspace ../new-customer init --title "Customer receiving"
    python operate.py --workspace ../new-customer import ../operation/complete-handover.zip

The original operation/sf30-dataset/ contains the maintained SF30 configuration, complete lossless CSV and source companions. The source manifest supplies the same descriptors to its receiving mapping and SF82 sourceFiles reader.

## Browser and subsequent receiving

Native source receiving completed: yes. Full browser receiving completed: {'yes' if report['browser_complete'] else 'continuation retained'}. Native SF30/SF82 receiving completed: {'yes' if report['publisher_complete'] else 'continuation retained'}. Whole original merchant receiving completed: {'yes' if report['merchant_complete'] else 'continuation retained'}. Managed customer receiving and reopen completed: {'yes' if report['managed_complete'] else 'continuation retained'}.

operation/merchant-receiving/ retains the actual 27-tool source-host workflow, interrupted and restarted complete export, every source-bound dataset package, independently imported original SDK and complete typed row comparisons when completed. Every exported dataset also passes through native SF30 admit/handle pagination; each native-sf30-pages.json retains every response, native reader source identities and full SF82 companion descriptors. Its connection points to the original source workspace selected above; the source job and its two editions remain the same operation.

operation/browser/browser-receiving.json records the actual desktop and 390-pixel customer actions, original byte downloads, full row reads, comparison, export, fresh receiving and reopen when completed. Every recorded download is included. The independently created browser customer remains under operation/browser-customer-workspace/.

operation/managed-receiving/ retains the original Applications launcher operating the already received native customer. It contains every row from every edition, the complete original handover, actual process identities, Stop and same-workspace reopen. application/ holds the selected source-owned launcher, provider and receiving guide; use those files at their original Wherobots directory in the selected complete repository.

## Source and reproduction

The selected source is the original cumulative source {manifest['revision']}. receiving/source-selection.json and receiving-manifest.json list every exact selected file.

The prepared receiving runner supports --arrow-mode existing for an already installed Arrow26 environment, with --python selecting its actual SDK interpreter. Existing worker paths can be supplied through --playwright-node-modules, --node and --chromium. The default --consumer-mode merchant queries every dataset using the current repository's original SF30/SF82 engines. The earlier --consumer-mode archive route remains available with its explicit --consumer-archive and --consumer-node-modules selections and original byte/hash checks. --merchant-driver selects the actual source/interoperability/merchant_receiving.mjs in its complete original repository layout, including its maintained host and dependencies. --managed-driver selects that same repository's examples/managed-receiving.mjs; it is derived from --merchant-driver when omitted. Local delivery is the default; an existing official save helper is selected explicitly when needed. The complete original source/interoperability/native_receiving.py is the original receiving driver. Its output-directory stages preserve completed steps. To continue a transferred receiving checkpoint with the prepared runner, use --resume-archive with that exact ZIP and keep the original --out path recorded in operation/operation.json; the runner verifies every member before reopening the same workspace identities. --save-mode local retains the complete files for an equipped worker's existing delivery route; the explicit --save-mode library --library-helper route saves the native checkpoint and replaces it with the completed delivery. Runtime versions and full original Arrow recovery identity remain in operation/runtime-originals.json and operation/operation.json. The complete customer journey is receiving/browser-receiving.cjs.

Customer adoption can select its existing organization, script, source collections, output definitions and SDK run under the current original commercial workshare. The same application supports reviewed native job submission, recovery, polling, logs and captured outputs through the original SDK and account configuration.
"""
 atomic(guide,text.encode());final=package()
 final_saved=[]
 if args.save_mode=='library':
  replacement={'local_path':str(archive_path),'purpose':'replace_library_file','library_file_id':first['library_file_id'],'version_reason':'Complete original browser and independently reopened customer receiving'}
  if first.get('current_version_number') is not None:replacement['expected_current_version']=first['current_version_number']
  final_saved=upload([replacement,{'local_path':str(guide),'purpose':'create_library_file','library_artifact_type':'report'},{'local_path':str(summary),'purpose':'create_library_file','library_artifact_type':'report'}])
  phase('complete_receiving_delivery_saved',archive=final,files=[{'library_file_id':x.get('library_file_id'),'path':x.get('path'),'status':x.get('status')} for x in final_saved])
 else:phase('complete_receiving_files_retained',archive=final,guide=str(guide),summary=str(summary))
 print(json.dumps({'complete':report['browser_complete'] and report['publisher_complete'] and report['merchant_complete'] and report['managed_complete'],'archive':final,'native':str(out/'operation.json'),'browser':str(out/'browser/browser-receiving.json'),'managed':str(out/'managed-receiving/receiving.json'),'saved':final_saved}),flush=True)
 if browser_failure or publisher_failure or merchant_failure or managed_failure:raise RuntimeError(browser_failure or publisher_failure or merchant_failure or managed_failure)
if __name__=='__main__':
 try:main()
 except BaseException as error:print(json.dumps({'receiving_error':clean(str(error))}),flush=True);raise
