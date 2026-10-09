import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {start} from './server.mjs';

function send(port,{host,method='GET',path='/api/state',origin,body}={}){
  return new Promise((resolve,reject)=>{
    const headers={};
    if(host!==undefined)headers.Host=host;
    if(origin!==undefined)headers.Origin=origin;
    if(body!==undefined)headers['Content-Type']='application/json';
    const req=http.request({host:'127.0.0.1',port,path,method,headers},res=>{
      let text='';res.setEncoding('utf8');res.on('data',x=>text+=x);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:text}));
    });
    req.on('error',reject);req.end(body);
  });
}
async function localServer(binding,fn){
  const server=start({port:0,host:binding});
  try{
    if(!server.listening)await once(server,'listening');
    await fn(server.address().port);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('real loopback HTTP accepts both legitimate local names and simulated approval flow',async()=>{
  await localServer('127.0.0.1',async port=>{
    for(const name of ['127.0.0.1','localhost','[::1]']){
      const result=await send(port,{host:`${name}:${port}`});
      assert.equal(result.status,200,name);
      assert.ok(result.headers['set-cookie']?.[0].includes('HttpOnly'));
      assert.equal(JSON.parse(result.body).status,'empty');
    }
    const p=await send(port,{host:`127.0.0.1:${port}`,method:'POST',path:'/api/action',body:JSON.stringify({action:'propose'})});
    assert.equal(p.status,200);
    const proposal=JSON.parse(p.body);
    assert.equal(proposal.status,'proposed');
    assert.equal(proposal.approved,false);
    assert.equal(proposal.proposal.schema,'gridkind-sim-v1');
  });
});

test('real HTTP rejects every forged and mismatched Host before creating a session',async()=>{
  await localServer('127.0.0.1',async port=>{
    const badHosts=[`evil.test:${port}`,`localhost.evil.test:${port}`,`127.0.0.1.evil.test:${port}`,`127.0.0.2:${port}`,`localhost.:${port}`,`[::1].evil:${port}`,`127.0.0.1:${port+1}`,'localhost','user@localhost:'+port];
    for(const bad of badHosts){
      for(const method of ['GET','POST']){
        const result=await send(port,{host:bad,method,path:method==='GET'?'/api/state':'/api/action',body:method==='POST'?'{"action":"propose"}':undefined});
        assert.equal(result.status,403,`${method} ${bad}`);
        assert.equal(result.headers['set-cookie'],undefined,`${method} ${bad}: no session cookie`);
        assert.equal(JSON.parse(result.body).error,'Loopback demo Host mismatch');
      }
    }
  });
});

test('retains cross-origin rejection and intentional non-loopback deployment behavior',async()=>{
  await localServer('127.0.0.1',async port=>{
    const result=await send(port,{host:`127.0.0.1:${port}`,origin:'https://evil.example',method:'POST',path:'/api/action',body:'{"action":"propose"}'});
    assert.equal(result.status,403);
    assert.equal(JSON.parse(result.body).error,'Cross-origin disabled');
  });
  await localServer('0.0.0.0',async port=>{
    const result=await send(port,{host:`intentional.example:${port}`});
    assert.equal(result.status,200);
    assert.equal(JSON.parse(result.body).status,'empty');
  });
});
