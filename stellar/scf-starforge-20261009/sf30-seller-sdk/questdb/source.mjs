// MIT. Native QuestDB discovery, live queries and complete retained publisher captures.
import { open, mkdir, lstat, rename, readdir } from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateQuestDbSource, questDbConnection } from './config.mjs';
import { compileQuestDbQueries, bindQuestDbParameters, describeQuestDbQueries, questDbStatement, QueryInputError } from './declaration.mjs';
import { createQuestDbResponseReader, createNativeCsvReader, canonicalCsvLine, readCapturedRows } from './result.mjs';
import { questDbRequest, requestLifetime } from './transport.mjs';
import { QuestDbSourceError, fail, object, exact, bounded, absolute, privateDirectory, readJson,
  writeAll, createFile, atomicJson, syncDirectory, readBytes, bytes, digest, identity, stamp, literal } from './common.mjs';

const shape=columns=>columns.map(({name,type,valueEncoding,timestampPrecision})=>({name,type,valueEncoding,...(timestampPrecision===undefined?{}:{timestampPrecision})}));
const HASH=/^[a-f0-9]{64}$/;
const CAPTURE_FILES=new Set(['response.json','rows.ndjson','data.csv','native.csv']);
export function questDbDatasetExtractionOptions(query,options={}) {
  exact(options,['maxRows','maxBytes','timeoutMs','maxRowBytes','includeNativeCsv'],'QUESTDB_EXTRACTION_FIELDS_INVALID');
  if(options.includeNativeCsv!==undefined&&typeof options.includeNativeCsv!=='boolean')throw fail('QUESTDB_CSV_OPTION_INVALID');
  return{maxRows:bounded(options.maxRows??1000000,1,1000000000,'QUESTDB_EXTRACTION_ROW_LIMIT_INVALID'),
    maxBytes:bounded(options.maxBytes??67108864,1024,8589934592,'QUESTDB_EXTRACTION_BYTE_LIMIT_INVALID'),
    timeoutMs:bounded(options.timeoutMs??Math.max(query.timeoutMs,120000),100,3600000,'QUESTDB_EXTRACTION_TIMEOUT_INVALID'),
    maxRowBytes:bounded(options.maxRowBytes??1048576,1024,16777216,'QUESTDB_ROW_BYTE_LIMIT_INVALID'),
    includeNativeCsv:options.includeNativeCsv??false};
}
async function hashFile(path,expected,signal) {
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077||stat.size!==expected.bytes)throw fail('QUESTDB_CAPTURE_CHANGED');
  const stream=createReadStream(path,{flags:constants.O_RDONLY|(constants.O_NOFOLLOW??0),highWaterMark:65536,signal}),hash=createHash('sha256');
  let total=0;
  try{for await(const chunk of stream){total+=chunk.length;if(total>expected.bytes)throw fail('QUESTDB_CAPTURE_CHANGED');hash.update(chunk);}}
  finally{stream.destroy();}
  if(total!==expected.bytes||hash.digest('hex')!==expected.sha256)throw fail('QUESTDB_CAPTURE_CHANGED');
}
export async function readQuestDbCapture(directory,{binding,signal,verifyFiles=true}={}) {
  await privateDirectory(directory);
  const manifest=await readJson(join(directory,'capture.json'),1048576,true);
  if(manifest.schema!=='stellar-forge.questdb-capture.v1'||manifest.complete!==true||!object(manifest.files)||
      !HASH.test(manifest.orderedRowsSha256)||!Number.isSafeInteger(manifest.rowCount)||manifest.rowCount<0||
      !Array.isArray(manifest.columnTypes)||String(manifest.rowCount)!==manifest.reportedCount)throw fail('QUESTDB_CAPTURE_MANIFEST_INVALID');
  if(binding&&identity(binding)!==identity(manifest.binding))throw fail('QUESTDB_CAPTURE_BINDING_CHANGED');
  const files=structuredClone(manifest.files);
  for(const key of ['json','ndjson','csv'])if(!files[key])throw fail('QUESTDB_CAPTURE_MANIFEST_INVALID');
  for(const file of Object.values(files)){
    if(!object(file)||!CAPTURE_FILES.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<0||!HASH.test(file.sha256))throw fail('QUESTDB_CAPTURE_MANIFEST_INVALID');
    if(verifyFiles)await hashFile(join(directory,file.path),file,signal);
  }
  const original=await readBytes(join(directory,'capture.json'),1048576,true);
  files.manifest={path:'capture.json',bytes:original.length,sha256:digest(original)};
  return{manifest,directory,files};
}
async function ensureCaptureRoot(path) {
  absolute(path);
  try{await privateDirectory(path);}catch(issue){if(issue.code!=='ENOENT')throw issue;await privateDirectory(path,true);}
}
async function fileWriter(directory,partial) {
  const path=join(directory,partial),file=await open(path,'wx',0o600),hash=createHash('sha256');let total=0,closed=false;
  return{async write(value){const data=Buffer.isBuffer(value)?value:Buffer.from(value);await writeAll(file,data);hash.update(data);total+=data.length;},
    async finish(name){if(closed)throw fail('QUESTDB_WRITER_ALREADY_CLOSED');await file.sync();await file.close();closed=true;await rename(path,join(directory,name));return{path:name,bytes:total,sha256:hash.digest('hex')};},
    async close(){if(!closed){closed=true;await file.close();}},get bytes(){return total;}};
}
export async function createQuestDbQuerySource(raw,{env=process.env,captureDirectory,sourceHash}={}) {
  const config=validateQuestDbSource(raw),queries=compileQuestDbQueries(config.queries),connection=questDbConnection(config,env);
  if(captureDirectory!==undefined)absolute(captureDirectory);
  const sourceIdentity=sourceHash??identity(config),maxInFlight=config.maxInFlight??4,pinnedTypes=Object.create(null),jobs=new Set();
  let closed=false,closing=null,completed=0,failures=0,serverVersion=null,lastDiscovery=null;
  function definition(name){if(typeof name!=='string'||!Object.hasOwn(queries,name))throw fail('QUERY_NOT_FOUND');return queries[name];}
  function withJob(name,signal,timeoutMs,action){
    if(closed)return Promise.reject(fail('SOURCE_CLOSED'));
    if(jobs.size>=maxInFlight)return Promise.reject(fail('SOURCE_BUSY'));
    const lifetime=requestLifetime(signal,timeoutMs);let done;
    const job={lifetime,done:new Promise(resolve=>{done=resolve;})};jobs.add(job);
    return(async()=>{
      try{if(lifetime.signal.aborted)throw fail('QUERY_ABORTED');const result=await action(lifetime.signal);
        if(lifetime.signal.aborted)throw fail(lifetime.timeout?'QUERY_TIMEOUT':'QUERY_ABORTED');completed++;return result;}
      catch(issue){failures++;if(lifetime.signal.aborted)throw fail(closed?'SOURCE_CLOSED':lifetime.timeout?'QUERY_TIMEOUT':'QUERY_ABORTED');
        if(issue instanceof QuestDbSourceError||issue instanceof QueryInputError)throw issue;
        throw fail(typeof issue?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(issue.code)?issue.code:'QUESTDB_OPERATION_FAILED');}
      finally{lifetime.close();jobs.delete(job);done();}
    })();
  }
  async function rawJson(sql,{columns,limit,maxBytes=1048576,timeoutMs=config.startupTimeoutMs??10000,signal,count=false,maxRows=10000}={}) {
    const rows=[],reader=createQuestDbResponseReader({columns,maxRows,onRow:row=>{rows.push(row);}});
    const request=await questDbRequest(connection,{sql,limit,count,maxBytes,timeoutMs,signal,onChunk:chunk=>reader.feed(chunk)});
    const result=await reader.end();
    return{...result,rows,request};
  }
  async function checkTypes(name,types){
    if(pinnedTypes[name]&&identity(shape(types))!==identity(shape(pinnedTypes[name])))throw fail('QUERY_SCHEMA_CHANGED','The native query columns changed; review the current source schema.');
  }
  function validate(name,input){return bindQuestDbParameters(definition(name),input);}
  async function query(name,input={},options={}) {
    const declaration=definition(name),prepared=questDbStatement(declaration,input);
    return withJob(name,options.signal,declaration.timeoutMs,async signal=>{
      const result=await rawJson(prepared.sql,{columns:declaration.columns,limit:declaration.maxRows+1,
        maxRows:declaration.maxRows+1,maxBytes:declaration.maxBytes,timeoutMs:declaration.timeoutMs,signal,count:true});
      await checkTypes(name,result.columnTypes);
      const rows=result.rows.slice(0,declaration.maxRows);
      return{schema:'stellar-forge.questdb-result.v1',query:name,columns:[...declaration.columns],
        columnTypes:result.columnTypes.map(column=>({...column,counts:{null:rows.filter(row=>row[column.name]===null).length,value:rows.filter(row=>row[column.name]!==null).length}})),rows,rowCount:rows.length,reportedCount:result.reportedCount,
        truncated:result.rowCount>declaration.maxRows||BigInt(result.reportedCount)>BigInt(rows.length),
        valueEncoding:'questdb-json-source-text',nullEncoding:'json-null',snapshot:'single-native-http-response',
        designatedTimestampIndex:result.designatedTimestampIndex,execution:{startedAt:result.request.startedAt,completedAt:result.request.completedAt,bytes:result.request.bytes,httpStatus:result.request.httpStatus},serverVersion};
    });
  }
  async function captureInternal(name,input,options,signal) {
    const query=definition(name),prepared=questDbStatement(query,input);
    const {directory:requestedDirectory,...rawOptions}=options;
    const extraction=questDbDatasetExtractionOptions(query,rawOptions);
    let directory=requestedDirectory;
    if(directory===undefined){
      if(!captureDirectory)throw fail('QUESTDB_CAPTURE_DIRECTORY_REQUIRED');
      await ensureCaptureRoot(captureDirectory);directory=join(captureDirectory,randomUUID());
    }
    absolute(directory);
    const binding={sourceHash:sourceIdentity,queryHash:identity(describeQuestDbQueries({query}).query),inputHash:identity(prepared.values),
      connection:identity({endpoint:connection.baseUrl,authentication:connection.authentication}),extraction};
    try{return await readQuestDbCapture(directory,{binding,signal});}
    catch(issue){if(issue.code!=='ENOENT')throw issue;}
    try{await privateDirectory(directory);}catch(issue){if(issue.code!=='ENOENT')throw issue;await privateDirectory(directory,true);}
    if((await readdir(directory)).length)throw fail('QUESTDB_CAPTURE_ALREADY_STARTED',
      'The original capture directory contains a retained request or partial response. Keep it and use a new directory for another native request.',{directory});
    const requestIdentity={schema:'stellar-forge.questdb-capture-request.v1',id:randomUUID(),binding,
      sourceHash:sourceIdentity,query:name,input:prepared.values,sql:prepared.sql,createdAt:stamp(),options:extraction,
      connection:{endpoint:connection.baseUrl,authentication:connection.authentication},serverVersion};
    await createFile(join(directory,'request.json'),bytes(requestIdentity));
    await atomicJson(join(directory,'status.json'),{state:'RUNNING',id:requestIdentity.id,startedAt:stamp()});
    let json,ndjson,csv,nativeCsv;
    try{
      json=await fileWriter(directory,'response.partial');ndjson=await fileWriter(directory,'rows.partial');csv=await fileWriter(directory,'data.partial');
      let canonicalBytes=0,ndjsonBytes=0;
      const reader=createQuestDbResponseReader({columns:query.columns,maxRows:extraction.maxRows,maxRowBytes:extraction.maxRowBytes,
        onColumns:async types=>{await checkTypes(name,types);const line=canonicalCsvLine(query.columns);canonicalBytes+=Buffer.byteLength(line);await csv.write(line);},
        onRow:async row=>{
          signal.throwIfAborted();
          const line=JSON.stringify(row)+'\n',csvLine=canonicalCsvLine(query.columns.map(column=>row[column]));
          const rowBytes=Buffer.byteLength(line);ndjsonBytes+=rowBytes;
          if(rowBytes>extraction.maxRowBytes)throw fail('QUESTDB_CAPTURE_ROW_TOO_LARGE');
          if(ndjsonBytes>extraction.maxBytes)throw fail('QUESTDB_CAPTURE_NDJSON_TOO_LARGE');
          canonicalBytes+=Buffer.byteLength(csvLine);
          if(canonicalBytes>extraction.maxBytes)throw fail('QUESTDB_CAPTURE_CSV_TOO_LARGE');
          await ndjson.write(line);await csv.write(csvLine);
        }});
      const request=await questDbRequest(connection,{sql:prepared.sql,limit:extraction.maxRows+1,count:true,format:'json',
        maxBytes:extraction.maxBytes,timeoutMs:extraction.timeoutMs,signal,
        onChunk:async chunk=>{await json.write(chunk);await reader.feed(chunk);}});
      const result=await reader.end({complete:true});
      signal.throwIfAborted();
      const files={json:await json.finish('response.json'),ndjson:await ndjson.finish('rows.ndjson'),csv:await csv.finish('data.csv')};
      let nativeExport=null;
      if(extraction.includeNativeCsv){
        nativeCsv=await fileWriter(directory,'native-csv.partial');
        const csvReader=createNativeCsvReader({columns:result.columnTypes,maxRowBytes:extraction.maxRowBytes});
        let parseError=null,parsed=null;
        const nativeRequest=await questDbRequest(connection,{path:'exp',sql:prepared.sql,limit:extraction.maxRows+1,format:'csv',
          timeoutMs:extraction.timeoutMs,maxBytes:extraction.maxBytes,signal,onChunk:async chunk=>{
            await nativeCsv.write(chunk);if(!parseError){try{csvReader.feed(chunk);}catch(issue){parseError={code:issue.code??'QUESTDB_NATIVE_CSV_INVALID',message:issue.message};}}
          }});
        if(!parseError){try{parsed=csvReader.end();}catch(issue){parseError={code:issue.code??'QUESTDB_NATIVE_CSV_INVALID',message:issue.message};}}
        files.nativeCsv=await nativeCsv.finish('native.csv');
        nativeExport={request:nativeRequest,independentRequest:true,snapshotEquality:'not-assumed',parsed,parseError,
          comparison:parsed?{sameRowCount:parsed.rowCount===result.rowCount,
            sameOrderedValues:parsed.orderedRowsSha256===result.orderedRowsSha256}:null,
          completeness:'native CSV has no count footer; canonical JSON completeness is checked independently'};
      }
      const manifest={schema:'stellar-forge.questdb-capture.v1',id:requestIdentity.id,complete:true,readOnly:true,
        query:name,input:prepared.values,binding,sourceHash:sourceIdentity,serverVersion,createdAt:requestIdentity.createdAt,completedAt:stamp(),
        columns:[...query.columns],columnTypes:result.columnTypes,rowCount:result.rowCount,reportedCount:result.reportedCount,
        designatedTimestampIndex:result.designatedTimestampIndex,orderedRowsSha256:result.orderedRowsSha256,
        valueEncoding:'questdb-json-source-text',nullEncoding:'json-null',csv:{nullEncoding:'unquoted-empty',emptyStringEncoding:'quoted-empty',
          stringEncoding:'quoted-utf8',recordSeparator:'CRLF',numericValues:'original-response-text'},
        snapshot:'single-native-http-response',request,metadata:result.metadata,nativeExport,files};
      await createFile(join(directory,'capture.json'),bytes(manifest));await syncDirectory(directory);
      await atomicJson(join(directory,'status.json'),{state:'COMPLETE',id:manifest.id,completedAt:manifest.completedAt,rowCount:manifest.rowCount});
      return readQuestDbCapture(directory,{binding,signal,verifyFiles:false});
    }catch(issue){
      try{await atomicJson(join(directory,'status.json'),{state:signal.aborted?'CANCELLED':'FAILED',id:requestIdentity.id,stoppedAt:stamp(),
        error:{code:issue.code??'QUESTDB_CAPTURE_FAILED',message:issue.message,httpStatus:issue.httpStatus,provider:issue.provider,retryAfter:issue.retryAfter,transportCode:issue.transportCode},complete:false});}catch{}
      throw issue;
    }finally{await Promise.allSettled([json,ndjson,csv,nativeCsv].filter(Boolean).map(writer=>writer.close()));}
  }
  function capture(name,input={},options={}) {
    const query=definition(name),{directory,signal,...rest}=options;
    const extraction=questDbDatasetExtractionOptions(query,rest);
    return withJob(name,signal,extraction.timeoutMs,sig=>captureInternal(name,input,{directory,...extraction},sig));
  }
  function exportDataset(name,input={},options={}) {
    const query=definition(name),{signal,onRow,...rest}=options;
    if(typeof onRow!=='function')return Promise.reject(fail('DATASET_EXTRACTION_WRITER_REQUIRED'));
    const extraction=questDbDatasetExtractionOptions(query,rest);
    return withJob(name,signal,extraction.timeoutMs,async sig=>{
      const retained=await captureInternal(name,input,extraction,sig),manifest=retained.manifest;
      let rowCount=0;
      for await(const row of readCapturedRows(join(retained.directory,retained.files.ndjson.path),
        {...retained.files.ndjson,maxRowBytes:extraction.maxRowBytes,signal:sig})){
        sig.throwIfAborted();rowCount++;await onRow(row,structuredClone(manifest.columnTypes),{rowCount});
      }
      if(rowCount!==manifest.rowCount)throw fail('QUESTDB_CAPTURE_COUNT_CHANGED');
      return{schema:'stellar-forge.questdb-dataset-extraction.v1',complete:true,readOnly:true,rowCount,
        columns:manifest.columns,columnTypes:manifest.columnTypes,valueEncoding:manifest.valueEncoding,
        snapshot:manifest.snapshot,capture:{schema:manifest.schema,id:manifest.id,directory:retained.directory,
          manifestSha256:retained.files.manifest.sha256,files:retained.files,rowCount:manifest.rowCount,reportedCount:manifest.reportedCount,
          complete:manifest.complete,orderedRowsSha256:manifest.orderedRowsSha256},
        request:manifest.request,serverVersion:manifest.serverVersion};
    });
  }
  function discover({tables,signal}={}) {
    if(tables!==undefined&&(!Array.isArray(tables)||tables.length>128||tables.some(table=>typeof table!=='string'||!table||table.length>255)))
      return Promise.reject(fail('QUESTDB_DISCOVERY_TABLES_INVALID'));
    return withJob('discovery',signal,config.startupTimeoutMs??10000,async sig=>{
      const observed=await rawJson('SELECT * FROM tables()',{limit:10001,maxRows:10001,count:true,maxBytes:4194304,signal:sig});
      if(BigInt(observed.reportedCount)!==BigInt(observed.rowCount)||observed.rowCount>10000)throw fail('QUESTDB_CATALOGUE_INCOMPLETE');
      const available=new Map(observed.rows.map(row=>[row.table_name,row]));
      if(tables?.some(table=>!available.has(table)))throw fail('QUESTDB_TABLE_NOT_FOUND');
      const names=tables??[...available.keys()];
      if(names.length>128)throw fail('QUESTDB_SELECT_DISCOVERY_TABLES','Select up to 128 named tables for detailed column discovery.',{tableNames:[...available.keys()]});
      const selected=[];
      for(const table of names){
        sig.throwIfAborted();
        const columns=await rawJson('SELECT * FROM table_columns('+literal(table)+')',{limit:10001,maxRows:10001,count:true,maxBytes:4194304,signal:sig});
        if(BigInt(columns.reportedCount)!==BigInt(columns.rowCount)||columns.rowCount>10000)throw fail('QUESTDB_COLUMNS_INCOMPLETE');
        const original=available.get(table);
        selected.push({name:table,designatedTimestamp:original.designatedTimestamp??null,partitionBy:original.partitionBy??null,
          walEnabled:original.walEnabled??null,columns:columns.rows.map(row=>({name:row.column,type:row.type,...row})),
          metadata:original,columnMetadata:columns.rows,request:columns.request});
      }
      lastDiscovery={schema:'stellar-forge.questdb-discovery.v1',serverVersion,observedAt:stamp(),
        endpoint:connection.baseUrl,authentication:connection.authentication,tableNames:[...available.keys()],tables:selected,
        catalogueRequest:observed.request,complete:true};
      return structuredClone(lastDiscovery);
    });
  }
  function route(name,{input='query'}={}) {
    definition(name);if(!['query','body'].includes(input))throw fail('QUESTDB_ROUTE_INPUT_INVALID');
    const values=context=>{
      if(input==='body'&&!['POST','PUT','PATCH'].includes(context?.method))throw new QueryInputError(null,'JSON_BODY_METHOD_REQUIRED');
      return context?.[input]??{};
    };
    const bad=issue=>({status:422,body:{error:'QUERY_INPUT_INVALID',code:issue.code,field:issue.field}});
    return Object.freeze({admit(context){
      try{validate(name,values(context));if(closed)return{status:503,body:{error:'SOURCE_CLOSED'}};
        if(jobs.size>=maxInFlight)return{status:429,headers:{'retry-after':'1'},body:{error:'SOURCE_BUSY'}};return true;}
      catch(issue){if(issue instanceof QueryInputError)return bad(issue);throw issue;}
    },async handler(context){
      try{return{status:200,headers:{'content-type':'application/json; charset=utf-8'},body:await query(name,values(context),{signal:context?.signal})};}
      catch(issue){if(issue instanceof QueryInputError)return bad(issue);return{status:issue.code==='QUERY_TIMEOUT'?504:issue.code==='SOURCE_BUSY'?429:503,body:{error:issue.code??'QUESTDB_QUERY_FAILED'}};}
    }});
  }
  function close(){
    if(closing)return closing;closed=true;for(const job of jobs)job.lifetime.cancel();
    closing=Promise.allSettled([...jobs].map(job=>job.done)).then(()=>{});return closing;
  }
  try{
    const version=await withJob('startup',undefined,config.startupTimeoutMs??10000,signal=>rawJson('SELECT build() AS version',{limit:1,maxRows:1,maxBytes:65536,signal}));
    serverVersion=version.rows[0]?.version;
    if(typeof serverVersion!=='string'||!serverVersion||serverVersion.length>4096)throw fail('QUESTDB_VERSION_UNAVAILABLE');
    for(const[name,query]of Object.entries(queries)){
      const statement=questDbStatement(query,query.probe);
      const value=await withJob('preflight',undefined,config.startupTimeoutMs??10000,signal=>rawJson(statement.sql+'\nLIMIT 0',
        {columns:query.columns,limit:0,maxRows:0,maxBytes:1048576,signal}));
      if(value.rowCount!==0)throw fail('QUESTDB_PREFLIGHT_RETURNED_ROWS');
      pinnedTypes[name]=value.columnTypes;
    }
  }catch(issue){await close();throw issue;}
  return Object.freeze({query,capture,exportDataset,discover,validate,route,close,
    describe:()=>describeQuestDbQueries(queries),
    inspect:()=>({schema:'stellar-forge.questdb-inspection.v1',serverVersion,queries:describeQuestDbQueries(queries),
      columnTypes:structuredClone(pinnedTypes),transport:'native-http-get',snapshot:'single-native-http-response',
      endpoint:connection.baseUrl,authentication:connection.authentication,lastDiscovery:structuredClone(lastDiscovery)}),
    status:()=>({schema:'stellar-forge.questdb-status.v1',state:closed?'CLOSED':'READY',active:jobs.size,maxInFlight,completed,failures})});
}
