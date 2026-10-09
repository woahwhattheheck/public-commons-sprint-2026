import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fetchBatch} from './paypal.mjs';

const oldCredentials=[process.env.PAYPAL_CLIENT_ID,process.env.PAYPAL_CLIENT_SECRET];
process.env.PAYPAL_CLIENT_ID='offline-fixture-client';
process.env.PAYPAL_CLIENT_SECRET='offline-fixture-secret';

async function withSandbox(pages,check){
  const prior=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url,options)=>{
    const parsed=new URL(url);
    assert.equal(parsed.origin,'https://api-m.sandbox.paypal.com');
    assert.equal(options.redirect,'error');
    if(parsed.pathname==='/v1/oauth2/token'){
      assert.equal(options.method,'POST');
      return Response.json({access_token:'fixture-token'});
    }
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer fixture-token');
    assert.equal(parsed.searchParams.get('total_required'),'true');
    const page=Number(parsed.searchParams.get('page'));
    calls.push(page);
    const payload=pages[page-1];
    assert.ok(payload,`unexpected page ${page}`);
    return Response.json({batch_header:{payout_batch_id:'DEMO123'},...payload});
  };
  try{await check(calls);}finally{globalThis.fetch=prior;}
}

const item=id=>({payout_item_id:id,transaction_status:'SUCCESS'});

test('stable two-page batch returns both pages exactly once',async()=>{
  await withSandbox([
    {total_pages:2,items:[item('P1'),item('P2')]},
    {total_pages:2,items:[item('P3')]}
  ],async calls=>{
    const result=await fetchBatch('DEMO123');
    assert.equal(result.length,2);
    assert.deepEqual(calls,[1,2]);
  });
});

test('a shrinking live page count refuses incomplete batch',async()=>{
  await withSandbox([{total_pages:3,items:[item('P1')]},{total_pages:2,items:[item('P2')]}],async calls=>{
    await assert.rejects(fetchBatch('DEMO123'),/pagination changed/);
    assert.deepEqual(calls,[1,2]);
  });
});

test('a growing page count refuses inconsistent batch',async()=>{
  await withSandbox([{total_pages:2,items:[item('P1')]},{total_pages:3,items:[item('P2')]}],async calls=>{
    await assert.rejects(fetchBatch('DEMO123'),/pagination changed/);
    assert.deepEqual(calls,[1,2]);
  });
});

test('duplicate payout item across pages refuses double counting',async()=>{
  await withSandbox([{total_pages:2,items:[item('P1')]},{total_pages:2,items:[item('P1')]}],async calls=>{
    await assert.rejects(fetchBatch('DEMO123'),/repeated during pagination/);
    assert.deepEqual(calls,[1,2]);
  });
});

test('legacy one-page fixture without total_pages is preserved',async()=>{
  await withSandbox([{items:[]}],async calls=>{
    assert.equal((await fetchBatch('DEMO123')).length,1);
    assert.deepEqual(calls,[1]);
  });
});

process.on('exit',()=>{
  if(oldCredentials[0]===undefined)delete process.env.PAYPAL_CLIENT_ID;
  else process.env.PAYPAL_CLIENT_ID=oldCredentials[0];
  if(oldCredentials[1]===undefined)delete process.env.PAYPAL_CLIENT_SECRET;
  else process.env.PAYPAL_CLIENT_SECRET=oldCredentials[1];
});
