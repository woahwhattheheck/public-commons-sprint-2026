import test from 'node:test';
import assert from 'node:assert/strict';
import { McpPaidToolBroker } from './agent-server.mjs';

// Exercises the actual SF32 broker, with only in-memory HTTP responses.
// No signer keys, funds, remote merchant, provider, network, or CI.
const resource='https://merchant.invalid/paid';
const catalog='https://catalog.invalid';
const terms={scheme:'exact',network:'stellar:testnet',asset:'USDC_TEST',
  amount:'1000',payTo:'GLOCALONLY'};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64');
const make=async({approve,signPayment,counts})=>{
  const fetchImpl=async(url,init)=>{
    assert.equal(init.redirect,'error','every fetch must retain the origin fence');
    if(String(url).startsWith(catalog)){
      counts.catalog++;
      return new Response(JSON.stringify({resources:[{
        resource:{url:resource,description:'Offline test route'},
        accepts:[terms],
        extensions:{bazaar:{info:{input:{type:'http',method:'GET'}}}}
      }]}),{status:200,headers:{'content-type':'application/json'}});
    }
    assert.equal(url,resource);
    counts.merchant++;
    if(!init.headers['PAYMENT-SIGNATURE']){
      return new Response('{}',{status:402,headers:{
        'PAYMENT-REQUIRED':b64({x402Version:2,resource:{url:resource},accepts:[terms]})
      }});
    }
    counts.signed++;
    return new Response('{"ok":true}',{status:200,headers:{
      'PAYMENT-RESPONSE':b64({success:true,network:'stellar:testnet',transaction:'test-fixture'})
    }});
  };
  const broker=new McpPaidToolBroker({discoveryUrl:catalog,
    allowedResourceOrigins:[resource],fetchImpl,approve,signPayment});
  const found=await broker.search({query:'paid'});
  const quote=broker.preview({handle:found.resources[0].handle});
  return {broker,quoteId:quote.quoteId};
};
const signer=counts=>async({resource:requested,accepted})=>{
  counts.signer++;
  return {x402Version:2,resource:requested,accepted,payload:{fixture:true}};
};

test('two concurrent calls reserve one quote before asynchronous approval',async()=>{
  const counts={catalog:0,merchant:0,signed:0,signer:0,approval:0};
  let authorize;
  const gate=new Promise(resolve=>{authorize=resolve;});
  const {broker,quoteId}=await make({counts,
    approve:async()=>{counts.approval++;return gate;},signPayment:signer(counts)});
  const first=broker.execute({quoteId});
  assert.equal(broker.status({quoteId}).status,'APPROVAL_PENDING');
  const simultaneous=await broker.execute({quoteId});
  assert.equal(simultaneous.status,'APPROVAL_PENDING');
  assert.equal(simultaneous.attempts,0);
  authorize(true);
  const settled=await first;
  assert.equal(settled.status,'CONFIRMED_BY_SERVER');
  assert.equal(settled.attempts,1);
  assert.equal(counts.approval,1);
  assert.equal(counts.signer,1);
  assert.equal(counts.merchant,2,'one 402 probe and one signed call');
  assert.equal(counts.signed,1);
  assert.equal((await broker.execute({quoteId})).status,'CONFIRMED_BY_SERVER');
  assert.equal(counts.signed,1,'settled quote cannot dispatch another payment');
});

test('cancel during outstanding approval prevents any merchant or signed call',async()=>{
  const counts={catalog:0,merchant:0,signed:0,signer:0,approval:0};
  let authorize;
  const gate=new Promise(resolve=>{authorize=resolve;});
  const {broker,quoteId}=await make({counts,
    approve:async()=>{counts.approval++;return gate;},signPayment:signer(counts)});
  const first=broker.execute({quoteId});
  assert.equal(broker.cancel({quoteId}).status,'CANCELLED');
  authorize(true);
  assert.equal((await first).status,'CANCELLED');
  assert.equal((await broker.execute({quoteId})).status,'CANCELLED');
  assert.equal(counts.approval,1);
  assert.equal(counts.merchant,0);
  assert.equal(counts.signer,0);
  assert.equal(counts.signed,0);
});

test('denied approval returns to PREVIEWED without signing or dispatch',async()=>{
  const counts={catalog:0,merchant:0,signed:0,signer:0,approval:0};
  const {broker,quoteId}=await make({counts,
    approve:async()=>{counts.approval++;return false;},signPayment:signer(counts)});
  await assert.rejects(()=>broker.execute({quoteId}),e=>e.code==='APPROVAL_REQUIRED');
  assert.equal(broker.status({quoteId}).status,'PREVIEWED');
  assert.equal(counts.merchant,0);
  assert.equal(counts.signer,0);
});