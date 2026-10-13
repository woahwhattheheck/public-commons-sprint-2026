// MIT. Merchant file transport over the original Grant procedure lifecycle.
import {createHash} from 'node:crypto';
import {lstat,readdir} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {
  readProcedureFile,retainProcedureFile,saveGrantProcedureNative,exportGrantProcedureNative,
  receiveGrantProcedureNative,reopenGrantProcedureNative,inspectGrantProcedureDelivery,
} from '../../stellar/scf_2026/sf47_budget_model/workspace/grant_procedures_native.mjs';
import {
  inspectGrantProcedure,GRANT_PROCEDURE_SCHEMA,GRANT_PROCEDURE_MAX_BYTES,
} from '../../stellar/scf_2026/sf47_budget_model/workspace/grant_procedures.mjs';

export const GRANT_PROCEDURE_AGENT_REQUEST = 'stellar-forge.grant-procedure-agent-request.v1';
export const GRANT_PROCEDURE_AGENT_RESULT = 'stellar-forge.grant-procedure-agent-result.v1';
export const grantProcedureVerbs = new Set([
  'procedure_save','procedure_export','procedure_receive','procedure_open','procedure_inspect','procedure_list',
]);
const OPERATIONS = ['save','export','receive'];
const MAX_RECORD = 48*1024*1024, MAX_BUNDLE = 32*1024*1024, MAX_REQUEST = 2*1024*1024;
const plain = value => value!==null && typeof value==='object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => value===null || typeof value!=='object' ? JSON.stringify(value)
  : Array.isArray(value) ? '['+value.map(canonical).join(',')+']'
  : '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const decode = bytes => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
const same = (a,b) => canonical(a)===canonical(b);
function need(ok,code,message) {if(!ok)throw Object.assign(new Error(message),{code});}
function exact(value,keys,label) {
  need(plain(value)&&Object.keys(value).every(key=>keys.includes(key)),
    'GRANT_PROCEDURE_INPUT','Use the declared '+label+' fields.');
}
function requestId(value) {
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value),
    'GRANT_PROCEDURE_REQUEST','Select the original stable procedure request ID.');
  return value;
}
function nativeId(value,prefix) {
  need(typeof value==='string'&&new RegExp('^'+prefix+'-[a-f0-9]{32}$').test(value),
    'GRANT_PROCEDURE_SELECTION','Select the original '+prefix+' identifier.');
  return value;
}
function digest(value) {
  need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),
    'GRANT_PROCEDURE_INPUT','Keep the complete original file SHA256.');
  return value;
}
function fileName(value) {
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(value),
    'GRANT_PROCEDURE_DELIVERY','Keep each original plain delivery filename.');
  return value;
}
function reference(value) {
  exact(value,['hostInput','snapshotId','transferId','sourceWorkspace'],'original input reference');
  need(['hostInput','snapshotId','transferId'].filter(key=>value[key]!==undefined).length===1,
    'GRANT_PROCEDURE_INPUT','Select one complete original host file, retained snapshot or committed transfer.');
  return copy(value);
}
function inputFile(value) {
  exact(value,['input','expectedInputSha256'],'original file selection');
  return {input:reference(value.input),expectedInputSha256:digest(value.expectedInputSha256)};
}
function selection(operation,args) {
  let value;
  if(operation==='save') value=inputFile({input:args.input,expectedInputSha256:args.expectedInputSha256});
  else if(operation==='export') {
    need(Number.isSafeInteger(args.expectedVersion)&&args.expectedVersion>0&&args.expectedVersion<=10000000,
      'GRANT_PROCEDURE_SELECTION','Select the reviewed current case version.');
    value={caseId:nativeId(args.caseId,'operation'),sourceId:nativeId(args.sourceId,'source'),
      expectedVersion:args.expectedVersion};
  } else {
    exact(args.delivery,['manifest','files'],'complete delivery selection');
    need(Array.isArray(args.delivery.files)&&args.delivery.files.length>0&&args.delivery.files.length<=100,
      'GRANT_PROCEDURE_DELIVERY','Select every original delivery member, up to the native 100-member bound.');
    const names=new Set();
    const files=args.delivery.files.map(file=>{
      exact(file,['name','input','expectedInputSha256'],'delivery member');
      const name=fileName(file.name);
      need(name!=='DELIVERY.json'&&!names.has(name),'GRANT_PROCEDURE_DELIVERY',
        'Select each original member once; the original manifest has its own reference.');
      names.add(name);return {name,...inputFile({input:file.input,expectedInputSha256:file.expectedInputSha256})};
    });
    for(const field of ['name','actor'])need(typeof args[field]==='string'&&args[field].trim()&&args[field].length<=300,
      'GRANT_PROCEDURE_RECEIVING','Name the original receiving case and recording operator.');
    value={delivery:{manifest:inputFile(args.delivery.manifest),files},name:args.name,actor:args.actor};
  }
  need(json(value).length<=MAX_REQUEST,'GRANT_PROCEDURE_INPUT',
    'Keep the metadata request within 2 MiB; pass complete original files by retained references.');
  return value;
}
async function optional(path,maximum=MAX_RECORD) {
  try{return await readProcedureFile(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function ordinaryDirectory(path) {
  try {
    const stat=await lstat(path);
    need(stat.isDirectory()&&!stat.isSymbolicLink(),'GRANT_PROCEDURE_DIRECTORY',
      'Keep the original procedure directory with its request.');
    return true;
  }catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function paths(context,operation,id) {
  need(OPERATIONS.includes(operation),'GRANT_PROCEDURE_OPERATION','Choose save, export or receive.');
  const parent=await context.directory(join(await context.root(),'procedure-operations'));
  const kind=await context.directory(join(parent,operation));
  return {parent,kind,root:join(kind,sha(Buffer.from(requestId(id))))};
}
async function recordAt(root,workspace,operation,id) {
  const raw=await optional(join(root,'request.json'),MAX_REQUEST);
  need(raw,'GRANT_PROCEDURE_NOT_FOUND','Select a retained original procedure request.');
  const record=decode(raw);
  need(record.schema===GRANT_PROCEDURE_AGENT_REQUEST&&record.workspace===workspace&&
    record.operation===operation&&record.requestId===id&&
    record.requestSha256===sha(Buffer.from(canonical(record.input)))&&
    /^[a-f0-9]{64}$/.test(record.bindingSelectionSha256||''),
    'GRANT_PROCEDURE_REQUEST_CHANGED','Keep the original complete procedure request and selected workspace together.');
  return record;
}
const identity = record => ({
  schema:GRANT_PROCEDURE_AGENT_RESULT,workspace:record.workspace,operation:record.operation,
  requestId:record.requestId,requestSha256:record.requestSha256,
});
const failure = error => ({
  code:error.code??null,message:String(error.message??error),status:error.status??null,
  definite:error.definite??null,uncertain:error.uncertain??null,requestId:error.requestId??null,
});
const mime = name => name.endsWith('.zip')?'application/zip'
  :name.endsWith('.html')?'text/html; charset=utf-8'
  :name.endsWith('.md')?'text/markdown; charset=utf-8'
  :name.endsWith('.json')?'application/json':'text/plain; charset=utf-8';
async function snapshot(context,record,name,bytes,complete) {
  const retained=await context.retain({
    bytes,filename:basename(name),mediaType:mime(name),status:200,
    ...(name.endsWith('.json')?{value:decode(bytes)}:{}),
    source:{kind:'grant-procedure-'+record.operation,requestId:record.requestId,
      requestSha256:record.requestSha256,complete},
  },{tool:'merchant_grant_procedure_'+record.operation,requestId:record.requestId,
    operation:record.operation,filename:name,complete});
  const {value,arrays,...ref}=retained;
  return {name,snapshot:ref};
}
function summary(complete) {
  const native=complete?.native;
  return complete ? {
    caseId:native?.id??complete.intent?.caseId??null,sourceId:complete.source?.id??null,
    caseVersion:native?.version??null,action:native?.action??null,
    editionId:complete.intent?.procedure?.editionId??complete.intent?.input?.editionId??null,
  } : null;
}
async function nativeRecords(root) {
  const directory=join(root,'native'),result=[];
  if(!await ordinaryDirectory(directory))return result;
  for(const name of (await readdir(directory)).sort()) {
    if(!['intent.json','dispatch.json','returned.json','rejected.json','COMPLETE.json','grant-procedure.json'].includes(name)&&
       !/^failure-[a-f0-9-]{36}\.json$/.test(name))continue;
    const bytes=await readProcedureFile(join(directory,name),MAX_RECORD);
    result.push({name:'native/'+name,bytes});
  }
  return result;
}
function acceptedReturn(files,original) {
  const found=files.find(file=>file.name==='native/returned.json');
  if(!found)return null;
  const record=decode(found.bytes),response=record.response;
  need(record.schema===GRANT_PROCEDURE_SCHEMA+'.return'&&plain(record.intent)&&
    record.intent.schema===GRANT_PROCEDURE_SCHEMA+'.'+original.operation&&
    record.intent.requestId===original.requestId&&plain(response)&&typeof response.dataBase64==='string',
    'GRANT_PROCEDURE_RETURN_CHANGED','Keep the original complete positive native response.');
  const bytes=Buffer.from(response.dataBase64,'base64');
  need(bytes.length===response.bytes&&sha(bytes)===response.sha256&&same(decode(bytes),response.value),
    'GRANT_PROCEDURE_RETURN_CHANGED','The native response bytes and parsed result differ.');
  return {event:'PROCEDURE_NATIVE_RETURN',...record};
}
async function staged(context,root,name,chosen,maximum=MAX_RECORD) {
  const filename=join(root,name),existing=await optional(filename,maximum);
  if(existing) {
    need(sha(existing)===chosen.expectedInputSha256,'GRANT_PROCEDURE_INPUT_CHANGED',
      'A staged original file differs from this retained request.');
    return existing;
  }
  const loaded=await context.load(chosen.input,chosen.expectedInputSha256);
  need(Buffer.isBuffer(loaded.bytes)&&loaded.bytes.length<=maximum&&sha(loaded.bytes)===chosen.expectedInputSha256,
    'GRANT_PROCEDURE_INPUT_CHANGED','Keep every original selected file byte and its exact hash.');
  await retainProcedureFile(filename,loaded.bytes);
  return loaded.bytes;
}
function receivingSelection(record,files,manifest) {
  const selected=name=>{
    const found=files.find(file=>file.name==='delivery/'+name)?.snapshot;
    need(found?.id&&found.retention?.state==='COMPLETE','GRANT_PROCEDURE_RETENTION',
      'Retain every complete original delivery member before receiving.');
    return {input:{snapshotId:found.id,sourceWorkspace:record.workspace},expectedInputSha256:found.file.sha256};
  };
  return {manifest:selected('DELIVERY.json'),files:manifest.members.map(file=>({name:file.name,...selected(file.name)}))};
}
async function retainCompleted(context,record,root,inventory,extra) {
  const savedBytes=await optional(join(root,'result.json'),MAX_REQUEST);
  if(savedBytes) {
    const saved=decode(savedBytes);
    need(saved.schema===GRANT_PROCEDURE_AGENT_RESULT&&saved.workspace===record.workspace&&
      saved.operation===record.operation&&saved.requestId===record.requestId&&
      saved.requestSha256===record.requestSha256&&saved.state==='COMPLETE'&&Array.isArray(saved.files),
      'GRANT_PROCEDURE_RESULT_CHANGED','Keep the complete original response with its original request.');
    const expected=new Map(inventory.map(file=>[file.name,{bytes:file.bytes.length,sha256:sha(file.bytes)}]));
    need(saved.files.length===expected.size,'GRANT_PROCEDURE_RESULT_CHANGED',
      'The original response must retain every complete output file.');
    for(const file of saved.files) {
      const match=expected.get(file.name);
      need(match&&file.snapshot?.id&&file.snapshot.retention?.state==='COMPLETE'&&
        file.snapshot.file.sha256===match.sha256&&file.snapshot.file.bytes===match.bytes,
        'GRANT_PROCEDURE_RESULT_CHANGED','A retained file differs from the original complete native output.');
      const original=await context.loadRetained(file.snapshot.id,match.sha256);
      need(original.bytes.length===match.bytes&&sha(original.bytes)===match.sha256,
        'GRANT_PROCEDURE_RESULT_CHANGED','The retained original file bytes changed.');
      expected.delete(file.name);
    }
    return saved;
  }
  const files=[];
  for(const file of inventory)files.push(await snapshot(context,record,file.name,file.bytes,true));
  const complete=files.every(file=>file.snapshot.retention?.state==='COMPLETE');
  const result={...identity(record),state:complete?'COMPLETE':'RETENTION_INCOMPLETE',...extra,files};
  if(record.operation==='export') {
    result.delivery=complete?receivingSelection(record,files,extra.manifest):null;
  }
  if(!complete)return {...result,recovery:'The original native operation is complete. Restore retained storage and inspect this same operation and request to finish file delivery.'};
  try {await context.immutable(join(root,'result.json'),json(result));}
  catch(error) {
    if(error.code==='GRANT_RETAINED_CONFLICT')return retainCompleted(context,record,root,inventory,extra);
    return {...result,state:'RETENTION_INCOMPLETE',retentionError:failure(error),
      recovery:'The native output and these complete snapshot IDs are retained. Inspect the same original request after storage recovers to retain its final response.'};
  }
  return result;
}
async function inspect(context,record,root) {
  const requestBytes=await readProcedureFile(join(root,'request.json'),MAX_REQUEST);
  const inventory=[{name:'request.json',bytes:requestBytes}];
  if(record.operation==='export') {
    const directory=join(root,'delivery'),manifestRaw=await optional(join(directory,'DELIVERY.json'),MAX_RECORD);
    if(manifestRaw) {
      const checked=await inspectGrantProcedureDelivery(directory),manifest=checked.manifest;
      need(manifest.caseId===record.input.caseId&&manifest.sourceId===record.input.sourceId&&
        manifest.caseVersion===record.input.expectedVersion,'GRANT_PROCEDURE_RESULT_CHANGED',
        'The native delivery differs from the reviewed original selection.');
      for(const file of manifest.members)inventory.push({
        name:'delivery/'+file.name,bytes:await readProcedureFile(join(directory,file.name),MAX_RECORD)});
      inventory.push({name:'delivery/DELIVERY.json',bytes:manifestRaw});
      return retainCompleted(context,record,root,inventory,{
        summary:{caseId:manifest.caseId,caseVersion:manifest.caseVersion,sourceId:manifest.sourceId,
          editionId:manifest.editionId,operatingPlanId:manifest.operatingPlanId,selectedRevision:manifest.selectedRevision},
        manifest,
      });
    }
    const pending=(await readdir(root)).filter(name=>name.startsWith('.delivery.pending-')).sort();
    return {...identity(record),state:pending.length||await ordinaryDirectory(directory)?'PUBLICATION_INCOMPLETE':'PREPARED',
      summary:{caseId:record.input.caseId,sourceId:record.input.sourceId,caseVersion:record.input.expectedVersion},
      files:[await snapshot(context,record,'request.json',requestBytes,false)],pending,
      recovery:'Repeat the identical original export selection. Its native publisher recovers a complete pending delivery or preserves partial stages while reading the reviewed case.'};
  }
  // Read the final marker before its preceding native journals. Concurrent completion
  // may add a later marker, but cannot make an observed final result precede COMPLETE.
  const actualRaw=await optional(join(root,'native-result.json'),MAX_RECORD);
  const native=await nativeRecords(root);inventory.push(...native);
  const prepared=await optional(join(root,'procedure.json'),GRANT_PROCEDURE_MAX_BYTES);
  if(prepared) {
    need(record.operation==='save'&&sha(prepared)===record.input.expectedInputSha256,
      'GRANT_PROCEDURE_INPUT_CHANGED','Keep the same complete prepared procedure.');
    inventory.push({name:'procedure.json',bytes:prepared});
  }
  const returned=acceptedReturn(native,record);
  const completeBytes=native.find(file=>file.name==='native/COMPLETE.json')?.bytes;
  const complete=completeBytes?decode(completeBytes):null;
  if(actualRaw) {
    const actual=decode(actualRaw);
    need(complete&&same(actual.complete,complete),'GRANT_PROCEDURE_RESULT_CHANGED',
      'The full native result differs from its original completion record.');
    if(record.operation==='save')need(complete.intent?.procedure?.sha256===record.input.expectedInputSha256,
      'GRANT_PROCEDURE_RESULT_CHANGED','The saved procedure differs from the reviewed original bytes.');
    else need(complete.intent?.input?.manifestSha256===record.input.delivery.manifest.expectedInputSha256,
      'GRANT_PROCEDURE_RESULT_CHANGED','The received original delivery differs from its reviewed manifest.');
    inventory.push({name:'native-result.json',bytes:actualRaw});
    if(record.operation==='receive') {
      const checked=await inspectGrantProcedureDelivery(join(root,'delivery'));
      for(const file of checked.manifest.members)inventory.push({
        name:'delivery/'+file.name,bytes:await readProcedureFile(join(root,'delivery',file.name),MAX_RECORD)});
      inventory.push({name:'delivery/DELIVERY.json',bytes:await readProcedureFile(join(root,'delivery','DELIVERY.json'),MAX_RECORD)});
    }
    return retainCompleted(context,record,root,inventory,{summary:summary(complete)});
  }
  const rejected=native.find(file=>file.name==='native/rejected.json');
  const dispatched=native.some(file=>file.name==='native/dispatch.json');
  const state=complete?'NATIVE_COMPLETE':returned?'NATIVE_RETURNED':rejected?'NATIVE_REJECTED':dispatched?'RESUME_REQUIRED':'PREPARED';
  const files=[];
  for(const file of inventory)files.push(await snapshot(context,record,file.name,file.bytes,false));
  return {...identity(record),state,summary:summary(complete),files,
    ...(returned?{nativeReturn:returned}:{}),
    ...(rejected?{rejection:decode(rejected.bytes)}:{}),
    recovery:state==='NATIVE_REJECTED'
      ?'The original native request was explicitly rejected. Preserve its result and prepare a newly reviewed operation.'
      :state==='RESUME_REQUIRED'
      ?'The original dispatch has no retained final response. Resume this exact original request with resume:true; keep every selected byte and request ID.'
      :state==='NATIVE_RETURNED'||state==='NATIVE_COMPLETE'
      ?'The original native return is retained. Repeat this exact request to reopen and verify its saved source, then retain the complete result; the native helper reuses its returned journal.'
      :'The original request is retained. Repeat its exact arguments to continue the selected native operation.'};
}
async function materializeDelivery(context,record,root) {
  const directory=await context.directory(join(root,'delivery'));
  const ready=await optional(join(directory,'DELIVERY.json'),MAX_RECORD);
  if(ready) {
    need(sha(ready)===record.input.delivery.manifest.expectedInputSha256,'GRANT_PROCEDURE_DELIVERY_CHANGED',
      'The frozen original manifest differs from this receiving request.');
    await inspectGrantProcedureDelivery(directory);return directory;
  }
  const manifestBytes=await staged(context,root,'delivery-manifest.json',record.input.delivery.manifest,MAX_RECORD);
  const manifest=decode(manifestBytes);
  need(manifest?.schema===GRANT_PROCEDURE_SCHEMA+'.delivery'&&Array.isArray(manifest.members)&&
    manifest.members.length===record.input.delivery.files.length&&manifest.members.length<=100,
    'GRANT_PROCEDURE_DELIVERY','Select the full original native delivery manifest and every declared member.');
  const selected=new Map(record.input.delivery.files.map(file=>[file.name,file]));
  for(const member of manifest.members) {
    const name=fileName(member.name),file=selected.get(name);
    need(file&&name!=='DELIVERY.json'&&Number.isSafeInteger(member.bytes)&&member.bytes>=0&&
      member.bytes<=(name==='case.zip'?MAX_BUNDLE:MAX_RECORD)&&member.sha256===file.expectedInputSha256,
      'GRANT_PROCEDURE_DELIVERY_CHANGED','The selected member differs from the original native delivery manifest.');
    const bytes=await staged(context,directory,name,file,name==='case.zip'?MAX_BUNDLE:MAX_RECORD);
    need(bytes.length===member.bytes,'GRANT_PROCEDURE_DELIVERY_CHANGED','Retain the complete original member size.');
    selected.delete(name);
  }
  need(selected.size===0,'GRANT_PROCEDURE_DELIVERY_CHANGED','Retain exactly the original delivery members.');
  await retainProcedureFile(join(directory,'DELIVERY.json'),manifestBytes);
  await inspectGrantProcedureDelivery(directory);return directory;
}
async function run(context,args,operation,holder) {
  const input=selection(operation,args),{root}=await paths(context,operation,args.requestId);
  await context.directory(root);
  const proposed={schema:GRANT_PROCEDURE_AGENT_REQUEST,workspace:args.workspace,operation,
    requestId:args.requestId,requestSha256:sha(Buffer.from(canonical(input))),input,
    bindingSelectionSha256:context.binding.selectionSha256,createdAt:new Date().toISOString()};
  try {await context.immutable(join(root,'request.json'),json(proposed));}
  catch(error){if(error.code!=='GRANT_RETAINED_CONFLICT')throw error;}
  const record=await recordAt(root,args.workspace,operation,args.requestId);
  need(same(record.input,input),'GRANT_PROCEDURE_REQUEST_CONFLICT',
    'This original request owns another complete selection. Inspect it or prepare a new reviewed request.');
  if(await optional(join(root,'native-result.json'),MAX_RECORD)||
    operation==='export'&&await optional(join(root,'delivery','DELIVERY.json'),MAX_RECORD))
    return inspect(context,record,root);
  need(record.bindingSelectionSha256===context.binding.selectionSha256,'GRANT_PROCEDURE_BINDING_CHANGED',
    'The original host workspace selection changed. Inspect the retained original operation and restore its selected host binding before continuing it.');
  const emit=event=>{if(event.event==='PROCEDURE_NATIVE_RETURN')holder.nativeReturn=copy(event);};
  try {
    let result;
    if(operation==='save') {
      const bytes=await staged(context,root,'procedure.json',input,GRANT_PROCEDURE_MAX_BYTES);
      // The original inspector and writer own all business and source decisions.
      const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      need(Buffer.from(raw).equals(bytes),'GRANT_PROCEDURE_ENCODING',
        'Select the exact UTF-8 procedure file emitted by the original preparation; decoding must preserve every selected byte.');
      await inspectGrantProcedure(raw);
      result=await saveGrantProcedureNative(context.client(),{
        prepared:raw,requestId:record.requestId,operationDirectory:join(root,'native'),
        workspaceDirectory:context.binding.directory,resume:args.resume===true,
      },{emit});
    } else if(operation==='export') {
      await exportGrantProcedureNative(context.client(),{...input,directory:join(root,'delivery')});
      return inspect(context,record,root);
    } else {
      const directory=await materializeDelivery(context,record,root);
      result=await receiveGrantProcedureNative(context.client(),{
        directory,operationDirectory:join(root,'native'),workspaceDirectory:context.binding.directory,
        requestId:record.requestId,name:input.name,actor:input.actor,resume:args.resume===true,
      },{emit});
    }
    const bytes=json(result);
    need(bytes.length<=MAX_RECORD,'GRANT_PROCEDURE_RESULT_SIZE',
      'The full native result exceeds the original retained-record bound; its native completion and response remain in the operation.');
    await retainProcedureFile(join(root,'native-result.json'),bytes);
    return inspect(context,record,root);
  } catch(error) {
    let retained;
    try {retained=await inspect(context,record,root);}catch(retentionError) {
      retained={...identity(record),state:holder.nativeReturn?'NATIVE_RETURNED':'RETENTION_INCOMPLETE',
        summary:null,files:[],retentionError:failure(retentionError)};
    }
    if(retained.state==='COMPLETE')return retained;
    if(holder.nativeReturn||retained.nativeReturn||['NATIVE_COMPLETE','NATIVE_RETURNED','NATIVE_REJECTED','RESUME_REQUIRED','PUBLICATION_INCOMPLETE'].includes(retained.state))
      return {...retained,...(holder.nativeReturn?{nativeReturn:holder.nativeReturn}:{}),
        error:failure(error),recovery:holder.nativeReturn
          ?'The original native writer returned successfully. Keep this complete nativeReturn, operation and request ID. Restore retained storage, inspect the same operation, and continue its original saved-source verification.'
          :retained.recovery};
    throw Object.assign(error,{operation,requestId:record.requestId,
      recovery:'Inspect this retained original procedure request before repeating its exact arguments.'});
  }
}
async function openProcedure(context,args) {
  const selected={caseId:nativeId(args.caseId,'operation'),sourceId:nativeId(args.sourceId,'source')};
  const result=await reopenGrantProcedureNative(context.client(),selected);
  const raw=Buffer.from(result.raw),bytes=json(result),record={workspace:args.workspace,operation:'open',
    requestId:null,requestSha256:sha(raw)};
  need(bytes.length<=MAX_RECORD,'GRANT_PROCEDURE_RESULT_SIZE','Read the original complete procedure verification within its retained-record bound.');
  const files=[
    await snapshot(context,record,'grant-procedure.json',raw,true),
    await snapshot(context,record,'source-verification.json',bytes,true),
  ];
  return {schema:GRANT_PROCEDURE_AGENT_RESULT,workspace:args.workspace,operation:'open',
    state:files.every(file=>file.snapshot.retention?.state==='COMPLETE')?'COMPLETE':'RETENTION_INCOMPLETE',
    summary:{...selected,caseVersion:result.current.program.version,editionId:result.document.editionId,
      operatingPlanId:result.plan.id,selectedRevision:result.document.selectedRevision},files};
}
async function list(context,args) {
  const offset=args.offset??0,limit=args.limit??20;
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,
    'GRANT_PROCEDURE_PAGE','Select a nonnegative offset and one through 100 original requests.');
  const chosen=args.operation===undefined?OPERATIONS:[args.operation];
  need(chosen.every(value=>OPERATIONS.includes(value)),'GRANT_PROCEDURE_OPERATION','Choose save, export or receive.');
  const parent=await context.directory(join(await context.root(),'procedure-operations')),entries=[];
  for(const operation of chosen) {
    const directory=join(parent,operation);
    if(!await ordinaryDirectory(directory))continue;
    for(const key of (await readdir(directory)).filter(name=>/^[a-f0-9]{64}$/.test(name)))
      entries.push({operation,key,root:join(directory,key)});
  }
  entries.sort((a,b)=>(a.operation+'/'+a.key).localeCompare(b.operation+'/'+b.key));
  const operations=[];
  for(const entry of entries.slice(offset,offset+limit)) {
    const raw=await optional(join(entry.root,'request.json'),MAX_REQUEST);
    if(!raw){operations.push({operation:entry.operation,captureKey:entry.key,state:'PREPARING'});continue;}
    const candidate=decode(raw),record=await recordAt(entry.root,args.workspace,entry.operation,candidate.requestId);
    need(entry.key===sha(Buffer.from(record.requestId)),'GRANT_PROCEDURE_REQUEST_CHANGED','Keep the original request directory identity.');
    const result=await optional(join(entry.root,'result.json'),MAX_REQUEST);
    if(result) {
      const saved=decode(result);
      need(saved.schema===GRANT_PROCEDURE_AGENT_RESULT&&saved.workspace===record.workspace&&
        saved.operation===record.operation&&saved.requestId===record.requestId&&
        saved.requestSha256===record.requestSha256&&saved.state==='COMPLETE',
        'GRANT_PROCEDURE_RESULT_CHANGED','Inspect the exact original complete retained response.');
    }
    operations.push({operation:record.operation,requestId:record.requestId,requestSha256:record.requestSha256,
      createdAt:record.createdAt,state:result?'COMPLETE':'RETAINED'});
  }
  return {workspace:args.workspace,offset,count:entries.length,operations,
    nextOffset:offset+limit<entries.length?offset+limit:null};
}
export async function executeGrantProcedureTool(verb,args,context) {
  need(grantProcedureVerbs.has(verb),'GRANT_PROCEDURE_TOOL','Choose an original procedure operation.');
  if(verb==='procedure_open')return openProcedure(context,args);
  if(verb==='procedure_list')return list(context,args);
  requestId(args.requestId);
  if(verb==='procedure_inspect') {
    const {root}=await paths(context,args.operation,args.requestId);
    return inspect(context,await recordAt(root,args.workspace,args.operation,args.requestId),root);
  }
  const operation=verb.slice('procedure_'.length),input=selection(operation,args);
  const key=args.workspace+'\0'+operation+'\0'+args.requestId,inputSha256=sha(Buffer.from(canonical(input)));
  const pending=context.pending.get(key);
  if(pending) {
    need(pending.inputSha256===inputSha256,'GRANT_PROCEDURE_REQUEST_CONFLICT',
      'The running original request already owns another complete selection.');
    return pending.promise;
  }
  const holder={inputSha256,nativeReturn:null,promise:null};
  const promise=run(context,args,operation,holder);holder.promise=promise;
  context.pending.set(key,holder);
  try {return await promise;}finally{context.pending.delete(key);}
}
