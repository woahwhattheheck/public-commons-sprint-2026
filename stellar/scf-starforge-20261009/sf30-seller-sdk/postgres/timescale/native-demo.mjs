#!/usr/bin/env node
// MIT. Operate one isolated native Timescale demonstration through the complete product.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readPostgresSourceFile, resolvePostgresConnection } from '../config.mjs';
import { bytes, digest, identity, readPrivate, readJson, createFile, atomicJson, privateDirectory, fault, stamp } from '../publisher/files.mjs';
import { loadDatasetConfig } from '../../dataset-handler.mjs';
import { openTimescaleWorkspace } from './model.mjs';
import { startTimescaleWorkspaceServer } from './server.mjs';
import { exportTimescaleWorkspace, inspectTimescalePackage, receiveTimescaleWorkspace } from './package.mjs';
import { identifier, tableRows } from './contracts.mjs';
import { TEXT_TYPES } from './native.mjs';
const SEED=[
  ['2026-10-01T00:05:00Z','line-a','9007199254740993.01'],
  ['2026-10-01T00:45:00Z','line-a','0.99'],
  ['2026-10-01T01:15:00Z','line-a','3.125'],
  ['2026-10-01T00:30:00Z','line-b','4.75']
];
const LATE=[['2026-10-01T00:20:00Z','line-a','2.50'],['2026-10-01T02:10:00Z','line-b','1.25']];
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function runNativeDemo({directory,connectionFile}){
  directory=resolve(directory);connectionFile=resolve(connectionFile);
  await privateDirectory(directory,true);
  const declarationBytes=await readPrivate(connectionFile),declarationDigest=digest(declarationBytes);
  const recordPath=join(directory,'native-demo.json');
  let record;
  if(await exists(recordPath)){
    record=await readJson(recordPath,16777216);
    if(record.schema!=='stellar-forge.timescale-native-demo.v1'||record.connectionDigest!==declarationDigest||record.connectionFile!==connectionFile)
      throw fault('TIMESCALE_DEMO_BINDING_CHANGED');
  }else{
    const id=randomUUID();
    record={schema:'stellar-forge.timescale-native-demo.v1',id,namespace:'sf_ts_'+id.replaceAll('-','').slice(0,16),
      createdAt:stamp(),connectionFile,connectionDigest:declarationDigest,
      originalInputs:{kind:'explicit-native-product-demonstration',seed:SEED,late:LATE,timeBucket:'1 hour',window:{start:'2026-10-01T00:00:00Z',end:'2026-10-01T03:00:00Z',timezone:'UTC'}},
      requestIds:Object.fromEntries(['before','prepare-first','first-refresh','first-verify','prepare-job','apply-job','after','prepare-second','second-refresh','second-verify','review','select','extract','export','receive'].map(key=>[key,randomUUID()])),
      phases:{},complete:false};
    await createFile(recordPath,bytes(record));
  }
  const save=()=>atomicJson(directory,'native-demo.json',record);
  async function phase(name,work){
    if(record.phases[name]?.state==='COMPLETE')return record.phases[name].result;
    record.phases[name]={...record.phases[name],state:'RUNNING',startedAt:record.phases[name]?.startedAt??stamp()};await save();
    try{
      const result=await work();record.phases[name]={...record.phases[name],state:'COMPLETE',completedAt:stamp(),result};await save();
      process.stdout.write(JSON.stringify({phase:name,state:'COMPLETE',record:recordPath})+'\n');return result;
    }catch(error){record.phases[name]={...record.phases[name],state:'FAILED',error:{code:error.code??'NATIVE_DEMO_FAILED',sqlState:/^[A-Z0-9]{5}$/.test(error.code??'')?error.code:null}};await save();throw error;}
  }
  const {Client}=await import('pg');
  const config=await resolvePostgresConnection(await readPostgresSourceFile(connectionFile));
  const client=new Client({...config,connectionTimeoutMillis:10000,statement_timeout:600000,application_name:'sf30-timescale-native-demo',types:TEXT_TYPES});
  let workspace,listener,received;
  try{
    await client.connect();await client.query("SET TimeZone='UTC'");
    const actual=await client.query("SELECT e.extversion,n.nspname AS extension_schema,current_setting('server_version') AS server_version,current_database() AS database_name FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='timescaledb'");
    if(actual.rows.length!==1||actual.rows[0].extversion!=='2.30.2')throw fault('TIMESCALE_DEMO_VERSION_REQUIRED','Run this retained journey on the selected native TimescaleDB2.30.2 installation.');
    const native=actual.rows[0],schema=identifier(record.namespace),ext=identifier(native.extension_schema);
    record.native=native;await save();
    const owned=await client.query("SELECT pg_catalog.obj_description(oid,'pg_namespace') AS owner_marker FROM pg_catalog.pg_namespace WHERE nspname=$1",[record.namespace]);
    if(owned.rows.length&&owned.rows[0].owner_marker!=='stellar-forge-native-demo:'+record.id)
      throw fault('TIMESCALE_DEMO_NAMESPACE_OWNED','The selected namespace belongs to another original operation.');
    await phase('native-source',async()=>{
      await client.query('BEGIN');
      try{
        if(owned.rows.length){
          const retained=await client.query('SELECT outcome FROM '+schema+'._journey WHERE operation_id=$1',['source']);
          if(retained.rows.length){await client.query('COMMIT');return JSON.parse(retained.rows[0].outcome);}
          throw fault('TIMESCALE_DEMO_SOURCE_INCOMPLETE');
        }
        await client.query('CREATE SCHEMA '+schema);
        await client.query('COMMENT ON SCHEMA '+schema+" IS 'stellar-forge-native-demo:"+record.id+"'");
        await client.query('CREATE TABLE '+schema+'._journey(operation_id text PRIMARY KEY,outcome jsonb NOT NULL)');
        await client.query('CREATE TABLE '+schema+'.readings(observed_at timestamptz NOT NULL,line text NOT NULL,reading numeric NOT NULL,PRIMARY KEY(observed_at,line))');
        await client.query('SELECT '+ext+'.create_hypertable($1::regclass,$2::name,chunk_time_interval=>$3::interval)',[record.namespace+'.readings','observed_at','1 day']);
        for(const row of record.originalInputs.seed)await client.query('INSERT INTO '+schema+'.readings VALUES($1::timestamptz,$2::text,$3::numeric)',row);
        await client.query('CREATE MATERIALIZED VIEW '+schema+'.hourly WITH(timescaledb.continuous,timescaledb.materialized_only=true) AS SELECT '+ext+".time_bucket(INTERVAL '1 hour',observed_at) AS bucket,line,count(*) AS samples,sum(reading) AS total FROM "+schema+'.readings GROUP BY bucket,line WITH NO DATA');
        const policy=await client.query('SELECT '+ext+'.add_continuous_aggregate_policy($1::regclass,NULL::interval,$2::interval,$3::interval,initial_start=>$4::timestamptz,timezone=>$5::text) AS job_id',
          [record.namespace+'.hourly','1 hour','1 hour','2099-01-01T00:00:00Z','UTC']);
        const result={namespace:record.namespace,relation:record.namespace+'.hourly',jobId:policy.rows[0].job_id,seedRows:record.originalInputs.seed.length,native};
        await client.query('INSERT INTO '+schema+'._journey VALUES($1,$2::jsonb)',['source',JSON.stringify(result)]);await client.query('COMMIT');return result;
      }catch(error){await client.query('ROLLBACK');throw error;}
    });
    const workspaceDirectory=join(directory,'workspace');
    workspace=await openTimescaleWorkspace({directory:workspaceDirectory,create:!await exists(join(workspaceDirectory,'workspace.json')),
      sourceFile:connectionFile,maintenanceSourceFile:connectionFile,targetDirectory:join(directory,'dataset'),title:'Native Timescale usage operations'});
    const complete=async started=>{const result=await started.completion;if(result.state!=='COMPLETE')throw fault(result.data.error?.code??'TIMESCALE_DEMO_OPERATION_FAILED');return result.data.result;};
    const before=await phase('before',()=>complete(workspace.startCapture({requestId:record.requestIds.before,title:'Original source and native policy',note:'Capture the native continuous aggregate and original scheduled policy before operating the selected day.'})));
    const beforeEdition=await workspace.edition(before.editionId);
    const selected=beforeEdition.catalog.find(row=>row.schema===record.namespace&&row.name==='hourly');
    if(!selected)throw fault('TIMESCALE_DEMO_AGGREGATE_MISSING');
    const selection={editionId:beforeEdition.value.id,editionDigest:beforeEdition.record.digest,aggregateKey:selected.key,
      timeColumn:'bucket',timeType:'timestamptz',...record.originalInputs.window,title:'October usage',owner:'Native product operator',
      note:'Operate the original explicit input rows through the actual Timescale aggregate.'};
    const prepared=await phase('prepare-first',()=>complete(workspace.prepareRefresh({requestId:record.requestIds['prepare-first'],plan:{...selection,bucketsPerBatch:10,maxBatches:0,newestFirst:true,force:false}})));
    const planBinding={planId:prepared.planId,planDigest:prepared.digest};
    await phase('first-refresh',()=>complete(workspace.startRefresh({requestId:record.requestIds['first-refresh'],...planBinding})));
    const verify=await phase('first-verify',()=>complete(workspace.startVerification({requestId:record.requestIds['first-verify'],...planBinding})));
    if(verify.matches!==true)throw fault('TIMESCALE_DEMO_FIRST_AGGREGATE_DIFFERS');
    const job=await phase('prepare-job',()=>complete(workspace.prepareJob({requestId:record.requestIds['prepare-job'],
      editionId:beforeEdition.value.id,editionDigest:beforeEdition.record.digest,jobId:record.phases['native-source'].result.jobId,
      changes:{scheduled:false,schedule_interval:'2 hours',timezone:'UTC'},title:'Customer-operated schedule',
      owner:'Native product operator',note:'Retain the native schedule change and disable autonomous runs for this isolated demonstration.'})));
    await phase('apply-job',()=>complete(workspace.applyJob({requestId:record.requestIds['apply-job'],planId:job.planId,planDigest:job.digest})));
    await phase('late-native-input',async()=>{
      await client.query('BEGIN');
      try{
        const old=await client.query('SELECT outcome FROM '+schema+'._journey WHERE operation_id=$1',['late']);
        if(old.rows.length){await client.query('COMMIT');return JSON.parse(old.rows[0].outcome);}
        for(const row of record.originalInputs.late)await client.query('INSERT INTO '+schema+'.readings VALUES($1::timestamptz,$2::text,$3::numeric)',row);
        const result={rows:record.originalInputs.late.length,originalInputs:record.originalInputs.late};
        await client.query('INSERT INTO '+schema+'._journey VALUES($1,$2::jsonb)',['late',JSON.stringify(result)]);await client.query('COMMIT');return result;
      }catch(error){await client.query('ROLLBACK');throw error;}
    });
    const second=await phase('prepare-second',()=>complete(workspace.prepareRefresh({requestId:record.requestIds['prepare-second'],plan:{...selection,bucketsPerBatch:0,maxBatches:0,newestFirst:true,force:false}})));
    const secondBinding={planId:second.planId,planDigest:second.digest};
    await phase('second-refresh',()=>complete(workspace.startRefresh({requestId:record.requestIds['second-refresh'],...secondBinding})));
    const compared=await phase('second-verify',()=>complete(workspace.startVerification({requestId:record.requestIds['second-verify'],...secondBinding})));
    if(compared.matches!==true)throw fault('TIMESCALE_DEMO_SECOND_AGGREGATE_DIFFERS');
    const after=await phase('after',()=>complete(workspace.startCapture({requestId:record.requestIds.after,title:'Refreshed aggregate and native schedule',
      note:'Retain the complete after edition following late input, native refresh, complete result comparison and job setting change.'})));
    await phase('review',async()=>{
      const comparison=await workspace.comparison(before.editionId,after.editionId);
      return complete(workspace.saveReview({requestId:record.requestIds.review,beforeId:before.editionId,afterId:after.editionId,
        comparisonDigest:identity(comparison),reviewer:'Native product operator',note:'Review all captured native changes for this explicit demonstration.',
        decisions:comparison.changes.map(row=>({changeKey:row.key,decision:'ACCEPT',owner:'Native product operator',note:'Observed in the retained source and executed operation sequence.'}))}));
    });
    const afterEdition=await workspace.edition(after.editionId);
    const publication=await phase('select',()=>complete(workspace.selectAggregate({requestId:record.requestIds.select,selection:{
      ...selection,editionId:after.editionId,editionDigest:afterEdition.record.digest,columns:['bucket','line','samples','total']}})));
    const extraction=await phase('extract',()=>complete(workspace.startPublicationExtraction({requestId:record.requestIds.extract,planId:publication.planId,planDigest:publication.digest})));
    if(!['READY','REVIEWED','PUBLISHED'].includes(extraction.state))throw fault('TIMESCALE_DEMO_EXTRACTION_FAILED');
    await phase('publish',async()=>{
      let run=workspace.publisher.run(extraction.runId);
      if(run.state==='PUBLISHED')return run.data.publication;
      if(run.state==='PUBLICATION_UNKNOWN'){run=await workspace.publisher.recover(run.id);if(run.state==='PUBLISHED')return run.data.publication;}
      if(run.state!=='REVIEWED')run=await workspace.publisher.review(run.id,{reviewer:'Native product operator',note:'Complete native aggregate comparison and original exact-text extraction reviewed.',initialize:true});
      const result=await workspace.publisher.publish(run.id,run.data.review.id);
      if(result.state!=='PUBLISHED')throw fault('TIMESCALE_DEMO_PUBLICATION_FAILED');return result.data.publication;
    });
    listener=await startTimescaleWorkspaceServer({workspace,port:0});
    await phase('original-http-operator',async()=>{
      const page=await fetch(listener.url),html=await page.text();
      const state=await fetch(listener.url+'/api/timescale/status').then(x=>x.json());
      if(page.status!==200||!html.includes('/timescale/app.mjs')||state.id!==workspace.settings.id)throw fault('TIMESCALE_DEMO_OPERATOR_UNAVAILABLE');
      return {httpStatus:page.status,url:listener.url,workspaceId:state.id,editionCount:state.editions.total,
        browserExecution:false,interpretation:'Original native HTTP listener and complete HTML were read; this phase does not claim DOM/browser execution.'};
    });
    const exported=await phase('export',()=>complete(exportTimescaleWorkspace(workspace,{requestId:record.requestIds.export,outputDirectory:join(directory,'package')})));
    const inspected=await phase('inspect-package',()=>inspectTimescalePackage(exported.directory,exported.manifestDigest));
    const receiving=await phase('receive',()=>receiveTimescaleWorkspace({requestId:record.requestIds.receive,packageDirectory:exported.directory,
      expectedDigest:exported.manifestDigest,directory:join(directory,'received')}));
    await listener.close();listener=null;workspace=null;
    received=await openTimescaleWorkspace({directory:receiving.directory});
    const reopened=await phase('reopen-and-original-customer',async()=>{
      const saved=received.status({limit:100});
      const observed=await received.edition(after.editionId);
      if(saved.editions.total!==2||observed.record.digest!==after.digest)throw fault('TIMESCALE_DEMO_RECEIVED_HISTORY_CHANGED');
      const version=record.phases.publish.result.snapshot;
      const dataset=await loadDatasetConfig(join(receiving.targetDirectory,'generations',version,'dataset.json'));
      const page=dataset.handle({query:new URLSearchParams('limit=50')});
      if(page.status!==200||page.body.page.total!==4||page.body.rows.length!==4||
          !page.body.rows.some(row=>row.line==='line-a'&&row.total==='9007199254740996.50'))throw fault('TIMESCALE_DEMO_EXACT_CUSTOMER_ROWS_CHANGED');
      const retained=await received.publisher.inspect(extraction.runId,'limit=50');
      if(retained.run.state!=='PUBLISHED')throw fault('TIMESCALE_DEMO_RECEIVED_PUBLICATION_CHANGED');
      return {workspaceId:saved.id,editions:saved.editions.total,originalPublication:retained.run.data.publication,
        completeCustomerPage:page.body,receivedEditionDigest:observed.record.digest,packageDigest:inspected.manifestDigest};
    });
    record.complete=true;record.completedAt=stamp();record.receiving=receiving;record.customer=reopened;await save();
    return {complete:true,record:recordPath,namespace:record.namespace,native,package:exported,receiving};
  }finally{await listener?.close();await workspace?.close();await received?.close();await client.end();}
}
async function main(argv=process.argv.slice(2)){
  const values={};
  while(argv.length){const key=argv.shift(),value=argv.shift();if(!['--directory','--connection'].includes(key)||!value||values[key])throw fault('TIMESCALE_DEMO_USAGE','Use --directory NEW_PRIVATE_DIRECTORY --connection ORIGINAL_PRIVATE_SOURCE_JSON on the selected isolated Timescale2.30.2 database.');values[key]=value;}
  if(!values['--directory']||!values['--connection'])throw fault('TIMESCALE_DEMO_USAGE');
  const result=await runNativeDemo({directory:values['--directory'],connectionFile:values['--connection']});process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}

export { runNativeDemo, main };
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(issue=>{process.stderr.write(JSON.stringify({error:issue.code??'TIMESCALE_NATIVE_DEMO_FAILED'})+'\n');process.exitCode=1;});
