/** One focused original-source, fsync-backed end-to-end acceptance. No network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DurableCatalogTransaction } from './journal.mjs';

const offer = () => ({
  resource:{url:'https://seller.example/weather',description:'City weather',serviceName:'Weather'},
  accepts:[{network:'stellar:testnet',scheme:'exact',payTo:'GSELLER',asset:'USDC:TEST',maxAmountRequired:'20000'}],
  extensions:{bazaar:{info:{input:{type:'http',method:'GET',description:'Weather'},output:{type:'json'}},schema:{type:'object',properties:{city:{type:'string'}}}}},
});
const authority={sellerId:'seller-1',signer:'GDUMMYAUTHENTICATEDSIGNER',allowedOrigins:new Set(['https://seller.example']),allowedRecipients:new Set(['GSELLER']),allowedNetworks:new Set(['stellar:testnet']),allowedSchemes:new Set(['exact'])};
const provenance = () => ({authority:'signed_export',sellerId:'seller-1',sourceURL:'https://seller.example/approved/export',sourceSha256:createHash('sha256').update('operator-approved original bytes').digest('hex'),observedAt:'2026-10-10T18:00:00.000Z'});

test('SF60 original trust+life+catalog commit, rewrite, lock, retire, reboot and corruption',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sf60-'));
  let tx;
  try {
    tx=await DurableCatalogTransaction.open(dir);
    await assert.rejects(()=>DurableCatalogTransaction.open(dir),{code:'EEXIST'});
    const first={sellerId:'seller-1',sequence:1,entry:offer()};
    assert.equal((await tx.ingest(first,authority,provenance())).decision,'accepted');
    const key='http|https://seller.example|/weather||GET';
    assert.equal(tx.lookupCatalogKey(key).sellerId,'seller-1');
    assert.equal(tx.list().resources.length,1);
    const before=tx.head;
    assert.equal((await tx.ingest(first,authority,provenance())).decision,'soft_drop');
    assert.equal(tx.head,before);
    const untrusted={...offer()};untrusted.accepts=[{...untrusted.accepts[0],payTo:'GATTACKER'}];
    await assert.rejects(()=>tx.ingest({sellerId:'seller-1',sequence:2,entry:untrusted},authority,provenance()),/TRUST_PAYMENT_RECIPIENT_UNAUTHORIZED/);
    assert.equal(tx.head,before);assert.equal(tx.list().resources.length,1);
    const corrected=offer();corrected.accepts[0].maxAmountRequired='15000';
    assert.equal((await tx.ingest({sellerId:'seller-1',sequence:2,entry:corrected},authority,provenance())).decision,'accepted');
    assert.equal(tx.list().resources[0].accepts[0].maxAmountRequired,'15000');
    const meta=tx.lookupCatalogKey(key);
    assert.equal((await tx.retire({catalogKey:key,sellerId:'seller-1',signer:authority.signer,sequence:3,provenance:provenance(),reason:'seller withdrew route'})).reason,'RETIRED');
    assert.equal(tx.list().resources.length,0);
    assert.equal(tx.history(meta.lifecycleId).length,3);
    await tx.close();tx=null;
    tx=await DurableCatalogTransaction.open(dir);
    assert.equal(tx.count,3);assert.equal(tx.list().resources.length,0);
    assert.equal(tx.history(meta.lifecycleId).length,3);
    const resurrect=offer();resurrect.resource.description='Back online';
    assert.equal((await tx.ingest({sellerId:'seller-1',sequence:4,entry:resurrect},authority,provenance())).decision,'accepted');
    assert.equal(tx.list().resources.length,1);
    await tx.close();tx=null;
    const path=join(dir,'catalog-commits.json');
    const journal=JSON.parse(await readFile(path,'utf8'));journal.records[0].operation.candidate.entry.resource.description='forged';
    await writeFile(path,JSON.stringify(journal));
    await assert.rejects(()=>DurableCatalogTransaction.open(dir),/JOURNAL_DIGEST_INVALID/);
  } finally {if(tx)await tx.close();await rm(dir,{recursive:true,force:true});}
});
