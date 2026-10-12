// One original WFS customer: retained GeoSolutions source and original SF30/SF36/SF81/SF88/SF100.
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {readFile,readdir,lstat,open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const SOURCE=resolve(process.env.WFS_NATIVE_SOURCE);
const SCF=join(SOURCE,'stellar/scf-starforge-20261009'),WFS=join(SCF,'sf30-seller-sdk/wfs');
const importFile=path=>import(pathToFileURL(path).href);
const {withPrivateLock,atomicJson}=await importFile(join(SCF,'sf30-seller-sdk/routescan/quota.mjs'));
const {initializeWfsProject,readWfsProject,getWfsOrder,saveWfsQuery}=await importFile(join(WFS,'project.mjs'));
const {receiveWfsProject,inspectWfsProjectBundle}=await importFile(join(WFS,'portable.mjs'));
const {optionalJson,durableDirectory,exactFile}=await importFile(join(WFS,'source.mjs'));
const {normalizeWfsSelection,wfsRequest,wfsItemsUrl}=await importFile(join(WFS,'protocol.mjs'));
const {openWfsApplication}=await importFile(join(WFS,'application.mjs'));
const {startWfsWorkspace}=await importFile(join(WFS,'workspace.mjs'));
const {wfsLoopbackJson}=await importFile(join(WFS,'loopback.mjs'));
const {exportWfsReceivedFile}=await importFile(join(WFS,'customer.mjs'));
const {prepareNativeVectorCustomer,verifyNativeVectorCustomer,inspectNativeVectorBrowser}=await importFile(join(WFS,'examples/native-vector-customer.mjs'));
const {createNativeHttpFactory}=await importFile(join(SCF,'sf30-seller-sdk/native-http-factory.mjs'));
const {Buyer}=await importFile(join(SCF,'sf88-operator-buyer-cli/node/client.mjs'));
const {initializeMerchantProvider}=await importFile(join(SOURCE,'stellar-forge/mcp-merchant-operator/providers.mjs'));
const {inspectMerchantProvider}=await importFile(join(SOURCE,'stellar-forge/mcp-merchant-operator/provider-cli.mjs'));
const {startMerchantMcp}=await importFile(join(SOURCE,'stellar-forge/mcp-merchant-operator/serve.mjs'));
const {openMerchantFileClient}=await importFile(join(SOURCE,'stellar-forge/mcp-merchant-operator/retained-download.mjs'));
const {localFacilitator,localMerchantTransport,PAYMENT,MODE}=await importFile(join(SCF,'sf30-seller-sdk/stac/examples/gdelt-native-fixture-exports.mjs'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const OP='SCF-WFS-GEOSOLUTIONS-CUSTOMER-7DE2-20261012',SCHEMA='stellar-forge.wfs-native-customer.v1';
const SOURCE_OPERATION='OGC-WFS2-GEOSOLUTIONS-20261012-7DE2';
// This is the unchanged original local protocol transport's certificate origin.
const ORIGIN='https://gdelt-journey.example';
const args=Object.create(null);
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];
  if(key==='--fixture-tty-child'){args.child=true;continue;}
  if(!['--directory','--python','--source-capture','--source-manifest-sha256'].includes(key)||!process.argv[i+1])
    throw Error('Use the original customer directory, Python, source capture and exact manifest SHA256.');
  args[key.slice(2)]=process.argv[++i];
}
const ROOT=resolve(args.directory),PYTHON=args.python??process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3';
const CAPTURE=resolve(args['source-capture']??process.env.WFS_NATIVE_CAPTURE);
const MANIFEST_SHA=args['source-manifest-sha256']??process.env.WFS_NATIVE_MANIFEST_SHA256;
assert.match(MANIFEST_SHA??'',/^[a-f0-9]{64}$/);
process.env.WFS_NATIVE_CAPTURE=CAPTURE;process.env.WFS_NATIVE_MANIFEST_SHA256=MANIFEST_SHA;
await durableDirectory(ROOT);
async function save(name,value){
  const path=join(ROOT,name);await durableDirectory(dirname(path));
  await atomicJson(dirname(path),path.slice(dirname(path).length+1),value);return value;
}
async function retained(name,make){
  const path=join(ROOT,name);let value;
  try{value=await optionalJson(path,16*1024*1024);}
  catch(error){
    if(error.code!=='PRIVATE_FILE_REQUIRED')throw error;
    // The original journey lease owns this immutable journal. Recover its
    // committed inode if interruption left the matching staged link attached.
    await exactFile(path,await originalMember(ROOT,name,16*1024*1024));
    value=await optionalJson(path,16*1024*1024);
  }
  if(value!==null)return value;
  if(make===undefined)return null;
  value=await make();await durableDirectory(dirname(path));await exactFile(path,Buffer.from(json(value)));return value;
}
async function port(){
  const server=createServer();await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  const value=server.address().port;await new Promise(done=>server.close(done));return value;
}
async function auditFiles(root){
  const result=[];
  async function visit(path,prefix=''){
    for(const item of(await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      assert(!item.isSymbolicLink(),'Original delivered output must remain a regular file or directory.');
      const full=join(path,item.name),name=prefix?prefix+'/'+item.name:item.name;
      if(item.isDirectory())await visit(full,name);
      else{assert(item.isFile());const bytes=await readFile(full);result.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}
    }
  }
  await visit(root);return result;
}
async function originalMember(root,name,maximum){
  assert(typeof name==='string'&&name.length>0&&!isAbsolute(name)&&!name.includes('\\'));
  const pieces=name.split('/');assert(pieces.every(part=>part&&part!=='.'&&part!=='..'));
  let parent=root;
  for(const part of pieces.slice(0,-1)){parent=join(parent,part);const info=await lstat(parent);assert(info.isDirectory()&&!info.isSymbolicLink());}
  const handle=await open(join(root,name),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();assert(before.isFile()&&before.size<=maximum);
    const bytes=await handle.readFile(),after=await handle.stat();
    assert.equal(bytes.length,before.size);assert.equal(before.size,after.size);
    assert.equal(before.mtimeMs,after.mtimeMs);assert.equal(before.ctimeMs,after.ctimeMs);return bytes;
  }finally{await handle.close();}
}
async function originalSource(){
  const root=await realpath(CAPTURE),raw=await originalMember(root,'source-manifest.json',4*1024*1024);
  assert.equal(hash(raw),MANIFEST_SHA);
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  assert.equal(manifest.schema,'commons.wfs2-public-source-capture.v1');assert.equal(manifest.operation,SOURCE_OPERATION);
  assert.equal(manifest.endpoint,'https://gs-main.geosolutionsgroup.com/geoserver/wfs');
  assert.equal(manifest.editions.length,2);
  const selection=normalizeWfsSelection({version:'2.0.0',typeName:manifest.selection.typeName,
    srsName:manifest.selection.srsName,pageSize:manifest.selection.pageSize,
    sortBy:[{property:manifest.selection.sortField,direction:'A'}]});
  assert.equal(manifest.selection.sortBy,selection.sortBy[0].property+' A');
  assert.equal(manifest.selection.outputFormat,'application/json');
  const expectedOrigin=new URL(manifest.endpoint).origin,loaded=new Map();
  const all=[manifest.capabilities,manifest.schemaResponse,...manifest.editions.flatMap(edition=>[edition.hits,...edition.pages.map(page=>page.response)])];
  assert.equal(all.length,manifest.sourceRequests);assert.equal(new Set(all.map(row=>row.key)).size,all.length);
  let total=0;
  for(const row of all){
    assert.equal(row.schema,'commons.wfs2-source-response.v1');assert.equal(row.operation,SOURCE_OPERATION);
    assert.equal(row.status,200);assert.equal(row.curlExit,0);assert(Number.isFinite(Date.parse(row.fetchedAt)));
    for(const url of [row.requestedUrl,row.url]){const parsed=new URL(url);assert.equal(parsed.origin,expectedOrigin);assert(!parsed.username&&!parsed.password&&!parsed.hash);}
    const bytes=await originalMember(root,row.body,8*1024*1024),headers=await originalMember(root,row.rawHeaders,1024*1024);
    assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);
    assert.equal(headers.length,row.headersBytes);assert.equal(hash(headers),row.headersSha256);
    const result=JSON.parse(await originalMember(root,row.result,1024*1024));assert.deepEqual(result,row);
    total+=bytes.length;loaded.set(row.key,{...row,bytes});
  }
  assert.equal(total,manifest.sourceBytes);assert(total<=64*1024*1024);
  assert.equal(manifest.capabilities.requestedUrl,wfsRequest(manifest.endpoint,'GetCapabilities'));
  assert.equal(manifest.schemaResponse.requestedUrl,wfsRequest(manifest.endpoint,'DescribeFeatureType',{typeNames:selection.typeName}));
  const pages=[];
  for(const edition of manifest.editions){
    assert.equal(edition.selection.typeName,selection.typeName);assert.equal(edition.selection.srsName,selection.srsName);
    assert.equal(edition.selection.pageSize,selection.pageSize);assert.equal(edition.selection.sortBy,manifest.selection.sortBy);
    assert.equal(edition.numberMatched,edition.numberReturned);assert.equal(edition.uniqueFeatureIds,edition.numberMatched);
    assert(edition.pages.length>=2,'Use the original multipage source intake.');
    const index=new Map();let offset=0,expectedNext=wfsItemsUrl(manifest.endpoint,selection);
    for(const page of edition.pages){
      assert.equal(page.startIndex,offset);
      assert(page.numberMatched===null||page.numberMatched===undefined||page.numberMatched===edition.numberMatched);
      assert(Number.isSafeInteger(page.numberReturned)&&page.numberReturned>=0&&page.numberReturned<=selection.pageSize);
      assert.equal(page.response.requestedUrl,expectedNext);
      const requested=new URL(wfsItemsUrl(manifest.endpoint,selection));
      requested.searchParams.set('startIndex',String(offset));requested.searchParams.sort();
      const actual=new URL(page.response.requestedUrl),parameters=url=>{
        const value=Object.create(null);
        for(const [key,entry]of url.searchParams){
          const folded=key.toLowerCase();assert(!Object.hasOwn(value,folded),'The original source repeats a WFS parameter.');
          value[folded]=entry;
        }
        return value;
      };
      assert.equal(actual.origin,requested.origin);assert.equal(actual.pathname,requested.pathname);
      assert(!actual.username&&!actual.password&&!actual.hash);
      assert.deepEqual(parameters(actual),parameters(requested));
      assert(!index.has(page.response.requestedUrl));
      index.set(page.response.requestedUrl,loaded.get(page.response.key));offset+=page.numberReturned;
      assert(offset<=edition.numberMatched);assert(page.next===null||typeof page.next==='string');
      expectedNext=page.next;
    }
    assert.equal(offset,edition.numberMatched);assert.equal(expectedNext,null);
    assert.equal(edition.startedAt,edition.pages[0].response.fetchedAt);assert.equal(edition.completedAt,edition.pages.at(-1).response.fetchedAt);
    pages.push(index);
  }
  return{root,raw,manifest,selection,loaded,pages};
}
async function commandJson(script,values,{signal}={}){
  signal?.throwIfAborted();
  const child=spawn(process.execPath,[script,...values],{stdio:['ignore','pipe','pipe'],env:process.env});
  const chunks=[],errors=[];let bytes=0,errorBytes=0,issue;
  const stop=()=>{issue??=signal?.reason??Error('Original CLI interrupted.');child.kill('SIGTERM');};
  signal?.addEventListener('abort',stop,{once:true});
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024){issue??=Error('Original CLI output exceeded its selected capacity.');child.kill('SIGTERM');}else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{if(errorBytes<65536){errors.push(chunk.subarray(0,65536-errorBytes));errorBytes+=chunk.length;}});
  child.once('error',error=>{issue??=error;});
  const code=await new Promise(done=>child.once('close',done));
  signal?.removeEventListener('abort',stop);
  if(issue)throw issue;
  assert.equal(code,0,Buffer.concat(errors).toString('utf8'));
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
async function run(){
 return withPrivateLock(ROOT,'journey.lock',async()=>{
  const source=await originalSource();
  const old=await optionalJson(join(ROOT,'result.json'),32*1024*1024);
  if(old?.state==='COMPLETE'){
    assert.equal(old.schema,SCHEMA);assert.equal(old.operation,OP);assert.equal(old.source.manifestSha256,MANIFEST_SHA);
    for(const file of old.deliverables){const bytes=await readFile(join(ROOT,'outputs',file.path));assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);}
    await readWfsProject(old.receivedProject);
    console.log(JSON.stringify({operation:OP,state:'COMPLETE',reused:true,result:join(ROOT,'result.json')}));return old;
  }
  const started=await retained('intent.json',async()=>({schema:SCHEMA,operation:OP,createdAt:new Date().toISOString(),
    mode:MODE,source:SOURCE,sourceOperation:SOURCE_OPERATION,sourceManifestSha256:MANIFEST_SHA}));
  assert.equal(started.schema,SCHEMA);assert.equal(started.operation,OP);assert.equal(started.sourceManifestSha256,MANIFEST_SHA);
  const project=join(ROOT,'feature-desk'),fixture=await durableDirectory(join(ROOT,'local-fixture'));
  const outputs=await durableDirectory(join(ROOT,'outputs'));
  await exactFile(join(outputs,'original-source-manifest.json'),source.raw);
  const settings=await retained('runtime-selection.json',async()=>({merchantPort:await port(),origin:ORIGIN}));
  assert.equal(settings.origin,ORIGIN);
  const originalProject=await initializeWfsProject({directory:project,name:'GeoSolutions WFS original customer workspace'});
  let facilitator,transport,app,browser,mcp,client,playwrightBrowser,configuration,operationFailure;
  async function nativeBrowser(){
    if(playwrightBrowser)return playwrightBrowser;
    const require=createRequire(import.meta.url);let playwright;
    for(const path of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES&&join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'),
      join(SOURCE,'node_modules/playwright')].filter(Boolean)){
      try{playwright=require(path);break;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
    }
    if(!playwright)throw Error('Use the same installed Playwright runtime for this customer.');
    playwrightBrowser=await playwright.chromium.launch({headless:true,
      ...(process.env.WFS_NATIVE_CHROMIUM_EXECUTABLE?{executablePath:process.env.WFS_NATIVE_CHROMIUM_EXECUTABLE}:{}),
      args:['--disable-dev-shm-usage']});
    return playwrightBrowser;
  }
  let selectedEdition=0,pauseFirstPage=!await optionalJson(join(ROOT,'order-cancelled.json'));
  let gateReached,releaseGate;
  const gate=new Promise(done=>{gateReached=done}),continuation=new Promise(done=>{releaseGate=done});
  const uses=await optionalJson(join(ROOT,'source-adoption-current.json'),4*1024*1024)??[];
  assert(Array.isArray(uses));
  async function recordUse(row,kind){
    const selected={kind,key:row.key,requestedUrl:row.requestedUrl,sha256:row.sha256,bytes:row.bytes.length,fetchedAt:row.fetchedAt,adoptedAt:new Date().toISOString()};
    uses.push(selected);await save('source-adoption-current.json',uses);
  }
  const metadataRecordSource=async(url,kind)=>{
    const original=kind==='capabilities'?source.manifest.capabilities:source.manifest.schemaResponse;
    assert.equal(original.requestedUrl,url);const row=source.loaded.get(original.key);await recordUse(row,kind);
    return{raw:row.bytes,requestedUrl:row.requestedUrl,url:row.url,status:row.status,fetchedAt:row.fetchedAt,headers:row.headers};
  };
  const featureRecordSource=async url=>{
    const row=source.pages[selectedEdition].get(url);assert(row,'The original selected source edition does not contain '+url);
    await recordUse(row,'edition-'+(selectedEdition+1));
    return{bytes:row.bytes,requestedUrl:row.requestedUrl,url:row.url,status:row.status,fetchedAt:row.fetchedAt,
      contentType:row.headers['content-type'],etag:row.headers.etag??null,lastModified:row.headers['last-modified']??null,
      contentCrs:row.headers['content-crs']??null};
  };
  const onProgress=async value=>{
    if(pauseFirstPage&&selectedEdition===0&&value.pages===1&&value.next){
      pauseFirstPage=false;gateReached(value);await continuation;
    }
  };
  const step=async(name,value)=>{await save('steps/'+name+'.json',{at:new Date().toISOString(),...value});console.log(JSON.stringify({operation:OP,step:name,...value}));};
  const environment={...process.env,WFS_NATIVE_MCP_TOKEN:randomBytes(32).toString('hex'),MCP_OAUTH_CONFIG:undefined,MCP_CLIENT_ORIGINS:''};
  async function restartMcp(){
    await client?.close();client=null;if(mcp){await mcp.close();mcp=null;}
    mcp=await startMerchantMcp({configPath:configuration,port:0,tokenEnv:'WFS_NATIVE_MCP_TOKEN',environment});
    client=await openMerchantFileClient({url:mcp.url,tokenEnv:'WFS_NATIVE_MCP_TOKEN',environment,
      errorPrefix:'WFS',clientName:'original-wfs-native-customer'});
  }
  const call=(name,input={})=>client.call('merchant_wfs_'+name,{workspace:'desk',...input});
  const originalRequest=async(id,input)=>retained('requests/'+id+'.json',async()=>({
    workspace:'desk',id,expectedRevision:(await call('status')).project.revision,...input}));
  const mutation=async(name,id,input)=>client.call('merchant_wfs_'+name,await originalRequest(id,input));
  const dataset=(action,id,input={})=>call('dataset',{action,id,...input});
  const retainDownload=async(name,kind,input={})=>{
    const file=await app.download(kind,input);await exactFile(join(outputs,name),file.bytes);
    return{name,bytes:file.bytes.length,sha256:hash(file.bytes)};
  };
  try{
    facilitator=await localFacilitator();
    transport=await localMerchantTransport(fixture,'http://127.0.0.1:'+settings.merchantPort);
    const keys=await retained('local-fixture/operator-keys.json',async()=>Object.fromEntries(
      ['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'].map(key=>[key,randomBytes(32).toString('base64')])));
    const buyer=await new Buyer({runtimeDirectory:join(SCF,'sf88-operator-buyer-cli'),stateDirectory:join(ROOT,'buyer'),
      operatorProfile:join(fixture,'operator-profile.json'),
      environment:{...process.env,...keys,NODE_EXTRA_CA_CERTS:transport.certFile},timeoutMs:180000}).ready();
    const nativeFactory=await createNativeHttpFactory({facilitator:facilitator.url,allowLocalFacilitator:true});
    app=await openWfsApplication({directory:project,python:PYTHON,buyer,nativeFactory,merchantPort:settings.merchantPort,
      metadataRecordSource,featureRecordSource,onProgress,
      fetchImpl:async()=>{throw Error('This same source operation is received from its retained exact responses.');}});
    assert.equal(app.startup().sourceAuthConfigured,false);
    browser=await startWfsWorkspace({application:app,port:0,connectionFile:join(ROOT,'browser-connection.json')});
    await save('browser-startup.json',browser.startup);
    const host={schema:'stellar-forge.wfs-workspace-host.v1',workspaces:{desk:{label:'GeoSolutions original WFS customer',
      connectionFile:join(ROOT,'browser-connection.json'),projectId:originalProject.id,expectedBindingSha256:browser.startup.binding.sha256,
      timeoutMs:1800000,inputs:{},merchantProfiles:{native:{label:'Original local protocol',origin:ORIGIN,path:'/wfs',payment:PAYMENT}}}}};
    const originalHost=await retained('host-connection.json',async()=>host);assert.deepEqual(originalHost,host);
    const registered=inspectMerchantProvider('wfs-workspaces').providers[0];
    assert.equal(registered.family,'wfsWorkspaces');assert(registered.tools.some(tool=>tool.name==='merchant_wfs_cancel'));
    const initialized=await initializeMerchantProvider('wfs-workspaces',{directory:join(ROOT,'merchant-mcp'),
      connection:join(ROOT,'host-connection.json'),name:'WFS original source and customer'});
    configuration=initialized.configuration;await restartMcp();
    await step('original-owner-and-source',{provider:registered.id,tools:registered.toolCount,projectId:originalProject.id,
      bindingSha256:browser.startup.binding.sha256,sourceOperation:SOURCE_OPERATION,manifestSha256:MANIFEST_SHA,
      sourceRequests:source.manifest.sourceRequests,sourceAttempts:source.manifest.sourceAttempts,sourceAuth:'PUBLIC'});
    const terms=source.manifest.selection.serviceTerms.map(item=>item.field+': '+item.value).join('\n');
    const discovered=await mutation('discover','wfs-original-capabilities',{endpoint:source.manifest.endpoint,
      name:'GeoSolutions original WFS2 service',terms});
    const sourceId=discovered.source.id;
    const described=await mutation('describe','wfs-original-schema',{sourceId,typeName:source.selection.typeName});
    const schemaId=described.schema.id;
    const queried=await mutation('save_query','wfs-original-query',{sourceId,schemaId,
      name:'Original states polygon collection',selection:source.selection});
    const queryId=queried.query.id;
    const metadataFiles=[await retainDownload('GetCapabilities.xml','capabilities',{sourceId}),
      await retainDownload('DescribeFeatureType.xsd','schema',{schemaId})];
    assert.equal(metadataFiles[0].sha256,source.manifest.capabilities.sha256);assert.equal(metadataFiles[1].sha256,source.manifest.schemaResponse.sha256);
    const orders=[];
    for(let index=0;index<2;index++){
      selectedEdition=index;
      const id='wfs-original-order-'+(index+1),request=await originalRequest(id,{
        queryId,name:'Original source edition '+(index+1),limits:{pageBytes:8*1024*1024,totalBytes:64*1024*1024,maxPages:1024,requestTimeoutMs:60000}});
      if(index===0&&!await optionalJson(join(ROOT,'order-cancelled.json'))){
        const task=client.call('merchant_wfs_download_order',request).then(value=>({value}),error=>({error:{code:error.code??error.name,message:String(error.message)}}));
        const boundary=await Promise.race([gate.then(value=>({gate:value})),task]);
        if(!boundary.gate){if(boundary.error)throw Object.assign(Error(boundary.error.message),{code:boundary.error.code});throw Error('The retained original first-page interruption was not reached.');}
        let cancelled;
        try{cancelled=await call('cancel',{id});}finally{releaseGate();}
        const outcome=await task;assert(outcome.error);
        const state=await readWfsProject(project);assert.equal(state.pending.id,id);assert.equal(state.pending.progress.pages,1);
        const current=await getWfsOrder(project,state.pending.progress.orderId);
        assert.equal(current.order.state,'PARTIAL');assert.equal(current.capture.pageCount,1);assert.equal(current.capture.complete,false);
        const prefix=current.capture.pages[0];assert.equal(prefix.sha256,source.manifest.editions[0].pages[0].response.sha256);
        const binding={id,request,cancelled,outcome,orderId:current.order.id,prefix,
          prefixAdoptions:uses.filter(item=>item.key===source.manifest.editions[0].pages[0].response.key).length,at:new Date().toISOString()};
        await save('order-cancelled.json',binding);
        await step('original-first-page-cancel',{id,orderId:current.order.id,rows:current.capture.rows,
          prefixSha256:prefix.sha256,prefixBytes:prefix.bytes,next:current.capture.next});
      }
      const result=await client.call('merchant_wfs_download_order',request);
      const replay=await client.call('merchant_wfs_download_order',request);assert.equal(replay.order.id,result.order.id);assert.equal(replay.reused,true);
      const actual=await getWfsOrder(project,result.order.id),expected=source.manifest.editions[index];
      assert.equal(actual.order.state,'READY');assert.equal(actual.capture.complete,true);
      assert.equal(actual.capture.rows,expected.numberMatched);assert.equal(actual.capture.pageCount,expected.pages.length);
      for(let page=0;page<expected.pages.length;page++){
        assert.equal(actual.capture.pages[page].requestedUrl,expected.pages[page].response.requestedUrl);
        assert.equal(actual.capture.pages[page].sha256,expected.pages[page].response.sha256);
        assert.equal(actual.capture.pages[page].fetchedAt,expected.pages[page].response.fetchedAt);
      }
      if(index===0){
        const cancelled=await optionalJson(join(ROOT,'order-cancelled.json'));
        assert.equal(actual.capture.pages[0].sha256,cancelled.prefix.sha256);
        assert.equal(uses.filter(item=>item.key===expected.pages[0].response.key).length,cancelled.prefixAdoptions);
      }
      orders.push(result.order.id);
      await step('complete-original-edition-'+(index+1),{orderId:result.order.id,captureId:actual.capture.sourceId,
        rows:actual.capture.rows,pages:actual.capture.pageCount,bytes:actual.capture.totalBytes,
        sourceWindow:[expected.startedAt,expected.completedAt]});
    }
    const compared=await mutation('compare','wfs-original-comparison',{before:orders[0],after:orders[1],keyPointer:'/id'});
    const comparisonId=compared.comparison.id;
    const comparison=await call('query',{kind:'comparison',input:{comparisonId,kind:'changed',offset:0,limit:100}});
    const featurePage=await call('query',{kind:'features',input:{orderId:orders[1],offset:0,limit:3}});
    assert.equal(featurePage.total,source.manifest.editions[1].numberMatched);
    const sourceOutputs=[...metadataFiles,await retainDownload('wfs-edition-comparison.json','comparison',{comparisonId}),
      await retainDownload('wfs-original-features.geojson','features',{orderId:orders[1]})];
    await step('complete-original-comparison',{comparisonId,counts:comparison.counts,
      sourceSelectionsEqual:comparison.sourceSelectionsEqual,coordinates:featurePage.coordinates,files:sourceOutputs});
    const vectors=await prepareNativeVectorCustomer({app,call,source,orders,root:ROOT,outputs,retained,step,
      nativeBrowser,browserUrl:browser.url});
    const publication=await mutation('publish','wfs-original-publication',{orderId:orders[1],profile:'native'});
    const publicationId=publication.publication.id;
    const serving=await call('merchant',{action:'start',publicationId});assert.equal(serving.mode,'NATIVE_SELLER');
    const published=await call('query',{kind:'publication',input:{publicationId}}),edition=published.merchant.edition;
    assert.equal(edition.rowCount,source.manifest.editions[1].numberMatched);
    const pageSize=Math.min(250,Math.max(1,Math.ceil(edition.rowCount/3))),sourcePageSize=4;
    const rowPages=Math.max(1,Math.ceil(edition.rowCount/pageSize)),sourcePages=Math.max(1,Math.ceil(edition.sourceFileRows/sourcePageSize));
    const maxPages=rowPages+sourcePages+1;assert(maxPages<=1024);
    const totalAtomic=(BigInt(PAYMENT.amount)*BigInt(maxPages)).toString();
    const policy={schema:'stellar-spend-governor/v1',assets:[{network:PAYMENT.network,asset:PAYMENT.asset,
      max_single:PAYMENT.amount,max_total:totalAtomic,max_per_utc_day:totalAtomic,
      max_per_actor_utc_day:totalAtomic,max_per_service_utc_day:totalAtomic}]};
    const retainedPolicy=await retained('local-fixture/policy.json',async()=>policy);assert.deepEqual(retainedPolicy,policy);
    await exactFile(join(fixture,'signer.mjs'),Buffer.from('export async function sign({challenge,accepted}) { return {x402Version:2,resource:challenge.resource,accepted,payload:{transaction:"LOCAL_CONTROLLED_NOT_A_TRANSACTION"},extensions:challenge.extensions}; }\n'));
    const profile={operator:{python:PYTHON,actor:'wfs-native-customer',service:'geosolutions-wfs',
      policy:join(fixture,'policy.json'),ledger:join(fixture,'ledger.sqlite')},
      signerModule:join(fixture,'signer.mjs'),buyerTransport:transport.buyerTransport};
    await retained('local-fixture/operator-profile.json',async()=>profile);
    await retained('approval-limit.json',async()=>({plannedRequests:maxPages,amount:PAYMENT.amount,maxTotalAtomic:totalAtomic}));
    const resource=new URL(published.merchant.plan.resource);
    const unsigned=await fetch(serving.url+resource.pathname+'?limit='+pageSize);
    const challenge=unsigned.headers.get('payment-required');await unsigned.arrayBuffer();
    assert.equal(unsigned.status,402);assert(challenge);
    await save('outputs/unsigned-offer.json',{status:unsigned.status,challenge:JSON.parse(Buffer.from(challenge,'base64'))});
    const intentId='wfs-original-first-page';
    await call('purchase',{action:'prepare',publicationId,intentId,kind:'rows',query:'limit='+Math.min(3,pageSize)});
    const single=await call('purchase',{action:'buy',publicationId,intentId});
    const recovered=await call('purchase',{action:'recover',publicationId,intentId});
    assert.equal(single.sha256,recovered.sha256);
    await step('original-paid-request-recovery',{intentId,bytes:recovered.bytes,sha256:recovered.sha256,state:recovered.state});
    const acquisitions=[];
    for(const kind of ['rows','sources']){
      const id='wfs-complete-'+kind,number=kind==='rows'?rowPages:sourcePages,limit=kind==='rows'?pageSize:sourcePageSize;
      await dataset('prepare',id,{publicationId,kind,query:'limit='+limit,maxPages:number,
        maxRows:kind==='rows'?Math.max(1,edition.rowCount):edition.sourceFileRows,
        maxTotalAtomic:(BigInt(PAYMENT.amount)*BigInt(number)).toString()});
      await dataset('create',id,{publicationId});await dataset('run',id,{publicationId});
      const accounting=await dataset('accounting',id,{publicationId}),inspected=await dataset('inspect',id,{publicationId});
      const delivered=await dataset('deliver',id,{publicationId}),again=await dataset('recover',id,{publicationId});
      assert.equal(delivered.manifest.dataset.snapshot,kind==='rows'?edition.snapshot:edition.sourceSnapshot);
      const file=await app.download('dataset',{publicationId,id,file:'dataset.csv'});
      await exactFile(join(outputs,kind+'.csv'),file.bytes);
      await save('outputs/'+kind+'-acquisition.json',{id,accounting,inspected,delivered,again});
      acquisitions.push({id,kind,delivery:delivered.report,manifest:delivered.manifest,bytes:file.bytes.length,sha256:hash(file.bytes)});
      await step('original-complete-'+kind,{id,snapshot:delivered.manifest.dataset.snapshot,bytes:file.bytes.length,sha256:hash(file.bytes)});
    }
    const sourceIdDataset='wfs-complete-sources';
    const received=await dataset('receive',sourceIdDataset,{publicationId}),beforeReceiveReplay=await auditFiles(received.directory);
    const receivedAgain=await dataset('receive',sourceIdDataset,{publicationId});
    assert.equal(receivedAgain.captureManifestSha256,received.captureManifestSha256);
    assert.deepEqual(await auditFiles(received.directory),beforeReceiveReplay);
    const reopened=await dataset('reopen',sourceIdDataset,{publicationId});
    assert.equal(reopened.projectId,originalProject.id);
    const customerProject=await readWfsProject(reopened.directory);
    assert.equal(customerProject.id,originalProject.id);assert.equal(customerProject.orders.length,2);
    for(let index=0;index<2;index++){
      const original=await getWfsOrder(project,orders[index]),customer=await getWfsOrder(reopened.directory,orders[index]);
      assert.deepEqual(customer.capture,original.capture);
    }
    await verifyNativeVectorCustomer({directory:reopened.directory,python:PYTHON,expected:vectors,
      label:'native-vectors-paid-customer-reopen',step});
    const exactXml=await exportWfsReceivedFile({sourceDirectory:received.directory,file:discovered.source.directory+'/response.bin',python:PYTHON});
    assert.equal(hash(exactXml.bytes),source.manifest.capabilities.sha256);
    await exactFile(join(outputs,'customer-GetCapabilities.xml'),exactXml.bytes);
    const originalWindow=await dataset('open',sourceIdDataset,{publicationId});
    const customerState=await wfsLoopbackJson({url:originalWindow.url,path:'/api/state'});
    assert.equal(customerState.project.id,originalProject.id);
    await step('complete-source-receiving-and-offline-reopen',{captureManifestSha256:received.captureManifestSha256,
      sourceSetId:received.sourceSetId,projectId:reopened.projectId,revision:reopened.revision,
      counts:reopened.counts,exactXmlSha256:hash(exactXml.bytes)});
    // New MCP instance resumes this exact deterministic full file with its own read ID.
    const selection={workspace:'desk',kind:'project'},parts=[];
    const first=await client.call('merchant_wfs_file_read',{...selection,limit:65536});
    assert.equal(first.offset,0);parts.push(Buffer.from(first.data,'base64'));
    const fileIdentity=first.file;let offset=first.nextOffset,chunks=1,readId;
    await restartMcp();
    while(offset!==null){
      const chunk=await client.call('merchant_wfs_file_read',{...selection,expectedSha256:fileIdentity.sha256,
        offset,limit:65536,...(readId?{readId}:{})});
      readId=chunk.readId;assert.equal(chunk.file.sha256,fileIdentity.sha256);assert.equal(chunk.offset,offset);
      const bytes=Buffer.from(chunk.data,'base64');assert.equal(bytes.length,chunk.bytesRead);
      parts.push(bytes);offset=chunk.nextOffset;chunks++;
    }
    const bundleBytes=Buffer.concat(parts);assert.equal(bundleBytes.length,fileIdentity.bytes);assert.equal(hash(bundleBytes),fileIdentity.sha256);
    await exactFile(join(outputs,'wfs-feature-project.json'),bundleBytes);
    const bundle=JSON.parse(bundleBytes),bundleSummary=inspectWfsProjectBundle(bundle);
    const copy=join(ROOT,'received-whole-project');
    await receiveWfsProject({directory:copy,bundle,id:'wfs-original-whole-receiving',python:PYTHON});
    await verifyNativeVectorCustomer({directory:copy,python:PYTHON,expected:vectors,
      label:'native-vectors-whole-project-receiving',step});
    const copyState=await readWfsProject(copy);
    await saveWfsQuery({directory:copy,id:'wfs-customer-follow-on-query',expectedRevision:copyState.revision,
      sourceId,schemaId,name:'Customer saved follow-on query',selection:source.selection});
    const changed=await readWfsProject(copy);
    await receiveWfsProject({directory:copy,bundle,id:'wfs-original-whole-receiving',python:PYTHON});
    assert.deepEqual(await readWfsProject(copy),changed);
    // Installed CLI consumes these same complete customer files and source records.
    const cli=join(WFS,'cli.mjs');
    const shown=await commandJson(cli,['show','--project',copy]);
    assert.equal(shown.id,changed.id);assert.equal(shown.revision,changed.revision);
    const inspectedBundle=await commandJson(cli,['inspect-bundle','--source',join(outputs,'wfs-feature-project.json')]);
    assert.equal(inspectedBundle.bundleSha256,bundleSummary.bundleSha256);
    const cliReplayed=await commandJson(cli,['receive','--project',copy,'--source',join(outputs,'wfs-feature-project.json'),'--id','wfs-original-whole-receiving','--python',PYTHON]);
    assert.equal(cliReplayed.bundleSha256,bundle.bundleSha256);assert.deepEqual(await readWfsProject(copy),changed);
    await save('outputs/installed-cli-receiving.json',{shown,inspectedBundle,cliReplayed});
    await step('mcp-restart-whole-project-and-installed-receiving',{bytes:bundleBytes.length,sha256:hash(bundleBytes),chunks,
      bundleSha256:bundle.bundleSha256,projectId:changed.id,sourceRevision:bundleSummary.project.revision,customerRevision:changed.revision});
    await nativeBrowser();
    const page=await playwrightBrowser.newPage({viewport:{width:1440,height:1000}}),browserErrors=[];
    page.on('pageerror',error=>browserErrors.push(String(error)));
    await page.goto(browser.url,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.getElementById('project-title').textContent==='GeoSolutions WFS original customer workspace');
    // Open a real retained feature order before capturing its geometry/row workspace.
    await page.locator('nav>[data-section="orders"]').click();
    await page.locator('#orders-body tr').first().getByRole('button',{name:'Open',exact:true}).click();
    await page.waitForFunction(()=>!document.getElementById('order-panel').hidden);
    for(const section of ['services','queries','orders','comparison','publication','customer','vectors','transfer','history']){
      await page.locator('nav>[data-section="'+section+'"]').click();
      await page.screenshot({path:join(outputs,'merchant-'+section+'.png'),fullPage:true});
    }
    await page.goto(originalWindow.url,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.getElementById('project-title').textContent==='GeoSolutions WFS original customer workspace');
    await inspectNativeVectorBrowser({page,expected:vectors,outputs});
    await page.locator('nav>[data-section="orders"]').click();
    await page.locator('#orders-body tr').first().getByRole('button',{name:'Open',exact:true}).click();
    await page.waitForFunction(()=>!document.getElementById('order-panel').hidden);
    await page.screenshot({path:join(outputs,'customer-order-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:join(outputs,'customer-order-mobile.png'),fullPage:true});
    const width=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert(width.document<=width.viewport);assert.deepEqual(browserErrors,[]);
    await playwrightBrowser.close();playwrightBrowser=null;
    await step('actual-source-merchant-and-customer-browser',{screenshots:14,desktop:1440,mobile:width,browserErrors});
    await call('merchant',{action:'stop',publicationId});
    await client.close();client=null;await mcp.close();mcp=null;
    await browser.close();browser=null;await app.close();app=null;
    assert.deepEqual(await readWfsProject(copy),changed);
    const deliverables=await auditFiles(outputs);
    const result={schema:SCHEMA,operation:OP,state:'COMPLETE',mode:MODE,startedAt:started.createdAt,completedAt:new Date().toISOString(),
      source:{operation:SOURCE_OPERATION,manifestSha256:MANIFEST_SHA,endpoint:source.manifest.endpoint,
        sourceRequests:source.manifest.sourceRequests,sourceAttempts:source.manifest.sourceAttempts,sourceBytes:source.manifest.sourceBytes,
        selection:source.selection,editions:source.manifest.editions.map(edition=>({id:edition.id,rows:edition.numberMatched,
          pages:edition.pages.length,startedAt:edition.startedAt,completedAt:edition.completedAt})),auth:'PUBLIC'},
      projectId:originalProject.id,sourceId,schemaId,queryId,orders,comparisonId,comparisonCounts:comparison.counts,
      publicationId,editionId:edition.editionId,acquisitions,sourceReceiving:received,customerReopen:reopened,vectors,
      receivedProject:copy,completeTransfer:{bytes:bundleBytes.length,sha256:hash(bundleBytes),chunks,bundleSha256:bundle.bundleSha256},
      installedCli:{projectId:shown.id,customerRevision:shown.revision,reused:cliReplayed.reused},
      fixtureCalls:facilitator.counts,transport:transport.counts,deliverables};
    await save('result.json',result);
    console.log(JSON.stringify({operation:OP,state:'COMPLETE',mode:MODE,result:join(ROOT,'result.json'),rows:edition.rowCount,
      sourceFileRows:edition.sourceFileRows,deliverables:deliverables.length}));return result;
  }catch(error){
    operationFailure=error;
    await save('last-outcome.json',{schema:SCHEMA,operation:OP,state:'INTERRUPTED',at:new Date().toISOString(),
      code:error.code??error.name,message:String(error.message),stack:String(error.stack).slice(0,12000)});
    throw error;
  }finally{
    releaseGate();const closeErrors=[];
    for(const resource of [playwrightBrowser,client,mcp,browser,app,transport,facilitator]){
      if(resource)try{await resource.close();}catch(error){closeErrors.push(error);}
    }
    if(closeErrors.length&&!operationFailure)throw closeErrors[0];
  }
 });
}
if(args.child)await run();
else{
 const PY=String.raw`
import json,os,pty,re,select,signal,sys,time
node,script,directory=sys.argv[1:4]
pid,fd=pty.fork()
if pid==0:os.execve(node,[node,'--max-old-space-size=384',script,'--fixture-tty-child','--directory',directory,'--python',sys.executable],os.environ.copy())
transcript=bytearray();scanned=0;approvals=0;status=None
prompt=re.compile(rb'To authorize ONE fresh reservation, type exactly: (APPROVE [0-9a-f]{16})')
def stop(number,frame):raise InterruptedError('Original local protocol journey interrupted')
signal.signal(signal.SIGTERM,stop)
try:
 deadline=time.monotonic()+1800
 while time.monotonic()<deadline:
  ready,_,_=select.select([fd],[],[],0.1)
  if ready:
   try:chunk=os.read(fd,65536)
   except OSError:break
   if not chunk:break
   transcript.extend(chunk)
   if len(transcript)>2097152:raise RuntimeError('Original local transcript capacity exceeded')
   for match in prompt.finditer(transcript,scanned):
    with open(os.path.join(directory,'approval-limit.json')) as f:limit=json.load(f)['plannedRequests']
    if approvals>=limit:raise RuntimeError('Unexpected additional local reservation')
    os.write(fd,match.group(1)+b'\n');approvals+=1;scanned=match.end()
  ended,value=os.waitpid(pid,os.WNOHANG)
  if ended:status=value;break
finally:
 if status is None:
  ended,value=os.waitpid(pid,os.WNOHANG)
  if ended:status=value
  else:
   signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
   try:os.killpg(pid,signal.SIGTERM)
   except ProcessLookupError:pass
   grace=time.monotonic()+15
   while status is None and time.monotonic()<grace:
    ended,value=os.waitpid(pid,os.WNOHANG)
    if ended:status=value;break
    time.sleep(0.05)
   if status is None:
    try:os.killpg(pid,signal.SIGKILL)
    except ProcessLookupError:pass
    _,status=os.waitpid(pid,0)
 os.close(fd)
 descriptor=os.open(os.path.join(directory,'local-fixture-transcript.log'),os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
 with os.fdopen(descriptor,'wb') as f:f.write(transcript);f.flush();os.fsync(f.fileno())
sys.exit(os.waitstatus_to_exitcode(status))
`;
 const child=spawn(PYTHON,['-I','-B','-c',PY,process.execPath,fileURLToPath(import.meta.url),ROOT],{stdio:['ignore','inherit','inherit'],env:process.env});
 const stop=()=>child.kill('SIGTERM');process.once('SIGTERM',stop);process.once('SIGINT',stop);
 let code;try{code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});}
 finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);}
 if(code!==0){const failed=await optionalJson(join(ROOT,'last-outcome.json'));console.error(JSON.stringify({operation:OP,state:'INTERRUPTED',code,failed}));process.exitCode=1;}
 else{const result=await optionalJson(join(ROOT,'result.json'),32*1024*1024);assert.equal(result?.state,'COMPLETE');console.log(JSON.stringify({operation:OP,state:'COMPLETE',result:join(ROOT,'result.json'),projectId:result.projectId,orders:result.orders}));}
}
