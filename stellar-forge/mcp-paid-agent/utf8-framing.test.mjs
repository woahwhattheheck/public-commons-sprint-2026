// MIT — focused real Node HTTP wire test for the SF-32 MCP request boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer,request } from 'node:http';
import { McpPaidToolBroker,createMcpHttpHandler,MCP_VERSION } from './agent-server.mjs';

const token='sf32-focused-test-operator-secret-not-live';
const makePayload=search=>({jsonrpc:'2.0',id:17,method:'tools/call',
  params:{name:'sf43_discover_review_and_pay',arguments:{search}}});
const jsonBytes=obj=>Buffer.from(JSON.stringify(obj),'utf8');

async function post(port,bytes,splitAt=null){
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path:'/',method:'POST',headers:{
      authorization:'Bearer '+token,
      'content-type':'application/json',
      accept:'application/json, text/event-stream',
      'mcp-protocol-version':MCP_VERSION,
      'transfer-encoding':'chunked',
    }},res=>{
      const parts=[];res.on('data',c=>parts.push(c));
      res.on('error',reject);
      res.on('end',()=>{const raw=Buffer.concat(parts).toString('utf8');
        resolve({status:res.statusCode,body:JSON.parse(raw)});});
    });
    req.on('error',reject);
    if(splitAt===null)req.end(bytes);
    else{
      // A separated transfer chunk intentionally splits one UTF-8 code point.
      req.write(bytes.subarray(0,splitAt));
      setTimeout(()=>req.end(bytes.subarray(splitAt)),20);
    }
  });
}

test('MCP JSON-RPC preserves split UTF-8, rejects wire-byte overflow and malformed UTF-8',async()=>{
  const invoked=[];
  const broker=new McpPaidToolBroker({discoveryUrl:'https://catalog.example',
    agentCommerce:async input=>{invoked.push(input.search);return {echo:input.search};}});
  const server=createServer(createMcpHttpHandler(broker,{bearerToken:token}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try{
    const original='Málaga 🔍';
    const bytes=jsonBytes(makePayload(original));
    const position=bytes.indexOf(Buffer.from('🔍','utf8'));
    assert.ok(position>0);
    const accepted=await post(port,bytes,position+1);
    assert.equal(accepted.status,200);
    assert.equal(accepted.body.result.isError,false);
    assert.equal(accepted.body.result.structuredContent.echo,original);
    assert.deepEqual(invoked,[original]);

    // 70,000 UTF-16 code units of U+00E9 exceed 128 KiB of UTF-8 wire bytes.
    // The old handler compared JS string length and incorrectly accepted this.
    const large=jsonBytes(makePayload('é'.repeat(70000)));
    assert.ok(large.byteLength>128*1024);
    const rejected=await post(port,large);
    assert.equal(rejected.status,413);
    assert.equal(rejected.body.error.code,-32700);
    assert.equal(invoked.length,1);

    const valid=jsonBytes(makePayload('bad-X'));
    const marker=valid.indexOf(Buffer.from('X'));
    assert.ok(marker>0);
    const malformed=Buffer.concat([valid.subarray(0,marker),
      Buffer.from([0xc3,0x28]),valid.subarray(marker+1)]);
    const invalid=await post(port,malformed);
    assert.equal(invalid.status,400);
    assert.equal(invalid.body.error.code,-32700);
    assert.equal(invoked.length,1);
  }finally{
    await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  }
});
