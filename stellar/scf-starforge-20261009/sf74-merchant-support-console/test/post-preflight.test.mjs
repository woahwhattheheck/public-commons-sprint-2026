import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {start} from '../server.mjs';

const encode = value => Buffer.from(value).toString('base64');
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const close = server => new Promise(resolve => {server.close(resolve);server.closeAllConnections();});

test('original POST preflight binds exact console intake bytes and composes with original repair comparison', async t => {
  let ready=false, method='POST', hold=null;
  const calls=[];
  const buyer='http://127.0.0.1:1';
  const merchant=createServer((req,res)=>{
    calls.push({method:req.method,path:req.url,cookie:req.headers.cookie,authorization:req.headers.authorization});
    const origin=`http://127.0.0.1:${merchant.address().port}`;
    const offer={resource:{url:origin+'/paid'},type:'http',x402Version:2,
      accepts:[{network:'stellar:testnet',scheme:'exact',payTo:'PUBLIC_TEST_RECIPIENT',amount:'1',asset:'TEST'}],
      extensions:{bazaar:{info:{input:{type:'http',method}}}}};
    if (req.url.startsWith('/discovery/resources')) {
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({items:[offer],pagination:{total:1}}));return;
    }
    const finish=()=>{
      if (ready) {
        res.setHeader('access-control-allow-origin',buyer);
        res.setHeader('access-control-allow-credentials','true');
        res.setHeader('access-control-allow-methods','GET, POST');
        res.setHeader('access-control-allow-headers','payment-signature, content-type');
        res.setHeader('access-control-expose-headers','payment-required');
      }
      if (req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
      assert.equal(req.method,'GET');
      res.writeHead(402,{'payment-required':encode(JSON.stringify(offer))});res.end();
    };
    if (hold&&req.method==='OPTIONS') hold(finish); else finish();
  });
  await new Promise(resolve=>merchant.listen(0,'127.0.0.1',resolve));t.after(()=>close(merchant));
  const {server,url}=await start({allowLoopback:true});t.after(()=>close(server));
  const origin=new URL(url).origin, merchantOrigin=`http://127.0.0.1:${merchant.address().port}`;
  const api=async(path,body,caller=origin)=>{
    const response=await fetch(new URL(path,url),{method:'POST',headers:{'content-type':'application/json',...(caller?{origin:caller}:{})},body:JSON.stringify(body)});
    return {status:response.status,...await response.json()};
  };
  const form={resource:merchantOrigin+'/paid',catalog:merchantOrigin+'/discovery/resources',origin:buyer,
    network:'stellar:testnet',payTo:'PUBLIC_TEST_RECIPIENT',method:'POST',credentialed:true,permission:true};
  await fetch(url);await fetch(new URL('/health',url));
  assert.equal(calls.length,0,'page load must not probe');
  const before=(await api('/api/intake',form)).report, beforeBytes=serialize(before);
  assert.equal(before.originals.sellerCatalog.sellerDiscovery.state,'CATALOG_NON_GET_ONLY');
  assert.ok(calls.every(x=>x.path.startsWith('/discovery/resources')));
  const input={intake:encode(beforeBytes),permission:true}, count=calls.length;
  assert.equal((await api('/api/post-preflight',{...input,permission:false})).status,422);
  assert.equal((await api('/api/post-preflight',input,null)).status,403);
  const legacy=structuredClone(before);delete legacy.scope.browserCredentialed;
  assert.equal((await api('/api/post-preflight',{...input,intake:encode(serialize(legacy))})).status,422);
  assert.equal(calls.length,count);
  const pb=await api('/api/post-preflight',input);
  assert.equal(pb.status,200);assert.equal(pb.report.status,'PREFLIGHT_REMEDIATION');
  assert.equal(pb.report.source.intakeSha256,hash(beforeBytes));
  assert.equal(pb.report.credentialed,true);
  assert.equal(calls.length,count+1);assert.equal(calls.at(-1).method,'OPTIONS');

  ready=true;
  const after=(await api('/api/intake',form)).report, afterBytes=serialize(after);
  let release, arrived;
  const started=new Promise(resolve=>{arrived=resolve;});
  hold=finish=>{release=finish;arrived();};
  const pending=api('/api/post-preflight',{intake:encode(afterBytes),permission:true});
  await started;
  assert.equal((await api('/api/post-preflight',input)).status,409);
  assert.equal((await api('/api/intake',form)).status,409);
  hold=null;release();
  const pa=await pending;assert.equal(pa.status,200);
  assert.equal(pa.report.status,'POST_PREFLIGHT_READY_CHALLENGE_UNKNOWN');
  const finalCount=calls.length;
  const compared=await api('/api/compare',{before:encode(beforeBytes),after:encode(afterBytes),
    postBefore:encode(serialize(pb.report)),postAfter:encode(serialize(pa.report))});
  assert.equal(compared.status,200);
  assert.equal(compared.report.classification,'POST_OPTIONS_READY_CHALLENGE_UNCHECKED');
  assert.equal(calls.length,finalCount,'comparison remains offline');
  assert.ok(calls.every(x=>!x.cookie&&!x.authorization&&['GET','OPTIONS'].includes(x.method)));

  // A fresh original capture that does not prove POST-only stays ineligible, without a new request.
  method='GET';
  const unproven=(await api('/api/intake',form)).report, unprovenCount=calls.length;
  const skipped=await api('/api/post-preflight',{intake:encode(serialize(unproven)),permission:true});
  assert.equal(skipped.status,200);assert.equal(skipped.report.status,'INCONCLUSIVE');
  assert.equal(skipped.report.operations.OPTIONS,0);assert.equal(calls.length,unprovenCount);
});
