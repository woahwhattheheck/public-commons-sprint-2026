#!/usr/bin/env node
// MIT. Receive and commission the retained Routescan SCF installation through
// the maintained MCP, original Operations service, and original CLI.
import {readFile,writeFile,mkdir,open,link,unlink,stat,realpath} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {MerchantGrantWorkspaces,readGrantWorkspaceConfiguration}
  from '../../../../stellar-forge/mcp-merchant-operator/grant-workspace.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const OPERATION='SCF-CUSTOMER-INSTALLATION-OPERATIONS-BD9D-20261012';
const ACTOR='BD9D original SCF Installation receiving operator';
const ORIGINAL_SHA='c71303844660d5a859d3936a569b5461c7b1679b739dfead95d907759693df2b';
const ORIGINAL_PLAN='97bb2797558058e1b4c4f4f386bffc6241f246661656dfcd92d9f6e395f7bb84';
const DEPLOYMENT='deployment-e0667ddeae2a42c686a161a0ef2d6a5d';
const PURCHASE='purchase-206fc6c410024b96beec967c66dc1f94';
const QUERY_SOURCE='source-7846c30f2be142b79b1500f865b5ace4';
const ANNEX_SOURCE='source-1765b6e34fc446febb06db06f2657df8';
const QUERY_SHA='1f63ebfc7346bb12f9737f5cc86cc9e8a4356822c9b86fd96bd2abcab673b240';
const OUTPUT_SHA='85020c7b9dc9d6118e1535a046a06ca60014a092911317ac837945d6d177e85a';
const QUERY='https://api.routescan.io/v2/network/mainnet/evm/1/aggregations/avg-gas-price?dateFrom=2026-10-10T00%3A00%3A00.000Z&dateTo=2026-10-10T23%3A59%3A59.999Z&unit=day';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const clone=value=>structuredClone(value);
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const requestId=phase=>'bd9d-installation-'+sha(Buffer.from(OPERATION+'\0'+phase)).slice(0,40);
async function optional(filename){try{return await readFile(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function exactFile(filename,bytes){
  await mkdir(dirname(filename),{recursive:true,mode:0o700});
  const old=await optional(filename);
  if(old){need(old.equals(bytes),'Existing original file differs: '+filename);return;}
  const temporary=filename+'.pending-'+randomUUID(),fd=await open(temporary,'wx',0o600);
  try{
    try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
    try{await link(temporary,filename);}catch(error){if(error.code!=='EEXIST')throw error;
      need((await readFile(filename)).equals(bytes),'Concurrent original file differs: '+filename);}
    const parent=await open(dirname(filename),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await unlink(temporary).catch(()=>{});}
}
function args(){
  const result={};
  for(let index=2;index<process.argv.length;index+=2){
    const name=process.argv[index];need(['--work','--case','--python','--scenario'].includes(name)&&process.argv[index+1],
      'Use --work DIR --case ORIGINAL_V37_ZIP --python ABSOLUTE_PYTHON --scenario ORIGINAL_SCENARIO_JSON.');
    result[name.slice(2)]=resolve(process.argv[index+1]);
  }
  need(Object.keys(result).length===4,'All four original input paths are required.');
  return result;
}
function runPython(python,code,argv=[]){
  const result=spawnSync(python,['-B','-c',code,...argv],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  need(!result.error&&result.status===0,'Original Python operation failed: '+(result.error?.message||result.stderr));
  return JSON.parse(result.stdout);
}
function originalCounts(current){return Object.fromEntries(Object.entries(current.records).map(([kind,rows])=>[kind,rows.length]));}
function withoutCurrent(row){const {current,...saved}=row;return saved;}
function brief(row){return{id:row.id,revision:row.revision,version:row.version,sha256:row.sha256};}

async function main(){
  const options=args();await mkdir(options.work,{recursive:true,mode:0o700});
  need(await realpath(options.work)===options.work,'Use a private original work directory without symlinks.');
  const sourceBytes=await readFile(options.case);
  need(sourceBytes.length===647130&&sha(sourceBytes)===ORIGINAL_SHA,'Use the complete original v37 Operations case.');
  const sourceManifest={operation:OPERATION,actor:ACTOR,case:{path:options.case,bytes:sourceBytes.length,sha256:sha(sourceBytes)},
    sourceDirectory:HERE,scenario:{path:options.scenario,sha256:sha(await readFile(options.scenario))},python:options.python};
  await exactFile(join(options.work,'operation-input.json'),json(sourceManifest));
  const dirs={source:join(options.work,'source-workspace'),receiving:join(options.work,'receiving-workspace')};
  for(const directory of [...Object.values(dirs),join(options.work,'exports'),join(options.work,'phases'),join(options.work,'delivery')])
    await mkdir(directory,{recursive:true,mode:0o700});
  const connection={schema:'stellar-forge.sf47-workspace-connection.v1',workspaces:Object.fromEntries(
    Object.entries(dirs).map(([workspace,directory])=>[workspace,{directory,label:workspace+' Installation operating case',
      scenarioFile:options.scenario,pythonExecutable:options.python,allowStart:true,
      inputs:workspace==='source'?{original_case:{file:options.case,sha256:ORIGINAL_SHA,kind:'original-operating-case',
        label:'Original SCF operating case v37',mediaType:'application/zip'}}:{}}]))};
  const connectionFile=join(options.work,'connection.json');await exactFile(connectionFile,json(connection));
  const configured=await readGrantWorkspaceConfiguration(connectionFile);
  const providerOptions={grantWorkspaces:configured,exportsDirectory:join(options.work,'exports')};
  let provider=new MerchantGrantWorkspaces(providerOptions);
  const phaseRoot=join(options.work,'phases');
  async function originalBytes(snapshot){
    need(snapshot.retention?.state==='COMPLETE'&&snapshot.id,'The native response must retain its complete original bytes.');
    const chunks=[];let offset=0,readId;
    do{
      const chunk=await provider.call('merchant_grant_file_read',{workspace:snapshot.workspace,snapshotId:snapshot.id,
        expectedSha256:snapshot.file.sha256,offset,limit:196608,...(readId?{readId}:{})});
      need(chunk.offset===offset&&chunk.encoding==='base64','Original byte reader returned another position or encoding.');
      const bytes=Buffer.from(chunk.data,'base64');need(bytes.length===chunk.bytesRead,'Original byte page is incomplete.');
      chunks.push(bytes);readId=chunk.readId;offset=chunk.nextOffset;
    }while(offset!==null);
    const bytes=Buffer.concat(chunks);
    need(bytes.length===snapshot.file.bytes&&sha(bytes)===snapshot.file.sha256,'The complete original snapshot changed.');
    return bytes;
  }
  async function phase(name,make,{binary=false}={}){
    need(/^[a-z][a-z0-9-]{0,99}$/.test(name),'Retain a plain phase name.');
    const requestFile=join(phaseRoot,name+'.request.json'),snapshotFile=join(phaseRoot,name+'.snapshot.json');
    const stored=await optional(requestFile);
    const request=stored?JSON.parse(stored):await make();
    if(!stored)await exactFile(requestFile,json(request));
    need(request.operation===OPERATION&&request.phase===name&&request.tool.startsWith('merchant_grant_'),
      'Original phase request identity differs.');
    const bodyFile=join(phaseRoot,name+(binary?'.zip':'.json'));
    let snapshot,bytes;const savedSnapshot=await optional(snapshotFile);
    if(savedSnapshot)snapshot=JSON.parse(savedSnapshot);
    else{
      snapshot=await provider.call(request.tool,request.args);
      need(snapshot.retention?.state==='COMPLETE'&&snapshot.id,
        'Original native response needs retained storage before continuation: '+JSON.stringify(snapshot.retention));
      await exactFile(snapshotFile,json(snapshot));
    }
    bytes=await optional(bodyFile);
    if(!bytes){bytes=await originalBytes(snapshot);await exactFile(bodyFile,bytes);}
    need(snapshot.file.bytes===bytes.length&&snapshot.file.sha256===sha(bytes),'Retained original phase bytes differ.');
    process.stdout.write(JSON.stringify({operation:OPERATION,phase:name,state:'COMPLETE',snapshotId:snapshot.id,bytes:bytes.length,sha256:snapshot.file.sha256})+'\n');
    return {request,snapshot,bytes,path:bodyFile,value:binary?undefined:JSON.parse(bytes)};
  }
  const call=(name,tool,body,binary=false)=>phase(name,async()=>({operation:OPERATION,phase:name,
    tool:'merchant_grant_'+tool,args:typeof body==='function'?await body():body}),{binary});
  const sourceArgs=caseId=>({workspace:'source',caseId});
  const readEdition=(phaseName,workspace,caseId,installationId,revision)=>call(phaseName,'installation',
    {workspace,caseId,installationId,revision});
  let delivery;
  try{
    const workspaces=await provider.call('merchant_grant_workspaces');
    await exactFile(join(options.work,'native-source-bindings-'+sha(json(workspaces))+'.json'),json(workspaces));
    const sourceBinding=workspaces.workspaces.find(value=>value.workspace==='source');
    await provider.call('merchant_grant_open',{workspace:'source',expectedSelectionSha256:sourceBinding.selectionSha256});
    const imported=await call('import-original-case','case_import',{workspace:'source',input:{hostInput:'original_case'},
      expectedInputSha256:ORIGINAL_SHA,name:'Routescan customer Installation operating case — original SCF source',
      requestId:requestId('import-original-case'),actor:ACTOR});
    const caseId=imported.value.id;
    const original=await call('read-original-case','case',sourceArgs(caseId)),current=original.value;
    need(current.plan.contentSha256===ORIGINAL_PLAN&&current.records.deployments.length===8&&current.records.purchases.length===8,
      'The original funding plan and eight retained deployments/purchases must remain complete.');
    const deployment=current.records.deployments.find(row=>row.id===DEPLOYMENT);
    const purchase=current.records.purchases.find(row=>row.id===PURCHASE);
    need(deployment?.caseRef==='routescan-stellar-api-workshare-2026'&&purchase?.deploymentId===deployment.id&&
      purchase.deliveredSha256===OUTPUT_SHA&&purchase.deliveredBytes===50,'Select the exact retained Routescan operation.');
    const queryArchive=await call('export-original-query-source','export',{...sourceArgs(caseId),kind:'source',sourceId:QUERY_SOURCE},true);
    need(sha(queryArchive.bytes)===QUERY_SHA,'The original query source ZIP changed.');
    const observationFile=join(options.work,'original-query-observation.json');
    let observed=await optional(observationFile);
    if(!observed){
      const result=runPython(options.python,
        "import sys,zipfile,hashlib,json,datetime\nwith zipfile.ZipFile(sys.argv[1]) as z:\n rows=[i for i in z.infolist() if i.filename.endswith('Original_Routescan_Response.json')]\n assert len(rows)==1 and rows[0].file_size==50\n raw=z.read(rows[0]); assert hashlib.sha256(raw).hexdigest()==sys.argv[2]\n print(json.dumps({'member':rows[0].filename,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'value':json.loads(raw),'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}))",
        [queryArchive.path,OUTPUT_SHA]);
      await exactFile(observationFile,json(result));observed=json(result);
    }
    const observation=JSON.parse(observed);
    const seeded=await call('seed-installation','installation_seed',{...sourceArgs(caseId),expectedVersion:current.program.version});
    const inputFile=join(options.work,'installation-edition-1-input.json');
    let inputBytes=await optional(inputFile);
    if(!inputBytes){
      const document=clone(seeded.value.document);
      Object.assign(document,{name:'Routescan daily Ethereum gas query — customer receiving installation',stage:'COMMISSIONING',
        merchantDeploymentId:deployment.id,buyerDeploymentIds:[deployment.id]});
      document.workorder={sourceId:ANNEX_SOURCE,reference:deployment.caseRef,payer:'',
        scope:'Commission the existing Routescan resource and retain its complete original result in the original SCF Installation workflow. Original source operation fdad62f2, sequence 462; release '+deployment.releaseRef+'.',
        terms:''};
      document.task={name:'Receive a complete daily Ethereum gas aggregation',
        purpose:'Open the original gas-price result for a named UTC day in an independently received operating case.',
        request:'GET '+QUERY,
        completeOutput:'One whole UTF-8 JSON response for the selected Ethereum mainnet chain 1 daily window, preserved with its source request and original byte identity. Original received response: 50 bytes, SHA256 '+OUTPUT_SHA+'.',
        repeatTrigger:'A later complete UTC reporting day, a corrected provider result, or an explicitly selected different reporting window.',
        pricedUnit:'One complete selected query response; retained original settlement '+purchase.amountStroops+' stroops on '+purchase.network+'.'};
      document.source={sourceIds:[QUERY_SOURCE,ANNEX_SOURCE],reference:QUERY,
        mode:'SNAPSHOT',population:'The complete retained daily average-gas-price response for Ethereum mainnet chain 1, 2026-10-10T00:00:00.000Z through 2026-10-10T23:59:59.999Z; unit=day.',
        meaning:'Original parsed response: '+JSON.stringify(observation.value)+'. Keep exact original field names and values; the query specifies UTC day and Ethereum chain 1. Field units beyond the retained source stay subject to the provider source contract.',
        authority:'Original public Routescan response and source annex retained by the source operator in this Operations case.',
        changePolicy:'Save a later edition selecting the complete replacement source and its new SHA; keep this original result and earlier edition available. Withdraw the deployment through its original Operations record with the operator reason.'};
      document.payment={...document.payment,network:purchase.network,asset:purchase.asset,recipient:purchase.recipient,
        priceAtomic:purchase.amountStroops,taskUnits:1,taskBudgetAtomic:purchase.amountStroops,
        authority:'',termsSourceIds:[ANNEX_SOURCE],facilitators:[]};
      document.receiving={application:'SCF Delivery operations — saved Customer Installations and complete operating-case receiving',
        host:'Authorized Commons Linux runtime; separate original source and receiving workspaces',
        operator:ACTOR,
        acceptanceRule:'Read the original source ZIP through the native retained-file reader, recover the complete original JSON, verify all 50 bytes and SHA256 '+OUTPUT_SHA+', then reopen the selected installation and all original source records after whole-case receiving.',
        changeAndWithdraw:'Open the current saved edition as a draft, edit the source/task/terms/receiving fields, review the current case version and save the next edition with the original request ID. Earlier saved editions remain available.',
        recovery:'Reopen this operation directory and repeat the same command. Original phase requests, native snapshot IDs and exact body files recover the same save or import; private source and receiving workspaces retain their original Journals.',
        maintenance:'Commons SCF operating workspace maintainers; original coordination thread C0BTB4SUCP9/1791730668.369819. Original Routescan resource operator: '+deployment.operator+'.',
        sourceIds:[QUERY_SOURCE,ANNEX_SOURCE]};
      document.assignments.note='The original six funded packages and measurable criteria remain attached to this installation. Record actual implementation hours against the original work item once; retained testnet settlement stays in its original purchase record.';
      document.checks.push({id:'original-query-source-receiving',title:'Receive the complete original Routescan response',
        criterion:'The original source ZIP yields its complete 50-byte JSON response and the retained delivered SHA256.',
        tranche:null,required:true,state:'ACCEPTED',operator:ACTOR,observedAt:observation.observedAt,
        note:'Native source export and original JSON member read completed: '+observation.member+'; '+observation.bytes+' bytes; SHA256 '+observation.sha256+'. Parsed result: '+JSON.stringify(observation.value)+'.',
        sourceIds:[QUERY_SOURCE,ANNEX_SOURCE],workIds:[],purchaseIds:[PURCHASE],outcomeIds:[]});
      await exactFile(inputFile,json(document));inputBytes=json(document);
    }
    const document=JSON.parse(inputBytes);
    const preview1=await call('preview-edition-1','installation_preview',{...sourceArgs(caseId),expectedVersion:current.program.version,
      installationId:null,expectedRevision:0,inputs:document});
    const saved1=await call('save-edition-1','installation_save',{...sourceArgs(caseId),expectedVersion:current.program.version,
      installationId:null,expectedRevision:0,inputs:document,expectedPreviewSha256:preview1.value.previewSha256,
      requestId:requestId('save-edition-1'),actor:ACTOR,note:'Commission the original Routescan task and complete source receiving against the selected funded plan.'});
    const installationId=saved1.value.recordId;
    const edition1=await readEdition('read-edition-1','source',caseId,installationId,1);
    const replay1=await call('recover-edition-1-save','installation_save',saved1.request.args);
    need(stable(replay1.value)===stable(saved1.value),'The original saved request must reopen the same installation and version.');
    const export1=await call('export-edition-1','export',{...sourceArgs(caseId),kind:'installation',installationId,revision:1},true);
    await exactFile(join(options.work,'delivery','Routescan_Installation_Edition_1.zip'),export1.bytes);
    const afterFirst=await call('read-case-after-edition-1','case',sourceArgs(caseId));
    const nextInputFile=join(options.work,'installation-edition-2-input.json');
    let nextInputBytes=await optional(nextInputFile);
    if(!nextInputBytes){
      const next=clone(edition1.value.preview.document);
      next.receiving.changeAndWithdraw+=' For receiving staff, import the entire selected-edition ZIP before changing it, retain all original attachments and use the selected installation identity when appending an edition. Check original saved history before any withdrawal.';
      next.receiving.maintenance+=' Edition handover includes installation.html, both saved installation editions, the original funding-plan history and all original case sources.';
      next.assignments.note+=' Onward support uses the complete operating-case archive and names the original case, installation and edition in the work order.';
      await exactFile(nextInputFile,json(next));nextInputBytes=json(next);
    }
    const nextDocument=JSON.parse(nextInputBytes);
    const preview2=await call('preview-edition-2','installation_preview',{...sourceArgs(caseId),
      expectedVersion:afterFirst.value.program.version,installationId,expectedRevision:1,inputs:nextDocument});
    const saved2=await call('save-edition-2','installation_save',{...sourceArgs(caseId),
      expectedVersion:afterFirst.value.program.version,installationId,expectedRevision:1,inputs:nextDocument,
      expectedPreviewSha256:preview2.value.previewSha256,requestId:requestId('save-edition-2'),actor:ACTOR,
      note:'Complete the second-operator change, onward receiving and maintenance instructions while retaining the first edition.'});
    const edition2=await readEdition('read-edition-2','source',caseId,installationId,2);
    const reopened1=await readEdition('reopen-original-edition-1','source',caseId,installationId,1);
    need(stable(withoutCurrent(edition1.value))===stable(withoutCurrent(reopened1.value)),'The first saved edition changed.');
    const page1=await call('history-page-1','installation_history',{...sourceArgs(caseId),installationId,limit:1});
    need(page1.value.editions.length===1&&page1.value.editions[0].revision===2&&page1.value.nextBefore===2,
      'The first original history page must expose the second edition and its next cursor.');
    const page2=await call('history-page-2','installation_history',{...sourceArgs(caseId),installationId,
      before:page1.value.nextBefore,limit:1});
    need(page2.value.editions.length===1&&page2.value.editions[0].revision===1&&page2.value.nextBefore===null,
      'The complete original edition history must remain available.');
    const export2=await call('export-edition-2','export',{...sourceArgs(caseId),kind:'installation',installationId,revision:2},true);
    const edition2Zip=join(options.work,'delivery','Routescan_Installation_Edition_2.zip');
    await exactFile(edition2Zip,export2.bytes);
    await provider.close();
    provider=new MerchantGrantWorkspaces(providerOptions);
    const receivingBinding=workspaces.workspaces.find(value=>value.workspace==='receiving');
    await provider.call('merchant_grant_open',{workspace:'receiving',expectedSelectionSha256:receivingBinding.selectionSha256});
    const received=await call('receive-selected-edition','case_import',{workspace:'receiving',
      input:{snapshotId:export2.snapshot.id,sourceWorkspace:'source'},expectedInputSha256:export2.snapshot.file.sha256,
      name:'Routescan Installation — complete received operating case',requestId:requestId('receive-selected-edition'),actor:ACTOR});
    const receivedCaseId=received.value.id;
    need(received.value.selectedInstallation?.id===installationId&&received.value.selectedInstallation?.revision===2,
      'The selected edition must open with the received complete case.');
    const received2=await readEdition('read-received-edition-2','receiving',receivedCaseId,installationId,2);
    const received1=await readEdition('read-received-edition-1','receiving',receivedCaseId,installationId,1);
    for(const [originalEdition,receivedEdition] of [[edition1.value,received1.value],[edition2.value,received2.value]])
      need(stable(withoutCurrent(originalEdition))===stable(withoutCurrent(receivedEdition)),
        'Receiving must preserve every complete original saved edition.');
    const finalCase=await call('read-complete-received-case','case',{workspace:'receiving',caseId:receivedCaseId});
    need(stable(finalCase.value.records)===stable(current.records),'Receiving must preserve all original record collections.');
    need(finalCase.value.plan.contentSha256===current.plan.contentSha256,'Receiving must preserve the original funded plan.');
    const receivedSource=await call('read-complete-received-source','export',{workspace:'receiving',caseId:receivedCaseId,
      kind:'source',sourceId:QUERY_SOURCE},true);
    need(receivedSource.bytes.equals(queryArchive.bytes),'Receiving changed the complete original source ZIP.');
    const receivedExport=await call('export-complete-received-edition','export',{workspace:'receiving',caseId:receivedCaseId,
      kind:'installation',installationId,revision:2},true);
    await exactFile(join(options.work,'delivery','Routescan_Installation_Received_Edition_2.zip'),receivedExport.bytes);
    const importReplay=await call('recover-selected-edition-import','case_import',received.request.args);
    need(stable(importReplay.value)===stable(received.value),'The original receiving request must reopen its same selected edition.');
    delivery={operation:OPERATION,actor:ACTOR,originalInput:sourceManifest.case,sourceBindings:workspaces,
      sourceCaseId:caseId,receivingCaseId:receivedCaseId,installationId,
      editions:[brief(edition1.value),brief(edition2.value)],originalCounts:originalCounts(current),
      receivingCounts:originalCounts(finalCase.value),planContentSha256:current.plan.contentSha256,
      originalQuery:observation,selectedInstallation:received.value.selectedInstallation,
      sourceEditionsUnchanged:true,allOriginalRecordsPreserved:true,
      files:[['Routescan_Installation_Edition_1.zip',export1.bytes],
        ['Routescan_Installation_Edition_2.zip',export2.bytes],
        ['Routescan_Installation_Received_Edition_2.zip',receivedExport.bytes]].map(([name,bytes])=>
          ({name,path:join(options.work,'delivery',name),bytes:bytes.length,sha256:sha(bytes)}))};
  }finally{await provider.close();}
  // The original browser owner is now closed before its original CLI opens the same workspace.
  const cliArgs=['-B',join(HERE,'cli.py'),'operations','--workspace',dirs.receiving,'--scenario',options.scenario];
  const cli=(name,more)=>{
    const result=spawnSync(options.python,[...cliArgs,name,...more],{encoding:'utf8',timeout:120000,
      maxBuffer:8*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    need(!result.error&&result.status===0,'Original Installation CLI failed: '+(result.error?.message||result.stderr));
    return JSON.parse(result.stdout);
  };
  const cliShow=cli('installation-show',['--case',delivery.receivingCaseId,'--installation',delivery.installationId,'--revision','2']);
  need(cliShow.sha256===delivery.editions[1].sha256,'The original CLI reopened another saved edition.');
  await exactFile(join(options.work,'delivery','Routescan_Installation_CLI_Reopen.json'),json(cliShow));
  const cliHistory=cli('installation-history',['--case',delivery.receivingCaseId,'--installation',delivery.installationId,'--limit','100']);
  need(cliHistory.editions.length===2&&cliHistory.nextBefore===null,'Original CLI must reopen the full installation history.');
  await exactFile(join(options.work,'delivery','Routescan_Installation_CLI_History.json'),json(cliHistory));
  const cliZip=join(options.work,'delivery','Routescan_Installation_CLI_Export.zip');
  const cliExport=cli('installation-export',['--case',delivery.receivingCaseId,'--installation',delivery.installationId,
    '--revision','2','--output',cliZip]);
  const bytes=await readFile(cliZip);
  delivery.cli={showSha256:cliShow.sha256,historyEditions:cliHistory.editions.length,export:cliExport};
  delivery.files.push({name:'Routescan_Installation_CLI_Export.zip',path:cliZip,bytes:bytes.length,sha256:sha(bytes)});
  const openText='# Routescan Installation operating handover\n\n'+
    'Open Routescan_Installation_Edition_2.zip and its installation.html for the full operating instructions. '+
    'Import that entire ZIP through Delivery operations → Import complete case. The selected second edition, first edition, '+
    'original grant plan, eight deployments, eight purchases and all original source files reopen together.\n\n'+
    'The independent receiving workspace is '+dirs.receiving+'. Its selected installation is '+delivery.installationId+
    '. Original source and receiving workspace access remains private to this host.\n\n'+
    'Resume this same operating command with the same work directory and original input. '+
    'operation-input.json, phase requests and native snapshots preserve the original save and receiving identities.\n\n'+
    'Source query: '+QUERY+'\n\nOperation: '+OPERATION+'\n';
  await exactFile(join(options.work,'delivery','OPEN_Routescan_Installation.md'),Buffer.from(openText));
  for(const name of ['Routescan_Installation_CLI_Reopen.json','Routescan_Installation_CLI_History.json','OPEN_Routescan_Installation.md']){
    const path=join(options.work,'delivery',name),raw=await readFile(path);
    delivery.files.push({name,path,bytes:raw.length,sha256:sha(raw)});
  }
  const finished=join(options.work,'result.json');
  await exactFile(finished,json({...delivery,state:'COMPLETE'}));
  process.stdout.write(JSON.stringify({operation:OPERATION,state:'COMPLETE',result:finished,
    sourceCaseId:delivery.sourceCaseId,receivingCaseId:delivery.receivingCaseId,installationId:delivery.installationId,
    editions:delivery.editions,files:delivery.files},null,2)+'\n');
}
main().catch(error=>{process.stderr.write(JSON.stringify({operation:OPERATION,state:'INTERRUPTED',
  message:error.message,code:error.code??null},null,2)+'\n');process.exitCode=1;});
