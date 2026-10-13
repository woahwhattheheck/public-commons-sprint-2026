import {verifyProductSourceImports} from './grant-product-authoring-core.mjs';
import {verifyIssuerProgrammes,issuerContextSection} from './grant-issuer-source.mjs';
import {selectedIssuerContext} from './grant-issuer-core.mjs';
// MIT. Exact original files and prepared output inside the existing submission draft.
import {
  ANSWERS, REQUIREMENTS, SCHEMA, ENVELOPE, MAX_BYTES, makeSource, validateDraft,
  validateSource, retainVersion, receiveSource, outputText, applicationOutput, fieldStatus, formSourceReview,
} from './grant-submission-core.mjs';
import {verifyPlanningSource} from './grant-plan-source.mjs';
import {
  HANDOVER_SCHEMA, BUNDLE_SCHEMA, SOURCE_PACKAGE_SCHEMA, EDITION_SCHEMA, RETURN_SCHEMA, SOURCE_ROLES,
  EVIDENCE_KINDS, RETURN_KINDS, canonical, safeFilename, referenceUrl,
  emptyHandover, emptySelection, handoverOf, authorSnapshot, hydrateAuthorSnapshot, validateHandover, originalObject,
  frozenEdition, editionFileDescriptors, changedItems,
} from './grant-handover-core.mjs';

export const MAX_SOURCE_PACKAGE_BYTES=MAX_BYTES*2+65536;

const clone=value=>JSON.parse(JSON.stringify(value));
const need=(value,message)=>{if(!value)throw new Error(message);};
const encoder=new TextEncoder();
const now=()=>new Date().toISOString();
const utf8=value=>encoder.encode(value);
const decode=value=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(value);
const parse=value=>JSON.parse(decode(value).replace(/^\uFEFF/,''));
const same=(a,b)=>canonical(a)===canonical(b);
const owned=value=>{need(value instanceof Uint8Array||value instanceof ArrayBuffer,'Supply the complete original byte array.');return value instanceof Uint8Array?value:new Uint8Array(value);};
const escaped=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

export async function contentHash(value,algorithm='SHA-256') {
  const bytes=typeof value==='string'?utf8(value):owned(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest(algorithm,bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function gitBlob(bytes) {
  bytes=owned(bytes);const prefix=utf8('blob '+bytes.length+'\0'),body=new Uint8Array(prefix.length+bytes.length);
  body.set(prefix);body.set(bytes,prefix.length);return contentHash(body,'SHA-1');
}
function encodeBase64(bytes) {
  bytes=owned(bytes);let text='';
  for(let offset=0;offset<bytes.length;offset+=24576)text+=String.fromCharCode(...bytes.subarray(offset,offset+24576));
  return btoa(text);
}
export function fileBytes(draft,sha256) {
  const object=handoverOf(draft).objects.find(row=>row.sha256===sha256)||(draft.planSources||[]).find(row=>row.sha256===sha256);
  need(object,'Retain the complete selected original file.');
  const text=atob(object.base64),bytes=new Uint8Array(text.length);
  for(let index=0;index<text.length;index++)bytes[index]=text.charCodeAt(index);
  return bytes;
}
async function objectFrom(bytes) {
  bytes=owned(bytes);
  need(bytes.length<=MAX_BYTES,'This original file exceeds the existing complete-draft limit.');
  return {sha256:await contentHash(bytes),bytes:bytes.length,base64:encodeBase64(bytes)};
}
function appendObject(draft,object) {
  const previous=draft.handover.objects.find(row=>row.sha256===object.sha256);
  if(previous)need(same(previous,object),'The retained original file identity has conflicting complete bytes.');
  else draft.handover.objects.push(clone(object));
}
function descriptor(object,{name,mediaType='application/octet-stream',sourceUrl='',identityBasis}={}) {
  need(typeof name==='string'&&name.length>0,'Retain the original filename.');
  need(typeof mediaType==='string','Retain the observed file type.');
  referenceUrl(sourceUrl);
  return {name:safeFilename(name),originalName:name,mediaType,sourceUrl,bytes:object.bytes,sha256:object.sha256,
    ...(identityBasis===undefined?{}:{identityBasis})};
}
async function identified(schema,body) {
  return {...(schema?{schema}:{}),id:await contentHash(canonical(body)),body};
}
function working(draft) {
  const result=clone(validateDraft(draft));result.handover ||= emptyHandover();return result;
}
function finish(draft,at=now()) {draft.updatedAt=at;validateHandover(draft);return validateDraft(draft);}
function enteredDate(value,label,empty=false) {
  need(typeof value==='string'&&((empty&&value==='')||Number.isFinite(Date.parse(value))),label+' needs the observed date or timestamp.');
}
function enteredText(value,label) {need(typeof value==='string',label+' must be text.');return value;}
export async function verifyOriginalApplication(source) {
  validateSource(source);const bytes=utf8(source.markdown);
  need(bytes.length===source.bytes&&await contentHash(bytes)===source.sha256&&await gitBlob(bytes)===source.gitBlob,
    'The complete application differs from its retained source identity.');
  return source;
}
async function verifyIndexed(bytes,meta,label) {
  need(meta&&Number.isSafeInteger(meta.bytes)&&typeof meta.sha256==='string'&&typeof meta.git_blob==='string',
    'Retain the original '+label+' identity from the source index.');
  need(bytes.length===meta.bytes&&await contentHash(bytes)===meta.sha256&&await gitBlob(bytes)===meta.git_blob,
    'The complete '+label+' differs from its original source index.');
}
export async function createSourceBundle(source,{
  indexBytes,budgetBytes,companionBytes,urls={},receivedAt=now(),
}={}) {
  await verifyOriginalApplication(source);enteredDate(receivedAt,'Source reception');
  indexBytes=owned(indexBytes);budgetBytes=owned(budgetBytes);companionBytes=owned(companionBytes);
  const applicationBytes=utf8(source.markdown),index=parse(indexBytes);
  need(index.schema==='stellar-forge.grant-reviewer-source-index.v1','Use the complete original reviewer source index.');
  await verifyIndexed(applicationBytes,index.application,'application');
  await verifyIndexed(companionBytes,index.product_and_finance,'product and finance companion');
  const bytesByRole=[applicationBytes,indexBytes,budgetBytes,companionBytes];
  need(bytesByRole.reduce((total,bytes)=>total+bytes.length,0)<=MAX_BYTES,'The complete source bundle exceeds the existing draft intake budget.');
  const names=['application.md','source-index.json','budget.csv','product-and-finance.md'];
  const types=['text/markdown;charset=utf-8','application/json','text/csv;charset=utf-8','text/markdown;charset=utf-8'];
  const bases=[
    'Verified against original source-index application SHA-256, byte count and Git blob.',
    'Complete received source-index bytes; its own digest is a receiving identity.',
    'Complete received budget bytes; this source index declares no independent budget-file digest.',
    'Verified against original source-index product_and_finance SHA-256, byte count and Git blob.',
  ];
  const objects=[],files=[];
  for(let index=0;index<SOURCE_ROLES.length;index++) {
    const role=SOURCE_ROLES[index],object=await objectFrom(bytesByRole[index]);
    objects.push(object);
    files.push({role,...descriptor(object,{name:names[index],mediaType:types[index],
      sourceUrl:urls[role]||(role==='application'?source.url:''),identityBasis:bases[index]})});
  }
  const bundle=await identified(BUNDLE_SCHEMA,{applicationSha256:source.sha256,receivedAt,files});
  return {bundle,objects};
}
export function retainSourceBundle(draft,received,{select=true,at=now()}={}) {
  const result=working(draft);
  need(received?.bundle?.schema===BUNDLE_SCHEMA&&Array.isArray(received.objects),'Receive the complete original reviewer source bundle.');
  need(result.sources.some(source=>source.sha256===received.bundle.body.applicationSha256),
    'Receive the original application through the existing editor before its companion files.');
  for(const object of received.objects)appendObject(result,object);
  const existing=result.handover.bundles.find(row=>row.id===received.bundle.id);
  if(existing)need(same(existing,received.bundle),'The retained source bundle identity differs.');
  else result.handover.bundles.push(clone(received.bundle));
  if(select&&received.bundle.body.applicationSha256===result.currentSource)result.handover.selection.bundleId=received.bundle.id;
  return finish(result,at);
}

async function verifyRetainedObject(holder,object) {
  const bytes=fileBytes(holder,object.sha256);
  need(bytes.length===object.bytes&&encodeBase64(bytes)===object.base64&&await contentHash(bytes)===object.sha256,
    'A retained original file differs from its complete byte identity.');
}
async function verifyReviewerBundle(holder,bundle) {
  const files=new Map(bundle.body.files.map(row=>[row.role,row]));
  const index=parse(fileBytes(holder,files.get('source-index').sha256));
  need(index.schema==='stellar-forge.grant-reviewer-source-index.v1','Retain the original source-index schema.');
  await verifyIndexed(fileBytes(holder,files.get('application').sha256),index.application,'application');
  await verifyIndexed(fileBytes(holder,files.get('product-and-finance').sha256),index.product_and_finance,'product and finance companion');
  const source=holder.sources.find(row=>row.sha256===bundle.body.applicationSha256);
  need(decode(fileBytes(holder,files.get('application').sha256))===source.markdown,
    'The bundle’s original application differs from the retained answer source.');
}
export async function verifyReviewerSource(received) {
  need(received&&typeof received==='object'&&!Array.isArray(received),
    'Open a complete four-file reviewer source package.');
  received=clone(received);
  await verifyOriginalApplication(received.source);
  need(received.bundle?.schema===BUNDLE_SCHEMA&&Array.isArray(received.objects)&&received.objects.length<=SOURCE_ROLES.length,
    'Retain the original reviewer bundle and all four file bodies.');
  const objects=new Map();
  for(const object of received.objects) {
    need(object&&typeof object==='object','Retain each original source file.');
    const prior=objects.get(object.sha256);
    if(prior)need(same(prior,object),'The same source file identity has different complete bytes.');
    else objects.set(object.sha256,object);
  }
  const holder={sources:[received.source],handover:{...emptyHandover(),
    bundles:[received.bundle],objects:[...objects.values()]}};
  // Reuse the original source/descriptor model without making an editorial draft.
  validateHandover(holder);
  const referenced=new Set(received.bundle.body.files.map(file=>file.sha256));
  need(objects.size===referenced.size&&[...objects.keys()].every(hash=>referenced.has(hash)),
    'A source package contains exactly its four reviewer files.');
  need(received.bundle.body.files.reduce((total,file)=>total+file.bytes,0)<=MAX_BYTES,
    'The complete reviewer source exceeds the existing draft intake budget.');
  for(const object of holder.handover.objects)await verifyRetainedObject(holder,object);
  need(await contentHash(canonical(received.bundle.body))===received.bundle.id,
    'The reviewer source bundle differs from its retained content identity.');
  await verifyReviewerBundle(holder,received.bundle);
  return clone({source:received.source,bundle:received.bundle,objects:holder.handover.objects});
}
export async function createReviewerSourcePackage(received,{exportedAt=now()}={}) {
  enteredDate(exportedAt,'Source package export');
  const source=await verifyReviewerSource(received);
  const text=JSON.stringify({schema:SOURCE_PACKAGE_SCHEMA,exportedAt,
    sha256:await contentHash(JSON.stringify(source)),received:source})+'\n';
  need(utf8(text).length<=MAX_SOURCE_PACKAGE_BYTES,
    'The encoded source package exceeds the complete-file receiving allowance.');
  return text;
}
export async function openReviewerSourcePackage(text) {
  need(typeof text==='string'&&utf8(text).length<=MAX_SOURCE_PACKAGE_BYTES,
    'Open a complete reviewer source package within the existing receiving allowance.');
  const value=JSON.parse(text.replace(/^\uFEFF/,''));
  need(value?.schema===SOURCE_PACKAGE_SCHEMA&&value.received&&typeof value.sha256==='string',
    'Open the original four-file reviewer source package.');
  enteredDate(value.exportedAt,'Source package export');
  need(await contentHash(JSON.stringify(value.received))===value.sha256,
    'The source package differs from its complete exported content.');
  return verifyReviewerSource(value.received);
}
export async function reviewerSourceFromDraft(draft,bundleId) {
  validateDraft(draft);validateHandover(draft);
  need(typeof bundleId==='string','Select an original reviewer source bundle.');
  const value=handoverOf(draft),bundle=value.bundles.find(row=>row.id===bundleId);
  need(bundle,'Select a retained complete reviewer source bundle.');
  const source=draft.sources.find(row=>row.sha256===bundle.body.applicationSha256);
  const hashes=new Set(bundle.body.files.map(file=>file.sha256));
  const objects=value.objects.filter(object=>hashes.has(object.sha256));
  return verifyReviewerSource({source,bundle,objects});
}
export async function receiveReviewerSource(draft,received,{at=now(),planningOptions={}}={}) {
  enteredDate(at,'Source receiving');
  draft=clone(draft);
  await verifyHandover(draft,{planningOptions});
  const incoming=await verifyReviewerSource(received),value=handoverOf(draft);
  const retained=value.bundles.find(row=>row.id===incoming.bundle.id);
  if(retained)need(same(retained,incoming.bundle),'The retained reviewer bundle identity differs.');
  if(draft.currentSource===incoming.source.sha256&&retained&&value.selection.bundleId===retained.id)
    return clone(draft);
  const next=draft.currentSource===incoming.source.sha256?
    retainVersion(draft,'Before selecting reviewer source files',at):
    receiveSource(draft,incoming.source,at);
  const result=retainSourceBundle(next,incoming,{select:true,at});
  await verifyHandover(result,{planningOptions});
  return result;
}

export async function readReviewerSource({baseUrl,fetchImpl=globalThis.fetch,receivedAt=null}={}) {
  const base=new URL(baseUrl);referenceUrl(base.href);
  need(typeof fetchImpl==='function','Use the existing reader source connection.');
  let retained=0;
  const read=async path=>{
    const url=new URL(path,base);
    need(url.origin===base.origin,'Read the four files from the same original reader.');
    const response=await fetchImpl(url.href,{cache:'no-cache',credentials:'same-origin'});
    need(response.ok,'The original '+path+' source returned HTTP '+response.status+'. The working draft remains available.');
    const reader=response.body?.getReader(),parts=[];let size=0;
    if(reader) {
      try {
        for(;;) {
          const item=await reader.read();if(item.done)break;
          size+=item.value.length;
          if(retained+size>MAX_BYTES){await reader.cancel();throw new Error('The complete reader source exceeds the existing draft budget.');}
          parts.push(item.value);
        }
      } finally {reader.releaseLock();}
    } else {
      const bytes=new Uint8Array(await response.arrayBuffer());size=bytes.length;
      need(retained+size<=MAX_BYTES,'The complete reader source exceeds the existing draft budget.');parts.push(bytes);
    }
    retained+=size;const bytes=new Uint8Array(size);let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    return {bytes,url:url.href};
  };
  // Keep complete source responses, without interleaving a second reader acquisition.
  const application=await read('./grant-data/application.md');
  const index=await read('./grant-data/source-index.json');
  const budget=await read('./grant-data/budget.csv');
  const companion=await read('./grant-data/product-and-finance.md');
  receivedAt ||= now();
  const source=makeSource({markdown:decode(application.bytes),index:parse(index.bytes),url:application.url,receivedAt});
  const received=await createSourceBundle(source,{indexBytes:index.bytes,budgetBytes:budget.bytes,companionBytes:companion.bytes,receivedAt,
    urls:{application:application.url,'source-index':index.url,budget:budget.url,'product-and-finance':companion.url}});
  return {source,...received};
}
export async function stageOriginal(draft,bytes,{name,mediaType,forReturn=false,sourceUrl='',at=now()}={}) {
  const result=working(draft),object=await objectFrom(bytes);appendObject(result,object);
  const file=descriptor(object,{name,mediaType,sourceUrl});
  result.handover.selection[forReturn?'returnDraft':'evidenceDraft'].file=file;
  return finish(result,at);
}
function normalizedTargets(draft,values) {
  need(Array.isArray(values),'Select the original items supported by this evidence.');
  const ids=new Set(),result=[];
  for(const value of values) {
    need(value&&['answer','field','requirement'].includes(value.kind),'Associate evidence with an original answer, form field or requirement.');
    const key=value.kind+':'+value.id;need(!ids.has(key),'Select each associated item once.');ids.add(key);
    const row=value.kind==='answer'?ANSWERS.find(row=>row[0]===value.id):
      value.kind==='field'?draft.fields.find(row=>row.id===value.id):REQUIREMENTS.find(row=>row.id===value.id);
    need(row,'Select an item that exists in the current draft.');
    result.push({kind:value.kind,id:value.id,label:value.kind==='answer'?row[1]:value.kind==='field'?(row.label||'Unlabeled form field'):row.title});
  }
  return result;
}
export async function retainEvidence(draft,{at=now()}={}) {
  const result=working(draft),selection=result.handover.selection,input=selection.evidenceDraft;
  enteredDate(at,'Evidence recording time');enteredDate(input.observedAt,'Source observation',true);
  referenceUrl(input.sourceUrl);need(input.file,'Select the complete original evidence file.');
  need(EVIDENCE_KINDS.includes(input.kind),'Select the evidence category.');
  need(input.title.trim(),'Give the retained evidence a useful title.');
  const body={createdAt:at,title:input.title,actor:selection.actor,note:input.note,observedAt:input.observedAt,
    sourceUrl:input.sourceUrl,kind:input.kind,file:clone(input.file),targets:normalizedTargets(result,input.targets),
    draftId:result.id,applicationSha256:result.currentSource};
  const item=await identified(null,body);
  if(!result.handover.evidence.some(row=>row.id===item.id))result.handover.evidence.push(item);
  if(!selection.evidenceIds.includes(item.id))selection.evidenceIds.push(item.id);
  selection.evidenceDraft={title:'',kind:'source',sourceUrl:'',observedAt:'',note:'',targets:[],file:null};
  return finish(result,at);
}
export function preparedItems(draft,{kind='answers',format='plain'}={}) {
  validateDraft(draft);need(['answers','fields'].includes(kind)&&['plain','markdown'].includes(format),'Select the prepared output mode.');
  return kind==='fields'?draft.fields.map(row=>({
    id:row.id,label:row.label||'Unlabeled form field',prompt:row.prompt,text:outputText(row.text,format),answerIds:[...row.answerIds],
  })):draft.answers.map(row=>({
    id:row.id,label:ANSWERS.find(item=>item[0]===row.id)[1],prompt:'',text:outputText(row.text,format),answerIds:[row.id],
  }));
}
function sourceContext(draft) {
  const value=handoverOf(draft),required=new Set([draft.currentSource,...draft.answers.map(row=>row.sourceSha)]),issues=[];
  const selected=value.selection.bundleId?value.bundles.find(row=>row.id===value.selection.bundleId):null;
  if(selected&&selected.body.applicationSha256!==draft.currentSource)issues.push('The selected reader bundle belongs to another application edition; all retained original bundles remain available.');
  const current=selected?.body.applicationSha256===draft.currentSource?selected:null;
  const bundles=[...(current?[current]:[]),...value.bundles.filter(row=>row.body.applicationSha256!==draft.currentSource&&required.has(row.body.applicationSha256))];
  for(const sha of required)if(!bundles.some(row=>row.body.applicationSha256===sha))
    issues.push('No complete four-file reviewer bundle was received for application '+sha+'. Its original application text is retained.');
  if(!value.selection.actor.trim())issues.push('No preparing operator name was entered.');
  if(!value.selection.evidenceIds.length)issues.push('No separate evidence files were selected for this prepared edition.');
  const issuer=selectedIssuerContext(draft);
  if(issuer && (draft.planningReview?.sourceSha!==issuer.body.plan.fileSha256 || draft.planningReview?.revision!==issuer.body.plan.revision))
    issues.push('The selected issuer programme retains native plan revision '+issuer.body.plan.revision+'. Its exact plan can be received and reviewed through Native planning.');
  return {bundles,issues,selectedBundleId:current?.id||null};
}
export async function prepareSubmission(draft,{at=now(),planningOptions={}}={}) {
  enteredDate(at,'Preparation time');await verifyHandover(draft,{planningOptions});
  const selection=handoverOf(draft).selection,context=sourceContext(draft);
  const items=preparedItems(draft,{kind:selection.outputKind,format:selection.format});
  need(items.length>0,'Add the actual issuer fields or select the canonical answers.');
  const output=applicationOutput(draft,{format:selection.format,useFields:selection.outputKind==='fields'});
  const snapshot=authorSnapshot(draft);
  const body={createdAt:at,title:selection.title,actor:selection.actor,note:selection.note,snapshot,
    selectedBundleId:context.selectedBundleId,bundleIds:context.bundles.map(row=>row.id),evidenceIds:[...selection.evidenceIds],
    issuerProgrammeId:selection.issuerProgrammeId??null,
    output:{kind:selection.outputKind,format:selection.format,items,text:output,bytes:utf8(output).length,sha256:await contentHash(output)},
    fieldIssues:selection.outputKind==='fields'?draft.fields.map(row=>({id:row.id,label:row.label,
      ...fieldStatus(row,draft.form,selection.format)})):[],
    fieldSourceReview:selection.outputKind==='fields'?formSourceReview(draft):null,
    contextIssues:context.issues,
    statusMeaning:'Prepared exact output and retained context. Preparation is not a submission, issuer receipt, award decision, payment or approval.',
  };
  const edition=await identified(EDITION_SCHEMA,body);
  const result=retainVersion(draft,'Before preparing '+(selection.title||'submission'),at);result.handover ||= emptyHandover();
  if(!result.handover.editions.some(row=>row.id===edition.id))result.handover.editions.push(edition);
  result.handover.selection.returnDraft={...emptySelection().returnDraft,editionId:edition.id};
  return {draft:finish(result,at),edition};
}
export async function recordIssuerReturn(draft,{at=now()}={}) {
  const result=working(draft),selection=result.handover.selection,input=selection.returnDraft;
  const edition=frozenEdition(result,input.editionId);
  enteredDate(at,'Recording time');enteredDate(input.observedAt,'Observation time',true);referenceUrl(input.sourceUrl);
  need(RETURN_KINDS.includes(input.kind),'Select the actual observation category.');
  need(input.note.trim()||input.file||input.reference.trim(),'Enter the actual observation or retain the original returned file.');
  if(input.supersedes)need(result.handover.returns.some(row=>row.id===input.supersedes&&row.body.editionId===edition.id),
    'Select an original observation from this same prepared edition to correct.');
  const body={editionId:edition.id,kind:input.kind,recordedAt:at,observedAt:input.observedAt,actor:selection.actor,
    sourceUrl:input.sourceUrl,reference:input.reference,note:input.note,file:input.file?clone(input.file):null,supersedes:input.supersedes};
  const observation=await identified(RETURN_SCHEMA,body);
  if(!result.handover.returns.some(row=>row.id===observation.id))result.handover.returns.push(observation);
  selection.returnDraft={editionId:edition.id,kind:'operator-note',observedAt:'',sourceUrl:'',reference:'',note:'',supersedes:null,file:null};
  return {draft:finish(result,at),observation};
}
export function comparePrepared(draft,id) {
  validateDraft(draft);validateHandover(draft);const edition=frozenEdition(draft,id),previous=edition.body.snapshot;
  const kind=edition.body.output.kind,format=edition.body.output.format;
  const currentItems=preparedItems(draft,{kind,format});
  const fields=changedItems(previous.fields,draft.fields),answers=changedItems(previous.answers,draft.answers);
  const context=[];
  const omitted=new Set(['answers','fields','updatedAt','versions','handover']);
  const current=authorSnapshot(draft);
  for(const key of new Set([...Object.keys(previous),...Object.keys(current)])) {
    if(omitted.has(key))continue;
    const before=Object.prototype.hasOwnProperty.call(previous,key)?previous[key]:null;
    const after=Object.prototype.hasOwnProperty.call(current,key)?current[key]:null;
    if(!same(before,after))context.push({key,before,after});
  }
  const frozenIssuer=edition.body.issuerProgrammeId??null,currentIssuer=handoverOf(draft).selection.issuerProgrammeId??null;
  if(frozenIssuer!==currentIssuer)context.push({key:'issuerProgramme',before:frozenIssuer?clone(selectedIssuerContext(draft,frozenIssuer).body):null,
    after:currentIssuer?clone(selectedIssuerContext(draft,currentIssuer).body):null});
  const outputItems=changedItems(edition.body.output.items,currentItems);
  return {editionId:id,preparedAt:edition.body.createdAt,currentUpdatedAt:draft.updatedAt,
    outputKind:kind,format,outputItems,answers,fields,context,
    outputChanged:outputItems.some(row=>row.status!=='unchanged'),
    originalOutput:edition.body.output.text,currentOutput:currentItems.length?applicationOutput(draft,{format,useFields:kind==='fields'}):'',
    meaning:'Exact comparison to the retained prepared output. Later edits and later observations do not revise that frozen edition.'};
}
export async function verifyHandover(draft,{planningOptions={}}={}) {
  validateDraft(draft);validateHandover(draft);
  await verifyProductSourceImports(draft,contentHash);
  for(const source of draft.sources)await verifyOriginalApplication(source);
  for(const source of draft.planSources||[])await verifyPlanningSource(source,planningOptions);
  if(!draft.handover)return draft;
  const value=draft.handover;
  for(const object of value.objects)await verifyRetainedObject(draft,object);
  for(const collection of ['bundles','evidence','editions','returns'])for(const row of value[collection])
    need(await contentHash(canonical(row.body))===row.id,'The retained '+collection+' record differs from its original content identity.');
  await verifyIssuerProgrammes(draft,{planningOptions});
  for(const bundle of value.bundles)await verifyReviewerBundle(draft,bundle);
  for(const edition of value.editions) {
    const body=edition.body,snapshot=hydrateAuthorSnapshot(draft,body.snapshot);
    validateDraft(snapshot);
    await verifyProductSourceImports(snapshot,contentHash);
    for(const source of snapshot.sources) {
      await verifyOriginalApplication(source);
      need(draft.sources.some(row=>row.sha256===source.sha256&&row.markdown===source.markdown),
        'Retain every frozen original application in this same draft.');
    }
    const items=preparedItems(snapshot,{kind:body.output.kind,format:body.output.format});
    const output=applicationOutput(snapshot,{format:body.output.format,useFields:body.output.kind==='fields'});
    need(same(items,body.output.items)&&output===body.output.text&&utf8(output).length===body.output.bytes&&await contentHash(output)===body.output.sha256,
      'The frozen output differs from its complete retained authoring state.');
    const expected=body.output.kind==='fields'?snapshot.fields.map(row=>({id:row.id,label:row.label,...fieldStatus(row,snapshot.form,body.output.format)})):[];
    need(same(expected,body.fieldIssues),'The frozen field observations differ from their actual retained fields.');
    // Earlier prepared editions predate this observation and keep their exact bodies.
    if(Object.prototype.hasOwnProperty.call(body,'fieldSourceReview'))need(same(body.fieldSourceReview,body.output.kind==='fields'?formSourceReview(snapshot):null),
      'The prepared field source comparison differs from its frozen authoring state.');
  }
  return draft;
}
export async function createDraftEnvelope(draft,{exportedAt=now(),planningOptions={}}={}) {
  await verifyHandover(draft,{planningOptions});
  return JSON.stringify({schema:ENVELOPE,exportedAt,sha256:await contentHash(JSON.stringify(draft)),draft})+'\n';
}
export async function openDraftEnvelope(text,{planningOptions={}}={}) {
  need(typeof text==='string'&&utf8(text).length<=MAX_BYTES*2+65536,'Open a bounded complete original draft export.');
  const value=JSON.parse(text.replace(/^\uFEFF/,''));
  need(value.schema===ENVELOPE&&value.draft&&typeof value.sha256==='string','Open the original complete submission draft export.');
  need(await contentHash(JSON.stringify(value.draft))===value.sha256,'The draft differs from its exact exported content.');
  return verifyHandover(value.draft,{planningOptions});
}
export function sourceReferences(draft) {
  const result=[],seen=new Set();
  for(const bundle of handoverOf(draft).bundles) {
    const file=bundle.body.files.find(row=>row.role==='source-index');
    const index=parse(fileBytes(draft,file.sha256));
    for(const source of Array.isArray(index.sources)?index.sources:[]) {
      if(!source||typeof source!=='object')continue;
      const key=canonical(source);if(seen.has(key))continue;seen.add(key);
      result.push({bundleId:bundle.id,source:clone(source)});
    }
  }
  return result;
}
export function originalDownload(draft,file) {
  const bytes=fileBytes(draft,file.sha256);
  need(bytes.length===file.bytes,'The selected file descriptor differs from its retained object.');
  return {bytes,name:file.name,mediaType:file.mediaType};
}
export function preparedReport(draft,id) {
  validateHandover(draft);const edition=frozenEdition(draft,id),body=edition.body;
  const returns=handoverOf(draft).returns.filter(row=>row.body.editionId===id);
  const files=editionFileDescriptors(draft,id),comparison=comparePrepared(draft,id);
  const para=value=>'<p>'+escaped(value)+'</p>';
  const pre=value=>'<pre>'+escaped(value)+'</pre>';
  const table=(heads,rows)=>'<table><thead><tr>'+heads.map(value=>'<th>'+escaped(value)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+escaped(value??'')+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  const sections=[
    '<h1>'+escaped(body.title||'Prepared submission')+'</h1>',
    para('Prepared '+body.createdAt+' · Operator: '+(body.actor||'not entered')),
    para('Edition '+edition.id),para(body.statusMeaning),para(body.note),
    '<h2>Exact prepared output</h2>',
    para(body.output.kind+' · '+body.output.format+' · '+body.output.bytes+' bytes · SHA-256 '+body.output.sha256),
    pre(body.output.text),
    '<h2>Source and evidence context</h2>',
    table(['Role','Original file','Bytes','SHA-256','Source or observation','Identity basis'],
      files.map(file=>[file.role+(file.sourceRole?' / '+file.sourceRole:''),file.originalName,file.bytes,file.sha256,file.sourceUrl||file.title||'',file.identityBasis||'Complete retained original bytes.'])),
    ...body.evidenceIds.map(id=>{const item=handoverOf(draft).evidence.find(row=>row.id===id),e=item.body;return '<h3>'+escaped(e.title)+'</h3>'+para(e.kind+' · recorded '+e.createdAt+' · operator '+(e.actor||'not entered'))+
      para('Original observation '+(e.observedAt||'not entered'))+para(e.sourceUrl)+para(e.targets.map(row=>row.kind+': '+row.label+' ['+row.id+']').join('; ')||'No item-specific association was entered.')+pre(e.note)+para('Evidence '+id);}),
    ...body.contextIssues.map(para),
    issuerContextSection(draft,body.issuerProgrammeId??null),
    '<h2>Recorded field observations</h2>',
    ...(body.fieldIssues.length?body.fieldIssues.map(row=>'<h3>'+escaped(row.label||row.id)+'</h3>'+para(JSON.stringify(row.counts))+
      (row.issues.length?row.issues.map(para).join(''):para('No issue from the recorded field conventions.'))):[para('Canonical-answer output; no issuer-field limit comparison was recorded.')]),
    ...(body.fieldSourceReview?[
      '<h2>Answer coverage and source wording at preparation</h2>',para(body.fieldSourceReview.meaning),
      table(['Answer area','Mapped field identities'],body.fieldSourceReview.answers.map(row=>[row.title,row.fieldIds.join(', ')||'No association entered'])),
      table(['Field','Source state','Changed answer identities','Last wording choice','Reviewed at'],body.fieldSourceReview.fields.map(row=>[row.label||row.id,row.status,row.changedAnswerIds.join(', '),row.choice||'',row.reviewedAt||''])),
    ]:[]),
    '<h2>Original issuer observations</h2>',
    para('These are the operator’s retained observations and original files. File hashes identify received bytes; they do not independently authenticate an issuer or prove submission or approval.'),
    ...(returns.length?returns.map(row=>'<h3>'+escaped(row.body.kind)+'</h3>'+
      para('Recorded '+row.body.recordedAt+'; source observation '+(row.body.observedAt||'not entered')+'; operator '+(row.body.actor||'not entered'))+
      para('Observation '+row.id+(row.body.supersedes?' · corrects '+row.body.supersedes:''))+
      para(row.body.reference)+para(row.body.sourceUrl)+pre(row.body.note)+
      (row.body.file?para('Original file '+row.body.file.originalName+' · '+row.body.file.bytes+' bytes · '+row.body.file.sha256):para('No original return file was attached.'))):[para('No issuer observation has been recorded for this edition.')]),
    '<h2>Comparison to the present draft</h2>',
    para(comparison.meaning),para('Current draft update '+comparison.currentUpdatedAt),
    table(['Original item','Current status'],comparison.outputItems.map(row=>[row.before?.label||row.after?.label||row.id,row.status])),
    ...comparison.outputItems.filter(row=>row.status!=='unchanged').map(row=>'<h3>'+escaped(row.before?.label||row.after?.label||row.id)+'</h3><h4>Frozen output</h4>'+
      pre(row.before?.text??'(absent)')+'<h4>Current output</h4>'+pre(row.after?.text??'(absent)')),
    '<h3>Other retained authoring changes</h3>',
    ...comparison.context.map(row=>'<h4>'+escaped(row.key)+'</h4><h5>Frozen</h5>'+pre(JSON.stringify(row.before,null,2))+'<h5>Current</h5>'+pre(JSON.stringify(row.after,null,2))),
    '<h2>Whole editable receiving</h2>',
    para('The complete original draft JSON carries every file byte, saved version, prepared edition and observation. Open that JSON through the existing submission editor to continue editing. This printable report is a readable projection; its frozen prepared output and later comparison are labeled separately.'),
  ];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
    escaped(body.title||'Prepared submission')+'</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:1080px;margin:auto;padding:2rem;color:#181818;background:#fff}h1,h2,h3{line-height:1.2}h2{border-top:2px solid #222;padding-top:1.1rem;margin-top:2rem}p,td,pre{overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 ui-monospace,monospace;background:#f4f4f4;padding:1rem}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;vertical-align:top;border:1px solid #aaa;padding:.55rem}th{background:#eee}@media print{body{max-width:none;padding:0}h2,h3{break-after:avoid}pre,table{font-size:10pt}}</style></head><body>'+sections.join('\n')+'</body></html>';
}
