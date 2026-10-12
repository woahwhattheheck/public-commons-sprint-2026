// MIT. Receive the original operated study through its existing Merchant surface.
import {createHash} from 'node:crypto';
import {resolve,join,relative} from 'node:path';
import {MerchantResearchWorkspaces} from '../../../../stellar-forge/mcp-merchant-operator/research-workspace.mjs';
import {RESEARCH_EXTRACTION_SECTIONS,RESEARCH_EXTRACTION_PUBLICATION_SECTIONS,
  RESEARCH_EXTRACTION_EXPORTS} from '../../../../stellar-forge/mcp-merchant-operator/catalog/research-extraction.mjs';
import {MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
import {extractionDigest} from './study-extraction.mjs';
import {extractionTransportRequest,extractionTransportDigest} from './research-extraction-transport.mjs';
import {readResearchHostFile,openResearchSource} from './workspace-files.mjs';
import {writePortableFile,PORTABLE_LIMIT} from './portable.mjs';
import {privateDirectory,writeBytes,writeJson,parseJson,need,object} from '../node/store.mjs';

const SCHEMA='sf88-research-study-extraction-merchant-receiving/v1';
const running=new Set(),alias='study-extraction';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>a===undefined||b===undefined?a===b:extractionDigest(a)===extractionDigest(b);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const selected=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const isMissing=error=>error?.code==='ENOENT';
const now=()=>new Date().toISOString();
async function optionalJson(path){
  try{return parseJson(await readResearchHostFile(path,32*1024*1024,{privateFile:true}));}
  catch(error){if(isMissing(error))return null;throw error;}
}
async function verifyFile(file){
  const source=await openResearchSource(file.file,PORTABLE_LIMIT,{sha256:file.sha256});
  try{need(source.bytes===file.bytes,'EXTRACTION_RECEIVING_FILE_CHANGED');}
  finally{await source.close();}
  return file;
}

/**
 * Consume one actual operated dossier. This helper creates no form/result/table
 * action. A requested replay is admitted only after the exact committed request
 * is found in that selected revision's original operation history.
 *
 * Caller retains the normal programme/process owner and its runDirectory.
 */
export async function runStudyExtractionMerchant(config){
  const {signal}=config;
  signal?.throwIfAborted();
  need(typeof config.connectionFile==='string'&&typeof config.workspaceDirectory==='string'&&
    typeof config.runDirectory==='string'&&/^research_[a-f0-9]{64}$/.test(config.expectedWorkspaceId??'')&&
    typeof config.dossierId==='string'&&Number.isSafeInteger(config.revision)&&config.revision>=1&&
    ['formId','resultSetId','tableId','publicationId'].every(key=>typeof config[key]==='string'&&config[key]),
    'EXTRACTION_MERCHANT_SELECTION_REQUIRED');
  const inputSource=config.source;
  need(object(inputSource)&&typeof inputSource.occurrenceId==='string'&&digest(inputSource.sha256)&&
    Number.isSafeInteger(inputSource.bytes)&&inputSource.bytes>0&&inputSource.bytes<=16*1024*1024&&
    Array.isArray(inputSource.pointers)&&inputSource.pointers.length>0&&inputSource.pointers.length<=512&&
    inputSource.pointers.every(pointer=>typeof pointer==='string')&&
    new Set(inputSource.pointers).size===inputSource.pointers.length&&
    (inputSource.fileName===undefined||typeof inputSource.fileName==='string'&&inputSource.fileName.length>0)&&
    Array.isArray(config.replayRequests)&&config.replayRequests.length>0,
    'EXTRACTION_MERCHANT_SOURCE_REQUIRED');
  for(const replay of config.replayRequests)need(object(replay)&&
    ['extraction','publication'].includes(replay.kind)&&typeof replay.file==='string'&&
    digest(replay.sha256)&&typeof replay.operationId==='string'&&replay.operationId,
    'EXTRACTION_MERCHANT_REPLAY_REQUIRED');
  const directory=await privateDirectory(resolve(config.runDirectory));
  need(!running.has(directory),'EXTRACTION_MERCHANT_PROGRAMME_ACTIVE');
  running.add(directory);
  let merchant,journal,failure,result;
  const journalFile=join(directory,'merchant-receiving.json');
  const selection={
    ...selected(config,['expectedWorkspaceId','dossierId','revision','formId','resultSetId',
      'tableId','publicationId','againstPublicationId']),
    source:selected(inputSource,['occurrenceId','fileName','pointers','sha256','bytes']),
    replayRequests:config.replayRequests.map(row=>selected(row,['kind','sha256','operationId']))
  };
  const check=()=>signal?.throwIfAborted();
  const persist=()=>writeJson(journalFile,journal);
  try{
    journal=await optionalJson(journalFile);
    if(journal)need(journal.schema===SCHEMA&&same(journal.selection,selection),
      'EXTRACTION_MERCHANT_PROGRAMME_CHANGED');
    else{
      journal={schema:SCHEMA,selection,status:'RUNNING',startedAt:now(),steps:{},files:{},admissions:[]};
      await persist();
    }
    const filesDirectory=await privateDirectory(join(directory,'files'));
    const requestDirectory=await privateDirectory(join(directory,'requests'));
    const snapshotDirectory=await privateDirectory(join(directory,'snapshots'));
    const fileRecord=(file,bytes,sha256,contentType)=>({
      file,relative:relative(directory,file).replaceAll('\\','/'),bytes,sha256,contentType
    });
    const retainBytes=async(file,bytes,contentType='application/json')=>{
      const expected=fileRecord(file,bytes.length,hash(bytes),contentType);
      try{await writeBytes(file,bytes,{exclusive:true});}
      catch(error){if(error.code!=='EEXIST')throw error;await verifyFile(expected);}
      journal.files[expected.relative]=expected;await persist();return expected;
    };
    const retainJson=(name,value)=>retainBytes(join(snapshotDirectory,name+'.json'),jsonBytes(value));
    const step=async(name,work)=>{
      check();
      if(journal.steps[name]){
        const saved=journal.steps[name];
        for(const file of saved.files??[])await verifyFile(file);
        return saved.value;
      }
      journal.status='RUNNING';journal.currentStep=name;delete journal.failure;await persist();
      const completed=await work();
      journal.steps[name]={completedAt:now(),value:completed.value,files:completed.files??[]};
      await persist();check();return completed.value;
    };
    if(journal.status==='COMPLETED'){
      for(const file of Object.values(journal.files))await verifyFile(file);
      result=journal.result;
      need(result?.schema===SCHEMA&&result.state==='COMPLETED','EXTRACTION_MERCHANT_RESULT_CHANGED');
      return result;
    }
    merchant=new MerchantResearchWorkspaces({
      researchWorkspaces:{workspaces:{[alias]:{
        label:'Original study extraction receiving',
        consoleUrlFile:resolve(config.connectionFile),
        directory:resolve(config.workspaceDirectory),sources:{}
      }}},
      exportsDirectory:await privateDirectory(join(directory,'merchant-exports'))
    });
    const call=async(name,args={})=>{check();return merchant.call(name,{workspace:alias,...args});};
    const attachment=await call('merchant_research_attach');
    need(attachment.status?.workspaceId===config.expectedWorkspaceId&&attachment.state==='ATTACHED',
      'EXTRACTION_MERCHANT_WORKSPACE_CHANGED');
    journal.admissions.push({at:now(),attachmentId:attachment.attachmentId,
      workspaceId:attachment.status.workspaceId});await persist();
    const metadata=await call('merchant_research_dossier',{
      dossierId:config.dossierId,revision:config.revision});
    need(metadata.id===config.dossierId&&metadata.revision===config.revision,
      'EXTRACTION_MERCHANT_DOSSIER_CHANGED');

    const pageViews=async(publication,section)=>{
      const area=publication?'publication':'extraction';
      return step(area+'-'+section,async()=>{
        const items=[],pages=[],pageFiles=[];let offset=0,total=null;
        while(true){
          const args={dossierId:config.dossierId,revision:config.revision,section,offset,limit:100,
            ...(publication&&section==='comparison'?{fromPublicationId:config.againstPublicationId,
              toPublicationId:config.publicationId}:{}),
            ...(publication?selected(config,['tableId','publicationId']):
              selected(config,['formId','resultSetId']))};
          const page=await call(publication?'merchant_research_extraction_publications':
            'merchant_research_extraction',args);
          need(page.dossierId===config.dossierId&&page.revision===config.revision&&page.section===section,
            'EXTRACTION_MERCHANT_PAGE_CHANGED');
          if(section!=='overview'){
            need(page.offset===offset&&Array.isArray(page.items)&&Number.isSafeInteger(page.total)&&
              page.total>=0&&(total===null||total===page.total),'EXTRACTION_MERCHANT_PAGE_CHANGED');
            total=page.total;items.push(...page.items);
            const next=page.nextOffset;
            need(next===null||Number.isSafeInteger(next)&&next===offset+page.items.length&&next>offset,
              'EXTRACTION_MERCHANT_PAGE_CURSOR_CHANGED');
          }
          const file=await retainJson(area+'-'+section+'-'+String(offset).padStart(8,'0'),page);
          pages.push({offset,file});pageFiles.push(file);
          if(section==='overview'||page.nextOffset===null)break;
          offset=page.nextOffset;
        }
        if(section!=='overview')need(items.length===total,'EXTRACTION_MERCHANT_PAGE_INCOMPLETE');
        return {value:{section,count:section==='overview'?null:items.length,pages},files:pageFiles};
      });
    };
    const pageRecords=async(view)=>{
      const rows=[];
      for(const entry of view.pages){
        await verifyFile(entry.file);
        const page=parseJson(await readResearchHostFile(entry.file.file,32*1024*1024,{privateFile:true}));
        rows.push(...(page.items??[]));
      }
      return rows;
    };
    const extractionPages={},publicationPages={};
    for(const section of RESEARCH_EXTRACTION_SECTIONS)
      extractionPages[section]=await pageViews(false,section);
    for(const section of RESEARCH_EXTRACTION_PUBLICATION_SECTIONS){
      if(section==='comparison'&&config.againstPublicationId===undefined){
        publicationPages[section]={section,state:'NOT_SELECTED',count:0,pages:[]};
        continue;
      }
      publicationPages[section]=await pageViews(true,section);
    }

    const sourceValues=await step('source-values',async()=>{
      const value=await call('merchant_research_extraction_source_values',{
        dossierId:config.dossierId,revision:config.revision,
        ...selected(inputSource,['occurrenceId','fileName','pointers'])
      });
      need(value.occurrence?.occurrenceId===inputSource.occurrenceId&&
        value.values.length===inputSource.pointers.length&&value.values.every((row,index)=>
          row.pointer===inputSource.pointers[index]&&row.contentSha256===inputSource.sha256&&
          row.contentBytes===inputSource.bytes&&
          (inputSource.fileName===undefined?row.file===undefined:row.file?.name===inputSource.fileName)),
        'EXTRACTION_MERCHANT_SOURCE_CHANGED');
      const file=await retainJson('source-values',value);
      return {value:{file,occurrence:value.occurrence,pointerCount:value.values.length},files:[file]};
    });
    const nativeOperations={
      extraction:await pageRecords(extractionPages.operations),
      publication:await pageRecords(publicationPages.operations)
    };
    const replays=[];
    for(let index=0;index<config.replayRequests.length;index++){
      const selectedReplay=config.replayRequests[index];
      const value=await step('replay-'+index,async()=>{
        const requestFile=join(requestDirectory,'replay-'+index+'.request.json');
        let raw;
        try{raw=await readResearchHostFile(resolve(selectedReplay.file),16*1024*1024,{privateFile:true});}
        catch(error){if(!isMissing(error))throw error;raw=await readResearchHostFile(requestFile,16*1024*1024,{privateFile:true});}
        need(hash(raw)===selectedReplay.sha256,'EXTRACTION_MERCHANT_REQUEST_FILE_CHANGED');
        const supplied=parseJson(raw);
        need(object(supplied)&&Object.keys(supplied).length===5&&
          ['requestId','expectedRevision','actor','action','data'].every(key=>Object.hasOwn(supplied,key)),
          'EXTRACTION_MERCHANT_REQUEST_FILE_CHANGED');
        const request=extractionTransportRequest(supplied,{publication:selectedReplay.kind==='publication'});
        const original=nativeOperations[selectedReplay.kind].find(row=>row.id===selectedReplay.operationId);
        need(original&&original.requestId===request.requestId&&same(original.request,request)&&
          original.requestSha256===extractionTransportDigest(request,{publication:selectedReplay.kind==='publication'})&&
          original.revision<=config.revision,
          'EXTRACTION_MERCHANT_COMMITTED_REQUEST_REQUIRED');
        const retainedRequest=await retainBytes(requestFile,raw);
        const response=await call(selectedReplay.kind==='publication'?
          'merchant_research_extraction_publication_review':'merchant_research_extraction_review',
          {dossierId:config.dossierId,...request});
        need(response.duplicate===true&&response.operation.id===original.id&&
          response.operation.sha256===original.sha256&&same(response.operation,original),
          'EXTRACTION_MERCHANT_REPLAY_CHANGED');
        const responseFile=await retainJson('replay-'+index+'-response',response);
        return {value:{kind:selectedReplay.kind,requestId:request.requestId,
          operationId:original.id,revision:original.revision,duplicate:true,
          requestFile:retainedRequest,responseFile},files:[retainedRequest,responseFile]};
      });
      replays.push(value);
    }

    const receipts=async()=>{
      const items=[];let offset=0,snapshot;
      while(true){
        const page=await call('merchant_research_exports',{
          dossierId:config.dossierId,offset,limit:100,...(snapshot?{snapshot}:{})});
        need(page.workspace===alias&&page.offset===offset&&Array.isArray(page.items)&&
          digest(page.snapshot)&&(snapshot===undefined||snapshot===page.snapshot),
          'EXTRACTION_MERCHANT_EXPORT_INVENTORY_CHANGED');
        items.push(...page.items);snapshot=page.snapshot;
        if(page.next===null)break;
        need(Number.isSafeInteger(page.next?.offset)&&page.next.offset===offset+page.items.length&&
          page.next.offset>offset&&page.next.snapshot===snapshot,
          'EXTRACTION_MERCHANT_EXPORT_CURSOR_CHANGED');
        offset=page.next.offset;
      }
      return items;
    };
    const download=async(receipt)=>{
      need(digest(receipt.exportId)&&Number.isSafeInteger(receipt.bytes)&&
        receipt.bytes>=0&&receipt.bytes<=PORTABLE_LIMIT,'EXTRACTION_MERCHANT_EXPORT_INVALID');
      const extension=RESEARCH_EXTRACTION_EXPORTS[receipt.kind]?.extension??
        ({'portable-json':'json','portable-gzip':'json.gz','source-record':'json',
          'source-file':'bin','source-content':'bin'})[receipt.kind];
      need(extension,'EXTRACTION_MERCHANT_EXPORT_INVALID');
      const file=join(filesDirectory,receipt.kind+'-'+receipt.exportId+'.'+extension);
      const expected=fileRecord(file,receipt.bytes,receipt.exportId,receipt.contentType);
      try{await verifyFile(expected);journal.files[expected.relative]=expected;await persist();return expected;}
      catch(error){if(!isMissing(error))throw error;}
      let readId;
      const body=(async function*(){
        const digestor=createHash('sha256');let offset=0;
        try{
          while(true){
            const chunk=await call('merchant_research_file_read',{kind:receipt.kind,
              exportId:receipt.exportId,...(readId?{readId}:{}),offset,limit:MAX_RETAINED_CHUNK_BYTES});
            need(chunk.file?.sha256===receipt.exportId&&chunk.file?.bytes===receipt.bytes&&
              chunk.offset===offset&&chunk.encoding==='base64'&&typeof chunk.readId==='string'&&
              typeof chunk.data==='string','EXTRACTION_MERCHANT_CHUNK_CHANGED');
            const bytes=Buffer.from(chunk.data,'base64');
            need(bytes.toString('base64')===chunk.data&&chunk.bytesRead===bytes.length&&
              bytes.length<=MAX_RETAINED_CHUNK_BYTES&&offset+bytes.length<=receipt.bytes&&
              chunk.nextOffset===(offset+bytes.length<receipt.bytes?offset+bytes.length:null)&&
              (bytes.length>0||receipt.bytes===0),'EXTRACTION_MERCHANT_CHUNK_CHANGED');
            readId=chunk.nextOffset===null?undefined:chunk.readId;
            digestor.update(bytes);offset+=bytes.length;yield bytes;
            if(chunk.nextOffset===null)break;
          }
          need(offset===receipt.bytes&&digestor.digest('hex')===receipt.exportId,
            'EXTRACTION_MERCHANT_EXPORT_CHANGED');
        }finally{
          if(readId)await merchant.call('merchant_research_file_release',{workspace:alias,readId});
        }
      })();
      // Reuse the original write-once native file publisher, including its
      // temporary cleanup and directory sync; validate before final publication.
      const saved=await writePortableFile(file,{body,filename:receipt.sourceFilename,contentType:receipt.contentType});
      need(saved.sha256===receipt.exportId&&saved.bytes===receipt.bytes,'EXTRACTION_MERCHANT_EXPORT_CHANGED');
      journal.files[expected.relative]=expected;await persist();return expected;
    };
    const exported=[];
    const retainExport=async(kind,options={},sourceHash)=>{
      const value=await step('export-'+kind,async()=>{
        const expectedSelection={dossierId:config.dossierId,revision:config.revision,...options};
        delete expectedSelection.expectedSha256;
        const matches=(await receipts()).filter(row=>row.kind===kind&&
          row.workspaceId===config.expectedWorkspaceId&&
          Object.entries(expectedSelection).every(([key,value])=>same(row.selection?.[key],value))&&
          (!sourceHash||row.exportId===sourceHash));
        let receipt=matches.sort((a,b)=>a.retainedAt.localeCompare(b.retainedAt))[0];
        if(!receipt)receipt=await call('merchant_research_export',{
          dossierId:config.dossierId,revision:config.revision,kind,...options,
          ...(sourceHash?{expectedSha256:sourceHash}:{})
        });
        need(receipt.workspaceId===config.expectedWorkspaceId&&receipt.kind===kind&&
          Object.entries(expectedSelection).every(([key,value])=>same(receipt.selection?.[key],value))&&
          (!sourceHash||receipt.exportId===sourceHash),'EXTRACTION_MERCHANT_EXPORT_SELECTION_CHANGED');
        const receiptFile=await retainJson('export-'+kind+'-receipt',receipt);
        const file=await download(receipt);
        return {value:{kind,exportId:receipt.exportId,bytes:file.bytes,sha256:file.sha256,
          file,receiptFile,selection:receipt.selection},files:[receiptFile,file]};
      });
      exported.push(value);return value;
    };
    const occurrence=sourceValues.occurrence;
    need(typeof occurrence.editionId==='string'&&
      /^(0|[1-9][0-9]{0,8})$/.test(String(occurrence.key)),'EXTRACTION_MERCHANT_SOURCE_OCCURRENCE_CHANGED');
    const sourceRecord=await retainExport('source-record',{
      editionId:occurrence.editionId,key:String(occurrence.key)});
    const sourceContent=await retainExport(inputSource.fileName?'source-file':'source-content',{
      editionId:occurrence.editionId,key:String(occurrence.key),
      ...(inputSource.fileName?{fileName:inputSource.fileName}:{})
    },inputSource.sha256);
    for(const kind of Object.keys(RESEARCH_EXTRACTION_EXPORTS))
      await retainExport(kind,selected(config,kind.startsWith('extraction-publication-')?
        ['tableId','publicationId','againstPublicationId']:['formId','resultSetId']));
    await retainExport('portable-json');await retainExport('portable-gzip');
    check();
    await merchant.close();merchant=null;
    result={schema:SCHEMA,state:'COMPLETED',workspaceId:config.expectedWorkspaceId,
      ...selected(config,['dossierId','revision','formId','resultSetId','tableId','publicationId','againstPublicationId']),
      source:{...selected(inputSource,['occurrenceId','fileName','sha256','bytes']),
        pointerCount:sourceValues.pointerCount,valuesFile:sourceValues.file,
        contentFile:sourceContent.file,recordFile:sourceRecord.file},
      pages:{extraction:extractionPages,publications:publicationPages},
      replays,exports:exported,files:Object.values(journal.files),journalFile,completedAt:now()};
    journal.status='COMPLETED';journal.result=result;journal.completedAt=result.completedAt;
    delete journal.currentStep;delete journal.failure;await persist();return result;
  }catch(error){
    failure=error;
    if(merchant)try{await merchant.close();}catch(cleanup){
      failure=new AggregateError([error,cleanup],'Original Merchant receiving and owned close require attention.');
    }
    if(journal){
      journal.status='ATTENTION';journal.failure={code:failure.code??error.code??null,
        message:failure.message,at:now()};
      try{await persist();}catch(retention){
        failure=new AggregateError([failure,retention],'Original Merchant receiving outcome could not be retained.');
      }
    }
    throw failure;
  }finally{running.delete(directory);}
}
