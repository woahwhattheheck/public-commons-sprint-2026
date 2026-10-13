// MIT. Receive the original native issuer programme in the existing submission draft.
import {MAX_ISSUER_BYTES,ISSUER_BUNDLE_SCHEMA,ISSUER_CONTEXT_SCHEMA,TERMS_SCHEMA,CORRESPONDENCE_SCHEMA,
  issuerNeed as need,issuerCanonical as canonical,issuerClone as clone,issuerWorkingSelection,
  validateIssuerContext,issuerContexts,selectedIssuerContext} from './grant-issuer-core.mjs';
import {parseNativeJson,nativeCanonical,readPlanningZip,receivePlanningFile,encodeBase64,decodeBase64} from './grant-plan-source.mjs';
import {emptyHandover,safeFilename,referenceUrl} from './grant-handover-core.mjs';
import {validateDraft,retainVersion,receivePlanningSource} from './grant-submission-core.mjs';
const OPERATIONS_SCHEMA='stellar-forge.sf47-operations.v1';
const PLAN_FIELDS=['source','revision','scenario','planning','report','savedAt','note','contentSha256'];
const now=()=>new Date().toISOString();
const encode=value=>new TextEncoder().encode(value);
const decode=value=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(value);
async function digest(bytes){
  need(globalThis.crypto?.subtle,'Open the original submission workspace through HTTPS or its loopback host.');
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
}
async function inflate(bytes,maximum){
  need(typeof DecompressionStream==='function','Receive this original ZIP in a browser with native ZIP decompression, or use the installed grant exporter.');
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),parts=[];
  let count=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;
    if(count>maximum){await reader.cancel();throw new Error('The original issuer ZIP entry exceeds its declared size.');}parts.push(value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(count);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
const crcTable=Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const value of bytes)crc=crcTable[(crc^value)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function safePath(name){return typeof name==='string'&&name&&!name.startsWith('/')&&!name.includes('\\')&&
  !/[\u0000-\u001f\u007f]/.test(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');}
/** Original native bundle reception in memory. Files stay inside the complete ZIP. */
export async function readIssuerZip(bytes,{inflate:expand=inflate,decode:text=decode}={}){
  need(bytes instanceof Uint8Array&&bytes.length>=22&&bytes.length<=MAX_ISSUER_BYTES,
    'Open the complete original issuer Operations ZIP up to 32 MiB.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)
    if(view.getUint32(at,true)===0x06054b50&&at+22+view.getUint16(at+20,true)===bytes.length){end=at;break;}
  need(end>=0,'Receive the original complete ZIP directory.');
  need(view.getUint16(end+4,true)===0&&view.getUint16(end+6,true)===0,'Receive the original single-volume export.');
  const count=view.getUint16(end+10,true),central=view.getUint32(end+16,true),centralSize=view.getUint32(end+12,true);
  need(count>=12&&count<=220&&view.getUint16(end+8,true)===count&&central+centralSize===end,
    'Receive the complete native Operations entry set.');
  const entries=[],names=new Set(),ranges=[];let offset=central,total=0;
  for(let index=0;index<count;index++){
    need(offset+46<=end&&view.getUint32(offset,true)===0x02014b50,'Keep the original ZIP entry directory.');
    const flags=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true),crc=view.getUint32(offset+16,true),
      packed=view.getUint32(offset+20,true),size=view.getUint32(offset+24,true),nameSize=view.getUint16(offset+28,true),
      extraSize=view.getUint16(offset+30,true),commentSize=view.getUint16(offset+32,true),disk=view.getUint16(offset+34,true),
      external=view.getUint32(offset+38,true),local=view.getUint32(offset+42,true);
    need(offset+46+nameSize+extraSize+commentSize<=end,'Keep the complete native ZIP entry metadata.');
    const name=text(bytes.subarray(offset+46,offset+46+nameSize));
    need(safePath(name)&&!names.has(name),'Retain unique original regular entry names.');names.add(name);
    const type=(external>>>16)&0xf000;
    need(type===0||type===0x8000,'Receive original regular files.');
    need(!(flags&1)&&[0,8].includes(method)&&disk===0,'Receive the original unencrypted Operations ZIP.');
    total+=size;need(total<=MAX_ISSUER_BYTES&&packed<=MAX_ISSUER_BYTES,'The expanded complete issuer programme exceeds 32 MiB.');
    need(local+30<=central&&view.getUint32(local,true)===0x04034b50,'Keep each original local ZIP header.');
    const localFlags=view.getUint16(local+6,true),localMethod=view.getUint16(local+8,true),
      localNameSize=view.getUint16(local+26,true),localExtraSize=view.getUint16(local+28,true),
      data=local+30+localNameSize+localExtraSize;
    need(localFlags===flags&&localMethod===method&&data+packed<=central&&
      text(bytes.subarray(local+30,local+30+localNameSize))===name,'Original local and central entry metadata differ.');
    if(!(flags&8))need(view.getUint32(local+14,true)===crc&&view.getUint32(local+18,true)===packed&&view.getUint32(local+22,true)===size,
      'Retain matching original ZIP entry sizes and checksums.');
    entries.push({name,method,crc,packed,size,data});ranges.push([local,data+packed]);
    offset+=46+nameSize+extraSize+commentSize;
  }
  need(offset===end,'Keep the complete original ZIP directory.');
  ranges.sort((a,b)=>a[0]-b[0]);need(ranges.every((range,index)=>!index||range[0]>=ranges[index-1][1]),'Retain separate original ZIP entries.');
  const files=new Map();
  for(const entry of entries){
    const packed=bytes.subarray(entry.data,entry.data+entry.packed),raw=entry.method===0?new Uint8Array(packed):await expand(packed,entry.size);
    need(raw instanceof Uint8Array&&raw.length===entry.size&&crc32(raw)===entry.crc,'An original issuer entry is incomplete: '+entry.name);
    files.set(entry.name,raw);
  }
  return files;
}
function child(node,key){
  const value=node?.kind==='object'&&node.entries.find(row=>row[0]===key)?.[1];
  need(value,'Retain the complete original '+key+' field.');return value;
}
function omit(node,keys){need(node.kind==='object','Retain an original JSON object.');return {...node,entries:node.entries.filter(([key])=>!keys.includes(key))};}
function object(entries){return {kind:'object',entries,value:Object.fromEntries(entries.map(([key,node])=>[key,node.value]))};}
function scalar(value){return typeof value==='number'?{kind:'number',raw:String(value),value}:{kind:'scalar',value};}
async function nativeHash(node,hash,encoding){return hash(encoding(nativeCanonical(node)));}
async function verifySeal(node,label,hash,encoding,key='sha256'){
  need(await nativeHash(omit(node,[key]),hash,encoding)===node.value[key],'The retained '+label+' differs from its complete native identity.');
}
function samePlan(left,right){return PLAN_FIELDS.every(key=>nativeCanonical(child(left,key))===nativeCanonical(child(right,key)));}
function sourceReferenceIds(document){
  return [...new Set([...(document.sourceIds||[]),...(document.guidanceSourceIds||[]),
    ...(document.fieldSources||[]).flatMap(row=>row.sourceIds||[]),
    ...(document.award?.tranches||[]).flatMap(row=>row.sourceIds||[]),
    ...(document.award?.metric?.sourceIds||[])])].sort();
}
function sourceFile(received,sha){
  const original=received.handover?.objects.find(row=>row.sha256===sha);
  need(original,'Retain the original complete issuer handover file.');return decodeBase64(original.base64);
}
function eventFor(document,value,action){
  const event=document.events[value.caseVersion-1];
  need(event&&event.version===value.caseVersion&&event.action===action&&event.actor===value.actor&&
    (event.note||'')===(value.note||''),'The original issuer record differs from its native save event.');
  return event;
}
/** Returns a verified transient view; the parent draft retains the original ZIP once. */
export async function receiveIssuerProgrammeFile(bytes,{
  filename='issuer-programme.zip',receivedAt=now(),planningOptions={},
}={}){
  const hashing=planningOptions.digest||digest,text=planningOptions.decode||decode,encoding=planningOptions.encode||encode;
  const files=await readIssuerZip(bytes,planningOptions),trees=new Map();
  const tree=name=>{need(files.has(name),'Retain original '+name+'.');if(!trees.has(name))trees.set(name,parseNativeJson(text(files.get(name))));return trees.get(name);};
  const manifest=tree('MANIFEST.json').value;
  need(manifest.schema===ISSUER_BUNDLE_SCHEMA&&Array.isArray(manifest.files)&&manifest.files.length===files.size-1,
    'Open the complete original issuer Operations handover.');
  need(new Set(manifest.files.map(row=>row.path)).size===manifest.files.length&&
    manifest.files.every(row=>row.path!=='MANIFEST.json'&&files.has(row.path)),
    'Retain the exact manifest entry set.');
  for(const entry of manifest.files){
    const raw=files.get(entry.path);
    need(raw.length===entry.bytes&&await hashing(raw)===entry.sha256,'An issuer file differs from the original manifest: '+entry.path);
  }
  for(const name of ['planning.zip','operations.json','summary.json','README.txt','recorded-cash.csv',
    'invoice-balances.csv','recorded-work.csv','plan-versus-actual.csv','award-terms-selection.json','award-terms.html','award-terms.csv'])
    need(files.has(name),'Choose Export complete issuer case, including '+name+'.');
  const operationTree=tree('operations.json'),document=operationTree.value;
  need(document.schema===OPERATIONS_SCHEMA&&Array.isArray(document.sources)&&Array.isArray(document.events),
    'Keep the complete original Operations document and source history.');
  const programme=document.program;
  need(programme&&document.plan&&Array.isArray(document.amendments||[])&&document.events.length===programme.version,
    'Retain the original selected plan and complete case events.');
  need(document.events.every((event,index)=>event.version===index+1),'Retain the consecutive original case history.');
  const sources=new Map();
  for(const metadata of document.sources){
    need(metadata&&typeof metadata.id==='string'&&!sources.has(metadata.id)&&safePath('sources/'+metadata.id),
      'Retain unique original source identities.');
    const raw=files.get('sources/'+metadata.id);
    need(raw&&raw.length===metadata.bytes&&await hashing(raw)===metadata.sha256,'Retain the complete original source '+metadata.id+'.');
    sources.set(metadata.id,metadata);
  }
  need([...files.keys()].filter(name=>name.startsWith('sources/')).length===sources.size,'Retain the exact original source-file set.');
  const planSource=await receivePlanningFile(files.get('planning.zip'),{...planningOptions,filename:'planning.zip',receivedAt});
  const planningFiles=await readPlanningZip(files.get('planning.zip'),planningOptions);
  const nativePlans=child(parseNativeJson(text(planningFiles.get('workspace.json'))),'revisions').items;
  const planNodes=new Map(nativePlans.map(node=>[node.value.revision,node]));
  const operatingPlan=child(operationTree,'plan'),selectedPlan=planNodes.get(programme.planRevision);
  need(programme.planId===planSource.document.id&&document.plan.id===programme.planId&&selectedPlan&&
    document.plan.revision===programme.planRevision&&samePlan(operatingPlan,selectedPlan),
    'The case-selected plan must remain an exact original native revision.');
  const terms=[],commissioning=[],correspondence=[];
  for(const metadata of sources.values()){
    const isTerms=metadata.awardTerms!==undefined,isBinding=metadata.awardTermsCommissioning!==undefined,isMessage=metadata.issuerCorrespondence!==undefined;
    if(!isTerms&&!isBinding&&!isMessage)continue;
    need(Number(isTerms)+Number(isBinding)+Number(isMessage)===1,'Retain the original single-purpose native source marker.');
    const node=tree('sources/'+metadata.id),value=node.value;
    await verifySeal(node,'issuer source',hashing,encoding);
    if(isTerms){
      need(value.schema===TERMS_SCHEMA&&canonical(metadata.awardTerms)===canonical({schema:TERMS_SCHEMA,id:value.id,revision:value.revision,sha256:value.sha256}),
        'Retain the exact original issuer-terms marker.');
      const event=eventFor(document,value,'award-terms.save');
      need(canonical(event.sourceChange?.issuerTermsSource)===canonical(metadata),'Retain the original native terms source event.');
      const captured=child(node,'source'),historic=child(captured,'plan'),plan=planNodes.get(historic.value.revision);
      need(plan&&samePlan(historic,plan)&&typeof value.source.case.id==='string'&&
        value.source.case.planId===historic.value.id&&value.source.case.version===value.caseVersion-1&&value.source.case.planRevision===historic.value.revision,
        'Retain the selected historical plan for this issuer edition.');
      const references=sourceReferenceIds(value.document);
      need(references.every(id=>sources.has(id))&&canonical(value.source.sources)===canonical(references.map(id=>sources.get(id))),
        'Retain the exact original sources selected for this terms edition.');
      const preview=object([['schema',scalar(TERMS_SCHEMA+'.preview')],
        ['inputs',object([['id',child(node,'id')],['expectedRevision',scalar(value.revision-1)],['document',child(node,'document')]])],
        ['source',captured],['comparison',child(node,'comparison')]]);
      need(await nativeHash(preview,hashing,encoding)===value.previewSha256,'Retain the complete original issuer comparison preview.');
      if(value.document.stage==='UNRECORDED')need(event.kind==='source'&&event.recordId===metadata.id&&canonical(event.after)===canonical(metadata),
        'Retain the original terms-draft save.');
      else {
        const after=event.after||{};
        need(event.kind==='awards'&&event.recordId===value.nativeAwardId&&after.id===value.nativeAwardId&&
          after.stage===value.document.stage&&after.reference===value.document.issuer.reference&&after.date===value.document.issuer.issuedOn&&
          canonical(after.amountUsd)===canonical(value.document.award?.amountUsd??null)&&
          canonical(after.sourceIds)===canonical([...new Set([...value.document.sourceIds,metadata.id])]),
          'Retain the observed issuer stage with its exact source record.');
      }
      terms.push({source:metadata,edition:value,node});
    }else if(isBinding){
      need(value.schema===TERMS_SCHEMA+'.commissioning'&&canonical(metadata.awardTermsCommissioning)===canonical({schema:value.schema,id:value.id,sha256:value.sha256}),
        'Retain the exact original commissioning source marker.');
      const event=eventFor(document,value,'award-terms.plan-bind');
      need(event.kind==='source'&&event.recordId===metadata.id&&canonical(event.after)===canonical(metadata)&&
        canonical(event.sourceChange?.issuerTermsCommissioning)===canonical(metadata),'Retain the original commissioning save event.');
      await verifySeal(child(node,'preview'),'commissioning preview',hashing,encoding,'previewSha256');
      const selected=child(node,'selectedPlan'),plan=planNodes.get(selected.value.revision);
      need(plan&&samePlan(selected,plan),'Retain the exact commissioned native plan.');
      commissioning.push({source:metadata,edition:value,node});
    }else{
      need(value.schema===CORRESPONDENCE_SCHEMA&&canonical(metadata.issuerCorrespondence)===canonical({schema:value.schema,id:value.id,sha256:value.sha256})&&
        value.inspection?.schema==='stellar-forge.issuer-correspondence.v1'&&Array.isArray(value.selected),
        'Retain the complete original message receiving index.');
      const event=eventFor(document,value,'issuer-correspondence.bind');
      need(event.kind==='source'&&event.recordId===metadata.id&&canonical(event.after)===canonical(metadata)&&
        value.initialCaseVersion+value.selected.length+1===value.caseVersion,'Retain the original message-receiving event.');
      need(await nativeHash(child(node,'identity'),hashing,encoding)===value.inspectionSha256,'Retain the exact inspected message identity.');
      const original=value.selected.find(row=>row.path==='original');
      need(original&&new Set(value.selected.map(row=>row.key)).size===value.selected.length&&
        original.source.sha256===value.identity.sha256&&original.source.bytes===value.identity.bytes&&
        value.inspection.original.sha256===value.identity.sha256&&value.inspection.original.bytes===value.identity.bytes,
        'Retain the whole original message and its inspected identity.');
      for(let index=0;index<value.selected.length;index++){
        const part=value.selected[index],candidate=value.identity.candidates.find(row=>row.key===part.key),
          prior=document.events[value.initialCaseVersion+index];
        need(candidate&&candidate.available&&candidate.path===part.path&&candidate.sha256===part.source.sha256&&
          candidate.bytes===part.source.bytes&&canonical(sources.get(part.source.id))===canonical(part.source)&&
          prior?.action==='source.add'&&prior.actor===value.actor&&canonical(prior.after)===canonical(part.source),
          'Retain the original selected message part and source save.');
      }
      correspondence.push({source:metadata,edition:value,node});
    }
  }
  terms.sort((a,b)=>a.edition.id.localeCompare(b.edition.id)||a.edition.revision-b.edition.revision);
  const prior=new Map();
  for(const row of terms){
    const previous=prior.get(row.edition.id),expected=previous?{sourceId:previous.source.id,sha256:previous.source.sha256,revision:previous.edition.revision}:null;
    need(row.edition.revision===(previous?previous.edition.revision+1:1)&&canonical(row.edition.previous)===canonical(expected),
      'Retain every original issuer edition in its consecutive source chain.');
    prior.set(row.edition.id,row);
  }
  const selected=tree('award-terms-selection.json').value;
  need(selected.schema===TERMS_SCHEMA+'.selection','Retain the explicit issuer edition in the native handover.');
  const selectedTerms=terms.find(row=>row.source.id===selected.sourceId);
  need(selectedTerms&&canonical(selected)===canonical({schema:TERMS_SCHEMA+'.selection',id:selectedTerms.edition.id,
    revision:selectedTerms.edition.revision,sourceId:selectedTerms.source.id,sourceSha256:selectedTerms.source.sha256,
    editionSha256:selectedTerms.edition.sha256}),'Keep the original complete issuer-terms selection.');
  const termsBySource=new Map(terms.map(row=>[row.source.id,row]));
  const amendmentTrees=operationTree.entries.find(([key])=>key==='amendments')?.[1]?.items||[];
  const amendments=new Map();
  for(const node of amendmentTrees){await verifySeal(node,'native amendment edition',hashing,encoding);amendments.set(node.value.id+':'+node.value.revision,node.value);}
  for(const row of commissioning){
    const value=row.edition,term=termsBySource.get(value.terms.sourceId),preview=value.preview;
    need(term&&canonical(value.terms)===canonical({id:term.edition.id,revision:term.edition.revision,sourceId:term.source.id,
      sourceSha256:term.source.sha256,sha256:term.edition.sha256})&&
      canonical(preview.source.selectedTerms)===canonical({source:term.source,edition:term.edition}),
      'Retain the exact terms edition selected by each original commissioning.');
    need(['PROPOSAL','ISSUER_TERMS'].includes(preview.inputs.basis)&&
      (preview.inputs.basis!=='ISSUER_TERMS'||term.edition.document.stage==='AWARDED'),
      'Retain the explicit original commissioning basis.');
    const nativeSelected=child(row.node,'selectedPlan'),proposed=child(child(row.node,'preview'),'selectedPlan');
    need(['scenario','planning','report'].every(key=>nativeCanonical(child(nativeSelected,key))===nativeCanonical(child(proposed,key))),
      'Keep the exact original plan chosen by the reviewed commissioning.');
    if(value.amendment!==null){
      const original=amendments.get(value.amendment.id+':'+value.amendment.revision);
      need(original&&original.state==='APPLIED'&&original.sha256===value.amendment.sha256&&
        original.version===value.amendment.caseVersion&&original.version===value.caseVersion-1,
        'Retain the complete reviewed and applied native amendment.');
    }
  }
  for(const [rows,action,key]of [[terms,'award-terms.save','issuerTermsSource'],[commissioning,'award-terms.plan-bind',null],
    [correspondence,'issuer-correspondence.bind',null]]){
    const actual=rows.map(row=>row.source.id).sort(),events=document.events.filter(row=>row.action===action)
      .map(row=>key?row.sourceChange?.[key]?.id:row.recordId).sort();
    need(canonical(actual)===canonical(events),'Retain the complete original '+action+' source history.');
  }
  const sha256=await hashing(bytes);
  return {schema:ISSUER_CONTEXT_SCHEMA+'.received',filename,receivedAt,bytes:bytes.length,sha256,
    base64:encodeBase64(bytes),files,manifest,document,selection:selected,selectedTerms,
    terms,commissioning:commissioning.sort((a,b)=>a.edition.caseVersion-b.edition.caseVersion),
    correspondence:correspondence.sort((a,b)=>a.edition.caseVersion-b.edition.caseVersion),planSource};
}
export function issuerProgrammeSummary(received){
  const {document,selection,selectedTerms,planSource}=received,programme=document.program;
  return {programme:{id:programme.id,name:programme.name,version:programme.version,mode:programme.mode,state:programme.state,calendarStart:programme.calendarStart},
    plan:{id:programme.planId,revision:programme.planRevision,contentSha256:document.plan.contentSha256,fileSha256:planSource.sha256,fileBytes:planSource.bytes},
    selection:clone(selection),document:clone(selectedTerms.edition.document),
    termsHistory:received.terms.map(({source,edition})=>({id:edition.id,revision:edition.revision,sourceId:source.id,sourceSha256:source.sha256,
      sha256:edition.sha256,caseVersion:edition.caseVersion,actor:edition.actor,savedAt:edition.savedAt,stage:edition.document.stage,
      planRevision:edition.source.plan.revision,planContentSha256:edition.source.plan.contentSha256,
      originalCaseId:edition.source.case.id,originalPlanId:edition.source.case.planId})),
    commissioning:received.commissioning.map(({source,edition})=>({id:edition.id,sourceId:source.id,sourceSha256:source.sha256,sha256:edition.sha256,
      termsId:edition.terms.id,termsRevision:edition.terms.revision,caseVersion:edition.caseVersion,planRevision:edition.selectedPlan.revision,
      planContentSha256:edition.selectedPlan.contentSha256,basis:edition.preview.inputs.basis,savedAt:edition.savedAt,amendment:clone(edition.amendment)})),
    correspondence:received.correspondence.map(({source,edition})=>{
      const metadata=edition.inspection.metadata||{},original=edition.selected.find(row=>row.path==='original');
      return {sourceId:source.id,sourceSha256:source.sha256,originalSourceId:original.source.id,originalSha256:original.source.sha256,
        subject:metadata.subject||'',messageId:metadata.messageId||'',date:metadata.date||'',dateUtc:metadata.dateUtc??null,
        filename:edition.inspection.original.filename,selected:edition.selected.map(row=>({path:row.path,key:row.key,sourceId:row.source.id,
          sha256:row.source.sha256,bytes:row.source.bytes,filename:row.source.filename,mediaType:row.source.mediaType})),
        parserWarnings:clone(edition.inspection.warnings||[])};
    }),originals:clone(document.sources)};
}
function working(draft){const result=clone(draft);result.handover||=emptyHandover();result.handover.issuerProgrammes||=[];
  result.handover.selection.issuerProgrammeId??=null;result.handover.selection.issuerDraft=issuerWorkingSelection(result.handover.selection);return result;}
function appendObject(draft,bytes,sha256){
  const value={sha256,bytes:bytes.length,base64:encodeBase64(bytes)},old=draft.handover.objects.find(row=>row.sha256===sha256);
  if(old)need(canonical(old)===canonical(value),'Keep the exact original issuer file bytes.');else draft.handover.objects.push(value);
}
function descriptor(received){return {name:safeFilename(received.filename),originalName:received.filename,mediaType:'application/zip',
  bytes:received.bytes,sha256:received.sha256};}
export async function stageIssuerProgramme(draft,bytes,{filename='issuer-programme.zip',at=now(),planningOptions={}}={}){
  validateDraft(draft);
  const received=await receiveIssuerProgrammeFile(bytes,{filename,receivedAt:at,planningOptions}),result=working(draft);
  appendObject(result,bytes,received.sha256);const selected=result.handover.selection.issuerDraft;
  selected.file=descriptor(received);selected.receivedAt=at;
  if(!selected.title||selected.title==='Issuer programme')selected.title=received.selectedTerms.edition.document.title;
  result.updatedAt=at;return {draft:validateDraft(result),received};
}
export async function retainIssuerProgramme(draft,{at=now(),planningOptions={}}={}){
  validateDraft(draft);const staged=issuerWorkingSelection(draft.handover?.selection);
  need(staged.file,'Open a complete original issuer programme first.');
  need(staged.title.trim()&&staged.actor.trim(),'Name the receiving context and its recording operator.');
  referenceUrl(staged.sourceUrl,'Issuer source URL');
  const received=await receiveIssuerProgrammeFile(sourceFile(draft,staged.file.sha256),
    {filename:staged.file.originalName,receivedAt:staged.receivedAt||at,planningOptions});
  need(received.sha256===staged.file.sha256&&received.bytes===staged.file.bytes,'Retain the exact reviewed issuer file.');
  const result=working(retainVersion(draft,'Before retaining issuer programme',at));
  const body={title:staged.title,actor:staged.actor,note:staged.note,receivedAt:staged.receivedAt||at,sourceUrl:staged.sourceUrl,
    draftId:result.id,applicationSha256:result.currentSource,file:descriptor(received),...issuerProgrammeSummary(received)};
  const hashing=planningOptions.digest||digest,encoding=planningOptions.encode||encode;
  const row={schema:ISSUER_CONTEXT_SCHEMA,id:await hashing(encoding(canonical(body))),body};
  validateIssuerContext(row,{objects:new Map(result.handover.objects.map(item=>[item.sha256,item]))});
  const old=result.handover.issuerProgrammes.find(item=>item.id===row.id);
  if(old)need(canonical(old)===canonical(row),'Keep the original retained issuer context.');else result.handover.issuerProgrammes.push(row);
  result.handover.selection.issuerProgrammeId=row.id;
  result.handover.selection.issuerDraft={file:null,title:'Issuer programme',actor:staged.actor,note:'',receivedAt:'',sourceUrl:''};
  result.updatedAt=at;return {draft:validateDraft(result),context:row,received};
}
export function selectIssuerProgramme(draft,id,{at=now()}={}){
  validateDraft(draft);if(id!==null)selectedIssuerContext(draft,id);
  const result=working(retainVersion(draft,'Before selecting issuer programme',at));result.handover.selection.issuerProgrammeId=id;
  result.updatedAt=at;return validateDraft(result);
}
export async function reopenIssuerProgramme(draft,id,{planningOptions={}}={}){
  const selected=selectedIssuerContext(draft,id),body=selected.body;
  const received=await receiveIssuerProgrammeFile(sourceFile(draft,body.file.sha256),
    {filename:body.file.originalName,receivedAt:body.receivedAt,planningOptions});
  need(received.bytes===body.file.bytes&&received.sha256===body.file.sha256,'Keep the original complete issuer programme.');
  const current=issuerProgrammeSummary(received);
  for(const key of Object.keys(current))need(canonical(body[key])===canonical(current[key]),
    'The retained '+key+' projection differs from its complete original issuer programme.');
  return received;
}
export async function receiveIssuerPlanning(draft,id,{at=now(),planningOptions={}}={}){
  validateDraft(draft);const context=selectedIssuerContext(draft,id);
  const received=await reopenIssuerProgramme(draft,context.id,{planningOptions});
  const result=receivePlanningSource(draft,received.planSource,at,{revision:context.body.plan.revision});
  result.handover.selection.issuerProgrammeId=context.id;
  return validateDraft(result);
}
export async function verifyIssuerProgrammes(draft,{planningOptions={}}={}){
  const hashing=planningOptions.digest||digest,encoding=planningOptions.encode||encode,seen=new Map();
  for(const row of issuerContexts(draft)){
    validateIssuerContext(row,{objects:new Map(draft.handover.objects.map(item=>[item.sha256,item]))});
    need(await hashing(encoding(canonical(row.body)))===row.id,'Retain the exact original issuer context identity.');
    let received=seen.get(row.body.file.sha256);
    if(!received){received=await reopenIssuerProgramme(draft,row.id,{planningOptions});seen.set(row.body.file.sha256,received);}
    else{const summary=issuerProgrammeSummary(received);for(const key of Object.keys(summary))
      need(canonical(row.body[key])===canonical(summary[key]),'Retain the original issuer '+key+' projection.');}
  }
  const staged=issuerWorkingSelection(draft.handover?.selection);
  if(staged.file&&!seen.has(staged.file.sha256)){
    const received=await receiveIssuerProgrammeFile(sourceFile(draft,staged.file.sha256),{filename:staged.file.originalName,
      receivedAt:staged.receivedAt||draft.updatedAt,planningOptions});
    need(received.sha256===staged.file.sha256&&received.bytes===staged.file.bytes,'Retain the complete working issuer file.');
  }
  return draft;
}
export function issuerOriginal(received,sourceId){
  const metadata=received.document.sources.find(row=>row.id===sourceId);need(metadata,'Select an original retained issuer source.');
  const bytes=received.files.get('sources/'+sourceId);need(bytes,'Keep the original source bytes.');return {metadata:clone(metadata),bytes};
}
export function issuerPreparedFiles(draft,edition){
  const id=edition.body.issuerProgrammeId??null;if(id===null)return [];
  const row=selectedIssuerContext(draft,id);
  return [{...clone(row.body.file),role:'issuer-programme',issuerProgrammeId:id,title:row.body.title,
    identityBasis:'Complete original Operations case with selected terms, message sources, native plan and commissioning history.'}];
}
const escape=value=>String(value??'Unstated').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function issuerContextSection(draft,id){
  if(id===null||id===undefined)return '';
  const row=selectedIssuerContext(draft,id),body=row.body,document=body.document;
  const table=(heads,rows)=>'<div class="table"><table><thead><tr>'+heads.map(value=>'<th>'+escape(value)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(values=>'<tr>'+values.map(value=>'<td>'+escape(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  let output='<section><h2>Issuer programme</h2><h3>'+escape(body.title)+'</h3>'+
    '<p>Recorded by '+escape(body.actor)+' · received '+escape(body.receivedAt)+'</p>';
  output+=table(['Field','Retained selection'],[['Observed stage',document.stage.replaceAll('_',' ')],['Proposed track',document.proposalTrack],
    ['Issuer-selected track',document.issuerTrack],['Issued award (USD)',document.award?.amountUsd??null],
    ['Round',document.round.label],['Deadline',document.round.deadlineOn],['Deadline source',document.round.deadlineBasis],
    ['Original issuer reference',document.issuer.reference],['Selected native plan',body.plan.id+' · revision '+body.plan.revision],
    ['Terms edition',body.selection.id+' · revision '+body.selection.revision]]);
  output+='<p>'+escape(body.note)+'</p><h3>Original correspondence</h3>'+table(['Source','Subject','Original date','Message identity'],
    body.correspondence.map(message=>[message.filename,message.subject,message.date,message.messageId]));
  output+='<h3>Saved terms history</h3>'+table(['Edition','Observed stage','Recorded by','Native plan','Saved'],
    body.termsHistory.map(term=>[term.id+' / '+term.revision,term.stage,term.actor,term.planRevision,term.savedAt]));
  output+='<h3>Planning commissioning</h3>'+table(['Terms edition','Native plan','Selected basis','Saved'],
    body.commissioning.map(binding=>[binding.termsId+' / '+binding.termsRevision,binding.planRevision,binding.basis,binding.savedAt]));
  output+='<p>Complete original handover: '+escape(body.file.originalName)+' · '+body.file.bytes+' bytes · SHA-256 <code>'+body.file.sha256+'</code>.</p>';
  return output+'</section>';
}
