/**
 * Offline workbook decisions over the original supplier review engine.
 * The workbook carries original source/history; only decideMany owns decisions.
 */
import {
  ReportError, canonicalJSON, sha256, serializeWorkspace, reopenWorkspace,
  decideMany, finalize, exportCSV, exportHTML, exportSQL
} from './supplier-report.mjs';

export const WORKBOOK_SCHEMA = 'conapi.supplier-review-workbook.v1';
export const RETURN_SCHEMA = 'conapi.supplier-review-workbook-return.v1';
export const PREVIEW_SCHEMA = 'conapi.supplier-review-workbook-preview.v1';
export const OPERATION_SCHEMA = 'conapi.supplier-review-workbook-operation.v1';
export const DELIVERY_SCHEMA = 'conapi.supplier-review-workbook-delivery.v1';
const MAX_XLSX = 64 * 1024 * 1024, MAX_JSON = 96 * 1024 * 1024;
const PART = 24000, MAX_ROWS = 1048576;
const ACTIONS = new Set(['use_candidate','keep_baseline','exclude','replace','choose_source']);
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const check = (condition,code,message,details={}) => {
  if (!condition) throw new ReportError(code,message,details);
};
const clone = value => JSON.parse(canonicalJSON(value));
const equal = (a,b) => canonicalJSON(a) === canonicalJSON(b);
const utf8 = value => new TextEncoder().encode(value);
const digest = value => sha256(canonicalJSON(value));
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function text(value,label,{empty=false,maximum=32767,controls=true}={}) {
  check(typeof value === 'string' && (empty || value.trim()) && value.length <= maximum,
    'WORKBOOK_TEXT_INVALID',label+' must be text within '+maximum+' characters.');
  sha256(value);
  if (!controls) check(!/[\u0000-\u001f\u007f]/.test(value),
    'WORKBOOK_TEXT_INVALID',label+' cannot contain control characters.');
  return value;
}
function integerText(value,label) {
  check(typeof value === 'string' && /^[1-9][0-9]*$/.test(value),
    'WORKBOOK_VALUE_INVALID',label+' must be a positive integer written as text.');
  const n=Number(value);
  check(Number.isSafeInteger(n),'WORKBOOK_VALUE_INVALID',label+' exceeds the supported original integer range.');
  return n;
}
function reportOf(value) {
  return reopenWorkspace(typeof value === 'string' ? value : serializeWorkspace(value));
}
function descriptor(report) {
  return {requestId:report.requestId,comparisonId:report.comparisonId,
    baselineEditionId:report.baseline.id,candidateEditionId:report.candidate.id,
    baselineDigest:report.baseline.digest,candidateDigest:report.candidate.digest,
    rulesSha256:digest(report.rules)};
}
function decisionInput(decision) {
  if (!decision) return null;
  const out={itemId:decision.itemId,action:decision.action,reason:decision.reason};
  if (decision.action==='replace') out.values=clone(decision.values);
  if (decision.action==='choose_source') {out.side=decision.side;out.rowNumber=decision.rowNumber;}
  return out;
}
function selectedValues(item,decision) {
  if (decision?.action==='replace') return decision.values;
  if (decision && decision.action!=='exclude') {
    const side=decision.action==='use_candidate'?'candidate':decision.action==='keep_baseline'?'baseline':decision.side;
    const row=decision.action==='choose_source' ? item[side].find(v=>v.rowNumber===decision.rowNumber) : item[side][0];
    if (row) return row.values;
  }
  // An exception with several rows remains visibly unselected. The first
  // canonical row is an editable starting value, never an automatic decision.
  return item.candidate[0]?.values || item.baseline[0]?.values || {};
}
function cellEncoding(value) {
  const plain=typeof value==='string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\r]/.test(value)
    && (value.match(/\n/g)||[]).length<=200;
  return plain ? {encoding:'text',text:value} : {encoding:'json',text:canonicalJSON(value)};
}
function parts(value) {
  // Split by Unicode code points so a supplementary character is never torn.
  const result=[];let current='';
  for (const char of value) {
    if (current.length+char.length>PART) {result.push(current);current='';}
    current+=char;
  }
  result.push(current);
  return result;
}
function summary(value) {
  const encoded=canonicalJSON(value);
  if (encoded.length<=30000) return encoded;
  const initial=encoded.slice(0,29800).replace(/[\ud800-\udbff]$/,'');
  return initial+'\n[Summary shortened. Complete values are in Source values and the retained workspace.]';
}
function itemRows(report) {
  const items=[],replacementRows=[],sourceRows=[];
  for (const item of report.items) {
    const saved=report.decisions[item.id] || null;
    items.push({id:item.id,key:summary(item.key),change:item.kind,
      baseline:summary(item.baseline.map(row=>({rowNumber:row.rowNumber,values:row.values,issues:row.issues}))),
      candidate:summary(item.candidate.map(row=>({rowNumber:row.rowNumber,values:row.values,issues:row.issues}))),
      savedDecision:saved ? summary({action:saved.action,reviewer:saved.reviewer,reason:saved.reason,revision:saved.revision}) : ''});
    const values=selectedValues(item,saved);
    for (const field of report.rules.fields) {
      const value=own(values,field.name)?values[field.name]:null;
      const encoded=value===null ? {encoding:'text',text:''} : cellEncoding(value);
      parts(encoded.text).forEach((value,index)=>replacementRows.push({
        itemId:item.id,field:field.name,part:index+1,kind:own(values,field.name)&&values[field.name]!==null?'text':'null',
        encoding:encoded.encoding,text:value
      }));
    }
    for (const side of ['baseline','candidate']) for (const row of item[side]) {
      const values=[...report.rules.fields.map(field=>['Canonical: '+field.name,row.values[field.name]]),
        ...Object.entries(row.raw).map(([name,value])=>['Original: '+name,value])];
      for (const [field,value] of values) {
        const encoded=cellEncoding(value);
        parts(encoded.text).forEach((value,index)=>sourceRows.push({
          itemId:item.id,side,rowNumber:row.rowNumber,field,part:index+1,encoding:encoded.encoding,text:value
        }));
      }
    }
  }
  return {items,replacementRows,sourceRows};
}
export function createReviewWorkbookModel(value) {
  const report=reportOf(value),workspace=serializeWorkspace(report),workspaceSha256=sha256(workspace);
  const workbookId='workbook_'+digest({schema:WORKBOOK_SCHEMA,workspaceSha256});
  const rows=itemRows(report);
  check(rows.items.length+10<=MAX_ROWS && rows.replacementRows.length+1<=MAX_ROWS && rows.sourceRows.length+1<=MAX_ROWS,
    'WORKBOOK_SIZE','This complete review exceeds the Excel worksheet row limit.');
  const basis={schema:WORKBOOK_SCHEMA,workbookId,...descriptor(report),revision:report.revision,
    workspaceSha256,workspace,fields:clone(report.rules.fields),...rows,
    sourceDescription:'Baseline '+report.baseline.sourceId+' / '+report.baseline.id+
      '; incoming '+report.candidate.sourceId+' / '+report.candidate.id+
      '. Exact source metadata, raw rows, rules and complete decision history are in Basis.'};
  const basisText=canonicalJSON(basis);
  check(utf8(basisText).length<=MAX_JSON,'WORKBOOK_SIZE','The complete original workbook basis exceeds 96 MiB.');
  return freeze({...basis,basisText,basisSha256:sha256(basisText)});
}
function uniqueRows(rows,key,label) {
  check(Array.isArray(rows),'WORKBOOK_RETURN_INVALID',label+' must be complete rows.');
  const index=new Map();
  for (const row of rows) {
    check(object(row),'WORKBOOK_RETURN_INVALID',label+' contains a non-object row.');
    const id=key(row);
    check(!index.has(id),'WORKBOOK_ROWS_CHANGED',label+' contains a repeated original identity.',{identity:id});
    index.set(id,row);
  }
  return index;
}
function exactSet(actual,expected,key,label) {
  const left=uniqueRows(actual,key,label),right=uniqueRows(expected,key,label);
  check(left.size===right.size,'WORKBOOK_ROWS_CHANGED',label+' must retain every original row.');
  for (const [id,row] of right) check(left.has(id) && equal(left.get(id),row),
    'WORKBOOK_ROWS_CHANGED',label+' changed an original identity or value.',{identity:id});
}
function parsedBasis(input) {
  check(object(input) && input.schema===RETURN_SCHEMA,'WORKBOOK_RETURN_INVALID','Open an original supplier review XLSX return.');
  text(input.basisText,'Workbook basis',{maximum:MAX_JSON});
  check(sha256(input.basisText)===input.basisSha256,'WORKBOOK_BASIS_CHANGED','The complete original workbook basis hash differs.');
  let basis;
  try {basis=JSON.parse(input.basisText);} catch {throw new ReportError('WORKBOOK_BASIS_CHANGED','The workbook basis is not valid JSON.');}
  check(object(basis) && basis.schema===WORKBOOK_SCHEMA,'WORKBOOK_BASIS_CHANGED','Unsupported original workbook basis.');
  const original=reportOf(basis.workspace),expected=createReviewWorkbookModel(original);
  check(input.workbookId===expected.workbookId && input.basisText===expected.basisText &&
    input.basisSha256===expected.basisSha256,'WORKBOOK_BASIS_CHANGED',
    'The workbook basis differs from its reconstructed original sources, rules, decisions or rows.');
  check(object(input.file) && Number.isSafeInteger(input.file.bytes) && input.file.bytes>0 && input.file.bytes<=MAX_XLSX &&
    typeof input.file.sha256==='string' && /^[a-f0-9]{64}$/.test(input.file.sha256),
    'WORKBOOK_FILE_INVALID','The original returned XLSX file identity is missing.');
  return {original,expected};
}
function correctionValues(rows,model) {
  const ids=new Set(model.items.map(row=>row.id)),fields=new Set(model.fields.map(row=>row.name)),groups=new Map();
  check(Array.isArray(rows),'WORKBOOK_RETURN_INVALID','Keep the complete Corrections sheet.');
  for (const row of rows) {
    check(object(row) && ids.has(row.itemId) && fields.has(row.field),
      'WORKBOOK_ROWS_CHANGED','Corrections contains an unknown original item or canonical field.');
    const part=integerText(row.partText,'Correction part');
    check(part<=MAX_ROWS && ['text','null'].includes(row.kind) && ['text','json'].includes(row.encoding),
      'WORKBOOK_VALUE_INVALID','Use original text/null value kinds and text/json encoding.');
    text(row.text,'Correction value',{empty:true,maximum:PART});
    const key=canonicalJSON([row.itemId,row.field]);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push({...row,part});
  }
  const result=new Map();
  for (const item of model.items) {
    const values={};
    for (const field of model.fields) {
      const key=canonicalJSON([item.id,field.name]),group=groups.get(key);
      check(group?.length,'WORKBOOK_ROWS_CHANGED','Keep every canonical Corrections field.',{itemId:item.id,field:field.name});
      group.sort((a,b)=>a.part-b.part);
      const first=group[0];
      check(group.every((row,index)=>row.part===index+1 && row.kind===first.kind && row.encoding===first.encoding),
        'WORKBOOK_VALUE_INVALID','Value parts must be contiguous with the same kind and encoding.',{itemId:item.id,field:field.name});
      const joined=group.map(row=>row.text).join('');
      if (first.kind==='null') {
        check(first.encoding==='text' && joined==='','WORKBOOK_VALUE_INVALID','Explicit null uses text encoding and an empty value.');
        Object.defineProperty(values,field.name,{value:null,enumerable:true});
      } else if (first.encoding==='text') Object.defineProperty(values,field.name,{value:joined,enumerable:true});
      else {
        let decoded;
        try {decoded=JSON.parse(joined);} catch {throw new ReportError('WORKBOOK_VALUE_INVALID','The complete encoded correction is not JSON.',{itemId:item.id,field:field.name});}
        check(typeof decoded==='string','WORKBOOK_VALUE_INVALID','A canonical text correction encoded as JSON must decode to a string.');
        sha256(decoded);
        Object.defineProperty(values,field.name,{value:decoded,enumerable:true});
      }
    }
    result.set(item.id,values);
  }
  return result;
}
function originalCorrectionValues(model) {
  return correctionValues(model.replacementRows.map(row=>({...row,partText:String(row.part)})),model);
}
function returnedDecisions(input,model,original) {
  const review=uniqueRows(input.rows,row=>text(row.itemId,'Review item ID',{maximum:4096,controls:false}),'Review');
  check(review.size===model.items.length,'WORKBOOK_ROWS_CHANGED','Keep every original Review item.');
  const sources=model.sourceRows.map(row=>({
    itemId:row.itemId,side:row.side,rowNumberText:String(row.rowNumber),field:row.field,
    partText:String(row.part),encoding:row.encoding,text:row.text
  }));
  exactSet(input.sourceRows,sources,row=>canonicalJSON([row.itemId,row.side,row.rowNumberText,row.field,row.partText]),'Source values');
  const replacements=correctionValues(input.replacementRows,model),initial=originalCorrectionValues(model),decisions=[];
  for (const item of model.items) {
    const row=review.get(item.id);
    check(row,'WORKBOOK_ROWS_CHANGED','An original Review item is missing.',{itemId:item.id});
    for (const key of ['key','change','baseline','candidate','savedDecision'])
      check(row[key]===item[key],'WORKBOOK_ROWS_CHANGED','Review changed an original source or decision summary.',{itemId:item.id,field:key});
    for (const key of ['action','reason','side','rowNumberText']) text(row[key],key,{empty:true});
    const action=row.action;
    if (!action) {
      check(!row.reason && !row.side && !row.rowNumberText && equal(replacements.get(item.id),initial.get(item.id)),
        'WORKBOOK_UNUSED_INPUT','This item contains return edits without a Decision. Choose a decision or restore those cells.',{itemId:item.id});
      continue;
    }
    check(ACTIONS.has(action),'WORKBOOK_DECISION_INVALID','Choose one of the five original decision actions.',{itemId:item.id});
    text(row.reason,'Decision reason');
    const decision={itemId:item.id,action,reason:row.reason};
    if (action==='replace') decision.values=replacements.get(item.id);
    else check(equal(replacements.get(item.id),initial.get(item.id)),
      'WORKBOOK_UNUSED_INPUT','Correction cells changed on an item whose Decision is not replace.',{itemId:item.id});
    if (action==='choose_source') {
      check(row.side==='baseline' || row.side==='candidate','WORKBOOK_DECISION_INVALID','Choose baseline or candidate for the original source row.');
      decision.side=row.side;decision.rowNumber=integerText(row.rowNumberText,'Original source row');
    } else check(!row.side && !row.rowNumberText,'WORKBOOK_UNUSED_INPUT','Only choose_source accepts Source side and Source row.',{itemId:item.id});
    decisions.push(decision);
  }
  const reviewer=text(input.reviewer,'Reviewer',{maximum:4096,controls:false});
  text(input.note,'Return note',{empty:true});
  // The original engine validates canonical types, keys and chosen source rows.
  if (decisions.length) decideMany(original,decisions,{reviewer,expectedRevision:original.revision,at:original.candidate.capturedAt});
  return {decisions,reviewer,note:input.note};
}
function historyContains(current,prior) {
  return equal(descriptor(current),descriptor(prior)) && current.revision>=prior.revision &&
    equal(current.history.slice(0,prior.history.length),prior.history);
}
function planBody(input) {const {planSha256,...body}=input;return body;}

export function reviewWorkbookReturn(value,input,{resolutions={},reviewedAt=new Date().toISOString()}={}) {
  const current=reportOf(value),{original,expected}=parsedBasis(input);
  check(historyContains(current,original),'WORKBOOK_SOURCE_CHANGED',
    'Select this workbook’s original comparison and a workspace retaining its exported history. A different rules/source edition needs its own workbook.',
    {workbookComparisonId:original.comparisonId,currentComparisonId:current.comparisonId,workbookRevision:original.revision,currentRevision:current.revision});
  check(object(resolutions),'WORKBOOK_RESOLUTION_INVALID','Conflict choices must be keyed by the original item ID.');
  text(reviewedAt,'Review time',{maximum:64,controls:false});
  check(Number.isFinite(Date.parse(reviewedAt)) && /^\d{4}-\d\d-\d\dT/.test(reviewedAt),
    'WORKBOOK_REVIEW_INVALID','The review time must be an ISO timestamp.');
  const returned=returnedDecisions(input,expected,original),decisions=[],rows=[],conflicts=[];
  const items=new Map(current.items.map(item=>[item.id,item]));
  for (const decision of returned.decisions) {
    const baseline=original.decisions[decision.itemId] || null,currentDecision=current.decisions[decision.itemId] || null;
    const concurrent=!equal(baseline,currentDecision),already=equal(decisionInput(currentDecision),decision);
    const row={itemId:decision.itemId,key:clone(items.get(decision.itemId).key),change:items.get(decision.itemId).kind,
      baseDecision:baseline,currentDecision,returnedDecision:decision,action:decision.action,
      status:already?'already_current':concurrent?'conflict':'ready'};
    if (row.status==='conflict') {
      const resolution=resolutions[decision.itemId];
      check(resolution===undefined || resolution==='keep_current' || resolution==='use_returned',
        'WORKBOOK_RESOLUTION_INVALID','Resolve a changed item with keep_current or use_returned.');
      row.resolution=resolution || null;
      if (resolution==='use_returned') decisions.push(decision);
      conflicts.push(row);
    } else if (!already) decisions.push(decision);
    rows.push(row);
  }
  const conflictIds=new Set(conflicts.map(row=>row.itemId));
  for (const key of Object.keys(resolutions)) check(conflictIds.has(key),
    'WORKBOOK_RESOLUTION_INVALID','A conflict choice no longer belongs to this exact preview.',{itemId:key});
  const unresolved=conflicts.filter(row=>!row.resolution).length;
  const projected=decisions.length ? decideMany(current,decisions,{
    reviewer:returned.reviewer,expectedRevision:current.revision,at:reviewedAt
  }) : current;
  const body={schema:PREVIEW_SCHEMA,workbookId:expected.workbookId,...descriptor(current),
    sourceRevision:original.revision,currentRevision:current.revision,currentWorkspaceSha256:sha256(serializeWorkspace(current)),
    basisSha256:expected.basisSha256,inputSha256:digest(input),returnedFile:clone(input.file),
    reviewer:returned.reviewer,note:returned.note,reviewedAt,resolutions:clone(resolutions),
    rows,decisions:clone(decisions),conflicts:conflicts.length,unresolved,
    summary:{returned:returned.decisions.length,apply:decisions.length,alreadyCurrent:rows.filter(row=>row.status==='already_current').length,
      keptCurrent:conflicts.filter(row=>row.resolution==='keep_current').length,
      untouched:current.items.length-returned.decisions.length,projected:clone(projected.summary)},
    canApply:unresolved===0,canFinalize:unresolved===0 && projected.status==='reviewed'};
  return freeze({...body,planSha256:digest(body)});
}
function operationRequest(operationId,preview,finalizeOutput) {
  return {schema:OPERATION_SCHEMA,operationId,workbookId:preview.workbookId,
    comparisonId:preview.comparisonId,currentWorkspaceSha256:preview.currentWorkspaceSha256,
    inputSha256:preview.inputSha256,planSha256:preview.planSha256,
    reviewer:preview.reviewer,at:preview.reviewedAt,finalizeOutput};
}
export function applyWorkbookReturn(value,input,preview,{operationId,finalizeOutput=false}={}) {
  const before=reportOf(value);
  text(operationId,'Workbook operation ID',{maximum:200,controls:false});
  check(typeof finalizeOutput==='boolean','WORKBOOK_OPERATION_INVALID','Finalization must be an explicit boolean.');
  check(object(preview) && preview.schema===PREVIEW_SCHEMA && digest(planBody(preview))===preview.planSha256,
    'WORKBOOK_REVIEW_CHANGED','Select the complete original reviewed return.');
  const fresh=reviewWorkbookReturn(before,input,{resolutions:preview.resolutions,reviewedAt:preview.reviewedAt});
  check(fresh.planSha256===preview.planSha256,'WORKBOOK_REVIEW_CHANGED',
    'The current workspace or returned selection changed after review. Review the complete return again.');
  check(fresh.canApply,'WORKBOOK_CONFLICTS_PENDING','Resolve the changed decisions before applying this return.');
  const after=fresh.decisions.length?decideMany(before,fresh.decisions,{
    reviewer:fresh.reviewer,expectedRevision:before.revision,at:fresh.reviewedAt
  }):before;
  const finalized=finalizeOutput?finalize(after):null;
  const beforeWorkspace=serializeWorkspace(before),afterWorkspace=serializeWorkspace(after);
  const request=operationRequest(operationId,fresh,finalizeOutput),requestSha256=digest(request);
  return freeze({schema:OPERATION_SCHEMA,operationId,request,requestSha256,
    input:clone(input),preview:fresh,beforeWorkspace,afterWorkspace,
    beforeSha256:sha256(beforeWorkspace),afterSha256:sha256(afterWorkspace),
    receipt:{schema:OPERATION_SCHEMA,status:'APPLIED',operationId,requestSha256,
      workbookId:fresh.workbookId,comparisonId:after.comparisonId,requestId:after.requestId,
      sourceRevision:fresh.sourceRevision,beforeRevision:before.revision,afterRevision:after.revision,
      appliedItems:fresh.decisions.map(row=>row.itemId),reviewer:fresh.reviewer,at:fresh.reviewedAt,
      returnedFile:clone(input.file),afterSha256:sha256(afterWorkspace),
      finalized:finalized!==null,resultDigest:finalized?.resultDigest || null,
      summary:clone(after.summary)}});
}
export function verifyWorkbookOperation(operation) {
  check(object(operation) && operation.schema===OPERATION_SCHEMA && object(operation.request),
    'WORKBOOK_OPERATION_INVALID','Select a complete retained workbook operation.');
  const rebuilt=applyWorkbookReturn(operation.beforeWorkspace,operation.input,operation.preview,{
    operationId:operation.operationId,finalizeOutput:operation.request.finalizeOutput
  });
  check(equal(rebuilt,operation),'WORKBOOK_OPERATION_CHANGED',
    'The retained workbook request, decision history or result differs from its original replay.');
  return rebuilt;
}
export function recoverWorkbookReturn(value,operation) {
  const current=reportOf(value),verified=verifyWorkbookOperation(operation),before=reportOf(verified.beforeWorkspace),after=reportOf(verified.afterWorkspace);
  if (historyContains(current,after)) return {status:'ALREADY_APPLIED',report:current,operation:verified};
  check(sha256(serializeWorkspace(current))===verified.beforeSha256 && historyContains(current,before),
    'WORKBOOK_RECOVERY_CONFLICT',
    'The saved workspace changed before this prepared return was adopted. Keep this operation and review its original return against the current workspace.');
  return {status:'RECOVERED',report:after,operation:verified};
}
export function workbookBytes(value) {
  check(typeof value==='string' && value.length<=Math.ceil(MAX_XLSX/3)*4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
    'WORKBOOK_FILE_INVALID','The complete XLSX must use canonical base64 within 64 MiB.');
  let raw;
  try {raw=atob(value);} catch {throw new ReportError('WORKBOOK_FILE_INVALID','The complete XLSX base64 is invalid.');}
  const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
  check(bytes.length>0 && bytes.length<=MAX_XLSX && btoa(raw)===value,'WORKBOOK_FILE_INVALID','The complete XLSX base64 is not canonical.');
  return bytes;
}
export function workbookBase64(value) {
  check(value instanceof Uint8Array && value.byteLength>0 && value.byteLength<=MAX_XLSX,
    'WORKBOOK_FILE_INVALID','Choose a nonempty XLSX within 64 MiB.');
  let binary='';
  for (let offset=0;offset<value.length;offset+=16384) binary+=String.fromCharCode(...value.subarray(offset,offset+16384));
  return btoa(binary);
}
export async function workbookFileIdentity(bytes) {
  check(bytes instanceof Uint8Array && bytes.byteLength>0 && bytes.byteLength<=MAX_XLSX,
    'WORKBOOK_FILE_INVALID','Choose a nonempty XLSX within 64 MiB.');
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return {bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')};
}
function textMember(name,content,contentType='application/json;charset=utf-8') {
  return {name,contentType,encoding:'utf-8',bytes:utf8(content).length,sha256:sha256(content),content};
}
async function deliveryFiles(operation,contentBase64) {
  const verified=verifyWorkbookOperation(operation),bytes=workbookBytes(contentBase64),identity=await workbookFileIdentity(bytes);
  check(equal(identity,verified.input.file),'WORKBOOK_FILE_CHANGED','The retained return file differs from the reviewed original XLSX.');
  const report=reportOf(verified.afterWorkspace);
  const files=[
    {name:'returned.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',encoding:'base64',...identity,content:contentBase64},
    textMember('return.json',canonicalJSON(verified.input)+'\n'),
    textMember('review.json',canonicalJSON(verified.preview)+'\n'),
    textMember('operation.json',canonicalJSON(verified)+'\n'),
    textMember('before.workspace.json',verified.beforeWorkspace),
    textMember('workspace.json',verified.afterWorkspace),
    textMember('changes.csv',exportCSV(report),'text/csv;charset=utf-8'),
    textMember('report.html',exportHTML(report),'text/html;charset=utf-8')
  ];
  if (report.status==='reviewed') {
    const accepted=finalize(report);
    files.push(textMember('accepted.csv',exportCSV(report,{kind:'accepted'}),'text/csv;charset=utf-8'));
    files.push(textMember('accepted.snapshot.sql',exportSQL(report),'application/sql;charset=utf-8'));
    files.push(textMember('lineage.json',canonicalJSON(accepted)+'\n'));
  }
  return files;
}
export async function createWorkbookDelivery(operation,contentBase64) {
  const files=await deliveryFiles(operation,contentBase64);
  const manifest={schema:DELIVERY_SCHEMA,operationId:operation.operationId,requestSha256:operation.requestSha256,
    comparisonId:operation.receipt.comparisonId,requestId:operation.receipt.requestId,
    beforeSha256:operation.beforeSha256,afterSha256:operation.afterSha256,
    files:files.map(({content,...file})=>file)};
  return freeze({schema:DELIVERY_SCHEMA,manifest,manifestSha256:digest(manifest),files});
}
export async function receiveWorkbookDelivery(packet,{readWorkbook}={}) {
  check(typeof readWorkbook==='function','WORKBOOK_READER_REQUIRED',
    'Receive the retained XLSX through the original workbook parser before adopting its decisions.');
  check(object(packet) && packet.schema===DELIVERY_SCHEMA && object(packet.manifest) &&
    packet.manifest.schema===DELIVERY_SCHEMA && Array.isArray(packet.files),
    'WORKBOOK_DELIVERY_INVALID','Open the complete original workbook delivery packet.');
  check(digest(packet.manifest)===packet.manifestSha256,'WORKBOOK_DELIVERY_CHANGED','The receiving manifest differs from its complete contents.');
  const files=uniqueRows(packet.files,row=>row.name,'Delivery');
  check(files.has('operation.json') && files.has('returned.xlsx'),'WORKBOOK_DELIVERY_INVALID','Keep the complete original operation and returned workbook.');
  let operation;
  try {operation=JSON.parse(files.get('operation.json').content);} catch {throw new ReportError('WORKBOOK_DELIVERY_INVALID','The original operation JSON is invalid.');}
  const expected=await createWorkbookDelivery(operation,files.get('returned.xlsx').content);
  check(equal(packet.manifest,expected.manifest) && packet.manifestSha256===expected.manifestSha256,
    'WORKBOOK_DELIVERY_CHANGED','The source/history/export manifest differs from the original receiving operation.');
  exactSet(packet.files,expected.files,row=>row.name,'Delivery');
  const parsed=await readWorkbook(files.get('returned.xlsx').content);
  check(equal(parsed,operation.input),'WORKBOOK_RETURN_XLSX_CHANGED',
    'The actual returned XLSX cells differ from the retained review input. Receive its original complete workbook and operation.');
  return {report:reportOf(operation.afterWorkspace),operation:verifyWorkbookOperation(operation),
    contentBase64:files.get('returned.xlsx').content,manifest:clone(packet.manifest)};
}
