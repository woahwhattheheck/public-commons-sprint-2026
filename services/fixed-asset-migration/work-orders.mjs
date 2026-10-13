import * as E from './engine.mjs';
import {sha256Utf8} from './sha256.mjs';

/** Work-order migration is a companion of the original financial workspace.
 * Every mutation is one original import-supporting operation; original CSV bytes
 * are retained once and all subsequent mappings, corrections and reviews replay.
 */
export const SCHEMA='tjlabs.work-order-migration-event.v1';
export const PURPOSE='Work-order migration operation / tjlabs.work-order-migration-event.v1';
const clone=x=>JSON.parse(JSON.stringify(x));
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function need(ok,message,code='WORK_ORDER_INPUT'){if(!ok){const e=Error(message);e.code=code;throw e;}}
const stable=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
const hash=x=>sha256Utf8(stable(x)).sha256;
const txt=(v,label,max=1000,empty=false)=>{need(typeof v==='string'&&v.length<=max&&(empty||v.length>0),'Supply '+label+'.');sha256Utf8(v);return v;};
const ident=(v,label)=>{txt(v,label,200);need(!/[\u0000-\u001f]/.test(v),'Use a complete printable '+label+'.');return v;};
const key=(...v)=>JSON.stringify(v);
const f=(name,type='text',required=false)=>({name,type,required,label:name.replaceAll('_',' ')});
export const FIELDS=Object.freeze({
 orders:[f('company_id','id',true),f('work_order_id','id',true),f('asset_id'),f('fixed_asset_id'),f('location_id'),f('description'),f('status'),f('opened_date','date'),f('closed_date','date'),f('native_record_id'),f('source_reference')],
 costs:[f('company_id','id',true),f('work_order_id','id',true),f('line_id','id',true),f('line_kind','kind',true),f('asset_id'),f('fixed_asset_id'),f('project_id'),f('project_task_id'),f('dimension_set_id'),f('dimension_1'),f('dimension_2'),f('currency','currency',true),f('quantity','decimal'),f('unit_code'),f('cost_amount','decimal',true),f('cost_basis','id',true),f('posting_date','date'),f('native_record_id'),f('native_document_id'),f('source_reference')]
});
const DESTINATION=['company_id','work_order_id','asset_id','fixed_asset_id','project_id','project_task_id','dimension_set_id','dimension_1','dimension_2','currency','cost_basis','line_kind','unit_code','posting_date'];
const roles=['source','target'];
function scope(role,domain){need(roles.includes(role)&&Object.hasOwn(FIELDS,domain),'Choose source/target and orders/costs.');}
const encoder=()=>{
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 return {
 encode(s){const bytes=[];for(const c of s){const n=c.codePointAt(0);if(n<128)bytes.push(n);else if(n<2048)bytes.push(192|(n>>6),128|(n&63));else if(n<65536){need(n<55296||n>57343,'Retain valid UTF-8 original text.');bytes.push(224|(n>>12),128|((n>>6)&63),128|(n&63));}else bytes.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));}
 let out='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2],v=(a<<16)|((b||0)<<8)|(c||0);out+=alphabet[v>>>18]+alphabet[(v>>>12)&63]+(b===undefined?'=':alphabet[(v>>>6)&63])+(c===undefined?'=':alphabet[v&63]);}return out;},
 decode(s){need(typeof s==='string'&&s.length%4===0&&!/[^A-Za-z0-9+/=]/.test(s)&&(!s.includes('=')||s.indexOf('=')>=s.length-2&&/^={1,2}$/.test(s.slice(s.indexOf('=')))),'Retain the complete canonical Base64 operation.');
 const bytes=[];for(let i=0;i<s.length;i+=4){const v=(alphabet.indexOf(s[i])<<18)|(alphabet.indexOf(s[i+1])<<12)|((s[i+2]==='='?0:alphabet.indexOf(s[i+2]))<<6)|(s[i+3]==='='?0:alphabet.indexOf(s[i+3]));bytes.push((v>>>16)&255);if(s[i+2]!=='=')bytes.push((v>>>8)&255);if(s[i+3]!=='=')bytes.push(v&255);}
 let out='';for(let i=0;i<bytes.length;){const a=bytes[i++];let n=a,count=0,min=0;if(a>=194&&a<=223){n=a&31;count=1;min=128;}else if(a>=224&&a<=239){n=a&15;count=2;min=2048;}else if(a>=240&&a<=244){n=a&7;count=3;min=65536;}else need(a<128,'Invalid UTF-8 operation.');for(let j=0;j<count;j++){const b=bytes[i++];need(b!==undefined&&(b&192)===128,'Incomplete UTF-8 operation.');n=(n<<6)|(b&63);}need(n>=min&&n<=1114111&&(n<55296||n>57343),'Invalid UTF-8 operation.');out+=String.fromCodePoint(n);}return out;}
 };
};
const codec=encoder();
function pair(x){const d=E.decimal(x),negative=d[0]==='-',parts=d.replace(/^-/,'').split('.');return{n:BigInt(parts.join(''))*(negative?-1n:1n),s:parts[1]?.length||0};}
function fmt(n,s){const sign=n<0n?'-':'';let v=(n<0n?-n:n).toString().padStart(s+1,'0');return E.decimal(sign+(s?v.slice(0,-s)+'.'+v.slice(-s):v));}
export function add(a,b){const x=pair(a),y=pair(b),s=Math.max(x.s,y.s);return fmt(x.n*10n**BigInt(s-x.s)+y.n*10n**BigInt(s-y.s),s);}
const sub=(a,b)=>add(a,b[0]==='-'?b.slice(1):'-'+b);
const sum=values=>values.reduce((a,b)=>add(a,b),'0');
function blank(ws){return{schema:'tjlabs.work-order-migration-state.v1',workspaceId:ws.id,head:null,eventCount:0,sources:[],selections:{source:{},target:{}},mappings:{},corrections:[],allocations:{},matches:{},orderMatches:{},rehearsals:[],acceptances:[]};}
function sourceAt(s,id){const f=s.sources.find(x=>x.id===id);need(f,'Select a retained work-order source.');return f;}
const sourceRows=new WeakMap(),stateRows=new WeakMap();
function rowIndex(s){let cached=stateRows.get(s);if(!cached||cached.count!==s.sources.length){cached={count:s.sources.length,rows:new Map()};for(const source of s.sources)for(const row of source.rows)cached.rows.set(row.id,{source,row});stateRows.set(s,cached);}return cached.rows;}
function originalRow(source,rowId){let indexed=sourceRows.get(source);if(!indexed){indexed=new Map(source.rows.map(r=>[r.id,r]));sourceRows.set(source,indexed);}const row=indexed.get(rowId);need(row,'Select a retained work-order row.');return row;}
function cellsAt(s,source,rowId){let cells=[...originalRow(source,rowId).cells];for(const c of s.corrections)if(c.sourceId===source.id&&c.rowId===rowId)cells[c.column]=c.value;return cells;}
function apply(s,action,input,event){
 if(action==='import'){
  scope(input.role,input.domain);txt(input.filename,'original filename',300);const p=E.parseCsv(input.text);
  const id='wo-source-'+hash({role:input.role,domain:input.domain,filename:input.filename,sha256:p.sha256}).slice(0,32);
  let src=s.sources.find(x=>x.id===id);if(!src){src={id,role:input.role,domain:input.domain,filename:input.filename,text:input.text,sha256:p.sha256,bytes:p.bytes,headers:p.headers,rows:p.rows.map((cells,i)=>({id:id+':r'+(i+2),record:i+2,cells})),observedAt:input.observedAt||event.at};s.sources.push(src);}
  s.selections[input.role][input.domain]=id;return{id,rows:src.rows.length};
 }
 if(action==='select'){const src=sourceAt(s,input.sourceId);s.selections[src.role][src.domain]=src.id;return{sourceId:src.id};}
 if(action==='map'){
  const src=sourceAt(s,input.sourceId);need(plain(input.columns),'Supply the complete reviewed column mapping.');const names=FIELDS[src.domain].map(x=>x.name);
  for(const [name,column]of Object.entries(input.columns))need(names.includes(name)&&Number.isInteger(column)&&column>=0&&column<src.headers.length,'Map each canonical field to an original column index.');
  s.mappings[src.id]=clone(input.columns);return{sourceId:src.id};
 }
 if(action==='correct'){
  const src=sourceAt(s,input.sourceId),cells=cellsAt(s,src,input.rowId);need(Number.isInteger(input.column)&&input.column>=0&&input.column<cells.length,'Select an original cell.');
  need(cells[input.column]===input.before,'This cell changed; review the current value before correcting it.','WORK_ORDER_CELL_CHANGED');
  txt(input.value,'complete corrected cell',E.LIMITS.cellCharacters,true);txt(input.reason,'correction reason',4000);txt(input.actor,'reviewer',200);
  s.corrections.push({...clone(input),operationId:event.operationId,at:event.at});return{sourceId:src.id,rowId:input.rowId};
 }
 if(action==='allocate-batch'){
  const parsed=E.parseCsv(input.text);need(new Set(parsed.headers).size===parsed.headers.length,'Use unique headings in a reviewed allocation schedule.');const required=['source_row_id','allocation_id','cost_amount'],headers=parsed.headers;
  for(const h of required)need(headers.filter(x=>x===h).length===1,'The allocation CSV requires one '+h+' column.');
  need(parsed.rows.length>0&&parsed.rows.length<=10000,'Import one to 10,000 reviewed allocation rows.');
  const groups=new Map();for(const cells of parsed.rows){need(cells.length===headers.length,'Retain complete allocation CSV rows.');const v=Object.fromEntries(headers.map((h,i)=>[h,cells[i]]));const sourceRowId=v.source_row_id;const selected=rowIndex(s).get(sourceRowId);need(selected&&selected.source.role==='source'&&selected.source.domain==='costs','Use retained original source row IDs in the allocation CSV.');
   const a={id:v.allocation_id,cost_amount:v.cost_amount,quantity:v.quantity??'',note:v.note||''};for(const field of DESTINATION)if(Object.hasOwn(v,field))a[field]=v[field];
   if(!groups.has(sourceRowId))groups.set(sourceRowId,[]);groups.get(sourceRowId).push(a);
  }
  for(const [rowId,allocations]of groups){const src=rowIndex(s).get(rowId).source;apply(s,'allocate',{sourceId:src.id,rowId,allocations,reason:input.reason,actor:input.actor},event);}
  return{sourceLines:groups.size,allocationRows:parsed.rows.length};
 }
 if(action==='match-batch'){
  const parsed=E.parseCsv(input.text);need(new Set(parsed.headers).size===parsed.headers.length,'Use unique headings in a reviewed match schedule.');for(const h of ['allocation_key','target_row_id'])need(parsed.headers.filter(x=>x===h).length===1,'The readback CSV requires one '+h+' column.');
  need(parsed.rows.length>0&&parsed.rows.length<=10000,'Import one to 10,000 reviewed match rows.');
  const groups=new Map();for(const cells of parsed.rows){need(cells.length===parsed.headers.length,'Retain complete match CSV rows.');const v=Object.fromEntries(parsed.headers.map((h,i)=>[h,cells[i]]));if(!groups.has(v.allocation_key))groups.set(v.allocation_key,[]);if(v.target_row_id)groups.get(v.allocation_key).push(v.target_row_id);}
  for(const [allocationKey,targetRowIds]of groups)apply(s,'match',{allocationKey,targetRowIds,reason:input.reason,actor:input.actor},event);
  return{allocations:groups.size,matchRows:parsed.rows.length};
 }
 if(action==='allocate'){
  const src=sourceAt(s,input.sourceId);need(src.role==='source'&&src.domain==='costs','Allocate an original source cost line.');originalRow(src,input.rowId);
  need(Array.isArray(input.allocations)&&input.allocations.length>0&&input.allocations.length<=100,'Supply one to 100 complete explicit allocations.');
  const seen=new Set();for(const a of input.allocations){ident(a.id,'allocation ID');need(!seen.has(a.id),'Allocation IDs must be unique within a source line.');seen.add(a.id);for(const field of DESTINATION)txt(a[field]??'',field,1000,true);E.decimal(a.cost_amount);if(a.quantity!==''&&a.quantity!==undefined)E.decimal(a.quantity);txt(a.note||'','allocation note',4000,true);}
  txt(input.reason,'allocation reason',4000);txt(input.actor,'reviewer',200);
  s.allocations[input.rowId]={sourceId:src.id,rows:clone(input.allocations),reason:input.reason,actor:input.actor,at:event.at,operationId:event.operationId};return{sourceId:src.id,rowId:input.rowId};
 }
 if(action==='order-match-batch'){
  const parsed=E.parseCsv(input.text);need(new Set(parsed.headers).size===parsed.headers.length,'Use unique headings in a reviewed header schedule.');
  for(const h of ['source_row_id','target_row_id'])need(parsed.headers.includes(h),'Supply '+h+' in the reviewed header schedule.');
  need(parsed.rows.length>0&&parsed.rows.length<=10000,'Import one to 10,000 reviewed header matches.');const seen=new Set();
  for(const cells of parsed.rows){need(cells.length===parsed.headers.length,'Retain complete header schedule rows.');const v=Object.fromEntries(parsed.headers.map((h,i)=>[h,cells[i]]));need(!seen.has(v.source_row_id),'Review one destination per original header.');seen.add(v.source_row_id);const expected={};
   for(const [name,value]of Object.entries(v))if(name.startsWith('expected_'))expected[name.slice(9)]=value;
   apply(s,'order-match',{sourceRowId:v.source_row_id,targetRowId:v.target_row_id,expected,actor:input.actor,reason:input.reason},event);
  }return{headers:parsed.rows.length};
 }
 if(action==='order-match'){
  const source=rowIndex(s).get(input.sourceRowId);need(source&&source.source.role==='source'&&source.source.domain==='orders','Select an original source order.');
  txt(input.actor,'header reviewer',200);txt(input.reason,'header match reason',4000);
  if(input.targetRowId===''){delete s.orderMatches[input.sourceRowId];return{sourceRowId:input.sourceRowId,cleared:true};}
  const target=rowIndex(s).get(input.targetRowId);need(target&&target.source.role==='target'&&target.source.domain==='orders','Select an actual returned order header.');
  need(plain(input.expected),'Supply the complete reviewed expected header fields.');
  for(const [field,value]of Object.entries(input.expected)){need(FIELDS.orders.some(f=>f.name===field)&&!['native_record_id','source_reference'].includes(field),'Use a canonical header field for the explicit destination.');txt(value,field,E.LIMITS.cellCharacters,true);}
  s.orderMatches[input.sourceRowId]={targetRowId:input.targetRowId,expected:clone(input.expected),actor:input.actor,reason:input.reason,at:event.at};
  return{sourceRowId:input.sourceRowId,targetRowId:input.targetRowId};
 }
 if(action==='match'){
  ident(input.allocationKey,'expected allocation key');need(Array.isArray(input.targetRowIds)&&input.targetRowIds.length<=10000,'Supply complete selected returned row IDs.');need(new Set(input.targetRowIds).size===input.targetRowIds.length,'Do not select a returned row twice.');
  for(const rowId of input.targetRowIds){const selected=rowIndex(s).get(rowId);need(selected&&selected.source.role==='target'&&selected.source.domain==='costs','Select each returned cost from its retained target export.');}
  txt(input.reason,'readback match reason',4000);txt(input.actor,'reviewer',200);
  if(input.targetRowIds.length)s.matches[input.allocationKey]={rowIds:[...input.targetRowIds],reason:input.reason,actor:input.actor,at:event.at};else delete s.matches[input.allocationKey];return{allocationKey:input.allocationKey};
 }
 if(action==='rehearsal'||action==='accept'){
  txt(input.label,'review label',200);txt(input.actor,'reviewer',200);txt(input.note,'review note',8000);txt(input.reference,'actual export, rehearsal or cutover reference',2000);
  need(typeof input.basis==='string'&&input.basis===basis(s),'The selected sources, mappings or corrections changed; review the current complete comparison.','WORK_ORDER_BASIS_CHANGED');
  const report=reconcileState(s);if(action==='accept')need(report.ready,'Resolve all source, allocation and actual returned-target differences before acceptance.','WORK_ORDER_NOT_READY');
  const record={operationId:event.operationId,at:event.at,label:input.label,actor:input.actor,note:input.note,reference:input.reference,basis:input.basis,summary:report.summary};
  (action==='accept'?s.acceptances:s.rehearsals).push(record);return clone(record);
 }
 need(false,'Unknown work-order operation: '+action);
}
export function read(workspace){
 const ws=E.validateWorkspace(workspace),s=blank(ws),files=new Map(ws.supportingFiles.map(f=>[f.id,f])),seen=new Set();
 for(const op of ws.operations){if(op.kind!=='import-supporting')continue;const file=files.get(op.supportingInputId);if(!file||file.purpose!==PURPOSE||seen.has(file.id))continue;
  seen.add(file.id);const event=JSON.parse(codec.decode(file.base64));
  need(event.schema===SCHEMA&&event.workspaceId===ws.id&&event.sequence===s.eventCount+1&&event.previous===s.head,'The complete work-order event chain differs.','WORK_ORDER_HISTORY_CHANGED');
  need(event.operationId===op.id&&event.requestSha256===hash(event.input),'The saved work-order request identity differs.','WORK_ORDER_HISTORY_CHANGED');
  apply(s,event.action,event.input,event);s.head=sha256Utf8(codec.decode(file.base64)).sha256;s.eventCount++;
 }
 return s;
}
export function run(workspace,action,input){
 E.validateWorkspace(workspace);need(plain(input),'Supply the complete original work-order request.');ident(input.operationId,'operation ID');
 const old=workspace.operations.find(x=>x.id===input.operationId);
 if(old){
  const file=workspace.supportingFiles.find(f=>f.id===old.supportingInputId);need(file?.purpose===PURPOSE,'This operation ID belongs to another request.','OPERATION_CONFLICT');
  const event=JSON.parse(codec.decode(file.base64));need(event.action===action&&event.requestSha256===hash(input),'This operation ID belongs to a different work-order request.','OPERATION_CONFLICT');
  return{workspace,receipt:clone(old),replayed:true};
 }
 need(input.expectedRevision===workspace.revision,'The original workspace revision changed.','REVISION_CONFLICT');
 const state=read(workspace),at=input.at||new Date().toISOString(),event={schema:SCHEMA,workspaceId:workspace.id,sequence:state.eventCount+1,previous:state.head,operationId:input.operationId,at,action,input:clone(input),requestSha256:hash(input)};
 const result=apply(state,action,input,event),text=JSON.stringify(event);
 const saved=E.importSupportingFile(workspace,{operationId:input.operationId,expectedRevision:input.expectedRevision,at,filename:'work-order-'+String(event.sequence).padStart(4,'0')+'-'+action+'.json',mimeType:'application/json',purpose:PURPOSE,base64:codec.encode(text)});
 return{...saved,workOrderResult:result};
}
export const templateCsv=domain=>{need(Object.hasOwn(FIELDS,domain),'Select orders or costs.');return E.encodeCsv([FIELDS[domain].map(f=>f.name)]);};
function basis(s){return hash({selections:s.selections,mappings:s.mappings,corrections:s.corrections,allocations:s.allocations,matches:s.matches,orderMatches:s.orderMatches,sources:s.sources.map(({text,rows,...x})=>x)});}
function rows(s,role,domain,issues){
 const id=s.selections[role][domain];if(!id)return [];
 const src=sourceAt(s,id),mapping=s.mappings[id]||{},spec=FIELDS[domain];
 for(const f of spec)if(f.required&&!Object.hasOwn(mapping,f.name))issues.push({code:'MISSING_MAPPING',sourceId:id,field:f.name,message:'Map '+role+' '+domain+' '+f.label+'.'});
 return src.rows.map(row=>{
  const cells=cellsAt(s,src,row.id),values={};let valid=true;
  if(cells.length!==src.headers.length){issues.push({code:'RAGGED_ROW',sourceId:id,rowId:row.id,message:'Original row and header column counts differ.'});valid=false;}
  for(const f of spec){let v=mapping[f.name]===undefined?'':cells[mapping[f.name]]??'';values[f.name]=v;
   try{if(v===''){need(!f.required,'Supply '+f.label+'.');continue;}txt(v,f.label,E.LIMITS.cellCharacters,true);
    if(f.type==='decimal')values[f.name]=E.decimal(v);
    if(f.type==='currency')need(/^[A-Z]{3}$/.test(v),'Use the actual three-letter source currency.');
    if(f.type==='kind')need(['labor','material','expense'].includes(v),'Map line kind to labor, material or expense using a reviewed cell correction.');
    if(f.type==='date')need(/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'Use the actual ISO calendar date.');
   }catch(e){valid=false;issues.push({code:'INVALID_CELL',sourceId:id,rowId:row.id,field:f.name,value:v,message:e.message});}
  }
  if(domain==='costs'&&values.quantity!==''&&!values.unit_code){valid=false;issues.push({code:'QUANTITY_UNIT',rowId:row.id,message:'Retain the original unit for every quantity.'});}
  return{sourceId:id,rowId:row.id,record:row.record,values,valid};
 });
}
const allocationKey=(rowId,id)=>rowId+'::'+id;
export function reconcile(workspace){return reconcileState(read(workspace));}
function reconcileState(s){
 const issues=[],domains={source:{},target:{}};
 for(const role of roles)for(const domain of Object.keys(FIELDS))domains[role][domain]=rows(s,role,domain,issues);
 for(const domain of ['orders','costs'])if(!s.selections.source[domain])issues.push({code:'MISSING_SOURCE',message:'Select the complete original '+domain+' export.'});
 if(!s.selections.target.orders)issues.push({code:'MISSING_TARGET_ORDERS',message:'Select the actual returned target work-order headers.'});
 if(!s.selections.target.costs)issues.push({code:'MISSING_TARGET',message:'Select the actual returned target cost export.'});
 const index={};for(const role of roles)for(const domain of Object.keys(FIELDS)){
  const seen=new Map();index[role+':'+domain]=seen;
  for(const r of domains[role][domain]){if(!r.valid)continue;const k=domain==='orders'?key(r.values.company_id,r.values.work_order_id):key(r.values.company_id,r.values.work_order_id,r.values.line_id);
   if(seen.has(k)){seen.set(k,null);issues.push({code:'DUPLICATE_KEY',rowId:r.rowId,message:'This original company/order'+(domain==='costs'?'/line':'')+' key is duplicated.'});}else seen.set(k,r);
  }
 }
 const orderComparisons=[],usedOrders=new Set(),targetOrders=new Map(domains.target.orders.map(r=>[r.rowId,r]));
 const sourceOrderKeys=new Set(domains.source.orders.map(r=>r.rowId));
 for(const source of domains.source.orders){
  const match=s.orderMatches[source.rowId],target=match?targetOrders.get(match.targetRowId):null,differences=[];
  const expected={...source.values,...(match?.expected||{})};
  if(!match||!target)differences.push({field:'returned_header',expected:'explicit current returned header',actual:match?.targetRowId||'unmatched'});
  if(!source.valid)differences.push({field:'source_header',expected:'valid mapped row',actual:source.rowId});
  if(target){if(!target.valid)differences.push({field:'returned_header',expected:'valid mapped row',actual:target.rowId});
   if(usedOrders.has(target.rowId))differences.push({field:'returned_header',expected:'one explicit original header',actual:'already assigned'});usedOrders.add(target.rowId);
   for(const field of FIELDS.orders.map(f=>f.name).filter(f=>!['native_record_id','source_reference'].includes(f))){
    if((source.values[field]!==''||Object.hasOwn(match.expected,field))&&expected[field]!==target.values[field])differences.push({field,expected:expected[field],actual:target.values[field]});
   }
  }
  orderComparisons.push({sourceRowId:source.rowId,targetRowId:target?.rowId||null,expected,state:differences.length?'DIFFERENT':'EQUAL',differences});
 }
 for(const [sourceRowId,match]of Object.entries(s.orderMatches))if(!sourceOrderKeys.has(sourceRowId))issues.push({code:'STALE_HEADER_MATCH',rowId:sourceRowId,message:'A retained header match belongs to an older source selection.'});
 for(const r of domains.target.orders)if(!usedOrders.has(r.rowId))issues.push({code:'UNMATCHED_TARGET_HEADER',rowId:r.rowId,message:'This returned header has no reviewed original header match.'});
 const expected=[],used=new Map(),returned=new Map(domains.target.costs.map(r=>[r.rowId,r])),sourceTotals=new Map(),allocationTotals=new Map(),targetTotals=new Map(),comparisons=[];
 const total=(map,v,amount)=>{const k=key(v.company_id,v.currency,v.cost_basis,v.line_kind);const old=map.get(k)||{company_id:v.company_id,currency:v.currency,cost_basis:v.cost_basis,line_kind:v.line_kind,amount:'0',rows:0};old.amount=add(old.amount,amount);old.rows++;map.set(k,old);};
 for(const row of domains.source.costs){if(!row.valid)continue;const v=row.values;
  if(!index['source:orders'].get(key(v.company_id,v.work_order_id)))issues.push({code:'MISSING_ORDER',rowId:row.rowId,message:'The original work-order header is missing or ambiguous.'});
  total(sourceTotals,v,v.cost_amount);
  const selected=s.allocations[row.rowId];let allocations=selected?.rows;
  if(!allocations)allocations=[{id:'full',...v,note:'Complete original cost with unchanged destination identifiers.'}];
  const amounts=allocations.map(x=>E.decimal(x.cost_amount));if(sum(amounts)!==v.cost_amount)issues.push({code:'ALLOCATION_TOTAL',rowId:row.rowId,source:v.cost_amount,allocated:sum(amounts),message:'Explicit allocations must exactly conserve the complete original line amount.'});
  const quantityPresent=allocations.filter(x=>x.quantity!==undefined&&x.quantity!=='');
  if(v.quantity===''&&quantityPresent.length)issues.push({code:'UNSOURCED_ALLOCATION_QUANTITY',rowId:row.rowId,message:'The original cost supplies no quantity; retain missing quantity instead of introducing an unverified allocation total.'});
  if(v.quantity!==''&&(quantityPresent.length!==allocations.length||sum(quantityPresent.map(x=>x.quantity))!==v.quantity))issues.push({code:'ALLOCATION_QUANTITY',rowId:row.rowId,message:'Retain the complete original quantity across allocations, separately from its monetary amount.'});
  for(const a of allocations){const values={...v,...a};for(const f of ['company_id','work_order_id','currency','cost_basis','line_kind'])if(!values[f])issues.push({code:'ALLOCATION_DESTINATION',rowId:row.rowId,allocationId:a.id,field:f,message:'Supply the explicit destination '+f+'.'});
   for(const f of ['company_id','currency','cost_basis','line_kind'])if(values[f]!==v[f])issues.push({code:'ALLOCATION_SCOPE',rowId:row.rowId,allocationId:a.id,field:f,message:'Allocation keeps the original company, currency, cost basis and line kind; a separate reviewed conversion is required for a changed scope.'});
   if(v.quantity!==''&&values.unit_code!==v.unit_code)issues.push({code:'ALLOCATION_UNIT',rowId:row.rowId,allocationId:a.id,message:'Keep the original unit; no implicit unit conversion is applied.'});
   const item={key:allocationKey(row.rowId,a.id),sourceId:row.sourceId,sourceRowId:row.rowId,allocationId:a.id,values:{...values,cost_amount:E.decimal(values.cost_amount),quantity:values.quantity===undefined||values.quantity===''?'':E.decimal(values.quantity)},explicit:!!selected};expected.push(item);total(allocationTotals,item.values,item.values.cost_amount);
  }
 }
 for(const row of domains.target.costs)if(row.valid){
  if(!index['target:orders'].get(key(row.values.company_id,row.values.work_order_id)))issues.push({code:'MISSING_TARGET_ORDER',rowId:row.rowId,message:'The returned cost has no unique valid header in the selected target order export.'});
  total(targetTotals,row.values,row.values.cost_amount);
 }
 for(const item of expected){
  const selected=s.matches[item.key],ids=selected?.rowIds||[],matched=ids.map(id=>returned.get(id)).filter(Boolean),differences=[];
  if(!ids.length)differences.push({field:'returned_rows',expected:'explicit reviewed match',actual:'unmatched'});
  if(matched.length!==ids.length)differences.push({field:'returned_rows',expected:'rows in current selected target',actual:'older or missing export'});
  for(const r of matched){if(!r.valid)differences.push({field:'returned_row',actual:r.rowId,expected:'valid mapped row'});
   if(used.has(r.rowId)){differences.push({field:'returned_row',actual:r.rowId,expected:'one allocation only'});issues.push({code:'TARGET_REUSED',rowId:r.rowId,message:'A returned row is assigned to more than one expected allocation.'});}used.set(r.rowId,item.key);
   for(const f of DESTINATION)if(!(f==='posting_date'&&!item.values[f])&&(r.values[f]||'')!==(item.values[f]||''))differences.push({field:f,expected:item.values[f]||'',actual:r.values[f]||'',rowId:r.rowId});
  }
  const valid=matched.filter(x=>x.valid);const amount=sum(valid.map(x=>x.values.cost_amount));if(amount!==item.values.cost_amount)differences.push({field:'cost_amount',expected:item.values.cost_amount,actual:amount,delta:sub(amount,item.values.cost_amount)});
  let quantity=null;if(item.values.quantity!==''){if(valid.some(x=>x.values.quantity===''))differences.push({field:'quantity',expected:item.values.quantity,actual:'missing'});else{quantity=sum(valid.map(x=>x.values.quantity));if(quantity!==item.values.quantity)differences.push({field:'quantity',expected:item.values.quantity,actual:quantity});}}
  comparisons.push({allocationKey:item.key,sourceRowId:item.sourceRowId,targetRowIds:ids,state:differences.length?'DIFFERENT':'EQUAL',expectedAmount:item.values.cost_amount,returnedAmount:amount,returnedQuantity:quantity,differences});
 }
 const extras=domains.target.costs.filter(x=>!used.has(x.rowId));for(const r of extras)issues.push({code:'UNMATCHED_TARGET',rowId:r.rowId,message:'This returned target cost has no explicit reviewed source allocation match.'});
 const expectedKeys=new Set(expected.map(x=>x.key));for(const k of Object.keys(s.matches))if(!expectedKeys.has(k))issues.push({code:'STALE_MATCH',allocationKey:k,message:'A readback match refers to an older source selection or allocation.'});
 const currentBasis=basis(s),differences=comparisons.filter(x=>x.state!=='EQUAL').length;
 const headerDifferences=orderComparisons.filter(x=>x.state!=='EQUAL').length;
 const summary={targetOrders:domains.target.orders.length,differentHeaders:headerDifferences,sourceOrders:domains.source.orders.length,sourceCosts:domains.source.costs.length,expectedAllocations:expected.length,targetCosts:domains.target.costs.length,matchedAllocations:comparisons.length-differences,differentAllocations:differences,unmatchedTarget:extras.length,errors:issues.length};
 const ready=issues.length===0&&differences===0&&headerDifferences===0&&expected.length>0;
 return{schema:'tjlabs.work-order-reconciliation.v1',workspaceId:s.workspaceId,basis:currentBasis,ready,accepted:ready&&s.acceptances.some(a=>a.basis===currentBasis),summary,issues,domains,expected,comparisons,orderComparisons,totals:{source:[...sourceTotals.values()],allocated:[...allocationTotals.values()],returned:[...targetTotals.values()]},rehearsals:clone(s.rehearsals),acceptances:clone(s.acceptances),coverage:s.sources.map(src=>({sourceId:src.id,role:src.role,domain:src.domain,selected:s.selections[src.role][src.domain]===src.id,headers:src.headers.map((name,column)=>({name,column,fields:Object.entries(s.mappings[src.id]||{}).filter(([,i])=>i===column).map(([field])=>field)}))}))};
}
export function exportFiles(workspace){
 const s=read(workspace),r=reconcileState(s),files=[];
 const add=(path,type,text)=>files.push({path,type,text,...sha256Utf8(text)});
 add('work-orders/state.json','application/json',JSON.stringify(s,null,2)+'\n');
 add('work-orders/reconciliation.json','application/json',JSON.stringify(r,null,2)+'\n');
 for(const src of s.sources){add('work-orders/originals/'+src.id+'.csv','text/csv',src.text);add('work-orders/corrected/'+src.id+'.csv','text/csv',E.encodeCsv([src.headers,...src.rows.map(row=>cellsAt(s,src,row.id))]));}
 for(const role of roles)for(const domain of Object.keys(FIELDS))add('work-orders/canonical/'+role+'-'+domain+'.csv','text/csv',E.encodeCsv([['_source_row_id',...FIELDS[domain].map(f=>f.name)],...r.domains[role][domain].map(row=>[row.rowId,...FIELDS[domain].map(f=>row.values[f.name])])]));
 const cols=['allocation_key','source_row_id','allocation_id',...FIELDS.costs.map(f=>f.name)];
 add('work-orders/expected-allocations.csv','text/csv',E.encodeCsv([cols,...r.expected.map(a=>[a.key,a.sourceRowId,a.allocationId,...FIELDS.costs.map(f=>a.values[f.name]??'')])]));
 add('work-orders/README.txt','text/plain','Work-order migration companion\nWorkspace '+workspace.id+' / revision '+workspace.revision+'\nOriginal and corrected exports, exact allocations, selected target readback and all original operation records are included. Cost amounts are compared only within their retained company, currency, cost basis and line kind. Quantities remain in their original units. Financial FA/GL closure remains in the original six-domain report. Work-order ready: '+r.ready+'; accepted current basis: '+r.accepted+'.\n');
 return{report:r,files};
}
export function buildHandover(workspace){
 const original=E.buildHandover(workspace),extra=exportFiles(workspace);const files=original.files.filter(f=>f.path!=='MANIFEST.json').concat(extra.files);
 const manifest={...original.manifest,workOrders:{ready:extra.report.ready,accepted:extra.report.accepted,summary:extra.report.summary,basis:extra.report.basis},files:files.map(({text,base64,...f})=>f)};
 const text=JSON.stringify(manifest,null,2)+'\n';files.push({path:'MANIFEST.json',type:'application/json',text,...sha256Utf8(text)});
 return{...original,files,manifest,workOrders:extra.report};
}
