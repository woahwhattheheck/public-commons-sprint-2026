import test from 'node:test';
import assert from 'node:assert/strict';
import {anthropicCompletionText} from '../src/anthropic.mjs';

const opts = {apiKey:'offline-fixture-key',model:'sandbox-fixture-model',userContent:'{"cart":"offline"}',system:'Only return advisory JSON'};
test('native Anthropic Messages call uses first-party API and returns completed text',async()=>{
  const calls=[];
  const transport=async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({type:'message',stop_reason:'end_turn',content:[{type:'text',text:'{"summary":"Check merchant terms","questions":[]}'}]})}};
  const text=await anthropicCompletionText({...opts,transport});
  assert.equal(text,'{"summary":"Check merchant terms","questions":[]}');
  assert.equal(calls[0].url,'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.headers['x-api-key'],'offline-fixture-key');
  assert.equal(calls[0].init.headers['anthropic-version'],'2023-06-01');
  assert.equal(calls[0].init.headers.Authorization,undefined);
  const data=JSON.parse(calls[0].init.body);
  assert.equal(data.model,opts.model);
  assert.deepEqual(data.messages,[{role:'user',content:opts.userContent}]);
  assert.equal(data.system,opts.system);
});
test('truncated responses or tool blocks cannot be used as advisory text',async()=>{
  for(const body of [
    {type:'message',stop_reason:'max_tokens',content:[{type:'text',text:'{"summary":"partial","questions":[]}'}]},
    {type:'message',stop_reason:'tool_use',content:[{type:'tool_use',name:'capture_order'}]},
    {type:'message',stop_reason:'end_turn',content:[{type:'text',text:'{}'},{type:'text',text:'{}'}]},
  ]) {
    await assert.rejects(()=>anthropicCompletionText({...opts,transport:async()=>({ok:true,json:async()=>body})}),/malformed or incomplete/);
  }
});
