import {createImplementationSourceBundle,validateImplementationSourceBundle,
  implementationSourceMember,validateImplementationSourceFile} from './source-bundle-reference.mjs';
// MIT. Source-defined implementation and receiving in the original merchant case.
// Browser and Node share this file. Persistence remains the SF74 case workspace.
export const COMMISSIONING_SCHEMA = 'stellar-forge.merchant-commissioning.v1';
export const MAX_COMMISSIONING_BYTES = 64 * 1024 * 1024;
export const MAX_MATERIAL_BYTES = 48 * 1024 * 1024;
export const TASK_STATUSES = Object.freeze(['planned','in_progress','ready','done','retired']);
export const RECEIVING_OUTCOMES = Object.freeze(['accepted','changes_required','not_run','not_applicable']);
export const PLAN_FIELDS = Object.freeze([
  'title','customerTask','payer','merchant','buyer','implementationOwner','receivingOwner',
  'sourceLocation','merchantHost','buyerApplication','outputDefinition','repeatTrigger',
  'supportOwner','supportBoundary','commercialReference','notes',
]);
export const RECEIVING_PLAN_FIELDS=Object.freeze(['customerTask','merchant','buyer','sourceLocation',
  'merchantHost','buyerApplication','outputDefinition']);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const INPUTS = ['before','after','postBefore','postAfter','terms','supportText','inputs'];
const TEXT = new TextEncoder();
const UTF8 = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const copy = value => JSON.parse(JSON.stringify(value));
export function commissioningError(code,detail,status=422) {
  return Object.assign(new Error(detail),{code,status});
}
function ensure(condition,detail,code='INVALID_COMMISSIONING') {
  if(!condition)throw commissioningError(code,detail,code.endsWith('_CONFLICT')?409:422);
}
function record(value,keys,label) {
  ensure(value&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value)),label+' must be an object');
  ensure(Object.keys(value).every(key=>keys.includes(key)),'Unexpected '+label+' field');
  return value;
}
function text(value,max,label,{empty=true}={}) {
  ensure(typeof value==='string'&&value.length<=max&&
    (empty||value.trim())&&UTF8.decode(TEXT.encode(value))===value&&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'Invalid '+label);
  return value;
}
function id(value,label='identifier') {
  ensure(typeof value==='string'&&ID.test(value),'Invalid '+label);return value;
}
function hash(value,label='source digest') {
  ensure(typeof value==='string'&&HASH.test(value),'Invalid '+label);return value;
}
function utc(value,label='observation time') {
  ensure(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&
    Number.isFinite(Date.parse(value)),'Use an actual UTC '+label);
  ensure(new Date(value).toISOString().slice(0,19)===value.slice(0,19),'Invalid '+label);
  return value;
}
function date(value,label='due date') {
  text(value,10,label);
  ensure(!value||/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&
    new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,'Invalid '+label);
  return value;
}
function array(value,max,label) {
  ensure(Array.isArray(value)&&value.length<=max,'Invalid '+label);return value;
}
function unique(values,label) {
  ensure(new Set(values).size===values.length,'Repeated '+label);
}
function amount(value,label,{integer=false}={}) {
  ensure(value===null||typeof value==='number'&&Number.isFinite(value)&&value>=0&&
    (!integer||Number.isSafeInteger(value)),'Invalid '+label);return value;
}
function reference(value,label='reference') {
  text(value,4096,label);
  if(/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    const u=new URL(value);
    ensure(['https:','http:','urn:'].includes(u.protocol)&&!u.username&&!u.password,
      label+' must use HTTP(S), a URN or a plain original record identifier');
  }
  return value;
}
export function encodeCommissioningBytes(bytes) {
  ensure(bytes instanceof Uint8Array&&bytes.length<=MAX_MATERIAL_BYTES,'Material exceeds its byte limit');
  let binary='';
  for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
}
export function decodeCommissioningBytes(value) {
  ensure(typeof value==='string'&&value.length<=4*Math.ceil(MAX_MATERIAL_BYTES/3)&&
    value.length%4===0&&!/[^A-Za-z0-9+/=]/.test(value),'Invalid material Base64');
  let binary;try{binary=atob(value);}catch{throw commissioningError('INVALID_COMMISSIONING','Invalid material Base64');}
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  ensure(bytes.length<=MAX_MATERIAL_BYTES&&encodeCommissioningBytes(bytes)===value,
    'Material encoding changed');return bytes;
}
export async function commissioningDigest(value) {
  const bytes=typeof value==='string'?TEXT.encode(value):value;
  ensure(bytes instanceof Uint8Array,'Digest input must be original bytes');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
function stable(value) {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
}
function defaultPlan() {return Object.fromEntries(PLAN_FIELDS.map(key=>[key,'']));}
export function newCommissioning() {
  return {schema:COMMISSIONING_SCHEMA,revision:0,plan:defaultPlan(),activeEditionId:null,
    editions:[],tasks:[],materials:[],receiving:[],measurements:[],events:[],blobs:{}};
}
function plan(value) {
  record(value,PLAN_FIELDS,'commissioning plan');
  return Object.fromEntries(PLAN_FIELDS.map(key=>[key,text(value[key]??'',
    ['customerTask','outputDefinition','supportBoundary','notes'].includes(key)?16000:4096,key)]));
}
function blobText(state,digest) {
  const blob=state.blobs[hash(digest)];
  ensure(blob,'Referenced original file is missing');
  return UTF8.decode(decodeCommissioningBytes(blob.data));
}
export function commissioningWorkorder(state,editionId=state.activeEditionId) {
  const edition=state.editions.find(row=>row.id===editionId);
  ensure(edition,'Choose a retained workorder edition');
  const packet=JSON.parse(blobText(state,edition.packet));
  ensure(packet?.schema==='SCF-SF77/merchant-workorder-v1','Unsupported original workorder packet');
  return {edition,packet};
}
function packetShape(packet) {
  ensure(packet&&packet.schema==='SCF-SF77/merchant-workorder-v1','Use an original SF77 workorder');
  text(packet.workOrderRef,120,'workorder reference',{empty:false});
  utc(packet.generatedAt,'workorder generation time');
  ensure(packet.seller&&packet.scope&&packet.baseline&&packet.commercial,'Original workorder is incomplete');
  text(packet.seller.displayName,200,'merchant name',{empty:false});
  text(packet.seller.relationshipOwner,200,'relationship owner',{empty:false});
  hash(packet.baseline.sourceSha256,'original workorder source digest');
  const rows=array(packet.milestones,1000,'original workorder milestones');
  unique(rows.map(row=>id(row.key,'milestone identifier')),'milestone');
  for(const row of rows) {
    text(row.title,2400,'milestone title',{empty:false});
    text(row.acceptance,64000,'milestone acceptance');
    text(row.type,160,'milestone type',{empty:false});
  }
  return packet;
}
function subjectIndexes(state) {return {tasks:new Map(state.tasks.map(row=>[row.id,row])),materials:new Map(state.materials.map(row=>[row.id,row]))};}
function selectedTaskDefinitions(state,taskIds,indexes=subjectIndexes(state)) {
  return taskIds.slice().sort().map(taskId=>{
    const task=indexes.tasks.get(taskId);
    ensure(task,'Receiving task is missing');
    return {id:task.id,title:task.title,acceptance:task.acceptance,dependencies:task.dependencies.slice().sort()};
  });
}
function receivingMaterials(state,materialIds,indexes=subjectIndexes(state)) {
  return materialIds.slice().sort().map(materialId=>{
    const material=indexes.materials.get(materialId);
    ensure(material,'Receiving material is missing');
    return {id:material.id,sha256:material.sha256};
  });
}
function receivingDeliverables(state,editionId,taskIds,materialIds,indexes=subjectIndexes(state)) {
  const tasks=new Set(taskIds),selected=new Set(materialIds.filter(id=>indexes.materials.get(id)?.kind!=='observation'));
  for(const row of state.materials)
    if(row.kind!=='observation'&&(row.editionId===editionId||row.editionId===null)&&
      row.taskIds.some(id=>tasks.has(id)))selected.add(row.id);
  return receivingMaterials(state,[...selected],indexes);
}
function receivingSubject(state,editionId,taskIds,materialIds,indexes=subjectIndexes(state)) {
  return {plan:Object.fromEntries(RECEIVING_PLAN_FIELDS.map(key=>[key,state.plan[key]])),
    tasks:selectedTaskDefinitions(state,taskIds,indexes),materials:receivingMaterials(state,materialIds,indexes),
    deliverables:receivingDeliverables(state,editionId,taskIds,materialIds,indexes)};
}
export function commissioningReceivingMatches(state,row,indexes=subjectIndexes(state)) {
  return stable(row.subject)===stable(receivingSubject(state,row.editionId,row.taskIds,row.materialIds,indexes));
}
export function commissioningSummary(state) {
  const active=state.tasks.filter(row=>!row.retired&&row.status!=='retired');
  const superseded=new Set(state.receiving.map(row=>row.supersedesId).filter(Boolean));
  const latest=new Map(),matches=new Map(),indexes=subjectIndexes(state);
  const order=(a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||
    Date.parse(a.recordedAt)-Date.parse(b.recordedAt);
  for(const row of state.receiving)if(row.editionId===state.activeEditionId&&!superseded.has(row.id))
    for(const taskId of row.taskIds) {
      const key=row.kind+':'+taskId,prior=latest.get(key);
      if(!prior||order(row,prior)>=0)latest.set(key,row);
    }
  const matching=row=>{
    if(!row)return false;
    if(!matches.has(row.id))matches.set(row.id,commissioningReceivingMatches(state,row,indexes));
    return matches.get(row.id);
  };
  const resultFor=(task,kind)=>latest.get(kind+':'+task.id);
  const received=(task,kind,outcome)=>{const row=resultFor(task,kind);return row?.outcome===outcome&&matching(row);};
  return {revision:state.revision,workorders:state.editions.length,tasks:active.length,
    done:active.filter(row=>row.status==='done').length,
    ready:active.filter(row=>row.status==='ready').length,
    accepted:active.filter(row=>received(row,'customer','accepted')).length,
    technicalAccepted:active.filter(row=>received(row,'technical','accepted')).length,
    changesRequired:active.filter(row=>['technical','customer'].some(kind=>received(row,kind,'changes_required'))).length,
    receivingNeedsUpdate:active.filter(task=>['technical','customer'].some(kind=>{
      const row=resultFor(task,kind);return row&&!matching(row);})).length,
    sourceChanges:active.filter(row=>Object.keys(row.proposed).length).length,
    materials:state.materials.length,receiving:state.receiving.length,
    measurements:state.measurements.length,activeEditionId:state.activeEditionId};
}
export async function validateCommissioning(value) {
  if(value===null||value===undefined)return null;
  if(typeof value==='string') {
    text(value,MAX_COMMISSIONING_BYTES,'commissioning file',{empty:false});
    try{value=JSON.parse(value);}catch{throw commissioningError('INVALID_COMMISSIONING','Commissioning file is not JSON');}
  }
  record(value,['schema','revision','plan','activeEditionId','editions','tasks','materials',
    'receiving','measurements','events','blobs'],'commissioning workspace');
  ensure(value.schema===COMMISSIONING_SCHEMA,'Unsupported commissioning format');
  ensure(Number.isSafeInteger(value.revision)&&value.revision>=0,'Invalid commissioning revision');
  const state=copy(value);state.plan=plan(state.plan);
  for(const [key,limit] of Object.entries({editions:256,tasks:2000,materials:2000,
    receiving:4000,measurements:4000,events:8000}))array(state[key],limit,key);
  ensure(state.blobs&&typeof state.blobs==='object'&&!Array.isArray(state.blobs),'Missing original file store');
  const blobs=Object.entries(state.blobs);ensure(blobs.length<=8192,'Too many original files');
  const used=new Set();
  const use=digest=>{hash(digest);ensure(own(state.blobs,digest),'Missing original file '+digest);used.add(digest);};
  for(const [digest,blob] of blobs) {
    hash(digest);record(blob,['bytes','data'],'original file');
    const raw=decodeCommissioningBytes(blob.data);
    ensure(blob.bytes===raw.length&&await commissioningDigest(raw)===digest,'Original file bytes changed');
  }
  unique(state.editions.map(row=>id(row.id)),'workorder edition');
  const editionIds=new Set(state.editions.map(row=>row.id));
  ensure(state.activeEditionId===null||editionIds.has(state.activeEditionId),'Selected workorder edition is missing');
  for(const row of state.editions) {
    record(row,['id','recordedAt','actor','packet','html','checklist','inputs','runtimeMapping','sourceCase','sourceBundle'],'workorder edition');
    utc(row.recordedAt);text(row.actor,200,'operator',{empty:false});
    for(const key of ['packet','html','checklist'])use(row[key]);
    record(row.inputs,INPUTS.filter(key=>key!=='inputs'),'original workorder input references');
    for(const [key,ref] of Object.entries(row.inputs)) {
      if(key==='supportText'&&row.sourceBundle&&!own(state.blobs,ref))hash(ref);
      else use(ref);
    }
    ensure(row.inputs.terms,'The original owner terms are missing');
    const packet=packetShape(JSON.parse(blobText(state,row.packet)));
    if(row.sourceBundle!==undefined) {
      use(row.sourceBundle.manifest);
      await validateImplementationSourceBundle(row.sourceBundle,blobText(state,row.sourceBundle.manifest),{
        packet,termsSha256:row.inputs.terms,sourceCase:row.sourceCase,
        outputs:{packet:row.packet,html:row.html,checklist:row.checklist}});
      if(own(state.blobs,row.inputs.supportText))ensure(state.blobs[row.inputs.supportText].bytes===row.sourceBundle.runtimeBytes,
        'Original runtime size differs from its retained source bundle');
    }
    const sourceRef=packet.sourceKind==='RUNTIME'?row.inputs.supportText:row.inputs.before;
    ensure(sourceRef&&sourceRef===packet.baseline.sourceSha256,'Workorder source does not match its original input');
    if(packet.sourceKind==='RUNTIME') {
      record(row.runtimeMapping,['resource','catalog','origin','network','payTo','method','credentialed'],'saved runtime mapping');
      for(const key of ['resource','catalog','origin','network','payTo','method'])text(row.runtimeMapping[key],2048,'runtime '+key);
      ensure(typeof row.runtimeMapping.credentialed==='boolean','Runtime credential mode is missing');
      ensure(!['before','after','postBefore','postAfter'].some(key=>own(row.inputs,key)),'Runtime edition contains unrelated diagnosis inputs');
    } else ensure(row.runtimeMapping===null&&!row.inputs.supportText,'Diagnostic edition has an unrelated runtime mapping');
    if(row.sourceCase!==null) {
      record(row.sourceCase,['id','revision','workspaceSha256','supportSha256'],'source case reference');
      id(row.sourceCase.id);hash(row.sourceCase.revision);hash(row.sourceCase.workspaceSha256);
      if(row.sourceCase.supportSha256!==null)hash(row.sourceCase.supportSha256);
    }
  }
  unique(state.tasks.map(row=>id(row.id)),'implementation task');
  const taskIds=new Set(state.tasks.map(row=>row.id));
  for(const row of state.tasks) {
    record(row,['id','sourceKey','editionId','title','acceptance','owner','dueOn','status','notes',
      'dependencies','retired','sourceValues','proposed'],'implementation task');
    if(row.sourceKey!==null)id(row.sourceKey,'source milestone');
    ensure(row.editionId===null||editionIds.has(row.editionId),'Task workorder edition is missing');
    text(row.title,2400,'task title',{empty:false});text(row.acceptance,64000,'task acceptance');
    text(row.owner,200,'task owner');date(row.dueOn);text(row.notes,64000,'task notes');
    ensure(TASK_STATUSES.includes(row.status)&&typeof row.retired==='boolean','Invalid task status');
    array(row.dependencies,2000,'task dependencies');unique(row.dependencies,'task dependency');
    ensure(row.dependencies.every(ref=>taskIds.has(ref)&&ref!==row.id),'Task dependency is missing or self-referencing');
    record(row.sourceValues,['title','acceptance','retired'],'original task fields');
    record(row.proposed,['title','acceptance','retired'],'changed source fields');
    for(const item of [row.sourceValues,row.proposed])for(const [key,v] of Object.entries(item)) {
      if(key==='retired')ensure(typeof v==='boolean','Invalid original retirement value');
      else text(v,key==='title'?2400:64000,'source '+key);
    }
  }
  const visiting=new Set(),visited=new Set(),byTask=new Map(state.tasks.map(row=>[row.id,row]));
  function visit(taskId) {
    ensure(!visiting.has(taskId),'Task dependencies form a cycle');
    if(visited.has(taskId))return;
    visiting.add(taskId);for(const other of byTask.get(taskId).dependencies)visit(other);
    visiting.delete(taskId);visited.add(taskId);
  }
  for(const taskId of taskIds)visit(taskId);
  unique(state.materials.map(row=>id(row.id)),'deliverable');
  const materialIds=new Set(state.materials.map(row=>row.id));
  for(const row of state.materials) {
    record(row,['id','name','mediaType','sha256','kind','description','taskIds','editionId',
      'recordedAt','actor','reference','sourceFile'],'deliverable');
    text(row.name,240,'original filename',{empty:false});
    ensure(!/[/\\]/.test(row.name)&&row.name!=='.'&&row.name!=='..','Use the original basename for a file');
    text(row.mediaType,160,'media type',{empty:false});text(row.kind,160,'deliverable kind',{empty:false});
    text(row.description,16000,'deliverable description');reference(row.reference);
    if(row.sourceFile!==undefined) {
      const edition=state.editions.find(edition=>edition.id===row.editionId);
      ensure(edition?.sourceBundle,'The original source-bundle edition is missing');
      const member=validateImplementationSourceFile(row.sourceFile,edition.sourceBundle,
        blobText(state,edition.sourceBundle.manifest),{sha256:row.sha256});
      ensure(row.name===member.path.split('/').at(-1),'Keep the original source filename');
      if(own(state.blobs,row.sha256)) {use(row.sha256);ensure(state.blobs[row.sha256].bytes===member.bytes,'Original material size changed');}
    } else use(row.sha256);
    array(row.taskIds,2000,'deliverable tasks');unique(row.taskIds,'deliverable task');
    ensure(row.taskIds.every(x=>taskIds.has(x)),'Deliverable task is missing');
    ensure(row.editionId===null||editionIds.has(row.editionId),'Deliverable workorder is missing');
    utc(row.recordedAt);text(row.actor,200,'deliverable operator',{empty:false});
  }
  unique(state.receiving.map(row=>id(row.id)),'receiving record');
  const receivingIds=new Set(state.receiving.map(row=>row.id)),superseded=new Set();
  for(const row of state.receiving) {
    record(row,['id','editionId','taskIds','materialIds','outcome','kind','observedAt','recordedAt',
      'actor','reference','notes','supersedesId','subject','subjectSha256'],'receiving record');
    ensure(editionIds.has(row.editionId),'Receiving workorder is missing');
    ensure(['technical','customer'].includes(row.kind)&&RECEIVING_OUTCOMES.includes(row.outcome),'Invalid receiving result');
    array(row.taskIds,2000,'receiving tasks');unique(row.taskIds,'receiving task');
    ensure(row.taskIds.length&&row.taskIds.every(x=>taskIds.has(x)),'Select retained receiving tasks');
    array(row.materialIds,2000,'receiving deliverables');unique(row.materialIds,'receiving deliverable');
    ensure(row.materialIds.every(x=>materialIds.has(x)),'Receiving deliverable is missing');
    utc(row.observedAt);utc(row.recordedAt);text(row.actor,200,'receiving operator',{empty:false});
    record(row.subject,['plan','tasks','materials','deliverables'],'received subject');
    record(row.subject.plan,RECEIVING_PLAN_FIELDS,'received delivery definition');
    for(const key of RECEIVING_PLAN_FIELDS)text(row.subject.plan[key],16000,'received '+key);
    array(row.subject.tasks,2000,'received task definitions');
    unique(row.subject.tasks.map(task=>id(task.id)),'received task definition');
    ensure(stable(row.subject.tasks.map(task=>task.id).sort())===stable(row.taskIds.slice().sort()),'Received task definitions differ from their selected tasks');
    for(const task of row.subject.tasks) {
      record(task,['id','title','acceptance','dependencies'],'received task definition');
      text(task.title,2400,'received task title',{empty:false});text(task.acceptance,64000,'received task acceptance');
      array(task.dependencies,2000,'received task dependencies');unique(task.dependencies,'received dependency');
      ensure(task.dependencies.every(id=>taskIds.has(id)),'Original received dependency is missing');
    }
    for(const key of ['materials','deliverables']) {
      array(row.subject[key],2000,'received '+key);unique(row.subject[key].map(material=>id(material.id)),'received file');
      for(const material of row.subject[key]) {
        record(material,['id','sha256'],'received file');
        ensure(state.materials.some(original=>original.id===material.id&&original.sha256===material.sha256),
          'Received original file identity changed');
      }
    }
    ensure(stable(row.subject.materials)===stable(receivingMaterials(state,row.materialIds)),
      'Received original files differ from their selected references');
    hash(row.subjectSha256);
    ensure(await commissioningDigest(stable(row.subject))===row.subjectSha256,'Received subject bytes changed');
    reference(row.reference);text(row.notes,64000,'receiving observation');
    ensure(!['accepted','changes_required'].includes(row.outcome)||row.notes.trim()||row.materialIds.length||row.reference.trim(),
      'Record the observed result, original deliverable or receiving reference');
    if(row.supersedesId!==null) {
      ensure(receivingIds.has(row.supersedesId)&&row.supersedesId!==row.id&&!superseded.has(row.supersedesId),
        'Correction must identify one earlier receiving record');
      const prior=state.receiving.find(x=>x.id===row.supersedesId);
      ensure(prior.editionId===row.editionId&&prior.kind===row.kind&&state.receiving.indexOf(prior)<state.receiving.indexOf(row)&&
        stable(prior.subject.plan)===stable(row.subject.plan)&&stable(prior.subject.tasks)===stable(row.subject.tasks)&&
        stable(prior.subject.deliverables)===stable(row.subject.deliverables),
        'Correction must keep the original workorder and receiving kind');
      superseded.add(row.supersedesId);
    }
  }
  unique(state.measurements.map(row=>id(row.id)),'task measurement');
  const correctedMeasurements=new Set();
  for(const row of state.measurements) {
    record(row,['id','editionId','phase','taskDefinition','comparisonKey','inputDescription','outputDescription',
      'unit','units','activeMinutes','elapsedMinutes','manualCorrections','observedAt','recordedAt',
      'actor','materialIds','reference','notes','supersedesId'],'task measurement');
    ensure(editionIds.has(row.editionId),'Measurement workorder is missing');
    ensure(['baseline','installed','recurring'].includes(row.phase),'Invalid measurement phase');
    for(const key of ['taskDefinition','comparisonKey','inputDescription','outputDescription','unit'])
      text(row[key],key==='taskDefinition'?16000:4096,key,{empty:['taskDefinition','comparisonKey'].includes(key)?false:true});
    for(const key of ['units','activeMinutes','elapsedMinutes'])amount(row[key],key);
    amount(row.manualCorrections,'manual corrections',{integer:true});
    ensure(row.activeMinutes!==null||row.elapsedMinutes!==null||row.manualCorrections!==null||row.units!==null,
      'Enter an actual measured value');
    utc(row.observedAt);utc(row.recordedAt);text(row.actor,200,'measuring operator',{empty:false});
    array(row.materialIds,2000,'measurement sources');unique(row.materialIds,'measurement source');
    ensure(row.materialIds.every(x=>materialIds.has(x)),'Measurement source is missing');
    reference(row.reference);text(row.notes,64000,'measurement notes');
    if(row.supersedesId!==null) {
      const prior=state.measurements.find(x=>x.id===row.supersedesId);
      ensure(prior&&state.measurements.indexOf(prior)<state.measurements.indexOf(row)&&
        prior.editionId===row.editionId&&prior.phase===row.phase&&prior.comparisonKey===row.comparisonKey&&
        !correctedMeasurements.has(prior.id),'Correction must retain its original measurement');
      correctedMeasurements.add(prior.id);
    }
  }
  unique(state.events.map(row=>id(row.id)),'commissioning operation');
  for(const row of state.events) {
    record(row,['id','type','recordedAt','actor','requestSha256','result'],'commissioning operation');
    text(row.type,160,'operation type',{empty:false});utc(row.recordedAt);
    text(row.actor,200,'operator',{empty:false});hash(row.requestSha256);
    ensure(row.result&&typeof row.result==='object'&&!Array.isArray(row.result),'Operation result is missing');
  }
  ensure(used.size===blobs.length,'Commissioning contains an unreferenced original file');
  ensure(TEXT.encode(JSON.stringify(state)).length<=MAX_COMMISSIONING_BYTES,'Commissioning workspace exceeds its file size limit');
  return state;
}


function request(value) {
  record(value,['type','requestId','expectedRevision','actor','payload','recordedAt'],'commissioning request');
  id(value.requestId,'request identifier');text(value.type,160,'operation type',{empty:false});
  text(value.actor,200,'operator',{empty:false});
  ensure(Number.isSafeInteger(value.expectedRevision)&&value.expectedRevision>=0,'Use the current implementation revision');
  ensure(value.payload&&typeof value.payload==='object'&&!Array.isArray(value.payload),'Supply the original operation payload');
  if(value.recordedAt!==undefined)utc(value.recordedAt);
  return value;
}
function addBlob(state,bytes) {
  return commissioningDigest(bytes).then(sha256=>{
    const data=encodeCommissioningBytes(bytes);
    if(own(state.blobs,sha256))ensure(state.blobs[sha256].data===data,'Original file digest collision');
    else state.blobs[sha256]={bytes:bytes.length,data};
    return sha256;
  });
}
function inputBytes(value,key) {
  if(key==='supportText') {
    text(value,MAX_MATERIAL_BYTES,'original runtime support',{empty:false});
    return TEXT.encode(value);
  }
  return decodeCommissioningBytes(value);
}
function taskTemplate({id,sourceKey=null,editionId=null,title,acceptance='',owner=''}) {
  return {id,sourceKey,editionId,title,acceptance,owner,dueOn:'',status:'planned',notes:'',
    dependencies:[],retired:false,sourceValues:{},proposed:{}};
}
function sourceTaskKey(packet,milestone) {
  return packet.workOrderRef+'\u001f'+milestone.key;
}
async function taskIdFor(packet,milestone) {
  return 'source-'+(await commissioningDigest(sourceTaskKey(packet,milestone))).slice(0,32);
}
function setSourceField(task,key,value) {
  const previous=task.sourceValues[key];
  if(!own(task.sourceValues,key)||task[key]===previous) {task[key]=value;delete task.proposed[key];}
  else if(task[key]!==value)task.proposed[key]=value;
  else delete task.proposed[key];
  task.sourceValues[key]=value;
}
async function useEdition(state,editionId) {
  const {packet}=commissioningWorkorder(state,editionId), selected=new Set(), added=[], changed=[];
  for(const milestone of packet.milestones) {
    const taskId=await taskIdFor(packet,milestone);selected.add(taskId);
    let task=state.tasks.find(row=>row.id===taskId);
    if(!task) {
      task=taskTemplate({id:taskId,sourceKey:milestone.key,editionId,
        title:milestone.title,acceptance:milestone.acceptance});
      state.tasks.push(task);added.push(taskId);
    }
    ensure(task.sourceKey===milestone.key,'Source task identity conflicts with an existing task');
    const before=stable(task);
    for(const [key,value] of Object.entries({title:milestone.title,acceptance:milestone.acceptance,retired:false}))
      setSourceField(task,key,value);
    task.editionId=editionId;
    if(before!==stable(task)&&!added.includes(taskId))changed.push(taskId);
  }
  const removed=[];
  for(const task of state.tasks)if(task.sourceKey!==null&&!selected.has(task.id)) {
    // Removal changes the source proposal. Work, notes and receiving remain available.
    if(!task.retired){task.proposed.retired=true;removed.push(task.id);}
    task.sourceValues.retired=true;
  }
  state.activeEditionId=editionId;
  if(!state.plan.title)state.plan.title=packet.workOrderRef+' · '+packet.seller.displayName;
  if(!state.plan.merchant)state.plan.merchant=packet.seller.displayName;
  if(!state.plan.implementationOwner)state.plan.implementationOwner=packet.seller.relationshipOwner;
  if(!state.plan.customerTask)state.plan.customerTask=packet.delivery?.scope??'';
  if(!state.plan.outputDefinition)state.plan.outputDefinition=packet.delivery?.deliverables??'';
  if(!state.plan.merchantHost)state.plan.merchantHost=packet.scope.resource??'';
  if(!state.plan.buyerApplication)state.plan.buyerApplication=packet.scope.buyerOrigin??'';
  if(!state.plan.commercialReference)state.plan.commercialReference=packet.commercial.ownerReceipt??'';
  return {editionId,added,changed,removed,sourceChanges:state.tasks.filter(row=>Object.keys(row.proposed).length).map(row=>row.id)};
}
export async function previewCommissioningWorkorder(value,result) {
  const state=await validateCommissioning(value)??newCommissioning();
  record(result,['packet','html','checklist'],'original workorder result');
  const packet=packetShape(result.packet), next=new Map(), previous=new Map();
  for(const milestone of packet.milestones)next.set(await taskIdFor(packet,milestone),milestone);
  for(const row of state.tasks.filter(task=>task.sourceKey!==null))previous.set(row.id,row);
  let current=null;if(state.activeEditionId)current=commissioningWorkorder(state).packet;
  return {
    workOrderRef:packet.workOrderRef,sourceSha256:packet.baseline.sourceSha256,
    scopeChanges:current?Object.keys({...current.scope,...packet.scope}).filter(key=>
      stable(current.scope[key])!==stable(packet.scope[key])).map(key=>({field:key,from:current.scope[key]??null,to:packet.scope[key]??null})):[],
    newTasks:[...next].filter(([key])=>!previous.has(key)).map(([id,row])=>({id,title:row.title})),
    changedTasks:[...next].filter(([key,row])=>previous.has(key)&&
      (previous.get(key).sourceValues.title!==row.title||previous.get(key).sourceValues.acceptance!==row.acceptance))
      .map(([id,row])=>({id,title:row.title,operatorEditsPreserved:
        ['title','acceptance'].filter(key=>previous.get(id)[key]!==previous.get(id).sourceValues[key])})),
    removedTasks:[...previous].filter(([key,row])=>!next.has(key)&&!row.retired).map(([id,row])=>({id,title:row.title})),
    recordedEdition:state.editions.find(row=>blobText(state,row.packet)===JSON.stringify(packet,null,2)+'\n')?.id??null,
  };
}
async function recordWorkorder(state,payload,context) {
  record(payload,['result','inputs','sourceCase','sourceBundle'],'workorder receiving payload');
  record(payload.result,['packet','html','checklist'],'original workorder result');
  const packet=packetShape(payload.result.packet);
  text(payload.result.html,MAX_MATERIAL_BYTES,'original workorder HTML',{empty:false});
  text(payload.result.checklist,MAX_MATERIAL_BYTES,'original acceptance checklist',{empty:false});
  record(payload.inputs,INPUTS,'original workorder inputs');
  ensure(payload.inputs.terms,'Keep the original workorder terms input');
  const refs={};
  for(const key of INPUTS.filter(key=>key!=='inputs'))if(own(payload.inputs,key)) {
    const bytes=inputBytes(payload.inputs[key],key);
    refs[key]=await addBlob(state,bytes);
  }
  const packetSha=await addBlob(state,TEXT.encode(JSON.stringify(packet,null,2)+'\n'));
  const html=await addBlob(state,TEXT.encode(payload.result.html));
  const checklist=await addBlob(state,TEXT.encode(payload.result.checklist));
  let sourceBundle;
  if(payload.sourceBundle!==undefined) {
    record(payload.sourceBundle,['manifestText','runtimeBytes'],'original source-bundle input');
    sourceBundle=await createImplementationSourceBundle({...payload.sourceBundle,packet,
      termsSha256:refs.terms,sourceCase:payload.sourceCase??null,outputs:{packet:packetSha,html,checklist}});
    await addBlob(state,TEXT.encode(payload.sourceBundle.manifestText));
    const runtimeSha256=packet.runtimeSource.supportSha256;
    if(refs.supportText)ensure(refs.supportText===runtimeSha256,'Original runtime differs from the selected bundle');
    refs.supportText=runtimeSha256;
  }
  const editionId='edition-'+(sourceBundle?.manifestSha256??packetSha).slice(0,32);
  const existing=state.editions.find(row=>row.id===editionId);
  const immutable={packet:packetSha,html,checklist,inputs:refs,
    runtimeMapping:packet.sourceKind==='RUNTIME'?copy(payload.inputs.inputs):null,
    sourceCase:payload.sourceCase??null,...(sourceBundle?{sourceBundle}:{})};
  if(existing) {
    ensure(Object.keys(immutable).every(key=>stable(existing[key])===stable(immutable[key])),
      'This workorder packet is already retained with different original inputs','EDITION_CONFLICT');
  } else state.editions.push({id:editionId,recordedAt:context.recordedAt,actor:context.actor,...immutable});
  const applied=await useEdition(state,editionId);
  return {...applied,retained:Boolean(existing),packetSha256:packetSha};
}
const TASK_EDIT_FIELDS=['title','acceptance','owner','dueOn','status','notes','dependencies','retired'];
function taskChanges(state,payload,context) {
  record(payload,['tasks'],'task changes');array(payload.tasks,2000,'task changes');
  unique(payload.tasks.map(row=>id(row.id)),'edited task');
  const changed=[];
  for(const patch of payload.tasks) {
    record(patch,['id',...TASK_EDIT_FIELDS],'task change');
    let task=state.tasks.find(row=>row.id===patch.id);
    if(!task) {
      ensure(!patch.id.startsWith('source-'),'Use a distinct identifier for an operator-created task');
      task=taskTemplate({id:patch.id,title:patch.title,owner:context.actor});
      state.tasks.push(task);
    }
    for(const key of TASK_EDIT_FIELDS)if(own(patch,key))task[key]=copy(patch[key]);
    changed.push(task.id);
  }
  return {taskIds:changed};
}
function acceptChanges(state,payload) {
  record(payload,['changes'],'source field choices');array(payload.changes,6000,'source choices');
  unique(payload.changes.map(row=>row.taskId+':'+row.field),'source field choice');
  const adopted=[];
  for(const choice of payload.changes) {
    record(choice,['taskId','field'],'source field choice');
    const task=state.tasks.find(row=>row.id===choice.taskId);
    ensure(task&&['title','acceptance','retired'].includes(choice.field)&&own(task.proposed,choice.field),
      'That source change is no longer pending','SOURCE_CHANGE_CONFLICT');
    task[choice.field]=task.proposed[choice.field];delete task.proposed[choice.field];
    adopted.push({taskId:task.id,field:choice.field});
  }
  return {adopted};
}
async function addMaterial(state,payload,context) {
  record(payload,['id','name','mediaType','data','kind','description','taskIds','editionId','reference','sourceFile'],'deliverable payload');
  id(payload.id);ensure(!state.materials.some(row=>row.id===payload.id),'Deliverable identifier already exists','MATERIAL_CONFLICT');
  const editionId=payload.editionId??state.activeEditionId;
  let sha256,bytes,name=payload.name,sourceFile;
  if(payload.sourceFile!==undefined) {
    ensure(payload.data===undefined,'Choose the original bundle file or supplied file bytes');
    const edition=state.editions.find(row=>row.id===editionId);
    ensure(edition?.sourceBundle,'Choose a retained source-bundle workorder');
    const member=validateImplementationSourceFile(payload.sourceFile,edition.sourceBundle,
      blobText(state,edition.sourceBundle.manifest));
    name=member.path.split('/').at(-1);
    ensure(payload.name===undefined||payload.name===name,'Keep the original source filename');
    sha256=member.sha256;bytes=member.bytes;sourceFile=member.sourceFile;
  } else {
    const original=decodeCommissioningBytes(payload.data);sha256=await addBlob(state,original);bytes=original.length;
  }
  const row={id:payload.id,name,mediaType:payload.mediaType||'application/octet-stream',
    sha256,kind:payload.kind||'deliverable',description:payload.description??'',taskIds:payload.taskIds??[],
    editionId,recordedAt:context.recordedAt,actor:context.actor,
    reference:payload.reference??'',...(sourceFile?{sourceFile}:{})};
  state.materials.push(row);return {materialId:row.id,sha256,bytes};
}
async function receive(state,payload,context) {
  record(payload,['id','editionId','taskIds','materialIds','outcome','kind','observedAt','reference','notes','supersedesId'],'receiving payload');
  const row={id:payload.id,editionId:payload.editionId??state.activeEditionId,taskIds:payload.taskIds??[],
    materialIds:payload.materialIds??[],outcome:payload.outcome,kind:payload.kind,observedAt:payload.observedAt,
    recordedAt:context.recordedAt,actor:context.actor,reference:payload.reference??'',notes:payload.notes??'',
    supersedesId:payload.supersedesId??null};
  if(row.supersedesId) {
    const prior=state.receiving.find(record=>record.id===row.supersedesId);
    ensure(prior&&stable(prior.taskIds.slice().sort())===stable(row.taskIds.slice().sort()),
      'A correction keeps the original received tasks. Record a new observation for different work.');
    row.subject={...copy(prior.subject),materials:receivingMaterials(state,row.materialIds)};
  } else row.subject=receivingSubject(state,row.editionId,row.taskIds,row.materialIds);
  row.subjectSha256=await commissioningDigest(stable(row.subject));
  state.receiving.push(row);return {receivingId:row.id,outcome:row.outcome,kind:row.kind,subjectSha256:row.subjectSha256};
}
function measure(state,payload,context) {
  record(payload,['id','editionId','phase','taskDefinition','comparisonKey','inputDescription','outputDescription',
    'unit','units','activeMinutes','elapsedMinutes','manualCorrections','observedAt','materialIds','reference','notes','supersedesId'],'measurement payload');
  const row={id:payload.id,editionId:payload.editionId??state.activeEditionId,phase:payload.phase,
    taskDefinition:payload.taskDefinition,comparisonKey:payload.comparisonKey,
    inputDescription:payload.inputDescription??'',outputDescription:payload.outputDescription??'',
    unit:payload.unit??'',units:payload.units??null,activeMinutes:payload.activeMinutes??null,
    elapsedMinutes:payload.elapsedMinutes??null,manualCorrections:payload.manualCorrections??null,
    observedAt:payload.observedAt,recordedAt:context.recordedAt,actor:context.actor,materialIds:payload.materialIds??[],
    reference:payload.reference??'',notes:payload.notes??'',supersedesId:payload.supersedesId??null};
  state.measurements.push(row);return {measurementId:row.id,phase:row.phase};
}
/** Compute a complete next case value. The caller saves it through the original case CAS. */
export async function applyCommissioningCommand(value,command) {
  request(command);
  const state=await validateCommissioning(value)??newCommissioning();
  // Expected revisions do not change the identity of the original operation. A
  // lost-response recovery finds its event before checking the current revision.
  const requestSha256=await commissioningDigest(stable({type:command.type,actor:command.actor,
    payload:command.payload,...(command.recordedAt?{recordedAt:command.recordedAt}:{})}));
  const retained=state.events.find(row=>row.id===command.requestId);
  if(retained) {
    ensure(retained.requestSha256===requestSha256,'This request identifier belongs to different original bytes','REQUEST_CONFLICT');
    return {state,result:copy(retained.result),replayed:true,revision:state.revision};
  }
  if(command.expectedRevision!==state.revision)
    throw Object.assign(commissioningError('COMMISSIONING_CONFLICT','A newer implementation revision exists. Reload the saved case before applying this change.',409),{currentRevision:state.revision});
  const context={actor:command.actor,recordedAt:command.recordedAt??new Date().toISOString()};
  let result;
  switch(command.type) {
    case 'record_workorder':result=await recordWorkorder(state,command.payload,context);break;
    case 'select_workorder':
      record(command.payload,['editionId'],'workorder selection');
      result=await useEdition(state,command.payload.editionId);break;
    case 'update_plan':
      record(command.payload,PLAN_FIELDS,'plan changes');
      state.plan=plan({...state.plan,...command.payload});result={fields:Object.keys(command.payload)};break;
    case 'save_tasks':result=taskChanges(state,command.payload,context);break;
    case 'accept_source_changes':result=acceptChanges(state,command.payload);break;
    case 'add_material':result=await addMaterial(state,command.payload,context);break;
    case 'record_receiving':result=await receive(state,command.payload,context);break;
    case 'record_measurement':result=measure(state,command.payload,context);break;
    default:throw commissioningError('UNKNOWN_COMMISSIONING_OPERATION','Unknown implementation operation');
  }
  state.revision++;
  state.events.push({id:command.requestId,type:command.type,...context,requestSha256,result:copy(result)});
  await validateCommissioning(state);
  return {state,result,replayed:false,revision:state.revision};
}
function unionImmutable(earlier,later,label) {
  const map=new Map(earlier.map(row=>[row.id,copy(row)]));
  for(const row of later) {
    if(map.has(row.id))ensure(stable(map.get(row.id))===stable(row),
      'Restored '+label+' conflicts with retained original '+row.id,'HISTORY_CONFLICT');
    else map.set(row.id,copy(row));
  }
  return [...map.values()];
}
/** Historical saves and old clients retain later source and receiving history. */
export async function mergeCommissioningHistory(restored,current) {
  const before=await validateCommissioning(restored),after=await validateCommissioning(current);
  if(!after)return before;
  if(!before)return after;
  const next=copy(before);
  next.editions=unionImmutable(before.editions,after.editions,'workorder edition');
  next.materials=unionImmutable(before.materials,after.materials,'deliverable');
  next.receiving=unionImmutable(before.receiving,after.receiving,'receiving record');
  next.measurements=unionImmutable(before.measurements,after.measurements,'measurement');
  next.events=unionImmutable(before.events,after.events,'operation');
  for(const [sha,blob] of Object.entries(after.blobs)) {
    if(own(next.blobs,sha))ensure(stable(next.blobs[sha])===stable(blob),'Restored original file differs','HISTORY_CONFLICT');
    else next.blobs[sha]=copy(blob);
  }
  const ids=new Set(next.tasks.map(row=>row.id));
  for(const task of after.tasks)if(!ids.has(task.id)) {
    next.tasks.push({...copy(task),retired:true});ids.add(task.id);
  }
  const filledHistory=['editions','materials','receiving','measurements','events'].some(key=>next[key].length!==before[key].length)||next.tasks.length!==before.tasks.length;
  if(!filledHistory&&before.revision>after.revision)return before;
  next.revision=Math.max(before.revision,after.revision);
  // Historical restoration creates a new implementation revision. An ordinary
  // next command already owns its revision and is returned unchanged above.
  if(stable({...next,revision:0})!==stable({...after,revision:0}))next.revision++;
  return validateCommissioning(next);
}
export function commissioningComparisons(state) {
  const superseded=new Set(state.measurements.map(row=>row.supersedesId).filter(Boolean));
  const active=state.measurements.filter(row=>!superseded.has(row.id));
  const result=[];
  for(const observed of active.filter(row=>row.phase!=='baseline')) {
    const baseline=active.filter(row=>row.phase==='baseline'&&row.comparisonKey===observed.comparisonKey&&
      row.taskDefinition===observed.taskDefinition&&row.unit===observed.unit&&
      row.outputDescription===observed.outputDescription&&Date.parse(row.observedAt)<=Date.parse(observed.observedAt))
      .sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.id.localeCompare(b.id)).at(-1);
    if(!baseline) {result.push({measurementId:observed.id,baselineId:null,comparable:false,reason:'No earlier baseline with the same task, output definition and unit'});continue;}
    const values={};
    for(const key of ['units','activeMinutes','elapsedMinutes','manualCorrections']) {
      const a=baseline[key],b=observed[key];
      values[key]=a===null||b===null?null:{baseline:a,observed:b,delta:b-a,
        percent:a===0?null:100*(b-a)/a};
    }
    // Different volumes retain raw totals and an explicit per-unit comparison.
    const perUnit={};
    if(baseline.units>0&&observed.units>0)for(const key of ['activeMinutes','elapsedMinutes','manualCorrections'])
      if(baseline[key]!==null&&observed[key]!==null) {
        const a=baseline[key]/baseline.units,b=observed[key]/observed.units;
        perUnit[key]={baseline:a,observed:b,delta:b-a,percent:a===0?null:100*(b-a)/a};
      }
    result.push({measurementId:observed.id,baselineId:baseline.id,comparable:true,
      sameVolume:baseline.units===observed.units,values,perUnit});
  }
  return result;
}
/** Every retained native bundle travels with the complete case, including
 * historical editions and original attachments not assigned to a task. */
export function commissioningSourceBundles(state) {
  const bundles=new Map();
  for(const edition of state.editions) {
    const reference=edition.sourceBundle;if(!reference)continue;
    const manifestText=blobText(state,reference.manifest);
    const original=JSON.parse(manifestText),key=reference.manifestSha256;
    const retained=bundles.get(key);
    if(retained) {
      ensure(retained.bundleId===reference.bundleId&&retained.manifestText===manifestText,
        'Retained source bundle identity changed');
      retained.editionIds.push(edition.id);continue;
    }
    const members=[...original.files.map(file=>file.path),'manifest.json'];
    bundles.set(key,{bundleId:reference.bundleId,manifestSha256:key,manifestText,
      editionIds:[edition.id],files:members.map(path=>implementationSourceMember(reference,manifestText,path))});
  }
  return [...bundles.values()];
}
export function commissioningOriginalFiles(state) {
  const files=[];
  for(const edition of state.editions) {
    for(const [key,name] of [['packet','packet.json'],['html','seller-packet.html'],['checklist','acceptance-checklist.md']])
      files.push({name:edition.id+'/'+name,sha256:edition[key],bytes:state.blobs[edition[key]].bytes});
    for(const [key,sha256] of Object.entries(edition.inputs)) {
      const retained=state.blobs[sha256];
      if(retained)files.push({name:edition.id+'/input-'+key+'.json',sha256,bytes:retained.bytes});
      else ensure(key==='supportText'&&edition.sourceBundle,
        'Original workorder input is missing');
    }
  }
  for(const row of state.materials) {
    const retained=state.blobs[row.sha256];
    if(retained)files.push({name:'materials/'+row.id+'/'+row.name,sha256:row.sha256,bytes:retained.bytes});
    else {
      const edition=state.editions.find(edition=>edition.id===row.editionId);
      ensure(edition?.sourceBundle&&row.sourceFile,'Original material source is missing');
      validateImplementationSourceFile(row.sourceFile,edition.sourceBundle,
        blobText(state,edition.sourceBundle.manifest),{sha256:row.sha256});
    }
  }
  // One complete named inventory per immutable native manifest. Material links
  // and contained runtime inputs point to these files instead of copying large
  // originals repeatedly or labeling a whole handoff as an extracted runtime.
  for(const bundle of commissioningSourceBundles(state))for(const file of bundle.files)
    files.push({name:'source-bundles/'+bundle.manifestSha256+'/'+file.path,
      sha256:file.sha256,bytes:file.bytes,role:file.role,sourceFile:copy(file.sourceFile)});
  return files;
}
export function commissioningFileBytes(state,sha256) {
  const blob=state.blobs[hash(sha256)];
  if(!blob) {
    let original=commissioningOriginalFiles(state).find(file=>file.sha256===sha256&&file.sourceFile);
    if(!original) {
      const edition=state.editions.find(row=>row.sourceBundle&&row.inputs.supportText===sha256);
      if(edition) {
        const member=implementationSourceMember(edition.sourceBundle,
          blobText(state,edition.sourceBundle.manifest),'originals/support.json');
        original={name:'source-bundles/'+edition.sourceBundle.manifestSha256+'/originals/support.json',
          ...member,containedRuntime:{sha256,bytes:edition.sourceBundle.runtimeBytes}};
      }
    }
    if(original)throw Object.assign(commissioningError('ORIGINAL_SOURCE_FILE_EXTERNAL',
      'Open the original source bundle to read this file'),{original});
    throw commissioningError('ORIGINAL_FILE_MISSING','Original file is missing');
  }
  return decodeCommissioningBytes(blob.data);
}
/** Exact native members available for implementation tasks and receiving. */
export function commissioningSourceFiles(state,editionId=state.activeEditionId) {
  const bundle=commissioningSourceBundles(state).find(row=>row.editionIds.includes(editionId));
  return bundle?bundle.files.map(file=>({...copy(file),editionId})):[];
}
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=value=>String(value??'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ');
const csv=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
export function commissioningTasksCsv(state) {
  // A leading apostrophe protects spreadsheet users from formula interpretation.
  const cell=value=>csv(/^[=+\-@\t\r]/.test(String(value??''))?"'"+value:value);
  const fields=['id','title','acceptance','owner','dueOn','status','retired','dependencies','notes','editionId'];
  return [fields.map(csv).join(','),...state.tasks.map(row=>fields.map(key=>cell(Array.isArray(row[key])?row[key].join(' | '):row[key])).join(','))].join('\r\n')+'\r\n';
}
export function commissioningReport(state) {
  const table=(heads,rows)=>'<div class="table"><table><thead><tr>'+heads.map(x=>'<th>'+html(x)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+html(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  const section=(heading,body)=>'<section><h2>'+html(heading)+'</h2>'+body+'</section>';
  const details=state.editions.map(row=>{const p=commissioningWorkorder(state,row.id).packet;
    return [row.id,p.workOrderRef,p.scope.intendedRetryMethod+' '+(p.scope.resource??''),p.generatedAt,row.actor,row.packet];});
  const comparisons=commissioningComparisons(state),s=commissioningSummary(state);
  const content=section('Implementation',table(['Field','Value'],PLAN_FIELDS.filter(key=>state.plan[key]).map(key=>[label(key),state.plan[key]])))+
    section('Progress',table(['Active tasks','Done','Technical receiving accepted','Customer receiving accepted','Changes requested','Receiving needs updating'],
      [[s.tasks,s.done,s.technicalAccepted,s.accepted,s.changesRequired,s.receivingNeedsUpdate]]))+
    section('Work',table(['Task','Acceptance','Owner','Due','Status','Dependencies','Notes','Source changes'],
      state.tasks.map(row=>[row.title,row.acceptance,row.owner,row.dueOn,row.retired?'retired':label(row.status),
        row.dependencies.map(id=>state.tasks.find(t=>t.id===id)?.title??id).join('\n'),row.notes,
        Object.entries(row.proposed).map(([key,value])=>label(key)+': '+value).join('\n')])))+
    section('Original workorders',table(['Edition','Workorder','Scope','Generated','Recorded by','Packet SHA-256'],details))+
    section('Deliverables',table(['File','Kind','Tasks','Recorded by','Original reference','SHA-256'],
      state.materials.map(row=>[row.name,row.kind,row.taskIds.join('\n'),row.actor,row.reference,row.sha256])))+
    section('Receiving history',table(['Observed','Kind','Result','Tasks','Operator','Reference','Observation','Corrects','Current subject','Subject SHA-256'],
      state.receiving.map(row=>[row.observedAt,row.kind,label(row.outcome),row.taskIds.join('\n'),row.actor,row.reference,row.notes,row.supersedesId??'',commissioningReceivingMatches(state,row)?'Matches':'Definition or delivery files changed',row.subjectSha256])))+
    section('Task measurements',table(['Observed','Phase','Task / comparison','Inputs','Output','Unit / quantity','Active minutes','Elapsed minutes','Manual corrections','Operator / reference'],
      state.measurements.map(row=>[row.observedAt,row.phase,row.taskDefinition+'\n'+row.comparisonKey,
        row.inputDescription,row.outputDescription,row.unit+' / '+(row.units??''),row.activeMinutes,
        row.elapsedMinutes,row.manualCorrections,row.actor+'\n'+row.reference])))+
    section('Measured comparisons',table(['Measurement','Baseline','Comparison'],comparisons.map(row=>[
      row.measurementId,row.baselineId??'',row.comparable?JSON.stringify({sameVolume:row.sameVolume,totals:row.values,perUnit:row.perUnit},null,2):row.reason])))+
    section('Original files',table(['File','Bytes','SHA-256'],commissioningOriginalFiles(state).map(row=>[row.name,row.bytes,row.sha256])));
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+html(state.plan.title||'Merchant implementation')+'</title><style>'+
    'body{margin:0;color:#202020;background:#fff;font:15px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:32px}h1{font-size:28px}h2{font-size:20px}section{margin:28px 0}.table{overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:9px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}small{color:#555}@media print{main{max-width:none;padding:0}tr{break-inside:avoid}thead{display:table-header-group}}'+
    '</style></head><body><main><h1>'+html(state.plan.title||'Merchant implementation')+'</h1><small>Saved implementation revision '+
    html(state.revision)+' · selected edition '+html(state.activeEditionId??'none')+'</small>'+content+'</main></body></html>\n';
}
