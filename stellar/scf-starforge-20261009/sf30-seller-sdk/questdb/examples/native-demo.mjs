// MIT. Operate the real QuestDB demo through the original retained workbench.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { compileQuestDbReport } from '../report.mjs';
import { readQuestDbCapture } from '../source.mjs';
import { readCapturedRows } from '../result.mjs';
import { timestampValue, identity } from '../common.mjs';

const execute=promisify(execFile),hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const optional=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(issue){if(issue.code==='ENOENT')return null;throw issue;}};
async function atomic(path,value){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,json(value),{mode:0o600,flag:'wx'});await rename(temp,path);}
async function immutable(path,value){
  const encoded=json(value);
  try{await writeFile(path,encoded,{mode:0o600,flag:'wx'});}
  catch(issue){if(issue.code!=='EEXIST')throw issue;if(await readFile(path,'utf8')!==encoded)throw new Error('Retained native case input changed: '+path);}
}
const shortCapture=value=>({id:value.manifest.id,directory:value.directory,rowCount:value.manifest.rowCount,
  reportedCount:value.manifest.reportedCount,orderedRowsSha256:value.manifest.orderedRowsSha256,
  columnTypes:value.manifest.columnTypes,files:value.files,serverVersion:value.manifest.serverVersion,
  nativeExport:value.manifest.nativeExport});
function reports({from,firstTo,to,historyFrom}){
  const symbols=['BTC-USDT','ETH-USDT','XLM-USDT'];
  const parameters={from:{type:'timestamp'},to:{type:'timestamp'},
    symbol0:{type:'symbol',enum:symbols},symbol1:{type:'symbol',enum:symbols},symbol2:{type:'symbol',enum:symbols}};
  const probe={from,to:firstTo,symbol0:symbols[0],symbol1:symbols[1],symbol2:symbols[2]};
  const columns=['event_time','event_time_ns','event_epoch_ns','symbol','side','price','amount',
    'decimal_price','null_note','empty_note','side_note','is_buy'];
  const sql=[
    'SELECT timestamp AS event_time, cast(timestamp as timestamp_ns) AS event_time_ns,',
    'cast(cast(timestamp as timestamp_ns) as long) AS event_epoch_ns, symbol, side, price, amount,',
    'cast(price as decimal(38,18)) AS decimal_price, cast(null as string) AS null_note,',
    "cast('' as string) AS empty_note, CASE WHEN side='buy' THEN cast(null as string) ELSE cast('' as string) END AS side_note,",
    "(side='buy') AS is_buy FROM trades",
    'WHERE timestamp >= $from AND timestamp < $to AND symbol in ($symbol0,$symbol1,$symbol2)',
    'ORDER BY timestamp, symbol, side, price, amount'
  ].join('\n');
  const common={table:'trades',timestamp:'timestamp',timestampType:'timestamp',
    window:{start:'from',end:'to'},parameters:{symbol:{type:'symbol',enum:symbols}},
    filters:[{column:'symbol',op:'eq',parameter:'symbol'}],maxRows:100,maxBytes:1048576,timeoutMs:120000,
    probe:{from,to,symbol:'BTC-USDT'}};
  return{
    executions:{sql,parameters,parameterOrder:Object.keys(parameters),columns,maxRows:100,maxBytes:1048576,
      timeoutMs:120000,probe},
    window:compileQuestDbReport({...common,kind:'window',columns:[
      {name:'event_time',column:'timestamp'},{name:'symbol',column:'symbol'},
      {name:'side',column:'side'},{name:'price',column:'price'},{name:'amount',column:'amount'}]}),
    sampled:compileQuestDbReport({...common,kind:'sample',timestampAlias:'bucket',sample:{
      interval:'1m',keys:['symbol'],aggregates:[{name:'executions',fn:'count'},
        {name:'volume',fn:'sum',column:'amount'},{name:'first_price',fn:'first',column:'price'},
        {name:'last_price',fn:'last',column:'price'}],fill:'none',alignment:'calendar'}}),
    preceding:compileQuestDbReport({...common,kind:'asof',
      parameters:{...common.parameters,leftSide:{type:'symbol',enum:['buy','sell']},
        rightSide:{type:'symbol',enum:['buy','sell']},historyFrom:{type:'timestamp'}},
      filters:[...common.filters,{column:'side',op:'eq',parameter:'leftSide'}],
      probe:{...common.probe,leftSide:'buy',rightSide:'sell',historyFrom},
      asof:{table:'trades',timestamp:'timestamp',timestampType:'timestamp',tolerance:'1s',
        keys:[{left:'symbol',right:'symbol'}],filters:[
          {column:'symbol',op:'eq',parameter:'symbol'},
          {column:'side',op:'eq',parameter:'rightSide'},
          {column:'timestamp',op:'gte',parameter:'historyFrom'}]},
      columns:[{name:'event_time',column:'timestamp',side:'left'},
        {name:'symbol',column:'symbol',side:'left'},{name:'price',column:'price',side:'left'},
        {name:'previous_time',column:'timestamp',side:'right'},
        {name:'previous_price',column:'price',side:'right'},{name:'previous_side',column:'side',side:'right'}]})
  };
}
async function nativeReportChecks(name,capture,{from,to}){
  let rows=0,matched=0,unmatched=0;const lower=timestampValue(from),upper=timestampValue(to);
  for await(const row of readCapturedRows(join(capture.directory,capture.files.ndjson.path),capture.files.ndjson)){
    rows++;assert.equal(row.symbol,'BTC-USDT');
    if(name==='preceding'){
      const at=timestampValue(row.event_time);assert.ok(at>=lower&&at<upper);
      if(row.previous_time===null){unmatched++;assert.equal(row.previous_side,null);assert.equal(row.previous_price,null);}
      else{matched++;const before=timestampValue(row.previous_time);assert.ok(before<=at&&at-before<=1000000000n);assert.equal(row.previous_side,'sell');}
    }else if(name==='sampled'){
      const bucket=timestampValue(row.bucket);assert.ok(bucket>=lower&&bucket<upper);
      assert.equal(typeof row.executions,'string');assert.ok(BigInt(row.executions)>0n);
    }
  }
  assert.equal(rows,capture.manifest.rowCount);
  return{rows,ndjsonSha256:capture.files.ndjson.sha256,...(name==='preceding'?{matched,unmatched,toleranceNanoseconds:'1000000000'}:{interval:'1m'})};
}
export async function runQuestDbNativeJourney({directory,from,firstTo,to,historyFrom,
  endpoint='https://demo.questdb.io/',sourcePin=null,onEvent=()=>{}}={}){
  assert.equal(typeof directory,'string');directory=resolve(directory);
  for(const value of [from,firstTo,to,historyFrom])timestampValue(value);
  assert.ok(timestampValue(from)<timestampValue(firstTo)&&timestampValue(firstTo)<timestampValue(to));
  assert.ok(timestampValue(historyFrom)<=timestampValue(from)-1000000000n,
    'The explicit preceding-series floor must include the entire one-second tolerance before the left window.');
  await mkdir(directory,{recursive:true,mode:0o700});
  const stat=await lstat(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077));
  const requested={schema:'native.questdb-source-case.v1',endpoint,from,firstTo,to,historyFrom,
    symbols:['BTC-USDT','ETH-USDT','XLM-USDT'],sourceKind:'Actual OKX executions in the selected QuestDB demonstration instance',
    derivedFields:{event_time_ns:'Native timestamp cast; source observation precision is unchanged',
      event_epoch_ns:'Native nanosecond epoch LONG derived from the actual event timestamp',
      decimal_price:'Native DECIMAL(38,18) cast of the original DOUBLE price',
      null_note:'Explicit native NULL encoding field',empty_note:'Explicit native empty-text encoding field',
      side_note:'Native NULL for buys and empty text for other executions',is_buy:'Native execution-side Boolean'}};
  await immutable(join(directory,'case.json'),requested);
  const completed=await optional(join(directory,'journey-result.json'));
  if(completed?.outcome==='PASS')return completed;
  const attempt=randomUUID(),startedAt=new Date().toISOString();
  await mkdir(join(directory,'attempts'),{recursive:true,mode:0o700});
  const progress=await optional(join(directory,'journey-progress.json'))??
    {schema:'native.questdb-source-progress.v1',startedAt,attempts:[]};
  progress.attempts.push({id:attempt,startedAt,sourcePin,node:process.version});
  const save=async values=>{Object.assign(progress,values);await atomic(join(directory,'journey-progress.json'),progress);};
  await save({});
  const event=async(name,value)=>{await save({lastEvent:{name,at:new Date().toISOString(),...value}});onEvent({event:name,...value});};
  const environment={...process.env,QUESTDB_HTTP_URL:endpoint},workspaceDirectory=join(directory,'workbench');
  const connectionFile=join(directory,'connection.json'),sourceFile=join(directory,'source.json'),merchantFile=join(directory,'merchant.json');
  const configuration={schema:'stellar-forge.questdb-source.v1',endpointEnv:'QUESTDB_HTTP_URL',
    maxInFlight:1,startupTimeoutMs:120000,queries:reports({from,firstTo,to,historyFrom})};
  const paymentOptions=[
    {scheme:'exact',network:'stellar:testnet',asset:'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      payTo:'GDWR665E7ES4TIQBDAFJMWSEF6Z4GW7DJJLDCVUSDSXXZL6FPQYN2UL5',amount:'900719925474099312345',
      maxTimeoutSeconds:60,extra:{name:'Retained QuestDB execution dataset',version:'1'}},
    {scheme:'exact',network:'stellar:testnet',asset:'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      payTo:'GDC5QPBHAXNKAGL2O4IU4CUTUPF5FLHRUWZG3OVLSMHDU3MCXSHBY4JB',amount:'10001',maxTimeoutSeconds:60}
  ];
  const merchant={publicOrigin:'https://questdb-demo.example',description:'Actual retained QuestDB execution editions',
    serviceName:'QuestDB native operator',tags:['questdb','native','dataset'],paymentOptions};
  let session,client,result,failure,publicationId=progress.publicationId??null;
  let verifies=0,settlements=0,paidRequests=0;
  const facilitatorClient={
    async getSupported(){return{kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet'}],extensions:['bazaar'],signers:{}};},
    async verify(){verifies++;return{isValid:true,payer:'disposable-questdb-native-payer'};},
    async settle(){settlements++;return{success:true,transaction:hash('disposable-questdb-native-'+settlements),network:'stellar:testnet'};}
  };
  const extraction={maxRows:50000,maxBytes:4194304,maxRowBytes:1048576,timeoutMs:120000,includeNativeCsv:false};
  const dataset={name:'questdb_executions',columns:Object.fromEntries(configuration.queries.executions.columns.map(name=>
    [name,{type:name==='is_buy'?'boolean':'string',nullable:['null_note','empty_note','side_note'].includes(name)}])),
    filters:['symbol','side'],sorts:['event_time','symbol'],maxCellChars:65536,defaultLimit:20,maxLimit:250,maxPageBytes:921600};
  const command=(action,input={})=>client.publicationCommand(publicationId,action,input);
  async function extract(label,input,includeNativeCsv){
    let plan,run;
    if(progress[label+'Plan'])plan=await command('plan',{plan:progress[label+'Plan']});
    else{
      const observed=await command('source');
      plan=await command('plan/save',{title:label==='first'?'Fixed one-minute OKX edition':'Fixed widened two-minute OKX edition',
        query:'executions',sourceHash:observed.hash,input,dataset,extraction:{...extraction,includeNativeCsv}});
      await save({[label+'Plan']:plan.id});
    }
    let runId=progress[label+'Run'];
    if(!runId){
      // Recover a delivered extraction-start response by its original saved plan.
      // Each plan in this operator has one original extraction; never replay it.
      const retained=(await client.publication(publicationId)).status.runs.filter(row=>row.plan===plan.id);
      assert.ok(retained.length<=1,'Several original extractions use this plan; choose the retained run explicitly.');
      runId=retained[0]?.id;
      if(!runId)runId=(await command('extract/start',{plan:plan.id})).id;
      await save({[label+'Run']:runId});
    }
    for(;;){
      run=(await client.run(publicationId,runId)).run;
      if(run.state!=='EXTRACTING')break;
      await delay(500);
    }
    if(['FAILED','CANCELLED','INTERRUPTED'].includes(run.state)){
      try{run=await command('recover',{id:run.id});}catch{}
    }
    assert.ok(['READY','REVIEWED','PUBLISHED','PUBLICATION_UNKNOWN'].includes(run.state),
      JSON.stringify({run:run.id,state:run.state,error:run.data.error}));
    const inspection=await client.run(publicationId,run.id),candidate=inspection.run.data.candidate;
    assert.ok(candidate,'The original extraction has no complete retained candidate.');
    assert.equal(candidate.dataset.nullEncoding,'unquoted-empty');
    assert.equal(candidate.dataset.rowCount,candidate.extraction.rowCount);
    assert.ok(candidate.extraction.rowCount>0,'The selected real source window returned no executions.');
    const capture=await readQuestDbCapture(candidate.extraction.capture.directory);
    assert.equal(capture.files.manifest.sha256,candidate.extraction.capture.manifestSha256);
    await immutable(join(directory,label+'-capture.json'),shortCapture(capture));
    await save({[label+'Capture']:shortCapture(capture),[label+'Rows']:capture.manifest.rowCount});
    return{plan,run,candidate,capture};
  }
  try{
    await immutable(connectionFile,{...configuration,queries:{}});
    await immutable(sourceFile,configuration);await immutable(merchantFile,merchant);
    const [{startQuestDbWorkbench},{createQuestDbWorkbenchClient},{createNativeSellerServer},{X402BuyerClient}]=await Promise.all([
      import('../workspace/server.mjs'),import('../workspace/client.mjs'),
      import('../../native-factory.mjs'),import('../../../sf31-buyer-client/buyer.mjs')
    ]);
    const retainedWorkspace=await optional(join(workspaceDirectory,'workspace.json'));
    session=await startQuestDbWorkbench({directory:workspaceDirectory,environment,
      ...(!retainedWorkspace?{sourcePath:connectionFile,merchantPath:merchantFile}:{}),
      datasetNativeFactory:compiled=>createNativeSellerServer(compiled,{facilitatorClient})});
    client=await createQuestDbWorkbenchClient({url:session.url,environment});
    let state=await client.state();
    await save({workbench:{directory:workspaceDirectory,revision:state.revision}});
    if(!progress.discovery){
      const discovery=(await client.discover({expectedRevision:state.revision,tables:['trades']})).catalogue;
      assert.equal(discovery.tables[0].name,'trades');
      const byName=new Map(discovery.tables[0].columns.map(column=>[column.name,column]));
      for(const column of ['symbol','side','price','amount','timestamp'])assert.ok(byName.has(column),'Native trade column missing: '+column);
      await immutable(join(directory,'discovery.json'),discovery);await save({discovery});
      await event('native-schema',{serverVersion:discovery.serverVersion,columns:discovery.tables[0].columns});
    }
    if(!Object.keys(state.source?.queries??{}).length){
      state=await client.save({expectedRevision:state.revision,source:configuration,merchant});
    }
    assert.equal(identity(state.source),identity(configuration),'Retain this operator’s original reviewed report source.');
    assert.equal(identity(state.merchant),identity(merchant),'Retain this operator’s original merchant terms.');
    await save({sourceRevision:state.revision});
    if(!progress.preview){
      const observed=await client.preview({expectedRevision:state.revision,query:'window',input:configuration.queries.window.probe});
      await immutable(join(directory,'preview.json'),observed);await save({preview:observed});
      await event('native-preview',{rows:observed.sample.rowCount,reportedCount:observed.sample.reportedCount,truncated:observed.sample.truncated});
    }
    for(const[name,maxBytes]of [['sampled',524288],['preceding',2097152]]){
      let selected=progress[name+'CaptureId'],record;
      if(!selected){selected='capture-native-'+name+'-'+randomUUID();await save({[name+'CaptureId']:selected});}
      try{record=await client.captureRecord(selected);}catch(issue){if(issue.status!==404&&issue.code!=='ENOENT')throw issue;}
      if(!record)record=await client.capture({expectedRevision:state.revision,query:name,input:configuration.queries[name].probe,
        captureId:selected,extraction:{...extraction,maxBytes,includeNativeCsv:false},includeNativeCsv:false});
      while(record.state==='CAPTURING'){await delay(500);record=await client.captureRecord(selected);}
      if(record.state!=='COMPLETE'){
        try{record=await client.recoverCapture(selected);}catch{}
      }
      assert.equal(record.state,'COMPLETE',JSON.stringify({id:selected,state:record.state,error:record.error}));
      const capture=await readQuestDbCapture(record.directory),checks=await nativeReportChecks(name,capture,{from,to});
      await save({[name]:shortCapture(capture),[name+'Checks']:checks});
      await event('native-'+name,{rows:capture.manifest.rowCount,hash:capture.files.ndjson.sha256,...checks});
    }
    if(!progress.receiving){
      const received=await client.receiveCapture({captureId:progress.sampledCaptureId,directory:join(directory,'received-sample')});
      assert.equal(received.capture.rowCount,progress.sampled.rowCount);
      assert.equal(received.capture.orderedRowsSha256,progress.sampled.orderedRowsSha256);
      await save({receiving:{directory:received.directory,captureId:progress.sampledCaptureId,
        rowCount:received.capture.rowCount,files:received.receiving.files,state:received.receiving.state}});
    }
    if(!publicationId){
      const matching=(await client.state()).publications.filter(value=>value.query==='executions'&&value.revision===state.revision&&value.path==='/executions');
      assert.ok(matching.length<=1,'Choose the original dataset product before continuing this operator.');
      publicationId=matching[0]?.id??(await client.createPublication({expectedRevision:state.revision,query:'executions',path:'/executions'})).id;
      await save({publicationId});
    }
    const product=await client.publication(publicationId);
    assert.equal(product.query,'executions');assert.equal(product.revision,state.revision);
    const firstInput=structuredClone(configuration.queries.executions.probe);
    const first=await extract('first',firstInput,true);
    let initial=first.run;
    if(initial.state==='PUBLICATION_UNKNOWN')initial=await command('recover',{id:initial.id});
    if(initial.state!=='PUBLISHED'){
      if(initial.state!=='REVIEWED')initial=await command('review',{id:initial.id,initialize:true,reviewer:'Commons native operator',
        note:'Complete original QuestDB response and typed dataset reviewed, including native null/empty/numeric/timestamp fields.'});
      initial=await command('publish',{id:initial.id,reviewId:initial.data.review.id});
    }
    assert.equal(initial.state,'PUBLISHED',JSON.stringify(initial.data.error));
    await save({firstPublication:initial.data.publication});
    await client.seller(publicationId,true);
    const second=await extract('second',{...firstInput,to},false);
    let latest=second.run;
    if(latest.state==='PUBLICATION_UNKNOWN')latest=await command('recover',{id:latest.id});
    if(latest.state!=='PUBLISHED'){
      const target=(await client.publication(publicationId)).target;
      if(latest.state!=='REVIEWED')latest=await command('review',{id:latest.id,
        expectedSnapshot:target.versions.current,expectedRevision:target.versions.revision,
        reviewer:'Commons native operator',note:'Widened fixed UTC window, identical typed dataset contract and preserved original edition.'});
      latest=await command('publish',{id:latest.id,reviewId:latest.data.review.id});
    }
    assert.equal(latest.state,'PUBLISHED',JSON.stringify(latest.data.error));
    assert.ok(second.capture.manifest.rowCount>=first.capture.manifest.rowCount);
    await save({secondPublication:latest.data.publication});
    if(!progress.paid){
      const current=await client.publication(publicationId),sellerUrl=current.seller.origin;
      const offer=await client.buyerOffer(publicationId,initial.id,'limit=20');
      assert.equal(offer.accepts.length,2);assert.equal(offer.accepts[0].amount,paymentOptions[0].amount);
      assert.deepEqual(offer.accepts[0].extra,paymentOptions[0].extra);
      const intentId=progress.buyerIntentId??'questdb-native-'+randomUUID();await save({buyerIntentId:intentId});
      const prepared=await client.prepareBuyer(publicationId,{runId:initial.id,query:'limit=20',intentId,
        acceptIndex:0,offerSha256:offer.offerSha256});
      const buyer=new X402BuyerClient({fetchImpl:(url,options)=>{
        paidRequests++;const selected=new URL(url);return fetch(sellerUrl+selected.pathname+selected.search,options);
      }});
      const delivered=await buyer.call({...prepared.config.operation,approve:async()=>true,
        sign:async({challenge,accepted})=>({x402Version:2,resource:challenge.resource,accepted,
          extensions:challenge.extensions,payload:{transaction:'DISPOSABLE_NATIVE_PAYMENT_ADAPTER'}})});
      assert.equal(delivered.status,'DELIVERED_REPORTED_SETTLED');
      const page=await delivered.response.json();assert.ok(page.rows.length>0);assert.equal(page.page.total,first.capture.manifest.rowCount);
      for(const row of page.rows){
        assert.equal(row.null_note,null);assert.equal(row.empty_note,'');
        assert.equal(typeof row.event_epoch_ns,'string');assert.ok(BigInt(row.event_epoch_ns)>BigInt(Number.MAX_SAFE_INTEGER));
        assert.equal(typeof row.event_time_ns,'string');assert.equal(typeof row.decimal_price,'string');
        assert.equal(typeof row.is_buy,'boolean');
      }
      assert.equal(paidRequests,2);assert.equal(verifies,1);assert.equal(settlements,1);
      const paid={status:delivered.status,requests:paidRequests,verifies,settlements,rows:page.rows.length,totalRows:page.page.total,
        snapshot:first.candidate.dataset.snapshot,offerSha256:offer.offerSha256,accepts:offer.accepts,
        buyerRequestId:prepared.id,intentId,
        execution:'Original x402 buyer and native seller with disposable local signing/facilitator adapters.',
        preservation:{null:true,emptyText:true,largeEpochIntegerText:true,nativeTimestampText:true,nativeDecimalText:true,boolean:true}};
      await immutable(join(directory,'buyer-page.json'),page);await save({paid});await event('retained-edition-buyer',paid);
    }
    const old=await client.run(publicationId,initial.id),current=await client.publication(publicationId);
    assert.equal(old.preview.page.total,first.capture.manifest.rowCount);
    assert.equal(current.target.dataset.rowCount,second.capture.manifest.rowCount);
    const beforeClose={sourceRevision:state.revision,publicationId,publisherDirectory:current.status.directory,
      targetDirectory:current.target.directory,sourceFile:current.status.sourceFile,
      firstRun:initial.id,secondRun:latest.id,sellerRunningIntent:true};
    await save({context:{workspaceDirectory,...beforeClose}});
    await session.close();session=null;
    const workbenchModel=new URL('../workspace/model.mjs',import.meta.url).href,nativeFactory=new URL('../../native-factory.mjs',import.meta.url).href;
    const reopenScript=[
      "const {openQuestDbWorkbench}=await import(process.argv[1]);const {createNativeSellerServer}=await import(process.argv[2]);",
      "const facilitatorClient={async getSupported(){return{kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet'}],extensions:['bazaar'],signers:{}};},async verify(){throw new Error('No payment is requested during retained reopen');},async settle(){throw new Error('No settlement is requested during retained reopen');}};",
      "const m=await openQuestDbWorkbench({directory:process.argv[3],datasetNativeFactory:compiled=>createNativeSellerServer(compiled,{facilitatorClient})});",
      "try{const state=await m.inspect();const publication=await m.inspectPublication(process.argv[4]);const first=await m.inspectRun(process.argv[4],process.argv[5]);const second=await m.inspectRun(process.argv[4],process.argv[6]);console.log(JSON.stringify({state,publication,first:first.preview,second:second.preview}));}finally{await m.close();}"
    ].join('\n');
    const reopened=JSON.parse((await execute(process.execPath,['--input-type=module','-e',reopenScript,workbenchModel,nativeFactory,
      workspaceDirectory,publicationId,initial.id,latest.id],{env:environment,timeout:30000,maxBuffer:8388608})).stdout);
    assert.equal(reopened.state.revision,state.revision);assert.equal(reopened.state.publications.length,1);
    assert.equal(reopened.publication.id,publicationId);assert.ok(reopened.publication.seller?.origin);
    assert.equal(reopened.first.page.total,first.capture.manifest.rowCount);
    assert.equal(reopened.second.page.total,second.capture.manifest.rowCount);
    assert.equal(reopened.first.rows[0].empty_note,'');assert.equal(reopened.first.rows[0].null_note,null);
    for(const capture of [first.capture,second.capture])await readQuestDbCapture(capture.directory);
    await immutable(join(directory,'reopened.json'),reopened);
    const sourceBytes=await readFile(sourceFile);
    result={schema:'native.questdb-source-publisher-journey.v1',outcome:'PASS',startedAt:progress.startedAt,
      completedAt:new Date().toISOString(),attempt,sourcePin,runtime:{node:process.version},case:requested,
      source:{path:sourceFile,sha256:hash(sourceBytes),bytes:sourceBytes.length,discovery:progress.discovery},
      context:progress.context,
      first:{plan:first.plan.id,run:initial.id,rows:first.capture.manifest.rowCount,publication:initial.data.publication,capture:progress.firstCapture},
      second:{plan:second.plan.id,run:latest.id,rows:second.capture.manifest.rowCount,publication:latest.data.publication,capture:progress.secondCapture},
      sampled:progress.sampled,preceding:progress.preceding,reportChecks:{sampled:progress.sampledChecks,preceding:progress.precedingChecks},
      preview:progress.preview,receiving:progress.receiving,paid:progress.paid,
      reopen:{freshProcess:true,sourceRevision:reopened.state.revision,publicationId:reopened.publication.id,
        firstRows:reopened.first.page.total,secondRows:reopened.second.page.total,sellerRunning:true,
        runs:reopened.publication.status.runs.map(row=>({id:row.id,state:row.state}))},
      paths:{directory,workspaceDirectory,sourceFile,merchantFile,
        publisherDirectory:current.status.directory,targetDirectory:current.target.directory,buyerPage:join(directory,'buyer-page.json')}};
  }catch(issue){
    failure=issue;
    result={schema:'native.questdb-source-publisher-journey.v1',outcome:'FAILED',startedAt:progress.startedAt,stoppedAt:new Date().toISOString(),
      attempt,sourcePin,error:{name:issue.name,code:issue.code??'NATIVE_QUESTDB_OPERATION_FAILED',message:issue.message,
        provider:issue.provider,httpStatus:issue.httpStatus,request:issue.request},lastEvent:progress.lastEvent,context:progress.context};
  }finally{
    if(session){try{await session.close();}catch(issue){failure??=issue;result={...result,outcome:'FAILED',cleanupError:issue.message};}}
  }
  await immutable(join(directory,'attempts',attempt+'.json'),result);await atomic(join(directory,'journey-result.json'),result);
  if(failure)throw failure;
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const values=process.argv.slice(2),help='node native-demo.mjs DIRECTORY FROM FIRST_TO TO HISTORY_FROM [HTTPS_ENDPOINT]';
  if(values.length<5||values.length>6){console.error(help);process.exitCode=2;}
  else runQuestDbNativeJourney({directory:values[0],from:values[1],firstTo:values[2],to:values[3],historyFrom:values[4],endpoint:values[5],
    sourcePin:process.env.QUESTDB_SOURCE_PIN??null,onEvent:event=>console.log(JSON.stringify(event))})
    .then(result=>console.log(JSON.stringify({outcome:result.outcome,result:join(result.paths.directory,'journey-result.json'),
      firstRows:result.first.rows,secondRows:result.second.rows,workspace:result.paths.workspaceDirectory,publicationId:result.context.publicationId})))
    .catch(issue=>{console.error(JSON.stringify({code:issue.code??'NATIVE_QUESTDB_OPERATION_FAILED',message:issue.message}));process.exitCode=1;});
}
