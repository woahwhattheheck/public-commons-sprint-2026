import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {once} from 'node:events';
import {createOpsHandler} from '../ops.mjs';

const catalog={size:1,version:1,list:()=>({resources:[]}),search:()=>({resources:[]})};

async function withServer(handler, run) {
  const server=createServer(handler);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {await run('http://127.0.0.1:'+server.address().port);}
  finally {server.closeAllConnections();server.close();await once(server,'close');}
}

test('aborted Node HTTP response must not free a slot while original async handler is still running',async()=>{
  let entered, serverClosed, releaseWork;
  const workStarted=new Promise(resolve=>entered=resolve);
  const socketClosed=new Promise(resolve=>serverClosed=resolve);
  const workGate=new Promise(resolve=>releaseWork=resolve);
  const handler=async(req,res)=>{
    if(req.url.includes('hold')){
      res.once('close',()=>serverClosed());
      entered();
      await workGate; // Original service work is still active after peer disconnect.
      if(!res.destroyed)res.end('{}');
      return;
    }
    res.setHeader('content-type','application/json');
    res.end('{}');
  };
  const ops=createOpsHandler({catalog,discoveryHandler:handler,maxInFlight:1});
  await withServer(ops.handler,async root=>{
    const port=Number(new URL(root).port);
    const client=request({hostname:'127.0.0.1',port,path:'/discovery/resources?hold=1'});
    client.on('error',()=>{});client.end();
    try{
      await workStarted;
      assert.equal(ops.snapshot().inFlight,1);
      client.destroy();
      await socketClosed; // ServerResponse close fired and old code prematurely decremented.
      assert.equal(ops.snapshot().abortedResponses,1,'abort telemetry still records just once');
      assert.equal(ops.snapshot().inFlight,1,'outstanding backend Promise still occupies slot');
      const rejected=await fetch(root+'/discovery/resources?second=1');
      assert.equal(rejected.status,503,'no second admission despite client disconnect');
      assert.equal((await rejected.json()).error,'OVERLOADED');
    }finally{
      releaseWork();
    }
    // Wait for original handler to complete, not just for the socket to close.
    for(let i=0;i<25 && ops.snapshot().inFlight!==0;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(ops.snapshot().inFlight,0,'work settlement releases capacity exactly once');
    const good=await fetch(root+'/discovery/resources?after=1');
    assert.equal(good.status,200,'capacity restored after actual work completion');
    assert.equal(ops.snapshot().inFlight,0,'no negative or leaked active slots');
    assert.equal(ops.snapshot().overloaded,1);
  });
});
