// Focused actual loopback HTTP + real CORS header-path acceptance; no paid requests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {probe} from './audit.mjs';

async function serve(handler) {
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {base:'http://127.0.0.1:'+server.address().port,
    close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}

test('one actual buyer origin, good 402/OPTIONS and broken missing expose/paid preflight',async()=>{
  const seen=[];
  const seller=await serve((req,res)=>{
    seen.push(req.method+' '+req.url);
    const origin=req.headers.origin;
    if(req.url==='/ok') {
      res.setHeader('access-control-allow-origin',origin);
      res.setHeader('access-control-expose-headers','PAYMENT-RESPONSE, PAYMENT-REQUIRED');
      if(req.method==='OPTIONS') {
        res.writeHead(204,{'access-control-allow-headers':'content-type, payment-signature',
          'access-control-allow-methods':'GET, POST, OPTIONS'});return res.end();
      }
      res.writeHead(402,{'payment-required':'original-unpaid-challenge'});return res.end();
    }
    if(req.method==='OPTIONS'){res.writeHead(402);return res.end();}
    res.writeHead(402,{'access-control-allow-origin':origin,'payment-required':'original-unpaid-challenge'});res.end();
  });
  const buyer=await serve((_req,res)=>res.end('buyer'));
  try {
    const origin=buyer.base;
    const good=await probe({resource:seller.base+'/ok',origin,method:'POST',credentialed:false});
    assert.equal(good.status,'READABLE_402_AND_PREFLIGHT_READY');
    assert.equal(good.evidence.GET_402_browser_visible,true);
    assert.equal(good.evidence.preflightReady,true);
    const bad=await probe({resource:seller.base+'/bad',origin,method:'POST',credentialed:false});
    assert.equal(bad.status,'BROWSER_CHECKOUT_REMEDIATION');
    assert.deepEqual(new Set(bad.findings.map(x=>x.code)),new Set([
      'CHALLENGE_NOT_BROWSER_READABLE','PREFLIGHT_NOT_2XX','PREFLIGHT_CORS_ORIGIN','PREFLIGHT_METHOD','PREFLIGHT_PAYMENT_HEADER']));
    assert.deepEqual(seen,['GET /ok','OPTIONS /ok','GET /bad','OPTIONS /bad']);
    assert.equal(good.paidRequests,0);
    // Wildcard is NOT sufficient for credentialed browser requests.
    const wildcard={
      'access-control-allow-origin':'*','access-control-expose-headers':'*',
      'access-control-allow-headers':'*','access-control-allow-methods':'*',
    };
    const {assess}=await import('./audit.mjs');
    const credentialed=assess({origin,resource:seller.base,method:'POST',credentialed:true,
      getStatus:402,hasPaymentRequired:true,getHeaders:wildcard,optionsStatus:204,optionsHeaders:wildcard});
    assert.equal(credentialed.status,'BROWSER_CHECKOUT_REMEDIATION');
  } finally {await buyer.close();await seller.close();}
});
