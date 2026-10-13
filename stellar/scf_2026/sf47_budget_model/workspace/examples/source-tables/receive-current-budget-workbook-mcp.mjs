#!/usr/bin/env node
// MIT. Continue the original complete workbook case through Merchant MCP and native receiving.
import {constants,createReadStream} from 'node:fs';
import {mkdir,readFile,open,link,unlink,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inflateRawSync} from 'node:zlib';
import {inspectGrantAgentBinding} from '../../agent-client.mjs';
import {GRANT_TRANSFER_CHUNK_BYTES} from '../../agent-contracts.mjs';
import {importPlanningBook,preparePlanningImport,rebasePlanningBook} from '../../source-tables-core.mjs';
import {receivePlanningFile} from '../../../../../../stellar-forge/developer-site/dist/grant-plan-source.mjs';
import {MerchantGrantWorkspaces,GRANT_WORKSPACE_CONNECTION_SCHEMA}
  from '../../../../../../stellar-forge/mcp-merchant-operator/grant-workspace.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),nativeCli=resolve(HERE,'../../cli.py'),
  execute=promisify(execFile),SCHEMA='stellar-forge.planning-workbook-mcp.receiving.v1';
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,message)=>{if(!value)throw new Error(message);};
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const inflate=(raw,maximum)=>new Uint8Array(inflateRawSync(raw,{maxOutputLength:Math.max(1,maximum)}));
const selectedPlan=value=>value?.plan?.id?value.plan:value;
const selectedSourceRevision=source=>source.document.revisions.find(row=>row.revision===source.document.currentRevision);
const sourceReference=(result,pointer,workspace)=>({
  input:{snapshotId:result.id,...(workspace?{sourceWorkspace:workspace}:{})},
  expectedInputSha256:result.file.sha256,...(pointer?{inputPointer:pointer}:{}),
});
async function privateDirectory(path){
  await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&await realpath(path)===path,
    'Use the original private receiving directory without links: '+path);
  return path;
}
async function fileIdentity(path){
  const info=await lstat(path);need(info.isFile()&&!info.isSymbolicLink(),'Keep the complete original file: '+path);
  const digest=createHash('sha256');
  for await(const bytes of createReadStream(path))digest.update(bytes);
  return {bytes:info.size,sha256:digest.digest('hex')};
}
async function publishOnce(path,value){
  if(await exists(path))return readJson(path);
  const pending=path+'.pending-'+randomUUID(),fd=await open(pending,'wx',0o600);
  try{await fd.writeFile(json(value));await fd.sync();}finally{await fd.close();}
  try{
    try{await link(pending,path);}catch(error){if(error.code!=='EEXIST')throw error;}
    const directory=await open(dirname(path),constants.O_RDONLY|(constants.O_DIRECTORY??0));
    try{await directory.sync();}finally{await directory.close();}
    return readJson(path);
  }finally{await unlink(pending).catch(()=>{});}
}
async function receiveSnapshot(provider,descriptor,destination){
  need(descriptor?.retention?.state==='COMPLETE'&&descriptor.id&&descriptor.file?.sha256,
    'Retain the complete original snapshot before continuing its customer operation.');
  const expected=descriptor.file;
  if(await exists(destination)){
    const found=await fileIdentity(destination);
    need(found.bytes===expected.bytes&&found.sha256===expected.sha256,
      'The saved original output differs from its selected snapshot: '+destination);
    return destination;
  }
  const pending=destination+'.part';
  let offset=0;
  if(await exists(pending)){
    const info=await lstat(pending);
    need(info.isFile()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&info.size<=expected.bytes,
      'Keep the original private partial file: '+pending);
    offset=info.size;
  }
  const fd=await open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|(constants.O_NOFOLLOW??0),0o600);
  let readId;
  try{
    while(offset<expected.bytes){
      const result=await provider.call('merchant_grant_file_read',{
        workspace:descriptor.workspace,snapshotId:descriptor.id,expectedSha256:expected.sha256,
        offset,limit:GRANT_TRANSFER_CHUNK_BYTES,...(readId?{readId}:{}),
      });
      const bytes=Buffer.from(result.data,'base64');
      need(result.offset===offset&&result.bytesRead===bytes.length&&result.file.sha256===expected.sha256&&
        bytes.length>0&&offset+bytes.length<=expected.bytes,'Continue the exact original retained byte sequence.');
      await fd.writeFile(bytes);offset+=bytes.length;readId=result.nextOffset===null?undefined:result.readId;
      need(result.nextOffset===null?offset===expected.bytes:result.nextOffset===offset,
        'The original reader must retain its complete byte position.');
    }
    await fd.sync();
  }finally{
    await fd.close();
    if(readId)await provider.call('merchant_grant_file_release',{
      workspace:descriptor.workspace,snapshotId:descriptor.id,readId,
    }).catch(()=>{});
  }
  const actual=await fileIdentity(pending);
  need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,
    'The complete received file must match its original byte count and SHA256: '+pending);
  try{await link(pending,destination);}catch(error){
    if(error.code!=='EEXIST')throw error;
    const winner=await fileIdentity(destination);
    need(winner.bytes===expected.bytes&&winner.sha256===expected.sha256,'Another output already owns this original path.');
  }
  await unlink(pending);
  return destination;
}
async function native(python,args){
  try{return JSON.parse((await execute(python,[nativeCli,...args],{
    encoding:'utf8',maxBuffer:128*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},
  })).stdout);}
  catch(error){throw new Error(String(error.stderr||error.message));}
}
function verifyBudget(plan){
  need(plan?.id&&String(plan.scenario.award_request_usd)==='38095'&&
    String(plan.report.capacity.totalHours)==='401'&&plan.scenario.future_costs.length===6,
    'Continue the original fully reviewed 401-hour, $38,095 workbook case.');
}
async function checkpointOriginalCase(options,python,context){
  const configured=options.checkpointHelper??process.env.SF47_WORKBOOK_MCP_CHECKPOINT_HELPER;
  if(configured===undefined)return;
  need(typeof configured==='string'&&configured.length>0,'Select the original complete-case checkpoint helper.');
  const selected=resolve(configured),info=await lstat(selected);
  need(info.isFile()&&!info.isSymbolicLink()&&await realpath(selected)===selected,
    'Use the original regular complete-case checkpoint helper.');
  const directory=await privateDirectory(join(context.directory,'mcp-receiving','checkpoints')),
    path=join(directory,context.phase+'.json');
  const matches=value=>value?.schema===SCHEMA+'.checkpoint'&&value.state==='COMPLETE'&&
    value.operationId===context.operationId&&value.phase===context.phase&&
    value.originalContentSha256===context.originalContentSha256&&
    value.handoverArchiveSha256===context.handoverArchiveSha256&&
    Number.isSafeInteger(value.archive?.bytes)&&value.archive.bytes>0&&
    /^[0-9a-f]{64}$/.test(value.archive?.sha256);
  if(await exists(path)){
    need(matches(await readJson(path)),'Receive the checkpoint of this same complete original handover.');
    return;
  }
  const result=await new Promise((resolveResult,rejectResult)=>{
    const child=execFile(python,[selected],{encoding:'utf8',maxBuffer:1024*1024},
      (error,stdout,stderr)=>{
        if(error){rejectResult(Object.assign(new Error('Complete-case preservation returned before receiving its saved result.'),
          {code:'WORKBOOK_MCP_CHECKPOINT',cause:error,details:stderr.slice(-2000)}));return;}
        try{resolveResult(JSON.parse(stdout));}catch(error){rejectResult(error);}
      });
    child.stdin.on('error',()=>{});
    child.stdin.end(json(context));
  });
  need(matches(result),'The checkpoint helper must return its complete original case archive.');
  await publishOnce(path,result);
  process.stdout.write('WORKBOOK_MCP_CHECKPOINT '+json({
    phase:context.phase,archive:result.archive,location:result.location,
  }).trim()+'\n');
}

export async function receiveCurrentBudgetWorkbookMcp(directory,options={}){
  process.umask(0o077);
  const root=await realpath(resolve(directory)),original=await readJson(join(root,'WORKBOOK_HANDOVER_RECEIVING.json'));
  need(original.schema==='stellar-forge.planning-workbook-handover.receiving.v1'&&
    original.nativePortableOutputComplete&&original.received?.contentSha256,
    'Select the completed original native workbook customer case.');
  const files={
    native:join(root,'final-workbook-handover','planning.zip'),
    returned:join(root,'returned-workbook.xlsx'),
    workbook:join(root,'final-workbook-handover','planning.xlsx'),
    mapping:join(root,'final-workbook-handover','mappings','packages.json'),
    returnProfile:join(root,'RETURN_PROFILE.json'),
    exportProfile:join(root,'FINAL_WORKBOOK_PROFILE.json'),
  };
  const inputs={};
  for(const [name,path]of Object.entries(files))inputs[name]={path:relative(root,path),...await fileIdentity(path)};
  const originalZip=await receivePlanningFile(new Uint8Array(await readFile(files.native)),{filename:'planning.zip',inflate});
  need(selectedSourceRevision(originalZip)?.contentSha256===original.received.contentSha256,
    'The continuation must receive the exact native plan retained by the original case.');
  const area=await privateDirectory(join(root,'mcp-receiving')),
    phases=await privateDirectory(join(area,'phases')),output=await privateDirectory(join(area,'outputs')),
    exportsDirectory=await privateDirectory(join(area,'retained')),authoring=join(area,'authoring'),receiving=join(area,'receiving');
  const identity={schema:SCHEMA,originalContentSha256:original.received.contentSha256,inputs},
    recorded=await publishOnce(join(area,'INPUTS.json'),identity);
  need(json(recorded)===json(identity),'Resume this operation with its original complete case inputs and profiles.');
  const completed=join(area,'WORKBOOK_MCP_RECEIVING.json');
  if(await exists(completed)){
    const result=await readJson(completed);
    need(result.schema===SCHEMA&&result.state==='COMPLETE'&&result.originalContentSha256===identity.originalContentSha256,
      'Keep the original completed workbook operation.');
    for(const file of result.delivery.files){
      const actual=await fileIdentity(join(area,file.path));
      need(actual.bytes===file.bytes&&actual.sha256===file.sha256,'The complete delivered file changed: '+file.path);
    }
    return result;
  }
  const python=options.pythonExecutable??String((await execute('python3',['-c','import sys;print(sys.executable)'],
    {encoding:'utf8',maxBuffer:4096})).stdout).trim();
  need(python.startsWith('/'),'Select the actual original Python executable.');
  const phaseNames=[];
  async function phase(name,operation){
    const path=join(phases,name+'.json'),resumed=await exists(path);
    let value;
    if(resumed)value=await readJson(path);
    else{
      const returned=await operation();
      if(returned?.retention&&returned.retention.state!=='COMPLETE'){
        const partial=join(phases,name+'.retention-'+randomUUID()+'.json');
        await publishOnce(partial,returned);
        throw Object.assign(new Error(returned.retention.recovery||
          'The original operation returned; finish retaining its complete files before the next phase.'),{code:'WORKBOOK_MCP_RETENTION'});
      }
      value=await publishOnce(path,returned);
    }
    phaseNames.push(name);process.stdout.write('WORKBOOK_MCP_PHASE '+json({phase:name,resumed}).trim()+'\n');
    return value;
  }
  const restoreArgs=['import-bundle','--workspace',authoring,'--file',files.native,
    '--name','Merchant continuation of the complete returned workbook plan',
    '--request-id','current-budget-workbook-mcp-restore'];
  const restore=await phase('01-native-case-restored',()=>native(python,restoreArgs));
  const restored=selectedPlan(restore);
  const baseline=await native(python,['show','--workspace',authoring,'--plan',restored.id,
    '--revision',String(restored.revision),'--part','all']);
  need(baseline.contentSha256===original.received.contentSha256,
    'The exact original saved baseline must remain in the receiving workspace.');
  // A lost save response may already have advanced the current revision. Its
  // complete preview and original request are retained before dispatch below.
  verifyBudget(baseline);
  await phase('02-receiving-workspace-created',()=>native(python,['init','--workspace',receiving]));
  const rawReturnProfile=await readJson(files.returnProfile),exportProfile=await readJson(files.exportProfile);
  let provider,bindings;
  async function openProvider(){
    const a=await inspectGrantAgentBinding({directory:authoring,pythonExecutable:python,allowStart:true,
      label:'Original workbook Merchant continuation'});
    const b=await inspectGrantAgentBinding({directory:receiving,pythonExecutable:python,allowStart:true,
      label:'Complete workbook native receiving'});
    const fileBindings=Object.fromEntries(['returned','workbook','mapping'].map(name=>[name,{
      file:files[name],sha256:inputs[name].sha256,label:name,kind:'original',
      mediaType:name==='mapping'?'application/json':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }]));
    bindings={authoring:{...a,inputs:fileBindings},receiving:{...b,inputs:{}}};
    provider=new MerchantGrantWorkspaces({exportsDirectory,
      grantWorkspaces:{schema:GRANT_WORKSPACE_CONNECTION_SCHEMA,workspaces:bindings}});
    await provider.call('merchant_grant_open',{workspace:'authoring',expectedSelectionSha256:a.selectionSha256});
    await provider.call('merchant_grant_open',{workspace:'receiving',expectedSelectionSha256:b.selectionSha256});
  }
  const tool=(suffix,args={})=>provider.call('merchant_grant_'+suffix,{workspace:'authoring',...args});
  const retainedJson=async(descriptor,name)=>readJson(await receiveSnapshot(provider,descriptor,join(output,name+'.json')));
  try{
    await openProvider();
    const initial=await phase('03-complete-source-snapshot',()=>tool('source_snapshot',{
      planId:baseline.id,revision:baseline.revision,expectedContentSha256:baseline.contentSha256,
    }));
    const first=await retainedJson(initial,'original-complete-source-project');
    need(first.book.workbookSources.length===original.received.workbookSources&&
      first.book.workbookSelections.length===original.received.worksheetSelections,
      'The original workbook editions and all worksheet selections must reach Merchant MCP.');
    const originalBook=await importPlanningBook(first.book);
    const inspection=await phase('04-original-workbook-inspected',()=>tool('workbook_inspect',{
      file:{input:{hostInput:'returned'},expectedInputSha256:inputs.returned.sha256},
    }));
    await retainedJson(inspection,'returned-workbook-inspection');
    const projected=await phase('05-explicit-worksheet-projected',()=>tool('workbook_project',{
      file:{input:{hostInput:'workbook'},expectedInputSha256:inputs.workbook.sha256},
      mappingInput:{input:{hostInput:'mapping'},expectedInputSha256:inputs.mapping.sha256},
    }));
    await retainedJson(projected,'complete-native-workbook-projection');
    const supplied=await phase('06-original-projection-received',()=>tool('source_workbook_receive',{
      project:sourceReference(initial,'/book'),role:'packages',selection:sourceReference(projected),
    }));
    await retainedJson(supplied,'project-with-explicit-worksheet');
    const returned=await phase('07-complete-returned-workbook',()=>tool('source_workbook_return',{
      project:sourceReference(supplied,'/book'),
      file:{input:{hostInput:'returned'},expectedInputSha256:inputs.returned.sha256},profile:rawReturnProfile,
    }));
    await retainedJson(returned,'complete-returned-source-project');
    const configured=await phase('08-original-planning-choices',()=>tool('source_configure',{
      project:sourceReference(returned,'/book'),settings:{
        scenarioName:baseline.scenario.scenario_name,awardRequestUsd:String(baseline.scenario.award_request_usd),
        projectEndDay:baseline.scenario.project_end_day,
      },
    }));
    const comparison=await phase('09-complete-package-source-review',()=>tool('source_read',{
      project:sourceReference(configured,'/book'),role:'packages',
    }));
    await retainedJson(comparison,'complete-package-source-review');
    const reviewed=await phase('10-four-role-source-review',()=>tool('source_review',{
      project:sourceReference(configured,'/book'),roles:['packages','milestones','contributors','assignments'],
    }));
    const review=await retainedJson(reviewed,'reviewed-complete-source-project');
    for(const source of originalBook.workbookSources)
      need(review.book.workbookSources.some(item=>item.id===source.id&&item.sha256===source.sha256),
        'Retain each complete original workbook source while receiving its next actual edition.');
    const preview=await phase('11-complete-native-preview',()=>tool('source_preview',{
      project:sourceReference(reviewed,'/book'),
    }));
    const fullPreview=await retainedJson(preview,'complete-native-preview');
    verifyBudget({...fullPreview.native,id:baseline.id});
    need(fullPreview.review.sourceRows.length===16&&fullPreview.review.sourceRows.every(row=>row.workbook),
      'Every original planning row must retain its selected workbook cell provenance.');
    const saveArgs=await publishOnce(join(phases,'native-save-input.json'),{
      preview:sourceReference(preview),
      note:'Reviewed the complete original returned workbook through Merchant MCP, including all source editions, four collections and native delivery/cash result.',
      requestId:'current-budget-workbook-mcp-reviewed-save',
    });
    const saved=await phase('12-reviewed-native-save',()=>tool('source_save',saveArgs));
    const savedPlan=selectedPlan(await retainedJson(saved,'saved-complete-native-plan'));verifyBudget(savedPlan);
    need(savedPlan.id===baseline.id&&savedPlan.revision>baseline.revision,
      'The complete reviewed source operation must save its successor on the original received plan.');
    const savedReplay=await phase('12b-original-native-save-reopened',()=>tool('source_save',saveArgs));
    const replayPlan=selectedPlan(await retainedJson(savedReplay,'replayed-complete-native-plan'));
    need(replayPlan.id===savedPlan.id&&replayPlan.revision===savedPlan.revision&&
      replayPlan.contentSha256===savedPlan.contentSha256,'The original review request must reopen its same native save.');
    const exactEarlier=await phase('13-earlier-native-revision-export',()=>tool('export',{
      kind:'plan',planId:baseline.id,revision:baseline.revision,
    }));
    const earlierPath=await receiveSnapshot(provider,exactEarlier,join(output,'earlier-selected-planning.zip'));
    const earlier=await receivePlanningFile(new Uint8Array(await readFile(earlierPath)),{filename:'planning.zip',inflate});
    need(earlier.document.currentRevision===baseline.revision&&selectedSourceRevision(earlier)?.contentSha256===baseline.contentSha256,
      'The earlier exact native revision must remain selected after the complete source save.');
    const handoverArgs=await publishOnce(join(phases,'workbook-handover-input.json'),{
      planId:savedPlan.id,revision:savedPlan.revision,expectedContentSha256:savedPlan.contentSha256,
      profile:exportProfile,requestId:'current-budget-workbook-mcp-handover',
    });
    const handover=await phase('14-complete-workbook-handover',()=>tool('workbook_handover',handoverArgs));
    need(handover.retention.state==='COMPLETE'&&handover.originalMemberCount===15&&handover.files.length===4,
      'Receive the complete workbook archive and all four original member files.');
    // Retained files are independent of the native workspace processes. Close
    // both original writers before preserving or receiving the complete handover.
    await provider.close();provider=null;
    await checkpointOriginalCase(options,python,{
      schema:SCHEMA+'.checkpoint-request',operationId:'SCF-WORKBOOK-MCP-CEDAR-8047-20261012',
      phase:'14-complete-workbook-handover',directory:root,
      originalContentSha256:identity.originalContentSha256,
      handoverArchiveSha256:handover.archive.file.sha256,
    });
    provider=new MerchantGrantWorkspaces({exportsDirectory,
      grantWorkspaces:{schema:GRANT_WORKSPACE_CONNECTION_SCHEMA,workspaces:bindings}});
    const delivered=[];
    async function collect(descriptor,filename){
      const path=await receiveSnapshot(provider,descriptor,join(output,filename));
      const actual=await fileIdentity(path);delivered.push({path:relative(area,path),...actual});
      return path;
    }
    await collect(handover.archive,'complete-workbook-handover.zip');
    for(const file of handover.files)await collect(file,file.name);
    const manifest=await readJson(join(output,'WORKBOOK_EXPORT.json'));
    need(manifest.source?.id===savedPlan.id&&manifest.source.revision===savedPlan.revision&&
      manifest.source.contentSha256===savedPlan.contentSha256,
      'The complete workbook manifest must identify the selected saved native edition.');
    await provider.close();provider=null;
    await openProvider();
    const reopened=await tool('workbook_handover',handoverArgs);
    need(reopened.archive.id===handover.archive.id&&reopened.archive.file.sha256===handover.archive.file.sha256&&
      json(reopened.files.map(file=>[file.name,file.id,file.file.sha256]))===
        json(handover.files.map(file=>[file.name,file.id,file.file.sha256])),
      'A new Merchant process must reopen the same completed handover and all original files.');
    await phase('15-reopened-complete-handover',async()=>({
      requestId:handoverArgs.requestId,archive:reopened.archive.file,files:reopened.files.map(file=>({name:file.name,...file.file})),
    }));
    const nativeMember=handover.files.find(file=>file.name==='planning.zip'),
      projectMember=handover.files.find(file=>file.name==='planning-source-project.json');
    const received=await phase('16-native-plan-received',()=>tool('plan_import',{
      workspace:'receiving',kind:'plan',input:{snapshotId:nativeMember.id,sourceWorkspace:'authoring'},
      expectedInputSha256:nativeMember.file.sha256,
      name:'Complete workbook source operation received from Merchant',
      requestId:'current-budget-workbook-mcp-native-receive',
    }));
    const receivedPlan=selectedPlan(await retainedJson(received,'received-complete-native-plan'));verifyBudget(receivedPlan);
    need(receivedPlan.contentSha256===savedPlan.contentSha256,
      'The complete independently received native plan must preserve its reviewed source content.');
    const rebased=await phase('17-complete-source-project-rebased',()=>tool('source_rebase',{
      workspace:'receiving',project:sourceReference(projectMember,undefined,'authoring'),
      planId:receivedPlan.id,revision:receivedPlan.revision,expectedContentSha256:receivedPlan.contentSha256,
    }));
    const receivedProject=await retainedJson(rebased,'received-complete-source-project');
    const nativeReceived=await phase('18-received-native-preview',()=>tool('source_preview',{
      workspace:'receiving',project:sourceReference(rebased,'/book'),
    }));
    const receivedPreview=await retainedJson(nativeReceived,'received-complete-native-preview');
    verifyBudget({...receivedPreview.native,id:receivedPlan.id});
    need(receivedPreview.review.sourceRows.length===16&&receivedPreview.review.sourceRows.every(row=>row.workbook),
      'The next receiving operator must retain every original source row and workbook cell.');
    const sourceSelection={
      authoring:bindings.authoring.selectionSha256,receiving:bindings.receiving.selectionSha256,
      programmeSha256:hash(await readFile(fileURLToPath(import.meta.url))),
    };
    await provider.close();provider=null;
    const cold=await phase('19-native-cli-reopened',()=>native(python,[
      'show','--workspace',receiving,'--plan',receivedPlan.id,'--part','all',
    ]));
    verifyBudget(cold);
    need(cold.contentSha256===savedPlan.contentSha256,'The cold native CLI must reopen the same complete reviewed plan.');
    const coldBook=await importPlanningBook(cold.planning.sourceTables),
      coldPrepared=await preparePlanningImport(rebasePlanningBook(coldBook,cold));
    need(coldPrepared.review.sourceRows.length===16&&coldPrepared.review.sourceRows.every(row=>row.workbook),
      'Cold native receiving must preserve the full source project and original cell provenance.');
    const result={schema:SCHEMA,state:'COMPLETE',completedAt:new Date().toISOString(),
      operationId:'SCF-WORKBOOK-MCP-CEDAR-8047-20261012',
      originalContentSha256:identity.originalContentSha256,sourceSelection,phases:phaseNames,
      original:{id:baseline.id,revision:baseline.revision,contentSha256:baseline.contentSha256,
        workbookSources:originalBook.workbookSources.length,worksheetSelections:originalBook.workbookSelections.length},
      saved:{id:savedPlan.id,revision:savedPlan.revision,contentSha256:savedPlan.contentSha256,
        hours:String(savedPlan.report.capacity.totalHours),awardRequestUsd:String(savedPlan.scenario.award_request_usd),
        sourceRows:fullPreview.review.sourceRows.length,allRowsRetainWorkbookCells:true},
      receiving:{id:cold.id,revision:cold.revision,contentSha256:cold.contentSha256,
        workbookSources:coldBook.workbookSources.length,worksheetSelections:coldBook.workbookSelections.length,
        deliveredWorkbookSources:receivedProject.book.workbookSources.length,
        sourceRows:coldPrepared.review.sourceRows.length,allRowsRetainWorkbookCells:true},
      exactEarlierRevision:earlier.document.currentRevision,identicalNativeSaveReplay:true,
      reopenedOriginalHandover:true,nativeCliReopened:true,
      delivery:{requestId:handoverArgs.requestId,originalMemberCount:15,files:delivered},
    };
    return await publishOnce(completed,result);
  }finally{if(provider)await provider.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]||process.argv[2]==='--help')process.stdout.write(
    'node receive-current-budget-workbook-mcp.mjs COMPLETE_NATIVE_CASE_DIRECTORY\n');
  else receiveCurrentBudgetWorkbookMcp(process.argv[2]).then(value=>process.stdout.write(json(value)))
    .catch(error=>{process.stderr.write(json({error:{message:error.message,code:error.code}}));process.exitCode=1;});
}
