#!/usr/bin/env node
// MIT. Receive the original DSpace operator through installed Applications and its browser.
import {mkdir,lstat,readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const ROOT='stellar/scf-starforge-20261009/';
const DSPACE=ROOT+'sf30-seller-sdk/dspace';
const SCHEMA='stellar-forge.dspace-managed-receiving.v1';
const digest=value=>createHash('sha256').update(value).digest('hex');
const text=value=>JSON.stringify(value,null,2)+'\n';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(value,code,message=code)=>{if(!value)throw Object.assign(new Error(message),{code});};
const moduleAt=(root,file)=>import(pathToFileURL(join(root,ROOT+file)).href);
const scopeOf=value=>({operatorId:value.operator.id,instanceId:value.operator.instanceId,
  projectKey:value.operator.selected,workspaceId:value.id});
const headersFor=scope=>Object.fromEntries([['operator','operatorId'],['instance','instanceId'],
  ['project','projectKey'],['workspace','workspaceId']].map(([name,key])=>['x-dspace-'+name,scope[key]]));
async function exists(file){try{await lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function privateDirectory(directory){await mkdir(directory,{recursive:true,mode:0o700});
  const value=await lstat(directory);need(value.isDirectory()&&!value.isSymbolicLink(),'DSPACE_RECEIVING_DIRECTORY');}
async function save(file,value){const temporary=file+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,text(value),{flag:'wx',mode:0o600});await rename(temporary,file);}
async function fileIdentity(file){const st=await lstat(file);need(st.isFile()&&!st.isSymbolicLink(),'DSPACE_RECEIVING_REGULAR_FILE');
  const bytes=await readFile(file);return {path:file,bytes:bytes.length,sha256:digest(bytes)};}
async function freePort(){const server=createServer();await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  const port=server.address().port;await new Promise(done=>server.close(done));return port;}
function argument(args,name){const index=args.indexOf(name);need(index>=0&&args.indexOf(name,index+1)===-1,'DSPACE_RECEIVING_COMMAND');return args[index+1];}
function absolute(value){need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,'DSPACE_RECEIVING_ABSOLUTE_PATH');return value;}

/**
 * Use one existing READY installation and one complete original SQLite project.
 * All application adoption/start/stop and data actions go through the maintained
 * production modules. A single browser shares the two real loopback operators.
 */
export async function receiveDspaceManagedApplication(config,{onProgress=()=>{},signal}={}){
  for(const key of ['runtimeDirectory','directory','projectFile','browserExecutable','playwrightModule'])absolute(config[key]);
  need(/^[a-f0-9]{40}$/.test(config.expectedSourceCommit??'')&&/^[a-f0-9]{64}$/.test(config.expectedManifest??''),
    'DSPACE_RECEIVING_SOURCE_SELECTION');
  const bootstrap=config.bootstrapSourceRoot??join(config.runtimeDirectory,'package','source');
  const {inspectMerchantRuntime}=await moduleAt(bootstrap,'sf46-release/runtime-package.mjs');
  const installed=await inspectMerchantRuntime(config.runtimeDirectory,{expectedManifest:config.expectedManifest,load:false});
  need(installed.sourceCommit===config.expectedSourceCommit,'DSPACE_RECEIVING_SOURCE_CHANGED');
  const [{createRuntimeWorkspace,openRuntimeWorkspace},{startRuntimeWorkspace},{managedCommandAlive},
    {operationLease},{receiveDspaceWorkspace,openDspaceWorkspace},{readDspaceOperatorLaunch}]=await Promise.all([
      moduleAt(installed.sourceRoot,'distribution/runtime-workspace/model.mjs'),
      moduleAt(installed.sourceRoot,'distribution/runtime-workspace/server.mjs'),
      moduleAt(installed.sourceRoot,'distribution/runtime-workspace/managed-workspace.mjs'),
      moduleAt(installed.sourceRoot,'distribution/runtime-workspace/storage.mjs'),
      moduleAt(installed.sourceRoot,'sf30-seller-sdk/dspace/workspace.mjs'),
      moduleAt(installed.sourceRoot,'sf30-seller-sdk/dspace/launch.mjs'),
    ]);
  await privateDirectory(config.directory);
  const lease=await operationLease(join(config.directory,'receiving.lock'));
  const journalFile=join(config.directory,'journal.json'),resultFile=join(config.directory,'RESULT.json');
  const applicationWorkspace=join(config.directory,'applications');
  const project=await fileIdentity(config.projectFile);
  const selection={runtimeDirectory:installed.directory,installationId:installed.installationId,
    sourceCommit:installed.sourceCommit,sourceManifestSha256:installed.sourceManifestSha256,
    project:{path:project.path,bytes:project.bytes,sha256:project.sha256}};
  let journal,model,management,browser,stage='OPEN',failed=null,result=null;
  const pages=new Map(),live=new Map(),browserErrors=[];
  let saving=Promise.resolve();
  const persist=()=>{const snapshot=structuredClone(journal);const current=saving.then(()=>save(journalFile,snapshot));saving=current.catch(()=>{});return current;};
  const aborted=()=>{if(signal?.aborted)throw Object.assign(new Error('Receiving was interrupted; retain its original directory.'),{code:'DSPACE_RECEIVING_ABORTED'});};
  const phase=async(name,fn)=>{
    aborted();stage=name;
    if(journal.phases[name]?.state==='COMPLETE')return journal.phases[name].result;
    const previous=journal.phases[name];
    journal.phases[name]={state:'RUNNING',startedAt:previous?.startedAt??new Date().toISOString(),
      attempts:(previous?.attempts??0)+1,errors:previous?.errors??[]};await persist();
    onProgress({phase:name,state:'RUNNING'});
    try{const value=await fn();Object.assign(journal.phases[name],{state:'COMPLETE',completedAt:new Date().toISOString(),result:value});await persist();
      onProgress({phase:name,state:'COMPLETE'});return value;}
    catch(error){journal.phases[name].state='INTERRUPTED';journal.phases[name].errors.push({at:new Date().toISOString(),code:error.code??error.name,message:error.message});await persist();throw error;}
  };
  const app=async role=>{
    const value=(await model.applicationsState()).applications.find(x=>x.id===journal.apps[role].applicationId);
    need(value,'DSPACE_RECEIVING_APPLICATION_MISSING');return value;
  };
  const alive=async row=>Boolean(row?.active||row?.state&&await managedCommandAlive(row.state));
  const waitFor=async(role,label,predicate,recover,cleanup=false)=>{
    const end=Date.now()+(cleanup?90000:300000),recovered=new Set();let nextProgress=0;
    for(;;){
      if(!cleanup)aborted();
      const value=await app(role);if(await predicate(value))return value;
      const current=value.current??value.adoption;
      if(recover&&current&&!await alive(current)&&['INTERRUPTED','QUEUED'].includes(current.phase)){
        const key=JSON.stringify([current.id,current.phase,current.state]);
        if(!recovered.has(key)){recovered.add(key);await recover(value);continue;}
      }
      need(cleanup||!['FAILED','UNAVAILABLE'].includes(value.phase)&&value.adoption?.phase!=='FAILED',
        'DSPACE_RECEIVING_MANAGED_FAILED','The original managed application returned a failure; its operation is retained.');
      need(Date.now()<end,'DSPACE_RECEIVING_MANAGED_PENDING','The original managed operation remains pending.');
      if(Date.now()>=nextProgress){onProgress({phase:stage,label,role,applicationId:value.id,state:value.phase,operationId:current?.id??null});nextProgress=Date.now()+15000;}
      await delay(500);
    }
  };
  const checkCommand=(command,role)=>{
    const info=journal.apps[role];
    need(command.command==='dspace-workspace'&&argument(command.args,'--directory')===info.operatorDirectory&&
      argument(command.args,'--workspace')===info.workspaceDirectory&&
      argument(command.args,'--source-directory')===join(installed.sourceRoot,DSPACE)&&
      argument(command.args,'--startup-format')==='managed'&&argument(command.args,'--port')===String(info.port)&&
      /^[a-f0-9]{64}$/.test(argument(command.args,'--expected-selection-sha256')),'DSPACE_RECEIVING_COMMAND_CHANGED');
  };
  const stop=async role=>{
    const held=live.get(role);if(!held)return;
    const row=(await app(role)).runs.find(x=>x.id===held.pass.requestId);
    if(row&&await alive(row))await model.applicationsStop({applicationId:held.info.applicationId,operationId:held.pass.requestId});
    const value=await waitFor(role,'Drain the original repository operator',async item=>{
      const current=item.runs.find(x=>x.id===held.pass.requestId);
      return current&&!await alive(current)&&['SUCCEEDED','CANCELLED','FAILED'].includes(current.phase);
    },null,true);
    const last=value.runs.find(x=>x.id===held.pass.requestId);
    held.pass.stoppedAt=new Date().toISOString();held.pass.terminalPhase=last.phase;
    live.delete(role);await persist();return {operationId:last.id,phase:last.phase,applicationPhase:value.phase};
  };
  const start=async(role,reason)=>{
    if(live.has(role))return live.get(role);
    const info=journal.apps[role];
    let pass=info.passes.at(-1),observed=await app(role),row=pass&&observed.runs.find(x=>x.id===pass.requestId);
    if(!pass||pass.stoppedAt||row&&['SUCCEEDED','CANCELLED','FAILED'].includes(row.phase)&&!await alive(row)){
      const review=await model.applicationsStartReview({applicationId:info.applicationId});checkCommand(review.command,role);
      need(review.command.createDirectories.length===0,'DSPACE_RECEIVING_REOPEN_DIRECTORY');
      pass={requestId:randomUUID(),reason,reviewId:review.id,selectionSha256:argument(review.command.args,'--expected-selection-sha256'),
        createdAt:new Date().toISOString()};info.passes.push(pass);await persist();row=null;
    }
    const recovery=async()=>{
      const value=await model.applicationsRecover({applicationId:info.applicationId,operationId:pass.requestId});
      pass.recovery={at:new Date().toISOString(),operationId:value.operationId??pass.requestId,reopened:value.reopened===true};await persist();
    };
    live.set(role,{info,pass});
    if(!row)await model.applicationsStart({applicationId:info.applicationId,requestId:pass.requestId,reviewId:pass.reviewId});
    else if(!await alive(row))await recovery();
    const running=await waitFor(role,'Open the original repository operator',async value=>{
      const item=value.runs.find(x=>x.id===pass.requestId);return Boolean(item?.url?.url&&await alive(item));
    },recovery);
    const native=running.runs.find(x=>x.id===pass.requestId);
    const connection=await readDspaceOperatorLaunch({directory:info.operatorDirectory,
      instanceId:native.url.original.instanceId,selectionSha256:pass.selectionSha256,announcement:native.url.original});
    need(connection.url===native.url.url&&connection.launch.sourceSha256===native.url.original.sourceSha256,
      'DSPACE_RECEIVING_STARTUP_CHANGED');
    pass.openedAt??=new Date().toISOString();pass.instanceId=connection.scope.instanceId;pass.operatorId=connection.scope.operatorId;
    const held={info,pass,url:connection.url,scope:connection.scope,launch:connection.launch};
    live.set(role,held);await persist();return held;
  };
  const browserJSON=async(page,url,{method='GET',input,scope,headers={}}={})=>page.evaluate(async value=>{
    const response=await fetch(value.url,{method:value.method,headers:{...value.headers,...(value.input===undefined?{}:{'content-type':'application/json'})},
      ...(value.input===undefined?{}:{body:JSON.stringify(value.input)})});
    const body=await response.json();return {status:response.status,value:body};
  },{url,method,input,headers:{...headers,...(scope?headersFor(scope):{})}});
  const current=async page=>{const response=await browserJSON(page,'/api/state');need(response.status===200,'DSPACE_RECEIVING_COOKIE_AUTH');return response.value;};
  const waitUi=async page=>{await page.waitForFunction(()=>document.querySelector('#revision')?.textContent.startsWith('Revision ')&&
    document.querySelector('#message')?.textContent!=='Opening the saved workspace…');};
  const navigate=async(page,url)=>{await page.goto(url,{waitUntil:'domcontentloaded'});await waitUi(page);};
  const refresh=async page=>{await page.locator('#refresh').click();await waitUi(page);};
  const pending=async page=>page.evaluate(()=>new Promise((resolve,reject)=>{
    const opening=indexedDB.open('starforge-dspace',1);opening.onerror=()=>reject(opening.error);
    opening.onsuccess=()=>{const db=opening.result,tx=db.transaction('requests','readonly'),read=tx.objectStore('requests').get('pending');
      read.onsuccess=()=>{const v=read.result;resolve(v?{version:v.version,kind:v.kind,project:v.project,scope:v.scope,
        operationId:v.operationId??v.value?.operationId,value:v.value??null,file:v.file?{name:v.file.name,size:v.file.size}:null}:null);};
      tx.oncomplete=()=>db.close();read.onerror=()=>reject(read.error);};
  }));
  const responseFor=(page,path,method='POST')=>page.waitForResponse(response=>{
    const url=new URL(response.url());return url.pathname===path&&response.request().method()===method;
  });
  const scopedUi=async(page,path,trigger,method='POST')=>{
    const waiting=responseFor(page,path,method);await trigger();const response=await waiting;
    const headers=response.request().headers();
    need(['operator','instance','project','workspace'].every(key=>typeof headers['x-dspace-'+key]==='string'&&headers['x-dspace-'+key]),
      'DSPACE_RECEIVING_BROWSER_SCOPE_MISSING');
    const value=await response.json();need(response.ok(),'DSPACE_RECEIVING_UI_REQUEST',value.message??value.error);
    return {value,headers:Object.fromEntries(Object.keys(headers).filter(key=>key.startsWith('x-dspace-')).map(key=>[key,headers[key]]))};
  };
  const uiDownload=async(page,button,kind,filename)=>{
    const download=page.waitForEvent('download'),response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/download'&&new URL(r.url()).searchParams.get('kind')===kind);
    await page.locator(button).click();const [event,reply]=await Promise.all([download,response]);
    need(reply.ok(),'DSPACE_RECEIVING_DOWNLOAD');const file=join(config.directory,'artifacts',filename);await event.saveAs(file);
    const identity=await fileIdentity(file);
    need(identity.sha256===reply.headers()['x-file-sha256']&&identity.bytes===Number(reply.headers()['content-length']),
      'DSPACE_RECEIVING_DOWNLOAD_CHANGED');
    journal.artifacts[filename]=identity;await persist();return identity;
  };
  const selectProject=async(page,key)=>{
    const value=await current(page);if(value.operator.selected===key){await navigate(page,page.url());return value;}
    const reply=await scopedUi(page,'/api/select-project',()=>page.locator('#project').selectOption(key));
    await page.waitForFunction(key=>document.querySelector('#project')?.value===key,key);return reply.value;
  };

  try{
    journal=await exists(journalFile)?JSON.parse(await readFile(journalFile,'utf8')):{
      schema:SCHEMA,selection,createdAt:new Date().toISOString(),apps:{},phases:{},artifacts:{},requests:{}};
    need(journal.schema===SCHEMA&&same(journal.selection,selection),'DSPACE_RECEIVING_SELECTION_CHANGED');
    if(journal.completedAt){const prior=JSON.parse(await readFile(resultFile,'utf8'));need(prior.state==='PASS','DSPACE_RECEIVING_RESULT_INCOMPLETE');return prior;}
    await persist();await privateDirectory(join(config.directory,'artifacts'));
    await phase('retain-original-project',async()=>{
      for(const role of ['a','b']){
        if(!journal.apps[role]){
          journal.apps[role]={label:'Repository receiving operator '+role.toUpperCase(),
            operatorDirectory:join(config.directory,'operator-'+role),workspaceDirectory:join(config.directory,'project-'+role),
            port:await freePort(),saveRequestId:randomUUID(),passes:[]};
          while(role==='b'&&journal.apps.b.port===journal.apps.a.port)journal.apps.b.port=await freePort();await persist();
        }
        const info=journal.apps[role],file=join(info.workspaceDirectory,'repository-datasets.sqlite3');
        const workspace=await exists(file)?await openDspaceWorkspace({directory:info.workspaceDirectory}):
          await receiveDspaceWorkspace({file:project.path,directory:info.workspaceDirectory});
        try{
          const state=workspace.state();
          if(role==='a'){
            const source=state.sources.toSorted((a,b)=>b.item_count-a.item_count)[0];
            need(source?.item_count>=45&&state.editions.length>0,'DSPACE_RECEIVING_COMPLETE_ORIGINAL_COHORT');
            const original=workspace.get('sources',source.id),inspect=original.items.toSorted((a,b)=>b.metadata_count-a.metadata_count)[0];
            const edition=state.editions.find(x=>x.id===state.selected_edition_id)??state.editions.at(-1);
            journal.baseline={workspaceId:state.id,revision:state.revision,operationCount:state.operation_count,
              sourceId:source.id,sourceSha256:source.sha256,sourceRecords:source.item_count,
              sourceItems:original.items.map(x=>({uuid:x.uuid,objectSha256:x.object_sha256})),
              editionId:edition.id,editionSha256:edition.sha256,editionRows:edition.row_count,snapshot:edition.snapshot,
              inspect:{uuid:inspect.uuid,objectSha256:inspect.object_sha256,
                metadataSha256:digest(text(inspect.object.metadata)),authorValues:inspect.object.metadata['dc.contributor.author']?.length??0}};
          }else need(state.id===journal.baseline.workspaceId&&state.revision===journal.baseline.revision,
            'DSPACE_RECEIVING_ORIGINAL_COPY_CHANGED');
        }finally{await workspace.close();}
      }
      await persist();return {workspaceId:journal.baseline.workspaceId,sourceRecords:journal.baseline.sourceRecords,
        selectedRows:journal.baseline.editionRows,project:selection.project};
    });
    if(!await exists(join(applicationWorkspace,'workspace.json')))await createRuntimeWorkspace({directory:applicationWorkspace});
    model=await openRuntimeWorkspace({directory:applicationWorkspace});
    const attached=await model.attach({directory:installed.directory,label:'Received DSpace managed runtime'});
    journal.runtimeId=attached.runtimeId;await persist();
    await phase('review-save-connect-original-applications',async()=>{
      for(const role of ['a','b']){
        const info=journal.apps[role],settings={directory:info.operatorDirectory,workspaceDirectory:info.workspaceDirectory,port:info.port};
        if(!info.reviewId){
          const review=await model.applicationsReview({runtimeId:attached.runtimeId,kind:'dspace-workspace',label:info.label,settings});
          checkCommand(review.command,role);info.reviewId=review.id;info.initialSelectionSha256=argument(review.command.args,'--expected-selection-sha256');await persist();
        }
        if(!info.applicationId){
          const value=await model.applicationsSave({requestId:info.saveRequestId,reviewId:info.reviewId});
          info.applicationId=value.applicationId;info.revision=value.revision;await persist();
          need(!value.connectionError,'DSPACE_RECEIVING_ADOPTION',value.connectionError?.message);
        }
        await model.applicationsConnect({applicationId:info.applicationId});
        const value=await waitFor(role,'Connect the original READY runtime',row=>Boolean(row.release),
          ()=>model.applicationsConnect({applicationId:info.applicationId}));
        info.releaseId=value.release.id;await persist();
      }
      return {runtimeId:attached.runtimeId,applications:Object.fromEntries(Object.entries(journal.apps).map(([role,x])=>
        [role,{applicationId:x.applicationId,saveRequestId:x.saveRequestId,reviewId:x.reviewId,releaseId:x.releaseId}]))};
    });
    const firstA=await start('a','receive-managed-operator'),firstB=await start('b','independent-managed-operator');
    const playwright=await import(pathToFileURL(config.playwrightModule).href);
    need(playwright.chromium,'DSPACE_RECEIVING_PLAYWRIGHT');
    browser=await playwright.chromium.launchPersistentContext(join(config.directory,'browser-profile'),{
      executablePath:config.browserExecutable,headless:true,acceptDownloads:true,viewport:{width:1360,height:950},
      args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--disable-gpu',
        '--disable-software-rasterizer','--renderer-process-limit=1'],
    });
    browser.setDefaultTimeout(45000);
    for(const page of browser.pages())await page.close();
    const watch=page=>{page.on('pageerror',error=>browserErrors.push({at:new Date().toISOString(),message:error.message}));return page;};
    management=await startRuntimeWorkspace({directory:applicationWorkspace,port:0});
    const manager=watch(await browser.newPage());
    await manager.goto(management.url,{waitUntil:'domcontentloaded'});
    await manager.locator('[data-view="applications"]').click();
    const openManaged=async role=>{
      await manager.locator('[data-application-id="'+journal.apps[role].applicationId+'"]').click();
      const link=manager.getByRole('link',{name:'Open application',exact:true});await link.waitFor({state:'visible'});
      const opened=browser.waitForEvent('page');await link.click();const page=watch(await opened);await waitUi(page);
      need(new URL(page.url()).origin===live.get(role).url,'DSPACE_RECEIVING_OPEN_LINK_CHANGED');pages.set(role,page);return page;
    };
    const a=await openManaged('a'),b=await openManaged('b');
    const a2=watch(await browser.newPage());await navigate(a2,firstA.url);pages.set('a2',a2);
    await manager.screenshot({path:join(config.directory,'artifacts','Applications_Running.png'),fullPage:true});
    journal.artifacts['Applications_Running.png']=await fileIdentity(join(config.directory,'artifacts','Applications_Running.png'));
    await manager.close();await management.close();management=null;await persist();
    await phase('open-two-original-operators-and-cookie-isolation',async()=>{
      const [left,right,again]=await Promise.all([current(a),current(b),current(a2)]);
      need(left.operator.id!==right.operator.id&&left.operator.id===again.operator.id&&
        left.id===journal.baseline.workspaceId&&right.id===left.id,'DSPACE_RECEIVING_OPERATOR_IDENTITY');
      const names=(await browser.cookies()).filter(x=>x.name.startsWith('dspace_operator_')).map(x=>({name:x.name,httpOnly:x.httpOnly,sameSite:x.sameSite}));
      need(names.length===2&&names.every(x=>x.httpOnly&&x.sameSite==='Strict'),'DSPACE_RECEIVING_OPERATOR_COOKIES');
      return {a:scopeOf(left),b:scopeOf(right),cookies:names,tabs:3};
    });
    await phase('complete-original-source-browser-review',async()=>{
      await selectProject(a,'original');await a.locator('[data-page="sources"]').click();
      await a.locator('#scope').selectOption('all');
      let value=(await scopedUi(a,'/api/items',()=>a.locator('#source').selectOption(journal.baseline.sourceId),'GET')).value;
      const items=[...value.items],receipts=[{offset:value.offset,total:value.total,items:value.items.length}];
      while(items.length<value.total){
        value=(await scopedUi(a,'/api/items',()=>a.locator('#next-source').click(),'GET')).value;
        items.push(...value.items);receipts.push({offset:value.offset,total:value.total,items:value.items.length});
      }
      need(same(items.map(x=>({uuid:x.uuid,objectSha256:x.objectSha256})),journal.baseline.sourceItems),
        'DSPACE_RECEIVING_SOURCE_PAGE_CHANGED');
      const chosen=journal.baseline.inspect,index=items.findIndex(x=>x.uuid===chosen.uuid&&x.objectSha256===chosen.objectSha256);
      value=(await scopedUi(a,'/api/items',()=>a.locator('#source').selectOption(journal.baseline.sourceId),'GET')).value;
      for(let offset=0;offset<Math.floor(index/20);offset++)value=(await scopedUi(a,'/api/items',()=>a.locator('#next-source').click(),'GET')).value;
      await scopedUi(a,'/api/item',()=>a.locator('[data-inspect="'+(index%20)+'"]').click(),'GET');
      await a.waitForFunction(uuid=>document.querySelector('#item-json')?.textContent.includes(uuid),chosen.uuid);
      const inspected=JSON.parse(await a.locator('#item-json').textContent());
      need(digest(text(inspected.object.metadata))===chosen.metadataSha256,'DSPACE_RECEIVING_METADATA_ARRAY_CHANGED');
      const source=await uiDownload(a,'#source-download','source','Original_Repository_Source.json');
      await a.screenshot({path:join(config.directory,'artifacts','Repository_Source_Review.png'),fullPage:true});
      journal.artifacts['Repository_Source_Review.png']=await fileIdentity(join(config.directory,'artifacts','Repository_Source_Review.png'));await persist();
      return {sourceId:journal.baseline.sourceId,records:items.length,pages:receipts,inspected:chosen,download:source};
    });
    await phase('full-native-query-and-dataset-downloads',async()=>{
      await a.locator('[data-page="editions"]').click();
      await scopedUi(a,'/api/record',()=>a.locator('#edition').selectOption(journal.baseline.editionId),'GET');
      await a.locator('#query-uuid').fill('');await a.locator('#query-sort').selectOption('');await a.locator('#query-limit').selectOption('20');
      let response=(await scopedUi(a,'/api/query',()=>a.locator('#query-form button[type="submit"]').click())).value;
      const replies=[response],rows=[...response.rows];
      while(response.page.nextCursor){
        response=(await scopedUi(a,'/api/query',()=>a.locator('#next-query').click())).value;replies.push(response);rows.push(...response.rows);
      }
      need(rows.length===journal.baseline.editionRows&&replies.every(x=>x.dataset.snapshot===journal.baseline.snapshot),
        'DSPACE_RECEIVING_NATIVE_QUERY_CHANGED');
      const file=join(config.directory,'artifacts','Native_Query_Pages.json');await save(file,{editionId:journal.baseline.editionId,replies});
      journal.artifacts['Native_Query_Pages.json']=await fileIdentity(file);await persist();
      const csv=await uiDownload(a,'#edition-csv','dataset','Repository_Dataset.csv');
      const dataset=await uiDownload(a,'#edition-config','config','Repository_Dataset_Config.json');
      const originalEdition=await uiDownload(a,'#edition-records','editions','Repository_Edition.json');
      return {editionId:journal.baseline.editionId,rows:rows.length,pages:replies.length,snapshot:journal.baseline.snapshot,csv,dataset,originalEdition};
    });
    const transfer=await phase('complete-project-transfer-and-stale-tab',async()=>{
      await a.locator('[data-page="delivery"]').click();
      const file=await uiDownload(a,'#project-download','project','Repository_Before_Managed_Review.sqlite3');
      const original=scopeOf(await current(a));await a2.locator('[data-page="delivery"]').click();
      const received=(await scopedUi(a2,'/api/receive',()=>a2.locator('#project-file').setInputFiles(file.path))).value;
      need(received.sha256===file.sha256&&received.state.id===original.workspaceId&&received.state.operator.selected!=='original',
        'DSPACE_RECEIVING_COMPLETE_PROJECT_CHANGED');
      const stale=await browserJSON(a,'/api/query',{method:'POST',scope:original,
        input:{editionId:journal.baseline.editionId,query:{limit:'20'}}});
      need(stale.status===409&&stale.value.error==='DSCOPE_PROJECT','DSPACE_RECEIVING_STALE_PROJECT_ACCEPTED');
      const originalCount=(await current(a2)).operation_count;
      const mutation=await browserJSON(a,'/api/action',{method:'POST',scope:original,input:{action:'review-edition',
        operationId:randomUUID(),actor:'Managed receiving',expectedRevision:journal.baseline.revision,
        editionId:journal.baseline.editionId,editionSha256:journal.baseline.editionSha256,
        decision:'approved',comment:'This stale tab must remain bound to its original project.'}});
      need(mutation.status===409&&mutation.value.error==='DSCOPE_PROJECT'&&(await current(a2)).operation_count===originalCount,
        'DSPACE_RECEIVING_STALE_MUTATION_ACCEPTED');
      const independent=await current(b);need(independent.operator.id===firstB.scope.operatorId,'DSPACE_RECEIVING_OTHER_COOKIE_CHANGED');
      await selectProject(a2,'original');await navigate(a,firstA.url);
      return {file,operationId:received.operationId,receivedProject:received.state.operator.selected,
        originalScope:original,readRejection:stale.value.error,mutationRejection:mutation.value.error};
    });

    const lost=await phase('retain-committed-browser-request-after-response-loss',async()=>{
      await selectProject(a,'original');await a.locator('[data-page="editions"]').click();
      await scopedUi(a,'/api/record',()=>a.locator('#edition').selectOption(journal.baseline.editionId),'GET');
      if(!journal.requests.review){
        const before=await current(a);
        let settle,rejectBoundary;const boundary=new Promise((done,reject)=>{settle=done;rejectBoundary=reject;});
        const route=async route=>{
          try{
            const request=route.request(),input=request.postDataJSON();
            if(input.action!=='review-edition'){await route.continue();return;}
            journal.requests.review={input,scope:scopeOf(before),beforeCount:before.operation_count,
              beforeRevision:before.revision,inputSha256:digest(text(input)),startedAt:new Date().toISOString()};await persist();
            const response=await route.fetch(),value=await response.json();
            need(response.ok()&&value.operationId===input.operationId,'DSPACE_RECEIVING_REVIEW_NOT_COMMITTED');
            journal.requests.review.accepted=value;journal.requests.review.committedAt=new Date().toISOString();await persist();
            await route.abort('failed');settle();
          }catch(error){await route.abort('failed').catch(()=>{});rejectBoundary(error);}
        };
        await a.route('**/api/action',route);
        try{
          await a.locator('#decision').selectOption('approved');
          await a.locator('#review-comment').fill('Managed repository receiving: complete source, native dataset and original lineage reviewed.');
          await a.locator('#review-form button[type="submit"]').click();await boundary;
        }finally{await a.unroute('**/api/action',route);}
      }
      await a.locator('#pending').waitFor({state:'visible'});
      const retained=await pending(a),request=journal.requests.review;
      need(retained?.operationId===request.input.operationId&&same(retained.value,request.input)&&same(retained.scope,request.scope),
        'DSPACE_RECEIVING_LOST_INTENT_CHANGED');
      const original=await browserJSON(a,'/api/operation?id='+encodeURIComponent(request.input.operationId),{scope:scopeOf(await current(a))});
      need(original.status===200&&original.value.result.operationId===request.input.operationId,
        'DSPACE_RECEIVING_ORIGINAL_OPERATION_MISSING');
      return {operationId:request.input.operationId,inputSha256:request.inputSha256,beforeCount:request.beforeCount,
        acceptedRevision:original.value.result.revision,reviewId:original.value.result.review.id,scope:request.scope};
    });
    await phase('second-tab-preserves-original-pending-intent',async()=>{
      // This tab was opened before the first response was interrupted. Its
      // original local state still offers a new action; IndexedDB must arbitrate.
      await a2.locator('[data-page="editions"]').click();
      await scopedUi(a2,'/api/record',()=>a2.locator('#edition').selectOption(journal.baseline.editionId),'GET');
      let sends=0;const observe=request=>{if(new URL(request.url()).pathname==='/api/action')sends++;};a2.on('request',observe);
      try{
        await a2.locator('#decision').selectOption('approved');
        await a2.locator('#review-comment').fill('A second tab must preserve the original pending review.');
        await a2.locator('#review-form button[type="submit"]').click();
        await a2.waitForFunction(()=>/Another saved browser request|Recover the saved request/.test(document.querySelector('#message')?.textContent??''));
      }finally{a2.off('request',observe);}
      const original=await pending(a2);
      need(sends===0&&original?.operationId===lost.operationId&&digest(text(original.value))===lost.inputSha256,
        'DSPACE_RECEIVING_PENDING_REQUEST_REPLACED');
      need((await current(a)).operation_count===lost.beforeCount+1&&(await pending(b))===null,
        'DSPACE_RECEIVING_CROSS_TAB_MUTATION');
      return {operationId:lost.operationId,nativeSends:sends,retainedInputSha256:digest(text(original.value))};
    });
    await phase('saved-request-stale-project-and-explicit-reconnect',async()=>{
      await selectProject(a2,transfer.receivedProject);
      const waiting=responseFor(a,'/api/action');await a.locator('#retry').click();const response=await waiting,value=await response.json();
      need(response.status()===409&&value.error==='DSCOPE_PROJECT','DSPACE_RECEIVING_SAVED_REQUEST_RETARGETED');
      const original=await pending(a);need(original?.operationId===lost.operationId&&same(original.value,journal.requests.review.input),
        'DSPACE_RECEIVING_SCOPE_REJECTION_LOST_INPUT');
      await a.locator('#reconnect-request').click();
      await a.waitForFunction(()=>document.querySelector('#message')?.textContent.startsWith('Reconnected the saved request'));
      const rebound=await pending(a),state=await current(a);
      need(rebound.operationId===lost.operationId&&same(rebound.value,journal.requests.review.input)&&state.operator.selected==='original'&&
        rebound.scope.workspaceId===journal.baseline.workspaceId,'DSPACE_RECEIVING_RECONNECT_CHANGED_TARGET');
      return {operationId:lost.operationId,rejection:value.error,scope:rebound.scope};
    });
    await phase('managed-stop-reopen-and-same-id-browser-recovery',async()=>{
      if(!journal.restart){
        const original=await pending(a);
        need(original?.operationId===lost.operationId,'DSPACE_RECEIVING_RESTART_INTENT_MISSING');
        journal.restart={oldScope:original.scope,origin:new URL(a.url()).origin,previousManagedOperationId:live.get('a').pass.requestId,
          originalInputSha256:digest(text(original.value)),startedAt:new Date().toISOString()};await persist();
      }
      if(live.get('a')?.scope.instanceId===journal.restart.oldScope.instanceId){
        journal.restart.stop=await stop('a');await persist();
      }
      await model.close();model=await openRuntimeWorkspace({directory:applicationWorkspace});
      const reopened=await start('a','same-origin-saved-browser-request');
      need(reopened.url===journal.restart.origin&&reopened.scope.operatorId===journal.restart.oldScope.operatorId&&
        reopened.scope.workspaceId===journal.restart.oldScope.workspaceId&&reopened.scope.instanceId!==journal.restart.oldScope.instanceId,
        'DSPACE_RECEIVING_REOPEN_IDENTITY_CHANGED');
      journal.restart.managedOperationId=reopened.pass.requestId;journal.restart.scope=reopened.scope;await persist();
      await navigate(a,reopened.url);await a.locator('#pending').waitFor({state:'visible'});
      const stale=await browserJSON(a2,'/api/state',{scope:journal.restart.oldScope});
      need(stale.status===409&&stale.value.error==='DSCOPE_INSTANCE','DSPACE_RECEIVING_STALE_INSTANCE_ACCEPTED');
      let sends=0;const observe=request=>{if(new URL(request.url()).pathname==='/api/action')sends++;};a.on('request',observe);
      try{
        await a.locator('#retry').click();
        await a.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('operator restarted'));
      }finally{a.off('request',observe);}
      need(sends===0&&(await pending(a)).operationId===lost.operationId,'DSPACE_RECEIVING_INSTANCE_REBOUND_WITHOUT_REVIEW');
      await a.locator('#reconnect-request').click();
      await a.waitForFunction(()=>document.querySelector('#message')?.textContent.startsWith('Reconnected the saved request'));
      const rebound=await pending(a);need(rebound.operationId===lost.operationId&&
        digest(text(rebound.value))===journal.restart.originalInputSha256&&same(rebound.scope,reopened.scope),
        'DSPACE_RECEIVING_RESTART_INPUT_CHANGED');
      const recovered=(await scopedUi(a,'/api/action',()=>a.locator('#retry').click())).value;
      await a.locator('#pending').waitFor({state:'hidden'});
      const state=await current(a),other=await current(b);
      need(recovered.replayed===true&&recovered.operationId===lost.operationId&&
        recovered.review.id===lost.reviewId&&state.operation_count===lost.beforeCount+1&&other.operator.id===firstB.scope.operatorId,
        'DSPACE_RECEIVING_SAME_ID_RECOVERY_CHANGED');
      need((await pending(a))===null,'DSPACE_RECEIVING_PENDING_NOT_CLEARED');
      journal.restart.recovery={operationId:recovered.operationId,replayed:recovered.replayed,reviewId:recovered.review.id,
        revision:state.revision,operationCount:state.operation_count};await persist();
      return {...journal.restart,staleInstanceRejection:stale.value.error,unreviewedNativeSends:sends,otherOperatorId:other.operator.id};
    });
    await phase('reviewed-project-export-receive-and-mobile-reopen',async()=>{
      await a.locator('[data-page="editions"]').click();
      await scopedUi(a,'/api/record',()=>a.locator('#edition').selectOption(journal.baseline.editionId),'GET');
      const selected=(await scopedUi(a,'/api/action',()=>a.locator('#select-edition').click())).value;
      need(selected.selected_edition_id===journal.baseline.editionId,'DSPACE_RECEIVING_SELECTED_EDITION_CHANGED');
      await a.locator('[data-page="delivery"]').click();
      const file=await uiDownload(a,'#project-download','project','Repository_Managed_Workspace.sqlite3');
      const before=await current(a);await b.locator('[data-page="delivery"]').click();
      const received=(await scopedUi(b,'/api/receive',()=>b.locator('#project-file').setInputFiles(file.path))).value;
      need(received.sha256===file.sha256&&received.bytes===file.bytes&&received.state.id===before.id&&
        received.state.revision===before.revision&&received.state.operation_count===before.operation_count&&
        received.state.reviews.some(x=>x.id===lost.reviewId),'DSPACE_RECEIVING_FINAL_PROJECT_CHANGED');
      const request=await browserJSON(b,'/api/operation?id='+encodeURIComponent(lost.operationId),{scope:scopeOf(received.state)});
      need(request.status===200&&request.value.result.review.id===lost.reviewId,'DSPACE_RECEIVING_RECEIVED_OPERATION_CHANGED');
      await b.locator('[data-page="editions"]').click();
      await scopedUi(b,'/api/record',()=>b.locator('#edition').selectOption(journal.baseline.editionId),'GET');
      await b.locator('#query-uuid').fill('');await b.locator('#query-limit').selectOption('50');
      const query=(await scopedUi(b,'/api/query',()=>b.locator('#query-form button[type="submit"]').click())).value;
      need(query.page.total===journal.baseline.editionRows&&query.dataset.snapshot===journal.baseline.snapshot,
        'DSPACE_RECEIVING_RECEIVED_NATIVE_QUERY_CHANGED');
      await b.screenshot({path:join(config.directory,'artifacts','Repository_Received_Query.png'),fullPage:true});
      journal.artifacts['Repository_Received_Query.png']=await fileIdentity(join(config.directory,'artifacts','Repository_Received_Query.png'));
      await a.setViewportSize({width:390,height:844});await navigate(a,live.get('a').url);
      await a.locator('[data-page="delivery"]').click();await a.locator('#project-download').waitFor({state:'visible'});
      const dimensions=await a.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      need(dimensions.document<=dimensions.viewport+1,'DSPACE_RECEIVING_MOBILE_OVERFLOW');
      await a.screenshot({path:join(config.directory,'artifacts','Repository_Mobile_Reopen.png'),fullPage:true});
      journal.artifacts['Repository_Mobile_Reopen.png']=await fileIdentity(join(config.directory,'artifacts','Repository_Mobile_Reopen.png'));await persist();
      return {file,originalWorkspaceId:before.id,revision:before.revision,operationCount:before.operation_count,
        selectedEditionId:before.selected_edition_id,receivingOperationId:received.operationId,receivedProject:received.state.operator.selected,
        retainedReviewId:lost.reviewId,rows:query.page.total,snapshot:query.dataset.snapshot,mobile:dimensions};
    });
    await phase('stop-original-managed-operators',async()=>{
      const a=await stop('a'),b=await stop('b');
      need([a,b].every(x=>x&&['SUCCEEDED','CANCELLED'].includes(x.phase)&&x.applicationPhase==='STOPPED'),
        'DSPACE_RECEIVING_MANAGED_STOP_INCOMPLETE');
      await model.close();model=await openRuntimeWorkspace({directory:applicationWorkspace});
      const reopened=await model.applicationsState();
      need(Object.values(journal.apps).every(info=>reopened.applications.some(x=>x.id===info.applicationId&&x.phase==='STOPPED')),
        'DSPACE_RECEIVING_APPLICATION_HISTORY_CHANGED');
      return {a,b,retainedApplications:Object.values(journal.apps).map(x=>x.applicationId)};
    });
    need(browserErrors.length===0,'DSPACE_RECEIVING_BROWSER_ERROR',browserErrors.map(x=>x.message).join('; '));
    journal.completedAt=new Date().toISOString();await persist();
    result={schema:SCHEMA,state:'PASS',completedAt:journal.completedAt,selection,
      sourceRecords:journal.baseline.sourceRecords,selectedRows:journal.baseline.editionRows,
      originalWorkspaceId:journal.baseline.workspaceId,managedApplications:Object.fromEntries(Object.entries(journal.apps).map(([role,x])=>
        [role,{applicationId:x.applicationId,port:x.port,operatorDirectory:x.operatorDirectory,workspaceDirectory:x.workspaceDirectory,passes:x.passes}])),
      phases:Object.entries(journal.phases).map(([name,value])=>({name,state:value.state,completedAt:value.completedAt,result:value.result})),
      artifacts:[...Object.values(journal.artifacts),{path:journalFile}],browserErrors};
    await save(resultFile,result);onProgress({state:'PASS',resultFile,phases:result.phases.length});
  }catch(error){
    failed=error;
    if(journal){journal.issue={stage,at:new Date().toISOString(),code:error.code??error.name,message:error.message};await persist().catch(()=>{});}
    await save(resultFile,{schema:SCHEMA,state:'INTERRUPTED',stage,code:error.code??error.name,message:error.message,
      journal:journalFile,phases:journal?Object.entries(journal.phases).map(([name,value])=>({name,...value})):[]}).catch(()=>{});
  }finally{
    const errors=[];
    for(const role of [...live.keys()])try{await stop(role);}catch(error){errors.push({stage:'stop-'+role,code:error.code??error.name,message:error.message});}
    for(const [name,close] of [['browser',()=>browser?.close()],['management',()=>management?.close()],
      ['model',()=>model?.close()],['journal',()=>saving],['lease',()=>lease.close()]])
      try{await close();}catch(error){errors.push({stage:name,code:error.code??error.name,message:error.message});}
    if(errors.length){
      if(journal){journal.closureErrors=errors;delete journal.completedAt;await persist().catch(()=>{});}
      await save(resultFile,{...(result??{}),schema:SCHEMA,state:'INTERRUPTED',closureErrors:errors,journal:journalFile}).catch(()=>{});
      failed??=Object.assign(new Error('The original managed receiving has retained closure work.'),{code:'DSPACE_RECEIVING_CLOSURE'});
    }
  }
  if(failed)throw failed;return result;
}

function cli(argv){
  const names={'--runtime-directory':'runtimeDirectory','--source-commit':'expectedSourceCommit',
    '--manifest-sha256':'expectedManifest','--directory':'directory','--project-file':'projectFile',
    '--browser-executable':'browserExecutable','--playwright-module':'playwrightModule',
    '--bootstrap-source-root':'bootstrapSourceRoot'},value={};
  for(let index=0;index<argv.length;index+=2){
    const key=names[argv[index]];need(key&&argv[index+1]&&!Object.hasOwn(value,key),'DSPACE_RECEIVING_ARGUMENTS');
    value[key]=argv[index+1];
  }
  return value;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  receiveDspaceManagedApplication(cli(process.argv.slice(2)),{onProgress:value=>process.stdout.write(text(value))})
    .catch(error=>{process.stderr.write(text({state:'INTERRUPTED',code:error.code??error.name,message:error.message}));process.exitCode=1;});
}
