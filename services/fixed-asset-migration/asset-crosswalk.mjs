import * as E from './engine.mjs';
import {sha256Utf8} from './sha256.mjs';

/** Explicit correspondences over original selected rows. No source mutation,
 * posting, invented destination identity, cost allocation or ledger netting. */
export const SCHEMA='tjlabs.asset-crosswalk-event.v1';
export const PURPOSE='Asset identity crosswalk / tjlabs.asset-crosswalk-event.v1';
const clone=x=>JSON.parse(JSON.stringify(x));
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const stable=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
const hash=x=>sha256Utf8(stable(x)).sha256;
function need(ok,message,code='CROSSWALK_INPUT'){if(!ok){const e=Error(message);e.code=code;throw e;}}
function txt(value,label,max=4000){need(typeof value==='string'&&value.trim()&&value.length<=max,'Supply '+label+'.');sha256Utf8(value);return value;}
const key=(...v)=>JSON.stringify(v);
const domains=['assets','books'],roles=['source','target'];
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encode(text){const bytes=[];for(const c of text){const n=c.codePointAt(0);if(n<128)bytes.push(n);else if(n<2048)bytes.push(192|(n>>6),128|(n&63));else if(n<65536)bytes.push(224|(n>>12),128|((n>>6)&63),128|(n&63));else bytes.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));}let out='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2],v=(a<<16)|((b||0)<<8)|(c||0);out+=alphabet[v>>>18]+alphabet[(v>>>12)&63]+(b===undefined?'=':alphabet[(v>>>6)&63])+(c===undefined?'=':alphabet[v&63]);}return out;}
function decode(text){const bytes=[];for(let i=0;i<text.length;i+=4){const v=(alphabet.indexOf(text[i])<<18)|(alphabet.indexOf(text[i+1])<<12)|((text[i+2]==='='?0:alphabet.indexOf(text[i+2]))<<6)|(text[i+3]==='='?0:alphabet.indexOf(text[i+3]));bytes.push((v>>>16)&255);if(text[i+2]!=='=')bytes.push((v>>>8)&255);if(text[i+3]!=='=')bytes.push(v&255);}let out='';for(let i=0;i<bytes.length;){const a=bytes[i++];let n=a,count=0,min=0;if(a>=194&&a<=223){n=a&31;count=1;min=128;}else if(a>=224&&a<=239){n=a&15;count=2;min=2048;}else if(a>=240&&a<=244){n=a&7;count=3;min=65536;}else need(a<128,'Invalid original UTF-8 event.');for(let j=0;j<count;j++){const b=bytes[i++];need(b!==undefined&&(b&192)===128,'Incomplete original UTF-8 event.');n=(n<<6)|(b&63);}need(n>=min&&n<=1114111&&(n<55296||n>57343),'Invalid original UTF-8 event.');out+=String.fromCodePoint(n);}need(encode(out)===text,'Retain canonical original event bytes.');return out;}
function basis(workspace,revision=workspace.revision){
 const mappings={source:{},target:{}},sources=[],selected=new Set();
 for(const role of roles)for(const domain of domains){const m=workspace.mappingHistory.filter(x=>x.role===role&&x.domain===domain&&x.revision<=revision).at(-1);if(!m)continue;mappings[role][domain]=clone(m);selected.add(m.sourceId);}
 for(const id of selected){const s=workspace.sources.find(s=>s.id===id);need(s,'Retain the mapped original source.');sources.push({id:s.id,role:s.role,domain:s.domain,filename:s.filename,sha256:s.sha256,bytes:s.bytes,headers:s.headers});}
 return {workspaceId:workspace.id,mappings,sources,corrections:workspace.corrections.filter(c=>selected.has(c.sourceId)&&c.revision<=revision).map(clone)};
}
export function basisIdentity(workspace){E.validateWorkspace(workspace);return hash(basis(workspace));}
function sourceRows(workspace,selected,role,domain){
 const m=selected.mappings[role][domain];if(!m)return [];
 const source=workspace.sources.find(s=>s.id===m.sourceId),rows=new Map(source.rows.map(r=>[r.id,{...r,cells:r.cells.slice()}]));
 for(const c of selected.corrections)if(c.sourceId===source.id){const r=rows.get(c.rowId);need(r&&r.cells[c.column]===c.before,'Retain the complete original correction order.');r.cells[c.column]=c.value;}
 return [...rows.values()].map(r=>({sourceId:source.id,sourceSha256:source.sha256,mappingId:m.id,rowId:r.id,record:r.record,cells:r.cells,values:Object.fromEntries(E.DOMAINS[domain].fields.map(f=>[f.name,m.columns[f.name]===undefined?'':r.cells[m.columns[f.name]]??'']))}));
}
function pairsFor(workspace,selected,requested){
 need(Array.isArray(requested)&&requested.length<=E.LIMITS.rows*2,'Retain the complete asset and book correspondence list.');
 const indexes={};for(const role of roles)for(const domain of domains)indexes[key(role,domain)]=new Map(sourceRows(workspace,selected,role,domain).map(r=>[r.rowId,r]));
 const left=new Set(),right=new Set();
 return requested.map(p=>{
  need(plain(p)&&Object.keys(p).every(k=>['domain','sourceRowId','targetRowId'].includes(k))&&domains.includes(p.domain),'Select actual asset or book rows.');
  const a=indexes[key('source',p.domain)].get(p.sourceRowId),b=indexes[key('target',p.domain)].get(p.targetRowId);
  need(a&&b,'Both correspondence rows must belong to the selected source and returned target editions.');
  need(!left.has(key(p.domain,p.sourceRowId))&&!right.has(key(p.domain,p.targetRowId)),'Keep one source and one target per correspondence; splits and merges require a separate explicit migration scope.','CROSSWALK_NOT_ONE_TO_ONE');
  left.add(key(p.domain,p.sourceRowId));right.add(key(p.domain,p.targetRowId));
  return {domain:p.domain,source:clone(a),target:clone(b)};
 });
}
function blank(ws){return{schema:'tjlabs.asset-crosswalk-state.v1',workspaceId:ws.id,head:null,history:[],current:null};}
export function read(workspace){
 const ws=E.validateWorkspace(workspace),state=blank(ws),files=new Map(ws.supportingFiles.map(f=>[f.id,f])),seen=new Set();
 for(const op of ws.operations){
  if(op.kind!=='import-supporting')continue;const f=files.get(op.supportingInputId);if(f?.purpose!==PURPOSE||seen.has(f.id))continue;seen.add(f.id);
  const text=decode(f.base64),event=JSON.parse(text),input=event.input;
  need(event.schema===SCHEMA&&event.workspaceId===ws.id&&event.sequence===state.history.length+1&&event.previous===state.head&&event.operationId===op.id&&event.at===op.at,'Retain the complete ordered crosswalk journal.','CROSSWALK_HISTORY_CHANGED');
  need(plain(input)&&input.expectedRevision===op.previousRevision&&input.operationId===op.id&&event.requestSha256===hash(input),'Retain the exact original crosswalk request.','CROSSWALK_HISTORY_CHANGED');
  txt(input.actor,'the original reviewer',300);txt(input.reason,'the original decision reason');
  const selected=basis(ws,op.previousRevision);
  need(stable(event.basis)===stable(selected)&&input.basis_sha256===hash(selected)&&input.previous===state.head,'The saved crosswalk lost its original selected editions.','CROSSWALK_HISTORY_CHANGED');
  need(stable(event.pairs)===stable(pairsFor(ws,selected,input.pairs)),'A saved correspondence changed its original row values.','CROSSWALK_HISTORY_CHANGED');
  const item={...event,id:sha256Utf8(text).sha256,revision:op.revision};
  state.history.push(item);state.current=item;state.head=item.id;
 }
 return state;
}
export function save(workspace,input){
 E.validateWorkspace(workspace);need(plain(input),'Supply the complete reviewed correspondence.');
 txt(input.operationId,'the original operation ID',128);
 const old=workspace.operations.find(o=>o.id===input.operationId);
 if(old){const f=workspace.supportingFiles.find(f=>f.id===old.supportingInputId);need(f?.purpose===PURPOSE,'This operation belongs to another request.','OPERATION_CONFLICT');const event=JSON.parse(decode(f.base64));need(event.requestSha256===hash(input),'This operation already carries a different crosswalk request.','OPERATION_CONFLICT');read(workspace);return{workspace,receipt:clone(old),replayed:true};}
 need(input.expectedRevision===workspace.revision,'The original workspace changed; review the current edition.','REVISION_CONFLICT');
 const state=read(workspace),selected=basis(workspace);
 need(input.previous===state.head&&input.basis_sha256===hash(selected),'The reviewed correspondence or selected source editions changed.','CROSSWALK_BASIS_CHANGED');
 txt(input.actor,'a named reviewer',300);txt(input.reason,'the identity decision reason');
 const pairs=pairsFor(workspace,selected,input.pairs),original=E.reconcile(workspace),by={};
 for(const role of roles)for(const domain of domains)by[key(role,domain)]=new Map((original.domains[role][domain]?.rows||[]).map(r=>[r.rowId,r]));
 for(const p of pairs)for(const role of roles)need(by[key(role,p.domain)].get(p[role].rowId)?.valid,'Resolve missing/ambiguous/invalid original asset or book rows before linking them.');
 const at=input.at||new Date().toISOString(),event={schema:SCHEMA,workspaceId:workspace.id,sequence:state.history.length+1,previous:state.head,operationId:input.operationId,at,input:clone(input),requestSha256:hash(input),basis:selected,pairs};
 const text=JSON.stringify(event),saved=E.importSupportingFile(workspace,{operationId:input.operationId,expectedRevision:input.expectedRevision,at,filename:'asset-crosswalk-'+String(event.sequence).padStart(4,'0')+'.json',mimeType:'application/json',purpose:PURPOSE,base64:encode(text)});
 return {...saved,crosswalk:{id:sha256Utf8(text).sha256,pairs:pairs.length}};
}
function amountParts(value){need(typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value),'Use only original normalized exact decimal amounts.');const sign=value[0]==='-'?-1n:1n,p=value.replace(/^-/,'').split('.');return{n:BigInt(p.join(''))*sign,s:p[1]?.length||0};}
function sum(values){let n=0n,s=0;for(const v of values){const p=amountParts(v);if(p.s>s){n*=10n**BigInt(p.s-s);s=p.s;}n+=p.n*10n**BigInt(s-p.s);}const sign=n<0n?'-':'';let text=(n<0n?-n:n).toString().padStart(s+1,'0');if(s)text=text.slice(0,-s)+'.'+text.slice(-s);if(text.includes('.'))text=text.replace(/0+$/,'').replace(/\.$/,'');return sign+text;}
const difference=(target,source)=>sum([target,source==='0'?'0':source[0]==='-'?source.slice(1):'-'+source]);
function group(rows,fields){const out=new Map();for(const row of rows){const k=key(...fields.map(f=>row.values[f])),list=out.get(k)||[];list.push(row);out.set(k,list);}return out;}
export function reconcile(workspace){
 const ws=E.validateWorkspace(workspace),original=E.reconcile(ws),state=read(ws),selected=basis(ws),basis_sha256=hash(selected),current=state.current,basisCurrent=!!current&&current.input.basis_sha256===basis_sha256;
 const choices={source:{},target:{}};for(const role of roles)for(const domain of domains)choices[role][domain]=(original.domains[role][domain]?.rows||[]).map(r=>({...r,sourceId:original.domains[role][domain].sourceId}));
 const findings=[],links=[],coverage=[],balances=[],events=[],journalReferences=[],assetMap=new Map(),bookMap=new Map();
 const add=(code,message,details={})=>findings.push({code,message,...details});
 if(!current)add('NO_CROSSWALK','Save an attributed correspondence for the selected original rows.');
 else if(!basisCurrent)add('STALE_BASIS','Selected asset/book sources, mappings or corrections changed. Review and save a new crosswalk edition.');
 const pairs=basisCurrent?current.pairs:[],rowIndexes={},targetAssetMap=new Map();
 for(const role of roles)for(const domain of domains)rowIndexes[key(role,domain)]=new Map(choices[role][domain].map(r=>[r.rowId,r]));
 const matched={source:{assets:new Set(),books:new Set()},target:{assets:new Set(),books:new Set()}};
 for(const p of pairs){
  const source=rowIndexes[key('source',p.domain)].get(p.source.rowId),target=rowIndexes[key('target',p.domain)].get(p.target.rowId);
  if(!source?.valid||!target?.valid){add('INVALID_LINK','An original linked row is no longer valid.',{domain:p.domain,sourceRowId:p.source.rowId,targetRowId:p.target.rowId});continue;}
  matched.source[p.domain].add(source.rowId);matched.target[p.domain].add(target.rowId);
  const identityFields=p.domain==='assets'?['company_id','asset_id']:['company_id','book_id'];
  const entry={domain:p.domain,source:clone(p.source),target:clone(p.target),identityChanged:identityFields.some(f=>source.values[f]!==target.values[f]),attributes:E.DOMAINS[p.domain].fields.filter(f=>!identityFields.includes(f.name)&&f.name!=='parent_asset_id').map(f=>({field:f.name,source:source.values[f.name],target:target.values[f.name],equal:source.values[f.name]===target.values[f.name]})),hierarchy:null};
  links.push(entry);
  if(p.domain==='assets'){assetMap.set(key(source.values.company_id,source.values.asset_id),entry);targetAssetMap.set(key(target.values.company_id,target.values.asset_id),entry);}
  else {bookMap.set(key(source.values.company_id,source.values.book_id),entry);if(source.values.currency!==target.values.currency)add('CURRENCY_CHANGED','No currency conversion is inferred from a book correspondence.',{source:source.values,target:target.values});if(source.values.accounting_basis!==target.values.accounting_basis)add('ACCOUNTING_BASIS_CHANGED','The linked books have different declared accounting bases.',{source:source.values,target:target.values});}
 }
 for(const role of roles)for(const domain of domains){
  if(!original.domains[role][domain])add('SELECTION_MISSING','Select the original '+role+' '+domain+' mapping.',{role,domain});
  for(const row of choices[role][domain]){const status=!row.valid?'INVALID':matched[role][domain].has(row.rowId)?'LINKED':'UNLINKED';coverage.push({role,domain,rowId:row.rowId,values:clone(row.values),state:status});if(status!=='LINKED')add(status+'_ROW','The complete selected population contains an '+status.toLowerCase()+' '+domain+' row.',{role,domain,rowId:row.rowId});}
 }
 for(const link of links.filter(p=>p.domain==='assets')){
  const a=link.source.values,b=link.target.values,parent=a.parent_asset_id?assetMap.get(key(a.company_id,a.parent_asset_id)):null;
  const expected=a.parent_asset_id?(parent?.target.values.asset_id??null):'';
  const equal=expected!==null&&expected===b.parent_asset_id&&(!parent||parent.target.values.company_id===b.company_id);
  link.hierarchy={sourceParent:a.parent_asset_id,targetParent:b.parent_asset_id,expectedTargetParent:expected,state:equal?'MATCH':expected===null?'PARENT_UNLINKED':'DIFFERENCE'};
  if(!equal)add('HIERARCHY_'+link.hierarchy.state,'The original asset parent relationship does not resolve to the returned target parent.',{sourceRowId:link.source.rowId,targetRowId:link.target.rowId,...link.hierarchy});
 }
 for(const domain of ['balances','events']){
  const fields=domain==='balances'?['company_id','book_id','asset_id','as_of','currency','measure']:['company_id','book_id','asset_id','effective_date','currency','measure','event_type'];
  const amount=domain==='balances'?'amount':'signed_amount',source=original.domains.source[domain],target=original.domains.target[domain];
  if(!source&&!target)continue;
  if(!source||!target){add('FINANCIAL_SIDE_MISSING','Retain both original '+domain+' populations before mapped comparison.',{domain});continue;}
  const expected=new Map(),actual=group(target.rows,fields);
  for(const row of source.rows){
   const v=row.values,a=assetMap.get(key(v.company_id,v.asset_id)),b=bookMap.get(key(v.company_id,v.book_id));
   if(!row.valid||!a||!b||a.target.values.company_id!==b.target.values.company_id){add('FINANCIAL_ROW_UNRESOLVED','An original financial row needs valid asset/book links to the same target company.',{domain,rowId:row.rowId});continue;}
   const mapped={...v,company_id:a.target.values.company_id,asset_id:a.target.values.asset_id,book_id:b.target.values.book_id},k=key(...fields.map(f=>mapped[f])),list=expected.get(k)||[];list.push(row);expected.set(k,list);
  }
  for(const k of new Set([...expected.keys(),...actual.keys()])){
   const a=expected.get(k)||[],b=actual.get(k)||[],valid=a.every(r=>r.valid)&&b.every(r=>r.valid),ambiguous=domain==='balances'&&(a.length>1||b.length>1);
   const av=a.length&&valid&&!ambiguous?sum(a.map(r=>r.values[amount])):null,bv=b.length&&valid&&!ambiguous?sum(b.map(r=>r.values[amount])):null;
   const delta=av!==null&&bv!==null?difference(bv,av):null,status=!valid?'INVALID':ambiguous?'AMBIGUOUS':!a.length?'TARGET_ONLY':!b.length?'SOURCE_ONLY':delta==='0'?'MATCH':'DIFFERENCE';
   const result={key:k,scope:Object.fromEntries(fields.map((f,i)=>[f,JSON.parse(k)[i]])),source:av,target:bv,difference:delta,state:status,sourceRows:a.map(r=>({rowId:r.rowId,values:clone(r.values),rawValues:clone(r.rawValues)})),targetRows:b.map(r=>({rowId:r.rowId,values:clone(r.values),rawValues:clone(r.rawValues)}))};
   (domain==='balances'?balances:events).push(result);
   if(status!=='MATCH')add('MAPPED_'+status,'An exact mapped '+domain+' group remains unresolved.',{domain,key:k});
  }
 }
 for(const role of roles)for(const row of original.domains[role].journals?.rows||[]){
  const v=row.values;let link=null;if(v.asset_id)link=role==='source'?assetMap.get(key(v.company_id,v.asset_id)):targetAssetMap.get(key(v.company_id,v.asset_id));
  journalReferences.push({role,rowId:row.rowId,values:clone(v),rawValues:clone(row.rawValues),assetLink:link?{sourceRowId:link.source.rowId,targetRowId:link.target.rowId}:null,state:!row.valid?'INVALID':!v.asset_id?'NO_ASSET_ON_ORIGINAL':link?'LINKED':'UNLINKED'});
  if(!row.valid||v.asset_id&&!link)add('JOURNAL_REFERENCE_UNRESOLVED','The independent original journal line has an invalid or unlinked asset reference.',{role,rowId:row.rowId});
 }
 const monetaryCompared=balances.length+events.length>0;
 const ready=basisCurrent&&findings.length===0&&monetaryCompared&&original.financial.confirmed;
 return {schema:'tjlabs.asset-crosswalk-reconciliation.v1',workspaceId:ws.id,revision:ws.revision,basis_sha256,basisCurrent,head:state.head,history:state.history,choices,links,coverage,balances,events,journalReferences,independentFinancial:clone(original.financial),literalComparison:clone(original.summary),findings,ready,
 summary:{assetLinks:links.filter(x=>x.domain==='assets').length,bookLinks:links.filter(x=>x.domain==='books').length,unlinked:coverage.filter(x=>x.state!=='LINKED').length,findings:findings.length,balanceGroups:balances.length,eventGroups:events.length,monetaryCompared,independentFinanceConfirmed:original.financial.confirmed},
 meaning:'Reviewed one-to-one identity correspondence and exact mapped financial groups. Event totals do not prove historical event-ID or journal-line parity. Original independent journals, population attestations, literal comparisons and work-order allocation remain separate. No posting or source rewrite.'};
}
const htmlEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeCell=v=>/^[=+\-@\t\r\n]/.test(String(v??''))?"'"+String(v??''):String(v??'');
export function exportFiles(workspace){
 const report=reconcile(workspace),files=[],add=(path,type,text)=>files.push({path,type,text,...sha256Utf8(text)});
 add('asset-crosswalk/reconciliation.json','application/json',JSON.stringify(report,null,2)+'\n');
 add('asset-crosswalk/history.json','application/json',JSON.stringify({schema:'tjlabs.asset-crosswalk-history.v1',workspaceId:workspace.id,history:report.history},null,2)+'\n');
 add('asset-crosswalk/correspondences.csv','text/csv',E.encodeCsv([['domain','source_row_id','source_company','source_id','target_row_id','target_company','target_id','source_parent','target_parent','hierarchy'],...report.links.map(p=>[p.domain,p.source.rowId,p.source.values.company_id,p.source.values[E.DOMAINS[p.domain].id],p.target.rowId,p.target.values.company_id,p.target.values[E.DOMAINS[p.domain].id],p.source.values.parent_asset_id??'',p.target.values.parent_asset_id??'',p.hierarchy?.state??''].map(safeCell))]));
 for(const [name,rows]of [['balances',report.balances],['events',report.events]])add('asset-crosswalk/'+name+'.csv','text/csv',E.encodeCsv([['target_scope','source_amount','target_amount','target_minus_source','state','source_row_ids','target_row_ids'],...rows.map(r=>[JSON.stringify(r.scope),r.source??'',r.target??'',r.difference??'',r.state,JSON.stringify(r.sourceRows.map(x=>x.rowId)),JSON.stringify(r.targetRows.map(x=>x.rowId))].map(safeCell))]));
 const table=(headers,rows)=>'<div style="overflow:auto"><table><thead><tr>'+headers.map(x=>'<th>'+htmlEscape(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+htmlEscape(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Asset identity crosswalk</title><style>body{font:16px system-ui;color:#222;background:#fff;max-width:1200px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:.55rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f5f5f5}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Asset identity crosswalk</h1><p>'+htmlEscape(workspace.title)+' · revision '+workspace.revision+'</p><p>'+htmlEscape(report.meaning)+'</p><p>Mapped checks complete: '+report.ready+'. Selected identity basis current: '+report.basisCurrent+'. Independent financial basis confirmed: '+report.independentFinancial.confirmed+'.</p><h2>Selected asset and book correspondences</h2>'+table(['Domain','Original source','Returned target','Parent check','Attribute changes'],report.links.map(p=>[p.domain,JSON.stringify(p.source.values),JSON.stringify(p.target.values),p.hierarchy?.state??'',p.attributes.filter(a=>!a.equal).map(a=>a.field+': '+a.source+' → '+a.target).join('\n')]))+['balances','events'].map(name=>'<h2>Mapped '+name+'</h2>'+table(['Target scope','Source amount','Target amount','Target − source','State'],report[name].map(r=>[JSON.stringify(r.scope),r.source,r.target,r.difference,r.state]))).join('')+'<h2>Unresolved findings</h2>'+table(['Finding','Original evidence'],report.findings.map(f=>[f.message,JSON.stringify(f)]))+'<h2>Independent journal checks</h2>'+table(['Role','Company / book / journal / currency','Debit','Credit','Difference','State'],report.independentFinancial.journals.map(r=>[r.role,[r.company_id,r.book_id,r.journal_id,r.currency].join(' / '),r.debit,r.credit,r.difference,r.state]))+'<h2>Attribution and complete history</h2>'+table(['Revision','Reviewer','Reason','Time','Edition'],report.history.map(h=>[h.revision,h.input.actor,h.input.reason,h.at,h.id]))+'<p>CSV spreadsheet exports prefix formula-leading values with an apostrophe. JSON and retained original CSV preserve exact text. Complete original rows and source identities are in reconciliation.json and the editable workspace.</p><footer>TokenJunkieLabs · '+htmlEscape(workspace.id)+'</footer></html>';
 add('asset-crosswalk/report.html','text/html',html);return{report,files};
}
export function appendHandover(workspace,packet){
 const extra=exportFiles(workspace),files=packet.files.filter(f=>f.path!=='MANIFEST.json'),names=new Set(files.map(f=>f.path));
 for(const f of extra.files){need(!names.has(f.path),'An original handover member collides with the crosswalk.');names.add(f.path);files.push(f);}
 const manifest={...packet.manifest,assetCrosswalk:{head:extra.report.head,ready:extra.report.ready,basisCurrent:extra.report.basisCurrent,summary:extra.report.summary},files:files.map(({text,base64,...f})=>f)},text=JSON.stringify(manifest,null,2)+'\n';files.push({path:'MANIFEST.json',type:'application/json',text,...sha256Utf8(text)});
 return {...packet,files,manifest,assetCrosswalk:extra.report};
}

/** Original row IDs are generated internally from source hash + record number. */
export const scheduleCsv=rows=>E.encodeCsv(rows);
export function parseSchedule(workspace,text){
 const parsed=E.parseCsv(text),required=['domain','source_row_id','target_row_id'];
 need(parsed.headers.length===3&&new Set(parsed.headers).size===3&&required.every(h=>parsed.headers.includes(h)),'Use exactly domain, source_row_id and target_row_id headings.');
 const seen=new Set(),pairs=[],selected=basis(workspace),originalRows=Object.fromEntries(domains.map(domain=>[domain,new Set(sourceRows(workspace,selected,'source',domain).map(r=>r.rowId))]));
 for(const row of parsed.rows){need(row.length===3,'Retain each complete schedule row.');const value=Object.fromEntries(parsed.headers.map((h,i)=>[h,row[i]]));need(domains.includes(value.domain),'Select assets or books in each schedule row.');need(originalRows[value.domain].has(value.source_row_id),'Every schedule row must select an actual original source row, including unlinked rows.');const identity=key(value.domain,value.source_row_id);need(!seen.has(identity),'Keep one complete schedule row per original source.');seen.add(identity);if(value.target_row_id)pairs.push({domain:value.domain,sourceRowId:value.source_row_id,targetRowId:value.target_row_id});}
 pairsFor(workspace,selected,pairs);return pairs;
}
