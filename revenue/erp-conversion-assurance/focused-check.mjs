#!/usr/bin/env node
// Focused actual changed-behavior verification only: PASS, numeric mismatch, duplicate-key admission.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const dir=await mkdtemp(join(tmpdir(),'erp-qa-'));
const cli=new URL('./reconcile.mjs',import.meta.url).pathname;
const spec=JSON.stringify({version:1,dataset:'internal-fixture',keys:['id'],amounts:[{name:'balance',scale:2,tolerance:'0.00'}],source_columns:{id:'ID',balance:'Amount'},target_columns:{id:'ID',balance:'Amount'},group_by:['id']});
const run=async(target)=>{
  await writeFile(join(dir,'target.csv'),target);
  try{execFileSync(process.execPath,[cli,'--spec',join(dir,'spec.json'),'--source',join(dir,'source.csv'),'--target',join(dir,'target.csv'),'--out',join(dir,'report.json')],{env:{...process.env,ERP_RECON_HMAC_KEY:'focused-local-test-secret-acceptable-length'},stdio:'pipe'});}catch(e){if(e.status!==2)throw e;}
  return JSON.parse(await readFile(join(dir,'report.json'),'utf8'));
};
try{
 await writeFile(join(dir,'spec.json'),spec);await writeFile(join(dir,'source.csv'),'ID,Amount\n"one,quoted",1.00\ntwo,2.00\n');
 const ok=await run('ID,Amount\n"one,quoted",1.00\ntwo,2.00\n');
 if(ok.status!=='PASS'||ok.source.rows!==2||ok.target.rows!==2)throw Error('PASS contract failed');
 const mismatch=await run('ID,Amount\n"one,quoted",1.01\ntwo,2.00\n');
 if(mismatch.status!=='FAIL'||mismatch.counts.amount_delta!==1||mismatch.counts.group_delta!==1)throw Error('Mismatch contract failed');
 if(JSON.stringify(mismatch).includes('one,quoted'))throw Error('Raw key leaked in report');
 const duplicate=await run('ID,Amount\n"one,quoted",1.00\n"one,quoted",1.00\ntwo,2.00\n');
 if(duplicate.status!=='FAIL'||duplicate.counts.duplicate_in_target!==1)throw Error('Duplicate contract failed');
 console.log('FOCUSED PASS 3/3: matching composite CSV; exact fixed-point mismatch; duplicate keys + HMAC-redacted identity.');
}finally{await rm(dir,{recursive:true,force:true})}
