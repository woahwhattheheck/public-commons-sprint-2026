// MIT. One original Merchant receiving phase for already-saved Europe PMC editions and review.
import {readFile,mkdir,lstat,open,rename,unlink,link} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {validateEuropePmcPortable} from './europe-pmc-workspace.mjs';
import {MerchantResearchWorkspaces} from '../../../../stellar-forge/mcp-merchant-operator/research-workspace.mjs';

const SCHEMA='sf88-europe-pmc-merchant-journey.v1',ALIAS='europe-pmc';
const now=()=>new Date().toISOString();
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const digest=value=>createHash('sha256').update(value).digest('hex');
const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
async function existing(path){try{return await readFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomic(path,data){
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{
    try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
    await rename(temporary,path);
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function exclusive(path,data){
  const old=await existing(path);
  if(old){need(old.length===data.length&&digest(old)===digest(data),'EUROPE_PMC_MERCHANT_ARTIFACT_CHANGED');return;}
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{
    try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
    try{await link(temporary,path);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const retained=await readFile(path);need(retained.length===data.length&&digest(retained)===digest(data),'EUROPE_PMC_MERCHANT_ARTIFACT_CHANGED');
    }
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

/**
 * Continue the parent's original listener and native lifetime. This hook reads
 * the saved editions, replays the exact saved review and retains original exports.
 * It does not acquire provider data or create another review.
 */
export async function runEuropePmcMerchant({
  url,workspaceDirectory,runDirectory,workspaceId,library,selected,reviewRequest,queryId,dossierId
}){
  const connection=new URL(url),token=new URLSearchParams(connection.hash.slice(1)).get('token');
  need(connection.protocol==='http:'&&connection.hostname==='127.0.0.1'&&connection.port&&
    !connection.username&&!connection.password&&/^[a-f0-9]{64}$/.test(token||''),'EUROPE_PMC_MERCHANT_ORIGINAL_LISTENER_REQUIRED');
  for(const path of [workspaceDirectory,runDirectory])need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,
    'EUROPE_PMC_MERCHANT_ABSOLUTE_DIRECTORY_REQUIRED');
  need(typeof library==='string'&&/^(original|received-[a-f0-9]{64})$/.test(library)&&
    /^epq_[a-f0-9]{64}$/.test(queryId||'')&&/^d_[a-f0-9-]{36}$/.test(dossierId||''),
    'EUROPE_PMC_MERCHANT_ORIGINAL_SELECTION_REQUIRED');
  if(workspaceId!==undefined)need(/^research_[a-f0-9]{64}$/.test(workspaceId),'EUROPE_PMC_MERCHANT_WORKSPACE_REQUIRED');
  const choices=['baseline','expanded'].map(label=>{
    const row=selected?.[label];
    need(row&&/^epop_[a-f0-9]{64}$/.test(row.operationId||'')&&
      /^[a-f0-9]{64}$/.test(row.planSha256||'')&&/^[a-f0-9]{64}$/.test(row.editionSha256||'')&&
      row.queryId===queryId&&[row.queryRevision,row.editionBytes,row.records,row.pages].every(Number.isSafeInteger)&&
      row.queryRevision>=1&&row.editionBytes>0&&row.records>=0&&row.pages>=0,
      'EUROPE_PMC_MERCHANT_ORIGINAL_EDITION_REQUIRED');
    return {label,...row};
  });
  need(choices[0].operationId!==choices[1].operationId&&reviewRequest&&
    reviewRequest.operationId===selected.expanded.operationId&&
    reviewRequest.editionSha256===selected.expanded.editionSha256&&
    typeof reviewRequest.recordKey==='string'&&typeof reviewRequest.actor==='string'&&
    /^[A-Za-z0-9._:-]{8,160}$/.test(reviewRequest.requestId||'')&&
    Number.isSafeInteger(reviewRequest.expectedRevision)&&reviewRequest.expectedRevision>=0&&
    !Object.hasOwn(reviewRequest,'workspace')&&!Object.hasOwn(reviewRequest,'library'),
    'EUROPE_PMC_MERCHANT_ORIGINAL_REVIEW_REQUEST_REQUIRED');
  const input={workspaceDirectory,origin:connection.origin,library,selected,queryId,dossierId,
    expectedWorkspaceId:workspaceId??null,requestSha256:digest(bytes(canonical(reviewRequest)))};
  const originalUrl=new URL('/',connection.origin);originalUrl.hash='token='+token;
  const directory=join(runDirectory,'europe-pmc-merchant');
  await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);need(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,
    'EUROPE_PMC_MERCHANT_PRIVATE_DIRECTORY_REQUIRED');
  const statePath=join(directory,'operation.json'),prior=await existing(statePath);
  const state=prior?JSON.parse(prior.toString('utf8')):{schema:SCHEMA,input,createdAt:now(),stage:'PREPARED',
    attempts:[],attachments:[],exports:{},artifacts:{},preparedArtifacts:{},sourceEditions:[]};
  need(state.schema===SCHEMA&&same(state.input,input),'EUROPE_PMC_MERCHANT_ORIGINAL_OPERATION_CHANGED');
  const save=async()=>{
    const encoded=bytes(state);need(!encoded.includes(Buffer.from(token)),'EUROPE_PMC_MERCHANT_SESSION_IN_REPORT');
    await atomic(statePath,encoded);
  };
  const descriptor=(filename,data)=>({filename,bytes:data.length,sha256:digest(data)});
  const readArtifact=async name=>{
    const data=await existing(join(directory,name)),selected=state.artifacts[name]||state.preparedArtifacts[name];
    if(!data){need(!state.artifacts[name],'EUROPE_PMC_MERCHANT_ARTIFACT_MISSING');return null;}
    need(selected&&selected.filename===name&&data.length===selected.bytes&&digest(data)===selected.sha256,
      'EUROPE_PMC_MERCHANT_ARTIFACT_CHANGED');
    need(!data.includes(Buffer.from(token)),'EUROPE_PMC_MERCHANT_SESSION_IN_REPORT');
    if(!state.artifacts[name]){state.artifacts[name]=selected;await save();}
    return data;
  };
  const retain=async(name,data)=>{
    need(/^[a-z0-9][a-z0-9._-]+$/.test(name)&&!name.includes('..'),'EUROPE_PMC_MERCHANT_ARTIFACT_NAME');
    data=Buffer.isBuffer(data)?data:bytes(data);
    const selected=descriptor(name,data),old=await readArtifact(name);
    if(old){need(same(state.artifacts[name],selected),'EUROPE_PMC_MERCHANT_ARTIFACT_CHANGED');return state.artifacts[name];}
    need(!state.preparedArtifacts[name]||same(state.preparedArtifacts[name],selected),'EUROPE_PMC_MERCHANT_PREPARED_ARTIFACT_CHANGED');
    need(!data.includes(Buffer.from(token)),'EUROPE_PMC_MERCHANT_SESSION_IN_REPORT');
    state.preparedArtifacts[name]=selected;await save();
    await exclusive(join(directory,name),data);state.artifacts[name]=selected;await save();return selected;
  };
  const outputs=()=>Object.values(state.artifacts).map(item=>({...item,path:join(directory,item.filename)}));
  const verifyArtifacts=async()=>{for(const name of Object.keys(state.artifacts))await readArtifact(name);};
  const finish=async()=>{
    await retain('europe-pmc-merchant-completed-operation.json',state.finalSelection);
    state.result=state.finalSelection;state.stage='COMPLETE';await save();await verifyArtifacts();
    return {...state.result,nativeOutputs:outputs()};
  };
  if(state.stage==='COMPLETE'){await verifyArtifacts();return {...state.result,nativeOutputs:outputs()};}
  if(state.finalSelection)return finish();

  const attempt={startedAt:now(),stage:state.stage};state.attempts.push(attempt);await save();
  let merchant,attachment;
  try{
    const root=fileURLToPath(new URL('../../../../',import.meta.url));
    const prefix='stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/';
    const paths=[prefix+'europe-pmc-merchant.mjs',prefix+'workspace-client.mjs',
      prefix+'europe-pmc-client.mjs',prefix+'europe-pmc-workspace.mjs',
      'stellar-forge/mcp-merchant-operator/research-workspace.mjs',
      'stellar-forge/mcp-merchant-operator/research-europe-pmc.mjs',
      'stellar-forge/mcp-merchant-operator/catalog/research-workspace.mjs',
      'stellar-forge/mcp-merchant-operator/catalog/research-europe-pmc.mjs'];
    const pins=[];
    for(const path of paths){const data=await readFile(join(root,path));pins.push({path,bytes:data.length,sha256:digest(data)});}
    const fingerprint=digest(bytes(pins));
    if(state.sourceEditions.at(-1)?.fingerprint!==fingerprint)state.sourceEditions.push({fingerprint,selectedAt:now(),files:pins});
    attempt.sourceFingerprint=fingerprint;await save();
    await retain('europe-pmc-merchant-original-review-request.json',reviewRequest);
    const connectionFile=join(directory,'connection.private.json');
    await atomic(connectionFile,bytes({url:originalUrl.href}));
    merchant=new MerchantResearchWorkspaces({
      researchWorkspaces:{workspaces:{[ALIAS]:{label:'Europe PMC research editions',
        consoleUrlFile:connectionFile,directory:workspaceDirectory,sources:{}}}},
      exportsDirectory:join(directory,'retained-exports')
    });
    const call=(name,args={})=>merchant.call(name,{workspace:ALIAS,...args});
    const epmc=(name,args={})=>call('merchant_research_europe_pmc_'+name,{library,...args});
    const attached=await call('merchant_research_attach');
    need(attached.workspace===ALIAS&&attached.state==='ATTACHED'&&typeof attached.attachmentId==='string'&&
      /^research_[a-f0-9]{64}$/.test(attached.status?.workspaceId||'')&&
      (workspaceId===undefined||attached.status.workspaceId===workspaceId),'EUROPE_PMC_MERCHANT_ATTACHMENT_CHANGED');
    need(!state.workspaceId||state.workspaceId===attached.status.workspaceId,'EUROPE_PMC_MERCHANT_WORKSPACE_CHANGED');
    state.workspaceId=attached.status.workspaceId;
    attachment={attachmentId:attached.attachmentId,workspaceId:state.workspaceId,attachedAt:now(),state:'ATTACHED'};
    state.attachments.push(attachment);attempt.attachmentId=attachment.attachmentId;await save();
    const read=async(name,work,check)=>{
      const retained=await readArtifact(name),value=retained?JSON.parse(retained.toString('utf8')):await work();
      if(check)check(value);await retain(name,value);return value;
    };
    const listing=await read('europe-pmc-merchant-library.json',()=>epmc('list'),value=>{
      need(value.selection?.library===library&&/^epw_[a-f0-9]{64}$/.test(value.id||''),
        'EUROPE_PMC_MERCHANT_LIBRARY_CHANGED');
    });
    need(!state.libraryId||state.libraryId===listing.id,'EUROPE_PMC_MERCHANT_LIBRARY_CHANGED');
    state.libraryId=listing.id;await save();
    await read('europe-pmc-merchant-status.json',()=>epmc('status'));
    const history=await read('europe-pmc-merchant-original-history.json',()=>epmc('history'),value=>{
      need(value.workspaceId===state.libraryId&&Array.isArray(value.events),'EUROPE_PMC_MERCHANT_HISTORY_CHANGED');
    });
    const query=await read('europe-pmc-merchant-query.json',()=>epmc('query',{queryId}),value=>{
      need(value.id===queryId&&Array.isArray(value.versions),'EUROPE_PMC_MERCHANT_QUERY_CHANGED');
    });
    const editions={},sources=[],records={};
    for(const choice of choices){
      const {label,operationId}=choice;
      const inspected=await read('europe-pmc-merchant-'+label+'-operation.json',
        ()=>epmc('inspect',{operationId}),value=>{
          need(value.plan?.id===operationId&&value.plan.sha256===choice.planSha256&&
            value.operation?.editionSha256===choice.editionSha256&&value.operation.editionBytes===choice.editionBytes&&
            value.plan.payload.query.id===queryId&&value.plan.payload.query.revision===choice.queryRevision&&
            query.versions.some(row=>same(row,value.plan.payload.query)),'EUROPE_PMC_MERCHANT_EDITION_CHANGED');
        });
      editions[label]=inspected;
      const rows=[];let offset=0;
      for(;;){
        const page=await read('europe-pmc-merchant-'+label+'-records-'+String(offset).padStart(6,'0')+'.json',
          ()=>epmc('records',{operationId,parameters:{offset,limit:100}}),value=>{
            need(value.operationId===operationId&&value.editionSha256===choice.editionSha256&&
              value.total===choice.records&&Array.isArray(value.items)&&value.items.length<=100,
              'EUROPE_PMC_MERCHANT_RECORDS_CHANGED');
          });
        rows.push(...page.items);
        if(page.nextOffset===null)break;
        need(Number.isSafeInteger(page.nextOffset)&&page.nextOffset===offset+page.items.length&&
          page.nextOffset>offset&&page.nextOffset<=choice.records,'EUROPE_PMC_MERCHANT_PAGE_INVALID');
        offset=page.nextOffset;
      }
      need(rows.length===choice.records&&new Set(rows.map(row=>row.id)).size===rows.length,'EUROPE_PMC_MERCHANT_RECORDS_CHANGED');
      records[label]=rows;
      const selections=Array.from({length:choice.pages},(_,index)=>({index,boundary:false}));
      if(inspected.boundary)selections.push({index:0,boundary:true});
      for(const selection of selections){
        const filename='europe-pmc-merchant-'+label+'-'+(selection.boundary?'boundary':'source-'+String(selection.index).padStart(6,'0'))+'.json';
        const value=await read(filename,()=>epmc('source',{operationId,...selection}),descriptor=>{
          need(typeof descriptor.documentId==='string'&&/^[a-f0-9]{64}$/.test(descriptor.bodySha256||'')&&
            Number.isSafeInteger(descriptor.bodyBytes)&&descriptor.bodyBytes>=0,
            'EUROPE_PMC_MERCHANT_SOURCE_CHANGED');
        });
        sources.push({label,operationId,...selection,descriptor:value});
      }
    }
    const observedReview=records.expanded.find(row=>row.id===reviewRequest.recordKey)?.review;
    const reviewIndex=observedReview?.history?.findIndex(row=>row.requestId===reviewRequest.requestId)??-1;
    need(reviewIndex>=0,'EUROPE_PMC_MERCHANT_SAVED_REVIEW_REQUIRED');
    const originalReview={...observedReview.history[reviewIndex],history:observedReview.history.slice(0,reviewIndex+1)};
    for(const key of ['requestId','actor','operationId','editionSha256','recordKey','decision','note'])
      need(originalReview[key]===reviewRequest[key],'EUROPE_PMC_MERCHANT_ORIGINAL_REVIEW_CHANGED');
    need(originalReview.revision===reviewRequest.expectedRevision+1,'EUROPE_PMC_MERCHANT_ORIGINAL_REVIEW_CHANGED');
    if(!state.replay){
      const name='europe-pmc-merchant-recovered-review.json',retained=await readArtifact(name);
      const value=retained?JSON.parse(retained.toString('utf8')):state.replayCandidate??
        await epmc('review',{input:reviewRequest});
      need(same(value,originalReview),'EUROPE_PMC_MERCHANT_ORIGINAL_REPLAY_CHANGED');
      if(!state.replayCandidate){state.replayCandidate=value;await save();}
      await retain(name,value);state.replay={requestId:value.requestId,operationId:value.operationId,
        editionSha256:value.editionSha256,recordKey:value.recordKey,revision:value.revision,exactOriginalResult:true};await save();
    }
    const workspaceRequest={requestId:'epmc-merchant-'+digest(bytes(input)).slice(0,40),actor:reviewRequest.actor};
    const workspaceExport=await read('europe-pmc-merchant-workspace-export.json',
      ()=>epmc('export_workspace',{input:workspaceRequest}),value=>{
        need(value.requestId===workspaceRequest.requestId&&value.workspace?.id===state.libraryId&&
          value.workspace.revision===history.revision&&/^[a-f0-9]{64}$/.test(value.sha256||'')&&
          Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=128*1024*1024,
          'EUROPE_PMC_MERCHANT_WORKSPACE_EXPORT_CHANGED');
      });
    const inventory=async()=>{
      const receipts=[];let offset=0,snapshot;
      for(;;){
        const page=await call('merchant_research_exports',{offset,limit:100,...(snapshot?{snapshot}:{})});
        need(page.workspace===ALIAS&&Array.isArray(page.items),'EUROPE_PMC_MERCHANT_EXPORT_INVENTORY_CHANGED');
        receipts.push(...page.items);
        if(page.next===null)break;
        need(page.next&&Number.isSafeInteger(page.next.offset)&&page.next.offset>offset,'EUROPE_PMC_MERCHANT_EXPORT_PAGE_INVALID');
        offset=page.next.offset;snapshot=page.next.snapshot;
      }
      return receipts;
    };
    const matches=(receipt,request)=>receipt.workspaceId===state.workspaceId&&receipt.kind===request.kind&&
      receipt.selection?.library===library&&
      (request.operationId===undefined||receipt.selection.operationId===request.operationId)&&
      (request.requestId===undefined||receipt.selection.requestId===request.requestId)&&
      (request.index===undefined||receipt.selection.index===request.index&&receipt.selection.boundary===(request.boundary??false));
    const checkedReceipt=(receipt,request)=>{
      need(matches(receipt,request)&&/^[a-f0-9]{64}$/.test(receipt.exportId||'')&&
        Number.isSafeInteger(receipt.bytes)&&receipt.bytes>=0&&receipt.bytes<=128*1024*1024&&
        (request.expectedSha256===undefined||receipt.exportId===request.expectedSha256)&&
        receipt.verification?.state!=='DIGEST_MISMATCH','EUROPE_PMC_MERCHANT_EXPORT_RECEIPT_CHANGED');
      if(request.operationId){
        const choice=choices.find(row=>row.operationId===request.operationId);
        need(receipt.selection.planSha256===choice.planSha256&&receipt.selection.editionSha256===choice.editionSha256,
          'EUROPE_PMC_MERCHANT_EXPORT_SOURCE_CHANGED');
      }
      return receipt;
    };
    const receiveExport=async(name,receipt)=>{
      const selected={filename:name,bytes:receipt.bytes,sha256:receipt.exportId};
      need(!state.preparedArtifacts[name]||same(state.preparedArtifacts[name],selected),'EUROPE_PMC_MERCHANT_PREPARED_EXPORT_CHANGED');
      state.preparedArtifacts[name]=selected;await save();
      if(await readArtifact(name))return state.artifacts[name];
      const partial=join(directory,name+'.receiving');
      const handle=await open(partial,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
      let readId,offset=0,total=0,carry=Buffer.alloc(0);
      const hash=createHash('sha256');
      try{
        const original=await handle.stat();
        need(original.isFile()&&original.nlink===1&&(original.mode&0o077)===0&&original.size<=receipt.bytes,
          'EUROPE_PMC_MERCHANT_PARTIAL_FILE_CHANGED');
        for(;;){
          const page=await call('merchant_research_file_read',{kind:receipt.kind,exportId:receipt.exportId,
            offset,limit:65536,...(readId?{readId}:{})});
          const data=Buffer.from(page.data??'','base64');
          need(page.encoding==='base64'&&data.toString('base64')===page.data&&page.file?.sha256===receipt.exportId&&
            page.file?.bytes===receipt.bytes&&page.offset===offset&&page.bytesRead===data.length,
            'EUROPE_PMC_MERCHANT_EXPORT_CHUNK_CHANGED');
          readId=page.readId;
          const inspected=Buffer.concat([carry,data]);
          need(!inspected.includes(Buffer.from(token)),'EUROPE_PMC_MERCHANT_SESSION_IN_REPORT');
          carry=Buffer.from(inspected.subarray(Math.max(0,inspected.length-63)));
          const shared=Math.min(data.length,Math.max(0,original.size-offset));
          if(shared){
            const old=Buffer.alloc(shared);let received=0;
            while(received<shared){const part=await handle.read(old,received,shared-received,offset+received);
              need(part.bytesRead>0,'EUROPE_PMC_MERCHANT_PARTIAL_FILE_CHANGED');received+=part.bytesRead;}
            need(old.equals(data.subarray(0,shared)),'EUROPE_PMC_MERCHANT_PARTIAL_FILE_CHANGED');
          }
          let written=shared;
          while(written<data.length){const part=await handle.write(data,written,data.length-written,offset+written);
            need(part.bytesWritten>0,'EUROPE_PMC_MERCHANT_EXPORT_WRITE_FAILED');written+=part.bytesWritten;}
          hash.update(data);total+=data.length;
          const next=offset+data.length;
          need(page.nextOffset===(next<receipt.bytes?next:null)&&next<=receipt.bytes,
            'EUROPE_PMC_MERCHANT_EXPORT_CHUNK_CHANGED');
          if(page.nextOffset===null)break;
          need(next>offset,'EUROPE_PMC_MERCHANT_EXPORT_CHUNK_EMPTY');offset=next;
        }
        need(total===receipt.bytes&&hash.digest('hex')===receipt.exportId,'EUROPE_PMC_MERCHANT_COMPLETE_EXPORT_CHANGED');
        await handle.sync();
        need((await handle.stat()).size===receipt.bytes,'EUROPE_PMC_MERCHANT_COMPLETE_EXPORT_CHANGED');
      }finally{
        await handle.close();
        if(readId)await call('merchant_research_file_release',{readId});
      }
      try{await link(partial,join(directory,name));}
      catch(error){if(error.code!=='EEXIST')throw error;await readArtifact(name);}
      await unlink(partial);
      state.artifacts[name]=selected;await save();return selected;
    };
    const requests=[];
    const retainExport=async(key,filename,request)=>{
      let record=state.exports[key];
      if(!record){record={request,selectedAt:now()};state.exports[key]=record;await save();}
      need(same(record.request,request),'EUROPE_PMC_MERCHANT_EXPORT_SELECTION_CHANGED');
      if(!record.receipt){
        const retained=(await inventory()).filter(item=>matches(item,request)&&
          (request.expectedSha256===undefined||item.exportId===request.expectedSha256))
          .sort((a,b)=>(a.retainedAt||'').localeCompare(b.retainedAt||'')||(a.receiptId||'').localeCompare(b.receiptId||''));
        const receipt=retained[0]??await call('merchant_research_export',request);
        record.receipt=checkedReceipt(receipt,request);record.recoveredFromInventory=retained.length>0;await save();
      }
      const receipt=checkedReceipt(record.receipt,request);
      record.artifact=await receiveExport(filename,receipt);record.state='RECEIVED';await save();
      const row={key,request,receipt:record.receipt,artifact:record.artifact};requests.push(row);return row;
    };
    for(const choice of choices){
      for(const [format,extension]of [['edition','json'],['ris','ris'],['csv','csv'],['review','json']]){
        await retainExport(choice.label+'-'+format,'europe-pmc-merchant-'+choice.label+'-'+format+'.'+extension,
          {library,operationId:choice.operationId,kind:'europe-pmc-'+format,
            ...(format==='edition'?{expectedSha256:choice.editionSha256}:{})});
      }
    }
    for(const source of sources){
      const suffix=source.boundary?'boundary':'source-'+String(source.index).padStart(6,'0');
      const row=await retainExport(source.label+'-'+suffix,'europe-pmc-merchant-'+source.label+'-'+suffix+'.bin',
        {library,operationId:source.operationId,kind:'europe-pmc-source',index:source.index,
          boundary:source.boundary,expectedSha256:source.descriptor.bodySha256});
      need(row.artifact.bytes===source.descriptor.bodyBytes&&row.receipt.selection.documentId===source.descriptor.documentId,
        'EUROPE_PMC_MERCHANT_SOURCE_EXPORT_CHANGED');
    }
    const portable=await retainExport('workspace','europe-pmc-merchant-workspace.json.gz',
      {library,kind:'europe-pmc-workspace',requestId:workspaceRequest.requestId,expectedSha256:workspaceExport.sha256});
    need(portable.artifact.bytes===workspaceExport.bytes,'EUROPE_PMC_MERCHANT_WORKSPACE_EXPORT_CHANGED');
    const checked=validateEuropePmcPortable(await readArtifact(portable.artifact.filename));
    need(checked.library.id===state.libraryId&&checked.library.revision===history.revision&&
      same(checked.library.events,history.events),'EUROPE_PMC_MERCHANT_PORTABLE_HISTORY_CHANGED');
    for(const choice of choices){
      const raw=checked.files.get('operations/'+choice.operationId+'/edition.json');
      need(raw&&raw.length===choice.editionBytes&&digest(raw)===choice.editionSha256,
        'EUROPE_PMC_MERCHANT_PORTABLE_EDITION_CHANGED');
    }
    const after=await epmc('history');
    need(same(after,history),'EUROPE_PMC_MERCHANT_UNEXPECTED_LIBRARY_MUTATION');
    await retain('europe-pmc-merchant-final-history.json',after);
    await retain('europe-pmc-merchant-export-receipts.json',{schema:SCHEMA,library,selected,exports:requests});
    const status=await call('merchant_research_status');
    need(status.reads?.sessions?.length===0,'EUROPE_PMC_MERCHANT_READS_STILL_ACTIVE');
    const detached=await call('merchant_research_detach',{attachmentId:attachment.attachmentId});
    need(detached.attachmentId===attachment.attachmentId&&detached.state==='DETACHED','EUROPE_PMC_MERCHANT_DETACH_CHANGED');
    attachment.state='DETACHED';attachment.detachedAt=now();await save();
    await merchant.close();merchant=null;
    attempt.endedAt=now();attempt.outcome='COMPLETE';
    state.finalSelection={schema:SCHEMA,workspaceId:state.workspaceId,library,libraryId:state.libraryId,
      dossierId,queryId,selected,originalRequestRecovery:state.replay,attachments:state.attachments,
      sourceEditions:state.sourceEditions,exports:requests,historyUnchanged:true,completedAt:now()};
    await save();return await finish();
  }catch(error){
    attempt.endedAt=now();attempt.outcome='INTERRUPTED_OR_FAILED';
    state.lastError={code:error.code||'EUROPE_PMC_MERCHANT_OPERATION_FAILED',
      message:String(error.message||error).split(token).join('[session]')};await save().catch(()=>{});
    throw Object.assign(new Error(state.lastError.message),{code:state.lastError.code});
  }finally{
    if(merchant)await merchant.close();
  }
}
