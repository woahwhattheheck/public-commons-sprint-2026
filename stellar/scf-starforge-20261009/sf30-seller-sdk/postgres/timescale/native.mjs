// MIT. Native TimescaleDB operations use the existing PostgreSQL connection resolver.
import { readPostgresSourceFile, resolvePostgresConnection } from '../config.mjs';
import { identity, fault, stamp } from '../publisher/files.mjs';
import { catalog, selectedAggregate, tableRows, nativeTarget, relationName, identifier, jobDefinition, only, checkText } from './contracts.mjs';
const TEXT_TYPES = Object.freeze({getTypeParser:()=>value=>value});
const VIEW_ORDER = Object.freeze({
  hypertables:'hypertable_schema, hypertable_name',
  dimensions:'hypertable_schema, hypertable_name, dimension_number',
  continuous_aggregates:'view_schema, view_name',
  chunks:'chunk_schema, chunk_name',
  jobs:'job_id', job_stats:'job_id', job_history:'id',
});
const IDENTITY_SQL = [
  "SELECT current_database() AS database_name, d.oid::text AS database_oid, current_user AS role_name,",
  "inet_server_addr()::text AS server_address, inet_server_port()::text AS server_port,",
  "current_setting('server_version') AS server_version, current_setting('server_version_num') AS server_version_num,",
  "current_setting('TimeZone') AS timezone, current_setting('DateStyle') AS date_style,",
  "current_setting('IntervalStyle') AS interval_style, current_setting('transaction_read_only') AS read_only,",
  "transaction_timestamp()::text AS observed_at FROM pg_catalog.pg_database d WHERE d.datname=current_database()",
].join(' ');
const COLUMNS_SQL = [
  "SELECT n.nspname AS schema_name, c.relname AS relation_name, c.oid::text AS relation_oid,",
  "a.attnum::text AS ordinal, a.attname AS column_name, a.atttypid::text AS type_oid,",
  "pg_catalog.format_type(a.atttypid,a.atttypmod) AS type_name,a.attnotnull AS not_null",
  "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
  "JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid",
  "JOIN timescaledb_information.continuous_aggregates g ON g.view_schema=n.nspname AND g.view_name=c.relname",
  "WHERE a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum",
].join(' ');
const PROCEDURES_SQL = [
  "SELECT n.nspname AS schema_name,p.proname AS name,p.prokind AS kind,",
  "pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,",
  "pg_catalog.pg_get_function_arguments(p.oid) AS arguments,",
  "pg_catalog.pg_get_function_result(p.oid) AS result",
  "FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace",
  "JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'",
  "JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid AND e.extname='timescaledb'",
  "WHERE p.proname IN ('refresh_continuous_aggregate','alter_job','run_job','add_continuous_aggregate_policy','remove_continuous_aggregate_policy')",
  "ORDER BY n.nspname,p.proname,p.oid",
].join(' ');
function nativeError(issue) {
  if (issue?.code?.startsWith('TIMESCALE_')) return issue;
  const sqlState = typeof issue?.code==='string' && /^[A-Z0-9]{5}$/.test(issue.code) ? issue.code : null;
  const result = fault(sqlState==='42501'?'TIMESCALE_DATABASE_PERMISSION_REQUIRED':
    sqlState==='57014'?'TIMESCALE_NATIVE_CANCELLED':'TIMESCALE_NATIVE_OPERATION_FAILED',
    'The selected database operation did not complete. Its original SQLSTATE is retained.',502);
  if (sqlState) result.sqlState=sqlState;
  return result;
}
function resultTable(result, sql) {
  const columns = result.fields.map(field=>({name:field.name,oid:String(field.dataTypeID)}));
  const rows = result.rows.map(row=>row.map(value=>value===null?null:String(value)));
  return {columns,rows,rowCount:rows.length,queryDigest:identity(sql),encoding:'postgres-text',complete:true};
}
async function table(client,sql,values=[]) {
  const result=await client.query({text:sql,values,rowMode:'array',types:TEXT_TYPES,queryMode:'extended'});
  return resultTable(result,sql);
}
async function connection(sourceFile,{environment=process.env,signal,timeoutMs=600000,timezone='UTC'}={}) {
  if (!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>2147483647) throw fault('TIMESCALE_TIMEOUT_INVALID');
  if(signal?.aborted)throw fault('TIMESCALE_NATIVE_CANCELLED');
  const declaration=await readPostgresSourceFile(sourceFile);
  const selected=await resolvePostgresConnection(declaration,environment);
  let Client;
  try {({Client}=await import('pg'));}catch{throw fault('TIMESCALE_POSTGRES_DRIVER_UNAVAILABLE');}
  const client=new Client({...selected,connectionTimeoutMillis:declaration.config.connectTimeoutMs??5000,
    application_name:'sf30-timescale-operator',query_timeout:0,statement_timeout:timeoutMs,
    idle_in_transaction_session_timeout:timeoutMs+1000});
  let closing=null;
  const close=()=>closing??=(async()=>{signal?.removeEventListener('abort',abort);await client.end();})();
  const abort=()=>{close().catch(()=>{});};
  client.on('error',()=>{});
  signal?.addEventListener('abort',abort,{once:true});
  try {
    await client.connect();
    if(signal?.aborted)throw fault('TIMESCALE_NATIVE_CANCELLED');
    await client.query({text:"SELECT set_config('search_path','pg_catalog',false), set_config('TimeZone',$1,false),"+
      " set_config('DateStyle','ISO, YMD',false), set_config('IntervalStyle','iso_8601',false),"+
      " set_config('bytea_output','hex',false),set_config('lock_timeout',$2,false)",
      values:[timezone,String(declaration.config.lockTimeoutMs??5000)],queryMode:'extended'});
    return {client,close,declaration};
  }catch(issue){await close().catch(()=>{});throw nativeError(issue);}
}
async function captureOn(client,{id,title,note,sourceDigest,signal,onProgress}={}) {
  const tables={},startedAt=stamp();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    tables.identity=await table(client,IDENTITY_SQL);
    const extensionSQL="SELECT e.extname,e.extversion,n.nspname AS extension_schema FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname";
    tables.extensions=await table(client,extensionSQL);
    const installed=tableRows(tables.extensions).find(row=>row.extname==='timescaledb');
    if(!installed)throw fault('TIMESCALE_EXTENSION_REQUIRED','Install or select the actual TimescaleDB source before capture.',409);
    // Use the optional native system identifier when this role can read it.
    const allowed=await table(client,"SELECT pg_catalog.has_function_privilege(current_user,'pg_catalog.pg_control_system()','EXECUTE') AS permitted");
    if(tableRows(allowed)[0]?.permitted==='t'){
      const control=await table(client,'SELECT system_identifier::text FROM pg_catalog.pg_control_system()');
      tables.identity.columns.push({name:'system_identifier',oid:'25'});
      tables.identity.rows[0].push(tableRows(control)[0].system_identifier);
    }
    for(const [view,order] of Object.entries(VIEW_ORDER)){
      if(signal?.aborted)throw fault('TIMESCALE_NATIVE_CANCELLED');
      tables[view]=await table(client,'SELECT * FROM timescaledb_information.'+view+' ORDER BY '+order);
      onProgress?.({table:view,rows:tables[view].rows.length});
    }
    // The public jobs view omits timezone. Read the actual schedule field from
    // its original catalog, under the same selected role and snapshot.
    tables.job_schedules=await table(client,'SELECT id,timezone FROM _timescaledb_catalog.bgw_job ORDER BY id');
    tables.columns=await table(client,COLUMNS_SQL);
    tables.procedures=await table(client,PROCEDURES_SQL);
    await client.query('COMMIT');
    return {schema:'stellar-forge.timescale-edition.v1',id,title,note,sourceDigest,startedAt,completedAt:stamp(),
      complete:true,transaction:{isolation:'REPEATABLE READ',readOnly:true},
      visibility:'Native metadata and job history visible to the selected database role.',tables};
  }catch(issue){await client.query('ROLLBACK').catch(()=>{});throw nativeError(issue);}
}
async function captureTimescale(sourceFile,options={}) {
  const active=await connection(sourceFile,options);
  try{return await captureOn(active.client,options);}finally{await active.close();}
}
async function normalizeWindow(client,window) {
  const type=window.timeType;
  if(!['timestamptz','timestamp','date','smallint','integer','bigint'].includes(type))throw fault('TIMESCALE_TIME_TYPE_INVALID');
  const response=await table(client,'SELECT ($1::'+type+')::text AS window_start, ($2::'+type+')::text AS window_end, $1::'+type+' < $2::'+type+' AS ordered',[window.start,window.end]);
  const row=tableRows(response)[0];
  if(row.ordered!=='t')throw fault('TIMESCALE_WINDOW_ORDER_INVALID','Window start must precede window end.');
  return {...window,start:row.window_start,end:row.window_end};
}
function procedure(edition,name,argument=null) {
  const matches=tableRows(edition.tables.procedures).filter(row=>row.name===name&&(!argument||row.arguments.includes(argument)));
  if(matches.length!==1)throw fault('TIMESCALE_NATIVE_SIGNATURE_REQUIRED','The selected extension does not expose the requested native operation.',409);
  return identifier(matches[0].schema_name)+'.'+identifier(name);
}
function validateOriginal(edition,plan) {
  if(identity(nativeTarget(edition))!==identity(plan.target))throw fault('TIMESCALE_NATIVE_TARGET_CHANGED','The database no longer matches the selected source.',409);
  const aggregate=selectedAggregate(edition,plan.aggregateKey);
  if(aggregate.definitionDigest!==plan.definitionDigest)throw fault('TIMESCALE_AGGREGATE_CHANGED','Capture and review the current aggregate definition.',409);
  return aggregate;
}
async function prepareNativeRefresh(sourceFile,plan,options={}) {
  const active=await connection(sourceFile,{...options,timezone:plan.window.timezone});
  try {
    const before=await captureOn(active.client,{id:options.captureId,title:'Refresh preparation',note:plan.note,sourceDigest:options.sourceDigest});
    validateOriginal(before,plan);
    procedure(before,'refresh_continuous_aggregate','options jsonb');
    const window=await normalizeWindow(active.client,plan.window);
    return {...plan,window,preparedAt:stamp(),nativeVersion:tableRows(before.tables.extensions).find(row=>row.extname==='timescaledb').extversion};
  }finally{await active.close();}
}
async function runNativeRefresh(sourceFile,plan,{beforeDispatch,...options}={}) {
  const active=await connection(sourceFile,{...options,timezone:plan.window.timezone});
  try {
    const before=await captureOn(active.client,{id:options.captureId,title:'Before refresh',note:plan.note,sourceDigest:options.sourceDigest,signal:options.signal});
    validateOriginal(before,plan);
    const proc=procedure(before,'refresh_continuous_aggregate','options jsonb');
    await normalizeWindow(active.client,plan.window);
    const text='CALL '+proc+'($1::regclass,$2::'+plan.window.timeType+',$3::'+plan.window.timeType+',force=>$4::boolean,options=>$5::jsonb)';
    const values=[relationName(plan.relation),plan.window.start,plan.window.end,plan.force,JSON.stringify(plan.options)];
    await beforeDispatch?.({before,statementDigest:identity(text),dispatchedAt:stamp()});
    // Deliberately outside BEGIN: native incremental batches commit independently.
    const result=await table(active.client,text,values);
    return {schema:'stellar-forge.timescale-refresh-result.v1',command:'refresh_continuous_aggregate',
      acknowledgedAt:stamp(),window:plan.window,options:plan.options,atomic:plan.atomic,result};
  }catch(issue){throw nativeError(issue);}finally{await active.close();}
}
async function verifyAggregate(sourceFile,plan,{beforeDispatch,...options}={}) {
  const active=await connection(sourceFile,{...options,timezone:plan.window.timezone});
  try {
    const current=await captureOn(active.client,{id:options.captureId,title:'Verification metadata',note:plan.note,sourceDigest:options.sourceDigest});
    const aggregate=validateOriginal(current,plan),window=await normalizeWindow(active.client,plan.window);
    const columns=aggregate.columns.map(column=>identifier(column.name));
    let definition=aggregate.definition.trim().replace(/;\s*$/,'');
    if(!definition)throw fault('TIMESCALE_NATIVE_DEFINITION_REQUIRED');
    const predicate=identifier(window.timeColumn)+' >= $1::'+window.timeType+' AND '+identifier(window.timeColumn)+' < $2::'+window.timeType;
    const names=columns.join(', '),casts=columns.map(name=>name+'::text AS '+name).join(', ');
    const cte='WITH expected_native('+names+') AS ('+definition+'), expected AS (SELECT '+casts+
      ' FROM expected_native WHERE '+predicate+'), actual AS (SELECT '+casts+' FROM '+relationName(aggregate)+
      ' WHERE '+predicate+'), missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual), extra AS '+
      '(SELECT * FROM actual EXCEPT ALL SELECT * FROM expected) ';
    const countsSql=cte+'SELECT (SELECT count(*) FROM expected)::text AS expected_rows,'+
      '(SELECT count(*) FROM actual)::text AS actual_rows,(SELECT count(*) FROM missing)::text AS missing_rows,'+
      '(SELECT count(*) FROM extra)::text AS extra_rows';
    await beforeDispatch?.({statementDigest:identity(countsSql),startedAt:stamp()});
    await active.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const counts=await table(active.client,countsSql,[window.start,window.end]);
      const mismatchSQL=cte+"SELECT 'missing'::text AS direction, to_jsonb(missing)::text AS row FROM missing "+
        "UNION ALL SELECT 'extra'::text,to_jsonb(extra)::text FROM extra";
      const differences=await table(active.client,mismatchSQL,[window.start,window.end]);
      await active.client.query('COMMIT');
      const count=tableRows(counts)[0];
      return {schema:'stellar-forge.timescale-aggregate-verification.v1',completedAt:stamp(),window,
        definitionDigest:plan.definitionDigest,materializedOnly:aggregate.materializedOnlyText,
        counts,differences,matches:count.missing_rows==='0'&&count.extra_rows==='0',
        interpretation:'Compared the selected complete aggregate rows with its original native definition in the same read-only repeatable-read snapshot. This measures this window and capture only.'};
    }catch(issue){await active.client.query('ROLLBACK').catch(()=>{});throw issue;}
  }catch(issue){throw nativeError(issue);}finally{await active.close();}
}
const JOB_FIELDS=Object.freeze({schedule_interval:'interval',max_runtime:'interval',max_retries:'integer',
  retry_period:'interval',scheduled:'boolean',config:'jsonb',next_start:'timestamptz',fixed_schedule:'boolean',
  initial_start:'timestamptz',timezone:'text'});
async function prepareNativeJob(sourceFile,{edition,jobId,changes,title,owner,note},options={}) {
  only(changes,Object.keys(JOB_FIELDS));
  if(!Object.keys(changes).length)throw fault('TIMESCALE_JOB_CHANGES_REQUIRED');
  if(typeof jobId!=='string'||!/^[0-9]+$/.test(jobId)||BigInt(jobId)>2147483647n)throw fault('TIMESCALE_JOB_ID_INVALID');
  const job=tableRows(edition.tables.jobs).find(row=>row.job_id===jobId);
  if(!job)throw fault('TIMESCALE_JOB_NOT_FOUND', 'Select a job in this edition.',404);
  const originalSchedule=tableRows(edition.tables.job_schedules).find(row=>row.id===jobId);
  const active=await connection(sourceFile,options);
  try{
    const names=Object.keys(changes),values=names.map(name=>{
      const value=changes[name];
      if(value===null)throw fault('TIMESCALE_JOB_NULL_UNSUPPORTED','Omit unchanged settings; native NULL means leave unchanged.');
      if(name==='config')return typeof value==='string'?value:JSON.stringify(value);
      if(['scheduled','fixed_schedule'].includes(name)&&typeof value!=='boolean')throw fault('TIMESCALE_BOOLEAN_REQUIRED');
      return value;
    });
    const query='SELECT '+names.map((name,i)=>'($'+(i+1)+'::'+JOB_FIELDS[name]+')::text AS '+identifier(name)).join(', ');
    const normalized=tableRows(await table(active.client,query,values))[0];
    if(Object.hasOwn(normalized,'timezone')){
      const available=tableRows(await table(active.client,'SELECT name FROM pg_catalog.pg_timezone_names WHERE name=$1',[normalized.timezone]));
      if(available.length!==1)throw fault('TIMESCALE_TIMEZONE_INVALID');
    }
    return {schema:'stellar-forge.timescale-job-plan.v1',title:checkText(title,'a job-change title',128),
      owner:checkText(owner,'the operator name',128),note:checkText(note,'the change purpose'),jobId,
      target:nativeTarget(edition),before:jobDefinition(job,originalSchedule),beforeDigest:identity(jobDefinition(job,originalSchedule)),
      changes:normalized,createdAt:stamp()};
  }catch(issue){throw nativeError(issue);}finally{await active.close();}
}
async function runNativeJobChange(sourceFile,plan,{beforeDispatch,...options}={}) {
  const active=await connection(sourceFile,options);
  try{
    const before=await captureOn(active.client,{id:options.captureId,title:'Before job change',note:plan.note,sourceDigest:options.sourceDigest});
    if(identity(nativeTarget(before))!==identity(plan.target))throw fault('TIMESCALE_NATIVE_TARGET_CHANGED');
    const row=tableRows(before.tables.jobs).find(item=>item.job_id===plan.jobId);
    const schedule=tableRows(before.tables.job_schedules).find(item=>item.id===plan.jobId);
    if(!row||identity(jobDefinition(row,schedule))!==plan.beforeDigest)throw fault('TIMESCALE_JOB_CHANGED','Review the current job settings first.',409);
    const proc=procedure(before,'alter_job'),names=Object.keys(plan.changes),values=[plan.jobId,...names.map(name=>plan.changes[name])];
    const sql='SELECT * FROM '+proc+'($1::integer,'+names.map((name,i)=>identifier(name)+'=>$'+(i+2)+'::'+JOB_FIELDS[name]).join(', ')+')';
    await beforeDispatch?.({before,statementDigest:identity(sql),dispatchedAt:stamp()});
    const result=await table(active.client,sql,values);
    return {schema:'stellar-forge.timescale-job-change-result.v1',jobId:plan.jobId,acknowledgedAt:stamp(),result};
  }catch(issue){throw nativeError(issue);}finally{await active.close();}
}

export { TEXT_TYPES, VIEW_ORDER, table, captureTimescale, prepareNativeRefresh, runNativeRefresh, verifyAggregate, prepareNativeJob, runNativeJobChange, nativeError };
