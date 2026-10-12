import os,sys,json,pathlib,hashlib,subprocess,shutil,time,threading
def emit(value):
    print(json.dumps(value,separators=(',',':')),flush=True)
packet_bytes=sys.stdin.buffer.read()
expected_packet='7a098fefcb5ad745810602f5d994a723f0e10317acb27bd85db2ac4f723a1fa0'
if hashlib.sha256(packet_bytes).hexdigest()!=expected_packet:
    raise RuntimeError('Original Service source packet bytes differ')
packet=json.loads(packet_bytes)
commit=packet['authoredCommit']
if commit!='fe7329e0595d7ab77eddc832bee27785f13e9a4d' or len(packet['files'])!=118:
    raise RuntimeError('Unexpected Service receiving source')
root=pathlib.Path('/dev/service-commitments-receiver-24ea')
source=root/'source'
native=pathlib.Path('/dev/shm/scf-service-commitments-24ea')
for path in (root,source,native):
    path.mkdir(parents=True,exist_ok=True,mode=0o700)
for name,content in packet['files'].items():
    if name.startswith('/') or '..' in name.split('/'):
        raise RuntimeError('Unsafe source path')
    data=content.encode('utf-8')
    observed=hashlib.sha1(b'blob '+str(len(data)).encode()+bytes([0])+data).hexdigest()
    if observed!=packet['file_blobs'][name]:
        raise RuntimeError('Source blob mismatch '+name)
    target=source/name
    target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if target.exists() and target.read_bytes()!=data:
        raise RuntimeError('Different selected source already exists '+name)
    target.write_bytes(data)
deps=pathlib.Path('/workspace/scratch/9345d3fc660b/native-runtime/node_modules')
node='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'
chromium='/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell'
playwright='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js'
for path in (deps,pathlib.Path(node),pathlib.Path(chromium),pathlib.Path(playwright)):
    if not path.exists():
        raise RuntimeError('Original runtime dependency missing '+str(path))
modules=source/'node_modules'
if not modules.exists():
    modules.symlink_to(deps,target_is_directory=True)
browser=root/'browser'
browser.mkdir(exist_ok=True,mode=0o700)
browser_link=native/'browser'
if not browser_link.exists() and not browser_link.is_symlink():
    browser_link.symlink_to(browser,target_is_directory=True)
selection={'operationId':packet['operationId'],'commit':commit,'packetSha256':expected_packet,'source':str(source),'native':str(native),'files':packet['file_blobs'],'browserProfile':str(browser_link.resolve())}
(root/'source-selection.json').write_text(json.dumps(selection,indent=2)+chr(10))
(native/'runtime-custody.json').write_text(json.dumps({k:v for k,v in selection.items() if k!='files'},indent=2)+chr(10))
emit({'event':'service-source-ready','commit':commit,'files':len(packet['files']),'native':str(native),'sharedFreeBytes':shutil.disk_usage(native).free,'sourceFreeBytes':shutil.disk_usage(source).free})
argv=[node,str(source/packet['nativeEntry']),'--directory',str(native),'--source-commit',commit,'--chromium',chromium,'--playwright-module',playwright]
log=native/'service-native-output.log'
with log.open('ab',buffering=0) as output:
    child=subprocess.Popen(argv,cwd=str(source),stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    emit({'event':'service-original-native-started','pid':child.pid,'argv':argv})
    def pump():
        for block in iter(lambda:child.stdout.read1(16384),b''):
            output.write(block)
            sys.stdout.buffer.write(block)
            sys.stdout.buffer.flush()
    reader=threading.Thread(target=pump,daemon=True)
    reader.start()
    while child.poll() is None:
        time.sleep(0.5)
    reader.join(timeout=5)
    code=child.returncode
emit({'event':'service-original-native-completed','pid':child.pid,'exitCode':code,'checkpoint':str(native/'service-receiving-checkpoint.json'),'result':str(native/'service-native-run.json')})
sys.exit(code if code>=0 else 128-code)
