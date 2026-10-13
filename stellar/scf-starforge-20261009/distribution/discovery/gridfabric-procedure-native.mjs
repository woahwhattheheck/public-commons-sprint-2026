// MIT. Read-only native capture on the original GridFabric SDK and Operating Plans.
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open, mkdir, lstat, realpath, readdir, link, unlink} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectGridFabricProcedureInput, prepareGridFabricProcedure, recordGridFabricProcedure} from './gridfabric-procedure.mjs';
import {inspectOperatingPlan, renderOperatingPlanHTML, renderOperatingPlanMarkdown} from './operating-plan.mjs';

export const GRIDFABRIC_PROCEDURE_CAPTURE_SCHEMA = 'stellar-forge.gridfabric-procedure-capture.v1';
const NATIVE_NAMES = ['core.cjs','model.cjs','sqlite-store.mjs','files.mjs','native-file-reader.mjs',
  'operator.mjs','server.mjs','delivery.mjs','cli.mjs','public/index.html','public/style.css',
  'public/app.mjs','contracts/plaid-public-contract.json','contracts/management-examples.json',
  '../../merchant-fleet-gateway/state-lease.mjs'];
const BROWSER_NATIVE_NAMES=[...NATIVE_NAMES,'procedure-files.mjs','procedure-archive.mjs','procedure-controller.mjs',
  'public/procedures.html','public/procedures.mjs','public/procedures.css','browser-assets.json','../../distribution/browser-assets.mjs'];
const HELPER_NAMES = ['gridfabric-procedure-native.mjs','gridfabric-procedure-native.d.mts',
  'gridfabric-procedure.mjs','operating-plan.mjs','catalog.mjs',
  '../../sf30-seller-sdk/gridfabric-plaid/sdk/client.mjs',
  '../../sf30-seller-sdk/gridfabric-plaid/sdk/contract.mjs',
  '../../sf30-seller-sdk/gridfabric-plaid/sdk/http-client.mjs'];
const TABLES = ['instances','instance_editions','sources','source_rows','source_issues','mappings',
  'callbacks','callback_deliveries','events','event_revisions','distributions','opt_decisions',
  'device_actions','reports','report_rows','management_operations','management_receipts','operations'];
const READS = new Set(['launch','state','source','contracts','page','detail']);
const STEPS = ['workspace','configuration','sources','mappings','callbacks','events','dispatch','reports','delivery'];
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));
const json = v => JSON.stringify(v,null,2)+'\n';
const hash = v => createHash('sha256').update(v).digest('hex');
const canonical = v => plain(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) :
  Array.isArray(v) ? v.map(canonical) : v;
const same = (a,b) => JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const inputHash = v => hash(JSON.stringify(canonical(v)));
const stamp = s => [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
export class GridFabricProcedureCaptureError extends Error {
  constructor(code,message,details={}) {super(message);this.name='GridFabricProcedureCaptureError';this.code=code;this.details=details;}
}
function need(value,code,message,details) {
  if(!value)throw new GridFabricProcedureCaptureError(code,message,details);
}
function relative(value) {
  need(typeof value==='string' && value.length<=4096 && !value.includes('\\') &&
    !value.includes('\0') && value.split('/').every(s=>s&&s!=='.'&&s!=='..') && !isAbsolute(value),
    'GRID_CAPTURE_PATH','Use a complete relative capture member path.');
  return value;
}
function directory(value) {
  need(typeof value==='string' && isAbsolute(value) && !/[\0\r\n]/.test(value),
    'GRID_CAPTURE_DIRECTORY','Use an absolute private output directory.');
  return resolve(value);
}
function parse(bytes,label) {
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch(error){throw new GridFabricProcedureCaptureError('GRID_CAPTURE_JSON','Invalid complete JSON in '+label,{cause:error.message});}
}
async function ordinary(filename,{privateOnly=false}={}) {
  const before=await lstat(filename);
  need(before.isFile()&&!before.isSymbolicLink()&&(!privateOnly||(before.mode&0o077)===0),
    'GRID_CAPTURE_FILE','Retain an ordinary'+(privateOnly?' private':'')+' file.',{path:filename});
  const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    need(stamp(await handle.stat())===stamp(before),'GRID_CAPTURE_FILE_CHANGED','A source file changed before reading.',{path:filename});
    const bytes=await handle.readFile(),after=await handle.stat();
    need(stamp(after)===stamp(before)&&stamp(await lstat(filename))===stamp(before)&&bytes.length===before.size,
      'GRID_CAPTURE_FILE_CHANGED','A source file changed while reading.',{path:filename});
    return bytes;
  } finally {await handle.close();}
}
async function writeNew(filename,bytes) {
  const handle=await open(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try {await handle.writeFile(bytes);await handle.sync();}
  finally {await handle.close();}
}
async function syncDirectory(path) {
  const h=await open(path,constants.O_RDONLY);
  try {await h.sync();}finally{await h.close();}
}
async function tree(root,prefix='') {
  const result=[];
  for(const name of (await readdir(prefix?join(root,prefix):root)).sort()) {
    const path=prefix?prefix+'/'+name:name,st=await lstat(join(root,path));
    need(!st.isSymbolicLink()&&(st.isDirectory()||st.isFile())&&(st.mode&0o077)===0,
      'GRID_CAPTURE_MEMBER_TYPE','Capture directories and files must be private ordinary members.',{path});
    if(st.isDirectory()) result.push(...await tree(root,path));else result.push(path);
  }
  return result;
}
function workspaceMatches(value,expected) {
  return value?.workspace_id===expected.workspace_id&&value?.workspace_directory===expected.workspace_directory&&
    value?.source_sha256===expected.source_sha256;
}
function checkSource(value,expected) {
  need(value?.schema==='stellar-forge.gridfabric-native-source.v1'&&Array.isArray(value.modules)&&
    value.sha256===expected.source_sha256&&hash(JSON.stringify(value.modules))===value.sha256,
    'GRID_CAPTURE_SOURCE','The complete original source identity differs from the selected source.');
  const names=value.modules.length===NATIVE_NAMES.length?NATIVE_NAMES:BROWSER_NATIVE_NAMES;
  need(value.modules.length===names.length&&new Set(value.modules.map(x=>x.path)).size===names.length&&
    value.modules.every(x=>names.includes(x.path)&&Number.isSafeInteger(x.bytes)&&x.bytes>=0&&/^[a-f0-9]{64}$/.test(x.sha256||'')),
    'GRID_CAPTURE_SOURCE_MEMBERS','The installed original native source roster has changed.');
}
function checkLaunch(value,input) {
  need(value?.schema==='stellar-forge.gridfabric-launch.v1'&&value.status==='READY'&&
    value.workspace_id===input.workspace.workspace_id&&value.workspace===input.workspace.workspace_directory&&
    value.revision===input.expectedRevision,'GRID_CAPTURE_WORKSPACE','The live workspace, source or revision changed.');
  checkSource(value.source,input.workspace);
}
function checkState(value,input) {
  need(value?.workspace_id===input.workspace.workspace_id&&value.revision===input.expectedRevision&&plain(value.collections),
    'GRID_CAPTURE_REVISION','The native workspace revision differs from the reviewed revision.');
}
const recordKey = (collection,id) => JSON.stringify([collection,id]);
const associationKey = (stepId,collection,id) => JSON.stringify([stepId,collection,id]);
function descriptors(value,path='',result=[]) {
  if(Array.isArray(value))value.forEach((v,i)=>descriptors(v,path+'/'+i,result));
  else if(plain(value))for(const [key,v] of Object.entries(value)) {
    const at=path+'/'+key;
    if((key==='file'||key.endsWith('_file'))&&plain(v)&&/^[a-f0-9]{64}$/.test(v.sha256||'')&&
      Number.isSafeInteger(v.bytes)&&v.bytes>=0&&typeof v.name==='string')result.push({at,descriptor:v});
    descriptors(v,at,result);
  }
  return result;
}
function references(collection,r) {
  const result=[],add=(table,id)=>{if(typeof id==='string'&&id)result.push([table,id]);};
  if(collection!=='instances')add('instances',r.instance_id);
  if(collection!=='instance_editions')add('instance_editions',r.instance_edition_id);
  if(collection!=='sources')add('sources',r.source_id);
  if(collection!=='mappings')add('mappings',r.mapping_id);
  if(collection!=='reports')add('reports',r.report_id);
  if(collection!=='callbacks')add('callbacks',r.callback_id);
  if(collection==='instances'||collection==='instance_editions') {
    add('sources',r.schema_source_id);add('mappings',r.active_mapping_id);
    for(const binding of Object.values(r.bindings||{}))add('sources',binding.evidence_source_id);
  }
  if(collection==='sources')add('sources',r.corrects_source_id);
  if(collection==='mappings')for(const entry of r.entries||[])for(const id of entry.source_ids||[])add('sources',id);
  if(collection==='events'){
    add('callbacks',r.last_callback_id);add('callbacks',r.last_interval_callback_id);
    add('event_revisions',r.current_edition_id);add('distributions',r.absent_distribution_id);
  }
  if(collection==='event_revisions')add('events',r.event_key);
  if(collection==='device_actions') {
    add('opt_decisions',r.opt_decision_id);add('opt_decisions',r.dispatch_opt_decision_id);
    add('event_revisions',r.superseded_by_event_revision_id);add('distributions',r.superseded_by_distribution_id);
  }
  if(collection==='distributions')add('callbacks',r.complete_callback_id);
  if(collection==='management_receipts')add('management_operations',r.operation_id);
  if(collection==='device_actions'&&r.instance_id&&r.event_id)add('events',hash(JSON.stringify(['event',r.instance_id,r.event_id])));
  if(collection==='operations'&&plain(r.result)){
    for(const [field,table] of [['instance_id','instances'],['source_id','sources'],['mapping_id','mappings'],
      ['report_id','reports'],['callback_id','callbacks'],['operation_id','management_operations'],
      ['device_action_id','device_actions'],['distribution_id','distributions'],['receipt_id','management_receipts'],
      ['opt_decision_id','opt_decisions'],['instance_edition_id','instance_editions']])
      add(table,r.result[field]);
  }
  const evidence=(v)=>{
    if(!plain(v))return;
    for(const e of v.source_evidence||[])add('sources',e.source_id);
  };
  const outcome=v=>{
    if(!plain(v))return;
    add('instance_editions',v.instance_edition_id);add('distributions',v.distribution_id);
    for(const field of ['actions','device_actions','preserved_device_actions','superseded_device_actions'])
      for(const item of v[field]||[])add('device_actions',typeof item==='string'?item:item?.device_action_id);
    for(const item of v.opted_out||[])add('opt_decisions',item.opt_decision_id);
    for(const e of v.events||[]){add('event_revisions',e.event_revision_id);outcome(e.device);}
    for(const recovered of v.recovered||[])if(['device_actions','management_operations'].includes(recovered.collection))add(recovered.collection,recovered.id);
    evidence(v);
  };
  evidence(r);evidence(r.reconciliation);
  if(collection==='operations'){evidence(r.input);outcome(r.result);}
  for(const x of [...(r.reconciliations||[]),...(r.continuations||[])]){evidence(x);add('instance_editions',x.instance_edition_id);outcome(x.result);}
  if(collection==='report_rows')for(const row of r.calculation?.source_rows||[]) {
    add('sources',row.source_id);add('source_rows',row.source_row_id);
  }
  if(collection==='callbacks'){
    for(const x of [r,...(r.attempts||[])]) {
      add('reports',x.report_id);add('mappings',x.mapping_id);add('distributions',x.distribution_id);
      outcome(x.projection);
    }
    for(const previous of r.projection_history||[]){add('instance_editions',previous.instance_edition_id);outcome(previous.result);}
  }
  return result;
}

/**
 * Capture through an existing authenticated SDK borrower. Only original GET/file reads are used.
 * An exclusive private directory is reserved; capture.json is linked create-new only after
 * complete members and stable-revision checks. Failures preserve the incomplete directory.
 */
export async function captureGridFabricProcedure({client,catalog,input,outputDirectory,savedAt=new Date().toISOString(),plan}={}) {
  const selected=inspectGridFabricProcedureInput(input),root=directory(outputDirectory);
  need(typeof savedAt==='string'&&Number.isFinite(Date.parse(savedAt)),'GRID_CAPTURE_TIME','Keep a valid capture timestamp.');
  need(client&&['callRaw','fileInfo','readFile'].every(k=>typeof client[k]==='function')&&
    workspaceMatches(client.identity,selected.workspace),'GRID_CAPTURE_CLIENT','Use the bound original authenticated SDK borrower.');
  const basis=plan===undefined?prepareGridFabricProcedure({catalog,input:selected,savedAt}):inspectOperatingPlan(plan);
  need(basis.id===selected.id,'GRID_CAPTURE_PLAN','Keep the original plan ID.');
  const parent=dirname(root),parentInfo=await lstat(parent);
  need(parentInfo.isDirectory()&&!parentInfo.isSymbolicLink()&&await realpath(parent)===parent,
    'GRID_CAPTURE_PARENT','Select an existing ordinary output parent without symbolic links.');
  await mkdir(root,{mode:0o700});
  const rootInfo=await lstat(root),members=new Map(),made=new Set(['']),responses=[],records=[],pages=[],files=[];
  const capture={schema:GRIDFABRIC_PROCEDURE_CAPTURE_SCHEMA,workspace:clone(selected.workspace),revision:selected.expectedRevision,
    capturedAt:savedAt,instanceId:selected.instanceId,input:clone(selected),input_sha256:inputHash(selected),
    records,files,responses,pages,source:null,observations:null};
  async function put(path,bytes) {
    relative(path);need(!members.has(path),'GRID_CAPTURE_DUPLICATE_MEMBER','A capture member was already written.',{path});
    const raw=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes,'utf8'),parts=path.split('/');parts.pop();
    let current='';for(const part of parts){current=current?current+'/'+part:part;if(!made.has(current)){await mkdir(join(root,current),{mode:0o700});made.add(current);}}
    await writeNew(join(root,path),raw);
    const member={path,bytes:raw.length,sha256:hash(raw)};members.set(path,member);return member;
  }
  const putJSON=(path,value)=>put(path,json(value));
  async function read(operation,payload={}) {
    need(READS.has(operation),'GRID_CAPTURE_READ_ONLY','Capture permits only declared original reads.');
    need(workspaceMatches(client.identity,selected.workspace),'GRID_CAPTURE_CLIENT_CHANGED','The original SDK binding changed.');
    const reply=await client.callRaw(operation,payload);
    need(plain(reply?.value)&&typeof reply.raw_text==='string'&&reply.workspace_id===selected.workspace.workspace_id&&
      same(parse(Buffer.from(reply.raw_text,'utf8'),'original response'),reply.value),
      'GRID_CAPTURE_RESPONSE','Keep the original complete response and workspace binding.');
    const stem='responses/'+String(responses.length+1).padStart(6,'0');
    const member=await put(stem+'.json',reply.raw_text);
    const response={operation,payload:clone(payload),...member,metadata:await putJSON(stem+'.metadata.json',{
      operation,payload:clone(payload),workspace_id:reply.workspace_id,
      http_status:reply.http_status??null,headers:reply.headers??null,raw_headers:reply.raw_headers??null})};
    responses.push(response);return {value:reply.value,response};
  }
  try {
    capture.inputFile=await putJSON('procedure-input.json',selected);
    capture.catalogFile=await putJSON('catalog.json',catalog);
    capture.previousPlan=await putJSON('plan-before.json',basis);
    const beforeLaunch=await read('launch');checkLaunch(beforeLaunch.value,selected);
    const before=await read('state');checkState(before.value,selected);
    const source=await read('source');checkSource(source.value,selected.workspace);
    need(same(source.value,beforeLaunch.value.source),'GRID_CAPTURE_SOURCE_CHANGED','The original launch/source reads differ.');
    const contract=await read('contracts');
    const nativeRoot=new URL('../../sf30-seller-sdk/gridfabric-plaid/',import.meta.url),sourceMembers=[];
    for(let i=0;i<source.value.modules.length;i++) {
      const item=source.value.modules[i],raw=await ordinary(fileURLToPath(new URL(item.path,nativeRoot)));
      need(raw.length===item.bytes&&hash(raw)===item.sha256,'GRID_CAPTURE_INSTALLED_SOURCE',
        'The selected installed source differs from the live server. Run capture from its matching complete toolkit.',{module:item.path});
      sourceMembers.push({module:item.path,...await put('source/native/'+String(i+1).padStart(3,'0')+'-'+basename(item.path),raw)});
    }
    const helpers=[];for(let i=0;i<HELPER_NAMES.length;i++) {
      const module=HELPER_NAMES[i],raw=await ordinary(fileURLToPath(new URL(module,import.meta.url)));
      helpers.push({module,...await put('source/helpers/'+String(i+1).padStart(3,'0')+'-'+basename(module),raw)});
    }
    capture.source={identity:clone(source.value),response:source.response,members:sourceMembers,helpers,contracts:contract.response};
    const detailCache=new Map(),pageCache=new Map(),fileCache=new Map(),queued=new Map(),done=new Set(),queue=[];
    const explicit=new Set(selected.records.map(r=>associationKey(r.stepId,r.collection,r.id)));
    const fileAssociations=new Map();
    function enqueue(stepId,collection,id,selectedBy='dependency') {
      if(typeof id!=='string'||!id)return;
      need(TABLES.includes(collection)&&STEPS.includes(stepId),'GRID_CAPTURE_REFERENCE','Invalid original record reference.');
      const key=associationKey(stepId,collection,id);
      if(!queued.has(key)){const task={stepId,collection,id,selectedBy:[]};queued.set(key,task);queue.push(task);}
      const task=queued.get(key);if(!task.selectedBy.includes(selectedBy))task.selectedBy.push(selectedBy);
    }
    function enqueueFile(stepId,fileId,selectedBy,expected=null) {
      const key=JSON.stringify([stepId,fileId]);
      if(!fileAssociations.has(key))fileAssociations.set(key,{stepId,fileId,selectedBy:[],expected:[]});
      const row=fileAssociations.get(key);if(!row.selectedBy.includes(selectedBy))row.selectedBy.push(selectedBy);
      if(expected&&!row.expected.some(x=>same(x,expected)))row.expected.push(clone(expected));
    }
    async function completePages(stepId,collection,scope,parentRecord) {
      const key=JSON.stringify([collection,scope]);let saved=pageCache.get(key);
      if(!saved){
        let offset=0,total=null;const pageResponses=[],rows=[],ids=new Set();
        for(;;) {
          const reply=await read('page',{collection,scope,offset,limit:1000,order:'asc'}),p=reply.value;
          need(p.collection===collection&&p.offset===offset&&p.limit===1000&&Array.isArray(p.rows)&&
            Number.isSafeInteger(p.total)&&p.total>=0&&(total===null||total===p.total)&&
            p.rows.length<=1000&&offset+p.rows.length<=p.total,
            'GRID_CAPTURE_PAGE','The complete original page sequence changed or is malformed.',{collection,scope,offset});
          total=p.total;
          for(const row of p.rows){
            need(plain(row)&&typeof row.id==='string'&&!ids.has(row.id),'GRID_CAPTURE_PAGE_DUPLICATE','An original page row is repeated or lacks its ID.');
            ids.add(row.id);rows.push(row);
            const rowKey=recordKey(collection,row.id);
            if(!detailCache.has(rowKey))detailCache.set(rowKey,{record:clone(row),response:reply.response,pageRowId:row.id});
          }
          pageResponses.push(reply.response);
          const next=offset+p.rows.length;
          need(p.next_offset===(next<total?next:null)&&(p.next_offset===null||next>offset),
            'GRID_CAPTURE_PAGE_CONTINUATION','Original page continuation is missing or does not cover every row.');
          if(p.next_offset===null)break;offset=p.next_offset;
        }
        need(rows.length===total,'GRID_CAPTURE_PAGE_TOTAL','Keep every original scoped row.');
        saved={collection,scope,total,rows,responses:pageResponses};pageCache.set(key,saved);
      }
      pages.push({stepId,selectedBy:parentRecord,collection,scope,total:saved.total,
        rows:saved.rows.map(r=>r.id),responses:saved.responses});
      for(const row of saved.rows)enqueue(stepId,collection,row.id,parentRecord);
      return saved;
    }
    enqueue('configuration','instances',selected.instanceId,'selected-instance');
    for(const r of selected.records)enqueue(r.stepId,r.collection,r.id,'selected');
    for(const f of selected.files)enqueueFile(f.stepId,f.fileId,'selected');
    for(let cursor=0;cursor<queue.length;cursor++) {
      const task=queue[cursor],key=associationKey(task.stepId,task.collection,task.id);
      if(done.has(key))continue;done.add(key);
      const nativeKey=recordKey(task.collection,task.id);let detail=detailCache.get(nativeKey);
      if(!detail||(explicit.has(key)&&detail.response.operation!=='detail')) {
        const reply=await read('detail',{collection:task.collection,id:task.id});
        need(reply.value.collection===task.collection&&reply.value.id===task.id&&plain(reply.value.record),
          'GRID_CAPTURE_DETAIL','The original detail did not return the selected record.');
        detail={record:clone(reply.value.record),response:reply.response};detailCache.set(nativeKey,detail);
      }
      const r=detail.record;
      need(r.instance_id===undefined||r.instance_id===selected.instanceId,
        'GRID_CAPTURE_INSTANCE','An original selected/dependent record belongs to another Plaid instance.',{collection:task.collection,id:task.id});
      records.push({...task,origin:explicit.has(key)?'selected':'dependency',record:r,...detail.response,
        ...(detail.pageRowId===undefined?{}:{pageRowId:detail.pageRowId}),
        collection:task.collection,id:task.id,stepId:task.stepId});
      if(task.collection==='operations'&&r.action==='import_source'&&/^[a-f0-9]{64}$/.test(r.input?.file_sha256||''))
        enqueueFile(task.stepId,'file_'+r.input.file_sha256,nativeKey+'/input/file_sha256');
      for(const f of descriptors(r))enqueueFile(task.stepId,'file_'+f.descriptor.sha256,nativeKey+f.at,f.descriptor);
      for(const [table,id] of references(task.collection,r))enqueue(task.stepId,table,id,nativeKey);
      if(task.collection==='instances')await completePages(task.stepId,'instance_editions',task.id,nativeKey);
      if(task.collection==='sources') {
        await completePages(task.stepId,'source_issues',task.id,nativeKey);
        const scopes=new Set((r.device_channels||[]).map(c=>task.id+'\0'+c.device_id+'\0'+c.channel));
        let count=0;for(const scope of scopes)count+=(await completePages(task.stepId,'source_rows',scope,nativeKey)).total;
        const described=(r.device_channels||[]).reduce((n,c)=>n+c.rows,0);
        need(count===described,'GRID_CAPTURE_SOURCE_ROWS','All original parsed source rows must be retained.',{source_id:task.id,count,described});
      }
      for(const [parent,child] of [['reports','report_rows'],['callbacks','callback_deliveries'],['management_operations','management_receipts']])
        if(task.collection===parent)await completePages(task.stepId,child,task.id,nativeKey);
      if(task.collection==='events')for(const table of ['event_revisions','opt_decisions','device_actions'])
        await completePages(task.stepId,table,task.id,nativeKey);
    }
    for(const assoc of fileAssociations.values()) {
      let saved=fileCache.get(assoc.fileId);
      if(!saved) {
        const info=await client.fileInfo(assoc.fileId);
        need(info?.workspace_id===selected.workspace.workspace_id&&info.file_id===assoc.fileId&&
          Number.isSafeInteger(info.bytes)&&info.bytes>=0&&/^[a-f0-9]{64}$/.test(info.sha256||''),
          'GRID_CAPTURE_FILE_IDENTITY','The original native file identity is invalid.');
        const path='files/'+String(fileCache.size+1).padStart(6,'0')+'.bin';
        if(!made.has('files')){await mkdir(join(root,'files'),{mode:0o700});made.add('files');}
        const handle=await open(join(root,path),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
        const sha=createHash('sha256');let offset=0;
        try {
          while(offset<info.bytes) {
            const limit=Math.min(196608,info.bytes-offset),part=await client.readFile(assoc.fileId,{offset,limit,expectedSha256:info.sha256});
            need(part instanceof Uint8Array&&part.length===limit,'GRID_CAPTURE_FILE_INCOMPLETE','The native file range is incomplete.',{fileId:assoc.fileId,offset});
            await handle.writeFile(part);sha.update(part);offset+=part.length;
          }
          await handle.sync();
        } finally {await handle.close();}
        need(sha.digest('hex')===info.sha256,'GRID_CAPTURE_FILE_HASH','The complete native file differs from its original SHA-256.');
        const member={path,bytes:info.bytes,sha256:info.sha256};members.set(path,member);
        const after=await client.fileInfo(assoc.fileId);
        need(same(info,after),'GRID_CAPTURE_FILE_CHANGED','The retained native file identity changed during its read.');
        saved={...member,name:info.name,content_type:info.content_type,metadata:await putJSON(path+'.metadata.json',info)};
        fileCache.set(assoc.fileId,saved);
      }
      for(const expected of assoc.expected)need(saved.sha256===expected.sha256&&saved.bytes===expected.bytes,
        'GRID_CAPTURE_FILE_REFERENCE','The original descriptor and complete native file disagree.');
      files.push({stepId:assoc.stepId,fileId:assoc.fileId,origin:assoc.selectedBy.includes('selected')?'selected':'dependency',
        selectedBy:assoc.selectedBy,descriptors:assoc.expected,...saved});
    }
    const after=await read('state');checkState(after.value,selected);
    const afterLaunch=await read('launch');checkLaunch(afterLaunch.value,selected);
    need(same(before.value,after.value)&&same(beforeLaunch.value,afterLaunch.value),
      'GRID_CAPTURE_CHANGED','The original workspace changed during capture; no complete capture is published.');
    capture.observations={beforeLaunch:beforeLaunch.response,beforeState:before.response,afterState:after.response,afterLaunch:afterLaunch.response};
    const savedPlan=recordGridFabricProcedure(basis,capture,{input:selected,savedAt});
    capture.plan=await putJSON('gridfabric-plan.json',savedPlan);
    capture.html=await put('gridfabric-plan.html',renderOperatingPlanHTML(savedPlan));
    capture.markdown=await put('gridfabric-plan.md',renderOperatingPlanMarkdown(savedPlan));
    capture.members=[...members.values()].sort((a,b)=>a.path.localeCompare(b.path));
    need(same(await tree(root),capture.members.map(m=>m.path).sort()),'GRID_CAPTURE_ROSTER','Unfinished or undeclared files prevent capture publication.');
    need((await lstat(root)).ino===rootInfo.ino&&(await lstat(root)).dev===rootInfo.dev,
      'GRID_CAPTURE_DIRECTORY_CHANGED','The reserved output directory changed.');
    // The complete marker is an exclusive hard link; an existing destination is never replaced.
    const stage=join(root,'.capture-'+randomUUID()+'.pending'),raw=Buffer.from(json(capture),'utf8');
    await writeNew(stage,raw);await link(stage,join(root,'capture.json'));await unlink(stage);await syncDirectory(root);
    const received=await readGridFabricProcedureCapture(root);
    return {...received,receipt:{schema:'stellar-forge.gridfabric-procedure-capture-receipt.v1',directory:root,
      path:'capture.json',bytes:raw.length,sha256:hash(raw),workspace:clone(selected.workspace),revision:selected.expectedRevision}};
  } catch(error) {
    if(error&&typeof error==='object')error.captureDirectory=root;
    throw error;
  }
}

/** Reopen a complete capture without connecting to or starting an operator. */
export async function readGridFabricProcedureCapture(value) {
  const root=directory(typeof value==='string'?value:value?.directory),st=await lstat(root);
  need(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&await realpath(root)===root,
    'GRID_CAPTURE_DIRECTORY','Open an ordinary private capture directory.');
  const raw=await ordinary(join(root,'capture.json'),{privateOnly:true}),capture=parse(raw,'capture.json');
  need(capture?.schema===GRIDFABRIC_PROCEDURE_CAPTURE_SCHEMA&&Array.isArray(capture.members),
    'GRID_CAPTURE_INCOMPLETE','The complete capture marker is missing or unsupported.');
  const members=new Map();
  for(const member of capture.members){
    relative(member.path);
    need(member.path!=='capture.json'&&!members.has(member.path)&&Number.isSafeInteger(member.bytes)&&member.bytes>=0&&
      /^[a-f0-9]{64}$/.test(member.sha256||''),'GRID_CAPTURE_MANIFEST','The frozen capture roster is invalid.');
    members.set(member.path,member);
  }
  need(same(await tree(root),['capture.json',...members.keys()].sort()),
    'GRID_CAPTURE_ROSTER','A declared member is missing, or an extra/staging member remains.');
  // Stream large native files; only JSON/plan/source metadata needs to enter memory.
  for(const member of members.values()){
    const filename=join(root,member.path),before=await lstat(filename);
    const h=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW),sha=createHash('sha256');
    let count=0;
    try {
      need(before.isFile()&&(before.mode&0o077)===0&&stamp(await h.stat())===stamp(before),'GRID_CAPTURE_FILE','A frozen file changed.');
      const buffer=Buffer.alloc(196608);for(;;){const got=await h.read(buffer,0,buffer.length,null);if(!got.bytesRead)break;count+=got.bytesRead;sha.update(buffer.subarray(0,got.bytesRead));}
      need(count===member.bytes&&sha.digest('hex')===member.sha256&&stamp(await h.stat())===stamp(before)&&stamp(await lstat(filename))===stamp(before),
        'GRID_CAPTURE_FILE_HASH','A complete capture member changed.',{path:member.path});
    } finally {await h.close();}
  }
  const retained=async (item,read=true)=>{
    need(plain(item)&&members.has(item.path)&&same(members.get(item.path),{path:item.path,bytes:item.bytes,sha256:item.sha256}),
      'GRID_CAPTURE_REFERENCE','Capture references must name exact declared member identities.');
    return read?ordinary(join(root,item.path),{privateOnly:true}):undefined;
  };
  const input=inspectGridFabricProcedureInput(parse(await retained(capture.inputFile),'procedure-input.json'));
  need(same(input,capture.input)&&inputHash(input)===capture.input_sha256&&same(input.workspace,capture.workspace)&&
    input.instanceId===capture.instanceId&&input.expectedRevision===capture.revision,
    'GRID_CAPTURE_INPUT','The complete frozen input and original binding differ.');
  const catalog=parse(await retained(capture.catalogFile),'catalog.json'),previous=inspectOperatingPlan(parse(await retained(capture.previousPlan),'plan-before.json'));
  const plan=inspectOperatingPlan(parse(await retained(capture.plan),'gridfabric-plan.json'));
  checkSource(capture.source?.identity,input.workspace);
  need(Array.isArray(capture.source.members)&&capture.source.members.length===capture.source.identity.modules.length,
    'GRID_CAPTURE_SOURCE_MEMBERS','Keep every original source member.');
  const names=new Set();
  for(const item of capture.source.members){
    const declared=capture.source.identity.modules.find(m=>m.path===item.module);
    need(declared&&!names.has(item.module)&&declared.bytes===item.bytes&&declared.sha256===item.sha256,
      'GRID_CAPTURE_SOURCE_MEMBERS','Captured source bodies differ from the original declaration.');
    names.add(item.module);await retained(item);
  }
  need(Array.isArray(capture.source.helpers)&&capture.source.helpers.length===HELPER_NAMES.length&&
    same(capture.source.helpers.map(m=>m.module),HELPER_NAMES),'GRID_CAPTURE_HELPERS','Keep the complete executing helper source roster.');
  for(const item of capture.source.helpers)await retained(item);
  const responseValues=new Map();
  for(const response of capture.responses||[]){
    need(READS.has(response.operation)&&!responseValues.has(response.path),'GRID_CAPTURE_RESPONSE','Unexpected or duplicate original read.');
    const value=parse(await retained(response),'original response'),meta=parse(await retained(response.metadata),'response metadata');
    need(meta.operation===response.operation&&same(meta.payload,response.payload)&&meta.workspace_id===input.workspace.workspace_id,
      'GRID_CAPTURE_RESPONSE','Original response metadata differs from the frozen read.');
    responseValues.set(response.path,{value,response});
  }
  const responseValue=item=>{
    need(responseValues.has(item?.path),'GRID_CAPTURE_RESPONSE_MISSING','An original response is missing.');
    const entry=responseValues.get(item.path);
    need(item.bytes===entry.response.bytes&&item.sha256===entry.response.sha256&&
      item.operation===entry.response.operation&&same(item.payload,entry.response.payload)&&same(item.metadata,entry.response.metadata),
      'GRID_CAPTURE_RESPONSE_REFERENCE','The complete original response reference changed.');
    return entry.value;
  };
  checkLaunch(responseValue(capture.observations.beforeLaunch),input);
  checkLaunch(responseValue(capture.observations.afterLaunch),input);
  checkState(responseValue(capture.observations.beforeState),input);
  checkState(responseValue(capture.observations.afterState),input);
  need(same(responseValue(capture.observations.beforeLaunch),responseValue(capture.observations.afterLaunch))&&
    same(responseValue(capture.observations.beforeState),responseValue(capture.observations.afterState))&&
    same(responseValue(capture.source.response),capture.source.identity),
    'GRID_CAPTURE_CHANGED','The retained beginning/end/source observations differ.');
  responseValue(capture.source.contracts);
  const pageRow=(item,response)=>{
    const entry=responseValues.get(item.path);
    if(!entry.rowsById)entry.rowsById=new Map(response.rows.map(row=>[row?.id,row]));
    return entry.rowsById.get(item.pageRowId);
  };
  const associations=new Set(),recordIndex=new Map();
  for(const item of capture.records||[]){
    const key=associationKey(item.stepId,item.collection,item.id),response=responseValue(item);
    const original=item.operation==='detail'&&same(item.payload,{collection:item.collection,id:item.id})
      ? response.record : item.operation==='page'&&item.payload?.collection===item.collection&&
        item.pageRowId===item.id&&Array.isArray(response.rows)
        ? pageRow(item,response) : undefined;
    need(STEPS.includes(item.stepId)&&TABLES.includes(item.collection)&&!associations.has(key)&&
      response.collection===item.collection&&(item.operation!=='detail'||response.id===item.id)&&
      plain(original)&&same(original,item.record)&&(item.record.instance_id===undefined||item.record.instance_id===input.instanceId),
      'GRID_CAPTURE_RECORD','A retained original record does not match its complete detail or page row.');
    associations.add(key);recordIndex.set(key,item);await retained(item,false);
  }
  for(const page of capture.pages||[]){
    let offset=0;const ids=new Set();
    for(const ref of page.responses||[]){
      const p=responseValue(ref);
      need(ref.operation==='page'&&same(ref.payload,{collection:page.collection,scope:page.scope,offset,limit:1000,order:'asc'})&&
        p.collection===page.collection&&p.offset===offset&&p.total===page.total&&p.limit===1000&&Array.isArray(p.rows)&&p.rows.length<=1000,
        'GRID_CAPTURE_PAGE','The frozen original page sequence differs.');
      for(const row of p.rows){
        const full=recordIndex.get(associationKey(page.stepId,page.collection,row.id));
        need(typeof row.id==='string'&&!ids.has(row.id)&&full&&same(row,{id:row.id,...full.record}),
          'GRID_CAPTURE_PAGE','A page contains a duplicate or differs from the retained full record.');ids.add(row.id);
      }
      offset+=p.rows.length;
      need(p.next_offset===(offset<page.total?offset:null),'GRID_CAPTURE_PAGE','The frozen page continuation differs.');
    }
    need(offset===page.total&&same([...ids],page.rows)&&page.rows.every(id=>associations.has(associationKey(page.stepId,page.collection,id))),
      'GRID_CAPTURE_PAGE','A dependent page is incomplete or a full record is missing.');
  }
  const fileAssociations=new Set(),fileIndex=new Map();
  for(const item of capture.files||[]){
    const key=JSON.stringify([item.stepId,item.fileId]),meta=parse(await retained(item.metadata),'native file metadata');
    need(STEPS.includes(item.stepId)&&!fileAssociations.has(key)&&meta.file_id===item.fileId&&
      meta.workspace_id===input.workspace.workspace_id&&meta.bytes===item.bytes&&meta.sha256===item.sha256,
      'GRID_CAPTURE_NATIVE_FILE','The complete native file metadata differs.');
    fileAssociations.add(key);fileIndex.set(key,item);await retained(item,false);
  }
  need(associations.has(associationKey('configuration','instances',input.instanceId)),
    'GRID_CAPTURE_INSTANCE','Keep the original selected instance.');
  const scoped=new Map();
  for(const page of capture.pages||[]){
    const key=JSON.stringify([page.stepId,page.collection,page.scope]);
    need(!scoped.has(key),'GRID_CAPTURE_PAGE_DUPLICATE','A dependent scope appears more than once for a step.');
    scoped.set(key,page);
  }
  for(const item of capture.records){
    const r=item.record,required=[];
    for(const [table,id] of references(item.collection,r))
      need(associations.has(associationKey(item.stepId,table,id)),
        'GRID_CAPTURE_DEPENDENCY','A complete original dependent record is missing.',{collection:table,id});
    for(const f of descriptors(r)){
      const full=fileIndex.get(JSON.stringify([item.stepId,'file_'+f.descriptor.sha256]));
      need(full&&full.sha256===f.descriptor.sha256&&full.bytes===f.descriptor.bytes,
        'GRID_CAPTURE_DEPENDENCY','A referenced complete original file is missing.');
    }
    if(item.collection==='operations'&&r.action==='import_source'&&/^[a-f0-9]{64}$/.test(r.input?.file_sha256||''))
      need(fileAssociations.has(JSON.stringify([item.stepId,'file_'+r.input.file_sha256])),
        'GRID_CAPTURE_DEPENDENCY','The selected import operation original file is missing.');
    if(item.collection==='instances')required.push(['instance_editions',item.id]);
    if(item.collection==='sources'){
      required.push(['source_issues',item.id]);
      for(const scope of new Set((r.device_channels||[]).map(c=>item.id+'\0'+c.device_id+'\0'+c.channel)))
        required.push(['source_rows',scope]);
    }
    for(const [parent,child] of [['reports','report_rows'],['callbacks','callback_deliveries'],['management_operations','management_receipts']])
      if(item.collection===parent)required.push([child,item.id]);
    if(item.collection==='events')for(const table of ['event_revisions','opt_decisions','device_actions'])required.push([table,item.id]);
    for(const [table,scope] of required)need(scoped.has(JSON.stringify([item.stepId,table,scope])),
      'GRID_CAPTURE_DEPENDENCY','A complete original dependent page set is missing.',{collection:table,scope});
    if(item.collection==='sources'){
      const count=required.filter(([table])=>table==='source_rows').reduce((n,[table,scope])=>n+scoped.get(JSON.stringify([item.stepId,table,scope])).total,0);
      need(count===(r.device_channels||[]).reduce((n,c)=>n+c.rows,0),
        'GRID_CAPTURE_SOURCE_ROWS','The frozen parsed source-row count differs.');
    }
  }
  const expectedPlan=recordGridFabricProcedure(previous,capture,{input,savedAt:capture.capturedAt});
  need(same(plan,expectedPlan),'GRID_CAPTURE_PLAN','The complete original plan history differs from the captured inputs.');
  need((await retained(capture.html)).equals(Buffer.from(renderOperatingPlanHTML(plan),'utf8'))&&
    (await retained(capture.markdown)).equals(Buffer.from(renderOperatingPlanMarkdown(plan),'utf8')),
    'GRID_CAPTURE_RENDER','The complete plan handovers differ from their original saved history.');
  return {directory:root,plan,capture,input,catalog,receipt:{schema:'stellar-forge.gridfabric-procedure-capture-receipt.v1',
    directory:root,path:'capture.json',bytes:raw.length,sha256:hash(raw),workspace:clone(input.workspace),revision:input.expectedRevision}};
}
