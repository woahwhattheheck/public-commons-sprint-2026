import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import http from 'node:http';
import net from 'node:net';
import vm from 'node:vm';

// Test-only root override permits the exact same regression on the prior source.
const root=process.env.CLAIMPROOF_TEST_ROOT?pathToFileURL(process.env.CLAIMPROOF_TEST_ROOT+'/'):new URL('../',import.meta.url);
const cart={currency:'USD',merchantTerms:'Digital delivery. Refunds available.',items:[{sku:'SEAT',name:'Workshop seat',quantity:1,unit_price:'19.99'}]};
const mock=`
let status='APPROVED',lost=false,creates=0,captures=0,auth=0;
const id='ORDER123456789',amount={currency_code:'USD',value:'19.99'};
const reply=data=>({ok:true,status:200,json:async()=>data});
globalThis.fetch=async(url,options={})=>{
  if(!String(url).startsWith('https://api-m.sandbox.paypal.com/'))throw Error('unexpected external request');
  if(url.endsWith('/token')){auth++;return reply({access_token:'synthetic-only',expires_in:300})}
  if(url.endsWith('/capture')){captures++;if(lost)throw Error('synthetic lost response');status='COMPLETED';return reply({id,status:'COMPLETED'})}
  if(options.method==='POST'){creates++;return reply({id,status:'CREATED',links:[{rel:'approve',href:'https://www.sandbox.paypal.com/checkoutnow?token='+id}]})}
  const unit={amount};
  if(!['APPROVED','CREATED','VOIDED'].includes(status))unit.payments={captures:[{id:'CAPTURE123456',status,amount}]};
  return reply({id,intent:'CAPTURE',status:unit.payments?'COMPLETED':status,purchase_units:[unit]});
};
process.on('message',message=>{
  if(message.status)status=message.status;
  if(typeof message.lost==='boolean')lost=message.lost;
  process.send({creates,captures,auth});
});`;
async function start(t){
  const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=fork(new URL('src/server.mjs',root),[],{execArgv:['--import','data:text/javascript;base64,'+Buffer.from(mock).toString('base64')],
    env:{PATH:process.env.PATH,PORT:String(port),PAYPAL_CLIENT_ID:'fixture-only',PAYPAL_CLIENT_SECRET:'fixture-only'},stdio:['ignore','pipe','pipe','ipc']});
  t.after(async()=>{if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit}});
  let error='';child.stderr.on('data',x=>error+=x);
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error(error||'server exited')})]);
  const control=async(value={})=>{const response=once(child,'message');child.send(value);return (await response)[0]};
  const call=(route,data)=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:'/api/'+route,method:'POST',headers:{'Content-Type':'application/json'}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
    });req.on('error',reject);req.end(JSON.stringify(data));
  });
  const reviewed=await call('review',cart);assert.equal(reviewed.status,200);
  const request={review_id:reviewed.body.review_id,fingerprint:reviewed.body.cart.fingerprint,confirm:true};
  assert.equal((await call('create',request)).status,200);
  return {control,call,request};
}

test('lost capture outcome stays read-only across stale APPROVED reads and later settlement',{timeout:8000},async t=>{
  const {control,call,request}=await start(t);
  assert.equal((await call('capture',{...request,confirm:false})).status,400);
  await control({lost:true});
  const uncertain=await call('capture',request);
  assert.equal(uncertain.status,202);assert.equal(uncertain.body.state,'CAPTURE_UNKNOWN');
  const stale=await call('status',{...request,confirm:undefined});
  assert.equal(stale.status,202);assert.equal(stale.body.state,'CAPTURE_UNKNOWN');
  const retry=await call('capture',request);assert.equal(retry.body.state,'CAPTURE_UNKNOWN');
  assert.equal((await control()).captures,1);
  await control({status:'COMPLETED'});
  assert.equal((await call('status',request)).body.state,'CAPTURED');
  assert.deepEqual(await control(),{creates:1,captures:1,auth:1});
});

test('declined, refunded and voided records reconcile without payment writes or false settlement',{timeout:8000},async t=>{
  const {control,call,request}=await start(t);
  for(const status of ['DECLINED','DENIED','FAILED']){
    await control({status});
    const result=await call('status',request);assert.equal(result.status,200);assert.equal(result.body.state,'CAPTURE_FAILED');
    assert.equal((await call('capture',request)).body.state,'CAPTURE_FAILED');
  }
  await control({status:'COMPLETED'});assert.equal((await call('status',request)).body.state,'CAPTURED');
  for(const status of ['PARTIALLY_REFUNDED','REFUNDED']){
    await control({status});
    const result=await call('status',request);assert.equal(result.status,200);assert.equal(result.body.state,'CAPTURE_REVERSED');
  }
  await control({status:'COMPLETED'});assert.equal((await call('status',request)).status,400);
  // A new review for a voided order must also remain read-only.
  const review=(await call('review',cart)).body;
  const other={review_id:review.review_id,fingerprint:review.cart.fingerprint,confirm:true};
  await call('create',other);await control({status:'VOIDED'});
  assert.equal((await call('status',other)).body.state,'ORDER_VOIDED');
  assert.equal((await call('capture',other)).body.state,'ORDER_VOIDED');
  assert.equal((await control()).captures,0);
});

test('UI disables capture for uncertain/terminal states and retains the read-only status control',async()=>{
  const html=await readFile(new URL('src/index.html',root),'utf8');
  const functions=html.slice(html.indexOf('function syncCheckoutControls()'),html.indexOf('function clearCheckout()'));
  const nodes=new Map();const el=id=>{if(!nodes.has(id))nodes.set(id,{checked:true});return nodes.get(id)};
  const hidden=new Map();const ctx={el,hide:(id,value)=>hidden.set(id,value),say(){},checkoutBusy:false,current:{state:'ORDER_CREATED'},order:{order_id:'ORDER123456789'}};
  vm.createContext(ctx);vm.runInContext(functions,ctx);
  for(const state of ['CAPTURE_UNKNOWN','CAPTURE_FAILED','CAPTURE_REVERSED','ORDER_VOIDED']){
    ctx.showCaptureResult({state,order_id:ctx.order.order_id,capture_status:'fixture'});
    el('consent-capture').checked=true;ctx.syncCheckoutControls();
    assert.equal(el('capture').disabled,true,state);assert.equal(el('check-payment').disabled,false,state);
    assert.equal(hidden.get('approval-area'),true,state);
  }
  ctx.showCaptureResult({state:'CAPTURE_UNKNOWN',order_id:ctx.order.order_id});
  assert.match(el('payment-result').textContent,/read-only status check/);
});
