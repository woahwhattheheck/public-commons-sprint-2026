import {sha256Utf8,sha256Bytes} from './sha256.mjs';
export const WORKSPACE_SCHEMA='tjlabs.tourism-series-workspace.v1';
export const LIMITS=Object.freeze({csvBytes:33554432,supportingBytes:33554432,workspaceBytes:134217728,rows:100000,columns:512,cellCharacters:1000000,files:256,sources:128,operations:10000,registries:128});
export const FIELDS=Object.freeze(['observation_id','geography_id','period_start','period_end','metric_id','value','unit','multiplier','method_id','population','price_basis','source_id','source_locator','original_display','status','note']);
export const STATUSES=Object.freeze(['published','missing','suppressed','not_available']);
export const ANALYSIS_KINDS=Object.freeze(['sum','difference','percentage_change','ratio','reconcile']);
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

export function metadata(){return{schema:WORKSPACE_SCHEMA,limits:LIMITS,fields:FIELDS,statuses:STATUSES,analysisKinds:ANALYSIS_KINDS};}
const json=x=>JSON.stringify(x,null,2)+'\n';
const same=(a,b)=>stable(a)===stable(b);
function unique(values,label){need(Array.isArray(values)&&new Set(values).size===values.length,'DUPLICATE_SELECTION','Keep distinct '+label+'.');return values;}
function array(value,label,max=100000){need(Array.isArray(value)&&value.length<=max,'INVALID_INPUT','Supply complete '+label+' within the supported selection.');return value;}
function atId(rows,key,label){const item=rows.find(row=>row.id===key);need(item,'NOT_FOUND','Select a retained '+label+'.',{id:key});return item;}
function binaryText(file){const bytes=decodeBase64(file.content_base64);let s;try{s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8','Select an original UTF-8 CSV template.');}const d=sha256Utf8(s);need(d.bytes===file.bytes&&d.sha256===file.sha256,'INVALID_UTF8','The complete UTF-8 template must reproduce its original bytes.');return s;}
function rational(numerator,denominator,scale=1){
 let a=pairAny(numerator),b=pairAny(denominator),n=a.n*10n**BigInt(b.scale)*BigInt(scale),d=b.n*10n**BigInt(a.scale);
 if(d===0n)return null;if(d<0n){n=-n;d=-d;}
 const abs=x=>x<0n?-x:x;let x=abs(n),y=d;while(y){const t=x%y;x=y;y=t;}const g=x||1n;n/=g;d/=g;
 const scaled=abs(n)*1000000n,q=scaled/d,rem=scaled%d,rounded=q+(rem*2n>=d?1n:0n);
 return{numerator:n.toString(),denominator:d.toString(),display:formatDecimal(n<0n?-rounded:rounded,6),places:6,rounding:'half-away-from-zero'};
}
function unsignedDifference(a,b){const n=amountDifference(a,b);return n[0]==='-'?n.slice(1):n;}
function compareDecimal(a,b){const n=amountDifference(a,b);return n==='0'?0:n[0]==='-'?-1:1;}
function safeSegment(value){return 'id-'+encodeURIComponent(value).replace(/%/g,'_').slice(0,70)+'-'+sha256Utf8(value).sha256.slice(0,20);}
function safeFilename(name){const extension=name.match(/\.[A-Za-z0-9]{1,12}$/)?.[0]??'';return safeSegment(name)+extension;}
function bounded(ws){need(sha256Utf8(json(ws)).bytes<=LIMITS.workspaceBytes,'WORKSPACE_TOO_LARGE','Retain a complete workspace within128 MiB.');}
export function createWorkspace({id:workspaceId,title,createdAt}){
 return{schema:WORKSPACE_SCHEMA,id:id(workspaceId,'workspace ID'),title:text(title,'workspace title',300),createdAt:instant(createdAt,'creation'),revision:0,files:[],sources:[],registries:[],mappings:{},mappingHistory:[],corrections:[],analyses:[],reports:[],targetPlans:[],targetReturns:[],operations:[]};
}
function fileValue(input){
 id(input.id,'file ID');text(input.filename,'original filename',300);text(input.mime_type,'actual media type',200);
 need(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(input.mime_type),'INVALID_MEDIA_TYPE','Use an actual media type without header parameters.');
 need(['original','authored_transcription','extracted_text'].includes(input.representation),'INVALID_REPRESENTATION','Distinguish original bytes from an authored transcription or extracted text.');
 const original=decodeBase64(input.content_base64);
 return{id:input.id,filename:input.filename,mime_type:input.mime_type,content_base64:input.content_base64,...sha256Bytes(original),source_url:text(input.source_url??'','original source URL',4096,true),publisher:text(input.publisher??'','publisher',1000,true),published_at:text(input.published_at??'','original published date',100,true),retrieved_at:instant(input.retrieved_at,'retrieval'),representation:input.representation,note:text(input.note??'','provenance note',10000,true)};
}
function registryValue(ws,registry){
 need(plain(registry),'INVALID_REGISTRY','Supply the complete immutable source registry.');const r=clone(registry);id(r.id,'registry edition ID');
 const ids=unique(array(r.source_file_ids,'registry source files',LIMITS.files),'registry source files');for(const x of ids)atId(ws.files,x,'physical source file');
 const source=row=>{need(ids.includes(row.source_file_id),'REGISTRY_SOURCE','Bind the declaration to one retained registry source file.');text(row.source_locator,'original source locator',4000);};
 for(const name of ['geographies','partitions','metrics','methods','comparability','ratio_pairs','reconciliations']){r[name]=r[name]??[];array(r[name],name,10000);unique(r[name].map(v=>id(v.id,name+' ID')),name+' IDs');}
 need(r.geographies.length&&r.metrics.length&&r.methods.length,'INVALID_REGISTRY','Retain geographies, metrics and original methods.');
 const geo=new Map(r.geographies.map(x=>[x.id,x])),met=new Map(r.metrics.map(x=>[x.id,x])),methods=new Set(r.methods.map(x=>x.id));
 for(const g of r.geographies){text(g.name,'geography name',1000);text(g.scheme,'geography scheme',1000);text(g.level,'geography level',100);source(g);text(g.boundary_note??'','boundary note',10000,true);need(g.parent_id===null||geo.has(g.parent_id),'GEOGRAPHY_PARENT','Declare an existing parent or explicit null.');const seen=new Set([g.id]);let p=g.parent_id;while(p!==null){need(!seen.has(p),'GEOGRAPHY_CYCLE','Geography ancestry contains a cycle.');seen.add(p);p=geo.get(p).parent_id;}}
 for(const p of r.partitions){need(geo.has(p.parent_id),'PARTITION_PARENT','Select the original partition parent.');unique(array(p.member_ids,'partition members',10000),'partition members');need(p.member_ids.length>0&&p.member_ids.every(x=>geo.get(x)?.parent_id===p.parent_id),'PARTITION_MEMBERS','Use distinct declared direct children of this partition parent.');need(typeof p.complete==='boolean','PARTITION_COVERAGE','Explicitly state whether the partition is complete.');source(p);text(p.note,'partition basis',10000);}
 for(const m of r.metrics){text(m.name,'metric name',1000);text(m.unit,'metric unit',300);text(m.currency,'currency or empty',3,true);need(m.currency===''||/^[A-Z]{3}$/.test(m.currency),'METRIC_CURRENCY','Use explicit ISO currency or empty.');unique(array(m.additive_dimensions,'additive dimensions',2),'additive dimensions');need(m.additive_dimensions.every(x=>['geography','period'].includes(x)),'ADDITIVITY','Only explicit geography or period addition is supported.');text(m.population,'metric population',1000);text(m.price_basis,'metric price basis',1000);unique(array(m.ratio_denominator_metric_ids??[],'ratio denominator metrics',10000),'ratio denominators');need((m.ratio_denominator_metric_ids??[]).every(x=>met.has(x)),'RATIO_METRIC','Select known denominator metrics.');text(m.note??'','metric note',10000,true);}
 for(const m of r.methods){text(m.name,'method name',1000);text(m.version,'method version or unknown',1000);source(m);text(m.note,'method limitations',10000);}
 for(const c of r.comparability){unique(array(c.method_ids,'compared methods',10000),'compared methods');unique(array(c.metric_ids,'compared metrics',10000),'compared metrics');need(c.method_ids.length>1&&c.method_ids.every(x=>methods.has(x))&&c.metric_ids.length&&c.metric_ids.every(x=>met.has(x)),'COMPARABILITY_SCOPE','Bind the review to known methods and metrics.');need(['confirmed','unconfirmed'].includes(c.status),'COMPARABILITY_STATE','Keep explicit confirmation state.');text(c.actor,'comparability reviewer',300);instant(c.at,'comparability review');text(c.note,'comparability basis',10000);}
 for(const p of r.ratio_pairs){need(met.has(p.numerator_metric_id)&&met.has(p.denominator_metric_id)&&(met.get(p.numerator_metric_id).ratio_denominator_metric_ids??[]).includes(p.denominator_metric_id),'RATIO_PAIR','Declare the same permitted denominator in the numerator metric.');text(p.unit,'ratio output unit',300);need([1,100].includes(p.scale)&&typeof p.allow_different_population==='boolean'&&typeof p.allow_different_price_basis==='boolean','RATIO_PAIR','Declare scale and both dimension exceptions explicitly.');source(p);text(p.note,'ratio interpretation',10000);}
 for(const p of r.reconciliations){need(p.dimension==='metric'&&met.has(p.total_metric_id),'RECONCILIATION_RELATION','Select an explicit metric-component total.');unique(array(p.component_metric_ids,'component metrics',10000),'component metrics');need(p.component_metric_ids.length>0&&p.component_metric_ids.every(x=>met.has(x)&&x!==p.total_metric_id),'RECONCILIATION_RELATION','Declare every distinct component metric.');source(p);text(p.note,'reconciliation basis',10000);}
 return r;
}
function effectiveRows(ws,source){
 const rows=source.rows.map(r=>({...r,cells:r.cells.slice()})),byId=new Map(rows.map(r=>[r.id,r]));
 for(const c of ws.corrections)if(c.sourceId===source.id){const row=byId.get(c.rowId);need(row&&row.cells[c.column]===c.before,'CORRECTION_HISTORY','Keep the complete original correction ancestry.');row.cells[c.column]=c.value;}return rows;
}
function mappingValue(ws,input,revision,at){
 const s=atId(ws.sources,input.sourceId,'CSV source');atId(ws.registries,input.registryId,'registry edition');need(plain(input.columns)&&plain(input.constants),'INVALID_MAPPING','Supply both explicit column and constant objects.');
 for(const [f,c]of Object.entries(input.columns))need(FIELDS.includes(f)&&Number.isInteger(c)&&c>=0&&c<s.headers.length,'INVALID_MAPPING','Map canonical fields to original zero-based columns.');
 for(const [f,v]of Object.entries(input.constants)){need(FIELDS.includes(f)&&!Object.hasOwn(input.columns,f),'INVALID_MAPPING','A field must have one explicit column or constant.');text(v,'constant value',LIMITS.cellCharacters,true);}
 return{id:'mapping-'+hash({workspaceId:ws.id,operationId:input.operationId}).slice(0,40),sourceId:s.id,registryId:input.registryId,columns:clone(input.columns),constants:clone(input.constants),revision,at};
}

function projectInternal(ws,{registryId,sourceIds}){
 const registry=atId(ws.registries,registryId,'registry edition');unique(array(sourceIds,'selected source IDs',LIMITS.sources),'selected source IDs');
 const issues=[],rows=[],coverage=[],badRows=new Set();
 const issue=(code,message,ctx={},severity='error')=>{const e={code,message,severity,...ctx};issues.push({id:'finding-'+hash(e).slice(0,40),...e});if(severity==='error'&&ctx.rowId)badRows.add(ctx.rowId);};
 if(!sourceIds.length)issue('NO_SERIES','Select actual original series sources.');
 const selected=[];
 for(const sourceId of sourceIds){
  const source=atId(ws.sources,sourceId,'CSV source'),mapping=ws.mappings[sourceId];
  need(source.role==='source','INVALID_ROLE','Use original source series in analysis; returned target CSVs are reconciled through their prepared target.');
  if(!mapping||mapping.registryId!==registryId){issue('MAPPING_REQUIRED','Save a mapping against this exact registry edition.',{sourceId});continue;}
  const corrections=ws.corrections.filter(c=>c.sourceId===sourceId);selected.push({sourceId,sha256:source.sha256,mapping,corrections});
  const missing=FIELDS.filter(f=>!Object.hasOwn(mapping.columns,f)&&!Object.hasOwn(mapping.constants,f));
  for(const field of missing)issue('FIELD_UNMAPPED','Explicitly map or provide a constant for '+field+'.',{sourceId,field});
  const used=new Set(Object.values(mapping.columns));
  coverage.push({sourceId,headers:source.headers.map((name,column)=>({name,column,fields:Object.entries(mapping.columns).filter(([,c])=>c===column).map(([f])=>f)})),unmappedColumns:source.headers.map((name,column)=>({name,column})).filter(x=>!used.has(x.column)),constants:clone(mapping.constants)});
  const byObservation=new Map();
  for(const row of effectiveRows(ws,source)){
   const ctx={sourceId,rowId:row.id},values={},rawValues={};let normalized_value=null,currency='';
   const add=(code,message,extra={})=>issue(code,message,{...ctx,...extra});
   if(row.cells.length!==source.headers.length)add('RAGGED_ROW','The original row and header have different cell counts.');
   if(missing.length)add('INCOMPLETE_MAPPING','The complete canonical row is not mapped.');
   for(const f of FIELDS){const v=Object.hasOwn(mapping.constants,f)?mapping.constants[f]:row.cells[mapping.columns[f]]??'';values[f]=v;rawValues[f]=v;}
   for(const f of FIELDS.filter(f=>!['value','note','original_display'].includes(f)))if(values[f]==='')add('MISSING_FIELD','Supply explicit '+f+'.',{field:f});
   if(!validDate(values.period_start)||!validDate(values.period_end)||values.period_start>=values.period_end)add('INVALID_PERIOD','Use a valid nonempty half-open ISO calendar period.');
   const g=registry.geographies.find(x=>x.id===values.geography_id),m=registry.metrics.find(x=>x.id===values.metric_id);
   if(!g)add('UNKNOWN_GEOGRAPHY','The source-local geography is not in this registry.');
   if(!m)add('UNKNOWN_METRIC','The metric is not in this registry.');
   else {currency=m.currency;for(const field of ['unit','population','price_basis'])if(values[field]!==m[field])add('METRIC_DIMENSION','The row '+field+' differs from its declared metric.',{field,declared:m[field],actual:values[field]});}
   if(!registry.methods.some(x=>x.id===values.method_id))add('UNKNOWN_METHOD','Retain the original method edition in the registry.');
   if(!registry.source_file_ids.includes(values.source_id))add('UNKNOWN_PHYSICAL_SOURCE','The row does not reference a retained physical registry source.');
   if(!['1','1000','1000000'].includes(values.multiplier))add('INVALID_MULTIPLIER','Use explicit multiplier1,1000 or1000000.');
   if(!STATUSES.includes(values.status))add('INVALID_STATUS','Distinguish published, missing, suppressed and not_available.');
   else if(values.status==='published'){try{decimal(values.value);if(['1','1000','1000000'].includes(values.multiplier))normalized_value=scaledAmount(values.value,values.multiplier);}catch{add('INVALID_DECIMAL','A published value requires an exact ordinary decimal string.');}}
   else if(values.value!=='')add('MISSING_VALUE_NOT_EMPTY','A non-published status must retain an empty value, not zero or a number.');
   const item={rowId:row.id,sourceId,record:row.record,rawValues,values,normalized_value,currency,valid:true};rows.push(item);
   if(!byObservation.has(values.observation_id))byObservation.set(values.observation_id,[]);byObservation.get(values.observation_id).push(item);
  }
  for(const [observationId,items]of byObservation)if(items.length>1)for(const row of items)issue('DUPLICATE_OBSERVATION_ID','An observation ID repeats within the same original source.',{sourceId,rowId:row.rowId,observationId});
 }
 for(const row of rows)row.valid=!badRows.has(row.rowId);
 const basis_sha256=hash({workspaceId:ws.id,registry,selected,files:registry.source_file_ids.map(x=>{const{content_base64,...f}=atId(ws.files,x,'source file');return f;})});
 return{registryId,basis_sha256,rows,issues,coverage,ready:rows.length>0&&!issues.some(x=>x.severity==='error')};
}
export function project(ws,selection){validateWorkspace(ws);return projectInternal(ws,selection);}
function analysisInternal(ws,input){
 need(ANALYSIS_KINDS.includes(input.kind),'ANALYSIS_KIND','Choose a supported explicit analysis.');
 const projected=projectInternal(ws,input),registry=atId(ws.registries,input.registryId,'registry edition');
 unique(array(input.rowIds,'analysis row IDs',LIMITS.rows),'analysis row IDs');need(input.rowIds.length>0,'EMPTY_ANALYSIS','Choose the original operands.');
 const rows=input.rowIds.map(rowId=>{const r=projected.rows.find(x=>x.rowId===rowId);need(r,'ROW_NOT_SELECTED','The operand is outside the selected original sources.',{rowId});return r;});
 const issues=projected.issues.filter(x=>!x.rowId||input.rowIds.includes(x.rowId));
 const add=(code,message,severity='error',details)=>issues.push({id:'finding-'+hash({code,message,severity,details:details??null}).slice(0,40),code,message,severity,...(details?{details}:{})});
 let result=null,qualified=true;
 for(const row of rows){if(!row.valid)add('INVALID_OPERAND','An operand has unresolved original source findings.');if(row.normalized_value===null)add('UNAVAILABLE_OPERAND','Missing, suppressed or unavailable values cannot be used as zero.');}
 const v=r=>r.values,first=rows[0],metric=registry.metrics.find(m=>m.id===v(first).metric_id);
 const equal=(names,items=rows)=>names.every(k=>items.every(r=>(k==='currency'?r.currency:v(r)[k])===(k==='currency'?items[0].currency:v(items[0])[k])));
 const requireEqual=(names,items=rows)=>need(equal(names,items),'DIMENSION_MISMATCH','Keep matching '+names.join(', ')+'.');
 const validNumber=()=>!issues.some(x=>x.severity==='error');
 const dims=r=>({geography_id:v(r).geography_id,period_start:v(r).period_start,period_end:v(r).period_end,metric_id:v(r).metric_id,unit:v(r).unit,currency:r.currency,method_id:v(r).method_id,population:v(r).population,price_basis:v(r).price_basis});
 const checkMethods=()=>{
  const methods=[...new Set(rows.map(r=>v(r).method_id))];
  if(methods.length>1){const review=registry.comparability.find(c=>methods.every(x=>c.method_ids.includes(x))&&c.metric_ids.includes(v(first).metric_id)&&c.status==='confirmed');
   if(!review){qualified=false;add('UNCONFIRMED_COMPARABILITY','Method editions differ without a confirmed source-bound reviewer basis. This is a difference of published estimates, not a confirmed trend.','warning');}
   return review??null;
  }return null;
 };
 try{
  if(validNumber()){
   if(input.kind==='sum'){
    need(['geography','period'].includes(input.dimension)&&metric.additive_dimensions.includes(input.dimension),'NON_ADDITIVE','The metric must declare this additive dimension.');
    requireEqual(['metric_id','unit','currency','method_id','population','price_basis']);let coverage;
    if(input.dimension==='geography'){
     requireEqual(['period_start','period_end']);const p=atId(registry.partitions,input.partitionId,'disjoint geography partition');
     const gs=rows.map(r=>v(r).geography_id);unique(gs,'summed geographies');need(gs.every(g=>p.member_ids.includes(g)),'GEOGRAPHY_OVERLAP','Use only distinct members of the explicit disjoint partition; no parent, ancestor or outside area.');
     coverage={dimension:'geography',partitionId:p.id,parent_id:p.parent_id,members:gs,missing:p.member_ids.filter(x=>!gs.includes(x)),complete:p.complete&&gs.length===p.member_ids.length,note:p.note};
     if(!coverage.complete)add('PARTIAL_PARTITION','The sum covers only the stated subset; it is not the full parent total.','warning');
    }else{
     requireEqual(['geography_id']);const ordered=rows.slice().sort((a,b)=>v(a).period_start.localeCompare(v(b).period_start)),gaps=[];
     for(let i=1;i<ordered.length;i++){need(v(ordered[i-1]).period_end<=v(ordered[i]).period_start,'PERIOD_OVERLAP','Do not add overlapping half-open periods.');if(v(ordered[i-1]).period_end<v(ordered[i]).period_start)gaps.push({start:v(ordered[i-1]).period_end,end:v(ordered[i]).period_start});}
     coverage={dimension:'period',periods:ordered.map(r=>({start:v(r).period_start,end:v(r).period_end})),gaps,complete:gaps.length===0};
     if(gaps.length)add('PERIOD_GAPS','The selected periods contain the disclosed gaps.','warning',gaps);
    }
    const dimensions=dims(first);if(input.dimension==='geography'){dimensions.geography_id=coverage.complete?coverage.parent_id:null;dimensions.geography_ids=coverage.members;}else{dimensions.period_start=coverage.periods[0].start;dimensions.period_end=coverage.periods.at(-1).end;}result={value:amountSum(rows.map(r=>r.normalized_value)),unit:v(first).unit,currency:first.currency,dimensions,coverage};
   }else if(input.kind==='difference'||input.kind==='percentage_change'){
    need(rows.length===2,'OPERAND_COUNT','Choose exactly baseline and current operands.');requireEqual(['metric_id','unit','currency','population','price_basis']);
    const a=v(rows[0]),b=v(rows[1]),sameGeo=a.geography_id===b.geography_id,samePeriod=a.period_start===b.period_start&&a.period_end===b.period_end;
    need((sameGeo&&!samePeriod&&(a.period_end<=b.period_start||b.period_end<=a.period_start))||(!sameGeo&&samePeriod),'COMPARISON_SCOPE','Compare non-overlapping periods in the same geography, or different geographies in the same period.');
    const review=checkMethods(),difference=amountDifference(rows[1].normalized_value,rows[0].normalized_value);
    if(input.kind==='difference')result={value:difference,unit:a.unit,currency:first.currency,baseline:dims(rows[0]),current:dims(rows[1]),comparability:review,note:'Difference of original published estimates; no causal or inflation-adjusted claim.'};
    else{const q=rational(difference,rows[0].normalized_value,100);if(!q)add('ZERO_DENOMINATOR','Percentage change is undefined for a zero baseline.');result={value:null,rational:q,unit:'percent',baseline:dims(rows[0]),current:dims(rows[1]),comparability:review,note:'Change relative to the named baseline; method qualification remains explicit.'};}
   }else if(input.kind==='ratio'){
    need(rows.length===2,'OPERAND_COUNT','Choose one numerator and one denominator.');const pair=atId(registry.ratio_pairs,input.ratioPairId,'declared ratio pair');
    need(v(rows[0]).metric_id===pair.numerator_metric_id&&v(rows[1]).metric_id===pair.denominator_metric_id,'RATIO_PAIR','Use exactly the named numerator and denominator metrics.');
    requireEqual(['geography_id','period_start','period_end','method_id']);if(!pair.allow_different_population)requireEqual(['population']);if(!pair.allow_different_price_basis)requireEqual(['price_basis']);
    need(!(rows[0].currency&&rows[1].currency&&rows[0].currency!==rows[1].currency),'CURRENCY_MISMATCH','Never divide mismatched monetary currencies implicitly.');
    const q=rational(rows[0].normalized_value,rows[1].normalized_value,pair.scale);if(!q)add('ZERO_DENOMINATOR','The ratio is undefined for a zero denominator.');
    result={value:null,rational:q,unit:pair.unit,pair:clone(pair),numerator:dims(rows[0]),denominator:dims(rows[1])};
   }else{
    const rule=atId(registry.reconciliations,input.reconciliationId,'declared component relationship'),components=rows.slice(1);
    need(v(first).metric_id===rule.total_metric_id&&components.length===rule.component_metric_ids.length,'RECONCILIATION_COMPONENTS','Select the named total and every original declared component once.');
    unique(components.map(r=>v(r).metric_id),'component metrics');need(components.every(r=>rule.component_metric_ids.includes(v(r).metric_id)),'RECONCILIATION_COMPONENTS','Use the exact declared component metrics.');
    requireEqual(['geography_id','period_start','period_end','unit','currency','method_id','price_basis']);
    const tolerance=decimal(input.tolerance??'0');need(tolerance[0]!=='-','INVALID_TOLERANCE','Use an explicit nonnegative reviewer tolerance.');
    const sum=amountSum(components.map(r=>r.normalized_value)),residual=amountDifference(sum,first.normalized_value);
    result={value:residual,unit:v(first).unit,currency:first.currency,published_total:first.normalized_value,component_sum:sum,residual,tolerance,within_tolerance:compareDecimal(unsignedDifference(sum,first.normalized_value),tolerance)<=0,relationship:clone(rule),dimensions:dims(first),note:'Components minus published total; tolerance is a reviewer choice, never confidence or a source correction.'};
    if(residual!=='0')add('PUBLISHED_RESIDUAL','The component sum differs from the original published total. Both originals remain unchanged.','warning',{residual,tolerance});
   }
  }
 }catch(error){if(!error.code)throw error;add(error.code,error.message);}
 if(issues.some(x=>x.severity==='error'))qualified=false;
 return{kind:input.kind,selection:clone(input),basis_sha256:projected.basis_sha256,operands:clone(rows),result,issues,qualified,ready:result!==null&&!issues.some(x=>x.severity==='error')};
}
export function runAnalysis(ws,input){validateWorkspace(ws);return analysisInternal(ws,input);}

function targetPlan(ws,input,revision,at){
 const p=projectInternal(ws,input);unique(array(input.rowIds,'target row IDs',LIMITS.rows),'target row IDs');need(input.rowIds.length>0,'EMPTY_TARGET','Select original observations for the actual template.');
 const rows=input.rowIds.map(x=>{const r=p.rows.find(r=>r.rowId===x);need(r&&r.valid,'TARGET_SOURCE','Resolve the selected original row before preparing target output.',{rowId:x});return r;});
 const file=atId(ws.files,input.templateFileId,'actual native CSV template'),template=parseCsv(binaryText(file));
 const columns=array(input.columns,'native target columns',LIMITS.columns);need(columns.length===template.headers.length,'TARGET_MAPPING','Map every actual template column explicitly.');
 unique(columns.map(c=>c.column),'native template columns');
 for(const c of columns){need(Number.isInteger(c.column)&&c.column>=0&&c.column<template.headers.length,'TARGET_MAPPING','Select original zero-based template columns.');need(Object.hasOwn(c,'constant')!==Object.hasOwn(c,'field'),'TARGET_MAPPING','Choose exactly one canonical field or literal constant per target column.');if(Object.hasOwn(c,'constant'))text(c.constant,'target constant',LIMITS.cellCharacters,true);else need([...FIELDS,'normalized_value','rowId'].includes(c.field),'TARGET_MAPPING','Select a supported original canonical field.');}
 const keys=unique(array(input.keyColumns,'required native key columns',LIMITS.columns),'native key columns');need(keys.length>0&&keys.every(c=>Number.isInteger(c)&&c>=0&&c<template.headers.length),'TARGET_KEYS','Choose the actual native matching-key columns.');
 const seen=new Set(),prepared=rows.map(row=>{
  const cells=new Array(template.headers.length);for(const c of columns)cells[c.column]=Object.hasOwn(c,'constant')?c.constant:c.field==='normalized_value'?row.normalized_value??'':c.field==='rowId'?row.rowId:row.values[c.field];
  const values=keys.map(k=>cells[k]);need(values.every(v=>v!==''),'TARGET_KEY_MISSING','Every required native key value must be present.',{rowId:row.rowId});const key=stable(values);need(!seen.has(key),'TARGET_KEY_DUPLICATE','Prepared native keys repeat; explicitly resolve the selected source scope.',{key:values});seen.add(key);return{rowId:row.rowId,key:values,cells};
 });
 const csv=encodeCsv([template.headers,...prepared.map(r=>r.cells)]);
 return{id:id(input.id,'target plan ID'),registryId:input.registryId,sourceIds:clone(input.sourceIds),rowIds:clone(input.rowIds),templateFileId:file.id,template_sha256:file.sha256,columns:clone(columns),keyColumns:clone(keys),headers:template.headers,rows:prepared,csv,...sha256Utf8(csv),basis_sha256:p.basis_sha256,operands:clone(rows),actor:text(input.actor,'target reviewer',300),note:text(input.note,'actual template and receiving contract',10000),revision,at};
}
function targetReturn(ws,input,revision,at){
 const plan=atId(ws.targetPlans,input.planId,'original prepared target'),source=atId(ws.sources,input.sourceId,'actual returned CSV');need(source.role==='target','RETURN_ROLE','Choose an original returned target CSV.');
 const columns=array(input.columns,'returned original column mapping',LIMITS.columns);need(columns.length===plan.headers.length,'RETURN_MAPPING','Explicitly map every prepared column to its actual returned column.');
 unique(columns.map(c=>c.preparedColumn),'prepared columns');unique(columns.map(c=>c.returnedColumn),'returned columns');
 for(const c of columns)need(Number.isInteger(c.preparedColumn)&&c.preparedColumn>=0&&c.preparedColumn<plan.headers.length&&Number.isInteger(c.returnedColumn)&&c.returnedColumn>=0&&c.returnedColumn<source.headers.length,'RETURN_MAPPING','Use valid original zero-based source and returned column indexes.');
 const columnMap=new Map(columns.map(c=>[c.preparedColumn,c.returnedColumn])),groups=new Map(),invalid=[];
 for(const row of source.rows){const key=plan.keyColumns.map(c=>row.cells[columnMap.get(c)]??'');if(row.cells.length!==source.headers.length||key.some(v=>v===''))invalid.push({rowId:row.id,key,cells:clone(row.cells),reason:row.cells.length!==source.headers.length?'RAGGED_ROW':'MISSING_KEY'});
  const k=stable(key);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);
 }
 const matched=[],missing=[],unexpected=[],duplicates=[],differences=[],keys=new Set(plan.rows.map(r=>stable(r.key)));
 for(const [key,rows]of groups){if(rows.length>1)duplicates.push({key:JSON.parse(key),rowIds:rows.map(r=>r.id)});if(!keys.has(key))unexpected.push(...rows.map(r=>({rowId:r.id,key:JSON.parse(key),cells:clone(r.cells)})));}
 for(const expected of plan.rows){const actual=groups.get(stable(expected.key));if(!actual?.length){missing.push({rowId:expected.rowId,key:expected.key});continue;}if(actual.length!==1)continue;const row=actual[0],d=[];
  for(let column=0;column<plan.headers.length;column++){const received=row.cells[columnMap.get(column)]??null;if(expected.cells[column]!==received)d.push({preparedColumn:column,returnedColumn:columnMap.get(column),header:plan.headers[column],expected:expected.cells[column],actual:received});}
  if(d.length)differences.push({rowId:expected.rowId,returnedRowId:row.id,key:expected.key,cells:d});else if(!invalid.some(x=>x.rowId===row.id))matched.push({rowId:expected.rowId,returnedRowId:row.id,key:expected.key});
 }
 const used=new Set(columns.map(c=>c.returnedColumn)),extraColumns=source.headers.map((name,column)=>({name,column})).filter(c=>!used.has(c.column));
 return{id:id(input.id,'target return ID'),planId:plan.id,prepared_sha256:plan.sha256,sourceId:source.id,source_sha256:source.sha256,columns:clone(columns),actor:text(input.actor,'return reviewer',300),note:text(input.note,'actual returned-source interpretation',10000),revision,at,matched,missing,unexpected,duplicates,differences,invalid,extraColumns,returnedRows:clone(source.rows),ready:!missing.length&&!unexpected.length&&!duplicates.length&&!differences.length&&!invalid.length,noteOnMeaning:'Exact returned file reconciliation only; not evidence of cloud ingestion or access enforcement.'};
}
function effect(ws,kind,input,revision,at){
 if(kind==='import-file'){
  const value=fileValue(input),old=ws.files.find(x=>x.id===value.id);if(old){need(same(value,old),'FILE_ID_CONFLICT','This physical source ID already belongs to another complete original.');return{fileId:old.id,retained:true};}
  need(ws.files.length<LIMITS.files,'FILE_LIMIT','Preserve the full workspace before selecting another file scope.');ws.files.push(value);return{fileId:value.id,retained:false};
 }
 if(kind==='import-csv'){
  const sourceId=id(input.id,'CSV source ID');need(['source','target'].includes(input.role),'SOURCE_ROLE','Choose source or returned target.');text(input.filename,'original CSV filename',300);const p=parseCsv(input.text);
  const value={id:sourceId,role:input.role,filename:input.filename,text:input.text,bytes:p.bytes,sha256:p.sha256,headers:p.headers,rows:p.rows.map((cells,i)=>({id:sourceId+':r'+(i+2),record:i+2,cells}))},old=ws.sources.find(x=>x.id===sourceId);
  if(old){need(same(value,old),'SOURCE_ID_CONFLICT','This CSV ID already belongs to another complete original.');return{sourceId,rows:old.rows.length,retained:true};}
  need(ws.sources.length<LIMITS.sources,'SOURCE_LIMIT','Preserve this complete selection before importing another scope.');ws.sources.push(value);return{sourceId,rows:value.rows.length,retained:false};
 }
 if(kind==='save-registry'){
  const value=registryValue(ws,input.registry),old=ws.registries.find(r=>r.id===value.id);if(old){need(same(old,value),'REGISTRY_ID_CONFLICT','A registry edition is immutable. Save a separately identified successor.');return{registryId:old.id,retained:true};}
  need(ws.registries.length<LIMITS.registries,'REGISTRY_LIMIT','Preserve the original registry scope.');ws.registries.push(value);return{registryId:value.id,retained:false};
 }
 if(kind==='save-mapping'){
  const m=mappingValue(ws,input,revision,at);ws.mappingHistory.push(m);ws.mappings[m.sourceId]=m;return{mappingId:m.id,sourceId:m.sourceId};
 }
 if(kind==='save-correction'){
  const s=atId(ws.sources,input.sourceId,'original CSV'),r=effectiveRows(ws,s).find(r=>r.id===input.rowId);need(r&&Number.isInteger(input.column)&&input.column>=0&&input.column<r.cells.length,'CORRECTION_CELL','Select an existing complete original cell.');
  const c={id:'correction-'+hash({workspaceId:ws.id,operationId:input.operationId}).slice(0,40),sourceId:s.id,rowId:r.id,column:input.column,before:r.cells[input.column],value:text(input.value,'corrected complete value',LIMITS.cellCharacters,true),actor:text(input.actor,'correction reviewer',300),reason:text(input.reason,'correction reason',10000),at,revision};ws.corrections.push(c);return{correctionId:c.id,sourceId:s.id,rowId:r.id,column:c.column,before:c.before,value:c.value};
 }
 if(kind==='save-analysis'){
  id(input.id,'analysis ID');need(!ws.analyses.some(x=>x.id===input.id),'ANALYSIS_ID_CONFLICT','Retain the original frozen analysis and create a successor with a new ID.');
  const value={id:input.id,title:text(input.title,'analysis title',300),actor:text(input.actor,'analysis author',300),note:text(input.note,'analysis context',10000),at,revision,request:clone(input.analysis),result:analysisInternal(ws,input.analysis)};ws.analyses.push(value);return{analysisId:value.id,ready:value.result.ready,qualified:value.result.qualified};
 }
 if(kind==='save-report'){
  id(input.id,'report ID');need(!ws.reports.some(x=>x.id===input.id),'REPORT_ID_CONFLICT','Retain the original complete report and save a successor ID.');unique(array(input.analysisIds,'report analyses',1000),'report analysis IDs');need(input.analysisIds.length>0,'EMPTY_REPORT','Select original saved analyses.');
  const analyses=input.analysisIds.map(x=>clone(atId(ws.analyses,x,'frozen analysis'))),registryIds=[...new Set(analyses.map(x=>x.request.registryId))],sourceIds=[...new Set(analyses.flatMap(x=>x.request.sourceIds))];
  const fileIds=[...new Set(registryIds.flatMap(x=>atId(ws.registries,x,'registry').source_file_ids))];
  const value={id:input.id,title:text(input.title,'report title',300),actor:text(input.actor,'report author',300),note:text(input.note,'report qualifications',10000),at,revision,basisRevision:ws.revision,basisOperationSha256:hash(ws.operations),analysisIds:clone(input.analysisIds),analyses,registryIds,sourceIds,files:fileIds.map(x=>{const{content_base64,...f}=atId(ws.files,x,'original');return clone(f);}),sources:sourceIds.map(x=>{const s=atId(ws.sources,x,'CSV');return{id:s.id,filename:s.filename,bytes:s.bytes,sha256:s.sha256};})};ws.reports.push(value);return{reportId:value.id,analyses:analyses.length};
 }
 if(kind==='prepare-target'){
  id(input.id,'target plan ID');need(!ws.targetPlans.some(x=>x.id===input.id),'TARGET_ID_CONFLICT','Save a separately identified successor target plan.');const p=targetPlan(ws,input,revision,at);ws.targetPlans.push(p);return{planId:p.id,rows:p.rows.length,sha256:p.sha256};
 }
 if(kind==='record-target-return'){
  id(input.id,'target return ID');need(!ws.targetReturns.some(x=>x.id===input.id),'RETURN_ID_CONFLICT','Retain the original return and save a separately identified successor.');const r=targetReturn(ws,input,revision,at);ws.targetReturns.push(r);return{returnId:r.id,ready:r.ready};
 }
 fail('OPERATION_KIND','The original operation kind is unsupported.');
}
export function validateWorkspace(ws){
 need(plain(ws)&&ws.schema===WORKSPACE_SCHEMA,'INVALID_WORKSPACE','Open the complete original tourism workspace.');
 const replay=createWorkspace({id:ws.id,title:ws.title,createdAt:ws.createdAt});
 for(const name of ['files','sources','registries','mappingHistory','corrections','analyses','reports','targetPlans','targetReturns','operations'])array(ws[name],'saved '+name,name==='operations'?LIMITS.operations:100000);
 need(Number.isSafeInteger(ws.revision)&&ws.revision===ws.operations.length&&plain(ws.mappings),'INVALID_HISTORY','Keep the full original operation sequence and current mappings.');
 const seen=new Set();
 for(let i=0;i<ws.operations.length;i++){
  const o=ws.operations[i];need(plain(o)&&plain(o.input)&&plain(o.result),'INVALID_HISTORY','Retain the complete original request and receipt.');id(o.id,'operation ID');
  need(!seen.has(o.id)&&o.revision===i+1&&o.previousRevision===i,'INVALID_HISTORY','Keep distinct ordered operations.');seen.add(o.id);instant(o.at,'operation time');
  const input=clone(o.input);if(o.kind==='import-file')input.content_base64=atId(ws.files,o.fileInputId,'original file').content_base64;
  if(o.kind==='import-csv')input.text=atId(ws.sources,o.sourceInputId,'original CSV').text;
  need(input.operationId===o.id&&input.expectedRevision===i&&input.at===o.at&&hash({kind:o.kind,input})===o.requestSha256,'INVALID_HISTORY','The complete original operation request or identity changed.');
  const result=effect(replay,o.kind,input,i+1,o.at);need(same(result,o.result),'INVALID_HISTORY','The original operation result differs from its source-derived effect.');
  replay.revision=i+1;replay.operations.push(clone(o));
 }
 need(same(replay,ws),'INVALID_HISTORY','Preserve every original source, mapping, correction, frozen result and ordered receipt.');return ws;
}
function mutate(ws,kind,input){
 validateWorkspace(ws);need(plain(input),'INVALID_INPUT','Supply the complete original operation.');id(input.operationId,'operation ID');instant(input.at,'operation time');
 const requestSha256=hash({kind,input}),old=ws.operations.find(x=>x.id===input.operationId);
 if(old){need(old.requestSha256===requestSha256,'OPERATION_CONFLICT','This operation ID belongs to another original request.');return{workspace:ws,receipt:clone(old),replayed:true};}
 need(input.expectedRevision===ws.revision,'REVISION_CONFLICT','Reopen the current revision before applying this original request.',{current:ws.revision,expected:input.expectedRevision});
 need(ws.operations.length<LIMITS.operations,'OPERATION_LIMIT','Retain the complete original operation selection.');
 const next=clone(ws),revision=ws.revision+1,result=effect(next,kind,input,revision,input.at),saved=clone(input);
 if(kind==='import-file')delete saved.content_base64;if(kind==='import-csv')delete saved.text;
 const receipt={id:input.operationId,kind,input:saved,requestSha256,previousRevision:ws.revision,revision,at:input.at,result,...(kind==='import-file'?{fileInputId:result.fileId}:{}),...(kind==='import-csv'?{sourceInputId:result.sourceId}:{})};
 next.revision=revision;next.operations.push(receipt);bounded(next);return{workspace:next,receipt:clone(receipt),replayed:false};
}
export const importFile=(ws,input)=>mutate(ws,'import-file',input);
export const importCsv=(ws,input)=>mutate(ws,'import-csv',input);
export const saveRegistry=(ws,input)=>mutate(ws,'save-registry',input);
export const saveMapping=(ws,input)=>mutate(ws,'save-mapping',input);
export const saveCorrection=(ws,input)=>mutate(ws,'save-correction',input);
export const saveAnalysis=(ws,input)=>mutate(ws,'save-analysis',input);
export const saveReport=(ws,input)=>mutate(ws,'save-report',input);
export const prepareTarget=(ws,input)=>mutate(ws,'prepare-target',input);
export const recordTargetReturn=(ws,input)=>mutate(ws,'record-target-return',input);
export function exportWorkspace(ws){validateWorkspace(ws);bounded(ws);return json(ws);}
export function importWorkspace(value){text(value,'complete portable JSON',LIMITS.workspaceBytes);need(sha256Utf8(value).bytes<=LIMITS.workspaceBytes,'WORKSPACE_TOO_LARGE','Choose a complete workspace within128 MiB.');const ws=JSON.parse(value);validateWorkspace(ws);bounded(ws);return ws;}

const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const htmlTable=(headers,rows)=>'<div class="scroll"><table><thead><tr>'+headers.map(x=>'<th>'+escapeHtml(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+escapeHtml(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function reportHtml(ws,reportId){
 const report=reportId?atId(ws.reports,reportId,'frozen report'):null,analyses=report?report.analyses:ws.analyses,title=report?.title??ws.title,sourceIds=report?.sourceIds??ws.sources.map(s=>s.id);
 const body=analyses.map(a=>{
  const r=a.result,summary=r.result?.rational?r.result.rational.display:r.result?.value;
  return '<section><h2>'+escapeHtml(a.title)+'</h2><p>'+escapeHtml(a.note)+'</p><p><strong>'+escapeHtml(summary??'No defined result')+' '+escapeHtml(r.result?.unit??'')+'</strong> · '+(r.qualified?'Source dimensions qualified':'Qualification remains unresolved')+'</p><p>Saved revision '+a.revision+' · '+escapeHtml(a.actor)+' · '+escapeHtml(a.at)+'</p>'+
   htmlTable(['Finding','Severity','Meaning'],r.issues.map(i=>[i.code,i.severity,i.message]))+
   '<h3>Complete original operands</h3>'+htmlTable(['Row','Geography','Half-open period','Metric','Original display','Raw value','Multiplier','Normalized','Status','Unit / currency','Method','Population','Price basis','Physical source / locator'],r.operands.map(o=>[o.rowId,o.values.geography_id,o.values.period_start+' to '+o.values.period_end,o.values.metric_id,o.values.original_display,o.values.value,o.values.multiplier,o.normalized_value,o.values.status,o.values.unit+' / '+o.currency,o.values.method_id,o.values.population,o.values.price_basis,o.values.source_id+' / '+o.values.source_locator]))+
   '<details open><summary>Exact calculation, dimensions and declared source relationships</summary><pre>'+escapeHtml(json(r.result))+'</pre></details><p>Frozen source basis '+escapeHtml(r.basis_sha256)+'. Later edits create successor analyses; these operands remain the original saved selection.</p></section>';
 }).join('');
 const files=report?.files??ws.files.map(({content_base64,...f})=>f);
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(title)+'</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;padding:24px;max-width:1400px;color:#252525;background:#fff}h1,h2,h3{line-height:1.2}section{border-top:2px solid #aaa;margin-top:30px;padding-top:12px}.scroll{overflow:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #bcbcbc;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#ededed}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}a{color:#333}summary{cursor:pointer;font-weight:600}@media(max-width:600px){body{padding:12px}h1{font-size:25px}}@media print{body{max-width:none;padding:0;font-size:10pt}.scroll{overflow:visible}table{font-size:8pt}details>*,details:not([open])>*{display:block}section{break-before:auto}tr{break-inside:avoid}}</style><h1>'+escapeHtml(title)+'</h1><p>Complete source-qualified tourism series report. Workspace '+escapeHtml(ws.id)+' · '+(report?'Frozen report revision '+report.revision:'Current workspace revision '+ws.revision)+'.</p><p>'+escapeHtml(report?.note??'Original estimates, counted streams and methods remain distinct. No automatic live feed, causal attribution, platform ingestion, statistical confidence or access-control claim.')+'</p>'+
  (body||'<p>No saved analyses selected.</p>')+
  '<section><h2>Original source files</h2>'+htmlTable(['ID / filename','Representation','Publisher','Source URL','Bytes','SHA-256','Provenance'],files.map(f=>[f.id+' / '+f.filename,f.representation,f.publisher,f.source_url,f.bytes,f.sha256,f.note]))+
  '<ul>'+files.map(f=>'<li><a href="../originals/'+safeSegment(f.id)+'/'+safeFilename(f.filename)+'">'+escapeHtml(f.filename)+'</a> — '+escapeHtml(f.id)+'</li>').join('')+'</ul></section>'+
  '<section><h2>Complete original and corrected CSV rows</h2>'+sourceIds.map(id=>{const s=atId(ws.sources,id,'CSV');return'<h3>'+escapeHtml(s.filename)+'</h3><p>Original '+s.bytes+' bytes / '+s.sha256+'. Repeated headers retain column numbers. Original values are unchanged; attributed current overlays follow separately.</p>'+htmlTable(['Original record',...s.headers.map((h,i)=>i+': '+h)],s.rows.map(r=>[r.record,...r.cells]))+'<details><summary>All current corrected rows (later than a frozen report when applicable)</summary>'+htmlTable(['Record',...s.headers.map((h,i)=>i+': '+h)],effectiveRows(ws,s).map(r=>[r.record,...r.cells]))+'</details>';}).join('')+'</section>'+
  '<section><h2>Complete saved analysis/report and operation history</h2><pre>'+escapeHtml(json({report:report??null,mappingHistory:ws.mappingHistory,corrections:ws.corrections,operations:ws.operations}))+'</pre></section></html>';
}
export function renderReport(ws,reportId){validateWorkspace(ws);return reportHtml(ws,reportId);}
export function buildHandover(ws){
 validateWorkspace(ws);bounded(ws);const files=[],paths=new Set();
 const add=(path,type,content)=>{need(!paths.has(path),'HANDOVER_COLLISION','A complete handover path repeats.');paths.add(path);files.push({path,type,content,...sha256Utf8(content)});};
 const binary=(path,file)=>{need(!paths.has(path),'HANDOVER_COLLISION','A complete original path repeats.');paths.add(path);files.push({path,type:file.mime_type,base64:file.content_base64,bytes:file.bytes,sha256:file.sha256});};
 add('workspace.json','application/json',json(ws));add('history/operations.json','application/json',json(ws.operations));
 for(const f of ws.files)binary('originals/'+safeSegment(f.id)+'/'+safeFilename(f.filename),f);
 for(const s of ws.sources){const p='csv/'+safeSegment(s.id);add(p+'/original.csv','text/csv',s.text);add(p+'/corrected.csv','text/csv',encodeCsv([s.headers,...effectiveRows(ws,s).map(r=>r.cells)]));add(p+'/selection.json','application/json',json({id:s.id,role:s.role,filename:s.filename,bytes:s.bytes,sha256:s.sha256,mapping:ws.mappings[s.id]??null,mappingHistory:ws.mappingHistory.filter(m=>m.sourceId===s.id),corrections:ws.corrections.filter(c=>c.sourceId===s.id)}));}
 for(const r of ws.registries)add('registries/'+safeSegment(r.id)+'.json','application/json',json(r));
 for(const a of ws.analyses)add('analyses/'+safeSegment(a.id)+'.json','application/json',json(a));
 add('reports/complete-report.html','text/html',reportHtml(ws));
 for(const r of ws.reports){add('reports/'+safeSegment(r.id)+'.json','application/json',json(r));add('reports/'+safeSegment(r.id)+'.html','text/html',reportHtml(ws,r.id));}
 for(const p of ws.targetPlans){add('target/'+safeSegment(p.id)+'/prepared.csv','text/csv',p.csv);add('target/'+safeSegment(p.id)+'/selection.json','application/json',json(p));}
 for(const r of ws.targetReturns)add('returns/'+safeSegment(r.id)+'.json','application/json',json(r));
 const manifest={schema:'tjlabs.tourism-series-handover.v1',workspaceId:ws.id,revision:ws.revision,originalFilenames:ws.files.map(f=>({id:f.id,filename:f.filename,path:'originals/'+safeSegment(f.id)+'/'+safeFilename(f.filename)})),files:files.map(({content,base64,...f})=>f),meaning:'Complete original source, attributed overlays, immutable reports and actual file reconciliation. Vendor permissions, hosting, licensing and import execution remain separately agreed.'};
 add('MANIFEST.json','application/json',json(manifest));return{schema:manifest.schema,workspaceId:ws.id,revision:ws.revision,files,manifest};
}
