// MIT. Run the original Installation-return core and managed Page receiving as one saved operation.
import {constants} from 'node:fs';
import {readFile,mkdir,open,rename,lstat,realpath,readdir} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {acquireStateLease} from '../../../scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {GrantWorkspaceClient,inspectGrantAgentBinding} from './agent-client.mjs';
import {readGrantWorkspaceLaunch} from './launch.mjs';
import {runInstallationReturnPageReceiving} from './installation-return-page-receiving.mjs';
import {MerchantGrantWorkspaces,readGrantWorkspaceConfiguration} from '../../../../stellar-forge/mcp-merchant-operator/grant-workspace.mjs';

const SCHEMA='stellar-forge.sf47-installation-return-complete.v1';
const INPUT=SCHEMA+'.input';
const PREFIX='stellar/scf_2026/sf47_budget_model/workspace/';
const MAX=128*1024*1024;
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const blob=raw=>createHash('sha1').update(Buffer.from('blob '+raw.length+'\0')).update(raw).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const order=value=>Array.isArray(value)?value.map(order):plain(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])])):value;
const encode=value=>Buffer.from(JSON.stringify(order(value),null,2)+'\n');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const same=(a,b)=>JSON.stringify(order(a))===JSON.stringify(order(b));
const safe=value=>typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!value.includes('\\')&&
  !value.includes('\0')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
async function optional(path){try{return await original(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function original(path,maximum=MAX){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat(),named=await lstat(path);
    need(before.isFile()&&!named.isSymbolicLink()&&before.dev===named.dev&&before.ino===named.ino&&before.size<=maximum,
      'Select a complete bounded regular original file: '+path);
    const raw=await handle.readFile(),after=await handle.stat();
    need(raw.length===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,
      'The selected original file changed during its read: '+path);
    return raw;
  }finally{await handle.close();}
}
async function privateDirectory(path){
  need(isAbsolute(path)&&resolve(path)===path,'Select an absolute normalized private directory.');
  await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&await realpath(path)===path&&
    (!process.getuid||stat.uid===process.getuid()),'Keep the original operation directory private and owned: '+path);
}
async function publish(path,raw,lease){
  lease.assertHeld();need(Buffer.isBuffer(raw)&&raw.length<=MAX,'Keep complete receiving files within the declared bound.');
  await privateDirectory(dirname(path));
  const old=await optional(path);
  if(old){need(old.equals(raw),'The retained original receiving file differs: '+path);return;}
  const stage=path+'.'+randomUUID()+'.partial',handle=await open(stage,'wx',0o600);
  try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
  need((await original(stage)).equals(raw),'The complete staged receiving file differs.');
  lease.assertHeld();await rename(stage,path);
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
}
function normalize(value){
  const required=['schema','operationId','coreOperationId','pageOperationId','sourceRoot','sourceManifestFile',
    'workspaceDirectory','receivedDirectory','outputDirectory','pythonExecutable','playwrightModule','chromiumExecutable','workspaceAlias'];
  const allowed=[...required,'historicalResult'];
  need(plain(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>allowed.includes(key))&&
    value.schema===INPUT,'Use the complete original Installation-return input.');
  for(const [key,maximum] of [['operationId',90],['coreOperationId',60],['pageOperationId',100]])
    need(typeof value[key]==='string'&&new RegExp('^[A-Za-z0-9][A-Za-z0-9._-]{0,'+(maximum-1)+'}$').test(value[key]),
      'Select the original saved operation ID: '+key);
  need(new Set([value.operationId,value.coreOperationId,value.pageOperationId]).size===3,'Give the outer, core and Page their distinct original IDs.');
  need(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.workspaceAlias),'Select one original host workspace alias.');
  for(const key of ['sourceRoot','sourceManifestFile','workspaceDirectory','receivedDirectory','outputDirectory',
    'pythonExecutable','playwrightModule','chromiumExecutable'])
    need(typeof value[key]==='string'&&isAbsolute(value[key])&&resolve(value[key])===value[key],'Select an absolute original path: '+key);
  const roots=[value.sourceRoot,value.workspaceDirectory,value.receivedDirectory,value.outputDirectory];
  need(roots.every((item,index)=>roots.every((other,otherIndex)=>index===otherIndex||
    (item!==other&&!item.startsWith(other+'/')))),'Keep original source, both workspaces and receiving output separate.');
  if(value.historicalResult!==undefined){
    const old=value.historicalResult;
    need(plain(old)&&Object.keys(old).every(key=>['path','bytes','sha256'].includes(key))&&
      typeof old.path==='string'&&isAbsolute(old.path)&&resolve(old.path)===old.path&&
      Number.isSafeInteger(old.bytes)&&old.bytes>0&&old.bytes<=MAX&&/^[0-9a-f]{64}$/.test(old.sha256),
      'Retain a complete historical result with its exact original bytes and SHA.');
  }
  return structuredClone(value);
}
async function verifySource(config){
  need(process.platform==='linux'&&Number(process.versions.node.split('.')[0])>=22,
    'Use the selected original Linux Node 22 or newer runtime.');
  const raw=await original(config.sourceManifestFile),manifest=JSON.parse(raw);
  need(manifest.schema==='commons.sf47.installation-return-source-selection.v1'&&
    /^[0-9a-f]{40}$/.test(manifest.sourceCommit)&&Array.isArray(manifest.files)&&manifest.files.length>0,
    'Select the complete original source manifest.');
  need(await realpath(config.sourceRoot)===config.sourceRoot&&
    fileURLToPath(import.meta.url)===join(config.sourceRoot,PREFIX+'installation-return-complete.mjs'),
    'Run this complete receiving entry point from its selected original source root.');
  const names=new Set();let total=0;
  for(const row of manifest.files){
    need(plain(row)&&safe(row.path)&&!names.has(row.path)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&
      /^[0-9a-f]{64}$/.test(row.sha256)&&/^[0-9a-f]{40}$/.test(row.gitBlob),
      'The complete source manifest has an invalid original member.');
    names.add(row.path);
    const member=join(config.sourceRoot,row.path);
    need(await realpath(member)===member,'The selected source member resolves outside its original name.');
    const body=await original(member);
    need(body.length===row.bytes&&hash(body)===row.sha256&&blob(body)===row.gitBlob,
      'The selected full source member differs: '+row.path);
    total+=body.length;
  }
  need(names.has(PREFIX+'installation-return-complete.mjs')&&names.has(PREFIX+'installation-return-receiving.py')&&
    names.has(PREFIX+'installation-return-page-receiving.mjs'),'Retain the complete original receiving source.');
  return {raw,manifest,sha256:hash(raw),files:names.size,bytes:total};
}
const PACK=[
  'import os,sys,json,pathlib,hashlib,zipfile,tempfile,stat',
  'root=pathlib.Path(sys.argv[1]);intent_raw=(root/"customer-package-input.json").read_bytes();intent=json.loads(intent_raw)',
  'assert hashlib.sha256(intent_raw).hexdigest()==sys.argv[2]',
  'selected={}',
  'for row in intent["files"]:',
  ' p=pathlib.PurePosixPath(row["path"])',
  ' assert not p.is_absolute() and str(p)==row["path"] and all(x not in ("","..",".") for x in p.parts) and row["path"] not in selected',
  ' path=root.joinpath(*p.parts);info=path.lstat();assert stat.S_ISREG(info.st_mode) and not path.is_symlink()',
  ' raw=path.read_bytes();assert len(raw)==row["bytes"] and hashlib.sha256(raw).hexdigest()==row["sha256"]',
  ' selected[row["path"]]=raw',
  'selected["customer-package-input.json"]=intent_raw',
  'selected["handover.json"]=(json.dumps(intent["summary"],sort_keys=True,ensure_ascii=False,indent=2)+"\\n").encode()',
  'target=root/"Installation_Return_Complete_Receiving_20261012.zip"',
  'def verify(path):',
  ' with zipfile.ZipFile(path) as z:',
  '  assert len(z.infolist())==len(selected) and set(z.namelist())==set(selected)',
  '  for name,raw in selected.items():',
  '   assert not z.getinfo(name).is_dir() and z.read(name)==raw',
  'if target.exists():',
  ' assert not target.is_symlink() and target.is_file();verify(target)',
  'else:',
  ' fd,temporary=tempfile.mkstemp(prefix=".complete-receiving-",suffix=".partial",dir=root)',
  ' with os.fdopen(fd,"w+b") as stream:',
  '  os.fchmod(stream.fileno(),0o600)',
  '  with zipfile.ZipFile(stream,"w",compression=zipfile.ZIP_DEFLATED) as z:',
  '   for name in sorted(selected):',
  '    info=zipfile.ZipInfo(name,(2026,10,12,0,0,0));info.external_attr=0o100600<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,selected[name])',
  '  stream.flush();os.fsync(stream.fileno())',
  ' verify(pathlib.Path(temporary));os.replace(temporary,target)',
  ' parent=os.open(root,os.O_RDONLY|os.O_DIRECTORY)',
  ' try:os.fsync(parent)',
  ' finally:os.close(parent)',
  'body=target.read_bytes()',
  'print(json.dumps({"path":str(target),"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest(),"members":len(selected)}))',
].join('\n');
async function inventory(directory){
  const result=[];
  async function visit(path,prefix){
    for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const name=prefix?prefix+'/'+entry.name:entry.name;
      if(name==='lease.lock'||name==='result.json'||name==='customer-package-input.json'||
        name==='Installation_Return_Complete_Receiving_20261012.zip'||name==='page/views'||name.startsWith('packaging/'))continue;
      need(!entry.isSymbolicLink(),'Retain original regular receiving files without aliases.');
      if(entry.isDirectory())await visit(join(path,entry.name),name);
      else{
        need(entry.isFile(),'A receiving output is not a complete regular file: '+name);
        const raw=await original(join(path,entry.name));
        result.push({path:name,bytes:raw.length,sha256:hash(raw)});
      }
    }
  }
  await visit(directory,'');return result;
}
export async function runInstallationReturnComplete(input,{coreOnly=false}={}){
  const config=normalize(input);
  for(const path of [dirname(config.workspaceDirectory),dirname(config.receivedDirectory),config.outputDirectory])
    await privateDirectory(path);
  const lease=await acquireStateLease(config.outputDirectory),children=new Set();
  let browser=null,context=null,client=null,mcp=null,interrupted=null,primary=null,managedSelection=null,managedClosure=null;
  function stopGroup(owner){
    if(owner.closed||!Number.isSafeInteger(owner.pid)||owner.pid<=0)return;
    try{process.kill(-owner.pid,'SIGTERM');owner.stopState='TERM_SENT';owner.stopError=null;}
    catch(error){
      if(error.code==='ESRCH'){owner.stopState='GROUP_ABSENT';owner.stopError=null;}
      else{owner.stopState='STOP_FAILED';owner.stopError={code:error.code??null,message:error.message};}
    }
  }
  const onSignal=signal=>{
    interrupted=signal;
    for(const owner of children)stopGroup(owner);
    if(browser)browser.close().catch(()=>{});
  };
  const interrupt=()=>onSignal('SIGINT'),terminate=()=>onSignal('SIGTERM');
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  async function runProcess(argv,name){
    need(!interrupted,'The original receiving operation was interrupted by '+interrupted+'.');
    const root=join(config.outputDirectory,name==='package'?'packaging':'commands',name+'-'+randomUUID());
    await privateDirectory(root);
    const out=await open(join(root,'stdout'),'wx',0o600),err=await open(join(root,'stderr'),'wx',0o600);
    let child,owner,spawnError=null,code=null,signal=null;
    try{
      await new Promise(resolveResult=>{
        child=spawn(config.pythonExecutable,['-B',...argv],{
          cwd:config.sourceRoot,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',SF30_XML_NODE:process.execPath},
          stdio:['ignore',out.fd,err.fd],detached:true});
        owner={child,pid:child.pid??null,closed:false,stopState:null,stopError:null};
        children.add(owner);
        child.once('spawn',()=>{owner.pid=child.pid;if(interrupted)stopGroup(owner);});
        child.once('error',error=>{spawnError=error;});
        child.once('close',(value,endedSignal)=>{
          code=value;signal=endedSignal;owner.closed=true;
          if(owner.stopState!=='STOP_FAILED')children.delete(owner);
          resolveResult();
        });
      });
      await out.sync();await err.sync();
    }finally{await out.close();await err.close();}
    const stdout=await original(join(root,'stdout')),stderr=await original(join(root,'stderr'));
    const receipt={schema:SCHEMA+'.command',name,executable:config.pythonExecutable,argv:['-B',...argv],
      nodeExecutable:process.execPath,code,signal,
      processGroup:{id:owner?.pid??null,leaderClosed:owner?.closed??false,
        stopState:owner?.stopState??null,stopError:owner?.stopError??null},
      error:spawnError?{code:spawnError.code??null,message:spawnError.message}:null,
      stdout:{path:relative(config.outputDirectory,join(root,'stdout')),bytes:stdout.length,sha256:hash(stdout)},
      stderr:{path:relative(config.outputDirectory,join(root,'stderr')),bytes:stderr.length,sha256:hash(stderr)}};
    await publish(join(root,'result.json'),encode(receipt),lease);
    if(spawnError||code!==0||interrupted)
      throw Object.assign(new Error('The original '+name+' command did not complete: '+stderr.toString('utf8').slice(-6000)),
        {cause:spawnError,command:receipt});
    return {stdout,stderr,receipt};
  }
  async function closeOwners(){
    const failures=[];
    for(const [name,value] of [['context',context],['browser',browser],['MCP',mcp],['managed client',client]]){
      if(!value)continue;
      try{
        const returned=await value.close();
        if(name==='managed client'){
          need(returned&&['OWNED_ORIGINAL_SERVICE_CLOSED','BORROWED_CONNECTION_RELEASED'].includes(returned.state),
            'Retain the original managed close result.');
          if(managedSelection)need(returned.originalInstanceId===managedSelection.instanceId,
            'The original managed close returned another selected instance.');
          managedClosure={selection:managedSelection,original:returned};
        }
        if(name==='context')context=null;else if(name==='browser')browser=null;else if(name==='MCP')mcp=null;else client=null;
      }catch(error){failures.push({name,error});}
    }
    if(failures.length)throw Object.assign(new AggregateError(failures.map(x=>x.error),'Original receiving shutdown is incomplete.'),
      {failures:failures.map(x=>({owner:x.name,code:x.error.code??null,message:x.error.message}))});
  }
  async function finish(intent,source){
    need(intent.schema===SCHEMA+'.package'&&intent.inputSha256===hash(encode(config))&&
      intent.sourceManifestSha256===source.sha256&&intent.summary.operationId===config.operationId,
      'Continue the exact retained complete package selection.');
    need(intent.summary.coreOperationId===config.coreOperationId&&intent.summary.pageOperationId===config.pageOperationId&&
      intent.summary.mode==='WALKTHROUGH'&&intent.summary.source.commit===source.manifest.sourceCommit&&
      intent.summary.source.files===source.files&&intent.summary.source.bytes===source.bytes,
      'The retained customer summary differs from its original selected workflow.');
    const core=JSON.parse(await original(join(config.outputDirectory,'core-result.json')));
    const page=JSON.parse(await original(join(config.outputDirectory,'page-result.json')));
    need(core.state==='COMPLETE'&&page.state==='COMPLETE'&&core.operationId===config.coreOperationId&&
      page.operationId===config.pageOperationId&&page.coreOperationId===core.operationId&&
      page.ownerCaseId===core.ownerCaseId&&page.installationSha256===core.installationSha256&&
      intent.summary.ownerCaseId===core.ownerCaseId&&intent.summary.installationId===core.installationId&&
      intent.summary.revision===core.revision&&intent.summary.installationSha256===core.installationSha256&&
      same(intent.summary.coreArtifact,core.completeArtifact)&&same(intent.summary.pageArtifact,page.completeArtifact)&&
      same(intent.summary.checks,[...core.checks,...page.checks]),
      'The complete customer summary must retain its original native and Page results.');
    const closed=JSON.parse(await original(join(config.outputDirectory,'closed.json')));
    need(closed.operationId===config.operationId&&closed.ownedBrowserClosed===true&&closed.originalMcpClosed===true&&
      same(closed.managedClosure,intent.summary.managedClosure)&&
      ['OWNED_ORIGINAL_SERVICE_CLOSED','BORROWED_CONNECTION_RELEASED'].includes(closed.managedClosure?.original.state)&&
      closed.originalManagedServiceClosed===(closed.managedClosure.original.state==='OWNED_ORIGINAL_SERVICE_CLOSED')&&
      closed.originalBorrowedConnectionReleased===(closed.managedClosure.original.state==='BORROWED_CONNECTION_RELEASED'),
      'Retain the exact original owned-service or borrowed-connection closure.');
    const names=new Set(intent.files.map(row=>row.path));
    need(names.size===intent.files.length&&['input.json','source-selection.json','core-input.json',
      'core-result.json','page-result.json','closed.json','core/result.json','core/complete-receiving.zip',
      'page/result.json','page/complete-page-receiving.zip'].every(name=>names.has(name)),
      'Retain the complete original core and Page artifacts in the customer selection.');
    const raw=await original(join(config.outputDirectory,'customer-package-input.json'));
    const packed=await runProcess(['-c',PACK,config.outputDirectory,hash(raw)],'package');
    const completeArtifact=JSON.parse(packed.stdout);
    const archive=await original(completeArtifact.path);
    need(archive.length===completeArtifact.bytes&&hash(archive)===completeArtifact.sha256,'The complete customer archive changed.');
    const result={...intent.summary,state:'COMPLETE',completeArtifact,
      packageInput:{path:'customer-package-input.json',bytes:raw.length,sha256:hash(raw)}};
    await publish(join(config.outputDirectory,'result.json'),encode(result),lease);
    return result;
  }
  try{
    const source=await verifySource(config);
    await publish(join(config.outputDirectory,'input.json'),encode(config),lease);
    await publish(join(config.outputDirectory,'source-selection.json'),source.raw,lease);
    if(config.historicalResult){
      const raw=await original(config.historicalResult.path),selected=JSON.parse(raw);
      need(raw.length===config.historicalResult.bytes&&hash(raw)===config.historicalResult.sha256&&
        selected.state==='COMPLETE'&&selected.result?.state==='COMPLETE'&&
        selected.result.schema==='stellar-forge.sf47-installation-return-receiving.v1'&&
        selected.result.operationId!==config.coreOperationId,
        'Keep the exact earlier completed result as history, separate from the new current operation.');
      await publish(join(config.outputDirectory,'historical','original-receiving-result.json'),raw,lease);
    }
    const oldIntent=await optional(join(config.outputDirectory,'customer-package-input.json'));
    if(oldIntent)return await finish(JSON.parse(oldIntent),source);
    const coreInput={operationId:config.coreOperationId,sourceRoot:config.sourceRoot,
      workspaceDirectory:config.workspaceDirectory,receivedDirectory:config.receivedDirectory,
      outputDirectory:join(config.outputDirectory,'core')};
    await publish(join(config.outputDirectory,'core-input.json'),encode(coreInput),lease);
    const operated=await runProcess([join(config.sourceRoot,PREFIX+'installation-return-receiving.py'),
      '--input',join(config.outputDirectory,'core-input.json')],'core');
    const core=JSON.parse(operated.stdout);
    need(core.schema==='stellar-forge.sf47-installation-return-receiving.v1'&&core.state==='COMPLETE'&&
      core.operationId===config.coreOperationId&&core.mode==='WALKTHROUGH','The original complete core receiving did not return its selected case.');
    await publish(join(config.outputDirectory,'core-result.json'),encode(core),lease);
    if(coreOnly)return {schema:SCHEMA,state:'CORE_COMPLETE',operationId:config.operationId,coreOperationId:core.operationId,
      coreCompleteArtifact:core.completeArtifact,workspaceDirectory:config.workspaceDirectory,
      receivedDirectory:config.receivedDirectory,next:'Run the same complete input without --core-only to operate the original Page, typed client and MCP.'};
    need(!interrupted,'The original receiving operation was interrupted.');
    const binding=await inspectGrantAgentBinding({directory:config.workspaceDirectory,
      pythonExecutable:config.pythonExecutable,scenarioFile:join(config.sourceRoot,PREFIX+'../sf10_current_candidate.json'),
      allowStart:true,label:'Installation return current receiving'});
    client=new GrantWorkspaceClient(binding);
    await client.open({expectedSelectionSha256:binding.selectionSha256});
    const instance=await client.inspect();
    const originalLaunch=instance.original;
    need(originalLaunch&&['OWNED_ORIGINAL_SERVICE','BORROWED_ORIGINAL_SERVICE'].includes(instance.connection),
      'Retain the actual selected managed instance and its ownership.');
    managedSelection={instanceId:originalLaunch.instanceId,connection:instance.connection,
      selectionSha256:binding.selectionSha256,workspaceDirectory:config.workspaceDirectory};
    const launch=await readGrantWorkspaceLaunch({workspaceDirectory:config.workspaceDirectory,
      scenarioFile:binding.scenarioFile,pythonExecutable:config.pythonExecutable,selectionSha256:binding.selectionSha256,
      executionSourceDirectory:originalLaunch.execution.sourceDirectory,pid:originalLaunch.pid,instanceId:originalLaunch.instanceId,
      port:0,announcement:originalLaunch});
    const attempt=join(config.outputDirectory,'managed',randomUUID());
    await publish(join(attempt,'original-listener.json'),encode({schema:SCHEMA+'.listener',
      nodeExecutable:process.execPath,nodeVersion:process.version,pythonExecutable:config.pythonExecutable,
      playwrightModule:config.playwrightModule,chromiumExecutable:config.chromiumExecutable,
      ownership:managedSelection,original:launch.original}),lease);
    const connection={schema:'stellar-forge.sf47-workspace-connection.v1',workspaces:{
      [config.workspaceAlias]:{directory:config.workspaceDirectory,scenarioFile:binding.scenarioFile,
        pythonExecutable:config.pythonExecutable,label:'Installation return current receiving',allowStart:false}}};
    const connectionPath=join(config.outputDirectory,'mcp-connection.json');
    await publish(connectionPath,encode(connection),lease);
    const grantWorkspaces=await readGrantWorkspaceConfiguration(connectionPath);
    await privateDirectory(join(config.outputDirectory,'mcp'));
    mcp=new MerchantGrantWorkspaces({grantWorkspaces,exportsDirectory:join(config.outputDirectory,'mcp')});
    const playwright=await import(pathToFileURL(config.playwrightModule).href);
    need(playwright.chromium?.launch,'Select the original installed Playwright Chromium implementation.');
    browser=await playwright.chromium.launch({headless:true,executablePath:config.chromiumExecutable,
      args:['--no-sandbox','--disable-dev-shm-usage']});
    context=await browser.newContext({viewport:{width:1360,height:980},acceptDownloads:true});
    const page=await context.newPage();
    page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
    await page.goto(launch.url,{waitUntil:'domcontentloaded'});
    const openOperations=async selectedPage=>{
      await selectedPage.locator('#sections [data-tab="operations"]').click();
      await selectedPage.locator('.operations select[name="caseSelect"]').waitFor({state:'visible'});
    };
    const received=await runInstallationReturnPageReceiving({
      page,client,callTool:(name,args)=>mcp.call(name,args),workspace:config.workspaceAlias,openOperations,
      coreOutputDirectory:coreInput.outputDirectory,outputDirectory:join(config.outputDirectory,'page'),
      sourceRoot:config.sourceRoot,pythonExecutable:config.pythonExecutable,operationId:config.pageOperationId});
    need(received.state==='COMPLETE'&&received.coreOperationId===config.coreOperationId&&
      received.ownerCaseId===core.ownerCaseId&&received.installationSha256===core.installationSha256,
      'The complete Page receiving differs from its original current core case.');
    await publish(join(config.outputDirectory,'page-result.json'),encode(received),lease);
    await closeOwners();
    await publish(join(config.outputDirectory,'closed.json'),encode({schema:SCHEMA+'.closed',
      operationId:config.operationId,coreOperationId:config.coreOperationId,pageOperationId:config.pageOperationId,
      ownedBrowserClosed:true,originalMcpClosed:true,managedClosure,
      originalManagedServiceClosed:managedClosure?.original.state==='OWNED_ORIGINAL_SERVICE_CLOSED',
      originalBorrowedConnectionReleased:managedClosure?.original.state==='BORROWED_CONNECTION_RELEASED'}),lease);
    const summary={schema:SCHEMA,operationId:config.operationId,mode:core.mode,
      source:{commit:source.manifest.sourceCommit,manifestSha256:source.sha256,files:source.files,bytes:source.bytes},
      coreOperationId:core.operationId,pageOperationId:received.operationId,
      ownerCaseId:core.ownerCaseId,receiverCaseId:core.receiverCaseId,returnedCaseId:core.returnedCaseId,
      independentCaseId:core.independentCaseId,installationId:core.installationId,revision:core.revision,
      installationSha256:core.installationSha256,receivingReviewId:core.receivingReviewId,ownerReviewId:core.ownerReviewId,
      coreArtifact:core.completeArtifact,pageArtifact:received.completeArtifact,
      checks:[...core.checks,...received.checks],viewports:received.viewports,javascriptErrors:received.javascriptErrors,managedClosure,
      workspaceDirectory:config.workspaceDirectory,receivedDirectory:config.receivedDirectory,
      historicalResult:config.historicalResult?{path:'historical/original-receiving-result.json',
        bytes:config.historicalResult.bytes,sha256:config.historicalResult.sha256}:null,
      localQa:received.localQa??[],custody:'The complete native case ZIPs and original receiving files are included. Both original workspaces remain at their selected directories. The recorded managed close result distinguishes an owned service closed by this parent from a released connection to another original owner.'};
    const intent={schema:SCHEMA+'.package',inputSha256:hash(encode(config)),sourceManifestSha256:source.sha256,
      summary,files:await inventory(config.outputDirectory)};
    await publish(join(config.outputDirectory,'customer-package-input.json'),encode(intent),lease);
    return await finish(intent,source);
  }catch(error){
    primary=error;
    try{
      const failure={schema:SCHEMA+'.interrupted',operationId:config.operationId,code:error.code??null,
        message:error.message,stack:error.stack??null,command:error.command??null};
      const raw=encode(failure);
      await publish(join(config.outputDirectory,'attempts','interrupted-'+hash(raw)+'.json'),raw,lease);
    }catch(retentionError){error.retentionError=retentionError.message;}
    throw error;
  }finally{
    process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);
    try{await closeOwners();}
    catch(error){if(primary)primary.shutdownError=error;else throw error;}
    finally{await lease.close();}
  }
}
async function main(){
  const argv=process.argv.slice(2);
  need(argv.length>=2&&argv[0]==='--input'&&(argv.length===2||(argv.length===3&&argv[2]==='--core-only')),
    'Use --input ABSOLUTE_JSON [--core-only] for the same complete saved receiving operation.');
  const path=resolve(argv[1]),result=await runInstallationReturnComplete(JSON.parse(await original(path)),
    {coreOnly:argv.includes('--core-only')});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({schema:SCHEMA,state:'INTERRUPTED',
    code:error.code??null,message:error.message,stack:error.stack??null,command:error.command??null,
    shutdownError:error.shutdownError?{message:error.shutdownError.message,failures:error.shutdownError.failures}:null})+'\n');process.exitCode=1;});
