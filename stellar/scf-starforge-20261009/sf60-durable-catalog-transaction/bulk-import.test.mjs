/** One end-to-end native catalog/import journey; fictional development offers, no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DurableCatalogTransaction as Journal } from './journal.mjs';
import { bindOperations } from './bulk-import.mjs';

const authority={sellerId:'example',signer:'LOCAL-TEST-IDENTITY',allowedOrigins:new Set(['https://example.test']),
  allowedRecipients:new Set(['GEXAMPLE']),allowedNetworks:new Set(['stellar:testnet']),allowedSchemes:new Set(['exact'])};
const provenance={authority:'signed_export',sellerId:'example',sourceURL:'https://example.test/export',
  sourceSha256:'a'.repeat(64),observedAt:'2026-10-11T00:00:00Z'};
const offer=(index,sequence=1)=>({kind:'upsert',candidate:{sellerId:'example',sequence,entry:{
  resource:{url:`https://example.test/resource-${index}`,description:'Example data resource',serviceName:'Example'},
  accepts:[{network:'stellar:testnet',scheme:'exact',payTo:'GEXAMPLE',asset:'EXAMPLE:TOKEN',amount:String(100+sequence)}],
  extensions:{bazaar:{info:{input:{type:'http',method:'GET'}},schema:{type:'object'}}}}},authority,provenance});
const key=i=>`http|https://example.test|/resource-${i}||GET`;
const inputOf=operations=>({schema:'stellar-forge.catalog-batch-input/v1',operations:operations.map(({authority,...row})=>row)});
const authorityFile={schema:'stellar-forge.catalog-operator-authorities/v1',sellers:[Object.fromEntries(
  Object.entries(authority).map(([key,value])=>[key,value instanceof Set?[...value]:value]))]};

test('atomic batch, native rollback/replay/CAS, restart, and complete file-based operator flow',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sf60-batch-'));
  let db,serial;
  try {
    db=await Journal.open(join(root,'batch'));
    serial=await Journal.open(join(root,'serial'));
    const rows=Array.from({length:200},(_,i)=>offer(i));
    const before=db.head, journal=join(root,'batch','catalog-commits.json');
    const preview=await db.previewBatch(rows);
    assert.equal(db.head,before);assert.equal(db.count,0);
    await assert.rejects(()=>stat(journal),{code:'ENOENT'});
    assert.equal(preview.applied,200);assert.equal(preview.changes[0].before,null);
    await assert.rejects(()=>db.commitBatch(rows,{expectedHead:before,expectedPlan:'0'.repeat(64)}),/BATCH_EXPECTED_PLAN_MISMATCH/);
    assert.equal(db.head,before);
    const start=performance.now();
    const result=await db.commitBatch(rows,{expectedHead:before,expectedPlan:preview.planId});
    const batchMs=performance.now()-start;
    assert.equal(result.head,preview.nextHead);assert.equal(db.count,200);
    const serialStart=performance.now();
    for (const row of rows) await serial.ingest(row.candidate,row.authority,row.provenance);
    const serialMs=performance.now()-serialStart;
    assert.equal(db.head,serial.head);
    assert.equal(await readFile(journal,'utf8'),await readFile(join(root,'serial','catalog-commits.json'),'utf8'));
    const contents=await readFile(journal,'utf8'),meta=await stat(journal);
    const replay=await db.commitBatch(rows,{expectedHead:db.head});
    assert.equal(replay.decision,'unchanged');assert.equal(replay.replayed,200);
    assert.equal((await stat(journal)).ino,meta.ino);assert.equal((await stat(journal)).mtimeMs,meta.mtimeMs);
    const bad=offer(202);bad.candidate.entry.accepts[0].payTo='WRONG';
    await assert.rejects(()=>db.commitBatch([offer(201),bad],{expectedHead:db.head}),/BATCH_ITEM_1_TRUST_PAYMENT_RECIPIENT_UNAUTHORIZED/);
    assert.equal(await readFile(journal,'utf8'),contents);assert.equal(db.lookupCatalogKey(key(201)),null);
    // Native original parser must reject traversal and owner/sequence conflicts.
    const traversal=offer(203);traversal.candidate.entry.resource.url='https://example.test/%252e%252e/private';
    await assert.rejects(()=>db.previewBatch([traversal]),/BATCH_ITEM_0_/);
    const altered=offer(0);altered.candidate.entry.accepts[0].amount='999';
    await assert.rejects(()=>db.previewBatch([altered]),/TRUST_CONFLICTING_REPLAY/);
    // Both contenders enqueue with the same head: exactly one durable winner.
    const old=db.head;
    const results=await Promise.allSettled([db.commitBatch([offer(204)],{expectedHead:old}),db.commitBatch([offer(205)],{expectedHead:old})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.match(results.find(r=>r.status==='rejected').reason.message,/EXPECTED_HEAD_MISMATCH/);
    // Caller mutation after enqueue cannot replace the reviewed operation.
    const original=offer(206),pending=db.commitBatch([original],{expectedHead:db.head});
    original.candidate.entry.accepts[0].payTo='MUTATED';
    await pending;
    const retire={kind:'retire',catalogKey:key(0),sellerId:'example',signer:authority.signer,sequence:2,provenance,reason:'route replacement'};
    const changes=[offer(1,2),retire,offer(207)];
    const changed=await db.previewBatch(changes);
    assert.equal(changed.changes[0].before.accepts[0].amount,'101');
    assert.equal(changed.changes[0].after.accepts[0].amount,'102');
    await db.commitBatch(changes,{expectedHead:changed.baseHead,expectedPlan:changed.planId});
    assert.equal(db.lookupCatalogKey(key(0)).retired,true);
    assert.equal((await db.commitBatch([retire],{expectedHead:db.head})).decision,'unchanged');
    await assert.rejects(()=>db.previewBatch([offer(0)]),/TRUST_EXACT_REPLAY|STALE_SEQUENCE/);
    const finalHead=db.head,finalCount=db.count;
    await db.close();db=await Journal.open(join(root,'batch'));
    assert.equal(db.head,finalHead);assert.equal(db.count,finalCount);
    assert.equal(db.history(db.lookupCatalogKey(key(0)).lifecycleId).at(-1).state,'retired');
    const found=db.search(new URLSearchParams({query:'Example data',limit:'5'}));
    assert.equal(found.resources.length,5);assert.ok(found.pagination.cursor);
    assert.equal((await db.commitBatch([offer(0,3)],{expectedHead:db.head})).decision,'committed');
    assert.equal(db.lookupCatalogKey(key(0)).retired,false);
    // CLI preview -> actual process restart -> apply -> filtered list/status.
    const input=join(root,'input.json'),auth=join(root,'trusted.json'),review=join(root,'review'),directory=join(root,'cli');
    await writeFile(input,JSON.stringify(inputOf(rows.slice(0,3))));
    await writeFile(auth,JSON.stringify(authorityFile));
    const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./bulk-import.mjs',import.meta.url)),...args],{encoding:'utf8'}));
    const common=['--directory',directory,'--input',input,'--authorities',auth];
    assert.equal(cli('preview',...common,'--out',review).changes,3);
    const plan=join(review,'plan.json');
    assert.equal((await stat(plan)).mode&0o777,0o600);
    assert.match(await readFile(join(review,'review.html'),'utf8'),/Changes in transaction order/);
    assert.equal(cli('status','--directory',directory,'--plan',plan).reviewState,'at_reviewed_head');
    const modified=JSON.parse(await readFile(input,'utf8'));modified.operations[0].candidate.entry.accepts[0].amount='888';
    await writeFile(input,JSON.stringify(modified));
    assert.throws(()=>cli('apply',...common,'--plan',plan),/PLAN_SOURCE_CHANGED_PREVIEW_AGAIN/);
    await writeFile(input,JSON.stringify(inputOf(rows.slice(0,3))));
    assert.equal(cli('apply',...common,'--plan',plan).decision,'committed');
    assert.equal(cli('status','--directory',directory,'--plan',plan).reviewState,'at_planned_result');
    assert.equal(cli('list','--directory',directory,'--network','stellar:testnet','--limit','2').resources.length,2);
    assert.throws(()=>cli('apply',...common,'--plan',plan),/BATCH_EXPECTED_HEAD_MISMATCH/);
    const injected=inputOf(rows.slice(0,1));injected.operations[0].authority={signer:'UNTRUSTED'};
    assert.throws(()=>bindOperations(injected,authorityFile),/INPUT_ROW_0_INVALID/);
    console.log(JSON.stringify({offers:rows.length,batchMs:Number(batchMs.toFixed(2)),serialMs:Number(serialMs.toFixed(2)),
      ratio:Number((serialMs/batchMs).toFixed(2)),nativeJournalBytesEqual:true,rollback:true,restart:true,cli:true}));
  } finally {if(db)await db.close();if(serial)await serial.close();await rm(root,{recursive:true,force:true});}
});
