# MIT. Sequential caller of the original build, installer and customer operations.
# Closed phases use the maintained native checkpoint store before advancing.
from pathlib import Path
import gzip,hashlib,json,os,shutil,stat,subprocess,sys,tarfile,tempfile,traceback

intent_path=Path(sys.argv[1]).resolve(strict=True)
intent=json.loads(intent_path.read_text())
root=Path(intent['project']).resolve(strict=True)
if not intent_path.is_relative_to(root):
 raise RuntimeError('The original intent must remain in its selected project')
results=root/'results';results.mkdir(exist_ok=True,mode=0o700)
payloads=root/'checkpoint-inputs';payloads.mkdir(exist_ok=True,mode=0o700)
phase_source=root/'phase.mjs'
env=dict(os.environ);env['TMPDIR']=str(root/'temporary');env['PYTHONDONTWRITEBYTECODE']='1'
env['PATH']=str(Path(intent['node']).parent)+os.pathsep+env.get('PATH','')
Path(env['TMPDIR']).mkdir(exist_ok=True,mode=0o700)
host=Path(os.environ['SWARM_NATIVE_HOST_ROOT']).resolve(strict=True)
record=Path(os.environ['SWARM_NATIVE_RECORD']).resolve(strict=True)
if os.environ['SWARM_NATIVE_OPERATION_ID']!=intent['operationId']:
 raise RuntimeError('The checkpoint must use this original native operation')
sys.path.insert(0,str(host))
import swarm_cloud_job as native
import native_artifact_checkpoints as checkpoints
if (getattr(native,'NATIVE_ARTIFACT_CHECKPOINT_SCHEMA',None)!=checkpoints.SCHEMA or
    checkpoints.SCHEMA!='commons.native-artifact-checkpoint/v1' or
    Path(checkpoints.__file__).resolve().parent!=host or
    Path(native.__file__).resolve().parent!=host):
 raise RuntimeError('Install the complete maintained native checkpoint runtime')

def emit(value):
 print(json.dumps(value),flush=True)

def sync_directory(path):
 descriptor=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(descriptor)
 finally:os.close(descriptor)

def save(name,value):
 path=results/name
 descriptor,temporary=tempfile.mkstemp(prefix='.'+path.name+'-',dir=path.parent)
 try:
  with os.fdopen(descriptor,'w') as stream:
   stream.write(json.dumps(value,indent=2)+'\n')
   stream.flush();os.fsync(stream.fileno())
  os.replace(temporary,path)
  sync_directory(path.parent)
 finally:
  try:os.unlink(temporary)
  except FileNotFoundError:pass

def digest(path):
 with Path(path).open('rb') as stream:
  return hashlib.file_digest(stream,'sha256').hexdigest()

def call(phase):
 emit({'stage':phase,'event':'START'})
 subprocess.run([intent['node'],str(phase_source),phase,str(intent_path)],check=True,env=env,cwd=root)
 emit({'stage':phase,'event':'COMPLETE'})

def copy_package(source,dest,name,version):
 data=json.loads((source/'package.json').read_text())
 if data.get('name')!=name or data.get('version')!=version:
  raise RuntimeError('Original dependency identity differs: '+name)
 if dest.exists():
  old=json.loads((dest/'package.json').read_text())
  if old.get('name')==name and old.get('version')==version:return
  shutil.rmtree(dest)
 dest.parent.mkdir(parents=True,exist_ok=True)
 shutil.copytree(source,dest,symlinks=True)

def seed():
 runtime=Path(intent['runtimeDirectory']);marker=results/'dependency-source.json'
 if marker.exists():return
 modules=runtime/'node_modules'
 shutil.copytree('/dev/shm/b028-mcp-runtime/node_modules',modules,symlinks=True,dirs_exist_ok=True)
 copy_package(Path('/dev/shm/commons-8f43-freighter/node_modules/@stellar/freighter-api'),
  modules/'@stellar/freighter-api','@stellar/freighter-api','6.0.1')
 copy_package(Path('/dev/shm/commons-8f43-wallet-customer/semver-7.7.1-source/package'),
  modules/'semver','semver','7.7.1')
 for path,sha in [
  ('/dev/shm/commons-8f43-wallet-customer/freighter-api-6.0.1.tgz','899db94dd54b3c05ee62f5c448a62d1a8637c90a0166eba9c52b18a8834c541a'),
  ('/dev/shm/commons-8f43-wallet-customer/semver-7.7.1-source/semver-7.7.1.tgz','0f1bba66dfcd37f52c62a33a5124e2f2f71c96dbc80207b830ffcbc8cd5b5de5')]:
  if digest(path)!=sha:raise RuntimeError('Original dependency archive differs')
  shutil.copyfile(path,results/Path(path).name)
 lock=Path('/dev/shm/b028-mcp-runtime/node_modules/.package-lock.json')
 save('dependency-source.json',{'nativeDonor':'/dev/shm/b028-mcp-runtime/node_modules',
  'hiddenLockSha256':digest(lock),'freighter':'6.0.1','semver':'7.7.1',
  'method':'Private copy of the complete actual dependency tree; original npm creates the selected installation lock'})

def collect(complete=False):
 runtime=Path(intent['runtimeDirectory'])
 for name in ('runtime-profile.json','runtime-install.json','install-state.json','package-lock.json'):
  path=runtime/name
  if path.is_file():shutil.copyfile(path,results/name)
 path=runtime/'package/manifest.json'
 if path.is_file():shutil.copyfile(path,results/'package-manifest.json')
 for path in runtime.glob('install-*.log'):
  shutil.copyfile(path,results/path.name)
 for dirname in ('feed-reception','wallet-reception'):
  folder=root/dirname
  if folder.exists():
   for path in folder.iterdir():
    if path.is_file() and (path.suffix=='.png' or path.name.endswith('-reception.json')):
     shutil.copyfile(path,results/path.name)
 if complete:
  destination=Path('/dev/shm/commons-8f43-wallet-customer/managed-applications-result')
  destination.mkdir(exist_ok=True,mode=0o700)
  for path in results.iterdir():
   if path.name.startswith('wallet-') and path.is_file():
    shutil.copyfile(path,destination/path.name)

def closed_directory(path):
 path=Path(path)
 if path.is_symlink():raise RuntimeError('The closed phase root must be its original directory')
 path=path.resolve(strict=True)
 if path==root or not path.is_relative_to(root) or not path.is_dir():
  raise RuntimeError('Archive the selected closed directory beneath this original project')
 return path

def archive_tree(path,name):
 source=closed_directory(path);selected=source.relative_to(root).as_posix()
 destination=payloads/name
 descriptor,temporary=tempfile.mkstemp(prefix='.'+name+'-',dir=payloads)
 usage={'files':0,'directories':0,'symlinks':0,'logicalBytes':0,'allocatedFileBytes':0}
 seen=set()
 def account(member):
  current=root/member.name
  info=current.lstat()
  if stat.S_ISDIR(info.st_mode):usage['directories']+=1
  elif stat.S_ISLNK(info.st_mode):usage['symlinks']+=1
  elif stat.S_ISREG(info.st_mode):
   usage['files']+=1
   identity=(info.st_dev,info.st_ino)
   if identity not in seen:
    seen.add(identity)
    usage['logicalBytes']+=info.st_size
    usage['allocatedFileBytes']+=info.st_blocks*512
  else:raise RuntimeError('The closed phase contains a special file: '+member.name)
  return member
 try:
  with os.fdopen(descriptor,'wb') as raw:
   with gzip.GzipFile(filename='',mode='wb',fileobj=raw,compresslevel=6,mtime=0) as compressed:
    with tarfile.open(mode='w',fileobj=compressed,dereference=False) as archive:
     archive.add(source,arcname=selected,filter=account)
   raw.flush();os.fsync(raw.fileno())
  os.replace(temporary,destination);sync_directory(payloads)
 finally:
  try:os.unlink(temporary)
  except FileNotFoundError:pass
 measured={'path':destination.relative_to(root).as_posix(),'sourceDirectory':str(source),
  'archiveRoot':selected,'bytes':destination.stat().st_size,'sha256':digest(destination),
  'source':usage,'symlinks':'Preserved without dereferencing; restore into the same original project placement'}
 save(name+'.json',measured)
 return destination

retained_objects={}
completed_phases=[]
def checkpoint(phase,label,archives=()):
 # The native manifest owns immutable copies. Only closed, ordinary output files
 # are selected here; complete runtime/Applications trees are carried as tar files.
 selected=[intent_path.relative_to(root).as_posix(),'run-customers.py','phase.mjs',
           'receiving-source','results']
 selected.extend(path.relative_to(root).as_posix() for path in archives)
 emit({'stage':phase,'event':'CHECKPOINT_START'})
 saved=checkpoints.capture(record,phase,selected,label=label)
 if saved['state']!='complete':
  save('checkpoint-'+phase+'.json',saved)
  raise RuntimeError('Original phase checkpoint is incomplete: '+json.dumps(saved['errors']))
 # Keep the exact native result, while its original manifest remains in the record.
 save('checkpoint-'+phase+'.json',saved)
 for item in saved['files']:
  retained_objects[item['retained_path']]=item['bytes']
 measured={'checkpointId':saved['checkpoint_id'],'snapshot':saved['snapshot'],
  'state':saved['state'],'completedAt':saved['completed_at'],
  'files':len(saved['files']),'phaseBytes':sum(item['bytes'] for item in saved['files']),
  'uniqueRetainedBytes':sum(retained_objects.values()),
  'uniqueRetainedFileAllocatedBytes':sum((record/path).stat().st_blocks*512 for path in retained_objects),
  'record':str(record)}
 completed_phases.append(measured)
 save('checkpoint-progress.json',{'schema':checkpoints.SCHEMA,'operationId':intent['operationId'],
  'sourceCommit':intent['sourceCommit'],'phases':completed_phases,
  'finalArtifacts':[intent_path.relative_to(root).as_posix(),'results'],
  'archiveStorage':'Original checkpoint-files only; private phase archives removed after complete capture'})
 emit({'stage':phase,'event':'CHECKPOINT_COMPLETE',**measured})
 for path in archives:
  item=next(row for row in saved['files'] if row['path']==path.relative_to(root).as_posix())
  if path.stat().st_size!=item['bytes'] or digest(path)!=item['sha256']:
   raise RuntimeError('The private completed archive changed before its release')
  path.unlink()
 if archives:sync_directory(payloads)
 return saved

def retain_source():
 built=json.loads((results/'build.json').read_text())
 if built['sourceCommit']!=intent['sourceCommit']:
  raise RuntimeError('The completed source package differs from this original operation')
 source=results/'source.tgz';destination=payloads/'source.tgz'
 if source.exists():
  if destination.exists():raise RuntimeError('A different private source checkpoint input already exists')
  os.replace(source,destination);sync_directory(results);sync_directory(payloads)
 if not destination.is_file() or digest(destination)!=built['sha256']:
  raise RuntimeError('The source checkpoint must carry the completed original package')
 if destination.stat().st_size!=built['archiveBytes']:
  raise RuntimeError('The source package byte count changed')
 save('source-checkpoint.json',{'path':destination.relative_to(root).as_posix(),
  'bytes':destination.stat().st_size,'sha256':built['sha256'],'sourceCommit':built['sourceCommit'],
  'originalBuildArchive':built['archive']})
 return checkpoint('source-build-001','Original source package complete',[destination])

def retire_build(source_checkpoint,prepared_checkpoint):
 # prepareRuntimeInstall copied and verified its own installed/source.tgz. Only
 # this operation's completed release materialization can now be removed.
 if source_checkpoint['state']!='complete' or prepared_checkpoint['state']!='complete':
  raise RuntimeError('Retain source and prepared installation metadata before releasing build materialization')
 runtime=closed_directory(intent['runtimeDirectory'])
 plan=json.loads((runtime/'runtime-install.json').read_text())
 built=json.loads((results/'build.json').read_text())
 archive=runtime/'source.tgz'
 if (Path(plan['archivePath'])!=archive or plan['archiveSha256']!=built['sha256'] or
     digest(archive)!=built['sha256']):
  raise RuntimeError('Original prepared runtime must retain its exact source archive')
 release=root/'release'
 if not release.exists():return
 selected=closed_directory(release)
 if not Path(built['archive']).resolve(strict=True).is_relative_to(selected):
  raise RuntimeError('Only this original build output may be released')
 shutil.rmtree(selected);sync_directory(root)
 save('build-materialization-release.json',{'directory':str(selected),
  'sourceCheckpoint':source_checkpoint['snapshot'],'preparedCheckpoint':prepared_checkpoint['snapshot'],
  'retainedInstallationArchive':str(archive),'sha256':built['sha256']})

def applications_workspace():
 received=json.loads((results/'feed-managed-reception.json').read_text())
 return closed_directory(received['selection']['applicationWorkspace'])

complete=False
failed=False
try:
 if not (results/'build.json').exists():call('build')
 source_checkpoint=retain_source()
 if not (Path(intent['runtimeDirectory'])/'runtime-install.json').exists():call('prepare')
 collect()
 prepared_checkpoint=checkpoint('prepared-installation-001','Original installation prepared')
 retire_build(source_checkpoint,prepared_checkpoint)
 seed()
 call('install')
 collect()
 ready_archive=archive_tree(intent['runtimeDirectory'],'ready-runtime.tgz')
 checkpoint('ready-installation-001','Complete original READY runtime',[ready_archive])
 call('feeds')
 collect()
 feed_archive=archive_tree(applications_workspace(),'applications-after-feeds.tgz')
 checkpoint('feed-applications-001','Original feed Applications closed and reopened',[feed_archive])
 call('wallet')
 collect()
 wallet_archive=archive_tree(applications_workspace(),'applications-after-wallet.tgz')
 checkpoint('wallet-applications-001','Original wallet browser and Applications closed and reopened',[wallet_archive])
 collect(True)
 final_checkpoint=checkpoint('customer-completion-001','Original managed customer outputs retained')
 save('outcome.json',{'status':'COMPLETED','operationId':intent['operationId'],'sourceCommit':intent['sourceCommit'],
  'originalFeedOperation':'SCF-RSS-ATOM-APPLICATIONS-8F43-20261012',
  'originalWalletOperation':'SCF-BROWSER-WALLET-8F43-20261012',
  'completionCheckpoint':final_checkpoint['snapshot']})
 complete=True
except Exception as error:
 failed=True
 try:
  save('operation-error.json',{'error':type(error).__name__,'message':str(error),'traceback':traceback.format_exc()})
 except Exception as retention_error:
  emit({'event':'ERROR_RECORD_FAILED','error':type(retention_error).__name__,'message':str(retention_error)})
 raise
finally:
 if not complete:
  try:collect()
  except Exception as collect_error:
   if failed:
    emit({'event':'FINAL_COLLECTION_FAILED','error':type(collect_error).__name__,'message':str(collect_error)})
   else:raise
