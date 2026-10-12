import os,sys,json,pathlib,urllib.request,urllib.parse,hashlib,base64,subprocess,tarfile,io,time,traceback,shutil,re
from xml.sax.saxutils import escape
ROOT=pathlib.Path(os.environ.get('COMMONS_OPENLINEAGE_OPERATION_DIRECTORY','/dev/commons-java-9f05')).resolve()
ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
BLOB='f623ffd52e2f1c200055576abe907ba9abdfc431'
configured_jdk=os.environ.get('COMMONS_OPENLINEAGE_JAVA_HOME')
cached_jdk=pathlib.Path('/tmp/lda-7573/toolchain/zulu17.68.203-ca-crac-jdk17.0.20.1-linux_x64')
found_javac=shutil.which('javac')
JDK=pathlib.Path(configured_jdk).resolve() if configured_jdk else cached_jdk if (cached_jdk/'bin/javac').is_file() else pathlib.Path(found_javac).resolve().parent.parent if found_javac else None
results=[]
source=None
def emit(value):
    print(json.dumps(value,separators=(',',':')),flush=True)
def save(name,value):
    path=ROOT/name
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    path.write_text(json.dumps(value,indent=2)+'\n')
    path.chmod(0o600)
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Commons-OpenLineage-native-receiving','Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(req,timeout=90) as response:
        return response.read()
def run(name,argv,env=None,timeout=900):
    started=time.time()
    r=subprocess.run([str(v) for v in argv],cwd=ROOT,env=env,text=True,capture_output=True,timeout=timeout)
    row={'name':name,'argv':[str(v) for v in argv],'exit':r.returncode,'seconds':time.time()-started,'stdout':r.stdout,'stderr':r.stderr}
    results.append(row);save(name+'-native.json',row)
    emit({'kind':'phase','name':name,'exit':r.returncode,'seconds':row['seconds']})
    return row
def artifact_selected(relative):
    parts=relative.parts
    name=relative.name
    if parts[0]=='source':return True
    if len(parts)==1:return name in {'source-packet.json','runtime-acquisition.json','serial-native-result.json'}
    if parts[0]=='runtime':
        return len(parts)==2 and (name in {'runtime-intent.json','java-runtime.json','classpath.txt','OpenLineageNativeProducer.java','pom.xml','maven-preparation.json'} or bool(re.fullmatch(r'(maven-preparation|classpath)-[0-9a-f-]+\.(json|txt)',name)) or (name.startswith('maven-') and name.endswith(('.stdout','.stderr'))))
    if parts[0] not in {'merchant-operation','java-operation'}:return False
    if len(parts)==2:
        return name in {'merchant-producer-operation.json','merchant-producer-receiving.json','java-receiving-operation.json','java-receiving.json','original-simple.json','original-full.json','original-full.json.gz'} or bool(re.fullmatch(r'(merchant|java)-workspace-[0-9a-f]{64}\.json',name))
    if parts[1]=='wire':return len(parts)==3 and bool(re.fullmatch(r'[0-9a-f]{64}\.json(\.gz)?',name))
    if parts[1]=='workspace' or parts[1].startswith('received-'):
        return (len(parts)==3 and name in {'workspace.json','received.json'}) or (len(parts)==4 and parts[2]=='objects' and bool(re.fullmatch(r'[0-9a-f]{64}',name)))
    cases={'gzip-full-run','plain-simple-run','gzip-simple-run','wrong-workspace','writer-recovery','restart-replay','received-replay'}
    if parts[1] not in cases:return False
    if len(parts)==3:
        return name in {'java-input.json','java-producer-result.json'} or bool(re.fullmatch(r'input-[0-9]{6}\.json|invocation-[0-9a-f-]+\.json|java-[0-9a-f-]+\.(stdout|stderr)',name))
    return len(parts)==4 and parts[2]=='native' and bool(re.fullmatch(r'event-[0-9]{6}([0-9a-f-]*)?\.(json|wire|response|receipt\.json|attempt\.json)',name))
def archive(stage):
    save('serial-native-result.json',{'schema':'commons.openlineage.serial-native-result.v1','sourceBlob':BLOB,'source':source,'results':results})
    target=ROOT/(stage+'-complete.tar.gz')
    selected=['source','source-packet.json','merchant-operation','java-operation','runtime','runtime-acquisition.json','serial-native-result.json']
    secrets=[]
    for operation in ['merchant-operation','java-operation']:
        for token in ['operator-token','producer-token']:
            path=ROOT/operation/token
            if path.is_file():secrets.append(path.read_bytes().strip())
    with tarfile.open(target,'w:gz',compresslevel=6) as tar:
        for name in selected:
            path=ROOT/name
            leaves=[path] if path.is_file() else sorted(path.rglob('*')) if path.is_dir() else []
            for leaf in leaves:
                if not leaf.is_file():continue
                rel=leaf.relative_to(ROOT)
                if not artifact_selected(rel):continue
                if leaf.name in {'operator-token','producer-token','merchant-host.json','received-merchant-host.json','connection.json','maven-settings.xml'}:continue
                if leaf.name.startswith('java-config-') or any(part.endswith('producer-configurations') for part in rel.parts):continue
                if any(part.startswith('received-') for part in rel.parts) and 'application' in rel.parts:continue
                body=leaf.read_bytes()
                if any(secret and secret in body for secret in secrets):
                    raise RuntimeError('Private producer credential in retained artifact '+str(rel))
                tar.add(leaf,arcname=str(rel),recursive=False)
    body=target.read_bytes();digest=hashlib.sha256(body).hexdigest()
    shared=pathlib.Path('/dev/shm')/(stage+'-'+digest+'.tar.gz')
    retained={'kind':'native-artifact','stage':stage,'bytes':len(body),'sha256':digest,'base64':base64.b64encode(body).decode()}
    try:
        with shared.open('xb') as out:out.write(body);out.flush();os.fsync(out.fileno())
        retained['sharedArchive']=str(shared)
    except FileExistsError:
        assert shared.read_bytes()==body
        retained['sharedArchive']=str(shared)
    except OSError as error:retained['sharedWriteError']=str(error)
    emit(retained)
try:
    emit({'kind':'admitted','pid':os.getpid(),'root':str(ROOT)})
    response=json.loads(get('https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/'+BLOB))
    body=base64.b64decode(response['content'])
    assert hashlib.sha1(b'blob '+str(len(body)).encode()+b'\0'+body).hexdigest()==BLOB
    packet=json.loads(body)
    assert packet['schema']=='commons.openlineage.serial-native-source.v1' and len(packet['files'])==51
    source_path=ROOT/'source-packet.json'
    if source_path.exists():assert source_path.read_bytes()==body,'Continue the original source packet'
    else:source_path.write_bytes(body)
    src=ROOT/'source';src.mkdir(mode=0o700,exist_ok=True)
    names=set();source={'blob':BLOB,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'files':[]}
    for item in packet['files']:
        name=item['path']
        assert name==pathlib.Path(name).name and name not in names
        names.add(name);content=item['content'].encode()
        if (src/name).exists():assert (src/name).read_bytes()==content,'Continue the original source '+name
        else:(src/name).write_bytes(content)
        source['files'].append({'path':name,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()})
    assert JDK and (JDK/'bin/java').is_file() and (JDK/'bin/javac').is_file(),'Select an installed JDK17+ with COMMONS_OPENLINEAGE_JAVA_HOME'
    merchant_result=ROOT/'merchant-operation/merchant-producer-receiving.json'
    if merchant_result.is_file():
        completed=json.loads(merchant_result.read_bytes())
        assert completed.get('completedAt')
        for name,expected in completed['applicationSources'].items():assert hashlib.sha256((src/name).read_bytes()).hexdigest()==expected
        assert json.loads((ROOT/'merchant-operation/workspace/workspace.json').read_bytes())['workspaceId']==completed['workspaceId']
        r={'name':'merchant','exit':0,'reusedCompletedOperation':True,'workspaceId':completed['workspaceId'],'result':str(merchant_result),'completedAt':completed['completedAt']}
        results.append(r);emit({'kind':'phase','name':'merchant','reusedCompletedOperation':True,'workspaceId':completed['workspaceId']})
    else:
        r=run('merchant',['node',src/'MERCHANT_PRODUCER_RECEIVING.mjs',ROOT/'merchant-operation'],timeout=180)
    archive('openlineage-merchant-9f05-corrected')
    if r['exit']!=0:raise RuntimeError('Merchant receiving interrupted; inspect retained native result')
    maven_version='3.9.9'
    url='https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/'+maven_version+'/apache-maven-'+maven_version+'-bin.tar.gz'
    data=get(url);expected=get(url+'.sha512').decode().strip().split()[0]
    assert hashlib.sha512(data).hexdigest()==expected
    assert expected=='a555254d6b53d267965a3404ecb14e53c3827c09c3b94b5678835887ab404556bfaf78dcfe03ba76fa2508649dca8531c74bca4d5846513522404d48e8c4ac8b'
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tar:
        for member in tar.getmembers():
            destination=ROOT/member.name
            assert destination.resolve().is_relative_to(ROOT)
            if member.isdir():destination.mkdir(parents=True,exist_ok=True)
            elif member.isfile():
                destination.parent.mkdir(parents=True,exist_ok=True)
                destination.write_bytes(tar.extractfile(member).read());destination.chmod(member.mode&0o777)
            else:raise RuntimeError('Unexpected Maven archive member')
    maven=ROOT/('apache-maven-'+maven_version)/'bin/mvn'
    proxy=urllib.parse.urlsplit(os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') or '')
    proxies=''
    if proxy.hostname:
        auth=''
        if proxy.username:auth+='<username>'+escape(urllib.parse.unquote(proxy.username))+'</username>'
        if proxy.password:auth+='<password>'+escape(urllib.parse.unquote(proxy.password))+'</password>'
        proxies='<proxies><proxy><id>existing-runtime-proxy</id><active>true</active><protocol>http</protocol><host>'+escape(proxy.hostname)+'</host><port>'+str(proxy.port or 80)+'</port>'+auth+'<nonProxyHosts>127.0.0.1|localhost</nonProxyHosts></proxy></proxies>'
    settings=ROOT/'maven-settings.xml';settings.write_text('<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0">'+proxies+'</settings>');settings.chmod(0o600)
    env=dict(os.environ);env.update({'JAVA_HOME':str(JDK),'MAVEN_OPTS':'-Djava.io.tmpdir='+str(ROOT)+' -XX:-UsePerfData -Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts','MAVEN_ARGS':'-s '+str(settings)+' -Dmaven.repo.local='+str(ROOT/'m2'),'JAVA_TOOL_OPTIONS':'-Djava.io.tmpdir='+str(ROOT)+' -XX:-UsePerfData -Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts'})
    versions=run('runtime-version',[maven,'-version'],env,30)
    if versions['exit']!=0:raise RuntimeError('Read retained Maven runtime version failure')
    save('runtime-acquisition.json',{'schema':'commons.openlineage.java-runtime-acquisition.v1','maven':{'version':maven_version,'url':url,'bytes':len(data),'sha512':expected},'jdk':str(JDK),'versions':versions})
    r=run('java',['node',src/'JAVA_RECEIVING.mjs',ROOT/'java-operation','--runtime',ROOT/'runtime','--java',JDK/'bin/java','--maven',maven,'--workspace',ROOT/'merchant-operation/workspace','--operator-token-file',ROOT/'merchant-operation/operator-token','--producer-token-file',ROOT/'merchant-operation/producer-token'],env,900)
    archive('openlineage-java-9f05-complete')
    if r['exit']!=0:raise RuntimeError('Native Java receiving interrupted; inspect full retained logs')
    emit({'kind':'complete','sourceBlob':BLOB,'merchantExit':results[0]['exit'],'javaExit':r['exit']})
except Exception as error:
    results.append({'name':'runner-interruption','error':type(error).__name__,'message':str(error),'traceback':traceback.format_exc()})
    try:archive('openlineage-java-9f05-interrupted')
    except Exception as retained_error:emit({'kind':'capture-interruption','error':str(retained_error),'originalError':str(error)})
    emit({'kind':'interrupted','error':type(error).__name__,'message':str(error)})
    sys.exit(1)
