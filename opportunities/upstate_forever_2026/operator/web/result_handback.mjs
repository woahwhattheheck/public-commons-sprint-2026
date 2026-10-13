/** Saved-result selection for the maintained Source returns desk. No writer. */
import {receiveSourceHandbackDraft} from './source_handback.mjs';
const SCHEMA='upper-savannah.result-source-selection/v1',DRAFT='upper-savannah.source-handback-draft/v1';
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const stable=v=>JSON.stringify(v,(_,x)=>plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const clone=v=>JSON.parse(JSON.stringify(v));
const sha=/^[a-f0-9]{64}$/;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const need=(ok,message)=>{if(!ok)throw Error(message);};
async function digestText(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function shape(value){
 need(plain(value)&&value.schema===SCHEMA&&plain(value.result),'Open an original saved-result source selection.');
 const r=value.result;
 need(typeof r.id==='string'&&r.id&&r.id.length<=256&&sha.test(r.contentSha256)&&sha.test(r.snapshotSha256)&&
  Number.isSafeInteger(r.contentBytes)&&r.contentBytes>=0&&Number.isSafeInteger(r.workspaceRevision)&&r.workspaceRevision>=0&&
  Number.isSafeInteger(value.currentWorkspaceRevision)&&value.currentWorkspaceRevision>=0&&typeof r.exportIdInSnapshot==='boolean'&&sha.test(value.selectionSha256),'The result selection is missing its retained identity.');
 need(Array.isArray(value.sources)&&Array.isArray(value.associations)&&Array.isArray(value.missing)&&Array.isArray(value.notes)&&value.notes.every(x=>typeof x==='string'),'The complete source-selection explanation is absent.');
 const seen=new Set();
 for(const source of value.sources){
  need(plain(source)&&typeof source.id==='string'&&source.id&&!seen.has(source.id)&&sha.test(source.sha256)&&
   typeof source.label==='string'&&typeof source.kind==='string'&&Number.isSafeInteger(source.bytes)&&source.bytes>=0&&
   Array.isArray(source.bases)&&source.bases.every(x=>['retained-result-source-reference','current-original-record-association'].includes(x))&&
   Array.isArray(source.recordIds)&&source.recordIds.every(x=>typeof x==='string')&&Array.isArray(source.roles),'An original source identity or selection basis is incomplete.');
  seen.add(source.id);
 }
 need(value.associations.every(x=>plain(x)&&seen.has(x.sourceId)&&typeof x.recordId==='string')&&value.sourceSelectionComplete===(value.missing.length===0),'The source associations differ from the complete selection.');
 need(value.counts?.sources===value.sources.length&&value.counts?.missing===value.missing.length&&Number.isSafeInteger(value.counts.records)&&value.counts.records>=0,'The source selection counts differ.');
 return value;
}
export async function validateResultSourceSelection(value,{id,report,hashText=digestText}={}){
 shape(value);need(value.result.id===id,'The returned source selection belongs to another saved result.');
 const original=clone(report);if(!value.result.exportIdInSnapshot&&Object.hasOwn(original,'exportId')){need(original.exportId===id,'The displayed result identity changed.');delete original.exportId;}
 need(original.workspaceRevision===value.result.workspaceRevision&&original.format===value.result.format,'The displayed result and original source selection differ.');
 need(await hashText(stable(original))===value.result.snapshotSha256,'The source selection does not match the complete displayed result.');
 const binding=clone(value);delete binding.selectionSha256;
 need(await hashText(stable(binding))===value.selectionSha256,'The complete source selection changed.');
 return clone(value);
}
function noteFor(selection){
 const r=selection.result;
 return ['Saved measurement result '+r.id+'; original workspace revision '+r.workspaceRevision+'.',
  'Retained result SHA-256: '+r.contentSha256+'.',
  'Source associations inspected at workspace revision '+selection.currentWorkspaceRevision+'.',
  ...selection.notes,
  ...(selection.missing.length?['Unresolved original-source associations: '+selection.missing.length+'. The saved result remains complete; inspect the full selection evidence for every unresolved row.']:[])].join('\n\n');
}
export function createResultHandbackDraft(selection,existing=null){
 shape(selection);need(selection.sources.length>0,'No original source file is available for this selection. Open the complete result and source evidence.');
 const initial=existing?receiveSourceHandbackDraft(existing):{schema:DRAFT,draft:{sourceIds:[],exportIds:[],title:'',note:''},pending:null,selectedEditionId:''};
 need(!initial.pending,'The existing return retains an exact pending publication. Open that return to recover it, or download this separate working selection.');
 const out=clone(initial),r=selection.result,addition=noteFor(selection);
 out.draft.sourceIds=[...new Set([...out.draft.sourceIds,...selection.sources.map(s=>s.id)])];
 out.draft.exportIds=[...new Set([...out.draft.exportIds,r.id])];
 if(!out.draft.title.trim())out.draft.title=(r.kind==='calibration'?'Reviewed measurement inputs':'Concentration–discharge pairing')+' — source return';
 if(!out.draft.note.includes(addition))out.draft.note=[out.draft.note,addition].filter(Boolean).join('\n\n');
 out.selectedEditionId='';
 return receiveSourceHandbackDraft(out);
}
export function renderResultSourceSelection(selection,{existing=null}={}){
 shape(selection);const r=selection.result,pending=!!existing?.pending,hasDraft=!!(existing?.draft?.sourceIds?.length||existing?.draft?.exportIds?.length||existing?.draft?.title||existing?.draft?.note);
 const basis=value=>value==='retained-result-source-reference'?'Original saved-result reference':'Current original-file association';
 return '<section class="mwr"><h3>Return this saved result with its sources</h3><p>Original result revision <strong>'+esc(r.workspaceRevision)+'</strong>; source associations read at current workspace revision <strong>'+esc(selection.currentWorkspaceRevision)+'</strong>. The saved result keeps its original values and decisions.</p>'+
  '<p>'+selection.sources.length+' original files · '+selection.counts.records+' referenced measurements · '+selection.missing.length+' unresolved source associations.</p>'+
  '<ul>'+selection.notes.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+
  '<div class="mwr-table"><table><thead><tr><th>Original file</th><th>Selection basis</th><th>Bytes</th><th>Records</th></tr></thead><tbody>'+
  selection.sources.map(s=>'<tr><td>'+esc(s.label)+'<br>'+esc(s.kind)+'</td><td>'+s.bases.map(basis).map(esc).join('<br>')+'</td><td>'+s.bytes+'</td><td>'+s.recordIds.length+'</td></tr>').join('')+'</tbody></table></div>'+
  (selection.missing.length?'<details open><summary>Unresolved source associations ('+selection.missing.length+')</summary><p>The complete selection-evidence download retains every unresolved row. Showing the first '+Math.min(50,selection.missing.length)+'.</p><ul>'+selection.missing.slice(0,50).map(x=>'<li>'+esc(x.recordId||x.sourceId)+': '+esc(x.reason)+'</li>').join('')+'</ul></details>':'')+
  '<p>Source returns will preview the complete current project, original files, companions, readable workbook/report and this unchanged historical result before publishing its existing ZIP edition.</p>'+
  (pending?'<p class="mwr-notice">Your current return has a retained publication request. Recover that original request in Source returns. This selection can be downloaded separately without changing it.</p>':hasDraft?'<p>Your existing return title, note and selected sources/results will be preserved. Adding this result extends that working selection.</p>':'<p>Open a working selection in the original Source returns desk, then review its complete preview.</p>')+
  '<div class="mw-buttons"><button data-result-return="open"'+(pending||!selection.sources.length?' disabled':'')+'>'+(hasDraft?'Add to current source return':'Open source return')+'</button>'+
  (pending?'<button data-result-return="pending">Open current return</button>':'')+
  '<button data-result-return="draft"'+(!selection.sources.length?' disabled':'')+'>Download separate working selection</button><button data-result-return="evidence">Download complete selection evidence</button></div></section>';
}
