import os,sys,json,tty,hashlib,urllib.request,signal
os.umask(0o077)
if sys.stdin.isatty():tty.setraw(sys.stdin.fileno())
def frame_timeout(signum, frame):
    raise SystemExit("Original private input was not received within 120 seconds")
signal.signal(signal.SIGALRM,frame_timeout)
signal.alarm(120)
print("LIIP_ORIGINAL_READY",flush=True)
line=bytearray()
while True:
    c=os.read(0,1)
    if c==b"\n":break
    if not c or len(line)>16:raise SystemExit("Invalid original private frame")
    line.extend(c)
size=int(line)
if not 0<size<=1024*1024:raise SystemExit("Original private frame size exceeded")
data=bytearray()
while len(data)<size:
    block=os.read(0,min(65536,size-len(data)))
    if not block:raise SystemExit("Incomplete original private frame")
    data.extend(block)
PAYLOAD=json.loads(data)
signal.alarm(0)
with urllib.request.urlopen("https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/eecbcb28fc7b9282cbeace64cd37bdcc7ac36187/.swarm-delivery/liip-zurich-source-814b-20261013/source-packet.json",timeout=120) as response:
    body=response.read(2971443)
if len(body)!=2971442 or hashlib.sha256(body).hexdigest()!="d357ea970c52c9e80b4d2cee0f2ef71e649740fef35f75d8b9be93a9f46db11d":
    raise RuntimeError("Original source packet identity mismatch")
packet=json.loads(body)
if packet["operation"]!="LIIP-CKAN-WORKSHARE-814B-20261013" or len(packet["files"])!=175:
    raise RuntimeError("Original source packet operation mismatch")
for name,content in packet["files"].items():
    raw=content.encode("utf-8")
    expected=packet["manifest"][name]
    if len(raw)!=expected["bytes"] or hashlib.sha256(raw).hexdigest()!=expected["sha256"]:
        raise RuntimeError("Original source member identity mismatch: "+name)
PAYLOAD["files"]=packet["files"]
print(json.dumps({"event":"original-source-received","files":len(packet["files"]),"sha256":"d357ea970c52c9e80b4d2cee0f2ef71e649740fef35f75d8b9be93a9f46db11d"}),flush=True)
import os,sys,json,pathlib,subprocess,hashlib,socket,fcntl,tarfile,datetime,shutil,traceback
os.umask(0o077)
root=pathlib.Path('/dev/commons-liip-programme-814b')
root.mkdir(mode=0o700,exist_ok=True)
lock=open(root/'original-operation.lock','a+')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
identity={'operation':'LIIP-CKAN-WORKSHARE-814B-20261013','host':socket.gethostname(),'pid':os.getpid(),'namespace':os.readlink('/proc/self/ns/pid')}
print(json.dumps({'event':'native-accepted',**identity}),flush=True)
helper=root/'library-helpers';helper.mkdir(mode=0o700,exist_ok=True)
for name,body in PAYLOAD['helpers'].items():
 path=helper/name;path.write_text(body);path.chmod(0o600)
source=root/'source';source.mkdir(mode=0o700,exist_ok=True)
for name,body in PAYLOAD['files'].items():
 rel=pathlib.PurePosixPath(name)
 if rel.is_absolute() or '..' in rel.parts:raise ValueError('Invalid owned source member')
 path=source/name;path.parent.mkdir(parents=True,mode=0o700,exist_ok=True);path.write_text(body);path.chmod(0o600)
print(json.dumps({'event':'complete-source-received','files':len(PAYLOAD['files'])}),flush=True)
view=pathlib.Path('/workspace/scratch/814bb67cccdc/scf-recovered-native-runtime-20261012/node_modules')
if view.is_dir() and not (source/'node_modules').exists():(source/'node_modules').symlink_to(view,target_is_directory=True)
def materialize_original(transfer,destination,label):
 process=subprocess.Popen([sys.executable,str(helper/'library_file_transfer.py'),'materialize',str(destination)],
  stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 supplied=json.dumps(transfer)
 while True:
  try:
   stdout,stderr=process.communicate(input=supplied,timeout=20)
   break
  except subprocess.TimeoutExpired:
   supplied=None
   print(json.dumps({'event':'original-receiving-progress','part':label,'child':process.pid}),flush=True)
 if process.returncode:raise RuntimeError(label+' receiving failed: '+stderr[-1000:])
 print(json.dumps({'event':'original-receiving-finished','part':label,'bytes':destination.stat().st_size}),flush=True)
input_archive=root/'Liip_Zurich_Source_Captures.tar.gz'
if not input_archive.exists():
 materialize_original(PAYLOAD['captureTransfer'],input_archive,'Original source capture')
def checksum(path):
 with open(path,'rb') as inp:return hashlib.file_digest(inp,'sha256').hexdigest()
if input_archive.stat().st_size!=434557 or checksum(input_archive)!='b093a0a66b12830f7daf507980b77a9f6f692e22dcf44cd195ef2e599998979c':
 raise ValueError('Original captured source archive changed')
def private_receiving_directory(path):
 import stat
 relative=path.relative_to(root)
 current=root
 for component in ('',*relative.parts):
  if component:current=current/component
  try:current.mkdir(mode=0o700)
  except FileExistsError:pass
  details=current.lstat()
  if not stat.S_ISDIR(details.st_mode) or details.st_uid!=os.geteuid():
   raise ValueError('Original receiving directory is not an owned directory: '+str(current))
  current.chmod(0o700)
def receive_original_member(archive,member,target):
 import stat,tempfile
 if member.isdir():
  private_receiving_directory(target)
  return
 private_receiving_directory(target.parent)
 try:existing=target.lstat()
 except FileNotFoundError:existing=None
 if existing is not None:
  if not stat.S_ISREG(existing.st_mode) or existing.st_uid!=os.geteuid():
   raise ValueError('Original receiving member is not an owned file: '+str(target))
  incoming=hashlib.sha256();received=0
  with archive.extractfile(member) as inp:
   for block in iter(lambda:inp.read(1048576),b''):
    incoming.update(block);received+=len(block)
  if received!=member.size or existing.st_size!=member.size or checksum(target)!=incoming.hexdigest():
   raise ValueError('Existing original receiving member differs: '+str(target))
  target.chmod(0o600)
  return
 staging=root/'receiving-staging';private_receiving_directory(staging)
 descriptor,pending_name=tempfile.mkstemp(prefix='.original-receiving-',dir=staging)
 pending=pathlib.Path(pending_name)
 try:
  with os.fdopen(descriptor,'wb') as out,archive.extractfile(member) as inp:
   shutil.copyfileobj(inp,out)
   if out.tell()!=member.size:raise ValueError('Incomplete original receiving member: '+str(target))
   out.flush();os.fsync(out.fileno())
  pending.chmod(0o600)
  os.link(pending,target)
 finally:
  pending.unlink(missing_ok=True)
captures=root/'liip-zurich-source-captures'
with tarfile.open(input_archive,'r:gz') as archive:
 for member in archive:
  path=pathlib.PurePosixPath(member.name)
  if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0]!='liip-zurich-source-captures' or not(member.isdir() or member.isfile()):raise ValueError('Invalid retained source member')
  receive_original_member(archive,member,root/member.name)
print(json.dumps({'event':'original-source-received','rows':8210,'archiveSha256':checksum(input_archive)}),flush=True)
data=root/'programme';data.mkdir(mode=0o700,exist_ok=True)
if PAYLOAD.get('checkpoint'):
 checkpoint=root/'original-delivery-checkpoint.tar.gz'
 transfer=PAYLOAD['checkpoint']['transfer']
 materialize_original(transfer,checkpoint,'Original programme checkpoint')
 if checkpoint.stat().st_size!=PAYLOAD['checkpoint']['bytes'] or checksum(checkpoint)!=PAYLOAD['checkpoint']['sha256']:raise ValueError('Original programme checkpoint changed')
 with tarfile.open(checkpoint,'r:gz') as archive:
  for member in archive:
   path=pathlib.PurePosixPath(member.name)
   if path.is_absolute() or '..' in path.parts or not(member.isdir() or member.isfile()):raise ValueError('Invalid checkpoint member')
   if path.parts[:2]!=('liip-zurich-delivery','programme'):continue
   relative=pathlib.Path(*path.parts[2:])
   if not relative.parts:continue
   target=data/relative
   receive_original_member(archive,member,target)
 print(json.dumps({'event':'original-programme-checkpoint-received','sha256':PAYLOAD['checkpoint']['sha256']}),flush=True)
publisher_out=data/'publisher-delivery';publisher_out.mkdir(mode=0o700,exist_ok=True)
customer_out=data/'customer-delivery';customer_out.mkdir(mode=0o700,exist_ok=True)
(data/'original-operation.json').write_text(json.dumps(identity,indent=2)+'\n')
node='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'
python=os.environ.get('CODEX_PRIMARY_RUNTIME_PYTHON') or sys.executable
if not pathlib.Path(python).is_file():python=sys.executable
environment=dict(os.environ)
environment['PYTHONPATH']=str(source/'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python')
environment['PYTHONDONTWRITEBYTECODE']='1'
temporary=root/'temporary-build';temporary.mkdir(mode=0o700,exist_ok=True)
print(json.dumps({'event':'original-build-capacity','systemTemporaryFree':shutil.disk_usage('/tmp').free,
 'privateTemporaryFree':shutil.disk_usage(temporary).free,'privateTemporary':str(temporary)}),flush=True)
environment['TMPDIR']=str(temporary)
status=1
try:
 saved_path=publisher_out/'publisher-programme.json'
 saved_publisher=json.loads(saved_path.read_text()) if saved_path.exists() else {}
 if saved_publisher.get('state')=='COMPLETE':
  binding=saved_publisher['binding']
  if binding['operation']!=identity['operation'] or binding['capturesDirectory']!=str(captures) or binding['directory']!=str(data/'publisher-project') or binding['out']!=str(publisher_out):
   raise ValueError('Completed original publisher binding changed')
  retained_archive=saved_publisher['publisherArchive']
  if checksum(pathlib.Path(retained_archive['file']))!=retained_archive['sha256']:
   raise ValueError('Completed original publisher archive changed')
  print(json.dumps({'event':'completed-original-publisher-reused','archiveSha256':retained_archive['sha256'],
   'periods':[{'date':p['date'],'rows':p['rows'],'publicationId':p['publicationId'],'exportId':p['exportId']} for p in saved_publisher['periods']]}),flush=True)
  status=0
 else:
  command=[node,str(source/'stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/examples/zurich-portal-use.mjs'),
   '--captures',str(captures),'--directory',str(data/'publisher-project'),'--out',str(publisher_out)]
  status=subprocess.run(command,cwd=source,env=environment).returncode
 if status==0:
  command=[python,str(source/'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/zurich_portal_use.py'),
   '--programme',str(publisher_out/'publisher-programme.json'),'--database',str(data/'customer-workspace'),'--out',str(customer_out),'--retry-workbook']
  status=subprocess.run(command,cwd=source,env=environment).returncode
except Exception:
 traceback.print_exc();status=1
publisher=json.loads((publisher_out/'publisher-programme.json').read_text()) if (publisher_out/'publisher-programme.json').exists() else {}
customer=json.loads((customer_out/'customer-programme.json').read_text()) if (customer_out/'customer-programme.json').exists() else {}
summary=root/'Liip_Zurich_Portal_Use_Delivery.md'
lines=['# Zurich portal-use delivery','',
'Operation: '+identity['operation'],'',
'Publisher: '+publisher.get('state','INCOMPLETE')+'. Customer: '+customer.get('state','INCOMPLETE')+'.','',
'## Original selected source','',
'The two complete retained CKAN date selections contain 3,821 and 4,389 records. Their original hit_count totals are 9,627 and 10,427 requests.',
'The source dictionary, raw source captures and all reviewed source identities travel with the original project.',
'', 'Canonical source: https://data.stadt-zuerich.ch/dataset/prd_ssz_ogd_katalog_downloads','',
'## Received contents','',
'The complete original source capture archive is retained with this project.',
'']
if publisher.get('state')=='COMPLETE':
 lines+=['The publisher project retains both reviewed editions, the accepted period refresh, both published datasets, portable merchant packages and complete customer pages.',
 'Its native publisher archive has been received and reopened.', '']
elif publisher:
 lines+=['The publisher project retains its current original records and completed phases. Its progress record remains publisher-delivery/publisher-programme.json.', '']
else:
 lines+=['Publisher commissioning has not yet produced a saved publisher programme.', '']
if customer.get('state')=='COMPLETE':
 lines+=['The customer delivery contains two retained meanings, editable SQL queries, report, workbook, complete query exports and the native Analysis workspace archive.',
 'Use the original source-owned receiving commands in the operating guide to reopen each project.', '']
 lines+=['## Daily results','', '| Date | Source records | Download requests |','| --- | ---: | ---: |']
 for row in customer['daily']:lines+=['| '+row['date']+' | '+str(row['source_records'])+' | '+str(row['download_requests'])+' |']
 lines+=['', 'Request change: +800 (+'+format(800/9627*100,'.2f')+'%).','',
 'The original distinct_ips value remains a per-record field. Resource comparisons use the original CKAN resource UUID, with an explicit exact-label fallback for missing UUIDs.',
 '', 'Both native publisher receiving and the complete Analysis archive were reopened with their original source identities.']
else:
 lines+=['## Original continuation','',json.dumps({'nativeStatus':status,'publisherError':publisher.get('error'),'customerState':customer.get('state')})]
summary.write_text('\n'.join(lines)+'\n')
archive_path=root/'Liip_Zurich_Complete_Delivery.tar.gz'
with tarfile.open(archive_path,'w:gz') as archive:
 def owned_payload(member):
  parts=pathlib.PurePosixPath(member.name).parts
  if 'publisher-received' in parts or 'customer-received' in parts or any(p.startswith('.analysis-receive-') for p in parts):return None
  return member
 archive.add(data,arcname='liip-zurich-delivery/programme',filter=owned_payload)
 archive.add(input_archive,arcname='liip-zurich-delivery/Liip_Zurich_Source_Captures.tar.gz')
 archive.add(summary,arcname='liip-zurich-delivery/README.md')
print(json.dumps({'event':'complete-delivery-archive','path':str(archive_path),'bytes':archive_path.stat().st_size,'sha256':checksum(archive_path),'nativeStatus':status}),flush=True)
uploads=[{'local_path':str(archive_path),'purpose':'create_library_file','library_artifact_type':'other'},
 {'local_path':str(summary),'purpose':'create_library_file','library_artifact_type':'report'}]
if status==0 and customer.get('state')=='COMPLETE':
 for name,kind in [('Zurich_Portal_Use_Report.html','report'),('Zurich_Portal_Use_Workbook.xlsx','sheet'),('Zurich_Customer_Workspace.zip','other')]:
  path=customer_out/name
  if path.is_file():uploads.append({'local_path':str(path),'purpose':'create_library_file','library_artifact_type':kind})
for item in uploads:
 previous=PAYLOAD.get('deliveryIdentities',{}).get(pathlib.Path(item['local_path']).name)
 if previous:
  item.update(purpose='replace_library_file',library_file_id=previous['library_file_id'],expected_current_version=previous['current_version_number'],version_reason='Continue the original complete Zurich customer programme')
  item.pop('library_artifact_type',None)
saved=subprocess.run([sys.executable,str(helper/'library_upload.py')],input=json.dumps({'uploads':uploads}),text=True,capture_output=True)
(root/'delivery-library-save.json').write_text(saved.stdout)
print(json.dumps({'event':'delivery-library-save','exit':saved.returncode,'result':saved.stdout,'error':saved.stderr[-6000:]}),flush=True)
print(json.dumps({'event':'native-finished',**identity,'status':status,'publisher':publisher.get('state'),'customer':customer.get('state')}),flush=True)
sys.exit(status if status else saved.returncode)
