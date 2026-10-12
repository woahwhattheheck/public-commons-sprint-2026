#!/usr/bin/env python3
"""Continue the original MCC issued-source operation through its maintained API."""
import fcntl,hashlib,json,os,resource,subprocess,sys,tarfile,tempfile,zipfile
from pathlib import Path,PurePosixPath
os.umask(0o077)
ROOT=Path(__file__).resolve().parent
OP='LGNDX-MCC-ISSUED-SOURCE-REVIEW-0C7A-20261012'
SHA=lambda b:hashlib.sha256(b).hexdigest()
def git(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def put(path,body):
 path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 fd,temporary=tempfile.mkstemp(prefix='.mcc-native-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(body);f.flush();os.fsync(f.fileno())
  os.replace(temporary,path)
  d=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(d)
  finally:os.close(d)
 finally:
  if os.path.exists(temporary):os.unlink(temporary)
def receipt(path):return {'filename':path.name,'bytes':path.stat().st_size,'sha256':SHA(path.read_bytes())}
def verify(path,item):
 body=path.read_bytes()
 if len(body)!=item['bytes'] or SHA(body)!=item['sha256']:raise RuntimeError('Retained input/output identity changed: '+path.name)
 return body
selection=json.loads((ROOT/'selection.json').read_text())
if selection['operation']!=OP:raise RuntimeError('Original operation changed')
PRIVATE=Path(selection['private_root'])
if not PRIVATE.is_absolute() or PRIVATE==ROOT or ROOT in PRIVATE.parents or PRIVATE in ROOT.parents:
 raise RuntimeError('The selected private working directory must be separate from the retained operation')
lock=(ROOT/'receiving.lock').open('a+b');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
execution=ROOT/'execution.json'
if execution.exists():
 previous=json.loads(execution.read_text())
 if previous.get('complete'):
  for item in previous['outputs']:verify(ROOT/item['filename'],item)
  print(json.dumps({'operation':OP,'reopened':True,'complete':True,'outputs':previous['outputs']}),flush=True)
  sys.exit(0)
 (ROOT/'attempts').mkdir(mode=0o700,exist_ok=True)
 archived=ROOT/'attempts'/(SHA(execution.read_bytes())+'.json')
 if not archived.exists():put(archived,execution.read_bytes())
source=ROOT/'source.zip';verify(source,selection['source_archive'])
verify(ROOT/'receive.mjs',selection['driver'])
update=Path(selection['project_update']['path']);verify(update,selection['project_update'])
handoff=Path(selection['baseline_handoff']['path']);verify(handoff,selection['baseline_handoff'])
PRIVATE.mkdir(mode=0o700,parents=True,exist_ok=True)
checkpoint=ROOT/'native-state.tar.gz'
if checkpoint.exists() and not (PRIVATE/'operation.json').exists():
 with tarfile.open(checkpoint,'r:gz') as saved:
  for item in saved:
   relative=PurePosixPath(item.name)
   if relative.is_absolute() or '..' in relative.parts or not relative.parts or relative.parts[0] not in {'workspace','buyer-receiving','handoff','operation.json'}:
    raise RuntimeError('Retained checkpoint member changed')
   target=PRIVATE/str(relative)
   if item.isdir():target.mkdir(mode=0o700,parents=True,exist_ok=True);continue
   if not item.isfile():raise RuntimeError('Checkpoint requires original ordinary files')
   stream=saved.extractfile(item)
   if stream is None:raise RuntimeError('Checkpoint member missing')
   with stream:put(target,stream.read())
with zipfile.ZipFile(source) as z:
 manifest=json.loads(z.read('SOURCE_MANIFEST.json'))
 for item in manifest['files']:
  relative=PurePosixPath(item['path'])
  if relative.is_absolute() or '..' in relative.parts:raise RuntimeError('Selected source path changed')
  body=z.read('source/'+str(relative))
  if len(body)!=item['bytes'] or SHA(body)!=item['sha256'] or git(body)!=item['git_blob']:raise RuntimeError('Selected original source changed')
  put(PRIVATE/'source'/str(relative),body)
packet=PRIVATE/'baseline-portable.json'
with zipfile.ZipFile(handoff) as z:raw=z.read(selection['baseline_portable']['member'])
if len(raw)!=selection['baseline_portable']['bytes'] or SHA(raw)!=selection['baseline_portable']['sha256']:
 raise RuntimeError('Original revision-133 portable changed')
put(packet,raw)
temporary=PRIVATE/'temp';temporary.mkdir(mode=0o700,exist_ok=True)
env=dict(os.environ);env['TMPDIR']=str(temporary);env['NODE_OPTIONS']='--max-old-space-size=512 --max-semi-space-size=4'
result={'schema':'stellar-forge.mcc-native-execution.v1','operation':OP,'source_ref':selection['source_ref'],'complete':False,'stages':[]}
def checkpoint_state():
 fd,name=tempfile.mkstemp(prefix='.mcc-checkpoint-',suffix='.tar.gz',dir=ROOT);os.close(fd)
 try:
  with tarfile.open(name,'w:gz',compresslevel=6) as out:
   for selected in ('operation.json','workspace','buyer-receiving','handoff'):
    p=PRIVATE/selected
    if p.exists():out.add(p,arcname=selected,recursive=True)
  with open(name,'rb') as f:os.fsync(f.fileno())
  os.replace(name,checkpoint)
  d=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(d)
  finally:os.close(d)
  return receipt(checkpoint)
 finally:
  if os.path.exists(name):os.unlink(name)
exit_code=1
try:
 for phase in ('restore','apply','receive'):
  command=[selection['node'],str(ROOT/'receive.mjs'),str(PRIVATE/'source'),str(PRIVATE),str(update),str(packet),phase]
  child=subprocess.run(command,env=env,pass_fds=(lock.fileno(),))
  stage={'phase':phase,'exit_code':child.returncode,'child_peak_rss_kib':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss}
  result['stages'].append(stage)
  snapshot=checkpoint_state();stage['checkpoint']=snapshot
  put(execution,(json.dumps(result,sort_keys=True,indent=2)+'\n').encode())
  print(json.dumps({'operation':OP,'stage':stage}),flush=True)
  if child.returncode:raise RuntimeError('Original receiving phase returned '+str(child.returncode))
 journal=json.loads((PRIVATE/'operation.json').read_text())
 if journal.get('status')!='complete':raise RuntimeError('Original receiving journal is incomplete')
 target=ROOT/'customer-handoff.zip'
 fd,name=tempfile.mkstemp(prefix='.mcc-handoff-',suffix='.zip',dir=ROOT);os.close(fd)
 try:
  with zipfile.ZipFile(name,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
   for p in sorted((PRIVATE/'handoff').iterdir()):
    if not p.is_file() or p.is_symlink():raise RuntimeError('Ordinary named handoff file required')
    z.write(p,arcname=p.name)
   z.writestr('SOURCE_IDENTITY.json',json.dumps({'source_ref':selection['source_ref'],'source_archive':selection['source_archive'],
    'project_update_sha256':selection['project_update']['sha256'],'baseline_portable':selection['baseline_portable']},sort_keys=True,indent=2)+'\n')
  with open(name,'rb') as f:os.fsync(f.fileno())
  os.replace(name,target)
 finally:
  if os.path.exists(name):os.unlink(name)
 put(ROOT/'customer-result.json',(PRIVATE/'handoff/receiving-result.json').read_bytes())
 result['outputs']=[receipt(checkpoint),receipt(target),receipt(ROOT/'customer-result.json')]
 result['complete']=True;result['completed_at']=journal['completedAt'];exit_code=0
except BaseException as error:
 result['complete']=False;result['error']={'type':type(error).__name__,'message':str(error)[:500]}
 try:result['checkpoint']=checkpoint_state()
 except Exception as checkpoint_error:result['checkpoint_error']={'type':type(checkpoint_error).__name__,'message':str(checkpoint_error)[:300]}
finally:
 put(execution,(json.dumps(result,sort_keys=True,indent=2)+'\n').encode())
 print(json.dumps(result),flush=True)
sys.exit(exit_code)
