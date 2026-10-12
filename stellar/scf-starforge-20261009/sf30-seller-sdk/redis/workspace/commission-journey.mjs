// MIT. Full commissioning continuation on the original six-product native workspace.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redisCommissioningRequestId } from './commission.mjs';

const copy=value=>structuredClone(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const binary={base64:Buffer.from([255,0,239,187,191]).toString('base64')};
// These are the original native-journey and native-collections fixture inputs.
// Expected rows are specified before receiving; they are never copied from a result.
function examples(setup){
  const rows={
    availability:[{availability:binary}],
    catalog:[{itemId:'SKU-001',title:'Bearing',priceAtomic:'9007199254740993',missing:null}],
    leaderboard:[{itemId:'first',score:'1.25'},{itemId:'second',score:'2.5'},{itemId:'third',score:'3.75'}],
    events:[{id:'1-0',eventType:'updated',itemId:'SKU-001',quantity:'3'},
      {id:'2-0',eventType:'sold',itemId:'SKU-002',quantity:null},
      {id:'3-0',eventType:'restocked',itemId:'SKU-003',quantity:'7'}],
    list_feed:['9007199254740993',binary,'repeated','repeated','','λ'].map((value,index)=>({index:String(index),value})),
    member_catalog:['9007199254740993',binary,'',...Array.from({length:129},(_,index)=>'member-'+index)].map(member=>({member})),
  };
  assert.deepEqual(Object.values(setup.source.queries).map(query=>query.kind).sort(),['get','hash','list','set','sorted-set','stream']);
  return setup.plan.routes.map(route=>{
    assert.ok(rows[route.query],'The original six-product fixture must define '+route.query);
    const expected=route.query==='member_catalog'
      ?{columns:['member'],requiredRows:rows.member_catalog}
      :{columns:Object.keys(rows[route.query][0]),rows:rows[route.query],rowCount:rows[route.query].length};
    return {id:route.query,query:route.query,input:copy(route.example??{}),allPages:true,maxPages:256,maxRows:10000,expected};
  });
}
function assertZip(bytes,members){
  assert.equal(bytes.readUInt32LE(0),0x04034b50);
  assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length-12),members.length);
  const names=members.map(item=>item.path);
  for(const name of ['openapi.json','client/client-export.json','receiving.json',
    'customer-export.mjs','customer-export.plan.json','CUSTOMER_APPLICATION.md','README.md'])
    assert.ok(names.includes(name),'The complete handover must include '+name);
}
export async function runRedisCommissioningJourney({workspace,server,runtime,page}){
  assert.ok(workspace&&server?.url&&server?.token,'Use the already-open original Redis workspace and server.');
  const prefix='commission-native-',original=workspace.state(),originalHead=original.workspace.head;
  const call=async(path,input,accepted=[200])=>{
    const response=await fetch(server.url+path,{method:input===undefined?'GET':'POST',
      headers:{'x-workspace-token':server.token,...(input===undefined?{}:{origin:server.url,'content-type':'application/json'})},
      ...(input===undefined?{}:{body:JSON.stringify(input)})});
    const value=await response.json();assert.ok(accepted.includes(response.status),JSON.stringify({status:response.status,value}));return value;
  };
  const finish=async record=>{
    await workspace.queue;const value=await call('/api/commissioning/operation?id='+record.id);
    assert.ok(!['QUEUED','RUNNING'].includes(value.status),JSON.stringify(value));return value;
  };
  const save=async(workbook,id,note)=>{
    const input={revisionId:workbook.revisionId,input:workbook.input,customerPlan:workbook.customerPlan??null};
    const review=await call('/api/commissioning/review',input);
    const value=await call('/api/commissioning/save',{...input,requestId:id,digest:review.digest,note});
    assert.equal(value.status,'COMPLETED',JSON.stringify(value));return value;
  };
  const browserIssues=[],onPageError=error=>browserIssues.push(error.message);
  page?.on('pageerror',onPageError);
  let contract,run,handover,browserDownload;
  try{
    assert.equal((await fetch(server.url+'/api/commissioning/history')).status,403);
    const limitQueries=copy(original.current.source.queries);
    limitQueries.leaderboard.maxRows=1;limitQueries.leaderboard.parameters.offset.maximum='0';
    const limitRevision=await workspace.save({requestId:prefix+'source-limit-version',expectedHead:originalHead,
      queries:limitQueries,plan:original.current.plan,note:'Original native offset limit receiving'});
    assert.equal(limitRevision.status,'COMPLETED',JSON.stringify(limitRevision));
    const limited=await call('/api/commissioning/template');
    limited.input.operationId=prefix+'source-limit';limited.input.requestId=prefix+'source-limit-origin';
    limited.input.checks=examples(limited.input.setup);
    const ranking=limited.input.checks.find(check=>check.query==='leaderboard');
    ranking.expected={rowCount:1,requiredRows:[{itemId:'first',score:'1.25'}]};
    limited.input.checks=[ranking,...limited.input.checks.filter(check=>check!==ranking)];
    const limitedContract=await save(limited,prefix+'source-limit-contract','Retain the original incomplete source page');
    const limitedRun=await finish(await call('/api/commissioning/receive',
      {requestId:prefix+'source-limit-run',contractId:limitedContract.id},[202]));
    assert.equal(limitedRun.status,'FAILED',JSON.stringify(limitedRun));
    assert.equal(limitedRun.error.code,'REDIS_COMMISSIONING_SOURCE_INCOMPLETE');
    assert.equal(limitedRun.progress.phase,'source-incomplete');
    assert.equal(limitedRun.progress.source.continuationUnavailable,'OFFSET_LIMIT');
    const limitedRows=await call('/api/commissioning/rows?run='+limitedRun.id+'&check=leaderboard');
    assert.equal(limitedRows.complete,false);assert.equal(limitedRows.sourceIncomplete.continuationUnavailable,'OFFSET_LIMIT');
    assert.equal(limitedRows.rows[0].itemId,'first');
    assert.equal(workspace.record('operations',redisCommissioningRequestId(limited.input,'prepare',limitedRun.id),false),null);
    const restored=await workspace.restore({requestId:prefix+'restore-original',expectedHead:workspace.metadata().head,
      revisionId:originalHead,note:'Continue receiving the complete original six-product source'});
    assert.equal(restored.status,'COMPLETED',JSON.stringify(restored));
    const workbook=await call('/api/commissioning/template');
    workbook.input.operationId=prefix+'customer';workbook.input.requestId=prefix+'customer-origin';
    workbook.input.checks=examples(workbook.input.setup);
    workbook.input.release={releaseId:'commissioned-customer',label:'Native customer handover',runtime};
    workbook.customerPlan.operationId=prefix+'customer-export';
    workbook.customerPlan.budget={maxCalls:100,maxAtomic:String(BigInt(original.current.plan.payment.amount)*100n)};
    workbook.customerPlan.response={maxBytes:1048576,timeoutMs:30000};
    workbook.schema='stellar-forge.redis-commissioning-workbook.v1';
    workbook.note='Complete six-product customer commissioning';
    if(page){
      await page.goto(server.url+'/commissioning#'+server.token);
      await page.locator('#status').filter({hasText:'Saved customer commissioning workspace ready.'}).waitFor();
      await page.locator('#commission-import').setInputFiles({name:'commissioning-workbook.json',mimeType:'application/json',
        buffer:Buffer.from(JSON.stringify(workbook))});
      await page.locator('#status').filter({hasText:'Complete contract imported.'}).waitFor();
      await page.locator('#commission-note').fill(workbook.note);
      // A saved-work refresh must preserve a locally edited, complete customer draft.
      await page.locator('#commission-refresh').click();
      await page.waitForFunction(()=>document.querySelector('#commission-history-list article'));
      assert.equal(await page.locator('#commission-note').inputValue(),workbook.note);
      await page.locator('#commission-review').click();
      await page.locator('#status').filter({hasText:'Complete source, expected results, customer terms and release selection reviewed.'}).waitFor();
      assert.equal(await page.locator('#commission-review-matrix tbody tr').count(),6);
      await page.locator('#commission-save').click();
      await page.locator('#status').filter({hasText:'Complete commissioning contract saved.'}).waitFor();
      const history=await call('/api/commissioning/history');
      const saved=history.items.find(item=>item.kind==='commission-contract'&&item.note===workbook.note);
      assert.ok(saved);contract=await call('/api/commissioning/operation?id='+saved.id);
    }else contract=await save(workbook,prefix+'customer-contract',workbook.note);
    assert.equal(contract.input.customerPlan.products.length,6);
    // A later saved head is independent of the reviewed immutable receiving revision.
    const laterPlan=copy(original.current.plan);laterPlan.payment.amount=String(BigInt(laterPlan.payment.amount)+1n);
    const later=await workspace.save({requestId:prefix+'later-merchant-version',expectedHead:workspace.metadata().head,
      queries:original.current.source.queries,plan:laterPlan,note:'A later merchant version preserves the reviewed customer contract'});
    assert.equal(later.status,'COMPLETED',JSON.stringify(later));
    if(page){
      await page.locator('#commission-receive').click();
      await page.locator('#commission-run-status').filter({hasText:/^RECEIVED$/}).waitFor({timeout:180000});
      run=JSON.parse(await page.locator('#commission-run-json').innerText());
      await page.locator('#commission-run-checks tbody tr').filter({hasText:'member_catalog'}).getByRole('button',{name:'Inspect rows'}).click();
      await page.locator('#commission-observed').waitFor();
      assert.ok(await page.locator('#commission-observed-table tbody tr').count()>0);
    }else run=await finish(await call('/api/commissioning/receive',
      {requestId:prefix+'customer-run',contractId:contract.id},[202]));
    assert.equal(run.status,'COMPLETED',JSON.stringify(run));
    assert.equal(run.result.status,'RECEIVED',JSON.stringify(run));
    assert.equal(run.result.revisionId,contract.input.revisionId);assert.notEqual(workspace.metadata().head,run.result.revisionId);
    assert.equal(run.result.checks.length,6);assert.ok(run.result.checks.every(check=>check.passed));
    assert.ok(run.result.checks.find(check=>check.query==='list_feed').pages.length>=3);
    assert.equal(run.result.checks.find(check=>check.query==='member_catalog').pages.at(-1).scanCursor,'0');
    assert.equal(run.result.release.releaseId??run.result.release.id,'commissioned-customer');
    assert.deepEqual(await call('/api/commissioning/receive',{requestId:run.id,contractId:contract.id},[202]),run);
    let cursor='',seen=[],observedComplete=false,retainedPages=0;
    do{
      const value=await call('/api/commissioning/rows?run='+run.id+'&check=member_catalog&limit=50&cursor='+encodeURIComponent(cursor));
      seen.push(...value.rows);retainedPages+=value.pages.length;observedComplete=value.complete;cursor=value.nextCursor;
      assert.equal(value.sourceIncomplete,null);
    }while(cursor);
    assert.equal(observedComplete,true);
    assert.equal(new Set(seen.map(row=>JSON.stringify(row.member))).size,132);
    if(page){
      await page.locator('#commission-make-handover').click();
      await page.locator('#status').filter({hasText:'Complete customer handover is ready.'}).waitFor({timeout:120000});
      handover=JSON.parse(await page.locator('#commission-handover-json').innerText());
      // The browser shows the public result; retrieve the original request via history.
      const history=await call('/api/commissioning/history');
      const saved=history.items.find(item=>item.kind==='commission-handover'&&item.runId===run.id);
      assert.ok(saved);handover=await call('/api/commissioning/operation?id='+saved.id);
      const downloadEvent=page.waitForEvent('download');await page.locator('#commission-download-handover').click();
      const download=await downloadEvent,path=join(workspace.root,'commissioning-customer-handover.zip');
      await download.saveAs(path);const bytes=await readFile(path);
      assert.equal(sha(bytes),handover.result.file.sha256);browserDownload={path,bytes:bytes.length,sha256:sha(bytes)};
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }else handover=await finish(await call('/api/commissioning/handover',{requestId:prefix+'customer-handover',runId:run.id},[202]));
    assert.equal(handover.status,'COMPLETED',JSON.stringify(handover));
    assert.equal(handover.result.status,'HANDOVER_READY');assertZip((await workspace.commissioningFile(handover.id)).bytes,handover.result.members);
    const response=await fetch(server.url+'/api/commissioning/handover?id='+handover.id,{headers:{'x-workspace-token':server.token}});
    const zip=Buffer.from(await response.arrayBuffer());
    assert.equal(response.status,200);assert.equal(response.headers.get('x-content-sha256'),handover.result.file.sha256);
    assert.equal(sha(zip),handover.result.file.sha256);
    const first=await call('/api/commissioning/history?limit=2');
    const second=await call('/api/commissioning/history?limit=2&after='+first.nextCursor);
    assert.equal(first.items.length,2);assert.ok(first.nextCursor);assert.notEqual(second.items[0].id,first.items[0].id);
    assert.deepEqual(browserIssues,[]);
    const head=await workspace.restore({requestId:prefix+'restore-reviewed-head',expectedHead:workspace.metadata().head,
      revisionId:contract.input.revisionId,note:'Retain the commissioned customer source as current'});
    assert.equal(head.status,'COMPLETED',JSON.stringify(head));
    return {result:'PASS',workspaceId:original.workspace.id,contractId:contract.id,runId:run.id,handoverId:handover.id,
      revisionId:contract.input.revisionId,sourceLimit:{runId:limitedRun.id,requestId:limitedRows.sourceIncomplete.requestId,
        reason:limitedRows.sourceIncomplete.continuationUnavailable,retainedRows:limitedRows.rows.length},
      products:run.result.checks.map(check=>({id:check.id,rows:check.rowCount,pages:check.pages.length})),
      set:{uniqueMembers:132,retainedPages},file:handover.result.file,members:handover.result.members.length,
      ...(browserDownload?{browserDownload}:{})};
  }finally{page?.off('pageerror',onPageError);}
}
export async function verifyRedisCommissioningReopen(workspace,received){
  assert.equal(workspace.metadata().id,received.workspaceId);
  const run=workspace.operation(received.runId),handover=workspace.operation(received.handoverId);
  assert.equal(run.status,'COMPLETED');assert.equal(run.result.status,'RECEIVED');assert.equal(run.attempts,1);
  assert.deepEqual(workspace.commissioningReceive({requestId:run.id,contractId:received.contractId}),run);
  assert.deepEqual(await workspace.commissioningHandover({requestId:handover.id,runId:run.id}),handover);
  const file=await workspace.commissioningFile(handover.id);
  assert.equal(sha(file.bytes),received.file.sha256);assert.equal(file.bytes.length,received.file.bytes);
  assertZip(file.bytes,handover.result.members);
  return {result:'PASS',sameWorkspace:true,originalReceivingAttempts:run.attempts,originalHandoverAttempts:handover.attempts,
    bytes:file.bytes.length,sha256:sha(file.bytes)};
}
