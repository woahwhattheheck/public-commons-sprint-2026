import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {start} from '../server.mjs';
import {combine} from '../../sf70-merchant-intake/run.mjs';
import {compare} from '../../sf76-merchant-remediation-delta/compare.mjs';
import {evaluate} from '../../sf72-post-only-preflight/preflight.mjs';

const sha = report => createHash('sha256').update(JSON.stringify(report)).digest('hex');
const delta = (before, after, extra={}) => compare({before, after, beforeSha:sha(before), afterSha:sha(after), ...extra});
const close = server => new Promise(resolve => {server.close(resolve); server.closeAllConnections();});

test('console credential policy reaches native CORS and remains immutable in repair comparisons', async t => {
  let credentialSupport=false, method='GET', requests=0;
  const origin='http://127.0.0.1:1';
  const merchant=createServer((req,res)=>{
    requests++;
    const resource=`http://127.0.0.1:${merchant.address().port}/paid`;
    const offer={resource:{url:resource},type:'http',x402Version:2,
      accepts:[{network:'stellar:testnet',scheme:'exact',payTo:'PUBLIC_TEST_RECIPIENT',amount:'1',asset:'TEST'}],
      extensions:{bazaar:{info:{input:{type:'http',method}}}}};
    if (req.url.startsWith('/discovery/resources')) {
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({items:[offer],pagination:{total:1}}));return;
    }
    res.setHeader('access-control-allow-origin',credentialSupport?origin:'*');
    if (credentialSupport) res.setHeader('access-control-allow-credentials','true');
    res.setHeader('access-control-expose-headers','payment-required');
    res.setHeader('access-control-allow-methods','GET, POST');
    res.setHeader('access-control-allow-headers','payment-signature, content-type');
    if (req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
    assert.equal(req.method,'GET');
    assert.equal(req.headers.cookie,undefined);
    assert.equal(req.headers.authorization,undefined);
    res.writeHead(402,{'payment-required':Buffer.from(JSON.stringify(offer)).toString('base64')});res.end();
  });
  await new Promise(resolve=>merchant.listen(0,'127.0.0.1',resolve));t.after(()=>close(merchant));
  const {server,url}=await start({allowLoopback:true});t.after(()=>close(server));
  const base=`http://127.0.0.1:${merchant.address().port}`;
  const intake=async credentialed=>{
    const payload={resource:base+'/paid',catalog:base+'/discovery/resources',origin,
      network:'stellar:testnet',payTo:'PUBLIC_TEST_RECIPIENT',method,permission:true};
    if (credentialed!==undefined) payload.credentialed=credentialed;
    const response=await fetch(new URL('/api/intake',url),{method:'POST',
      headers:{origin:new URL(url).origin,'content-type':'application/json'},body:JSON.stringify(payload)});
    return {status:response.status,...await response.json()};
  };
  const anonymous=await intake();assert.equal(anonymous.status,200);
  assert.equal(anonymous.report.scope.browserCredentialed,false);
  assert.equal(anonymous.report.state,'UNPAID_DISCOVERY_AND_BROWSER_READY');
  const before=await intake(true);assert.equal(before.status,200);
  assert.equal(before.report.scope.browserCredentialed,true);
  assert.equal(before.report.originals.browserReadiness.credentialed,true);
  assert.equal(before.report.state,'REMEDIATION_REQUIRED');
  const requestCount=requests;
  assert.equal((await intake('true')).status,422);
  assert.equal(requests,requestCount);
  assert.throws(()=>delta(anonymous.report,before.report),/browserCredentialed/);
  credentialSupport=true;
  const after=await intake(true);assert.equal(after.report.state,'UNPAID_DISCOVERY_AND_BROWSER_READY');
  assert.equal(delta(before.report,after.report).technicalMilestoneObserved,true);
  const legacyBefore=structuredClone(before.report),legacyAfter=structuredClone(after.report);
  delete legacyBefore.scope.browserCredentialed;delete legacyAfter.scope.browserCredentialed;
  assert.equal(delta(legacyBefore,legacyAfter).scope.browserCredentialed,true);
  const wrong=structuredClone(after.report);wrong.scope.browserCredentialed=false;
  assert.throws(()=>delta(before.report,wrong),/disagree about browser credential mode/);
  const unknown=combine({seller:before.report.originals.sellerCatalog,browser:null,error:'Original browser unavailable',
    config:{resourceUrl:base+'/paid',catalogUrl:base+'/discovery/resources',origin,
      network:'stellar:testnet',payTo:'PUBLIC_TEST_RECIPIENT',method},observedAt:before.report.observedAt});
  delete unknown.scope.browserCredentialed;
  const incomplete=delta(unknown,legacyAfter);
  assert.equal(incomplete.classification,'BROWSER_CREDENTIAL_MODE_UNCONFIRMED');
  assert.equal(incomplete.technicalMilestoneObserved,false);
  assert.deepEqual(incomplete.changes.notReobservedWithCompleteAfterCatalog,[]);
  assert.ok(incomplete.changes.notReobservedButCredentialModeUnknown.length>0);

  method='POST';
  const postBefore=(await intake(true)).report;
  const pb=await evaluate(postBefore,{allowLoopback:true,credentialed:true});pb.source.intakeSha256=sha(postBefore);
  const postAfter=(await intake(true)).report;
  const pa=await evaluate(postAfter,{allowLoopback:true,credentialed:true});pa.source.intakeSha256=sha(postAfter);
  const postExtra=()=>({postBefore:pb,postAfter:pa,postBeforeSha:sha(pb),postAfterSha:sha(pa)});
  assert.equal(delta(postBefore,postAfter,postExtra()).classification,'POST_OPTIONS_READY_CHALLENGE_UNCHECKED');
  pa.credentialed=false;
  assert.throws(()=>delta(postBefore,postAfter,postExtra()),/disagree about browser credential mode/);
});
