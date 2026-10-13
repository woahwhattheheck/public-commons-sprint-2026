import {sha256Utf8} from './sha256.mjs';

export const WORKSPACE_SCHEMA='tjlabs.uniform-migration-workspace.v1';
export const LIMITS=Object.freeze({csvBytes:32*1024*1024,workspaceBytes:128*1024*1024,rows:100000,columns:512,sources:128,operations:10000,cellCharacters:1000000});
const roleNames=['source','target'];
const clone=x=>JSON.parse(JSON.stringify(x));
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=(code,message,details)=>{const e=new Error(message);e.code=code;if(details!==undefined)e.details=details;throw e;};
const need=(ok,code,message,details)=>{if(!ok)fail(code,message,details);};
const text=(x,name,max=2000,empty=false)=>{need(typeof x==='string'&&x.length<=max&&(empty||x.length>0),'INVALID_INPUT','Supply '+name+'.');sha256Utf8(x);return x;};
const id=(x,name)=>{text(x,name,128);need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x),'INVALID_ID','Use a stable '+name+' containing letters, numbers, dot, colon, underscore or hyphen.');return x;};
function instant(x,name){text(x,name,64);need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x))&&validDate(x.slice(0,10)),'INVALID_TIME','Supply the actual ISO timestamp for '+name+'.');return x;}
function validDate(x){if(!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;const d=new Date(x+'T00:00:00.000Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x;}
function stable(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(stable).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';}
const hash=x=>sha256Utf8(stable(x)).sha256;
const field=(name,type='string',required=false,reference=null)=>({name,label:name.replaceAll('_',' '),type,required,...(reference?{reference}:{})});
export const DOMAINS=Object.freeze({
 locations:{label:'Locations',id:'location_id',fields:[field('location_id','id',true),field('name','string',true),field('parent_location_id','id',false,'locations'),field('active')]},
 wearers:{label:'Wearers',id:'wearer_id',fields:[field('wearer_id','id',true),field('location_id','id',true,'locations'),field('name'),field('status')]},
 products:{label:'Products',id:'product_id',fields:[field('product_id','id',true),field('sku'),field('description'),field('unit','unit',true),field('category')]},
 entitlements:{label:'Entitlements',id:'entitlement_id',fields:[field('entitlement_id','id',true),field('wearer_id','id',true,'wearers'),field('product_id','id',true,'products'),field('quantity','decimal',true),field('unit','unit',true),field('valid_from','date'),field('valid_to','date')]},
 stock:{label:'Stock',id:'stock_id',fields:[field('stock_id','id',true),field('location_id','id',true,'locations'),field('product_id','id',true,'products'),field('quantity','decimal',true),field('unit','unit',true)]},
 issues:{label:'Issues',id:'issue_id',fields:[field('issue_id','id',true),field('wearer_id','id',true,'wearers'),field('product_id','id',true,'products'),field('location_id','id',true,'locations'),field('quantity','decimal',true),field('unit','unit',true),field('issued_at','date'),field('asset_id','id',false,'assets')]},
 returns:{label:'Returns',id:'return_id',fields:[field('return_id','id',true),field('issue_id','id',true,'issues'),field('quantity','decimal',true),field('unit','unit',true),field('returned_at','date'),field('location_id','id',false,'locations'),field('asset_id','id',false,'assets')]},
 assets:{label:'Assets',id:'asset_id',fields:[field('asset_id','id',true),field('product_id','id',true,'products'),field('serial'),field('wearer_id','id',false,'wearers'),field('location_id','id',false,'locations'),field('status'),field('issued_at','date'),field('retired_at','date')]}
});
for(const spec of Object.values(DOMAINS)){for(const f of spec.fields)Object.freeze(f);Object.freeze(spec.fields);Object.freeze(spec);}
function domainName(x){need(Object.hasOwn(DOMAINS,x),'INVALID_DOMAIN','Select one of the eight original inventory domains.');return x;}
function roleName(x){need(roleNames.includes(x),'INVALID_ROLE','Choose source or target.');return x;}
export function decimal(value){
 text(value,'an exact non-negative decimal quantity',100);
 need(/^\d{1,80}(?:\.\d{1,18})?$/.test(value),'INVALID_DECIMAL','Use a non-negative decimal string, without grouping, exponent or rounding.');
 let [whole,fraction='']=value.split('.');whole=whole.replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
 return whole+(fraction?'.'+fraction:'');
}
function decimalPair(value){const v=decimal(value),p=v.split('.');return {n:BigInt(p.join('')),scale:p[1]?.length||0};}
function quantitySum(values){let n=0n,scale=0;for(const value of values){const v=decimalPair(value);if(v.scale>scale){n*=10n**BigInt(v.scale-scale);scale=v.scale;}n+=v.n*10n**BigInt(scale-v.scale);}let s=n.toString().padStart(scale+1,'0');return scale?decimal(s.slice(0,-scale)+'.'+s.slice(-scale)):s;}
function quantityCompare(a,b){const x=decimalPair(a),y=decimalPair(b),s=Math.max(x.scale,y.scale),n=x.n*10n**BigInt(s-x.scale),m=y.n*10n**BigInt(s-y.scale);return n<m?-1:n>m?1:0;}

/** Strict RFC-style comma CSV. Original text, duplicate headers, blanks and ragged rows survive. */
export function parseCsv(original){
 text(original,'complete original CSV',LIMITS.csvBytes,true);const identity=sha256Utf8(original);
 need(identity.bytes<=LIMITS.csvBytes,'CSV_TOO_LARGE','Choose a complete CSV within 32 MiB.');
 let input=original.charCodeAt(0)===0xfeff?original.slice(1):original,rows=[],row=[],cell='',quoted=false,closed=false,started=false;
 const endCell=()=>{need(cell.length<=LIMITS.cellCharacters,'CELL_TOO_LARGE','A CSV cell exceeds the supported complete-cell size.');row.push(cell);cell='';closed=false;need(row.length<=LIMITS.columns,'TOO_MANY_COLUMNS','A CSV record exceeds 512 columns.');};
 const endRow=()=>{endCell();rows.push(row);row=[];started=false;need(rows.length<=LIMITS.rows+1,'TOO_MANY_ROWS','A CSV exceeds 100,000 data records.');};
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(closed&&c!==','&&c!=='\r'&&c!=='\n')fail('INVALID_CSV','Unexpected character after a quoted cell.',{offset:i});
  if(c==='"'){need(cell===''&&!closed,'INVALID_CSV','A quote must start a complete quoted cell.',{offset:i});quoted=true;started=true;}
  else if(c===','){endCell();started=true;}
  else if(c==='\r'||c==='\n'){if(c==='\r'&&input[i+1]==='\n')i++;endRow();}
  else{cell+=c;started=true;}
 }
 need(!quoted,'INVALID_CSV','The final quoted CSV cell is incomplete.');
 if(started||closed||cell!==''||row.length)endRow();
 need(rows.length>0,'EMPTY_CSV','Supply a header record, even when the original file has no data.');
 return {headers:rows[0],rows:rows.slice(1),...identity,bom:original.charCodeAt(0)===0xfeff};
}
const csvCell=v=>{const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
export const encodeCsv=rows=>rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
export const templateCsv=domain=>encodeCsv([DOMAINS[domainName(domain)].fields.map(x=>x.name)]);
export function createWorkspace({id:workspaceId,title,createdAt}){
 return {schema:WORKSPACE_SCHEMA,id:id(workspaceId,'workspace ID'),title:text(title,'workspace title',300),createdAt:instant(createdAt,'creation'),revision:0,sources:[],mappings:{source:{},target:{}},mappingHistory:[],corrections:[],operations:[]};
}
function sourceAt(ws,sourceId){const source=ws.sources.find(x=>x.id===sourceId);need(source,'SOURCE_NOT_FOUND','Select an original saved source.');return source;}
function effectiveRows(ws,source){const rows=source.rows.map(r=>({...r,cells:r.cells.slice()})),byId=new Map(rows.map(r=>[r.id,r]));
 for(const c of ws.corrections)if(c.sourceId===source.id){const row=byId.get(c.rowId);need(row&&row.cells[c.column]===c.before,'INVALID_CORRECTION_HISTORY','The original correction ancestry differs.');row.cells[c.column]=c.value;}
 return rows;
}
function validateMapping(ws,m){
 need(plain(m)&&plain(m.columns),'INVALID_MAPPING','Retain the complete column mapping.');
 domainName(m.domain);roleName(m.role);const source=sourceAt(ws,m.sourceId);need(source.domain===m.domain&&source.role===m.role,'INVALID_MAPPING','Keep the selected original domain and role.');
 const names=new Set(DOMAINS[m.domain].fields.map(f=>f.name));
 for(const [name,index]of Object.entries(m.columns))need(names.has(name)&&Number.isInteger(index)&&index>=0&&index<source.headers.length,'INVALID_MAPPING','Map known fields to original zero-based header indexes.',{field:name,column:index});
 return source;
}
export function validateWorkspace(ws){
 need(plain(ws)&&ws.schema===WORKSPACE_SCHEMA,'INVALID_WORKSPACE','Open the complete original migration workspace.');
 id(ws.id,'workspace ID');text(ws.title,'workspace title',300);instant(ws.createdAt,'workspace creation');
 need(Number.isSafeInteger(ws.revision)&&ws.revision>=0&&Array.isArray(ws.sources)&&ws.sources.length<=LIMITS.sources&&Array.isArray(ws.corrections)&&Array.isArray(ws.mappingHistory)&&Array.isArray(ws.operations)&&ws.operations.length<=LIMITS.operations,'INVALID_WORKSPACE','Retain complete original source, mapping, correction and operation lists.');
 need(ws.revision===ws.operations.length,'INVALID_OPERATION_HISTORY','Retain the complete operation sequence.');
 const sourceIds=new Set();
 for(const s of ws.sources){id(s.id,'source ID');need(!sourceIds.has(s.id),'DUPLICATE_SOURCE','A saved source is repeated.');sourceIds.add(s.id);domainName(s.domain);roleName(s.role);text(s.filename,'original filename',300);instant(s.observedAt,'source observation');
  const parsed=parseCsv(s.text);need(s.bytes===parsed.bytes&&s.sha256===parsed.sha256&&stable(s.headers)===stable(parsed.headers)&&Array.isArray(s.rows)&&s.rows.length===parsed.rows.length,'SOURCE_CHANGED','The original CSV identity or row selection differs.');
  need(s.id==='source-'+hash({role:s.role,domain:s.domain,filename:s.filename,sha256:s.sha256}).slice(0,40),'SOURCE_CHANGED','The saved source identity differs.');
  for(let i=0;i<s.rows.length;i++){const r=s.rows[i];need(r.id===s.id+':r'+(i+2)&&r.record===i+2&&stable(r.cells)===stable(parsed.rows[i]),'SOURCE_CHANGED','An original CSV row changed.');}
 }
 need(plain(ws.mappings)&&plain(ws.mappings.source)&&plain(ws.mappings.target),'INVALID_MAPPING','Retain both original role mappings.');
 const historyIds=new Set();
 for(const m of ws.mappingHistory){validateMapping(ws,m);id(m.id,'mapping ID');need(!historyIds.has(m.id),'INVALID_MAPPING_HISTORY','A mapping identity is repeated.');historyIds.add(m.id);need(Number.isSafeInteger(m.revision)&&m.revision>0&&m.revision<=ws.revision,'INVALID_MAPPING_HISTORY','Keep the mapping revision.');instant(m.at,'mapping time');}
 for(const role of roleNames)for(const [domain,m]of Object.entries(ws.mappings[role])){need(m.role===role&&m.domain===domain,'INVALID_MAPPING','The current mapping lost its role/domain.');validateMapping(ws,m);const latest=ws.mappingHistory.filter(x=>x.role===role&&x.domain===domain).at(-1);need(latest&&stable(latest)===stable(m),'INVALID_MAPPING_HISTORY','Current mapping is not its latest saved edition.');}
 const correctionIds=new Set();
 for(const c of ws.corrections){id(c.id,'correction ID');need(!correctionIds.has(c.id),'INVALID_CORRECTION_HISTORY','A correction identity is repeated.');correctionIds.add(c.id);const source=sourceAt(ws,c.sourceId),row=source.rows.find(r=>r.id===c.rowId);need(row&&Number.isInteger(c.column)&&c.column>=0&&c.column<row.cells.length,'INVALID_CORRECTION','Select an existing complete original cell.');text(c.before,'preceding cell',LIMITS.cellCharacters,true);text(c.value,'corrected cell',LIMITS.cellCharacters,true);text(c.reason,'correction reason',4000);text(c.actor,'correction reviewer',300);instant(c.at,'correction time');need(Number.isSafeInteger(c.revision)&&c.revision>0&&c.revision<=ws.revision,'INVALID_CORRECTION_HISTORY','Retain the original correction revision.');}
 for(const source of ws.sources)effectiveRows(ws,source);
 const opIds=new Set(),seenSources=new Set(),sourceOrder=[],seenMappings=[],seenCorrections=[],replayedCells=new Map();
 for(let i=0;i<ws.operations.length;i++){
  const o=ws.operations[i];id(o.id,'operation ID');
  need(!opIds.has(o.id)&&o.revision===i+1&&o.previousRevision===i&&plain(o.input)&&plain(o.result),'INVALID_OPERATION_HISTORY','Retain distinct ordered original requests and receipts.');opIds.add(o.id);instant(o.at,'operation time');
  const input=clone(o.input);
  if(o.kind==='import-csv'){need(typeof o.sourceInputId==='string','INVALID_OPERATION_HISTORY','Keep the original source reference for this import.');input.text=sourceAt(ws,o.sourceInputId).text;}
  need(input.operationId===o.id&&input.expectedRevision===i&&hash({kind:o.kind,input})===o.requestSha256,'INVALID_OPERATION_HISTORY','The complete original operation request changed.');
  if(input.at||input.observedAt)need(o.at===(input.at||input.observedAt),'INVALID_OPERATION_HISTORY','The original operation time changed.');
  let expected;
  if(o.kind==='import-csv'){
   const original=sourceAt(ws,o.sourceInputId);
   need(input.role===original.role&&input.domain===original.domain&&input.filename===original.filename,'INVALID_OPERATION_HISTORY','The original import source contract differs.');
   const retained=seenSources.has(original.id);
   if(!retained)need(original.observedAt===(input.observedAt||o.at),'INVALID_OPERATION_HISTORY','The first original source observation changed.');
   expected={sourceId:original.id,rows:original.rows.length,retained};if(!retained)sourceOrder.push(original.id);seenSources.add(original.id);
  }else if(o.kind==='save-mapping'){
   need(seenSources.has(input.sourceId),'INVALID_OPERATION_HISTORY','A mapping precedes its original source import.');
   const expectedMapping={id:'mapping-'+hash({operationId:o.id,workspaceId:ws.id}).slice(0,40),role:input.role,domain:input.domain,sourceId:input.sourceId,columns:clone(input.columns),revision:o.revision,at:o.at};
   const actual=ws.mappingHistory.find(m=>m.id===expectedMapping.id);
   need(actual&&stable(actual)===stable(expectedMapping),'INVALID_OPERATION_HISTORY','The original mapping effect or its full history is missing.');
   seenMappings.push(actual);expected={mappingId:actual.id,sourceId:actual.sourceId,role:actual.role,domain:actual.domain};
  }else if(o.kind==='save-correction'){
   need(seenSources.has(input.sourceId),'INVALID_OPERATION_HISTORY','A correction precedes its original source import.');
   const original=sourceAt(ws,input.sourceId),originalRow=original.rows.find(r=>r.id===input.rowId);
   need(originalRow&&Number.isInteger(input.column)&&input.column>=0&&input.column<originalRow.cells.length,'INVALID_OPERATION_HISTORY','The corrected original cell is absent.');
   const key=original.id+':'+originalRow.id,cells=replayedCells.get(key)||originalRow.cells.slice();replayedCells.set(key,cells);
   const expectedCorrection={id:'correction-'+hash({operationId:o.id,workspaceId:ws.id}).slice(0,40),sourceId:original.id,rowId:originalRow.id,column:input.column,before:cells[input.column],value:input.value,reason:input.reason,actor:input.actor,at:o.at,revision:o.revision};
   const actual=ws.corrections.find(c=>c.id===expectedCorrection.id);
   need(actual&&stable(actual)===stable(expectedCorrection),'INVALID_OPERATION_HISTORY','The original correction or complete preceding value is missing.');
   cells[input.column]=actual.value;seenCorrections.push(actual);expected={correctionId:actual.id,sourceId:actual.sourceId,rowId:actual.rowId,column:actual.column,before:actual.before,value:actual.value};
  }else fail('INVALID_OPERATION_HISTORY','The saved operation kind is unsupported.');
  need(stable(expected)===stable(o.result),'INVALID_OPERATION_HISTORY','The saved operation result differs from its original effect.');
 }
 need(seenSources.size===ws.sources.length&&stable(sourceOrder)===stable(ws.sources.map(s=>s.id))&&stable(seenMappings)===stable(ws.mappingHistory)&&stable(seenCorrections)===stable(ws.corrections),'INVALID_OPERATION_HISTORY','Retain exactly the source and review histories created by these original operations.');
 for(const role of roleNames)for(const domain of Object.keys(DOMAINS)){
  const latest=seenMappings.filter(m=>m.role===role&&m.domain===domain).at(-1),current=ws.mappings[role][domain];
  need(stable(latest??null)===stable(current??null),'INVALID_OPERATION_HISTORY','The current mapping lost its latest original saved selection.');
 }
 return ws;
}
function mutate(workspace,kind,input,run){
 validateWorkspace(workspace);need(plain(input),'INVALID_INPUT','Supply the complete saved operation.');
 const operationId=id(input.operationId,'operation ID'),requestSha256=hash({kind,input}),old=workspace.operations.find(x=>x.id===operationId);
 if(old){need(old.requestSha256===requestSha256,'OPERATION_CONFLICT','This operation ID already belongs to another original request.');return {workspace,receipt:clone(old),replayed:true};}
 need(input.expectedRevision===workspace.revision,'REVISION_CONFLICT','The workspace changed. Reopen its current revision before applying this request.',{expected:input.expectedRevision,current:workspace.revision});
 need(workspace.operations.length<LIMITS.operations,'OPERATION_LIMIT','Preserve this complete workspace before starting a separately identified migration.');
 const ws=clone(workspace),at=instant(input.at||input.observedAt||new Date().toISOString(),'operation'),revision=ws.revision+1;
 const result=run(ws,revision,at),savedInput=clone(input);
 if(kind==='import-csv')delete savedInput.text;
 const receipt={id:operationId,kind,requestSha256,input:savedInput,...(kind==='import-csv'?{sourceInputId:result.sourceId}:{}),previousRevision:ws.revision,revision,at,result};
 ws.revision=revision;ws.operations.push(receipt);validateWorkspace(ws);portableText(ws);return {workspace:ws,receipt:clone(receipt),replayed:false};
}
export function importCsv(ws,input){return mutate(ws,'import-csv',input,(next,revision,at)=>{
 const role=roleName(input.role),domain=domainName(input.domain),filename=text(input.filename,'original filename',300),parsed=parseCsv(input.text),sourceId='source-'+hash({role,domain,filename,sha256:parsed.sha256}).slice(0,40);
 const existing=next.sources.find(x=>x.id===sourceId);if(existing)return {sourceId,rows:existing.rows.length,retained:true};
 need(next.sources.length<LIMITS.sources,'SOURCE_LIMIT','This workspace already contains128 original sources; retain the complete original before selecting a separate migration.');
 next.sources.push({id:sourceId,role,domain,filename,text:input.text,bytes:parsed.bytes,sha256:parsed.sha256,headers:parsed.headers,rows:parsed.rows.map((cells,i)=>({id:sourceId+':r'+(i+2),record:i+2,cells})),observedAt:input.observedAt?instant(input.observedAt,'source observation'):at});
 return {sourceId,rows:parsed.rows.length,retained:false};
});}
export function saveMapping(ws,input){return mutate(ws,'save-mapping',input,(next,revision,at)=>{
 const m={id:'mapping-'+hash({operationId:input.operationId,workspaceId:next.id}).slice(0,40),role:input.role,domain:input.domain,sourceId:input.sourceId,columns:clone(input.columns),revision,at};validateMapping(next,m);
 next.mappingHistory.push(m);next.mappings[m.role][m.domain]=clone(m);return {mappingId:m.id,sourceId:m.sourceId,role:m.role,domain:m.domain};
});}
export function saveCorrection(ws,input){return mutate(ws,'save-correction',input,(next,revision,at)=>{
 const source=sourceAt(next,input.sourceId),row=effectiveRows(next,source).find(r=>r.id===input.rowId);need(row&&Number.isInteger(input.column)&&input.column>=0&&input.column<row.cells.length,'INVALID_CORRECTION','Select an existing original row and cell.');
 const c={id:'correction-'+hash({operationId:input.operationId,workspaceId:next.id}).slice(0,40),sourceId:source.id,rowId:row.id,column:input.column,before:row.cells[input.column],value:text(input.value,'complete corrected cell',LIMITS.cellCharacters,true),reason:text(input.reason,'reviewed correction reason',4000),actor:text(input.actor,'reviewer',300),at,revision};
 next.corrections.push(c);return {correctionId:c.id,sourceId:c.sourceId,rowId:c.rowId,column:c.column,before:c.before,value:c.value};
});}

export function reconcile(workspace){
 const ws=validateWorkspace(workspace),issues=[],domains={source:{},target:{}},indexes={source:{},target:{}};
 const issue=(severity,code,ctx,message,details)=>{const entry={severity,code,...ctx,message,...(details===undefined?{}:{details})};issues.push({id:'finding-'+hash(entry).slice(0,40),...entry});};
 for(const role of roleNames)for(const [domain,spec]of Object.entries(DOMAINS)){
  const mapping=ws.mappings[role][domain];if(!mapping)continue;
  const source=sourceAt(ws,mapping.sourceId),used=new Set(Object.values(mapping.columns)),coverage={headers:source.headers.map((name,column)=>({column,name,fields:Object.entries(mapping.columns).filter(([,i])=>i===column).map(([n])=>n)})),unmappedColumns:source.headers.map((name,column)=>({column,name})).filter(x=>!used.has(x.column))};
  for(const f of spec.fields)if(f.required&&!Object.hasOwn(mapping.columns,f.name))issue('error','REQUIRED_MAPPING',{role,domain,sourceId:source.id,field:f.name},'Map the required '+f.label+' field.');
  const rows=effectiveRows(ws,source).map(row=>{
   const values={},rawValues={},context={role,domain,sourceId:source.id,rowId:row.id},before=issues.length;
   if(row.cells.length!==source.headers.length)issue('error','RAGGED_ROW',context,'The complete row has a different cell count from its header.',{headerColumns:source.headers.length,rowColumns:row.cells.length});
   for(const f of spec.fields){
    const index=mapping.columns[f.name],raw=index===undefined?'':row.cells[index]??'';rawValues[f.name]=raw;values[f.name]=raw;
    if(raw===''&&f.required)issue('error','REQUIRED_VALUE',{...context,field:f.name},'The required '+f.label+' value is missing.');
    if(raw!==''&&f.type==='decimal'){try{values[f.name]=decimal(raw);}catch{issue('error','INVALID_DECIMAL',{...context,field:f.name},'The quantity must be an exact non-negative decimal without exponent, grouping or rounding.',{value:raw});}}
    if(raw!==''&&f.type==='date'&&!validDate(raw)&&!( /^\d{4}-\d{2}-\d{2}T/.test(raw)&&validDate(raw.slice(0,10))&&Number.isFinite(Date.parse(raw))))issue('error','INVALID_DATE',{...context,field:f.name},'Use an explicit valid ISO date or timestamp.',{value:raw});
    if(raw!==''&&f.type==='id'&&raw.trim()!==raw)issue('warning','OPAQUE_ID_WHITESPACE',{...context,field:f.name},'This identifier contains surrounding whitespace. Its complete original bytes remain significant.',{value:raw});
   }
   return {rowId:row.id,record:row.record,key:values[spec.id],values,rawValues,cells:row.cells,valid:!issues.slice(before).some(x=>x.severity==='error')};
  });
  domains[role][domain]={sourceId:source.id,mappingId:mapping.id,rows,coverage};const index=new Map();
  for(const row of rows)if(row.key!==''){const list=index.get(row.key)||[];list.push(row);index.set(row.key,list);}
  indexes[role][domain]=index;
  for(const [key,list]of index)if(list.length>1){issue('error','DUPLICATE_ID',{role,domain,sourceId:source.id,field:spec.id},'The exact identifier occurs in multiple complete rows.',{key,rowIds:list.map(x=>x.rowId)});list.forEach(x=>x.valid=false);}
 }
 for(const role of roleNames)for(const [domain,selected]of Object.entries(domains[role])){
  const spec=DOMAINS[domain],unique=(d,key)=>{const list=indexes[role][d]?.get(key);return list?.length===1?list[0]:null;};
  for(const row of selected.rows){
   const ctx={role,domain,sourceId:selected.sourceId,rowId:row.rowId};
   for(const f of spec.fields.filter(x=>x.reference)){
    const value=row.values[f.name];if(value==='')continue;
    if(!indexes[role][f.reference]){issue('error','REFERENCE_DOMAIN_MISSING',{...ctx,field:f.name},'Select the referenced '+f.reference+' source before confirming this row.',{value,referenceDomain:f.reference});row.valid=false;}
    else if(!unique(f.reference,value)){issue('error','REFERENCE_NOT_UNIQUE',{...ctx,field:f.name},'The exact reference is missing or ambiguous in the selected original domain.',{value,referenceDomain:f.reference});row.valid=false;}
   }
   if(row.values.product_id&&row.values.unit){const product=unique('products',row.values.product_id);if(product&&row.values.unit!==product.values.unit){issue('error','PRODUCT_UNIT_MISMATCH',{...ctx,field:'unit'},'The quantity unit differs from the selected product unit; no conversion is assumed.',{unit:row.values.unit,productUnit:product.values.unit});row.valid=false;}}
   for(const [a,b]of [['valid_from','valid_to'],['issued_at','retired_at']])if(row.values[a]&&row.values[b]&&Number.isFinite(Date.parse(row.values[a]))&&Number.isFinite(Date.parse(row.values[b]))&&Date.parse(row.values[a])>Date.parse(row.values[b])){issue('error','DATE_ORDER',ctx,'The ending date precedes its original starting date.',{startField:a,endField:b});row.valid=false;}
   if(domain==='returns'&&row.values.issue_id){const original=unique('issues',row.values.issue_id);if(original){
    if(row.values.unit!==original.values.unit){issue('error','RETURN_UNIT_MISMATCH',{...ctx,field:'unit'},'This return unit differs from its original issue; it cannot be added to that issue quantity.',{issueId:original.key,issueUnit:original.values.unit,returnUnit:row.values.unit});row.valid=false;}
    if(row.values.asset_id&&row.values.asset_id!==original.values.asset_id){issue('error','RETURN_ASSET_MISMATCH',{...ctx,field:'asset_id'},'The returned asset differs from the asset in its original issue.',{issueId:original.key,issuedAsset:original.values.asset_id});row.valid=false;}
    if(row.values.returned_at&&original.values.issued_at&&Number.isFinite(Date.parse(row.values.returned_at))&&Number.isFinite(Date.parse(original.values.issued_at))&&Date.parse(row.values.returned_at)<Date.parse(original.values.issued_at)){issue('error','RETURN_BEFORE_ISSUE',ctx,'The return precedes its original issue.');row.valid=false;}
   }}
  }
  if(domain==='locations'){
   for(const row of selected.rows){const seen=new Set([row.key]);let next=row.values.parent_location_id;
    while(next){if(seen.has(next)){issue('error','LOCATION_CYCLE',{role,domain,sourceId:selected.sourceId,rowId:row.rowId},'The location-parent references contain a cycle.',{key:row.key});row.valid=false;break;}seen.add(next);const parent=unique('locations',next);if(!parent)break;next=parent.values.parent_location_id;}
   }
  }
 }
 const returnTotals={source:[],target:[]};
 for(const role of roleNames){const selected=domains[role].returns;if(!selected)continue;const grouped=new Map();
  for(const row of selected.rows){const key=row.values.issue_id;if(!key)continue;const list=grouped.get(key)||[];list.push(row);grouped.set(key,list);}
  for(const [issueId,rows]of grouped){const originals=indexes[role].issues?.get(issueId),original=originals?.length===1?originals[0]:null;
   const compatible=original&&original.valid&&rows.every(x=>x.valid&&x.values.unit===original.values.unit);
   if(!compatible){returnTotals[role].push({issueId,state:'INCOMPLETE',rowIds:rows.map(x=>x.rowId),total:null,issued:original?.values.quantity??null,unit:original?.values.unit??null});continue;}
   const total=quantitySum(rows.map(x=>x.values.quantity)),exceeds=quantityCompare(total,original.values.quantity)>0;
   returnTotals[role].push({issueId,state:exceeds?'EXCEEDS_ISSUED':'COMPATIBLE',rowIds:rows.map(x=>x.rowId),total,issued:original.values.quantity,unit:original.values.unit});
   if(exceeds){issue('error','RETURNS_EXCEED_ISSUE',{role,domain:'returns',sourceId:selected.sourceId},'Complete compatible-unit returns exceed the exact original issue quantity.',{issueId,total,issued:original.values.quantity,unit:original.values.unit,rowIds:rows.map(x=>x.rowId)});rows.forEach(x=>x.valid=false);}
  }
 }
 const comparisons={};
 for(const [domain,spec]of Object.entries(DOMAINS)){
  const left=domains.source[domain],right=domains.target[domain];if(!left&&!right)continue;
  const counts={equal:0,changed:0,sourceOnly:0,targetOnly:0,ambiguous:0,missingKey:0},rows=[];
  if(!left||!right){comparisons[domain]={state:'SIDE_MISSING',sourceId:left?.sourceId??null,targetId:right?.sourceId??null,rows,counts};issue('error','COMPARISON_SIDE_MISSING',{role:left?'target':'source',domain},'Select both original source and target mappings for complete domain comparison.');continue;}
  const keys=new Set([...indexes.source[domain].keys(),...indexes.target[domain].keys()]);
  for(const key of keys){const a=indexes.source[domain].get(key)||[],b=indexes.target[domain].get(key)||[];
   if(a.length>1||b.length>1){rows.push({key,state:'AMBIGUOUS',sources:clone(a),targets:clone(b),cells:[]});counts.ambiguous++;continue;}
   const source=a[0],target=b[0],cells=spec.fields.map(f=>({field:f.name,source:source?.values[f.name]??null,target:target?.values[f.name]??null,sourceRaw:source?.rawValues[f.name]??null,targetRaw:target?.rawValues[f.name]??null,equal:!!source&&!!target&&source.values[f.name]===target.values[f.name],rawEqual:!!source&&!!target&&source.rawValues[f.name]===target.rawValues[f.name]}));
   // Unmapped original columns are paired by exact heading plus occurrence, with indexes retained.
   const extras=(side,row)=>{const out=[],seen=new Map();for(const h of side.coverage.headers){const occurrence=(seen.get(h.name)||0)+1;seen.set(h.name,occurrence);if(!h.fields.length)out.push({key:JSON.stringify([h.name,occurrence]),header:h.name,occurrence,column:h.column,value:row?.cells[h.column]??null});}return out;};
   const x=extras(left,source),y=extras(right,target),extraKeys=new Set([...x.map(v=>v.key),...y.map(v=>v.key)]),unmappedCells=[...extraKeys].map(k=>{const a=x.find(v=>v.key===k),b=y.find(v=>v.key===k);return{header:a?.header??b.header,occurrence:a?.occurrence??b.occurrence,sourceColumn:a?.column??null,targetColumn:b?.column??null,source:a?.value??null,target:b?.value??null,equal:!!a&&!!b&&a.value===b.value};});
   const state=!source?'TARGET_ONLY':!target?'SOURCE_ONLY':cells.every(x=>x.equal)&&unmappedCells.every(x=>x.equal)?'EQUAL':'CHANGED';
   counts[{EQUAL:'equal',CHANGED:'changed',SOURCE_ONLY:'sourceOnly',TARGET_ONLY:'targetOnly'}[state]]++;
   rows.push({key,state,sourceRowId:source?.rowId??null,targetRowId:target?.rowId??null,sourceCells:source?.cells??null,targetCells:target?.cells??null,cells,unmappedCells});
  }
  for(const [role,selected]of [['source',left],['target',right]])for(const row of selected.rows.filter(x=>x.key==='')){rows.push({key:'',state:'MISSING_KEY',role,row:clone(row),cells:[]});counts.missingKey++;}
  comparisons[domain]={state:'COMPLETE',sourceId:left.sourceId,targetId:right.sourceId,rows,counts};
 }
 if(!Object.keys(comparisons).length)issue('error','NO_SELECTION',{},'Import and map the actual source and target domains before reconciliation.');
 const errors=issues.filter(x=>x.severity==='error').length,warnings=issues.length-errors,differences=Object.values(comparisons).reduce((n,x)=>n+x.counts.changed+x.counts.sourceOnly+x.counts.targetOnly+x.counts.ambiguous+x.counts.missingKey,0);
 return {schema:'tjlabs.uniform-migration-reconciliation.v1',workspaceId:ws.id,revision:ws.revision,ready:errors===0&&differences===0,issues,domains,comparisons,returnTotals,summary:{errors,warnings,differences,selectedDomains:Object.keys(comparisons).length,sourceRows:Object.values(domains.source).reduce((n,x)=>n+x.rows.length,0),targetRows:Object.values(domains.target).reduce((n,x)=>n+x.rows.length,0)}};
}
function portableText(workspace){const envelope={schema:'tjlabs.uniform-migration-portable.v1',workspace,sha256:hash(workspace)},value=JSON.stringify(envelope,null,2)+'\n';need(sha256Utf8(value).bytes<=LIMITS.workspaceBytes,'WORKSPACE_TOO_LARGE','The complete workspace exceeds128 MiB; preserve original sources and explicit separate migration scopes.');return value;}
export function exportWorkspace(workspace){validateWorkspace(workspace);return portableText(workspace);}
export function importWorkspace(value){text(value,'complete portable workspace',LIMITS.workspaceBytes);need(sha256Utf8(value).bytes<=LIMITS.workspaceBytes,'WORKSPACE_TOO_LARGE','The complete workspace exceeds128 MiB.');let envelope;try{envelope=JSON.parse(value);}catch{fail('INVALID_JSON','Choose the complete saved workspace JSON.');}need(envelope?.schema==='tjlabs.uniform-migration-portable.v1'&&plain(envelope.workspace)&&envelope.sha256===hash(envelope.workspace),'WORKSPACE_CHANGED','The complete saved workspace identity differs.');return validateWorkspace(clone(envelope.workspace));}
export function buildHandover(workspace){
 const ws=validateWorkspace(workspace),report=reconcile(ws),files=[];
 const add=(path,type,text)=>{files.push({path,type,text,...sha256Utf8(text)});};
 add('workspace.json','application/json',exportWorkspace(ws));add('reconciliation.json','application/json',JSON.stringify(report,null,2)+'\n');
 add('review-history.json','application/json',JSON.stringify({workspaceId:ws.id,revision:ws.revision,mappingHistory:ws.mappingHistory,corrections:ws.corrections,operations:ws.operations},null,2)+'\n');
 for(const s of ws.sources){add('originals/'+s.id+'.csv','text/csv',s.text);add('corrected/'+s.id+'.csv','text/csv',encodeCsv([s.headers,...effectiveRows(ws,s).map(x=>x.cells)]));}
 for(const role of roleNames)for(const [domain,selected]of Object.entries(report.domains[role]))add('canonical/'+role+'/'+domain+'.csv','text/csv',encodeCsv([['_source_row_id',...DOMAINS[domain].fields.map(f=>f.name)],...selected.rows.map(r=>[r.rowId,...DOMAINS[domain].fields.map(f=>r.values[f.name])])]));
 const manifest={schema:'tjlabs.uniform-migration-handover-manifest.v1',workspaceId:ws.id,revision:ws.revision,ready:report.ready,summary:report.summary,originalSources:ws.sources.map(({text,rows,headers,...s})=>({...s,headers,rowCount:rows.length})),files:files.map(({text,...f})=>f),meaning:'Complete migration working handover. Read reconciliation findings and original mapping/correction history. This package does not upload into a supplier tenant, infer stock balances or establish production acceptance.'};
 add('MANIFEST.json','application/json',JSON.stringify(manifest,null,2)+'\n');
 return {schema:'tjlabs.uniform-migration-handover.v1',workspaceId:ws.id,revision:ws.revision,ready:report.ready,files,manifest};
}
