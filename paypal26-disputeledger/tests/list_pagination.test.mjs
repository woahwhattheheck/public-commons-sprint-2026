import test from 'node:test';
import assert from 'node:assert/strict';
import {PayPalDisputes} from '../src/paypal.mjs';

const id=n=>'PP-D-'+String(n).padStart(8,'0');
const item=n=>({dispute_id:id(n),status:'WAITING_FOR_SELLER_RESPONSE',reason:'CREDIT_NOT_PROCESSED'});
const next=cursor=>[{rel:'next',method:'GET',href:'https://api-m.sandbox.paypal.com/v1/customer/disputes?page_size=10&next_page_token='+encodeURIComponent(cursor)}];
const ok=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
function client(pageFn){
  const paths=[];
  const transport=async(url,init)=>{
    const u=new URL(url);
    assert.equal(u.origin,'https://api-m.sandbox.paypal.com');
    if(u.pathname==='/v1/oauth2/token'){
      assert.equal(init.method,'POST');return ok({access_token:'fixture-token',expires_in:3600});
    }
    assert.equal(init.method,'GET');
    paths.push(u.pathname+u.search);
    return ok(await pageFn(u));
  };
  return {paypal:new PayPalDisputes({id:'fixture-id',secret:'fixture-secret',transport}),paths};
}
test('three genuine API pages by cursor retain all 23 unique case IDs',async()=>{
  const {paypal,paths}=client(u=>{
    const cursor=u.searchParams.get('next_page_token');
    return cursor==='p2'?{items:Array.from({length:10},(_,i)=>item(i+10)),links:next('p3')}:
      cursor==='p3'?{items:[item(20),item(21),item(22)],links:[]}:
      {items:Array.from({length:10},(_,i)=>item(i)),links:next('p2')};
  });
  const result=await paypal.list();
  assert.equal(result.items.length,23);
  assert.equal(result.items[22].dispute_id,id(22));
  assert.equal(result.pages_read,3);
  assert.equal(result.incomplete,false);
  assert.deepEqual(paths,[
    '/v1/customer/disputes?page_size=10',
    '/v1/customer/disputes?page_size=10&next_page_token=p2',
    '/v1/customer/disputes?page_size=10&next_page_token=p3']);
});
test('legacy one-page response remains complete',async()=>{
  const {paypal,paths}=client(()=>({items:[item(1)],links:[]}));
  assert.deepEqual((await paypal.list()).items,[item(1)]);
  assert.equal(paths.length,1);
});
test('80-case review-store cap returns explicitly incomplete',async()=>{
  const {paypal,paths}=client(u=>{
    const n=Number(u.searchParams.get('next_page_token')||0);
    return {items:Array.from({length:10},(_,i)=>item(n*10+i)),links:next(String(n+1))};
  });
  const result=await paypal.list();
  assert.equal(result.items.length,80);
  assert.equal(result.pages_read,8);
  assert.equal(result.incomplete,true);
  assert.equal(paths.length,8);
});
test('duplicate IDs and loops reject the entire changing list',async()=>{
  const dup=client(u=>u.searchParams.has('next_page_token')?
    {items:[item(9)]}:{items:Array.from({length:10},(_,i)=>item(i)),links:next('p2')});
  await assert.rejects(dup.paypal.list(),/repeated an ID/);
  const loop=client(u=>u.searchParams.has('next_page_token')?
    {items:[item(10)],links:next('p2')}:{items:[item(9)],links:next('p2')});
  await assert.rejects(loop.paypal.list(),/cursor repeated/);
});
test('invalid pagination shape, oversized page and untrusted URLs reject',async()=>{
  for(const batch of [
    {items:null},
    {items:Array.from({length:11},(_,i)=>item(i))},
    {items:[{dispute_id:'bad'}]},
    {items:[item(0)],links:{}},
    {items:[item(0)],links:[{rel:'next',href:'https://example.com/v1/customer/disputes?page_size=10&next_page_token=xx'}]},
    {items:[item(0)],links:[{rel:'next',href:'https://api-m.sandbox.paypal.com/v1/customer/disputes?page_size=10&next_page_token=p&scope=admin'}]},
    {items:[item(0)],links:[{rel:'next',href:'https://api-m.sandbox.paypal.com/v1/customer/disputes?page_size=11&next_page_token=p'}]},
    {items:[item(0)],links:next('p').concat(next('q'))},
  ]){
    const {paypal}=client(()=>batch);
    await assert.rejects(paypal.list());
  }
});
test('provider GET failure rejects and cannot show a partial list',async()=>{
  const {paypal}=client(u=>{
    if(u.searchParams.has('next_page_token'))throw Error('provider 503');
    return {items:[item(1)],links:next('p2')};
  });
  await assert.rejects(paypal.list(),/provider 503/);
});
