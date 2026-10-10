import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSellerDiscovery, makePaymentRequiredResponse, verifyCatalogAcceptance } from '../index.mjs';

const payment = () => [{ scheme:'exact',network:'stellar:testnet',asset:'DEMO_USDC_ISSUER',amount:'20000',payTo:'DEMO_PAYTO',maxTimeoutSeconds:60 }];
const make = (opts={}) => createSellerDiscovery({
  resource:{url:'https://weather.example/forecast',description:'Forecast per city',serviceName:'Forecast Service',tags:['weather']},
  accepts:payment(),
  input:{type:'http',method:'GET',querySchema:{type:'object',properties:{
    city:{type:'string',description:'Human-readable city',examples:['Louisville']},
    days:{type:'integer',description:'Days forward',default:1},
  },required:['city'],additionalProperties:false}},
  output:{type:'json',example:{city:'Louisville',forecast:[]}}, ...opts,
});

test('real x402 v2 GET metadata preserves parameter descriptions and unit terms', () => {
  const record=make();
  assert.equal(record.x402Version,2);
  assert.equal(record.accepts[0].amount,'20000');
  const ext=record.extensions.bazaar;
  assert.deepEqual(ext.info.input.queryParams,{city:'Louisville',days:1});
  assert.equal(ext.schema.properties.input.properties.queryParams.properties.city.description,'Human-readable city');
  assert.equal(ext.schema.$schema,'https://json-schema.org/draft/2020-12/schema');
  assert.equal(ext.info.input.method,'GET');
});

test('source-standard canonical PAYMENT-REQUIRED base64 HTTP header, real loopback response', async () => {
  const record=make();const wire=makePaymentRequiredResponse(record);
  assert.equal(wire.statusCode,402);
  assert.deepEqual(JSON.parse(Buffer.from(wire.headers['PAYMENT-REQUIRED'],'base64').toString()),record);
  const server=createServer((_,res)=>{res.writeHead(wire.statusCode,wire.headers);res.end(wire.body);});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try { const r=await fetch(`http://127.0.0.1:${server.address().port}/weather`);
    assert.equal(r.status,402);
    const decoded=JSON.parse(Buffer.from(r.headers.get('payment-required'),'base64'));
    assert.equal(decoded.extensions.bazaar.info.input.queryParams.city,'Louisville');
    assert.equal((await r.text()),'{}');
  } finally {await new Promise(ok=>server.close(ok));}
});

test('body method derives schema-constrained POST input and retains description',()=>{
  const record=make({input:{type:'http',method:'POST',bodySchema:{type:'object',properties:{
    city:{type:'string',description:'Target city',examples:['Chicago']},days:{type:'integer',default:3},
  },required:['city'],additionalProperties:false}}});
  assert.equal(record.extensions.bazaar.info.input.bodyType,'json');
  assert.deepEqual(record.extensions.bazaar.info.input.body,{city:'Chicago',days:3});
  assert.equal(record.extensions.bazaar.schema.properties.input.properties.body.properties.city.description,'Target city');
});

test('MCP serializer uses toolName + schema without claiming live MCP tool attestation',()=>{
  const record=make({resource:{url:'https://weather.example/mcp'},input:{type:'mcp',toolName:'get_forecast',
    transport:'streamable-http',inputSchema:{type:'object',properties:{city:{type:'string',description:'City',default:'Louisville'}},required:['city']}}});
  assert.equal(record.extensions.bazaar.info.input.type,'mcp');
  assert.equal(record.extensions.bazaar.info.input.toolName,'get_forecast');
  assert.deepEqual(record.extensions.bazaar.info.input.example,{city:'Louisville'});
});

test('fail-closed unsafe metadata, mismatched field and secret header, or missing sample',()=>{
  assert.throws(()=>make({resource:{url:'http://evil.example/weather'}}),/HTTPS/);
  assert.throws(()=>make({accepts:[{...payment()[0],amount:'0'}]}),/atomic-unit/);
  assert.throws(()=>make({input:{type:'http',method:'GET',querySchema:{type:'object',properties:{city:{type:'string'}},required:['city']}}}),/required parameter/);
  assert.throws(()=>make({input:{type:'http',method:'GET',headers:{Authorization:'super-secret'}}}),/credentials/);
  assert.throws(()=>make({routeTemplate:'/weather/%2e%2e/evil'}),/Unsafe/);
  assert.throws(()=>make({resource:{url:'https://weather.example/forecast',iconUrl:'http://127.0.0.1/admin'}}),/Unsafe/);
});

test('catalog helper refuses unverified, mutated or mismatched echoes before invoking authority',()=>{
  const seller=make();const accepted=seller.accepts[0];let inserts=0;
  const payload={x402Version:2,resource:structuredClone(seller.resource),accepted:structuredClone(accepted),
    extensions:structuredClone(seller.extensions),payload:{authorization:'fixture'}};
  const settlement={status:'settled',sellerId:'seller-1',signer:'GTEST',origin:'https://weather.example',network:'stellar:testnet',scheme:'exact',asset:accepted.asset,amount:accepted.amount,payTo:accepted.payTo,
    receiptURL:'https://facilitator.example/receipts/local',receiptSha256:'a'.repeat(64),observedAt:'2026-10-10T02:00:00.000Z'};
  const catalog={ingest:arg=>{inserts++;assert.equal(arg.sequence,1);return {decision:'accepted',reason:'NEW_RESOURCE'};}};
  const query={seller,paymentPayload:payload,settlement,sequence:1,catalog};
  assert.equal(verifyCatalogAcceptance({...query,settlement:{...settlement,status:'verified'}}).reason,'SETTLEMENT_NOT_CONFIRMED');
  assert.equal(verifyCatalogAcceptance({...query,paymentPayload:{...payload,resource:{url:'https://evil.example'}}}).reason,'SELLER_RESOURCE_MISMATCH');
  assert.equal(verifyCatalogAcceptance({...query,paymentPayload:{...payload,extensions:{bazaar:{info:{input:{type:'http',method:'POST'}},schema:{}}}}}).reason,'DISCOVERY_ECHO_MISMATCH');
  assert.equal(verifyCatalogAcceptance({...query,paymentPayload:{...payload,accepted:{...accepted,payTo:'GOTHER'}}}).reason,'PAYMENT_REQUIREMENT_MISMATCH');
  assert.equal(inserts,0);
  assert.equal(verifyCatalogAcceptance(query).decision,'accepted');assert.equal(inserts,1);
});
