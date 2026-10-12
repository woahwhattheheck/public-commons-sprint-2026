#!/usr/bin/env node
// MIT. Complete SDK/MCP receiving against an existing original GridFabric workspace.
import fs from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {acquireStateLease} from '../../../merchant-fleet-gateway/state-lease.mjs';
import {openGridFabricWorkspace} from '../operator.mjs';
import {startGridFabricServer} from '../server.mjs';
import {connectGridFabricOperator} from './http-client.mjs';
import {downloadGridFabricFile,downloadGridFabricMerchantFile,reopenGridFabricDownload} from './download.mjs';
import {GRIDFABRIC_TABLES,GRIDFABRIC_HOST_TABLES,GRIDFABRIC_CONNECTION_SCHEMA,UUID,SHA256,plain,need,exact} from './contract.mjs';
import {MerchantGridFabricWorkspaces,readGridFabricWorkspaceConfiguration} from '../mcp/workspace.mjs';
import {gridFabricMerchantTools} from '../mcp/catalog.mjs';

const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function privateDirectory(path) {
  fs.mkdirSync(path,{recursive:true,mode:0o700});const info=fs.lstatSync(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0&&fs.realpathSync(path)===path,
    'GRIDFABRIC_RECEIVING_DIRECTORY','Use an ordinary private receiving directory.');
}
function read(path) {
  const info=fs.lstatSync(path);
  need(info.isFile()&&!info.isSymbolicLink()&&(info.mode&0o077)===0&&fs.realpathSync(path)===path,
    'GRIDFABRIC_RECEIVING_FILE','Use the original complete private receiving file.');
  return fs.readFileSync(path);
}
function atomic(path,value) {
  const temporary=path+'.'+randomUUID()+'.partial',bytes=json(value);let fd;
  try {
    fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.renameSync(temporary,path);const parent=fs.openSync(dirname(path),'r');
    try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function originalInput(configuration) {
  const file=resolve(configuration),value=JSON.parse(read(file));
  exact(value,['schema','operation_id','connectionFile','workspace','workspaceId','sourceSha256','outputDirectory',
    'exportRequestId','restoreRequestId','restoredName','minimumCollections'],
    ['schema','operation_id','connectionFile','workspace','workspaceId','sourceSha256','outputDirectory',
      'exportRequestId','restoreRequestId','restoredName']);
  need(value.schema==='commons.gridfabric-sdk-receiving-input.v1'&&typeof value.operation_id==='string'&&value.operation_id&&
    UUID.test(value.exportRequestId)&&UUID.test(value.restoreRequestId)&&value.exportRequestId!==value.restoreRequestId&&
    SHA256.test(value.sourceSha256)&&typeof value.workspaceId==='string'&&value.workspaceId&&
    typeof value.restoredName==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(value.restoredName)&&
    !['.','..'].includes(value.restoredName),'GRIDFABRIC_RECEIVING_INPUT','Retain the original operation, workspace, source, request IDs and sibling.');
  for(const key of ['connectionFile','workspace','outputDirectory']) {
    need(typeof value[key]==='string'&&value[key]&&!/[\0\r\n]/.test(value[key]),'GRIDFABRIC_RECEIVING_INPUT','Declare the original '+key+'.');
    value[key]=resolve(dirname(file),value[key]);
  }
  need(value.outputDirectory!==value.workspace&&!value.outputDirectory.startsWith(value.workspace+'/')&&
    value.restoredName!==basename(value.workspace),'GRIDFABRIC_RECEIVING_INPUT','Keep receiving output and the restored sibling separate from the original workspace.');
  if(value.minimumCollections!==undefined) {
    need(plain(value.minimumCollections),'GRIDFABRIC_RECEIVING_INPUT','Use original collection minimums.');
    for(const [table,count]of Object.entries(value.minimumCollections))need(GRIDFABRIC_TABLES.includes(table)&&
      Number.isSafeInteger(count)&&count>=0,'GRIDFABRIC_RECEIVING_INPUT','Select a native table and nonnegative original count.');
  }
  return {file,value,digest:sha(json(value))};
}
function errorView(error) {
  return {name:error.name,code:error.code,message:error.message,
    ...(error.details?{details:error.details}:{}),...(error.request_id?{request_id:error.request_id}:{}),
    ...(error.recovery?{recovery:error.recovery}:{}),...(error.uncertain?{uncertain:true}:{})};
}
function checkCounts(state,minimums={}) {
  for(const [table,count]of Object.entries(minimums))
    need(state.collections[table]>=count,'GRIDFABRIC_RECEIVING_INPUT','Use the complete original populated '+table+' collection.');
}
const asJson=value=>JSON.parse(JSON.stringify(value));

/**
 * Borrow the caller's live original application, receive its complete atomic native archive,
 * exercise the same original cold operator through SDK/MCP, then close the cold owner.
 * The caller retains its live application lifecycle throughout.
 */
export async function runGridFabricSdkReceiving({configuration}={}) {
  const input=originalInput(configuration),config=input.value,root=config.outputDirectory;
  privateDirectory(root);const lease=await acquireStateLease(root),recordPath=join(root,'receiving.json');
  let record,primary,coldWorkspace,coldServer,coldClient,merchant;
  const save=()=>{lease.assertHeld();atomic(recordPath,record);};
  const phase=(name,value={})=>{
    record.phases.push({name,at:new Date().toISOString(),...value});save();
    console.log(JSON.stringify({operation_id:config.operation_id,phase:name,...value}));
  };
  const closeCold=async()=>{
    const failures=[];
    if(coldServer) {
      try{await coldServer.close();coldServer=null;}
      catch(error){failures.push({owner:'http_listener',error});}
    }
    if(coldWorkspace) {
      try{await coldWorkspace.close();coldWorkspace=null;}
      catch(error){failures.push({owner:'sqlite_workspace',error});}
    }
    if(failures.length)throw Object.assign(
      new AggregateError(failures.map(item=>item.error),'The original cold operator did not close completely.'),
      {code:'GRIDFABRIC_RECEIVING_CLOSE',details:{close_errors:failures.map(({owner,error})=>({owner,...errorView(error)}))}});
  };
  try {
    const candidate=fs.existsSync(recordPath)?JSON.parse(read(recordPath)):{
      schema:'commons.gridfabric-sdk-receiving.v1',state:'RUNNING',operation_id:config.operation_id,
      configuration_sha256:input.digest,phases:[],created_at:new Date().toISOString()
    };
    need(plain(candidate)&&candidate.schema==='commons.gridfabric-sdk-receiving.v1'&&
      ['RUNNING','FAILED','COMPLETE'].includes(candidate.state)&&Array.isArray(candidate.phases)&&
      candidate.operation_id===config.operation_id&&candidate.configuration_sha256===input.digest,
      'GRIDFABRIC_RECEIVING_CONFLICT','Continue this original receiving operation and its retained configuration.');
    record=candidate;
    if(record.state==='COMPLETE') {
      await reopenGridFabricDownload({directory:join(root,'portable'),expectedManifestSha256:record.portable.manifest_sha256,
        expectedWorkspaceId:config.workspaceId,expectedFileId:'export_'+config.exportRequestId});
      return {...record,reused:true,receiving_record:recordPath};
    }
    record.state='RUNNING';delete record.error;save();
    primary=await connectGridFabricOperator({connectionFile:config.connectionFile,expectedWorkspaceId:config.workspaceId,
      expectedWorkspace:config.workspace,expectedSourceSha256:config.sourceSha256});
    const live=await primary.state();checkCounts(live,config.minimumCollections);
    record.workspace={workspace_id:config.workspaceId,directory:config.workspace,source_sha256:config.sourceSha256};
    if(record.revision===undefined){record.revision=live.revision;save();}
    const exported=await primary.callRaw('export',{request_id:config.exportRequestId,expected_revision:record.revision});
    need(exported.value.status==='READY'&&exported.value.export_id===config.exportRequestId&&
      exported.value.workspace_id===config.workspaceId&&exported.value.revision===record.revision&&
      SHA256.test(exported.value.sha256)&&Number.isSafeInteger(exported.value.bytes),
      'GRIDFABRIC_RECEIVING_EXPORT','Retain the complete original selected native export.');
    record.native_export=exported;phase('original_atomic_export_ready',{revision:record.revision,bytes:exported.value.bytes,sha256:exported.value.sha256});
    const portable=await downloadGridFabricFile({client:primary,fileId:'export_'+config.exportRequestId,
      directory:join(root,'portable'),expectedSha256:exported.value.sha256,chunkSize:196608});
    record.portable={export_id:config.exportRequestId,sha256:portable.originalFile.sha256,bytes:portable.originalFile.bytes,
      path:portable.originalFile.path,manifest_sha256:portable.manifestSha256};phase('complete_portable_received',record.portable);
    const received=await primary.receiveArchive({file:record.portable.path,expectedBytes:record.portable.bytes,
      expectedSha256:record.portable.sha256,name:config.restoredName,requestId:config.restoreRequestId});
    const destination=join(dirname(config.workspace),config.restoredName);
    need(received.value?.schema==='stellar-forge.gridfabric-restore.v1'&&received.value.status==='RESTORED'&&
      received.value.directory===destination&&received.value.workspace_id===config.workspaceId&&
      received.value.revision===record.revision&&received.value.source?.sha256===record.portable.sha256,
      'GRIDFABRIC_RECEIVING_RESTORE','The native receiving result must preserve the original archive, revision and sibling.');
    record.native_restore=received;
    record.restored={directory:destination,workspace_id:config.workspaceId,revision:record.revision};
    phase('original_sibling_restored',record.restored);
    const attempt=randomUUID(),connectionFile=join(root,'cold-'+attempt+'.url');
    const startCold=async()=>{
      coldWorkspace=await openGridFabricWorkspace({directory:destination,create:false});
      assert.equal(coldWorkspace.workspace_id,config.workspaceId);
      assert.equal(coldWorkspace.state().revision,record.revision);
      coldServer=await startGridFabricServer({workspace:coldWorkspace,connectionFile});
      assert.equal(coldServer.source.sha256,config.sourceSha256);
    };
    await startCold();
    coldClient=await connectGridFabricOperator({connectionFile,expectedWorkspaceId:config.workspaceId,
      expectedWorkspace:destination,expectedSourceSha256:config.sourceSha256});
    const coldState=await coldClient.state();checkCounts(coldState,config.minimumCollections);
    assert.deepEqual(asJson(coldState),asJson(coldWorkspace.state()));
    record.collections=coldState.collections;
    record.table_reads={};let sourceFile;
    for(const table of [...GRIDFABRIC_TABLES,...GRIDFABRIC_HOST_TABLES]) {
      const host=GRIDFABRIC_HOST_TABLES.includes(table),hash=createHash('sha256');let rows=0,pages=0;
      for await(const page of coldClient.pages(table,{host,limit:1000})) {
        const native=host?coldWorkspace.hostPage(table,{offset:page.offset,limit:page.limit}):
          coldWorkspace.page(table,{offset:page.offset,limit:page.limit});
        assert.deepEqual(page,asJson(native));pages++;
        for(const row of page.rows) {
          hash.update(JSON.stringify(row)+'\n');rows++;
          if(table==='host_files'&&!sourceFile&&typeof row.name==='string'&&row.name&&
            !/[\0\r\n\\/]/.test(row.name)&&!['.','..'].includes(row.name))sourceFile=row;
        }
      }
      record.table_reads[table]={rows,pages,sha256:hash.digest('hex')};
    }
    need(sourceFile&&SHA256.test(sourceFile.sha256),'GRIDFABRIC_RECEIVING_INPUT','Use the populated original workspace and its registered source files.');
    phase('all_original_native_pages_received',{collections:Object.keys(record.table_reads).length,
      rows:Object.values(record.table_reads).reduce((sum,item)=>sum+item.rows,0)});
    record.original_files=[];
    for(const original of coldWorkspace.files.identities()) {
      const id='file_'+original.sha256,info=await coldClient.fileInfo(id),hash=createHash('sha256');
      assert.equal(info.bytes,original.bytes);assert.equal(info.sha256,original.sha256);
      let offset=0,ranges=0;
      do {
        const bytes=await coldClient.readFile(id,{offset,limit:196608,expectedSha256:info.sha256});
        hash.update(bytes);offset+=bytes.length;ranges++;
        need(bytes.length>0||offset===info.bytes,'GRIDFABRIC_RECEIVING_FILE','Continue every original file range to its complete length.');
      }while(offset<info.bytes);
      assert.equal(offset,info.bytes);assert.equal(hash.digest('hex'),info.sha256);
      assert.equal((await coldClient.readFile(id,{offset:info.bytes,limit:196608,expectedSha256:info.sha256})).length,0);
      record.original_files.push({file_id:id,name:info.name,bytes:info.bytes,sha256:info.sha256,ranges});
    }
    phase('all_original_files_received',{files:record.original_files.length,
      bytes:record.original_files.reduce((sum,item)=>sum+item.bytes,0)});
    const connectionConfig=join(root,'merchant-workspaces-'+attempt+'.json');
    const selected={
      schema:GRIDFABRIC_CONNECTION_SCHEMA,workspaces:{
        original:{label:'Original live GridFabric workspace',connectionFile:config.connectionFile,
          workspaceId:config.workspaceId,workspace:config.workspace,sourceSha256:config.sourceSha256,
          files:{portable:{path:record.portable.path,name:basename(record.portable.path),kind:'archive',
            bytes:record.portable.bytes,sha256:record.portable.sha256}},
          receivingSiblings:{received:{name:config.restoredName}}},
        snapshot:{label:'Original received GridFabric snapshot',connectionFile,workspaceId:config.workspaceId,
          workspace:destination,sourceSha256:config.sourceSha256,
          files:{original:{path:coldWorkspace.files.filePath(sourceFile.sha256),name:sourceFile.name,kind:'source',
            bytes:sourceFile.bytes,sha256:sourceFile.sha256,mimeType:sourceFile.mime_type}}}
      }
    };
    atomic(connectionConfig,selected);
    merchant=new MerchantGridFabricWorkspaces({gridFabricWorkspaces:await readGridFabricWorkspaceConfiguration(connectionConfig)});
    const toolList=gridFabricMerchantTools((name,description,properties,required,annotations)=>
      ({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations}));
    need(toolList.length===38&&new Set(toolList.map(item=>item.name)).size===38,
      'GRIDFABRIC_RECEIVING_CATALOG','Retain the complete original 38-tool interface.');
    for(const table of [...GRIDFABRIC_TABLES,...GRIDFABRIC_HOST_TABLES]) {
      const host=GRIDFABRIC_HOST_TABLES.includes(table);let offset=0,rows=0;const hash=createHash('sha256');
      while(true) {
        const reply=await merchant.call(host?'merchant_gridfabric_host_page':'merchant_gridfabric_page',
          {workspace:'snapshot',collection:table,offset,limit:1000});
        assert.equal(JSON.parse(reply.raw_text).collection,table);
        const original=host?coldWorkspace.hostPage(table,{offset,limit:1000}):coldWorkspace.page(table,{offset,limit:1000});
        assert.deepEqual(reply.native,asJson(original));
        for(const row of reply.native.rows){rows++;hash.update(JSON.stringify(row)+'\n');}
        if(reply.native.next_offset===null)break;offset=reply.native.next_offset;
      }
      assert.equal(rows,record.table_reads[table].rows);
      assert.equal(hash.digest('hex'),record.table_reads[table].sha256);
    }
    const contracts=await merchant.call('merchant_gridfabric_contracts',{workspace:'snapshot'});
    assert.deepEqual(contracts.native,(await coldClient.contracts()));
    const source=await merchant.call('merchant_gridfabric_source',{workspace:'snapshot'});
    assert.equal(source.native.sha256,config.sourceSha256);
    let originalError;
    try{await merchant.call('merchant_gridfabric_detail',{workspace:'snapshot',collection:'instances',id:'missing-'+randomUUID()});}
    catch(error){originalError=error;}
    need(originalError?.details?.native_error?.code==='RECORD_NOT_FOUND'&&
      originalError.details.http_status===404&&typeof originalError.details.raw_text==='string',
      'GRIDFABRIC_RECEIVING_ERROR','The MCP interface must preserve the complete original native error.');
    const mcpFile=await downloadGridFabricMerchantFile({fileClient:{
      endpoint:'gridfabric-merchant:'+JSON.stringify([config.workspaceId,destination]),
      call:(name,args)=>merchant.call(name,args)},workspace:'snapshot',fileId:'file_'+sourceFile.sha256,
      directory:join(root,'mcp-source'),expectedSha256:sourceFile.sha256,chunkSize:196608});
    assert.equal(mcpFile.originalFile.sha256,sourceFile.sha256);
    const uploaded=await merchant.call('merchant_gridfabric_upload',{workspace:'snapshot',file:'original',
      expectedBytes:sourceFile.bytes,expectedSha256:sourceFile.sha256});
    assert.equal(uploaded.native.sha256,sourceFile.sha256);assert.equal(uploaded.native.bytes,sourceFile.bytes);
    const repeatedRestore=await merchant.call('merchant_gridfabric_receive',{workspace:'original',file:'portable',
      destination:'received',request_id:config.restoreRequestId,expectedBytes:record.portable.bytes,expectedSha256:record.portable.sha256});
    assert.equal(repeatedRestore.native.directory,destination);assert.equal(repeatedRestore.native.source.sha256,record.portable.sha256);
    assert.equal(repeatedRestore.native.status,'RESTORED');assert.equal(repeatedRestore.native.current.matches_snapshot,true);
    record.mcp={tool_count:toolList.length,collections:Object.keys(record.table_reads).length,
      original_error:errorView(originalError),source_download:{path:mcpFile.originalFile.path,
        bytes:mcpFile.originalFile.bytes,sha256:mcpFile.originalFile.sha256},streamed_source_sha256:uploaded.native.sha256,
      restored_request_id:config.restoreRequestId};
    phase('complete_mcp_native_workflow_received',{tools:toolList.length,collections:record.mcp.collections});
    const firstOrigin=coldClient.identity.origin;
    await closeCold();assert.equal(fs.existsSync(connectionFile),false);
    await startCold();await coldClient.reopen();
    const reopened=await merchant.call('merchant_gridfabric_reopen',{workspace:'snapshot'});
    assert.equal(reopened.native.workspace_id,config.workspaceId);assert.equal(reopened.native.revision,record.revision);
    assert.deepEqual(reopened.native.collections,record.collections);
    assert.equal((await coldClient.state()).revision,record.revision);
    record.restarted={sdk:true,mcp:true,previous_origin:firstOrigin,current_origin:coldClient.identity.origin};
    await merchant.close();merchant=null;await coldClient.close();coldClient=null;
    await closeCold();assert.equal(fs.existsSync(connectionFile),false);
    await primary.close();primary=null;
    record.cold_operator_closed=true;record.state='COMPLETE';record.completed_at=new Date().toISOString();
    record.receiving_directory=root;record.receiving_record=recordPath;save();
    console.log(JSON.stringify({schema:record.schema,state:record.state,operation_id:record.operation_id,
      workspace:record.workspace,revision:record.revision,collections:record.collections,
      original_files:record.original_files.length,mcp_tools:record.mcp.tool_count,receiving_record:recordPath}));
    return record;
  }catch(error) {
    if(record&&record.state!=='COMPLETE'){record.state='FAILED';record.error=errorView(error);save();}
    throw error;
  }finally {
    try{await merchant?.close();}finally{
      try{await coldClient?.close();}finally{
        try{await closeCold();}finally{
          try{await primary?.close();}finally{await lease.close();}
        }
      }
    }
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==4||process.argv[2]!=='--configuration')
    throw new Error('Usage: node sdk/receiving.mjs --configuration /absolute/private-receiving.json');
  await runGridFabricSdkReceiving({configuration:process.argv[3]});
}
