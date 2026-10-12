import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { MerchantFeedWorkspaces, readFeedsWorkspaceConfiguration, feedsWorkspaceTools } from './feed-mcp-native-source/stellar-forge/mcp-merchant-operator/feeds-workspace.mjs';
import { downloadFeedsDelivery } from './feed-mcp-native-source/stellar-forge/mcp-merchant-operator/feeds-download.mjs';
import { openMerchantFileClient } from './feed-mcp-native-source/stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { createMcpToolHandler } from './feed-mcp-native-source/stellar-forge/mcp-paid-agent/http-tools.mjs';

const projectRoot = '/workspace/scratch/b0285b3810b3';
const sourceRoot = join(projectRoot,'feed-mcp-native-source');
const root = join(projectRoot,'feed-mcp-native-runtime');
const cli = join(sourceRoot,'stellar/scf-starforge-20261009/sf30-seller-sdk/feeds/cli.py');
const sourceHash = 'b5334857c5f1ff9dbebb8ece2b86a8228d4bec1aeec69d6fdaac8c0d91ace072';
const node = process.execPath;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const privateEnv = {...process.env, SF30_XML_NODE:node};
const nativeProcesses = new Map();
let controller, http, client, endpoint, port, token;
await mkdir(root,{recursive:true,mode:0o700});
let state;
try { state=JSON.parse(await readFile(join(root,'journey-state.json'),'utf8')); }
catch(error) { if(error.code!=='ENOENT')throw error; state={schema:'stellar-forge.feed-mcp-native-journey.v1',startedAt:new Date().toISOString(),
 source:{url:'https://github.com/benwerd/OPML/blob/HEAD/subscriptions.opml',sha256:sourceHash,bytes:100070},phases:[],
 productId:randomUUID(),intentId:randomUUID()}; }
async function save() { await writeFile(join(root,'journey-state.next'),json(state),{mode:0o600}); await rename(join(root,'journey-state.next'),join(root,'journey-state.json')); }
async function phase(name, details) { state.phases.push({name,at:new Date().toISOString(),...details});await save();console.log(JSON.stringify({phase:name,...details})); }
async function runPython(args) {
 const child=spawn('python3',[cli,...args],{env:privateEnv,stdio:['ignore','pipe','pipe']});let out='',err='';
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const [code,signal]=await once(child,'close');
 if(code!==0)throw new Error('Original feed CLI '+args.at(-1)+' exited '+code+'/'+signal+': '+err.slice(0,2000));
 return JSON.parse(out);
}
async function startConsole(alias) {
 const workspace=join(root,alias);
 try { await readFile(join(workspace,'workspace.json')); }
 catch(error){if(error.code!=='ENOENT')throw error;await runPython(['--workspace',workspace,'init']);}
 const child=spawn('python3',[cli,'--workspace',workspace,'serve','--startup-format','json','--landing','subscriptions','--port','0'],
 {env:privateEnv,stdio:['ignore','pipe','pipe']});
 let errorText='',pending='';
 child.stderr.on('data',b=>errorText+=b);
 const exit=once(child,'close'); nativeProcesses.set(alias,{child,exit});
 const startup=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Original console did not announce startup')),30000);
  child.once('error',error=>{clearTimeout(timer);reject(error)});
  child.once('close',code=>{clearTimeout(timer);reject(new Error('Original console exited before startup '+code+': '+errorText.slice(0,1500)))});
  child.stdout.on('data',b=>{
   pending+=b.toString();
   const index=pending.indexOf('\n');
   if(index>=0){clearTimeout(timer);try{resolve(JSON.parse(pending.slice(0,index)))}catch(error){reject(error)}}
  });
 });
 if(startup.schema!=='stellar-forge.feed-workspace-launch.v1'||startup.workspace!==workspace)throw new Error('Different original console');
 await writeFile(join(root,alias+'-launch.json'),json(startup),{mode:0o600});await chmod(join(root,alias+'-launch.json'),0o600);
 return {workspace,bindingSha256:startup.bindingSha256,pid:startup.pid};
}
async function stopConsole(alias) {
 const owned=nativeProcesses.get(alias);if(!owned)return;
 if(owned.child.exitCode===null&&owned.child.signalCode===null)owned.child.kill('SIGTERM');
 await owned.exit;nativeProcesses.delete(alias);
}
async function openMcp() {
 const cfg=await readFeedsWorkspaceConfiguration(join(root,'connections.json'));
 controller=new MerchantFeedWorkspaces({feedsWorkspaces:cfg,exportsDirectory:join(root,'exports')},{environment:process.env});
 const tools=feedsWorkspaceTools((name,description,properties,required,annotations={})=>({name,description,
  inputSchema:{type:'object',properties,required,additionalProperties:false},annotations}));
 token=randomBytes(32).toString('base64url');
 http=createServer(createMcpToolHandler({tools,call:(name,args)=>controller.call(name,args)},{bearerToken:token,
  serverName:'starforge-feed-native-journey',instructions:'Use the original feed workspace and publisher. This host has no payer or signer.'}));
 http.listen({host:'127.0.0.1',port:port??0});await once(http,'listening');port=http.address().port;endpoint='http://127.0.0.1:'+port+'/mcp';
 client=await openMerchantFileClient({url:endpoint,tokenEnv:'FEED_NATIVE_MCP',environment:{FEED_NATIVE_MCP:token}});
 const response=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',
  accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},
  body:JSON.stringify({jsonrpc:'2.0',id:1000,method:'tools/list',params:{}})});
 const listed=(await response.json()).result.tools;
 if(listed.length!==17||!listed.every(t=>t.name.startsWith('merchant_feeds_')))throw new Error('Different native MCP catalog');
 return listed.length;
}
async function closeMcp() {
 if(http){const old=http;http=null;await new Promise((resolve,reject)=>old.close(error=>error?reject(error):resolve()));}
 if(controller){const old=controller;controller=null;await old.close();}
}
async function call(name,args={}) { return client.call(name,args,{timeoutMs:240000}); }
async function original(value) {
 if(Object.hasOwn(value,'native'))return value.native;
 if(value.completeResult){
  const item=value.completeResult; const path=join(root,'complete-results',item.exportId);
  await downloadFeedsDelivery({workspace:value.workspace,url:endpoint,exportId:item.exportId,directory:path,
   tokenEnv:'FEED_NATIVE_MCP',environment:{FEED_NATIVE_MCP:token},expectedManifestSha256:item.manifestSha256});
  return JSON.parse(await readFile(join(path,'result.json'),'utf8'));
 }
 return value;
}
async function lookup(workspace,id,family) {
 try{return await original(await call('merchant_feeds_read',{workspace,kind:'operation',id,family}));}
 catch(error){if(error.code==='FEEDS_CONSOLE_HTTP_404')return null;throw error;}
}
async function waitOriginal(workspace) {
 for(let attempt=0;attempt<1000;attempt++){
  const status=await original(await call('merchant_feeds_status',{workspace}));
  const activity=status.activity;
  if(activity.state==='FAILED')throw new Error('Original '+activity.action+' failed: '+activity.error);
  if(activity.state!=='RUNNING')return activity.result;
  await sleep(200);
 }
 throw new Error('Original worker remains active; retained operation must be followed.');
}
async function action(workspace,name,input,family='feed') {
 let prior=input.operationId?await lookup(workspace,input.operationId,family):null;
 if(prior?.state==='RESULT_RETAINED'&&!prior.historyOnly)return prior.result;
 if(prior?.continuation){
  const {action:resume,...selected}=prior.continuation;
  await call('merchant_feeds_action',{workspace,action:resume,input:selected});
 }else await call('merchant_feeds_action',{workspace,action:name,input});
 const result=await waitOriginal(workspace);
 if(input.operationId){
  prior=await lookup(workspace,input.operationId,family);
  if(prior?.state==='RESULT_RETAINED')return prior.result;
  if(prior?.run)throw new Error('Original capture remains '+prior.run.state+'; operation '+input.operationId+' and run '+prior.run.id+' are retained.');
 }
 return result;
}
async function seller(action,input={}) {
 return original(await call('merchant_feeds_publisher',{workspace:'research',productId:state.productId,action,input}));
}
let terminal;
try {
 const launchResearch=await startConsole('research'),launchReceiving=await startConsole('receiving');
 for(const name of ['exports','complete-results','downloads'])await mkdir(join(root,name),{mode:0o700,recursive:true});
 const require=createRequire(join(sourceRoot,'package.json'));
 const {Asset,Networks,Keypair}=require('@stellar/stellar-sdk');
 state.payment??={scheme:'exact',network:'stellar:testnet',amount:'1000',asset:Asset.native().contractId(Networks.TESTNET),
  payTo:Keypair.random().publicKey(),maxTimeoutSeconds:300};
 const connection={schema:'stellar-forge.feeds-workspace-connection.v1',workspaces:{
  research:{label:'Original NewsBlur research',consoleUrlFile:join(root,'research-launch.json'),
   files:{newsblur:{path:join(projectRoot,'feed-mcp-newsblur.opml'),kind:'opml',sha256:sourceHash}},
   merchantProfiles:{research:{label:'Native research dataset',origin:'https://feeds.example.invalid',path:'/research',payment:state.payment}},runtime:{port:0}},
  receiving:{label:'Independent received collection',consoleUrlFile:join(root,'receiving-launch.json')}}};
 await writeFile(join(root,'connections.json'),json(connection),{mode:0o600});await chmod(join(root,'connections.json'),0o600);
 const registered=await openMcp();await phase('original-consoles-and-mcp',{registered,sourceBinding:launchResearch.bindingSha256,receivingBinding:launchReceiving.bindingSha256});
 if(!state.opmlImported){
  const prior=await lookup('research','b028-newsblur-intake','collection');
  if(!prior){
   await call('merchant_feeds_intake',{workspace:'research',file:'newsblur',operationId:'b028-newsblur-intake'});
   await waitOriginal('research');
  }
  const complete=await lookup('research','b028-newsblur-intake','collection');
  if(complete?.state!=='RESULT_RETAINED'||complete.result.sourceId!==sourceHash||complete.result.entries.length!==573)
   throw new Error('Original NewsBlur intake differs');
  state.opmlImported=true;await phase('complete-original-opml',{bytes:100070,subscriptions:573,sourceSha256:sourceHash});
 }
 if(!state.collection){
  const entries=[];let offset=0,snapshot;
  do{
   const page=await original(await call('merchant_feeds_read',{workspace:'research',kind:'subscription-plan',id:sourceHash,array:'entries',
    offset,limit:250,...(snapshot?{expectedSnapshot:snapshot}:{})}));
   entries.push(...page.items);snapshot=page.snapshot;offset=page.nextOffset;
  }while(offset!==null);
  if(entries.length!==573)throw new Error('Subscription plan did not retain every source entry');
  const selectedUrls=['https://jvns.ca/atom.xml','https://simonwillison.net/atom/everything/'];
  const selected=selectedUrls.map(url=>{const entry=entries.find(e=>e.url===url);if(!entry)throw new Error('Selected original source absent: '+url);return entry;});
  const newFeeds=Object.fromEntries(selected.map((e,index)=>['research-'+index,{url:e.url,label:e.title||e.text||e.url,
   allowedOrigins:[new URL(e.url).origin],rssIdentity:'guid'}]));
  const members=selected.map((e,index)=>({sourceId:sourceHash,entryId:e.entryId,feedId:'research-'+index,enabled:true}));
  state.collection=await action('research','collection-save',{collectionId:'research-library',title:'Public technical research',
   members,newFeeds,expectedRevision:0,operationId:'b028-research-library-save'},'collection');
  await phase('source-selection',{originalEntries:entries.length,enabled:2,urls:selectedUrls,revision:state.collection.revision});
 }
 if(!state.captured){
  const result=await action('research','collection-capture',{collectionId:'research-library',expectedRevision:state.collection.revision,
   expectedRevisions:{'research-0':1,'research-1':1},operationId:'b028-research-library-capture',pageLimit:1,force:false},'collection');
  if(result.state!=='CAPTURED')throw new Error('Original collection acquisition is '+result.state);
  state.captured=result;await phase('public-feed-acquisition',{runId:result.id,feeds:result.items.map(x=>({feedId:x.feedId,captureId:x.captureId,state:x.state}))});
 }
 if(!state.applied){
  const applications=[];
  for(const item of state.captured.items){
   const review=await original(await call('merchant_feeds_read',{workspace:'research',kind:'review',id:item.captureId,limit:250}));
   if(Object.entries(review.counts).some(([kind,count])=>/conflict|ambigu/i.test(kind)&&count))throw new Error('Original source review requires an explicit conflict choice');
   const applied=await action('research','apply',{captureId:item.captureId,expectedRevision:review.feed.revision,
    operationId:'b028-apply-'+item.feedId,decisions:{},acceptIdentity:false});
   applications.push(applied);
   const requests=await original(await call('merchant_feeds_read',{workspace:'research',kind:'requests',id:item.captureId}));
   state.http??=[];state.http.push({feedId:item.feedId,captureId:item.captureId,requests});
  }
  state.applied=applications;await phase('original-review-and-apply',{applications:applications.map(x=>({feedId:x.feedId,revision:x.revision})),
   requests:state.http.flatMap(x=>x.requests).map(x=>({url:x.url,status:x.status,bytes:x.bytes,sourceSha256:x.sourceSha256}))});
 }
 const fields=['key','id','title','link','published','updated','summary','feed_id','source_sha256'];
 if(!state.edition){
  state.edition=await action('research','collection-edition',{runId:state.captured.id,name:'Public technical research',fields,
   expectedRevisions:Object.fromEntries(state.applied.map(x=>[x.feedId,x.revision])),operationId:'b028-research-library-edition'},'collection');
  await phase('native-collection-edition',{bindingId:state.edition.binding.id,editionId:state.edition.edition.id,rowCount:state.edition.edition.rowCount});
 }
 const editionId=state.edition.edition.id;
 const query=await action('research','query',{editionId,params:{fields:'key,title,link',sort:'title',limit:'5'}});
 if(!state.query){state.query=query;await phase('native-dataset-query',{rows:query.data?.length??query.rows?.length??null});}
 if(!state.delivery){
  state.delivery=await call('merchant_feeds_export',{workspace:'research',kind:'collection-project',id:state.edition.binding.id,operationId:'b028-collection-delivery'});
  await phase('complete-collection-export',{exportId:state.delivery.exportId,manifestSha256:state.delivery.manifestSha256});
 }
 const downloadOptions={workspace:'research',url:endpoint,exportId:state.delivery.exportId,directory:join(root,'downloads','research-collection'),
  tokenEnv:'FEED_NATIVE_MCP',environment:{FEED_NATIVE_MCP:token},chunkSize:32768,expectedManifestSha256:state.delivery.manifestSha256};
 if(!state.downloadInterrupted){
  const abort=new AbortController();let stopped=false;
  try{await downloadFeedsDelivery({...downloadOptions,signal:abort.signal,onProgress:progress=>{
   if(!stopped){stopped=true;abort.abort();}}});}
  catch(error){if(!abort.signal.aborted)throw error;state.downloadInterrupted={at:new Date().toISOString(),code:error.code??error.name};await save();}
 }
 await closeMcp();await stopConsole('research');const reopened=await startConsole('research');await openMcp();
 const resumed=await downloadFeedsDelivery({...downloadOptions,url:endpoint,environment:{FEED_NATIVE_MCP:token}});
 state.download=resumed;await phase('complete-download-after-restart',{...resumed,sourceBinding:reopened.bindingSha256});
 if(!state.received){
  const prior=await lookup('receiving','b028-receive-collection','collection');
  if(prior?.state!=='RESULT_RETAINED'){
   await call('merchant_feeds_receive',{workspace:'receiving',fromWorkspace:'research',exportId:state.delivery.exportId,operationId:'b028-receive-collection'});
   await waitOriginal('receiving');
  }
  const result=await lookup('receiving','b028-receive-collection','collection');
  if(result?.state!=='RESULT_RETAINED')throw new Error('Original collection receiving did not finish');
  state.received=result.result;
  await phase('original-customer-receiving',{operationId:result.id,state:result.state});
 }
 await stopConsole('receiving');await startConsole('receiving');
 const receivingQuery=await action('receiving','query',{editionId,params:{fields:'key,title,link',sort:'title',limit:'5'}});
 if(JSON.stringify(query)!==JSON.stringify(receivingQuery))throw new Error('Reopened received edition query differs');
 await phase('received-workspace-reopen',{editionId,querySha256:hash(json(receivingQuery))});
 if(!state.prepared){
  state.prepared=await original(await call('merchant_feeds_publisher_prepare',{workspace:'research',productId:state.productId,editionId,profile:'research'}));
  await phase('native-publisher-preparation',{productId:state.productId,draftId:state.prepared.draft.id,snapshot:state.prepared.source.snapshot});
 }
 const draftId=state.prepared.draft.id,snapshot=state.prepared.source.snapshot;
 const preview=await seller('publisher.preview',{target:'draft:'+draftId,query:'fields=key,title,link&limit=5'});
 if(preview.status!==200)throw new Error('Original native draft query failed');
 await seller('publisher.release.stage',{draftId,id:'research-release',label:'Public technical research'});
 let pub=await seller('publisher.status',{});
 if(pub.releases.state.active!=='research-release'){
  const generation=pub.releases.state.generation;
  await seller('publisher.release.activate',{id:'research-release',expectedGeneration:generation});
 }
 pub=await seller('publisher.status',{});
 const generation=pub.releases.state.generation;
 const started=await seller('publisher.release.start',{expectedGeneration:generation});
 state.release={generation,started};await save();
 const buyerReview=await seller('publisher.buyer.review',{snapshot,query:'fields=key,title,link&limit=5'});
 if(!buyerReview.offerSha256)throw new Error('Original running seller has no exact offer');
 const buyer=await seller('publisher.buyer.prepare',{review:buyerReview,intentId:state.intentId,acceptIndex:0,offerSha256:buyerReview.offerSha256});
 state.buyer={id:buyer.buyer.id,offerSha256:buyerReview.offerSha256};
 const customerConfig=await call('merchant_feeds_publisher_export',{workspace:'research',productId:state.productId,id:buyer.buyer.id,
  kind:'buyer-config',operationId:'b028-research-customer-config'});
 state.customerConfig=await downloadFeedsDelivery({workspace:'research',url:endpoint,exportId:customerConfig.exportId,
  directory:join(root,'downloads','customer-config'),tokenEnv:'FEED_NATIVE_MCP',environment:{FEED_NATIVE_MCP:token},
  expectedManifestSha256:customerConfig.manifestSha256});
 await seller('publisher.release.stop',{});
 await phase('native-publisher-and-customer',{productId:state.productId,draftId,snapshot,offerSha256:buyerReview.offerSha256,
  completeCustomerConfig:state.customerConfig.files,payments:0,signerConnected:false});
 const lookupOriginal=await lookup('research','b028-research-library-capture','collection');
 if(lookupOriginal.run?.id!==state.captured.id)throw new Error('Original operation lookup lost its exact capture');
 await phase('original-operation-recovery',{operationId:lookupOriginal.id,state:lookupOriginal.state,runId:lookupOriginal.run.id,historyOnly:lookupOriginal.historyOnly});
 state.completedAt=new Date().toISOString();state.state='COMPLETE';delete state.failure;await save();
 terminal={schema:state.schema,state:state.state,startedAt:state.startedAt,completedAt:state.completedAt,source:state.source,
  phases:state.phases,editionId,collectionBindingId:state.edition.binding.id,download:state.download,customerConfig:state.customerConfig,
  productId:state.productId,payments:0,signerConnected:false};
} catch(error) {
 state.state='INCOMPLETE';state.failure={code:error.code??error.name,message:error.message,at:new Date().toISOString()};await save();
 console.error(JSON.stringify({state:state.state,error:state.failure}));process.exitCode=1;
 terminal={schema:state.schema,state:state.state,source:state.source,phases:state.phases,failure:state.failure};
} finally {
 const closed=[];
 try{await closeMcp();closed.push('merchant-mcp-and-owned-publisher');}catch(error){closed.push('merchant-close:'+error.message);process.exitCode=1;}
 for(const alias of [...nativeProcesses.keys()]){try{await stopConsole(alias);closed.push(alias);}catch(error){closed.push(alias+':'+error.message);process.exitCode=1;}}
 terminal??={schema:'stellar-forge.feed-mcp-native-journey.v1',state:'INCOMPLETE'};
 terminal.closed=closed;terminal.closedAt=new Date().toISOString();
 await writeFile(join(root,'result.json'),json(terminal),{mode:0o600});console.log(JSON.stringify({state:terminal.state,result:join(root,'result.json'),closed}));
}

