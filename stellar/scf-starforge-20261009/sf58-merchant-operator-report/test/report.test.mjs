// MIT. One focused source-integrated export check; these are local format fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeOperatorReport,runCli} from '../report.mjs';
const at='2026-10-10T20:00:00.000Z';
const free=id=>({intentId:id,observedAt:at,buyer:{
  status:'NO_PAYMENT_REQUIRED',attempts:1,httpStatus:200,settlement:'NOT_REQUESTED',
  requirement:null,receipt:null,reason:null
}});
const unpaid=id=>({intentId:id,observedAt:at,buyer:{
  status:'UNPAID_HTTP_ERROR',attempts:1,httpStatus:503,settlement:'NOT_REQUESTED',
  requirement:null,receipt:null,reason:'HTTP_503'
}});
test('original SF52 classifies free/unsuccessful requests with no verified transfer',()=>{
  const x=makeOperatorReport([free('free-001'),unpaid('unpaid-002')],{inputSha256:'c'.repeat(64)});
  assert.equal(x.report.counts.total,2);
  assert.equal(x.report.counts.verifiedTransfers,0);
  assert.equal(x.report.counts.reviewRequired,2);
  assert.deepEqual(x.report.verifiedAtomicByAsset,[]);
  assert(x.report.entries.every(e=>e.transaction===null));
  assert.match(x.csv,/NO_VERIFIED_PAID_TRANSFER/);
  assert.match(x.html,/not an invoice/i);
});
test('original SF52 duplicate intent rejection carries into merchant export',()=>{
  assert.throws(()=>makeOperatorReport([free('same'),free('same')]),/DUPLICATE_INTENT_ID/);
});
test('writes local source identities and refuses overwrite of evidence output',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'scf58-'));
  try{
    const input=join(dir,'observations.json'),output=join(dir,'result');
    await writeFile(input,JSON.stringify([free('one')]));
    const result=await runCli(['--input',input,'--out',output]);
    const read=JSON.parse(await readFile(join(output,'summary.json'),'utf8'));
    assert.deepEqual(read.entries,result.entries);
    assert.equal(read.source.gitBlobSha1.length,40);
    assert.equal(read.source.sourceSha256.length,64);
    assert.match(await readFile(join(output,'audit.csv'),'utf8'),/NO_VERIFIED_PAID_TRANSFER/);
    assert.match(await readFile(join(output,'index.html'),'utf8'),/Stellar Forge/);
    await assert.rejects(runCli(['--input',input,'--out',output]),/EEXIST/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
