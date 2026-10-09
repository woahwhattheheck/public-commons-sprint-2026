import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPitchPulseServer} from '../server.mjs';

test('broadcast assets remain read-only while sharing a local visitor session',async()=>{
 const server=createPitchPulseServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{
  const initial=await fetch(origin+'/api/state');
  assert.equal(initial.status,200);
  const cookie=initial.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const mutation=await fetch(origin+'/api/next',{method:'POST',headers:{cookie}});
  assert.equal(mutation.status,200);
  const before=await (await fetch(origin+'/api/state',{headers:{cookie}})).json();
  assert.equal(before.acceptedEvents,1);
  for(const [path,type] of [
   ['/broadcast','text/html'],
   ['/broadcast.mjs','text/javascript'],
   ['/broadcast.css','text/css']
  ]){
   const response=await fetch(origin+path,{headers:{cookie}});
   assert.equal(response.status,200,path);
   assert.match(response.headers.get('content-type'),new RegExp(type));
   assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
   assert.match(await response.text(),path==='/broadcast'?/SYNTHETIC REPLAY/:path.endsWith('.css')?/\.scoreboard/:/activeOverlays/);
  }
  const after=await (await fetch(origin+'/api/state',{headers:{cookie}})).json();
  assert.equal(after.acceptedEvents,before.acceptedEvents);
  assert.deepEqual(after.scoreboard,before.scoreboard);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
