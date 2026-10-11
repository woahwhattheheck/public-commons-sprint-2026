// Focused source-native contract exercise over real loopback JSON-RPC HTTP transport.
// The local ledger and decoded fixture are NOT a Stellar chain transaction or paid endpoint.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { reconcileRpc, validStrKey, ReconciliationError } from './verify.mjs';

const crc = b => { let n=0; for(const v of b) { n^=v<<8; for(let j=0;j<8;j++) n=((n<<1)^(n&0x8000?0x1021:0))&65535; } return n; };
const base32=b=>{ const a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let val=0,bits=0,s='';for(const v of b) {val=val*256+v;bits+=8;while(bits>=5) {bits-=5;s+=a[Math.floor(val/2**bits)%32];val%=2**bits;}}if(bits) s+=a[(val<<(5-bits))%32];return s;};
const key=(version,b)=>{const p=Buffer.concat([Buffer.from([version]),Buffer.alloc(32,b)]);const c=crc(p);return base32(Buffer.concat([p,Buffer.from([c&255,c>>8])]));};
const payer=key(48,1),payTo=key(48,2),asset=key(16,3),hash='c'.repeat(64);
assert.equal(validStrKey(asset,'C'),true);
assert.equal(validStrKey(payer,'G'),true);
assert.equal(validStrKey(payTo,'G'),true);
assert.equal(validStrKey(key(48,3),'C'),false);
const record={ intentId:'actual-intent-placeholder',
  requirement:{scheme:'exact',network:'stellar:testnet',asset,payTo,amount:'10000'},
  receipt:{network:'stellar:testnet',transaction:hash,payer,amount:'10000',success:true},
  operatorReservation:{schema:'stellar-forge.sf62.result.v1',outcome:'FRESH_RESERVATION_APPROVED',
    request_id:'actual-intent-placeholder',network:'stellar:testnet',asset,reserved_atomic_units:'10000'}};
const mk=(id,ledger=123,decoded={name:'transfer',from:payer,to:payTo,amount:'10000'})=>
  ({id,ledger,txHash:hash,contractId:asset,localDecoded:decoded});
const eventId=n=>`${((123n<<32n)+(1n<<12n)).toString().padStart(19,'0')}-${String(n).padStart(10,'0')}`;
const endCursor=`${((125n<<32n)+0xffffffffn).toString().padStart(19,'0')}-4294967295`;
const fullPage=(offset,match=false)=>Array.from({length:200},(_,i)=>
  mk(eventId(offset+i),123,i===0&&match?undefined:{name:'other'}));
let scenario='pass',calls=[];
const server=createServer(async(req,res)=>{
  let payload='';for await (const chunk of req) payload+=chunk;
  const q=JSON.parse(payload);calls.push({method:q.method,params:q.params});
  let result;
  if(q.method==='getTransaction') result={status:'SUCCESS',txHash:hash,ledger:123};
  else if(q.method==='getEvents') {
    const second=Boolean(q.params.pagination.cursor);
    // Match original Stellar RPC semantics: full pages return the final event
    // ID; short/empty pages return the maximum cursor of the scanned window.
    if(scenario==='duplicate') result=second?
      {events:[mk(eventId(200))],cursor:endCursor,latestLedger:125}:
      {events:fullPage(0,true),cursor:eventId(199),latestLedger:125};
    else if(scenario==='unfinished'||scenario==='single-unfinished') result={
      events:fullPage(second?200:0,scenario==='single-unfinished'&&!second),
      cursor:eventId(second?399:199),latestLedger:125};
    else if(scenario==='no-transfer') result={events:[mk(eventId(0),123,{name:'other'})],
      cursor:endCursor,latestLedger:125};
    else if(scenario==='quiet-contract') result={events:[mk(eventId(0))],
      cursor:endCursor,latestLedger:125};
    else result=second?{events:[],cursor:endCursor,latestLedger:125}:
      {events:fullPage(0,true),cursor:eventId(199),latestLedger:125};
  } else result={error:'unsupported method'};
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const endpoint=`http://127.0.0.1:${server.address().port}/`;
const decoder=async e=>e.localDecoded; // The real operator CLI uses original SF43 Stellar SDK XDR decoder instead.
let passed=0;
try {
  const run=(more={})=>reconcileRpc({record,payer,decodeContractEvent:decoder,rpcEndpoint:endpoint,...more});
  const expectCode=async (fn,code)=>{
    await assert.rejects(fn,e=>e instanceof ReconciliationError&&e.code===code);
    passed++;
  };
  scenario='pass';calls=[];
  const result=await run();
  assert.equal(result.verdict,'LOCAL_RPC_REPLAY_MATCHED');
  assert.equal(result.matchingTransfers,1);assert.equal(result.eventPages,2);
  assert.deepEqual(calls.map(x=>x.method),['getTransaction','getEvents','getEvents']);
  assert.equal(calls[1].params.startLedger,123);
  assert.equal(calls[2].params.startLedger,undefined);
  assert.equal(calls[2].params.pagination.cursor,eventId(199));passed++;
  scenario='quiet-contract';calls=[];
  const quiet=await run();
  assert.equal(quiet.matchingTransfers,1);assert.equal(quiet.eventPages,1);
  assert.deepEqual(calls.map(x=>x.method),['getTransaction','getEvents']);passed++;
  scenario='duplicate';await expectCode(run,'AMBIGUOUS_TRANSFERS');
  scenario='unfinished';await expectCode(()=>run({maxEventPages:2}),'EVENT_PAGE_BUDGET_EXHAUSTED');
  scenario='single-unfinished';await expectCode(()=>run({maxEventPages:2}),'EVENT_PAGE_BUDGET_EXHAUSTED');
  scenario='no-transfer';await expectCode(run,'NO_EXACT_TRANSFER');
  const bad={...record,operatorReservation:{...record.operatorReservation,reserved_atomic_units:'1'}};
  await expectCode(()=>run({record:bad}),'RESERVED_TERMS_MISMATCH');
  await expectCode(()=>run({payer:payTo}),'RECEIPT_PAYER_MISMATCH');
  await expectCode(()=>run({rpcEndpoint:'https://unapproved.example'}),'RPC_ENDPOINT_NOT_ALLOWED');
  await expectCode(()=>run({decodeContractEvent:null}),'STELLAR_SDK_DECODER_REQUIRED');
  console.log(JSON.stringify({status:'PASS',cases:passed,transport:'actual HTTP loopback',
    originalModule:'sf86 direct RPC verifier',liveStellarTransaction:false}));
} finally {server.close();}
