/** Exact comparison of two complete manufacturing source editions. No ERP writes or inferred conversions. */
import { KINDS, FIELD_DEFINITIONS, DISPOSITION_STATUSES, importWorkspace, analyze, sha256 } from './data_readiness.mjs';
export const COMPARISON_SCHEMA='manufacturing-data-comparison.v1';
export const IDENTITY_FIELDS=Object.freeze({
 items:Object.freeze(['itemId','revision']),
 bom:Object.freeze({withLineId:Object.freeze(['parentId','parentRevision','lineId']),withoutLineId:Object.freeze(['parentId','parentRevision','componentId','componentRevision'])}),
 inventory:Object.freeze(['itemId','revision','site','location','lot']),
 purchaseOrders:Object.freeze(['orderId','lineId'])
});
const QUANTITIES=Object.freeze({items:[],bom:['quantity'],inventory:['quantity'],purchaseOrders:['orderedQuantity','receivedQuantity']});
const BASIS=Object.freeze({items:[],bom:['componentId','componentRevision','unit'],inventory:['itemId','revision','unit'],purchaseOrders:['itemId','revision','unit']});
const REQUIRED_IDENTITY=Object.freeze({items:['itemId'],bom:['parentId','componentId'],inventory:['itemId','site','location'],purchaseOrders:['orderId','lineId']});
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>JSON.parse(JSON.stringify(value));
function need(ok,message){if(!ok)throw new Error(message);}
function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';return JSON.stringify(value);}
function hash(value){return sha256(stable(value));}
function plainRow(row){return {ref:copy(row.ref),values:copy(row.values)};}
function identity(kind,row){
 const values=row.values;
 const fields=kind==='bom'?(values.lineId?IDENTITY_FIELDS.bom.withLineId:IDENTITY_FIELDS.bom.withoutLineId):IDENTITY_FIELDS[kind];
 return {strategy:kind==='bom'?(values.lineId?'parent-revision-line':'parent-component-revisions'):'exact-fields',fields:[...fields],values:fields.map(field=>values[field])};
}
function keyOf(value){return stable([value.strategy,value.fields,value.values]);}
function indexRows(kind,rows){
 const groups=new Map();
 for(const row of rows){const ident=identity(kind,row),key=keyOf(ident);let group=groups.get(key);if(!group){group={identity:ident,rows:[],invalidFields:new Set()};groups.set(key,group);}group.rows.push(row);
  for(const field of REQUIRED_IDENTITY[kind])if(!row.values[field])group.invalidFields.add(field);
 }
 return groups;
}
function decimal(value){
 if(typeof value!=='string'||value.length>256||!/^[-+]?\d+(?:\.\d+)?$/.test(value))return null;
 const negative=value[0]==='-',parts=value.replace(/^[-+]/,'').split('.'),fraction=parts[1]||'';
 if(parts[0].length>160||fraction.length>80)return null;
 let n=BigInt(parts[0]+fraction),scale=fraction.length;if(negative)n=-n;
 while(scale&&n%10n===0n){n/=10n;scale--;}return {n,scale};
}
function decimalText(value){
 let n=value.n,scale=value.scale;while(scale&&n%10n===0n){n/=10n;scale--;}
 const negative=n<0n;let text=(negative?-n:n).toString();
 if(scale){text=text.padStart(scale+1,'0');text=text.slice(0,-scale)+'.'+text.slice(-scale);}
 return (negative?'-':'')+text;
}
function subtract(after,before){const scale=Math.max(after.scale,before.scale);return decimalText({n:after.n*10n**BigInt(scale-after.scale)-before.n*10n**BigInt(scale-before.scale),scale});}
function decimalCompatible(kind,before,after){
 const itemField=kind==='bom'?'componentId':'itemId';
 if(!before[itemField]||!after[itemField])return {code:'QUANTITY_BASIS_MISSING',message:'Quantity difference requires an explicit referenced item on both sides.',fields:[itemField]};
 if(before.unit!==after.unit)return {code:'UNIT_CHANGED',message:'Quantity difference is not calculated across different units.',fields:['unit']};
 if(!before.unit||!after.unit)return {code:'UNIT_MISSING',message:'Quantity difference requires a nonblank unit on both sides.',fields:['unit']};
 const changed=BASIS[kind].filter(field=>before[field]!==after[field]);
 if(changed.length)return {code:'QUANTITY_BASIS_CHANGED',message:'Quantity difference is not calculated after the referenced item or revision changes.',fields:changed};
 return null;
}
function sourceDescriptor(source){return source?{id:source.id,kind:source.kind,name:source.name,sha256:source.sha256,bytes:source.bytes,delimiter:source.delimiter,columns:copy(source.columns),at:source.at}:null;}
function describe(state,report){
 const index=new Map(state.imports.map(source=>[source.id,source]));
 return {workspaceId:state.id,label:state.label,revision:state.revision,workspaceSha256:hash(state),activeSources:copy(state.activeSources),sources:Object.fromEntries(KINDS.map(kind=>[kind,sourceDescriptor(index.get(state.activeSources[kind]))])),readiness:copy(report.readiness),counts:copy(report.counts)};
}
function sourceBlocked(report,sourceId){
 if(!sourceId)return true;
 return report.issues.some(issue=>(issue.code.startsWith('CSV_')||issue.code.startsWith('MAPPING_'))&&issue.rows.some(row=>row.sourceId===sourceId));
}
function addIssue(target,{code,kind=null,side=null,message,action,rows=[],detail={},severity='error',originalIssueId=null,disposition=null}){
 const record={id:'comparison-issue-'+hash({code,kind,side,rows,detail,originalIssueId}).slice(0,32),code,kind,side,severity,message,action,rows:copy(rows),detail:copy(detail)};
 if(originalIssueId)record.originalIssueId=originalIssueId;if(disposition)record.disposition=copy(disposition);target.push(record);return record;
}
function difference(kind,ident,status,beforeRows,afterRows,fields,action){
 const rowBefore=beforeRows.map(plainRow),rowAfter=afterRows.map(plainRow);
 const record={kind,identity:copy(ident),status,fields,beforeRows:rowBefore,afterRows:rowAfter,action};
 return {id:'difference-'+hash(record).slice(0,32),...record};
}
/**
 * Inputs are full original workspace objects or JSON texts. Both are independently admitted by the readiness core.
 * Returned quantities always compare canonical source strings, never core-derived converted quantities.
 * Complete original workspaces/raw CSV remain the caller's retained inputs; descriptors and row references bind this result.
 */
export function compareWorkspaces(beforeInput,afterInput){
 const beforeState=importWorkspace(beforeInput),afterState=importWorkspace(afterInput);
 const beforeReport=analyze(beforeState),afterReport=analyze(afterState);
 const before=describe(beforeState,beforeReport),after=describe(afterState,afterReport),differences=[],issues=[],families={};
 for(const [side,report]of [['before',beforeReport],['after',afterReport]])for(const original of report.issues){
  const kinds=new Set(original.rows.map(row=>row.kind));const family=original.detail.kind||(kinds.size===1?[...kinds][0]:null);
  addIssue(issues,{...original,kind:family,side,code:'SOURCE_'+original.code,originalIssueId:original.id});
 }
 for(const kind of KINDS){
  const beforeRows=beforeReport.tables[kind],afterRows=afterReport.tables[kind],beforeSourceId=before.activeSources[kind],afterSourceId=after.activeSources[kind];
  const family={status:'COMPARABLE',identityFields:copy(IDENTITY_FIELDS[kind]),beforeSourceId,afterSourceId,beforeRows:beforeRows.length,afterRows:afterRows.length,unchanged:0,added:0,missing:0,changed:0,ambiguous:0};
  families[kind]=family;
  if(sourceBlocked(beforeReport,beforeSourceId)||sourceBlocked(afterReport,afterSourceId)){
   family.status='INCOMPARABLE_SOURCE';
   addIssue(issues,{code:'FAMILY_NOT_COMPARABLE',kind,message:'Both sides require a selected, parseable '+kind+' source with complete column mappings.',action:'Supply or remap the actual source on each side, then compare again. No added or missing rows are inferred for this family.',detail:{beforeSourceId,afterSourceId,beforeBlocked:sourceBlocked(beforeReport,beforeSourceId),afterBlocked:sourceBlocked(afterReport,afterSourceId)}});
   continue;
  }
  const left=indexRows(kind,beforeRows),right=indexRows(kind,afterRows),keys=new Set(left.keys());for(const key of right.keys())keys.add(key);
  for(const key of keys){
   const leftGroup=left.get(key),rightGroup=right.get(key),prior=leftGroup?.rows||[],next=rightGroup?.rows||[],ident=(leftGroup||rightGroup).identity;
   const invalidFields=new Set([...(leftGroup?.invalidFields||[]),...(rightGroup?.invalidFields||[])]);
   if(prior.length>1||next.length>1||invalidFields.size){
    family.ambiguous++;
    const row=difference(kind,ident,'ambiguous',prior,next,[],'Resolve the duplicate or incomplete identity in the original source; no arbitrary row pairing or aggregation was performed.');
    differences.push(row);
    addIssue(issues,{code:invalidFields.size?'INCOMPLETE_IDENTITY':'AMBIGUOUS_IDENTITY',kind,message:'This identity cannot be paired uniquely across the two source editions.',action:row.action,rows:[...row.beforeRows.map(r=>({...r.ref,side:'before'})),...row.afterRows.map(r=>({...r.ref,side:'after'}))],detail:{differenceId:row.id,identity:ident,beforeCount:prior.length,afterCount:next.length,invalidFields:[...invalidFields]}});
    continue;
   }
   if(!prior.length||!next.length){
    const status=prior.length?'missing':'added';family[status]++;
    const fields=FIELD_DEFINITIONS[kind].map(({name})=>({field:name,before:prior[0]?.values[name]??null,after:next[0]?.values[name]??null}));
    differences.push(difference(kind,ident,status,prior,next,fields,status==='added'?'Confirm this row is an intended addition in the compared source.':'Reconcile the missing row with the source owner or obtain the omitted target extract.'));
    continue;
   }
   const a=prior[0].values,b=next[0].values,fields=[],basis=QUANTITIES[kind].length?decimalCompatible(kind,a,b):null;
   for(const {name}of FIELD_DEFINITIONS[kind]){
    if(a[name]===b[name])continue;
    const field={field:name,before:a[name],after:b[name]};
    if(QUANTITIES[kind].includes(name)){
     const x=decimal(a[name]),y=decimal(b[name]);
     if(basis)field.comparisonNote=basis.message;
     else if(!x||!y||x.n<0n||y.n<0n||(kind==='bom'&&(x.n===0n||y.n===0n)))field.comparisonNote='Quantity difference is not calculated from an invalid or out-of-range source quantity.';
     else {field.delta=subtract(y,x);field.numericEquivalent=field.delta==='0';}
    }
    fields.push(field);
   }
   if(!fields.length){family.unchanged++;continue;}
   family.changed++;
   const row=difference(kind,ident,'changed',prior,next,fields,'Review each changed field against the approved migration mapping and original row references. Delta means compared minus baseline.');
   differences.push(row);
   if(basis)addIssue(issues,{code:basis.code,kind,message:basis.message,action:'Confirm the source item, exact revision and unit. This comparison never infers a conversion or substitutes the latest revision.',rows:[{...prior[0].ref,side:'before'},{...next[0].ref,side:'after'}],detail:{differenceId:row.id,fields:basis.fields,before:Object.fromEntries(BASIS[kind].map(field=>[field,a[field]])),after:Object.fromEntries(BASIS[kind].map(field=>[field,b[field]]))}});
  }
 }
 const counts={differences:differences.length,issues:issues.length,errors:0,warnings:0,byStatus:{added:0,missing:0,changed:0,ambiguous:0},unchanged:0,byKind:{}};
 for(const row of issues){if(row.severity==='error')counts.errors++;else if(row.severity==='warning')counts.warnings++;}
 for(const kind of KINDS){const f=families[kind];counts.unchanged+=f.unchanged;for(const status of Object.keys(counts.byStatus))counts.byStatus[status]+=f[status];counts.byKind[kind]=copy(f);}
 const readiness={status:counts.errors?'SOURCE_REVIEW_REQUIRED':counts.differences?'DIFFERENCES_REVIEW_REQUIRED':'MATCHED_FOR_REVIEW',blockingIssues:counts.errors,note:'This compares the selected canonical source fields after their recorded column maps and trimming. It does not certify a target load, infer revisions, aggregate duplicates, convert units, or write to an ERP. Reviewer decisions do not remove source exceptions.'};
 return {schema:COMPARISON_SCHEMA,id:'comparison-'+hash({before:before.workspaceSha256,after:after.workspaceSha256}).slice(0,32),before,after,families,differences,issues,counts,readiness};
}
function reviewState(result,{reviews=[],reviewer='',notes=''}={}){
 need(object(result)&&result.schema===COMPARISON_SCHEMA&&Array.isArray(result.differences)&&Array.isArray(result.issues),'Supply a complete calculated comparison.');
 need(typeof reviewer==='string'&&reviewer.length<=1000,'Reviewer must be text of at most 1,000 characters.');
 need(typeof notes==='string'&&notes.length<=12000,'Review notes must be text of at most 12,000 characters.');
 need(Array.isArray(reviews),'Review decisions must be an array.');const ids=new Set(result.differences.map(row=>row.id)),latest=new Map();
 for(const row of reviews){
  need(object(row)&&ids.has(row.differenceId),'A review decision belongs to another comparison difference.');
  need(DISPOSITION_STATUSES.includes(row.status),'Unknown comparison review status.');
  need(typeof row.note==='string'&&row.note.length<=12000,'A review note must be text of at most 12,000 characters.');
  need(row.status==='open'||row.note.trim(),'Add the rationale for the reviewed difference.');
  if(row.actor!==undefined)need(typeof row.actor==='string'&&row.actor.length<=1000,'Review actor must be text.');
  if(row.at!==undefined)need(typeof row.at==='string'&&/^\d{4}-\d\d-\d\dT/.test(row.at)&&Number.isFinite(Date.parse(row.at)),'Review time must be an ISO timestamp.');
  latest.set(row.differenceId,copy(row));
 }
 return {reviewer,notes,reviews:copy(reviews),latest};
}
export function exportComparisonJSON(result,options={}){
 const review=reviewState(result,options);return JSON.stringify({...result,review:{reviewer:review.reviewer,notes:review.notes,reviews:review.reviews}},null,2)+'\n';
}
function csvCell(value){let text=String(value??'');if(/^[\t\r\n ]*[=+\-@]/.test(text)&&!/^-\d+(?:\.\d+)?$/.test(text))text="'"+text;return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;}
export function exportComparisonCSV(result,options={}){
 const review=reviewState(result,options),headers=['recordType','comparisonId','differenceId','kind','status','identity','field','before','after','deltaAfterMinusBefore','numericEquivalent','comparisonNote','beforeRows','afterRows','issueCode','side','message','action','reviewStatus','reviewNote','reviewActor','reviewAt','reviewer','overallNotes'];
 const lines=[headers.map(csvCell).join(',')];
 const emit=values=>lines.push(values.map(csvCell).join(','));
 for(const row of result.differences){
  const decision=review.latest.get(row.id)||{status:'open',note:''};const fields=row.fields.length?row.fields:[{}];
  for(const field of fields)emit(['difference',result.id,row.id,row.kind,row.status,JSON.stringify(row.identity),field.field,field.before,field.after,field.delta,field.numericEquivalent,field.comparisonNote,JSON.stringify(row.beforeRows),JSON.stringify(row.afterRows),'','','',row.action,decision.status,decision.note,decision.actor,decision.at,review.reviewer,review.notes]);
 }
 for(const row of result.issues)emit(['issue',result.id,row.detail?.differenceId||'',row.kind,row.severity,'','','','','','','',JSON.stringify(row.rows),'',row.code,row.side,row.message,row.action,row.disposition?.status||'',row.disposition?.note||'','','',review.reviewer,review.notes]);
 if(!result.differences.length&&!result.issues.length)emit(['summary',result.id,'','','MATCHED_FOR_REVIEW','','','','','','','','','','','',result.readiness.note,'','','','','',review.reviewer,review.notes]);
 return lines.join('\r\n')+'\r\n';
}
function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
export function reportHTML(result,options={}){
 const review=reviewState(result,options),e=escapeHTML;
 const sourceRows=KINDS.map(kind=>{const f=result.families[kind],a=result.before.sources[kind],b=result.after.sources[kind];return '<tr><th>'+e(kind)+'</th><td>'+e(a?.name||'Missing source')+'<br><code>'+e(a?.sha256||'')+'</code></td><td>'+e(b?.name||'Missing source')+'<br><code>'+e(b?.sha256||'')+'</code></td><td>'+e(f.status)+'<br>'+f.beforeRows+' / '+f.afterRows+' rows</td><td>'+f.unchanged+' unchanged; '+f.added+' added; '+f.missing+' missing; '+f.changed+' changed; '+f.ambiguous+' ambiguous</td></tr>';}).join('');
 const differences=result.differences.map(row=>{const d=review.latest.get(row.id)||{status:'open',note:''};return '<article><h3>'+e(row.kind)+' · '+e(row.status)+'</h3><p><strong>Exact identity</strong> '+e(JSON.stringify(row.identity))+'</p><p>'+e(row.action)+'</p>'+(row.fields.length?'<div class="scroll"><table><thead><tr><th>Field</th><th>Baseline</th><th>Compared</th><th>Delta / note</th></tr></thead><tbody>'+row.fields.map(field=>'<tr><td>'+e(field.field)+'</td><td><pre>'+e(field.before===null?'[absent]':field.before)+'</pre></td><td><pre>'+e(field.after===null?'[absent]':field.after)+'</pre></td><td>'+e(own(field,'delta')?field.delta+(field.numericEquivalent?' (same numeric value)':''):field.comparisonNote||'')+'</td></tr>').join('')+'</tbody></table></div>':'<p>Ambiguous identity: all candidate rows are retained below; none were paired arbitrarily.</p>')+'<h4>Baseline rows</h4><pre>'+e(JSON.stringify(row.beforeRows,null,2))+'</pre><h4>Compared rows</h4><pre>'+e(JSON.stringify(row.afterRows,null,2))+'</pre><p>Review: '+e(d.status)+' · '+e(d.actor||'')+' · '+e(d.at||'')+'</p><p>'+e(d.note)+'</p><small>'+e(row.id)+'</small></article>';}).join('');
 const issues=result.issues.map(row=>'<article><h3>'+e(row.code)+' · '+e(row.side||'comparison')+'</h3><p>'+e(row.message)+'</p><p>'+e(row.action)+'</p><pre>'+e(JSON.stringify({rows:row.rows,detail:row.detail},null,2))+'</pre>'+(row.disposition?'<p>Original source review: '+e(row.disposition.status)+' · '+e(row.disposition.note)+'</p>':'')+'<small>'+e(row.id)+'</small></article>').join('');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manufacturing source comparison</title><style>body{font:15px/1.5 system-ui,sans-serif;background:#fff;color:#17212b;margin:0;padding:24px;max-width:1250px}h1{font-size:26px}h2{font-size:21px;margin-top:30px}h3{font-size:17px}table{border-collapse:collapse;width:100%}th,td{padding:9px;border:1px solid #b8c0c8;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef1f4}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}code,small{overflow-wrap:anywhere}article{padding:16px;border:1px solid #b8c0c8;margin:16px 0;break-inside:avoid}.scroll{overflow:auto}small{color:#46515d}@media(max-width:600px){body{padding:14px}th,td{padding:6px}}@media print{body{max-width:none;padding:0}.scroll{overflow:visible}}</style></head><body><h1>Manufacturing source comparison</h1><p>'+e(result.before.label)+' · revision '+result.before.revision+' → '+e(result.after.label)+' · revision '+result.after.revision+'</p><p><code>'+e(result.id)+'</code></p><h2>'+e(result.readiness.status.replace(/_/g,' '))+'</h2><p>'+e(result.readiness.note)+'</p><p>'+result.counts.differences+' row differences; '+result.counts.issues+' source/comparison exceptions; '+result.counts.unchanged+' unchanged identities.</p><p>Delta means compared minus baseline. Numeric formatting changes remain visible even where the delta is zero.</p><h2>Source identities and coverage</h2><p>Baseline workspace '+e(result.before.workspaceId)+' · <code>'+e(result.before.workspaceSha256)+'</code><br>Compared workspace '+e(result.after.workspaceId)+' · <code>'+e(result.after.workspaceSha256)+'</code></p><div class="scroll"><table><thead><tr><th>Family</th><th>Baseline source / SHA-256</th><th>Compared source / SHA-256</th><th>Coverage</th><th>Identity counts</th></tr></thead><tbody>'+sourceRows+'</tbody></table></div><h2>Reviewer context</h2><p>'+e(review.reviewer)+'</p><pre>'+e(review.notes)+'</pre><h2>Row differences</h2>'+(differences||'<p>No row differences were calculated. Check family coverage and source exceptions before interpreting this result.</p>')+'<h2>Source and comparison exceptions</h2>'+(issues||'<p>No exceptions from the recorded checks.</p>')+'<h2>Retained review history</h2><pre>'+e(JSON.stringify(review.reviews,null,2))+'</pre><h2>Retained originals</h2><p>The companion working desk retains both complete source workspaces and their exact original CSV editions, column maps and prior selections. This report compares their canonical fields; original downloads retain source bytes. CSV comparison exports neutralize spreadsheet formula prefixes and include every difference and source exception.</p></body></html>';
}
