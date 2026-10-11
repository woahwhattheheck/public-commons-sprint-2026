// MIT. One original-source availability journey; native SDK + real loopback HTTP.
// Facilitator outcomes below are controlled local responses, NOT chain payments.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { createNativeSellerServer } from './native-factory.mjs';
import { startSellerService } from './serve.mjs';
import { createUpstreamApplication } from './upstream.mjs';
import { protectUpstream } from './upstream-readiness.mjs';
import { createUpstreamHandler } from './upstream-handler.mjs';
import { startSellerOperations } from './operations/server.mjs';

let backendMode = 'failure', backendCalls = 0, nativeEntries = 0, verified = 0, settled = 0;
let held, observedHold;
const privateMarker = 'Bearer locally-generated-availability-acceptance';
const backend = createServer((req,res) => {
  backendCalls++;
  assert.equal(req.headers.authorization, privateMarker);
  assert.equal(req.headers['payment-signature'], undefined);
  const send = status => { if (res.writableEnded) return; res.writeHead(status,{'content-type':'application/json'});
    res.end(JSON.stringify(status === 200 ? {rows:[{item:'original backend result'}]} : {privateDiagnostic:privateMarker})); };
  if (backendMode === 'held') { held = () => send(200); observedHold?.(); return; }
  send(backendMode === 'failure' ? 503 : backendMode === 'client' ? 404 : 200);
});
await new Promise(done => backend.listen(0,'127.0.0.1',done));
const origin = `http://127.0.0.1:${backend.address().port}`;
const config = {schema:'stellar-forge.seller-service.v1',publicOrigin:'https://merchant.example',routes:[{
  id:'search',path:'/search',handler:'merchantSearch',definition:{method:'GET',description:'Local acceptance query',
    queryParameters:[{name:'q',type:'string',description:'Query value',example:'one',required:true}],
    payment:{scheme:'exact',network:'stellar:testnet',asset:'UNVERIFIED_LOCAL_ASSET',
      payTo:'UNVERIFIED_LOCAL_RECIPIENT',amount:'17000',maxTimeoutSeconds:60}},
}]};
const bindings = {schema:'stellar-forge.seller-upstreams.v1',bindings:{merchantSearch:{
  origin,path:'/query',query:['q'],headerEnv:{Authorization:'LOCAL_BACKEND_AUTH'},maxInFlight:8,
  availability:{failureThreshold:2,resetAfterMs:100,maxResetAfterMs:400},
}}};
const beforeConfig = JSON.stringify(config);
const application = createUpstreamApplication(config,bindings,{allowLoopback:true,env:{LOCAL_BACKEND_AUTH:privateMarker}});
assert.equal(JSON.stringify(config),beforeConfig);
assert.equal(typeof application.handlers[application.config.routes[0].admit],'function');
const facilitator = {
  async getSupported() { return {kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet'}],extensions:['bazaar'],signers:{}}; },
  async verify() { verified++; return {isValid:true,payer:'LOCAL_ACCEPTANCE_NO_WALLET'}; },
  async settle() { settled++; return {success:true,network:'stellar:testnet',transaction:'LOCAL_ACCEPTANCE_NO_CHAIN',payer:'LOCAL_ACCEPTANCE_NO_WALLET'}; },
};
let seller,operations;
const readState = () => application.snapshot().bindings[0].availability;
try {
  seller = await startSellerService({config:application.config,handlers:application.handlers,port:0,
    nativeFactory:async compiled => {
      const native = await createNativeSellerServer(compiled,{facilitatorClient:facilitator});
      const original = native.processHTTPRequest.bind(native);
      native.processHTTPRequest = (...args) => { nativeEntries++; return original(...args); };
      return native;
    }});
  seller.upstreamSnapshot = application.snapshot;
  operations = await startSellerOperations(seller,{port:0});
  const target = seller.url+'/search?q=one';
  const challengeResponse = await fetch(target);
  assert.equal(challengeResponse.status,402);
  const challenge = JSON.parse(Buffer.from(challengeResponse.headers.get('payment-required'),'base64').toString());
  assert.equal(challenge.accepts[0].amount,'17000');
  assert.equal(backendCalls,0); assert.equal(verified,0);
  const headers = {'payment-signature':encodePaymentSignatureHeader({x402Version:2,
    resource:challenge.resource,accepted:challenge.accepts[0],extensions:challenge.extensions,
    payload:{acceptance:'LOCAL_ONLY_NO_SIGNATURE'}})};
  const attempt = () => fetch(target,{headers});
  for (let i=0;i<2;i++) {
    const result = await attempt(); assert.equal(result.status,503);
    assert.equal((await result.json()).error,'UPSTREAM_REQUEST_FAILED');
  }
  assert.equal(backendCalls,2); assert.equal(verified,2); assert.equal(settled,0);
  assert.equal(readState().state,'OPEN');
  const beforeBlocked = {nativeEntries,verified,backendCalls};
  const blocked = await attempt(); assert.equal(blocked.status,429);
  assert.match(blocked.headers.get('retry-after'),/^\d+$/);
  assert.equal((await blocked.json()).error,'UPSTREAM_CIRCUIT_OPEN');
  assert.deepEqual({nativeEntries,verified,backendCalls},beforeBlocked);
  const snapshot = await (await fetch(operations.url+'/api/snapshot')).json();
  assert.equal(snapshot.upstreams.bindings[0].availability.state,'OPEN');
  assert.ok(!JSON.stringify(snapshot).includes(privateMarker));
  assert.ok(!JSON.stringify(snapshot).includes(origin));
  assert.equal((await fetch(operations.url+'/api/upstreams',{method:'POST'})).status,405);
  assert.equal((await fetch(operations.url+'/api/upstreams',{headers:{origin:'https://wrong.example'}})).status,403);

  await delay(110);
  backendMode = 'held';
  const reached = new Promise(done => { observedHold = done; });
  const recovering = attempt(); await reached;
  assert.equal(readState().state,'RECOVERY_IN_FLIGHT');
  const trialCounts = {nativeEntries,verified,backendCalls};
  const concurrent = await attempt(); assert.equal(concurrent.status,429);
  assert.equal((await concurrent.json()).error,'UPSTREAM_RECOVERY_IN_PROGRESS');
  assert.deepEqual({nativeEntries,verified,backendCalls},trialCounts);
  held(); const recovered = await recovering;
  assert.equal(recovered.status,200); assert.ok(recovered.headers.get('payment-response'));
  assert.deepEqual(await recovered.json(),{rows:[{item:'original backend result'}]});
  assert.equal(readState().state,'CLOSED'); assert.equal(readState().recovered,1);
  backendMode = 'client'; assert.equal((await attempt()).status,404);
  assert.equal(readState().failureStreak,0);

  // A pre-existing slow success must not close a circuit opened by later failures.
  backendMode = 'held';
  const slowReached = new Promise(done => { observedHold = done; });
  const olderSuccess = attempt(); await slowReached;
  backendMode = 'failure';
  assert.equal((await attempt()).status,503); assert.equal((await attempt()).status,503);
  assert.equal(readState().state,'OPEN');
  held(); assert.equal((await olderSuccess).status,200);
  assert.equal(readState().state,'OPEN');
  await delay(110);
  assert.equal((await attempt()).status,503);
  assert.ok(readState().retryAfterMs > 100); assert.equal(readState().opens,3);

  // Preserve an original application's admission/control interface when wrapping.
  const originalHandler = createUpstreamHandler({baseUrl:origin,path:'/query',allowLocal:true});
  const decision = {status:409,body:{error:'ORIGINAL_APPLICATION_DECISION'}};
  let applicationAdmissions = 0;
  originalHandler.admit = () => { applicationAdmissions++; return decision; };
  originalHandler.idempotency = {status:() => 'original'};
  const composed = protectUpstream(originalHandler,{failureThreshold:2,resetAfterMs:100,maxResetAfterMs:400},{maxInFlight:1});
  assert.equal(composed.admit({}),decision); assert.equal(applicationAdmissions,1);
  assert.equal(composed.idempotency,originalHandler.idempotency);
  console.log(JSON.stringify({result:'PASS',source:'original SF30 seller + upstream + operations + x402 SDK 2.28.0',
    backendCalls,nativeEntries,controlledVerifyCalls:verified,controlledSettleCalls:settled,
    availability:readState(),externalRequests:0,chainTransactions:0,
    contract:'outage blocks before native entry; one recovery; late-success isolation; original admission preserved'}));
} finally {
  held?.();
  if (operations) await operations.close();
  if (seller) { seller.server.closeAllConnections(); await seller.close(); }
  backend.closeAllConnections(); await new Promise(done => backend.close(done));
}
