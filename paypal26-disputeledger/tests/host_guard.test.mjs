import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const dir=fileURLToPath(new URL('../',import.meta.url));
const server=fileURLToPath(new URL('../src/server.mjs',import.meta.url));

async function availablePort(){
  const listener=net.createServer();
  await new Promise((resolve,reject)=>{
    listener.once('error',reject);
    listener.listen(0,'127.0.0.1',resolve);
  });
  const {port}=listener.address();
  await new Promise(resolve=>listener.close(resolve));
  return port;
}

function request(port,host,path,{method='GET',body}={}){
  return new Promise((resolve,reject)=>{
    const headers={Host:host};
    if(body!==undefined)headers['Content-Type']='application/json';
    const req=http.request({hostname:'127.0.0.1',port,path,method,headers},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
      res.on('error',reject);
    });
    req.on('error',reject);
    req.end(body);
  });
}

test('actual local server accepts its advertised Host, rejects alternate Host on every route',async()=>{
  const port=await availablePort();
  const expected='127.0.0.1:'+port;
  const child=spawn(process.execPath,[server],{
    cwd:dir,
    env:{...process.env,PORT:String(port),PAYPAL_CLIENT_ID:'',PAYPAL_CLIENT_SECRET:'',
      AI_CHAT_COMPLETIONS_URL:'',AI_API_KEY:'',AI_MODEL:''},
    stdio:['ignore','pipe','pipe']
  });
  let stdout='',stderr='',ready=false;
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Server start timed out: '+stderr)),6000);
      const fail=(reason)=>{clearTimeout(timer);reject(reason);};
      child.once('error',fail);
      child.once('exit',code=>{if(!ready)fail(new Error('Server exited '+code+': '+stderr));});
      child.stdout.on('data',chunk=>{
        stdout+=chunk.toString('utf8');
        if(!ready&&stdout.includes('DisputeLedger read-only sandbox demo at ')){
          ready=true;clearTimeout(timer);resolve();
        }
      });
      child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8');});
    });
    const home=await request(port,expected,'/');
    assert.equal(home.status,200);
    assert.match(home.body,/DisputeLedger/);
    const health=await request(port,expected,'/api/health');
    assert.equal(health.status,200);
    assert.equal(JSON.parse(health.body).ready,true);
    const demo=await request(port,expected,'/api/demo');
    assert.equal(demo.status,200);
    const caseId=JSON.parse(demo.body).case.dispute_id;
    const packet=await request(port,expected,'/api/packet',{
      method:'POST',body:JSON.stringify({id:caseId,evidence:{}})
    });
    assert.equal(packet.status,200);
    assert.equal(JSON.parse(packet.body).packet.review_status,'DRAFT_ONLY');

    // All routes, not just POST, require the loopback authority.
    for(const host of ['localhost:'+port,'unrecognized.local:'+port,
      '127.0.0.1:'+port+'.unexpected.local','127.0.0.1']){
      for(const path of ['/','/api/health','/api/demo','/api/disputes',
        '/api/detail?id='+encodeURIComponent(caseId),'/api/packet']){
        const result=await request(port,host,path,path==='/api/packet'
          ?{method:'POST',body:JSON.stringify({id:caseId,evidence:{}})}:{});
        assert.equal(result.status,403,host+' '+path);
        assert.deepEqual(JSON.parse(result.body),{error:'Unexpected Host header'});
      }
    }
    // A normal Host does not disable the existing Origin guard on POST.
    const badOrigin=await new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port,path:'/api/packet',method:'POST',
        headers:{Host:expected,Origin:'https://unrecognized.local','Content-Type':'application/json'}},res=>{
          const data=[];res.on('data',c=>data.push(c));
          res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(data).toString()}));
        });
      req.on('error',reject);
      req.end(JSON.stringify({id:caseId,evidence:{}}));
    });
    assert.equal(badOrigin.status,400);
    assert.match(JSON.parse(badOrigin.body).error,/Cross-origin/);
  }finally{
    if(child.exitCode===null){
      child.kill('SIGTERM');
      await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,1500).unref();});
    }
  }
});
