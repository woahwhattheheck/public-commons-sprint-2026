# MIT. Select one retained original native foreground carrier.
from pathlib import Path
from types import SimpleNamespace
import hashlib,json,os,shutil,stat,subprocess,sys,tempfile
STAGE=Path('/dev/shm/commons-8f43-managed-native')
HOST=Path('/workspace/scratch/d76c9c89fb9e/native-prepared-stop-20261012/host')
PROJECT=Path('/dev/commons-8f43-managed-db4d')
COMMIT='75dd7badd76f6cd1a3cad97866184c5a1e4922d2'
RECORDS=Path('/workspace/scratch/8f4370a17e6f/managed-native-records')
RECORDS.mkdir(parents=True,exist_ok=True,mode=0o700)
NATIVE='b93dcc336452c70124f49c62d67c0cd2385295d4d9659254936cc07cad46453e'
NODE='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'
PYTHON='/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3'
HOST_FILES=json.loads("{\"CAPACITY_FAILURE_RECOVERY.md\":{\"sha\":\"6bc76ddf50ccc595d6c76641f289dc89e2955889\",\"mode\":\"0o644\"},\"CLOUD_DISK_ADMISSION.md\":{\"sha\":\"e1f950922da1bbc54b05e768c377ea0a480c319a\",\"mode\":\"0o644\"},\"CLOUD_MEMORY_ADMISSION.md\":{\"sha\":\"c63f80c2b44d41c0845c13c0398fd79c1106b28a\",\"mode\":\"0o644\"},\"NATIVE_ARTIFACT_RETENTION.md\":{\"sha\":\"9cff9f35b3536115a1c88d2e62fce262ad48e0da\",\"mode\":\"0o644\"},\"NATIVE_ARTIFACT_SELECTION.md\":{\"sha\":\"b866a7280161e9b7c61fdd8f855e5c7ece5cf861\",\"mode\":\"0o644\"},\"NATIVE_COMPLETION.md\":{\"sha\":\"9b90a9227b7c6e0341ae1f3333636dc279a18c95\",\"mode\":\"0o644\"},\"NATIVE_FOREGROUND.md\":{\"sha\":\"be17574423b695fdd2f07197b859ca6fd694f627\",\"mode\":\"0o644\"},\"NATIVE_PLACEMENT.md\":{\"sha\":\"56bcca2503b629139a1556682313713ade342e55\",\"mode\":\"0o644\"},\"NATIVE_QUEUE_HISTORY.md\":{\"sha\":\"4fb4aab30c96092c28dd1fe92433e0aa12fe566e\",\"mode\":\"0o644\"},\"NATIVE_RECORD_RELOCATION.md\":{\"sha\":\"ba0d9aad92841dab083f3606aefbee0ea7b9e541\",\"mode\":\"0o644\"},\"RUNTIME_CONSUMERS.md\":{\"sha\":\"06103367a13b181478c0a9413fa13427b2bba85b\",\"mode\":\"0o644\"},\"RUNTIME_DECLARATIONS.md\":{\"sha\":\"c6b089432cb50031068c04be05bdb1921b868009\",\"mode\":\"0o644\"},\"SOURCE_REUSE.md\":{\"sha\":\"495367d5e892509d872f2abcb4edee7616f59adb\",\"mode\":\"0o644\"},\"SWARM_CLOUD_BROWSER.md\":{\"sha\":\"4ff018a68da5b69b2a4d2bc6246ea31cfa0a7865\",\"mode\":\"0o644\"},\"SWARM_CLOUD_CACHE.md\":{\"sha\":\"96db065c3ce0076a95f0e95fcdfaab3148669f38\",\"mode\":\"0o644\"},\"SWARM_CLOUD_ENVIRONMENT.md\":{\"sha\":\"07b6c88cedfe531e2df9430f51fabbcb755b67da\",\"mode\":\"0o644\"},\"WORKER_CAPACITY.md\":{\"sha\":\"9957caf81a7de40e5f46215bd063fdbeaa92b8e2\",\"mode\":\"0o644\"},\"capacity_fairness.py\":{\"sha\":\"3af54bf8637d76646a52e9bbc148814f96403505\",\"mode\":\"0o644\"},\"capacity_recovery.py\":{\"sha\":\"c789218ee10a8152b2f37513f1773fc1873aaf18\",\"mode\":\"0o644\"},\"cloud_cache_workspace.py\":{\"sha\":\"59e0afb5f85c7066f69476734e4a0eb6b60692d4\",\"mode\":\"0o644\"},\"cloud_disk.py\":{\"sha\":\"00954b2cfb49cfd8cf32285e09f6b5475a8e2ad8\",\"mode\":\"0o644\"},\"cloud_job_sources.py\":{\"sha\":\"be62bec9fa03f801ca13ae7dde0276c9ec99d858\",\"mode\":\"0o644\"},\"cloud_job_workflows.py\":{\"sha\":\"a5831ea56a8e5786901dbc838eacb667232ef9c2\",\"mode\":\"0o644\"},\"cloud_job_workspace/CACHE_OPERATIONS.md\":{\"sha\":\"6bb3fc7451112f6d8ca8079784675849af019015\",\"mode\":\"0o644\"},\"cloud_job_workspace/README.md\":{\"sha\":\"fe91c35d0a836bccbc0b140f2599a8767a8fc382\",\"mode\":\"0o644\"},\"cloud_job_workspace/app.js\":{\"sha\":\"b49a47cd52c92e9f97e3ec141d4ab507add26fcf\",\"mode\":\"0o644\"},\"cloud_job_workspace/cache.js\":{\"sha\":\"8d5b95d743f04b1d644047ca9022773d9b9ed2be\",\"mode\":\"0o644\"},\"cloud_job_workspace/index.html\":{\"sha\":\"8fcee00e86ce19a86de03252c5f0c082820ee24b\",\"mode\":\"0o644\"},\"cloud_job_workspace/style.css\":{\"sha\":\"c5cf49bf34f48b91f31907263023803df4b5e3b5\",\"mode\":\"0o644\"},\"cloud_job_workspace.py\":{\"sha\":\"95a9546cfddb7e854ffe43b5f022a2a66104ab0c\",\"mode\":\"0o644\"},\"cloud_memory.py\":{\"sha\":\"e99380609c80101be173183099c4e6a7cd22769f\",\"mode\":\"0o644\"},\"cloud_residency.py\":{\"sha\":\"60b28a472ae21d247566fe414ee115e0578598f7\",\"mode\":\"0o644\"},\"cloud_source_command.py\":{\"sha\":\"533bfef89138d6685f059bcc2256a380810f05ba\",\"mode\":\"0o644\"},\"cloud_source_packet.mjs\":{\"sha\":\"3ce78d882ff5b6ddb12bebd61d5916e0a86d78e2\",\"mode\":\"0o644\"},\"connected_github_source.py\":{\"sha\":\"2f9dfde150cb6c3cbe8b5f8b385b8b4921eb96b3\",\"mode\":\"0o755\"},\"connected_github_source_reuse.py\":{\"sha\":\"b8938853c4d9ddf5e51b213887bd73ea85a6357e\",\"mode\":\"0o644\"},\"heavy_dispatch.py\":{\"sha\":\"a35553e86028a79dfaa1c98b41f7fb88c5917b65\",\"mode\":\"0o644\"},\"heavy_slot.py\":{\"sha\":\"0417a29faf30891130a5adc0e378bfbc9a6d0932\",\"mode\":\"0o644\"},\"native_artifact_retention.py\":{\"sha\":\"718a4e314390df666329f4f10dc260fa58757bcd\",\"mode\":\"0o644\"},\"native_artifact_selection.py\":{\"sha\":\"318eb38b9c4b6323e53e4e4a8dd227b8fdd0fee5\",\"mode\":\"0o644\"},\"native_capacity.py\":{\"sha\":\"0afbac17123d1966669fe72147aee7fd880e93fe\",\"mode\":\"0o644\"},\"native_completion.py\":{\"sha\":\"835b72f255bcd1f5b1ff649a9be5f5ff31aa6c99\",\"mode\":\"0o644\"},\"native_foreground.py\":{\"sha\":\"afb28c62e1635ab329c8c611f90184eeae03398f\",\"mode\":\"0o644\"},\"native_handoff_capacity.py\":{\"sha\":\"3249b2d779b2e0f8a0199588f0bc9c0cda1f27e8\",\"mode\":\"0o644\"},\"native_placement.py\":{\"sha\":\"d90ec7fa6e270fd718a3ee676388847540306eb3\",\"mode\":\"0o644\"},\"native_placement_files.py\":{\"sha\":\"3b0bb442d4d075f2b669ed127634c0232d2c9bba\",\"mode\":\"0o644\"},\"native_reservation.py\":{\"sha\":\"5a3eb43c035827d951998a60683e9b371f5c2041\",\"mode\":\"0o644\"},\"native_result_view.py\":{\"sha\":\"b9a52b40e2a32da20f1ff3fd704acfd73f375177\",\"mode\":\"0o644\"},\"native_runtime_handoff.py\":{\"sha\":\"16373eb1e3160352ade64042ebae5e9c679fc4cb\",\"mode\":\"0o644\"},\"node_dependency_borrow.py\":{\"sha\":\"2f64b8b97a2ce8afb90d30a708ec47d6f999f88c\",\"mode\":\"0o644\"},\"node_lockfile_cache.py\":{\"sha\":\"661566492bb0ae8e44b40b349187c3036b23451e\",\"mode\":\"0o644\"},\"node_package_cache.py\":{\"sha\":\"20b224d96f453de5b7de71c2cb386a3871005a9e\",\"mode\":\"0o644\"},\"offload_build.py\":{\"sha\":\"7ae4b9b51858b8e47c6e5655fd7083cec529ff72\",\"mode\":\"0o644\"},\"run_bounded.py\":{\"sha\":\"05819dc9379cfc2a12c3db2378a5cc2b625ca85b\",\"mode\":\"0o644\"},\"runtime_catalog.py\":{\"sha\":\"dd9b963c1a10d1db2b79d0df4db6766c2a06034f\",\"mode\":\"0o644\"},\"runtime_consumers.py\":{\"sha\":\"6dc59325617ee88728fcad276d25d2abf6301a95\",\"mode\":\"0o644\"},\"runtime_declarations.py\":{\"sha\":\"718c2f35821f0fac28c0d9c661a1d441b834baba\",\"mode\":\"0o644\"},\"runtime_source.py\":{\"sha\":\"2f499158af7971304843bb58bd2136fc4540d9c3\",\"mode\":\"0o644\"},\"swarm_cloud_browser.mjs\":{\"sha\":\"1fe3ccf9efd78d614af21e4d538e7c0bb43d2933\",\"mode\":\"0o644\"},\"swarm_cloud_browser.py\":{\"sha\":\"327494cd43a8bd6790a6a93f960e4ac3c0261cbb\",\"mode\":\"0o755\"},\"swarm_cloud_cache.py\":{\"sha\":\"b84af64cbccda3967003e47d8efdf23f634cebe3\",\"mode\":\"0o644\"},\"swarm_cloud_dependencies.py\":{\"sha\":\"cab4cdf4b06157478b66fea570e377f4794b95d6\",\"mode\":\"0o644\"},\"swarm_cloud_job.py\":{\"sha\":\"d73a913a0cedcb39fb8ebdef325c67962240bf39\",\"mode\":\"0o644\"},\"swarm_cloud_worker.py\":{\"sha\":\"dcc991d9051a6a985253a6a91c108d402b0768e2\",\"mode\":\"0o644\"},\"worker_capacity.py\":{\"sha\":\"9960d377e95526f2919f40e9824ff37799d26158\",\"mode\":\"0o644\"},\"worker_storage.py\":{\"sha\":\"fbf5bbd03cc9eba88c385d7726fb1e5ddaa11238\",\"mode\":\"0o644\"},\"workflow_delivery.py\":{\"sha\":\"9ea9c7cb73a791d3a3faa3050082f168452e04f8\",\"mode\":\"0o644\"},\"workflow_local.py\":{\"sha\":\"5e34636220bcf0b28cbbca44851c225a32c7c3bf\",\"mode\":\"0o644\"},\"NATIVE_ARTIFACT_CHECKPOINTS.md\":{\"sha\":\"4308268532e95de242f809e637667cc182ed8a20\",\"mode\":\"0o644\"},\"cloud_job_workspace/checkpoints.js\":{\"sha\":\"c5c1753c8e713f0a3bf39ee35c23cdb061927a0b\",\"mode\":\"0o644\"},\"native_artifact_checkpoints.py\":{\"sha\":\"6234a05effb3fc69776c889fa00529b5a8936abd\",\"mode\":\"0o644\"}}")
manifest_file=HOST.parent/'source-manifest.json'
manifest_bytes=manifest_file.read_bytes();receipt=json.loads(manifest_bytes)
if (receipt.get('schema')!='commons.prepared-stop-install.v1' or receipt.get('base')!='46bbfc4da90915400033074f4c72b79582b5d95f' or
    receipt.get('source_bundle')!='9e5d792d3ed1d819b7ed78422ca591c31223a280' or receipt.get('host')!=str(HOST)):
 raise RuntimeError('Select the complete original D76C native runtime')
rows=receipt.get('files')
if not isinstance(rows,list) or len(rows)!=len(HOST_FILES) or {row.get('path') for row in rows}!=set(HOST_FILES):
 raise RuntimeError('The selected native host needs its whole original 71-file closure')
for row in rows:
 name=row['path'];wanted=HOST_FILES[name];path=HOST/name
 if set(row)!={'path','sha','bytes'} or row['sha']!=wanted['sha']:
  raise RuntimeError('Native manifest member differs: '+name)
 info=path.lstat()
 if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=int(wanted['mode'],8):
  raise RuntimeError('Native source placement or mode differs: '+name)
 raw=path.read_bytes()
 if len(raw)!=row['bytes'] or hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()!=wanted['sha']:
  raise RuntimeError('Native source bytes differ: '+name)
if hashlib.sha256((HOST/'swarm_cloud_job.py').read_bytes()).hexdigest()!=NATIVE:
 raise RuntimeError('Selected original native runtime identity differs')

def exact_write(path,data,mode=0o600):
 path=Path(path);path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 if os.path.lexists(path):
  if not stat.S_ISREG(path.lstat().st_mode) or path.read_bytes()!=data:
   raise RuntimeError('Preserve the existing original postimage: '+str(path))
  return
 descriptor,pending=tempfile.mkstemp(prefix='.'+path.name+'-',dir=path.parent)
 try:
  with os.fdopen(descriptor,'wb') as output:
   os.fchmod(output.fileno(),mode);output.write(data);output.flush();os.fsync(output.fileno())
  try:os.link(pending,path)
  except FileExistsError:
   if not stat.S_ISREG(path.lstat().st_mode) or path.read_bytes()!=data:
    raise RuntimeError('A concurrent original postimage differs: '+str(path))
  descriptor=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(descriptor)
  finally:os.close(descriptor)
 finally:
  os.unlink(pending)

PROJECT.mkdir(mode=0o700,exist_ok=True)
git=PROJECT/'source-corrected.git';distribution='stellar/scf-starforge-20261009/distribution'
builder=PROJECT/'builder-c287'/distribution;builder.mkdir(parents=True,exist_ok=True,mode=0o700)
listed=subprocess.check_output(['git','--git-dir='+str(git),'--no-replace-objects','--no-lazy-fetch',
 'ls-tree','-z',COMMIT+':'+distribution])
builder_manifest={}
for item in listed.split(b'\0'):
 if not item:continue
 meta,name=item.split(b'\t',1);mode,kind,sha=meta.decode().split();name=name.decode()
 if kind!='blob' or not name.endswith(('.mjs','.json','.py')):continue
 data=subprocess.check_output(['git','--git-dir='+str(git),'--no-replace-objects','--no-lazy-fetch','cat-file','blob',sha])
 if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=sha:raise RuntimeError('Builder Git source differs')
 p=builder/name
 if p.exists() and p.read_bytes()!=data:raise RuntimeError('Selected builder postimage differs')
 exact_write(p,data)
 builder_manifest[name]={'gitBlob':sha,'bytes':len(data)}
for name,source_name,expected_sha in [
 ('phase.mjs','phase.mjs','af020aa10ecdc735167d2b78d998ed07595b8e5a'),
 ('run-customers.py','run-customers-checkpoint.py','b5195498e582ccaa084520a4a95f2b9c5e36ef34')]:
 data=(STAGE/source_name).read_bytes()
 if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=expected_sha:raise RuntimeError('Selected customer phase source differs: '+name)
 target=PROJECT/name
 if target.exists() and target.read_bytes()!=data:raise RuntimeError('Existing customer phase postimage differs: '+name)
 exact_write(target,data)
receiving=PROJECT/'receiving-source';receiving.mkdir(exist_ok=True,mode=0o700)
expected={
 'managed-rss-atom-receiving.mjs':'3d74f3ade9204478f75ddb1a6a244607934a11fb',
 'applications-receiving.mjs':'bc357be6dc23b7185c8989c058ddde3ed7fa191a',
 'browser-receiving.mjs':'5d607b3bfdd8a903fdfa1f5d979e886383bee721',
 'feed-config-template.json':'4995333c9e83bcb0b9523acfc13e0f3dc95cd10c'}
for name,sha in expected.items():
 data=(STAGE/'receiving-source'/name).read_bytes()
 if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=sha:raise RuntimeError('Original receiver differs')
 exact_write(receiving/name,data)
(PROJECT/'results').mkdir(exist_ok=True,mode=0o700)
intent={'schema':'starforge.original-managed-customer-installation.v1',
 'operationId':'SCF-MANAGED-CUSTOMERS-INSTALL-8F43-DB4D-20261012-C287-CHECKPOINT-CONTINUATION',
 'priorOperationId':'SCF-MANAGED-CUSTOMERS-INSTALL-8F43-DB4D-20261012-C287-CONTINUATION',
 'priorRecord':'/workspace/scratch/8f4370a17e6f/managed-native-records/91085fe875e06cee234286a2ff0851383a84d2845b60f46baca4db20fe1f2bab',
 'priorPhase':'PACKAGED; PREPARE interrupted after execution carrier disappeared',
 'priorSourceArchive':{'bytes':10945213,'sha256':'d5ba9aaeabd91122ae3aa6c29825510c532957ae45a639c0cee92591c9664498'},
 'originalOperationId':'SCF-MANAGED-CUSTOMERS-INSTALL-8F43-DB4D-20261012',
 'originalRecord':'/dev/shm/commons-8f43-managed-native/records/d3634ff588bdfe09c4f1fef9e4e10d4e09712ea14d952c0c657b7eb02292102b',
 'originalSourceCommit':'db4dcd0e812b13184d6f0dd93f040d1f6c723a74',
 'adoptedSourceRepair':'c2874172fc7cc3a278fbc3e0974751041900feef','sourceCommit':COMMIT,
 'project':str(PROJECT),'sourceCache':str(git),'builderDirectory':str(builder),
 'receivingDirectory':str(receiving),'runtimeDirectory':str(PROJECT/'installed'),
 'npmCache':str(PROJECT/'npm-cache'),'node':NODE,'npm':str(Path(NODE).parent/'npm'),'python':PYTHON,
 'nativeRuntimeSha256':NATIVE,'nativeHost':str(HOST),
 'nativeSourceManifestSha256':hashlib.sha256(manifest_bytes).hexdigest(),
 'nativeSourceBundle':receipt['source_bundle'],'nativeSources':HOST_FILES,
 'builderSources':builder_manifest,'receivingSources':expected,
 'phaseSha256':hashlib.sha256((PROJECT/'phase.mjs').read_bytes()).hexdigest(),
 'runnerSha256':hashlib.sha256((PROJECT/'run-customers.py').read_bytes()).hexdigest()}
selected=PROJECT/'intent-checkpoint.json';data=(json.dumps(intent,indent=2)+'\n').encode()
if selected.exists() and selected.read_bytes()!=data:raise RuntimeError('Existing source operation intent differs')
exact_write(selected,data)
exact_write(RECORDS/'carrier-intent-checkpoint.json',data)
sys.path.insert(0,str(HOST));os.environ['SWARM_NODE24_BIN']=str(Path(NODE).parent)
os.environ['PYTHONDONTWRITEBYTECODE']='1'
import swarm_cloud_job as native
from native_foreground import ForegroundLaunch, resume_foreground
if '--resume' in sys.argv:
 report=resume_foreground(native,intent['operationId'],str(RECORDS),action='resume-capacity',report_format='summary')
 if report is not None:print(json.dumps({key:report.get(key) for key in ['operation_id','record','state','supervisor_alive','process_alive','reused']}),flush=True)
 raise SystemExit(0)
args=SimpleNamespace(operation_id=intent['operationId'],peer='8f43-scf-managed-customers',project=str(PROJECT),
 command=[PYTHON,'-B',str(PROJECT/'run-customers.py'),str(selected)],java=None,node='24',
 artifact=[selected.relative_to(PROJECT).as_posix(),'results'],artifact_on_success=[],artifact_on_failure=[],retain_artifacts=True,
 runtime_path=[str(HOST),str(git),str(STAGE/'source.git'),'/workspace/scratch/d1ccf784531e/scf-following-release/source.git',
  '/dev/shm/b028-mcp-runtime/node_modules','/dev/shm/commons-8f43-freighter',
  '/dev/shm/commons-8f43-wallet-customer','/dev/shm/commons-8f43-opml-native/result/customer',
  '/workspace/scratch/39daa82f3fbd/routescan_native_39da/operator-workspace',
  '/workspace/scratch/bc0850d7ba23/browser-runtime'],
 runtime_consumers_root='/workspace/shared/swarm/jobs/runtime-consumers',
 memory_mib=896,memory_reserve_mib=128,memory_reclaim='clean-cache',
 memory_reservations_root='/workspace/shared/swarm/capacity/memory',
 disk_space=[str(PROJECT)+'=512',str(RECORDS)+'=128'],
 disk_inodes=[str(PROJECT)+'=65536',str(RECORDS)+'=1024'],
 disk_reserve_mib=4,disk_reserve_inodes=128,
 disk_reservations_root='/workspace/shared/swarm/capacity/disk',
 records_root=str(RECORDS),worker_root=str(PROJECT/'workers'),temp_root=str(PROJECT/'temporary'))
launch=ForegroundLaunch(native)
try:
 report=native.start(args,launcher=launch)
 print(json.dumps({key:report.get(key) for key in ['operation_id','record','state','supervisor_alive','process_alive','reused']}),flush=True)
finally:
 if launch.root is not None:
  code=launch.handoff()
  if code is not None:raise SystemExit(code)
