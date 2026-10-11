#!/usr/bin/env node
// One original merchant-source → review → package → release → HTTP → reopen journey.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { savePackage, readPackage } from './workspace/model.mjs';
import { reviewSourceRefresh, requireSourceRefresh } from './source-refresh.mjs';
import { createRefreshReview, exportRefreshReview, renderRefreshReview, run } from './refresh-cli.mjs';
import { run as originalCli } from './cli.mjs';
import { initReleaseStore, stageRelease, activateRelease, runActiveRelease, compareReleases } from '../sf82-seller-pilot/releases.mjs';
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonOperation = (operationId, schema) => ({
  get: {operationId, responses: {'200': {description:'Result', content:{'application/json':{schema}}}}}
});

export async function exercise(root) {
  root ??= await mkdtemp(join(tmpdir(), 'scf-source-refresh-'));
  const parent = join(root, 'projects'); await mkdir(parent, {mode:0o700});
  const original = JSON.parse(await readFile(new URL('./openapi.example.json', import.meta.url), 'utf8'));
  original.paths['/status'] = jsonOperation('status',{type:'object',properties:{ready:{type:'boolean'}},required:['ready'],additionalProperties:false});
  const payment = JSON.parse(await readFile(new URL('./service-selections.example.json', import.meta.url), 'utf8'))[0].accepts[0];
  delete payment.scheme; delete payment.amount;
  const plan = {schema:'stellar-forge.api-merchant-plan.v1',sellerServer:'https://merchant.example/api',payment,operations:[
    {method:'GET',path:'/forecast/{city}',amountAtomic:'9007199254740993',responseValidation:'none',timeoutMs:8000,requestHeaders:['accept-language']},
    {method:'POST',path:'/forecast',id:'coordinates',amountAtomic:'20000',responseValidation:'none'},
    {method:'GET',path:'/status',id:'status',amountAtomic:'1000',responseValidation:'declared'},
  ]};
  const specText = json(original);
  const baseline = await savePackage({specText,plan,parent,name:'weather-v1'});
  const originalHash = hash(await readFile(join(baseline.folder,'merchant-package.json')));
  const candidate = structuredClone(original);
  candidate.info.version = '2.0.0';
  candidate.servers[0].url = 'https://weather.example/api/v3';
  candidate.paths['/v2/forecast/{city}'] = candidate.paths['/forecast/{city}'];
  delete candidate.paths['/forecast/{city}']; delete candidate.paths['/forecast'];
  candidate.components.parameters.City.schema.maxLength = 128;
  candidate.paths['/status'].get.responses[200].content['application/json'].schema.properties.version = {type:'string'};
  candidate.paths['/alerts'] = jsonOperation('alerts',{type:'object',properties:{count:{type:'integer',minimum:0}},required:['count'],additionalProperties:false});
  const candidateSpecText = json(candidate);
  const unresolved = reviewSourceRefresh({baseline:{specText,plan},candidateSpecText});
  assert.equal(unresolved.ready,false);
  assert.deepEqual(unresolved.operations[0].suggestions,['GET /v2/forecast/{city}']);
  assert.equal(unresolved.operations[1].state,'UNRESOLVED');
  assert.equal(unresolved.unselected.some(row=>row.key==='GET /alerts'),true);
  const decisions = {mappings:[{from:'GET /forecast/{city}',to:'GET /v2/forecast/{city}'},{from:'POST /forecast',to:null}],
    additions:[{method:'GET',path:'/alerts',id:'alerts',amountAtomic:'3000',responseValidation:'declared'}]};
  const document = await createRefreshReview({parent,baselineName:'weather-v1',candidateSpecText,decisions});
  assert.equal(document.report.ready,true,json(document.report.issues));
  assert.equal(document.report.plan.operations[0].amountAtomic,'9007199254740993');
  assert.deepEqual(document.report.plan.payment,plan.payment);
  assert.equal(document.report.operations[0].after.binding.id,document.report.operations[0].before.binding.id);
  assert.equal(document.report.operations[0].after.upstream.timeoutMs,8000);
  assert.equal(document.report.operations[0].changes.some(change=>change.pointer.includes('referencedComponents')),true);
  assert.throws(()=>requireSourceRefresh({...document.input,candidateSpecText:candidateSpecText+' '},document.report.reviewId),/changed/);
  assert.throws(()=>reviewSourceRefresh({...document.input,decisions:{mappings:[{from:'GET /forecast/{city}',to:'GET /v2/forecast/{city}',settings:{amountAtomic:'1'}}]}}),/retains/);
  const colliding = reviewSourceRefresh({...document.input,decisions:{...decisions,additions:[{...decisions.additions[0],id:'coordinates'}]}});
  assert.equal(colliding.ready,false); assert.equal(colliding.issues.some(row=>row.code==='ORIGINAL_IDENTITY_REUSE'),true);
  await writeFile(join(root,'candidate.json'),candidateSpecText,{mode:0o600});
  await writeFile(join(root,'decisions.json'),json(decisions),{mode:0o600});
  const reviewFile = join(root,'review.json'), html = join(root,'review.html');
  await run(['review','--parent',parent,'--baseline','weather-v1','--spec',join(root,'candidate.json'),'--decisions',join(root,'decisions.json'),'--out',reviewFile,'--html',html]);
  assert.equal((await stat(reviewFile)).mode&0o777,0o600);
  await originalCli(['refresh','show','--review',reviewFile]);
  const exported = await exportRefreshReview({parent,document,reviewId:document.report.reviewId,name:'weather-v2'});
  assert.equal(exported.reopened,false);
  const reopened = await exportRefreshReview({parent,document,reviewId:document.report.reviewId,name:'weather-v2'});
  assert.equal(reopened.reopened,true);
  const saved = await readPackage(parent,'weather-v2');
  assert.equal(saved.specText,candidateSpecText);
  assert.equal(hash(await readFile(join(baseline.folder,'merchant-package.json'))),originalHash);
  const escaped = structuredClone(original); escaped.info.title='<script>alert(1)</script>';
  const safe = await createRefreshReview({parent,baselineName:'weather-v1',candidateSpecText:json(escaped)});
  assert.equal(renderRefreshReview(safe).includes('<script>alert(1)</script>'),false);
  const store = join(root,'releases'); await initReleaseStore(store);
  await stageRelease(store,{id:'first',workspace:baseline.folder,runtime:{port:0}});
  await stageRelease(store,{id:'updated',workspace:exported.folder,runtime:{port:0}});
  const comparison = await compareReleases(store,'first','updated');
  await activateRelease(store,'updated',{expectedGeneration:0,reason:'Reviewed API source update'});
  let session;
  try {
    session = await runActiveRelease(store,{expectedGeneration:1,handleSignals:false,startupTimeoutMs:15000});
    const status = session.observation ?? session;
    const url = status.listener ?? session.url;
    if (!url) throw new Error('Native release address missing: '+Object.keys(session).join(','));
    const response = await fetch(url+'/api/v2/forecast/Louisville?days=3');
    assert.equal(response.status,402);
    const offer = JSON.parse(Buffer.from(response.headers.get('payment-required'),'base64').toString('utf8'));
    assert.equal(offer.accepts[0].amount,'9007199254740993');
    assert.equal(offer.resource.url,'https://merchant.example/api/v2/forecast/Louisville?days=3');
  } finally { await session?.close(); }
  const result={root,reviewId:document.report.reviewId,summary:document.report.summary,releaseComparison:comparison.summary,
    originalPackageRetained:true,reopened:true,nativeHttpStatus:402,exactAtomicPrice:'9007199254740993'};
  await writeFile(join(root,'journey.json'),json(result),{mode:0o600});
  console.log(json(result));
  return result;
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  exercise(process.argv[2]).catch(error=>{console.error(error.stack);process.exitCode=1;});
