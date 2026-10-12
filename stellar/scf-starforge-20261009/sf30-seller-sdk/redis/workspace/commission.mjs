// MIT. Commission customer inputs through the original Redis setup and workspace.
import { readFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { normalizeRedisSetup, createRedisConnectionSetup, redisSetupTemplates } from './setup-model.mjs';
import { compileRedisQueries, bindRedisQuery } from '../declaration.mjs';
import { redisWorkspaceBinding } from './model.mjs';

export const REDIS_COMMISSIONING_SCHEMA = 'stellar-forge.redis-commissioning-input.v1';
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const ordered = v => Array.isArray(v) ? v.map(ordered) : plain(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
const stable = v => JSON.stringify(ordered(v));
const hash = v => createHash('sha256').update(v).digest('hex');
const encode = v => JSON.stringify(v, null, 2) + '\n';
const issue = (code, message, details) => Object.assign(new Error(message), {code, details});
function fields(value, names, label) {
  if (!plain(value) || Object.keys(value).some(k => !names.includes(k)))
    throw issue('REDIS_COMMISSIONING_FIELDS_INVALID', 'Use the supported ' + label + ' fields.');
}
function identifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value))
    throw issue('REDIS_COMMISSIONING_ID_INVALID', label + ' needs 1–80 letters, digits, underscores or hyphens.');
}
function integer(value, low, high, label) {
  if (!Number.isSafeInteger(value) || value < low || value > high)
    throw issue('REDIS_COMMISSIONING_LIMIT_INVALID', label + ' must be an integer from ' + low + ' to ' + high + '.');
}
function expected(value) {
  fields(value, ['columns','rows','requiredRows','rowCount','rowsSha256'], 'expected result');
  if (!Object.keys(value).length)
    throw issue('REDIS_COMMISSIONING_EXPECTED_REQUIRED', 'Record the receiving example’s expected result.');
  for (const name of ['columns','rows','requiredRows'])
    if (value[name] !== undefined && !Array.isArray(value[name]))
      throw issue('REDIS_COMMISSIONING_EXPECTED_INVALID', name + ' must be an array.');
  if (value.rowCount !== undefined) integer(value.rowCount, 0, 100000, 'Expected row count');
  if (value.rowsSha256 !== undefined && !/^[a-f0-9]{64}$/.test(value.rowsSha256))
    throw issue('REDIS_COMMISSIONING_EXPECTED_INVALID', 'Use the SHA256 of canonical JSON rows.');
}
export function normalizeRedisCommissioning(input, environment = process.env) {
  fields(input, ['schema','operationId','requestId','setup','checks','release'], 'commissioning input');
  if (input.schema !== REDIS_COMMISSIONING_SCHEMA)
    throw issue('REDIS_COMMISSIONING_SCHEMA_INVALID', 'Choose a Redis commissioning input.');
  if (Buffer.byteLength(encode(input)) > 3145728)
    throw issue('REDIS_COMMISSIONING_INPUT_TOO_LARGE', 'Keep commissioning input within 3 MiB.');
  identifier(input.operationId, 'Operation ID'); identifier(input.requestId, 'Creation request ID');
  const setup = normalizeRedisSetup(input.setup, environment), compiled = compileRedisQueries(setup.source.queries);
  if (!Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 24)
    throw issue('REDIS_COMMISSIONING_CHECKS_INVALID', 'Select 1–24 actual customer receiving examples.');
  const ids = new Set(), queries = new Set();
  const checks = input.checks.map(check => {
    fields(check, ['id','query','input','allPages','maxPages','maxRows','expected'], 'receiving example');
    identifier(check.id, 'Example ID');
    if (ids.has(check.id)) throw issue('REDIS_COMMISSIONING_CHECK_DUPLICATE', 'Use distinct receiving example IDs.');
    ids.add(check.id);
    if (typeof check.query !== 'string' || !Object.hasOwn(compiled, check.query) || !plain(check.input))
      throw issue('REDIS_COMMISSIONING_QUERY_INVALID', 'Select a declared query and its input object.');
    bindRedisQuery(compiled[check.query], check.input);
    queries.add(check.query); expected(check.expected);
    if (check.allPages !== undefined && typeof check.allPages !== 'boolean')
      throw issue('REDIS_COMMISSIONING_PAGING_INVALID', 'allPages must be true or false.');
    const maxPages = check.maxPages ?? 100, maxRows = check.maxRows ?? 10000;
    integer(maxPages, 1, 1000, 'Maximum pages'); integer(maxRows, 1, 100000, 'Maximum collected rows');
    return {...structuredClone(check), allPages:check.allPages ?? false, maxPages, maxRows};
  });
  const missing = [...new Set(setup.plan.routes.map(r => r.query))].filter(name => !queries.has(name));
  if (missing.length) throw issue('REDIS_COMMISSIONING_PRODUCT_UNCOVERED',
    'Add a receiving example for each selected customer product.', {queries:missing});
  if (input.release !== undefined) {
    fields(input.release, ['releaseId','label','runtime'], 'retained release');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.release.releaseId ?? ''))
      throw issue('REDIS_COMMISSIONING_RELEASE_INVALID', 'Use the selected lowercase release ID.');
    if (input.release.label !== undefined && (typeof input.release.label !== 'string' ||
        input.release.label.length > 240 || !input.release.label.isWellFormed()))
      throw issue('REDIS_COMMISSIONING_RELEASE_INVALID', 'Use a release label within 240 characters.');
    if (input.release.runtime !== undefined) {
      fields(input.release.runtime, ['port','facilitator','allowLocalFacilitator'], 'release runtime');
      if (input.release.runtime.port !== undefined) integer(input.release.runtime.port, 0, 65535, 'Merchant port');
      if (input.release.runtime.facilitator !== undefined) {
        let url; try { url = new URL(input.release.runtime.facilitator); } catch {}
        if (!url || !['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash)
          throw issue('REDIS_COMMISSIONING_RUNTIME_INVALID', 'Use the selected HTTP(S) facilitator URL.');
      }
      if (input.release.runtime.allowLocalFacilitator !== undefined &&
          typeof input.release.runtime.allowLocalFacilitator !== 'boolean')
        throw issue('REDIS_COMMISSIONING_RUNTIME_INVALID', 'allowLocalFacilitator must be a boolean.');
    }
  }
  return {schema:REDIS_COMMISSIONING_SCHEMA, input:structuredClone(input), setup, checks,
    review:{schema:'stellar-forge.redis-commissioning-review.v1', operationId:input.operationId,
      requestId:input.requestId, setup:setup.review,
      checks:checks.map(c => ({id:c.id,query:c.query,input:c.input,allPages:c.allPages,
        maxPages:c.maxPages,maxRows:c.maxRows,expected:c.expected})),
      release:input.release ?? null}};
}
function resultMatches(expectedResult, columns, rows) {
  const observed = {columns, rows, rowCount:rows.length, rowsSha256:hash(stable(rows))};
  const mismatches = [];
  for (const key of ['columns','rows','rowCount','rowsSha256'])
    if (expectedResult[key] !== undefined && stable(expectedResult[key]) !== stable(observed[key]))
      mismatches.push(key);
  if (expectedResult.requiredRows) {
    // Match a multiset: duplicate expected rows need duplicate actual rows.
    const available = new Map();
    for (const row of rows) { const k=stable(row); available.set(k,(available.get(k)??0)+1); }
    for (const row of expectedResult.requiredRows) {
      const k=stable(row), count=available.get(k)??0;
      if (!count) { mismatches.push('requiredRows'); break; }
      available.set(k,count-1);
    }
  }
  return {passed:mismatches.length===0, mismatches, observed};
}
async function completed(workspace, action) {
  let record = await action();
  if (record.status === 'INTERRUPTED') record = await workspace.resume(record.id);
  if (record.status !== 'COMPLETED')
    throw issue('REDIS_COMMISSIONING_OPERATION_INCOMPLETE',
      'Continue the original saved operation after resolving its recorded error.',
      {requestId:record.id,status:record.status,error:record.error});
  return record;
}
function requestId(input, suffix) { return 'commission-'+hash(input.operationId+'\n'+suffix).slice(0,48); }

export async function commissionRedis({input, inputSha256, directory, environment=process.env, mode='review'}={}) {
  if (!['review','create','receive'].includes(mode))
    throw issue('REDIS_COMMISSIONING_MODE_INVALID', 'Choose review, create or receive.');
  const selected = normalizeRedisCommissioning(input, environment);
  const identity = inputSha256 ?? hash(stable(input));
  if (!/^[a-f0-9]{64}$/.test(identity))
    throw issue('REDIS_COMMISSIONING_DIGEST_INVALID', 'Use the original complete input SHA256.');
  const report = {schema:'stellar-forge.redis-commissioning-result.v1', mode,
    inputSha256:identity, operationId:input.operationId, review:selected.review};
  if (mode === 'review') return {...report,status:'REVIEWED'};
  if (mode === 'receive' && selected.setup.review.environment.some(v=>!v.available))
    throw issue('REDIS_COMMISSIONING_ENVIRONMENT_REQUIRED',
      'Set the named source variables in the receiving process environment.',
      {names:selected.setup.review.environment.filter(v=>!v.available).map(v=>v.name)});
  const setup = await createRedisConnectionSetup({directory,initial:input.setup,environment,
    operationId:input.operationId,inputSha256:identity});
  try {
    const review=setup.review(input.setup);
    const created=await setup.create({draft:input.setup,digest:review.digest,requestId:input.requestId});
    report.workspace=created;
    if (mode === 'create') return {...report,status:'CREATED'};
    const workspace=setup.workspace, meta=workspace.metadata(), revision=workspace.revision(meta.head);
    if (stable(revision.source.queries)!==stable(selected.setup.source.queries) ||
        stable(revision.plan)!==stable(selected.setup.plan))
      throw issue('REDIS_COMMISSIONING_REVISION_CHANGED',
        'The operator has saved different product inputs. Review that revision in its original workspace.');
    report.revisionId=revision.id; report.checks=[];
    for (const check of selected.checks) {
      const rows=[], pages=[], cursors=new Set(); let columns, next=structuredClone(check.input);
      for (let page=0;;page++) {
        const cursor=stable(next);
        if (cursors.has(cursor)) throw issue('REDIS_COMMISSIONING_CURSOR_REPEATED',
          'The original source returned a repeated continuation.',{check:check.id,input:next});
        cursors.add(cursor);
        const op=await completed(workspace,()=>workspace.preview({
          requestId:requestId(input,'preview-'+check.id+'-'+page),
          revisionId:revision.id,query:check.query,input:next}));
        const data=op.result.data;
        if (!Array.isArray(data.rows) || !Array.isArray(data.columns))
          throw issue('REDIS_COMMISSIONING_RESULT_INVALID','The original query result is incomplete.');
        columns ??= data.columns;
        if (stable(columns)!==stable(data.columns))
          throw issue('REDIS_COMMISSIONING_COLUMNS_CHANGED','The query columns changed during receiving.');
        if (rows.length+data.rows.length>check.maxRows)
          throw issue('REDIS_COMMISSIONING_RECEIVING_LIMIT',
            'The full native batch exceeds the selected receiving row budget.',{check:check.id,requestId:op.id});
        rows.push(...data.rows);
        const continuation=data.nextInput;
        pages.push({requestId:op.id,observedAt:op.result.observedAt,input:next,
          rows:data.rows.length,resultSha256:hash(stable(data)),
          nextInput:continuation??null,scanCursor:data.scanCursor??null,scanComplete:data.scanComplete??null});
        // Empty SSCAN pages still carry a native continuation. Never use rowCount
        // or the requested COUNT hint to decide whether another page exists.
        if (!check.allPages || continuation === undefined || continuation === null) break;
        if (!plain(continuation))
          throw issue('REDIS_COMMISSIONING_CONTINUATION_INVALID','Use the source’s exact nextInput object.');
        if (page+1>=check.maxPages)
          throw issue('REDIS_COMMISSIONING_RECEIVING_LIMIT',
            'The selected receiving page budget was reached with a native continuation remaining.',
            {check:check.id,requestId:op.id,nextInput:continuation});
        next=structuredClone(continuation);
      }
      const match=resultMatches(check.expected,columns,rows);
      report.checks.push({id:check.id,query:check.query,passed:match.passed,
        mismatches:match.mismatches,rowCount:rows.length,rowsSha256:match.observed.rowsSha256,pages});
    }
    if (report.checks.some(c=>!c.passed))
      return {...report,status:'ACCEPTANCE_MISMATCH'};
    const prepared=await completed(workspace,()=>workspace.prepare({
      requestId:requestId(input,'prepare'),revisionId:revision.id}));
    const customerFiles=[];
    for (const name of Object.keys(prepared.result.files ?? {}).filter(n=>n==='openapi.json'||n.startsWith('client/'))) {
      const file=await workspace.file(prepared.id,name);
      customerFiles.push({path:name,bytes:file.bytes.length,sha256:hash(file.bytes)});
    }
    report.package={requestId:prepared.id,directory:prepared.result.directory,
      manifestSha256:prepared.result.manifestSha256,customerFiles};
    if (input.release) {
      const stage=await completed(workspace,()=>workspace.stage({
        requestId:requestId(input,'stage'),packageId:prepared.id,...input.release}));
      report.release={requestId:stage.id,...stage.result};
    }
    report.workspace={...report.workspace,...redisWorkspaceBinding(workspace.metadata())};
    return {...report,status:'RECEIVED'};
  } finally { await setup.close(); }
}
export async function redisCommissioningTemplate() {
  const setup=await redisSetupTemplates();
  const [source,plan]=await Promise.all(['example-collections-source.json','example-collections-plan.json']
    .map(name=>readFile(new URL('../'+name,import.meta.url),'utf8').then(JSON.parse)));
  Object.assign(setup.source.queries,source.queries);
  setup.plan.routes.push(...plan.routes);
  setup.label='Customer Valkey data products';
  return {schema:REDIS_COMMISSIONING_SCHEMA,operationId:'customer-valkey-commissioning',
    requestId:'customer-valkey-create',setup,
    checks:setup.plan.routes.map(route=>({id:route.id,query:route.query,input:route.example??{},
      allPages:false,maxPages:100,maxRows:10000,expected:{rowCount:1}}))};
}
async function readInput(path) {
  const file=await open(path,'r');
  try {
    const before=await file.stat();
    if (!before.isFile() || before.size>3145728)
      throw issue('REDIS_COMMISSIONING_INPUT_INVALID','Choose a regular JSON file within 3 MiB.');
    const bytes=await file.readFile(),after=await file.stat();
    if (bytes.length!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs)
      throw issue('REDIS_COMMISSIONING_INPUT_CHANGED','The selected input changed while reading.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return {input:JSON.parse(text),inputSha256:hash(bytes)};
  } finally { await file.close(); }
}
export async function redisCommissioningCli(args=process.argv.slice(2)) {
  const [mode,...rest]=args;
  if (mode==='template'&&rest.length===0) return redisCommissioningTemplate();
  const values={};
  for(let i=0;i<rest.length;i+=2) {
    if(!['--input','--workspace'].includes(rest[i])||!rest[i+1]||values[rest[i]])
      throw issue('REDIS_COMMISSIONING_ARGUMENTS_INVALID',
        'Use template, or review|create|receive --input <file> [--workspace <directory>].');
    values[rest[i]]=rest[i+1];
  }
  if(!['review','create','receive'].includes(mode)||!values['--input']||
      (mode!=='review'&&!values['--workspace']))
    throw issue('REDIS_COMMISSIONING_ARGUMENTS_INVALID',
      'Use template, or review|create|receive --input <file> [--workspace <directory>].');
  return commissionRedis({...await readInput(values['--input']),directory:values['--workspace'],mode});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const result=await redisCommissioningCli();
    process.stdout.write(encode(result));
    if(result.status==='ACCEPTANCE_MISMATCH')process.exitCode=2;
  } catch(error) {
    process.stderr.write(encode({error:{code:error.code??'REDIS_COMMISSIONING_FAILED',
      message:error.message,details:error.details??null}})); process.exitCode=1;
  }
}
