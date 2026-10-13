#!/usr/bin/env node
// MIT. Receive the complete original Freeform Workshare into Customer Installations
// through the maintained MCP, original Operations service, and original CLI.
import {readFile,writeFile,mkdir,open,link,unlink,stat,realpath} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {GRANT_TRANSFER_CHUNK_BYTES} from './agent-contracts.mjs';
import {MerchantGrantWorkspaces,readGrantWorkspaceConfiguration}
  from '../../../../stellar-forge/mcp-merchant-operator/grant-workspace.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const OPERATION='SCF-WORKSHARE-INSTALLATION-20261012';
const ACTOR='6200 SCF Workshare Installation receiving operator';
const ORIGINAL_SHA='c71303844660d5a859d3936a569b5461c7b1679b739dfead95d907759693df2b';
const ORIGINAL_PLAN='97bb2797558058e1b4c4f4f386bffc6241f246661656dfcd92d9f6e395f7bb84';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const clone=value=>structuredClone(value);
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const requestId=phase=>'workshare-installation-'+sha(Buffer.from(OPERATION+'\0'+phase)).slice(0,40);
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
    const name=process.argv[index];need(['--work','--case','--commercial-case','--python','--scenario'].includes(name)&&process.argv[index+1],
      'Use --work DIR --case ORIGINAL_V37_ZIP --commercial-case ORIGINAL_FREEFORM_ZIP --python ABSOLUTE_PYTHON --scenario ORIGINAL_SCENARIO_JSON.');
    result[name.slice(2)]=resolve(process.argv[index+1]);
  }
  need(Object.keys(result).length===5,'All five original input paths are required.');
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
  const prepared=runPython(options.python,
    "import runpy,sys\nsys.argv=[sys.argv[1],'--archive',sys.argv[2],'--directory',sys.argv[3]]\nrunpy.run_path(sys.argv[0],run_name='__main__')",
    [join(HERE,'workshare-installation-inputs.py'),options['commercial-case'],join(options.work,'original-inputs')]);
  const commissioning=JSON.parse(await readFile(prepared.commissioning.path,'utf8'));
  const originalWorkshare=commissioning.cases[0],plan=originalWorkshare.workshare_input.plan;
  const sourceManifest={operation:OPERATION,actor:ACTOR,
    case:{bytes:sourceBytes.length,sha256:sha(sourceBytes)},
    commercialCase:{bytes:prepared.originalArchive.bytes,sha256:prepared.originalArchive.sha256},
    workshareCaseId:prepared.caseId,planSha256:prepared.planSha256,
    commissioning:{bytes:prepared.commissioning.bytes,sha256:prepared.commissioning.sha256},
    packets:{bytes:prepared.packets.bytes,sha256:prepared.packets.sha256},
    scenarioSha256:sha(await readFile(options.scenario))};
  await exactFile(join(options.work,'operation-input.json'),json(sourceManifest));
  const completed=await optional(join(options.work,'result.json'));
  if(completed){
    const result=JSON.parse(completed);
    need(result.state==='COMPLETE'&&result.operation===OPERATION&&stable(result.originalInputs)===stable(sourceManifest),
      'Reopen this operation with its complete original input.');
    for(const file of result.files){
      const bytes=await readFile(file.path);
      need(bytes.length===file.bytes&&sha(bytes)===file.sha256,'Retained completed delivery differs: '+file.name);
    }
    process.stdout.write(JSON.stringify({operation:OPERATION,state:'COMPLETE',recovered:true,
      result:join(options.work,'result.json'),installationId:result.installationId,files:result.files})+'\n');
    return;
  }
  const dirs={source:join(options.work,'source-workspace'),receiving:join(options.work,'receiving-workspace')};
  for(const directory of [...Object.values(dirs),join(options.work,'exports'),join(options.work,'phases'),join(options.work,'delivery')])
    await mkdir(directory,{recursive:true,mode:0o700});
  const input=(file,hash,kind,label,mediaType)=>({file,sha256:hash,kind,label,mediaType});
  const inputs={
    original_case:input(options.case,ORIGINAL_SHA,'original-operating-case','Original SCF operating case v37','application/zip'),
    commissioning:input(prepared.commissioning.path,prepared.commissioning.sha256,'original-workshare-commissioning',
      'Complete original saved Freeform Workshare and phase effort','application/json'),
    packets:input(prepared.packets.path,prepared.packets.sha256,'original-workshare-receiving',
      'Complete original matching Freeform receiving packet','application/json'),
    original_workshare:input(options['commercial-case'],prepared.originalArchive.sha256,'original-workshare-case',
      'Complete thirty-member Freeform case and application handover','application/zip')};
  const connection={schema:'stellar-forge.sf47-workspace-connection.v1',workspaces:Object.fromEntries(
    Object.entries(dirs).map(([workspace,directory])=>[workspace,{directory,label:workspace+' Workshare Installation case',
      scenarioFile:options.scenario,pythonExecutable:options.python,allowStart:true,inputs:workspace==='source'?inputs:{}}]))};
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
        expectedSha256:snapshot.file.sha256,offset,limit:GRANT_TRANSFER_CHUNK_BYTES,...(readId?{readId}:{})});
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
      expectedInputSha256:ORIGINAL_SHA,name:'Freeform Workshare Installation — original complete SCF case',
      requestId:requestId('import-original-case'),actor:ACTOR});
    const caseId=imported.value.id;
    const original=await call('read-original-case','case',sourceArgs(caseId));
    const originalCase=original.value;
    need(originalCase.plan.contentSha256===ORIGINAL_PLAN&&originalCase.records.deployments.length===8&&
      originalCase.records.purchases.length===8,'Retain the original grant plan and all eight deployments and purchases.');
    let current=originalCase;
    const attachments={};
    for(const [alias,filename] of [
      ['commissioning','Freeform_Original_Workshare_Commissioning.json'],
      ['packets','Freeform_Complete_Receiving_Packets.json'],
      ['original_workshare','Freeform_Complete_Case_and_Operating_Handover_20261012.zip']]){
      const descriptor=inputs[alias];
      const phaseName='attach-'+alias.replaceAll('_','-');
      const attached=await call(phaseName,'source_attach',{...sourceArgs(caseId),expectedVersion:current.program.version,
        input:{hostInput:alias},expectedInputSha256:descriptor.sha256,
        requestId:requestId(phaseName),actor:ACTOR,filename,kind:'work',mediaType:descriptor.mediaType,
        sourceUrl:'https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8ALYESLB',
        observedAt:originalWorkshare.workshare_input.source.observed_at});
      attachments[alias]={sourceId:attached.value.recordId,sha256:descriptor.sha256};
      current=(await call('read-case-after-'+alias.replaceAll('_','-'),'case',sourceArgs(caseId))).value;
    }
    const selection={...sourceArgs(caseId),expectedVersion:current.program.version,
      sourceId:attachments.commissioning.sourceId,expectedSourceSha256:attachments.commissioning.sha256,
      packetSourceId:attachments.packets.sourceId,expectedPacketSha256:attachments.packets.sha256};
    const inventory=await call('read-original-workshare-inventory','installation_workshares',selection);
    const selected=inventory.value.cases.find(row=>row.caseId===prepared.caseId);
    need(selected&&selected.planSha256===prepared.planSha256&&selected.hours==='64'&&selected.phaseCount===6&&
      selected.commercial.amount==='8800'&&selected.commercial.currency==='USD'&&selected.commercial.price_status==='PROPOSED',
      'Keep the complete original six-phase commercial Workshare and its sixty-four-hour allocation.');
    const seeded=await call('prepare-complete-workshare-installation','installation_workshare_seed',{
      ...selection,workshareCaseId:prepared.caseId,installationId:null,expectedRevision:0});
    const document=clone(seeded.value.document);
    const phaseChecks=new Map(document.workshare.phaseChecks.map(row=>[row.phaseId,row.checkId]));
    need(phaseChecks.size===6&&document.checks.length===originalCase.plan.scenario.future_costs.length+6,
      'Retain all original commercial phases and funded-plan criteria.');
    for(const phase of plan.phases){
      const check=document.checks.find(row=>row.id===phaseChecks.get(phase.id));
      need(check?.criterion===phase.acceptance&&check.title===phase.title&&check.state==='OPEN',
        'Receive each original phase criterion as its actual open commissioning step.');
    }
    document.stage='PLANNED';
    document.task.request=plan.outcome+'\n\n'+plan.phases.map(phase=>phase.title+'\n'+phase.description).join('\n\n');
    document.task.completeOutput=plan.phases.map(phase=>phase.title+': '+phase.acceptance).join('\n\n');
    document.task.repeatTrigger='A later original source capture or reviewed scope correction. '+plan.schedule.follow_on;
    document.source.population='Quoted customer cohort: '+plan.phases.find(row=>row.id==='intake').description;
    document.source.meaning=plan.phases.find(row=>row.id==='mapping').description;
    document.source.sourceIds=[...new Set([...document.source.sourceIds,attachments.original_workshare.sourceId])];
    document.receiving.application='Original CAMWS association operations application and CiviCRM API4 transaction extension';
    document.receiving.acceptanceRule=plan.phases.find(row=>row.id==='handover').acceptance;
    document.receiving.changeAndWithdraw=plan.change_process;
    document.receiving.recovery=plan.phases.find(row=>row.id==='native').description;
    document.receiving.maintenance=plan.schedule.follow_on+' '+plan.rights;
    document.receiving.sourceIds=[attachments.original_workshare.sourceId,attachments.packets.sourceId];
    document.assignments.costIds=[];
    document.assignments.note='Original phase effort belongs to this proposed commercial workorder. '+
      'Select an original funded package when it applies to this installation and record each worked hour once. '+
      plan.estimate.assumptions;
    await exactFile(join(options.work,'installation-edition-1-input.json'),json(document));
    const preview1=await call('preview-edition-1','installation_preview',{...sourceArgs(caseId),
      expectedVersion:current.program.version,installationId:null,expectedRevision:0,inputs:document});
    const saved1=await call('save-edition-1','installation_save',{...sourceArgs(caseId),
      expectedVersion:current.program.version,installationId:null,expectedRevision:0,inputs:document,
      expectedPreviewSha256:preview1.value.previewSha256,requestId:requestId('save-edition-1'),actor:ACTOR,
      note:'Receive the complete saved Freeform Workshare, original phase allocation and customer operating handover.'});
    const installationId=saved1.value.recordId;
    const edition1=await readEdition('read-edition-1','source',caseId,installationId,1);
    const replay1=await call('recover-edition-1-save','installation_save',saved1.request.args);
    need(stable(replay1.value)===stable(saved1.value),'Reopen the same original Installation save.');
    const export1=await call('export-edition-1','export',{...sourceArgs(caseId),kind:'installation',installationId,revision:1},true);
    await exactFile(join(options.work,'delivery','Freeform_Workshare_Installation_Edition_1.zip'),export1.bytes);
    const afterFirst=(await call('read-case-after-edition-1','case',sourceArgs(caseId))).value;
    const next=clone(edition1.value.preview.document);
    next.receiving.changeAndWithdraw+=' In the Installation desk, retain '+installationId+
      ' and its saved history. Receive a complete revised Workshare source into a new edition when original scope or phases change.';
    next.receiving.recovery+=' Reopen the original source and saved installation before recovering a save with its original request ID.';
    next.receiving.maintenance+=' The complete receiving archive includes the original thirty-member case and application handover, '+
      'commercial phase source, funding-plan history and every saved Installation edition.';
    const refresh=await call('refresh-original-workshare-for-edition-2','installation_workshare_seed',{
      ...selection,expectedVersion:afterFirst.program.version,workshareCaseId:prepared.caseId,
      installationId,expectedRevision:1,inputs:next});
    need(refresh.value.workshare.resetPhaseIds.length===0&&
      stable(refresh.value.document.workshare)===stable(document.workshare),
      'Refreshing the unchanged original source must preserve its complete phase bindings.');
    const nextDocument=refresh.value.document;
    await exactFile(join(options.work,'installation-edition-2-input.json'),json(nextDocument));
    const preview2=await call('preview-edition-2','installation_preview',{...sourceArgs(caseId),
      expectedVersion:afterFirst.program.version,installationId,expectedRevision:1,inputs:nextDocument});
    const saved2=await call('save-edition-2','installation_save',{...sourceArgs(caseId),
      expectedVersion:afterFirst.program.version,installationId,expectedRevision:1,inputs:nextDocument,
      expectedPreviewSha256:preview2.value.previewSha256,requestId:requestId('save-edition-2'),actor:ACTOR,
      note:'Complete onward source refresh, saved-operation recovery and maintainer receiving instructions.'});
    const edition2=await readEdition('read-edition-2','source',caseId,installationId,2);
    const reopened1=await readEdition('reopen-original-edition-1','source',caseId,installationId,1);
    need(stable(withoutCurrent(edition1.value))===stable(withoutCurrent(reopened1.value)),
      'The original first edition must remain unchanged.');
    const page1=await call('history-page-1','installation_history',{...sourceArgs(caseId),installationId,limit:1});
    const page2=await call('history-page-2','installation_history',{...sourceArgs(caseId),installationId,
      before:page1.value.nextBefore,limit:1});
    need(page1.value.editions[0]?.revision===2&&page1.value.nextBefore===2&&
      page2.value.editions[0]?.revision===1&&page2.value.nextBefore===null,'Retain the complete two-edition history.');
    const export2=await call('export-edition-2','export',{...sourceArgs(caseId),kind:'installation',installationId,revision:2},true);
    await exactFile(join(options.work,'delivery','Freeform_Workshare_Installation_Edition_2.zip'),export2.bytes);
    await provider.close();
    provider=new MerchantGrantWorkspaces(providerOptions);
    const receivingBinding=workspaces.workspaces.find(value=>value.workspace==='receiving');
    await provider.call('merchant_grant_open',{workspace:'receiving',expectedSelectionSha256:receivingBinding.selectionSha256});
    const received=await call('receive-selected-edition','case_import',{workspace:'receiving',
      input:{snapshotId:export2.snapshot.id,sourceWorkspace:'source'},expectedInputSha256:export2.snapshot.file.sha256,
      name:'Freeform Workshare Installation — complete independent receiving',
      requestId:requestId('receive-selected-edition'),actor:ACTOR});
    const receivingCaseId=received.value.id;
    need(received.value.selectedInstallation?.id===installationId&&received.value.selectedInstallation?.revision===2,
      'The original selected edition must reopen with the entire received case.');
    const received1=await readEdition('read-received-edition-1','receiving',receivingCaseId,installationId,1);
    const received2=await readEdition('read-received-edition-2','receiving',receivingCaseId,installationId,2);
    for(const [left,right] of [[edition1.value,received1.value],[edition2.value,received2.value]])
      need(stable(withoutCurrent(left))===stable(withoutCurrent(right)),'Receiving must preserve every complete saved edition.');
    const finalCase=(await call('read-complete-received-case','case',{workspace:'receiving',caseId:receivingCaseId})).value;
    need(stable(finalCase.records)===stable(originalCase.records)&&
      finalCase.plan.contentSha256===originalCase.plan.contentSha256,'Retain all original records and the selected grant plan.');
    const sourceFiles=[];
    for(const [alias,selectedSource] of Object.entries(attachments)){
      const exported=await call('receive-original-'+alias.replaceAll('_','-'),'export',{
        workspace:'receiving',caseId:receivingCaseId,kind:'source',sourceId:selectedSource.sourceId},true);
      need(sha(exported.bytes)===selectedSource.sha256&&exported.bytes.equals(await readFile(inputs[alias].file)),
        'Retain each complete original Workshare file unchanged during independent receiving.');
      sourceFiles.push({sourceId:selectedSource.sourceId,bytes:exported.bytes.length,sha256:selectedSource.sha256});
    }
    const receivedExport=await call('export-complete-received-edition','export',{workspace:'receiving',
      caseId:receivingCaseId,kind:'installation',installationId,revision:2},true);
    await exactFile(join(options.work,'delivery','Freeform_Workshare_Installation_Received_Edition_2.zip'),receivedExport.bytes);
    const importReplay=await call('recover-selected-edition-import','case_import',received.request.args);
    need(stable(importReplay.value)===stable(received.value),'Recover the same original case receiving request.');
    delivery={operation:OPERATION,actor:ACTOR,originalInputs:sourceManifest,sourceCaseId:caseId,
      receivingCaseId,installationId,workshareCaseId:prepared.caseId,worksharePlanSha256:prepared.planSha256,
      savedWorkshareId:prepared.savedWorkshareId,savedScopeId:prepared.savedScopeId,phaseHours:prepared.phaseHours,
      editions:[brief(edition1.value),brief(edition2.value)],originalCounts:originalCounts(originalCase),
      receivingCounts:originalCounts(finalCase),planContentSha256:originalCase.plan.contentSha256,
      originalSourceFiles:sourceFiles,selectedInstallation:received.value.selectedInstallation,
      files:[['Freeform_Workshare_Installation_Edition_1.zip',export1.bytes],
        ['Freeform_Workshare_Installation_Edition_2.zip',export2.bytes],
        ['Freeform_Workshare_Installation_Received_Edition_2.zip',receivedExport.bytes]].map(([name,bytes])=>
          ({name,path:join(options.work,'delivery',name),bytes:bytes.length,sha256:sha(bytes)}))};
  }finally{await provider.close();}
  const cliArgs=['-B',join(HERE,'cli.py'),'operations','--workspace',dirs.receiving,'--scenario',options.scenario];
  const cli=(name,more)=>{
    const result=spawnSync(options.python,[...cliArgs,name,...more],{encoding:'utf8',timeout:120000,
      maxBuffer:8*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    need(!result.error&&result.status===0,'Original Installation CLI failed: '+(result.error?.message||result.stderr));
    return JSON.parse(result.stdout);
  };
  const cliShow=cli('installation-show',['--case',delivery.receivingCaseId,'--installation',delivery.installationId,'--revision','2']);
  need(cliShow.sha256===delivery.editions[1].sha256,'The original CLI reopened another saved edition.');
  await exactFile(join(options.work,'delivery','Freeform_Workshare_Installation_CLI_Reopen.json'),json(cliShow));
  const cliHistory=cli('installation-history',['--case',delivery.receivingCaseId,'--installation',delivery.installationId,'--limit','100']);
  need(cliHistory.editions.length===2&&cliHistory.nextBefore===null,'Reopen the complete original Installation history.');
  await exactFile(join(options.work,'delivery','Freeform_Workshare_Installation_CLI_History.json'),json(cliHistory));
  const cliZip=join(options.work,'delivery','Freeform_Workshare_Installation_CLI_Export.zip');
  const cliRequest={operation:OPERATION,phase:'cli-export',caseId:delivery.receivingCaseId,
    installationId:delivery.installationId,revision:2,editionSha256:delivery.editions[1].sha256,
    argv:['--case',delivery.receivingCaseId,'--installation',delivery.installationId,'--revision','2','--output',cliZip]};
  await exactFile(join(phaseRoot,'cli-export.request.json'),json(cliRequest));
  const commandFile=join(phaseRoot,'cli-export.command-result.json');
  let commandBytes=await optional(commandFile);
  if(!await optional(cliZip)){
    need(!commandBytes,'The original completed CLI export file must be restored with its saved command result.');
    const commandResult=cli('installation-export',cliRequest.argv);
    commandBytes=json(commandResult);await exactFile(commandFile,commandBytes);
  }
  const completeCase=delivery.files.find(file=>file.name==='Freeform_Workshare_Installation_Received_Edition_2.zip');
  const cliArchive=runPython(options.python,
    "import runpy,sys,json\nsys.path.insert(0,sys.argv[1])\nm=runpy.run_path(sys.argv[2])\n"+
    "print(json.dumps(m['verify_cli_export'](sys.argv[3],sys.argv[4],sys.argv[5],sys.argv[6],int(sys.argv[7]),sys.argv[8])))",
    [HERE,join(HERE,'workshare-installation-inputs.py'),cliZip,completeCase.path,
      delivery.receivingCaseId,delivery.installationId,'2',delivery.editions[1].sha256]);
  const cliExport={...cliRequest,archive:cliArchive,originalCommand:commandBytes?JSON.parse(commandBytes):null};
  await exactFile(join(phaseRoot,'cli-export.complete.json'),json(cliExport));
  const cliBytes=await readFile(cliZip);
  need(cliBytes.length===cliArchive.bytes&&sha(cliBytes)===cliArchive.sha256,'The received original CLI archive changed.');
  delivery.cli={showSha256:cliShow.sha256,historyEditions:cliHistory.editions.length,export:cliExport};
  delivery.files.push({name:'Freeform_Workshare_Installation_CLI_Export.zip',path:cliZip,bytes:cliBytes.length,sha256:sha(cliBytes)});
  const opening='# Freeform Workshare Installation\n\n'+
    'Open Freeform_Workshare_Installation_Edition_2.zip and its installation.html for the complete selected customer workorder. '+
    'Import the entire ZIP through Delivery operations → Import complete case. Its selected second edition, original first edition, '+
    'complete saved Freeform case/application handover, commercial source, funding-plan history and original eight purchases reopen together.\n\n'+
    'The six original commercial phases remain joined to their exact saved Workshare. Implementation and support retain their original dates and conditions. '+
    'Continue the open customer assignments in the existing Installation editor and append a new edition as actual work proceeds.\n\n'+
    'Independent receiving workspace: '+dirs.receiving+'\n\nInstallation: '+delivery.installationId+
    '\n\nWorkshare case: '+delivery.workshareCaseId+'\n\nOperation: '+OPERATION+'\n\n'+
    'Continue the same command with the same work directory. Its complete original phase requests and native snapshots recover the same saves and imports.\n';
  await exactFile(join(options.work,'delivery','OPEN_Freeform_Workshare_Installation.md'),Buffer.from(opening));
  for(const name of ['Freeform_Workshare_Installation_CLI_Reopen.json','Freeform_Workshare_Installation_CLI_History.json',
    'OPEN_Freeform_Workshare_Installation.md']){
    const path=join(options.work,'delivery',name),raw=await readFile(path);
    delivery.files.push({name,path,bytes:raw.length,sha256:sha(raw)});
  }
  await exactFile(join(options.work,'result.json'),json({...delivery,state:'COMPLETE'}));
  process.stdout.write(JSON.stringify({operation:OPERATION,state:'COMPLETE',
    result:join(options.work,'result.json'),installationId:delivery.installationId,files:delivery.files})+'\n');
}
main().catch(error=>{process.stderr.write(JSON.stringify({operation:OPERATION,state:'INTERRUPTED',
  code:error.code||error.name,message:error.message,status:error.status,
  exitCode:error.exitCode,signal:error.signal,diagnostics:error.diagnostics})+'\n');process.exitCode=1;});
