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
  reviewedAt:'2026-10-12',
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
  need(JSON.stringify(matches.map(x=>x[1]))===JSON.stringify(ANSWERS.map(x=>x[1])),'Use the complete original application with its nine canonical answers in order.');
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
    // Form-source metadata remains editable until the operator completes it.
  }
}
function validateState(state,sources,planSources=[]){
  validatePlanningState(state.planningReview,planSources);
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
  need(measureText(JSON.stringify(input)).utf8Bytes<=MAX_BYTES,'This draft exceeds 16 MiB. The current editor remains open. Copy any oversized unsaved answer text, then reduce the unsaved addition before saving.');
  return input;
}
function stateOf(draft){
  return clone({title:draft.title,currentSource:draft.currentSource,answers:draft.answers,form:draft.form,fields:draft.fields,reviews:draft.reviews,planningReview:draft.planningReview??null});
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
  Object.assign(result,clone({title:version.title,currentSource:version.currentSource,answers:version.answers,form:version.form,fields:version.fields,reviews:version.reviews,planningReview:version.planningReview??null}));
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
  if(draft)field.text=answerIds.map(id=>{const a=draft.answers.find(x=>x.id===id);need(a,'Select a canonical answer.');return a.text;}).join('\n\n');
  validateFields([field]);return field;
}
export function rebuildField(draft,id){
  const result=retainVersion(draft,'Before refreshing form field');
  const field=result.fields.find(x=>x.id===id);need(field,'Select an existing form field.');
  field.text=field.answerIds.map(id=>result.answers.find(x=>x.id===id).text).join('\n\n');
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
export function receivePlanningSource(draft,source,now=new Date().toISOString()){
  validatePlanSources([source]);
  const result=retainVersion(draft,'Before receiving native planning edition',now);
  result.planSources??=[];
  const retained=result.planSources.find(x=>x.sha256===source.sha256);
  if(retained){
    need(retained.base64===source.base64&&JSON.stringify(retained.document)===JSON.stringify(source.document),
      'Retain the original complete planning edition.');
  }else result.planSources.push(clone(source));
  result.planningReview=newPlanReview(retained||source);
  return validateDraft(result);
}
