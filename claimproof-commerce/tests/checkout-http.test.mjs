import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import vm from 'node:vm';
const raw={currency:'USD',merchantTerms:'Digital delivery. Refunds available.',items:[{sku:'SEAT',name:'Workshop seat',quantity:1,unit_price:'19.99'}]};

test('actual loopback HTTP review/create/capture/status keeps consent and reconciles pending without recapture',{timeout:8000},async()=>{
  const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=fork(new URL('../src/server.mjs',import.meta.url),[],{
    execArgv:['--import',new URL('./fixtures/paypal-sandbox-mock.mjs',import.meta.url).href],
    env:{PATH:process.env.PATH,PORT:String(port),PAYPAL_CLIENT_ID:'fixture-only',PAYPAL_CLIENT_SECRET:'fixture-only'},
    stdio:['ignore','pipe','pipe','ipc']
  });
  let stderr='';child.stderr.on('data',x=>stderr+=x);
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('child exited: '+stderr)})]);
    function call(route,data,origin){return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port,path:route,method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})}},res=>{
        let body='';res.setEncoding('utf8');res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body:route==='/'?body:JSON.parse(body)}));
      });req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data));
    })}
    const page=await call('/');assert.equal(page.status,200);assert.match(page.body,/Check sandbox status \(read only\)/);
    new vm.Script(page.body.split('<script>')[1].split('</script>')[0]);
    const review=(await call('/api/review',raw)).body;
    const request={review_id:review.review_id,fingerprint:review.cart.fingerprint,confirm:true};
    assert.equal((await call('/api/create',{...request,confirm:false})).status,400);
    assert.equal((await call('/api/create',request,'https://other.example')).status,400);
    const orders=await Promise.all(Array.from({length:4},()=>call('/api/create',request)));
    assert.ok(orders.every(x=>x.status===200&&x.body.order.order_id==='ORDER123456789'));
    const captures=await Promise.all(Array.from({length:4},()=>call('/api/capture',request)));
    assert.ok(captures.every(x=>x.status===202&&x.body.state==='CAPTURE_PENDING'));
    assert.equal((await call('/api/status',{...request,fingerprint:'wrong'})).status,400);
    const reconciled=await call('/api/status',{review_id:request.review_id,fingerprint:request.fingerprint});
    assert.equal(reconciled.status,200);assert.equal(reconciled.body.state,'CAPTURED');
    assert.equal(reconciled.body.capture_status,'COMPLETED');
    const stats=once(child,'message');child.send('stats');
    assert.deepEqual((await stats)[0],{creates:1,captures:1,auth:1});
  }finally{child.kill('SIGTERM');await once(child,'exit')}
});

test('status UI sends no confirmation or capture, and ignores an edited-cart response',async()=>{
  const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
  const handler=html.slice(html.indexOf("el('check-status').onclick="),html.indexOf('</script>'));
  const nodes=new Map();const el=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)};
  let requests=[],release;
  const ctx={el,say(){},current:{review_id:'local-review',cart:{fingerprint:'fixed'}},order:{order_id:'ORDER123456789'},editRevision:0,
    api:async(route,body)=>{requests.push({route,body});return {order_id:'ORDER123456789',state:'CAPTURE_PENDING',capture_status:'PENDING'}}};
  vm.createContext(ctx);vm.runInContext(handler,ctx);
  await el('check-status').onclick();
  assert.equal(requests[0].route,'status');assert.equal(requests[0].body.confirm,undefined);
  assert.equal(ctx.current.state,'CAPTURE_PENDING');assert.equal(el('capture').disabled,true);
  ctx.api=()=>new Promise(resolve=>{release=resolve});
  const pending=el('check-status').onclick();ctx.editRevision++;ctx.current=null;
  const before=el('payment-result').textContent;
  release({order_id:'ORDER123456789',state:'CAPTURED',capture_status:'COMPLETED'});await pending;
  assert.equal(el('payment-result').textContent,before);
});
