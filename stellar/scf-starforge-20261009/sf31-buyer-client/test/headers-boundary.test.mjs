// MIT. Focused SF31 regression: inspect normalized caller header entries BEFORE any request.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {X402BuyerClient, BuyerError} from '../buyer.mjs';

test('Headers/Map may not sneak payment credentials onto the unsigned request', async () => {
  let networkCalls=0, approvalCalls=0, signerCalls=0;
  const buyer=new X402BuyerClient({fetchImpl:async () => {
    networkCalls++;
    return new Response(null,{status:204});
  }});
  const call=headers=>buyer.call({
    url:'https://seller.example/protected',headers,
    approve:async()=>{approvalCalls++;return true;},
    sign:async()=>{signerCalls++;throw new Error('signer must not be reached');},
  });
  const attempts=[
    new Headers({'PAYMENT-SIGNATURE':'previously-signed-payload'}),
    new Headers({'authorization':'Bearer stray-secret'}),
    new Map([['Cookie','session=unapproved']]),
    new Map([['Proxy-Authorization','Basic stray-secret']]),
    {'Host':'bad.example'},
  ];
  for(const headers of attempts){
    await assert.rejects(call(headers),
      e=>e instanceof BuyerError && e.code==='FORBIDDEN_CALLER_HEADERS');
  }
  assert.equal(networkCalls,0,'not even an unsigned fetch may carry rejected headers');
  assert.equal(approvalCalls,0);
  assert.equal(signerCalls,0);

  const valid=await call(new Headers({'X-Trace-Id':'non-secret'}));
  assert.equal(valid.status,'NO_PAYMENT_REQUIRED');
  assert.equal(networkCalls,1,'ordinary Headers input still works');
  assert.equal(approvalCalls,0);
  assert.equal(signerCalls,0);
});

test('malformed header values fail closed before a network attempt',async()=>{
  let networkCalls=0;
  const buyer=new X402BuyerClient({fetchImpl:async()=>{networkCalls++;throw Error('should not fetch');}});
  await assert.rejects(
    buyer.call({
      url:'https://seller.example/protected',
      headers:{'X-Header':'illegal\r\nsecond: injected'},
      approve:async()=>true,
      sign:async()=>null,
    }),
    e=>e instanceof BuyerError && e.code==='BAD_CALLER_HEADERS');
  assert.equal(networkCalls,0);
});
