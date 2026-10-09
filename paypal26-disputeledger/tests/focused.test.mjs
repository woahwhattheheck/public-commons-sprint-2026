import test from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE,normalizeCase,preparePacket,modelFacts} from '../src/core.mjs';
import {PayPalDisputes} from '../src/paypal.mjs';
import {advise} from '../src/ai.mjs';

test('synthetic draft records absent requested evidence and cannot present itself as PayPal settlement',()=>{
  const entry=normalizeCase(SAMPLE,true);
  const packet=preparePacket(entry,{delivery:true,order_record:true,refund:false});
  assert.equal(packet.synthetic,true);
  assert.equal(packet.case.provider_verified,false);
  assert.deepEqual(packet.needs_human_evidence,['buyer_messages']);
  assert.equal(packet.review_status,'DRAFT_ONLY');
  assert.equal(packet.submissions_performed,0);
  assert.equal(packet.refund_actions_performed,0);
  assert.equal(modelFacts(packet).dispute_id,undefined);
  assert.throws(()=>preparePacket(entry,{delivery:'true'}),/Evidence/);
});

test('sandbox OAuth + list/details make only expected GET dispute calls, refuse synthetic and unsafe IDs',async()=>{
  const paths=[];
  const transport=async(url,opt)=>{
    paths.push({url,method:opt.method});
    if(url.endsWith('/v1/oauth2/token'))return new Response(JSON.stringify({access_token:'mock',expires_in:1200}),{status:200});
    if(url.includes('page_size=10'))return new Response(JSON.stringify({items:[{dispute_id:'PP-D-12345678'}]}),{status:200});
    if(url.endsWith('/PP-D-12345678'))return new Response(JSON.stringify({dispute_id:'PP-D-12345678',status:'OPEN'}),{status:200});
    throw Error('Unexpected network route');
  };
  const adapter=new PayPalDisputes({id:'dummy',secret:'dummy',transport});
  assert.equal((await adapter.list())[0].dispute_id,'PP-D-12345678');
  assert.equal((await adapter.detail('PP-D-12345678')).status,'OPEN');
  await assert.rejects(adapter.detail('../../v2/checkout/orders'),/real PayPal sandbox/);
  await assert.rejects(adapter.detail('DEMO-PP-D-001'),/real PayPal sandbox/);
  assert.deepEqual(paths.map(v=>v.method),['POST','GET','GET']);
  assert.ok(paths.every(x=>x.url.startsWith('https://api-m.sandbox.paypal.com/')));
});

test('AI only sees bounded category facts, never dispute identity, and its advice remains separate',async()=>{
  const pkt=preparePacket(normalizeCase(SAMPLE,true),{buyer_messages:true});
  let sent='';
  const transport=async(url,options)=>{
    sent=options.body;
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{
      role:'assistant',content:JSON.stringify({summary:'Ask for tracking records.',questions:['Is there a verifiable delivery record?']})
    }}]}),{status:200});
  };
  const answer=await advise(pkt,{endpoint:'https://model.example/v1/chat/completions',key:'placeholder',model:'fixture',transport});
  assert.equal(answer.model_used,true);
  assert.equal(answer.questions.length,1);
  assert.equal(sent.includes('DEMO-PP-D-001'),false);
  assert.equal(sent.includes('DEMO-TXN'),false);
  assert.equal(sent.includes('merchant_notes'),false);
});
