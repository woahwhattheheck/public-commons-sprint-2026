// MIT. Same-owner Datasette merchant receiving and exact completed-upload replay. No capture, publisher, payment or Analysis owner is opened.
import {constants} from 'node:fs';
import {open, mkdir, readdir, realpath, rename, unlink} from 'node:fs/promises';
import {join, resolve, relative, isAbsolute, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';

const PREFIX='merchant_datasette_';
const TOOL_NAMES=Object.freeze([
  'workspaces','health','status','operations','operation','reconnect','files','file','file_read','file_release',
  'export_prepare','export_inventory','export_manifest','export_file','export_file_release','upload_status','upload_chunk',
].map(name=>PREFIX+name));
const NATIVE_NAMES=Object.freeze([
  'source.capture','source.adopt','source.inspect','source.review','editions.create','editions.list',
  'editions.inspect','editions.compare','source.select','publisher.status','publisher.source','publisher.target',
  'publisher.plan','publisher.extract','publisher.inspect','publisher.review','publisher.publish','publisher.recover',
  'publisher.buyer-offer','publisher.prepare-buyer','release.prepare','release.stage','source.export','source.receive',
  'files.list','files.inspect','files.read','workspace.export','workspace.receive','operations.inspect','operations.cancel',
]);
const REQUEST_NAMES=Object.freeze(['requests.inspect','requests.list']);
const READ_OPERATIONS=new Set(['source.inspect','editions.inspect','editions.list','operations.inspect']);
const HASH=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):
  plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value);
const bytes=value=>Buffer.from(canonical(value)+'\n');
const same=(a,b)=>canonical(a)===canonical(b);
const need=(test,code,reason)=>{if(!test)throw Object.assign(new Error(reason??code),{code});};
const printable=(value,max=4096)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const errorRecord=error=>({
  name:error?.name??'Error',code:error?.code??null,message:error?.message??String(error),
  ...(plain(error?.details)?{details:error.details}:{}),
  ...(plain(error?.recovery)?{recovery:error.recovery}:{}),
});
function relativePath(value) {
  need(printable(value)&&!value.startsWith('/')&&!/[\\:]/.test(value)&&
    value.split('/').every(part=>part&&part!=='.'&&part!=='..'),'DATASETTE_RECEIVING_PATH');
  return value;
}
async function privateDirectory(path) {
  await mkdir(path,{recursive:true,mode:0o700});
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await handle.stat();need(stat.isDirectory()&&(stat.mode&0o077)===0,'DATASETTE_RECEIVING_PRIVATE_DIRECTORY');}
  finally{await handle.close();}
  need(await realpath(path)===path,'DATASETTE_RECEIVING_CANONICAL_DIRECTORY');
}
async function readPrivate(path,maximum=64*1024*1024) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&(before.mode&0o077n)===0n&&before.size<=BigInt(maximum),'DATASETTE_RECEIVING_PRIVATE_FILE');
    const raw=await handle.readFile(),after=await handle.stat({bigint:true});
    need(raw.length<=maximum&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'DATASETTE_RECEIVING_FILE_CHANGED');
    return raw;
  }finally{await handle.close();}
}
async function maybeJSON(path) {
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPrivate(path)));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function writeJSON(path,value) {
  await privateDirectory(dirname(path));
  const raw=bytes(value),temporary=path+'.pending-'+randomUUID();
  let handle;
  try{
    handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await handle.writeFile(raw);await handle.sync();await handle.close();handle=null;
    await rename(temporary,path);
    const directory=await open(dirname(path),constants.O_RDONLY);
    try{await directory.sync();}finally{await directory.close();}
  }finally{
    if(handle)await handle.close();
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  return {path,bytes:raw.length,sha256:sha(raw)};
}
async function identity(path) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&(before.mode&0o077n)===0n,'DATASETTE_RECEIVING_PRIVATE_FILE');
    const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);let position=0;
    for(;;){const part=await handle.read(buffer,0,buffer.length,position);if(!part.bytesRead)break;
      position+=part.bytesRead;hash.update(buffer.subarray(0,part.bytesRead));}
    const after=await handle.stat({bigint:true});
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&BigInt(position)===after.size&&
      before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'DATASETTE_RECEIVING_FILE_CHANGED');
    return {bytes:position,sha256:hash.digest('hex')};
  }finally{await handle.close();}
}
function fileMatches(actual,expected) {
  return actual?.path===expected.path&&actual.sha256===expected.sha256&&String(actual.bytes)===String(expected.bytes);
}
function contentInventory(value) {
  return {workspaceId:value.workspaceId,files:value.files.map(file=>{
    const {modifiedAt,...retained}=file;return retained;
  }).sort((left,right)=>left.path<right.path?-1:left.path>right.path?1:0)};
}
function inventoryDifference(before,after) {
  const original=new Map(contentInventory(before).files.map(file=>[file.path,file]));
  const current=new Map(contentInventory(after).files.map(file=>[file.path,file]));
  const removed=[...original.keys()].filter(path=>!current.has(path));
  const added=[...current.keys()].filter(path=>!original.has(path));
  const changed=[...original.keys()].filter(path=>current.has(path)&&!same(original.get(path),current.get(path)));
  return {removed:removed.slice(0,40),added:added.slice(0,40),changed:changed.slice(0,40),
    counts:{removed:removed.length,added:added.length,changed:changed.length}};
}
function ownerIdentity(health) {
  return {workspaceId:health.workspaceId,
    ...(health.instanceId===undefined?{}:{instanceId:health.instanceId}),
    ...(health.pid===undefined?{}:{pid:health.pid})};
}
function pageShape(page,offset,total,count) {
  need(plain(page)&&page.offset===offset&&Number.isSafeInteger(page.limit)&&page.limit>=1&&
    Number.isSafeInteger(page.total)&&page.total>=0&&(total===undefined||total===page.total)&&count<=page.limit,
  'DATASETTE_RECEIVING_PAGINATION');
  need(page.next===(offset+count<page.total?offset+count:null)&&!(page.next!==null&&count===0),
    'DATASETTE_RECEIVING_PAGINATION');
}
async function closeServer(server) {
  if(!server?.listening)return;
  const closing=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  server.closeIdleConnections?.();await closing;
}

/**
 * Attach one already-open native workspace after its original source/publisher/customer operations.
 * The owner supplies an already-produced full workspace archive and exact reviewed edition identity.
 * Native reads retain their original outcomes. An optional completed-upload declaration
 * exercises only the original zero-byte replay; no new upload bytes or source action is submitted.
 */
export async function runDatasetteMcpReceiving({
  sourceRoot,connectionFile,outputDirectory,workspaceAlias='portfolio',
  expectedWorkspaceId,editionId,expectedEditionSha256,captureId,expectedCaptureSha256,
  expectedRows=189,workspaceArchive,requiredNativeFiles=[],originalUpload,
}={}) {
  for(const value of [sourceRoot,connectionFile,outputDirectory])
    need(printable(value)&&isAbsolute(value),'DATASETTE_RECEIVING_ABSOLUTE_PATH');
  sourceRoot=await realpath(resolve(sourceRoot));connectionFile=resolve(connectionFile);outputDirectory=resolve(outputDirectory);
  need(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspaceAlias)&&printable(expectedWorkspaceId,256)&&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(editionId??'')&&HASH.test(expectedEditionSha256??'')&&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(captureId??'')&&
    (expectedCaptureSha256===undefined||HASH.test(expectedCaptureSha256))&&
    Number.isSafeInteger(expectedRows)&&expectedRows>=0&&expectedRows<=1000000,
  'DATASETTE_RECEIVING_ORIGINAL_BINDING');
  need(plain(workspaceArchive)&&Array.isArray(requiredNativeFiles),'DATASETTE_RECEIVING_ARCHIVE_REQUIRED',
    'Pass the exact already-exported original workspace archive; this receiver does not create another native export.');
  if(originalUpload!==undefined) {
    need(plain(originalUpload)&&Object.keys(originalUpload).length===4&&
      ['uploadId','name','bytes','sha256'].every(key=>Object.hasOwn(originalUpload,key))&&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(originalUpload.uploadId??'')&&
      printable(originalUpload.name,240)&&!/[\\/]/.test(originalUpload.name)&&
      typeof originalUpload.bytes==='string'&&/^(0|[1-9][0-9]*)$/.test(originalUpload.bytes)&&
      Number(originalUpload.bytes)<=2*1024*1024*1024&&HASH.test(originalUpload.sha256??''),
    'DATASETTE_RECEIVING_UPLOAD_BINDING','Pass the same complete original upload declaration, without creating another intake.');
    originalUpload=structuredClone(originalUpload);
  }
  const requiredToolNames=originalUpload?TOOL_NAMES:TOOL_NAMES.filter(name=>!['upload_status','upload_chunk'].includes(name.slice(PREFIX.length)));
  const required=[workspaceArchive,...requiredNativeFiles].map(file=>{
    relativePath(file.path);need(HASH.test(file.sha256??'')&&/^(0|[1-9][0-9]*)$/.test(String(file.bytes))&&
      Number(file.bytes)<=2*1024*1024*1024,'DATASETTE_RECEIVING_FILE_PIN');
    return {path:file.path,bytes:String(file.bytes),sha256:file.sha256};
  });
  need(new Map(required.map(file=>[file.path,file])).size===required.length,'DATASETTE_RECEIVING_DUPLICATE_PIN');
  const from=path=>import(pathToFileURL(join(sourceRoot,path)).href);
  const [{acquireStateLease},nativeProvider,leaf,clientModule,http]=await Promise.all([
    from('stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs'),
    from('stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/provider.mjs'),
    from('stellar-forge/mcp-merchant-operator/datasette-workspace.mjs'),
    from('stellar-forge/mcp-merchant-operator/datasette-client.mjs'),
    from('stellar-forge/mcp-paid-agent/http-tools.mjs'),
  ]);
  const descriptor=nativeProvider.default;
  need(descriptor.id==='datasette-workspaces'&&descriptor.concurrency==='provider'&&
    descriptor.configuration.privateExports===true,'DATASETTE_RECEIVING_PROVIDER_JOIN',
  'Use the completed original source-owned Datasette contribution, with its receiving leaf and private exports.');
  const tool=(name,description,properties,required,annotations={})=>({
    name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations,
  });
  const definitions=descriptor.tools(tool);
  need(new Set(definitions.map(item=>item.name)).size===TOOL_NAMES.length&&
    same(definitions.map(item=>item.name).sort(),[...TOOL_NAMES].sort()),'DATASETTE_RECEIVING_CATALOG');
  const advertisedNative=definitions.find(item=>item.name===PREFIX+'operation')?.inputSchema.properties.operation.enum;
  const nativeNames=Array.isArray(advertisedNative)?[...advertisedNative]:[];
  need(new Set(nativeNames).size===nativeNames.length&&
    (same([...nativeNames].sort(),[...NATIVE_NAMES].sort())||
     same([...nativeNames].sort(),[...NATIVE_NAMES,...REQUEST_NAMES].sort())),'DATASETTE_RECEIVING_NATIVE_CATALOG');
  const loaded=await descriptor.load();
  need(loaded.MerchantDatasetteWorkspaces===leaf.MerchantDatasetteWorkspaces,'DATASETTE_RECEIVING_PROVIDER_JOIN');
  await privateDirectory(outputDirectory);
  const lease=await acquireStateLease(outputDirectory),journalPath=join(outputDirectory,'journey.json');
  let journal,owner=null,primaryError=null;
  const config={
    sourceRoot,connectionFile,workspaceAlias,expectedWorkspaceId,editionId,expectedEditionSha256,
    captureId,expectedCaptureSha256:expectedCaptureSha256??null,expectedRows,requiredNativeFiles:required,
    originalUpload:originalUpload??null,nativeOperationNames:nativeNames,
  };
  const configHash=sha(bytes(config));
  const save=async()=>{lease.assertHeld();journal.updatedAt=new Date().toISOString();await writeJSON(journalPath,journal);};
  const evidence=async(name,value)=>{
    const selected=await writeJSON(join(outputDirectory,'observed',relativePath(name)),value);
    journal.evidence[name]={bytes:selected.bytes,sha256:selected.sha256};await save();return value;
  };
  const closeOwner=async()=>{
    if(!owner)return;
    const closing=owner;owner=null;const errors=[];
    try{await closing.provider.close();}catch(error){errors.push(errorRecord(error));}
    try{await closeServer(closing.server);}catch(error){errors.push(errorRecord(error));}
    closing.record.closed=errors.length===0;closing.record.closedAt=new Date().toISOString();
    if(errors.length)closing.record.closeErrors=errors;
    await save();need(errors.length===0,'DATASETTE_RECEIVING_CLOSE',JSON.stringify(errors));
  };
  const openOwner=async()=>{
    const connection=await nativeProvider.readDatasetteWorkspaceConfiguration(join(outputDirectory,'connection.json'));
    // The provider retains complete exports in an existing private directory.
    await privateDirectory(join(outputDirectory,'merchant-exports'));
    const provider=descriptor.create(loaded,{datasetteWorkspaces:connection,exportsDirectory:join(outputDirectory,'merchant-exports')},{});
    need(provider instanceof leaf.MerchantDatasetteWorkspaces,'DATASETTE_RECEIVING_PROVIDER_JOIN');
    const record={id:randomUUID(),startedAt:new Date().toISOString(),closed:false};
    journal.attachments.push(record);await save();
    const bearer=randomBytes(32).toString('base64url');
    const wrapped={tools:definitions,async call(name,args){
      const entry={id:randomUUID(),tool:name,input:structuredClone(args),startedAt:new Date().toISOString(),state:'READING'};
      journal.calls.push(entry);await save();
      try{
        const result=await provider.call(name,args),raw=bytes(result);
        entry.state='RETURNED';entry.result={bytes:raw.length,sha256:sha(raw)};
        entry.completedAt=new Date().toISOString();await save();return result;
      }catch(error){entry.state='FAILED';entry.error=errorRecord(error);entry.completedAt=new Date().toISOString();await save();throw error;}
    }};
    const server=createServer(http.createMcpToolHandler(wrapped,{
      bearerToken:bearer,serverName:'datasette-original-receiving',serverVersion:'1.0.0',
      maxRequestBytes:descriptor.maxRequestBytes,instructions:'Read the existing Datasette workspace and receive its exact retained source files. No source, publisher, payment or customer owner is created.',
    }));
    owner={server,provider,record,client:null};
    try{
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(journal.mcpPort??0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
      const address=server.address();need(address&&typeof address==='object','DATASETTE_RECEIVING_LISTENER');
      if(journal.mcpPort!==undefined)need(address.port===journal.mcpPort,'DATASETTE_RECEIVING_LISTENER');
      journal.mcpPort=address.port;record.port=address.port;await save();
      const url='http://127.0.0.1:'+address.port+'/',environment={DATASETTE_RECEIVING_TOKEN:bearer};
      owner.client=await clientModule.openDatasetteClient({url,workspace:workspaceAlias,tokenEnv:'DATASETTE_RECEIVING_TOKEN',environment});
      const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
        headers:{authorization:'Bearer '+bearer,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':http.MCP_VERSION},
        body:JSON.stringify({jsonrpc:'2.0',id:'receiving-tools',method:'tools/list',params:{}})});
      need(response.status===200,'DATASETTE_RECEIVING_CATALOG_HTTP');
      const reply=await response.json(),observed=reply.result?.tools;
      need(reply.id==='receiving-tools'&&Array.isArray(observed)&&
        same(observed.map(item=>item.name).sort(),[...TOOL_NAMES].sort()),'DATASETTE_RECEIVING_CATALOG');
      await evidence('tool-catalog.json',observed);
      return owner.client;
    }catch(error){try{await closeOwner();}catch(closeError){error.closeError=errorRecord(closeError);}throw error;}
  };
  const nativeRead=async(client,operation,input)=>{
    need(READ_OPERATIONS.has(operation),'DATASETTE_RECEIVING_READ_ONLY');
    const result=await client.nativeOperation(operation,input,{timeoutMs:300000});
    need(result.workspace===workspaceAlias&&result.operation===operation,'DATASETTE_RECEIVING_NATIVE_REPLY');
    return result.native;
  };
  const inventory=async client=>{
    const pages=[],files=[];let offset=0,total;
    for(;;){
      const wrapped=await client.files({offset,limit:200},{timeoutMs:300000}),result=wrapped.native;
      need(wrapped.workspace===workspaceAlias&&result?.workspaceId===expectedWorkspaceId&&Array.isArray(result.files),
        'DATASETTE_RECEIVING_FILES');
      pageShape(result.page,offset,total,result.files.length);total=result.page.total;
      for(const file of result.files){relativePath(file.path);need(HASH.test(file.sha256)&&file.workspaceId===expectedWorkspaceId&&
        /^(0|[1-9][0-9]*)$/.test(file.bytes),'DATASETTE_RECEIVING_FILE_PIN');files.push(file);}
      pages.push(result);if(result.page.next===null)break;offset=result.page.next;
      need(files.length<=30000,'DATASETTE_RECEIVING_FILES_LIMIT');
    }
    need(new Set(files.map(file=>file.path)).size===files.length,'DATASETTE_RECEIVING_DUPLICATE_FILE');
    return {workspaceId:expectedWorkspaceId,files,pages};
  };
  const allRows=async(client,operation,input)=>{
    const pages=[],rows=[],cellTypes=[];let offset=0,total,first;
    for(;;){
      const value=await nativeRead(client,operation,{...input,offset,limit:50});
      need(Array.isArray(value?.columns)&&Array.isArray(value.rows)&&Array.isArray(value.cellTypes)&&
        value.cellTypes.length===value.rows.length&&value.valueEncoding==='exact-source-text-with-explicit-cell-types',
        'DATASETTE_RECEIVING_ROW_ENCODING');
      pageShape(value.page,offset,total,value.rows.length);total=value.page.total;
      if(!first)first=value;
      need(same(value.columns,first.columns)&&value.captureSha256===first.captureSha256&&
        (operation!=='editions.inspect'||value.editionSha256===expectedEditionSha256)&&
        value.rows.every((row,index)=>Array.isArray(row)&&row.length===first.columns.length&&
          Array.isArray(value.cellTypes[index])&&value.cellTypes[index].length===row.length),
        'DATASETTE_RECEIVING_ROWS_CHANGED');
      pages.push(value);rows.push(...value.rows);cellTypes.push(...value.cellTypes);
      need(rows.length<=expectedRows,'DATASETTE_RECEIVING_ROW_COUNT');
      if(value.page.next===null)break;offset=value.page.next;
    }
    need(rows.length===expectedRows,'DATASETTE_RECEIVING_ROW_COUNT');
    return {columns:first.columns,rows,cellTypes,captureSha256:first.captureSha256,
      captureFile:first.captureFile,capture:first.capture,pages};
  };
  try{
    journal=await maybeJSON(journalPath);
    if(journal)need(journal.schema==='stellar-forge.datasette-mcp-receiving.v1'&&journal.configHash===configHash&&
      same(journal.config,config),'DATASETTE_RECEIVING_RESUME_BINDING');
    else{
      const names=(await readdir(outputDirectory)).filter(name=>name!=='lease.lock');
      need(names.length===0,'DATASETTE_RECEIVING_DIRECTORY_IN_USE');
      journal={schema:'stellar-forge.datasette-mcp-receiving.v1',id:randomUUID(),config,configHash,
        startedAt:new Date().toISOString(),state:'STARTED',evidence:{},calls:[],attachments:[]};
      await save();
    }
    // A completed receiver can be reverified entirely locally, without opening either listener.
    if(journal.state==='COMPLETE'){
      for(const [name,pin] of Object.entries(journal.evidence))
        need(same(await identity(join(outputDirectory,'observed',relativePath(name))),pin),'DATASETTE_RECEIVING_EVIDENCE_CHANGED');
      const local=await clientModule.reopenDatasetteExport({directory:join(outputDirectory,'received'),exportId:journal.receiving.exportId,
        expectedManifestSha256:journal.receiving.manifestFile.sha256});
      return {state:'COMPLETE',passed:true,repeated:true,report:journalPath,export:local,workspaceId:expectedWorkspaceId,
        exportId:journal.receiving.exportId,manifestSha256:journal.receiving.manifestFile.sha256,result:journal.result};
    }
    await writeJSON(join(outputDirectory,'connection.json'),{
      schema:nativeProvider.DATASETTE_CONNECTION_SCHEMA,workspaces:{
        [workspaceAlias]:{label:'Original Datasette receiving',urlFile:connectionFile,expectedWorkspaceId,timeoutMs:300000},
      },
    });
    let client=await openOwner();
    const aliases=await client.workspaces({});
    need(aliases.workspaces.some(item=>item.workspace===workspaceAlias),'DATASETTE_RECEIVING_ALIAS');
    const health=(await client.health({})).native,current=(await client.status({})).native;
    need(health.workspaceId===expectedWorkspaceId&&current.workspaceId===expectedWorkspaceId&&!current.active,
      'DATASETTE_RECEIVING_OWNER_ACTIVE');
    need(isAbsolute(current.directory)&&outputDirectory!==resolve(current.directory)&&
      !outputDirectory.startsWith(resolve(current.directory)+'/'),'DATASETTE_RECEIVING_DIRECTORY_OVERLAP');
    const ownerAtStart=ownerIdentity(health);
    if(journal.original)need(same(journal.original.status,current),'DATASETTE_RECEIVING_OWNER_CHANGED',
      'The original source, publisher or customer state changed. Review its saved owner before this same receiving continuation.');
    else{journal.original={health:ownerAtStart,status:current};await save();}
    await evidence('native-status-before.json',current);
    const operations=(await client.operations({})).native;
    need(Array.isArray(operations)&&same(operations.map(item=>item.operation).sort(),[...nativeNames].sort()),
      'DATASETTE_RECEIVING_NATIVE_CATALOG');
    await evidence('native-operation-catalog.json',operations);
    if(originalUpload) {
      const before=await client.uploadStatus({uploadId:originalUpload.uploadId},{timeoutMs:300000});
      need(before.workspace===workspaceAlias&&before.native?.workspaceId===expectedWorkspaceId&&
        before.native.state==='COMPLETE'&&Object.entries(originalUpload).every(([key,value])=>before.native[key]===value)&&
        before.native.receivedBytes===originalUpload.bytes&&before.native.prefixSha256===originalUpload.sha256&&
        before.native.uncheckpointedBytes==='0','DATASETTE_RECEIVING_UPLOAD_NOT_COMPLETE');
      await evidence('original-complete-upload.json',before);
      const repeated=await client.uploadChunk({...originalUpload,offset:originalUpload.bytes,length:'0',data:''},{timeoutMs:300000});
      const {replayed,...native}=repeated.native??{};
      need(repeated.workspace===workspaceAlias&&replayed===true&&same(native,before.native),
        'DATASETTE_RECEIVING_UPLOAD_CHANGED','The zero-byte replay must return the same original completed upload.');
      await evidence('original-complete-upload-replay.json',repeated);
      journal.upload={...originalUpload,archiveFile:before.native.archiveFile,retainedFile:before.native.retainedFile,
        replayed:true};await save();
    }
    const savedEdition=current.editions.find(item=>item.id===editionId);
    let savedCapture=current.captures.find(item=>item.operationId===captureId),capture,sourceOperation,captureLocation;
    need(savedEdition?.editionSha256===expectedEditionSha256,'DATASETTE_RECEIVING_SOURCE_BINDING');
    const edition=await allRows(client,'editions.inspect',{id:editionId});
    if(savedCapture) {
      need(savedCapture.rowCount===expectedRows&&
        (expectedCaptureSha256===undefined||savedCapture.captureSha256===expectedCaptureSha256),
      'DATASETTE_RECEIVING_SOURCE_BINDING');
      capture=await allRows(client,'source.inspect',{operationId:captureId});
      sourceOperation=await nativeRead(client,'operations.inspect',{operationId:captureId});
      captureLocation='workspace-capture';
    } else {
      // A received edition already contains the original capture. Its complete
      // native edition read verifies that same capture and every retained page;
      // importing it does not allocate a second acquisition in workspace/captures.
      need(plain(edition.capture)&&edition.capture.operationId===captureId&&
        edition.capture.state==='COMPLETE'&&edition.capture.rowCount===expectedRows&&
        printable(edition.captureFile)&&isAbsolute(edition.captureFile)&&
        (expectedCaptureSha256===undefined||edition.captureSha256===expectedCaptureSha256),
      'DATASETTE_RECEIVING_SOURCE_BINDING');
      savedCapture={...edition.capture,captureFile:edition.captureFile,captureSha256:edition.captureSha256};
      capture={...edition,inspection:'editions.inspect',editionId,editionSha256:expectedEditionSha256};
      captureLocation='retained-edition-capture';
      sourceOperation={schema:'stellar-forge.datasette-received-capture-reference.v1',
        operationId:captureId,captureLocation,editionId,editionSha256:expectedEditionSha256,
        captureFile:edition.captureFile,captureSha256:edition.captureSha256,capture:edition.capture};
    }
    need(edition.captureSha256===savedCapture.captureSha256&&capture.captureSha256===savedCapture.captureSha256&&
      same({columns:edition.columns,rows:edition.rows,cellTypes:edition.cellTypes},
        {columns:capture.columns,rows:capture.rows,cellTypes:capture.cellTypes}),'DATASETTE_RECEIVING_SOURCE_CHANGED');
    await evidence('complete-edition-pages.json',edition);
    await evidence('complete-capture-pages.json',capture);
    await evidence('original-source-operation.json',sourceOperation);
    let files=await inventory(client);
    for(const pin of required)need(files.files.some(file=>fileMatches(file,pin)),'DATASETTE_RECEIVING_REQUIRED_FILE',pin.path);
    if(journal.upload)need(files.files.some(file=>fileMatches(file,journal.upload.retainedFile)),
      'DATASETTE_RECEIVING_REQUIRED_UPLOAD','The original completed upload must travel in the complete native file inventory.');
    for(const [path,pin] of [[savedEdition.editionFile,expectedEditionSha256],[savedCapture.captureFile,savedCapture.captureSha256]]){
      const name=relative(resolve(current.directory),resolve(path));relativePath(name);
      need(files.files.some(file=>file.path===name&&file.sha256===pin),'DATASETTE_RECEIVING_REQUIRED_SOURCE',name);
    }
    const currentInventorySha256=sha(bytes(files));
    let originalInventory=files;
    if(journal.originalFilesSha256) {
      if(journal.originalFilesEvidence||journal.originalFilesSha256!==currentInventorySha256) {
        const originalName=journal.originalFilesEvidence??'complete-original-file-inventory.json';
        const originalBytes=await readPrivate(join(outputDirectory,'observed',relativePath(originalName)));
        const originalPin=journal.evidence[originalName];
        need(originalPin&&originalPin.bytes===originalBytes.length&&originalPin.sha256===sha(originalBytes),
          'DATASETTE_RECEIVING_EVIDENCE_CHANGED');
        originalInventory=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(originalBytes));
        need(sha(bytes(originalInventory))===journal.originalFilesSha256,'DATASETTE_RECEIVING_EVIDENCE_CHANGED');
      }
      // Restoring the same complete source files gives them receiving-host mtimes.
      // Keep every native file identity and the original full observation; compare
      // content across restores, then compare the full fresh snapshot during this run.
      if(!same(contentInventory(originalInventory),contentInventory(files))) {
        await evidence('changed-native-file-inventory.json',files);
        throw Object.assign(new Error('The original retained native file content or membership changed.'),
          {code:'DATASETTE_RECEIVING_FILES_CHANGED',details:inventoryDifference(originalInventory,files)});
      }
    } else journal.originalFilesSha256=currentInventorySha256;
    if(!journal.originalFilesEvidence) {
      await evidence('complete-initial-file-inventory.json',originalInventory);
      journal.originalFilesEvidence='complete-initial-file-inventory.json';
    }
    const originalContentSha256=sha(bytes(contentInventory(originalInventory)));
    if(journal.originalContentFilesSha256)
      need(journal.originalContentFilesSha256===originalContentSha256,'DATASETTE_RECEIVING_EVIDENCE_CHANGED');
    journal.originalContentFilesSha256=originalContentSha256;
    const originalModifiedAt=new Map(originalInventory.files.map(file=>[file.path,file.modifiedAt]));
    journal.currentFilesObservation={sha256:currentInventorySha256,files:files.files.length,
      restoredModificationTimes:files.files.filter(file=>originalModifiedAt.get(file.path)!==file.modifiedAt).length};
    await save();
    await evidence('complete-original-file-inventory.json',files);
    const sample=[...files.files].sort((a,b)=>Number(b.bytes)-Number(a.bytes))[0];
    need(sample&&Number(sample.bytes)>1,'DATASETTE_RECEIVING_COMPLETE_FILE_REQUIRED');
    const inspected=(await client.file({path:sample.path,sha256:sample.sha256})).native;
    need(fileMatches(inspected,sample),'DATASETTE_RECEIVING_FILE_CHANGED');
    // Exercise real retained-handle release without changing the original file.
    const partial=await client.fileRead({path:sample.path,expectedSha256:sample.sha256,offset:0,limit:1},{timeoutMs:300000});
    need(partial.offset===0&&partial.bytesRead===1&&partial.nextOffset===1&&partial.file.sha256===sample.sha256,
      'DATASETTE_RECEIVING_CHUNK');
    await client.fileRelease({readId:partial.readId});
    journal.partialRead={path:sample.path,sha256:sample.sha256,offset:partial.offset,bytes:partial.bytesRead,
      readId:partial.readId,released:true};await save();
    if(journal.receiving){
      const retained=await client.exportManifest({exportId:journal.receiving.exportId});
      need(same(retained.manifestFile,journal.receiving.manifestFile),'DATASETTE_RECEIVING_EXPORT_CHANGED');
    }else{
      journal.receiving=await client.exportPrepare({workspaceId:expectedWorkspaceId},{timeoutMs:300000});await save();
    }
    const receiving=journal.receiving;
    need(receiving.originalFiles===files.files.length,'DATASETTE_RECEIVING_COMPLETE_INVENTORY');
    const exported=[];let offset=0,total;
    for(;;){
      const page=await client.exportInventory({exportId:receiving.exportId,offset,limit:200});
      need(page.exportId===receiving.exportId&&page.manifestSha256===receiving.manifestFile.sha256,'DATASETTE_RECEIVING_EXPORT_CHANGED');
      pageShape(page.page,offset,total,page.files.length);total=page.page.total;exported.push(...page.files);
      if(page.page.next===null)break;offset=page.page.next;
    }
    need(exported.length===files.files.length+1&&exported.some(file=>file.name==='native-manifest.json'),'DATASETTE_RECEIVING_COMPLETE_INVENTORY');
    for(const file of files.files)need(exported.some(member=>member.name==='files/'+file.path&&member.sha256===file.sha256&&member.bytes===Number(file.bytes)),
      'DATASETTE_RECEIVING_EXPORT_CHANGED');
    await evidence('complete-receiving-inventory.json',exported);
    const exportChunk=await client.exportFile({exportId:receiving.exportId,file:'files/'+sample.path,
      expectedManifestSha256:receiving.manifestFile.sha256,expectedSha256:sample.sha256,offset:0,limit:1},{timeoutMs:300000});
    need(exportChunk.bytesRead===1&&exportChunk.nextOffset===1&&exportChunk.file.sha256===sample.sha256,'DATASETTE_RECEIVING_CHUNK');
    await client.exportFileRelease({exportId:receiving.exportId,readId:exportChunk.readId});
    if(!journal.downloadInterruption) {
      const controller=new AbortController();
      try {
        await client.downloadExport({exportId:receiving.exportId,directory:join(outputDirectory,'received'),
          expectedManifestSha256:receiving.manifestFile.sha256,chunkSize:32768,signal:controller.signal,
          async onProgress(progress) {
            if(progress.bytes>0&&progress.bytes<progress.total&&!journal.downloadInterruption) {
              journal.downloadInterruption={...progress,recordedAt:new Date().toISOString(),
                boundary:'original-downloader-fsynced-prefix-and-checkpoint'};
              await save();
              controller.abort(Object.assign(new Error('The original receiving programme interrupted its checkpointed transfer.'),
                {code:'DATASETTE_RECEIVING_CONTROLLED_DOWNLOAD_STOP'}));
            }
          }});
        need(false,'DATASETTE_RECEIVING_PARTIAL_DOWNLOAD_REQUIRED',
          'The original workspace archive must exercise an actual incomplete download prefix.');
      } catch(error) {
        need(controller.signal.aborted&&journal.downloadInterruption,
          'DATASETTE_RECEIVING_PARTIAL_DOWNLOAD_FAILED',error.message);
        journal.downloadInterruption.error=errorRecord(error);await save();
      }
    }
    need(journal.downloadInterruption.bytes>0&&
      journal.downloadInterruption.bytes<journal.downloadInterruption.total,
    'DATASETTE_RECEIVING_PARTIAL_DOWNLOAD_REQUIRED');
    await evidence('interrupted-download-prefix.json',journal.downloadInterruption);
    await closeOwner();
    // Reopen the same merchant endpoint after an actual incomplete transfer. Its
    // original downloader rehashes the durable prefix and resumes the same file.
    client=await openOwner();
    const reconnect=await client.reconnect({workspaceId:expectedWorkspaceId},{timeoutMs:300000});
    need(same(reconnect.status,current)&&same(ownerIdentity(reconnect.native),ownerAtStart),'DATASETTE_RECEIVING_OWNER_CHANGED');
    await evidence('same-owner-reconnect.json',reconnect);
    const manifest=await client.exportManifest({exportId:receiving.exportId});
    need(same(manifest.manifestFile,receiving.manifestFile),'DATASETTE_RECEIVING_EXPORT_CHANGED');
    journal.download=await client.downloadExport({exportId:receiving.exportId,directory:join(outputDirectory,'received'),
      expectedManifestSha256:receiving.manifestFile.sha256});
    need(journal.download.state==='COMPLETE'&&journal.download.resumed===true&&
      journal.download.resumedBytes>=journal.downloadInterruption.bytes&&
      journal.download.files===files.files.length+1,'DATASETTE_RECEIVING_DOWNLOAD_RESUME');
    await evidence('first-complete-download.json',journal.download);
    journal.resumedDownload=await client.downloadExport({exportId:receiving.exportId,directory:join(outputDirectory,'received'),
      expectedManifestSha256:receiving.manifestFile.sha256});
    need(journal.resumedDownload.state==='COMPLETE'&&journal.resumedDownload.resumed===true&&
      journal.resumedDownload.resumedBytes===journal.download.bytes,'DATASETTE_RECEIVING_DOWNLOAD_RESUME');
    await evidence('same-manifest-download-resume.json',journal.resumedDownload);
    files=await inventory(client);
    need(sha(bytes(files))===currentInventorySha256,'DATASETTE_RECEIVING_FILES_CHANGED');
    const after=(await client.status({})).native,healthAfter=(await client.health({})).native;
    need(same(after,current)&&same(ownerIdentity(healthAfter),ownerAtStart),'DATASETTE_RECEIVING_OWNER_CHANGED');
    await evidence('native-status-after.json',after);
    await closeOwner();
    journal.offline=await clientModule.reopenDatasetteExport({directory:join(outputDirectory,'received'),
      exportId:receiving.exportId,expectedManifestSha256:receiving.manifestFile.sha256});
    need(journal.offline.state==='REOPENED'&&journal.offline.files===journal.download.files,'DATASETTE_RECEIVING_COLD_REOPEN');
    for(const file of files.files){
      const received=await identity(join(outputDirectory,'received','files',file.path));
      need(received.sha256===file.sha256&&received.bytes===Number(file.bytes),'DATASETTE_RECEIVING_FILE_CHANGED',file.path);
    }
    await evidence('offline-complete-file-reopen.json',journal.offline);
    const invoked=[...new Set(journal.calls.filter(call=>call.state==='RETURNED').map(call=>call.tool))].sort();
    need(same(invoked,[...requiredToolNames].sort()),'DATASETTE_RECEIVING_TOOL_COVERAGE');
    journal.result={workspaceId:expectedWorkspaceId,editionId,editionSha256:expectedEditionSha256,
      captureId,captureLocation,captureSha256:savedCapture.captureSha256,rows:edition.rows.length,columns:edition.columns,
      sourceValuesPreserved:true,originalFiles:files.files.length,downloadFiles:journal.download.files,
      receivedBytes:journal.download.bytes,workspaceArchive:required[0],
      interruptedDownload:journal.downloadInterruption,resumedPrefixBytes:journal.download.resumedBytes,
      advertisedToolNames:[...TOOL_NAMES],invokedToolNames:invoked,nativeOperations:nativeNames,originalUpload:journal.upload??null,
      originalOwnerUnchanged:true,nativeOwnerClosed:false,
      classification:'Original retained-source, publisher and customer files received through the same 17-tool interface; '+
        (originalUpload?'the same completed upload was read and zero-byte replayed. ':'no upload was requested. ')+
        'No capture, review, publication or provider/payment request was submitted.',
    };
    need(journal.attachments.filter(item=>item.closed).length>=2,'DATASETTE_RECEIVING_CLOSE');
    journal.state='COMPLETE';journal.completedAt=new Date().toISOString();await save();
    return {state:'COMPLETE',passed:true,report:journalPath,workspaceId:expectedWorkspaceId,
      exportId:receiving.exportId,manifestSha256:receiving.manifestFile.sha256,result:journal.result};
  }catch(error){
    primaryError=error;
    if(journal){journal.state='STOPPED';journal.error=errorRecord(error);await save().catch(saveError=>{error.journalError=errorRecord(saveError);});}
    throw error;
  }finally{
    const errors=[];
    try{await closeOwner();}catch(error){errors.push(error);}
    try{await lease.close();}catch(error){errors.push(error);}
    if(errors.length){if(primaryError)primaryError.closeErrors=errors.map(errorRecord);else throw new AggregateError(errors,'Datasette receiving did not close all of its own resources.');}
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const args=process.argv.slice(2);
    need(args.length===2&&args[0]==='--input'&&isAbsolute(args[1]),'DATASETTE_RECEIVING_INPUT','Use --input ABS_PRIVATE_JSON.');
    const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPrivate(args[1],1024*1024)));
    process.stdout.write(JSON.stringify(await runDatasetteMcpReceiving(input))+'\n');
  }catch(error){process.stderr.write(JSON.stringify(errorRecord(error))+'\n');process.exitCode=1;}
}
