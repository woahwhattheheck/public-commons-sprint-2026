import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {toCompletionsURL, modelSettings} from './run.mjs';

test('official LLM_* keys map to original Apertus completion endpoint',()=>{
  const config = modelSettings({LLM_BASE_URL:'https://demo.apertus.example/v1/',LLM_NAME:'swiss-ai/Apertus-v1.5-8B',LLM_API_KEY:'sample-key'});
  assert.deepEqual(config, {endpoint:'https://demo.apertus.example/v1/chat/completions', key:'sample-key', model:'swiss-ai/Apertus-v1.5-8B',mode:'live-available'});
  assert.equal(toCompletionsURL('https://demo.apertus.example/v1/chat/completions'),'https://demo.apertus.example/v1/chat/completions');
  assert.equal(modelSettings({}).mode,'offline');
});

test('rejects unsafe remote HTTP and URL-carried credentials',()=>{
  assert.throws(()=>toCompletionsURL('http://remote.example/v1'), /HTTPS/);
  assert.throws(()=>toCompletionsURL('https://user:secret@remote.example/v1'), /credentials/);
  assert.throws(()=>toCompletionsURL('https://remote.example/v1#cred'), /fragment/);
  assert.equal(toCompletionsURL('http://127.0.0.1:1234/v1'),'http://127.0.0.1:1234/v1/chat/completions');
});
