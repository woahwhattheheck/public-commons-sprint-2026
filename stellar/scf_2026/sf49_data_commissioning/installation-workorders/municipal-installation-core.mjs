// SPDX-License-Identifier: MIT
/** Bind the original municipal snapshot to the existing customer Installation. */
import {createHash} from 'node:crypto';
import {bindingTemplate,prepareInstallation,renderWorkorder} from './prepare-core.mjs';
export const SELECTION_SCHEMA='stellar-forge.municipal-installation-selection.v1';
export const SOURCE_SCHEMA='stellar-forge.municipal-installation-source.v1';
export const MAX_SOURCE=8*1024*1024,MAX_CASE=24*1024*1024;
export const sha=raw=>createHash('sha256').update(raw).digest('hex');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const copy=value=>JSON.parse(JSON.stringify(value));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const ordered=value=>Array.isArray(value)?value.map(ordered):object(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
export const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const exact=(value,keys,label)=>need(object(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'Retain complete '+label+' fields.');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const ref=project=>({id:project.id,revision:project.revision,snapshotSha256:project.snapshotSha256});
function inspect(source){
 need(source?.schema===SOURCE_SCHEMA&&object(source.workspace)&&digest(source.archive?.sha256)&&Number.isSafeInteger(source.archive.bytes)&&source.archive.bytes>0&&source.archive.bytes<=MAX_SOURCE,'Use the full original native municipal inspection within the existing 8 MiB case-source limit.');
 need(Array.isArray(source.projects)&&source.projects.length>0,'Retain the original populated municipal project selection.');
 const ids=new Set();
 for(const project of source.projects){
  need(typeof project.id==='string'&&/^[a-f0-9]{32}$/.test(project.id)&&!ids.has(project.id)&&Number.isSafeInteger(project.revision)&&project.revision>=0&&digest(project.snapshotSha256),'Retain distinct original project/revision identities.');
  ids.add(project.id);need(object(project.state)&&Array.isArray(project.inputs)&&Array.isArray(project.history)&&Array.isArray(project.operations),'Retain the complete original project state, source editions and history.');
 }
 return source;
}
function originalCase(seed,value){
 need(object(value?.program)&&Array.isArray(value.sources)&&value.program.id===seed.source?.caseId&&value.program.version===seed.source.version&&value.program.planId===seed.source.planId,
  'Use the complete same-version original Operations case and Workshare seed.');
 need(value.sources.length<=200&&value.sources.reduce((n,s)=>n+s.bytes,0)<=MAX_CASE,'Retain the original complete 24 MiB / 200-file case source allowance.');
}
function attachment(value,id,file,label){
 const matches=value.sources.filter(s=>s.id===id);
 need(matches.length===1&&matches[0].sha256===file.sha256&&matches[0].bytes===file.bytes,'Attach the exact complete '+label+' to the original case.');
 return matches[0];
}
export function municipalInstallationTemplate({source,seed,caseValue,profile}){
 inspect(source);originalCase(seed,caseValue);
 const matches=caseValue.sources.filter(row=>row.sha256===source.archive.sha256&&row.bytes===source.archive.bytes);
 return {selection:{schema:SELECTION_SCHEMA,workspace:copy(source.workspace),
  handover:{sourceId:matches.length===1?matches[0].id:null,...source.archive},
  projects:source.projects.map(project=>({reference:ref(project),included:true,purpose:''}))},
  bindings:bindingTemplate(seed,profile),source};
}
export function prepareMunicipalInstallation({source,seed,caseValue,profile,bindings,selectionRaw,selectionSourceId}){
 inspect(source);originalCase(seed,caseValue);
 need(Buffer.isBuffer(selectionRaw)&&selectionRaw.length<=MAX_SOURCE,'Keep the complete selected-project JSON within the original source limit.');
 const selection=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(selectionRaw));
 exact(selection,['schema','workspace','handover','projects'],'municipal selection');
 need(selection.schema===SELECTION_SCHEMA&&same(selection.workspace,source.workspace),'Select the original managed municipal workspace.');
 exact(selection.handover,['sourceId','bytes','sha256'],'original handover selection');
 need(selection.handover.bytes===source.archive.bytes&&selection.handover.sha256===source.archive.sha256,'The original full handover changed.');
 const archive=attachment(caseValue,selection.handover.sourceId,source.archive,'municipal ZIP');
 const selectedFile={sourceId:selectionSourceId,bytes:selectionRaw.length,sha256:sha(selectionRaw)};
 attachment(caseValue,selectionSourceId,selectedFile,'selected-project source');
 need(Array.isArray(selection.projects)&&selection.projects.length===source.projects.length,'Retain every original project with an explicit inclusion or exclusion.');
 const seen=new Set(),rows=[];
 for(const selected of selection.projects){
  exact(selected,['reference','included','purpose'],'project choice');
  exact(selected.reference,['id','revision','snapshotSha256'],'original project reference');
  const original=source.projects.find(p=>same(ref(p),selected.reference));
  need(original&&!seen.has(original.id),'Select each original project once by its exact edition.');
  need(typeof selected.included==='boolean'&&typeof selected.purpose==='string'&&selected.purpose.trim()&&selected.purpose.length<=4000,
   'Give every selected or excluded original project its actual purpose or exclusion reason.');
  seen.add(original.id);rows.push({...copy(selected),source:original});
 }
 need(rows.some(r=>r.included),'Select a complete useful municipal project.');
 const next=copy(bindings);need(object(next.source)&&object(next.receiving),'Keep the original full bindings template.');
 for(const field of ['source','receiving'])next[field].sourceIds=[...new Set([...(next[field].sourceIds??[]),archive.id,selectionSourceId])];
 const prepared=prepareInstallation(seed,profile,next);
 need(prepared.document.workshare,'Use the complete original commercial Workshare seed.');
 need(prepared.document.source.mode==='SNAPSHOT','The selected handover is one complete retained source edition.');
 const snapshot={schema:'stellar-forge.municipal-installation-projects.v1',workspace:copy(source.workspace),originalCase:copy(seed.source),
  handover:copy(selection.handover),selectedProjectsSource:selectedFile,
  originalSourceSha256:source.originalSourceSha256,receivingSourceSha256:source.receivingSourceSha256,
  entireEdition:{projects:source.projects.length,members:source.manifest.files.length,database:source.database},
  projects:rows,acceptance:'Source, review and native outcomes retain their original states. Installation acceptance is an attributed decision against the original commercial checks.'};
 return {schema:'stellar-forge.municipal-installation-preparation.v1',prepared,source,snapshot,bindings:next,workorder:renderWorkorder(prepared)};
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const detail=(label,value)=>'<details><summary>'+esc(label)+'</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
const table=(heads,rows)=>'<div class="table"><table><thead><tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
export function renderMunicipalSource(source,selection=null){
 inspect(source);
 const choices=new Map((selection?.projects??[]).map(x=>[x.reference.id,x]));
 const sections=source.projects.map(p=>{
  const choice=choices.get(p.id),selected=p.state.inputs??{};
  return '<section><h2>'+esc(p.title)+'</h2>'+table(['Original project','Revision','Mode','Selected scope'],[[p.id,p.revision,p.mode,choice?(choice.included?'Included: ':'Excluded: ')+choice.purpose:'Scope not yet recorded']])+
  '<h3>Every retained source edition</h3>'+table(['Kind / current selection','Original file','Rows','Bytes','Original identity'],p.inputs.map(i=>[i.kind+(selected[i.kind]===i.id?' · selected':''),i.filename,i.row_count,i.body.bytes,i.id+' / '+i.sha256]))+
  '<h3>Saved mapping and review history</h3>'+table(['Revision','Original action','Named actor','Original time','State identity'],p.history.map(r=>[r.revision,r.action,r.actor,r.at,r.stateSha256]))+
  '<p>'+esc(p.operations.length)+' original operation results; '+esc(p.nativeRuns.length)+' native runs; '+esc(p.releases.length)+' release records. These observations retain their original meanings and states.</p>'+
  detail('Complete current mapping, source selection and named reviews',p.state)+detail('Complete original history and operation results',{history:p.history,operations:p.operations,nativeRuns:p.nativeRuns,releases:p.releases})+'</section>';
 });
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Municipal installation source</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#202326;background:#fff;margin:0}main{max-width:1120px;padding:32px;margin:auto}h1,h2,h3{line-height:1.25}section{border-top:1px solid #bbb;margin-top:32px;padding-top:20px}a{color:#222;text-decoration:underline}table{width:100%;border-collapse:collapse;font-size:14px}td,th{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}.table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.45 ui-monospace,monospace;background:#f3f3f3;padding:12px}summary{cursor:pointer;padding:8px 0;font-weight:600}header p{overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:16px}button{font:inherit;background:#eee;border:1px solid #888;padding:6px 12px;cursor:pointer}@media(max-width:600px){main{padding:16px}h1{font-size:25px}td,th{padding:6px}}@media print{main{max-width:none;padding:0}nav{display:none}details{display:block}details>pre{display:block}table{font-size:10px}tr{break-inside:avoid}h2,h3{break-after:avoid}.table{overflow:visible}}</style><main><header><h1>Municipal installation source</h1><p>Complete original asset projects, source editions, saved mappings and operation history for the existing Installation and Workshare.</p><p>Workspace '+esc(source.workspace.id)+' · original ZIP '+esc(source.archive.bytes)+' bytes · SHA-256 '+esc(source.archive.sha256)+'</p><nav><a href="Municipal_Complete_Original_Handover.zip" download>Complete original workspace</a><a href="Municipal_Complete_Source_Report.json" download>Complete source report</a><a href="Selected_Municipal_Projects.json" download>Editable project selection</a><button onclick="document.querySelectorAll(\'details\').forEach(x=>x.open=true);window.print()">Print complete report</button></nav></header>'+sections.join('')+'<section><h2>Whole archive selection</h2>'+table(['Original member','Bytes','SHA-256'],source.manifest.files.map(x=>[x.path,x.bytes,x.sha256]))+detail('Complete original archive manifest',source.manifest)+'</section></main></html>';
}
