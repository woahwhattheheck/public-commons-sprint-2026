#!/usr/bin/env node
'use strict';
// Actual loopback HTTP requests to the unmodified production entrypoint; no CDN/PayPal requests.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const http=require('node:http');
const net=require('node:net');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
function request(port,target,method='GET'){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:target,method},res=>{
      let body='';res.setEncoding('utf8');res.on('data',part=>body+=part);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
    });
    req.setTimeout(3000,()=>req.destroy(new Error('loopback request timed out')));
    req.on('error',reject);req.end();
  });
}
(async()=>{
  const lease=net.createServer();
  await new Promise((resolve,reject)=>{lease.once('error',reject);lease.listen(0,'127.0.0.1',resolve);});
  const port=lease.address().port;await new Promise(resolve=>lease.close(resolve));
  const child=spawn(process.execPath,['src/caseboard.mjs'],{cwd:root,env:{...process.env,CLAIMPROOF_BOARD_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',part=>stderr+=part);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('server startup timeout: '+stderr)),4000);
      child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('server exited before readiness: '+code+' '+stderr));});
    });
    const page=await request(port,'/');assert.equal(page.status,200);
    assert.match(page.body,/importEpoch/);assert.match(page.headers['content-security-policy'],/connect-src 'none'/);
    assert.equal((await request(port,'/','POST')).status,404);
    console.log('PASS actual localhost GET / and read-only route / CSP behavior');
    const invalid=await request(port,'//[');assert.equal(invalid.status,400);
    assert.equal(JSON.parse(invalid.body).error,'invalid request URL');
    const health=await request(port,'/health');assert.equal(health.status,200);
    assert.equal(JSON.parse(health.body).paypal_mutations,false);
    assert.equal(child.exitCode,null);
    console.log('PASS malformed URL returns 400; same process remains healthy');
    console.log('Result: 2/2 loopback checks passed; no external requests or payment actions');
  } finally {
    child.kill('SIGTERM');await exited;
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
