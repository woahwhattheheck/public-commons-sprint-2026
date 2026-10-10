// MIT. Native Node HTTP x402 v2 wire-contract checks; no real signatures/settlement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { X402BuyerClient,BuyerError } from '../buyer.mjs';
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64');
const terms={scheme:'exact',network:'stellar:TESTNET',amount:'20',asset:'stellar-asset-fixture',payTo:'GBUYER_TEST_PAYTO',maxTimeoutSeconds:60,extra:{name:'USD'}};
const expected={scheme:'exact',network:terms.network,asset:terms.asset,payTo:terms.payTo,maxAtomic:'20'};
async function fixture(fn){
  const state={calls:[],paid:[],response:'success',paymentRequired:null};
  const server=createServer(async (req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/discovery/resources'){
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({resources:[{resource:{url:`http://localhost:${server.address().port}/protected`},accepts:[terms]}],pagination:{limit:1,offset:0,total:1}}));return;
    }
    if(url.pathname!=='/protected'){res.writeHead(404);res.end();return;}
    let chunks=[];for await(const chunk of req)chunks.push(chunk);
    const data=Buffer.concat(chunks).toString();
    const auth=req.headers['payment-signature'];
    state.calls.push({method:req.method,body:data,auth:!!auth});
    const challenge={x402Version:2,resource:{url:`http://localhost:${server.address().port}/protected`,description:'Local fixture'},accepts:[terms],extensions:{bazaar:{info:{service:'fixture'},schema:{type:'object'}}}};
    if(!auth){res.writeHead(402,{'PAYMENT-REQUIRED':b64(state.paymentRequired??challenge)});res.end();return;}
    const obj=JSON.parse(Buffer.from(auth,'base64').toString());
    state.paid.push(obj);
    if(state.response==='redirect'){res.writeHead(302,{Location:'http://example.com/steal'});res.end();return;}
    if(state.response==='pending'){res.writeHead(402,{'PAYMENT-RESPONSE':b64({success:false,errorReason:'settlement_pending',transaction:'test-hash',network:terms.network})});res.end();return;}
    if(state.response==='missing'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:'fixture no receipt'}));return;}
    res.writeHead(200,{'PAYMENT-RESPONSE':b64({success:true,transaction:'test-hash',network:terms.network}),'content-type':'application/json'});
    res.end(JSON.stringify({data:'fixture fulfilled'}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{return await fn({state,buyer:new X402BuyerClient({allowLocal:true}),url:`http://localhost:${server.address().port}/protected`,origin:`http://localhost:${server.address().port}`});}
  finally{server.close();await once(server,'close');}
}
function signed({challenge,accepted}){return {x402Version:2,resource:challenge.resource,accepted,payload:{offlineFixtureMarker:true},extensions:challenge.extensions};}
function settings(url){return {url,method:'POST',body:'request body',expect:expected,approve:async()=>true,sign:signed};}

test('real GET discovery HTTP, 402 -> policy -> signer -> one v2 paid POST + receipt',async()=>fixture(async({state,buyer,url,origin})=>{
  const found=await buyer.discover({origin,filters:{network:terms.network}});
  assert.equal(found.resources[0].resource.url,url);
  const result=await buyer.call({...settings(url),intentId:'one'});
  assert.equal(result.status,'DELIVERED_REPORTED_SETTLED');assert.equal(result.attempts,2);
  assert.equal(state.calls.length,2);assert.deepEqual(state.calls.map(x=>x.method),['POST','POST']);
  assert.deepEqual(state.calls.map(x=>x.body),['request body','request body']);
  assert.deepEqual(state.calls.map(x=>x.auth),[false,true]);
  assert.equal(state.paid[0].x402Version,2);assert.deepEqual(state.paid[0].accepted,terms);
  assert.equal(state.paid[0].payload.offlineFixtureMarker,true);
  assert.equal(result.receipt.transaction,'test-hash');
}));

test('quote drift and recipient mismatch: block before approval or signing',async()=>fixture(async({state,buyer,url})=>{
  let attempts=0;
  await assert.rejects(buyer.call({...settings(url),expect:{...expected,maxAtomic:'19'},approve:()=>{attempts++;return true;}}),e=>e.code==='PAYMENT_TERMS_NOT_AUTHORIZED');
  assert.equal(attempts,0);assert.equal(state.calls.length,1);
  await assert.rejects(buyer.call({...settings(url),expect:{...expected,payTo:'OTHER'}}),e=>e.code==='PAYMENT_TERMS_NOT_AUTHORIZED');
  assert.equal(state.paid.length,0);
}));

test('explicit approval denied: zero signatures or paid sends',async()=>fixture(async({state,buyer,url})=>{
  let signCalls=0;
  await assert.rejects(buyer.call({...settings(url),approve:()=>false,sign:()=>{signCalls++;return signed();}}),e=>e.code==='PAYMENT_NOT_APPROVED');
  assert.equal(signCalls,0);assert.equal(state.calls.length,1);
}));

test('challenge URL or signer accepted fields differ: payment never sent',async()=>fixture(async({state,buyer,url})=>{
  state.paymentRequired={x402Version:2,resource:{url:url+'?mismatch=1'},accepts:[terms]};
  await assert.rejects(buyer.call(settings(url)),e=>e.code==='RESOURCE_MISMATCH');
  state.paymentRequired=null;
  await assert.rejects(buyer.call({...settings(url),sign:({challenge,accepted})=>signed({challenge,accepted:{...accepted,amount:'1'}})}),e=>e.code==='SIGNER_ENVELOPE_MISMATCH');
  assert.equal(state.paid.length,0);
}));

test('pending, missing receipt, redirected paid request remain terminal with no retry',async()=>fixture(async({state,buyer,url})=>{
  state.response='pending';const pending=await buyer.call(settings(url));
  assert.equal(pending.status,'SETTLEMENT_PENDING');assert.equal(pending.receipt.transaction,'test-hash');
  state.response='missing';const missing=await buyer.call(settings(url));
  assert.equal(missing.status,'PAYMENT_OUTCOME_UNKNOWN');assert.equal(missing.reason,'MISSING_PAYMENT_RESPONSE');
  state.response='redirect';await assert.rejects(buyer.call(settings(url)),e=>e.code==='REDIRECT_DENIED'&&e.paymentSent);
  assert.equal(state.paid.length,3);assert.equal(state.calls.length,6);
}));

test('transport loss after paid send: unknown outcome and EXACTLY ONE send',async()=>fixture(async({buyer,url})=>{
  let calls=0;
  const real=buyer.fetch;
  buyer.fetch=async (...args)=>{calls++;if(calls===2)throw new Error('connection lost after send');return real(...args);};
  await assert.rejects(buyer.call(settings(url)),e=>e.code==='PAYMENT_OUTCOME_UNKNOWN'&&e.paymentSent);
  assert.equal(calls,2);
}));

test('refuse remote http and unbounded/nonreplayable requests',async()=>{
  const buyer=new X402BuyerClient();
  await assert.rejects(buyer.call({...settings('http://127.0.0.1:4321/protected')}),e=>e.code==='HTTPS_REQUIRED');
  await assert.rejects(buyer.call({...settings('https://example.com/paid'),body:new ReadableStream()}),e=>e.code==='NONREPLAYABLE_BODY');
});


test('untrusted catalog/resource HTTPS IP literals and private hostnames are blocked before any IO',async()=>{
  let requests=0,consents=0,signatures=0;
  const buyer=new X402BuyerClient({fetchImpl:()=>{requests++;throw Error('unexpected egress');}});
  const forbidden=[
    'https://127.0.0.1/paid', 'https://localhost./paid',
    'https://10.24.0.12/paid', 'https://169.254.169.254/latest/meta-data',
    'https://192.168.0.1/paid', 'https://[::1]/paid',
    'https://[::ffff:127.0.0.1]/paid', 'https://0x7f000001/paid',
    'https://seller.local/paid', 'https://api.internal/paid',
    'https://seller.home.arpa/paid', 'https://sub.localhost/paid'
  ];
  for(const target of forbidden){
    await assert.rejects(buyer.discover({origin:target}),e=>e.code==='UNSAFE_RESOURCE_HOST',target+' discovery');
    await assert.rejects(buyer.call({...settings(target),approve:()=>{consents++;return true;},
      sign:()=>{signatures++;throw Error('unexpected signature');}}),
      e=>e.code==='UNSAFE_RESOURCE_HOST',target+' paid call');
  }
  assert.equal(requests,0);assert.equal(consents,0);assert.equal(signatures,0);
});

test('explicit developer loopback exception does not allow arbitrary IP hosts',async()=>{
  let requests=0;
  const buyer=new X402BuyerClient({allowLocal:true,fetchImpl:async()=>{
    requests++;return new Response(null,{status:204});
  }});
  const local=await buyer.call({...settings('http://127.0.0.1:4040/protected')});
  assert.equal(local.status,'NO_PAYMENT_REQUIRED');assert.equal(requests,1);
  await assert.rejects(buyer.call(settings('https://10.5.6.7/protected')),
    e=>e.code==='UNSAFE_RESOURCE_HOST');
  assert.equal(requests,1);
});

test('approval receives immutable full accepted terms and exact posted body identity',async()=>fixture(async({state,buyer,url})=>{
  let approved;
  const result=await buyer.call({...settings(url),
    approve:intent=>{
      approved=intent;
      assert.equal(intent.maxTimeoutSeconds,60);
      assert.deepEqual(intent.acceptedTerms,terms);
      assert.equal(Object.isFrozen(intent),true);
      assert.equal(Object.isFrozen(intent.acceptedTerms),true);
      assert.equal(Object.isFrozen(intent.acceptedTerms.extra),true);
      assert.equal(intent.bodyPresent,true);
      assert.equal(intent.bodyBytes,12);
      assert.equal(intent.bodySha256,createHash('sha256').update('request body').digest('hex'));
      assert.throws(()=>{intent.acceptedTerms.extra.name='tampered';},TypeError);
      return true;
    },
    sign:({intent,challenge,accepted})=>{
      assert.strictEqual(intent,approved);
      assert.notStrictEqual(accepted,intent.acceptedTerms);
      assert.deepEqual(accepted,terms);
      return signed({challenge,accepted});
    }
  });
  assert.equal(result.status,'DELIVERED_REPORTED_SETTLED');
  assert.equal(state.paid.length,1);
}));

test('policy rejects unapproved extra and caller caps timeout before signing',async()=>fixture(async({state,buyer,url})=>{
  state.paymentRequired={x402Version:2,resource:{url},accepts:[{
    ...terms,extra:{name:'UNAPPROVED_REPAYMENT_CONDITION'}
  }]};
  let signerCalls=0,approvalCalls=0;
  await assert.rejects(buyer.call({...settings(url),
    approve:intent=>{
      approvalCalls++;
      return intent.acceptedTerms.extra?.name==='USD';
    },
    sign:()=>{signerCalls++;throw Error('not allowed');}
  }),e=>e.code==='PAYMENT_NOT_APPROVED');
  assert.equal(approvalCalls,1);
  state.paymentRequired=null;
  approvalCalls=0;
  await assert.rejects(buyer.call({...settings(url),
    expect:{...expected,maxTimeoutSeconds:30},
    approve:()=>{approvalCalls++;return true;},
    sign:()=>{signerCalls++;throw Error('not allowed');}
  }),e=>e.code==='PAYMENT_TERMS_NOT_AUTHORIZED');
  assert.equal(approvalCalls,0);
  assert.equal(signerCalls,0);
  assert.equal(state.paid.length,0);
}));

test('request fingerprint binds exact replayable body bytes and presence',async()=>fixture(async({buyer,url})=>{
  const intents=[];
  for(const data of [undefined,'',new Uint8Array([0,255]),'request body']){
    await assert.rejects(buyer.call({...settings(url),body:data,
      approve:intent=>{intents.push(intent);return false;}
    }),e=>e.code==='PAYMENT_NOT_APPROVED');
  }
  assert.equal(intents.length,4);
  assert.equal(intents[0].bodyPresent,false);
  assert.equal(intents[1].bodyPresent,true);
  assert.equal(intents[0].bodySha256,intents[1].bodySha256);
  assert.equal(intents[2].bodyBytes,2);
  assert.equal(intents[2].bodySha256,createHash('sha256').update(Buffer.from([0,255])).digest('hex'));
  assert.notEqual(intents[3].bodySha256,intents[2].bodySha256);
}));
