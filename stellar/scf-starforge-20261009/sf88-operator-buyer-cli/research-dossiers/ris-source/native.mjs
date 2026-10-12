#!/usr/bin/env node
// MIT. One complete original Research RIS operator, Merchant and cold-receiving programme.
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isAbsolute,resolve,join,relative,sep} from 'node:path';
import {parseArgs} from 'node:util';
import {openDossierStore} from '../dossier.mjs';
import {startDossierWorkspace} from '../server.mjs';
import {ResearchWorkspaceClient} from '../workspace-client.mjs';
import {main as workspaceMain} from '../workspace-cli.mjs';
import {privateDirectory,need} from '../../node/store.mjs';
import {createRisSource,inspectRisSource,decodeBase64,valueSha} from './schema.mjs';
import {prepareRisReview} from './review.mjs';
import {runRisSourcesBrowser} from './browser-journey.mjs';
import {runRisSourcesMerchant} from './merchant-journey.mjs';
import {nativeJson,nativeSha,nativeRead,nativeWrite,nativeSame,nativePath,openRisNativeJournal} from './native-support.mjs';

const PREFIX='stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/';
const SOURCE_PACKET={bytes:6578,sha256:'a468739354d5b543712b583226f934dc63bbba29769d2c327df4c54876174413'};
const ORIGINALS=[
  {suffix:'gkad1085',bytes:818,sha256:'303a2af8a2c0ebf550e31642d4e9705bce08eb0037e4b62f0a59219ad1a75a71'},
  {suffix:'gkad1088',bytes:803,sha256:'0b23b1517129ae3261ec222f78a83f2abce1412eb8464c3ee8680350d51841cc'}
];
const SCHEMA='sf88-research-ris-native-selection-v1',COMPLETE='sf88-research-ris-native-complete-v1';
const stamp=()=>new Date().toISOString();
function absolute(path){need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'RIS_NATIVE_ABSOLUTE_PATH_REQUIRED');return path;}
async function checked(row,{ordinarySource=false}={}){
  const bytes=await nativeRead(absolute(row.file),{ordinarySource});
  need(bytes.length===row.bytes&&nativeSha(bytes)===row.sha256,'RIS_NATIVE_SELECTED_FILE_CHANGED');return bytes;
}
async function processIdentity(pid){
  try{const text=await readFile('/proc/'+pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);
    return {pid,startTicks:fields[19],state:fields[0]};}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function childAlive(identity){
  if(!identity?.pid)return false;const current=await processIdentity(identity.pid);
  return Boolean(current&&current.startTicks===identity.startTicks&&!['Z','X'].includes(current.state));
}
async function originalChild(journal,name,argv){
  const prior=journal.state.values.children?.[name];
  need(!await childAlive(prior),'RIS_NATIVE_ORIGINAL_CHILD_STILL_RUNNING');
  const retained=await journal.recover(name+'-result.json');if(retained)return JSON.parse(retained);
  let child,closed,closeResult,stdout='',stderr='';
  try{
    child=spawn(process.execPath,argv,{stdio:['pipe','pipe','pipe'],env:{...process.env},cwd:journal.directory});
    closed=new Promise((resolve,reject)=>{
      child.once('error',reject);child.once('close',(code,signal)=>{closeResult={code,signal};resolve(closeResult);});
    });
    // Attach a handler immediately while identity/ownership persistence proceeds.
    closed.catch(()=>{});
    const maximum=64*1024*1024;
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',data=>{stdout+=data;if(Buffer.byteLength(stdout)>maximum)child.kill('SIGTERM');});
    child.stderr.on('data',data=>{stderr+=data;if(Buffer.byteLength(stderr)>maximum)child.kill('SIGTERM');});
    need(Number.isInteger(child.pid)&&child.pid>0,'RIS_NATIVE_CHILD_START_FAILED');
    const identity=await processIdentity(child.pid);
    journal.state.values.children??={};journal.state.values.children[name]={
      pid:child.pid,startTicks:identity?.startTicks??null,startedAt:stamp(),argv,stage:'RUNNING'};
    await journal.save();
    const exit=await closed;
    journal.state.values.children[name].exit=exit;journal.state.values.children[name].stage='EXITED';
    await journal.save();
    need(Buffer.byteLength(stdout)<=maximum&&Buffer.byteLength(stderr)<=maximum,'RIS_NATIVE_CHILD_OUTPUT_LIMIT');
    await journal.retain(exit.code===0?name+'-stderr.txt':name+'-failed-'+nativeSha(Buffer.from(stderr))+'.txt',Buffer.from(stderr));
    need(exit.code===0,'RIS_NATIVE_CHILD_FAILED');
    const lines=stdout.trim().split('\n'),result=JSON.parse(lines.at(-1));
    await journal.retain(name+'-result.json',nativeJson(result));return result;
  }finally{
    if(child){
      child.stdin.destroy();
      if(!closeResult){
        child.kill('SIGTERM');
        await Promise.race([closed.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,1500))]);
        if(!closeResult){child.kill('SIGKILL');await closed.catch(()=>{});}
      }
    }
  }
}
async function engineSelection(selection){
  const root=absolute(selection.engine.root),actualRoot=fileURLToPath(new URL('../../../../../',import.meta.url));
  need(resolve(actualRoot)===root,'RIS_NATIVE_LOADED_ENGINE_CHANGED');
  const bytes=await checked(selection.engine.manifest,{ordinarySource:true}),manifest=JSON.parse(bytes);
  need(manifest.schema==='sf88-research-ris-engine-source-v1'&&Array.isArray(manifest.files)&&
    manifest.sourceFiles===manifest.files.length&&new Set(manifest.files.map(row=>row.path)).size===manifest.files.length,
    'RIS_NATIVE_ENGINE_MANIFEST_CHANGED');
  let total=0;
  for(const row of manifest.files){
    need(['100644','100755'].includes(row.mode)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&
      /^[a-f0-9]{64}$/.test(row.sha256),'RIS_NATIVE_ENGINE_FILE_INVALID');
    const data=await nativeRead(nativePath(root,row.path),{ordinarySource:true});need(data.length===row.bytes&&nativeSha(data)===row.sha256,
      'RIS_NATIVE_ENGINE_SOURCE_CHANGED');total+=data.length;
  }
  need(total===manifest.sourceBytes,'RIS_NATIVE_ENGINE_SIZE_CHANGED');
  const required=['LICENSE',PREFIX+'dossier.mjs',PREFIX+'workspace-client.mjs',PREFIX+'server.mjs',
    PREFIX+'public/app.js',PREFIX+'public/index.html',PREFIX+'ris-source/native.mjs',
    PREFIX+'ris-source/reopen.mjs',PREFIX+'ris-source/browser-journey.mjs',PREFIX+'ris-source/merchant-journey.mjs',
    PREFIX+'ris-source/package.py',PREFIX+'ris-source/OPERATING_GUIDE.md',PREFIX+'ris-source/RECEIVING_GUIDE.md',
    'stellar-forge/mcp-merchant-operator/research-workspace.mjs','stellar-forge/mcp-merchant-operator/research-ris.mjs'];
  for(const path of required)need(manifest.files.some(row=>row.path===path),'RIS_NATIVE_ENGINE_MEMBER_MISSING');
  return {bytes,manifest,summary:{manifestSHA:nativeSha(bytes),manifestBytes:bytes.length,files:manifest.files.length,bytes:total}};
}
function sourceInput(packet,preparedAt){
  need(packet.schema==='commons.original-ris-source-packet/v1'&&packet.documents.length===2,'RIS_NATIVE_ORIGINAL_PACKET_CHANGED');
  const terms='Original Crossref bibliographic metadata and observed HTTP provenance. These files contain no abstract or full text. Preserve the original source attribution and record-specific rights.';
  const documents=ORIGINALS.map(expected=>{
    const row=packet.documents.find(item=>item.source_url.endsWith('/'+expected.suffix+'/transform/application/x-research-info-systems'));
    // Native Crossref source URLs contain the DOI path rather than a synthetic provider ID.
    const selected=row??packet.documents.find(item=>item.source_url.includes('/10.1093/nar/'+expected.suffix+'/'));
    need(selected&&selected.status===200&&selected.bytes===expected.bytes&&selected.sha256===expected.sha256&&
      selected.source_url===selected.final_url&&Array.isArray(selected.headers),'RIS_NATIVE_ORIGINAL_RESPONSE_CHANGED');
    const raw=decodeBase64(selected.body_base64);
    need(raw.length===expected.bytes&&nativeSha(raw)===expected.sha256,'RIS_NATIVE_ORIGINAL_RESPONSE_BYTES_CHANGED');
    return {filename:'crossref-'+expected.suffix+'.ris',encoding:'utf-8',
      declaration:{database:'Crossref',query:'DOI 10.1093/nar/'+expected.suffix,exportedAt:null,
        retrievedAt:selected.retrieved_at,url:selected.source_url,sourceReference:selected.source_url,sourceTerms:terms,
        notes:'Complete original RIS response. No Content-Type header was present in the observed response.',
        provenance:structuredClone(selected)},bytes:expected.bytes,sha256:expected.sha256,bodyBase64:selected.body_base64};
  });
  const original=documents[0];
  documents.push({...structuredClone(original),filename:'crossref-gkad1085-local-copy.ris',
    declaration:{...structuredClone(original.declaration),
      retrievedAt:null,sourceReference:'Declared local byte-identical copy of crossref-gkad1085.ris',
      notes:'This is an explicitly declared local copy of the retained 818-byte original. It is not another HTTP response or database acquisition.',
      provenance:{kind:'local-byte-copy',createdAt:preparedAt,originalFilename:original.filename,
        originalBodySha256:original.sha256,originalSourceUrl:original.declaration.url}}});
  return {label:'Crossref original RIS baseline',preparedAt,sourceReference:'Original two-response Crossref RIS packet '+SOURCE_PACKET.sha256,
    sourceTerms:terms,documents};
}
export async function runRisNative(selection){
  need(selection?.schema===SCHEMA&&typeof selection.operationId==='string'&&
    /^[A-Za-z0-9._:-]{8,128}$/.test(selection.operationId),'RIS_NATIVE_SELECTION_REQUIRED');
  const runDirectory=absolute(selection.runDirectory),workspaceDirectory=join(runDirectory,'private','workspace');
  need(absolute(selection.runtime.node)===resolve(process.execPath),'RIS_NATIVE_NODE_SELECTION_CHANGED');
  for(const path of [selection.runtime.python,selection.runtime.playwrightModule,selection.runtime.chromiumExecutable])absolute(path);
  need(Number.isInteger(selection.port)&&selection.port>=0&&selection.port<=65535,'RIS_NATIVE_PORT_INVALID');
  need(nativeSame({bytes:selection.originalResponses.bytes,sha256:selection.originalResponses.sha256},SOURCE_PACKET),
    'RIS_NATIVE_ORIGINAL_PACKET_SELECTION_CHANGED');
  const engine=await engineSelection(selection),packetBytes=await checked(selection.originalResponses,{ordinarySource:true}),packet=JSON.parse(packetBytes);
  const journal=await openRisNativeJournal(join(runDirectory,'native'),selection);
  const {state}=journal;
  const finish=async result=>{
    for(const row of result.files){const data=await nativeRead(nativePath(runDirectory,row.file));
      need(data.length===row.bytes&&nativeSha(data)===row.sha256,'RIS_NATIVE_DELIVERY_FILE_CHANGED');}
    await nativeWrite(join(runDirectory,'RIS_NATIVE_COMPLETE.json'),nativeJson(result));
    await journal.finish(result);return result;
  };
  if(state.stage==='COMPLETE')return finish(state.result);
  if(state.values.deliveryResult)return finish(state.values.deliveryResult);
  let server,client;
  try{
    await privateDirectory(join(runDirectory,'private'));
    await journal.retain('engine-source-manifest.json',engine.bytes);
    await privateDirectory(join(runDirectory,'original-inputs'));
    await nativeWrite(join(runDirectory,'original-inputs','original-ris-http-responses.json'),packetBytes);
    const input=sourceInput(packet,state.startedAt),prepared=createRisSource(input);
    for(const document of input.documents)
      await nativeWrite(join(runDirectory,'original-inputs',document.filename),decodeBase64(document.bodyBase64));
    await journal.retain('baseline-source.json',prepared.bytes);
    const store=await openDossierStore(workspaceDirectory);
    const title='Original RIS receiving · '+selection.operationId;
    const description='Complete retained Crossref RIS source review and receiving. Native operation '+selection.operationId+
      '. Original response packet '+SOURCE_PACKET.sha256+'.';
    if(!state.values.dossierId){
      const all=await store.list(),matches=all.filter(row=>row.title===title&&row.description===description);
      need(matches.length<=1&&all.length===matches.length,'RIS_NATIVE_PRIVATE_DOSSIER_SELECTION_CHANGED');
      const created=matches[0]??await store.create({title,description,projection:'metadata'});
      state.values.dossierId=created.id;await journal.save();
    }
    const dossierId=state.values.dossierId;
    let metadata=await store.getMetadata(dossierId);
    need(metadata.title===title&&metadata.description===description,'RIS_NATIVE_SEED_DOSSIER_CHANGED');
    if(!state.values.questionId){
      const text='How do the retained Crossref RIS records, declared duplicate occurrence and explicit source selections continue through an editable Research handover?';
      if(!state.values.questionRequest){
        need(metadata.questions.length===0,'RIS_NATIVE_QUESTION_ALREADY_PRESENT');
        state.values.questionRequest={text,expectedRevision:metadata.revision};await journal.save();
      }
      const selected=state.values.questionRequest;
      if(metadata.revision===selected.expectedRevision)
        metadata=await store.addQuestion(dossierId,{...selected,projection:'metadata'});
      else metadata=await store.getMetadata(dossierId,{revision:selected.expectedRevision+1});
      need(metadata.revision===selected.expectedRevision+1&&metadata.questions.length===1&&metadata.questions[0].text===text,
        'RIS_NATIVE_ORIGINAL_QUESTION_CHANGED');
      state.values.questionId=metadata.questions[0].id;await journal.save();
    }
    const questionId=state.values.questionId;
    server=await startDossierWorkspace({directory:workspaceDirectory,port:state.values.port??selection.port,
      extractionPython:selection.runtime.python,clinicalTrialsPython:selection.runtime.python});
    if(state.values.port!==undefined)need(Number(new URL(server.origin).port)===state.values.port,'RIS_NATIVE_ORIGINAL_ORIGIN_CHANGED');
    else{state.values.port=Number(new URL(server.origin).port);state.values.workspaceId=server.workspaceId;await journal.save();}
    need(server.workspaceId===state.values.workspaceId,'RIS_NATIVE_ORIGINAL_WORKSPACE_CHANGED');
    const connectionFile=join(runDirectory,'private','application-url.json');
    await nativeWrite(connectionFile,nativeJson({url:server.url}),{replace:true});
    client=new ResearchWorkspaceClient({url:server.url,directory:workspaceDirectory,expectedWorkspaceId:server.workspaceId});
    await client.status();const ris=client.risSources();
    if(!state.values.baselineRequest){
      const review={requestId:selection.operationId+':baseline',questionId,actor:'Commons literature operations',
        reviewedAt:state.startedAt,records:[],duplicates:[],acknowledgedDiagnostics:[],previous:null};
      const first=prepareRisReview(prepared,review),choices=structuredClone(first.review);
      const duplicate=new Set();
      for(const group of first.groups)for(const id of group.recordIds.slice(1))duplicate.add(id);
      choices.records=choices.records.map(row=>({...row,selected:!duplicate.has(row.recordId),classification:'background',
        note:duplicate.has(row.recordId)?'Declared local duplicate; preserve its complete source occurrence without selecting it twice.':
          'Selected original bibliography for source operations and handover context; this is metadata triage, not study eligibility.'}));
      choices.duplicates=first.groups.map(group=>({groupId:group.id,decision:'choose',
        reason:'Select the original retained occurrence; preserve the explicit local byte-identical copy as an unselected source occurrence.'}));
      const reviewed=prepareRisReview(prepared,choices,{complete:true});
      const head=await client.metadata(dossierId);
      state.values.baselineRequest={source:prepared.descriptor,review:reviewed.review,
        expectedPlanSha256:reviewed.planSha256,expectedRevision:head.revision};await journal.save();
    }
    const baselineRequest=state.values.baselineRequest;
    await ris.prepare(dossierId,{source:input,review:baselineRequest.review});
    const baseline=await ris.receive(dossierId,baselineRequest);
    need(baseline.receipt.requestId===baselineRequest.review.requestId&&nativeSame(baseline.receipt.source,prepared.descriptor)&&
      baseline.receipt.planSha256===baselineRequest.expectedPlanSha256&&
      baseline.receipt.inputSha256===valueSha({source:prepared.descriptor,review:baselineRequest.review}),
      'RIS_NATIVE_BASELINE_RECEIPT_CHANGED');
    if(state.values.baselineReceipt)need(nativeSame(state.values.baselineReceipt,baseline.receipt),'RIS_NATIVE_BASELINE_RECEIPT_CHANGED');
    else{state.values.baselineReceipt=baseline.receipt;await journal.save();}
    const baselineReceipt=baseline.receipt;
    await journal.retain('baseline-request.json',nativeJson(baselineRequest));
    await journal.retain('baseline-receipt.json',nativeJson(baselineReceipt));
    state.stage='BROWSER';await journal.save();
    const browser=await runRisSourcesBrowser({url:server.url,workspaceDirectory,runDirectory,dossierId,questionId,
      baselineSource:prepared.source,baselineRequest,baselineReceipt,
      playwrightModule:selection.runtime.playwrightModule,chromiumExecutable:selection.runtime.chromiumExecutable});
    need(browser.request&&browser.receipt?.questionId===questionId&&browser.currentRevision===browser.receipt.revision,
      'RIS_NATIVE_BROWSER_RECEIVING_REQUIRED');
    const {receipt,request}=browser;
    const saved=await ris.sources(dossierId,{requestId:receipt.requestId});
    need(nativeSame(saved.receipt,receipt)&&receipt.inputSha256===valueSha({source:request.source,review:request.review})&&
      receipt.planSha256===request.expectedPlanSha256,'RIS_NATIVE_BROWSER_RECEIPT_CHANGED');
    const browserSummary={receipt,request,beforeRevision:browser.beforeRevision,afterRevision:browser.afterRevision,
      currentRevision:browser.currentRevision,steps:browser.steps};
    await journal.retain('browser-result.json',nativeJson(browserSummary));
    await journal.retain('reviewed-request.json',nativeJson(request));
    await journal.retain('reviewed-receipt.json',nativeJson(receipt));
    const revision=receipt.revision;
    await journal.captureFile('reviewed-source.json',{editionId:receipt.editionId,revision,source:receipt.source},
      file=>ris.export(dossierId,{file,editionId:receipt.editionId,revision,format:'source',expectedSha256:receipt.source.sha256}),
      data=>{need(data.length===receipt.source.bytes&&nativeSha(data)===receipt.source.sha256,'RIS_NATIVE_REVIEWED_SOURCE_CHANGED');inspectRisSource(data);});
    state.stage='CLI';await journal.save();
    const cli=async(name,args,check=()=>{})=>{
      const file='cli-'+name+'.json',old=await journal.recover(file);
      if(old){const value=JSON.parse(old);check(value);return value;}
      const argv=[...args,'--connection-file',connectionFile,'--directory',workspaceDirectory,'--id',dossierId];
      let output='';const value=await workspaceMain(argv,{output:{write:text=>{output+=String(text);return true;}}});
      const parsed=JSON.parse(output);check(parsed);
      await journal.retain(file,nativeJson(parsed));return value??parsed;
    };
    await cli('list',['ris-list','--revision',String(revision),'--limit','1'],
      value=>need(value.total===2&&value.nextOffset===1,'RIS_NATIVE_CLI_PAGE_CHANGED'));
    await cli('list-next',['ris-list','--revision',String(revision),'--offset','1','--limit','1'],
      value=>need(value.items.length===1&&value.nextOffset===null,'RIS_NATIVE_CLI_PAGE_CHANGED'));
    await cli('review',['ris-review','--edition',receipt.editionId,'--revision',String(revision),'--limit','100'],
      value=>need(value.complete&&nativeSame(value.receipt,receipt)&&value.records.length===3,'RIS_NATIVE_CLI_REVIEW_CHANGED'));
    await cli('request',['ris-request','--request',receipt.requestId],
      value=>need(nativeSame(value.receipt,receipt),'RIS_NATIVE_CLI_RECEIPT_CHANGED'));
    const previewInput=journal.path('reviewed-preview-input.json');
    await journal.retain('reviewed-preview-input.json',nativeJson({source:request.source,review:request.review}));
    await cli('preview',['ris-preview','--input',previewInput],
      value=>need(value.duplicate&&nativeSame(value.receipt,receipt),'RIS_NATIVE_CLI_PREVIEW_CHANGED'));
    await cli('replay',['ris-receive','--input',journal.path('reviewed-request.json')],
      value=>need(value.duplicate&&nativeSame(value.receipt,receipt),'RIS_NATIVE_CLI_REPLAY_CHANGED'));
    await cli('compare',['ris-compare','--before',baselineReceipt.editionId,'--after',receipt.editionId,
      '--revision',String(revision),'--section','changed','--limit','100'],
      value=>need(value.counts.added===0&&value.counts.absent===0&&value.counts.changed===2,'RIS_NATIVE_CLI_COMPARISON_CHANGED'));
    await journal.captureFile('cli-review.csv',{editionId:receipt.editionId,revision,format:'csv'},
      async file=>{
        let output='';await workspaceMain(['ris-export','--connection-file',connectionFile,'--directory',workspaceDirectory,
          '--id',dossierId,'--edition',receipt.editionId,'--revision',String(revision),'--format','csv','--out',file],
          {output:{write:text=>{output+=String(text);return true;}}});
        const value=JSON.parse(output);need(value.editionId===receipt.editionId&&value.revision===revision,'RIS_NATIVE_CLI_EXPORT_CHANGED');
      },async data=>{
        const expected=await store.exportRis(dossierId,{editionId:receipt.editionId,revision,format:'csv'});
        need(data.equals(expected.bytes),'RIS_NATIVE_CLI_EXPORT_CHANGED');
      });
    state.stage='MERCHANT';await journal.save();
    const merchant=await runRisSourcesMerchant({url:server.url,workspaceDirectory,runDirectory,workspaceId:server.workspaceId,
      dossierId,questionId,baselineReceipt,baselineRequest,receipt,request,sourceFile:journal.path('reviewed-source.json'),
      sourceSha256:receipt.source.sha256});
    await journal.retain('merchant-result.json',nativeJson({...merchant,nativeOutputs:merchant.nativeOutputs}));
    state.stage='ORIGINAL_EXPORTS';await journal.save();
    const reports=[];
    for(const [label,selected]of [['before',baselineReceipt.revision],['reviewed',receipt.revision],['current',revision]]){
      for(const format of ['html','md','json','json.gz']){
        const name='Research_Dossier_'+label+'.'+format;
        const descriptor=await journal.captureFile(name,{dossierId,revision:selected,format},
          file=>client.exportDossier(dossierId,{file,revision:selected,format}),
          async data=>{
            if(format==='html'||format==='md'){
              const expected=await store.exportDossier(dossierId,{revision:selected,format});
              need(data.equals(Buffer.from(expected.body)),'RIS_NATIVE_REPORT_CHANGED');
            }else if(format==='json'){
              const parsed=JSON.parse(data);need(parsed.id===dossierId&&parsed.versions.at(-1)?.state.revision===selected,
                'RIS_NATIVE_PORTABLE_HEAD_CHANGED');
            }else need(data.length>2&&data[0]===0x1f&&data[1]===0x8b,'RIS_NATIVE_GZIP_REQUIRED');
          });
        if(format==='html'||format==='md')reports.push({...descriptor,file:journal.path(name),format,revision:selected});
      }
    }
    const finalMetadata=await client.metadata(dossierId);
    need(finalMetadata.revision===revision,'RIS_NATIVE_UNEXPECTED_DOSSIER_MUTATION');
    await journal.retain('final-metadata.json',nativeJson(finalMetadata));
    const file=name=>({...state.artifacts[name],file:journal.path(name)});
    const coldSelection={schema:'sf88-research-ris-cold-reopen-v1',operationId:selection.operationId,runDirectory,dossierId,
      questionId,baselineReceipt,receipt,currentRevision:revision,python:selection.runtime.python,
      portableJson:file('Research_Dossier_current.json'),portableGzip:file('Research_Dossier_current.json.gz'),
      metadata:file('final-metadata.json'),reports};
    await journal.retain('cold-selection.json',nativeJson(coldSelection));
    await client.close();client=null;await server.close();server=null;
    state.stage='COLD_REOPEN';await journal.save();
    const cold=await originalChild(journal,'cold',[fileURLToPath(new URL('./reopen.mjs',import.meta.url)),
      '--selection',journal.path('cold-selection.json'),'--parent-lifetime']);
    need(cold.schema==='sf88-research-ris-cold-reopen-v1'&&cold.dossierId===dossierId&&cold.currentRevision===revision&&
      cold.continued.revision===revision+1,'RIS_NATIVE_COLD_REOPEN_CHANGED');
    const rows=new Map();
    const add=async(path,expected,kind)=>{
      const name=relative(runDirectory,path).split(sep).join('/');
      need(name&&!name.startsWith('../')&&!name.startsWith('private/')&&!isAbsolute(name),'RIS_NATIVE_PRIVATE_OUTPUT_SELECTED');
      const bytes=await nativeRead(path);
      need(bytes.length===expected.bytes&&nativeSha(bytes)===expected.sha256,'RIS_NATIVE_OUTPUT_CHANGED');
      const row={file:name,bytes:bytes.length,sha256:nativeSha(bytes),kind},old=rows.get(name);
      need(!old||nativeSame(old,row),'RIS_NATIVE_DUPLICATE_OUTPUT_CHANGED');rows.set(name,row);
    };
    for(const row of await journal.verify())await add(row.path,row,'native-operation');
    for(const row of browser.artifacts)await add(row.path,row,'browser-operation');
    const browserJournal=await nativeRead(browser.journalPath);
    await add(browser.journalPath,{bytes:browserJournal.length,sha256:nativeSha(browserJournal)},'browser-history');
    for(const row of merchant.nativeOutputs)await add(row.path,row,'merchant-operation');
    for(const row of cold.nativeOutputs)await add(row.path,row,'cold-receiving');
    for(const document of input.documents){
      await add(join(runDirectory,'original-inputs',document.filename),document,'original-ris-document');
    }
    await add(join(runDirectory,'original-inputs','original-ris-http-responses.json'),SOURCE_PACKET,'original-provider-receipts');
    const result={schema:COMPLETE,operationId:selection.operationId,workspaceId:state.values.workspaceId,dossierId,questionId,
      baselineReceipt,receipt,beforeRevision:baselineReceipt.revision,reviewedRevision:receipt.revision,currentRevision:revision,
      sourceSelection:{packet:SOURCE_PACKET,documents:input.documents.map(({filename,bytes,sha256,declaration})=>
        ({filename,bytes,sha256,declaration})),localCopyDeclared:true},
      engine:engine.summary,browser:{journalPath:'browser/journey.json',steps:browser.steps},
      merchant:{replay:merchant.replay,historyUnchanged:merchant.historyUnchanged,exports:merchant.exports},
      cold:{json:cold.json,gzip:cold.gzip,continued:cold.continued,tamper:cold.tamper},
      files:[...rows.values()].sort((a,b)=>a.file.localeCompare(b.file))};
    const frozen= nativeJson(result);
    await nativeWrite(join(runDirectory,'native','FINAL_DELIVERY_SELECTION.json'),frozen);
    result.files.push({file:'native/FINAL_DELIVERY_SELECTION.json',bytes:frozen.length,sha256:nativeSha(frozen),kind:'frozen-delivery-selection'});
    state.values.deliveryResult=result;await journal.save();
    return await finish(result);
  }catch(error){await journal.failed(error);throw error;}
  finally{try{if(client)await client.close();}finally{if(server)await server.close();}}
}
export async function main(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{selection:{type:'string'}},strict:true});
  need(values.selection,'RIS_NATIVE_SELECTION_FILE_REQUIRED');
  const selection=JSON.parse(await nativeRead(resolve(values.selection)));
  const result=await runRisNative(selection);process.stdout.write(JSON.stringify(result)+'\n');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'RIS_NATIVE_FAILED'})+'\n');process.exitCode=1;});
