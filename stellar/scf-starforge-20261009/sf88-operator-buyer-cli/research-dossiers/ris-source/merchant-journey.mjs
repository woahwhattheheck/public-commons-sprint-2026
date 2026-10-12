// MIT. Complete original Merchant intake, replay and retained-file receiving for RIS.
import {open,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {need,privateDirectory} from '../../node/store.mjs';
import {MerchantResearchWorkspaces} from '../../../../../stellar-forge/mcp-merchant-operator/research-workspace.mjs';
import {verifyResearchRisReceipt} from '../../../../../stellar-forge/mcp-merchant-operator/research-ris.mjs';
import {RESEARCH_RIS_EXPORTS} from '../../../../../stellar-forge/mcp-merchant-operator/catalog/research-ris.mjs';
import {inspectRisEdition} from './review.mjs';
import {nativeSha,nativeJson,nativeSame,nativeRead,nativeWrite,openRisNativeJournal} from './native-support.mjs';

const ALIAS='ris-sources',SCHEMA='sf88-research-ris-merchant-journey-v1';
const stamp=()=>new Date().toISOString();
const exactDigest=(data,expected)=>need(data.length===expected.bytes&&nativeSha(data)===expected.sha256,'RIS_MERCHANT_ORIGINAL_BYTES_CHANGED');

/** Uses the parent's original listener. Every receive is an exact saved-request replay. */
export async function runRisSourcesMerchant({url,workspaceDirectory,runDirectory,workspaceId,dossierId,questionId,
  baselineReceipt,baselineRequest,receipt,request,sourceFile,sourceSha256}={}){
  const connection=new URL(url),token=new URLSearchParams(connection.hash.slice(1)).get('token');
  need(connection.protocol==='http:'&&connection.hostname==='127.0.0.1'&&connection.port&&
    !connection.username&&!connection.password&&/^[a-f0-9]{64}$/.test(token??''),'RIS_MERCHANT_ORIGINAL_LISTENER_REQUIRED');
  for(const directory of [workspaceDirectory,runDirectory,sourceFile])
    need(typeof directory==='string'&&isAbsolute(directory)&&resolve(directory)===directory,'RIS_MERCHANT_ABSOLUTE_PATH_REQUIRED');
  need(/^[a-f0-9]{64}$/.test(sourceSha256??'')&&sourceSha256===receipt?.source?.sha256&&
    baselineReceipt.questionId===questionId&&receipt.questionId===questionId&&
    baselineReceipt.editionId!==receipt.editionId,'RIS_MERCHANT_SELECTED_EDITIONS_REQUIRED');
  const sourceBytes=await nativeRead(sourceFile);exactDigest(sourceBytes,receipt.source);
  const selection={schema:SCHEMA,origin:connection.origin,workspaceDirectory,workspaceId,dossierId,questionId,
    baselineReceipt,baselineRequest,receipt,request,source:{file:sourceFile,bytes:sourceBytes.length,sha256:sourceSha256}};
  const journal=await openRisNativeJournal(join(runDirectory,'merchant'),selection,{secrets:[token]});
  const {state}=journal;
  if(state.stage==='COMPLETE')return journal.finish(state.result);
  const privateRoot=join(runDirectory,'private','ris-merchant');await privateDirectory(privateRoot);
  const connectionFile=join(privateRoot,'connection.json');
  await nativeWrite(connectionFile,nativeJson({url}),{replace:true});
  let merchant,attachment;
  try{
    merchant=new MerchantResearchWorkspaces({researchWorkspaces:{workspaces:{[ALIAS]:{
      label:'Original RIS sources and reviewed editions',consoleUrlFile:connectionFile,directory:workspaceDirectory,
      sources:{'reviewed-ris-source':{kind:'ris-source',file:sourceFile,sha256:sourceSha256}}
    }}},exportsDirectory:join(privateRoot,'retained-exports')});
    const call=(name,args={})=>merchant.call(name,{workspace:ALIAS,...args});
    const ris=(name,args={})=>call('merchant_research_ris_'+name,{dossierId,...args});
    const attached=await call('merchant_research_attach');
    attachment=attached.attachmentId;
    need(attached.state==='ATTACHED'&&attached.workspace===ALIAS&&
      attached.status?.workspaceId===workspaceId&&typeof attachment==='string','RIS_MERCHANT_ATTACHMENT_CHANGED');
    state.values.attachments??=[];const attempt={attachmentId:attachment,workspaceId,attachedAt:stamp(),state:'ATTACHED'};
    state.values.attachments.push(attempt);await journal.save();
    const retainedJson=async(name,work,check=()=>{})=>{
      const prior=await journal.recover(name),value=prior?JSON.parse(prior):await work();
      check(value);await journal.retain(name,nativeJson(value));return value;
    };
    const original=await retainedJson('original-dossier.json',()=>call('merchant_research_dossier',{dossierId}),
      value=>need(value?.id===dossierId||value?.dossier?.id===dossierId,'RIS_MERCHANT_DOSSIER_CHANGED'));
    const originalHead=original.dossier??original;
    if(state.values.revision===undefined){state.values.revision=originalHead.revision;await journal.save();}
    need(originalHead.revision===state.values.revision&&originalHead.revision>=receipt.revision,'RIS_MERCHANT_DOSSIER_REVISION_CHANGED');
    const revision=state.values.revision;
    const pages=[];let offset=0;
    for(;;){
      const page=await retainedJson('editions-'+String(offset).padStart(5,'0')+'.json',
        ()=>ris('list',{revision,offset,limit:1}),value=>{
          need(value.dossier?.id===dossierId&&value.revision===revision&&Array.isArray(value.items)&&value.items.length<=1,
            'RIS_MERCHANT_EDITION_PAGE_CHANGED');
        });
      pages.push(...page.items);
      if(page.nextOffset===null)break;
      need(page.nextOffset===offset+page.items.length&&page.nextOffset>offset,'RIS_MERCHANT_PAGE_CURSOR_CHANGED');
      offset=page.nextOffset;
    }
    for(const expected of [baselineReceipt,receipt])
      need(pages.some(row=>nativeSame(row,expected)),'RIS_MERCHANT_ORIGINAL_RECEIPT_MISSING');
    const choices=[{label:'baseline',receipt:baselineReceipt,request:baselineRequest},{label:'reviewed',receipt,request}];
    const views={};
    for(const choice of choices){
      const selected=choice.receipt;
      const view=await retainedJson(choice.label+'-review.json',()=>ris('review',{editionId:selected.editionId,revision,limit:100}),
        value=>need(nativeSame(value.receipt,selected)&&value.dossier.revision===revision&&
          value.records.length===value.counts.records&&value.nextOffset===null,'RIS_MERCHANT_COMPLETE_REVIEW_CHANGED'));
      views[choice.label]=view;
      const replay=await retainedJson(choice.label+'-saved-request.json',()=>ris('request',{requestId:selected.requestId,revision}),
        value=>verifyResearchRisReceipt(value,{dossierId,source:choice.request.source,
          review:view.review,planSha256:choice.request.expectedPlanSha256}));
      need(nativeSame(replay.receipt,selected),'RIS_MERCHANT_ORIGINAL_RECEIPT_CHANGED');
      for(const record of view.records){
        await retainedJson(choice.label+'-record-'+String(record.ordinal).padStart(3,'0')+'-'+record.recordId.slice(-12)+'.json',
          ()=>ris('review',{editionId:selected.editionId,revision,recordId:record.recordId}),
          value=>need(value.record?.recordId===record.recordId&&value.record.sha256===record.sha256&&
            value.record.bytes===record.bytes&&Array.isArray(value.record.fields),'RIS_MERCHANT_ORIGINAL_RECORD_CHANGED'));
      }
    }
    await retainedJson('prepared-original-source.json',()=>ris('prepare',{
      source:'reviewed-ris-source',review:request.review,limit:100}),
      value=>need(nativeSame(value.source,receipt.source)&&value.planSha256===receipt.planSha256&&value.complete,
        'RIS_MERCHANT_PREPARED_SOURCE_CHANGED'));
    await retainedJson('reviewed-preview.json',()=>ris('preview',{input:{source:request.source,review:request.review,limit:100}}),
      value=>need(value.complete&&value.duplicate===true&&nativeSame(value.receipt,receipt),'RIS_MERCHANT_ORIGINAL_PREVIEW_CHANGED'));
    if(!state.values.replay){
      const retained=await journal.recover('same-request-receipt.json');
      const result=retained?JSON.parse(retained):state.values.replayCandidate??await ris('receive',{input:request});
      verifyResearchRisReceipt(result,{dossierId,source:request.source,review:views.reviewed.review,planSha256:request.expectedPlanSha256});
      need(result.duplicate===true&&nativeSame(result.receipt,receipt),'RIS_MERCHANT_REPLAY_CREATED_AN_EDITION');
      if(!state.values.replayCandidate){state.values.replayCandidate=result;await journal.save();}
      await journal.retain('same-request-receipt.json',nativeJson(result));
      state.values.replay={requestId:receipt.requestId,editionId:receipt.editionId,revision:receipt.revision,duplicate:true};
      await journal.save();
    }
    for(const section of ['added','absent','changed','unchanged']){
      let offset=0;const rows=[];
      for(;;){
        const page=await retainedJson('comparison-'+section+'-'+offset+'.json',
          ()=>ris('compare',{before:baselineReceipt.editionId,after:receipt.editionId,revision,section,offset,limit:1}),
          value=>need(nativeSame(value.before,baselineReceipt)&&nativeSame(value.after,receipt)&&
            value.dossier.revision===revision&&value.section===section,'RIS_MERCHANT_COMPARISON_CHANGED'));
        rows.push(...page.items);if(page.nextOffset===null){need(rows.length===page.counts[section],'RIS_MERCHANT_COMPARISON_INCOMPLETE');break;}
        need(page.nextOffset===offset+page.items.length&&page.nextOffset>offset,'RIS_MERCHANT_COMPARISON_CURSOR_CHANGED');
        offset=page.nextOffset;
      }
    }
    const inventory=async()=>{
      const rows=[];let offset=0,snapshot;
      for(;;){
        const page=await call('merchant_research_exports',{offset,limit:100,...(snapshot?{snapshot}:{})});
        need(page.workspace===ALIAS&&Array.isArray(page.items),'RIS_MERCHANT_EXPORT_INVENTORY_CHANGED');
        rows.push(...page.items);if(page.next===null)break;
        need(Number.isSafeInteger(page.next?.offset)&&page.next.offset>offset,'RIS_MERCHANT_EXPORT_CURSOR_CHANGED');
        offset=page.next.offset;snapshot=page.next.snapshot;
      }return rows;
    };
    const matches=(row,selected)=>row.workspaceId===workspaceId&&row.kind===selected.kind&&
      row.selection?.dossierId===dossierId&&row.selection.revision===selected.revision&&
      ['editionId','documentId','recordId','beforeRisEditionId','afterRisEditionId'].every(key=>
        selected[key]===undefined||row.selection[key]===selected[key])&&
      (selected.expectedSha256===undefined||row.exportId===selected.expectedSha256);
    const checked=(row,selected)=>{
      need(matches(row,selected)&&/^[a-f0-9]{64}$/.test(row.exportId??'')&&
        Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=256*1024*1024&&
        row.verification?.state!=='DIGEST_MISMATCH','RIS_MERCHANT_EXPORT_RECEIPT_CHANGED');
      if(selected.editionId){
        const expected=choices.find(choice=>choice.receipt.editionId===selected.editionId)?.receipt;
        need(expected&&nativeSame(row.selection.receipt,expected),'RIS_MERCHANT_EXPORT_SOURCE_CHANGED');
      }
      if(selected.beforeRisEditionId)need(nativeSame(row.selection.beforeReceipt,baselineReceipt)&&
        nativeSame(row.selection.afterReceipt,receipt),'RIS_MERCHANT_EXPORT_COMPARISON_CHANGED');
      return row;
    };
    const readExport=async(name,receipt)=>{
      const expected={bytes:receipt.bytes,sha256:receipt.exportId};
      const old=await journal.recover(name);if(old){exactDigest(old,expected);return state.artifacts[name];}
      const partial=journal.path(name+'.receiving');
      const handle=await open(partial,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
      let readId,total=0,offset=0,carry=Buffer.alloc(0);const hash=createHash('sha256');
      try{
        const info=await handle.stat();need(info.isFile()&&info.uid===process.getuid()&&info.nlink===1&&
          (info.mode&0o077)===0&&info.size<=receipt.bytes,'RIS_MERCHANT_RECEIVING_FILE_CHANGED');
        for(;;){
          const page=await call('merchant_research_file_read',{kind:receipt.kind,exportId:receipt.exportId,offset,
            limit:65536,...(readId?{readId}:{})});
          const data=Buffer.from(page.data??'','base64');
          need(page.encoding==='base64'&&data.toString('base64')===page.data&&page.file?.sha256===receipt.exportId&&
            page.file.bytes===receipt.bytes&&page.offset===offset&&page.bytesRead===data.length,'RIS_MERCHANT_CHUNK_CHANGED');
          readId=page.readId;
          const joined=Buffer.concat([carry,data]);need(!joined.includes(Buffer.from(token)),'RIS_MERCHANT_SESSION_IN_FILE');
          carry=Buffer.from(joined.subarray(Math.max(0,joined.length-token.length+1)));
          const shared=Math.min(data.length,Math.max(0,info.size-offset));
          if(shared){
            const before=Buffer.alloc(shared);let count=0;
            while(count<shared){const part=await handle.read(before,count,shared-count,offset+count);
              need(part.bytesRead>0,'RIS_MERCHANT_PARTIAL_PREFIX_CHANGED');count+=part.bytesRead;}
            need(before.equals(data.subarray(0,shared)),'RIS_MERCHANT_PARTIAL_PREFIX_CHANGED');
          }
          let written=shared;
          while(written<data.length){const part=await handle.write(data,written,data.length-written,offset+written);
            need(part.bytesWritten>0,'RIS_MERCHANT_RECEIVING_WRITE_STOPPED');written+=part.bytesWritten;}
          hash.update(data);total+=data.length;const next=offset+data.length;
          need(next<=receipt.bytes&&page.nextOffset===(next<receipt.bytes?next:null),'RIS_MERCHANT_CHUNK_CURSOR_CHANGED');
          if(page.nextOffset===null)break;
          need(next>offset,'RIS_MERCHANT_EMPTY_CHUNK');offset=next;
        }
        need(total===receipt.bytes&&hash.digest('hex')===receipt.exportId,'RIS_MERCHANT_COMPLETE_BYTES_CHANGED');
        await handle.sync();need((await handle.stat()).size===receipt.bytes,'RIS_MERCHANT_COMPLETE_BYTES_CHANGED');
      }finally{
        try{await handle.close();}finally{if(readId)await call('merchant_research_file_release',{readId});}
      }
      const data=await nativeRead(partial);exactDigest(data,expected);
      const result=await journal.retain(name,data);await unlink(partial);return result;
    };
    state.values.exports??={};const exported=[];
    const exportOne=async(key,name,selected)=>{
      let item=state.values.exports[key];
      if(!item){item={request:selected};state.values.exports[key]=item;await journal.save();}
      need(nativeSame(item.request,selected),'RIS_MERCHANT_EXPORT_SELECTION_CHANGED');
      if(!item.receipt){
        const previous=(await inventory()).filter(row=>matches(row,selected))
          .sort((a,b)=>(a.retainedAt??'').localeCompare(b.retainedAt??'')||(a.receiptId??'').localeCompare(b.receiptId??''));
        item.receipt=checked(previous[0]??await call('merchant_research_export',selected),selected);
        item.recoveredFromInventory=previous.length>0;await journal.save();
      }
      checked(item.receipt,selected);item.artifact=await readExport(name,item.receipt);await journal.save();
      exported.push({key,request:selected,receipt:item.receipt,artifact:item.artifact});return item;
    };
    for(const choice of choices){
      const view=views[choice.label],common={dossierId,editionId:choice.receipt.editionId,revision};
      for(const kind of ['ris-edition','ris-source','ris-selected','ris-csv','ris-html','ris-markdown']){
        const spec=RESEARCH_RIS_EXPORTS[kind],item=await exportOne(choice.label+'-'+kind,
          choice.label+'-'+kind+'.'+spec.extension,{...common,kind});
        if(kind==='ris-edition'){
          const data=await journal.recover(item.artifact.file),inspected=inspectRisEdition(data);
          exactDigest(data,choice.receipt.edition);need(nativeSame(inspected.reviewed.review,view.review),'RIS_MERCHANT_REVIEWED_EDITION_CHANGED');
        }
      }
      for(const document of view.documents){
        const item=await exportOne(choice.label+'-document-'+document.id,
          choice.label+'-document-'+document.id.slice(-16)+'.ris',{...common,kind:'ris-document',
            documentId:document.id,expectedSha256:document.sha256});
        need(item.artifact.bytes===document.bytes,'RIS_MERCHANT_SOURCE_LENGTH_CHANGED');
      }
      for(const record of view.records){
        const item=await exportOne(choice.label+'-record-'+record.recordId,
          choice.label+'-raw-record-'+record.recordId.slice(-16)+'.ris',{...common,kind:'ris-record',
            recordId:record.recordId,expectedSha256:record.sha256});
        need(item.artifact.bytes===record.bytes,'RIS_MERCHANT_RECORD_LENGTH_CHANGED');
      }
    }
    for(const kind of ['ris-comparison','ris-comparison-html','ris-comparison-markdown'])
      await exportOne(kind,kind+'.'+RESEARCH_RIS_EXPORTS[kind].extension,{dossierId,kind,revision,
        beforeRisEditionId:baselineReceipt.editionId,afterRisEditionId:receipt.editionId});
    for(const [label,selectedRevision]of [['before',baselineReceipt.revision],['reviewed',receipt.revision],['current',revision]])
      for(const [kind,extension]of [['html','html'],['markdown','md'],['portable-gzip','json.gz']])
        await exportOne('dossier-'+label+'-'+kind,'dossier-'+label+'.'+extension,{dossierId,kind,revision:selectedRevision});
    const final=await call('merchant_research_dossier',{dossierId}),finalHead=final.dossier??final;
    need(nativeSame(finalHead,originalHead),'RIS_MERCHANT_UNEXPECTED_DOSSIER_MUTATION');
    await journal.retain('unchanged-final-dossier.json',nativeJson(final));
    await journal.retain('complete-export-receipts.json',nativeJson({schema:SCHEMA,exports:exported}));
    const status=await call('merchant_research_status');
    need(status.reads?.sessions?.length===0,'RIS_MERCHANT_READ_SESSION_REMAINS');
    const detached=await call('merchant_research_detach',{attachmentId:attachment});
    need(detached.state==='DETACHED'&&detached.attachmentId===attachment,'RIS_MERCHANT_DETACH_CHANGED');
    attempt.state='DETACHED';attempt.detachedAt=stamp();await journal.save();
    await merchant.close();merchant=null;
    const result={schema:SCHEMA,workspaceId,dossierId,questionId,revision,baselineReceipt,receipt,
      replay:state.values.replay,exports:exported,attachments:state.values.attachments,historyUnchanged:true};
    return await journal.finish(result);
  }catch(error){await journal.failed(error);throw error;}
  finally{if(merchant)await merchant.close();}
}
