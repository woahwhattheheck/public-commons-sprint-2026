import {sha256Utf8,sha256Bytes} from './sha256.mjs';

export const WORKSPACE_SCHEMA='tjlabs.fixed-asset-migration-workspace.v1';
export const LIMITS=Object.freeze({csvBytes:32*1024*1024,workspaceBytes:128*1024*1024,rows:100000,columns:512,sources:128,operations:10000,cellCharacters:1000000,supportingBytes:32*1024*1024,supportingFiles:128});
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
 assets:{label:'Assets',id:'asset_id',key:['company_id','asset_id'],fields:[field('company_id','id',true),field('asset_id','id',true),field('parent_asset_id','id'),field('class_code'),field('description')]},
 books:{label:'Books',id:'book_id',key:['company_id','book_id'],fields:[field('company_id','id',true),field('book_id','id',true),field('currency','currency',true),field('accounting_basis','string',true)]},
 balances:{label:'Balances',id:'asset_id',key:['company_id','book_id','asset_id','as_of','currency','measure'],fields:[field('company_id','id',true),field('book_id','id',true),field('asset_id','id',true),field('as_of','date',true),field('currency','currency',true),field('measure','id',true),field('amount','decimal',true)]},
 events:{label:'Events',id:'event_id',key:['company_id','book_id','event_id'],fields:[field('company_id','id',true),field('book_id','id',true),field('asset_id','id',true),field('event_id','id',true),field('effective_date','date',true),field('currency','currency',true),field('measure','id',true),field('signed_amount','decimal',true),field('event_type')]},
 journals:{label:'Journals',id:'journal_id',key:['company_id','book_id','journal_id','line_id'],fields:[field('company_id','id',true),field('book_id','id',true),field('journal_id','id',true),field('line_id','id',true),field('posting_date','date',true),field('currency','currency',true),field('account_code','id',true),field('debit','nonnegative',true),field('credit','nonnegative',true),field('asset_id','id')]},
 controls:{label:'Controls',id:'measure',key:['company_id','book_id','as_of','currency','measure'],fields:[field('company_id','id',true),field('book_id','id',true),field('as_of','date',true),field('currency','currency',true),field('measure','id',true),field('amount','decimal',true),field('source_reference')]}
});
for(const spec of Object.values(DOMAINS)){for(const f of spec.fields)Object.freeze(f);Object.freeze(spec.fields);Object.freeze(spec.key);Object.freeze(spec);}
const financialDomains=new Set(['balances','events','journals','controls']);
function domainName(x){need(Object.hasOwn(DOMAINS,x),'INVALID_DOMAIN','Select one of the six financial migration domains.');return x;}
function roleName(x){need(roleNames.includes(x),'INVALID_ROLE','Choose source or target.');return x;}
export function decimal(value){
 text(value,'an exact signed decimal amount',102);
 need(/^[+-]?\d{1,80}(?:\.\d{1,18})?$/.test(value),'INVALID_DECIMAL','Use a signed decimal string without grouping, exponent or rounding, up to80 whole and18 fractional digits.');
 const negative=value[0]==='-';let [whole,fraction='']=value.replace(/^[+-]/,'').split('.');
 whole=whole.replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
 return (negative&&(whole!=='0'||fraction)?'-':'')+whole+(fraction?'.'+fraction:'');
}
function decimalPair(value){const v=decimal(value),negative=v[0]==='-',p=v.replace(/^-/,'').split('.');return{n:BigInt(p.join(''))*(negative?-1n:1n),scale:p[1]?.length||0};}
function formatDecimal(n,scale){const negative=n<0n;let s=(negative?-n:n).toString().padStart(scale+1,'0');if(scale)s=s.slice(0,-scale)+'.'+s.slice(-scale);if(s.includes('.'))s=s.replace(/0+$/,'').replace(/\.$/,'');return(negative?'-':'')+s;}
function pairAny(value){const negative=value[0]==='-',p=value.replace(/^-/,'').split('.');return{n:BigInt(p.join(''))*(negative?-1n:1n),scale:p[1]?.length||0};}
function amountSum(values){let n=0n,scale=0;for(const value of values){const v=pairAny(value);if(v.scale>scale){n*=10n**BigInt(v.scale-scale);scale=v.scale;}n+=v.n*10n**BigInt(scale-v.scale);}return formatDecimal(n,scale);}
function amountNegate(value){return value==='0'?'0':value[0]==='-'?value.slice(1):'-'+value;}
function amountDifference(actual,expected){return amountSum([actual,amountNegate(expected)]);}
function scaledAmount(value,multiplier){const v=decimalPair(value);return formatDecimal(v.n*BigInt(multiplier),v.scale);}
function groupKey(values,names){return JSON.stringify(names.map(name=>values[name]));}
function currentBasis(ws,mappings=ws.mappings,corrections=ws.corrections,supportingFiles=ws.supportingFiles){
 const selected=[];for(const role of roleNames)for(const domain of Object.keys(DOMAINS)){const m=mappings[role][domain];if(m){const s=sourceAt(ws,m.sourceId);selected.push({role,domain,sourceId:s.id,source_sha256:s.sha256,mapping:m,corrections:corrections.filter(c=>c.sourceId===s.id)});}}
 return hash({workspaceId:ws.id,selected,supportingFiles:supportingFiles.map(({base64,...file})=>file)});
}
export function financeBasis(ws){validateWorkspace(ws);return currentBasis(ws);}
function normalizePolicy(value){
 need(plain(value),'INVALID_FINANCE_POLICY','Supply the complete declared financial basis.');
 need(Array.isArray(value.rollforward_measures)&&Array.isArray(value.carrying_equations),'INVALID_FINANCE_POLICY','Supply explicit movement-measure and carrying-equation arrays.');
 const p={id:id(value.id,'financial policy ID'),company_id:text(value.company_id,'exact company ID',1000),book_id:text(value.book_id,'exact book ID',1000),currency:text(value.currency,'currency code',3),
 opening_date:value.opening_date,closing_date:value.closing_date,event_scope_complete:value.event_scope_complete,population_complete:value.population_complete,
 rollforward_measures:clone(value.rollforward_measures),carrying_equations:clone(value.carrying_equations),actor:text(value.actor,'basis reviewer',300),note:text(value.note,'complete basis explanation',4000)};
 need(/^[A-Z]{3}$/.test(p.currency),'INVALID_FINANCE_POLICY','Use the explicit three-letter currency code.');
 need(validDate(p.opening_date)&&validDate(p.closing_date)&&p.opening_date<p.closing_date,'INVALID_FINANCE_POLICY','Use valid opening and closing calendar dates, with opening before closing.');
 need(typeof p.event_scope_complete==='boolean'&&typeof p.population_complete==='boolean','INVALID_FINANCE_POLICY','Explicitly record both event-scope and population completeness.');
 need(Array.isArray(p.rollforward_measures)&&p.rollforward_measures.length<=64,'INVALID_FINANCE_POLICY','Select the original movement measures, at most64.');
 for(const measure of p.rollforward_measures)text(measure,'exact movement measure',1000);
 need(new Set(p.rollforward_measures).size===p.rollforward_measures.length,'INVALID_FINANCE_POLICY','Keep each movement measure once.');
 need(Array.isArray(p.carrying_equations)&&p.carrying_equations.length<=32,'INVALID_FINANCE_POLICY','Retain at most32 explicit carrying equations.');
 const results=new Set();for(const e of p.carrying_equations){
  need(plain(e),'INVALID_FINANCE_POLICY','Supply the complete carrying equation.');text(e.result_measure,'exact resulting measure',1000);
  need(!results.has(e.result_measure),'INVALID_FINANCE_POLICY','Keep one equation per resulting measure.');results.add(e.result_measure);
  need(Array.isArray(e.components)&&e.components.length>0&&e.components.length<=32,'INVALID_FINANCE_POLICY','Supply all equation components, at most32.');
  const seen=new Set();for(const c of e.components){need(plain(c)&&(c.coefficient===1||c.coefficient===-1),'INVALID_FINANCE_POLICY','Each component requires an explicit1 or-1 coefficient.');text(c.measure,'exact component measure',1000);need(!seen.has(c.measure),'INVALID_FINANCE_POLICY','Keep each component measure once.');seen.add(c.measure);}
 }
 return p;
}

const b64Alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeBase64(value){
 need(typeof value==='string'&&value.length<=Math.ceil(LIMITS.supportingBytes/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'INVALID_BASE64','Retain complete canonical Base64 bytes without whitespace.');
 const size=value.length/4*3-(value.endsWith('==')?2:value.endsWith('=')?1:0);need(size<=LIMITS.supportingBytes,'SUPPORTING_FILE_TOO_LARGE','Choose a complete supporting file within32 MiB.');
 const out=new Uint8Array(size);let at=0;
 for(let i=0;i<value.length;i+=4){
  const a=b64Alphabet.indexOf(value[i]),b=b64Alphabet.indexOf(value[i+1]),c=value[i+2]==='='?0:b64Alphabet.indexOf(value[i+2]),d=value[i+3]==='='?0:b64Alphabet.indexOf(value[i+3]);
  if(i+4===value.length){need(value[i+2]!=='='||(b&15)===0,'INVALID_BASE64','Retain canonical Base64 padding bits.');need(value[i+3]!=='='||value[i+2]==='='||(c&3)===0,'INVALID_BASE64','Retain canonical Base64 padding bits.');}
  if(at<size)out[at++]=(a<<2)|(b>>4);if(at<size)out[at++]=((b&15)<<4)|(c>>2);if(at<size)out[at++]=((c&3)<<6)|d;
 }
 return out;
}
function supportingValue(input,at){
 const filename=text(input.filename,'original supporting filename',300),mimeType=text(input.mimeType,'original media type',200),purpose=text(input.purpose,'original file purpose',4000);
 need(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mimeType),'INVALID_MEDIA_TYPE','Use the complete original media type without header parameters.');
 const identity=sha256Bytes(decodeBase64(input.base64)),fileId='supporting-'+hash({filename,mimeType,purpose,...identity}).slice(0,40);
 return{id:fileId,filename,mimeType,purpose,base64:input.base64,...identity,observedAt:at};
}
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
 return {schema:WORKSPACE_SCHEMA,id:id(workspaceId,'workspace ID'),title:text(title,'workspace title',300),createdAt:instant(createdAt,'creation'),revision:0,sources:[],mappings:{source:{},target:{}},mappingHistory:[],corrections:[],financePolicies:[],financePolicyHistory:[],supportingFiles:[],operations:[]};
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
 need(financialDomains.has(m.domain)?m.amount_multiplier===1||m.amount_multiplier===1000:m.amount_multiplier===1,'INVALID_AMOUNT_MULTIPLIER','Explicitly select amount_multiplier1 or1000 for financial mappings; assets/books use1.');
 return source;
}
export function validateWorkspace(ws){
 need(plain(ws)&&ws.schema===WORKSPACE_SCHEMA,'INVALID_WORKSPACE','Open the complete original migration workspace.');
 id(ws.id,'workspace ID');text(ws.title,'workspace title',300);instant(ws.createdAt,'workspace creation');
 need(Number.isSafeInteger(ws.revision)&&ws.revision>=0&&Array.isArray(ws.sources)&&ws.sources.length<=LIMITS.sources&&Array.isArray(ws.corrections)&&Array.isArray(ws.mappingHistory)&&Array.isArray(ws.operations)&&ws.operations.length<=LIMITS.operations,'INVALID_WORKSPACE','Retain complete original source, mapping, correction and operation lists.');
 need(ws.revision===ws.operations.length,'INVALID_OPERATION_HISTORY','Retain the complete operation sequence.');
 need(Array.isArray(ws.supportingFiles)&&ws.supportingFiles.length<=LIMITS.supportingFiles,'INVALID_SUPPORTING_FILES','Retain every complete original supporting file.');
 const supportingIds=new Set();for(const f of ws.supportingFiles){need(plain(f),'INVALID_SUPPORTING_FILE','Retain the complete original supporting file.');instant(f.observedAt,'supporting file observation');const expected=supportingValue(f,f.observedAt);need(!supportingIds.has(f.id)&&stable(expected)===stable(f),'SUPPORTING_FILE_CHANGED','The complete supporting bytes, metadata or identity differ.');supportingIds.add(f.id);}
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
 need(Array.isArray(ws.financePolicies)&&Array.isArray(ws.financePolicyHistory),'INVALID_FINANCE_POLICY','Retain all original financial policy editions.');
 const opIds=new Set(),seenSources=new Set(),sourceOrder=[],seenMappings=[],seenCorrections=[],seenPolicies=[],seenSupporting=[],replayedMappings={source:{},target:{}},replayedPolicies=[],replayedCells=new Map();
 for(let i=0;i<ws.operations.length;i++){
  const o=ws.operations[i];id(o.id,'operation ID');
  need(!opIds.has(o.id)&&o.revision===i+1&&o.previousRevision===i&&plain(o.input)&&plain(o.result),'INVALID_OPERATION_HISTORY','Retain distinct ordered original requests and receipts.');opIds.add(o.id);instant(o.at,'operation time');
  const input=clone(o.input);
  if(o.kind==='import-supporting'){
   const file=ws.supportingFiles.find(f=>f.id===o.supportingInputId);need(file,'INVALID_OPERATION_HISTORY','Retain the complete original supporting file for this request.');input.base64=file.base64;
  }
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
   const expectedMapping={id:'mapping-'+hash({operationId:o.id,workspaceId:ws.id}).slice(0,40),role:input.role,domain:input.domain,sourceId:input.sourceId,columns:clone(input.columns),amount_multiplier:input.amount_multiplier,revision:o.revision,at:o.at};
   const actual=ws.mappingHistory.find(m=>m.id===expectedMapping.id);
   need(actual&&stable(actual)===stable(expectedMapping),'INVALID_OPERATION_HISTORY','The original mapping effect or its full history is missing.');
   seenMappings.push(actual);replayedMappings[actual.role][actual.domain]=actual;expected={mappingId:actual.id,sourceId:actual.sourceId,role:actual.role,domain:actual.domain};
  }else if(o.kind==='save-correction'){
   need(seenSources.has(input.sourceId),'INVALID_OPERATION_HISTORY','A correction precedes its original source import.');
   const original=sourceAt(ws,input.sourceId),originalRow=original.rows.find(r=>r.id===input.rowId);
   need(originalRow&&Number.isInteger(input.column)&&input.column>=0&&input.column<originalRow.cells.length,'INVALID_OPERATION_HISTORY','The corrected original cell is absent.');
   const key=original.id+':'+originalRow.id,cells=replayedCells.get(key)||originalRow.cells.slice();replayedCells.set(key,cells);
   const expectedCorrection={id:'correction-'+hash({operationId:o.id,workspaceId:ws.id}).slice(0,40),sourceId:original.id,rowId:originalRow.id,column:input.column,before:cells[input.column],value:input.value,reason:input.reason,actor:input.actor,at:o.at,revision:o.revision};
   const actual=ws.corrections.find(c=>c.id===expectedCorrection.id);
   need(actual&&stable(actual)===stable(expectedCorrection),'INVALID_OPERATION_HISTORY','The original correction or complete preceding value is missing.');
   cells[input.column]=actual.value;seenCorrections.push(actual);expected={correctionId:actual.id,sourceId:actual.sourceId,rowId:actual.rowId,column:actual.column,before:actual.before,value:actual.value};
  }else if(o.kind==='import-supporting'){
   const original=ws.supportingFiles.find(f=>f.id===o.supportingInputId),retained=seenSupporting.some(f=>f.id===original.id),expectedFile=supportingValue(input,retained?original.observedAt:o.at);
   need(stable(expectedFile)===stable(original),'INVALID_OPERATION_HISTORY','The supporting file differs from its original complete import request.');
   if(!retained)seenSupporting.push(original);
   expected={supportingFileId:original.id,bytes:original.bytes,sha256:original.sha256,retained};
  }else if(o.kind==='save-finance-policy'){
   const normalized=normalizePolicy(input.policy),basis_sha256=currentBasis(ws,replayedMappings,seenCorrections,seenSupporting);
   const expectedPolicy={...normalized,basis_sha256,revision:o.revision,at:o.at};
   const actual=ws.financePolicyHistory.find(p=>p.id===normalized.id&&p.revision===o.revision);
   need(actual&&stable(actual)===stable(expectedPolicy),'INVALID_OPERATION_HISTORY','The complete declared financial basis or its selected-source binding changed.');
   need(!replayedPolicies.some(p=>p.id!==actual.id&&p.company_id===actual.company_id&&p.book_id===actual.book_id&&p.currency===actual.currency),'INVALID_FINANCE_POLICY','Keep one current policy per exact company/book/currency.');
   const prior=replayedPolicies.findIndex(p=>p.id===actual.id);if(prior<0)replayedPolicies.push(actual);else replayedPolicies[prior]=actual;
   seenPolicies.push(actual);expected={policyId:actual.id,basis_sha256,company_id:actual.company_id,book_id:actual.book_id,currency:actual.currency};
  }else fail('INVALID_OPERATION_HISTORY','The saved operation kind is unsupported.');
  need(stable(expected)===stable(o.result),'INVALID_OPERATION_HISTORY','The saved operation result differs from its original effect.');
 }
 need(seenSources.size===ws.sources.length&&stable(sourceOrder)===stable(ws.sources.map(s=>s.id))&&stable(seenMappings)===stable(ws.mappingHistory)&&stable(seenCorrections)===stable(ws.corrections)&&stable(seenPolicies)===stable(ws.financePolicyHistory)&&stable(replayedPolicies)===stable(ws.financePolicies)&&stable(seenSupporting)===stable(ws.supportingFiles),'INVALID_OPERATION_HISTORY','Retain exactly the source and review histories created by these original operations.');
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
 if(kind==='import-supporting')delete savedInput.base64;
 const receipt={id:operationId,kind,requestSha256,input:savedInput,...(kind==='import-csv'?{sourceInputId:result.sourceId}:{}),...(kind==='import-supporting'?{supportingInputId:result.supportingFileId}:{}),previousRevision:ws.revision,revision,at,result};
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
 const m={id:'mapping-'+hash({operationId:input.operationId,workspaceId:next.id}).slice(0,40),role:input.role,domain:input.domain,sourceId:input.sourceId,columns:clone(input.columns),amount_multiplier:input.amount_multiplier,revision,at};validateMapping(next,m);
 next.mappingHistory.push(m);next.mappings[m.role][m.domain]=clone(m);return {mappingId:m.id,sourceId:m.sourceId,role:m.role,domain:m.domain};
});}
export function saveCorrection(ws,input){return mutate(ws,'save-correction',input,(next,revision,at)=>{
 const source=sourceAt(next,input.sourceId),row=effectiveRows(next,source).find(r=>r.id===input.rowId);need(row&&Number.isInteger(input.column)&&input.column>=0&&input.column<row.cells.length,'INVALID_CORRECTION','Select an existing original row and cell.');
 const c={id:'correction-'+hash({operationId:input.operationId,workspaceId:next.id}).slice(0,40),sourceId:source.id,rowId:row.id,column:input.column,before:row.cells[input.column],value:text(input.value,'complete corrected cell',LIMITS.cellCharacters,true),reason:text(input.reason,'reviewed correction reason',4000),actor:text(input.actor,'reviewer',300),at,revision};
 next.corrections.push(c);return {correctionId:c.id,sourceId:c.sourceId,rowId:c.rowId,column:c.column,before:c.before,value:c.value};
});}


export function saveFinancePolicy(ws,input){return mutate(ws,'save-finance-policy',input,(next,revision,at)=>{
 const p={...normalizePolicy(input.policy),basis_sha256:currentBasis(next),revision,at};
 need(!next.financePolicies.some(v=>v.id!==p.id&&v.company_id===p.company_id&&v.book_id===p.book_id&&v.currency===p.currency),'INVALID_FINANCE_POLICY','Edit the existing policy for this company/book/currency rather than adding a competing scope.');
 const previous=next.financePolicies.findIndex(v=>v.id===p.id);if(previous<0)next.financePolicies.push(p);else next.financePolicies[previous]=p;
 next.financePolicyHistory.push(p);return {policyId:p.id,basis_sha256:p.basis_sha256,company_id:p.company_id,book_id:p.book_id,currency:p.currency};
});}

export function importSupportingFile(ws,input){return mutate(ws,'import-supporting',input,(next,revision,at)=>{
 const file=supportingValue(input,at),existing=next.supportingFiles.find(f=>f.id===file.id);
 if(existing)return{supportingFileId:existing.id,bytes:existing.bytes,sha256:existing.sha256,retained:true};
 need(next.supportingFiles.length<LIMITS.supportingFiles,'SUPPORTING_FILE_LIMIT','Preserve the complete current selection before adding another supporting-file scope.');
 next.supportingFiles.push(file);return{supportingFileId:file.id,bytes:file.bytes,sha256:file.sha256,retained:false};
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
   if(row.cells.length!==source.headers.length)issue('error','RAGGED_ROW',context,'The complete row has a different cell count from its original header.',{headerColumns:source.headers.length,rowColumns:row.cells.length});
   for(const f of spec.fields){
    const column=mapping.columns[f.name],raw=column===undefined?'':row.cells[column]??'';rawValues[f.name]=raw;values[f.name]=raw;
    if(raw===''&&f.required)issue('error','REQUIRED_VALUE',{...context,field:f.name},'The required '+f.label+' value is missing.');
    if(raw!==''&&(f.type==='decimal'||f.type==='nonnegative')){try{
     const normalized=decimal(raw);need(f.type!=='nonnegative'||normalized[0]!=='-','NEGATIVE_AMOUNT','Debit and credit amounts must be non-negative.');
     values[f.name]=scaledAmount(normalized,mapping.amount_multiplier);
    }catch(error){issue('error',error.code||'INVALID_DECIMAL',{...context,field:f.name},'Use an exact declared decimal amount without grouping, exponent or rounding; debit/credit must be non-negative.',{value:raw,amount_multiplier:mapping.amount_multiplier});}}
    if(raw!==''&&f.type==='date'&&!validDate(raw))issue('error','INVALID_DATE',{...context,field:f.name},'Use an explicit valid ISO calendar date YYYY-MM-DD.',{value:raw});
    if(raw!==''&&f.type==='currency'&&!/^[A-Z]{3}$/.test(raw))issue('error','INVALID_CURRENCY',{...context,field:f.name},'Use the declared three-letter uppercase currency code.',{value:raw});
    if(raw!==''&&f.type==='id'&&raw.trim()!==raw)issue('warning','OPAQUE_ID_WHITESPACE',{...context,field:f.name},'Surrounding whitespace is significant in this exact original identifier.',{value:raw});
   }
   return {rowId:row.id,record:row.record,key:spec.key.every(name=>values[name]!=='')?groupKey(values,spec.key):'',values,rawValues,cells:row.cells,valid:!issues.slice(before).some(x=>x.severity==='error')};
  });
  domains[role][domain]={sourceId:source.id,mappingId:mapping.id,amount_multiplier:mapping.amount_multiplier,rows,coverage};const index=new Map();
  for(const row of rows)if(row.key!==''){const list=index.get(row.key)||[];list.push(row);index.set(row.key,list);}
  indexes[role][domain]=index;
  for(const [key,list]of index)if(list.length>1){issue('error','DUPLICATE_KEY',{role,domain,sourceId:source.id},'The exact composite key occurs in multiple complete rows.',{key,fields:spec.key,rowIds:list.map(x=>x.rowId)});list.forEach(x=>x.valid=false);}
 }
 for(const role of roleNames){
  const unique=(domain,key)=>{const list=indexes[role][domain]?.get(key);return list?.length===1?list[0]:null;};
  // Composite references always include company; book currency is never inferred from another row.
  for(const [domain,selected]of Object.entries(domains[role]))for(const row of selected.rows){
   const v=row.values,ctx={role,domain,sourceId:selected.sourceId,rowId:row.rowId};
   const reference=(to,names,field)=>{
    const key=groupKey(v,names),target=unique(to,key);
    if(!target||!target.valid){issue('error','REFERENCE_NOT_UNIQUE',{...ctx,field},'The selected complete reference is absent, ambiguous or invalid.',{referenceDomain:to,key});row.valid=false;return null;}
    return target;
   };
   if(financialDomains.has(domain)){const book=reference('books',['company_id','book_id'],'book_id');
    if(book&&book.values.currency!==v.currency){issue('error','BOOK_CURRENCY_MISMATCH',{...ctx,field:'currency'},'The amount currency differs from the exact selected book; no conversion is assumed.',{currency:v.currency,bookCurrency:book.values.currency});row.valid=false;}
    if(v.asset_id)reference('assets',['company_id','asset_id'],'asset_id');
   }
   if(domain==='assets'&&v.parent_asset_id){const parent=unique('assets',JSON.stringify([v.company_id,v.parent_asset_id]));
    if(!parent||!parent.valid){issue('error','PARENT_ASSET_NOT_UNIQUE',{...ctx,field:'parent_asset_id'},'The exact parent asset is absent, ambiguous or invalid within this company.',{company_id:v.company_id,parent_asset_id:v.parent_asset_id});row.valid=false;}
   }
  }
  const done=new Set();for(const start of domains[role].assets?.rows||[]){
   if(done.has(start.key)||!start.key)continue;const path=[],positions=new Map();let row=start;
   while(row&&!done.has(row.key)){
    if(positions.has(row.key)){const cycle=path.slice(positions.get(row.key));for(const member of cycle){issue('error','ASSET_PARENT_CYCLE',{role,domain:'assets',sourceId:domains[role].assets.sourceId,rowId:member.rowId},'The exact company asset-parent references contain a cycle.',{keys:cycle.map(x=>x.key)});member.valid=false;}break;}
    positions.set(row.key,path.length);path.push(row);row=row.values.parent_asset_id?unique('assets',JSON.stringify([row.values.company_id,row.values.parent_asset_id])):null;
   }
   for(const member of path)done.add(member.key);
  }
  // Cyclic parents also invalidate a referencing monetary row before any total is calculated.
  for(const domain of financialDomains)for(const row of domains[role][domain]?.rows||[])if(row.values.asset_id){
   const asset=unique('assets',JSON.stringify([row.values.company_id,row.values.asset_id]));if(asset&&!asset.valid&&row.valid){row.valid=false;issue('error','INVALID_ASSET_REFERENCE',{role,domain,sourceId:domains[role][domain].sourceId,rowId:row.rowId},'Resolve the referenced original asset before including this financial row.');}
  }
 }
 const basis_sha256=currentBasis(ws),financial={basis_sha256,policies:ws.financePolicies.map(p=>({...p,basisCurrent:p.basis_sha256===basis_sha256})),rollforwards:[],controls:[],equations:[],journals:[],confirmed:true};
 const addFinancial=(section,row,domain,message)=>{
  financial[section].push(row);if(row.state!=='MATCH'){financial.confirmed=false;issue(['UNCONFIRMED','STALE_BASIS'].includes(row.state)?'warning':'error','FINANCIAL_'+row.state,{role:row.role,domain,policyId:row.policyId??null},message,{...row});}
 };
 const groupRows=(rows,names)=>{const groups=new Map();for(const row of rows){const key=groupKey(row.values,names),list=groups.get(key)||[];list.push(row);groups.set(key,list);}return groups;};
 const uniqueAmount=(rows,field='amount')=>{
  if(!rows?.length)return{state:'MISSING',amount:null};
  if(rows.length!==1)return{state:'AMBIGUOUS',amount:null};
  return rows[0].valid?{state:'MATCH',amount:rows[0].values[field]}:{state:'INVALID',amount:null};
 };
 const badState=states=>states.includes('AMBIGUOUS')?'AMBIGUOUS':states.includes('INVALID')?'INVALID':states.includes('MISSING')?'MISSING':null;
 const sameScope=(v,p)=>v.company_id===p.company_id&&v.book_id===p.book_id&&v.currency===p.currency;
 for(const role of roleNames){
  const scopeRows=[...(domains[role].books?.rows||[]),...[...financialDomains].flatMap(d=>domains[role][d]?.rows||[])],scopes=groupRows(scopeRows,['company_id','book_id','currency']);
  for(const [scope,rows]of scopes){
   const v=rows[0].values,p=financial.policies.find(p=>sameScope(v,p));
   if(!p){financial.confirmed=false;issue('warning','FINANCIAL_BASIS_UNCONFIRMED',{role,domain:'books'},'Record the explicit selected-source financial basis for this company/book/currency before confirming financial reconciliation.',{company_id:v.company_id,book_id:v.book_id,currency:v.currency});}
  }
  // Journal arithmetic needs no population claim; each returned group stays in its own book/currency.
  for(const rows of groupRows(domains[role].journals?.rows||[],['company_id','book_id','journal_id','currency']).values()){
   const v=rows[0].values,valid=rows.every(r=>r.valid),debit=valid?amountSum(rows.map(r=>r.values.debit)):null,credit=valid?amountSum(rows.map(r=>r.values.credit)):null,difference=valid?amountDifference(debit,credit):null;
   const dates=[...new Set(rows.map(r=>r.values.posting_date))];const state=!valid?'INVALID':difference==='0'?'MATCH':'DIFFERENCE';
   addFinancial('journals',{role,company_id:v.company_id,book_id:v.book_id,currency:v.currency,journal_id:v.journal_id,posting_dates:dates,debit,credit,difference,state,rowIds:rows.map(r=>r.rowId)},'journals','The complete journal group contains invalid lines or unbalanced exact amounts.');
  }
  for(const p of financial.policies){
   if(!scopes.has(JSON.stringify([p.company_id,p.book_id,p.currency])))continue;
   const ctx={role,policyId:p.id,company_id:p.company_id,book_id:p.book_id,currency:p.currency};
   const balances=(domains[role].balances?.rows||[]).filter(r=>sameScope(r.values,p)),events=(domains[role].events?.rows||[]).filter(r=>sameScope(r.values,p)),controls=(domains[role].controls?.rows||[]).filter(r=>sameScope(r.values,p));
   const balanceIndex=groupRows(balances,['asset_id','as_of','measure']),eventsByAssetMeasure=groupRows(events,['asset_id','measure']);
   if(!p.rollforward_measures.length){financial.confirmed=false;issue('warning','ROLLFORWARD_MEASURES_UNCONFIRMED',{role,domain:'events',policyId:p.id},'No explicit movement measures are selected for this financial basis.',{...ctx});}
   for(const measure of p.rollforward_measures){
    const matchingBalances=balances.filter(r=>r.values.measure===measure),matchingEvents=events.filter(r=>r.values.measure===measure),assetIds=new Set([...matchingBalances,...matchingEvents].map(r=>r.values.asset_id));
    if(!assetIds.size)assetIds.add(null);
    for(const asset_id of assetIds){
     const openingRow=uniqueAmount(balanceIndex.get(JSON.stringify([asset_id,p.opening_date,measure]))),closingRow=uniqueAmount(balanceIndex.get(JSON.stringify([asset_id,p.closing_date,measure])));
     const assetEvents=eventsByAssetMeasure.get(JSON.stringify([asset_id,measure]))||[],selectedEvents=assetEvents.filter(r=>r.values.effective_date>p.opening_date&&r.values.effective_date<=p.closing_date);
     const invalidEvents=assetEvents.some(r=>!r.valid),eventState=!domains[role].events?'MISSING':invalidEvents?'INVALID':'MATCH';
     const stateBefore=!p.basisCurrent?'STALE_BASIS':!p.event_scope_complete?'UNCONFIRMED':badState([openingRow.state,closingRow.state,eventState]);
     const arithmetic=!stateBefore,movement=arithmetic?amountSum(selectedEvents.map(r=>r.values.signed_amount)):null,expected=arithmetic?amountSum([openingRow.amount,movement]):null,difference=arithmetic?amountDifference(closingRow.amount,expected):null;
     addFinancial('rollforwards',{...ctx,asset_id,measure,opening_date:p.opening_date,closing_date:p.closing_date,opening:openingRow.amount,movement,expected,closing:closingRow.amount,difference,state:stateBefore||(difference==='0'?'MATCH':'DIFFERENCE'),eventRowIds:selectedEvents.map(r=>r.rowId),openingRowIds:(balanceIndex.get(JSON.stringify([asset_id,p.opening_date,measure]))||[]).map(r=>r.rowId),closingRowIds:(balanceIndex.get(JSON.stringify([asset_id,p.closing_date,measure]))||[]).map(r=>r.rowId)},'events','The declared complete-period rollforward has an unresolved basis, population or exact amount difference.');
    }
   }
   const periodBalances=balances.filter(r=>validDate(r.values.as_of)&&r.values.as_of>=p.opening_date&&r.values.as_of<=p.closing_date),periodControls=controls.filter(r=>validDate(r.values.as_of)&&r.values.as_of>=p.opening_date&&r.values.as_of<=p.closing_date);
   const balanceGroups=groupRows(periodBalances,['as_of','measure']),controlGroups=groupRows(periodControls,['as_of','measure']),controlKeys=new Set([...balanceGroups.keys(),...controlGroups.keys()]);
   if(!controlKeys.size)controlKeys.add(JSON.stringify([p.closing_date,null]));
   for(const key of controlKeys){
    const [as_of,measure]=JSON.parse(key),bs=balanceGroups.get(key)||[],cs=controlGroups.get(key)||[],control=uniqueAmount(cs);
    const populationState=!domains[role].balances||!bs.length?'MISSING':bs.every(r=>r.valid)?'MATCH':'INVALID',stateBefore=!p.basisCurrent?'STALE_BASIS':!p.population_complete?'UNCONFIRMED':badState([populationState,control.state]);
    const population=populationState==='MATCH'?amountSum(bs.map(r=>r.values.amount)):null,difference=!stateBefore?amountDifference(population,control.amount):null;
    addFinancial('controls',{...ctx,as_of,measure,population,control:control.amount,difference,state:stateBefore||(difference==='0'?'MATCH':'DIFFERENCE'),balanceRowIds:bs.map(r=>r.rowId),controlRowIds:cs.map(r=>r.rowId)},'controls','The explicit complete-population balance/control reconciliation is unresolved.');
   }
   for(const equation of p.carrying_equations){
    const measures=new Set([equation.result_measure,...equation.components.map(c=>c.measure)]),groups=groupRows(periodBalances.filter(r=>measures.has(r.values.measure)),['asset_id','as_of']);
    if(!groups.size)groups.set(JSON.stringify([null,p.closing_date]),[]);
    for(const [key,rows]of groups){const [asset_id,as_of]=JSON.parse(key),result=uniqueAmount(rows.filter(r=>r.values.measure===equation.result_measure)),components=equation.components.map(c=>({...c,...uniqueAmount(rows.filter(r=>r.values.measure===c.measure))}));
     const stateBefore=!p.basisCurrent?'STALE_BASIS':badState([result.state,...components.map(c=>c.state)]),expected=!stateBefore?amountSum(components.map(c=>c.coefficient===1?c.amount:amountNegate(c.amount))):null,difference=!stateBefore?amountDifference(result.amount,expected):null;
     addFinancial('equations',{...ctx,asset_id,as_of,result_measure:equation.result_measure,result:result.amount,components,expected,difference,state:stateBefore||(difference==='0'?'MATCH':'DIFFERENCE'),rowIds:rows.map(r=>r.rowId)},'balances','The explicitly configured carrying-value equation has unresolved original measures or amounts.');
    }
   }
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
 return {schema:'tjlabs.fixed-asset-migration-reconciliation.v1',workspaceId:ws.id,revision:ws.revision,ready:errors===0&&differences===0&&financial.confirmed,issues,domains,comparisons,financial,summary:{errors,warnings,differences,selectedDomains:Object.keys(comparisons).length,sourceRows:Object.values(domains.source).reduce((n,x)=>n+x.rows.length,0),targetRows:Object.values(domains.target).reduce((n,x)=>n+x.rows.length,0)}};
}
function portableText(workspace){const envelope={schema:'tjlabs.fixed-asset-migration-portable.v1',workspace,sha256:hash(workspace)},value=JSON.stringify(envelope,null,2)+'\n';need(sha256Utf8(value).bytes<=LIMITS.workspaceBytes,'WORKSPACE_TOO_LARGE','The complete workspace exceeds128 MiB; preserve original sources and explicit separate migration scopes.');return value;}
export function exportWorkspace(workspace){validateWorkspace(workspace);return portableText(workspace);}
export function importWorkspace(value){text(value,'complete portable workspace',LIMITS.workspaceBytes);need(sha256Utf8(value).bytes<=LIMITS.workspaceBytes,'WORKSPACE_TOO_LARGE','The complete workspace exceeds128 MiB.');let envelope;try{envelope=JSON.parse(value);}catch{fail('INVALID_JSON','Choose the complete saved workspace JSON.');}need(envelope?.schema==='tjlabs.fixed-asset-migration-portable.v1'&&plain(envelope.workspace)&&envelope.sha256===hash(envelope.workspace),'WORKSPACE_CHANGED','The complete saved workspace identity differs.');return validateWorkspace(clone(envelope.workspace));}
export function buildHandover(workspace){
 const ws=validateWorkspace(workspace),report=reconcile(ws),files=[];
 const add=(path,type,text)=>{files.push({path,type,text,...sha256Utf8(text)});};
 add('workspace.json','application/json',exportWorkspace(ws));add('reconciliation.json','application/json',JSON.stringify(report,null,2)+'\n');
 add('review-history.json','application/json',JSON.stringify({workspaceId:ws.id,revision:ws.revision,mappingHistory:ws.mappingHistory,corrections:ws.corrections,financePolicies:ws.financePolicies,financePolicyHistory:ws.financePolicyHistory,operations:ws.operations},null,2)+'\n');
 for(const f of ws.supportingFiles){const filename=f.filename.replace(/[^A-Za-z0-9._-]/g,'_')||'original.bin';files.push({path:'supporting/'+f.id+'/'+filename,type:f.mimeType,base64:f.base64,bytes:f.bytes,sha256:f.sha256});}
 for(const s of ws.sources){add('originals/'+s.id+'.csv','text/csv',s.text);add('corrected/'+s.id+'.csv','text/csv',encodeCsv([s.headers,...effectiveRows(ws,s).map(x=>x.cells)]));}
 for(const role of roleNames)for(const [domain,selected]of Object.entries(report.domains[role]))add('canonical/'+role+'/'+domain+'.csv','text/csv',encodeCsv([['_source_row_id',...DOMAINS[domain].fields.map(f=>f.name)],...selected.rows.map(r=>[r.rowId,...DOMAINS[domain].fields.map(f=>r.values[f.name])])]));
 const manifest={schema:'tjlabs.fixed-asset-migration-handover-manifest.v1',workspaceId:ws.id,revision:ws.revision,ready:report.ready,summary:report.summary,originalSources:ws.sources.map(({text,rows,headers,...s})=>({...s,headers,rowCount:rows.length})),supportingFiles:ws.supportingFiles.map(({base64,...f})=>f),financialBasis:report.financial,files:files.map(({text,base64,...f})=>f),meaning:'Complete original financial migration handover, including binary supporting files, exact amount scale, declared financial basis, all source/target comparisons and original operation history. Financial totals stay within their company, book, currency and measure. Use the supplier-approved import/exit contract and inspect actual returned target files.'};
 add('MANIFEST.json','application/json',JSON.stringify(manifest,null,2)+'\n');
 return {schema:'tjlabs.fixed-asset-migration-handover.v1',workspaceId:ws.id,revision:ws.revision,ready:report.ready,files,manifest};
}
