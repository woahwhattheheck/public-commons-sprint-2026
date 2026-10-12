#!/usr/bin/env python3
"""One original selected-source receiving and customer MCP continuation."""
import datetime, gzip, hashlib, json, os, pathlib, subprocess, sys
ROOT=pathlib.Path('/workspace/scratch/b3909ae247f2/stellar-expert-mcp-receiving')
INPUT=ROOT/'source-input'; CACHE=ROOT/'source-cache'; SOURCE=ROOT/'source'; PRIVATE=ROOT/'private'
COMMIT='a4e5c7248462e54f25f8c98f9e70dccf83d02237'
METADATA=INPUT/'metadata-a4e5c724.json.gz'
EXPECTED=(INPUT/'metadata-a4e5c724.sha256').read_text().strip()
PRIVATE.mkdir(parents=True,exist_ok=True,mode=0o700)
def save(p,v):
 b=(json.dumps(v,indent=2)+'\n').encode(); q=p.with_name(p.name+'.next')
 fd=os.open(q,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 os.replace(q,p)
def note(phase,**v):
 value={'schema':'stellar-forge.stellar-expert-mcp-native-source.v1','sourceCommit':COMMIT,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'phase':phase,**v}
 save(PRIVATE/'source-receiving-result.json',value); print(json.dumps(value),flush=True)
def git_blob(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def receive():
 args=[sys.executable,str(INPUT/'git-object-receiving.py'),'--metadata',str(METADATA),'--commit',COMMIT,'--directory',str(CACHE),'--incoming',str(INPUT/'incoming'),'--materialize',str(SOURCE)]
 retained_incoming=pathlib.Path('/dev/shm/b3909-stellar-incoming-a4e5')
 if retained_incoming.is_dir() and retained_incoming.resolve()==retained_incoming:args += ['--incoming', str(retained_incoming)]
 donors=[('repository','/workspace/scratch/7737a0699973/scf'),('repository','/workspace/scratch/7108267765ab/fiscal-applications-native/source-10f5/cache/repository.git'),('repository','/workspace/scratch/d1ccf784531e/scf-following-release/source.git'),('source','/workspace/scratch/b3909ae247f2/stellar-expert-product'),('source','/workspace/scratch/9b238a12a516/grpc-merchant-agent/source'),('source','/workspace/scratch/f8256c696474/scf-overview/source')]
 for kind,path in donors:
  p=pathlib.Path(path)
  if p.is_dir() and p.resolve()==p:args+=['--donor-'+kind,path]
 result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'GIT_NO_LAZY_FETCH':'1'})
 (PRIVATE/'original-receiver-output.json').write_text(result.stdout); (PRIVATE/'original-receiver-errors.txt').write_text(result.stderr)
 if result.returncode not in (0,2):raise RuntimeError('Original source receiver failed: '+result.stderr[-1500:])
 value=json.loads(result.stdout);note('ORIGINAL_SOURCE_'+value['phase'],receiver=value);return result.returncode
try:
 assert hashlib.sha256(METADATA.read_bytes()).hexdigest()==EXPECTED,'Selected metadata identity changed'
 if receive()!=0:
  missing=json.loads((CACHE/'missing-objects.json').read_text())
  assert missing['source']['commit']==COMMIT
  objects=missing['objects']
  raise RuntimeError('Original local source closure still requires '+str(len(objects))+' selected objects ('+str(sum(x['size'] for x in objects))+' bytes); preserved receiver missing-object manifest identifies them')
 modules=SOURCE/'node_modules'; target=pathlib.Path('/workspace/scratch/89255e756bf9/scf_deps/node_modules')
 assert target.is_dir(),'Original accepted dependency tree is unavailable'
 if modules.is_symlink():assert modules.resolve()==target.resolve(),'Selected source dependency tree changed'
 elif not modules.exists():modules.symlink_to(target,target_is_directory=True)
 else:raise RuntimeError('Unexpected dependency directory in selected source')
 note('ORIGINAL_SOURCE_READY',sourceDirectory=str(SOURCE),dependencyRoot=str(target))
 child=subprocess.run(['node',str(PRIVATE/'mcp-journey.cjs')],cwd=str(ROOT))
 if child.returncode:raise RuntimeError('Original MCP/customer continuation returned '+str(child.returncode))
 note('COMPLETE',sourceDirectory=str(SOURCE),result=str(PRIVATE/'result.json'))
except BaseException as error:
 note('INCOMPLETE',code=type(error).__name__,message=str(error))
 raise

