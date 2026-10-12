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
source_owner=Path('/workspace/scratch/b71092915960/stac-managed-applications-native/operation-code')
for path in sorted(source_owner.iterdir()):
 if path.is_file():
  if path.is_symlink():raise ValueError('Use the selected original operation source')
  exact(BASE/'operation-code'/path.name,path.read_bytes())
metadata=BASE/'operation-code/source-7169.json'
data=metadata.read_bytes()
if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!='56da861934c0a161c8ab76b64a17c2a9b421d557':raise ValueError('Original full source metadata changed')
selection=json.loads((BASE/'native-input.json').read_text())
if selection['operationId']!=OPERATION or selection['sourceCommit']!=SOURCE:raise ValueError('Continue the original selected operation')
builder=Path(selection['builderDirectory'])
for item in selection['builderFiles']:
 original=Path('/workspace/scratch/b71092915960/stac-applications-source-7169/builder')/item['name']
 body=original.read_bytes()
 if len(body)!=item['bytes'] or hashlib.sha1(b'blob '+str(len(body)).encode()+b'\0'+body).hexdigest()!=item['blob']:raise ValueError('Original builder source changed: '+item['name'])
 exact(builder/item['name'],body)
 exact(BASE/'incoming'/(item['blob']+'.blob'),body)
save(DELIVERY/'native-carrier-selection.json',{'operationId':OPERATION,'sourceCommit':SOURCE,'carrierSource':'commons:0b1f4b156c01f0b05182d9ace93cba0c351e2b17','carrier':'original one-allocation put/run/pack/upload','base':str(BASE),'project':str(ROOT),'startedAt':started,'originalSharedInputSha256':digest(BASE/'original-shared-input.json'),'selectedInputSha256':digest(BASE/'native-input.json'),'selectionChanges':['builderDirectory moved to the owned private source copy'],'attemptLabel':label})
out=logs/(label+'.original.stdout');err=logs/(label+'.original.stderr')
code=1
try:
 with out.open('wb') as stdout,err.open('wb') as stderr:
  result=subprocess.run([sys.executable,'-B',str(BASE/'receive-and-continue.py')],cwd=ROOT,stdout=stdout,stderr=stderr,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','TMPDIR':str(ROOT/'temporary'),'NODE_OPTIONS':'--max-old-space-size=160'})
  code=result.returncode
finally:
 original=DELIVERY/'original-operation'
 original.mkdir(mode=0o700,exist_ok=True)
 for name in ('native-input.json','original-shared-input.json','receive-and-continue.py','launch-native.py'):
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
 body=archive.read_bytes()
 request=urllib.request.Request(upload['upload_url'],data=body,headers=upload['required_headers'],method=upload['method'])
 with urllib.request.urlopen(request,timeout=45) as response:
  response.read()
  transfer.update(state='UPLOADED',httpStatus=response.status,completedAt=stamp())
except BaseException as failure:
 transfer.update(state='TRANSFER_UNCERTAIN',errorType=type(failure).__name__,httpStatus=getattr(failure,'code',None),observedAt=stamp())
finally:save(transfer_file,transfer)
print(json.dumps({'operationId':OPERATION,'sourceCommit':SOURCE,'exitCode':code,'complete':code==0 and (ROOT/'continuation.json').is_file(),'stdoutTail':tail(out),'stderrTail':tail(err),'transfer':transfer}),flush=True)
raise SystemExit(code if transfer['state']=='UPLOADED' else 70)
