# MIT. Complete the existing STAC receiving operation in one equipped process.
from pathlib import Path
import datetime,fcntl,hashlib,json,os,shutil,subprocess,sys,urllib.request,urllib.error,zipfile
OPERATION='SCF-STAC-MANAGED-APPLICATION-RECEIVING-B710-20261012'
SOURCE='7169c10e37a1800d22133efaf37cfaac5d96e343'
ROOT=Path(__file__).resolve().parent
BASE=ROOT/'operation-base'
DELIVERY=ROOT/'delivery'
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):h.update(block)
 return h.hexdigest()
def save(path,value):
 path.write_text(json.dumps(value,indent=2)+'\n');path.chmod(0o600)
def exact(path,data):
 path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 if path.exists():
  if path.read_bytes()!=data:raise ValueError('Preserve a changed selected source: '+str(path))
 else:
  with path.open('xb') as stream:stream.write(data)
 path.chmod(0o600)
def tail(path,size=14000):
 if not path.exists():return ''
 with path.open('rb') as stream:
  stream.seek(max(0,path.stat().st_size-size))
  return stream.read().decode('utf-8',errors='replace')
if len(sys.argv)!=3:raise SystemExit('Usage: one-allocation.py PRIVATE_UPLOAD_JSON ATTEMPT_LABEL')
upload_path=Path(sys.argv[1]).resolve()
label=sys.argv[2]
if not label.replace('-','').isalnum():raise SystemExit('Choose an alphanumeric attempt label')
if not upload_path.is_relative_to(ROOT) or upload_path.is_symlink():raise SystemExit('Use the existing private upload selection')
upload=json.loads(upload_path.read_text())
if upload['method']!='PUT' or not upload['upload_url'].startswith('https://'):raise SystemExit('Use the original returned upload contract')
ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
BASE.mkdir(mode=0o700,exist_ok=True)
DELIVERY.mkdir(mode=0o700,exist_ok=True)
logs=ROOT/'native-logs';logs.mkdir(mode=0o700,exist_ok=True)
(ROOT/'temporary').mkdir(mode=0o700,exist_ok=True)
lock=(ROOT/'original-operation.lock').open('a+')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
started=stamp()

# Reuse the maintained transfer engine with the original opaque reservation.
upload_tools=Path(os.environ.get('STAC_LIBRARY_HELPER_DIRECTORY','/workspace/scratch/b71092915960/wherobots/library-upload-20261012'))
upload_tool_hashes={
 'library_upload.py':'b11e4929596e321366c2f7291890fbb6d6bf8b413ae6d24593e9548f9bf50f23',
 'library_file_transfer.py':'5c81478cd94a59d721a1677d0bd36f7cec23c18a21b48740b1c9ff94d27fb26f',
 'library_hosted_apps.py':'b7961301f7ca6f76b2f2f30e4e5673a303532680a790e545c3207a2bf5e63de4'
}
for name,expected in upload_tool_hashes.items():
 source=upload_tools/name
 if not source.is_file() or source.is_symlink() or digest(source)!=expected:
  raise ValueError('The selected maintained Library transfer source changed: '+name)
 exact(DELIVERY/'original-operation'/'library-upload'/name,source.read_bytes())
sys.path.insert(0,str(upload_tools))
from library_upload import UploadRequest,PreparedUpload,SignedUrlUploader
source_owner=Path(os.environ.get('STAC_OPERATION_CODE_DIRECTORY','/workspace/scratch/b71092915960/stac-managed-applications-native/operation-code'))
for path in sorted(source_owner.iterdir()):
 if path.is_file():
  if path.is_symlink():raise ValueError('Use the selected original operation source')
  exact(BASE/'operation-code'/path.name,path.read_bytes())
metadata=BASE/'operation-code/source-7169.json'
data=metadata.read_bytes()
if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!='56da861934c0a161c8ab76b64a17c2a9b421d557':raise ValueError('Original full source metadata changed')
input_file=BASE/'native-input.json'
following_file=BASE/'following-preparation.json'
following=json.loads(following_file.read_text()) if following_file.is_file() else None
if following:
 if following.get('operationId')!=OPERATION or following.get('attemptLabel')!=label:
  raise ValueError('Preserve the original following preparation')
 input_file=BASE/'following-native-input.json'
 original=following['originalInput'];selected=following['selectedInput']
 if original['path']!='operation-base/native-input.json' or digest(BASE/'native-input.json')!=original['sha256']:
  raise ValueError('Original native input changed after preparation')
 if selected['path']!='operation-base/following-native-input.json' or input_file.stat().st_size!=selected['bytes'] or digest(input_file)!=selected['sha256']:
  raise ValueError('Selected following input changed after preparation')
selection=json.loads(input_file.read_text())
if selection['operationId']!=OPERATION or selection['sourceCommit']!=SOURCE:raise ValueError('Continue the original selected operation')
builder=Path(selection['builderDirectory'])
for item in selection['builderFiles']:
 original=Path(os.environ.get('STAC_BUILDER_SOURCE_DIRECTORY','/workspace/scratch/b71092915960/stac-applications-source-7169/builder'))/item['name']
 body=original.read_bytes()
 if len(body)!=item['bytes'] or hashlib.sha1(b'blob '+str(len(body)).encode()+b'\0'+body).hexdigest()!=item['blob']:raise ValueError('Original builder source changed: '+item['name'])
 exact(builder/item['name'],body)
 exact(BASE/'incoming'/(item['blob']+'.blob'),body)
save(DELIVERY/'native-carrier-selection.json',{'operationId':OPERATION,'sourceCommit':SOURCE,'carrierSource':'commons:0b1f4b156c01f0b05182d9ace93cba0c351e2b17','carrier':'original one-allocation put/run/pack/upload','base':str(BASE),'project':str(ROOT),'startedAt':started,'originalSharedInputSha256':digest(BASE/'original-shared-input.json'),'selectedInputSha256':digest(input_file),'selectedInputPath':str(input_file),'selectionChanges':['builderDirectory moved to the owned private source copy']+([item['field'] for item in following['changes']] if following else []),'followingPreparationSha256':digest(following_file) if following else None,'attemptLabel':label})
out=logs/(label+'.original.stdout');err=logs/(label+'.original.stderr')
code=1
try:
 with out.open('wb') as stdout,err.open('wb') as stderr:
  result=subprocess.run([sys.executable,'-B',str(BASE/'receive-and-continue.py')]+(['--input',str(input_file)] if following else []),cwd=ROOT,stdout=stdout,stderr=stderr,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','TMPDIR':str(ROOT/'temporary'),'NODE_OPTIONS':'--max-old-space-size=160'})
  code=result.returncode
finally:
 original=DELIVERY/'original-operation'
 original.mkdir(mode=0o700,exist_ok=True)
 for name in ('native-input.json','original-shared-input.json','following-native-input.json','following-preparation.json','receive-and-continue.py','launch-native.py'):
  p=BASE/name
  if p.is_file():shutil.copy2(p,original/name)
 shutil.copy2(Path(__file__),original/'one-allocation.py')
 for name in ('operation-code','builder'):
  if (BASE/name).is_dir():shutil.copytree(BASE/name,original/name,dirs_exist_ok=True)
 for p in (out,err):
  if p.is_file():shutil.copy2(p,DELIVERY/p.name)
 for name in ('continuation.json','continuation-error.json','runtime-ready.json','source-release.json'):
  p=ROOT/name
  if p.is_file():shutil.copy2(p,DELIVERY/name)
 save(DELIVERY/'one-allocation-result.json',{'operationId':OPERATION,'sourceCommit':SOURCE,'attemptLabel':label,'startedAt':started,'completedAt':stamp(),'exitCode':code,'stdoutFile':out.name,'stderrFile':err.name,'complete':code==0 and (ROOT/'continuation.json').is_file()})
archive=ROOT/'SCF_STAC_Managed_Applications_Native_20261012.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as target:
 for path in sorted(DELIVERY.rglob('*')):
  if path.is_symlink():raise ValueError('Preserve original source without an external archive link')
  if path.is_file():target.write(path,path.relative_to(DELIVERY).as_posix())
archive.chmod(0o600)
with zipfile.ZipFile(archive) as check:
 bad=check.testzip()
 if bad:raise ValueError('Native archive member CRC failed: '+bad)
 members=len(check.infolist())
archive_sha=digest(archive)
transfer={'operationId':OPERATION,'upload_session_id':upload['upload_session_id'],'file_id':upload['file_id'],'path':str(archive),'bytes':archive.stat().st_size,'sha256':archive_sha,'members':members,'state':'PREPARED','preparedAt':stamp()}
transfer_file=ROOT/('transfer-'+label+'.json')
save(transfer_file,transfer)
try:
 request_body={'local_path':str(archive),'purpose':upload['purpose']}
 if upload.get('library_artifact_type') is not None:
  request_body['library_artifact_type']=upload['library_artifact_type']
 request=UploadRequest.parse(request_body,0)
 if request.size_bytes!=archive.stat().st_size:
  raise ValueError('The complete native archive changed before transfer')
 prepared=PreparedUpload.parse(request,upload)
 upload_state=ROOT/('upload-'+label)
 upload_state.mkdir(mode=0o700)
 completed=SignedUrlUploader().upload((prepared,),upload_state)
 if completed!={0}:
  raise RuntimeError('The original Library upload did not complete')
 transfer.update(state='UPLOADED',transferEngine='maintained SignedUrlUploader',completedAt=stamp())
except BaseException as failure:
 transfer.update(state='TRANSFER_UNCERTAIN',errorType=type(failure).__name__,httpStatus=getattr(failure,'code',None),observedAt=stamp())
finally:save(transfer_file,transfer)
print(json.dumps({'operationId':OPERATION,'sourceCommit':SOURCE,'exitCode':code,'complete':code==0 and (ROOT/'continuation.json').is_file(),'stdoutTail':tail(out),'stderrTail':tail(err),'transfer':transfer}),flush=True)
raise SystemExit(code if transfer['state']=='UPLOADED' else 70)
