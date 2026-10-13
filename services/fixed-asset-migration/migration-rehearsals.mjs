import * as E from './engine.mjs';
import * as W from './work-orders.mjs';
import * as X from './asset-crosswalk.mjs';
import {sha256Utf8} from './sha256.mjs';

/** Named observations of an exact original operation prefix. All calculations use the unchanged original engines;
 * captured reports remain immutable historical observations across upgrades. */
export const SCHEMA='tjlabs.migration-rehearsal-edition.v1';
export const PURPOSE='Migration rehearsal edition / tjlabs.migration-rehearsal-edition.v1';
export const KINDS=Object.freeze(['rehearsal','returned-export','handover-review','checkpoint']);
const clone=v=>JSON.parse(JSON.stringify(v));
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const hash=v=>sha256Utf8(stable(v)).sha256;
function need(ok,message,code='REHEARSAL_INPUT'){if(!ok){const e=Error(message);e.code=code;throw e;}}
function text(v,label,max=4000){need(typeof v==='string'&&v.trim()&&v.length<=max,'Supply '+label+'.');sha256Utf8(v);return v;}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csvCell=v=>{const s=String(v??'');return /^[\s]*[=+\-@]/.test(s)?"'"+s:s;};
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encode(text){const bytes=[];for(const c of text){const n=c.codePointAt(0);if(n<128)bytes.push(n);else if(n<2048)bytes.push(192|(n>>6),128|(n&63));else if(n<65536)bytes.push(224|(n>>12),128|((n>>6)&63),128|(n&63));else bytes.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));}let out='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2],v=(a<<16)|((b||0)<<8)|(c||0);out+=alphabet[v>>>18]+alphabet[(v>>>12)&63]+(b===undefined?'=':alphabet[(v>>>6)&63])+(c===undefined?'=':alphabet[v&63]);}return out;}
function decode(text){const bytes=[];for(let i=0;i<text.length;i+=4){const v=(alphabet.indexOf(text[i])<<18)|(alphabet.indexOf(text[i+1])<<12)|((text[i+2]==='='?0:alphabet.indexOf(text[i+2]))<<6)|(text[i+3]==='='?0:alphabet.indexOf(text[i+3]));bytes.push((v>>>16)&255);if(text[i+2]!=='=')bytes.push((v>>>8)&255);if(text[i+3]!=='=')bytes.push(v&255);}let out='';for(let i=0;i<bytes.length;){const a=bytes[i++];let n=a,count=0,min=0;if(a>=194&&a<=223){n=a&31;count=1;min=128;}else if(a>=224&&a<=239){n=a&15;count=2;min=2048;}else if(a>=240&&a<=244){n=a&7;count=3;min=65536;}else need(a<128,'Invalid original UTF-8 event.');for(let j=0;j<count;j++){const b=bytes[i++];need(b!==undefined&&(b&192)===128,'Incomplete original UTF-8 event.');n=(n<<6)|(b&63);}need(n>=min&&n<=1114111&&(n<55296||n>57343),'Invalid original UTF-8 event.');out+=String.fromCodePoint(n);}need(encode(out)===text,'Retain canonical original event bytes.');return out;}
// A lossless JSON value DAG retains repeated full report rows and strings once.
// Nodes are post-ordered: every reference points backward, so decoding cannot cycle.
function packEvidence(value){
 const nodes=[],shapes=[],seen=new Map(),shapeIds=new Map();
 function encodeValue(v){
  let node;
  if(v===null||typeof v!=='object')node=v;
  else if(Array.isArray(v))node=[0,...v.map(encodeValue)];
  else{const keys=Object.keys(v),signature=JSON.stringify(keys);let shape=shapeIds.get(signature);if(shape===undefined){shape=shapes.length;shapes.push(keys);shapeIds.set(signature,shape);}node=[1,shape,...keys.map(k=>encodeValue(v[k]))];}
  const signature=JSON.stringify(node);need(signature!==undefined,'Capture complete JSON report values.');
  let id=seen.get(signature);if(id===undefined){id=nodes.length;nodes.push(node);seen.set(signature,id);}return id;
 }
 const root=encodeValue(value);return {schema:'tjlabs.migration-rehearsal-evidence.v1',shapes,nodes,root};
}
function unpackEvidence(value){
 need(value?.schema==='tjlabs.migration-rehearsal-evidence.v1'&&Array.isArray(value.shapes)&&Array.isArray(value.nodes),'Retain the complete captured report encoding.');
 for(const keys of value.shapes)need(Array.isArray(keys)&&keys.every(k=>typeof k==='string')&&new Set(keys).size===keys.length,'Retain distinct original report object keys.');
 const decoded=[];
 for(const node of value.nodes){
  if(!Array.isArray(node)){need(node===null||['string','boolean','number'].includes(typeof node),'Retain JSON report scalar values.');decoded.push(node);continue;}
  need(node[0]===0||node[0]===1,'Retain the original report node kind.');
  const start=node[0]===0?1:2,refs=node.slice(start);
  need(refs.every(id=>Number.isSafeInteger(id)&&id>=0&&id<decoded.length),'Retain complete acyclic report references.');
  if(node[0]===0)decoded.push(refs.map(id=>decoded[id]));
  else{const keys=value.shapes[node[1]];need(Number.isSafeInteger(node[1])&&keys?.length===refs.length,'Retain original report keys and every value.');decoded.push(Object.fromEntries(keys.map((k,i)=>[k,decoded[refs[i]]])));}
 }
 need(Number.isSafeInteger(value.root)&&value.root>=0&&value.root<decoded.length,'Retain the complete captured report root.');
 return decoded[value.root];
}
function selectedPrefix(ws,revision){
 need(Number.isSafeInteger(revision)&&revision>=0&&revision<=ws.revision,'Select an actual retained workspace revision.');
 const operations=ws.operations.slice(0,revision),sourceIds=new Set(operations.filter(o=>o.kind==='import-csv').map(o=>o.sourceInputId)),supportIds=new Set(operations.filter(o=>o.kind==='import-supporting').map(o=>o.supportingInputId));
 const mappings={source:{},target:{}},mappingHistory=ws.mappingHistory.filter(m=>m.revision<=revision);
 for(const m of mappingHistory)mappings[m.role][m.domain]=m;
 const financePolicyHistory=ws.financePolicyHistory.filter(p=>p.revision<=revision),financePolicies=[];
 for(const p of financePolicyHistory){const i=financePolicies.findIndex(old=>old.id===p.id);if(i<0)financePolicies.push(p);else financePolicies[i]=p;}
 return {...ws,revision,operations,sources:ws.sources.filter(s=>sourceIds.has(s.id)),supportingFiles:ws.supportingFiles.filter(f=>supportIds.has(f.id)),
  mappings,mappingHistory,corrections:ws.corrections.filter(c=>c.revision<=revision),financePolicies,financePolicyHistory};
}
export function workspaceAt(workspace,revision){E.validateWorkspace(workspace);return clone(E.validateWorkspace(selectedPrefix(workspace,revision)));}
function prefixIdentity(ws){
 const {sources,supportingFiles,...rest}=ws;
 return hash({...rest,sources:sources.map(({text,rows,...s})=>s),supportingFiles:supportingFiles.map(({base64,...f})=>f)});
}
function evidence(ws){return {finance:E.reconcile(ws),workOrders:W.reconcile(ws),crosswalk:X.reconcile(ws)};}
function summary(reports){return {
 finance:{ready:reports.finance.ready,...reports.finance.summary,financialConfirmed:reports.finance.financial.confirmed},
 workOrders:{ready:reports.workOrders.ready,accepted:reports.workOrders.accepted,...reports.workOrders.summary},
 crosswalk:{ready:reports.crosswalk.ready,basisCurrent:reports.crosswalk.basisCurrent,...reports.crosswalk.summary}
};}
function origins(ws){
 return {finance:ws.sources.map(s=>({id:s.id,role:s.role,domain:s.domain,filename:s.filename,bytes:s.bytes,sha256:s.sha256,rows:s.rows.length,selected:ws.mappings[s.role]?.[s.domain]?.sourceId===s.id})),
  supporting:ws.supportingFiles.map(({base64,...f})=>f),
  workOrders:W.read(ws).sources.map(s=>({id:s.id,role:s.role,domain:s.domain,filename:s.filename,bytes:s.bytes,sha256:s.sha256,rows:s.rows.length}))};
}
function observation(ws,reports){
 return {schema:'tjlabs.migration-rehearsal-preview.v1',workspaceId:ws.id,revision:ws.revision,prefix_sha256:prefixIdentity(ws),evidence_sha256:hash(reports),summary:summary(reports),sources:origins(ws),
  meaning:'Observation of this exact original revision. Saving adds a supporting event; original financial policies must be reaffirmed afterward.'};
}
export function preview(workspace){const ws=E.validateWorkspace(workspace);return observation(ws,evidence(ws));}
export function list(workspace){
 const ws=E.validateWorkspace(workspace),files=new Map(ws.supportingFiles.map(f=>[f.id,f])),editions=[];let head=null;
 for(const op of ws.operations){
  if(op.kind!=='import-supporting')continue;const f=files.get(op.supportingInputId);if(f?.purpose!==PURPOSE)continue;
  const r=JSON.parse(decode(f.base64));
  need(r.schema===SCHEMA&&r.workspaceId===ws.id&&r.operationId===op.id&&r.sequence===editions.length+1&&r.previous===head,'The original rehearsal sequence changed.','REHEARSAL_HISTORY_CHANGED');
  need(r.revision===op.previousRevision&&r.savedRevision===op.revision&&r.at===op.at&&r.request_sha256===hash(r.request),'Retain the exact saved review request and revision.','REHEARSAL_HISTORY_CHANGED');
  need(r.request.operationId===op.id&&r.request.expectedRevision===op.previousRevision&&r.request.previous===head&&r.request.expectedEvidenceSha256===r.evidence_sha256,'The review no longer names its original evidence.','REHEARSAL_HISTORY_CHANGED');
  need(KINDS.includes(r.kind)&&r.kind===r.request.kind&&r.label===r.request.label&&r.actor===r.request.actor&&r.reference===r.request.reference&&r.note===r.request.note,'Retain the original review attribution.','REHEARSAL_HISTORY_CHANGED');
  const prefix=selectedPrefix(ws,r.revision);need(prefixIdentity(prefix)===r.prefix_sha256,'The captured original operation prefix changed.','REHEARSAL_PREFIX_CHANGED');
  const expected={...r};delete expected.id;need(r.id==='rehearsal-'+hash(expected),'The named edition identity changed.','REHEARSAL_HISTORY_CHANGED');
  need(plain(r.evidence)&&hash(unpackEvidence(r.evidence))===r.evidence_sha256,'The complete captured reports changed.','REHEARSAL_EVIDENCE_CHANGED');
  const {evidence,...metadata}=r;editions.push({...metadata,supportingFileId:f.id,file_sha256:f.sha256,file_bytes:f.bytes});head=r.id;
 }
 return {schema:'tjlabs.migration-rehearsal-history.v1',workspaceId:ws.id,revision:ws.revision,head,editions};
}
export function save(workspace,input){
 E.validateWorkspace(workspace);need(plain(input),'Supply the complete review request.');
 const allowed=['operationId','expectedRevision','at','previous','expectedEvidenceSha256','kind','label','actor','reference','note'];
 need(Object.keys(input).every(k=>allowed.includes(k)),'Use the documented reviewed-edition fields.');
 const old=workspace.operations.find(o=>o.id===input.operationId);
 if(old){const retained=list(workspace).editions.find(e=>e.operationId===input.operationId);need(retained&&retained.request_sha256===hash(input),'This original operation ID belongs to another request.','OPERATION_CONFLICT');return {workspace,receipt:clone(old),replayed:true,edition:retained};}
 need(input.expectedRevision===workspace.revision,'The workspace changed; reopen the current review before saving.','REVISION_CONFLICT');
 text(input.operationId,'stable operation ID',128);text(input.label,'named edition',240);text(input.actor,'reviewer',300);text(input.reference,'actual export/rehearsal reference',2000);text(input.note,'review note',8000);
 need(KINDS.includes(input.kind),'Select rehearsal, returned-export, handover-review or checkpoint.');
 const history=list(workspace);need(input.previous===history.head,'The last review edition changed.','REHEARSAL_HEAD_CHANGED');
 const captured=evidence(workspace),current=observation(workspace,captured);need(input.expectedEvidenceSha256===current.evidence_sha256,'The actual evidence changed; review the current original results.','REHEARSAL_EVIDENCE_CHANGED');
 const at=input.at||new Date().toISOString(),body={schema:SCHEMA,workspaceId:workspace.id,operationId:input.operationId,sequence:history.editions.length+1,previous:history.head,revision:workspace.revision,savedRevision:workspace.revision+1,at,
  kind:input.kind,label:input.label,actor:input.actor,reference:input.reference,note:input.note,request:clone(input),request_sha256:hash(input),
  prefix_sha256:current.prefix_sha256,evidence_sha256:current.evidence_sha256,summary:current.summary,sources:current.sources,evidence:packEvidence(captured),keyDefinitions:Object.fromEntries(Object.entries(inventory(captured)).map(([name,value])=>[name,value.keys]))};
 const record={...body,id:'rehearsal-'+hash(body)},value=JSON.stringify(record)+'\n';
 const result=E.importSupportingFile(workspace,{operationId:input.operationId,expectedRevision:input.expectedRevision,at,filename:record.id+'.json',mimeType:'application/json',purpose:PURPOSE,base64:encode(value)});
 return {...result,edition:list(result.workspace).editions.at(-1)};
}
export function inspect(workspace,id){
 const record=list(workspace).editions.find(r=>r.id===id);need(record,'Select an actual saved rehearsal edition.','REHEARSAL_MISSING');
 const prefix=workspaceAt(workspace,record.revision),file=workspace.supportingFiles.find(f=>f.id===record.supportingFileId),saved=JSON.parse(decode(file.base64));
 need(stable(origins(prefix))===stable(record.sources),'The captured original source descriptors changed.','REHEARSAL_EVIDENCE_CHANGED');
 return {schema:'tjlabs.migration-rehearsal-inspection.v1',record,reports:clone(unpackEvidence(saved.evidence))};
}
export function exportRevision(workspace,id){const result=inspect(workspace,id);return E.exportWorkspace(workspaceAt(workspace,result.record.revision));}
function inventory(reports,capturedKeys=null){
 const families={};
 for(const role of ['source','target'])for(const [domain,data]of Object.entries(reports.finance.domains[role])){
  const financial=['balances','events','journals','controls'].includes(domain),books=reports.finance.domains[role].books?.rows||[];
  const rows=data.rows.map(row=>{
   if(!financial)return row;
   const matches=books.filter(b=>b.values.company_id===row.values.company_id&&b.values.book_id===row.values.book_id);
   const book=matches.length===1&&matches[0].valid===true&&matches[0].values.currency===row.values.currency&&matches[0].values.accounting_basis?matches[0]:null;
   return {...row,comparisonContext:{book:book?clone(book):null,accounting_basis:book?.values.accounting_basis||null}};
  });
  families['finance/'+role+'/'+domain]={keys:E.DOMAINS[domain].key,rows};
 }
 for(const role of ['source','target'])for(const [domain,rows]of Object.entries(reports.workOrders.domains[role]))families['work-orders/'+role+'/'+domain]={keys:domain==='orders'?['company_id','work_order_id']:['company_id','work_order_id','line_id'],rows};
 if(capturedKeys)for(const [name,family]of Object.entries(families)){need(Array.isArray(capturedKeys[name])&&capturedKeys[name].length,'Retain the original population key definition.');family.keys=capturedKeys[name];}
 return families;
}
function scalarChanges(before,after){const keys=[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].sort();return keys.filter(k=>stable(before?.[k]??null)!==stable(after?.[k]??null)).map(field=>({field,before:before?.[field]??null,after:after?.[field]??null}));}
function exactDelta(after,before){function pair(s){need(typeof s==='string'&&/^-?\d+(?:\.\d+)?$/.test(s),'Keep canonical exact decimal strings.');const neg=s[0]==='-',parts=s.replace(/^-/,'').split('.');return {n:BigInt(parts.join(''))*(neg?-1n:1n),scale:parts[1]?.length||0};}const a=pair(after),b=pair(before),scale=Math.max(a.scale,b.scale),n=a.n*10n**BigInt(scale-a.scale)-b.n*10n**BigInt(scale-b.scale),sign=n<0n?'-':'',v=(n<0n?-n:n).toString().padStart(scale+1,'0');let value=sign+(scale?v.slice(0,-scale)+'.'+v.slice(-scale):v);if(value.includes('.'))value=value.replace(/0+$/,'').replace(/\.$/,'');return /^-?0$/.test(value)?'0':value;}
function compareFamily(name,left,right){
 const keys=(left||right).keys;need(stable(left?.keys||keys)===stable(right?.keys||keys),'The original family key definition changed.');
 const index=rows=>{const map=new Map();for(const row of rows){const values=row.values||{},key=JSON.stringify(keys.map(k=>values[k]??null));if(!map.has(key))map.set(key,[]);map.get(key).push(row);}return map;};
 const a=index(left?.rows||[]),b=index(right?.rows||[]),rows=[];
 for(const key of [...new Set([...a.keys(),...b.keys()])].sort()){
  const before=a.get(key)||[],after=b.get(key)||[],ambiguous=before.length>1||after.length>1;
  const valuesChanged=before.length===1&&after.length===1&&stable(before[0].values)!==stable(after[0].values);
  const rawChanged=before.length===1&&after.length===1&&stable(before[0].rawValues||before[0].cells)!==stable(after[0].rawValues||after[0].cells);
  const state=ambiguous?'AMBIGUOUS':!before.length?'ADDED':!after.length?'REMOVED':valuesChanged?'CHANGED':rawChanged?'RAW_CHANGED':'UNCHANGED';
  const changes=!ambiguous&&before.length&&after.length?scalarChanges(before[0].values,after[0].values):[];
  const monetary=[];
  if(before.length===1&&after.length===1&&!ambiguous){
   const x=before[0].values,y=after[0].values;
   for(const field of ['amount','signed_amount','debit','credit','cost_amount','quantity']){
    if(!(field in x)&&!(field in y))continue;
    const scope=['company_id','book_id','currency','measure','as_of','effective_date','posting_date','cost_basis','asset_id','account_code','event_type',...(field==='quantity'?['unit_code']:[])];
    const valid=before[0].valid!==false&&after[0].valid!==false;
    const bookScoped=name.startsWith('finance/'),leftBasis=before[0].comparisonContext?.accounting_basis,rightBasis=after[0].comparisonContext?.accounting_basis;
    const basisCompatible=!bookScoped||!!leftBasis&&leftBasis===rightBasis;
    const compatible=valid&&basisCompatible&&scope.every(k=>(x[k]??null)===(y[k]??null))&&(field!=='quantity'||!!x.unit_code);
    const available=typeof x[field]==='string'&&typeof y[field]==='string'&&/^-?\d+(?:\.\d+)?$/.test(x[field])&&/^-?\d+(?:\.\d+)?$/.test(y[field]);
    monetary.push({field,before:x[field]??null,after:y[field]??null,delta:compatible&&available?exactDelta(y[field],x[field]):null,
     reason:!valid?'An original row is invalid; no arithmetic is inferred':!basisCompatible?'The selected book accounting basis is missing, invalid or changed':!compatible?'Scope or quantity unit changed; no arithmetic across them':!available?'An original value is missing or invalid':null});
   }
  }
  rows.push({family:name,key,state,before,after,changes,monetary});
 }
 return {family:name,keys,beforeSelected:!!left,afterSelected:!!right,beforeRows:left?.rows.length||0,afterRows:right?.rows.length||0,
  counts:Object.fromEntries(['UNCHANGED','RAW_CHANGED','CHANGED','ADDED','REMOVED','AMBIGUOUS'].map(k=>[k,rows.filter(r=>r.state===k).length])),rows};
}
function changeList(before,after){const a=new Map(),b=new Map();for(const row of before){const k=hash(row);a.set(k,{value:row,count:(a.get(k)?.count||0)+1});}for(const row of after){const k=hash(row);b.set(k,{value:row,count:(b.get(k)?.count||0)+1});}return [...new Set([...a.keys(),...b.keys()])].map(key=>({key,beforeCount:a.get(key)?.count||0,afterCount:b.get(key)?.count||0,value:a.get(key)?.value||b.get(key)?.value})).filter(r=>r.beforeCount!==r.afterCount);}
export function compare(workspace,beforeId,afterId){
 need(beforeId!==afterId,'Select two distinct original review editions.');
 const before=inspect(workspace,beforeId),after=inspect(workspace,afterId);
 need(before.record.revision<after.record.revision,'Choose the earlier original revision first.');
 const a=inventory(before.reports,before.record.keyDefinitions),b=inventory(after.reports,after.record.keyDefinitions),families=[...new Set([...Object.keys(a),...Object.keys(b)])].sort().map(name=>compareFamily(name,a[name],b[name]));
 const findings={finance:changeList(before.reports.finance.issues,after.reports.finance.issues),workOrders:changeList(before.reports.workOrders.issues,after.reports.workOrders.issues),crosswalk:changeList(before.reports.crosswalk.findings,after.reports.crosswalk.findings)};
 const mapped={};for(const name of ['balances','events'])mapped[name]=compareFamily('mapped/'+name,{keys:['comparison_key'],rows:before.reports.crosswalk[name].map(r=>({rowId:r.key,values:{comparison_key:r.key,...r.scope,source:r.source,target:r.target,difference:r.difference,state:r.state},original:r}))},{keys:['comparison_key'],rows:after.reports.crosswalk[name].map(r=>({rowId:r.key,values:{comparison_key:r.key,...r.scope,source:r.source,target:r.target,difference:r.difference,state:r.state},original:r}))});
 return {schema:'tjlabs.migration-rehearsal-comparison.v1',workspaceId:workspace.id,before,after,families,mapped,findings,
  summary:{changed:families.reduce((n,f)=>n+f.counts.CHANGED,0),rawChanged:families.reduce((n,f)=>n+f.counts.RAW_CHANGED,0),added:families.reduce((n,f)=>n+f.counts.ADDED,0),removed:families.reduce((n,f)=>n+f.counts.REMOVED,0),ambiguous:families.reduce((n,f)=>n+f.counts.AMBIGUOUS,0)},
  meaning:'After minus before within exact unchanged currency/date/basis/unit scope only. Row identity uses original declared keys, never row position or a guessed cross-edition equivalence. Findings show exact list membership changes, not inferred resolution. Mapped identity and literal parity remain separate.'};
}
const table=(headers,rows)=>'<div class="scroll"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function html(title,body){return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>body{font:16px/1.5 system-ui;max-width:1300px;margin:24px auto;padding:0 18px;color:#222;background:#fff}h1,h2{line-height:1.2}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#f5f5f5}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{margin:30px 0}code{overflow-wrap:anywhere}</style><h1>'+esc(title)+'</h1>'+body+'<footer><p>TokenJunkieLabs · original retained migration evidence and named edition identities.</p></footer></html>';}
function reportHtml(result){
 const records=result.before?[result.before.record,result.after.record]:[result.record];
 let body='<p>Captured observations retain the original revision, source editions and complete calculated reports. Compare those historical results while reviewing current financial policies and acceptance in their original desks.</p>'+table(['Edition','Kind','Captured revision','Saved revision','Reviewer','Original reference','Note'],records.map(r=>[r.label,r.kind,r.revision,r.savedRevision,r.actor,r.reference,r.note]));
 body+='<p>Financial policies, literal parity, mapped identity and work-order acceptance retain their independent meanings. Saving a review adds original supporting evidence; current financial policy reviews may require reaffirmation.</p>';
 if(result.families){body+='<p>'+esc(result.meaning)+'</p>';for(const family of [...result.families,...Object.values(result.mapped)]){const changed=family.rows.filter(r=>r.state!=='UNCHANGED');body+='<section><h2>'+esc(family.family)+'</h2><p>Earlier '+family.beforeRows+' rows; later '+family.afterRows+' rows. '+changed.length+' changed/added/removed/ambiguous keys; complete unchanged rows remain in JSON.</p>'+table(['Original key','State','Before exact values','After exact values','Field changes','Exact amount changes'],changed.map(r=>[r.key,r.state,JSON.stringify(r.before.map(x=>x.values)),JSON.stringify(r.after.map(x=>x.values)),JSON.stringify(r.changes),JSON.stringify(r.monetary)]))+'</section>';}
 body+='<section><h2>Exact finding membership changes</h2><pre>'+esc(JSON.stringify(result.findings,null,2))+'</pre></section>';}
 else body+='<section><h2>Captured outcome summary</h2><pre>'+esc(JSON.stringify(result.record.summary,null,2))+'</pre></section><section><h2>Complete original evidence</h2><pre>'+esc(JSON.stringify(result.reports,null,2))+'</pre></section>';
 return html(result.families?'Migration rehearsal comparison':'Migration rehearsal: '+result.record.label,body);
}
export function exportFiles(workspace,selection={}){
 const history=list(workspace),after=selection.after||history.editions.at(-1)?.id,before=selection.before||(selection.after?null:history.editions.at(-2)?.id);
 need(after,'Save a named original edition before exporting its evidence.');
 const result=before?compare(workspace,before,after):inspect(workspace,after),files=[];
 const add=(path,type,text)=>files.push({path,type,text,...sha256Utf8(text)});
 add('rehearsals/history.json','application/json',JSON.stringify(history,null,2)+'\n');
 add('rehearsals/review.json','application/json',JSON.stringify(result,null,2)+'\n');
 add('rehearsals/report.html','text/html;charset=utf-8',reportHtml(result));
 const rows=[['family','original_key','state','before_values','after_values','field_changes','exact_amount_changes']];
 for(const f of [...(result.families||[]),...Object.values(result.mapped||{})])for(const r of f.rows)rows.push([f.family,r.key,r.state,JSON.stringify(r.before.map(x=>x.values)),JSON.stringify(r.after.map(x=>x.values)),JSON.stringify(r.changes),JSON.stringify(r.monetary)]);
 add('rehearsals/rows.csv','text/csv;charset=utf-8',E.encodeCsv(rows.map(r=>r.map(csvCell))));
 return {result,files};
}
export function appendHandover(workspace,packet){
 const history=list(workspace);if(!history.editions.length)return packet;
 const extra=exportFiles(workspace),files=packet.files.filter(f=>f.path!=='MANIFEST.json'),names=new Set(files.map(f=>f.path));
 for(const f of extra.files){need(!names.has(f.path),'Retain distinct original handover paths.');names.add(f.path);files.push(f);}
 const manifest={...packet.manifest,rehearsalReview:{head:history.head,editions:history.editions.length,review:'rehearsals/review.json',meaning:'Historical observation, not current tenant acceptance'},files:files.map(({text,base64,...f})=>f)},text=JSON.stringify(manifest,null,2)+'\n';
 files.push({path:'MANIFEST.json',type:'application/json',text,...sha256Utf8(text)});return {...packet,manifest,files};
}
