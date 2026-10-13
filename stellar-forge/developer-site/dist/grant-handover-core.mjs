import {validateIssuerContextCollections,selectedIssuerContext} from './grant-issuer-core.mjs';
// MIT. Original submission-draft extension; no separate store or issuer action.
export const HANDOVER_SCHEMA = 'stellar-forge.grant-submission-handover.v1';
export const BUNDLE_SCHEMA = 'stellar-forge.grant-reviewer-source-bundle.v1';
export const SOURCE_PACKAGE_SCHEMA = 'stellar-forge.grant-reviewer-source-package.v1';
export const EDITION_SCHEMA = 'stellar-forge.grant-prepared-submission.v1';
export const RETURN_SCHEMA = 'stellar-forge.grant-submission-return.v1';
export const SOURCE_ROLES = ['application','source-index','budget','product-and-finance'];
export const EVIDENCE_KINDS = ['source','review-export','operated-result','issuer-instructions','other'];
export const RETURN_KINDS = ['submission-observation','issuer-acknowledgement','issuer-message','operator-note'];
const HASH = /^[a-f0-9]{64}$/;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const clone = value => JSON.parse(JSON.stringify(value));
const need = (value,message) => { if (!value) throw new Error(message); };
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
function record(value,name) { need(value && typeof value === 'object' && !Array.isArray(value),name+' must be an object.'); return value; }
function text(value,name) { need(typeof value === 'string',name+' must be text.'); return value; }
function list(value,name) { need(Array.isArray(value),name+' must be a list.'); return value; }
function unique(values,name) { need(new Set(values).size === values.length,'Retain unique '+name+'.'); }
function hash(value,name) { need(typeof value === 'string' && HASH.test(value),'Retain the original '+name+' SHA-256.'); return value; }
function date(value,name,empty=false) { text(value,name); need((empty && value==='') || Number.isFinite(Date.parse(value)),name+' needs a recorded date or timestamp.'); }
export function referenceUrl(value,name='Source URL') {
  text(value,name);
  if (!value) return value;
  const match = value.match(/^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?(?:[/?#][^\s]*)?$/i);
  need(match && (!match[3] || Number(match[3])<=65535) &&
    (match[1].toLowerCase()==='https' || ['127.0.0.1','localhost','[::1]'].includes(match[2].toLowerCase())),
    name+' needs HTTPS or the original loopback source, without credentials.');
  return value;
}
export function safeFilename(value) {
  text(value,'Original filename');
  const result=value.replace(/[\u0000-\u001f\u007f/\\]/g,'_').replace(/^\.+$/,'file').trim();
  return result || 'original-file';
}
export function canonical(value) {
  if (value===null || typeof value==='boolean' || typeof value==='string') return JSON.stringify(value);
  if (typeof value==='number') { need(Number.isFinite(value),'Retain a finite JSON number.'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  record(value,'JSON value');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export function emptySelection() {
  return {
    bundleId:null, evidenceIds:[], title:'Prepared submission', actor:'', note:'',
    outputKind:'answers', format:'plain',
    issuerProgrammeId:null, issuerDraft:{file:null,title:'Issuer programme',actor:'',note:'',receivedAt:'',sourceUrl:''},
    evidenceDraft:{title:'',kind:'source',sourceUrl:'',observedAt:'',note:'',targets:[],file:null},
    returnDraft:{editionId:null,kind:'operator-note',observedAt:'',sourceUrl:'',reference:'',note:'',supersedes:null,file:null},
  };
}
export function emptyHandover() {
  return {schema:HANDOVER_SCHEMA,objects:[],bundles:[],evidence:[],editions:[],returns:[],issuerProgrammes:[],selection:emptySelection()};
}
export function handoverOf(draft) { return draft.handover || emptyHandover(); }
export function handoverSelectionOf(draft) { return draft.handover ? clone(draft.handover.selection) : null; }
export function restoreHandoverSelection(draft,version) {
  if (!draft.handover && !version.handoverSelection) return draft;
  draft.handover ||= emptyHandover();
  draft.handover.selection=version.handoverSelection ? clone(version.handoverSelection) : emptySelection();
  return draft;
}
export function authorSnapshot(draft) {
  const result=clone(draft);
  delete result.handover;
  result.versions=[];
  // Original planning file bytes stay once in the parent draft. The frozen
  // metadata and native document bind the exact original file by its SHA.
  if(Array.isArray(result.planSources))result.planSources=result.planSources.map(source=>{delete source.base64;return source;});
  return result;
}
export function hydrateAuthorSnapshot(draft,snapshot) {
  const result=clone(snapshot);
  if(Array.isArray(result.planSources))result.planSources=result.planSources.map(source=>{
    const retained=(draft.planSources||[]).find(row=>row.sha256===source.sha256);
    need(retained,'Retain every original planning file referenced by this prepared edition.');
    const metadata=clone(retained);delete metadata.base64;
    need(canonical(metadata)===canonical(source),'The frozen planning metadata differs from its retained original file.');
    return clone(retained);
  });
  const bundleId=result.productSourceAuthoring?.selection?.bundleId;
  if(bundleId){
    const bundle=(draft.handover?.bundles||[]).find(row=>row.id===bundleId);
    need(bundle,'Retain the complete product-source reviewer edition selected by this prepared submission.');
    const hashes=new Set(bundle.body.files.map(file=>file.sha256));
    // A frozen author snapshot excludes recursive handover history. Hydration
    // reconnects only its selected original source files from the parent draft.
    result.handover=emptyHandover();
    result.handover.bundles=[clone(bundle)];
    result.handover.objects=(draft.handover?.objects||[]).filter(row=>hashes.has(row.sha256)).map(clone);
    result.handover.selection.bundleId=bundleId;
  }
  return result;
}
function descriptor(value,objects,name='Original file') {
  record(value,name); hash(value.sha256,name); text(value.name,name+' name');
  need(value.name===safeFilename(value.name),name+' needs a safe receiving filename.');
  text(value.originalName,name+' original name'); text(value.mediaType,name+' media type');
  need(Number.isSafeInteger(value.bytes) && value.bytes>=0,name+' needs its complete byte count.');
  const object=objects.get(value.sha256);
  need(object && object.bytes===value.bytes,'Retain the complete original bytes for '+value.name+'.');
  if (own(value,'sourceUrl')) referenceUrl(value.sourceUrl,name+' source URL');
  return value;
}
function targets(values) {
  list(values,'Evidence associations');
  unique(values.map(value=>value.kind+':'+value.id),'evidence associations');
  for (const value of values) {
    record(value,'Evidence association');
    need(['answer','field','requirement'].includes(value.kind),'Select an original answer, form field or content requirement.');
    text(value.id,'Associated item identity'); need(value.id.length>0,'Retain the associated item identity.');
    text(value.label,'Associated item label');
  }
}
function validateSelection(value,context) {
  if (value===null || value===undefined) return;
  record(value,'Handover working selection');
  for (const key of ['title','actor','note']) text(value[key],'Handover '+key);
  need(value.bundleId===null || context.bundles.has(value.bundleId),'Retain the selected reviewer source bundle.');
  list(value.evidenceIds,'Selected evidence'); unique(value.evidenceIds,'selected evidence');
  need(value.evidenceIds.every(id=>context.evidence.has(id)),'Retain every selected evidence item.');
  need(['answers','fields'].includes(value.outputKind),'Select canonical answers or issuer fields.');
  need(['plain','markdown'].includes(value.format),'Select the exact output format.');
  const evidence=record(value.evidenceDraft,'Working evidence description');
  for (const key of ['title','sourceUrl','observedAt','note']) text(evidence[key],'Evidence '+key);
  need(EVIDENCE_KINDS.includes(evidence.kind),'Select an evidence category.'); targets(evidence.targets);
  // Unfinished source/date metadata remains editable, just like the original issuer form.
  if (evidence.file!==null) descriptor(evidence.file,context.objects);
  const returned=record(value.returnDraft,'Working issuer-return description');
  need(returned.editionId===null || context.editions.has(returned.editionId),'Select a retained prepared edition.');
  need(RETURN_KINDS.includes(returned.kind),'Select an observation category.');
  for (const key of ['observedAt','sourceUrl','reference','note']) text(returned[key],'Return '+key);
  need(returned.supersedes===null || context.returns.has(returned.supersedes),'Retain the observation being corrected.');
  if (returned.file!==null) descriptor(returned.file,context.objects);
}
export function validateHandover(draft) {
  if (draft.handover===undefined) {
    need(!(draft.versions||[]).some(value=>value.handoverSelection),'Retain the source/evidence collection referenced by saved versions.');
    return draft;
  }
  const value=record(draft.handover,'Submission handover');
  need(value.schema===HANDOVER_SCHEMA,'Use the supported original submission handover.');
  for (const key of ['objects','bundles','evidence','editions','returns']) list(value[key],'Retained '+key);
  unique(value.objects.map(row=>row.sha256),'original file digests');
  const objects=new Map();
  for (const object of value.objects) {
    record(object,'Retained original');hash(object.sha256,'Original file');
    need(Number.isSafeInteger(object.bytes) && object.bytes>=0,'Retain each original byte count.');
    text(object.base64,'Complete original bytes');
    need(B64.test(object.base64),'Retain canonical complete base64 bytes.');
    const count=object.base64.length/4*3-(object.base64.endsWith('==')?2:object.base64.endsWith('=')?1:0);
    need(count===object.bytes,'The encoded original byte count differs.');
    objects.set(object.sha256,object);
  }
  for (const key of ['bundles','evidence','editions','returns']) {
    unique(value[key].map(row=>row.id),key+' identities');
    value[key].forEach(row=>hash(row.id,key+' identity'));
  }
  const bundles=new Map(value.bundles.map(row=>[row.id,row]));
  const evidence=new Map(value.evidence.map(row=>[row.id,row]));
  const editions=new Map(value.editions.map(row=>[row.id,row]));
  const returned=new Map(value.returns.map(row=>[row.id,row]));
  const sourceHashes=new Set((draft.sources||[]).map(row=>row.sha256));
  for (const bundle of value.bundles) {
    need(bundle.schema===BUNDLE_SCHEMA,'Retain the original reviewer-source bundle schema.');
    const body=record(bundle.body,'Complete source bundle');
    hash(body.applicationSha256,'Application');
    need(sourceHashes.has(body.applicationSha256),'Retain the bundle’s original application edition.');
    date(body.receivedAt,'Reviewer source reception');
    list(body.files,'Complete reviewer source files');
    need(canonical(body.files.map(row=>row.role).sort())===canonical([...SOURCE_ROLES].sort()),
      'Retain all four original reviewer source files.');
    for (const file of body.files) { descriptor(file,objects); text(file.identityBasis,'Source identity basis'); referenceUrl(file.sourceUrl); }
    need(body.files.find(row=>row.role==='application').sha256===body.applicationSha256,'The source bundle selects another application.');
  }
  for (const item of value.evidence) {
    const body=record(item.body,'Evidence record'); date(body.createdAt,'Evidence reception');
    for (const key of ['title','actor','note','observedAt','sourceUrl']) text(body[key],'Evidence '+key);
    date(body.observedAt,'Evidence observation date',true); referenceUrl(body.sourceUrl);
    need(EVIDENCE_KINDS.includes(body.kind),'Retain the evidence category.');
    descriptor(body.file,objects); targets(body.targets);
    text(body.draftId,'Evidence draft identity');hash(body.applicationSha256,'Evidence application');
    need(sourceHashes.has(body.applicationSha256),'Retain the evidence association’s original application.');
  }
  for (const edition of value.editions) {
    need(edition.schema===EDITION_SCHEMA,'Retain the prepared-edition schema.');
    const body=record(edition.body,'Frozen prepared edition');date(body.createdAt,'Preparation date');
    for (const key of ['title','actor','note']) text(body[key],'Prepared edition '+key);
    record(body.snapshot,'Complete original authoring state');
    need(body.snapshot.schema===draft.schema && body.snapshot.handover===undefined &&
      Array.isArray(body.snapshot.versions) && body.snapshot.versions.length===0,
      'Retain the complete nonrecursive original authoring state.');
    need(body.selectedBundleId===null || bundles.has(body.selectedBundleId),'Retain the selected frozen reviewer bundle.');
    if(body.selectedBundleId!==null)need(bundles.get(body.selectedBundleId).body.applicationSha256===body.snapshot.currentSource,'The selected prepared reviewer bundle belongs to another application.');
    hydrateAuthorSnapshot(draft,body.snapshot);
    list(body.bundleIds,'Frozen reviewer sources');unique(body.bundleIds,'frozen reviewer source identities');
    need(body.bundleIds.every(id=>bundles.has(id)),'Retain every frozen source bundle.');
    need(body.selectedBundleId===null || body.bundleIds.includes(body.selectedBundleId),'Include the explicitly selected reviewer source in the frozen closure.');
    list(body.evidenceIds,'Frozen evidence');unique(body.evidenceIds,'frozen evidence identities');
    need(body.evidenceIds.every(id=>evidence.has(id)),'Retain every frozen evidence file.');
    const output=record(body.output,'Exact prepared output');
    need(['answers','fields'].includes(output.kind) && ['plain','markdown'].includes(output.format),'Retain the exact selected output mode.');
    list(output.items,'Complete prepared answers');text(output.text,'Complete prepared output');hash(output.sha256,'Prepared output');
    need(Number.isSafeInteger(output.bytes) && output.bytes>=0,'Retain the exact prepared output byte count.');
    need(output.items.length>0,'Retain at least one complete prepared answer.');
    unique(output.items.map(row=>row.id),'prepared answer identities');
    for (const item of output.items) {
      record(item,'Prepared answer');text(item.id,'Prepared answer ID');text(item.label,'Prepared answer label');text(item.text,'Prepared answer text');
      list(item.answerIds,'Prepared answer sources');text(item.prompt,'Original issuer prompt');
    }
    list(body.fieldIssues,'Recorded field observations');list(body.contextIssues,'Retained-source observations');
    text(body.statusMeaning,'Preparation meaning');
  }
  for (const observation of value.returns) {
    need(observation.schema===RETURN_SCHEMA,'Retain the issuer-observation schema.');
    const body=record(observation.body,'Recorded issuer observation');
    need(editions.has(body.editionId),'Bind the observation to its exact prepared edition.');
    need(RETURN_KINDS.includes(body.kind),'Retain the recorded observation category.');
    date(body.recordedAt,'Observation recording time');date(body.observedAt,'Source observation time',true);
    for (const key of ['actor','sourceUrl','reference','note']) text(body[key],'Observation '+key);
    referenceUrl(body.sourceUrl);
    if (body.file!==null) descriptor(body.file,objects);
    need(body.supersedes===null || (returned.has(body.supersedes) &&
      returned.get(body.supersedes).body.editionId===body.editionId && body.supersedes!==observation.id),
      'A correction must retain the original observation for this same edition.');
  }
  // A correction is an additional observation, never an overwritten issuer record.
  for (const observation of value.returns) {
    const seen=new Set();let current=observation;
    while (current) { need(!seen.has(current.id),'Keep an acyclic observation correction history.');seen.add(current.id);current=current.body.supersedes?returned.get(current.body.supersedes):null; }
  }
  validateIssuerContextCollections(draft,objects);
  const context={objects,bundles,evidence,editions,returns:returned};
  validateSelection(value.selection,context);
  for (const version of draft.versions||[]) validateSelection(version.handoverSelection,context);
  return draft;
}
export function originalObject(draft,sha256) {
  hash(sha256,'Original file');
  const object=handoverOf(draft).objects.find(row=>row.sha256===sha256);
  need(object,'The selected original bytes are not retained.');
  return object;
}
export function frozenEdition(draft,id) {
  const edition=handoverOf(draft).editions.find(row=>row.id===id);
  need(edition,'Select a retained prepared edition.');return edition;
}
export function editionFileDescriptors(draft,id) {
  const value=handoverOf(draft),edition=frozenEdition(draft,id),files=[];
  for (const bundleId of edition.body.bundleIds) {
    const bundle=value.bundles.find(row=>row.id===bundleId);
    for (const file of bundle.body.files) files.push({...file,role:'reviewer-source',bundleId,sourceRole:file.role});
  }
  for (const evidenceId of edition.body.evidenceIds) {
    const item=value.evidence.find(row=>row.id===evidenceId);
    files.push({...item.body.file,role:'evidence',evidenceId,title:item.body.title});
  }
  for (const source of edition.body.snapshot.planSources||[]) files.push({
    name:safeFilename(source.filename),originalName:source.filename,mediaType:source.kind==='zip'?'application/zip':'application/json',
    bytes:source.bytes,sha256:source.sha256,role:'native-planning-source',
    identityBasis:'Exact original planning file, native document and selected revision retained by the original SF47 bridge.',
  });
  if(edition.body.issuerProgrammeId){
    const issuer=selectedIssuerContext(draft,edition.body.issuerProgrammeId);
    files.push({...clone(issuer.body.file),role:'issuer-programme',issuerProgrammeId:issuer.id,title:issuer.body.title,
      identityBasis:'Complete original Operations case with selected terms, correspondence, native planning and commissioning history.'});
  }
  for (const observation of value.returns.filter(row=>row.body.editionId===id && row.body.file)) {
    files.push({...observation.body.file,role:'issuer-observation',observationId:observation.id});
  }
  return files;
}
export function changedItems(before,after) {
  const old=new Map(before.map(row=>[row.id,row])),next=new Map(after.map(row=>[row.id,row])),rows=[];
  for (const id of new Set([...old.keys(),...next.keys()])) {
    const a=old.get(id),b=next.get(id);
    rows.push({id,status:!a?'added':!b?'removed':canonical(a)===canonical(b)?'unchanged':'changed',before:a||null,after:b||null});
  }
  return rows;
}
