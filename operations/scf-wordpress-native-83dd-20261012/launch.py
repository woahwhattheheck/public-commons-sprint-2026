#!/usr/bin/env python3
"""Retain the original native WordPress job until its private result is durably saved.

The original supervisor owns capacity, source, process and result identities.
Its source-owned finalization callback saves the actual stopped continuation
before those same reservations release.
"""
from __future__ import annotations
import argparse,base64,fcntl,hashlib,json,os,pathlib,select,stat,subprocess,sys,tempfile,time,traceback,zipfile,zlib

NATIVE_SOURCE="#!/usr/bin/env python3\n\"\"\"Commission the single retained WordPress receiving operation through its native host.\"\"\"\nimport argparse,hashlib,json,os,pathlib,sys,tempfile\nHERE=pathlib.Path(__file__).resolve().parent\nHOST=pathlib.Path('/dev/83dd-wordpress-native-host')\nRECORDS=pathlib.Path('/dev/83dd-wordpress-native-records')\nCOURIER=pathlib.Path('/dev/83dd-wordpress-native-courier')\nLIBRARY=pathlib.Path('/root/.codex/plugins/cache/openai-curated-remote/openai-library/0.1.62/skills/library/scripts')\nNODE=pathlib.Path('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node')\nMODULES=pathlib.Path('/workspace/scratch/9345d3fc660b/native-runtime/node_modules')\nWORKER=pathlib.Path('/dev/83dd-wordpress-worker')\nSCF='stellar/scf-starforge-20261009/'\nselection_raw=(HERE/'host-selection.json').read_bytes()\nselection=json.loads(selection_raw)\nassert selection['schema']=='stellar-forge.wordpress-testnet-host.v1'\nassert selection['operationId']=='scf-wordpress-native-receiving-83dd-20261012'\nsource=pathlib.Path(selection['sourceRoot'])\nproject=pathlib.Path(selection['operationDirectory'])\nassert source==pathlib.Path('/dev/83dd-wordpress-release/source')\nassert project==pathlib.Path('/dev/83dd-wordpress-native-operation')\nclosure_raw=(HERE/'SOURCE_CLOSURE.json').read_bytes()\nclosure=json.loads(closure_raw)\nassert closure['sourceRef']=='f167c3e524b782ceb6dd196df81f6b97886442a9'\nassert closure['commissioningRef']=='4c62463acfae23b50fb3327d7eafeb087e8b4806'\nassert closure['directory']==str(source) and not closure['missing'],'Original source closure remains incomplete'\nfor name,item in closure['files'].items():\n p=source/name\n assert not p.is_symlink() and p.is_file(),name\n raw=p.read_bytes()\n assert len(raw)==item['bytes'] and hashlib.sha256(raw).hexdigest()==item['sha256'],name\n assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\\0'+raw).hexdigest()==item['gitBlob'],name\ndef atomic_owned(path,data):\n path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)\n if path.exists():\n  assert not path.is_symlink() and path.read_bytes()==data,'Retained selection differs: '+str(path)\n  return\n fd,tmp=tempfile.mkstemp(prefix=path.name+'.',dir=path.parent)\n try:\n  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())\n  os.chmod(tmp,0o600)\n  try:os.link(tmp,path)\n  except FileExistsError:\n   assert not path.is_symlink() and path.read_bytes()==data,'Concurrent selection differs'\n finally:\n  if os.path.exists(tmp):os.unlink(tmp)\nfor p in [source,HOST,NODE,MODULES,pathlib.Path(selection['nativeHelper']),pathlib.Path(selection['python']),\n          pathlib.Path(selection['php']),pathlib.Path(selection['wordpressCore']),\n          pathlib.Path(selection['sqlite']),pathlib.Path(selection['chromium']),\n          pathlib.Path(selection['playwrightModule']),pathlib.Path(selection['openssl'])]:\n assert p.exists(),str(p)\nfor p in [project,project/'results',WORKER,RECORDS,COURIER]:\n assert not p.is_symlink(),str(p)\n p.mkdir(parents=True,exist_ok=True,mode=0o700)\nassert project.resolve()==project and source.resolve()==source\natomic_owned(project/'host-selection.json',selection_raw)\nclosure_target=project/'SOURCE_CLOSURE.json'\nif closure_target.exists():\n previous=json.loads(closure_target.read_text())\n def identity(value):\n  return {key:value[key] for key in ['schema','sourceRef','commissioningRef','directory']} | {\n   'files':{name:{key:item[key] for key in ['gitBlob','sha256','bytes']} for name,item in value['files'].items()},\n   'missing':value['missing']}\n assert identity(previous)==identity(closure),'Retained original source closure changed'\nelse:atomic_owned(closure_target,closure_raw)\natomic_owned(project/'NATIVE_LAUNCH.py',globals()['NATIVE_LAUNCH_BYTES'])\nlink=source/'node_modules'\nif link.is_symlink():assert link.resolve(strict=True)==MODULES.resolve(strict=True),'Original native package selection changed'\nelif link.exists():raise ValueError('Selected source already has a different node_modules directory')\nelse:link.symlink_to(MODULES,target_is_directory=True)\nhost_raw=(HERE/'HOST_CLOSURE.json').read_bytes()\nhost=json.loads(host_raw)\nassert host['schema']=='commons.native-supervisor-finalizer-host-closure.v1'\nassert host['operationId']==selection['operationId'] and host['directory']==str(HOST)\nassert host['packetSha256']==hashlib.sha256((HERE/'host-finalizer.json').read_bytes()).hexdigest()\nfor name,item in host['files'].items():\n p=HOST/name\n assert not p.is_symlink() and p.is_file(),name\n raw=p.read_bytes()\n assert len(raw)==item['bytes'] and hashlib.sha256(raw).hexdigest()==item['sha256'],name\natomic_owned(project/'HOST_CLOSURE.json',host_raw)\nos.environ['PYTHONDONTWRITEBYTECODE']='1'\nos.environ['GIT_NO_LAZY_FETCH']='1'\nos.environ['GIT_OPTIONAL_LOCKS']='0'\nos.environ['TJL_NATIVE_PHP_BIN']=selection['php']\nos.environ['TJL_NATIVE_WORDPRESS_SOURCE']=selection['wordpressCore']\nos.environ['TJL_NATIVE_SQLITE_SOURCE']=selection['sqlite']\nos.environ['TJL_WORKSPACE_PYTHON']=selection['python']\nsys.path.insert(0,str(HOST))\nfrom native_foreground import load_native,ForegroundLaunch\nnative=load_native(HOST)\nassert callable(globals().get('NATIVE_FINALIZER')),'Original source-owned finalizer is required'\nlaunch=ForegroundLaunch(native,on_finalized=globals()['NATIVE_FINALIZER'])\nparser=argparse.ArgumentParser()\nnative.launch_options(parser)\noptions=[\n 'astra83dd-wordpress','--operation-id',selection['operationId'],'--project',str(project),\n '--worker-root',str(WORKER),'--temp-root',str(WORKER/'tmp'),'--records-root',str(RECORDS),\n '--memory-mib','1024','--memory-reserve-mib','256','--memory-reclaim','clean-cache','--memory-storage','included',\n '--disk-space',str(project)+'=128','--disk-space',str(WORKER)+'=64','--disk-space',str(RECORDS)+'=32','--disk-space',str(COURIER)+'=384',\n '--disk-inodes',str(project)+'=6000','--disk-inodes',str(WORKER)+'=1500','--disk-inodes',str(RECORDS)+'=300','--disk-inodes',str(COURIER)+'=100',\n '--retain-artifacts','--report-format','summary',\n '--artifact','host-selection.json','--artifact','SOURCE_CLOSURE.json','--artifact','NATIVE_LAUNCH.py','--artifact','HOST_CLOSURE.json',\n '--artifact','results']\nruntime_paths=[\n str(source),str(HOST),str(MODULES),str(NODE),selection['python'],str(LIBRARY),\n str(pathlib.Path(selection['nativeHelper']).parent),selection['php'],\n '/workspace/scratch/b0285b3810b3/michael-af-staff/cms-integration/php-native-runtime/php',\n selection['wordpressCore'],selection['sqlite'],str(pathlib.Path(selection['chromium']).parent),\n str(pathlib.Path(selection['playwrightModule']).parent),selection['openssl']]\nfor path in sorted(set(runtime_paths)):options.extend(['--runtime-path',path])\nargs=parser.parse_args(options)\nargs.command=[str(NODE),str(source/SCF/'sf30-seller-sdk/wordpress/native/testnet.mjs'),\n '--input',str(project/'host-selection.json')]\ntry:\n record=native.run_path(selection['operationId'],RECORDS)\n recovery=globals().get('NATIVE_RECOVER_FAILURE')\n options={} if recovery is None else {'recover_failure':recovery}\n report=native.resume_capacity(record,launcher=launch,**options) if (record/'request.json').exists() else native.start(args,launcher=launch)\n print(json.dumps(native.report_value(report,'summary'),separators=(',',':')),flush=True)\nfinally:\n if launch.root is not None:\n  code=launch.handoff()\n  if code is not None:raise SystemExit(code)\n"

HERE=pathlib.Path(__file__).resolve().parent
OPERATION='scf-wordpress-native-receiving-83dd-20261012'
HOST=pathlib.Path('/dev/83dd-wordpress-native-host')
PROJECT=pathlib.Path('/dev/83dd-wordpress-native-operation')
RECORDS=pathlib.Path('/dev/83dd-wordpress-native-records')
COURIER=pathlib.Path('/dev/83dd-wordpress-native-courier')
LIBRARY=pathlib.Path('/root/.codex/plugins/cache/openai-curated-remote/openai-library/0.1.62/skills/library/scripts')
HELPER=LIBRARY/'library_upload.py'
RECORD=RECORDS/hashlib.sha256(OPERATION.encode()).hexdigest()
SHARED=pathlib.Path('/workspace/scratch/83dd50f1866b/wordpress-native-custody')/(OPERATION+'.json')
ARCHIVE_NAME='SCF_WordPress_Native_83DD_20261012.zip'
MAX_ARCHIVE=192*1024*1024
MAX_PRIVATE=176*1024*1024
SCHEMA='stellar-forge.wordpress-native-custody.v1'
KEEP=COURIER/'custody.json'
EVENT_DESCRIPTOR=None
FINAL_CUSTODY=None

def now():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def compact(value):
    return json.dumps(value,ensure_ascii=True,separators=(',',':'),sort_keys=True).encode()

def emit(value):
    try:
        line=(json.dumps(value,ensure_ascii=True,separators=(',',':'))+'\n').encode()
        if EVENT_DESCRIPTOR is None:
            sys.stdout.buffer.write(line);sys.stdout.buffer.flush()
        else:
            while line:
                size=os.write(EVENT_DESCRIPTOR,line);line=line[size:]
    except (BrokenPipeError,OSError):
        pass

def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()

def read_json(path,default=None):
    if not path.exists():
        return default
    if path.is_symlink() or not path.is_file():
        raise ValueError('Expected original regular JSON file: '+str(path))
    return json.loads(path.read_text(encoding='utf-8'))

def write_atomic(path,data,*,same=False):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.is_symlink():
        raise ValueError('Refusing symlink control file: '+str(path))
    if same and path.exists():
        if path.read_bytes()!=data:
            raise ValueError('Retained exact bytes changed: '+str(path))
        return
    fd,temp=tempfile.mkstemp(prefix='.'+path.name+'.',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as out:
            out.write(data);out.flush();os.fsync(out.fileno())
        os.chmod(temp,0o600)
        if same:
            try:
                os.link(temp,path)
            except FileExistsError:
                if path.is_symlink() or path.read_bytes()!=data:
                    raise ValueError('Concurrent retained bytes changed: '+str(path))
        else:
            os.replace(temp,path)
        dfd=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(dfd)
        finally:os.close(dfd)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def save(value):
    write_atomic(KEEP,compact(value))
    return value

def summary(report):
    keys=('operation_id','record','state','exit_code','started_at','ended_at',
          'supervisor_alive','process_alive','error','error_type','errno','error_stage','message')
    return {k:report[k] for k in keys if k in report}

def native_module():
    sys.path.insert(0,str(HOST))
    from native_foreground import load_native
    return load_native(HOST)

def selection_environment():
    value=read_json(HERE/'host-selection.json')
    if value.get('operationId')!=OPERATION or value.get('operationDirectory')!=str(PROJECT):
        raise ValueError('Original host selection changed')
    env=dict(os.environ)
    env.update(PYTHONDONTWRITEBYTECODE='1',GIT_NO_LAZY_FETCH='1',GIT_OPTIONAL_LOCKS='0',
               TJL_NATIVE_PHP_BIN=value['php'],TJL_NATIVE_WORDPRESS_SOURCE=value['wordpressCore'],
               TJL_NATIVE_SQLITE_SOURCE=value['sqlite'],TJL_WORKSPACE_PYTHON=value['python'])
    return env

def observe(native):
    return native.inspect(RECORD) if (RECORD/'request.json').exists() else None

def await_native(native,child):
    """Observe only this original process; no replacement after actual dispatch."""
    last=None
    while True:
        report=observe(native)
        signature=compact(summary(report)) if report else b'no-original-request'
        if signature!=last:
            emit({'event':'native','operation_id':OPERATION,'report':summary(report or {})})
            last=signature
        alive=bool(report and (report.get('supervisor_alive') or report.get('process_alive')))
        if child is not None:
            code=child.poll()
            if code is None:
                time.sleep(15);continue
            child.wait()
        else:
            code=None
        if alive:
            time.sleep(15);continue
        if report and report.get('state')=='finalization_pending':
            try:
                native.finalize(RECORD,retain_artifacts=True)
                report=observe(native)
            except Exception:
                write_atomic(COURIER/'native-finalization-error.txt',traceback.format_exc().encode())
        return report,code

def run_native(native,*,recover_failure=None):
    assert_restore_complete()
    prepare_courier_inputs()
    current=observe(native)
    if current and (current.get('supervisor_alive') or current.get('process_alive')):
        # Observe an existing original owner; it already owns its own finalizer.
        return await_native(native,None)
    if current and (current.get('state') in native.TERMINAL or current.get('state')=='finalization_pending'):
        if current.get('state')!='launch_failed' or recover_failure is None:
            return current,None
    if current and any((RECORD/name).exists() for name in
                       ('process.json','output.log','command-completion.dat','stop-request.json')):
        return current,None
    if current and (RECORD/'result.json').exists() and recover_failure is None:
        return current,None
    # The dedicated foreground itself becomes the original supervisor. The
    # callback consumes its passed result; it never waits for itself to exit.
    code=None
    try:
        exec(compile(NATIVE_SOURCE,__file__,'exec'),
             {'__name__':'__main__','__file__':__file__,'NATIVE_FINALIZER':finalize_native,
              'NATIVE_RECOVER_FAILURE':recover_failure,'NATIVE_LAUNCH_BYTES':retained_launch_bytes()})
    except SystemExit as ended:
        code=ended.code if isinstance(ended.code,int) else 0 if ended.code is None else 1
    except BaseException as error:
        remember_exception(error,'native-launch')
        raise
    return observe(native),code

# Early failures do not own the native memory or disk reservation. Retain only
# bounded original control bytes here; full application custody stays in the
# supervisor's on_finalized callback.
CHECKPOINT_SCHEMA='stellar-forge.wordpress-native-control-checkpoint.v1'
CHECKPOINT_MAX=4*1024*1024
CHECKPOINT_FILE_MAX=2*1024*1024
CHECKPOINT_FILES_MAX=512
CHECKPOINT_PATH=COURIER/'pre-dispatch-checkpoint.json'
SHARED_CHECKPOINT=SHARED.with_suffix('.checkpoint.json')
RESTORE_PROGRESS=COURIER/'checkpoint-restore.json'
PREVIOUS_LAUNCHES={'880e65144caa5c55582bf0253c699e563682f1bacd2b02058131ac5631722d7c'}
SOURCE_REF='f167c3e524b782ceb6dd196df81f6b97886442a9'
COMMISSIONING_REF='4c62463acfae23b50fb3327d7eafeb087e8b4806'
DISPATCH_MARKERS=('process.json','output.log','command-completion.dat','stop-request.json')
PROJECT_CONTROLS={'host-selection.json','SOURCE_CLOSURE.json','HOST_CLOSURE.json','NATIVE_LAUNCH.py'}
COURIER_CONTROLS={'native-launch-error.json','native-launch-error.txt','launcher-adoption.json'}
LAST_ERROR=None
LAST_ERROR_TRACE=None
LAST_CHECKPOINT=None
LAST_EMITTED_CHECKPOINT=None

def exception_value(error,stage):
    value={'stage':stage,'type':type(error).__name__,'message':str(error)[:4000]}
    for name in ('errno','filename','filename2'):
        item=getattr(error,name,None)
        if isinstance(item,(str,int)) and not isinstance(item,bool):
            value[name]=item[:2000] if isinstance(item,str) else item
    chain=[]
    seen={id(error)}
    following=error.__cause__ or (None if error.__suppress_context__ else error.__context__)
    while following is not None and id(following) not in seen and len(chain)<4:
        seen.add(id(following))
        row={'type':type(following).__name__,'message':str(following)[:2000]}
        if isinstance(getattr(following,'errno',None),int):row['errno']=following.errno
        chain.append(row)
        following=following.__cause__ or (None if following.__suppress_context__ else following.__context__)
    if chain:value['causes']=chain
    return value

def remember_exception(error,stage):
    global LAST_ERROR,LAST_ERROR_TRACE
    trace=''.join(traceback.format_exception(type(error),error,error.__traceback__)).encode('utf-8')
    retained=trace[:128*1024]
    LAST_ERROR_TRACE=retained
    value={**exception_value(error,stage),'observed_at':now(),
           'traceback_sha256':hashlib.sha256(trace).hexdigest(),'traceback_bytes':len(trace),
           'traceback_retained_bytes':len(retained),'traceback_clipped':len(retained)!=len(trace),
           'traceback_file':{'scope':'courier','path':'native-launch-error.txt'}}
    LAST_ERROR=value
    for name,raw in [('native-launch-error.txt',retained),('native-launch-error.json',compact(value))]:
        try:write_atomic(COURIER/name,raw)
        except OSError as failed:
            value.setdefault('persistence_errors',[]).append(exception_value(failed,'retain-'+name))
    return value

def control_path(scope,name):
    roots={'record':RECORD,'courier':COURIER}
    if scope not in roots or not isinstance(name,str) or len(name)>500:
        raise ValueError('Select the original record or a named courier control')
    parts=pathlib.PurePosixPath(name).parts
    if (not parts or name!=pathlib.PurePosixPath(name).as_posix() or name.startswith('/')
            or any(part in ('.','..','') for part in parts)):
        raise ValueError('Select an original relative control path')
    if scope=='courier' and name not in (COURIER_CONTROLS|{
            'custody.json','pre-dispatch-checkpoint.json','checkpoint-restore.json',
            'native-observation.json','native-finalization-error.txt','native-postprocess-error.txt',
            'archive.json','upload-attempt.json','upload-request.json'}):
        raise ValueError('This courier member is not a readable control')
    if scope=='record' and name=='.lock':
        raise ValueError('The native record lock is not a readable control')
    root=roots[scope]
    if root.is_symlink() or root.resolve()!=root:
        raise ValueError('Original control root is not canonical')
    path=root
    for part in parts:
        path=path/part
        if path.is_symlink():raise ValueError('Control paths may not traverse links')
    return path

def read_stable(path,maximum=CHECKPOINT_FILE_MAX):
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        before=os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size>maximum:
            raise ValueError('Original control exceeds its declared regular-file limit')
        chunks=[];remaining=before.st_size
        while remaining:
            raw=os.read(descriptor,min(65536,remaining))
            if not raw:raise ValueError('Original control ended during its read')
            chunks.append(raw);remaining-=len(raw)
        after=os.fstat(descriptor)
        if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(
                after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):
            raise ValueError('Original control changed during its read')
        raw=b''.join(chunks)
        return raw,{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
                    'mode':stat.S_IMODE(before.st_mode)&0o777}
    finally:os.close(descriptor)

def control_read(request):
    if set(request)-{'action','scope','path','offset','limit','sha256'}:
        raise ValueError('Unexpected control read selection')
    offset=request.get('offset',0);limit=request.get('limit',16384)
    if (isinstance(offset,bool) or not isinstance(offset,int) or offset<0
            or isinstance(limit,bool) or not isinstance(limit,int) or not 1<=limit<=32768):
        raise ValueError('Use a nonnegative byte offset and a limit from 1 to 32768')
    path=control_path(request.get('scope'),request.get('path'))
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        before=os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size>32*1024*1024:
            raise ValueError('Original control exceeds its 32 MiB record envelope')
        if offset>before.st_size:raise ValueError('Offset exceeds the original control')
        h=hashlib.sha256()
        while True:
            block=os.read(descriptor,65536)
            if not block:break
            h.update(block)
        data=os.pread(descriptor,limit,offset)
        after=os.fstat(descriptor)
        if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(
                after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):
            raise ValueError('Original control changed during its read')
        checksum=h.hexdigest()
        if request.get('sha256') is not None and request['sha256']!=checksum:
            raise ValueError('The selected control changed; inspect its new identity')
        return {'scope':request['scope'],'path':request['path'],'bytes':before.st_size,
                'sha256':checksum,'offset':offset,'data_base64':base64.b64encode(data).decode(),
                'next_offset':offset+len(data) if offset+len(data)<before.st_size else None}
    finally:os.close(descriptor)

def source_identity(value):
    return {key:value[key] for key in ('schema','sourceRef','commissioningRef','directory')}|{
        'files':{name:{key:row[key] for key in ('gitBlob','sha256','bytes')}
                 for name,row in value['files'].items()},'missing':value['missing']}

def native_status(native=None):
    value={'operation_id':OPERATION,'record':str(RECORD),'observed_at':now(),
           'report':None,'result':None,'request':None,'resume_request':None,
           'recovery_reasons':[],'error_details':LAST_ERROR}
    try:
        native=native or native_module()
        report=observe(native)
        value['report']=summary(report or {})
    except Exception as error:
        report=None
        value['inspection_error']=exception_value(error,'native-inspect')
        value['recovery_reasons'].append('Original native owner inspection did not complete')
    request=None;state={};terminal=None
    for name in ('request.json','state.json','result.json'):
        path=RECORD/name
        try:
            if not path.exists() and not path.is_symlink():continue
            raw,identity=read_stable(control_path('record',name))
            parsed=json.loads(raw)
            if not isinstance(parsed,dict):raise ValueError('Native control is not an object')
            if name=='request.json':
                request=parsed
                value['request']={'path':name,**identity,'operation_id':parsed.get('intent',{}).get('operation_id'),
                                  'created_at':parsed.get('created_at')}
            elif name=='state.json':state=parsed
            else:
                terminal=parsed
                keys=('state','error','error_type','errno','error_stage','message','ended_at','exit_code')
                value['result']={'path':name,**identity,'value':{k:parsed[k] for k in keys if k in parsed}}
        except Exception as error:
            value.setdefault('control_errors',[]).append({'path':name,**exception_value(error,'native-control')})
            value['recovery_reasons'].append('An original native control could not be read')
    if value['error_details'] is None:
        try:value['error_details']=read_json(COURIER/'native-launch-error.json')
        except Exception as error:value['error_read_error']=exception_value(error,'courier-error')
    value['registration']='retained' if request else 'not-created'
    if request and (request.get('intent',{}).get('operation_id')!=OPERATION or
            request.get('intent',{}).get('project')!=str(PROJECT) or (native is not None and native.run_path(OPERATION,RECORDS)!=RECORD)):
        value['recovery_reasons'].append('The original request identity differs')
    if report and (report.get('supervisor_alive') or report.get('process_alive')):
        value['recovery_reasons'].append('The original native owner is live')
    markers=[name for name in DISPATCH_MARKERS if (RECORD/name).exists() or (RECORD/name).is_symlink()]
    if state.get('process') or markers:
        value['recovery_reasons'].append('The original command has dispatch, completion or stop state')
    if terminal and terminal.get('state')!='launch_failed':
        value['recovery_reasons'].append('The retained result belongs to an already-started or completed command')
    if not terminal and request and native is not None and state.get('state') not in set(native.CAPACITY_RESUMABLE_STATES)|{'starting'}:
        value['recovery_reasons'].append('The original state is not a pre-dispatch capacity state')
    try:
        progress=read_json(RESTORE_PROGRESS)
        if progress and progress.get('state')!='complete':
            value['recovery_reasons'].append('Finish the exact selected checkpoint restoration first')
            value['restore_pending']={key:progress.get(key) for key in ('state','sha256','source')}
    except Exception as error:
        value['recovery_reasons'].append('Checkpoint restoration control could not be read')
        value['restore_error']=exception_value(error,'restore-control')
    value['dispatch_markers']=markers
    if not value['recovery_reasons']:
        value['resume_request']={'action':'resume-native'}
        if terminal:value['resume_request']['recover_failure']=value['result']['sha256']
    if LAST_CHECKPOINT:
        value['checkpoint']={k:LAST_CHECKPOINT[k] for k in ('path','bytes','sha256','compressed_bytes','compressed_sha256','shared_path','shared_persistence_error') if k in LAST_CHECKPOINT}
    return value

def retained_launch_bytes():
    current=pathlib.Path(__file__).read_bytes()
    original=PROJECT/'NATIVE_LAUNCH.py'
    if not original.exists():return current
    raw,identity=read_stable(original)
    current_sha=hashlib.sha256(current).hexdigest()
    if identity['sha256']!=current_sha and identity['sha256'] not in PREVIOUS_LAUNCHES:
        raise ValueError('Retained native launcher is not this courier or its exact published predecessor')
    if identity['sha256']!=current_sha:
        value={'schema':'stellar-forge.wordpress-native-courier-adoption.v1','operation_id':OPERATION,
               'original_artifact_sha256':identity['sha256'],'current_courier_sha256':current_sha,
               'sourceRef':SOURCE_REF,'commissioningRef':COMMISSIONING_REF,
               'native_command_unchanged':True}
        write_atomic(COURIER/'launcher-adoption.json',compact(value),same=True)
    return raw

def assert_restore_complete():
    progress=read_json(RESTORE_PROGRESS)
    if progress and progress.get('state')!='complete':
        raise ValueError('Resume the same checkpoint restoration before native recovery')

def checkpoint_build(native):
    # The native record lock is used only for this stable observation. It is
    # released before original resume_capacity acquires its own lock.
    if RECORD.is_symlink() or RECORD.resolve()!=RECORD:
        raise ValueError('Original record root is not canonical')
    with native.run_lock(RECORD):
        status=native_status(native)
        if not status['request']:raise ValueError('The original request has not been written; retain the source carrier')
        if status['recovery_reasons']:raise ValueError('; '.join(status['recovery_reasons']))
        rows=[];total=0
        def retain(root,label,relative):
            nonlocal total
            path=root/relative
            if path.is_symlink():raise ValueError('Checkpoint refuses linked private controls')
            raw,identity=read_stable(path)
            total+=len(raw)
            if total>CHECKPOINT_FILE_MAX or len(rows)>=CHECKPOINT_FILES_MAX:
                raise ValueError('The original controls exceed this small checkpoint envelope')
            rows.append({'root':label,'path':relative,**identity,
                         'content_base64':base64.b64encode(raw).decode()})
        for base,dirs,names in os.walk(RECORD,followlinks=False):
            dirs.sort();names.sort();base=pathlib.Path(base)
            for name in dirs:
                if (base/name).is_symlink():raise ValueError('Native checkpoint directory is linked')
            for name in names:
                relative=(base/name).relative_to(RECORD).as_posix()
                if relative=='.lock':continue
                retain(RECORD,'record',relative)
        for base,dirs,names in os.walk(PROJECT,followlinks=False):
            base=pathlib.Path(base)
            for name in dirs:
                if (base/name).is_symlink():raise ValueError('A started project needs its full native continuation archive')
            for name in names:
                relative=(base/name).relative_to(PROJECT).as_posix()
                if relative not in PROJECT_CONTROLS:
                    raise ValueError('A started project needs its full native continuation archive')
        for name in sorted(PROJECT_CONTROLS):
            retain(PROJECT,'project',name)
        for name in sorted(COURIER_CONTROLS):
            memory=(compact(LAST_ERROR) if name=='native-launch-error.json' and LAST_ERROR else
                    LAST_ERROR_TRACE if name=='native-launch-error.txt' and LAST_ERROR_TRACE is not None else None)
            if memory is not None:
                total+=len(memory)
                if total>CHECKPOINT_FILE_MAX or len(rows)>=CHECKPOINT_FILES_MAX:
                    raise ValueError('The original controls exceed this small checkpoint envelope')
                rows.append({'root':'courier','path':name,'bytes':len(memory),'mode':0o600,
                             'sha256':hashlib.sha256(memory).hexdigest(),
                             'content_base64':base64.b64encode(memory).decode()})
            elif (COURIER/name).exists():retain(COURIER,'courier',name)
        source=read_json(PROJECT/'SOURCE_CLOSURE.json')
        if (source.get('sourceRef')!=SOURCE_REF or source.get('commissioningRef')!=COMMISSIONING_REF
                or source.get('directory')!='/dev/83dd-wordpress-release/source' or source.get('missing')):
            raise ValueError('Original selected source is not complete')
        host=read_json(PROJECT/'HOST_CLOSURE.json')
        value={'schema':CHECKPOINT_SCHEMA,'operation_id':OPERATION,'record':str(RECORD),'project':str(PROJECT),
               'sourceRef':SOURCE_REF,'commissioningRef':COMMISSIONING_REF,
               'source_identity_sha256':hashlib.sha256(compact(source_identity(source))).hexdigest(),
               'host_closure_sha256':digest(PROJECT/'HOST_CLOSURE.json'),
               'host_packet_sha256':host.get('packetSha256'),
               'native_failure_sha256':status['result']['sha256'] if status['result'] else None,
               'request_sha256':status['request']['sha256'],'resume_request':status['resume_request'],
               'files':sorted(rows,key=lambda row:(row['root'],row['path']))}
        raw=compact(value)
        if len(raw)>CHECKPOINT_MAX:raise ValueError('Checkpoint JSON exceeds its transport envelope')
        return raw

def retain_checkpoint(native,*,emit_frames=False):
    global LAST_CHECKPOINT,LAST_EMITTED_CHECKPOINT
    raw=checkpoint_build(native)
    compressed=zlib.compress(raw,6)
    identity={'path':str(CHECKPOINT_PATH),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
              'compressed_bytes':len(compressed),'compressed_sha256':hashlib.sha256(compressed).hexdigest(),
              'encoding':'zlib+base64','data':raw,'compressed':compressed}
    LAST_CHECKPOINT=identity
    try:write_atomic(CHECKPOINT_PATH,raw)
    except OSError as error:identity['persistence_error']=exception_value(error,'checkpoint-write')
    try:
        write_atomic(SHARED_CHECKPOINT,raw)
        identity['shared_path']=str(SHARED_CHECKPOINT)
    except OSError as error:
        identity['shared_persistence_error']=exception_value(error,'shared-checkpoint-write')
    metadata={key:identity[key] for key in ('path','bytes','sha256','compressed_bytes','compressed_sha256','encoding')}
    for key in ('shared_path','shared_persistence_error'):
        if key in identity:metadata[key]=identity[key]
    if identity.get('persistence_error'):metadata['persistence_error']=identity['persistence_error']
    emit({'event':'checkpoint-ready','operation_id':OPERATION,'checkpoint':metadata})
    if emit_frames and LAST_EMITTED_CHECKPOINT!=identity['sha256']:
        # A caller can retain these complete frames even if this private
        # namespace subsequently vanishes. They are private control data.
        emit({'action':'checkpoint-begin','operation_id':OPERATION,**metadata})
        for offset in range(0,len(compressed),12288):
            data=compressed[offset:offset+12288]
            emit({'action':'checkpoint-write','sha256':identity['sha256'],'offset':offset,
                  'data_base64':base64.b64encode(data).decode()})
        emit({'action':'checkpoint-commit','sha256':identity['sha256'],
              'compressed_sha256':identity['compressed_sha256']})
        LAST_EMITTED_CHECKPOINT=identity['sha256']
    return metadata

def checkpoint_read(request):
    if set(request)-{'action','sha256','offset','limit'}:
        raise ValueError('Unexpected checkpoint read selection')
    selected=LAST_CHECKPOINT
    if selected is None:
        raw,_=read_stable(CHECKPOINT_PATH,CHECKPOINT_MAX)
        compressed=zlib.compress(raw,6)
        selected={'data':raw,'sha256':hashlib.sha256(raw).hexdigest(),'compressed':compressed,
                  'compressed_bytes':len(compressed),'compressed_sha256':hashlib.sha256(compressed).hexdigest()}
    if request.get('sha256')!=selected['sha256']:
        raise ValueError('Select the exact retained checkpoint SHA-256')
    offset=request.get('offset',0);limit=request.get('limit',12288)
    if (isinstance(offset,bool) or not isinstance(offset,int) or offset<0
            or isinstance(limit,bool) or not isinstance(limit,int) or not 1<=limit<=32768):
        raise ValueError('Use a nonnegative checkpoint offset and a limit from 1 to 32768')
    raw=selected['compressed']
    if offset>len(raw):raise ValueError('Checkpoint offset exceeds its original bytes')
    chunk=raw[offset:offset+limit]
    return {'sha256':selected['sha256'],'encoding':'zlib+base64','compressed_sha256':selected['compressed_sha256'],
            'compressed_bytes':len(raw),'offset':offset,'data_base64':base64.b64encode(chunk).decode(),
            'next_offset':offset+len(chunk) if offset+len(chunk)<len(raw) else None}

def restore_checkpoint(checkpoint_path,expected):
    if not isinstance(expected,str) or len(expected)!=64:
        raise ValueError('Select the exact original checkpoint SHA-256')
    raw,identity=read_stable(pathlib.Path(checkpoint_path),CHECKPOINT_MAX)
    if identity['sha256']!=expected:raise ValueError('Checkpoint digest differs')
    value=json.loads(raw)
    if (value.get('schema')!=CHECKPOINT_SCHEMA or value.get('operation_id')!=OPERATION
            or value.get('record')!=str(RECORD) or value.get('project')!=str(PROJECT)
            or value.get('sourceRef')!=SOURCE_REF or value.get('commissioningRef')!=COMMISSIONING_REF):
        raise ValueError('Checkpoint does not bind this original operation and source')
    rows=value.get('files')
    if not isinstance(rows,list) or not 1<=len(rows)<=CHECKPOINT_FILES_MAX:
        raise ValueError('Checkpoint has an invalid complete control selection')
    roots={'record':RECORD,'project':PROJECT,'courier':COURIER}
    prepared=[];seen=set();total=0
    for row in rows:
        label=row.get('root');name=row.get('path')
        if label not in roots or not isinstance(name,str):
            raise ValueError('Checkpoint member root is not selected')
        parts=pathlib.PurePosixPath(name).parts
        if (not parts or name!=pathlib.PurePosixPath(name).as_posix() or name.startswith('/')
                or any(part in ('.','..','') for part in parts)):
            raise ValueError('Checkpoint member path is not an original control')
        if label=='project' and name not in PROJECT_CONTROLS:
            raise ValueError('Checkpoint contains a noninitial project file')
        if label=='courier' and name not in COURIER_CONTROLS:
            raise ValueError('Checkpoint contains an unselected courier file')
        if label=='record' and (name in DISPATCH_MARKERS or name=='.lock'):
            raise ValueError('Started commands require their complete original native archive')
        key=(label,name)
        if key in seen:raise ValueError('Duplicate checkpoint member')
        seen.add(key)
        data=base64.b64decode(row.get('content_base64',''),validate=True)
        if (isinstance(row.get('bytes'),bool) or not isinstance(row.get('bytes'),int)
                or len(data)!=row['bytes'] or len(data)>CHECKPOINT_FILE_MAX
                or hashlib.sha256(data).hexdigest()!=row.get('sha256')
                or base64.b64encode(data).decode()!=row.get('content_base64')):
            raise ValueError('Original checkpoint member identity differs')
        mode=row.get('mode')
        if isinstance(mode,bool) or not isinstance(mode,int) or not 0<=mode<=0o777:
            raise ValueError('Checkpoint member mode differs')
        total+=len(data)
        if total>CHECKPOINT_FILE_MAX:raise ValueError('Checkpoint controls exceed the original envelope')
        prepared.append((label,name,data,row))
    payload={(label,name):data for label,name,data,_ in prepared}
    if not {('record','request.json'),('record','state.json')}|{('project',name) for name in PROJECT_CONTROLS}<=seen:
        raise ValueError('Checkpoint is missing original request or source controls')
    request=json.loads(payload['record','request.json'])
    intent=request.get('intent',{})
    state=json.loads(payload['record','state.json'])
    result=json.loads(payload['record','result.json']) if ('record','result.json') in payload else None
    if (intent.get('operation_id')!=OPERATION or intent.get('project')!=str(PROJECT)
            or hashlib.sha256(payload['record','request.json']).hexdigest()!=value.get('request_sha256')
            or state.get('process') or (result and result.get('state')!='launch_failed')):
        raise ValueError('Checkpoint request or native outcome is not an original pre-dispatch state')
    failure=hashlib.sha256(payload['record','result.json']).hexdigest() if result else None
    if failure!=value.get('native_failure_sha256'):
        raise ValueError('Checkpoint original failure selection differs')
    resume={'action':'resume-native',**({'recover_failure':failure} if failure else {})}
    if value.get('resume_request')!=resume:raise ValueError('Checkpoint original resume request differs')
    selected_source=json.loads(payload['project','SOURCE_CLOSURE.json'])
    current_source=read_json(HERE/'SOURCE_CLOSURE.json')
    if (selected_source.get('missing') or
            hashlib.sha256(compact(source_identity(selected_source))).hexdigest()!=value.get('source_identity_sha256')
            or source_identity(current_source)!=source_identity(selected_source)):
        raise ValueError('Prepare the complete exact original source before restoring controls')
    if ((HERE/'host-selection.json').read_bytes()!=payload['project','host-selection.json']
            or (HERE/'HOST_CLOSURE.json').read_bytes()!=payload['project','HOST_CLOSURE.json']
            or hashlib.sha256(payload['project','HOST_CLOSURE.json']).hexdigest()!=value.get('host_closure_sha256')
            or digest(HERE/'host-finalizer.json')!=value.get('host_packet_sha256')):
        raise ValueError('Prepare the original selected native host and source inputs')
    launcher_sha=hashlib.sha256(payload['project','NATIVE_LAUNCH.py']).hexdigest()
    if launcher_sha not in PREVIOUS_LAUNCHES|{digest(pathlib.Path(__file__))}:
        raise ValueError('Checkpoint native launcher is not the original published courier')
    native=native_module()
    if request.get('schema')!=native.SCHEMA:
        raise ValueError('Checkpoint does not contain the selected native request schema')
    expected_command=['/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node',
                      '/dev/83dd-wordpress-release/source/stellar/scf-starforge-20261009/sf30-seller-sdk/wordpress/native/testnet.mjs',
                      '--input',str(PROJECT/'host-selection.json')]
    if intent.get('command')!=expected_command:
        raise ValueError('Checkpoint native command differs from the original commissioning')
    if RECORD.is_symlink() or RECORD.resolve()!=RECORD:
        raise ValueError('Original record root is not canonical')
    COURIER.mkdir(parents=True,exist_ok=True,mode=0o700)
    if COURIER.is_symlink() or COURIER.resolve()!=COURIER:raise ValueError('Original courier root differs')
    with open(COURIER/'.owner.lock','a+b') as owner:
        fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with native.run_lock(RECORD):
            current=observe(native)
            if current and (current.get('supervisor_alive') or current.get('process_alive')):
                raise ValueError('Preserve the live original native owner')
            progress=read_json(RESTORE_PROGRESS)
            if progress and progress.get('sha256')!=expected:
                raise ValueError('A different original checkpoint restore is retained')
            # Validate all destinations and existing original bytes before the
            # first restore write. No original control is replaced.
            for label,name,data,row in prepared:
                root=roots[label]
                if root.is_symlink() or root.resolve()!=root:raise ValueError('Restore root is not canonical')
                destination=root
                for part in pathlib.PurePosixPath(name).parts:
                    destination=destination/part
                    if destination.is_symlink():raise ValueError('Restore may not traverse private links')
                if destination.exists():
                    existing,_=read_stable(destination)
                    if existing!=data:raise ValueError('Existing original control advanced or differs: '+str(destination))
            for base,dirs,names in os.walk(RECORD,followlinks=False):
                base=pathlib.Path(base)
                if any((base/name).is_symlink() for name in dirs):raise ValueError('Existing native controls are linked')
                for name in names:
                    relative=(base/name).relative_to(RECORD).as_posix()
                    if relative!='.lock' and ('record',relative) not in seen:
                        raise ValueError('Existing native state has additional controls; preserve it')
            for base,dirs,names in os.walk(PROJECT,followlinks=False):
                base=pathlib.Path(base)
                if any((base/name).is_symlink() for name in dirs):raise ValueError('Existing project has private donor links')
                for name in names:
                    if ('project',(base/name).relative_to(PROJECT).as_posix()) not in seen:
                        raise ValueError('Existing project has additional output; preserve its full continuation')
            journal={'schema':'stellar-forge.wordpress-native-control-restore.v1','state':'restoring',
                     'operation_id':OPERATION,'sha256':expected,'source':str(checkpoint_path)}
            write_atomic(RESTORE_PROGRESS,compact(journal))
            # Request visibility comes last. The restore journal prevents a
            # partial restoration from becoming a new native registration.
            for label,name,data,row in sorted(prepared,key=lambda item:(item[0]=='record' and item[1]=='request.json',item[0],item[1])):
                destination=roots[label]/name
                write_atomic(destination,data,same=True)
                os.chmod(destination,row['mode'])
            write_atomic(CHECKPOINT_PATH,raw)
            write_atomic(RESTORE_PROGRESS,compact({**journal,'state':'complete'}))
    emit({'event':'checkpoint-restored','operation_id':OPERATION,'sha256':expected,'files':len(prepared),
          'request_sha256':value['request_sha256'],'native_failure_sha256':failure,
          'status':native_status(native)})

def snapshot_files(root,prefix):
    """Record physical private files; donor links remain references, never walks."""
    files=[];directories=[];links=[];special=[]
    if not root.exists():
        return files,directories,links,special
    if root.is_symlink() or not root.is_dir() or root.resolve()!=root:
        raise ValueError('Expected original private directory: '+str(root))
    for base,dirs,names in os.walk(root,followlinks=False):
        dirs.sort();names.sort()
        base=pathlib.Path(base)
        retained=[]
        for name in dirs:
            path=base/name;st=path.lstat();relative=path.relative_to(root).as_posix()
            if stat.S_ISLNK(st.st_mode):
                links.append({'path':prefix+'/'+relative,'target':os.readlink(path),
                              'resolved':str(path.resolve(strict=False))})
            elif stat.S_ISDIR(st.st_mode):
                directories.append({'path':prefix+'/'+relative,'mode':stat.S_IMODE(st.st_mode)})
                retained.append(name)
            else:
                raise ValueError('Unrecognized private directory member')
        dirs[:]=retained
        for name in names:
            path=base/name;st=path.lstat();relative=path.relative_to(root).as_posix()
            member=prefix+'/'+relative
            if stat.S_ISLNK(st.st_mode):
                links.append({'path':member,'target':os.readlink(path),'resolved':str(path.resolve(strict=False))})
            elif stat.S_ISREG(st.st_mode):
                files.append({'path':member,'bytes':st.st_size,'mode':stat.S_IMODE(st.st_mode),
                              'sha256':digest(path),'source':str(path),
                              'identity':[st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns]})
            else:
                special.append({'path':member,'mode':stat.S_IFMT(st.st_mode)})
    return files,directories,links,special

def create_archive(report,child_code):
    target=COURIER/ARCHIVE_NAME
    prior=read_json(COURIER/'archive.json')
    if prior:
        if (prior.get('operation_id')!=OPERATION or not target.is_file() or target.is_symlink()
                or target.stat().st_size!=prior['bytes'] or digest(target)!=prior['sha256']):
            raise ValueError('Original retained archive identity differs')
        return prior
    if target.exists():
        if target.is_symlink() or not target.is_file():
            raise ValueError('Original archive path is not a regular file')
        with zipfile.ZipFile(target) as previous:
            manifest=json.loads(previous.read('MANIFEST.json'))
            rows={row['path']:row for row in manifest['files']}
            names=previous.namelist()
            if (manifest.get('schema')!='stellar-forge.wordpress-native-private-archive.v1'
                    or manifest.get('operation_id')!=OPERATION
                    or manifest.get('roots')!={'project':str(PROJECT),'record':str(RECORD)}
                    or len(names)!=len(set(names)) or set(names)!=set(rows)|{'MANIFEST.json','README.txt'}
                    or manifest.get('native')!=summary(report or {})):
                raise ValueError('Interrupted original archive publication differs')
            for name,row in rows.items():
                h=hashlib.sha256();count=0
                with previous.open(name) as stream:
                    for chunk in iter(lambda:stream.read(1024*1024),b''):
                        h.update(chunk);count+=len(chunk)
                if count!=row['bytes'] or h.hexdigest()!=row['sha256']:
                    raise ValueError('Interrupted archive member differs')
        result={'operation_id':OPERATION,'filename':ARCHIVE_NAME,'bytes':target.stat().st_size,
                'sha256':digest(target),'files':len(rows),'private_bytes':manifest['private_bytes'],
                'links':len(manifest.get('links',[])),'created_at':manifest['created_at']}
        write_atomic(COURIER/'archive.json',compact(result),same=True)
        return result
    # Only this locked courier owns its reproducible interrupted archive temps.
    for pending in COURIER.glob('.native-archive-*.zip'):
        if pending.is_file() and not pending.is_symlink():pending.unlink()
    report_value={'schema':SCHEMA,'operation_id':OPERATION,'observed_at':now(),
                  'native':report,'carrier_exit_code':child_code,
                  'sourceRef':'f167c3e524b782ceb6dd196df81f6b97886442a9',
                  'commissioningRef':'4c62463acfae23b50fb3327d7eafeb087e8b4806'}
    write_atomic(COURIER/'native-observation.json',compact(report_value))
    files=[];directories=[];links=[];special=[]
    for root,prefix in ((PROJECT,'project'),(RECORD,'record')):
        f,d,l,s=snapshot_files(root,prefix)
        files+=f;directories+=d;links+=l;special+=s
    for name in ('native-observation.json','native-launch.log','native-finalization-error.txt','native-launch-error.txt','original-host-selection.json','original-source-closure.json','original-finalizer-host.json'):
        path=COURIER/name
        if path.is_file() and not path.is_symlink():
            st=path.stat()
            files.append({'path':'courier/'+name,'bytes':st.st_size,'mode':0o600,
                          'sha256':digest(path),'source':str(path),
                          'identity':[st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns]})
    raw_bytes=sum(row['bytes'] for row in files)
    if raw_bytes>MAX_PRIVATE:
        raise ValueError('Private continuation exceeds the declared 176 MiB snapshot envelope')
    manifest={
        'schema':'stellar-forge.wordpress-native-private-archive.v1','operation_id':OPERATION,
        'created_at':now(),'roots':{'project':str(PROJECT),'record':str(RECORD)},
        'sourceRef':report_value['sourceRef'],'commissioningRef':report_value['commissioningRef'],
        'native':summary(report or {}),'files':[{k:v for k,v in row.items() if k not in ('source','identity')} for row in files],
        'directories':directories,'links':links,'special_entries':special,'private_bytes':raw_bytes,
        'restore':'Use the published carrier launch.py --restore ARCHIVE --sha256 EXACT_SHA256 after its original source preparation. This restores exact private files and original donor links; it never starts a task.'}
    readme=(
        'Original WordPress native private continuation\n\n'
        'This archive contains the actual stopped native record and private project, including dedicated testnet credentials and original buyer/session state. Keep it private.\n'
        'The public source remains at the two exact source refs in MANIFEST.json. Prepare that source using the original published four-input carrier before restoring. Its runtime dependencies remain original selected references.\n'
        'Run the same carrier launch.py --restore /absolute/archive.zip --sha256 <actual saved archive digest>. The restorer validates all physical file hashes and refuses differing existing private files. It restores recorded donor links after exact archive verification; it does not traverse or package those donors.\n'
        'Then inspect the original native operation and actual result. A completed result stays completed. An undispatched interrupted queue uses the original resume-capacity API. A started terminal or interrupted command retains its exact original WordPress/approval/acquisition state for the already published native testnet continuation, with its actual carrier lineage retained.\n'
        'No provider action is performed by extraction or inspection. Native business continuation uses the original testnet host and original account, budget, release, page and payment identities.\n').encode()
    fd,temp=tempfile.mkstemp(prefix='.native-archive-',suffix='.zip',dir=COURIER)
    os.close(fd);os.chmod(temp,0o600)
    try:
        with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
            for row in files:
                source=pathlib.Path(row['source'])
                descriptor=os.open(source,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
                with os.fdopen(descriptor,'rb') as inp:
                    before=os.fstat(inp.fileno())
                    if [before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns]!=row['identity']:
                        raise ValueError('Private source changed before archiving')
                    info=zipfile.ZipInfo(row['path']);info.compress_type=zipfile.ZIP_DEFLATED
                    info.external_attr=(stat.S_IFREG|row['mode'])<<16
                    h=hashlib.sha256();count=0
                    with archive.open(info,'w',force_zip64=True) as out:
                        for chunk in iter(lambda:inp.read(1024*1024),b''):
                            h.update(chunk);count+=len(chunk);out.write(chunk)
                    after=os.fstat(inp.fileno())
                    if (h.hexdigest()!=row['sha256'] or count!=row['bytes'] or
                            [after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns]!=row['identity']):
                        raise ValueError('Private source changed during archiving')
            archive.writestr('MANIFEST.json',compact(manifest))
            archive.writestr('README.txt',readme)
        with open(temp,'rb') as stream:os.fsync(stream.fileno())
        size=os.stat(temp).st_size
        if size>MAX_ARCHIVE:
            raise ValueError('Complete archive exceeds original courier disk declaration')
        result={'operation_id':OPERATION,'filename':ARCHIVE_NAME,'bytes':size,'sha256':digest(temp),
                'files':len(files),'private_bytes':raw_bytes,'links':len(links),'created_at':now()}
        try:os.link(temp,target)
        except FileExistsError:
            if target.is_symlink() or target.stat().st_size!=size or digest(target)!=result['sha256']:
                raise ValueError('Concurrent original archive differs')
        write_atomic(COURIER/'archive.json',compact(result),same=True)
        return result
    finally:
        if os.path.exists(temp):os.unlink(temp)

def finalized_result(raw,archive):
    decoder=json.JSONDecoder();found=None
    for offset,ch in enumerate(raw):
        if ch!='{':continue
        try:value,_=decoder.raw_decode(raw,offset)
        except json.JSONDecodeError:continue
        if isinstance(value,dict) and isinstance(value.get('results'),list):
            found=value
    if not found or len(found['results'])!=1:
        return None
    row=found['results'][0]
    expected=str(COURIER/ARCHIVE_NAME)
    if (not isinstance(row,dict) or row.get('status')!='succeeded'
            or row.get('local_path')!=expected or row.get('purpose')!='create_library_file'
            or not isinstance(row.get('library_file_id'),str) or not row['library_file_id'].startswith('libfile_')
            or not isinstance(row.get('file_id'),str) or not row['file_id'].startswith('file_')
            or type(row.get('current_version_number')) is not int or row['current_version_number']<0
            or not isinstance(row.get('path'),str) or row.get('file_name')!=ARCHIVE_NAME):
        return None
    return {key:row[key] for key in ('library_file_id','file_id','current_version_number','path',
                                     'file_name','status','local_metadata_applied') if key in row}

def upload_archive(archive):
    temporary=COURIER/'helper-tmp'
    temporary.mkdir(parents=True,exist_ok=True,mode=0o700)
    if temporary.is_symlink() or temporary.resolve()!=temporary:
        raise ValueError('Library staging must remain in this courier private directory')
    helper_environment=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',
                            TMPDIR=str(temporary),TMP=str(temporary),TEMP=str(temporary))
    request_path=COURIER/'upload-request.json'
    stdout=COURIER/'upload.stdout';stderr=COURIER/'upload.stderr'
    previous=read_json(COURIER/'upload-attempt.json')
    request={'uploads':[{'local_path':str(COURIER/ARCHIVE_NAME),'purpose':'create_library_file',
                         'library_artifact_type':'other'}]}
    request_hash=hashlib.sha256(compact(request)).hexdigest()
    if previous:
        if (previous.get('operation_id')!=OPERATION or previous.get('archive_sha256')!=archive['sha256']
                or previous.get('request_sha256')!=request_hash):
            raise ValueError('The original upload request or archive identity changed')
        raw=stdout.read_text(encoding='utf-8',errors='replace') if stdout.exists() else ''
        finalized=finalized_result(raw,archive)
        if finalized:return finalized
        if previous.get('state')!='helper-not-started':
            # A process may have begun or accepted the provider action. Reconcile
            # that exact original helper result instead of creating again.
            return None
    write_atomic(request_path,compact(request),same=True)
    attempt={**(previous or {}),'operation_id':OPERATION,'archive_sha256':archive['sha256'],
             'started_at':(previous or {}).get('started_at',now()),'request_sha256':request_hash,
             'state':'starting','launch_attempt':(previous or {}).get('launch_attempt',0)+1}
    attempt.pop('error',None);attempt.pop('errno',None);attempt.pop('ended_at',None)
    write_atomic(COURIER/'upload-attempt.json',compact(attempt))
    child=None;launch_invoked=False
    try:
        with open(stdout,'wb',buffering=0) as out,open(stderr,'wb',buffering=0) as err:
            bootstrap=("import os,runpy,sys,tempfile; "
                       "tempfile.tempdir=os.environ['TMPDIR']; "
                       "sys.path.insert(0,"+repr(str(LIBRARY))+"); "
                       "sys.argv=["+repr(str(HELPER))+"]; "
                       "runpy.run_path("+repr(str(HELPER))+",run_name='__main__')")
            # Popen returning is the positive process-start boundary. A definite
            # exception before a child is returned records helper-not-started.
            launch_invoked=True
            child=subprocess.Popen([sys.executable,'-B','-c',bootstrap],stdin=subprocess.PIPE,
                                   stdout=out,stderr=err,close_fds=True,env=helper_environment)
            attempt.update(state='running',pid=child.pid)
            write_atomic(COURIER/'upload-attempt.json',compact(attempt))
            child.communicate(input=compact(request))
            attempt.update(state='returned',returncode=child.returncode,ended_at=now())
            write_atomic(COURIER/'upload-attempt.json',compact(attempt))
    except BaseException as error:
        # A started helper must end before this same supervisor can release the
        # archive/helper reservation. If stdin was not delivered, closing it
        # makes that original helper return; its response remains authoritative.
        if child is not None and child.poll() is None:
            try:child.communicate()
            except BaseException:
                if child.stdin is not None:child.stdin.close()
                child.wait()
        definitely_not_started=child is None and (not launch_invoked or isinstance(error,OSError))
        attempt.update(state='helper-not-started' if definitely_not_started else 'uncertain',
                       ended_at=now(),error=type(error).__name__)
        if isinstance(error,OSError):attempt['errno']=error.errno
        write_atomic(COURIER/'upload-attempt.json',compact(attempt))
        try:write_atomic(COURIER/'upload-error.txt',traceback.format_exc().encode())
        except OSError:pass
    raw=stdout.read_text(encoding='utf-8',errors='replace') if stdout.exists() else ''
    return finalized_result(raw,archive)

def publish_receipt(archive,result,native_report):
    global FINAL_CUSTODY
    value={'schema':SCHEMA,'operation_id':OPERATION,'state':'saved','observed_at':now(),
           'archive':archive,'library':result,'native':summary(native_report or {}),
           'private_record':str(RECORD),'private_project':str(PROJECT)}
    FINAL_CUSTODY=value
    emit({'event':'saved','receipt':value})
    try:save(value)
    except OSError as error:emit({'event':'private-custody-receipt-pending','errno':error.errno})
    try:
        write_atomic(SHARED,compact(value))
        emit({'event':'custody-receipt','path':str(SHARED),'archive_sha256':archive['sha256']})
    except OSError as error:
        emit({'event':'custody-receipt-pending','errno':error.errno,
              'private_receipt':str(KEEP),'archive_sha256':archive['sha256'],
              'library_file_id':result['library_file_id']})
    return value

def resume_undispatched(request):
    """Select only the original native pre-dispatch recovery contract."""
    if set(request)-{'action','recover_failure'} or request.get('action')!='resume-native':
        raise ValueError('Use only the original resume-native failure selection')
    native=native_module()
    status=native_status(native)
    if status['resume_request'] is None:
        raise ValueError('; '.join(status['recovery_reasons']))
    if request!=status['resume_request']:
        raise ValueError('Use the exact current resume_request from status')
    # The original resume_capacity rechecks owners, source, exact failure digest,
    # recovery eligibility and registration under its own record lock.
    return run_native(native,recover_failure=request.get('recover_failure'))

def hold(state,*,reservation_live=False):
    """Keep the original namespace for native recovery or exact save custody."""
    try:save(state)
    except OSError:pass
    def selected():
        return {'state':state.get('state'),'operation_id':OPERATION,'archive':state.get('archive'),
                'native':native_status(),'private_custody':str(KEEP),
                'reservation_live':reservation_live}
    def checkpoint():
        if not reservation_live and state.get('state')=='native-owner-recovery':
            try:retain_checkpoint(native_module(),emit_frames=True)
            except Exception as error:
                emit({'event':'checkpoint-unavailable','operation_id':OPERATION,
                      'error':exception_value(error,'control-checkpoint')})
    emit({'event':'retained','state':selected()})
    checkpoint()
    while True:
        try:ready,_,_=select.select([sys.stdin],[],[],45)
        except (OSError,ValueError):ready=[]
        if not ready:
            emit({'event':'retained','state':selected()})
            continue
        line=sys.stdin.readline()
        if not line:
            time.sleep(45);continue
        request=None
        try:
            request=json.loads(line)
            if not isinstance(request,dict):raise ValueError('Use one original JSON action object')
            action=request.get('action')
            if action=='status':
                emit({'event':'retained','state':selected()});continue
            if action=='control-read':
                emit({'event':'control','value':control_read(request)});continue
            if action=='checkpoint-read':
                emit({'event':'checkpoint-range','value':checkpoint_read(request)});continue
            if action=='checkpoint' and not reservation_live:
                retain_checkpoint(native_module(),emit_frames=True);continue
            if (action=='resume-native' and not reservation_live
                    and state.get('state')=='native-owner-recovery'):
                report,code=resume_undispatched(request)
                saved=FINAL_CUSTODY or read_json(KEEP)
                if saved and saved.get('state')=='saved':
                    return saved
                state={**state,'native':report,'supervisor_exit_code':code}
                try:save(state)
                except OSError:pass
                emit({'event':'native-owner-recovery','native':native_status(),
                      'supervisor_exit_code':code,'operation_id':OPERATION})
                checkpoint()
                continue
            if (action=='retry-save' and reservation_live and state.get('archive')
                    and (read_json(COURIER/'upload-attempt.json') or {}).get('state')=='helper-not-started'):
                result=upload_archive(state['archive'])
                if result:
                    return publish_receipt(state['archive'],result,state.get('native'))
                emit({'event':'retained','state':selected()});continue
            if (action=='retry-custody' and reservation_live and not state.get('archive')):
                archive=create_archive(state.get('native'),state.get('native',{}).get('exit_code'))
                state={**state,'archive':archive,'state':'save-reconciliation'}
                save(state)
                result=upload_archive(archive)
                if result:return publish_receipt(archive,result,state.get('native'))
                continue
            if (action=='record-finalized' and state.get('archive')
                    and request.get('archive_sha256')==state['archive']['sha256']):
                raw=json.dumps({'results':[request.get('result')]})
                result=finalized_result(raw,state['archive'])
                if result:
                    write_atomic(COURIER/'reconciled-upload-result.json',compact(request),same=True)
                    return publish_receipt(state['archive'],result,state.get('native'))
            raise ValueError('Use status, control-read, checkpoint, checkpoint-read, or the exact eligible original recovery action')
        except Exception as error:
            emit({'event':'retained-error','error':exception_value(error,'courier-action'),
                  'state':selected()})
            if isinstance(request,dict) and request.get('action')=='resume-native':
                checkpoint()

def finalize_native(*,root,request,result,supervisor):
    """Save inside the original supervisor, after its native writers close."""
    global FINAL_CUSTODY
    if (pathlib.Path(root)!=RECORD or request['intent']['operation_id']!=OPERATION
            or type(result.get('exit_code')) is not int):
        raise ValueError('The finalizer received a different original native result')
    native=native_module()
    if native.alive(result.get('process')):
        raise ValueError('The original command is still alive')
    # The generic supervisor log is part of the frozen record. All callback
    # diagnostics use this private courier log; events use its retained pipe.
    for stream in (sys.stdout,sys.stderr):
        try:stream.flush()
        except OSError:pass
    report={**result,'operation_id':OPERATION,'record':str(RECORD),
            'supervisor_alive':True,'process_alive':False}
    archive=None
    try:
        descriptor=os.open(COURIER/'finalizer.log',os.O_CREAT|os.O_APPEND|os.O_WRONLY,0o600)
        try:os.dup2(descriptor,1);os.dup2(descriptor,2)
        finally:os.close(descriptor)
        write_atomic(COURIER/'terminal-observation.json',
                     compact({'native':report,'supervisor':supervisor,'reservation':'original-supervisor'}))
        archive=create_archive(report,result['exit_code'])
        save({'schema':SCHEMA,'operation_id':OPERATION,'state':'saving',
              'archive':archive,'native':report,'reservation':'original-supervisor'})
        saved=upload_archive(archive)
        if saved:
            FINAL_CUSTODY=publish_receipt(archive,saved,report)
        else:
            FINAL_CUSTODY=hold({'schema':SCHEMA,'operation_id':OPERATION,'state':'save-reconciliation',
                  'archive':archive,'native':report,'private_custody':str(KEEP),
                  'upload_response':str(COURIER/'upload.stdout'),'reservation':'original-supervisor'},
                  reservation_live=True)
    except BaseException as error:
        try:write_atomic(COURIER/'custody-error.txt',traceback.format_exc().encode())
        except OSError:pass
        FINAL_CUSTODY=hold({'schema':SCHEMA,'operation_id':OPERATION,'state':'custody-reconciliation',
              'archive':archive,'native':report,'error':type(error).__name__,
              'private_project':str(PROJECT),'private_record':str(RECORD),
              'private_custody':str(KEEP),'reservation':'original-supervisor'},reservation_live=True)
    if not FINAL_CUSTODY or FINAL_CUSTODY.get('state')!='saved':
        raise ValueError('The original private continuation has no actual saved receipt')
    return {'archive_sha256':FINAL_CUSTODY['archive']['sha256'],
            'library_file_id':FINAL_CUSTODY['library']['library_file_id'],
            'file_id':FINAL_CUSTODY['library']['file_id'],
            'version':FINAL_CUSTODY['library']['current_version_number']}

def restore(archive_path,expected):
    archive_path=pathlib.Path(archive_path).resolve(strict=True)
    if not expected or digest(archive_path)!=expected:
        raise ValueError('Select the actual saved archive SHA-256 before restoring private state')
    current=observe(native_module())
    if current and (current.get('supervisor_alive') or current.get('process_alive')):
        raise ValueError('The original native owner is active; preserve its current private files')
    with zipfile.ZipFile(archive_path) as archive:
        manifest=json.loads(archive.read('MANIFEST.json'))
        if (manifest.get('schema')!='stellar-forge.wordpress-native-private-archive.v1'
                or manifest.get('operation_id')!=OPERATION
                or manifest.get('roots')!={'project':str(PROJECT),'record':str(RECORD)}):
            raise ValueError('Archive does not bind this original operation and private roots')
        rows={row['path']:row for row in manifest['files']}
        names=archive.namelist()
        if len(names)!=len(set(names)) or set(names)!=set(rows)|{'MANIFEST.json','README.txt'}:
            raise ValueError('Archive member selection differs')
        if sum(row['bytes'] for row in rows.values())>MAX_PRIVATE:
            raise ValueError('Archive exceeds the original private envelope')
        roots={'project':PROJECT,'record':RECORD,'courier':COURIER}
        def target(member):
            parts=pathlib.PurePosixPath(member).parts
            if (len(parts)<2 or parts[0] not in roots or str(pathlib.PurePosixPath(member))!=member
                    or any(p in ('','..','.') for p in parts)):
                raise ValueError('Unexpected archive member path')
            root=roots[parts[0]]
            root.mkdir(parents=True,exist_ok=True,mode=0o700)
            if root.is_symlink() or root.resolve()!=root:
                raise ValueError('Private restore root is not canonical')
            destination=root.joinpath(*parts[1:])
            current=root
            for part in parts[1:-1]:
                current=current/part
                if current.is_symlink():raise ValueError('Restore parent is a symlink')
                current.mkdir(exist_ok=True,mode=0o700)
            return destination
        # Complete validation precedes any source mutation.
        for member,row in rows.items():
            info=archive.getinfo(member)
            if info.file_size!=row['bytes'] or stat.S_ISLNK(info.external_attr>>16):
                raise ValueError('Native archive member identity differs')
            with archive.open(member) as stream:
                h=hashlib.sha256()
                for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
            if h.hexdigest()!=row['sha256']:raise ValueError('Native archive member digest differs')
        for member,row in rows.items():
            destination=target(member)
            if destination.exists() or destination.is_symlink():
                if destination.is_symlink() or not destination.is_file() or digest(destination)!=row['sha256']:
                    raise ValueError('Existing private continuation differs: '+str(destination))
                continue
            fd,temp=tempfile.mkstemp(prefix='.'+destination.name+'.',dir=destination.parent)
            try:
                with os.fdopen(fd,'wb') as out,archive.open(member) as inp:
                    for chunk in iter(lambda:inp.read(1024*1024),b''):out.write(chunk)
                    out.flush();os.fsync(out.fileno())
                os.chmod(temp,row['mode']&0o777)
                try:os.link(temp,destination)
                except FileExistsError:
                    if destination.is_symlink() or digest(destination)!=row['sha256']:
                        raise ValueError('Concurrent restored bytes differ')
            finally:
                if os.path.exists(temp):os.unlink(temp)
        for row in manifest.get('directories',[]):
            destination=target(row['path'])
            if destination.is_symlink():raise ValueError('Existing private directory is a symlink')
            destination.mkdir(exist_ok=True,mode=row['mode']&0o777)
        for row in manifest.get('links',[]):
            destination=target(row['path'])
            if destination.is_symlink():
                if os.readlink(destination)!=row['target']:raise ValueError('Original donor link differs')
                continue
            if destination.exists():raise ValueError('Physical member replaces original donor link')
            source=pathlib.Path(row['target'])
            resolved=(source if source.is_absolute() else destination.parent/source).resolve(strict=True)
            if str(resolved)!=row['resolved']:raise ValueError('Original donor source moved')
            destination.symlink_to(row['target'],target_is_directory=resolved.is_dir())
    emit({'event':'restored','operation_id':OPERATION,'project':str(PROJECT),'record':str(RECORD),
          'archive_sha256':expected,'files':len(rows)})

def prepare_courier_inputs():
    for path in (HELPER,LIBRARY/'library_hosted_apps.py',LIBRARY/'library_file_transfer.py'):
        if not path.is_file():
            raise ValueError('Selected original installed Library helper is unavailable: '+str(path))
    write_atomic(COURIER/'original-host-selection.json',(HERE/'host-selection.json').read_bytes(),same=True)
    source_closure=(HERE/'SOURCE_CLOSURE.json').read_bytes()
    retained_closure=COURIER/'original-source-closure.json'
    if retained_closure.exists():
        def closure_identity(value):
            return {key:value[key] for key in ('schema','sourceRef','commissioningRef','directory')}|{
                'files':{name:{key:row[key] for key in ('gitBlob','sha256','bytes')}
                         for name,row in value['files'].items()},'missing':value['missing']}
        if closure_identity(read_json(retained_closure))!=closure_identity(json.loads(source_closure)):
            raise ValueError('Original selected source changed during courier continuation')
    else:
        write_atomic(retained_closure,source_closure,same=True)
    write_atomic(COURIER/'original-finalizer-host.json',(HERE/'host-finalizer.json').read_bytes(),same=True)

def main():
    global EVENT_DESCRIPTOR
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--restore',metavar='ARCHIVE')
    mode.add_argument('--restore-checkpoint',metavar='CHECKPOINT')
    mode.add_argument('--status',action='store_true')
    mode.add_argument('--checkpoint',action='store_true')
    parser.add_argument('--sha256')
    args=parser.parse_args()
    if args.restore:
        restore(args.restore,args.sha256)
        return 0
    if args.restore_checkpoint:
        restore_checkpoint(args.restore_checkpoint,args.sha256)
        return 0
    if args.sha256:raise ValueError('--sha256 selects only an original archive or checkpoint')
    if args.status:
        emit({'event':'native-status','status':native_status()})
        return 0
    if args.checkpoint:
        retain_checkpoint(native_module(),emit_frames=True)
        return 0
    EVENT_DESCRIPTOR=os.dup(sys.stdout.fileno())
    os.set_inheritable(EVENT_DESCRIPTOR,False)
    COURIER.mkdir(parents=True,exist_ok=True,mode=0o700)
    if COURIER.is_symlink() or COURIER.resolve()!=COURIER:
        raise ValueError('Courier directory is not the original private path')
    with open(COURIER/'.owner.lock','a+b') as owner:
        fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
        original=read_json(KEEP)
        if original and original.get('state')=='saved':
            archive=original['archive']
            if digest(COURIER/ARCHIVE_NAME)!=archive['sha256']:
                raise ValueError('Saved native archive changed')
            publish_receipt(archive,original['library'],original.get('native'))
            return 0
        native=None
        try:
            prepare_courier_inputs()
            native=native_module()
            report,code=run_native(native)
        except BaseException as error:
            detail=remember_exception(error,'courier-native-run')
            current=native_status(native)
            report=current.get('report');code=74
            emit({'event':'native-courier-error','error':detail,
                  'operation_id':OPERATION,'native':current})
        saved=FINAL_CUSTODY or read_json(KEEP)
        if saved and saved.get('state')=='saved':
            emit({'event':'custody-complete','receipt':saved,
                  'supervisor_exit_code':code,'native':summary(report or {})})
            return code if code not in (None,0) else native.exit_status(report) if native and report else 127
        # Only bounded original control data is copied here. Full private ZIP
        # creation and Library helper work remain inside the native callback.
        saved=hold({'schema':SCHEMA,'operation_id':OPERATION,'state':'native-owner-recovery',
              'native':report,'supervisor_exit_code':code,'private_project':str(PROJECT),
              'private_record':str(RECORD),'private_custody':str(KEEP)},reservation_live=False)
        if saved and saved.get('state')=='saved':
            latest=observe(native_module())
            return native_module().exit_status(latest) if latest else 127
        return code if code not in (None,0) else 74

if __name__=='__main__':
    raise SystemExit(main())
