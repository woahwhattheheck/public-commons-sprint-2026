// MIT. Receive one application contract on its original Redis and Valkey workspaces.
import { open, lstat, mkdir, realpath, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { acquirePrivateDirectoryWriter } from '../../operations/history.mjs';
import { normalizeRedisCommissioning, commissionRedis, redisCommissioningTemplate } from './commission.mjs';
import { openRedisAuthoringWorkspace, redisWorkspaceBinding } from './model.mjs';

export const REDIS_CUTOVER_SCHEMA='stellar-forge.redis-cutover-input.v1';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const ordered=v=>Array.isArray(v)?v.map(ordered):plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const stable=v=>JSON.stringify(ordered(v));
const encode=v=>JSON.stringify(v,null,2)+'\n';
const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=(code,message,details)=>Object.assign(new Error(message),{code,details});
const clone=v=>structuredClone(v);
function fields(v,allowed,label){
  if(!plain(v)||Object.keys(v).some(k=>!allowed.includes(k)))
    throw fail('REDIS_CUTOVER_FIELDS_INVALID','Use the supported '+label+' fields.');
}
function text(v,label,max=1000){
  if(typeof v!=='string'||!v.trim()||!v.isWellFormed()||v.length>max||/[\x00-\x1f\x7f]/.test(v))
    throw fail('REDIS_CUTOVER_TEXT_INVALID','Record '+label+' as ordinary text within '+max+' characters.');
}
function id(v){if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v))
  throw fail('REDIS_CUTOVER_ID_INVALID','Use an operation ID within 80 letters, digits, underscores or hyphens.');}
function contract(selected){
  return {queries:selected.setup.source.queries,routes:selected.setup.plan.routes,
    payment:selected.setup.plan.payment,checks:selected.checks};
}
export function normalizeRedisCutover(input,environment=process.env){
  fields(input,['schema','operationId','consistency','baseline','candidate','comparisons','release','maxComparisonBytes'],'cutover input');
  if(input.schema!==REDIS_CUTOVER_SCHEMA)throw fail('REDIS_CUTOVER_SCHEMA_INVALID','Choose a Redis/Valkey application cutover input.');
  id(input.operationId);
  if(Buffer.byteLength(encode(input))>8388608)throw fail('REDIS_CUTOVER_INPUT_TOO_LARGE','Keep the complete input within 8 MiB.');
  fields(input.consistency,['mode','reference','approvedBy'],'source edition');
  if(!['immutable-edition','paused-writes'].includes(input.consistency.mode))
    throw fail('REDIS_CUTOVER_CONSISTENCY_REQUIRED','Select the agreed immutable source edition or paused-write receiving window.');
  text(input.consistency.reference,'the actual source edition or receiving window reference',2000);
  text(input.consistency.approvedBy,'the responsible receiving operator',240);
  const baseline=normalizeRedisCommissioning(input.baseline,environment);
  const candidate=normalizeRedisCommissioning(input.candidate,environment);
  if(input.baseline.operationId===input.candidate.operationId||input.baseline.requestId===input.candidate.requestId)
    throw fail('REDIS_CUTOVER_OPERATIONS_DISTINCT','Use separate original creation/receiving IDs for the two source workspaces.');
  if(input.baseline.release!==undefined||input.candidate.release!==undefined)
    throw fail('REDIS_CUTOVER_RELEASE_ORDER','Choose an optional top-level candidate release; receiving compares both sources before staging it.');
  if(stable(contract(baseline))!==stable(contract(candidate)))
    throw fail('REDIS_CUTOVER_CONTRACT_CHANGED','Keep the approved queries, routes, payment terms and receiving examples identical on both deployments.');
  if(!Array.isArray(input.comparisons)||input.comparisons.length!==baseline.checks.length)
    throw fail('REDIS_CUTOVER_COMPARISONS_REQUIRED','Choose one comparison rule for every approved receiving example.');
  const seen=new Set();
  const comparisons=input.comparisons.map(item=>{
    fields(item,['checkId','mode'],'comparison');
    const check=baseline.checks.find(c=>c.id===item.checkId);
    if(!check||seen.has(item.checkId)||!['ordered','multiset','set'].includes(item.mode))
      throw fail('REDIS_CUTOVER_COMPARISON_INVALID','Choose each original check once with ordered, multiset or set comparison.');
    seen.add(item.checkId);
    const kind=baseline.setup.source.queries[check.query].kind;
    if(kind==='set'&&item.mode!=='set')
      throw fail('REDIS_CUTOVER_SET_COMPARISON','Compare complete native SSCAN results as member sets; page order and duplicate visits are not the membership contract.');
    if(kind!=='set'&&item.mode==='set')
      throw fail('REDIS_CUTOVER_SET_COMPARISON','Set comparison is reserved for an original set query.');
    if(['list','stream','sorted-set'].includes(kind)&&item.mode!=='ordered')
      throw fail('REDIS_CUTOVER_ORDER_REQUIRED','Keep the order of list, stream and ranking results.');
    if(['set','list','stream','sorted-set'].includes(kind)&&!check.allPages)
      throw fail('REDIS_CUTOVER_COMPLETE_COLLECTION_REQUIRED','Receive every page for a collection comparison.',{checkId:check.id});
    return {...clone(item),query:check.query,kind};
  });
  const maxComparisonBytes=input.maxComparisonBytes??67108864;
  if(!Number.isSafeInteger(maxComparisonBytes)||maxComparisonBytes<1048576||maxComparisonBytes>268435456)
    throw fail('REDIS_CUTOVER_LIMIT_INVALID','Choose a comparison data budget from 1 to 256 MiB.');
  if(input.release!==undefined)normalizeRedisCommissioning({...input.candidate,release:input.release},environment);
  return {input:clone(input),baseline,candidate,comparisons,maxComparisonBytes,
    review:{schema:'stellar-forge.redis-cutover-review.v1',operationId:input.operationId,
      consistency:clone(input.consistency),contractSha256:hash(stable(contract(baseline))),
      baseline:baseline.review,candidate:candidate.review,comparisons,
      maxComparisonBytes,release:input.release??null}};
}
function multiset(rows,unique){
  const map=new Map();
  for(const row of rows){const key=stable(row),old=map.get(key);
    map.set(key,{row,count:unique?1:(old?.count??0)+1});}
  return map;
}
// Full native responses remain unchanged in the original preview operations.
// Only this explicitly selected comparison view can discard SSCAN duplicate visits.
export function compareRedisCutoverRows({baseline,candidate,mode}){
  if(!['ordered','multiset','set'].includes(mode)||!Array.isArray(baseline?.rows)||!Array.isArray(candidate?.rows)||
      !Array.isArray(baseline.columns)||!Array.isArray(candidate.columns))
    throw fail('REDIS_CUTOVER_RESULT_INVALID','Choose full original rows, columns and a comparison mode.');
  const columnsMatch=stable(baseline.columns)===stable(candidate.columns);
  const result={mode,columnsMatch,baselineRows:baseline.rows.length,candidateRows:candidate.rows.length,
    baselineSha256:hash(stable(baseline.rows)),candidateSha256:hash(stable(candidate.rows))};
  if(mode==='ordered'){
    const changed=[];
    for(let i=0;i<Math.max(baseline.rows.length,candidate.rows.length);i++){
      const left=i<baseline.rows.length,right=i<candidate.rows.length;
      if(left!==right||stable(baseline.rows[i])!==stable(candidate.rows[i]))
        changed.push({index:i,baselinePresent:left,candidatePresent:right,
          ...(left?{baseline:baseline.rows[i]}:{}),...(right?{candidate:candidate.rows[i]}:{})});
    }
    return {...result,matched:columnsMatch&&changed.length===0,changed};
  }
  const left=multiset(baseline.rows,mode==='set'),right=multiset(candidate.rows,mode==='set');
  const removed=[],added=[];
  for(const key of [...new Set([...left.keys(),...right.keys()])].sort()){
    const a=left.get(key),b=right.get(key),delta=(a?.count??0)-(b?.count??0);
    if(delta>0)removed.push({row:a.row,count:delta});
    if(delta<0)added.push({row:b.row,count:-delta});
  }
  return {...result,baselineDistinctRows:left.size,candidateDistinctRows:right.size,
    matched:columnsMatch&&removed.length===0&&added.length===0,removed,added};
}
function matchesExpected(expected,columns,rows){
  const actual={columns,rows,rowCount:rows.length,rowsSha256:hash(stable(rows))},mismatches=[];
  for(const k of ['columns','rows','rowCount','rowsSha256'])
    if(expected[k]!==undefined&&stable(expected[k])!==stable(actual[k]))mismatches.push(k);
  if(expected.requiredRows){
    const values=multiset(rows,false);
    for(const row of expected.requiredRows){
      const key=stable(row),value=values.get(key);
      if(!value?.count){mismatches.push('requiredRows');break;}
      value.count--;
    }
  }
  return {matched:mismatches.length===0,mismatches};
}
async function privateRoot(directory){
  if(typeof directory!=='string'||!directory)throw fail('REDIS_CUTOVER_DIRECTORY_REQUIRED','Choose the private cutover receiving directory.');
  const selected=resolve(directory);
  await mkdir(selected,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const st=await lstat(selected);
  if(!st.isDirectory()||st.isSymbolicLink()||process.platform!=='win32'&&
      ((st.mode&0o077)||typeof process.getuid==='function'&&st.uid!==process.getuid()))
    throw fail('REDIS_CUTOVER_DIRECTORY_INVALID','Use the original owner-private receiving directory.');
  return realpath(selected);
}
async function readJson(path,maximum=16777216){
  const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await f.stat();
    if(!before.isFile()||before.size>maximum)
      throw fail('REDIS_CUTOVER_FILE_INVALID','Choose a complete regular JSON file within its size limit.');
    const bytes=await f.readFile(),after=await f.stat();
    if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)
      throw fail('REDIS_CUTOVER_FILE_CHANGED','The selected receiving file changed during reading.');
    return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256:hash(bytes)};
  }finally{await f.close();}
}
async function writeJson(root,name,value){
  const path=join(root,name),existing=await lstat(path).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(existing&&(!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1))
    throw fail('REDIS_CUTOVER_FILE_INVALID','Keep the original regular receiving artifact.');
  const temporary=join(root,'.'+name+'-'+randomUUID()+'.tmp'),f=await open(temporary,'wx',0o600);
  try{await f.writeFile(encode(value));await f.sync();}finally{await f.close();}
  try{await rename(temporary,path);}catch(e){await unlink(temporary).catch(()=>{});throw e;}
  const d=await open(root,'r');try{await d.sync();}finally{await d.close();}
}
async function bindInput(root,input,identity){
  const file=join(root,'cutover-input.json');
  const prior=await readJson(file,16777216).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  const selected={schema:'stellar-forge.redis-cutover-selection.v1',inputSha256:identity,input};
  if(prior){
    if(stable(prior.value)!==stable(selected))
      throw fail('REDIS_CUTOVER_INPUT_CHANGED','Continue this directory with its original complete input; use a new operation for a different receiving edition.');
  }else await writeJson(root,'cutover-input.json',selected);
}
function reportBinding(report,input){
  if(report?.schema!=='stellar-forge.redis-commissioning-result.v1'||report.mode!=='receive'||
      report.operationId!==input.operationId||report.inputSha256!==hash(stable(input))||
      !['RECEIVED','ACCEPTANCE_MISMATCH'].includes(report.status)||!Array.isArray(report.checks)||
      typeof report.workspace?.workspaceId!=='string'||typeof report.workspace?.profileSha256!=='string'||
      typeof report.revisionId!=='string')
    throw fail('REDIS_CUTOVER_RECEIVING_REQUIRED','Receive both original commissioning inputs before comparing their saved outcomes.');
}
function collectCheck(workspace,report,check,maximum){
  const recorded=report.checks.find(c=>c.id===check.id);
  if(!recorded||recorded.query!==check.query||!Array.isArray(recorded.pages)||!recorded.pages.length||
      recorded.pages.length>check.maxPages)
    throw fail('REDIS_CUTOVER_CHECK_MISSING','Choose the complete original receiving check.',{checkId:check.id});
  let next=clone(check.input),columns,used=0;const rows=[],windows=[],seen=new Set();
  for(let index=0;index<recorded.pages.length;index++){
    const page=recorded.pages[index],key=stable(next);
    if(seen.has(key))throw fail('REDIS_CUTOVER_CURSOR_REPEATED','The saved receiving path repeats a native continuation.');
    seen.add(key);
    const op=workspace.operation(page.requestId);
    if(op.kind!=='preview'||op.status!=='COMPLETED'||op.input.revisionId!==report.revisionId||
        op.input.query!==check.query||stable(op.input.input)!==key||stable(page.input)!==key)
      throw fail('REDIS_CUTOVER_PAGE_BINDING_CHANGED','The recorded page does not belong to this original check/revision.');
    const data=op.result?.data;
    if(!Array.isArray(data?.rows)||!Array.isArray(data?.columns)||hash(stable(data))!==page.resultSha256||
        page.rows!==data.rows.length||stable(page.nextInput)!==stable(data.nextInput??null))
      throw fail('REDIS_CUTOVER_PAGE_CHANGED','The original full result does not match its retained receiving page.');
    columns??=data.columns;
    if(stable(columns)!==stable(data.columns))
      throw fail('REDIS_CUTOVER_COLUMNS_CHANGED','The selected query changed columns between pages.');
    used+=Buffer.byteLength(stable(data.rows));
    if(used>maximum||rows.length+data.rows.length>check.maxRows)
      throw fail('REDIS_CUTOVER_DATA_LIMIT','The retained full rows exceed the selected comparison budget.');
    rows.push(...data.rows);windows.push(op.result.observedAt);
    const continuation=data.nextInput??null;
    if(index+1<recorded.pages.length){
      if(!check.allPages||!plain(continuation))
        throw fail('REDIS_CUTOVER_PAGE_SEQUENCE_INVALID','A saved page continues after the original source completed.');
      next=clone(continuation);
    }else if(check.allPages&&continuation!==null)
      throw fail('REDIS_CUTOVER_PAGE_SEQUENCE_INCOMPLETE','Keep receiving until the native continuation completes.');
  }
  if(rows.length!==recorded.rowCount||hash(stable(rows))!==recorded.rowsSha256)
    throw fail('REDIS_CUTOVER_AGGREGATE_CHANGED','The full original rows differ from their receiving outcome.');
  return {rows,columns,windows,expected:matchesExpected(check.expected,columns,rows),bytes:used};
}
async function compareSaved(root,selected,reports,environment){
  const workspaces={},result=[];
  try{
    for(const side of ['baseline','candidate']){
      const report=reports[side],input=selected.input[side];reportBinding(report,input);
      const w=await openRedisAuthoringWorkspace(join(root,side),{environment,
        expectedWorkspaceId:report.workspace.workspaceId,expectedProfileSha256:report.workspace.profileSha256});
      workspaces[side]=w;
      const revision=w.revision(report.revisionId);
      if(stable(revision.source.queries)!==stable(selected[side].setup.source.queries)||
          stable(revision.plan)!==stable(selected[side].setup.plan))
        throw fail('REDIS_CUTOVER_REVISION_CHANGED','The retained receiving revision differs from the selected application contract.');
    }
    for(const rule of selected.comparisons){
      const check=selected.baseline.checks.find(c=>c.id===rule.checkId);
      const baseline=collectCheck(workspaces.baseline,reports.baseline,check,selected.maxComparisonBytes);
      const candidate=collectCheck(workspaces.candidate,reports.candidate,check,selected.maxComparisonBytes-baseline.bytes);
      const difference=compareRedisCutoverRows({baseline,candidate,mode:rule.mode});
      const full={schema:'stellar-forge.redis-cutover-difference.v1',...rule,
        baselineColumns:baseline.columns,candidateColumns:candidate.columns,
        baselineExpected:baseline.expected,candidateExpected:candidate.expected,...difference};
      const file='difference-'+rule.checkId+'.json';await writeJson(root,file,full);
      result.push({...rule,matched:difference.matched,
        expectationsMatch:baseline.expected.matched&&candidate.expected.matched,
        baselineRows:difference.baselineRows,candidateRows:difference.candidateRows,
        baselineSha256:difference.baselineSha256,candidateSha256:difference.candidateSha256,
        file,differenceSha256:hash(encode(full)),
        windows:{baseline:baseline.windows,candidate:candidate.windows}});
    }
    const match=result.every(r=>r.matched&&r.expectationsMatch);
    let release=null;
    if(match&&selected.input.release){
      const w=workspaces.candidate,report=reports.candidate;
      if(report.status!=='RECEIVED'||!report.package?.requestId)
        throw fail('REDIS_CUTOVER_PACKAGE_REQUIRED','Complete the original candidate customer package before staging.');
      const packageRecord=w.operation(report.package.requestId);
      if(packageRecord.kind!=='prepare'||packageRecord.status!=='COMPLETED'||
          packageRecord.input.revisionId!==report.revisionId||
          packageRecord.result.manifestSha256!==report.package.manifestSha256)
        throw fail('REDIS_CUTOVER_PACKAGE_CHANGED','The selected candidate package differs from its original receiving result.');
      const requestId='cutover-'+hash(selected.input.operationId+'\nstage').slice(0,48);
      let op=await w.stage({requestId,packageId:report.package.requestId,...selected.input.release});
      if(op.status==='INTERRUPTED')op=await w.resume(op.id);
      if(op.status!=='COMPLETED')throw fail('REDIS_CUTOVER_RELEASE_INCOMPLETE','Continue the original candidate release operation.',{requestId:op.id,status:op.status,error:op.error});
      release={requestId:op.id,...op.result};
    }
    return {comparisons:result,release,status:match?'RECEIVED':'CONTRACT_MISMATCH',
      workspaceBindings:Object.fromEntries(Object.entries(workspaces).map(([side,w])=>[side,redisWorkspaceBinding(w.metadata())]))};
  }finally{
    const errors=[];
    for(const w of Object.values(workspaces).reverse())try{await w.close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Close the original cutover workspace handles.');
  }
}
export async function receiveRedisCutover({input,inputSha256,directory,environment=process.env,mode='review'}={}){
  if(!['review','create','receive','compare'].includes(mode))
    throw fail('REDIS_CUTOVER_MODE_INVALID','Choose review, create, receive or compare.');
  const selected=normalizeRedisCutover(input,environment),identity=inputSha256??hash(stable(input));
  if(!/^[a-f0-9]{64}$/.test(identity))throw fail('REDIS_CUTOVER_DIGEST_INVALID','Use the complete selected input SHA256.');
  const initial={schema:'stellar-forge.redis-cutover-result.v1',operationId:input.operationId,
    inputSha256:identity,mode,review:selected.review};
  if(mode==='review')return {...initial,status:'REVIEWED'};
  const root=await privateRoot(directory),lease=await acquirePrivateDirectoryWriter(root);
  try{
    await bindInput(root,input,identity);const reports={};
    for(const side of ['baseline','candidate']){
      if(mode==='compare')reports[side]=(await readJson(join(root,side+'-receiving.json'))).value;
      else{
        reports[side]=await commissionRedis({input:input[side],inputSha256:hash(stable(input[side])),
          directory:join(root,side),environment,mode:mode==='create'?'create':'receive'});
        await writeJson(root,side+(mode==='create'?'-created.json':'-receiving.json'),reports[side]);
      }
    }
    if(mode==='create'){
      const result={...initial,status:'CREATED',directory:root,
        workspaceBindings:Object.fromEntries(Object.entries(reports).map(([side,r])=>[side,r.workspace]))};
      await writeJson(root,'cutover-created.json',result);return result;
    }
    const compared=await compareSaved(root,selected,reports,environment);
    const result={...initial,...compared,directory:root,
      packages:Object.fromEntries(Object.entries(reports).map(([side,r])=>[side,r.package??null]))};
    await writeJson(root,'cutover-result.json',result);return result;
  }catch(error){
    await writeJson(root,'cutover-error.json',{schema:'stellar-forge.redis-cutover-error.v1',
      operationId:input.operationId,inputSha256:identity,observedAt:new Date().toISOString(),
      error:{code:error.code??'REDIS_CUTOVER_FAILED',message:error.message,details:error.details??null}}).catch(()=>{});
    throw error;
  }finally{await lease.release();}
}
export async function redisCutoverTemplate(){
  const baseline=await redisCommissioningTemplate(),candidate=clone(baseline);
  baseline.operationId='customer-redis-baseline';baseline.requestId='customer-redis-baseline-create';
  candidate.operationId='customer-valkey-candidate';candidate.requestId='customer-valkey-candidate-create';
  baseline.setup.label='Original customer Redis application';
  candidate.setup.label='Selected customer Valkey application';
  baseline.setup.source.connection.host='redis.customer.example';
  candidate.setup.source.connection.host='valkey.customer.example';
  baseline.setup.source.connection.passwordEnv='REDIS_BASELINE_PASSWORD';
  candidate.setup.source.connection.passwordEnv='VALKEY_CANDIDATE_PASSWORD';
  for(const input of [baseline,candidate]){
    for(const check of input.checks){
      const kind=input.setup.source.queries[check.query].kind;
      if(['set','list','stream','sorted-set'].includes(kind))check.allPages=true;
      // The customer replaces these editable expectations with its agreed data.
      if(kind==='set')check.expected={columns:['member']};
    }
  }
  return {schema:REDIS_CUTOVER_SCHEMA,operationId:'customer-application-cutover',
    consistency:{mode:'immutable-edition',reference:'REPLACE_WITH_CUSTOMER_SOURCE_EDITION',approvedBy:'REPLACE_WITH_RECEIVING_OPERATOR'},
    baseline,candidate,comparisons:baseline.checks.map(c=>({checkId:c.id,
      mode:baseline.setup.source.queries[c.query].kind==='set'?'set':'ordered'})),maxComparisonBytes:67108864};
}
export async function redisCutoverCli(args=process.argv.slice(2)){
  const [mode,...rest]=args;if(mode==='template'&&!rest.length)return redisCutoverTemplate();
  const options={};
  for(let i=0;i<rest.length;i+=2){
    if(!['--input','--directory'].includes(rest[i])||!rest[i+1]||options[rest[i]])
      throw fail('REDIS_CUTOVER_ARGUMENTS_INVALID','Use template, or review|create|receive|compare --input <file> [--directory <private-directory>].');
    options[rest[i]]=rest[i+1];
  }
  if(!['review','create','receive','compare'].includes(mode)||!options['--input']||(mode!=='review'&&!options['--directory']))
    throw fail('REDIS_CUTOVER_ARGUMENTS_INVALID','Choose a complete input and the original receiving directory.');
  const loaded=await readJson(options['--input'],8388608);
  return receiveRedisCutover({input:loaded.value,inputSha256:loaded.sha256,directory:options['--directory'],mode});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await redisCutoverCli();process.stdout.write(encode(result));if(result.status==='CONTRACT_MISMATCH')process.exitCode=2;}
  catch(error){process.stderr.write(encode({error:{code:error.code??'REDIS_CUTOVER_FAILED',message:error.message,details:error.details??null}}));process.exitCode=1;}
}
