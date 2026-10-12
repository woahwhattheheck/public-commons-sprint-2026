#!/usr/bin/env python3
"""Retain and save the complete Analysis project using the accepted ab412 custody loop."""
from __future__ import annotations
import fcntl,hashlib,json,os,signal,stat,subprocess,sys,time,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CONTROL=ROOT/'file-save'
OPERATION='SCF-ANALYSIS-PROJECT-OPENING-7DE2-20261012'
INPUT_SHA=hashlib.sha256((ROOT/'control-source/source-frame.json').read_bytes()).hexdigest()
os.umask(0o077)
def now():return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def directory(path):
 if path.exists():
  if not path.is_dir() or path.is_symlink():raise ValueError('Use the original private control directory')
  sync(path.parent);return
 directory(path.parent);path.mkdir(mode=0o700);sync(path);sync(path.parent)
def save(path,value):
 directory(path.parent)
 temp=path.with_name(path.name+'.part')
 with temp.open('w') as f:json.dump(value,f,sort_keys=True,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.replace(temp,path);sync(path.parent)
def read(path):return json.loads(path.read_text()) if path.is_file() else None
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1048576),b''):h.update(block)
 return h.hexdigest()
def accepted(value,archive):
 rows=value.get('results') if isinstance(value,dict) else None
 if not isinstance(rows,list) or len(rows)!=1:return False
 row=rows[0]
 return (isinstance(row,dict) and row.get('status')=='succeeded'
  and row.get('local_path')==archive['path']
  and bool(row.get('library_file_id') or row.get('file_id')))
def stop(number,_frame):
 for selected in (signal.SIGTERM,signal.SIGINT):signal.signal(selected,signal.SIG_IGN)
 raise SystemExit(128+number)
def run_child(command,stdout,stderr=None,*,input_bytes=None):
 child=None
 previous={n:signal.getsignal(n) for n in (signal.SIGTERM,signal.SIGINT)}
 pending=[]
 def defer(number,frame):pending.append((number,frame))
 try:
  for n in previous:signal.signal(n,defer)
  child=subprocess.Popen(command,cwd=ROOT,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},
   stdin=subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL,
   stdout=stdout,stderr=stderr if stderr is not None else subprocess.STDOUT)
  for n,handler in previous.items():signal.signal(n,handler)
  if pending:
   number,frame=pending[0];handler=previous[number]
   if callable(handler):handler(number,frame)
   elif handler!=signal.SIG_IGN:raise SystemExit(128+number)
  child.communicate(input_bytes)
  return child.returncode
 except BaseException:
  for n in previous:signal.signal(n,signal.SIG_IGN)
  if child is not None and child.poll() is None:
   child.terminate()
   try:child.wait(timeout=5)
   except subprocess.TimeoutExpired:child.kill();child.wait()
  raise
 finally:
  for n,handler in previous.items():signal.signal(n,handler)
def progress(value):
 save(CONTROL/'result.json',value)
 save(ROOT/'delivery/private-save-result.json',value)
def release_packaged_cache(archive):
 # The complete Analysis project retains all selected source and runtime files.
 return {'files':0,'allocated_bytes':0,'keeper':archive,'at':now()}
def announce(value):
 try:print(json.dumps(value),flush=True)
 except OSError:pass
def recover_saved(save_root,archive):
 for name in ('library-result.json','helper.stdout'):
  try:value=read(save_root/name)
  except (ValueError,OSError):value=None
  if accepted(value,archive):return value
 try:ack=read(save_root/'custody-ack.json')
 except (ValueError,OSError):ack=None
 if (isinstance(ack,dict) and ack.get('archive_sha256')==archive['sha256']
     and ack.get('archive_bytes')==archive['bytes'] and accepted(ack.get('result'),archive)):
  return ack['result']
 return None
def publish_completed(state,built,archive):
 # The complete private archive remains owned by this foreground until its
 # original save has a returned identity. A local I/O failure never drops it.
 for number in (signal.SIGTERM,signal.SIGINT):signal.signal(number,signal.SIG_IGN)
 state.update(state='ARTIFACT_READY',archive=archive,builder_result=built,updated_at=now())
 save_root=CONTROL/'saves'/archive['sha256']
 intent_path=save_root/'intent.json'
 released=False
 last_notice=None
 while True:
  try:
   if not released:
    try:state['released_packaged_cache']=release_packaged_cache(archive)
    except (OSError,ValueError) as exc:
     state['cache_retention']={'kind':type(exc).__name__,'message':str(exc),'at':now()}
    released=True
   directory(save_root)
   intent=read(intent_path)
   if intent and (intent.get('archive')!=archive or intent.get('input_sha256')!=INPUT_SHA):
    raise ValueError('Keep the original save intent')
   returned=recover_saved(save_root,archive)
   if accepted(returned,archive):
    custody={'schema':'stellar-forge.analysis-saved-project-custody.v1','operation':OPERATION,
     'archive':archive,'input_sha256':INPUT_SHA,'saved_result':returned,
     'saved_at':(read(save_root/'custody.json') or {}).get('saved_at') or now()}
    save(save_root/'library-result.json',returned)
    save(save_root/'custody.json',custody)
    save(ROOT/'delivery/custody.json',custody)
    state.update(state='COMPLETE',custody=custody,completed_at=state.get('completed_at') or now())
    progress(state);announce(state);return 0
   if intent is None:
    state.update(state='SAVING',updated_at=now())
    progress(state)
    payload=json.dumps({'uploads':[{'local_path':archive['path'],'purpose':'create_library_file','library_artifact_type':'other'}]}).encode()
    # Open both original output streams before committing the one-send intent.
    # Once the intent exists, only its result/ACK can complete this save.
    with (save_root/'helper.stdout').open('a+b') as out,(save_root/'helper.stderr').open('a+b') as err:
     if os.fstat(out.fileno()).st_size or os.fstat(err.fileno()).st_size:
      raise ValueError('Reconcile the retained helper output before a save intent')
     intent={'schema':'stellar-forge.analysis-complete-project-save.v1','operation':OPERATION,
      'input_sha256':INPUT_SHA,'archive':archive,'started_at':now()}
     save(intent_path,intent)
     try:
      state['helper_exit']=run_child([sys.executable,'-B',str(ROOT/'publish-support/library_upload.py')],out,err,input_bytes=payload)
     except BaseException as exc:
      state['helper_interruption']={'kind':type(exc).__name__,'at':now()}
     finally:
      out.flush();os.fsync(out.fileno());err.flush();os.fsync(err.fileno())
    # A complete stdout receipt is recoverable even if a later journal write fails.
    continue
   state.update(state='AWAITING_PRIVATE_SAVE',save_intent=str(intent_path),
    ack_path=str(save_root/'custody-ack.json'),updated_at=now())
   progress(state)
  except BaseException as exc:
   state.update(state='AWAITING_PRIVATE_SAVE',save_intent=str(intent_path),
    ack_path=str(save_root/'custody-ack.json'),updated_at=now(),
    local_recovery={'kind':type(exc).__name__,'message':str(exc),'at':now()})
   try:progress(state)
   except (OSError,ValueError):pass
  recovery=state.get('local_recovery') or {}
  notice=(state['state'],state.get('helper_exit'),recovery.get('kind'),recovery.get('message'))
  if notice!=last_notice:
   announce(state);last_notice=notice
  time.sleep(5)
