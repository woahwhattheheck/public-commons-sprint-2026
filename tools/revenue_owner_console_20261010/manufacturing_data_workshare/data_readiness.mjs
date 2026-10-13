/** Manufacturing data readiness: original CSV editions, explicit mappings and exact quantities. */
export const SCHEMA='manufacturing-data-readiness.v1';
export const KINDS=Object.freeze(['items','bom','inventory','purchaseOrders']);
export const DISPOSITION_STATUSES=Object.freeze(['open','working','deferred','accepted_risk','resolved']);
const defs={
 items:[['itemId','Item ID',true],['revision','Revision (blank is a specific revision)',true],['description','Description',false],['baseUnit','Base unit',true]],
 bom:[['parentId','Parent item ID',true],['parentRevision','Parent revision',true],['componentId','Component item ID',true],['componentRevision','Component revision',true],['quantity','Component quantity',true],['unit','Quantity unit',true],['lineId','BOM line ID',false]],
 inventory:[['itemId','Item ID',true],['revision','Revision',true],['site','Site',true],['location','Location',true],['quantity','On-hand quantity',true],['unit','Quantity unit',true],['lot','Lot',false]],
 purchaseOrders:[['orderId','Order ID',true],['lineId','Order line ID',true],['itemId','Item ID',true],['revision','Revision',true],['orderedQuantity','Ordered quantity',true],['receivedQuantity','Received quantity',true],['unit','Quantity unit',true],['dueDate','Due date (YYYY-MM-DD)',false],['supplier','Supplier',false]]
};
export const FIELD_DEFINITIONS=Object.freeze(Object.fromEntries(Object.entries(defs).map(([k,v])=>[k,Object.freeze(v.map(([name,label,required])=>Object.freeze({name,label,required})))])));
const MAX_SOURCE_BYTES=16*1024*1024,MAX_ROWS=200000;
const clone=v=>JSON.parse(JSON.stringify(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function need(ok,message){if(!ok)throw new Error(message);}
function text(v,label,max=1000){need(typeof v==='string'&&v.length<=max,label+' must be text of at most '+max+' characters.');return v;}
function id(v,label='Identity'){text(v,label,250);need(v.trim().length>0,label+' is required.');return v;}
function time(v){text(v,'Timestamp',80);need(/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v)),'Use an explicit ISO timestamp.');return v;}
function kind(v){need(KINDS.includes(v),'Unknown table kind.');return v;}
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function utf8(s){const a=[];for(let i=0;i<s.length;i++){let c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const d=s.charCodeAt(i+1);if(d>=0xdc00&&d<=0xdfff){c=0x10000+((c-0xd800)<<10)+d-0xdc00;i++;}else c=0xfffd;}else if(c>=0xdc00&&c<=0xdfff)c=0xfffd;if(c<128)a.push(c);else if(c<2048)a.push(192|(c>>6),128|(c&63));else if(c<65536)a.push(224|(c>>12),128|((c>>6)&63),128|(c&63));else a.push(240|(c>>18),128|((c>>12)&63),128|((c>>6)&63),128|(c&63));}return a;}
export function sha256(s){
 const b=utf8(s),len=b.length; b.push(128);while(b.length%64!==56)b.push(0);const bits=BigInt(len)*8n;for(let i=7;i>=0;i--)b.push(Number((bits>>BigInt(i*8))&255n));
 const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 let h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];const r=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let p=0;p<b.length;p+=64){const w=new Array(64);for(let i=0;i<16;i++)w[i]=(b[p+4*i]<<24)|(b[p+4*i+1]<<16)|(b[p+4*i+2]<<8)|b[p+4*i+3];for(let i=16;i<64;i++)w[i]=(w[i-16]+(r(w[i-15],7)^r(w[i-15],18)^(w[i-15]>>>3))+w[i-7]+(r(w[i-2],17)^r(w[i-2],19)^(w[i-2]>>>10)))|0;
 let [a,c,d,e,f,g,j,k]=h;for(let i=0;i<64;i++){const t=(k+(r(f,6)^r(f,11)^r(f,25))+((f&g)^(~f&j))+K[i]+w[i])|0;const u=((r(a,2)^r(a,13)^r(a,22))+((a&c)^(a&d)^(c&d)))|0;k=j;j=g;g=f;f=(e+t)|0;e=d;d=c;c=a;a=(t+u)|0;}h=h.map((v,i)=>(v+[a,c,d,e,f,g,j,k][i])|0);}
 return h.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');
}
function hash(v){return sha256(stable(v));}
function issue(code,message,rows=[],detail={},action='Review the exact source row and replace or remap its source edition.',severity='error'){
 return {id:'issue-'+hash({code,rows,detail}).slice(0,32),code,severity,message,action,rows:clone(rows),detail:clone(detail)};
}
export function inspectCSV(csv,{delimiter=','}={}){
 text(csv,'CSV source',MAX_SOURCE_BYTES);need(utf8(csv).length<=MAX_SOURCE_BYTES,'CSV exceeds 16 MiB.');need([',',';','\t'].includes(delimiter),'Choose comma, semicolon or tab explicitly.');
 let i=csv.charCodeAt(0)===0xfeff?1:0,line=1,start=1,cell='',cells=[],records=[],errors=[],quoted=false,closed=false,started=false;
 const errorKeys=new Set();const addError=value=>{const key=value.code+':'+value.line;if(!errorKeys.has(key)){errorKeys.add(key);errors.push(value);}};
 const finishCell=()=>{cells.push(cell);cell='';closed=false;started=false;};
 const finishRow=()=>{finishCell();records.push({line:start,values:cells});cells=[];need(records.length<=MAX_ROWS+1,'CSV exceeds 200,000 data records.');};
 while(i<csv.length){const c=csv[i++];
  if(quoted){if(c==='"'){if(csv[i]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else if(c==='\r'||c==='\n'){if(c==='\r'&&csv[i]==='\n'){cell+='\r\n';i++;}else cell+=c;line++;}else cell+=c;continue;}
  if(c==='"'){if(!started&&cell===''){quoted=true;started=true;}else addError({code:'CSV_QUOTE',line,message:'Quote must begin a field.'});continue;}
  if(c===delimiter){finishCell();continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&csv[i]==='\n')i++;finishRow();line++;start=line;continue;}
  if(closed)addError({code:'CSV_AFTER_QUOTE',line,message:'Unexpected text after a closing quote.'});
  cell+=c;started=true;
 }
 if(quoted)addError({code:'CSV_UNCLOSED_QUOTE',line:start,message:'Quoted field is not closed.'});
 if(cell!==''||cells.length||started||closed)finishRow();
 const header=records.shift(),headers=header?.values||[];
 if(!header)addError({code:'CSV_EMPTY',line:1,message:'The CSV has no header.'});
 const seen=new Set();for(const h of headers){if(h==='')addError({code:'CSV_HEADER',line:1,message:'Column names must not be blank.'});if(seen.has(h))addError({code:'CSV_DUPLICATE_HEADER',line:1,message:'Duplicate header: '+h});seen.add(h);}
 for(const row of records)if(row.values.length!==headers.length)addError({code:'CSV_WIDTH',line:row.line,message:'Row has '+row.values.length+' fields; header has '+headers.length+'.'});
 return {delimiter,headers,rows:records,errors,bytes:utf8(csv).length,sha256:sha256(csv)};
}
export const parseCSV=inspectCSV;
function csvCell(v){let s=String(v??'');if(/^[\t\r\n ]*[=+\-@]/.test(s)&&!/^-\d+(?:\.\d+)?$/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csvLines(headers,rows){return [headers,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';}
export function templateCSV(k){return csvLines(FIELD_DEFINITIONS[kind(k)].map(x=>x.name),[]);}
function coreState(s){need(object(s)&&s.schema===SCHEMA,'Open a manufacturing readiness workspace.');id(s.id);need(Number.isSafeInteger(s.revision)&&s.revision>=0,'Invalid workspace revision.');for(const k of ['imports','unitMappingEditions','dispositions','history','requests'])need(Array.isArray(s[k]),'Missing '+k+'.');need(object(s.activeSources),'Missing active sources.');return s;}
export function createWorkspace({id:ident,label='',at}){
 id(ident);text(label,'Workspace label');time(at);
 return {schema:SCHEMA,id:ident,label,revision:0,createdAt:at,updatedAt:at,imports:[],activeSources:{items:null,bom:null,inventory:null,purchaseOrders:null},unitMappingEditions:[],activeUnitMapping:null,dispositions:[],history:[],requests:[]};
}
function mappedSource(state,input){
 coreState(state);need(object(input),'Supply an import.');const {id:ident,kind:k,name,csv,delimiter=',',columns={},at}=input;
 id(ident,'Import identity');kind(k);text(name,'Original filename',500);need(name.length>0,'Original filename is required.');time(at);need(object(columns),'Column mapping must be an object.');
 const parsed=inspectCSV(csv,{delimiter});const fields=FIELD_DEFINITIONS[k];const allowed=new Set(fields.map(x=>x.name));const mapping={};
 for(const [key,value]of Object.entries(columns)){need(allowed.has(key),'Unknown mapped field: '+key);if(object(value)){need(['revision','parentRevision','componentRevision'].includes(key)&&Object.keys(value).length===1&&value.constant==='','Only revision fields may explicitly select the blank constant.');mapping[key]={constant:''};}else{text(value,'Column name');mapping[key]=value;}}
 const source={id:ident,kind:k,name,csv,delimiter,columns:mapping,at,sha256:parsed.sha256,bytes:parsed.bytes};
 const ref=(row,line)=>({sourceId:ident,kind:k,row,line});
 let issues=parsed.errors.map(e=>issue(e.code,e.message,[ref(0,e.line)],{line:e.line}));
 for(const f of fields){const column=mapping[f.name];if(f.required&&!column)issues.push(issue('MAPPING_REQUIRED','Choose the source column for '+f.label+'.',[ref(0,1)],{field:f.name}));
  if(typeof column==='string'&&column&&!parsed.headers.includes(column))issues.push(issue('MAPPING_COLUMN','Mapped column is absent: '+column,[ref(0,1)],{field:f.name,column}));}
 const canonicalRows=parsed.errors.length?[]:parsed.rows.map((row,index)=>{const value={};for(const f of fields){const selected=mapping[f.name],at=typeof selected==='string'?parsed.headers.indexOf(selected):-1;value[f.name]=at<0?'':row.values[at].trim();}return {ref:ref(index+1,row.line),values:value};});
 return {schema:'manufacturing-import-preview.v1',baseRevision:state.revision,source,headers:parsed.headers,rows:parsed.rows,canonicalRows,issues};
}
export function stageImport(state,input){return clone(mappedSource(state,input));}
function metaCheck(meta){need(object(meta),'Request metadata is required.');id(meta.requestId,'Request identity');id(meta.actor,'Actor');time(meta.at);need(Number.isSafeInteger(meta.expectedRevision)&&meta.expectedRevision>=0,'Expected revision is required.');}
function mutate(state,payload,meta,apply){
 coreState(state);metaCheck(meta);const signature=hash({payload,meta});const prior=state.requests.find(x=>x.id===meta.requestId);
 if(prior){need(prior.signature===signature,'Request identity was already used for another complete mutation.');return clone(state);}
 need(state.revision===meta.expectedRevision,'Workspace changed; keep both editions and review the current revision.');
 const next=clone(state);apply(next);next.revision++;next.updatedAt=meta.at;
 next.history.push({revision:next.revision,requestId:meta.requestId,actor:meta.actor,at:meta.at,type:payload.type,activeSources:clone(next.activeSources),activeUnitMapping:next.activeUnitMapping});
 next.requests.push({id:meta.requestId,signature,revision:next.revision});return next;
}
export function adoptImport(state,preview,meta){
 need(object(preview)&&preview.schema==='manufacturing-import-preview.v1','Stage the complete original import first.');
 const check=mappedSource(state,preview.source);need(stable({...check,baseRevision:preview.baseRevision})===stable(preview),'Import preview changed; stage the exact original bytes again.');
 need(preview.baseRevision===meta.expectedRevision,'Preview belongs to a different workspace revision.');
 return mutate(state,{type:'adoptImport',source:preview.source},meta,next=>{
  need(!next.imports.some(x=>x.id===preview.source.id),'Use a new import edition identity.');
  next.imports.push(clone(preview.source));next.activeSources[preview.source.kind]=preview.source.id;
 });
}
export function selectImport(state,sourceId,meta){
 const source=coreState(state).imports.find(x=>x.id===sourceId);need(source,'Original import is absent.');
 return mutate(state,{type:'selectImport',sourceId},meta,next=>{next.activeSources[source.kind]=sourceId;});
}
export function remapImport(state,sourceId,columns,meta){
 const source=coreState(state).imports.find(x=>x.id===sourceId);need(source,'Original import is absent.');
 const preview=stageImport({...state,revision:meta.expectedRevision},{...source,id:meta.importId||meta.requestId,columns,at:meta.at});return adoptImport(state,preview,meta);
}
function decimal(s){if(typeof s!=='string'||s.length>256||!/^[-+]?\d+(?:\.\d+)?$/.test(s))return null;
 let neg=s[0]==='-',v=s.replace(/^[-+]/,''),[whole,fraction='']=v.split('.');if(fraction.length>80||whole.length>160)return null;
 let n=BigInt(whole+fraction),scale=fraction.length;if(neg)n=-n;while(scale&&n%10n===0n){n/=10n;scale--;}return {n,scale};
}
function decimalText(d){let s=(d.n<0n?-d.n:d.n).toString();if(d.scale)s=s.padStart(d.scale+1,'0').slice(0,-d.scale)+'.'+s.padStart(d.scale+1,'0').slice(-d.scale);return(d.n<0n?'-':'')+s;}
function multiply(a,b){return {n:a.n*b.n,scale:a.scale+b.scale};}
function subtract(a,b){const scale=Math.max(a.scale,b.scale);return {n:a.n*10n**BigInt(scale-a.scale)-b.n*10n**BigInt(scale-b.scale),scale};}
function validatedMappings(mappings){
 need(Array.isArray(mappings),'Unit mappings must be an array.');const keys=new Set();
 return mappings.map(m=>{need(object(m),'Unit mapping must be an object.');const fromUnit=id(m.fromUnit,'From unit'),toUnit=id(m.toUnit,'To unit'),factor=text(m.factor,'Exact conversion factor',256);
 need(fromUnit!==toUnit,'Identical units need no conversion.');const d=decimal(factor);need(d&&d.n>0n,'Conversion factor must be a positive exact decimal.');const key=stable([fromUnit,toUnit]);need(!keys.has(key),'Duplicate unit conversion.');keys.add(key);text(m.note??'','Unit mapping note',4000);return {fromUnit,toUnit,factor:decimalText(d),note:m.note??''};});
}
export function setUnitMappings(state,{mappings,...meta}){
 const value=validatedMappings(mappings);return mutate(state,{type:'setUnitMappings',mappings:value},meta,next=>{const entry={id:meta.requestId,at:meta.at,actor:meta.actor,mappings:value};next.unitMappingEditions.push(entry);next.activeUnitMapping=entry.id;});
}
export function recordDisposition(state,{issueId,status,note='',...meta}){
 id(issueId,'Issue identity');need(DISPOSITION_STATUSES.includes(status),'Unknown disposition status.');text(note,'Disposition note',12000);
 need(status==='open'||note.trim(),'Add the reviewer rationale.');
 return mutate(state,{type:'recordDisposition',issueId,status,note},meta,next=>{need(analyze(state).issues.some(x=>x.id===issueId),'Review an issue in the current source edition.');next.dispositions.push({issueId,status,note,actor:meta.actor,at:meta.at,requestId:meta.requestId});});
}
const itemKey=(id,revision)=>stable([id,revision]);
function rowKey(row,fields){return stable(fields.map(k=>row.values[k]));}
export function analyze(state){
 coreState(state);const tables={items:[],bom:[],inventory:[],purchaseOrders:[]},issues=[],sourceIssues=[];
 const push=(...args)=>issues.push(issue(...args));const sources=new Map(state.imports.map(s=>[s.id,s]));
 for(const k of KINDS){const selected=state.activeSources[k];if(!selected){push('SOURCE_REQUIRED','Select an original '+k+' CSV.',[],{kind:k},'Import and map the actual '+k+' source.');continue;}
  const s=sources.get(selected);need(s&&s.kind===k,'Active import identity or kind changed.');const preview=mappedSource(state,s);need(preview.source.sha256===s.sha256&&preview.source.bytes===s.bytes,'Original CSV bytes changed.');tables[k]=preview.canonicalRows;for(const sourceIssue of preview.issues)sourceIssues.push(sourceIssue);}
 for(const sourceIssue of sourceIssues)issues.push(sourceIssue);if(state.activeSources.items&&tables.items.length===0)push('EMPTY_ITEM_MASTER','The selected item master has no parsed item rows.',[],{sourceId:state.activeSources.items},'Provide a complete item master before evaluating references.');const items=new Map();
 for(const row of tables.items){const v=row.values;for(const f of ['itemId','baseUnit'])if(!v[f])push('REQUIRED_VALUE','Item '+f+' is blank.',[row.ref],{field:f});
  if(v.itemId){const key=itemKey(v.itemId,v.revision),group=items.get(key)||[];group.push(row);items.set(key,group);}}
 for(const [key,group]of items)if(group.length>1)push('DUPLICATE_ITEM','More than one item has the same exact item ID and revision.',group.map(x=>x.ref),{identity:JSON.parse(key)},'Resolve the duplicate master identity in a successor source.');
 const mappingEdition=state.unitMappingEditions.find(x=>x.id===state.activeUnitMapping);const mappings=validatedMappings(mappingEdition?.mappings||[]);
 const conversions=new Map(mappings.map(x=>[stable([x.fromUnit,x.toUnit]),decimal(x.factor)]));
 const reference=(row,identifier,revision,field)=>{if(!identifier){push('REQUIRED_VALUE',field+' is blank.',[row.ref],{field});return null;}const candidates=items.get(itemKey(identifier,revision));
  if(!candidates){push('MISSING_ITEM_REVISION','The exact item and revision are absent from the selected master.',[row.ref],{field,itemId:identifier,revision},'Provide this exact revision or correct the source reference; do not select an assumed latest revision.');return null;}
  if(candidates.length!==1){push('AMBIGUOUS_ITEM_REVISION','The item reference resolves to a duplicate master identity.',[row.ref],{field,itemId:identifier,revision});return null;}return candidates[0];};
 const quantity=(row,field,positive=false)=>{const d=decimal(row.values[field]);if(!d){push('INVALID_QUANTITY','Quantity must be an exact ordinary decimal (no exponent, grouping or blank).',[row.ref],{field,value:row.values[field]});return null;}
  if(d.n<0n||(positive&&d.n===0n)){push('QUANTITY_RANGE',positive?'BOM quantity must be greater than zero.':'Quantity must not be negative.',[row.ref],{field,value:row.values[field]});return null;}return d;};
 const converted=(row,d,item,field)=>{if(!d||!item)return null;const from=row.values.unit,to=item.values.baseUnit;if(!from||!to){push('UNIT_REQUIRED','Source and item base units must be explicit.',[row.ref,item.ref],{field});return null;}
  if(from===to)return decimalText(d);const factor=conversions.get(stable([from,to]));if(!factor){push('UNIT_MAPPING_REQUIRED','The source unit differs from the item base unit.',[row.ref,item.ref],{fromUnit:from,toUnit:to},'Review and record a direct explicit conversion factor, or correct the source unit.');return null;}return decimalText(multiply(d,factor));};
 const duplicate=(rows,fields,code)=>{const groups=new Map();for(const row of rows){const key=typeof fields==='function'?fields(row):rowKey(row,fields);const group=groups.get(key)||[];group.push(row);groups.set(key,group);}for(const [key,g]of groups)if(g.length>1)push(code,'Duplicate source identity requires review.',g.map(r=>r.ref),{identity:JSON.parse(key)});};
 duplicate(tables.bom,r=>r.values.lineId?stable(['line',r.values.parentId,r.values.parentRevision,r.values.lineId]):stable(['component',r.values.parentId,r.values.parentRevision,r.values.componentId,r.values.componentRevision]),'DUPLICATE_BOM_LINE');
 duplicate(tables.inventory,['itemId','revision','site','location','lot'],'DUPLICATE_INVENTORY_POSITION');
 duplicate(tables.purchaseOrders,['orderId','lineId'],'DUPLICATE_PO_LINE');
 const graph=new Map(),reverse=new Map(),edgeRows=[];
 const vertex=x=>{if(!graph.has(x))graph.set(x,[]);if(!reverse.has(x))reverse.set(x,[]);};
 for(const row of tables.bom){const v=row.values,parent=reference(row,v.parentId,v.parentRevision,'parentId'),component=reference(row,v.componentId,v.componentRevision,'componentId');
  const d=quantity(row,'quantity',true);row.derived={baseQuantity:converted(row,d,component,'quantity'),baseUnit:component?.values.baseUnit??null};
  if(parent&&component){const a=itemKey(v.parentId,v.parentRevision),b=itemKey(v.componentId,v.componentRevision);vertex(a);vertex(b);graph.get(a).push(b);reverse.get(b).push(a);edgeRows.push({a,b,row});if(a===b)push('BOM_SELF_EDGE','A BOM item contains its own exact revision.',[row.ref],{identity:JSON.parse(a)},'Correct the source edge.');}}
 // Iterative two-pass strongly connected components: arbitrary depth without recursion.
 const seen=new Set(),order=[];for(const root of graph.keys()){if(seen.has(root))continue;seen.add(root);const stack=[[root,0]];while(stack.length){const top=stack[stack.length-1],adj=graph.get(top[0]);if(top[1]<adj.length){const next=adj[top[1]++];if(!seen.has(next)){seen.add(next);stack.push([next,0]);}}else{order.push(top[0]);stack.pop();}}}
 const components=new Map(),groups=[];for(let i=order.length-1;i>=0;i--){const root=order[i];if(components.has(root))continue;const index=groups.length,members=[],stack=[root];components.set(root,index);while(stack.length){const node=stack.pop();members.push(node);for(const next of reverse.get(node))if(!components.has(next)){components.set(next,index);stack.push(next);}}groups.push(members);}
 const cycleRows=new Map();for(const edge of edgeRows){const c=components.get(edge.a);if(c===components.get(edge.b)&&groups[c].length>1){const rows=cycleRows.get(c)||[];rows.push(edge.row.ref);cycleRows.set(c,rows);}}
 for(const [c,rows]of cycleRows)push('BOM_CYCLE','These source edges belong to a circular multi-level BOM.',rows,{items:groups[c].sort().map(x=>JSON.parse(x))},'Break the circular dependency in a successor BOM edition.');
 for(const row of tables.inventory){const v=row.values;for(const f of ['site','location'])if(!v[f])push('REQUIRED_VALUE','Inventory '+f+' is blank.',[row.ref],{field:f});
  const item=reference(row,v.itemId,v.revision,'itemId'),d=quantity(row,'quantity');row.derived={baseQuantity:converted(row,d,item,'quantity'),baseUnit:item?.values.baseUnit??null};}
 for(const row of tables.purchaseOrders){const v=row.values;for(const f of ['orderId','lineId'])if(!v[f])push('REQUIRED_VALUE','Purchase order '+f+' is blank.',[row.ref],{field:f});
  const item=reference(row,v.itemId,v.revision,'itemId'),ordered=quantity(row,'orderedQuantity'),received=quantity(row,'receivedQuantity');let open=null;if(ordered&&received){const balance=subtract(ordered,received);open=decimalText(balance);if(balance.n<0n)push('PO_OVER_RECEIVED','Received quantity exceeds ordered quantity.',[row.ref],{ordered:v.orderedQuantity,received:v.receivedQuantity},'Reconcile the order and receipt records; retain an explained over-receipt rather than clamping it.');}
  if(v.dueDate&&(!/^\d{4}-\d\d-\d\d$/.test(v.dueDate)||Number.isNaN(Date.parse(v.dueDate+'T00:00:00Z'))||new Date(v.dueDate+'T00:00:00Z').toISOString().slice(0,10)!==v.dueDate))push('INVALID_DATE','Use a valid YYYY-MM-DD due date.',[row.ref],{field:'dueDate',value:v.dueDate});
  row.derived={openQuantity:open,baseOrderedQuantity:converted(row,ordered,item,'orderedQuantity'),baseReceivedQuantity:converted(row,received,item,'receivedQuantity'),baseUnit:item?.values.baseUnit??null};}
 const uniqueIssues=new Map(issues.map(x=>[x.id,x]));issues.length=0;for(const uniqueIssue of uniqueIssues.values())issues.push(uniqueIssue);
 const decisions=new Map();for(const d of state.dispositions)decisions.set(d.issueId,d);
 for(const row of issues)row.disposition=clone(decisions.get(row.id)||{status:'open',note:''});
 const counts={rows:Object.fromEntries(KINDS.map(k=>[k,tables[k].length])),issues:issues.length,errors:issues.filter(x=>x.severity==='error').length,warnings:issues.filter(x=>x.severity==='warning').length,byCode:{},byDisposition:{}};
 for(const row of issues){counts.byCode[row.code]=(counts.byCode[row.code]||0)+1;counts.byDisposition[row.disposition.status]=(counts.byDisposition[row.disposition.status]||0)+1;}
 return {schema:'manufacturing-readiness-analysis.v1',workspaceId:state.id,revision:state.revision,tables,issues,counts,activeSources:clone(state.activeSources),readiness:{status:counts.errors?'SOURCE_REVIEW_REQUIRED':'READY_FOR_REVIEW',blockingIssues:counts.errors,note:'Readiness covers only the retained source checks. Reviewer dispositions do not erase data exceptions or certify ERP acceptance.'}};
}
function validJSON(value){const stack=[value];let nodes=0;while(stack.length){need(++nodes<=3000000,'Workspace is too large.');const v=stack.pop();if(v===null||typeof v==='string'||typeof v==='boolean')continue;if(typeof v==='number'){need(Number.isFinite(v),'Non-finite JSON value.');continue;}need(Array.isArray(v)||object(v),'Workspace must contain plain JSON.');for(const [k,x]of Object.entries(v)){need(!['__proto__','prototype','constructor'].includes(k),'Unsafe object key.');stack.push(x);}}}
export function importWorkspace(value){
 const state=typeof value==='string'?JSON.parse(value):clone(value);validJSON(state);coreState(state);text(state.label,'Workspace label');time(state.createdAt);time(state.updatedAt);
 const sourceIndex=new Map(state.imports.map(source=>[source.id,source])),requestIndex=new Map(state.requests.map(request=>[request.id,request]));
 const ids=new Set();for(const source of state.imports){need(!ids.has(source.id),'Duplicate source edition identity.');ids.add(source.id);const check=mappedSource(state,source).source;need(stable(check)===stable(source),'Original import source, hash or mapping changed.');}
 for(const k of KINDS){const selected=state.activeSources[k];need(selected===null||sourceIndex.get(selected)?.kind===k,'Invalid active source selection.');}
 const units=new Set();for(const edition of state.unitMappingEditions){id(edition.id);need(!units.has(edition.id),'Duplicate unit mapping edition.');units.add(edition.id);time(edition.at);id(edition.actor);need(stable(validatedMappings(edition.mappings))===stable(edition.mappings),'Unit mappings changed.');}
 need(state.activeUnitMapping===null||units.has(state.activeUnitMapping),'Missing active unit mapping.');
 const requests=new Set();for(const r of state.requests){id(r.id);need(!requests.has(r.id),'Duplicate request identity.');requests.add(r.id);need(/^[a-f0-9]{64}$/.test(r.signature)&&Number.isSafeInteger(r.revision)&&r.revision>0&&r.revision<=state.revision,'Invalid retained request.');}
 need(state.requests.length===state.revision&&state.history.length===state.revision,'Revision history is incomplete.');
 state.history.forEach((h,i)=>{need(h.revision===i+1&&requestIndex.get(h.requestId)?.revision===h.revision,'Retain ordered revision history and its original request.');time(h.at);id(h.actor);need(object(h.activeSources),'Retain each earlier source selection.');for(const k of KINDS){const selected=h.activeSources[k];need(selected===null||sourceIndex.get(selected)?.kind===k,'An earlier selected source edition is missing.');}need(h.activeUnitMapping===null||units.has(h.activeUnitMapping),'An earlier unit mapping edition is missing.');});
 const last=state.history[state.history.length-1];if(last)need(stable(last.activeSources)===stable(state.activeSources)&&last.activeUnitMapping===state.activeUnitMapping,'Current selections differ from the retained latest edition.');
 for(const d of state.dispositions){id(d.issueId);need(DISPOSITION_STATUSES.includes(d.status),'Unknown retained disposition.');text(d.note,'Disposition note',12000);time(d.at);id(d.actor);need(requests.has(d.requestId),'Disposition has no retained request.');}
 analyze(state);return clone(state);
}
export function exportWorkspace(state){return JSON.stringify(importWorkspace(state),null,2)+'\n';}
export function exportExceptionsCSV(state){const report=analyze(state);return csvLines(['issueId','code','severity','status','message','action','sourceRows','reviewerNote'],report.issues.map(x=>[x.id,x.code,x.severity,x.disposition.status,x.message,x.action,JSON.stringify(x.rows),x.disposition.note]));}
export function exportCanonicalCSV(state,k){kind(k);const report=analyze(state),fields=FIELD_DEFINITIONS[k].map(x=>x.name),derived=k==='items'?[]:k==='purchaseOrders'?['openQuantity','baseOrderedQuantity','baseReceivedQuantity','baseUnit']:['baseQuantity','baseUnit'];return csvLines(['sourceId','sourceRow','sourceLine',...fields,...derived.map(x=>'derived_'+x)],report.tables[k].map(r=>[r.ref.sourceId,r.ref.row,r.ref.line,...fields.map(f=>r.values[f]),...derived.map(f=>r.derived?.[f]??'')]));}
function escapeHTML(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function reportHTML(state){
 const r=analyze(state),e=escapeHTML;
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(state.label||'Manufacturing data readiness')+'</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#17212b;background:#fff;margin:0;padding:24px;max-width:1200px}h1{font-size:26px}h2{margin-top:32px;font-size:20px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{text-align:left;vertical-align:top;border:1px solid #b8c0c8;padding:9px;overflow-wrap:anywhere}th{background:#eef1f4}small{color:#46515d}.scroll{overflow:auto}code{overflow-wrap:anywhere}article{border:1px solid #b8c0c8;padding:16px;margin:16px 0;break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere} @media(max-width:600px){body{padding:14px}th,td{padding:6px}}@media print{body{max-width:none;padding:0}.scroll{overflow:visible}}</style><h1>'+e(state.label||'Manufacturing data readiness')+'</h1><p>Workspace '+e(state.id)+' · revision '+r.revision+' · source updated '+e(state.updatedAt)+'</p><h2>'+e(r.readiness.status.replace(/_/g,' '))+'</h2><p>'+e(r.readiness.note)+'</p><p>'+r.counts.issues+' current exceptions. '+state.imports.length+' original source editions retained.</p><h2>Selected originals</h2><div class="scroll"><table><thead><tr><th>Table</th><th>Original filename</th><th>Rows</th><th>SHA-256</th></tr></thead><tbody>'+KINDS.map(k=>{const s=state.imports.find(x=>x.id===state.activeSources[k]);return '<tr><td>'+e(k)+'</td><td>'+e(s?.name||'Not imported')+'</td><td>'+r.tables[k].length+'</td><td><code>'+e(s?.sha256||'')+'</code></td></tr>';}).join('')+'</tbody></table></div><h2>Actionable exceptions</h2>'+r.issues.map(x=>'<article><strong>'+e(x.code)+' — '+e(x.message)+'</strong><p>'+e(x.action)+'</p><p>Status: '+e(x.disposition.status)+'</p><p>'+e(x.disposition.note)+'</p><pre>'+e(JSON.stringify(x.rows,null,2))+'</pre><small>'+e(x.id)+'</small></article>').join('')+'<h2>Review boundary</h2><p>Source values and blank revisions remain explicit. Unit conversions use only recorded direct factors. This report does not calculate purchasing, production plans, or ERP import acceptance. Canonical exports accompany the retained originals; CSV exports neutralize spreadsheet formula prefixes while original CSV downloads retain their exact bytes.</p></html>';
}
