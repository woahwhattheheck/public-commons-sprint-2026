// One focused report-package proof; no network, wallet, or payment.
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeSourceBytes, interpret, renderReport, writePackage, verifyPackage} from '../report.mjs';
import {inspectChallenge} from '../../sf52-merchant-visibility/diagnose.mjs';

test('original diagnostic input becomes deterministic offline report without elevated outcome',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sf64-native-'));
  try {
    const source=Buffer.from(JSON.stringify({
      schema:'stellar-forge.seller-visibility.v1',mode:'READ_ONLY_UNAUTHENTICATED',
      seller:'https://seller.example/pay?label=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
      network:'stellar:testnet', desiredPayTo:'G-TEST-ONLY',
      challenge:inspectChallenge(200, null),extensionResponse:{state:'NOT_PROVIDED'},
      catalog:{endpoint:'https://facilitator.example/discovery/resources',pages:1,rawRows:0,
        uniqueKeys:0,matchingResourceCount:0,complete:true,incompleteReason:null,matches:[],
        matchingPayToOtherResources:[]}, verdict:'NOT_LISTED_IN_EXHAUSTED_CATALOG'
    },null,2)+'\n');
    const {report}=normalizeSourceBytes(source);
    assert.equal(report.challenge.state,'UNPAID_GET_HTTP_200');
    const missing = interpret(report);
    assert.equal(missing.state,'REMEDIATION_REQUIRED');
    assert.equal(missing.findings[0].priority,'HIGH');
    const listed = structuredClone(report);
    listed.verdict='LISTED';
    listed.catalog.rawRows=1;
    listed.catalog.uniqueKeys=1;
    listed.catalog.matchingResourceCount=1;
    listed.catalog.matches=[{resource:listed.seller,type:'http'}];
    const listedAssessment = interpret(listed);
    assert.equal(listedAssessment.state,'REMEDIATION_REQUIRED');
    assert.equal(listedAssessment.findings[0].priority,'HIGH');
    assert.match(listedAssessment.findings[0].action,/free access opt-in/);
    const legacy=structuredClone(listed);
    legacy.challenge={state:'NOT_HTTP_402',httpStatus:200};
    assert.equal(interpret(legacy).findings[0].priority,'HIGH');
    assert.match(renderReport(report),/Unauthenticated seller GET returned HTTP 200/);
    const out=join(root,'report');
    await writePackage({source,out,capturedAt:'2026-10-10T22:00:00.000Z'});
    const verified=await verifyPackage(out);
    assert.equal(verified.verified,true);
    assert.equal((await readFile(join(out,'evidence.json'))).toString(),source.toString());
    assert.match((await readFile(join(out,'index.html'),'utf8')),/script-src &#39;none&#39;|script-src 'none'/);
    await assert.rejects(writePackage({source,out}),/EEXIST/);
    await writeFile(join(out,'index.html'),'tamper');
    await assert.rejects(verifyPackage(out),/Checksum mismatch/);
    const mismatch=structuredClone(report);mismatch.catalog.complete=false;
    assert.throws(()=>normalizeSourceBytes(Buffer.from(JSON.stringify(mismatch))),/Contradictory/);
  } finally {await rm(root,{recursive:true,force:true});}
});
