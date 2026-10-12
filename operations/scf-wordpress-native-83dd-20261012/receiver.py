import ast,hashlib,json,os,pathlib,subprocess,sys,tempfile,termios,tty
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
  command=json.loads(line);action=command.get('action')
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
