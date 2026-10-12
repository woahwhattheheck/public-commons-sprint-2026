import ast,base64,hashlib,json,os,pathlib,stat,subprocess,sys,tempfile,termios,tty,zlib
tty.setraw(sys.stdin.fileno())
root=pathlib.Path('/dev/83dd-wordpress-source-receiver')
root.mkdir(mode=0o700,parents=True,exist_ok=True)
source=pathlib.Path('/dev/83dd-wordpress-release/source')
allowed={'input.json','prepare.py','host-selection.json','launch.py','host-finalizer.json'}
def reply(value):
 print(json.dumps(value,separators=(',',':')),flush=True)
def status():
 return {name: {'bytes':(root/(name+'.partial')).stat().st_size if (root/(name+'.partial')).exists() else 0,
 'complete':(root/name).exists()} for name in sorted(allowed)}
def atomic(path,data,mode=0o600):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix=path.name+'.',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

CHECKPOINT_MAX=4*1024*1024
checkpoint_operation='scf-wordpress-native-receiving-83dd-20261012'
def checkpoint_id(value):
 if not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value):
  raise ValueError('Select an exact checkpoint SHA-256')
 return value
def checkpoint_paths(value):
 key=checkpoint_id(value)
 return root/(key+'.checkpoint-meta.json'),root/(key+'.checkpoint.zlib.partial'),root/(key+'.checkpoint.json')
def checkpoint_command(command):
 action=command.get('action')
 if action not in {'checkpoint-begin','checkpoint-write','checkpoint-commit','checkpoint-restore'}:return False
 meta_path,partial,ready=checkpoint_paths(command.get('sha256'))
 if action=='checkpoint-begin':
  assert command.get('operation_id')==checkpoint_operation and command.get('encoding')=='zlib+base64'
  size=command.get('bytes');compressed=command.get('compressed_bytes')
  assert isinstance(size,int) and not isinstance(size,bool) and 1<=size<=CHECKPOINT_MAX
  assert isinstance(compressed,int) and not isinstance(compressed,bool) and 1<=compressed<=CHECKPOINT_MAX+65536
  checkpoint_id(command.get('compressed_sha256'))
  meta={key:command[key] for key in ('operation_id','encoding','bytes','sha256','compressed_bytes','compressed_sha256')}
  encoded=json.dumps(meta,sort_keys=True,separators=(',',':')).encode()
  if meta_path.exists():
   assert not meta_path.is_symlink() and meta_path.read_bytes()==encoded,'Original checkpoint selection differs'
  else:atomic(meta_path,encoded)
  reply({'checkpointReceiving':meta});return True
 assert meta_path.is_file() and not meta_path.is_symlink(),'Receive the original checkpoint selection first'
 meta=json.loads(meta_path.read_text())
 if action=='checkpoint-write':
  data=base64.b64decode(command.get('data_base64',''),validate=True)
  assert base64.b64encode(data).decode()==command['data_base64'] and len(data)<=32768
  offset=command.get('offset')
  assert isinstance(offset,int) and not isinstance(offset,bool) and offset>=0 and offset+len(data)<=meta['compressed_bytes']
  fd=os.open(partial,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
  try:
   current=os.fstat(fd);assert stat.S_ISREG(current.st_mode)
   if offset<current.st_size:
    assert offset+len(data)<=current.st_size and os.pread(fd,len(data),offset)==data,'Retained checkpoint bytes differ'
   else:
    assert offset==current.st_size,'Checkpoint offset differs'
    os.lseek(fd,offset,os.SEEK_SET)
    with os.fdopen(os.dup(fd),'wb') as out:out.write(data);out.flush();os.fsync(out.fileno())
   size=os.fstat(fd).st_size
  finally:os.close(fd)
  reply({'checkpointWritten':meta['sha256'],'offset':offset,'bytes':size});return True
 if action=='checkpoint-commit':
  assert command.get('compressed_sha256')==meta['compressed_sha256']
  assert partial.is_file() and not partial.is_symlink() and partial.stat().st_size==meta['compressed_bytes']
  compressed=partial.read_bytes()
  assert hashlib.sha256(compressed).hexdigest()==meta['compressed_sha256'],'Compressed checkpoint identity differs'
  decoder=zlib.decompressobj()
  data=decoder.decompress(compressed,CHECKPOINT_MAX+1)
  assert decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail
  assert len(data)==meta['bytes'] and hashlib.sha256(data).hexdigest()==meta['sha256'],'Original checkpoint digest differs'
  packet=json.loads(data)
  assert packet['schema']=='stellar-forge.wordpress-native-control-checkpoint.v1'
  assert packet['operation_id']==checkpoint_operation
  if ready.exists():
   assert not ready.is_symlink() and ready.read_bytes()==data,'Committed checkpoint differs'
  else:atomic(ready,data)
  reply({'checkpointCommitted':str(ready),'bytes':len(data),'sha256':meta['sha256'],
         'originalRequestSha256':packet['request_sha256'],'originalFailureSha256':packet['native_failure_sha256']})
  return True
 assert ready.is_file() and not ready.is_symlink() and hashlib.sha256(ready.read_bytes()).hexdigest()==meta['sha256']
 assert all((root/name).is_file() and not (root/name).is_symlink() for name in allowed)
 assert (root/'HOST_CLOSURE.json').is_file() and (root/'SOURCE_CLOSURE.json').is_file()
 process=subprocess.Popen([sys.executable,'-B',str(root/'launch.py'),'--restore-checkpoint',str(ready),
                           '--sha256',meta['sha256']],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 for message in process.stdout:reply({'checkpointRestore':message.rstrip()})
 reply({'checkpointRestoreExit':process.wait(),'sha256':meta['sha256']})
 return True


prior=pathlib.Path('/dev/shm/83dd-wordpress-source-prep/input.json')
if prior.is_file() and not prior.is_symlink():
 try:
  raw=json.dumps(json.loads(prior.read_text()),ensure_ascii=True,separators=(',',':')).encode()
  if hashlib.sha256(raw).hexdigest()=='f23675c786d761fde0d2afdb0aea6121dd77c166f061e51067d8bca3895d3e42':
   existing=root/'input.json'
   if existing.exists():assert existing.read_bytes()==raw,'Retained source metadata differs'
   else:atomic(existing,raw)
 except (OSError,ValueError):pass

reply({'ready':True,'root':str(root),'source':str(source),'pid':os.getpid(),'files':status(),
 'capacity':[{'path':p,'available':os.statvfs(p).f_bavail*os.statvfs(p).f_frsize,'free':os.statvfs(p).f_bfree*os.statvfs(p).f_frsize} for p in ['/dev','/dev/shm','/workspace/scratch/83dd50f1866b']]})
for line in sys.stdin.buffer:
 try:
  command=json.loads(line);assert isinstance(command,dict);action=command.get('action')
  if checkpoint_command(command):continue
  if action=='status':reply({'files':status()});continue
  if action=='write':
   name=command['name'];assert name in allowed
   b=command['data'].encode();offset=command['offset'];p=root/(name+'.partial')
   assert isinstance(offset,int) and offset>=0 and len(b)<=100000
   fd=os.open(p,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
   try:
    size=os.fstat(fd).st_size
    if offset<size:
     assert offset+len(b)<=size
     assert os.pread(fd,len(b),offset)==b,'Retained input differs'
    else:
     assert offset==size,'Input offset differs'
     os.lseek(fd,offset,os.SEEK_SET)
     with os.fdopen(os.dup(fd),'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
    size=os.fstat(fd).st_size
   finally:os.close(fd)
   reply({'written':name,'bytes':size,'offset':offset,'chunk':len(b)});continue
  if action=='commit':
   name=command['name'];assert name in allowed;p=root/(name+'.partial')
   b=p.read_bytes();assert len(b)==command['bytes']
   if command.get('sha256') is not None:assert hashlib.sha256(b).hexdigest()==command['sha256'],'Original input digest differs'
   if name.endswith('.py'):ast.parse(b,filename=name)
   if name=='input.json':
    value=json.loads(b);assert value['sourceRef']=='f167c3e524b782ceb6dd196df81f6b97886442a9'
    assert value['commissioningRef']=='4c62463acfae23b50fb3327d7eafeb087e8b4806'
   existing=root/name
   if existing.exists():assert existing.read_bytes()==b,'Completed input differs';p.unlink()
   else:os.replace(p,existing)
   reply({'committed':name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()});continue
  if action=='prepare':
   process=subprocess.Popen([sys.executable,'-B',str(root/'prepare.py')],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
   for message in process.stdout:reply({'preparation':message.rstrip()})
   reply({'preparationExit':process.wait()});continue
  if action=='missing':
   report=json.loads((root/'SOURCE_CLOSURE.json').read_text());items=list(report['missing'].items())
   offset=command.get('offset',0);limit=command.get('limit',100)
   assert isinstance(offset,int) and isinstance(limit,int) and 1<=limit<=100
   reply({'selected':len(report['files']),'bytes':report['bytes'],'missingCount':len(items),
    'missing':dict(items[offset:offset+limit]),'next':offset+limit if offset+limit<len(items) else None});continue
  if action=='source':
   name=command['path'];inputs=json.loads((root/'input.json').read_text())
   expected=inputs.get('overlayBlobs',{}).get(name,inputs['files'].get(name,{}).get('sha'))
   assert expected and name.startswith('stellar/scf-starforge-20261009/') and '..' not in pathlib.PurePosixPath(name).parts
   b=command['data'].encode();actual=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
   assert actual==expected,(name,actual,expected)
   atomic(source/name,b,0o644);reply({'source':name,'blob':actual,'bytes':len(b)});continue
  if action=='launch':
   assert all((root/name).is_file() for name in allowed),'Complete the original five-input selection'
   assert (root/'HOST_CLOSURE.json').is_file(),'Complete the original native host composition'
   reply({'launching':str(root/'launch.py')})
   os.execv(sys.executable,[sys.executable,'-B',str(root/'launch.py')])
  if action=='finish':reply({'closed':True});break
  raise ValueError('Unknown receiving action')
 except Exception as error:reply({'error':type(error).__name__,'message':str(error)[:3000]})
