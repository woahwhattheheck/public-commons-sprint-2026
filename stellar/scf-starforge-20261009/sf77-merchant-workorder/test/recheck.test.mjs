// MIT. ILLUSTRATIVE OFFLINE observations only; no merchant, quote, payment or browser execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {assess} from '../../sf68-browser-payment-readiness/audit.mjs';
import {combine} from '../../sf70-merchant-intake/run.mjs';
import {assessPreflight,eligibleIntake} from '../../sf72-post-only-preflight/preflight.mjs';

const cli=fileURLToPath(new URL('../workorder.mjs',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const config={resourceUrl:'https://seller.example/paid',catalogUrl:'https://facilitator.example/discovery/resources',
  origin:'https://buyer.example',network:'stellar:testnet',payTo:'ILLUSTRATIVE_PUBLIC_RECIPIENT',method:'GET',credentialed:true};
const terms={workOrderRef:'OFFLINE-ILLUSTRATION',sellerDisplayName:'Illustrative <seller>',relationshipOwner:'Example owner',
  merchantConsent:{status:'NOT_RECORDED'},commercial:{priceApproval:'NOT_APPROVED',feeUsd:125,costUsd:50}};
function intake({after=false,method='GET',credentialed=true,broken=false,complete=true,browserMissing=false,legacy=false}={}) {
  const c={...config,method,credentialed};
  const seller={schema:'stellar-forge.seller-visibility.v1',mode:'READ_ONLY_UNAUTHENTICATED',
    seller:c.resourceUrl,network:c.network,desiredPayTo:c.payTo,
    sellerDiscovery:{state:method==='POST'?'CATALOG_NON_GET_ONLY':'UNPAID_402_BAZAAR_VISIBLE'},
    catalog:{endpoint:c.catalogUrl,complete,matchingResourceCount:1,
      matchingEvidence:{desiredNetworkFound:true,desiredPayToFound:true,desiredPaymentRouteFound:true},
      operationEvidence:{httpMethods:[method],mcpToolCount:0,unresolvedMethodCount:0}},verdict:'LISTED'};
  const headers={'access-control-allow-origin':c.origin,'access-control-allow-credentials':'true',
    'access-control-expose-headers':broken?'some-other-header':'payment-required',
    'access-control-allow-methods':method,'access-control-allow-headers':'payment-signature,content-type'};
  const browser=method==='POST'||browserMissing?null:assess({resource:c.resourceUrl,origin:c.origin,method,credentialed,
    getStatus:402,getHeaders:headers,optionsStatus:204,optionsHeaders:headers,hasPaymentRequired:true});
  const report=combine({seller,browser,config:c,error:browserMissing?'Illustrative unavailable browser':null,
    observedAt:after?'2026-10-11T12:10:00.000Z':'2026-10-11T12:00:00.000Z'});
  if(legacy) delete report.scope.browserCredentialed;
  return report;
}
function preflight(report,sourceSha,broken=false) {
  const headers={'access-control-allow-origin':report.scope.buyerOrigin,'access-control-allow-credentials':'true',
    'access-control-allow-methods':'POST','access-control-allow-headers':broken?'content-type':'payment-signature,content-type'};
  return {schema:'stellar-forge.post-only-browser-preflight.v1',method:'OPTIONS_ONLY',credentialed:true,
    observedAt:new Date(Date.parse(report.observedAt)+1000).toISOString(),
    source:{intakeSha256:sourceSha,originalSchema:report.schema,originalObservedAt:report.observedAt,
      resource:report.scope.resource,catalog:report.scope.catalog,network:report.scope.network,origin:report.scope.buyerOrigin},
    operations:{GET:0,POST:0,OPTIONS:1,payments:0,signatures:0},eligibility:eligibleIntake(report),
    ...assessPreflight({origin:report.scope.buyerOrigin,credentialed:true,status:204,headers})};
}
async function setup(t) {
  const dir=await mkdtemp(join(tmpdir(),'sf77-recheck-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const guard=join(dir,'no-network.mjs');
  await writeFile(guard,"globalThis.fetch=()=>{throw new Error('SF77 must not fetch while exporting')};\n");
  await writeFile(join(dir,'terms.json'),JSON.stringify(terms));
  const save=async(name,data)=>{const bytes=JSON.stringify(data,null,2)+'\n';await writeFile(join(dir,name),bytes);return sha(bytes);};
  const run=(extra=[],out='packet')=>spawnSync(process.execPath,['--import',pathToFileURL(guard).href,cli,
    '--intake',join(dir,'before.json'),'--terms',join(dir,'terms.json'),'--out',join(dir,out),
    '--at','2026-10-11T12:20:00Z',...extra],{encoding:'utf8'});
  const inputs=(post=false)=>['--after',join(dir,'after.json'),...(post?['--sf72-before',join(dir,'pb.json'),'--sf72-after',join(dir,'pa.json')]:[])];
  const outputs=async(out='packet')=>({packet:JSON.parse(await readFile(join(dir,out,'packet.json'),'utf8')),
    html:await readFile(join(dir,out,'seller-packet.html'),'utf8'),checklist:await readFile(join(dir,out,'acceptance-checklist.md'),'utf8')});
  return {dir,save,run,inputs,outputs};
}
function commercialOpen({packet,checklist,html}) {
  assert.equal(packet.readiness,'INTERNAL_UNSENT_PACKET');
  assert.equal(packet.commercial.approvedFeeUsd,null);
  for(const k of ['livePaymentVerified','sellerHasAcceptedWork','invoiceIssued','cashReceived']) assert.equal(packet.limits[k],false);
  assert.equal(packet.limits.newNetworkCalls,0);assert.doesNotMatch(checklist,/- \[[xX]\]/);
  assert.match(html,/Illustrative &lt;seller&gt;/);assert.doesNotMatch(html,/<seller>/);
}

test('original file-based GET repair comparison exports exact sources, credential mode and open commercial decisions',async t=>{
  const f=await setup(t);const b=await f.save('before.json',intake({broken:true}));const a=await f.save('after.json',intake({after:true}));
  const result=f.run(f.inputs());assert.equal(result.status,0,result.stderr);
  const out=await f.outputs();commercialOpen(out);
  assert.equal(out.packet.scope.browserCredentialed,true);
  assert.equal(out.packet.repairReview.classification,'GET_UNPAID_DISCOVERY_AND_BROWSER_READY');
  assert.equal(out.packet.repairReview.technicalMilestoneObserved,true);
  assert.equal(out.packet.baseline.sourceSha256,b);assert.equal(out.packet.repairReview.source.after.sha256,a);
  assert.deepEqual(out.packet.repairReview.changes.notReobservedWithCompleteAfterCatalog.map(x=>x.code),['BROWSER_CHALLENGE_NOT_BROWSER_READABLE']);
  for(const text of [out.html,out.checklist]) {assert.match(text,/GET_UNPAID_DISCOVERY_AND_BROWSER_READY/);assert.ok(text.includes(a));assert.match(text,/Credentialed browser policy/);}
  assert.equal(sha(await readFile(join(f.dir,'before.json'))),b);assert.equal(sha(await readFile(join(f.dir,'after.json'))),a);
  if(process.platform!=='win32') {assert.equal((await stat(join(f.dir,'packet'))).mode&0o777,0o700);assert.equal((await stat(join(f.dir,'packet','packet.json'))).mode&0o777,0o600);}
  const existing=await readFile(join(f.dir,'packet','packet.json'));assert.notEqual(f.run(f.inputs()).status,0);
  assert.deepEqual(await readFile(join(f.dir,'packet','packet.json')),existing);
});

test('legacy unknown credential mode and incomplete catalog remain unconfirmed in every export',async t=>{
  const f=await setup(t);await f.save('before.json',intake({browserMissing:true,legacy:true}));await f.save('after.json',intake({after:true}));
  assert.equal(f.run(f.inputs()).status,0);const out=await f.outputs();commercialOpen(out);
  assert.equal(out.packet.scope.browserCredentialed,null);
  assert.equal(out.packet.repairReview.classification,'BROWSER_CREDENTIAL_MODE_UNCONFIRMED');
  assert.equal(out.packet.repairReview.technicalMilestoneObserved,false);
  assert.deepEqual(out.packet.repairReview.changes.notReobservedWithCompleteAfterCatalog,[]);
  assert.equal(out.packet.repairReview.changes.notReobservedButCredentialModeUnknown[0].code,'BROWSER_HTTP_UNAVAILABLE');
  for(const text of [out.html,out.checklist]) assert.match(text,/credential mode unknown; closure unconfirmed/);
  await f.save('before.json',intake({broken:true}));await f.save('after.json',intake({after:true,complete:false}));
  assert.equal(f.run(f.inputs(),'incomplete').status,0);const incomplete=await f.outputs('incomplete');
  assert.equal(incomplete.packet.repairReview.classification,'CATALOG_COVERAGE_INCOMPLETE');
  assert.deepEqual(incomplete.packet.repairReview.changes.notReobservedWithCompleteAfterCatalog,[]);
  assert.equal(incomplete.packet.repairReview.changes.notReobservedButAfterCatalogIncomplete[0].code,'BROWSER_CHALLENGE_NOT_BROWSER_READABLE');
  commercialOpen(incomplete);
});

test('POST handoff consumes paired original SF72 hashes without turning OPTIONS into checkout acceptance',async t=>{
  const f=await setup(t);const before=intake({method:'POST',legacy:true}),after=intake({method:'POST',after:true,legacy:true});
  const b=await f.save('before.json',before),a=await f.save('after.json',after);
  const pb=await f.save('pb.json',preflight(before,b,true)),pa=await f.save('pa.json',preflight(after,a));
  const result=f.run(f.inputs(true));assert.equal(result.status,0,result.stderr);const out=await f.outputs();commercialOpen(out);
  assert.equal(out.packet.scope.browserCredentialed,true);
  assert.equal(out.packet.repairReview.classification,'POST_OPTIONS_READY_CHALLENGE_UNCHECKED');
  assert.equal(out.packet.repairReview.source.sf72Before.reportSha256,pb);assert.equal(out.packet.repairReview.source.sf72After.reportSha256,pa);
  assert.equal(out.packet.repairReview.boundaries.paidCheckoutVerified,false);
  for(const text of [out.html,out.checklist]) {assert.ok(text.includes(pa));assert.match(text,/OPTIONS only/);}
  // Semantically identical JSON with different bytes must fail the original SF72 binding.
  await writeFile(join(f.dir,'before.json'),JSON.stringify(before));
  const tampered=f.run(f.inputs(true),'tampered');assert.notEqual(tampered.status,0);assert.match(tampered.stderr,/exact original SF70 bytes/);
  await assert.rejects(access(join(f.dir,'tampered')));
});

test('changed scope, asserted verdicts and partial SF72 inputs fail before output creation',async t=>{
  const f=await setup(t);await f.save('before.json',intake({broken:true}));
  for(const [name,after,error] of [
    ['mode',intake({after:true,credentialed:false}),/browserCredentialed/],
    ['scope',(()=>{const a=intake({after:true});a.scope.payTo='ANOTHER_RECIPIENT';return a;})(),/matching SF52/],
    ['decision',(()=>{const a=intake({after:true,broken:true});a.state='UNPAID_DISCOVERY_AND_BROWSER_READY';a.findings=[];return a;})(),/disagree with original/]
  ]) {await f.save('after.json',after);const result=f.run(f.inputs(),name);assert.notEqual(result.status,0);assert.match(result.stderr,error);await assert.rejects(access(join(f.dir,name)));}
  const partial=f.run(['--sf72-before',join(f.dir,'pb.json')],'partial');assert.notEqual(partial.status,0);assert.match(partial.stderr,/both original SF72/);
  const noAfter=f.run(['--sf72-before','a','--sf72-after','b'],'no-after');assert.notEqual(noAfter.status,0);assert.match(noAfter.stderr,/requires --after/);
});

test('baseline-only packets retain backward compatibility and never guess legacy credential mode',async t=>{
  const f=await setup(t);await f.save('before.json',intake({browserMissing:true,legacy:true}));
  const result=f.run();assert.equal(result.status,0,result.stderr);const out=await f.outputs();commercialOpen(out);
  assert.equal(out.packet.repairReview,null);assert.equal(out.packet.scope.browserCredentialed,null);
  assert.match(out.html,/No after report supplied/);assert.match(out.checklist,/Recheck: NOT SUPPLIED/);
});
