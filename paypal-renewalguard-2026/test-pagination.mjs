import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSubscriptionPages,makeServer} from './src/server.mjs';

const row=n=>({id:'I-'+String(n).padStart(6,'0'),status:'ACTIVE',plan_id:'P-SANDBOX'});
const link=page=>[{rel:'next',method:'GET',href:
  'https://api-m.sandbox.paypal.com/v1/billing/subscriptions?page='+page+'&page_size=20'}];

test('45 entries across three pages, including a partial final page', async()=>{
  const pages=[Array.from({length:20},(_,i)=>row(i)),
    Array.from({length:20},(_,i)=>row(i+20)),
    Array.from({length:5},(_,i)=>row(i+40))],calls=[];
  const result=await collectSubscriptionPages(async page=>{
    calls.push(page);return {subscriptions:pages[page-1],links:page<3?link(page+1):[]};
  });
  assert.deepEqual(calls,[1,2,3]);
  assert.equal(result.items.length,45);
  assert.equal(result.items[44].id,row(44).id);
  assert.equal(result.incomplete,false);
});

test('a full page missing a next link is not automatically complete', async()=>{
  const calls=[],result=await collectSubscriptionPages(async page=>{
    calls.push(page);return {subscriptions:page===1?Array.from({length:20},(_,i)=>row(i)):[]};
  });
  assert.deepEqual(calls,[1,2]);
  assert.equal(result.items.length,20);
  assert.equal(result.incomplete,false);
});

test('page cap signals incomplete merchant coverage',async()=>{
  const result=await collectSubscriptionPages(async page=>({
    subscriptions:Array.from({length:20},(_,i)=>row(20*(page-1)+i)),
    links:link(page+1),
  }),3);
  assert.equal(result.items.length,60);
  assert.equal(result.pages_read,3);
  assert.equal(result.incomplete,true);
});

test('duplicates, bad IDs, bad shapes, and untrusted links do not return partial results',async()=>{
  await assert.rejects(collectSubscriptionPages(async page=>({
    subscriptions:page===1?Array.from({length:20},(_,i)=>row(i)):[row(19)],
    links:page===1?link(2):[],
  })),/duplicate subscription/);
  for(const batch of [
    {subscriptions:[{id:'BAD'}]},
    {subscriptions:Array.from({length:21},(_,i)=>row(i))},
    {subscriptions:null},
    {subscriptions:[],links:{}},
    {subscriptions:[row(1)],links:[{rel:'next',href:'https://outside.invalid/?page=2'}]},
    {subscriptions:[row(1)],links:link(3)},
    {subscriptions:[row(1)],links:[{...link(2)[0],method:'POST'}]},
  ]) await assert.rejects(collectSubscriptionPages(async()=>batch));
});

test('provider failure aborts the list, and demo endpoint retains a valid shape',async()=>{
  await assert.rejects(collectSubscriptionPages(async page=>{
    if(page===2)throw Error('sandbox 503');
    return {subscriptions:Array.from({length:20},(_,i)=>row(i))};
  }),/sandbox 503/);
  const server=makeServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/list?mode=demo');
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.items.length,3);
    assert.equal(body.pages_read,1);
    assert.equal(body.incomplete,false);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
