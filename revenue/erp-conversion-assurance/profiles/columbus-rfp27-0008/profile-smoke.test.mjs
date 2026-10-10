// One focused exact-W2 source integration diagnostic, no network or provider data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const local=name=>fileURLToPath(new URL(name, import.meta.url));
const engine=local('../../reconcile.mjs');
const diagnosticSecret='not-a-real-secret-diagnostic-only';

function run(profile,source,target){
  const folder=mkdtempSync(join(tmpdir(),'col-rfp27-0008-'));
  const output=join(folder,'private-diagnostic.json');
  try {
    const x=spawnSync(process.execPath,[engine,'--spec',local(profile),'--source',local(source),'--target',local(target),'--out',output],{encoding:'utf8',env:{...process.env,ERP_RECON_HMAC_KEY:diagnosticSecret},timeout:20000});
    if(x.error) throw x.error;
    const report=JSON.parse(readFileSync(output,'utf8'));
    return {exit:x.status,report,stderr:x.stderr};
  } finally {rmSync(folder,{recursive:true,force:true});}
}

test('approved-shape GL fixture passes and payroll cent drift fails via W2 engine',()=>{
  const gl=run('gl.profile.json','sample-gl.source.csv','sample-gl.target.csv');
  assert.equal(gl.exit,0,gl.stderr);
  assert.equal(gl.report.status,'PASS');
  assert.equal(gl.report.source.rows,4);
  assert.equal(gl.report.counts.duplicate_in_source,0);
  const payroll=run('payroll.profile.json','sample-payroll.source.csv','sample-payroll.target.csv');
  assert.equal(payroll.exit,2,payroll.stderr);
  assert.equal(payroll.report.status,'FAIL');
  assert.equal(payroll.report.counts.amount_delta,1);
  assert.ok(payroll.report.discrepancies.some(d=>d.kind==='AMOUNT_DELTA' && d.amount==='net_pay' && d.delta_target_minus_source==='0.01'));
  assert.equal(payroll.report.source.rows,2);
});
