import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {start} from '../server.mjs';
import {combine} from '../../sf70-merchant-intake/run.mjs';
import {evaluate} from '../../sf72-post-only-preflight/preflight.mjs';
import {renderHtml, renderChecklist} from '../../sf77-merchant-workorder/workorder.mjs';

const encode = value => Buffer.from(value).toString('base64');
const bytes = value => JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const close = server => new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
// Deliberately illustrative HTTPS source observations: native pure modules assemble the reports.
// These fixtures make no merchant request and establish no live seller or commercial claim.
function intake(method, second, ready = true) {
  const config = {resourceUrl:'https://seller.example/paid', catalogUrl:'https://provider.example/discovery/resources',
    origin:'https://buyer.example', network:'stellar:testnet', payTo:'ILLUSTRATIVE_PUBLIC_RECIPIENT', method, credentialed:true};
  const seller = {schema:'stellar-forge.seller-visibility.v1', mode:'READ_ONLY_UNAUTHENTICATED',
    seller:config.resourceUrl, network:config.network, desiredPayTo:config.payTo, verdict:'LISTED',
    sellerDiscovery:{state:method === 'POST' ? 'CATALOG_NON_GET_ONLY' : 'UNPAID_402_BAZAAR_VISIBLE'},
    catalog:{endpoint:config.catalogUrl,complete:true,matchingResourceCount:1,
      matchingEvidence:{desiredPaymentRouteFound:true},
      operationEvidence:{unresolvedMethodCount:0,mcpToolCount:0,httpMethods:[method]}}};
  const browser = method === 'POST' ? null : {credentialed:true,
    status:ready ? 'READABLE_402_AND_PREFLIGHT_READY' : 'REMEDIATION_REQUIRED',
    findings:ready ? [] : [{severity:'HIGH',code:'ORIGIN_NOT_ALLOWED',repair:'Permit the specific buyer origin.'}]};
  return combine({seller,browser,config,observedAt:'2026-10-11T10:00:0' + second + '.000Z'});
}
const ownerTerms = {workOrderRef:'ILLUSTRATIVE-INTERNAL',sellerDisplayName:'Example <merchant>',relationshipOwner:'Example owner',
  merchantConsent:{status:'NOT_RECORDED',receiptUrl:null},
  commercial:{priceApproval:'NOT_APPROVED',feeUsd:null,costUsd:null,approvalReceiptUrl:null},proposedWindow:'UNSCHEDULED'};

test('workorder API preserves native baseline, repair review, exact sources and original downloadable renderers', async t => {
  let captures = 0;
  const {server,url} = await start({runCapture:async()=>{captures++;throw Error('Export must not capture');}});
  t.after(()=>close(server));
  const origin = new URL(url).origin;
  const api = async (input, caller=origin) => {
    const response = await fetch(new URL('/api/workorder',url), {method:'POST',
      headers:{'content-type':'application/json',...(caller?{origin:caller}:{})},body:JSON.stringify(input)});
    return {status:response.status,...await response.json()};
  };
  const before = bytes(intake('GET',1,false)), after = bytes(intake('GET',2));
  const input = {before:encode(before),terms:encode(bytes(ownerTerms))};
  const baseline = await api(input);
  assert.equal(baseline.status,200);
  assert.equal(baseline.packet.baseline.sourceSha256,hash(before));
  assert.equal(baseline.packet.repairReview,null);
  assert.equal(baseline.packet.commercial.approvedFeeUsd,null);
  assert.equal(baseline.packet.readiness,'INTERNAL_UNSENT_PACKET');
  assert.deepEqual(baseline.html,renderHtml(baseline.packet));
  assert.deepEqual(baseline.checklist,renderChecklist(baseline.packet));
  assert.ok(baseline.html.includes('Example &lt;merchant&gt;'));
  assert.equal(baseline.packet.limits.sellerHasAcceptedWork,false);
  const repaired = await api({...input,after:encode(after)});
  assert.equal(repaired.status,200);
  assert.equal(repaired.packet.repairReview.classification,'GET_UNPAID_DISCOVERY_AND_BROWSER_READY');
  assert.equal(repaired.packet.repairReview.source.before.sha256,hash(before));
  assert.equal(repaired.packet.repairReview.source.after.sha256,hash(after));
  assert.ok(repaired.html.includes('Original before/after repair review'));
  assert.ok(repaired.checklist.includes(hash(after)));
  const legacy = intake('GET',1,false);
  delete legacy.scope.browserCredentialed;
  delete legacy.originals.browserReadiness.credentialed;
  const uncertain = await api({...input,before:encode(bytes(legacy)),after:encode(after)});
  assert.equal(uncertain.packet.repairReview.classification,'BROWSER_CREDENTIAL_MODE_UNCONFIRMED');
  assert.equal(uncertain.packet.repairReview.technicalMilestoneObserved,false);

  const pbSource = intake('POST',1), paSource = intake('POST',2);
  const pbBytes = bytes(pbSource), paBytes = bytes(paSource);
  const preflight = async (source, raw, second) => {
    const result = await evaluate(source,{credentialed:true,observedAt:'2026-10-11T10:00:0' + second + '.500Z',
      fetchImpl:async()=>new Response(null,{status:204,headers:{
        'access-control-allow-origin':'https://buyer.example','access-control-allow-credentials':'true',
        'access-control-allow-methods':'POST','access-control-allow-headers':'payment-signature,content-type'}})});
    result.source.intakeSha256 = hash(raw);
    return bytes(result);
  };
  const postBefore = await preflight(pbSource,pbBytes,1), postAfter = await preflight(paSource,paBytes,2);
  const postInput = {...input,before:encode(pbBytes),after:encode(paBytes),
    postBefore:encode(postBefore),postAfter:encode(postAfter)};
  const post = await api(postInput);
  assert.equal(post.status,200);
  assert.equal(post.packet.repairReview.classification,'POST_OPTIONS_READY_CHALLENGE_UNCHECKED');
  assert.equal(post.packet.repairReview.source.sf72After.reportSha256,hash(postAfter));
  assert.equal((await api({...postInput,after:encode(paBytes+' ')})).status,422,'reformatting breaks exact preflight binding');
  assert.equal((await api({...postInput,postAfter:undefined})).status,422,'paired checks are required');
  assert.equal((await api({...postInput,after:undefined})).status,422,'baseline does not silently consume browser comparison');
  assert.equal((await api(input,null)).status,403);
  assert.equal((await api({...input,path:'/tmp/intake.json'})).status,422,'no filesystem input');
  const approved = structuredClone(ownerTerms); approved.commercial.priceApproval='OWNER_APPROVED_PROPOSAL';
  assert.equal((await api({...input,terms:encode(bytes(approved))})).status,422,'approval does not invent economics');
  assert.equal(captures,0,'export never invokes network diagnosis');
});
