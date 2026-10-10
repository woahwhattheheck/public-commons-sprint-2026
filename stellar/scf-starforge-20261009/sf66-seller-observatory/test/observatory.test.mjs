// Single local filesystem-integrity acceptance. Fixtures exercise storage, not provider simulations.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkTargets, record, history, dashboard} from '../observatory.mjs';

test('source-preserving observed snapshots, regression detection and tamper stop', async () => {
  const dir=await mkdtemp(join(tmpdir(),'sf66-'));
  try {
    const [target]=checkTargets({targets:[{id:'real-seller-slot', resource:'https://seller.example/paid',
      catalog:'https://facilitator.example/discovery/resources',network:'stellar:testnet'}]});
    const original={schema:'stellar-forge.seller-visibility.v1',mode:'READ_ONLY_UNAUTHENTICATED',
      seller:target.resource,network:target.network,desiredPayTo:null,
      challenge:{state:'X402_402',httpStatus:402},
      catalog:{endpoint:target.catalog,complete:true,pages:1,rawRows:1,uniqueKeys:1,
        matchingResourceCount:1,matches:[],matchingPayToOtherResources:[]},verdict:'LISTED'};
    const bytes1=Buffer.from(JSON.stringify(original,null,4));
    const e1=await record(dir,target,bytes1,{origin:'SF52_IMPORTED_ORIGINAL'});
    assert.equal(e1.trend,'FIRST_OBSERVATION');
    assert.deepEqual(await readFile(join(dir,e1.evidence)),bytes1);
    const absent={...original,catalog:{...original.catalog,rawRows:0,uniqueKeys:0,matchingResourceCount:0},
      verdict:'NOT_LISTED_IN_EXHAUSTED_CATALOG'};
    const e2=await record(dir,target,Buffer.from(JSON.stringify(absent)),{origin:'SF52_IMPORTED_ORIGINAL'});
    assert.equal(e2.trend,'LISTING_REGRESSION');
    assert.equal((await history(dir)).length,2);
    assert.match(dashboard(await history(dir)),/LISTING_REGRESSION/);
    assert.match(dashboard(await history(dir)),/Original JSON/);
    await writeFile(join(dir,e1.evidence),'tampered');
    await assert.rejects(history(dir),/Evidence hash mismatch/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
