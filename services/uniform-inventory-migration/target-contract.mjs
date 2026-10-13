import * as E from './engine.mjs';
import {sha256Utf8} from './sha256.mjs';

export const TARGET_SCHEMA='tjlabs.uniform-target-contract.v1';
const clone=x=>JSON.parse(JSON.stringify(x));
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const need=(ok,code,message,details)=>{if(!ok){const e=new Error(message);e.code=code;if(details!==undefined)e.details=details;throw e;}};
const stable=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
const text=(v,label,empty=false)=>{need(typeof v==='string'&&(empty||v.length>0)&&v.length<=E.LIMITS.cellCharacters,'INVALID_CONTRACT','Supply '+label+'.');sha256Utf8(v);return v;};
const hash=x=>sha256Utf8(stable(x)).sha256;
const digest=v=>{text(v,'a complete SHA-256');need(/^[a-f0-9]{64}$/.test(v),'INVALID_CONTRACT','Use the complete lowercase SHA-256.');return v;};
const field=(domain,name)=>E.DOMAINS[domain].fields.find(f=>f.name===name);
const instant=v=>{text(v,'the actual attributed ISO time');need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v.slice(0,10)+'T00:00:00.000Z').toISOString().slice(0,10)===v.slice(0,10),'INVALID_CONTRACT','Use an ISO time including its offset.');return v;};
function filename(v){text(v,'a target CSV filename');need(v.length<=240&&/^[A-Za-z0-9][A-Za-z0-9._-]*\.csv$/i.test(v),'INVALID_CONTRACT','Choose one ordinary CSV filename without directory components.');return v;}
function unique(values,label){const s=new Set(values);need(s.size===values.length,'INVALID_CONTRACT','Keep distinct '+label+'.');return s;}
function decision(v,label){need(plain(v),'INVALID_CONTRACT','Supply the actual '+label+' decision.');text(v.id,label+' decision ID');text(v.actor,label+' actor');instant(v.at);text(v.reason,label+' reason');return v;}
function source(ws,id,role,domain){const s=ws.sources.find(s=>s.id===id);need(s&&s.role===role&&s.domain===domain,'SELECTION_CHANGED','Keep the selected original '+role+' '+domain+' file.');return s;}
function effective(ws,s){const rows=s.rows.map(r=>({...r,cells:r.cells.slice()})),by=new Map(rows.map(r=>[r.id,r]));for(const c of ws.corrections)if(c.sourceId===s.id){const r=by.get(c.rowId);need(r&&r.cells[c.column]===c.before,'SOURCE_CHANGED','Keep the complete original correction ancestry.');r.cells[c.column]=c.value;}return rows;}
function selection(ws,role,d,binding){const m=ws.mappings[role][d];need(m&&plain(binding),'SELECTION_MISSING','Bind the complete selected '+role+' '+d+' mapping.');const s=source(ws,m.sourceId,role,d);need(binding.sourceId===s.id&&binding.sourceSha256===s.sha256&&binding.mappingId===m.id,'SELECTION_CHANGED','The selected original source or mapping differs for '+role+' '+d+'.');return{s,m,rows:effective(ws,s)};}

export function validateTargetContract(workspace,contract){
 const ws=E.validateWorkspace(workspace),c=clone(contract);need(plain(c)&&c.schema===TARGET_SCHEMA,'INVALID_CONTRACT','Open a complete target contract.');text(c.id,'contract ID');text(c.edition,'contract edition');decision(c.approval,'target contract');
 need(plain(c.workspace)&&c.workspace.id===ws.id&&c.workspace.revision===ws.revision&&c.workspace.sha256===sha256Utf8(E.exportWorkspace(ws)).sha256,'WORKSPACE_CHANGED','Bind the exact complete workspace revision and portable bytes.');
 need(Array.isArray(c.sourceEvidence)&&c.sourceEvidence.length>0,'INVALID_CONTRACT','Retain the actual prime-supplied native contract references.');for(const e of c.sourceEvidence){text(e.name,'original contract source name');digest(e.sha256);text(e.locator,'original source locator');}
 need(Array.isArray(c.crosswalks),'INVALID_CONTRACT','Declare every selected original crosswalk identity, including an explicit empty list.');unique(c.crosswalks.map(w=>w.id),'declared crosswalk IDs');for(const w of c.crosswalks){text(w.id,'declared crosswalk ID');need(Object.hasOwn(E.DOMAINS,w.domain),'INVALID_CONTRACT','Select the crosswalk identifier domain.');digest(w.sha256);need(Number.isInteger(w.sourceColumn)&&Number.isInteger(w.targetColumn)&&w.sourceColumn>=0&&w.targetColumn>=0&&w.sourceColumn!==w.targetColumn,'INVALID_CONTRACT','Declare exact original key-column positions.');text(w.approvalId,'original crosswalk approval ID');}
 need(Array.isArray(c.requiredDomains)&&c.requiredDomains.length>0&&c.requiredDomains.every(d=>Object.hasOwn(E.DOMAINS,d)),'INVALID_CONTRACT','Name the complete agreed migration domains.');unique(c.requiredDomains,'scope domains');
 need(Array.isArray(c.domains)&&c.domains.length===c.requiredDomains.length,'INVALID_CONTRACT','Supply every agreed domain once.');unique(c.domains.map(d=>d.domain),'domain contracts');
 const filenames=new Set();
 for(const d of c.domains){
  need(c.requiredDomains.includes(d.domain),'INVALID_CONTRACT','Keep every domain inside the explicit scope.');const {s,m}=selection(ws,'source',d.domain,d.source);
  filename(d.filename);need(!filenames.has(d.filename.toLowerCase()),'INVALID_CONTRACT','Target filenames must also be distinct on case-insensitive recipients.');filenames.add(d.filename.toLowerCase());
  need(Array.isArray(d.columns)&&d.columns.length>0&&d.columns.length<=E.LIMITS.columns,'INVALID_CONTRACT','Retain all actual ordered native target columns.');
  for(const col of d.columns){
   need(plain(col)&&plain(col.value),'INVALID_CONTRACT','Supply each native target column and explicit value source.');text(col.header,'original target heading',true);
   const v=col.value;
   if(v.from==='field'){need(field(d.domain,v.field),'INVALID_CONTRACT','Select a canonical source field.');need(Object.hasOwn(m.columns,v.field),'INVALID_CONTRACT','The selected canonical field is not mapped.');need(['raw','canonical'].includes(v.representation),'INVALID_CONTRACT','Select raw or canonical field representation explicitly.');}
   else if(v.from==='column')need(Number.isInteger(v.column)&&v.column>=0&&v.column<s.headers.length,'INVALID_CONTRACT','Select an exact original numeric column.');
   else if(v.from==='constant'){text(v.value,'complete declared constant',true);decision(v.decision,'constant');}
   else need(false,'INVALID_CONTRACT','Use field, column or approved constant as a value source.');
   if(v.crosswalkId!==undefined){text(v.crosswalkId,'crosswalk ID');need(['source-to-target','target-to-source'].includes(v.direction),'INVALID_CONTRACT','Choose the exact crosswalk direction.');}
   if(v.values!==undefined){need(Array.isArray(v.values)&&v.values.length>0,'INVALID_CONTRACT','Supply the complete exact value translation.');decision(v.decision,'value translation');unique(v.values.map(x=>text(x.from,'original translation value',true)),'translation inputs');for(const x of v.values)text(x.to,'translated value',true);}
   need(typeof col.required==='boolean','INVALID_CONTRACT','State whether each target column is required.');
   if(col.maxCharacters!==undefined)need(Number.isSafeInteger(col.maxCharacters)&&col.maxCharacters>=0,'INVALID_CONTRACT','Use a nonnegative Unicode character limit.');
   if(col.maxBytes!==undefined)need(Number.isSafeInteger(col.maxBytes)&&col.maxBytes>=0,'INVALID_CONTRACT','Use a nonnegative UTF-8 byte limit.');
   if(col.allowedValues!==undefined){need(Array.isArray(col.allowedValues),'INVALID_CONTRACT','Retain the actual allowed values.');for(const x of col.allowedValues)text(x,'allowed value',true);}
  }
  need(Array.isArray(d.readbackKeys),'INVALID_CONTRACT','State every native-to-original key translation for readback, including an explicit empty list when IDs are preserved.');
  unique(d.readbackKeys.map(x=>x.field),'readback key fields');
  for(const k of d.readbackKeys){const f=field(d.domain,k.field);need(f&&f.type==='id','INVALID_CONTRACT','Readback translation applies only to an original identifier field.');text(k.crosswalkId,'readback crosswalk ID');need(typeof k.allowBlank==='boolean','INVALID_CONTRACT','State whether an empty optional key is allowed.');need(!k.allowBlank||!f.required,'INVALID_CONTRACT','A required identifier cannot allow an empty readback value.');}
  need(plain(d.excludedOriginalColumns)&&Array.isArray(d.excludedOriginalColumns.columns),'INVALID_CONTRACT','Classify unused original columns explicitly.');
  const used=new Set(d.columns.flatMap(col=>col.value.from==='column'?[col.value.column]:col.value.from==='field'?[m.columns[col.value.field]]:[]));
  const omitted=s.headers.map((heading,column)=>({heading,column})).filter(x=>!used.has(x.column));
  need(stable(d.excludedOriginalColumns.columns.map(x=>x.column).sort((a,b)=>a-b))===stable(omitted.map(x=>x.column)),'INVALID_CONTRACT','Retain exactly the original columns outside this native output.');
  for(const x of d.excludedOriginalColumns.columns){need(s.headers[x.column]===x.heading,'INVALID_CONTRACT','An excluded original column heading changed.');decision(x.decision,'omitted target field');}
 }
 return c;
}
function crosswalks(input,ws){
 need(Array.isArray(input),'INVALID_CROSSWALK','Supply complete original crosswalk files.');const maps=new Map(),identities=[];
 for(const w of input){need(plain(w),'INVALID_CROSSWALK','Retain each complete crosswalk.');text(w.id,'crosswalk ID');need(!maps.has(w.id),'INVALID_CROSSWALK','Crosswalk IDs must be distinct.');need(Object.hasOwn(E.DOMAINS,w.domain),'INVALID_CROSSWALK','Select the referenced identifier domain.');text(w.filename,'crosswalk filename');decision(w.approval,'crosswalk');const parsed=E.parseCsv(w.text);need(w.sha256===parsed.sha256,'INVALID_CROSSWALK','The complete original crosswalk bytes changed.');
  need(Number.isInteger(w.sourceColumn)&&Number.isInteger(w.targetColumn)&&w.sourceColumn!==w.targetColumn&&w.sourceColumn>=0&&w.targetColumn>=0&&w.sourceColumn<parsed.headers.length&&w.targetColumn<parsed.headers.length,'INVALID_CROSSWALK','Select two exact original source/native key columns.');
  const forward=new Map(),reverse=new Map();for(let i=0;i<parsed.rows.length;i++){const row=parsed.rows[i];need(row.length===parsed.headers.length,'INVALID_CROSSWALK','A crosswalk record has a different column count.');const a=row[w.sourceColumn],b=row[w.targetColumn];need(a!==''&&b!==''&&!forward.has(a)&&!reverse.has(b),'INVALID_CROSSWALK','Use complete one-to-one opaque identifiers; ambiguous or repeated crosswalk keys require an explicit different contract.');const r={source:a,target:b,record:i+2,cells:row.slice()};forward.set(a,r);reverse.set(b,r);}
  const m=ws.mappings.source[w.domain];need(m,'INVALID_CROSSWALK','Select the original source identifier domain for this crosswalk.');const s=source(ws,m.sourceId,'source',w.domain),column=m.columns[E.DOMAINS[w.domain].id];need(Number.isInteger(column),'INVALID_CROSSWALK','Map the original identifier field for the crosswalk.');const keys=new Set(effective(ws,s).map(r=>r.cells[column]));for(const a of forward.keys())need(keys.has(a),'INVALID_CROSSWALK','A crosswalk source key is outside its original selected domain.',{crosswalkId:w.id,sourceKey:a});
  maps.set(w.id,{...w,parsed,forward,reverse});identities.push({id:w.id,domain:w.domain,filename:w.filename,bytes:parsed.bytes,sha256:parsed.sha256,sourceColumn:w.sourceColumn,targetColumn:w.targetColumn,approval:clone(w.approval),recordSha256:hash((({text,...metadata})=>metadata)(w))});
 }
 return{maps,identities};
}
function base(workspace,contract,input){
 const ws=E.validateWorkspace(workspace),c=validateTargetContract(ws,contract),cw=crosswalks(input,ws),report=E.reconcile(ws);
 need(c.crosswalks.length===cw.identities.length,'INVALID_CROSSWALK','Keep exactly the original crosswalk files selected by this approved contract.');
 for(const declared of c.crosswalks){const actual=cw.maps.get(declared.id);need(actual&&actual.domain===declared.domain&&actual.sha256===declared.sha256&&actual.sourceColumn===declared.sourceColumn&&actual.targetColumn===declared.targetColumn&&actual.approval.id===declared.approvalId,'INVALID_CROSSWALK','An approved complete crosswalk identity changed.');}
 for(const d of c.domains){for(const k of d.readbackKeys){const w=cw.maps.get(k.crosswalkId),f=field(d.domain,k.field);need(w&&w.domain===(f.reference||d.domain),'INVALID_CROSSWALK','The readback crosswalk must identify the actual field domain.');}for(const col of d.columns)if(col.value.crosswalkId!==undefined){const w=cw.maps.get(col.value.crosswalkId);need(w,'INVALID_CROSSWALK','A selected complete crosswalk is absent.');if(col.value.from==='field'){const f=field(d.domain,col.value.field);need(f.type==='id'&&w.domain===(f.reference||d.domain),'INVALID_CROSSWALK','Use the field’s actual identifier domain crosswalk.');}}}
 const identity={workspace:{id:ws.id,revision:ws.revision,sha256:sha256Utf8(E.exportWorkspace(ws)).sha256},contractSha256:hash(c),crosswalks:cw.identities};return{ws,c,cw,report,identity};
}
function issue(list,code,context,message){list.push({id:'target-finding-'+hash({code,context,message}).slice(0,40),code,...context,message});}
function translate(value,rule,maps,context,issues){
 let result=value,steps=[];
 if(rule.crosswalkId!==undefined){
  if(result===''&&rule.allowBlank===true)return{value:result,steps};
  const w=maps.get(rule.crosswalkId),r=(rule.direction==='source-to-target'?w.forward:w.reverse).get(result);
  if(!r){issue(issues,'CROSSWALK_KEY_MISSING',context,'The exact selected key has no original crosswalk record.');return{value:null,steps};}
  const next=rule.direction==='source-to-target'?r.target:r.source;steps.push({kind:'crosswalk',id:w.id,sha256:w.sha256,record:r.record,before:result,after:next,direction:rule.direction});result=next;
 }
 if(rule.values!==undefined){const r=rule.values.find(x=>x.from===result);if(!r){issue(issues,'VALUE_TRANSLATION_MISSING',context,'The original value is absent from the explicitly approved translation.');return{value:null,steps};}steps.push({kind:'value-translation',before:result,after:r.to,decision:clone(rule.decision)});result=r.to;}
 return{value:result,steps};
}
function addFile(files,path,mediaType,text){const identity=sha256Utf8(text);files.push({path,mediaType,text,...identity});}
function originalFiles(files,ws,c,input){
 addFile(files,'original/workspace.json','application/json',E.exportWorkspace(ws));
 addFile(files,'original/target-contract.json','application/json',JSON.stringify(c,null,2)+'\n');
 for(let i=0;i<input.length;i++){const w=input[i];addFile(files,'original/crosswalk-'+String(i+1).padStart(3,'0')+'.csv','text/csv',w.text);}
 addFile(files,'original/crosswalks.json','application/json',JSON.stringify(input.map((w,i)=>({...w,text:undefined,path:'crosswalk-'+String(i+1).padStart(3,'0')+'.csv'})),null,2)+'\n');
}
export function projectTarget(workspace,contract,input=[]){
 const {ws,c,cw,report,identity}=base(workspace,contract,input),issues=[],domains=[],files=[];
 for(const i of report.issues.filter(i=>i.severity==='error'&&i.role==='source'&&c.requiredDomains.includes(i.domain)&&i.code!=='COMPARISON_SIDE_MISSING'))issue(issues,'ORIGINAL_SOURCE_FINDING',{domain:i.domain,originalFinding:i},'Resolve the selected original source finding before creating native load files.');
 for(const d of c.domains){const selected=report.domains.source[d.domain],s=source(ws,selected.sourceId,'source',d.domain),m=ws.mappings.source[d.domain],rows=[];
  for(const r of selected.rows){const cells=[],lineage=[];
   for(let column=0;column<d.columns.length;column++){const col=d.columns[column],v=col.value,context={domain:d.domain,sourceId:s.id,rowId:r.rowId,targetColumn:column,targetHeading:col.header};let value,origin;
    if(v.from==='field'){value=v.representation==='canonical'?r.values[v.field]:r.rawValues[v.field];origin={kind:'mapped-field',field:v.field,representation:v.representation,originalColumn:m.columns[v.field],originalValue:r.cells[m.columns[v.field]]};}
    else if(v.from==='column'){value=r.cells[v.column];origin={kind:'original-column',originalColumn:v.column,originalValue:value};}
    else{value=v.value;origin={kind:'approved-constant',value,decision:clone(v.decision)};}
    if(typeof value!=='string'){issue(issues,'SOURCE_CELL_MISSING',context,'The selected original cell is absent.');cells.push(null);lineage.push({...context,origin,steps:[],value:null});continue;}
    const t=translate(value,v,cw.maps,context,issues);value=t.value;
    if(value!==null){if(col.required&&value==='')issue(issues,'TARGET_REQUIRED_VALUE',context,'The actual native target column requires a value.');if(col.maxCharacters!==undefined&&Array.from(value).length>col.maxCharacters)issue(issues,'TARGET_CHARACTER_LIMIT',context,'The full value exceeds the declared native character limit.');if(col.maxBytes!==undefined&&sha256Utf8(value).bytes>col.maxBytes)issue(issues,'TARGET_BYTE_LIMIT',context,'The full UTF-8 value exceeds the declared native byte limit.');if(col.allowedValues!==undefined&&!col.allowedValues.includes(value))issue(issues,'TARGET_VALUE_NOT_ALLOWED',context,'The actual value is outside the native contract’s declared values.');}
    cells.push(value);lineage.push({...context,origin,steps:t.steps,value});
   }rows.push({originalRowId:r.rowId,originalRecord:r.record,originalCells:r.cells.slice(),cells,lineage});
  }domains.push({domain:d.domain,sourceId:s.id,sourceSha256:s.sha256,mappingId:m.id,filename:d.filename,headers:d.columns.map(x=>x.header),rows,excludedOriginalColumns:clone(d.excludedOriginalColumns)});
 }
 const ready=issues.length===0;
 if(ready)for(const d of domains){const value=E.encodeCsv([d.headers,...d.rows.map(r=>r.cells)]);if(sha256Utf8(value).bytes>E.LIMITS.csvBytes)issue(issues,'TARGET_CSV_LIMIT',{domain:d.domain},'The complete projected native CSV exceeds the supported32MiB file size.');}
 if(issues.length===0)for(const d of domains)addFile(files,'load/'+d.filename,'text/csv',E.encodeCsv([d.headers,...d.rows.map(r=>r.cells)]));
 const result={schema:'tjlabs.uniform-target-projection.v1',id:'projection-'+hash(identity).slice(0,40),identity,scope:c.requiredDomains,readyForPrimeLoad:issues.length===0,status:issues.length?'needs-review':'prepared',domains,issues,meaning:'Complete declarative native-file preparation. The prime executes the actual authorised load; no tenant operation or production acceptance occurs here.'};
 originalFiles(files,ws,c,input);addFile(files,'projection.json','application/json',JSON.stringify(result,null,2)+'\n');
 return{...result,files};
}
export function compareReadback(workspace,contract,input=[]){
 const {ws,c,cw,report,identity}=base(workspace,contract,input),issues=[],transforms=[],files=[];let derived=E.createWorkspace({id:'readback-'+hash(identity).slice(0,40),title:'Derived original/native-key comparison',createdAt:c.approval.at}),n=0;
 const imported=[];
 for(const d of c.domains)for(const role of ['source','target']){
  const binding=role==='source'?d.source:d.target;
  if(!binding){issue(issues,'TARGET_RETURN_MISSING',{domain:d.domain,role},'Bind the actual complete returned target file and mapping before comparison.');continue;}
  const selected=selection(ws,role,d.domain,binding),rows=selected.rows.map(r=>({...r,cells:r.cells.slice()}));
  if(role==='target'){
   for(const r of rows){const changes=new Map();for(const k of d.readbackKeys){
    const column=selected.m.columns[k.field];if(!Number.isInteger(column)){issue(issues,'TARGET_KEY_MAPPING_MISSING',{domain:d.domain,field:k.field},'Map the native returned identifier field explicitly.');continue;}
    const before=r.cells[column];if(typeof before!=='string'){issue(issues,'TARGET_CELL_MISSING',{domain:d.domain,rowId:r.id,column},'The original returned key cell is absent.');continue;}
    const context={domain:d.domain,sourceId:selected.s.id,rowId:r.id,field:k.field,column},t=translate(before,{crosswalkId:k.crosswalkId,direction:'target-to-source',allowBlank:k.allowBlank},cw.maps,context,issues);
    if(t.value===null)continue;
    if(changes.has(column)&&changes.get(column).value!==t.value){issue(issues,'CONFLICTING_KEY_TRANSLATIONS',context,'Two mapped fields select the same original column with different required translations.');continue;}
    changes.set(column,t);transforms.push({...context,before,after:t.value,steps:t.steps});
   }for(const [column,t]of changes)r.cells[column]=t.value;}
  }
  imported.push({domain:d.domain,role,originalSourceId:selected.s.id,originalSha256:selected.s.sha256,originalMappingId:selected.m.id,headers:selected.s.headers.slice(),rows:rows.map(r=>({originalRowId:r.id,originalRecord:r.record,cells:r.cells})),columns:clone(selected.m.columns)});
 }
 if(issues.length===0){
  for(const item of imported){const csv=E.encodeCsv([item.headers,...item.rows.map(r=>r.cells)]),operationId='readback-import-'+(++n),name=item.role+'-'+item.domain+'.csv';let saved=E.importCsv(derived,{operationId,expectedRevision:derived.revision,role:item.role,domain:item.domain,filename:name,text:csv,observedAt:c.approval.at});derived=saved.workspace;item.derivedSourceId=saved.receipt.result.sourceId;saved=E.saveMapping(derived,{operationId:'readback-map-'+n,expectedRevision:derived.revision,role:item.role,domain:item.domain,sourceId:item.derivedSourceId,columns:item.columns,at:c.approval.at});derived=saved.workspace;for(let i=0;i<item.rows.length;i++)item.rows[i].derivedRowId=derived.sources.find(s=>s.id===item.derivedSourceId).rows[i].id;addFile(files,'derived/'+name,'text/csv',csv);}
 }
 const reconciliation=issues.length?null:E.reconcile(derived),result={schema:'tjlabs.uniform-native-readback.v1',id:'readback-'+hash(identity).slice(0,40),identity,scope:c.requiredDomains,status:issues.length?'needs-review':reconciliation.ready?'reconciled':'needs-review',technicalReady:!!reconciliation?.ready,issues,translations:transforms,originalToDerived:imported,reconciliation,meaning:'A complete derived comparison after the declared one-to-one native-key reversal. Original native files/keys remain in original/workspace.json. Native operational acceptance and residual-difference decisions remain attributable prime/source-owner records.'};
 originalFiles(files,ws,c,input);if(reconciliation)addFile(files,'derived/workspace.json','application/json',E.exportWorkspace(derived));addFile(files,'readback.json','application/json',JSON.stringify(result,null,2)+'\n');return{...result,files};
}
export function targetContractTemplate(workspace){
 const ws=E.validateWorkspace(workspace);
 return{schema:TARGET_SCHEMA,id:'replace-with-agreed-contract-id',edition:'replace-with-actual-edition',approval:{id:null,actor:null,at:null,reason:null},workspace:{id:ws.id,revision:ws.revision,sha256:sha256Utf8(E.exportWorkspace(ws)).sha256},sourceEvidence:[],crosswalks:[],requiredDomains:Object.keys(E.DOMAINS),domains:Object.keys(E.DOMAINS).map(domain=>{const binding=role=>{const m=ws.mappings[role][domain],s=m&&ws.sources.find(x=>x.id===m.sourceId);return s?{sourceId:s.id,sourceSha256:s.sha256,mappingId:m.id}:null;};return{domain,source:binding('source'),target:binding('target'),filename:domain+'.csv',columns:[],readbackKeys:[],excludedOriginalColumns:{columns:[]}};})};
}
