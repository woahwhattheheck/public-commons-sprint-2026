// MIT. Dedicated native PGwire sessions, exact text parsers and owned cancellation.
import { readBytes, fail, checkAbort, PROTOCOL_VERSION } from './common.mjs';
function localHost(host){
  return host==='localhost'||host==='::1'||/^127(?:\.[0-9]{1,3}){3}$/.test(host);
}
async function connectionOptions(config,env){
  const secret=env[config.connectionStringEnv];
  if(typeof secret!=='string'||!secret)throw fail('RISINGWAVE_CONNECTION_ENV_MISSING','Set the saved connection-string environment reference.',{environment:config.connectionStringEnv});
  let url;try{url=new URL(secret);}catch{throw fail('RISINGWAVE_CONNECTION_URL_INVALID');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hash||url.search||!url.hostname)throw fail('RISINGWAVE_CONNECTION_URL_INVALID',
    'Use a postgres:// URL without query overrides; TLS is controlled by the saved source configuration.');
  const host=url.hostname.replace(/^\[|\]$/g,''),port=Number(url.port||4566);
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw fail('RISINGWAVE_CONNECTION_PORT_INVALID');
  if(config.tls==='disable'&&(!config.allowLocal||!localHost(host)))throw fail('RISINGWAVE_TLS_REQUIRED','Plain PGwire requires an explicitly allowed loopback source.');
  let user,password,database;
  try{user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);database=decodeURIComponent(url.pathname.slice(1));}
  catch{throw fail('RISINGWAVE_CONNECTION_URL_ENCODING_INVALID');}
  if(!user||!database||[user,password,database].some(value=>value.includes('\0')))throw fail('RISINGWAVE_CONNECTION_IDENTITY_REQUIRED');
  let ssl=false;
  if(config.tls==='require'){
    ssl={rejectUnauthorized:true};
    if(config.caFileEnv){
      const path=env[config.caFileEnv];if(typeof path!=='string')throw fail('RISINGWAVE_CA_ENV_MISSING');
      ssl.ca=(await readBytes(path,1048576,false)).toString('utf8');
    }
  }
  return {options:{host,port,user,password,database,ssl,application_name:'stellar-forge-risingwave',
    connectionTimeoutMillis:config.queryTimeoutMs,query_timeout:config.queryTimeoutMs},
    secrets:[secret,password].filter(Boolean)};
}
function nativeError(issue,secrets,phase){
  const clean=value=>{
    let text=String(value??'').slice(0,8192);
    for(const secret of secrets)text=text.split(secret).join('[redacted]');
    return text.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi,'[connection]');
  };
  const message=clean(issue?.message??issue);
  const details={phase,sqlState:typeof issue?.code==='string'&&/^[0-9A-Z]{5}$/.test(issue.code)?issue.code:null,
    message,detail:clean(issue?.detail),hint:clean(issue?.hint)};
  const gap=['declare','fetch'].includes(phase)&&(
    message.includes("rw_timestamp is too small, need to be large than the current unix_millis - subscription's retention time")||
    /No data found for rw_timestamp [0-9]+, data may have been recycled, please recreate cursor/.test(message)||
    message.includes('The cursor has exceeded its maximum lifetime, please recreate it (close then declare cursor).'));
  const code=gap?'RISINGWAVE_RETENTION_GAP':issue?.code==='57014'||/query.*timeout/i.test(message)?'RISINGWAVE_QUERY_TIMEOUT':'RISINGWAVE_PROVIDER_ERROR';
  return fail(code,message,details);
}
export async function connectRisingWave(config,{env=process.env,signal}={}){
  checkAbort(signal);
  const prepared=await connectionOptions(config,env);
  checkAbort(signal);
  const imported=await import('pg'),Client=imported.Client??imported.default?.Client;
  if(!Client)throw fail('RISINGWAVE_PG_DRIVER_MISSING');
  checkAbort(signal);
  const client=new Client(prepared.options);
  let terminal=false,closing=null,failure=null;
  const textTypes={getTypeParser:(_oid,format)=>format==='binary'?()=>{throw fail('RISINGWAVE_BINARY_WIRE_NOT_SUPPORTED');}:value=>value};
  function close(){
    if(closing)return closing;
    closing=(async()=>{
      try{
        const ended=client.end();
        const timer=setTimeout(()=>client.connection?.stream?.destroy(),2000);
        timer.unref?.();
        try{await ended;}finally{clearTimeout(timer);}
      }finally{terminal=true;signal?.removeEventListener('abort',abort);}
    })();
    return closing;
  }
  function abort(){failure=fail('RISINGWAVE_CANCELLED','The original source operation was cancelled.');void close().catch(()=>{});}
  client.on('error',issue=>{failure=nativeError(issue,prepared.secrets,'connection');});
  signal?.addEventListener('abort',abort,{once:true});
  async function query(text,values=[],options={}){
    checkAbort(signal);
    if(failure)throw failure;
    if(terminal||closing)throw fail('RISINGWAVE_SOURCE_CLOSED');
    try{
      const result=await client.query({text,values,rowMode:'array',types:textTypes,
        query_timeout:options.timeoutMs??config.queryTimeoutMs});
      checkAbort(signal);
      if(Array.isArray(result))throw fail('RISINGWAVE_SINGLE_STATEMENT_REQUIRED');
      const fields=result.fields.map(field=>({name:field.name,typeOid:String(field.dataTypeID),
        tableId:String(field.tableID??0),columnId:field.columnID??0,format:field.format??'text'}));
      if(result.rows.some(row=>!Array.isArray(row)||row.length!==fields.length||row.some(value=>value!==null&&typeof value!=='string')))
        throw fail('RISINGWAVE_NATIVE_TEXT_PROTOCOL_INVALID');
      return {fields,rows:result.rows,rowCount:result.rowCount,command:result.command};
    }catch(issue){
      if(issue?.name==='RisingWaveSourceError'||issue?.name==='QueryInputError')throw issue;
      if(failure)throw failure;
      throw nativeError(issue,prepared.secrets,options.phase??'query');
    }
  }
  try{
    await client.connect();checkAbort(signal);
    const info=await query('SELECT version() AS version, pg_backend_pid() AS session_id, current_database() AS database, current_user AS user');
    const row=info.rows[0];
    if(!row||!/RisingWave/i.test(row[0])||!new RegExp('(?:^|[^0-9])'+PROTOCOL_VERSION.replaceAll('.','\\.')+'(?:[^0-9]|$)').test(row[0]))
      throw fail('RISINGWAVE_CURSOR_PROTOCOL_VERSION_REQUIRED','This cursor checkpoint parser is pinned to RisingWave '+PROTOCOL_VERSION+'.',{version:row?.[0]??null});
    await query("SET TIME ZONE 'UTC'");
    return {query,close,identity:{version:row[0],sessionId:row[1],database:row[2],user:row[3],
      endpoint:{host:prepared.options.host,port:prepared.options.port,database:row[2],user:row[3],tls:config.tls}}};
  }catch(issue){await close().catch(()=>{});if(issue?.name==='RisingWaveSourceError')throw issue;throw nativeError(issue,prepared.secrets,'connect');}
}
export function rowsAsObjects(result){
  if(new Set(result.fields.map(field=>field.name)).size!==result.fields.length)throw fail('RISINGWAVE_DUPLICATE_RESULT_FIELD');
  return result.rows.map(row=>Object.fromEntries(result.fields.map((field,index)=>[field.name,row[index]])));
}
