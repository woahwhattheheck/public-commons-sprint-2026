// MIT. SF31 deployment-prefix discovery contract using the original buyer SDK and HTTP socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { X402BuyerClient } from '../buyer.mjs';

test('real GET discovery preserves provider deployment prefix without changing root routes', async () => {
  const requests=[];
  const server=createServer((req,res)=>{
    requests.push({method:req.method,path:req.url,signature:req.headers['payment-signature']});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({resources:[],pagination:{offset:0,total:0,limit:100}}));
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  try{
    const origin='http://127.0.0.1:'+server.address().port;
    const buyer=new X402BuyerClient({allowLocal:true});
    const root=await buyer.discover({origin,limit:5});
    assert.equal(root.source,origin+'/discovery/resources?limit=5');
    const provider=await buyer.discover({
      origin:origin+'/platform/v2/x402/?stale=ignored',
      query:'stellar data',
      filters:{network:'stellar:testnet'},
      limit:7
    });
    assert.equal(provider.source,
      origin+'/platform/v2/x402/discovery/search?query=stellar+data&network=stellar%3Atestnet&limit=7');
    const resource=await buyer.discover({origin:origin+'/api/v1////',limit:3});
    assert.equal(resource.source,origin+'/api/v1/discovery/resources?limit=3');
    assert.deepEqual(requests,[
      {method:'GET',path:'/discovery/resources?limit=5',signature:undefined},
      {method:'GET',path:'/platform/v2/x402/discovery/search?query=stellar+data&network=stellar%3Atestnet&limit=7',signature:undefined},
      {method:'GET',path:'/api/v1/discovery/resources?limit=3',signature:undefined}
    ]);
  }finally{
    server.close();
    await once(server,'close');
  }
});
