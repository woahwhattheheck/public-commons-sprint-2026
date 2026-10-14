// MIT. Current Principal source-bound projections; original observations stay intact.
export const SOURCE={repository:'principal-Protocol-org/principal',baseCommit:'f35b914cbf4896255a3711d81795b810b0a47f1c',implementationEdition:'paired-exit-1-market-1-accounting-3'};
export const CONTRACTS=['oracle_adapter','permissioning','principal_manager','pt_token','recovery_escrow','risk_control','sy_wrapper','yt_token','market_pool','router'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
export function integer(value){if(typeof value==='string'&&/^-?\d+$/.test(value))return BigInt(value);if(typeof value==='number'&&Number.isSafeInteger(value))return BigInt(value);throw Error('Keep the original exact integer text.');}
export function atomText(value,decimals=null){try{const n=integer(value);if(decimals===null)return n.toString()+' raw units';const d=integer(decimals);if(d<0n||d>38n)throw Error('Unsupported precision');const scale=10n**d,a=n<0n?-n:n;return(n<0n?'-':'')+(a/scale).toString()+(d?'.'+(a%scale).toString().padStart(Number(d),'0'):'');}catch{return value===undefined||value===null?'Not observed':String(value);}}
export function network(config){return{rpcUrl:config?.network?.rpcUrl??null,passphrase:config?.network?.passphrase??null};}
export function binding(config,contractKey,apiSha256){const c=config?.contracts?.[contractKey]??{};return{...network(config),contractKey,contractId:c.id??null,wasmSha256:c.wasmSha256??null,apiSha256:apiSha256??null};}
export function observedBinding(row){const key=row.binding?.contractKey??String(row.actionId??'').split('.')[0],config=row.configuration??row.config??{};return{...network({network:row.binding?.network??config.network}),contractKey:key,contractId:row.contractId??row.binding?.contractId??config.contracts?.[key]?.id??null,wasmSha256:row.binding?.wasmSha256??config.contracts?.[key]?.wasmSha256??null,apiSha256:row.apiSha256??null};}
export function completeBinding(b){return plain(b)&&['rpcUrl','passphrase','contractKey','contractId','wasmSha256','apiSha256'].every(k=>typeof b[k]==='string'&&b[k].length>0);}
export function sameBinding(a,b){return completeBinding(a)&&completeBinding(b)&&canonical(a)===canonical(b);}
export function latest(state,apiSha256,contract,method,parameters={}){const want=binding(state.config,contract,apiSha256);return [...(state.observations??[])].reverse().find(row=>row.actionId===contract+'.'+method&&row.status==='CLI_EXIT_0'&&!row.parseError&&sameBinding(observedBinding(row),want)&&canonical(row.parameters??{})===canonical(parameters))??null;}
export function decimals(state,api,token){return latest(state,api,token,'decimals')?.value??null;}
export function topology(state,api){const cfg=state.config??{},expected=[
 ['sy_wrapper','permissioning_address','permissioning'],['sy_wrapper','recovery_escrow','recovery_escrow'],
 ['pt_token','permissioning_address','permissioning'],['yt_token','permissioning_address','permissioning'],
 ['pt_token','minter','principal_manager'],['yt_token','minter','principal_manager'],
 ['pt_token','recovery_escrow','recovery_escrow'],['yt_token','recovery_escrow','recovery_escrow'],
 ['yt_token','oracle_address','oracle_adapter'],
 ['principal_manager','sy_wrapper_address','sy_wrapper'],['principal_manager','pt_token_address','pt_token'],
 ['principal_manager','yt_token_address','yt_token'],['principal_manager','oracle_address','oracle_adapter'],
 ['principal_manager','permissioning_address','permissioning'],['market_pool','manager_address','principal_manager'],
 ['market_pool','recovery_escrow','recovery_escrow'],['router','market_address','market_pool']
 ];const rows=expected.map(([contract,method,target])=>{const row=latest(state,api,contract,method),want=cfg.contracts?.[target]?.id??null;return{contract,method,expected:want,observed:row?.value??null,observationId:row?.id??null,status:!row||!want?'UNOBSERVED':row.value===want?'MATCH':'MISMATCH'};});
 const underlying=['sy_wrapper','pt_token','yt_token','principal_manager','recovery_escrow'].map(contract=>({contract,row:latest(state,api,contract,'underlying_address')}));
 const known=underlying.filter(x=>x.row);const same=new Set(known.map(x=>canonical(x.row.value))).size<=1;
 for(const x of underlying)rows.push({contract:x.contract,method:'underlying_address',expected:known[0]?.row.value??null,observed:x.row?.value??null,observationId:x.row?.id??null,status:!x.row?'UNOBSERVED':same?'CONSISTENT_OBSERVED':'MISMATCH'});
 const maturities=['principal_manager','pt_token','yt_token'].map(contract=>({contract,row:latest(state,api,contract,'maturity')}));
 const observed=maturities.filter(x=>x.row),equal=new Set(observed.map(x=>String(x.row.value))).size<=1;
 for(const x of maturities)rows.push({contract:x.contract,method:'maturity',expected:observed[0]?.row.value??null,observed:x.row?.value??null,observationId:x.row?.id??null,status:!x.row?'UNOBSERVED':equal?'CONSISTENT_OBSERVED':'MISMATCH'});
 return rows;
}
export const CASE_SCHEMA='principal.recovery-case.v1';
const caseIdOK=id=>typeof id==='string'&&/^[-a-zA-Z0-9]{1,100}$/.test(id);
const idsOK=ids=>Array.isArray(ids)&&ids.every(x=>typeof x==='string'&&x.length>0)&&new Set(ids).size===ids.length;
export function caseValue(note){try{const value=JSON.parse(note.body);if(!plain(value)||value.schema!==CASE_SCHEMA||!caseIdOK(value.caseId)||note.subjectId!=='recovery-case:'+value.caseId)return null;return value;}catch{return null;}}
export function caseKey(value){return canonical([value.caseId,value.binding??null,value.account??null]);}
export function checkCase(value){
 if(!plain(value)||value.schema!==CASE_SCHEMA||!caseIdOK(value.caseId))throw Error('Keep the complete original recovery case identity.');
 if(!completeBinding(value.binding)||value.binding.contractKey!=='recovery_escrow')throw Error('Select the complete RecoveryEscrow binding.');
 if(!/^[GC][A-Z2-7]{55}$/.test(value.account??''))throw Error('Use the complete affected public account address.');
 if(!['REVIEW','SEIZURE_PREPARED','POSITIONS_HELD','FINALIZATION_PREPARED','RECONCILED','CLOSED'].includes(value.stage))throw Error('Select a supported operator review stage.');
 for(const k of ['operator','reason','review'])if(typeof value[k]!=='string'||value[k].length>200000||(k!=='review'&&!value[k].trim()))throw Error('Keep the operator, reason and complete review text.');
 for(const k of ['fileIds','observationIds','planIds','eventIds'])if(!idsOK(value[k]))throw Error('Retain unique complete '+k+'.');
 if(value.previousNoteId!==null&&(typeof value.previousNoteId!=='string'||!value.previousNoteId))throw Error('Retain the preceding case edition.');
 if(value.resolvedNoteIds!==undefined&&!idsOK(value.resolvedNoteIds))throw Error('Retain each acknowledged competing tip once.');
 if((value.resolvedNoteIds??[]).includes(value.previousNoteId)||(value.previousNoteId===null&&(value.resolvedNoteIds??[]).length))throw Error('Choose one original basis and separate acknowledged competing tips.');
 if(value.sourceCase!==undefined){const s=value.sourceCase;if(!plain(s)||!caseIdOK(s.caseId)||!idsOK(s.noteIds)||!s.noteIds.length)throw Error('Keep the original case and every selected source note reference.');}
 return value;
}
export function cases(state){
 const groups=new Map(),all=new Map();
 for(const [index,note]of (state.notes??[]).entries()){const value=caseValue(note);if(!value)continue;const item={note,value,index,parents:[],errors:[]};const key=caseKey(value),history=groups.get(key)??[];history.push(item);groups.set(key,history);if(all.has(note.id)){item.errors.push('Repeated original note identity.');all.get(note.id).errors.push('Repeated original note identity.');}else all.set(note.id,item);}
 return [...groups.entries()].map(([key,history])=>{
  const used=new Set();
  for(const item of history){
   try{checkCase(item.value);}catch(error){item.errors.push(error.message);}
   item.parents=[...(item.value.previousNoteId===null?[]:[item.value.previousNoteId]),...(Array.isArray(item.value.resolvedNoteIds)?item.value.resolvedNoteIds:[])];
   for(const id of item.parents){const parent=all.get(id);if(!parent)item.errors.push('Preceding note is missing: '+id);else if(caseKey(parent.value)!==key)item.errors.push('Preceding note has another account or contract binding: '+id);else if(parent.index>=item.index)item.errors.push('Preceding note was not saved before this edition: '+id);}
   if(!item.errors.length)for(const id of item.parents)used.add(id);
  }
  const tips=history.filter(item=>!used.has(item.note.id)),errors=history.flatMap(item=>item.errors.map(message=>({noteId:item.note.id,message})));
  const unique=errors.length===0&&tips.length===1,chosen=unique?tips[0]:null,first=history[0].value;
  return{key,caseId:first.caseId,binding:first.binding??null,account:first.account??null,history,tips,errors,unique,status:errors.length?'INVALID_HISTORY':tips.length===1?'CURRENT':'COMPETING_EDITIONS',note:chosen?.note??null,value:chosen?.value??null};
 });
}
export function currentCase(state,selection){const group=cases(state).find(row=>row.key===selection?.key);if(!group?.unique||group.note.id!==selection?.noteId)throw Error('The selected recovery case edition is no longer the unique current tip. Review its complete history before preparing.');return group;}
export function checkReferences(value,state){
 checkCase(value);
 for(const [key,records]of [['fileIds',state.files],['observationIds',state.observations],['planIds',state.plans],['eventIds',state.events]]){const ids=new Set((records??[]).map(x=>String(x.id??x.eventId)));for(const id of value[key])if(!ids.has(id))throw Error('The selected '+key+' original is not retained in this workspace: '+id);}
 const rows=cases(state),group=rows.find(row=>row.key===caseKey(value));
 if(!group){if(value.previousNoteId!==null||(value.resolvedNoteIds??[]).length)throw Error('The selected preceding case history is missing.');if(rows.some(row=>row.caseId===value.caseId))throw Error('This case ID already identifies another original account or contract. Copy to a new case ID.');}
 else{
  if(group.errors.length)throw Error('This history contains invalid ancestry. Retain it and explicitly copy the selected source to a new case.');
  const selected=[value.previousNoteId,...(value.resolvedNoteIds??[])],tips=group.tips.map(t=>t.note.id);
  if(!value.previousNoteId||selected.length!==tips.length||selected.some(id=>!tips.includes(id)))throw Error('The case has newer or competing editions. Select a current basis and acknowledge every current tip before saving.');
 }
 if(value.sourceCase){
  const s=value.sourceCase;for(const id of s.noteIds){const note=(state.notes??[]).find(n=>n.id===id),original=caseValue(note??{});if(!original||original.caseId!==s.caseId)throw Error('The copied case source note is not retained: '+id);if(Object.hasOwn(s,'binding')&&canonical(original.binding??null)!==canonical(s.binding))throw Error('Copied source contract binding changed.');if(Object.hasOwn(s,'account')&&(original.account??null)!==s.account)throw Error('Copied source account changed.');}
  if(s.caseId===value.caseId)throw Error('An explicit copy must use a new case identity.');
 }
 return value;
}
export function report(state,capabilities={}){return{schema:'principal.operator-review.v1',createdAt:new Date().toISOString(),source:SOURCE,sourceEdition:capabilities.sourceEdition??null,apiSha256:capabilities.apiSha256??state.apiSha256,workspace:state.workspace,config:state.config,topology:topology(state,capabilities.apiSha256??state.apiSha256),cases:cases(state),observations:state.observations??[],eventPages:state.eventPages??[],events:state.events??[],plans:state.plans??[],notes:state.notes??[],files:state.files??[],requests:state.requests??[]};}
export function reportHTML(record){
 const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const table=(rows,columns)=>'<div class="table-scroll"><table><thead><tr>'+columns.map(([t])=>'<th>'+esc(t)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+columns.map(([,f])=>'<td>'+esc(f(r))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 // Retain the complete original JSON without laying out tens of megabytes of
 // encoded request/source bodies as a single rendered text block.
 const complete=JSON.stringify(record).replaceAll('<','\\u003c');
 const downloadScript=`document.getElementById('download-review').addEventListener('click',()=>{const text=document.getElementById('complete-review').textContent;const url=URL.createObjectURL(new Blob([text+'\\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='principal-review-complete.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);});`;
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Principal operator review</title><style>body{max-width:1100px;margin:40px auto;padding:0 20px;font:15px/1.5 system-ui;color:#202020;overflow-wrap:anywhere}h1,h2{line-height:1.2}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:680px;margin:20px 0}td,th{border:1px solid #aaa;padding:8px;text-align:left;overflow-wrap:anywhere;min-width:96px}td:first-child,th:first-child{min-width:240px}button{font:inherit;padding:10px 14px;border:1px solid #888;background:#fff;cursor:pointer}.note{border-top:1px solid #ddd;padding:16px 0}@media(max-width:600px){body{margin:20px auto}table{font-size:12px}}</style><h1>Principal operator review</h1><p>Saved workspace '+esc(record.workspace?.name)+' · revision '+esc(record.workspace?.revision)+' · '+esc(record.createdAt)+'</p><p>Observations retain their original time, contract and selected source edition. Case stages are operator review records.</p><h2>Contract wiring</h2>'+table(record.topology,[['Contract',x=>x.contract],['Read',x=>x.method],['Expected',x=>x.expected],['Observed',x=>x.observed],['Status',x=>x.status]])+'<h2>Retained native market quotes</h2><p>Historical contract results; amounts are exact atoms and a quote does not reserve a price. Both directions charge SY fees.</p>'+table((record.observations??[]).filter(x=>x.actionId==='market_pool.quote_swap'&&x.status==='CLI_EXIT_0'&&!x.parseError),[['Observed',x=>x.createdAt],['Contract',x=>x.contractId],['Direction',x=>x.value?.sy_in?'SY to PT':'PT to SY'],['Input',x=>x.value?.amount_in],['Gross output',x=>x.value?.gross_amount_out],['Net output',x=>x.value?.amount_out],['Fee · SY',x=>x.value?.total_fee],['Source observation',x=>x.id]])+'<h2>Recovery cases</h2>'+table(record.cases,[['Case',x=>x.caseId],['Account',x=>x.account],['History',x=>x.status],['Stage',x=>x.value?.stage??'Explicit resolution required'],['Operator',x=>x.value?.operator??''],['Reason',x=>x.value?.reason??''],['Editions',x=>x.history.length]])+'<h2>Original files</h2>'+table(record.files??[],[['File',x=>x.name],['Bytes',x=>x.bytes],['SHA-256',x=>x.sha256]])+'<h2>Original requests</h2>'+table(record.requests??[],[['Request',x=>x.id],['Method',x=>x.envelope?.method],['State',x=>x.status],['Revision',x=>x.response?.revision??''],['Error',x=>x.error?.code??'']])+'<h2>Working notes</h2>'+(record.notes??[]).map(n=>'<section class="note"><h3>'+esc(n.title)+'</h3><p>'+esc(n.body)+'</p><p>'+esc(n.createdAt)+'</p></section>').join('')+'<h2>Complete saved review</h2><p>The full original review is embedded in this file, including every request body and result. Download it to inspect the complete JSON. The separate native workspace export also includes every original file byte and installed application member.</p><button id="download-review" type="button">Download complete saved review JSON</button><script id="complete-review" type="application/json">'+complete+'</script><script>'+downloadScript+'</script></html>';
}
