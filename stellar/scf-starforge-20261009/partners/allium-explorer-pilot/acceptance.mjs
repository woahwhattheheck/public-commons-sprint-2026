// MIT. One integrated provider-contract → original dataset → original seller exercise.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { beginRun, collectRun, readProduct, stageResults } from './explorer.mjs';
import { loadDatasetConfig } from '../../sf30-seller-sdk/dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../../sf30-seller-sdk/dataset-cli.mjs';
import { openDatasetVersions } from '../../sf30-seller-sdk/dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from '../../sf30-seller-sdk/dataset-refresh/service.mjs';

const directory=await mkdtemp(join(tmpdir(),'allium-native-'));
let service,versions,submitted=0,statusReads=0,resultReads=0;
const fixtureToken='local-acceptance-credential';
const documented={sql:'SELECT approved_projection FROM stellar.raw.transactions_v2',
  meta:{columns:['transaction_hash','source_account','ledger_sequence','ledger_close_time','successful',
    'fee_charged_stroops','operation_count','private_note'].map(name=>({name,data_type:'contract-fixture'}))},
  data:[0,1,2].map(i=>({transaction_hash:'fixture-transaction-'+i,source_account:'fixture-account',
    ledger_sequence:100+i,ledger_close_time:`2026-10-01T00:00:0${i}.000000000Z`,successful:true,
    fee_charged_stroops:'900719925474099312345',operation_count:1,private_note:'omit from seller'})),
  queried_at:'2026-10-01T01:00:00Z'};
const backend=createServer(async(req,res)=>{
  assert.equal(req.headers['x-api-key'],fixtureToken);
  res.setHeader('content-type','application/json');
  if(req.url==='/api/v1/explorer/queries/approved-query/run-async' && req.method==='POST') {
    submitted++;let bytes='';for await(const piece of req)bytes+=piece;
    const body=JSON.parse(bytes);assert.deepEqual(body.parameters,{window_start:'2026-10-01',window_end:'2026-10-02'});
    assert.deepEqual(body.run_config,{limit:10000});res.end(JSON.stringify({run_id:'provider-run-1'}));
  }else if(req.url==='/api/v1/explorer/query-runs/provider-run-1/status' && req.method==='GET') {
    statusReads++;res.end(JSON.stringify(statusReads===1?'running':'success'));
  }else if(req.url==='/api/v1/explorer/query-runs/provider-run-1/results' && req.method==='GET') {
    resultReads++;res.end(JSON.stringify(documented));
  }else {res.statusCode=404;res.end('{}');}
});
backend.listen(0,'127.0.0.1');await once(backend,'listening');
try {
  const product={...await readProduct(new URL('./examples/product.json',import.meta.url)),
    queryId:'approved-query',origin:'http://127.0.0.1:'+backend.address().port};
  const options={env:{ALLIUM_API_KEY:fixtureToken},allowLoopback:true};
  const runDir=join(directory,'run');
  const started=await beginRun(product,runDir,options);assert.equal(started.runId,'provider-run-1');
  await assert.rejects(beginRun(product,runDir,options),e=>e.code==='EEXIST');
  assert.equal((await collectRun(runDir,options)).status,'running');
  const staged=await collectRun(runDir,options);assert.equal(staged.rowCount,3);
  assert.equal((await collectRun(runDir,options)).unchanged,true);
  assert.equal(submitted,1);assert.equal(resultReads,1);
  const original=await loadDatasetConfig(staged.dataset);
  const context={method:'GET',url:new URL('https://merchant.example/data?sort=ledger_sequence&limit=1'),
    query:{sort:'ledger_sequence',limit:'1'},headers:{},pathParams:{}};
  assert.equal(original.admit(context),true);
  const page=original.handle(context);assert.equal(page.body.rows[0].fee_charged_stroops,'900719925474099312345');
  assert(!JSON.stringify(page.body).includes('private_note'));
  const malformed=structuredClone(documented);malformed.data[0].fee_charged_stroops=9007199254740992;
  await assert.rejects(stageResults(product,Buffer.from(JSON.stringify(malformed)),join(directory,'bad-precision')),
    /exact source string/);
  const changed=structuredClone(documented);changed.data[0].fee_charged_stroops='100';
  const next=await stageResults(product,Buffer.from(JSON.stringify(changed)),join(directory,'next'));
  const state=join(directory,'versions');
  versions=await openDatasetVersions({directory:state,initialConfig:staged.dataset,retentionMs:60000,maxVersions:3});
  const config=await buildDatasetSellerConfig(versions,{origin:'https://allium-pilot.example',path:'/data',
    payment:{scheme:'exact',network:'stellar:testnet',asset:'LOCAL_EXERCISE_ASSET',
      payTo:'LOCAL_EXERCISE_RECIPIENT',amount:'100',maxTimeoutSeconds:60}});
  service=await startVersionedDatasetSeller({versions,config,port:0,controlTransport:'loopback'});
  const response=await fetch(service.url+'/data?limit=1');assert.equal(response.status,402);
  const challenge=await response.json();assert(challenge.accepts.length>0);
  const firstSnapshot=versions.status().current;
  const refresh=await datasetControl(state,'refresh',{configPath:next.dataset,expectedSnapshot:firstSnapshot});
  assert(refresh.changed);assert.notEqual(versions.status().current,firstSnapshot);
  assert.equal(submitted,1);assert.equal(resultReads,1);
  await service.close();service=null;
  versions=await openDatasetVersions({directory:state});assert.equal(versions.status().current,next.snapshot);
  await versions.close();versions=null;
  console.log(JSON.stringify({result:'PASS',providerRunPosts:submitted,providerStatusReads:statusReads,
    providerResultReads:resultReads,stagedRows:3,exactLargeValuePreserved:true,undeclaredColumnExcluded:true,
    resumedFromSavedRunState:true,originalSellerHttpStatus:402,originalVersionRefresh:true,
    originalDatasetPageSchema:page.body.schema,
    scope:'Actual local HTTP provider contract, original SF30 loader/seller/private refresh/restart. Provider responses are explicit fixtures; no Allium account call, signing or network settlement.'},null,2));
} finally {
  if(service)await service.close();else await versions?.close();
  backend.close();await once(backend,'close');await rm(directory,{recursive:true,force:true});
}
