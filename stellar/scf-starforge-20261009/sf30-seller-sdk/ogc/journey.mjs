// MIT. One local protocol → interruption → native seller → portable receiving journey.
// Source fixtures are explicitly fictional protocol inputs; all used product modules are original.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, cp, rm, rename, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capture, discover, readCapture, recordedSource, digest, parseSource } from './source.mjs';
import { inspectCapture, exportDataset, reopenExport } from './project.mjs';
import { writeReview } from './review.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { startSellerService } from '../serve.mjs';
import { startDatasetWorkspace } from '../dataset-workspace.mjs';
import { acquireWorkspace } from '../postgres/publisher/files.mjs';
export async function journey(out) {
  const directory = out ? resolve(out) : await mkdtemp(join(tmpdir(),'scf-ogc-'));
  const { mkdir } = await import('node:fs/promises'); await mkdir(directory,{recursive:true,mode:0o700}); await chmod(directory,0o700);
  const calls = [], responses = new Map(); let failures = 1, origin;
  const server = createServer((req,res) => {
    calls.push(req.url);
    const send = text => { responses.set(origin + req.url,text);res.writeHead(200,{'Content-Type':'application/geo+json','ETag':'"fixture-'+calls.length+'"'});res.end(text); };
    if (req.url === '/') return send(JSON.stringify({links:[{rel:'data',href:'/collections',type:'application/json'},{rel:'conformance',href:'/conformance',type:'application/json'}]}));
    if (req.url === '/conformance') return send(JSON.stringify({conformsTo:['http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core']}));
    if (req.url === '/collections') return send(JSON.stringify({collections:[{id:'observations',title:'Fictional protocol observations',links:[{rel:'items',href:'/items?limit=2',type:'application/geo+json'}]}]}));
    if (req.url === '/items?limit=2') return send('{"type":"FeatureCollection","numberReturned":1.0,"numberMatched":3,"features":[{"type":"Feature","id":9007199254740993,"properties":{"label":"A, quoted \\\"name\\\"\\nsecond line","height":12.500,"enabled":true,"nested":{"code":"0012"}},"geometry":{"type":"Point","coordinates":[36.123456789012345678,32.75]}}],"links":[{"rel":"next","href":"?cursor=opaque%2Fempty","type":"application/geo+json"}]}');
    if (req.url === '/items?cursor=opaque%2Fempty') {
      if (failures-- > 0) {res.writeHead(503,{'Retry-After':'1'});res.end();return;}
      return send('{"type":"FeatureCollection","features":[],"numberReturned":0,"numberMatched":3,"links":[{"rel":"next","href":"?cursor=opaque%2Bfinal","type":"application/geo+json"}]}');
    }
    if (req.url === '/items?cursor=opaque%2Bfinal') return send('{"type":"FeatureCollection","numberReturned":2,"numberMatched":3,"features":[{"type":"Feature","id":"two","properties":{"label":"","height":8,"enabled":false,"nested":{"code":"0007"}},"geometry":null},{"type":"Feature","id":"three","properties":{"label":null,"height":25,"enabled":true,"nested":{"code":"0099"},"hostile":"</script><script>window.injected=true</script>"},"geometry":{"type":"LineString","coordinates":[[36,32],[37,33]]}}],"links":[]}');
    res.writeHead(404);res.end();
  });
  await new Promise(done => server.listen(0,'127.0.0.1',done)); origin = 'http://127.0.0.1:'+server.address().port;
  let seller;
  try {
    const discovery = await discover(origin+'/',{allowLoopback:true});
    assert.equal(discovery.collections[0].itemsUrl,origin+'/items?limit=2');
    const state=join(directory,'capture'), config={schema:'stellar-forge.ogc-source.v1',itemsUrl:discovery.collections[0].itemsUrl,name:'Protocol journey — fictional source',allowLoopback:true};
    const cancelled=new AbortController();
    await assert.rejects(capture(state,config,{signal:cancelled.signal,onPage:() => cancelled.abort()}),{name:'AbortError'});
    const partial=await readCapture(state); const partialHeader=await readFile(join(state,'capture.json'));assert.equal(partial.rows,1);assert.equal(partial.pages.length,1);
    const unlock=await acquireWorkspace(state);
    try {await assert.rejects(capture(state),{code:'PUBLISHER_ALREADY_OPEN'});} finally {await unlock();}
    await assert.rejects(capture(state),{code:'OGC_HTTP_503'});
    const complete=await capture(state);assert.equal(complete.rows,3);assert.equal(complete.pages.length,3);assert.equal(complete.complete,true);
    assert.equal(calls.filter(x=>x==='/items?limit=2').length,1);
    const before=calls.length;await capture(state);assert.equal(calls.length,before);
    await writeFile(join(state,'capture.json'),partialHeader);
    const reconciled=await capture(state);assert.equal(reconciled.sourceId,complete.sourceId);assert.equal(calls.length,before);
    const inspected=await inspectCapture(state);assert.equal(inspected.properties.find(p=>p.pointer==='/id').unsafeIntegers,1);
    const review=join(directory,'review.html');await writeReview(state,review);
    const plan={schema:'stellar-forge.ogc-plan.v1',sourceId:complete.sourceId,name:'Reviewed protocol observations',
      columns:[{name:'feature_id',pointer:'/id',type:'string',nullable:false,format:'scalar'},
        {name:'label',pointer:'/properties/label',type:'string',nullable:true,format:'scalar'},
        {name:'height',pointer:'/properties/height',type:'number',nullable:false,format:'scalar'},
        {name:'enabled',pointer:'/properties/enabled',type:'boolean',nullable:false,format:'scalar'},
        {name:'code',pointer:'/properties/nested/code',type:'string',nullable:false,format:'scalar'},
        {name:'geometry',pointer:'/geometry',type:'string',nullable:true,format:'json'}],
      filters:['enabled'],ranges:['height'],sorts:['height'],defaultLimit:2,maxLimit:20,nullEmptyPolicy:'native-empty-is-null'};
    await writeFile(join(directory,'plan.json'),JSON.stringify(plan,null,2),{mode:0o600});
    const payment={scheme:'exact',network:'stellar:testnet',asset:'UNVERIFIED_DEMO_ASSET',payTo:'UNVERIFIED_DEMO_RECIPIENT',amount:'9007199254740993',maxTimeoutSeconds:60};
    const edition=join(directory,'edition');const published=await exportDataset(state,edition,plan,{payment,origin:'https://ogc.example'});
    const dataset=await loadDatasetConfig(join(edition,'dataset.json'));
    const first=dataset.handle({query:{sort:'height',limit:'2'}});assert.equal(first.status,200);assert.equal(first.body.page.total,3);
    const exact=first.body.rows.find(r=>r.feature_id==='9007199254740993');assert.equal(exact.code,'0012');assert.ok(exact.geometry.includes('36.123456789012345678'));
    const last=dataset.handle({query:{sort:'height',limit:'2',cursor:first.body.page.nextCursor}});assert.equal(last.body.rows[0].feature_id,'three');
    assert.equal(dataset.handle({query:{gte_height:'12',where_enabled:'true'}}).body.page.total,2);
    const workspace=await startDatasetWorkspace({datasetPath:join(edition,'dataset.json'),port:0,resource:'https://ogc.example/data'});
    try {const preview=await fetch(workspace.origin+'/api/query',{method:'POST',headers:{Authorization:'Bearer '+workspace.token,'Content-Type':'application/json',Origin:workspace.origin},body:JSON.stringify({query:'gte_height=12&sort=height&limit=1'})});
      assert.equal(preview.status,200);const result=await preview.json();assert.equal(result.result.page.total,2);assert.ok(result.requestUrl.includes('gte_height=12'));
    } finally {await workspace.close();}
    const sellerConfig=JSON.parse(await readFile(join(edition,'seller.json'),'utf8'));
    seller=await startSellerService({config:sellerConfig,port:0,handlers:{queryDataset:dataset.handle,admitDataset:dataset.admit}});
    const challenge=await fetch(seller.url+'/data');assert.equal(challenge.status,402);
    const challengeBody=await challenge.json();assert.equal(challengeBody.accepts[0].amount,payment.amount);
    const openapi=await fetch(seller.url+'/_seller/openapi.json');assert.equal(openapi.status,200);
    const docs=await openapi.json();assert.ok(JSON.stringify(docs).includes('gte_height'));
    await seller.close();seller=null;
    const received=join(directory,'received');await cp(edition,received,{recursive:true});
    const reopened=await reopenExport(received);assert.equal(reopened.dataset.snapshot,published.dataset.snapshot);
    // A missing final receipt is reconstructed from the same operation, never from another source.
    await rm(join(received,'export.json'));const recovered=await exportDataset(join(received,'source'),received,plan,{payment,origin:'https://ogc.example'});
    assert.equal(recovered.operationId,published.operationId);
    // Full source recording transport reuses actual captured byte strings and native links.
    const recordingDir=join(directory,'recordings');await mkdir(recordingDir,{mode:0o700});const records=[];
    for(const [url,text]of responses){if(!url.includes('/items'))continue;const file='page-'+records.length+'.geojson';await writeFile(join(recordingDir,file),text,{mode:0o600});records.push({file,requestedUrl:url,url,status:200,contentType:'application/geo+json',sha256:digest(Buffer.from(text)),fetchedAt:complete.createdAt});}
    const index=join(recordingDir,'responses.json');await writeFile(index,JSON.stringify({schema:'stellar-forge.ogc-recordings.v1',responses:records}),{mode:0o600});
    await new Promise(done=>server.close(done));
    const imported=await capture(join(directory,'imported'),config,{recordSource:await recordedSource(index)});assert.equal(imported.rows,3);
    // A lost source page must never reset a committed capture.
    const savedManifest=digest(await readFile(join(state,'capture.json'))), page=join(state,'pages',complete.pages[0].file);
    await rename(page,page+'.saved');await assert.rejects(capture(state),{code:'OGC_RETAINED_PAGE_MISSING'});
    assert.equal(digest(await readFile(join(state,'capture.json'))),savedManifest);await rename(page+'.saved',page);
    const result={schema:'stellar-forge.ogc-journey.v1',sourceKind:'fictional local protocol fixture',rows:3,pages:3,
      originalFirstPageReads:1,retainedPageReconciliation:true,nativeWorkspaceQuery:true,captureSourceId:complete.sourceId,nativeSnapshot:published.dataset.snapshot,
      capturedExactNumericId:exact.feature_id,geometryExact:exact.geometry,challengeStatus:402,challengeAmount:payment.amount,
      portableOperationId:reopened.operationId,queryPages:[first.body.rows.length,last.body.rows.length],sourceRecordingsReopened:imported.rows,
      capture:state,edition,received,review,plan:join(directory,'plan.json')};
    await writeFile(join(directory,'journey.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
  }finally{if(seller)await seller.close();if(server.listening)await new Promise(done=>server.close(done));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)journey(process.argv[2]).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;});
