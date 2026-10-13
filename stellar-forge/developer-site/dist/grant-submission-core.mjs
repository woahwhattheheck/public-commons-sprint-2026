import {validateRequirementReviews,captureRequirementReview} from './grant-requirement-review-core.mjs';
import {validateGrantOperatingSelection} from './grant-operating-plan-core.mjs';
import {validateProductSourceAuthoring,productSourceSelectionOf,restoreProductSourceSelection} from './grant-product-authoring-core.mjs';
import {validatePlanningUpdateState,selectPlanningRevision} from './grant-plan-update-core.mjs';
import {validateHandover,handoverSelectionOf,restoreHandoverSelection} from './grant-handover-core.mjs';
import {validatePlanSources, validatePlanningState, newPlanReview} from './grant-plan-core.mjs';
// MIT. Portable model for the existing SCF application and its local submission draft.
export const SCHEMA = 'stellar-forge.grant-submission-draft.v1';
export const ENVELOPE = 'stellar-forge.grant-submission-export.v1';
export const MAX_BYTES = 16 * 1024 * 1024;
export const ANSWERS = [
  ['project','Project and requested outcome'],
  ['need','Customer problem, need and adoption'],
  ['stellar','Why Stellar and what we contribute'],
  ['architecture','Defined architecture and operating behavior'],
  ['product','Working product and demonstrated results'],
  ['delivery','Three funded tranches and six priced deliverables'],
  ['outcomes','Threat response and outcome measurement'],
  ['capacity','Delivery capacity, payment timing and sustainability'],
  ['applicant','Applicant, experience and submission'],
];
// Later canonical headings retain the same nine saved-answer identities.
const ANSWER_HEADINGS = new Map([
  ...ANSWERS.map(([id, title]) => [title, id]),
  ["Customer problem, first payer and adoption", "need"],
  ["Why Stellar and how the product differs", "stellar"],
  ["Defined architecture and customer operation", "architecture"],
  ["Working foundation and demonstrated customer results", "product"],
  ["Threat response and measurable acceptance", "outcomes"],
  ["Capacity, payment timing and sustainability", "capacity"],
]);
export const REQUIREMENTS = [
  {id:'complete',title:'A complete answer within the form',answers:ANSWERS.map(x=>x[0]),detail:'Include the facts needed for review in the answers themselves.'},
  {id:'need',title:'Demonstrated customer need',answers:['need','product'],detail:'Explain actual use or validated need and relevant experience.'},
  {id:'integration',title:'Meaningful Stellar operation',answers:['stellar','architecture'],detail:'Describe the system and how Stellar supports its useful operation.'},
  {id:'readiness',title:'A team ready to build',answers:['applicant','capacity','delivery'],detail:'Connect relevant skills, selected infrastructure and a feasible delivery plan.'},
  {id:'budget',title:'Prospective eligible development',answers:['delivery','capacity'],detail:'Price the remaining Stellar implementation work and explain the allocation.'},
  {id:'tranches',title:'Three priced delivery tranches',answers:['delivery'],detail:'Give outcomes, timing, cost and completion measures; finish with mainnet.'},
  {id:'response',title:'Second-tranche threat response',answers:['outcomes','delivery'],detail:'Include the threat model and monitoring procedure in the second tranche.'},
  {id:'value',title:'Ecosystem contribution',answers:['stellar','product'],detail:'Explain the value and difference from existing solutions.'},
  {id:'eligibility',title:'Applicant and applicable conditions',answers:['applicant'],detail:'Review eligibility, open-source contract plans and any applicable track or funding conditions.'},
];
export const OFFICIAL = {
  reviewedAt:'2026-10-13',
  criteria:'https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria',
  budget:'https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines',
  rules:'https://stellar.gitbook.io/scf-handbook/scf-awards/official-rules-for-submissions',
  round:'https://communityfund.stellar.org/awards/recxrSMYwAl8vcglg',
  deadline:'2026-11-08',
};
const ids = ANSWERS.map(x=>x[0]);
const reviewIds = REQUIREMENTS.map(x=>x.id);
const clone = value => JSON.parse(JSON.stringify(value));
function need(value,message){if(!value)throw new Error(message);}
function string(value,name){need(typeof value==='string',name+' must be text.');return value;}
function list(value,name){need(Array.isArray(value),name+' must be a list.');return value;}
function unique(value,name){need(new Set(value).size===value.length,'Keep unique '+name+'.');}
function iso(value,name){need(typeof value==='string'&&Number.isFinite(Date.parse(value)),name+' needs an actual date.');}
function hash(value,size,name){need(typeof value==='string'&&new RegExp('^[a-f0-9]{'+size+'}$').test(value),'Retain the original '+name+'.');}
function limit(value,name){need(value===null||(Number.isSafeInteger(value)&&value>=1),name+' is a positive integer, or empty.');}
function webUrl(value,loopback=false){const match=value.match(/^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?(?:[/?#][^\s]*)?$/i);return !!match&&(!match[3]||Number(match[3])<=65535)&&(match[1].toLowerCase()==='https'||(loopback&&['127.0.0.1','localhost','[::1]'].includes(match[2].toLowerCase())));}
function httpsOrEmpty(value,name){string(value,name);need(!value||webUrl(value),name+' needs an HTTPS URL without credentials.');}
export function measureText(value){
  string(value,'Answer');let utf8Bytes=0;
  for(const ch of value){const n=ch.codePointAt(0);utf8Bytes+=n<=0x7f?1:n<=0x7ff?2:n<=0xffff?3:4;}
  return {words:value.trim()?value.trim().split(/\s+/u).length:0,characters:Array.from(value).length,utf16:value.length,utf8Bytes};
}
export function parseAnswers(markdown){
  string(markdown,'Original application');
  const matches=[...markdown.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  need(JSON.stringify(matches.map(x=>ANSWER_HEADINGS.get(x[1])))===JSON.stringify(ANSWERS.map(x=>x[0])),'Use the complete application with its nine original answer identities and accepted headings in order.');
  return matches.map((match,index)=>({id:ANSWERS[index][0],title:match[1],
    text:markdown.slice(match.index+match[0].length,index+1<matches.length?matches[index+1].index:markdown.length).replace(/^\r?\n/,'').trim()}));
}
export function validateSource(source){
  need(source&&typeof source==='object','Retain the original source edition.');
  string(source.markdown,'Complete original application');hash(source.sha256,64,'application SHA-256');hash(source.gitBlob,40,'application Git blob');
  need(Number.isSafeInteger(source.bytes)&&source.bytes===measureText(source.markdown).utf8Bytes,'Retain the complete original application bytes.');
  string(source.url,'Application source URL');need(webUrl(source.url,true),'Retain the HTTPS or loopback application source URL.');iso(source.receivedAt,'Source acquisition date');
  parseAnswers(source.markdown);return source;
}
export function makeSource({markdown,index,url,receivedAt=new Date().toISOString()}){
  const meta=index?.application;
  need(index?.schema==='stellar-forge.grant-reviewer-source-index.v1'&&meta,'Use the original application source index.');
  return validateSource({markdown,sha256:meta.sha256,gitBlob:meta.git_blob,bytes:meta.bytes,url,receivedAt});
}
export function createDraft(source,{id,title='SCF #46 submission',now=new Date().toISOString()}={}){
  validateSource(source);need(typeof id==='string'&&id.length>0,'Select the draft identity.');
  return validateDraft({schema:SCHEMA,id,folder:'SCF submission — '+title,title,createdAt:now,updatedAt:now,currentSource:source.sha256,sources:[clone(source)],
    answers:parseAnswers(source.markdown).map(x=>({id:x.id,text:x.text,baseText:x.text,sourceSha:source.sha256,note:''})),
    form:{name:'',url:'',observedAt:'',notes:''},fields:[],reviews:REQUIREMENTS.map(x=>({id:x.id,status:'unreviewed',note:'',answers:[...x.answers]})),versions:[]});
}
function validateForm(form){
  need(form&&typeof form==='object','Retain the form selection.');
  for(const key of ['name','url','observedAt','notes'])string(form[key],'Form '+key);
  // Preserve partially entered issuer metadata in a working draft; review reports it.
}
function validateFields(fields){
  list(fields,'Form fields');unique(fields.map(x=>x.id),'field identities');
  for(const field of fields){
    need(field&&typeof field==='object','Keep complete form fields.');
    for(const key of ['id','label','prompt','text','sourceUrl','observedAt'])string(field[key],'Field '+key);
    need(field.id.length>0,'Retain the field identity.');
    list(field.answerIds,'Field answer selection');unique(field.answerIds,'selected answer identities');
    need(field.answerIds.every(x=>ids.includes(x)),'Select original application answers.');
    limit(field.wordLimit,'Word limit');limit(field.characterLimit,'Character limit');
    need(['unspecified','characters','utf16','utf8Bytes'].includes(field.characterMethod),'Select the issuer character-count convention.');
    validateFieldSourceReview(field);
    if(field.sourceReviewNote!==undefined)string(field.sourceReviewNote,'Working field review note');
    // Form-source metadata remains editable until the operator completes it.
  }
}
function validateState(state,sources,planSources=[]){
  validatePlanningState(state.planningReview,planSources);
  if(state.planningReview?.operatingSelection!==undefined&&state.planningReview.operatingSelection!==null){
    const source=planSources.find(item=>item.sha256===state.planningReview.sourceSha);
    validateGrantOperatingSelection(state.planningReview.operatingSelection,source,state.planningReview.revision);
  }
  validatePlanningUpdateState(state,planSources);
  need(sources.some(x=>x.sha256===state.currentSource),'Retain the selected source edition.');
  list(state.answers,'Answers');need(JSON.stringify(state.answers.map(x=>x.id))===JSON.stringify(ids),'Retain all nine answer identities.');
  for(const answer of state.answers){
    string(answer.text,'Draft answer');string(answer.note,'Answer note');string(answer.baseText,'Answer source');
    const source=sources.find(x=>x.sha256===answer.sourceSha);need(source,'Retain every answer source edition.');
    need(parseAnswers(source.markdown).find(x=>x.id===answer.id)?.text===answer.baseText,'The answer baseline must match its retained source edition.');
  }
  validateForm(state.form);validateFields(state.fields);
  list(state.reviews,'Requirements review');need(JSON.stringify(state.reviews.map(x=>x.id))===JSON.stringify(reviewIds),'Retain the original requirements review.');
  for(const item of state.reviews){
    need(['unreviewed','covered','needs-edit','not-applicable'].includes(item.status),'Select an explicit review status.');
    string(item.note,'Review note');list(item.answers,'Review answer selection');unique(item.answers,'review answer identities');need(item.answers.every(x=>ids.includes(x)),'Select original answers for review.');
  }
  validateRequirementReviews(state,ids);
}
export function recordRequirementReview(draft,id,input,at=new Date().toISOString()){
  validateDraft(draft);
  const review=captureRequirementReview(draft,id,input,{at,criteria:{url:OFFICIAL.criteria,reviewedAt:OFFICIAL.reviewedAt}});
  const result=retainVersion(draft,'Before recording required-content review '+id,at);
  result.reviews[result.reviews.findIndex(row=>row.id===id)]=review;
  return validateDraft(result);
}
export function validateDraft(input){
  need(input&&typeof input==='object'&&input.schema===SCHEMA,'Open a complete SCF submission draft.');
  for(const key of ['id','title','folder'])string(input[key],'Draft '+key);
  need(input.id.length>0,'Retain the draft identity.');iso(input.createdAt,'Creation date');iso(input.updatedAt,'Update date');
  list(input.sources,'Source editions');need(input.sources.length>0,'Retain source editions.');unique(input.sources.map(x=>x.sha256),'source identities');input.sources.forEach(validateSource);
  validatePlanSources(input.planSources||[]);
  validateState(input,input.sources,input.planSources||[]);list(input.versions,'Saved versions');unique(input.versions.map(x=>x.id),'version identities');
  for(const version of input.versions){
    string(version.id,'Version identity');string(version.label,'Version label');iso(version.savedAt,'Version date');string(version.title,'Version title');
    validateState(version,input.sources,input.planSources||[]);
  }
  validateHandover(input);
  validateProductSourceAuthoring(input);
  need(measureText(JSON.stringify(input)).utf8Bytes<=MAX_BYTES,'This draft exceeds 16 MiB. The current editor remains open. Copy any oversized unsaved answer text, then reduce the unsaved addition before saving.');
  return input;
}
function stateOf(draft){
  return clone({title:draft.title,currentSource:draft.currentSource,answers:draft.answers,form:draft.form,fields:draft.fields,reviews:draft.reviews,planningReview:draft.planningReview??null,planningTargets:draft.planningTargets||[],planningUpdate:draft.planningUpdate??null,handoverSelection:handoverSelectionOf(draft),productSourceSelection:productSourceSelectionOf(draft)});
}
export function retainVersion(draft,label='Saved version',now=new Date().toISOString()){
  const result=clone(validateDraft(draft));result.updatedAt=now;
  const used=new Set(result.versions.map(x=>x.id));let suffix=1;while(used.has(result.id+':'+suffix))suffix++;
  const id=result.id+':'+suffix;
  result.versions.push({id,label,savedAt:now,...stateOf(result)});
  return validateDraft(result);
}
export function restoreVersion(draft,id,now=new Date().toISOString()){
  const version=draft.versions.find(x=>x.id===id);need(version,'Select an existing saved version.');
  const result=retainVersion(draft,'Before restoring '+version.label,now);
  Object.assign(result,clone({title:version.title,currentSource:version.currentSource,answers:version.answers,form:version.form,fields:version.fields,reviews:version.reviews,planningReview:version.planningReview??null,planningTargets:version.planningTargets||[],planningUpdate:version.planningUpdate??null}));
  restoreHandoverSelection(result,version);
  restoreProductSourceSelection(result,version);
  result.folder='SCF submission — '+result.title;return validateDraft(result);
}
export function compareSource(draft,source){
  validateDraft(draft);validateSource(source);
  return parseAnswers(source.markdown).map(next=>{
    const answer=draft.answers.find(x=>x.id===next.id);
    return {...next,edited:answer.text!==answer.baseText,sourceChanged:next.text!==answer.baseText,draftText:answer.text,baseText:answer.baseText};
  });
}
export function receiveSource(draft,source,now=new Date().toISOString()){
  const changes=compareSource(draft,source);const result=retainVersion(draft,'Before receiving source '+source.gitBlob.slice(0,12),now);
  if(!result.sources.some(x=>x.sha256===source.sha256))result.sources.push(clone(source));
  result.currentSource=source.sha256;
  for(const change of changes){const answer=result.answers.find(x=>x.id===change.id);
    if(!change.edited){answer.text=change.text;answer.baseText=change.text;answer.sourceSha=source.sha256;}
  }
  return validateDraft(result);
}
export function useSourceAnswer(draft,id,source,now=new Date().toISOString()){
  validateSource(source);const next=parseAnswers(source.markdown).find(x=>x.id===id);need(next,'Select an original answer.');
  const result=retainVersion(draft,'Before selecting source answer '+next.title,now);
  if(!result.sources.some(x=>x.sha256===source.sha256))result.sources.push(clone(source));
  const answer=result.answers.find(x=>x.id===id);Object.assign(answer,{text:next.text,baseText:next.text,sourceSha:source.sha256});
  return validateDraft(result);
}
export function newField(id,answerIds=[],draft=null){
  need(typeof id==='string'&&id.length>0,'Select a field identity.');
  const field={id,label:'',prompt:'',text:'',answerIds:[...answerIds],wordLimit:null,characterLimit:null,characterMethod:'unspecified',sourceUrl:'',observedAt:''};
  if(draft){field.text=answerIds.map(id=>{const a=draft.answers.find(x=>x.id===id);need(a,'Select a canonical answer.');return a.text;}).join('\n\n');field.sourceReview=fieldReviewSnapshot(draft,field,'refresh','',draft.updatedAt);}
  validateFields([field]);return field;
}
export function rebuildField(draft,id){
  const result=retainVersion(draft,'Before refreshing form field');
  const field=result.fields.find(x=>x.id===id);need(field,'Select an existing form field.');
  field.text=field.answerIds.map(id=>result.answers.find(x=>x.id===id).text).join('\n\n');
  field.sourceReview=fieldReviewSnapshot(result,field,'refresh','',result.updatedAt);
  return validateDraft(result);
}
function tableCells(line){return line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(x=>x.trim().replaceAll('\\|','|'));}
export function plainText(markdown){
  const lines=String(markdown).replaceAll('\r\n','\n').split('\n'),out=[];
  for(let i=0;i<lines.length;i++){
    if(lines[i].trim().startsWith('|')&&i+1<lines.length&&tableCells(lines[i+1]).every(x=>/^:?-{3,}:?$/.test(x))){
      const heads=tableCells(lines[i]);i++;
      while(i+1<lines.length&&lines[i+1].trim().startsWith('|')){
        const row=tableCells(lines[++i]);out.push(heads.map((h,j)=>h+': '+(row[j]??'')).join('; '));
      }
    }else if(!/^\s*(?:\x60{3}|~{3})/.test(lines[i]))out.push(lines[i].replace(/^#{1,6}\s+/,'').replace(/^>\s?/,''));
  }
  return out.join('\n').replace(/\[([^\]\n]+)\]\((https:\/\/[^)\s]+)\)/g,'$1 ($2)').replace(/\*\*([^*\n]+)\*\*/g,'$1').replace(/\x60([^\x60\n]+)\x60/g,'$1').trim();
}
export function outputText(text,format='plain'){need(['plain','markdown'].includes(format),'Select plain text or Markdown.');return format==='plain'?plainText(text):text;}
export function fieldStatus(field,form,format='plain'){
  const counts=measureText(outputText(field.text,format)),issues=[];
  if(!field.label.trim())issues.push('Record the issuer field label.');
  if(!field.text.trim())issues.push('Add the complete field answer.');
  const sourceUrl=field.sourceUrl||form.url,observedAt=field.observedAt||form.observedAt;
  if(!sourceUrl)issues.push('Record the form source URL.');else if(!webUrl(sourceUrl))issues.push('Complete the issuer HTTPS form URL.');
  if(!observedAt)issues.push('Record when the form was observed.');else if(!Number.isFinite(Date.parse(observedAt)))issues.push('Complete the form observation date.');
  if(field.wordLimit!==null&&counts.words>field.wordLimit)issues.push((counts.words-field.wordLimit)+' whitespace-counted words above the recorded limit.');
  if(field.characterLimit!==null){
    if(field.characterMethod==='unspecified')issues.push('Select the issuer character-count convention to compare its recorded limit.');
    else if(counts[field.characterMethod]>field.characterLimit)issues.push((counts[field.characterMethod]-field.characterLimit)+' '+field.characterMethod+' above the recorded limit.');
  }
  return {counts,issues};
}
export function applicationOutput(draft,{format='plain',useFields=false}={}){
  validateDraft(draft);
  const items=useFields?draft.fields.map(x=>({title:x.label||'Unlabeled form field',text:x.text})):
    draft.answers.map(x=>({title:ANSWERS.find(y=>y[0]===x.id)[1],text:x.text}));
  need(items.length>0,'Add a form field or choose canonical answers.');
  return items.map(x=>(format==='markdown'?'## ':'')+x.title+'\n\n'+outputText(x.text,format)).join('\n\n')+'\n';
}
export function importFormMap(draft,map){
  need(map?.schema==='stellar-forge.grant-form-map.v1','Open an issuer form map exported from this workspace.');
  validateForm(map.form);validateFields(map.fields);
  const result=retainVersion(draft,'Before importing issuer form mapping');
  result.form=clone(map.form);result.fields=clone(map.fields);return validateDraft(result);
}
export function exportFormMap(draft){validateDraft(draft);return {schema:'stellar-forge.grant-form-map.v1',form:clone(draft.form),fields:clone(draft.fields)};}

/** Keep native plan bytes once per draft; versions retain the selected review. */
export function receivePlanningSource(draft,source,now=new Date().toISOString(),{revision=source.document.currentRevision}={}){
  validatePlanSources([source]);
  const result=retainVersion(draft,'Before receiving native planning edition',now);
  result.planSources??=[];
  const retained=result.planSources.find(x=>x.sha256===source.sha256);
  if(retained){
    need(retained.base64===source.base64&&JSON.stringify(retained.document)===JSON.stringify(source.document),
      'Retain the original complete planning edition.');
  }else result.planSources.push(clone(source));
  selectPlanningRevision(result,(retained||source).sha256,revision,{now});
  return validateDraft(result);
}

// A field's manuscript baseline travels inside the original field and every
// saved version/form-map. Old drafts retain their original unreviewed state.
export const FIELD_SOURCE_SCHEMA='stellar-forge.grant-field-sources.v1';
function validateFieldSourceReview(field){
  const review=field.sourceReview;if(review===undefined)return;
  need(review&&review.schema===FIELD_SOURCE_SCHEMA,'Retain the field source review.');
  iso(review.reviewedAt,'Field source review date');
  need(['refresh','keep'].includes(review.choice),'Retain the explicit field wording choice.');
  string(review.fieldText,'Reviewed field text');string(review.note,'Field source review note');
  list(review.answers,'Reviewed source answers');unique(review.answers.map(row=>row.id),'reviewed answer identities');
  for(const row of review.answers){need(ids.includes(row.id),'Retain an original answer identity.');string(row.text,'Reviewed source answer');}
}
function fieldReviewSnapshot(draft,field,choice,note,reviewedAt){
  return {schema:FIELD_SOURCE_SCHEMA,reviewedAt,choice,note,fieldText:field.text,
    answers:field.answerIds.map(id=>{const answer=draft.answers.find(row=>row.id===id);need(answer,'Select a complete current answer.');return {id,text:answer.text};})};
}
/** Exact editorial comparison; unchanged text is never classified as new facts. */
export function fieldSourceStatus(draft,field){
  validateFieldSourceReview(field);
  const previous=field.sourceReview?.answers||[],old=new Map(previous.map(row=>[row.id,row]));
  const selected=new Set(field.answerIds),current=new Map(draft.answers.map(row=>[row.id,row]));
  const rows=[...new Set([...previous.map(row=>row.id),...field.answerIds])].map(id=>{
    const before=old.get(id),after=selected.has(id)?current.get(id):null;
    need(!selected.has(id)||after,'Retain the complete selected draft answer.');
    return {id,title:ANSWERS.find(row=>row[0]===id)?.[1]||id,before:before?.text??null,after:after?.text??null,
      status:!field.sourceReview?'unreviewed':!before?'added':!after?'removed':before.text===after.text?'unchanged':'changed'};
  });
  const changedAnswerIds=rows.filter(row=>!['unchanged','unreviewed'].includes(row.status)).map(row=>row.id);
  const orderChanged=!!field.sourceReview&&JSON.stringify(previous.map(row=>row.id))!==JSON.stringify(field.answerIds);
  const status=field.sourceReview?((changedAnswerIds.length||orderChanged)?'changed':field.answerIds.length?'current':'unmapped'):
    field.answerIds.length?'unreviewed':'unmapped';
  return {status,rows,changedAnswerIds,orderChanged,fieldEdited:field.sourceReview?field.text!==field.sourceReview.fieldText:null,
    choice:field.sourceReview?.choice??null,reviewedAt:field.sourceReview?.reviewedAt??null,
    proposedText:field.answerIds.map(id=>current.get(id).text).join('\n\n')};
}
export function reviewFieldSources(draft,id,{choice='keep',note='',now=new Date().toISOString()}={}){
  need(['refresh','keep'].includes(choice),'Select current answer wording or keep the edited field.');
  string(note,'Field source review note');iso(now,'Field source review date');
  const result=retainVersion(draft,choice==='refresh'?'Before refreshing mapped field':'Before accepting edited field wording',now);
  const field=result.fields.find(row=>row.id===id);need(field,'Select an existing form field.');
  if(choice==='refresh')field.text=fieldSourceStatus(result,field).proposedText;
  field.sourceReview=fieldReviewSnapshot(result,field,choice,note,now);delete field.sourceReviewNote;
  return validateDraft(result);
}
/** Operator-invoked batch refresh only for text copied unchanged from answers. */
export function refreshUneditedFormFields(draft,{now=new Date().toISOString()}={}){
  validateDraft(draft);const eligible=draft.fields.filter(field=>{
    const status=fieldSourceStatus(draft,field);
    return status.status==='changed'&&status.fieldEdited===false&&status.choice==='refresh';
  }).map(field=>field.id);
  if(!eligible.length)return {draft:clone(draft),updatedIds:[]};
  const result=retainVersion(draft,'Before refreshing unchanged mapped fields',now);
  for(const id of eligible){const field=result.fields.find(row=>row.id===id);
    field.text=fieldSourceStatus(result,field).proposedText;
    field.sourceReview=fieldReviewSnapshot(result,field,'refresh','',now);
  }
  return {draft:validateDraft(result),updatedIds:eligible};
}
/** Mapping coverage is explicit editorial context, not a claim of adequacy. */
export function formSourceReview(draft){
  const fields=draft.fields.map(field=>{
    const status=fieldSourceStatus(draft,field);
    return {id:field.id,label:field.label,status:status.status,changedAnswerIds:status.changedAnswerIds,
      fieldEdited:status.fieldEdited,choice:status.choice,reviewedAt:status.reviewedAt};
  });
  const answers=ANSWERS.map(([id,title])=>({id,title,fieldIds:draft.fields.filter(field=>field.answerIds.includes(id)).map(field=>field.id)}));
  return {schema:'stellar-forge.grant-form-source-review.v1',answers,fields,
    unmappedAnswerIds:answers.filter(row=>!row.fieldIds.length).map(row=>row.id),
    changedFieldIds:fields.filter(row=>row.status==='changed').map(row=>row.id),
    unreviewedFieldIds:fields.filter(row=>row.status==='unreviewed').map(row=>row.id),
    meaning:'The recorded mapping and exact answer changes support editorial review. Include the useful facts in the actual field text and apply the issuer’s observed prompts and limits.'};
}
