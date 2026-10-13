// MIT. Issuer-form worksheets over the original submission draft and history.
import {validateDraft,exportFormMap,importFormMap,newField,fieldStatus,ANSWERS} from './grant-submission-core.mjs';
import {parseTable,decodeSource} from './source-delimited.mjs';
export {decodeSource};
export const FORM_WORKBOOK_SCHEMA='stellar-forge.grant-form-workbook.v1';
export const FORM_WORKBOOK_REVIEW_SCHEMA='stellar-forge.grant-form-workbook-review.v1';
export const MAX_FORM_WORKBOOK_BYTES=64*1024*1024;
export const FORM_PROFILE_COLUMNS=Object.freeze(['name','url','observed_at','notes']);
export const FORM_FIELD_COLUMNS=Object.freeze(['action','id','position','label','prompt','text','answer_ids','word_limit','character_limit','character_method','source_url','observed_at']);
const properties=Object.freeze({label:'label',prompt:'prompt',text:'text',answer_ids:'answerIds',word_limit:'wordLimit',character_limit:'characterLimit',character_method:'characterMethod',source_url:'sourceUrl',observed_at:'observedAt'});
const formProperties=Object.freeze({name:'name',url:'url',observed_at:'observedAt',notes:'notes'});
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const need=(value,message,code='FORM_WORKBOOK_INVALID')=>{if(!value)throw Object.assign(new Error(message),{code});};
const size=text=>new TextEncoder().encode(text).length;
async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:canonical(value)))),v=>v.toString(16).padStart(2,'0')).join('');}
function delimiter(value){need(value===','||value==='\t','Select comma CSV or tab TSV.');return value;}
function text(value,label,max=16*1024*1024){need(typeof value==='string'&&size(value)<=max&&!value.includes('\u0000'),label+' must be complete UTF-8 text within its supported size.');need(!value.isWellFormed||value.isWellFormed(),label+' contains an unpaired Unicode surrogate.');return value;}
function mapFor(draft,map){need(map?.schema==='stellar-forge.grant-form-map.v1','Retain the complete original form map.');const check=clone(draft);check.form=clone(map.form);check.fields=clone(map.fields);validateDraft(check);return clone(map);}
// Prefix leading spreadsheet formula markers, tabs, CR and apostrophes reversibly.
// The workbook declares this encoding; quoted multiline source remains exact.
const dangerous=value=>/^[=+\-@\t\r']/.test(value);
const encodeCell=value=>{const s=String(value);return dangerous(s)?"'"+s:s;};
const decodeCell=value=>value.startsWith("'")&&dangerous(value.slice(1))?value.slice(1):value;
const quote=value=>'"'+encodeCell(value).replace(/"/g,'""')+'"';
function table(columns,rows,separator){return [columns,...rows].map(row=>row.map(quote).join(separator)).join('\r\n')+'\r\n';}
function cellValue(field,key){const value=field[properties[key]];if(key==='answer_ids')return JSON.stringify(value);if(value===null)return'';return value;}
export function formWorkbookSheets(map,{delimiter:separator=','}={}){
  delimiter(separator);need(map?.schema==='stellar-forge.grant-form-map.v1','Select an original form map.');
  return{delimiter:separator,cellEncoding:'apostrophe-v1',
    profile:table(FORM_PROFILE_COLUMNS,[FORM_PROFILE_COLUMNS.map(k=>map.form[formProperties[k]])],separator),
    fields:table(FORM_FIELD_COLUMNS,map.fields.map((field,index)=>FORM_FIELD_COLUMNS.map(key=>key==='action'?'upsert':key==='id'?field.id:key==='position'?index+1:cellValue(field,key))),separator)};
}
/** Convert both complete editable sheets without changing their cell values. */
export function convertFormWorkbookSheets(sheets,targetDelimiter){
  delimiter(targetDelimiter);need(sheets?.cellEncoding==='apostrophe-v1','Retain the workbook cell encoding.');
  const profileRows=readTable(sheets.profile,FORM_PROFILE_COLUMNS,sheets.delimiter,'Profile worksheet');
  const fieldRows=readTable(sheets.fields,FORM_FIELD_COLUMNS,sheets.delimiter,'Fields worksheet');
  return{delimiter:targetDelimiter,cellEncoding:'apostrophe-v1',
    profile:table(FORM_PROFILE_COLUMNS,profileRows.map(row=>FORM_PROFILE_COLUMNS.map(key=>row[key])),targetDelimiter),
    fields:table(FORM_FIELD_COLUMNS,fieldRows.map(row=>FORM_FIELD_COLUMNS.map(key=>row[key])),targetDelimiter)};
}
export async function createFormWorkbook(draft,{delimiter:separator=',',createdAt=new Date().toISOString()}={}){
  validateDraft(draft);need(Number.isFinite(Date.parse(createdAt)),'Use a valid workbook export date.');
  const baseline={schema:'stellar-forge.grant-form-workbook-baseline.v1',draftId:draft.id,draftCreatedAt:draft.createdAt,title:draft.title,
    currentSource:draft.currentSource,formMap:exportFormMap(draft),
    answers:draft.answers.map(answer=>({id:answer.id,title:ANSWERS.find(row=>row[0]===answer.id)?.[1]||answer.id,text:answer.text,sourceSha:answer.sourceSha}))};
  const workbook={schema:FORM_WORKBOOK_SCHEMA,createdAt,baselineSha256:await hash(baseline),baseline,sheets:formWorkbookSheets(baseline.formMap,{delimiter:separator})};
  text(JSON.stringify(workbook),'Complete form workbook',MAX_FORM_WORKBOOK_BYTES);return workbook;
}
export async function openFormWorkbook(input,draft){
  validateDraft(draft);let workbook=input;
  if(typeof input==='string'){text(input,'Complete form workbook',MAX_FORM_WORKBOOK_BYTES);try{workbook=JSON.parse(input.replace(/^\uFEFF/,''));}catch{need(false,'Open the complete form-workbook.json baseline.');}}
  need(object(workbook)&&workbook.schema===FORM_WORKBOOK_SCHEMA&&object(workbook.baseline)&&object(workbook.sheets),'Open a complete issuer-form workbook.');
  const b=workbook.baseline;
  need(b.schema==='stellar-forge.grant-form-workbook-baseline.v1'&&b.draftId===draft.id&&b.draftCreatedAt===draft.createdAt,'This workbook belongs to a different original draft. Reopen its original draft before receiving the sheets.','FORM_WORKBOOK_DRAFT');
  need(/^[a-f0-9]{64}$/.test(workbook.baselineSha256)&&await hash(b)===workbook.baselineSha256,'The original workbook baseline changed. Use its complete exported JSON.','FORM_WORKBOOK_BASELINE');
  mapFor(draft,b.formMap);need(Array.isArray(b.answers)&&same(b.answers.map(x=>x.id),ANSWERS.map(x=>x[0])),'Retain all nine original answer references.');
  for(const answer of b.answers){text(answer.text,'Reference answer');text(answer.title,'Reference title');need(/^[a-f0-9]{64}$/.test(answer.sourceSha),'Retain the original answer source identity.');}
  need(workbook.sheets.cellEncoding==='apostrophe-v1','Retain the workbook cell encoding.');delimiter(workbook.sheets.delimiter);
  text(workbook.sheets.profile,'Profile worksheet');text(workbook.sheets.fields,'Fields worksheet');
  text(JSON.stringify(workbook),'Complete form workbook',MAX_FORM_WORKBOOK_BYTES);return clone(workbook);
}
function readTable(source,columns,separator,label){
  text(source,label);const parsed=parseTable(source,{delimiter:delimiter(separator),header:true,skipEmptyRecords:false});
  const headings=parsed.headings.map(decodeCell);
  need(headings.length===columns.length&&new Set(headings).size===columns.length&&columns.every(k=>headings.includes(k)),label+' must retain each original column exactly once. Columns may be reordered.');
  return parsed.rows.map(row=>Object.fromEntries(headings.map((key,index)=>[key,decodeCell(row.cells[index])])));
}
function integer(value,label,{empty=true}={}){if(empty&&value==='')return null;need(/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value)),label+' must be a positive whole number or an empty unknown limit.');return Number(value);}
function incomingMap(draft,workbook,{profile=workbook.sheets.profile,fields=workbook.sheets.fields,delimiter:separator=workbook.sheets.delimiter}={}){
  const original=workbook.baseline.formMap,map=clone(original),profiles=readTable(profile,FORM_PROFILE_COLUMNS,separator,'Profile worksheet');
  need(profiles.length===1,'The profile worksheet needs exactly one complete form row.');
  for(const [key,property]of Object.entries(formProperties))map.form[property]=profiles[0][key];
  const rows=readTable(fields,FORM_FIELD_COLUMNS,separator,'Fields worksheet'),seen=new Set(),positions=new Map(original.fields.map((field,index)=>[field.id,index+1])),selected=new Map(original.fields.map(field=>[field.id,clone(field)]));
  for(const row of rows){
    need(row.id.length>0&&!seen.has(row.id),'Each worksheet row needs a unique nonempty field ID.');seen.add(row.id);
    need(row.action==='upsert'||row.action==='remove','Use upsert to add/edit a field or remove to delete it explicitly.');
    if(row.action==='remove'){need(selected.has(row.id),'Only an original baseline field can be removed by this workbook.');selected.delete(row.id);positions.delete(row.id);continue;}
    const field=selected.get(row.id)||newField(row.id);
    for(const [key,property]of Object.entries(properties)){
      if(key==='answer_ids'){try{field[property]=JSON.parse(row[key]);}catch{need(false,'answer_ids must be a JSON array of original answer IDs.');}}
      else if(key==='word_limit'||key==='character_limit')field[property]=integer(row[key],key);
      else field[property]=row[key];
    }
    const position=integer(row.position,'Field position',{empty:false});need(position>0,'Field positions start at 1.');
    positions.set(row.id,position);selected.set(row.id,field);
  }
  need(new Set(positions.values()).size===positions.size,'Each retained field needs a distinct position. An omitted row keeps its original position.');
  map.fields=[...selected.values()].sort((a,b)=>positions.get(a.id)-positions.get(b.id));
  mapFor(draft,map);return{map,profile,fields,delimiter:separator};
}
function differences(draft,baseline,incoming){
  const current=exportFormMap(draft),changes=[];
  function add(key,label,before,local,returned,extra={}){
    if(same(before,returned))return;
    const status=same(local,returned)?'already-current':same(local,before)?'incoming':'conflict';
    changes.push({key,label,before:clone(before),current:clone(local),incoming:clone(returned),status,...extra});
  }
  for(const property of Object.values(formProperties))add('form.'+property,'Form '+property,baseline.form[property],current.form[property],incoming.form[property],{kind:'form',property});
  const old=new Map(baseline.fields.map(x=>[x.id,x])),now=new Map(current.fields.map(x=>[x.id,x])),next=new Map(incoming.fields.map(x=>[x.id,x]));
  for(const id of new Set([...old.keys(),...next.keys()])){
    const before=old.get(id)||null,local=now.get(id)||null,returned=next.get(id)||null,key='field:'+encodeURIComponent(id);
    if(!before||!local||!returned){add(key+':presence',(returned||local||before)?.label||id,before,local,returned,{kind:'field',fieldId:id});continue;}
    for(const property of Object.values(properties))add(key+':'+property,(local.label||id)+' · '+property,before[property],local[property],returned[property],{kind:'property',fieldId:id,property});
  }
  add('field-order','Field order',baseline.fields.map(x=>x.id),current.fields.map(x=>x.id),incoming.fields.map(x=>x.id),{kind:'order'});
  return{current,changes};
}
function choicesFor(changes,decisions,{complete=false}={}){
  need(object(decisions),'Supply explicit workbook decisions.');const known=new Set(changes.map(x=>x.key));
  for(const [key,value]of Object.entries(decisions))need(known.has(key)&&['current','incoming'].includes(value),'Each decision must name a displayed change and choose current or incoming.');
  const unresolved=changes.filter(x=>x.status==='conflict'&&!own(decisions,x.key)).map(x=>x.key);
  need(!complete||!unresolved.length,'Choose current or returned values for every conflicting change.','FORM_WORKBOOK_CONFLICT');
  return{selected:Object.fromEntries(changes.map(x=>[x.key,decisions[x.key]||(x.status==='incoming'?'incoming':'current')])),unresolved};
}
function mergedMap(current,changes,selected){
  const map=clone(current);let order=null;
  for(const change of changes){
    if(selected[change.key]!=='incoming')continue;
    if(change.kind==='form')map.form[change.property]=clone(change.incoming);
    else if(change.kind==='field'){const index=map.fields.findIndex(x=>x.id===change.fieldId);if(change.incoming===null){if(index>=0)map.fields.splice(index,1);}else if(index>=0)map.fields[index]=clone(change.incoming);else map.fields.push(clone(change.incoming));}
    else if(change.kind==='property'){const field=map.fields.find(x=>x.id===change.fieldId);need(field,'Re-review the current field before applying its returned property.');field[change.property]=clone(change.incoming);}
    else order=change.incoming;
  }
  if(order){const byId=new Map(map.fields.map(x=>[x.id,x])),ids=[...order.filter(id=>byId.has(id)),...map.fields.map(x=>x.id).filter(id=>!order.includes(id))];map.fields=ids.map(id=>byId.get(id));}
  return map;
}
export async function reviewFormWorkbook(draft,input,returned={},decisions={}){
  const workbook=await openFormWorkbook(input,draft),received=incomingMap(draft,workbook,returned),{current,changes}=differences(draft,workbook.baseline.formMap,received.map),choice=choicesFor(changes,decisions);
  const selectedMap=mergedMap(current,changes,choice.selected);mapFor(draft,selectedMap);
  return{schema:FORM_WORKBOOK_REVIEW_SCHEMA,reviewSha256:await hash({baselineSha256:workbook.baselineSha256,draftId:draft.id,draftCreatedAt:draft.createdAt,currentMap:current,returnedMap:received.map}),
    draftId:draft.id,baselineSha256:workbook.baselineSha256,changes,decisions:choice.selected,unresolved:choice.unresolved,
    counts:{changes:changes.length,incoming:changes.filter(x=>x.status==='incoming').length,conflicts:changes.filter(x=>x.status==='conflict').length,alreadyCurrent:changes.filter(x=>x.status==='already-current').length},
    fields:selectedMap.fields.map(field=>({id:field.id,label:field.label,...fieldStatus(field,selectedMap.form,'plain')})),formMap:selectedMap};
}
export async function applyFormWorkbook(draft,input,returned={},options={}){
  const {expectedReviewSha256,decisions={}}=options,review=await reviewFormWorkbook(draft,input,returned,decisions);
  need(typeof expectedReviewSha256==='string'&&review.reviewSha256===expectedReviewSha256,'The current draft or returned sheets changed. Review this exact workbook again.','FORM_WORKBOOK_STALE');
  choicesFor(review.changes,decisions,{complete:true});
  const changed=!same(exportFormMap(draft),review.formMap);
  const updated=changed?importFormMap(draft,review.formMap):clone(validateDraft(draft));
  return{draft:updated,review,changed};
}
export function formWorkbookReferenceText(workbook){
  return workbook.baseline.answers.map(answer=>'## '+answer.title+' ['+answer.id+']\n\n'+answer.text).join('\n\n')+'\n';
}
