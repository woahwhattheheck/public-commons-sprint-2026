// MIT. Focused source→review→original merchant→portable reopen exercise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, chmod, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { inspectHar, newReview, buildDocument } from './model.mjs';
import { digest, prepare, openWorkspace, saveReview, readRevision, exportReview, copyWorkspace, readRegular } from './store.mjs';
import { renderReview } from './review.mjs';
import { saveHarMerchant } from './merchant.mjs';
import { readPackage } from '../workspace/model.mjs';
const j = v => JSON.stringify(v, null, 2) + '\n';
async function localCapture() {
  const server = createServer((req, res) => { res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: req.url.split('?')[0].split('/').pop(), quantity: 7, price: '9007199254740993.010000' })); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`, entries = [];
  try {
    for (const id of ['one', 'two']) {
      const url = `${origin}/items/${id}?region=PRIVATE_CAPTURE_REGION`, start = performance.now();
      const response = await fetch(url, { headers: { authorization: 'Bearer PRIVATE_CAPTURE_TOKEN' } });
      const text = await response.text(), elapsed = performance.now() - start;
      entries.push({ startedDateTime: new Date().toISOString(), time: elapsed, request: { method: 'GET', url, httpVersion:'HTTP/1.1',
        headers: [{name:'Authorization',value:'Bearer PRIVATE_CAPTURE_TOKEN'}], queryString:[{name:'region',value:'PRIVATE_CAPTURE_REGION'}],cookies:[],headersSize:-1,bodySize:0 },
        response: { status: response.status, statusText: response.statusText, httpVersion:'HTTP/1.1', cookies:[],headers:[...response.headers].map(([name,value])=>({name,value})),
          content:{mimeType:'application/json',size:Buffer.byteLength(text),text},redirectURL:'',headersSize:-1,bodySize:Buffer.byteLength(text)},cache:{},timings:{send:0,wait:elapsed,receive:0} });
    }
  } finally { await new Promise(done => server.close(done)); }
  return { log:{version:'1.2',creator:{name:'Original local HTTP workflow',version:'1.0'},entries} };
}
function reviewed(inventory) {
  const r = newReview(inventory); r.sourceUrl = inventory.groups[0].origin + '/';
  const op = r.operations[0]; op.enabled = true; op.reviewed = true; op.groups = inventory.groups.map(g=>g.id);
  op.path='/items/{id}'; op.pathExamples={id:'example'}; op.query.region={mode:'parameter',example:'example'};
  op.credentials['header:authorization']={mode:'backend',reference:'SOURCE_AUTH'};
  return r;
}
test('actual HTTP capture, private review, original native merchant and portable reopening', async () => {
  const root = await mkdtemp(join(tmpdir(),'har-workflow-')); await chmod(root,0o700);
  try {
    const har=await localCapture(), capture=Buffer.from(j(har)), source=join(root,'source.har'); await writeFile(source,capture,{mode:0o600});
    const workspace=join(root,'workspace'); await prepare(source,workspace); const w=await openWorkspace(workspace), review=reviewed(w.inventory);
    const decisions=join(root,'decisions.json'); await writeFile(decisions,j(review),{mode:0o600});
    const saved=await saveReview(workspace,decisions); assert.deepEqual(await saveReview(workspace,decisions),saved);
    const output=join(root,'export'); const publication=await exportReview(workspace,saved.revision,output);
    const html=await renderReview(w.inventory,review), exported=await readFile(join(output,'openapi.json'),'utf8');
    for(const secret of ['PRIVATE_CAPTURE_TOKEN','PRIVATE_CAPTURE_REGION']) {assert.ok(!html.includes(secret));assert.ok(!exported.includes(secret));}
    const spec=JSON.parse(exported);assert.equal(spec.paths['/items/{id}'].get.security.length,1);
    assert.equal(spec.paths['/items/{id}'].get.responses['200'].content['application/json'].schema.required,undefined);
    const plan={schema:'stellar-forge.api-merchant-plan.v1',sellerServer:'https://merchant.example/paid',allowLoopbackUpstream:true,
      payment:{network:'stellar:testnet',asset:'DEMO_NONPAYABLE_ASSET',payTo:'DEMO_NONPAYABLE_RECIPIENT',maxTimeoutSeconds:60},
      operations:[{method:'GET',path:'/items/{id}',id:'lookup',amountAtomic:'9007199254740993',headerEnv:{authorization:'SOURCE_AUTH'},responseValidation:'declared'}]};
    const planFile=join(root,'plan.json');await writeFile(planFile,j(plan),{mode:0o600}); const parent=join(root,'merchants');await mkdir(parent,{mode:0o700});
    const merchant=await saveHarMerchant({workspace,revision:saved.revision,planFile,parent,name:'captured'});
    assert.equal(merchant.preview.routes[0].amountAtomic,'9007199254740993');
    assert.equal(merchant.preview.routes[0].upstream,w.inventory.groups[0].origin+'/items/:id');
    const reopened=await readPackage(parent,'captured');assert.equal(reopened.manifest.files['original-openapi.json'],publication.files['openapi.json'].sha256);
    const recipient=join(root,'recipient');await copyWorkspace(workspace,recipient);await rm(workspace,{recursive:true});await rm(source);
    const received=await openWorkspace(recipient);assert.equal(received.manifest.sourceSha256,digest(capture));
    assert.equal((await readRevision(received,saved.revision)).revision,saved.revision);
    await exportReview(recipient,saved.revision,join(root,'recipient-export'));
    assert.deepEqual(await readFile(join(root,'recipient-export','openapi.json')),await readFile(join(output,'openapi.json')));
    plan.operations[0].headerEnv={};await writeFile(planFile,j(plan));
    await assert.rejects(saveHarMerchant({workspace:recipient,revision:saved.revision,planFile,parent,name:'bad-binding'}),/preserve the reviewed/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('explicit source decisions and retained identities reject ambiguous or changed inputs', async () => {
  const har=await localCapture(), source=Buffer.from(j(har)), inventory=inspectHar(har,digest(source)), review=reviewed(inventory);
  const unresolved=structuredClone(review);unresolved.operations[0].credentials['header:authorization'].mode='unresolved';assert.throws(()=>buildDocument(inventory,unresolved),/resolve captured credential/);
  const other=structuredClone(review);other.sourceSha256='0'.repeat(64);assert.throws(()=>buildDocument(inventory,other),/another HAR source/);
  const origin=structuredClone(review);origin.sourceUrl='https://different.example/';assert.throws(()=>buildDocument(inventory,origin),/capture origin/);
  const reused=structuredClone(review);reused.operations[1].enabled=true;reused.operations[1].reviewed=true;assert.throws(()=>buildDocument(inventory,reused),/reused/);
  const repeated=structuredClone(har);repeated.log.entries[0].request.url+='&region=second';repeated.log.entries[0].request.queryString.push({name:'region',value:'second'});
  const ri=inspectHar(repeated,digest(j(repeated)));assert.throws(()=>buildDocument(ri,reviewed(ri)),/repeated query/);
  const named=structuredClone(har);for(const e of named.log.entries){e.request.url+='&session_length=60';e.request.queryString.push({name:'session_length',value:'60'});}
  const ni=inspectHar(named,digest(j(named))), nr=reviewed(ni);
  nr.operations[0].credentials['query:session_length']={mode:'parameter',reason:'Public requested duration, not a credential',schema:{type:'integer'},example:60};
  assert.equal(buildDocument(ni,nr).paths['/items/{id}'].get.parameters.find(p=>p.name==='session_length').example,60);
  const missing=structuredClone(har);delete missing.log.entries[0].response.content.text;
  const mi=inspectHar(missing,digest(j(missing)));const doc=buildDocument(mi,reviewed(mi));
  assert.equal(doc.paths['/items/{id}'].get['x-har-observation'].responseObservations[0].recordedJsonBodies,1);
  const base64=structuredClone(har);const c=base64.log.entries[0].response.content;c.text=Buffer.from(c.text).toString('base64');c.encoding='base64';
  assert.equal(inspectHar(base64,digest(j(base64))).groups[0].responses[0].observedBodies,1);
  const root=await mkdtemp(join(tmpdir(),'har-identity-'));await chmod(root,0o700);
  try {
    const raw=join(root,'raw.har');await writeFile(raw,source,{mode:0o600});const w=join(root,'w');await prepare(raw,w);
    await assert.rejects(prepare(raw,w),/already exists/);const link=join(root,'linked.har');await symlink(raw,link);await assert.rejects(readRegular(link));
    await writeFile(join(w,'source.har'),Buffer.from(j({log:{version:'1.2',entries:[]}})));
    await assert.rejects(openWorkspace(w),/source identity changed/);
  } finally {await rm(root,{recursive:true,force:true});}
});
