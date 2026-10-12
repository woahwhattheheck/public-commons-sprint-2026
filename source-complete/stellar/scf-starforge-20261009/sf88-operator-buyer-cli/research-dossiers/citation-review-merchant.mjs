// MIT. One original Merchant receiving phase for an already-saved citation review.
import {readFile,mkdir,lstat,open,rename,unlink,link} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {MerchantResearchWorkspaces} from '../../../../stellar-forge/mcp-merchant-operator/research-workspace.mjs';

const SCHEMA='sf88-citation-review-merchant-journey.v1',ALIAS='citation-review';
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
  if(old){need(old.length===data.length&&digest(old)===digest(data),'CITATION_MERCHANT_ARTIFACT_CHANGED');return;}
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{
    try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
    try{await link(temporary,path);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const retained=await readFile(path);need(retained.length===data.length&&digest(retained)===digest(data),'CITATION_MERCHANT_ARTIFACT_CHANGED');
    }
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

/**
 * Parent retains the one original server and native-operation lifetime.
 * selection = {reviewId, originalRevision, reviewedRevision, currentRevision}.
 * reviewRequest is the exact already-saved browser request, without Merchant fields.
 */
export async function runCitationReviewMerchant({
  url,workspaceDirectory,runDirectory,dossierId,noticeId,selection,reviewRequest
}){
  const connection=new URL(url),token=new URLSearchParams(connection.hash.slice(1)).get('token');
  need(connection.protocol==='http:'&&connection.hostname==='127.0.0.1'&&connection.port&&
    !connection.username&&!connection.password&&/^[a-f0-9]{64}$/.test(token||''),'CITATION_MERCHANT_ORIGINAL_LISTENER_REQUIRED');
  for(const path of [workspaceDirectory,runDirectory])need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,
    'CITATION_MERCHANT_ABSOLUTE_DIRECTORY_REQUIRED');
  need(/^d_[a-f0-9-]{36}$/.test(dossierId||'')&&/^cu_[a-f0-9]{64}$/.test(noticeId||''),
    'CITATION_MERCHANT_ORIGINAL_SELECTION_REQUIRED');
  need(selection&&/^cur_[a-f0-9]{64}$/.test(selection.reviewId||'')&&
    [selection.originalRevision,selection.reviewedRevision,selection.currentRevision].every(value=>Number.isSafeInteger(value)&&value>=1)&&
    selection.reviewedRevision===selection.originalRevision+1&&selection.currentRevision>=selection.reviewedRevision,
    'CITATION_MERCHANT_REVIEW_REVISION_REQUIRED');
  need(reviewRequest&&reviewRequest.noticeId===noticeId&&reviewRequest.expectedRevision===selection.originalRevision&&
    /^[A-Za-z0-9_-]{8,100}$/.test(reviewRequest.requestId||'')&&/^[a-f0-9]{64}$/.test(reviewRequest.expectedFingerprint||''),
    'CITATION_MERCHANT_ORIGINAL_REQUEST_REQUIRED');
  need(!Object.hasOwn(reviewRequest,'workspace')&&!Object.hasOwn(reviewRequest,'dossierId'),
    'CITATION_MERCHANT_USE_ORIGINAL_REVIEW_REQUEST');
  const originalUrl=new URL('/',connection.origin);originalUrl.hash='token='+token;
  const directory=join(runDirectory,'citation-merchant');
  await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);need(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,
    'CITATION_MERCHANT_PRIVATE_DIRECTORY_REQUIRED');
  const statePath=join(directory,'operation.json'),prior=await existing(statePath);
  const input={dossierId,noticeId,workspaceDirectory,origin:connection.origin,selection,
    requestSha256:digest(bytes(canonical(reviewRequest)))};
  const state=prior?JSON.parse(prior.toString('utf8')):{schema:SCHEMA,input,createdAt:now(),stage:'PREPARED',
    attempts:[],attachments:[],exports:{},artifacts:{},preparedArtifacts:{},sourceEditions:[]};
  need(state.schema===SCHEMA&&same(state.input,input),'CITATION_MERCHANT_ORIGINAL_OPERATION_CHANGED');
  const save=async()=>{
    const encoded=bytes(state);need(!encoded.includes(Buffer.from(token)),'CITATION_MERCHANT_SESSION_IN_REPORT');
    await atomic(statePath,encoded);
  };
  const descriptor=(filename,data)=>({filename,bytes:data.length,sha256:digest(data)});
  const readArtifact=async name=>{
    const data=await existing(join(directory,name)),selected=state.artifacts[name]||state.preparedArtifacts[name];
    if(!data){need(!state.artifacts[name],'CITATION_MERCHANT_ARTIFACT_MISSING');return null;}
    need(selected&&selected.filename===name&&data.length===selected.bytes&&digest(data)===selected.sha256,
      'CITATION_MERCHANT_ARTIFACT_CHANGED');
    need(!data.includes(Buffer.from(token)),'CITATION_MERCHANT_SESSION_IN_REPORT');
    if(!state.artifacts[name]){state.artifacts[name]=selected;await save();}
    return data;
  };
  const retain=async(name,data)=>{
    need(/^[a-z0-9][a-z0-9._-]+$/.test(name)&&!name.includes('..'),'CITATION_MERCHANT_ARTIFACT_NAME');
    data=Buffer.isBuffer(data)?data:bytes(data);
    const selected=descriptor(name,data),old=await readArtifact(name);
    if(old){need(same(state.artifacts[name],selected),'CITATION_MERCHANT_ARTIFACT_CHANGED');return state.artifacts[name];}
    need(!state.preparedArtifacts[name]||same(state.preparedArtifacts[name],selected),'CITATION_MERCHANT_PREPARED_ARTIFACT_CHANGED');
    need(!data.includes(Buffer.from(token)),'CITATION_MERCHANT_SESSION_IN_REPORT');
    state.preparedArtifacts[name]=selected;await save();
    await exclusive(join(directory,name),data);state.artifacts[name]=selected;await save();return selected;
  };
  const outputs=()=>Object.values(state.artifacts).map(item=>({...item,path:join(directory,item.filename)}));
  const verifyArtifacts=async()=>{for(const name of Object.keys(state.artifacts))await readArtifact(name);};
  const finish=async()=>{
    await retain('citation-merchant-completed-operation.json',state.finalSelection);
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
    const paths=[prefix+'citation-review-merchant.mjs',prefix+'workspace-client.mjs',
      'stellar-forge/mcp-merchant-operator/research-workspace.mjs',
      'stellar-forge/mcp-merchant-operator/research-citation-updates.mjs',
      'stellar-forge/mcp-merchant-operator/catalog/research-workspace.mjs',
      'stellar-forge/mcp-merchant-operator/catalog/research-citation-updates.mjs'];
    const pins=[];
    for(const path of paths){const data=await readFile(join(root,path));pins.push({path,bytes:data.length,sha256:digest(data)});}
    const fingerprint=digest(bytes(pins));
    if(state.sourceEditions.at(-1)?.fingerprint!==fingerprint)state.sourceEditions.push({fingerprint,selectedAt:now(),files:pins});
    attempt.sourceFingerprint=fingerprint;await save();
    await retain('citation-merchant-original-review-request.json',reviewRequest);

    // Only this private connection file carries the original listener session.
    const connectionFile=join(directory,'connection.private.json');
    await atomic(connectionFile,bytes({url:originalUrl.href}));
    merchant=new MerchantResearchWorkspaces({
      researchWorkspaces:{workspaces:{[ALIAS]:{label:'Research citation review',
        consoleUrlFile:connectionFile,directory:workspaceDirectory,sources:{}}}},
      exportsDirectory:join(directory,'retained-exports')
    });
    const call=(name,args={})=>merchant.call(name,{workspace:ALIAS,...args});
    const attached=await call('merchant_research_attach');
    need(attached.workspace===ALIAS&&attached.state==='ATTACHED'&&typeof attached.attachmentId==='string'&&
      /^research_[a-f0-9]{64}$/.test(attached.status?.workspaceId||''),'CITATION_MERCHANT_ATTACHMENT_CHANGED');
    need(!state.workspaceId||state.workspaceId===attached.status.workspaceId,'CITATION_MERCHANT_WORKSPACE_CHANGED');
    state.workspaceId=attached.status.workspaceId;
    attachment={attachmentId:attached.attachmentId,workspaceId:state.workspaceId,attachedAt:now(),state:'ATTACHED'};
    state.attachments.push(attachment);attempt.attachmentId=attachment.attachmentId;await save();

    if(!state.noticePages){
      const pages=[];let offset=0;
      for(;;){
        const name='citation-merchant-notices-'+String(offset).padStart(6,'0')+'.json';
        const retained=await readArtifact(name);
        const page=retained?JSON.parse(retained.toString('utf8')):
          await call('merchant_research_citation_updates',{dossierId,revision:selection.currentRevision,offset,limit:30,status:'all'});
        need(page.dossier.id===dossierId&&page.dossier.revision===selection.currentRevision&&page.offset===offset&&
          Array.isArray(page.items)&&Array.isArray(page.coverage),'CITATION_MERCHANT_NOTICE_PAGE_CHANGED');
        await retain(name,page);pages.push({filename:name,offset,items:page.items.length,total:page.total});
        if(page.nextOffset===null)break;
        need(Number.isSafeInteger(page.nextOffset)&&page.nextOffset>offset,'CITATION_MERCHANT_NOTICE_PAGE_INVALID');
        offset=page.nextOffset;
      }
      state.noticePages=pages;await save();
    }
    const details={};
    for(const [label,revision]of [['previous',selection.originalRevision],['reviewed',selection.reviewedRevision],['current',selection.currentRevision]]){
      const name='citation-merchant-'+label+'-notice.json',retained=await readArtifact(name);
      const value=retained?JSON.parse(retained.toString('utf8')):
        await call('merchant_research_citation_update',{dossierId,noticeId,revision});
      need(value.dossier.id===dossierId&&value.dossier.revision===revision&&value.detail.noticeId===noticeId,
        'CITATION_MERCHANT_NOTICE_CHANGED');
      await retain(name,value);details[label]=value;
    }
    need(details.previous.detail.fingerprint===reviewRequest.expectedFingerprint,'CITATION_MERCHANT_ORIGINAL_NOTICE_CHANGED');
    const originalReview=details.current.detail.reviews.find(value=>value.requestId===reviewRequest.requestId);
    need(originalReview?.id===selection.reviewId&&originalReview.originalRevision===selection.originalRevision&&
      originalReview.revision===selection.reviewedRevision,'CITATION_MERCHANT_SAVED_REVIEW_REQUIRED');
    if(!state.replay){
      const name='citation-merchant-recovered-review.json',retained=await readArtifact(name);
      const value=retained?JSON.parse(retained.toString('utf8')):state.replayCandidate??
        await call('merchant_research_citation_review',{dossierId,...reviewRequest});
      need(value.duplicate===true&&value.review.id===selection.reviewId&&value.review.requestId===reviewRequest.requestId&&
        value.review.originalRevision===selection.originalRevision&&value.review.revision===selection.reviewedRevision,
        'CITATION_MERCHANT_ORIGINAL_REPLAY_CHANGED');
      // Preserve the actual response before selecting its immutable output. A
      // later dossier head may change metadata in another duplicate response.
      if(!state.replayCandidate){state.replayCandidate=value;await save();}
      await retain(name,value);state.replay={reviewId:value.review.id,requestId:value.review.requestId,duplicate:true};await save();
    }

    const inventory=async()=>{
      const receipts=[];let offset=0,snapshot;
      for(;;){
        const page=await call('merchant_research_exports',{dossierId,offset,limit:100,...(snapshot?{snapshot}:{})});
        need(page.workspace===ALIAS&&Array.isArray(page.items),'CITATION_MERCHANT_EXPORT_INVENTORY_CHANGED');
        receipts.push(...page.items);
        if(page.next===null)break;
        need(page.next&&Number.isSafeInteger(page.next.offset)&&page.next.offset>offset,'CITATION_MERCHANT_EXPORT_PAGE_INVALID');
        offset=page.next.offset;snapshot=page.next.snapshot;
      }
      return receipts;
    };
    const checkedReceipt=(receipt,request)=>{
      need(receipt.workspaceId===state.workspaceId&&receipt.kind===request.kind&&receipt.selection?.dossierId===dossierId&&
        receipt.selection?.revision===request.revision&&/^[a-f0-9]{64}$/.test(receipt.exportId||'')&&
        Number.isSafeInteger(receipt.bytes)&&receipt.bytes>=0&&receipt.bytes<=256*1024*1024,
        'CITATION_MERCHANT_EXPORT_RECEIPT_CHANGED');
      return receipt;
    };
    const receiveExport=async(name,receipt)=>{
      const selected={filename:name,bytes:receipt.bytes,sha256:receipt.exportId};
      need(!state.preparedArtifacts[name]||same(state.preparedArtifacts[name],selected),'CITATION_MERCHANT_PREPARED_EXPORT_CHANGED');
      state.preparedArtifacts[name]=selected;await save();
      if(await readArtifact(name))return state.artifacts[name];
      const partial=join(directory,name+'.receiving');
      const handle=await open(partial,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
      let readId,offset=0,total=0,carry=Buffer.alloc(0);
      const hash=createHash('sha256');
      try{
        const original=await handle.stat();
        need(original.isFile()&&original.nlink===1&&(original.mode&0o077)===0&&original.size<=receipt.bytes,
          'CITATION_MERCHANT_PARTIAL_FILE_CHANGED');
        for(;;){
          const page=await call('merchant_research_file_read',{kind:receipt.kind,exportId:receipt.exportId,
            offset,limit:65536,...(readId?{readId}:{})});
          const data=Buffer.from(page.data??'','base64');
          need(page.encoding==='base64'&&data.toString('base64')===page.data&&page.file?.sha256===receipt.exportId&&
            page.file?.bytes===receipt.bytes&&page.offset===offset&&page.bytesRead===data.length,
            'CITATION_MERCHANT_EXPORT_CHUNK_CHANGED');
          readId=page.readId;
          const inspected=Buffer.concat([carry,data]);
          need(!inspected.includes(Buffer.from(token)),'CITATION_MERCHANT_SESSION_IN_REPORT');
          carry=Buffer.from(inspected.subarray(Math.max(0,inspected.length-63)));
          const shared=Math.min(data.length,Math.max(0,original.size-offset));
          if(shared){
            const old=Buffer.alloc(shared);let received=0;
            while(received<shared){const part=await handle.read(old,received,shared-received,offset+received);
              need(part.bytesRead>0,'CITATION_MERCHANT_PARTIAL_FILE_CHANGED');received+=part.bytesRead;}
            need(old.equals(data.subarray(0,shared)),'CITATION_MERCHANT_PARTIAL_FILE_CHANGED');
          }
          let written=shared;
          while(written<data.length){const part=await handle.write(data,written,data.length-written,offset+written);
            need(part.bytesWritten>0,'CITATION_MERCHANT_EXPORT_WRITE_FAILED');written+=part.bytesWritten;}
          hash.update(data);total+=data.length;
          const next=offset+data.length;
          need(page.nextOffset===(next<receipt.bytes?next:null)&&next<=receipt.bytes,
            'CITATION_MERCHANT_EXPORT_CHUNK_CHANGED');
          if(page.nextOffset===null)break;
          need(next>offset,'CITATION_MERCHANT_EXPORT_CHUNK_EMPTY');offset=next;
        }
        need(total===receipt.bytes&&hash.digest('hex')===receipt.exportId,'CITATION_MERCHANT_COMPLETE_EXPORT_CHANGED');
        await handle.sync();
        need((await handle.stat()).size===receipt.bytes,'CITATION_MERCHANT_COMPLETE_EXPORT_CHANGED');
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
    for(const [label,revision]of [['previous',selection.originalRevision],['reviewed',selection.reviewedRevision],['current',selection.currentRevision]]){
      for(const [kind,extension]of [['html','html'],['markdown','md'],['portable-gzip','json.gz']]){
        const key=label+'-'+kind,name='citation-merchant-'+label+'.'+extension,request={dossierId,kind,revision};
        let record=state.exports[key];
        if(!record){record={request,selectedAt:now()};state.exports[key]=record;await save();}
        need(same(record.request,request),'CITATION_MERCHANT_EXPORT_SELECTION_CHANGED');
        if(!record.receipt){
          const retained=(await inventory()).filter(item=>item.kind===kind&&item.selection?.dossierId===dossierId&&
            item.selection?.revision===revision).sort((a,b)=>(a.retainedAt||'').localeCompare(b.retainedAt||'')||
              (a.receiptId||'').localeCompare(b.receiptId||''));
          const receipt=retained[0]??await call('merchant_research_export',request);
          record.receipt=checkedReceipt(receipt,request);record.recoveredFromInventory=retained.length>0;await save();
        }
        const receipt=checkedReceipt(record.receipt,request);
        record.artifact=await receiveExport(name,receipt);record.state='RECEIVED';await save();
        requests.push({label,revision,kind,receipt:record.receipt,artifact:record.artifact});
      }
    }
    await retain('citation-merchant-export-receipts.json',{schema:SCHEMA,dossierId,noticeId,selection,exports:requests});
    const status=await call('merchant_research_status');
    need(status.reads?.sessions?.length===0,'CITATION_MERCHANT_READS_STILL_ACTIVE');
    const detached=await call('merchant_research_detach',{attachmentId:attachment.attachmentId});
    need(detached.attachmentId===attachment.attachmentId&&detached.state==='DETACHED','CITATION_MERCHANT_DETACH_CHANGED');
    attachment.state='DETACHED';attachment.detachedAt=now();await save();
    await merchant.close();merchant=null;
    attempt.endedAt=now();attempt.outcome='COMPLETE';
    state.finalSelection={schema:SCHEMA,dossierId,noticeId,workspaceId:state.workspaceId,...selection,
      originalRequestRecovery:state.replay,noticePages:state.noticePages,attachments:state.attachments,
      sourceEditions:state.sourceEditions,exports:requests,completedAt:now()};
    await save();return await finish();
  }catch(error){
    attempt.endedAt=now();attempt.outcome='INTERRUPTED_OR_FAILED';
    state.lastError={code:error.code||'CITATION_MERCHANT_OPERATION_FAILED',
      message:String(error.message||error).split(token).join('[session]')};await save().catch(()=>{});
    throw Object.assign(new Error(state.lastError.message),{code:state.lastError.code});
  }finally{
    if(merchant)await merchant.close();
  }
}
