import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BazaarCatalog,createDiscoveryServer } from '../../scf46-stellar-bazaar/src/catalog.mjs';
import { McpPaidToolBroker,createMcpHttpHandler,MCP_VERSION } from './agent-server.mjs';
import { mcpAgentCommerceTool } from '../../stellar/scf-starforge-20261009/sf43-agent-commerce/mcp-buyer-acceptance.mjs';

const schema={type:'object',properties:{input:{type:'object'}},required:['input']};
const accepted={scheme:'exact',network:'stellar:testnet',amount:'17000',asset:'USDC:TEST',payTo:'GSELLER'};
const openServer=async handler=>{const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,url:`http://127.0.0.1:${server.address().port}`};};
const close=async ({server})=>new Promise(resolve=>server.close(resolve));
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64');

async function fixture({mismatch=false,settlementResponse={}}={}){
  let probes=0,signed=0,signatures=[];
  const provider=await openServer((req,res)=>{
    if(!req.url.startsWith('/weather')){res.writeHead(404);res.end();return;}
    if(!req.headers['payment-signature']){
      probes++;
      const charge=mismatch?{...accepted,amount:'18000'}:accepted;
      const r={x402Version:2,resource:{url:provider.url+'/weather'},accepts:[charge],extensions:{}};
      res.writeHead(402,{'PAYMENT-REQUIRED':b64(r),'content-type':'application/json'});
      res.end('{}');return;
    }
    signed++;
    signatures.push(JSON.parse(Buffer.from(req.headers['payment-signature'],'base64').toString('utf8')));
    const receipt={success:true,network:'stellar:testnet',transaction:'a'.repeat(64),...settlementResponse};
    res.writeHead(200,{'PAYMENT-RESPONSE':b64(receipt),'content-type':'application/json'});
    res.end(JSON.stringify({forecast:'rain',provenance:'loopback fixture'}));
  });
  const catalog=new BazaarCatalog();
  catalog.insertValidated({resource:{url:provider.url+'/weather',description:'Weather forecast observation'},
    accepts:[accepted],extensions:{bazaar:{info:{input:{type:'http',method:'GET',queryParams:{city:'Paris'},description:'Weather forecast'}},schema}}});
  const discovery=await openServer(createDiscoveryServer(catalog));
  return {provider,discovery,get probes(){return probes;},get signed(){return signed;},signatures,
    async cleanup(){await close(discovery);await close(provider);}};
}

const brokerFor=(fixture,options={})=>new McpPaidToolBroker({
  discoveryUrl:fixture.discovery.url,allowedResourceOrigins:[fixture.provider.url],
  signPayment:async({resource,accepted})=>({x402Version:2,resource,accepted,payload:{transaction:'SIGNED_TEST_FIXTURE_NO_STELLAR_TX'}}),
  ...options,
});

test('actual PR451 catalog GET/search and safe approval→canonical 402→signed header→receipt, one attempt',async()=>{
  const f=await fixture();let allow=false;let approvals=0;
  try{
    const broker=brokerFor(f,{approve:async ({requestUrl,accepted:a})=>{approvals++;assert.equal(new URL(requestUrl).searchParams.get('city'),'Paris');assert.equal(a.amount,'17000');return allow;}});
    const result=await broker.call('bazaar_search',{query:'weather'});
    assert.equal(result.resources.length,1);
    assert.equal(result.resources[0].allowedOrigin,true);
    const quote=await broker.call('bazaar_preview',{handle:result.resources[0].handle,input:{query:{city:'Paris'}}});
    assert.equal(quote.status,'PREVIEWED');assert.equal(f.probes,0);
    await assert.rejects(()=>broker.call('bazaar_execute_approved',{quoteId:quote.quoteId}),/independently denied/);
    assert.equal(f.probes,0);assert.equal(f.signed,0);
    allow=true;
    const done=await broker.call('bazaar_execute_approved',{quoteId:quote.quoteId});
    assert.equal(done.status,'CONFIRMED_BY_SERVER');assert.equal(done.attempts,1);
    assert.equal(done.result.paymentResponse.transaction,'a'.repeat(64));
    assert.equal(JSON.parse(done.result.content.body).forecast,'rain');
    assert.equal(f.probes,1);assert.equal(f.signed,1);assert.equal(approvals,2);
    assert.equal(f.signatures[0].x402Version,2);
    assert.equal(f.signatures[0].accepted.amount,'17000');
    assert.equal((await broker.call('bazaar_execute_approved',{quoteId:quote.quoteId})).status,'CONFIRMED_BY_SERVER');
    assert.equal(f.probes,1);assert.equal(f.signed,1); // replay-safe
  }finally{await f.cleanup();}
});

test('changed quoted terms reject before signer and never dispatch signed payment',async()=>{
  const f=await fixture({mismatch:true});let signCalls=0;
  try{
    const broker=brokerFor(f,{approve:()=>true,signPayment:async()=>{signCalls++;return {}}});
    const found=await broker.search({query:'weather'});
    const quote=broker.preview({handle:found.resources[0].handle});
    const result=await broker.execute({quoteId:quote.quoteId});
    assert.equal(result.status,'REJECTED');assert.equal(result.failure,'CHALLENGE_MISMATCH');
    assert.equal(signCalls,0);assert.equal(f.probes,1);assert.equal(f.signed,0);
  }finally{await f.cleanup();}
});

test('preview input and URL provenance fences; cancel prevents all outbound requests',async()=>{
  const f=await fixture();
  try{
    const disallowed=new McpPaidToolBroker({discoveryUrl:f.discovery.url});
    const untrusted=await disallowed.search({query:'weather'});
    assert.throws(()=>disallowed.preview({handle:untrusted.resources[0].handle}),/not approved/);
    const broker=brokerFor(f,{approve:()=>true});
    const rows=await broker.search({query:'weather'});
    assert.throws(()=>broker.preview({handle:rows.resources[0].handle,input:{query:{unknown:'secret'}}}),/advertised/);
    const quote=broker.preview({handle:rows.resources[0].handle,input:{query:{city:'Paris'}}});
    assert.equal(broker.cancel({quoteId:quote.quoteId}).status,'CANCELLED');
    assert.equal((await broker.execute({quoteId:quote.quoteId})).status,'CANCELLED');
    assert.equal(f.probes,0);assert.equal(f.signed,0);
  }finally{await f.cleanup();}
});

test('MCP Streamable HTTP single-response: initialize, tools/list, tools/call, status and auth fences',async()=>{
  const f=await fixture();let mcp;
  try{
    const token='this-is-an-operator-owned-token-for-local-check';
    const broker=brokerFor(f,{approve:()=>false});
    mcp=await openServer(createMcpHttpHandler(broker,{bearerToken:token,allowedClientOrigins:['https://operator.example']}));
    const call=async(method,params={},headers={})=>fetch(mcp.url,{method:'POST',
      headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream',
        'mcp-protocol-version':MCP_VERSION,...headers},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const init=await call('initialize',{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:'test',version:'1'}});
    assert.equal(init.status,200);assert.equal((await init.json()).result.protocolVersion,MCP_VERSION);
    const listed=await call('tools/list');const parsed=await listed.json();
    assert.ok(parsed.result.tools.some(t=>t.name==='bazaar_execute_approved'));
    const names=parsed.result.tools.map(t=>t.name);
    assert.equal(new Set(names).size,names.length);
    assert.deepEqual(parsed.result.tools.find(t=>t.name===mcpAgentCommerceTool.name),mcpAgentCommerceTool);
    const unavailable=await call('tools/call',{name:mcpAgentCommerceTool.name,arguments:{
      search:'weather',targetResourceURL:f.provider.url+'/weather',maxAtomic:'17000'}});
    const unavailableBody=await unavailable.json();
    assert.equal(unavailableBody.result.isError,true);
    assert.equal(unavailableBody.result.structuredContent.code,'AGENT_COMMERCE_UNAVAILABLE');
    const searched=await call('tools/call',{name:'bazaar_search',arguments:{query:'weather'}});
    assert.equal((await searched.json()).result.structuredContent.resources.length,1);
    const disallowedOrigin=await call('tools/list',{}, {origin:'https://attacker.example'});
    assert.equal(disallowedOrigin.status,403);
    const wrong=await fetch(mcp.url,{method:'POST',headers:{accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:4,method:'tools/list'})});
    assert.equal(wrong.status,401);
    const get=await fetch(mcp.url,{method:'GET',headers:{authorization:'Bearer '+token}});assert.equal(get.status,405);
    assert.equal(f.probes,0);assert.equal(f.signed,0);
  }finally{if(mcp)await close(mcp);await f.cleanup();}
});

test('SF43 tool dispatches only through an explicitly injected adapter',async()=>{
  const args={search:'weather',targetResourceURL:'https://seller.example/weather',
    targetMethod:'GET',maxAtomic:'17000'};
  let received=null;
  const broker=new McpPaidToolBroker({discoveryUrl:'https://catalog.example',
    agentCommerce:async input=>{received=input;return {decision:'NOT_AUTHORIZED',reason:'FOCUSED_ADAPTER'};}});
  const result=await broker.call(mcpAgentCommerceTool.name,args);
  assert.deepEqual(received,args);
  assert.deepEqual(result,{decision:'NOT_AUTHORIZED',reason:'FOCUSED_ADAPTER'});
  assert.throws(()=>new McpPaidToolBroker({discoveryUrl:'https://catalog.example',agentCommerce:{}}),
    /Invalid SF43 agent-commerce adapter/);
});

test('seller success with wrong network or missing/malformed Stellar hash stays INDETERMINATE',async()=>{
  for(const settlementResponse of [
    {network:'stellar:pubnet'}, {network:null}, {transaction:''},
    {transaction:'not-a-stellar-transaction-hash'},
  ]){
    const f=await fixture({settlementResponse});
    try{
      const broker=brokerFor(f,{approve:()=>true});
      const found=await broker.search({query:'weather'});
      const quote=broker.preview({handle:found.resources[0].handle});
      const result=await broker.execute({quoteId:quote.quoteId});
      assert.equal(result.status,'INDETERMINATE');
      assert.equal(result.attempts,1);
      assert.equal(result.result.paymentResponse.success,true); // not trusted
      assert.match(result.failure,/reconciliation/);
      assert.equal(f.probes,1);assert.equal(f.signed,1);
      assert.equal((await broker.execute({quoteId:quote.quoteId})).status,'INDETERMINATE');
      assert.equal(f.signed,1); // no second potentially costly signed request
    }finally{await f.cleanup();}
  }
});

test('signed-retry provider loss remains INDETERMINATE and cannot auto-charge again',async()=>{
  const f=await fixture();let calls=0;
  try{
    const fetchImpl=async(url,opts)=>{
      if(String(url).startsWith(f.provider.url)&&opts.headers?.['PAYMENT-SIGNATURE']){calls++;throw Error('transport lost after send');}
      return fetch(url,opts);
    };
    const broker=brokerFor(f,{approve:()=>true,fetchImpl});
    const found=await broker.search({query:'weather'});
    const q=broker.preview({handle:found.resources[0].handle});
    const first=await broker.execute({quoteId:q.quoteId});
    assert.equal(first.status,'INDETERMINATE');assert.equal(first.attempts,1);
    assert.equal((await broker.execute({quoteId:q.quoteId})).status,'INDETERMINATE');
    assert.equal(calls,1);assert.equal(f.probes,1);
  }finally{await f.cleanup();}
});

test('agent hard-filters payment tuples for asset, network and integer maxAmount, independent of Bazaar upstream',async()=>{
  const f=await fixture();try{
    const broker=brokerFor(f);
    assert.equal((await broker.search({query:'weather',asset:'NOT_USDC'})).resources.length,0);
    assert.equal((await broker.search({query:'weather',network:'stellar:pubnet'})).resources.length,0);
    assert.equal((await broker.search({query:'weather',maxAmount:'16999'})).resources.length,0);
    assert.equal((await broker.search({query:'weather',maxAmount:'17000'})).resources.length,1);
    await assert.rejects(()=>broker.search({query:'weather',maxAmount:'3e20'}),/maxAmount/);
  }finally{await f.cleanup();}
});
