// MIT. Native SQL Server statements, exact server-side representations, original SF30 routes.
import { performance } from 'node:perf_hooks';
import { compileMssqlQueries, bindMssqlParameters, describeMssqlQueries, projectedStatement,
  parameterDeclaration, requestParameters, encodedStatement, outputEncoding, QueryInputError } from './declaration.mjs';

export class MssqlSourceError extends Error {
  constructor(code, query, number) {
    super(code); this.name='MssqlSourceError';this.code=code;
    if (query) this.query=query;
    if (Number.isInteger(number)) this.number=number;
  }
}
const fail=(code,name,number)=>new MssqlSourceError(code,name,number);
const bounded=(n,low,high,code)=>{
  if(!Number.isInteger(n)||n<low||n>high)throw new TypeError(code);
  return n;
};
function safeError(error,name) {
  if(error instanceof MssqlSourceError||error instanceof QueryInputError)return error;
  const code=error?.code==='ETIMEOUT'?'QUERY_TIMEOUT':
    error?.code==='ECANCEL'?'QUERY_ABORTED':
    [229,230,262,297].includes(error?.number)?'QUERY_PERMISSION_DENIED':'QUERY_UNAVAILABLE';
  return fail(code,name,error?.number);
}
export async function createMssqlPool(connection,{maxConnections=4,connectTimeoutMs=5000,idleTimeoutMs=30000}={}) {
  let sql;
  try { const module=await import('mssql');sql=module.default??module; }
  catch { throw fail('MSSQL_DRIVER_UNAVAILABLE'); }
  const pool=new sql.ConnectionPool({...connection,connectionTimeout:connectTimeoutMs,
    requestTimeout:30000,pool:{max:maxConnections,min:0,idleTimeoutMillis:idleTimeoutMs},
    options:{...connection.options,abortTransactionOnError:true},arrayRowMode:false});
  // Individual requests carry sanitized failures. Consume pool-level errors so
  // a broken database socket cannot terminate the merchant process.
  pool.on('error',()=>{});
  try { await pool.connect();return {pool,sql}; }
  catch(error){await pool.close().catch(()=>{});throw safeError(error);}
}

function publicMetadata(columns) {
  return columns.map(column=>({name:column.name,type:column.system_type_name,
    nullable:Boolean(column.is_nullable),precision:column.precision,scale:column.scale,
    maxLength:column.max_length,collation:column.collation_name??null,encoding:outputEncoding(column)}));
}
export async function describeMssqlResult(pool,sql,query,{timeoutMs=10000,signal,onRequest=()=>{}}={}) {
  const request=pool.request();request.timeout=timeoutMs;onRequest(request);
  const abort=()=>request.cancel();signal?.addEventListener('abort',abort,{once:true});
  try {
    if(signal?.aborted)throw fail('QUERY_ABORTED');
    request.input('statement',sql.NVarChar(sql.MAX),projectedStatement(query));
    request.input('parameters',sql.NVarChar(sql.MAX),parameterDeclaration(query)||null);
    const result=await request.query(
      'SELECT column_ordinal,name,system_type_name,is_nullable,max_length,precision,scale,'+
      'collation_name,error_number FROM sys.dm_exec_describe_first_result_set(@statement,@parameters,0) '+
      'WHERE is_hidden=0 OR error_number IS NOT NULL ORDER BY column_ordinal');
    const columns=result.recordset;
    if(!Array.isArray(columns)||columns.length!==query.columns.length||
        columns.some((column,index)=>column.error_number||column.name!==query.columns[index]))
      throw fail('QUERY_PROJECTION_CHANGED');
    for(const column of columns)outputEncoding(column);
    return columns;
  }finally{signal?.removeEventListener('abort',abort);}
}

export async function createMssqlQuerySource({connection,queries,maxConnections=4,maxPending=32,
  connectTimeoutMs=5000,idleTimeoutMs=30000,startupTimeoutMs=10000}={}) {
  if(!connection||typeof connection!=='object')throw new TypeError('MSSQL_CONNECTION_REQUIRED');
  maxConnections=bounded(maxConnections,1,32,'MSSQL_CONNECTION_LIMIT');
  maxPending=bounded(maxPending,maxConnections,256,'MSSQL_PENDING_LIMIT');
  connectTimeoutMs=bounded(connectTimeoutMs,100,30000,'MSSQL_CONNECT_TIMEOUT');
  idleTimeoutMs=bounded(idleTimeoutMs,1000,300000,'MSSQL_IDLE_TIMEOUT');
  startupTimeoutMs=bounded(startupTimeoutMs,100,60000,'MSSQL_START_TIMEOUT');
  const compiled=compileMssqlQueries(queries);
  const {pool,sql}=await createMssqlPool(connection,{maxConnections,connectTimeoutMs,idleTimeoutMs});
  const metadata=Object.create(null),requests=new Set(),jobs=new Set();
  let closed=false,closing,completed=0,failures=0,version;
  const definition=name=>{
    if(typeof name!=='string'||!Object.hasOwn(compiled,name))throw fail('QUERY_NOT_FOUND');
    return compiled[name];
  };
  const validate=(name,input)=>bindMssqlParameters(definition(name),input);
  try {
    const request=pool.request();request.timeout=startupTimeoutMs;
    const result=await request.query("SELECT CONVERT(varchar(128),SERVERPROPERTY('ProductVersion')) AS version,"+
      "CONVERT(int,SERVERPROPERTY('ProductMajorVersion')) AS major");
    version=result.recordset?.[0]?.version;
    if(!version||Number(result.recordset[0].major)<13)throw fail('MSSQL_SERVER_2016_OR_NEWER_REQUIRED');
    const deadline=performance.now()+startupTimeoutMs;
    for(const [name,query] of Object.entries(compiled)){
      const remaining=Math.floor(deadline-performance.now());
      if(remaining<1)throw fail('MSSQL_START_TIMEOUT');
      metadata[name]=await describeMssqlResult(pool,sql,query,{timeoutMs:remaining});
    }
  }catch(error){await pool.close().catch(()=>{});throw safeError(error);}

  function query(name,input,{signal}={}) {
    let spec,values;
    try {
      if(closed)throw fail('SOURCE_CLOSED');
      if(signal!==undefined&&(typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))
        throw new TypeError('ABORT_SIGNAL_REQUIRED');
      if(signal?.aborted)throw fail('QUERY_ABORTED',name);
      spec=definition(name);values=validate(name,input);
      if(jobs.size>=maxPending)throw fail('SOURCE_BUSY');
    }catch(error){return Promise.reject(error);}
    const controller=new AbortController(),deadline=performance.now()+spec.timeoutMs;
    let currentRequest,timer,done=false,resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const job={cancel:code=>{
      if(done)return;controller.abort();try{currentRequest?.cancel();}catch{}
      finish(fail(code,name));
    }};
    function finish(error,result){
      if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);jobs.delete(job);
      if(error){failures++;reject(safeError(error,name));}else{completed++;resolve(result);}
    }
    const abort=()=>job.cancel('QUERY_ABORTED');
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>job.cancel('QUERY_TIMEOUT'),spec.timeoutMs);jobs.add(job);
    const remaining=()=>Math.max(1,Math.floor(deadline-performance.now()));
    const active=()=>{if(done||closed)throw fail(closed?'SOURCE_CLOSED':'QUERY_ABORTED',name);};
    (async()=>{
      try {
        // Refresh metadata within this request lifetime. Schema changes produce
        // the same admission error instead of silently changing a sold contract.
        const observed=await describeMssqlResult(pool,sql,spec,{timeoutMs:remaining(),
          signal:controller.signal,onRequest:request=>{currentRequest=request;requests.add(request);}});
        requests.delete(currentRequest);currentRequest=null;active();
        if(JSON.stringify(publicMetadata(observed))!==JSON.stringify(publicMetadata(metadata[name])))
          throw fail('QUERY_PROJECTION_CHANGED',name);
        const request=pool.request();currentRequest=request;requests.add(request);
        request.timeout=remaining();request.stream=true;request.arrayRowMode=true;
        for(const [index,parameter]of requestParameters(spec).entries()){
          const type=parameter.type==='bit'?sql.Bit:parameter.type==='float'?sql.Float:
            sql.NVarChar(parameter.length>4000?sql.MAX:parameter.length);
          request.input(parameter.name,type,values[index]);
        }
        const output={schema:'stellar-forge.mssql-result.v1',query:name,serverVersion:version,
          columns:[...spec.columns],columnTypes:publicMetadata(observed),rows:[],rowCount:0,truncated:false,
          valueEncoding:'sqlserver-server-text',binaryEncoding:'base64-object',nullEncoding:'json-null',
          snapshot:'single-statement-database-isolation'};
        let used=Buffer.byteLength(JSON.stringify(output)),shape=false;
        request.on('recordset',columns=>{
          if(done)return;
          const list=Array.isArray(columns)?columns:Object.values(columns);
          if(list.length!==spec.columns.length+1||list.slice(0,-1).some((column,index)=>column.name!==spec.columns[index])){
            job.cancel('QUERY_PROJECTION_CHANGED');return;
          }
          shape=true;
        });
        request.on('row',row=>{
          if(done)return;
          try{
            active();
            if(!shape||!Array.isArray(row)||row.length!==spec.columns.length+1)throw fail('QUERY_PROJECTION_CHANGED',name);
            if(Number(row.at(-1))!==0)throw fail('QUERY_RESULT_TOO_LARGE',name);
            if(output.rows.length>=spec.maxRows){output.truncated=true;return;}
            const item=Object.fromEntries(spec.columns.map((column,index)=>{
              const value=row[index];
              if(value!==null&&typeof value!=='string')throw fail('QUERY_RESULT_ENCODING_CHANGED',name);
              if(value!==null&&outputEncoding(observed[index])==='binary'){
                if(!/^(?:[a-fA-F0-9]{2})*$/.test(value))throw fail('QUERY_RESULT_ENCODING_CHANGED',name);
                return[column,{base64:Buffer.from(value,'hex').toString('base64')}];
              }
              return[column,value];
            }));
            used+=Buffer.byteLength(JSON.stringify(item))+(output.rows.length?1:0);
            if(used+64>spec.maxBytes)throw fail('QUERY_RESULT_TOO_LARGE',name);
            output.rows.push(item);
          }catch(error){try{request.cancel();}catch{}finish(error);}
        });
        request.on('error',error=>finish(error));
        await request.query(encodedStatement(spec,observed));
        active();
        if(!shape)throw fail('QUERY_PROJECTION_CHANGED',name);
        output.rowCount=output.rows.length;
        if(Buffer.byteLength(JSON.stringify(output))>spec.maxBytes)throw fail('QUERY_RESULT_TOO_LARGE',name);
        finish(null,output);
      }catch(error){finish(error);}
      finally{if(currentRequest)requests.delete(currentRequest);}
    })();
    return promise;
  }

  function route(name,{input='query'}={}){
    definition(name);
    if(!['query','body'].includes(input))throw new TypeError('MSSQL_ROUTE_INPUT_INVALID');
    const get=context=>{
      if(input==='body'&&!['POST','PUT','PATCH'].includes(context?.method))
        throw new QueryInputError(null,'JSON_BODY_METHOD_REQUIRED');
      return context?.[input];
    };
    const invalid=error=>({status:422,body:{error:'QUERY_INPUT_INVALID',code:error.code,field:error.field}});
    return Object.freeze({
      admit(context){try{
        validate(name,get(context));
        if(closed)return{status:503,body:{error:'SOURCE_CLOSED'}};
        if(jobs.size>=maxPending)return{status:429,headers:{'retry-after':'1'},body:{error:'SOURCE_BUSY'}};
        return true;
      }catch(error){if(error instanceof QueryInputError)return invalid(error);throw error;}},
      async handler(context){try{return{status:200,headers:{'content-type':'application/json; charset=utf-8'},
        body:await query(name,get(context),{signal:context?.signal})};}
        catch(error){if(error instanceof QueryInputError)return invalid(error);
          return{status:error.code==='QUERY_TIMEOUT'?504:error.code==='SOURCE_BUSY'?429:503,
            body:{error:error instanceof MssqlSourceError?error.code:'QUERY_UNAVAILABLE'}};}}
    });
  }
  function close(){
    if(closing)return closing;closed=true;
    for(const job of [...jobs])job.cancel('SOURCE_CLOSED');
    for(const request of requests)try{request.cancel();}catch{}
    closing=pool.close();return closing;
  }
  return Object.freeze({query,validate,route,close,
    describe:()=>describeMssqlQueries(compiled),
    preflight:()=>({serverVersion:version,queries:Object.fromEntries(Object.entries(metadata).map(([name,value])=>
      [name,{columns:publicMetadata(value),readSemantics:'single-statement-database-isolation'}]))}),
    status:()=>({closed,pending:jobs.size,maxPending,maxConnections,completed,failures,serverVersion:version})});
}
