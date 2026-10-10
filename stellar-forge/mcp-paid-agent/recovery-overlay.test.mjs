import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { McpPaidToolBroker, createMcpHttpHandler, MCP_VERSION } from './agent-server.mjs';
import { VERSION, gateNextAction } from '../../stellar/scf-starforge-20261009/sf33-failure-contract/contract.mjs';

// One focused boundary regression. Pure in-memory HTTP responses; no signer,
// Stellar network, public service, payment, or hosted Actions are contacted.
test('SF33 recovery diagnostics preserve MCP error shape and prevent indeterminate paid replay', async () => {
  const resource = 'https://merchant.example/protected';
  const accepted = {scheme:'exact',network:'stellar:testnet',asset:'USDC:TEST',amount:'17000',payTo:'GSELLER'};
  const required = {x402Version:2,resource:{url:resource},accepts:[accepted]};
  let signedAttempts = 0;
  const fetchImpl = async (url,options={}) => {
    if (String(url).startsWith('https://catalog.example/')) {
      return new Response(JSON.stringify({resources:[{resource:{url:resource},
        extensions:{bazaar:{info:{input:{type:'http',method:'GET'}}}},
        accepts:[accepted]}]}),{status:200,headers:{'content-type':'application/json'}});
    }
    if (String(url) !== resource) throw Error('unadvertised transport target');
    if (options.headers?.['PAYMENT-SIGNATURE']) {
      signedAttempts++;
      throw Error('injected signed transport loss');
    }
    return new Response('',{status:402,headers:{'PAYMENT-REQUIRED':
      Buffer.from(JSON.stringify(required)).toString('base64')}});
  };
  const broker = new McpPaidToolBroker({discoveryUrl:'https://catalog.example',
    allowedResourceOrigins:['https://merchant.example'],approve:()=>true,
    signPayment:async ({resource:challengeResource,accepted:terms})=>({
      x402Version:2,resource:challengeResource,accepted:terms,payload:{fixture:true}
    }),fetchImpl});
  const result = await broker.search({query:'paid'});
  assert.equal(result.resources.length,1);
  const quote = broker.preview({handle:result.resources[0].handle});
  const first = await broker.execute({quoteId:quote.quoteId});
  assert.equal(first.status,'INDETERMINATE');
  assert.equal(first.recovery.version,VERSION);
  assert.equal(first.recovery.stage,'settle');
  assert.equal(first.recovery.traceId,quote.quoteId);
  assert.equal(first.recovery.recoveryAction,'reconcile_settlement');
  assert.equal(first.recovery.safeToAutoRetry,false);
  assert.equal(first.recovery.settlementMayBePending,true);
  assert.equal(gateNextAction(first.recovery).maySubmitPayment,false);
  assert.equal((await broker.execute({quoteId:quote.quoteId})).status,'INDETERMINATE');
  assert.equal(signedAttempts,1);

  const token='focused-local-operator-token-not-real-credential';
  const server=createServer(createMcpHttpHandler(broker,{bearerToken:token}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const response=await fetch('http://127.0.0.1:'+server.address().port,{
      method:'POST',
      headers:{authorization:'Bearer '+token,'content-type':'application/json',
        accept:'application/json, text/event-stream','mcp-protocol-version':MCP_VERSION},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
        params:{name:'missing-tool',arguments:{}}})
    });
    const body=await response.json();
    assert.equal(body.result.isError,true);
    assert.equal(body.result.structuredContent.code,'TOOL_NOT_FOUND');
    assert.equal(body.result.structuredContent.recovery.code,'mcp_tool_missing');
    assert.equal(body.result.structuredContent.recovery.recoveryAction,'stop');
    assert.equal(body.result.structuredContent.recovery.safeToAutoRetry,false);
  } finally {
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});
