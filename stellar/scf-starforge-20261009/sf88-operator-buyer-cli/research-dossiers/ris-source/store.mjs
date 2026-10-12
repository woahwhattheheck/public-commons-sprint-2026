// MIT. RIS editions use the original Dossier blob writer, exclusive revision CAS and portable history.
import {jsonBytes,need} from '../../node/store.mjs';
import {RIS_LIMITS,clone,sha,plain,exact,text,time,integer,canonical,valueSha,equal,descriptor,
  createRisSource,inspectRisSource,decodeBase64} from './schema.mjs';
import {prepareRisReview,createRisEdition,inspectRisEdition,risPreviewPage,compareRisEditions,
  selectedRisBytes,risRecordFile} from './review.mjs';

export const RIS_RECEIVE_MODE='ORIGINAL_RIS_SOURCE_REVIEW';
export const RIS_RECEIVE_CHANGE='Received reviewed original RIS sources';
const isRis=edition=>edition?.provider==='ris-document'||edition?.origin?.mode===RIS_RECEIVE_MODE;
const receiptId=(id,requestId)=>'risimport_'+sha(id+'\n'+requestId);
const occurrenceId=(editionId,index)=>'o_'+sha(editionId+'\n'+index);
const editionId=(questionId,rawSha,requestId)=>'e_'+sha(questionId+'\nris-document\n'+rawSha+'\nris:'+requestId);
const inputSha=inspected=>valueSha({source:inspected.prepared.descriptor,review:inspected.reviewed.review});
const revision=value=>integer(value,'RIS_REVISION_INVALID',1,99999999);
function previousEdition(state,review){
  need(state.questions.some(row=>row.id===review.questionId),'QUESTION_NOT_FOUND');
  if(!review.previous)return null;
  const previous=state.editions.find(row=>row.id===review.previous.editionId);
  need(previous&&isRis(previous)&&previous.mode==='retained'&&previous.questionId===review.questionId&&
    previous.raw.sha256===review.previous.sha256,'RIS_PREVIOUS_EDITION_CHANGED');
  return previous;
}
function receipt(edition){
  const value=edition.origin;
  return {schema:'sf88-research-ris-receipt-v1',id:value.receiptId,requestId:value.requestId,
    editionId:edition.id,questionId:edition.questionId,label:edition.label,createdAt:edition.createdAt,
    originalRevision:value.originalRevision,originalRevisionSha256:value.originalRevisionSha256,
    revision:value.revision,inputSha256:value.inputSha256,planSha256:value.planSha256,
    source:clone(value.source),edition:clone(edition.raw),documents:value.documentIds.length,
    records:value.recordIds.length,previous:clone(value.previous)};
}
function applyEdition(state,edition,inspected){
  const review=inspected.reviewed.review,previous=previousEdition(state,review);
  need(!state.editions.some(row=>row.id===edition.id||row.origin?.mode===RIS_RECEIVE_MODE&&
    row.origin.requestId===review.requestId),'RIS_REQUEST_ALREADY_RECEIVED');
  if(previous&&review.previous.priorSelection==='deselect'){
    for(const selection of state.selections)if(selection.editionId===previous.id)
      Object.assign(selection,{selected:false,updatedAt:edition.createdAt});
  }
  state.editions.push(clone(edition));
  for(let index=0;index<inspected.reviewed.rows.length;index++){
    const choice=inspected.reviewed.rows[index].choice;
    state.selections.push({occurrenceId:occurrenceId(edition.id,index),editionId:edition.id,
      questionId:edition.questionId,key:String(index),selected:choice.selected,
      note:choice.note,classification:choice.classification,updatedAt:edition.createdAt});
  }
}
function expectedEdition(state,inspected,{createdAt,originalRevisionSha256}){
  const {prepared,reviewed}=inspected,review=reviewed.review,raw=inspected.descriptor;
  return {id:editionId(review.questionId,raw.sha256,review.requestId),questionId:review.questionId,
    label:prepared.source.label,provider:'ris-document',mode:'retained',createdAt,raw:clone(raw),
    sourceReference:prepared.source.sourceReference,sourceTerms:prepared.source.sourceTerms,
    origin:{mode:RIS_RECEIVE_MODE,intentId:'ris:'+review.requestId,requestId:review.requestId,
      receiptId:receiptId(state.id,review.requestId),inputSha256:inputSha(inspected),planSha256:reviewed.planSha256,
      source:clone(prepared.descriptor),originalRevision:state.revision,
      originalRevisionSha256,revision:state.revision+1,
      documentIds:prepared.source.documents.map(row=>row.id),
      recordIds:reviewed.rows.map(row=>row.record.id),previous:clone(review.previous)}};
}
async function readEdition(edition,readContent,cache){
  need(edition?.provider==='ris-document'&&edition?.origin?.mode===RIS_RECEIVE_MODE&&
    edition.mode==='retained','RIS_REVIEWED_EDITION_REQUIRED');
  const raw=descriptor(edition.raw),key='ris-edition:'+raw.sha256+':'+raw.bytes;
  if(cache?.has(key))return cache.get(key);
  const bytes=await readContent(raw);
  need(Buffer.isBuffer(bytes)&&bytes.length===raw.bytes&&sha(bytes)===raw.sha256,'RIS_EDITION_CHANGED');
  const inspected=inspectRisEdition(bytes);cache?.set(key,inspected);return inspected;
}
export async function validateRisState(state,readContent,cache=new Map()){
  const requests=new Set();
  for(const edition of state.editions.filter(isRis)){
    const inspected=await readEdition(edition,readContent,cache),origin=edition.origin;
    revision(origin.originalRevision);revision(origin.revision);
    need(origin.revision===origin.originalRevision+1&&origin.revision<=state.revision&&
      /^[a-f0-9]{64}$/.test(origin.originalRevisionSha256),'RIS_PORTABLE_REVISION_INVALID');
    time(edition.createdAt,'RIS_RECEIPT_TIME_INVALID');
    const base={id:state.id,revision:origin.originalRevision};
    const expected=expectedEdition(base,inspected,{createdAt:edition.createdAt,
      originalRevisionSha256:origin.originalRevisionSha256});
    need(equal(edition,expected),'RIS_PORTABLE_SOURCE_BINDING_CHANGED');
    need(!requests.has(origin.requestId),'RIS_PORTABLE_REQUEST_DUPLICATE');requests.add(origin.requestId);
    const prior=previousEdition(state,inspected.reviewed.review);
    need(!prior||prior.id!==edition.id&&prior.origin.revision<origin.revision,'RIS_PREVIOUS_EDITION_CHANGED');
  }
}
export async function validateRisTransition(previous,state,readContent,cache=new Map()){
  const before=new Map((previous?.editions??[]).filter(isRis).map(row=>[row.id,row]));
  const after=new Map(state.editions.filter(isRis).map(row=>[row.id,row]));
  for(const[id,edition]of before)need(after.has(id)&&equal(after.get(id),edition),'RIS_PORTABLE_HISTORY_CHANGED');
  const added=[...after.values()].filter(row=>!before.has(row.id));
  if(!added.length){need(state.change!==RIS_RECEIVE_CHANGE,'RIS_PORTABLE_RECEIPT_MISSING');return;}
  need(previous&&added.length===1&&state.revision===previous.revision+1&&state.change===RIS_RECEIVE_CHANGE,
    'RIS_PORTABLE_ATOMIC_REVISION_INVALID');
  const edition=added[0],inspected=await readEdition(edition,readContent,cache),origin=edition.origin;
  need(origin.originalRevision===previous.revision&&origin.revision===state.revision&&
    origin.originalRevisionSha256===state.previous,'RIS_PORTABLE_ORIGINAL_REVISION_CHANGED');
  const expected=clone(previous);applyEdition(expected,edition,inspected);
  Object.assign(expected,{revision:state.revision,previous:state.previous,updatedAt:state.updatedAt,change:state.change});
  need(equal(expected,state),'RIS_PORTABLE_ATOMIC_REPLAY_CHANGED');
}
function originalCsv(inspected){
  const rows=[['record_id','document','database','query','selected','classification','note','title','doi','year',
    'authors_json','native_fields_json','record_sha256']];
  for(const {record,choice,metadata}of inspected.reviewed.rows)rows.push([record.id,record.documentFilename,
    record.database,record.query,choice.selected,choice.classification,choice.note,metadata.title,metadata.doi,
    metadata.year,JSON.stringify(metadata.authors),JSON.stringify(record.tags.map(row=>({tag:row.tag,value:row.value}))),record.sha256]);
  const cell=value=>{
    let s=String(value??'');if(/^[\u0000-\u0020]*[=+\-@]/.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  };
  return Buffer.from(rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n');
}
function reviewReport(edition,inspected,{html=false}={}){
  const data={receipt:receipt(edition),source:inspected.prepared.descriptor,
    originalDocuments:inspected.prepared.analysis.documents,review:inspected.reviewed.review,
    diagnostics:inspected.prepared.analysis.diagnostics,
    records:inspected.reviewed.rows.map(({record,choice,metadata})=>({
      recordId:record.id,documentId:record.documentId,filename:record.documentFilename,
      ordinal:record.ordinal,bytes:record.bytes,sha256:record.sha256,start:record.start,end:record.end,
      complete:record.complete,metadata,choice,fields:record.tags,diagnostics:record.diagnostics}))};
  const body=JSON.stringify(data,null,2);
  if(html){
    const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'","&#39;");
    return Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+
      '<title>'+escape(edition.label)+' — original RIS review</title><style>body{max-width:78rem;margin:3rem auto;padding:0 1.5rem;font:16px/1.55 system-ui;color:#172833;background:#f7f8f5}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:1.5rem;border:1px solid #ccd5d8}h1{font-size:2rem}</style>'+
      '<h1>'+escape(edition.label)+'</h1><p>Original RIS review · revision '+edition.origin.revision+
      '. This report preserves the saved import decisions and full original field values. Later evidence edits remain in the original dossier history.</p><pre>'+
      escape(body)+'</pre></html>\n');
  }
  const fence=String.fromCharCode(96).repeat(3);
  return Buffer.from('# '+edition.label.replaceAll('\n',' ')+' — original RIS review\n\n'+
    'Original import revision '+edition.origin.revision+'. Full original fields and saved decisions follow. Later evidence edits remain in the dossier history.\n\n'+
    fence+'json\n'+body+'\n'+fence+'\n');
}
export function createRisSourceStore({head,commit,metadata,blob,putBlob}){
  const cacheFor=()=>new Map();
  async function originalSource(state,selected){
    const wanted=descriptor(selected);
    need(wanted.bytes<=RIS_LIMITS.sourceBytes,'RIS_SOURCE_TOO_LARGE');
    try{
      const bytes=await blob(wanted);return inspectRisSource(bytes);
    }catch(error){
      if(error.code!=='ENOENT')throw error;
      // A received portable contains the complete source inside its immutable
      // edition. Recover that original representation, without a new acquisition.
      for(const edition of state.editions.filter(isRis)){
        if(!equal(edition.origin?.source,wanted))continue;
        const inspected=await readEdition(edition,blob,cacheFor());
        need(equal(inspected.prepared.descriptor,wanted),'RIS_SOURCE_CHANGED');
        return inspected.prepared;
      }
      throw error;
    }
  }
  const findRequest=(state,requestId)=>state.editions.find(edition=>
    edition.origin?.mode===RIS_RECEIVE_MODE&&edition.origin.requestId===requestId);
  async function checkedRequest(state,inspected,{required=false}={}){
    const existing=findRequest(state,inspected.reviewed.review.requestId);
    if(!existing){need(!required,'RIS_REQUEST_NOT_FOUND');return null;}
    need(existing.origin.inputSha256===inputSha(inspected)&&existing.origin.planSha256===inspected.reviewed.planSha256&&
      equal(existing.raw,inspected.descriptor),'RIS_REQUEST_INPUT_CHANGED');
    const original=await readEdition(existing,blob,cacheFor());
    need(equal(original.edition,inspected.edition),'RIS_REQUEST_INPUT_CHANGED');
    return {dossier:metadata(state),receipt:receipt(existing),duplicate:true};
  }
  async function prepareRis(id,input={}){
    exact(input,['source','sourceFile','review','offset','limit','recordId'],'RIS_PREPARE_INPUT_INVALID');
    need([input.source!==undefined,input.sourceFile!==undefined].filter(Boolean).length===1,'RIS_ONE_SOURCE_INPUT_REQUIRED');
    let prepared;
    if(input.sourceFile!==undefined){
      exact(input.sourceFile,['bodyBase64','sha256','bytes'],'RIS_SOURCE_FILE_INPUT_INVALID');
      const bytes=decodeBase64(input.sourceFile.bodyBase64,{maximum:RIS_LIMITS.sourceBytes});
      need(bytes.length===input.sourceFile.bytes&&sha(bytes)===input.sourceFile.sha256,'RIS_SOURCE_CHANGED');
      prepared=inspectRisSource(bytes);
    }else prepared=createRisSource(input.source);
    const reviewed=prepareRisReview(prepared,input.review),current=await head(id);
    previousEdition(current.state,reviewed.review);
    const stored=await putBlob(prepared.bytes);
    need(equal(stored,prepared.descriptor),'RIS_SOURCE_CHANGED');
    return {dossier:metadata(current.state),...risPreviewPage(reviewed,input)};
  }
  async function previewRis(id,input={}){
    exact(input,['source','review','offset','limit','recordId'],'RIS_PREVIEW_INPUT_INVALID');
    const current=await head(id),prepared=await originalSource(current.state,input.source);
    const reviewed=prepareRisReview(prepared,input.review);
    previousEdition(current.state,reviewed.review);
    const existing=findRequest(current.state,reviewed.review.requestId);let completed=null;
    // An incomplete readonly preview may recover current record/group choices
    // from a full draft. It is never an accepted request or a receiving receipt.
    if(existing&&reviewed.complete){
      const inspected=createRisEdition(prepared,reviewed.review,{expectedPlanSha256:reviewed.planSha256});
      completed=await checkedRequest(current.state,inspected);
    }
    return {dossier:metadata(current.state),...risPreviewPage(reviewed,input),
      requestReceived:Boolean(existing),...(completed?{receipt:completed.receipt,duplicate:true}:{})};
  }
  async function receiveRis(id,input={}){
    exact(input,['source','review','expectedPlanSha256','expectedRevision'],'RIS_RECEIVE_INPUT_INVALID');
    const current=await head(id),prepared=await originalSource(current.state,input.source);
    const inspected=createRisEdition(prepared,input.review,{expectedPlanSha256:input.expectedPlanSha256});
    const duplicate=await checkedRequest(current.state,inspected);if(duplicate)return duplicate;
    previousEdition(current.state,inspected.reviewed.review);revision(input.expectedRevision);
    const now=new Date().toISOString();
    let made;
    try{
      const dossier=await commit(id,input.expectedRevision,RIS_RECEIVE_CHANGE,async(state,prior)=>{
        previousEdition(prior,inspected.reviewed.review);
        need(!findRequest(prior,inspected.reviewed.review.requestId),'RIS_REQUEST_ALREADY_RECEIVED');
        const raw=await putBlob(inspected.bytes);need(equal(raw,inspected.descriptor),'RIS_EDITION_CHANGED');
        // commit's exact prior head has the same immutable revision as this
        // selected current head; any intervening writer fails original CAS.
        need(prior.revision===current.state.revision,'REVISION_CONFLICT');
        made=expectedEdition(prior,inspected,{createdAt:now,originalRevisionSha256:current.sha256});
        applyEdition(state,made,inspected);
      },{projection:'metadata'});
      return {dossier,receipt:receipt(made),duplicate:false};
    }catch(error){
      if(['REVISION_CONFLICT','RIS_REQUEST_ALREADY_RECEIVED'].includes(error.code)){
        const latest=await head(id),recovered=await checkedRequest(latest.state,inspected);
        if(recovered)return recovered;
      }
      throw error;
    }
  }
  async function risSources(id,input={}){
    exact(input,['revision','editionId','requestId','offset','limit','recordId'],'RIS_SOURCE_LIST_INPUT_INVALID');
    if(input.revision!==undefined)revision(input.revision);
    const current=await head(id,input.revision),state=current.state;
    need(!(input.editionId&&input.requestId),'RIS_ONE_RECEIPT_SELECTOR_REQUIRED');
    if(input.requestId!==undefined){
      text(input.requestId,'RIS_REQUEST_ID_REQUIRED',240);
      const found=findRequest(state,input.requestId);need(found,'RIS_REQUEST_NOT_FOUND');
      await readEdition(found,blob,cacheFor());
      return {dossier:metadata(state),receipt:receipt(found),duplicate:true};
    }
    if(input.editionId!==undefined){
      const edition=state.editions.find(row=>row.id===input.editionId);
      const inspected=await readEdition(edition,blob,cacheFor());
      const result=risPreviewPage(inspected.reviewed,input);
      const selected=new Map(state.selections.filter(row=>row.editionId===edition.id).map(row=>[row.key,row]));
      const addCurrent=row=>{
        const index=inspected.reviewed.rows.findIndex(value=>value.record.id===row.recordId);
        return {...row,occurrenceId:occurrenceId(edition.id,index),currentSelection:clone(selected.get(String(index))??null)};
      };
      if(result.record)result.record=addCurrent(result.record);
      if(result.records)result.records=result.records.map(addCurrent);
      return {dossier:metadata(state),receipt:receipt(edition),...result};
    }
    const offset=input.offset??0,limit=input.limit??30;
    integer(offset,'RIS_OFFSET_INVALID',0,99999999);integer(limit,'RIS_LIMIT_INVALID',1,100);
    const all=state.editions.filter(isRis).map(receipt);
    return {schema:'sf88-research-ris-editions-v1',dossier:metadata(state),revision:state.revision,
      total:all.length,offset,limit,items:all.slice(offset,offset+limit),nextOffset:offset+limit<all.length?offset+limit:null};
  }
  async function comparisonSelection(id,input){
    if(input.revision!==undefined)revision(input.revision);
    const current=await head(id,input.revision),a=current.state.editions.find(row=>row.id===input.before),
      b=current.state.editions.find(row=>row.id===input.after),cache=cacheFor();
    need(a&&b&&a.questionId===b.questionId,'RIS_COMPARISON_QUESTION_CHANGED');
    const result=compareRisEditions(await readEdition(a,blob,cache),await readEdition(b,blob,cache));
    return {current,a,b,result};
  }
  async function compareRis(id,input={}){
    exact(input,['revision','before','after','section','offset','limit'],'RIS_COMPARE_INPUT_INVALID');
    const {current,a,b,result}=await comparisonSelection(id,input);
    const section=input.section??'changed',offset=input.offset??0,limit=input.limit??30;
    need(['added','absent','changed','unchanged'].includes(section),'RIS_COMPARISON_SECTION_INVALID');
    integer(offset,'RIS_OFFSET_INVALID',0,99999999);integer(limit,'RIS_LIMIT_INVALID',1,100);
    const rows=result[section];
    return {schema:result.schema,dossier:metadata(current.state),before:receipt(a),after:receipt(b),
      interpretation:result.interpretation,counts:result.counts,section,offset,limit,
      items:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null};
  }
  async function exportRisComparison(id,input={}){
    exact(input,['revision','before','after','format'],'RIS_COMPARE_EXPORT_INPUT_INVALID');
    const {current,a,b,result}=await comparisonSelection(id,input),format=input.format??'json';
    need(['json','html','md'].includes(format),'RIS_COMPARISON_EXPORT_FORMAT_INVALID');
    const data={...result,dossier:{id:current.state.id,title:current.state.title,revision:current.state.revision},
      beforeReceipt:receipt(a),afterReceipt:receipt(b)};
    const title='RIS source comparison: '+a.label+' to '+b.label;
    let bytes,contentType;
    if(format==='json'){bytes=jsonBytes(data);contentType='application/json';}
    else{
      const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
        .replaceAll('"','&quot;').replaceAll("'","&#39;");
      const sections=['changed','added','absent','unchanged'],fence=String.fromCharCode(96).repeat(3);
      if(format==='html'){
        const summary=sections.map(name=>'<li>'+escape(name)+': '+result.counts[name]+'</li>').join('');
        const rows=sections.map(name=>'<section><h2>'+escape(name)+'</h2>'+result[name].map(row=>
          '<article><h3>'+escape(row.identity)+'</h3><pre>'+escape(JSON.stringify(row,null,2))+'</pre></article>').join('')+'</section>').join('');
        bytes=Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+
          '<title>'+escape(title)+'</title><style>body{max-width:80rem;margin:3rem auto;padding:0 1.5rem;font:16px/1.55 system-ui;color:#182d37;background:#f7f8f5}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;padding:1.25rem;border:1px solid #ccd5d8}h3{overflow-wrap:anywhere}article{margin:1.5rem 0}</style>'+
          '<h1>'+escape(title)+'</h1><p>'+escape(result.interpretation)+'</p><p>Original dossier revision '+current.state.revision+
          '. The full saved import choices and native field values are included.</p><ul>'+summary+'</ul>'+
          '<details><summary>Original receiving and source identities</summary><pre>'+escape(JSON.stringify({
            dossier:data.dossier,beforeReceipt:data.beforeReceipt,afterReceipt:data.afterReceipt},null,2))+'</pre></details>'+rows+'</html>\n');
        contentType='text/html; charset=utf-8';
      }else{
        const rows=sections.map(name=>'## '+name+'\n\n'+result[name].map(row=>'### '+row.identity+'\n\n'+
          fence+'json\n'+JSON.stringify(row,null,2)+'\n'+fence+'\n').join('\n')).join('\n');
        bytes=Buffer.from('# '+title.replaceAll('\n',' ')+'\n\n'+result.interpretation+'\n\nOriginal dossier revision '+
          current.state.revision+'. Full saved import choices and native field values follow.\n\n'+
          sections.map(name=>'- '+name+': '+result.counts[name]).join('\n')+'\n\n## Original receiving identities\n\n'+
          fence+'json\n'+JSON.stringify({dossier:data.dossier,beforeReceipt:data.beforeReceipt,afterReceipt:data.afterReceipt},null,2)+
          '\n'+fence+'\n\n'+rows);
        contentType='text/markdown; charset=utf-8';
      }
    }
    return {filename:a.id+'.to.'+b.id+'.comparison.'+format,contentType,bytes,sha256:sha(bytes),
      revision:current.state.revision,editionId:b.id,beforeEditionId:a.id,representation:'derived-complete-source-comparison'};
  }
  async function exportRis(id,input={}){
    exact(input,['revision','editionId','format','documentId','recordId'],'RIS_EXPORT_INPUT_INVALID');
    const current=await head(id,input.revision),edition=current.state.editions.find(row=>row.id===input.editionId);
    const inspected=await readEdition(edition,blob,cacheFor()),format=input.format??'edition';
    const prefix=edition.id;let bytes,filename,contentType,representation;
    if(format==='edition'){bytes=inspected.bytes;filename=prefix+'.ris-edition.json';contentType='application/json';representation='original-reviewed-edition';}
    else if(format==='source'){bytes=inspected.prepared.bytes;filename=prefix+'.ris-source.json';contentType='application/json';representation='original-prepared-source';}
    else if(format==='document'){
      const document=inspected.prepared.source.documents.find(row=>row.id===input.documentId);
      need(document,'RIS_DOCUMENT_NOT_FOUND');bytes=decodeBase64(document.bodyBase64);filename=document.filename;
      contentType='application/octet-stream';representation='original-ris-document';
    }else if(format==='record'){
      const selected=risRecordFile(inspected,input.recordId);bytes=selected.bytes;
      filename=selected.record.id+'.ris';contentType='application/octet-stream';representation='original-record-byte-span';
    }else if(format==='selected-ris'){
      bytes=selectedRisBytes(inspected);filename=prefix+'.selected.utf8.ris';
      contentType='application/x-research-info-systems; charset=utf-8';representation='derived-selected-utf8';
    }else if(format==='csv'){
      bytes=originalCsv(inspected);filename=prefix+'.review.csv';contentType='text/csv; charset=utf-8';representation='derived-review-csv';
    }else if(format==='html'||format==='md'){
      bytes=reviewReport(edition,inspected,{html:format==='html'});filename=prefix+'.review.'+format;
      contentType=format==='html'?'text/html; charset=utf-8':'text/markdown; charset=utf-8';representation='derived-full-review-report';
    }else need(false,'RIS_EXPORT_FORMAT_INVALID');
    return {filename,contentType,bytes,sha256:sha(bytes),revision:current.state.revision,editionId:edition.id,representation};
  }
  return Object.freeze({prepareRis,previewRis,receiveRis,risSources,compareRis,exportRis,exportRisComparison});
}
