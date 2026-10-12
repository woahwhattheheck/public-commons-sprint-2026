#!/usr/bin/env node
// MIT. One retained native receiving operation through the original HTTP and MCP hosts.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startDspaceOperator} from '../server.mjs';
import {openDspaceWorkspace,receiveDspaceWorkspace} from '../workspace.mjs';
import {connectDspaceOperator,inspectDspaceInput,DspaceClientError} from '../client.mjs';
import {receiveDspaceMerchantFile} from '../merchant-provider.mjs';
import {acquireDatasetLease} from '../../dataset-refresh/writer-lease.mjs';
import {initializeDspaceOperatorMerchant,readMerchantConfig} from '../../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import {MCP_VERSION} from '../../../../../stellar-forge/mcp-paid-agent/http-tools.mjs';

const MODULE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ROOT=path.resolve(MODULE,'../../../..');
const PREFIX='f47a-dspace-agent-20261012';
const ACTOR='Repository receiving instructor';
const PUBLICATION='0157eef4-2dc8-4ddd-8124-94cdabc15f6e';
const PERSON='1b19bcc0-4f83-446d-95b7-ec0c806d1578';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const fail=(code,message,details={})=>Object.assign(new Error(message),{code,...details});
function assert(value,message,details){if(!value)throw fail('NATIVE_RECEIVING_ASSERTION',message,details);}
async function exists(file){try{await fsp.access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function privateDir(directory){await fsp.mkdir(directory,{recursive:true,mode:0o700});await fsp.chmod(directory,0o700);}
async function save(file,value){const temp=file+'.'+randomUUID()+'.tmp';const handle=await fsp.open(temp,'wx',0o600);
  try{await handle.writeFile(json(value));await handle.sync();}finally{await handle.close();}
  await fsp.rename(temp,file);
}
function argumentsFor(argv){
  const options={};
  for(let i=0;i<argv.length;i+=2){if(!['--directory','--project-file'].includes(argv[i])||!argv[i+1])throw fail('NATIVE_ARGUMENT','Use --directory PRIVATE_RECEIVING --project-file ORIGINAL_PROJECT.sqlite3.');
    options[argv[i].slice(2)]=path.resolve(argv[i+1]);}
  if(!options.directory||!options['project-file'])throw fail('NATIVE_ARGUMENT','The retained receiving directory and original complete project are required.');
  return options;
}
class OriginalMerchantStdio {
  constructor({configuration,directory,token}){
    this.configuration=configuration;this.directory=directory;this.token=token;this.pending=new Map();this.sequence=0;this.receipts=[];
  }
  async start(){
    const entry=path.join(ROOT,'stellar-forge/mcp-merchant-operator/stdio.mjs');
    this.child=spawn(process.execPath,[entry,'--config',this.configuration],{cwd:ROOT,env:process.env,stdio:['pipe','pipe','pipe']});
    this.stderr=fs.createWriteStream(path.join(this.directory,'merchant-stderr.log'),{flags:'a',mode:0o600});
    this.child.stderr.pipe(this.stderr,{end:false});
    this.lines=createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{
      try{
        assert(!line.includes(this.token),'The private original operator credential appeared in an MCP response.');
        const reply=JSON.parse(line),pending=this.pending.get(String(reply.id));
        if(!pending)return;
        clearTimeout(pending.timer);this.pending.delete(String(reply.id));
        if(reply.error)pending.reject(fail('NATIVE_MCP_RPC',reply.error.message,{response:reply.error}));
        else pending.resolve(reply.result);
      }catch(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
    });
    this.exit=new Promise((resolve,reject)=>{
      this.child.once('error',reject);
      this.child.once('close',(code,signal)=>{
        for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(fail('NATIVE_MCP_EXIT','The original MCP process exited before its reply.',{code,signal}));}
        this.pending.clear();this.stderr.end();resolve({code,signal});
      });
    });
    const initialized=await this.request('initialize',{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:'dspace-native-receiving',version:'1.0.0'}});
    assert(initialized.protocolVersion===MCP_VERSION,'The original MCP version was not negotiated.');
    this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    this.catalog=await this.request('tools/list',{});
    return this;
  }
  request(method,params){
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(String(id));reject(fail('NATIVE_MCP_REPLY_TIMEOUT','Retain the original operation and inspect it before continuing.',{method}));},120000);
      this.pending.set(String(id),{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(String(id));reject(error);}});
    });
  }
  async call(name,args){
    const result=await this.request('tools/call',{name,arguments:args});
    let value=result.structuredContent;
    if(value===undefined){const text=result.content?.find(c=>c.type==='text')?.text;value=text===undefined?null:JSON.parse(text);}
    this.receipts.push({tool:name,isError:Boolean(result.isError),code:result.isError?value?.code:null});
    if(result.isError)throw fail(value?.code??'NATIVE_MCP_TOOL',value?.reason??'The original MCP tool returned an error.',{response:value});
    return value;
  }
  async close(){
    if(this.closing)return this.closing;
    this.closing=(async()=>{if(this.child.exitCode===null&&!this.child.killed)this.child.stdin.end();const result=await this.exit;
      assert(result.code===0,'The original merchant host did not close cleanly.',result);return result;})();
    return this.closing;
  }
}

export async function runDspaceAgentReceiving({directory,projectFile}){
  directory=path.resolve(directory);await privateDir(directory);
  const lease=acquireDatasetLease(directory);
  const journalFile=path.join(directory,'journal.json'),resultFile=path.join(directory,'RESULT.json');
  let journal=await exists(journalFile)?JSON.parse(await fsp.readFile(journalFile,'utf8')):{
    schema:'stellar-forge.dspace-agent-receiving.v1',operationPrefix:PREFIX,createdAt:new Date().toISOString(),phases:{},requests:{},sourceRevisions:[]};
  assert(journal.schema==='stellar-forge.dspace-agent-receiving.v1'&&journal.operationPrefix===PREFIX,'Use the same retained native operation directory.');
  let saving=Promise.resolve();
  const persist=()=>{const value=structuredClone(journal);const pending=saving.then(()=>save(journalFile,value));saving=pending.catch(()=>{});return pending;};
  const phase=async(name,fn)=>{
    lease.assertHeld();
    const previous=journal.phases[name];
    if(previous?.state==='complete'){process.stdout.write(json({phase:name,state:'reused'}));return previous.result;}
    journal.phases[name]={state:'running',startedAt:previous?.startedAt??new Date().toISOString(),attempts:(previous?.attempts??0)+1,errors:previous?.errors??[]};await persist();
    try{const result=await fn();Object.assign(journal.phases[name],{state:'complete',completedAt:new Date().toISOString(),result});await persist();
      process.stdout.write(json({phase:name,state:'complete'}));return result;}
    catch(error){journal.phases[name].state='interrupted';journal.phases[name].errors.push({at:new Date().toISOString(),code:error.code??error.name,message:error.message});await persist();throw error;}
  };
  const sourceFiles=['client.mjs','client.d.mts','merchant-provider.mjs','server.mjs','launch.mjs','workspace.mjs','source.mjs','native/agent-consumer.mjs'];
  const sourceIdentity=[];
  for(const name of sourceFiles){const file=path.join(MODULE,name),identity=await inspectDspaceInput(file,{maximum:16*1024*1024});sourceIdentity.push({path:name,...identity});}
  journal.sourceRevisions.push({at:new Date().toISOString(),files:sourceIdentity});await persist();
  const originalFile=path.join(directory,'original-project.sqlite3');
  const workspaceDirectory=path.join(directory,'original-workspace');
  const operatorDirectory=path.join(directory,'operator');
  const downloads=path.join(directory,'downloads');
  await privateDir(downloads);
  let host,client,mcp,scope;
  const clients=new Set();
  const startHost=async()=>{
    host=await startDspaceOperator({directory:operatorDirectory,workspaceDirectory,port:0});
    client=await connectDspaceOperator({directory:operatorDirectory});clients.add(client);scope=client.scope;
    if(scope.projectKey!=='original'){const selected=await client.selectProject({scope,key:'original'});scope=selected.scope;}
    if(journal.operatorId)assert(journal.operatorId===scope.operatorId,'The original persistent operator changed.');
    else {journal.operatorId=scope.operatorId;await persist();}
  };
  const current=()=>client.state({scope});
  const openMcp=async(configuration)=>{
    mcp=await new OriginalMerchantStdio({configuration,directory,token:host.token}).start();
    const bound=await mcp.call('merchant_dspace_bind',{operator:'repository'});
    assert(bound.scope.operatorId===scope.operatorId&&bound.scope.instanceId===scope.instanceId&&bound.scope.workspaceId===scope.workspaceId&&bound.scope.projectKey===scope.projectKey,'The MCP host borrowed a different original operator.');
    return bound;
  };
  const request=async(name,make)=>{
    if(!journal.requests[name]){
      const state=await current();
      journal.requests[name]={operationId:PREFIX+'-'+name,expectedRevision:state.revision,actor:ACTOR,...await make()};
      await persist();
    }
    return structuredClone(journal.requests[name]);
  };
  const mutation=async(name,tool,make)=>{
    const input=await request(name,make);
    return mcp.call(tool,{operator:'repository',scope,...input});
  };
  const expectedFailure=async(fn,pattern)=>{
    try{await fn();throw fail('NATIVE_EXPECTED_FAILURE','The original scope check unexpectedly admitted the call.');}
    catch(error){if(error.code==='NATIVE_EXPECTED_FAILURE'||!pattern.test(error.code??''))throw error;return {code:error.code};}
  };
  try{
    const intake=await phase('original-project-receiving',async()=>{
      if(!await exists(originalFile)){
        const identity=await inspectDspaceInput(projectFile,{maximum:256*1024*1024});
        await fsp.copyFile(projectFile,originalFile,fs.constants.COPYFILE_EXCL);await fsp.chmod(originalFile,0o600);
        const copied=await inspectDspaceInput(originalFile,{maximum:256*1024*1024});
        assert(identity.sha256===copied.sha256&&identity.bytes===copied.bytes,'The retained original project copy changed.');
      }
      const identity=await inspectDspaceInput(originalFile,{maximum:256*1024*1024});
      const received=await receiveDspaceWorkspace({file:originalFile,directory:workspaceDirectory});
      try{const state=received.state();return {file:originalFile,...identity,workspaceId:state.id,revision:state.revision};}
      finally{await received.close();}
    });
    await startHost();
    assert(scope.workspaceId===intake.workspaceId,'The running operator differs from the original received workspace.');
    const baseline=await phase('original-source-and-typed-metadata',async()=>{
      const state=await current(),edition=await client.record({scope,kind:'editions',id:state.selected_edition_id,limit:100});
      assert(edition.selection.length===45&&edition.row_count===45,'Use the retained 45-record original repository cohort.');
      const publication=edition.selection.find(i=>i.uuid===PUBLICATION),person=edition.selection.find(i=>i.uuid===PERSON);
      assert(publication&&person,'The original publication and linked Person are absent.');
      const object=await client.item({scope,...publication}),linked=await client.item({scope,...person});
      const authors=object.object.metadata['dc.contributor.author'];
      assert(authors.length===85,'The original publication no longer has its 85 complete author entries.');
      const source=await client.download({scope,kind:'source',id:publication.sourceId,directory:downloads});
      const sourceRecord=await client.record({scope,kind:'sources',id:publication.sourceId,limit:100});
      assert(sourceRecord.total===44,'The retained publication capture differs from its complete collection.');
      return {selection:edition.selection,metadataFields:edition.metadataFields,rights:edition.rights,originalEditionId:edition.id,
        originalSnapshot:edition.snapshot,publication,person,authorSha256:sha(JSON.stringify(authors)),authorCount:authors.length,
        personFields:Object.keys(linked.object.metadata),sourceFile:source,sourceId:publication.sourceId};
    });
    const configuration=path.join(directory,'merchant','merchant-mcp.json'),connection=path.join(directory,'connection.json');
    const inputConfiguration={schema:'stellar-forge.dspace-operator-connection.v1',downloadByteBudget:1024*1024*1024,
      operators:{repository:{label:'Original repository receiving',launchFile:path.join(operatorDirectory,'operator-launch.json'),
        operatorId:scope.operatorId,inputs:{catalog:{kind:'source',file:baseline.sourceFile.path,sha256:baseline.sourceFile.sha256},
          project:{kind:'workspace',file:originalFile,sha256:intake.sha256}}}}};
    await save(connection,inputConfiguration);
    if(!await exists(configuration))await initializeDspaceOperatorMerchant({directory:path.dirname(configuration),connection,name:'Original repository receiving'});
    await readMerchantConfig(configuration);
    await phase('typed-http-original-request-recovery',async()=>{
      const input=await request('import-http',()=>({file:baseline.sourceFile.path,expectedSha256:baseline.sourceFile.sha256}));
      const lost=await connectDspaceOperator({directory:operatorDirectory,fetchImpl:async(url,options)=>{
        const response=await fetch(url,options);
        if(String(url).endsWith('/api/action')&&JSON.parse(options.body).operationId===input.operationId&&!journal.httpLostReply){
          const bytes=Buffer.from(await response.arrayBuffer());assert(response.ok,'The original import failed before the response-loss exercise.');
          journal.httpLostReply={operationId:input.operationId,status:response.status,bytes:bytes.length,sha256:sha(bytes),at:new Date().toISOString()};await persist();
          throw fail('NATIVE_RESPONSE_INTERRUPTED','Original committed HTTP response deliberately interrupted at its receiving boundary.');
        }
        return response;
      }});clients.add(lost);
      let uncertainty=null;
      try{await lost.importSource({...input,scope});}
      catch(error){assert(error instanceof DspaceClientError&&error.uncertain===true&&error.operationId===input.operationId,'The original interrupted import lost its uncertainty identity.');
        uncertainty={code:error.code,operationId:error.operationId,uncertain:error.uncertain};}
      const committed=await client.operation({scope,operationId:input.operationId});
      const replay=await client.importSource({...input,scope});
      assert(replay.replayed===true&&committed.result.source.id===baseline.sourceId,'The original exact import did not replay its saved result.');
      await lost.close();
      return {uncertainty,committed:committed.result,requestSha256:committed.request_sha256,replayed:replay.replayed};
    });
    await openMcp(configuration);
    await phase('original-stdio-bind-and-full-metadata',async()=>{
      const tools=mcp.catalog.tools.filter(t=>t.name.startsWith('merchant_dspace_'));
      assert(tools.length===20,'The maintained merchant catalog does not expose the complete DSpace tool set.');
      const choices=[];
      for(const sourceId of [...new Set(baseline.selection.map(x=>x.sourceId))]){
        let offset=0,total;
        do{const page=await mcp.call('merchant_dspace_items',{operator:'repository',scope,sourceId,offset,limit:13});
          total=page.total;choices.push(...page.items.map(x=>({sourceId,uuid:x.uuid,objectSha256:x.objectSha256})));offset+=page.items.length;
          assert(page.items.length>0||offset===total,'The original source page chain stopped early.');}
        while(offset<total);
      }
      assert(choices.length===45&&sha(JSON.stringify(choices.map(x=>[x.sourceId,x.uuid,x.objectSha256]).sort()))===
        sha(JSON.stringify(baseline.selection.map(x=>[x.sourceId,x.uuid,x.objectSha256]).sort())),'The MCP item pages differ from the original selected 45 records.');
      const authors=[];let offset=0;
      do{const page=await mcp.call('merchant_dspace_item',{operator:'repository',scope,...baseline.publication,field:'dc.contributor.author',offset,limit:17});
        authors.push(...page.metadata.values);offset=page.metadata.page.nextOffset;}
      while(offset!==null);
      assert(authors.length===85&&sha(JSON.stringify(authors))===baseline.authorSha256,'The complete original 85-author metadata array changed.');
      const linked=await mcp.call('merchant_dspace_item',{operator:'repository',scope,...baseline.person});
      assert(linked.metadata.fields.some(x=>x.field==='person.familyName'),'The original linked Person metadata is absent.');
      const declared=await mcp.call('merchant_dspace_inputs',{operator:'repository',input:'catalog'});
      assert(declared.sha256===baseline.sourceFile.sha256&&declared.bytes===baseline.sourceFile.bytes,'The host-declared input differs from the original source.');
      return {tools:tools.map(t=>t.name),records:choices.length,authors:authors.length,authorSha256:baseline.authorSha256,
        operatorId:scope.operatorId,workspaceId:scope.workspaceId,input:declared};
    });
    const imported=await phase('mcp-source-import',()=>mutation('import-mcp','merchant_dspace_import',()=>({
      input:'catalog',expectedSha256:baseline.sourceFile.sha256})));
    assert(imported.source.id===baseline.sourceId,'The MCP import returned a different original capture.');
    const edition=await phase('mcp-edition-and-review',async()=>{
      const saved=await mutation('edition-full','merchant_dspace_save_edition',()=>({name:'Reviewed repository cohort',mode:'items',
        selection:baseline.selection,metadataFields:baseline.metadataFields,rights:baseline.rights}));
      assert(saved.edition.row_count===45,'The original edition engine did not retain all45 selected records.');
      const reviewed=await mutation('review-full','merchant_dspace_review_edition',()=>({editionId:saved.edition.id,editionSha256:saved.edition.sha256,
        decision:'approved',comment:'Reviewed all45 original repository records, complete metadata arrays, selected customer fields and explicit internal demonstration distribution basis.'}));
      const selected=await mutation('select-full','merchant_dspace_select_edition',()=>({editionId:saved.edition.id,reviewId:reviewed.review.id}));
      assert(selected.snapshot===saved.edition.snapshot,'The original selection changed its reviewed dataset snapshot.');
      return {edition:saved.edition,review:reviewed.review,selected};
    });
    await phase('native-dataset-page-chain',async()=>{
      const pages=[];let cursor=null,rows=0;
      do{
        const page=await mcp.call('merchant_dspace_query',{operator:'repository',scope,editionId:edition.edition.id,
          query:{limit:'7',...(cursor?{cursor}:{})}});
        assert(page.dataset.snapshot===edition.edition.snapshot&&page.page.total===45&&page.rows.length===page.page.returned,'The original dataset page identity changed.');
        rows+=page.rows.length;pages.push({returned:page.page.returned,nextCursor:page.page.nextCursor,snapshot:page.dataset.snapshot});
        cursor=page.page.nextCursor;
      }while(cursor!==null);
      assert(rows===45&&pages.length===7,'The original native cursor did not deliver all45 records over7pages.');
      return {rows,pages,snapshot:edition.edition.snapshot};
    });
    const correction=await phase('corrected-edition-comparison',async()=>{
      const selection=baseline.selection.filter(x=>x.uuid!==PERSON);
      const saved=await mutation('edition-publications','merchant_dspace_save_edition',()=>({name:'Reviewed publication-only cohort',mode:'items',
        selection,metadataFields:baseline.metadataFields,rights:baseline.rights,previousEditionId:edition.edition.id}));
      const compared=await mutation('compare-publications','merchant_dspace_compare',()=>({beforeId:edition.edition.id,afterId:saved.edition.id}));
      const reviewed=await mutation('review-publications','merchant_dspace_review_edition',()=>({editionId:saved.edition.id,editionSha256:saved.edition.sha256,
        decision:'approved',comment:'Reviewed the explicit44-publication successor. The separately captured Person remains retained in the source and prior45-record edition.'}));
      await mutation('select-publications','merchant_dspace_select_edition',()=>({editionId:saved.edition.id,reviewId:reviewed.review.id}));
      assert(saved.edition.row_count===44,'The corrected original edition must contain44publication records.');
      const comparison=await mcp.call('merchant_dspace_record',{operator:'repository',scope,kind:'comparisons',id:compared.comparison.id,limit:100});
      assert(comparison.total>0,'The original comparator did not retain the selected-record correction.');
      return {edition:saved.edition,review:reviewed.review,comparison:compared.comparison,changes:comparison.total};
    });
    const complete=await phase('complete-export-acquisition',async()=>{
      const manifest=await mcp.call('merchant_dspace_download',{operator:'repository',scope,kind:'project'});
      assert(manifest.file.bytes>196608,'Use the complete original retained project for the multi-chunk receiving operation.');
      return manifest;
    });
    const finalFile=path.join(directory,'Repository_Agent_Workspace.sqlite3');
    await phase('retained-file-interruption-and-host-restart',async()=>{
      if(!journal.fileInterrupted){
        let chunks=0;
        const interrupted={call:async(name,args)=>{
          if(name==='merchant_dspace_file'&&++chunks===2)throw fail('NATIVE_RECEIVER_INTERRUPTED','Original file consumer stopped after its first saved chunk.');
          return mcp.call(name,args);
        }};
        await expectedFailure(()=>receiveDspaceMerchantFile({merchant:interrupted,operator:'repository',downloadId:complete.downloadId,
          expectedSha256:complete.file.sha256,destination:finalFile,chunkBytes:65536}),/^NATIVE_RECEIVER_INTERRUPTED$/);
        const partial=finalFile+'.'+complete.downloadId+'.part',stat=await fsp.stat(partial);
        assert(stat.size===65536&&stat.size<complete.file.bytes,'The original first receiving chunk was not retained.');
        journal.fileInterrupted={bytes:stat.size,downloadId:complete.downloadId,sha256:complete.file.sha256,at:new Date().toISOString()};await persist();
      }
      await mcp.close();mcp=null;
      assert((await current()).id===scope.workspaceId,'Closing borrowed MCP stopped the original operator.');
      await openMcp(configuration);
      let firstOffset=null;
      const resumed={call:async(name,args)=>{if(name==='merchant_dspace_file'&&firstOffset===null)firstOffset=args.offset;return mcp.call(name,args);}};
      const result=await receiveDspaceMerchantFile({merchant:resumed,operator:'repository',downloadId:complete.downloadId,
        expectedSha256:complete.file.sha256,destination:finalFile,chunkBytes:65536});
      assert(result.replayed||firstOffset===journal.fileInterrupted.bytes,'The same retained file did not resume from its original saved offset.');
      const actual=await inspectDspaceInput(finalFile,{maximum:1024*1024*1024});
      assert(actual.sha256===complete.file.sha256&&actual.bytes===complete.file.bytes,'The complete received project changed.');
      const repeated=await receiveDspaceMerchantFile({merchant:mcp,operator:'repository',downloadId:complete.downloadId,
        expectedSha256:complete.file.sha256,destination:finalFile});
      assert(repeated.replayed===true,'The exact complete receiving destination was not recognized.');
      return {manifest:complete,file:finalFile,...actual,firstResumedOffset:firstOffset,replayed:repeated.replayed};
    });
    await phase('project-receiving-loss-and-scope-protection',async()=>{
      const originalScope={...scope},operationId=PREFIX+'-receive-original';
      const receiver=await connectDspaceOperator({directory:operatorDirectory,fetchImpl:async(url,options)=>{
        const response=await fetch(url,options);
        if(String(url).endsWith('/api/receive')&&!journal.receiveLostReply){
          const body=await response.json();assert(response.ok&&body.operationId===operationId,'The original complete project receiving failed before response interruption.');
          journal.receiveLostReply={operationId,sha256:body.sha256,scope:{operatorId:body.state.operator.id,instanceId:body.state.operator.instanceId,
            projectKey:body.state.operator.selected,workspaceId:body.state.id},at:new Date().toISOString()};await persist();
          throw fail('NATIVE_RESPONSE_INTERRUPTED','The original receiving response was interrupted after its project was saved.');
        }
        return response;
      }});clients.add(receiver);
      let uncertainty=null;
      try{await receiver.receiveWorkspace({scope,file:originalFile,expectedSha256:intake.sha256,operationId});}
      catch(error){assert(error.uncertain&&error.operationId===operationId,'The original receiving request lost its persistent uncertainty identity.');
        uncertainty={code:error.code,operationId:error.operationId,uncertain:error.uncertain};}
      const binding=await mcp.call('merchant_dspace_bind',{operator:'repository',reconnect:true});scope=binding.scope;
      assert(scope.projectKey!==originalScope.projectKey&&scope.operatorId===originalScope.operatorId,'Receiving did not select its exact original new project.');
      const replay=await mcp.call('merchant_dspace_receive',{operator:'repository',scope,input:'project',expectedSha256:intake.sha256,operationId});
      scope=replay.scope;assert(replay.replayed===true&&replay.sha256===intake.sha256,'The complete original receiving operation did not replay.');
      const stale=[
        await expectedFailure(()=>mcp.call('merchant_dspace_status',{operator:'repository',scope:originalScope}),/^DSCOPE_/),
        await expectedFailure(()=>mcp.call('merchant_dspace_download',{operator:'repository',scope:originalScope,kind:'project'}),/^DSCOPE_/),
        await expectedFailure(()=>mcp.call('merchant_dspace_select_edition',{operator:'repository',scope:originalScope,operationId:PREFIX+'-stale-scope',
          expectedRevision:0,actor:ACTOR,editionId:correction.edition.id,reviewId:correction.review.id}),/^DSCOPE_/)
      ];
      const back=await mcp.call('merchant_dspace_select_project',{operator:'repository',scope,key:'original'});scope=back.scope;
      const original=await mcp.call('merchant_dspace_operation',{operator:'repository',scope,operationId:journal.requests['edition-full'].operationId});
      assert(original.result.edition.id===edition.edition.id,'Project receiving changed the original saved edition operation.');
      await expectedFailure(()=>mcp.call('merchant_dspace_operation',{operator:'repository',scope,operationId:PREFIX+'-stale-scope'}),/^DSPACE_OPERATION_MISSING$/);
      await receiver.close();
      return {uncertainty,receivedProject:replay.scope.projectKey,replayed:replay.replayed,staleScopeResponses:stale,originalOperation:original.result.operationId};
    });
    await phase('original-operator-restart-and-independent-receiving',async()=>{
      const before=await current(),oldScope={...scope};
      await mcp.close();mcp=null;
      for(const handle of clients)await handle.close();clients.clear();
      await host.close();host=null;
      await startHost();
      assert(scope.operatorId===oldScope.operatorId&&scope.instanceId!==oldScope.instanceId&&scope.workspaceId===oldScope.workspaceId,
        'The original operator restart changed persistent identity or failed to change its running instance.');
      const after=await current();
      assert(after.revision===before.revision&&after.selected_edition_id===correction.edition.id&&after.operation_count===before.operation_count,
        'The original saved operations changed across host restart.');
      await openMcp(configuration);
      const readback=await mcp.call('merchant_dspace_download_read',{operator:'repository',downloadId:complete.downloadId});
      assert(readback.file.sha256===complete.file.sha256,'The retained original export changed across operator restart.');
      const independentDirectory=path.join(directory,'independent-workspace');
      const received=await receiveDspaceWorkspace({file:finalFile,directory:independentDirectory});
      let independent;
      try{
        independent=received.state();
        assert(independent.id===before.id&&independent.selected_edition_id===correction.edition.id,'Independent receiving changed the original workspace or selected edition.');
        const source=received.get('sources',baseline.publication.sourceId),item=source.items.find(x=>x.uuid===PUBLICATION&&x.object_sha256===baseline.publication.objectSha256);
        assert(sha(JSON.stringify(item.object.metadata['dc.contributor.author']))===baseline.authorSha256,'The independently received85-author array differs.');
        const native=await received.query(correction.edition.id,{limit:'100'});
        assert(native.status===200&&native.body.rows.length===44&&native.body.dataset.snapshot===correction.edition.snapshot,'The independently received native dataset differs.');
      }finally{await received.close();}
      const reopened=await openDspaceWorkspace({directory:independentDirectory});
      try{assert(reopened.state().revision===independent.revision,'The cold original receiver did not retain its revision.');}finally{await reopened.close();}
      return {operatorId:scope.operatorId,priorInstanceId:oldScope.instanceId,instanceId:scope.instanceId,
        originalWorkspaceId:before.id,originalRevision:before.revision,operationCount:before.operation_count,
        receivingDirectory:independentDirectory,receivedRevision:independent.revision,records:44,priorEditionRecords:45,
        authors:85,selectedSnapshot:correction.edition.snapshot,file:complete.file};
    });
    const finalState=await current();
    const result={schema:'stellar-forge.dspace-agent-receiving-result.v1',state:'PASS',operationPrefix:PREFIX,completedAt:new Date().toISOString(),
      operatorId:scope.operatorId,workspaceId:scope.workspaceId,revision:finalState.revision,operationCount:finalState.operation_count,
      selectedEditionId:finalState.selected_edition_id,phases:Object.entries(journal.phases).map(([name,value])=>({name,state:value.state,completedAt:value.completedAt,result:value.result})),
      sourceFiles:sourceIdentity,project:{path:finalFile,...complete.file},journal:journalFile,
      merchantConfiguration:configuration,originalWorkspace:workspaceDirectory,operatorDirectory};
    await save(resultFile,result);process.stdout.write(json({state:'PASS',resultFile,phases:result.phases.length,workspaceId:scope.workspaceId,project:result.project}));
    return result;
  }finally{
    const closing=[];
    for(const close of [()=>mcp?.close(),...[...clients].map(handle=>()=>handle.close()),()=>host?.close(),()=>saving,()=>lease.close()]){
      try{await close();}catch(error){closing.push({code:error.code??error.name,message:error.message});}
    }
    if(closing.length){
      journal.closureErrors=closing;await persist();
      const previous=await exists(resultFile)?JSON.parse(await fsp.readFile(resultFile,'utf8')):{};
      await save(resultFile,{...previous,state:'INTERRUPTED',closureErrors:closing});
      throw fail('NATIVE_CLOSURE_INCOMPLETE','Original native handles reported incomplete closure.',{errors:closing});
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=argumentsFor(process.argv.slice(2));
  runDspaceAgentReceiving({directory:args.directory,projectFile:args['project-file']}).catch(error=>{
    process.stderr.write(json({state:'INTERRUPTED',code:error.code??error.name,message:error.message}));process.exitCode=1;
  });
}
