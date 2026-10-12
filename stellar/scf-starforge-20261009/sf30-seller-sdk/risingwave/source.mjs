// MIT. Native RisingWave source, complete captures and retained publisher history.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireWorkspace } from '../postgres/publisher/files.mjs';
import { validateRisingWaveSource } from './config.mjs';
import { compileRisingWaveQueries,describeRisingWaveQueries,bindRisingWaveParameters,risingWaveStatement,
  validateNativeColumns } from './declaration.mjs';
import { projectRecord } from './scalars.mjs';
import { connectRisingWave } from './transport.mjs';
import { discoverRisingWave,readRelation,inspectQuerySource } from './catalogue.mjs';
import { captureRisingWave,readRisingWaveCapture,inspectRisingWaveCapture,readRisingWaveRows,risingWaveDatasetExtractionOptions } from './capture.mjs';
import { inspectRisingWaveSubscription,prepareRisingWaveSubscription,createReviewedRisingWaveSubscription } from './subscription.mjs';
import { fail,QueryInputError,object,exact,identity,digest,bytes,now,privateDirectory,optionalJson,atomicJson,absolute,checkAbort,SOURCE_PIN } from './common.mjs';
export { readRisingWaveCapture,inspectRisingWaveCapture,readRisingWaveRows,risingWaveDatasetExtractionOptions };
export { bindRisingWaveParameters } from './declaration.mjs';
export { QueryInputError } from './common.mjs';
export function createRisingWaveQuerySource(raw,{env=process.env,captureDirectory,sourceHash,sourceFile}={}){
  const config=validateRisingWaveSource(raw),queries=compileRisingWaveQueries(config.queries);
  if(captureDirectory!==undefined)absolute(captureDirectory);
  const actualHash=sourceHash??digest(bytes(raw));
  if(!/^[a-f0-9]{64}$/.test(actualHash))throw fail('RISINGWAVE_SOURCE_HASH_INVALID');
  const jobs=new Set(),sessions=new Set(),types=Object.create(null);
  let closed=false,closing=null,completed=0,failures=0,lastDiscovery=null,lastVersion=null;
  const context={config,queries,sourceHash:actualHash,sourceConfigHash:identity(raw),withConnection};
  function definition(name){if(typeof name!=='string'||!Object.hasOwn(queries,name))throw fail('QUERY_NOT_FOUND');return queries[name];}
  function withJob(signal,action){
    if(closed)return Promise.reject(fail('SOURCE_CLOSED'));
    if(jobs.size>=config.maxInFlight)return Promise.reject(fail('SOURCE_BUSY','The saved source concurrency limit is already in use.'));
    const controller=new AbortController(),abort=()=>controller.abort(),job={controller,done:null};
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    jobs.add(job);
    job.done=(async()=>{
      try{checkAbort(controller.signal);const value=await action(controller.signal);checkAbort(controller.signal);completed+=1;return value;}
      catch(issue){failures+=1;throw issue;}
      finally{signal?.removeEventListener('abort',abort);jobs.delete(job);}
    })();
    return job.done;
  }
  async function withConnection(action,{signal}={}){
    checkAbort(signal);
    const connection=await connectRisingWave(config,{env,signal});sessions.add(connection);lastVersion=connection.identity.version;
    try{return await action(connection);}finally{await connection.close();sessions.delete(connection);}
  }
  function columnTypes(query,fields,rows){
    const native=new Map(fields.map(field=>[field.name,field]));
    return Object.entries(query.columns).map(([name,spec])=>({name,type:spec.type,nullable:spec.nullable,
      source:{column:spec.column,type:native.get(spec.column).type,typeOid:native.get(spec.column).typeOid},
      counts:{null:rows.filter(row=>row[name]===null).length,value:rows.filter(row=>row[name]!==null).length}}));
  }
  function preflight(options={}){
    exact(options,['signal'],'RISINGWAVE_PREFLIGHT_OPTIONS_INVALID');
    return withJob(options.signal,signal=>withConnection(async connection=>{
      for(const [name,declaration]of Object.entries(queries)){
        const value=await inspectQuerySource(connection,declaration);
        if(!value.subscription)throw fail('RISINGWAVE_SUBSCRIPTION_REQUIRED');
        validateNativeColumns(declaration,value.relation.columns);types[name]=columnTypes(declaration,value.relation.columns,[]);
      }
      return {sourceHash:actualHash,columnTypes:structuredClone(types),version:connection.identity.version};
    },{signal}));
  }
  function query(name,input={},options={}){
    const declaration=definition(name);exact(options,['signal'],'RISINGWAVE_QUERY_OPTIONS_INVALID');
    return withJob(options.signal,signal=>withConnection(async connection=>{
      const relation=await readRelation(connection,declaration.relation);
      validateNativeColumns(declaration,relation.columns);
      const prepared=risingWaveStatement(declaration,input,relation.columns),result=await connection.query(prepared.sql,prepared.values,{phase:'preview'});
      if(result.fields.length!==Object.keys(declaration.columns).length||result.fields.some((field,index)=>field.name!==Object.keys(declaration.columns)[index]||
          field.typeOid!==relation.columns.find(value=>value.name===declaration.columns[field.name].column)?.typeOid))
        throw fail('RISINGWAVE_PREVIEW_FIELDS_CHANGED');
      const outputFields=Object.entries(declaration.columns).map(([alias,spec],index)=>({
        ...relation.columns.find(field=>field.name===spec.column),name:alias}));
      const outputQuery={...declaration,columns:Object.fromEntries(Object.entries(declaration.columns).map(([alias,spec])=>[alias,{...spec,column:alias}]))};
      const truncated=result.rows.length>declaration.maxRows;
      const rows=result.rows.slice(0,declaration.maxRows).map(row=>projectRecord(row,outputQuery,outputFields));
      const observedTypes=columnTypes(declaration,relation.columns,rows);types[name]=observedTypes;
      const value={schema:'stellar-forge.risingwave-query-result.v1',query:name,input:prepared.input,sourceHash:actualHash,
        sourcePin:SOURCE_PIN,version:connection.identity.version,relation,sql:prepared.sql,columns:Object.keys(declaration.columns),
        columnTypes:observedTypes,rows,rowCount:rows.length,truncated,complete:!truncated,
        scope:'bounded-live-preview',maxRows:declaration.maxRows,observedAt:now(),valueEncoding:'risingwave-pgwire-text-with-declared-scalars'};
      if(Buffer.byteLength(JSON.stringify(value))>declaration.maxBytes)throw fail('RISINGWAVE_PREVIEW_BYTE_LIMIT');
      return value;
    },{signal}));
  }
  function discover(options={}){
    const {signal,...rest}=options;
    return withJob(signal,sig=>withConnection(async connection=>{
      const result=await discoverRisingWave(connection,rest);
      lastDiscovery={schema:'stellar-forge.risingwave-catalogue.v1',sourceHash:actualHash,...result};
      return structuredClone(lastDiscovery);
    },{signal:sig}));
  }
  function capture(name,input={},options={}){
    definition(name);
    const directory=options.directory??(captureDirectory?join(captureDirectory,randomUUID()):undefined);
    return withJob(options.signal,signal=>captureRisingWave(context,name,input,{...options,directory,signal}));
  }
  function resumeCapture(directory,options={}){
    exact(options,['signal','onProgress'],'RISINGWAVE_CAPTURE_RESUME_OPTIONS_INVALID');
    return withJob(options.signal,async signal=>{
      const intent=await optionalJson(join(absolute(directory),'intent.json'));
      if(!intent||intent.schema!=='stellar-forge.risingwave-capture-intent.v1'||intent.request?.sourceHash!==actualHash||
          identity(intent.request)!==intent.requestHash)throw fail('RISINGWAVE_CAPTURE_RESUME_IDENTITY_INVALID');
      const original=intent.request;definition(original.query);
      if(identity(bindRisingWaveParameters(queries[original.query],original.input))!==identity(original.input))
        throw fail('RISINGWAVE_CAPTURE_INPUT_CHANGED');
      return captureRisingWave(context,original.query,original.input,{...original.extraction,directory,
        baseCaptureDirectory:original.baseCaptureDirectory,signal,onProgress:options.onProgress});
    });
  }
  function subscriptionInspect(name,options={}){
    exact(options,['signal'],'RISINGWAVE_SUBSCRIPTION_INSPECT_OPTIONS_INVALID');
    return withJob(options.signal,signal=>inspectRisingWaveSubscription({...context,withConnection:(action)=>withConnection(action,{signal})},name));
  }
  function prepareSubscription(name,options={}){
    const {signal,...rest}=options;
    return withJob(signal,sig=>prepareRisingWaveSubscription({...context,withConnection:(action)=>withConnection(action,{signal:sig})},name,rest));
  }
  function createSubscription(review,options={}){
    return withJob(options.signal,signal=>createReviewedRisingWaveSubscription(context,review,{...options,signal}));
  }
  function exportDataset(name,input={},supplied={}){
    const declaration=definition(name),{onRow,signal,...rest}=supplied;
    if(typeof onRow!=='function')return Promise.reject(fail('DATASET_EXTRACTION_WRITER_REQUIRED'));
    const options=risingWaveDatasetExtractionOptions(declaration,rest),normalized=bindRisingWaveParameters(declaration,input);
    if(!captureDirectory)return Promise.reject(fail('RISINGWAVE_CAPTURE_DIRECTORY_REQUIRED'));
    return withJob(signal,async sig=>{
      await privateDirectory(captureDirectory,true);
      const family=identity({sourceHash:actualHash,query:name,relation:declaration.relation,subscription:declaration.subscription,
        keys:declaration.key.map(alias=>declaration.columns[alias].column)});
      const history=join(captureDirectory,family);await privateDirectory(history,true);
      const release=await acquireWorkspace(history);
      try{
        const head=await optionalJson(join(history,'latest.json')),pending=await optionalJson(join(history,'pending.json'));
        const captureRequest={query:name,input:normalized,extraction:options,baseCaptureDirectory:pending?.request?.baseCaptureDirectory??head?.directory??null},
          key=identity(captureRequest);
        let selected;
        if(pending){
          if(pending.requestHash!==key)throw fail('RISINGWAVE_PENDING_CAPTURE_DIFFERENT_PLAN',
            'The previous extraction has an unfinished retained source capture. Resume its original plan before selecting another plan.',
            {directory:pending.directory});
          selected=pending;
        }else{
          selected={schema:'stellar-forge.risingwave-publisher-capture-intent.v1',requestHash:key,
            request:captureRequest,directory:join(history,randomUUID()),at:now()};
          await atomicJson(join(history,'pending.json'),selected);
        }
        const retained=await captureRisingWave(context,name,normalized,{...options,directory:selected.directory,
          baseCaptureDirectory:captureRequest.baseCaptureDirectory,signal:sig});
        const manifest=retained.manifest;
        const next={schema:'stellar-forge.risingwave-capture-head.v1',directory:retained.directory,id:manifest.id,
          manifestSha256:retained.files.manifest.sha256,checkpoint:manifest.checkpoint,at:now()};
        await atomicJson(join(history,'latest.json'),next);
        // Keep the completed request so a lost response can be inspected without another source query.
        await atomicJson(join(history,'last-request.json'),{...selected,complete:true,head:next});
        types[name]=structuredClone(manifest.columnTypes);
        let rowCount=0;
        for await(const row of readRisingWaveRows(retained,{signal:sig,maxRowBytes:options.maxRowBytes})){
          rowCount+=1;await onRow(row,structuredClone(manifest.columnTypes),{rowCount});
        }
        if(rowCount!==manifest.rowCount)throw fail('RISINGWAVE_CAPTURE_COUNT_CHANGED');
        await atomicJson(join(history,'pending.json'),null);
        return {schema:'stellar-forge.risingwave-dataset-extraction.v1',complete:true,readOnly:true,rowCount,
          columns:manifest.columns,columnTypes:manifest.columnTypes,valueEncoding:manifest.valueEncoding,
          nullEncoding:manifest.nullEncoding,snapshot:manifest.snapshot,sourceHash:actualHash,sourcePin:SOURCE_PIN,
          capture:{schema:manifest.schema,id:manifest.id,directory:retained.directory,manifestSha256:retained.files.manifest.sha256,
            rowCount,sourceRowCount:manifest.sourceRowCount,complete:true,orderedRowsSha256:manifest.orderedRowsSha256,
            files:retained.files,checkpoint:manifest.checkpoint,barrier:manifest.barrier,baseCapture:manifest.baseCapture},
          request:manifest.request,sourceIdentity:manifest.sourceIdentity};
      }finally{await release();}
    });
  }
  function route(name,{input='query'}={}){
    const declaration=definition(name);
    if(!['query','body'].includes(input))throw fail('RISINGWAVE_ROUTE_INPUT_INVALID');
    const values=context=>context?.[input]??{};
    return Object.freeze({admit(context){
      try{
        bindRisingWaveParameters(declaration,values(context));
        return closed?{status:503,body:{error:'SOURCE_CLOSED'}}:jobs.size>=config.maxInFlight?
          {status:429,headers:{'retry-after':'1'},body:{error:'SOURCE_BUSY'}}:true;
      }catch(issue){if(issue instanceof QueryInputError)return{status:422,body:{error:'QUERY_INPUT_INVALID',code:issue.code,field:issue.field}};throw issue;}
    },async handler(context){
      try{return{status:200,body:await query(name,values(context),{signal:context?.signal})};}
      catch(issue){return{status:issue instanceof QueryInputError?422:503,body:{error:issue.code??'RISINGWAVE_SOURCE_FAILED'}};}
    }});
  }
  function close(){
    if(closing)return closing;closed=true;
    const pending=[...jobs];for(const job of pending)job.controller.abort();
    closing=Promise.allSettled([...sessions].map(session=>session.close()).concat(pending.map(job=>job.done))).then(()=>{});
    return closing;
  }
  return Object.freeze({query,discover,preflight,capture,resumeCapture,exportDataset,inspectSubscription:subscriptionInspect,
    prepareSubscription,createSubscription,route,close,validate:(name,input)=>bindRisingWaveParameters(definition(name),input),
    describe:()=>describeRisingWaveQueries(queries),
    inspect:()=>({schema:'stellar-forge.risingwave-inspection.v1',sourceHash:actualHash,sourceConfigHash:context.sourceConfigHash,
      sourceFile:sourceFile??null,sourcePin:SOURCE_PIN,version:lastVersion,queries:describeRisingWaveQueries(queries),
      columnTypes:structuredClone(types),transport:'native-pgwire-text',snapshot:'native-subscription-complete-boundary',
      lastDiscovery:structuredClone(lastDiscovery)}),
    status:()=>({schema:'stellar-forge.risingwave-status.v1',state:closed?'CLOSED':'READY',active:jobs.size,
      maxInFlight:config.maxInFlight,completed,failures})});
}
