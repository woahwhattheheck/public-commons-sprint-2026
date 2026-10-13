// MIT. Typed issuer context in the existing grant-submission handover.
export const ISSUER_CONTEXT_SCHEMA = 'stellar-forge.grant-issuer-context.v1';
export const ISSUER_BUNDLE_SCHEMA = 'stellar-forge.sf47-operations.v1.bundle';
export const TERMS_SCHEMA = 'stellar-forge.sf47-award-terms.v1';
export const CORRESPONDENCE_SCHEMA = 'stellar-forge.issuer-correspondence.receiving.v1';
export const STAGES = ['UNRECORDED','INTEREST_ACKNOWLEDGED','INVITED','SUBMITTED','AWARDED','DECLINED','WITHDRAWN'];
export const TRACKS = ['OPEN','INTEGRATION','RFP'];
export const MAX_ISSUER_BYTES = 32 * 1024 * 1024;
const HASH=/^[a-f0-9]{64}$/;
export const issuerClone=value=>JSON.parse(JSON.stringify(value));
export function issuerNeed(value,message){if(!value)throw new Error(message);}
export function issuerCanonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){issuerNeed(Number.isFinite(value),'Retain finite issuer context numbers.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(issuerCanonical).join(',')+']';
  issuerNeed(value&&typeof value==='object','Retain a complete issuer context object.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+issuerCanonical(value[key])).join(',')+'}';
}
const need=issuerNeed,record=(value,label)=>{need(value&&typeof value==='object'&&!Array.isArray(value),label+' must be an object.');return value;};
const text=(value,label)=>{need(typeof value==='string',label+' must be text.');return value;};
const hash=(value,label)=>{need(typeof value==='string'&&HASH.test(value),'Retain the original '+label+' SHA-256.');return value;};
const integer=(value,label,min=0)=>{need(Number.isSafeInteger(value)&&value>=min,'Retain the original '+label+'.');return value;};
const timestamp=(value,label)=>{text(value,label);need(Number.isFinite(Date.parse(value)),label+' needs its recorded date.');return value;};
function unique(values,label){need(new Set(values).size===values.length,'Retain unique '+label+'.');}
export function issuerWorkingSelection(selection={}){
  return {file:null,title:'Issuer programme',actor:'',note:'',receivedAt:'',sourceUrl:'',...issuerClone(selection.issuerDraft||{})};
}
export function issuerContexts(draft){return draft.handover?.issuerProgrammes||[];}
export function selectedIssuerContext(draft,id=draft.handover?.selection?.issuerProgrammeId??null){
  if(id===null)return null;
  const item=issuerContexts(draft).find(row=>row.id===id);
  need(item,'Select a retained issuer programme.');return item;
}
export function issuerFileDescriptor(value,objects){
  record(value,'Complete issuer handover file');hash(value.sha256,'issuer handover file');
  integer(value.bytes,'complete issuer handover byte count',1);
  need(value.bytes<=MAX_ISSUER_BYTES,'Receive the complete native issuer handover up to 32 MiB.');
  for(const key of ['name','originalName','mediaType'])text(value[key],'Issuer file '+key);
  need(value.name&&!/[\\/\u0000-\u001f\u007f]/.test(value.name)&&!['.','..'].includes(value.name),'Keep a plain receiving filename.');
  need(value.mediaType==='application/zip','Retain the complete original Operations ZIP.');
  if(objects){const original=objects.get(value.sha256);need(original&&original.bytes===value.bytes,'Retain the complete original issuer programme bytes.');}
  return value;
}
function selectedPlan(value){
  record(value,'Issuer programme selected plan');text(value.id,'Native plan identity');
  integer(value.revision,'native selected plan revision',1);hash(value.contentSha256,'native selected plan content');
  hash(value.fileSha256,'complete native planning ZIP');integer(value.fileBytes,'complete native planning ZIP byte count',1);
}
function termsSelection(value){
  record(value,'Original terms selection');
  need(value.schema===TERMS_SCHEMA+'.selection','Keep the original saved terms selection.');
  text(value.id,'Original terms identity');integer(value.revision,'original terms revision',1);
  text(value.sourceId,'Original terms source identity');hash(value.sourceSha256,'original terms source');
  hash(value.editionSha256,'original terms edition');
}
function termsDocument(value){
  record(value,'Selected issuer interpretation');
  for(const key of ['title','note'])text(value[key],'Issuer interpretation '+key);
  need(TRACKS.includes(value.proposalTrack),'Retain the explicitly proposed track.');
  need(value.issuerTrack===null||TRACKS.includes(value.issuerTrack),'Retain the issued track or the original empty value.');
  need(STAGES.includes(value.stage),'Retain the observed issuer stage.');
  record(value.issuer,'Original issuer reference');record(value.round,'Original round selection');
  for(const key of ['sourceIds','guidanceSourceIds']){need(Array.isArray(value[key]),'Retain '+key+'.');unique(value[key],key);}
  need(Array.isArray(value.fieldSources),'Retain the original field-source selections.');
  need(value.stage==='AWARDED'||value.award===null,'Keep unissued award terms empty at this observed stage.');
  if(value.award!==null)record(value.award,'Source-linked issued award');
}
export function validateIssuerContext(row,{objects}={}){
  record(row,'Issuer programme');need(row.schema===ISSUER_CONTEXT_SCHEMA,'Use the supported original issuer context.');
  hash(row.id,'issuer context identity');const body=record(row.body,'Complete issuer context');
  timestamp(body.receivedAt,'Issuer context reception');
  for(const key of ['title','actor','note','draftId','sourceUrl'])text(body[key],'Issuer context '+key);
  hash(body.applicationSha256,'issuer context application edition');issuerFileDescriptor(body.file,objects);
  const programme=record(body.programme,'Original Operations case');
  for(const key of ['id','name','calendarStart'])text(programme[key],'Original case '+key);
  integer(programme.version,'original case version',1);
  need(['OPERATIONS','WALKTHROUGH'].includes(programme.mode),'Retain the original case purpose.');
  need(['OPEN','CLOSED'].includes(programme.state),'Retain the original case state.');
  selectedPlan(body.plan);termsSelection(body.selection);termsDocument(body.document);
  for(const key of ['termsHistory','commissioning','correspondence','originals'])need(Array.isArray(body[key]),'Retain the full '+key+' context.');
  unique(body.originals.map(row=>row.id),'original source identities');
  const sources=new Map();
  for(const source of body.originals){
    record(source,'Original source');text(source.id,'Original source identity');text(source.filename,'Original source filename');
    text(source.mediaType,'Original source media type');hash(source.sha256,'original source');integer(source.bytes,'original source byte count');
    sources.set(source.id,source);
  }
  const original=sources.get(body.selection.sourceId);
  need(original&&original.sha256===body.selection.sourceSha256,'Retain the selected native terms source.');
  unique(body.termsHistory.map(row=>row.sourceId),'terms edition source identities');
  const selected=body.termsHistory.find(row=>row.sourceId===body.selection.sourceId);
  need(selected&&selected.id===body.selection.id&&selected.revision===body.selection.revision&&
    selected.sha256===body.selection.editionSha256,'Retain the selected edition in its complete terms history.');
  for(const history of body.termsHistory){
    text(history.id,'Terms identity');integer(history.revision,'terms history revision',1);
    const source=sources.get(history.sourceId);
    need(source&&source.sha256===history.sourceSha256,'Retain every native terms history source.');
    hash(history.sha256,'terms edition');integer(history.caseVersion,'terms save version',1);
    text(history.actor,'Original terms author');timestamp(history.savedAt,'Original terms save');
    need(STAGES.includes(history.stage),'Retain each observed historical stage.');
    integer(history.planRevision,'historical selected plan revision',1);hash(history.planContentSha256,'historical selected plan');
  }
  for(const binding of body.commissioning){
    text(binding.id,'Commissioning identity');integer(binding.caseVersion,'commissioning case version',1);
    const source=sources.get(binding.sourceId);
    need(source&&source.sha256===binding.sourceSha256,'Retain each original commissioning source.');
    hash(binding.sha256,'commissioning record');integer(binding.planRevision,'commissioned plan revision',1);
    hash(binding.planContentSha256,'commissioned native plan');text(binding.basis,'Commissioning basis');
    need(['PROPOSAL','ISSUER_TERMS'].includes(binding.basis),'Retain the explicitly selected commissioning basis.');
    need(body.termsHistory.some(row=>row.id===binding.termsId&&row.revision===binding.termsRevision),
      'Retain the exact terms edition used by each commissioning.');
  }
  for(const message of body.correspondence){
    const source=sources.get(message.sourceId),original=sources.get(message.originalSourceId);
    need(source&&source.sha256===message.sourceSha256&&original&&original.sha256===message.originalSha256,
      'Retain the original message and its receiving index.');
    for(const key of ['subject','messageId','date','filename'])text(message[key],'Original correspondence '+key);
    need(Array.isArray(message.selected),'Retain the original selected message parts.');
    need(message.selected.some(row=>row.path==='original'&&row.sourceId===message.originalSourceId),
      'Retain the whole original message selection.');
    for(const part of message.selected)need(sources.get(part.sourceId)?.sha256===part.sha256,'Retain each exact selected message part.');
  }
  return row;
}
export function validateIssuerContextCollections(draft,objects){
  const handover=draft.handover;if(!handover)return draft;
  const rows=handover.issuerProgrammes||[];
  need(Array.isArray(rows),'Retain original issuer programmes.');unique(rows.map(row=>row.id),'issuer programme identities');
  const ids=new Set(rows.map(row=>row.id)),sourceHashes=new Set((draft.sources||[]).map(row=>row.sha256));
  for(const row of rows){validateIssuerContext(row,{objects});need(sourceHashes.has(row.body.applicationSha256),'Retain the original application associated with issuer reception.');}
  const selection=value=>{
    if(!value)return;
    const id=value.issuerProgrammeId??null;need(id===null||ids.has(id),'Retain the selected issuer programme.');
    if(value.issuerDraft!==undefined){
      const staged=issuerWorkingSelection(value);
      for(const key of ['title','actor','note','receivedAt','sourceUrl'])text(staged[key],'Issuer working '+key);
      if(staged.file!==null)issuerFileDescriptor(staged.file,objects);
    }
  };
  selection(handover.selection);
  for(const version of draft.versions||[])selection(version.handoverSelection);
  for(const edition of handover.editions||[]){
    const id=edition.body.issuerProgrammeId??null;
    need(id===null||ids.has(id),'Retain the issuer programme frozen with this prepared edition.');
  }
  return draft;
}
export function issuerComparison(draft,context=selectedIssuerContext(draft)){
  if(!context)return null;
  const body=context.body,selected=draft.planningReview?.sourceSha?draft.planningReview:null;
  // The original native-plan receiver owns selection/update arithmetic.
  return {contextId:context.id,stage:body.document.stage,proposalTrack:body.document.proposalTrack,
    issuerTrack:body.document.issuerTrack,award:issuerClone(body.document.award),
    nativePlan:issuerClone(body.plan),planningSelection:issuerClone(selected),
    issuerSourceIds:issuerClone(body.document.sourceIds),guidanceSourceIds:issuerClone(body.document.guidanceSourceIds),
    round:issuerClone(body.document.round),originalMessageCount:body.correspondence.length,
    termsEditions:body.termsHistory.length,commissioningRecords:body.commissioning.length};
}
