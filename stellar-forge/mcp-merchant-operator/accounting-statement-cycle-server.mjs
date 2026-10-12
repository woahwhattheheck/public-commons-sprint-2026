// MIT. Local closing workbench over the original accounting statement client and cycle engine.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdir, readdir, readFile, realpath, stat, lstat} from 'node:fs/promises';
import {resolve, join, relative, isAbsolute, sep, extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes, createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {connectAccountingStatementClient, accountingStatementPreview, accountingStatementSelection} from './accounting-statement-client.mjs';
import {prepareAccountingStatementCycle, runAccountingStatementCycle, observeAccountingStatementCycle} from './accounting-statement-cycle.mjs';

import {readAccountingStatementServicePlanner,compileAccountingStatementServicePlan,validateAccountingStatementServicePlan,prepareAccountingStatementServiceCycle,renderAccountingStatementServicePlanCsv,renderAccountingStatementServicePlanHtml} from './accounting-statement-service-planner.mjs';
import {createCustomerSetupRoutes} from './accounting-statement-setup.mjs';
import {inspectAccountingStatementCustomerDossiers, exportAccountingStatementCustomerDossier, readAccountingStatementCustomerDossier} from './accounting-statement-customer-dossier.mjs';
import {readBrowserAssets} from '../../stellar/scf-starforge-20261009/distribution/browser-assets.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const KEY=/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256=/^[a-f0-9]{64}$/;
const STATIC=await readBrowserAssets(new URL('./accounting-statement-cycle-browser-assets.json',import.meta.url));
const TYPE={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const cleanError=error=>({code:String(error?.code??'WORKBENCH_ERROR'),message:String(error?.message??'The operation could not be completed.')});
const ordinal=index=>String(index+1).padStart(6,'0');
function need(condition,message,status=400,code='WORKBENCH_ARGUMENTS'){if(!condition)throw fail(status,code,message);}
function safeKey(value){need(typeof value==='string'&&KEY.test(value)&&value!=='.'&&value!=='..','Select a saved closing cycle.');return value;}
const selection=accountingStatementSelection;

async function bodyJson(request){
  need((request.headers['content-type']??'').split(';')[0].trim()==='application/json','Send a JSON request.',415);
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;need(size<=20_000_000,'The selection is too large.',413);chunks.push(chunk);}
  try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));need(plain(result),'Send a JSON object.');return result;}catch(error){if(error.status)throw error;throw fail(400,'WORKBENCH_JSON','The request is not valid JSON.');}
}
function sendJson(response,status,value){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));}
async function exists(path){try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function inside(root,path){
  const target=await realpath(path),difference=relative(root,target);
  need(difference!==''&&!difference.startsWith('..'+sep)&&difference!=='..'&&!isAbsolute(difference),'Choose a file inside this closing cycle.',403,'WORKBENCH_PATH');
  return target;
}
async function allRuns(client){
  const items=[];let offset=0,total,revision;
  for(;;){
    const result=await client.status({view:'runs',offset,limit:200}),page=result.page;
    need(page?.kind==='runs'&&Array.isArray(page.items)&&page.offset===offset&&Number.isSafeInteger(page.total)&&page.total>=0,
      'The completed-run inventory was incomplete. Refresh the workspace.',502,'WORKBENCH_PAGE');
    revision??=result.revision;total??=page.total;
    need(revision===result.revision&&total===page.total,'The workspace changed while its runs were being read. Refresh the workspace.',409,'WORKBENCH_INVENTORY_CHANGED');
    items.push(...page.items);
    if(page.nextOffset===null){need(items.length===total,'The run inventory ended early.',502,'WORKBENCH_PAGE');return {items,revision};}
    need(page.nextOffset===offset+page.items.length&&page.nextOffset>offset&&page.nextOffset<total,'The run inventory did not advance.',502,'WORKBENCH_PAGE');
    offset=page.nextOffset;
  }
}
async function inventory(client){
  const [customers,usage,runs,statements,bindings]=await Promise.all([
    client.allCustomers(),client.allUsage(),allRuns(client),client.allStatements(),client.allBindings()
  ]);
  const revisions=[customers,usage,runs,statements,bindings].map(value=>value.revision);
  need(revisions.every(value=>value===revisions[0]),'The workspace changed while its inventories were being read. Refresh after the active operation finishes.',409,'WORKBENCH_INVENTORY_CHANGED');
  return {revision:revisions[0],observedAt:new Date().toISOString(),customers:customers.items,usage:usage.items,runs:runs.items,statements:statements.items,bindings:bindings.items};
}
function tarHeader(name,size,{directory=false}={}){
  need(Buffer.byteLength(name)<=100&&Number.isSafeInteger(size)&&size>=0&&size<8**11,'This file cannot be included in the portable archive.',500,'WORKBENCH_ARCHIVE');
  const block=Buffer.alloc(512),put=(value,offset,length)=>block.write(value,offset,length,'utf8');
  put(name,0,100);put(directory?'0000700\0':'0000600\0',100,8);put('0000000\0',108,8);put('0000000\0',116,8);
  put(size.toString(8).padStart(11,'0')+'\0',124,12);put('00000000000\0',136,12);
  block.fill(32,148,156);put(directory?'5':'0',156,1);put('ustar\0',257,6);put('00',263,2);
  const checksum=block.reduce((sum,value)=>sum+value,0);
  put(checksum.toString(8).padStart(6,'0')+'\0 ',148,8);return block;
}
async function* verifiedFile(file){
  let observed=0;const hash=createHash('sha256');
  for await(const chunk of createReadStream(file.path)){observed+=chunk.length;hash.update(chunk);yield chunk;}
  need(observed===file.bytes&&(!file.sha256||hash.digest('hex')===file.sha256),
    'A saved customer file differs from its recorded contents. Resume the original cycle to recover its files.',409,'WORKBENCH_FILE_CHANGED');
}
async function* tarStream(files,assertReadable){
  const directories=new Set();
  for(const file of files){
    const parts=file.name.split('/');
    for(let index=1;index<parts.length;index++){
      const name=parts.slice(0,index).join('/')+'/';
      if(!directories.has(name)){assertReadable();yield tarHeader(name,0,{directory:true});directories.add(name);}
    }
    assertReadable();yield tarHeader(file.name,file.bytes);yield* verifiedFile(file);
    const padding=(512-file.bytes%512)%512;if(padding)yield Buffer.alloc(padding);
  }
  assertReadable();yield Buffer.alloc(1024);
}

/** Every write uses the original statement operation or cycle engine. The listener binds to loopback. */
export async function startAccountingStatementCycleWorkbench({
  directory,url,workspace,actor,tokenEnv='MCP_ACCESS_TOKEN',environment=process.env,host='127.0.0.1',port=4419,client:providedClient
}={}){
  need(typeof directory==='string'&&isAbsolute(directory),'Choose an absolute directory for saved closing cycles.');
  need(['127.0.0.1','::1','localhost'].includes(host),'The closing workbench must listen on this computer.');
  need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'Choose a valid local port.');
  need(typeof actor==='string'&&actor.trim()&&actor.length<=1000,'Choose the operator recorded on the statements.');
  need(typeof url==='string'&&typeof workspace==='string','Choose the existing merchant URL and workspace.');
  url=new URL(url).href;actor=actor.trim();
  await mkdir(directory,{recursive:true,mode:0o700});const root=await realpath(directory);
  const rootInfo=await stat(root);
  need(rootInfo.isDirectory()&&!(rootInfo.mode&0o077)&&(!process.getuid||rootInfo.uid===process.getuid()),'Use a private cycle directory owned by this operator (mode 0700).',400,'WORKBENCH_DIRECTORY');
  const csrfToken=randomBytes(32).toString('hex'),jobs=new Map(),dossierExports=new Map(),dossierQueues=new Map(),controller=new AbortController();let clientPromise,inventoryPromise,plannerInventory,plannerInventoryPromise,closing=false,origin,workQueue=Promise.resolve();
  const connection=async()=>{
    if(!clientPromise)clientPromise=(async()=>{
      const client=providedClient??await connectAccountingStatementClient({url,workspace,tokenEnv,environment,signal:controller.signal});
      need(client.workspace===workspace,'The connected client belongs to another workspace.',409,'WORKBENCH_WORKSPACE');
      await client.open();return client;
    })().catch(error=>{clientPromise=undefined;throw error;});
    return clientPromise;
  };
  const cyclePath=key=>join(root,safeKey(key));
  async function cycleRequest(key){
    const path=await inside(root,join(cyclePath(key),'request.json'));
    const value=JSON.parse(await readFile(path,'utf8'));
    need(value.schema==='stellar-forge.accounting-statement-cycle-request.v1','This directory does not contain a closing-cycle request.',409,'WORKBENCH_CYCLE');
    return value;
  }
  async function compatible(key){
    const request=await cycleRequest(key);
    need(request.workspace===workspace&&request.url===url,'Open this cycle with its original merchant URL and workspace.',409,'WORKBENCH_WORKSPACE');
    return request;
  }
  async function record(key){
    const job=jobs.get(key),request=await cycleRequest(key);
    try{return {...await observeAccountingStatementCycle({directory:cyclePath(key)}),key,job:job?{kind:job.kind,phase:job.phase,error:job.error,startedAt:job.startedAt,finishedAt:job.finishedAt}:null};}
    catch(error){
      if(await exists(join(cyclePath(key),'manifest.json')))throw error;
      return {key,cycleId:request.cycleId,label:request.label,workspace:request.workspace,preparedAt:request.createdAt,
        observedAt:new Date().toISOString(),phase:'UNPREPARED',complete:false,rows:[],counts:{total:request.selections.length,retained:0,delivered:0,errors:job?.phase==='ERROR'?1:0},
        job:job?{kind:job.kind,phase:job.phase,error:job.error,startedAt:job.startedAt,finishedAt:job.finishedAt}:null,
        error:['QUEUED','RUNNING'].includes(job?.phase)?null:job?.error??{code:'WORKBENCH_PREPARATION_INCOMPLETE',message:'Continue preparing to finish the saved customer reviews.'}};
    }
  }
  function begin(key,kind,work){
    need(!closing,'The workbench is shutting down.',503,'WORKBENCH_CLOSING');
    const previous=jobs.get(key);if(['QUEUED','RUNNING'].includes(previous?.phase))return previous;
    const job={kind,phase:'QUEUED',error:null,startedAt:new Date().toISOString(),finishedAt:null,promise:null};
    jobs.set(key,job);
    const predecessor=Promise.all([kind==='RUN'?workQueue:Promise.resolve(),dossierQueues.get(key)?.catch(()=>{})??Promise.resolve()]);
    job.promise=predecessor.then(()=>{controller.signal.throwIfAborted();job.phase='RUNNING';return work();}).then(()=>{job.phase='FINISHED';},error=>{job.phase='ERROR';job.error=cleanError(error);})
      .finally(()=>{job.finishedAt=new Date().toISOString();});
    if(kind==='RUN')workQueue=job.promise;
    return job;
  }
  const jobView=job=>({kind:job.kind,phase:job.phase,error:job.error,startedAt:job.startedAt,finishedAt:job.finishedAt});
  async function filesFor(key,itemIndex){
    need(!['QUEUED','RUNNING'].includes(jobs.get(key)?.phase),'Wait for the active closing operation before downloading a complete packet.',409,'WORKBENCH_ACTIVE');
    const report=await record(key),names=new Map();
    const add=(name,identity)=>names.set(name,identity);
    async function addCustomer(index,required){
      const row=report.rows[index];need(row,'Choose a customer in this cycle.',404);
      if(required)need(row.delivery?.complete,'This customer packet is still being completed.',409,'WORKBENCH_DELIVERY_PENDING');
      const prefix='items/'+ordinal(index)+'/delivery/',identities=new Map(Object.entries(row.statement?.files??{}));
      for(const file of row.delivery?.files??[])identities.set(file.name,file);
      if(row.delivery?.statusFile)identities.set('status.json',row.delivery.statusFile);
      if(row.delivery?.indexFile)identities.set('index.html',row.delivery.indexFile);
      for(const name of new Set([...identities.keys(),'delivery.json','status.json','index.html'])){
        if(required||await exists(join(cyclePath(key),prefix+name)))add(prefix+name,identities.get(name));
      }
    }
    if(itemIndex!==undefined)await addCustomer(itemIndex,true);
    else{
      for(const name of ['request.json','manifest.json','register.json','register.html'])if(await exists(join(cyclePath(key),name)))add(name);
      for(let index=0;index<report.rows.length;index++){
        const prefix='items/'+ordinal(index)+'/';
        if(await exists(join(cyclePath(key),prefix+'review.json')))add(prefix+'review.json',report.rows[index].reviewFile);
        if(await exists(join(cyclePath(key),prefix+'state.json')))add(prefix+'state.json');
        await addCustomer(index,false);
      }
    }
    const files=[];
    for(const [name,identity] of [...names.entries()].sort(([a],[b])=>a.localeCompare(b))){
      need(!name.includes('\\')&&!name.split('/').some(part=>!part||part==='.'||part==='..'),'The saved packet contains an invalid file name.',409);
      const path=await inside(root,join(cyclePath(key),name)),info=await stat(path);
      need(info.isFile(),'The saved packet contains a non-file entry.',409);
      if(identity)need(info.size===identity.bytes,'A saved customer file has changed size. Resume the original cycle to recover it.',409,'WORKBENCH_FILE_CHANGED');
      files.push({name,path,bytes:info.size,sha256:identity?.sha256});
    }
    return files;
  }

  function customerId(value){need(typeof value==='string'&&UUID.test(value),'Choose a customer from this closing cycle.');return value;}
  const dossierRoot=(key,id)=>join(root,'.customer-dossiers',safeKey(key),customerId(id));
  async function prepareDossierParent(key){
    let parent=root;
    for(const name of ['.customer-dossiers',safeKey(key)]){
      const path=join(parent,name);
      try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
      const info=await lstat(path);
      need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid()),
        'Use private customer packet directories owned by this operator (mode 0700).',409,'WORKBENCH_DIRECTORY');
      const target=await inside(root,path);
      need(target===path,'The customer packet directory must remain inside the original saved-work directory.',403,'WORKBENCH_PATH');
      parent=target;
    }
    return parent;
  }
  function dossierView(key,snapshot){
    const base='/api/cycles/'+encodeURIComponent(key)+'/customers/'+snapshot.customer.customerId+'/snapshots/'+snapshot.snapshotSha256;
    const {schema,cycle,customer,snapshotSha256,observedAt,complete,counts,statements,totalBytes}=snapshot;
    return {schema,cycle,customer,snapshotSha256,observedAt,complete,counts,statements,totalBytes,reused:snapshot.reused===true,
      indexHref:base+'/file/index.html',downloadHref:base+'/download',
      files:snapshot.files.map(file=>({...file,href:base+'/file/'+file.path.split('/').map(encodeURIComponent).join('/')+'?download=1'}))};
  }
  async function prepareCustomerDossier(key,id){
    customerId(id);need(!closing,'The workbench is shutting down.',503,'WORKBENCH_CLOSING');
    const identity=key+'\0'+id,existing=dossierExports.get(identity);if(existing)return existing;
    need(!['QUEUED','RUNNING'].includes(jobs.get(key)?.phase),'Wait for the active closing operation before preparing the customer packet.',409,'WORKBENCH_ACTIVE');
    const predecessor=dossierQueues.get(key)??Promise.resolve();
    const promise=predecessor.catch(()=>{}).then(async()=>{
      controller.signal.throwIfAborted();
      need(!['QUEUED','RUNNING'].includes(jobs.get(key)?.phase),'Wait for the active closing operation before preparing the customer packet.',409,'WORKBENCH_ACTIVE');
      await compatible(key);await prepareDossierParent(key);
      const snapshot=await exportAccountingStatementCustomerDossier({directory:cyclePath(key),customerId:id,outputDirectory:dossierRoot(key,id),signal:controller.signal});
      need(snapshot.customer?.customerId===id&&SHA256.test(snapshot.snapshotSha256??''),'The customer packet does not match the saved selection.',409,'WORKBENCH_CUSTOMER_DOSSIER');
      return dossierView(key,snapshot);
    });
    dossierExports.set(identity,promise);dossierQueues.set(key,promise);
    const clear=()=>{if(dossierExports.get(identity)===promise)dossierExports.delete(identity);if(dossierQueues.get(key)===promise)dossierQueues.delete(key);};
    promise.then(clear,clear);return promise;
  }
  async function customerDossierFiles(key,id,snapshotSha256){
    customerId(id);need(SHA256.test(snapshotSha256),'Choose a saved customer packet.');
    controller.signal.throwIfAborted();
    const request=await compatible(key),directory=await inside(root,join(dossierRoot(key,id),snapshotSha256));
    const snapshot=await readAccountingStatementCustomerDossier({directory,signal:controller.signal});
    need(snapshot.snapshotSha256===snapshotSha256&&snapshot.customer?.customerId===id&&snapshot.cycle?.cycleId===request.cycleId&&snapshot.cycle?.workspace===workspace&&snapshot.cycle?.requestSha256===request.sha256,
      'The saved customer packet belongs to a different closing cycle or customer.',409,'WORKBENCH_CUSTOMER_DOSSIER');
    const files=[];
    for(const file of snapshot.files){
      const name=file.path;
      need(typeof name==='string'&&!name.includes('\\')&&!name.split('/').some(part=>!part||part==='.'||part==='..')&&
        SHA256.test(file.sha256??'')&&Number.isSafeInteger(file.bytes)&&file.bytes>=0,'The saved customer packet contains an invalid file entry.',409,'WORKBENCH_CUSTOMER_DOSSIER');
      const path=await inside(directory,join(directory,name)),info=await stat(path);
      need(info.isFile()&&info.size===file.bytes,'A saved customer packet file differs from its recorded contents. Prepare the customer packet again from the original cycle.',409,'WORKBENCH_FILE_CHANGED');
      files.push({name,path,bytes:file.bytes,sha256:file.sha256});
    }
    return {snapshot,files};
  }

  const customerSetup=await createCustomerSetupRoutes({directory:root,url,workspace,actor,tokenEnv,connection,signal:controller.signal,bodyJson,sendJson,
    enqueue:work=>{const promise=workQueue.then(()=>{controller.signal.throwIfAborted();return work();});workQueue=promise.catch(()=>{});return promise;}
  });
  const server=createServer(async(request,response)=>{
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      need(request.headers.host===new URL(origin).host,'Use the displayed local workbench address.',403,'WORKBENCH_HOST');
      if(request.headers.origin)need(request.headers.origin===origin,'Open the workbench on this computer.',403,'WORKBENCH_ORIGIN');
      need(request.headers['sec-fetch-site']!=='cross-site','Open the workbench on this computer.',403,'WORKBENCH_ORIGIN');
      const address=new URL(request.url,origin),path=decodeURIComponent(address.pathname);
      if(request.method==='GET'&&STATIC.has(path)){
        const {url:assetUrl,type}=STATIC.get(path),bytes=await readFile(assetUrl);
        response.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length});response.end(bytes);return;
      }
      if(request.method==='POST')need(request.headers['x-workbench-token']===csrfToken,'Refresh this page before continuing.',403,'WORKBENCH_SESSION');
      if(request.method==='GET'&&path==='/api/context'){sendJson(response,200,{workspace,actor,directory:root,draftScope:digest(JSON.stringify({url,workspace,directory:root})),csrfToken,origin});return;}
      if(await customerSetup.handle(request,response,address))return;
      if(request.method==='GET'&&path==='/api/inventory'){
        if(!inventoryPromise)inventoryPromise=connection().then(inventory).finally(()=>{inventoryPromise=undefined;});
        sendJson(response,200,await inventoryPromise);return;
      }
      if(request.method==='GET'&&path==='/api/service-planner'){
        if(!plannerInventoryPromise)plannerInventoryPromise=connection()
          .then(client=>readAccountingStatementServicePlanner({client,signal:controller.signal}))
          .then(result=>{plannerInventory=result;return result;}).finally(()=>{plannerInventoryPromise=undefined;});
        sendJson(response,200,await plannerInventoryPromise);return;
      }
      if(request.method==='POST'&&path==='/api/service-planner/plan'){
        const body=await bodyJson(request);
        need(plannerInventory&&body.inventorySha256===plannerInventory.inventorySha256,
          'Refresh the service planner before compiling these choices. Your selected captures can be kept.',409,'WORKBENCH_PLANNER_CHANGED');
        sendJson(response,200,compileAccountingStatementServicePlan({inventory:plannerInventory,choices:body.choices}));return;
      }
      if(request.method==='POST'&&path==='/api/service-planner/validate'){
        const body=await bodyJson(request),plan=validateAccountingStatementServicePlan(body.plan);
        need(plan.workspace===workspace&&(!plan.endpoint||plan.endpoint===url),'Open this plan in its original merchant workspace.',409,'WORKBENCH_WORKSPACE');
        sendJson(response,200,{planSha256:plan.planSha256,counts:plan.counts});return;
      }
      if(request.method==='POST'&&path==='/api/service-planner/export'){
        const body=await bodyJson(request),plan=validateAccountingStatementServicePlan(body.plan);
        need(plan.workspace===workspace&&(!plan.endpoint||plan.endpoint===url),'Open this plan in its original merchant workspace.',409,'WORKBENCH_WORKSPACE');
        need(['csv','html'].includes(body.format),'Choose a CSV register or readable HTML plan.');
        sendJson(response,200,{filename:'service-close-'+plan.planSha256.slice(0,12)+'.'+body.format,
          mimeType:body.format==='csv'?'text/csv;charset=utf-8':'text/html;charset=utf-8',
          content:body.format==='csv'?renderAccountingStatementServicePlanCsv(plan):renderAccountingStatementServicePlanHtml(plan)});return;
      }
      if(request.method==='POST'&&path==='/api/service-planner/cycles'){
        const body=await bodyJson(request),plan=validateAccountingStatementServicePlan(body.plan);
        need(plan.workspace===workspace&&(!plan.endpoint||plan.endpoint===url),'Prepare this plan in its original merchant workspace.',409,'WORKBENCH_WORKSPACE');
        need(UUID.test(body.requestId??''),'Use one request identity for this prepared cycle.');
        need(typeof body.label==='string'&&body.label.trim()&&body.label.trim().length<=200,'Name this closing cycle.');
        const selections=plan.selections.map(selection),key='cycle-'+body.requestId;
        const inputHash=digest(JSON.stringify({label:body.label.trim(),selections})),previousJob=jobs.get(key);
        need(!previousJob?.inputHash||previousJob.inputHash===inputHash,'This preparation request already has different selections. Start a new cycle.',409,'WORKBENCH_PREPARATION_CHANGED');
        if(await exists(join(cyclePath(key),'request.json'))){
          const original=await compatible(key);
          need(original.label===body.label.trim()&&JSON.stringify(original.selections)===JSON.stringify(selections),
            'This preparation request already belongs to different customer selections. Start a new cycle.',409,'WORKBENCH_PREPARATION_CHANGED');
          if(await exists(join(cyclePath(key),'manifest.json'))){sendJson(response,200,await record(key));return;}
        }
        const job=begin(key,'PREPARE',async()=>prepareAccountingStatementServiceCycle({plan,directory:cyclePath(key),url,workspace,actor,
          label:body.label.trim(),tokenEnv,environment,signal:controller.signal,client:providedClient}));
        job.label=body.label.trim();job.inputHash=inputHash;
        sendJson(response,202,{key,job:jobView(job)});return;
      }
      if(request.method==='POST'&&path==='/api/preview'){
        const body=await bodyJson(request);sendJson(response,200,await (await connection()).preview(selection(body.selection)));return;
      }
      if(request.method==='GET'&&path==='/api/cycles'){
        const rows=[];for(const entry of await readdir(root,{withFileTypes:true})){
          if(!entry.isDirectory()||!KEY.test(entry.name)||!(await exists(join(root,entry.name,'request.json'))))continue;
          try{rows.push(await record(entry.name));}catch(error){rows.push({key:entry.name,label:entry.name,phase:'UNREADABLE',error:cleanError(error),complete:false,rows:[]});}
        }
        for(const [key,job] of jobs)if(!rows.some(row=>row.key===key))rows.push({key,label:job.label??'Preparing customer reviews',phase:'UNPREPARED',job:jobView(job),rows:[],complete:false});
        rows.sort((a,b)=>String(b.preparedAt??'').localeCompare(String(a.preparedAt??'')));
        sendJson(response,200,{items:rows});return;
      }
      if(request.method==='POST'&&path==='/api/cycles'){
        const body=await bodyJson(request);
        need(plain(body)&&UUID.test(body.requestId??''),'Use one request identity for this prepared cycle.');
        need(typeof body.label==='string'&&body.label.trim()&&body.label.trim().length<=200,'Name this closing cycle.');
        need(Array.isArray(body.selections)&&body.selections.length>0,'Add at least one customer statement.');
        const selections=body.selections.map(selection),key='cycle-'+body.requestId;
        const inputHash=digest(JSON.stringify({label:body.label.trim(),selections})),previousJob=jobs.get(key);
        need(!previousJob?.inputHash||previousJob.inputHash===inputHash,'This preparation request already has different selections. Start a new cycle.',409,'WORKBENCH_PREPARATION_CHANGED');
        if(await exists(join(cyclePath(key),'request.json'))){
          const original=await compatible(key);
          need(original.label===body.label.trim()&&JSON.stringify(original.selections)===JSON.stringify(selections),'This preparation request already belongs to different customer selections. Start a new cycle.',409,'WORKBENCH_PREPARATION_CHANGED');
          if(await exists(join(cyclePath(key),'manifest.json'))){sendJson(response,200,await record(key));return;}
        }
        const job=begin(key,'PREPARE',async()=>prepareAccountingStatementCycle({directory:cyclePath(key),url,workspace,actor,label:body.label.trim(),selections,tokenEnv,environment,signal:controller.signal,client:providedClient}));
        job.label=body.label.trim();job.inputHash=inputHash;
        sendJson(response,202,{key,job:jobView(job)});return;
      }
      const match=path.match(/^\/api\/cycles\/([^/]+)(?:\/(.*))?$/);
      if(match){
        const key=safeKey(match[1]),action=match[2]??'';
        if(request.method==='GET'&&action===''){
          if(!(await exists(join(cyclePath(key),'request.json')))&&jobs.has(key)){sendJson(response,200,{key,label:jobs.get(key).label??'Preparing customer reviews',phase:'UNPREPARED',rows:[],complete:false,job:jobView(jobs.get(key))});return;}
          sendJson(response,200,await record(key));return;
        }
        if(request.method==='POST'&&action==='run'){
          const body=await bodyJson(request);need(body.execute===true,'Review the prepared customer statements before issuing the cycle.');
          await compatible(key);const report=await record(key);need(report.phase!=='UNPREPARED','Prepare the customer reviews before issuing statements.',409);
          const job=begin(key,'RUN',async()=>runAccountingStatementCycle({directory:cyclePath(key),execute:true,environment,signal:controller.signal,client:await connection()}));
          sendJson(response,202,{key,job:jobView(job)});return;
        }
        if(request.method==='POST'&&action==='prepare'){
          await bodyJson(request);const original=await compatible(key);
          const job=begin(key,'PREPARE',async()=>prepareAccountingStatementCycle({directory:cyclePath(key),url,workspace,actor:original.actor,label:original.label,selections:original.selections,tokenEnv:original.tokenEnv,environment,signal:controller.signal,client:providedClient}));
          sendJson(response,202,{key,job:jobView(job)});return;
        }

        if(request.method==='GET'&&action==='customers'){
          await compatible(key);sendJson(response,200,await inspectAccountingStatementCustomerDossiers({directory:cyclePath(key),signal:controller.signal}));return;
        }
        const customerExport=action.match(/^customers\/([^/]+)\/export$/);
        if(request.method==='POST'&&customerExport){
          await bodyJson(request);sendJson(response,200,await prepareCustomerDossier(key,customerId(customerExport[1])));return;
        }
        const customerSnapshot=action.match(/^customers\/([^/]+)\/snapshots\/([^/]+)\/(download|file\/(.+))$/);
        if(request.method==='GET'&&customerSnapshot){
          const id=customerId(customerSnapshot[1]),snapshotSha256=customerSnapshot[2];
          const {files}=await customerDossierFiles(key,id,snapshotSha256);
          if(customerSnapshot[3]==='download'){
            need(files.length,'This customer packet has no files to download.',409,'WORKBENCH_CUSTOMER_DOSSIER');
            const filename=key+'-customer-'+id+'-'+snapshotSha256.slice(0,12)+'.tar.gz';
            response.writeHead(200,{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="'+filename+'"'});
            await pipeline(Readable.from(tarStream(files,()=>controller.signal.throwIfAborted())),createGzip(),response);return;
          }
          const name=customerSnapshot[4],file=files.find(item=>item.name===name);
          need(file,'Choose a file from this saved customer packet.',404);
          const type=TYPE[extname(name)]??'application/octet-stream',view=address.searchParams.get('download')!=='1'&&extname(name)==='.html';
          if(view)response.setHeader('Content-Security-Policy',"sandbox allow-same-origin allow-downloads; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'");
          response.writeHead(200,{'Content-Type':type,'Content-Length':file.bytes,'Content-Disposition':(view?'inline':'attachment')+'; filename="'+name.split('/').at(-1).replace(/["\r\n]/g,'')+'"'});
          await pipeline(Readable.from(verifiedFile(file)),response);return;
        }

        const reviewMatch=action.match(/^items\/([1-9][0-9]*)\/review$/);
        if(request.method==='GET'&&reviewMatch){
          const index=Number(reviewMatch[1])-1,report=await record(key),row=report.rows[index];need(row,'Choose a customer review in this cycle.',404);
          const bytes=await readFile(await inside(root,join(cyclePath(key),'items',ordinal(index),'review.json')));
          if(row.reviewFile)need(bytes.length===row.reviewFile.bytes&&digest(bytes)===row.reviewFile.sha256,'The saved customer review changed.',409,'WORKBENCH_REVIEW');
          const review=accountingStatementPreview(JSON.parse(bytes.toString('utf8')));
          need(review.previewSha256===row.previewSha256,'The saved review differs from this closing cycle.',409,'WORKBENCH_REVIEW');
          sendJson(response,200,review);return;
        }
        const archiveMatch=action.match(/^(?:items\/([1-9][0-9]*)\/)?download$/);
        if(request.method==='GET'&&archiveMatch){
          need(!['QUEUED','RUNNING'].includes(jobs.get(key)?.phase),'Wait for the active closing operation before downloading.',409,'WORKBENCH_ACTIVE');
          const lease=await acquireStateLease(cyclePath(key));
          try{
            const index=archiveMatch[1]===undefined?undefined:Number(archiveMatch[1])-1,files=await filesFor(key,index);
            need(files.length,'This cycle has no completed files to download.',409);
            const filename=key+(index===undefined?'':'-customer-'+(index+1))+'.tar.gz';
            const archiveFiles=index===undefined?files:files.map(file=>({...file,name:file.name.split('/').at(-1)}));
            response.writeHead(200,{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="'+filename+'"'});
            await pipeline(Readable.from(tarStream(archiveFiles,()=>lease.assertHeld())),createGzip(),response);
          }finally{await lease.close();}
          return;
        }
        if(request.method==='GET'&&action==='files'){
          const files=await filesFor(key);sendJson(response,200,{items:files.map(({name,bytes})=>({name,bytes,href:'/api/cycles/'+encodeURIComponent(key)+'/file/'+name.split('/').map(encodeURIComponent).join('/')+'?download=1'}))});return;
        }
        if(request.method==='GET'&&action.startsWith('file/')){
          need(!['QUEUED','RUNNING'].includes(jobs.get(key)?.phase),'Wait for the active closing operation before downloading.',409,'WORKBENCH_ACTIVE');
          const lease=await acquireStateLease(cyclePath(key));
          try{
            const name=action.slice(5),files=await filesFor(key),file=files.find(row=>row.name===name);need(file,'Choose a file from this closing cycle.',404);
            const type=TYPE[extname(name)]??'application/octet-stream',view=address.searchParams.get('download')!=='1'&&extname(name)==='.html';
            if(view)response.setHeader('Content-Security-Policy',"sandbox allow-same-origin allow-downloads; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'");
            response.writeHead(200,{'Content-Type':type,'Content-Length':file.bytes,'Content-Disposition':(view?'inline':'attachment')+'; filename="'+name.split('/').at(-1).replace(/["\r\n]/g,'')+'"'});
            await pipeline(Readable.from(verifiedFile(file)),response);
          }finally{await lease.close();}
          return;
        }
      }
      throw fail(404,'WORKBENCH_NOT_FOUND','This workbench page could not be found.');
    }catch(error){
      if(response.headersSent){response.destroy(error);return;}
      const status=error.status??(error.code==='ENOENT'?404:500);sendJson(response,status,{error:cleanError(error)});
    }
  });
  await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolveListen();});});
  const bound=server.address(),hostname=host==='::1'?'[::1]':host;origin='http://'+hostname+':'+bound.port;
  let closePromise;
  return Object.freeze({url:origin,server,directory:root,async close(){
    if(!closePromise){closing=true;controller.abort();closePromise=(async()=>{
      await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));
      await Promise.allSettled([...jobs.values()].map(job=>job.promise).concat([...dossierExports.values()]));
      await Promise.allSettled([plannerInventoryPromise,inventoryPromise].filter(Boolean));
      await customerSetup.close();
      if(clientPromise&&!providedClient)await (await clientPromise).disconnect();
    })();}return closePromise;
  }});
}
export async function runAccountingStatementCycleWorkbenchCli(argv=process.argv.slice(2)){
  if(argv.includes('--help')){
    process.stdout.write('Customer closing workbench\n\nnode accounting-statement-cycle-server.mjs --directory /absolute/customer-closes --url http://127.0.0.1:8787/mcp --workspace accounting --actor operator [--token-env MERCHANT_TOKEN] [--port 4419]\n');
    return null;
  }
  const options={},names={'--directory':'directory','--url':'url','--workspace':'workspace','--actor':'actor','--token-env':'tokenEnv','--port':'port','--host':'host'};
  for(let i=0;i<argv.length;i++){const name=names[argv[i]];need(name&&argv[i+1]!==undefined,'Use --help for the closing workbench options.');options[name]=name==='port'?Number(argv[++i]):argv[++i];}
  const workbench=await startAccountingStatementCycleWorkbench(options);
  process.stdout.write(JSON.stringify({schema:'stellar-forge.customer-closing-startup.v1',status:'CUSTOMER_CLOSING_READY',
    url:workbench.url,directory:workbench.directory,workspace:options.workspace,actor:options.actor.trim(),
    merchantUrl:new URL(options.url).href,tokenEnv:options.tokenEnv??'MCP_ACCESS_TOKEN',
    requestedPort:options.port??4419,pid:process.pid,startedAt:new Date().toISOString()})+'\n');
  process.stdout.write('Customer closing workbench: '+workbench.url+'\nSaved cycles: '+workbench.directory+'\n');
  const stop=()=>{workbench.close().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);return workbench;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  runAccountingStatementCycleWorkbenchCli().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
