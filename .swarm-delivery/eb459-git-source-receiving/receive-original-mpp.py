#!/usr/bin/env python3
"""Run the original Product4 operation and managed Applications receiving in one owned runtime."""
import argparse,base64,datetime,fcntl,gzip,hashlib,json,os,pathlib,shutil,stat,subprocess,sys,time
os.umask(0o077)
parser=argparse.ArgumentParser(description=__doc__)
for name in ['run-directory','records-directory','source-packet','donor-repository','git-receiver','runtime-receiver','application-caller','following-ready']:
 parser.add_argument('--'+name,required=True,type=pathlib.Path)
parser.add_argument('--node',default=shutil.which('node'))
parser.add_argument('--cache',type=pathlib.Path)
parser.add_argument('--cache-limit-bytes',type=int,default=4194304)
parser.add_argument('--following-timeout',type=int,default=0,help='Seconds to wait; 0 keeps the original runtime alive.')
options=parser.parse_args()
for name,value in vars(options).items():
 if isinstance(value,pathlib.Path):
  if not value.is_absolute(): parser.error('--'+name.replace('_','-')+' must be absolute')
  if value.exists() and value.resolve()!=value: parser.error('--'+name.replace('_','-')+' must be canonical')
if options.cache_limit_bytes<0 or options.following_timeout<0: parser.error('Byte and time limits must be nonnegative')
root=options.run_directory
root.mkdir(mode=0o700,parents=True,exist_ok=True)
(root/'tmp').mkdir(mode=0o700,exist_ok=True)
retained=options.records_directory
retained.mkdir(mode=0o700,parents=True,exist_ok=True)
node=options.node
if not node: parser.error('Select the original Node 24 executable with --node')
environment=dict(os.environ,TMPDIR=str(root/'tmp'),NODE_OPTIONS='--max-old-space-size=128')
environment['PATH']=str(pathlib.Path(node).parent)+os.pathsep+environment['PATH']
receiver=options.runtime_receiver
caller=options.application_caller
for path in [root,retained]:
 info=path.lstat()
 if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077:
  parser.error(str(path)+' must be an owned private directory')
lease_fd=os.open(root/'operation.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
fcntl.flock(lease_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
def git_oid(path):
 data=path.read_bytes()
 return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
assert git_oid(options.git_receiver)=='b4cfcbad88e1d076625e8f59badf315f08f9c23f'
assert git_oid(receiver)=='0f1be6df1c47f8f8fb9517dcaee5b708c71aa4d6'
assert git_oid(caller)=='e9fdd60207a7c706ab547ba68d60f53f504e53ec'
assert subprocess.run([node,'--check',str(caller)],capture_output=True,text=True).returncode==0
new_record={'schema':'stellar-forge.mpp-applications-original-operation.v1','sourceCommit':'9ef475062876557d6baf14e0e5414d7afbf3bc7f','receiverBlob':git_oid(receiver),'callerBlob':git_oid(caller),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
record_path=retained/'mpp-original-complete-native-result.json.gz'
record=new_record
if record_path.exists():
 saved=json.loads(gzip.decompress(record_path.read_bytes()))
 if saved.get('runDirectory')==str(root):
  for key in ['schema','sourceCommit','receiverBlob','callerBlob']:
   if saved.get(key)!=new_record[key]: parser.error('Retained original operation input changed: '+key)
  record=saved
record['runDirectory']=str(root)
record['selectedInputs']={key:str(value) for key,value in vars(options).items() if isinstance(value,pathlib.Path)}
def retain_record():
 packed=gzip.compress((json.dumps(record,ensure_ascii=False,sort_keys=True)+'\n').encode(),mtime=0)
 path=retained/'mpp-original-complete-native-result.json.gz'
 temporary=path.with_suffix('.partial')
 try:
  temporary.write_bytes(packed)
  with temporary.open('rb') as fd: os.fsync(fd.fileno())
  os.replace(temporary,path)
  return {'path':str(path),'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest()}
 except OSError as error:
  return {'error':str(error),'gzipBase64':base64.b64encode(packed).decode()}
def command(argv,log_name):
 record['phase']=log_name
 record['phaseStartedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 print(json.dumps({'phase':log_name,'startedAt':record['phaseStartedAt'],'retention':retain_record()}),flush=True)
 log=root/log_name
 with log.open('w') as output:
  process=subprocess.Popen(argv,env=environment,cwd=str(root),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
  for line in process.stdout:
   output.write(line);output.flush()
   try:
    data=json.loads(line)
    if data.get('state') not in ['PACKAGE_RECEIVED','CACHE_RETAINED'] or data.get('completed',0) in [1,2,3,10,20,30,40,50,60,70,80,82]:
     print(line,end='',flush=True)
   except Exception:
    if len(line)<500: print(line,end='',flush=True)
  status=process.wait()
 record.setdefault('steps',{})[log_name]={'exitCode':status,'log':log.read_text(errors='replace')}
 print(json.dumps({'phase':log_name+'-finished','exitCode':status,'retention':retain_record()}),flush=True)
 return status
args=['python3',str(options.git_receiver),
 '--metadata',str(options.source_packet/'9ef475-metadata.json.gz'),'--commit','9ef475062876557d6baf14e0e5414d7afbf3bc7f',
 '--directory',str(root/'9ef475-cache'),'--donor-repository',str(options.donor_repository),
 '--incoming',str(options.source_packet/'incoming'),
 '--additional-path','operations/scf-mpp-merchant-mcp-native-20261012/execute.mjs',
 '--additional-path','operations/scf-mpp-merchant-mcp-native-20261012/run.sh','--materialize',str(root/'source')]
status=command(args,'source-receiving.log')
if status: sys.exit(status)
source=root/'source';run=root/'mpp-mcp-run';run.mkdir(mode=0o700,exist_ok=True)
runtime_args=['python3',str(receiver),str(run/'runtime'),'--source',str(source/'stellar/scf-starforge-20261009/mpp-charge')]
if options.cache: runtime_args.extend(['--cache',str(options.cache),'--cache-limit-bytes',str(options.cache_limit_bytes)])
status=command(runtime_args,'runtime-receiving.log')
if status: sys.exit(status)
if record.get('nativeExitCode')==0 and (run/'result.json').exists():
 record['mppResult']=json.loads((run/'result.json').read_text())
 environment['NODE_EXTRA_CA_CERTS']=str(run/'tls.crt')
 print(json.dumps({'phase':'ORIGINAL_PRODUCT4_REOPENED','retention':retain_record()}),flush=True)
else:
 if any((run/name).exists() for name in ['merchant','customer']):
  parser.error('The retained original MPP operation has unfinished native state; reconcile its exact log before continuing it.')
 status=command(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(run/'tls.key'),'-out',str(run/'tls.crt'),
  '-days','1','-subj','/CN=merchant.example.com','-addext','subjectAltName=DNS:merchant.example.com'],'tls-setup.log')
 if status: sys.exit(status)
 environment['NODE_EXTRA_CA_CERTS']=str(run/'tls.crt')
 status=command([node,'--experimental-vm-modules',str(source/'operations/scf-mpp-merchant-mcp-native-20261012/execute.mjs'),str(source),str(run)],'original-mpp-native.log')
 if (run/'result.json').exists(): record['mppResult']=json.loads((run/'result.json').read_text())
 record['nativeExitCode']=status
 print(json.dumps({'phase':'ORIGINAL_PRODUCT4_FINISHED','exitCode':status,'result':record.get('mppResult'),'retention':retain_record()}),flush=True)
 if status: sys.exit(status)
descriptor=options.following_ready
record['phase']='FOLLOWING_READY_RECEIVING'
print(json.dumps({'phase':record['phase'],'descriptor':str(descriptor),'nativeRuntime':str(run/'runtime'),'retention':retain_record()}),flush=True)
deadline=time.monotonic()+options.following_timeout if options.following_timeout else None
while not descriptor.exists():
 if deadline and time.monotonic()>deadline:
  record['phase']='ORIGINAL_NATIVE_COMPLETE_FOLLOWING_DESCRIPTOR_PENDING'
  print(json.dumps({'phase':record['phase'],'retention':retain_record()}),flush=True)
  sys.exit(3)
 time.sleep(1)
entry=descriptor.lstat()
assert stat.S_ISREG(entry.st_mode) and not stat.S_ISLNK(entry.st_mode) and entry.st_nlink==1 and entry.st_uid==os.getuid() and entry.st_mode&0o077==0
following=json.loads(descriptor.read_text())
assert following['schema']=='stellar-forge.mpp-following-ready.v1'
record['following']=following
private_environment=root/'mpp-original-environment.json'
environment_bytes=json.dumps({'MPP_JOURNEY_HMAC':'b'*64,'MPP_CONSOLE_TOKEN':'c'*64}).encode()
if private_environment.exists():
 if private_environment.read_bytes()!=environment_bytes: parser.error('Original private environment bytes changed')
else: private_environment.write_bytes(environment_bytes)
for role in ['customer','merchant']:
 original=run/role
 metadata=json.loads((original/'workspace.json').read_text())
 reception=root/('applications-'+role+'-receiving')
 request={'schema':'stellar-forge.mpp-managed-reception.v1','applicationsDirectory':following['applicationsDirectory'],
  'runtimeDirectory':following['runtimeDirectory'],'expectedRuntime':following['expectedRuntime'],
  'mppDirectory':str(original),'mppCreatedAt':metadata['createdAt'],'receptionDirectory':str(reception),
  'label':'MPP original '+role+' receiving','role':role,
  'settings':{'port':0,'terminalPython':'/usr/bin/python3','environmentFile':str(private_environment),'tokenEnv':'MPP_CONSOLE_TOKEN'},
  'retainedPurchaseIds':['mpp-mcp-original-001','mpp-mcp-retry-001'] if role=='customer' else [],
  'offer':{'id':'report','inputs':{'query':{'edition':'2026-10','tag':['north','south']},'json':{'groupBy':'region','name':'München'}}},
  'configureCurrentCustomer':True,'exerciseMerchant':True,'timeoutMs':300000}
 request_path=root/('applications-'+role+'-input.json')
 request_bytes=(json.dumps(request,ensure_ascii=False)+'\n').encode()
 if request_path.exists():
  if request_path.read_bytes()!=request_bytes: parser.error('Original receiving input changed for '+role)
 else: request_path.write_bytes(request_bytes)
 status=command([node,str(caller),str(request_path)],'applications-'+role+'.log')
 result_path=reception/'result.json'
 if result_path.exists(): record.setdefault('applicationsResults',{})[role]=json.loads(result_path.read_text())
 journal_path=reception/'reception.json'
 if journal_path.exists(): record.setdefault('applicationsJournals',{})[role]=json.loads(journal_path.read_text())
 print(json.dumps({'phase':'APPLICATIONS_ROLE_FINISHED','role':role,'exitCode':status,'retention':retain_record()}),flush=True)
 if status: sys.exit(status)
record['phase']='COMPLETE';record['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
print(json.dumps({'phase':'COMPLETE','mpp':record['mppResult'],'applications':record['applicationsResults'],'retention':retain_record()}),flush=True)
