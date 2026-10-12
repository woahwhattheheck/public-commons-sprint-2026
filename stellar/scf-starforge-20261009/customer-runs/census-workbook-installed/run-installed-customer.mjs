// MIT. Installed Census workbook customer, followed by the original Rust buyer.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const work=resolve(process.env.SCF_CENSUS_WORKSPACE||here);
const required=name=>{const value=process.env[name];if(!value)throw Error(name+' is required');return resolve(value);};
const packageRoot=required('SCF_MERCHANT_PACKAGE'),binary=required('SCF_RUST_BINARY');
const source='e28755f20dd4f9cb932d82fb59feb48424e327e7';
const manifestSha256='267cd1292c8e542e8a70134c814bba7d624d2b375191a8892fb269f226bf4ff7';
const binarySha256='d895ec3cf3dc8056d74f8a3b15a91d1f5ecd3940db1cd0012b0fc5234669b7b9';
const digest=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p,v)=>{await fs.writeFile(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});await fs.chmod(p,0o600);};
assert.equal(digest(await fs.readFile(join(packageRoot,'manifest.json'))),manifestSha256,'original installed package manifest');
const upgradeCommit='d723d8709de2495b865fa2073f5e7ff844cac262';
const upgradePrefix='source/stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/';
const upgrades=[];
for(const [name,expected] of [
 ['versions.mjs','079e4f8eca9819b7cd916579e34f703664ef4346'],
 ['writer-lease.mjs','b0d0207910ffc77e6b8bd0a8c5558c52c5c8dbea']
]){
 const path=upgradePrefix+name,bytes=await fs.readFile(join(packageRoot,path));
 const gitBlobSha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
 assert.equal(gitBlobSha,expected,'maintained writer upgrade '+name);
 upgrades.push({path,gitBlobSha,sha256:digest(bytes),bytes:bytes.length});
}
assert.equal(digest(await fs.readFile(binary)),binarySha256,'original released Rust binary');
const inputs=[
 {year:2023,bytes:13138,sha256:'c884b6c56f0951b8fbc28217b00577fbc22e2372dc375686d024e507c4e8d807'},
 {year:2024,bytes:13432,sha256:'14a61938cff58166ef265af9a324b8a6f4cf6040f8630634e5711cb5b07e2cf5'}
];
for(const input of inputs){
 const destination=join(work,'inputs',input.year+'_Jam_Values.xlsx');
 let b;
 try{b=await fs.readFile(destination);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const url='https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/'+input.year+'_Jam_Values.xlsx';
  const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
  if(!response.ok){await response.body?.cancel();throw Error('Original Census workbook HTTP '+response.status);}
  const parts=[];let bytes=0;
  for await(const part of response.body){
   bytes+=part.length;
   if(bytes>input.bytes)throw Error('Original Census workbook exceeds its pinned size');
   parts.push(part);
  }
  b=Buffer.concat(parts);
  assert.equal(b.length,input.bytes);assert.equal(digest(b),input.sha256);
  await fs.mkdir(dirname(destination),{recursive:true,mode:0o700});
  const handle=await fs.open(destination,'wx',0o600);
  try{await handle.writeFile(b);await handle.sync();}finally{await handle.close();}
 }
 assert.equal(b.length,input.bytes);assert.equal(digest(b),input.sha256);
}
process.env.SCF_CENSUS_WORKSPACE=work;
await import(pathToFileURL(join(here,'operator-browser-journey.mjs')));
if(process.exitCode)throw Error('The original workbook customer phase failed; retain browser-run/last-error.json and resume the same workspace.');
const run=join(work,'browser-run'),native=await json(join(run,'result.json'));
assert.equal(native.status,'PASS');assert.equal(native.actualSourceRows,16);
const rust=join(run,'rust-customer'),state=join(rust,'operator'),delivery=join(rust,'delivery');
await fs.mkdir(rust,{recursive:true,mode:0o700});await fs.chmod(rust,0o700);
const runtime=join(packageRoot,'source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli');
const common=['--runtime',runtime,'--node',process.execPath,'--state',state];
let sequence=0;const commands=[];
async function call(name,args,{records=false}={}){
 const result=await new Promise((res,rej)=>{
  const child=spawn(binary,[...common,...args],{stdio:['ignore','pipe','pipe']});
  const out=[],err=[];let size=0;
  child.stdout.on('data',b=>{size+=b.length;if(size>8*1024*1024)child.kill('SIGTERM');out.push(b);});
  child.stderr.on('data',b=>err.push(b));
  child.on('error',rej);child.on('close',(code,signal)=>res({code,signal,out:Buffer.concat(out),err:Buffer.concat(err)}));
 });
 const prefix=String(++sequence).padStart(2,'0')+'-'+name;
 await fs.writeFile(join(rust,prefix+'.stdout'),result.out,{mode:0o600});
 await fs.writeFile(join(rust,prefix+'.stderr'),result.err,{mode:0o600});
 assert.equal(result.code,0,name+': '+result.err.toString('utf8'));
 commands.push({name,exitCode:result.code});
 const text=result.out.toString('utf8');
 return records?text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):JSON.parse(text);
}
const id='census-jam-2023-rust-installed';
const attachment=join(rust,'attachment.json'),deliveryArgs=join(rust,'delivery.json'),selection=join(rust,'selection.json');
await write(attachment,{id,directory:join(run,'acquisition'),accountingOnly:false});
await write(deliveryArgs,{destination:delivery});
await write(selection,{kind:'dataset',id,destination:delivery,name:'dataset.csv'});
await call('ready',['ready']);
await call('attach',['dataset','attach','--args',attachment]);
await call('recover',['dataset',id,'recover']);
await call('inspect',['dataset',id,'inspect']);
await call('deliver',['dataset',id,'deliver','--args',deliveryArgs]);
await call('verify',['file',selection,'verify']);
const rows=await call('typed-records',['file',selection,'records','dataset'],{records:true});
assert.equal(rows.length,16);assert(rows.every(r=>typeof r.lower_value==='number'&&typeof r.upper_value==='number'));
const zeroTopics=rows.filter(r=>r.lower_value===0).map(r=>r.topic).sort();
assert.deepEqual(zeroTopics,['Age','Duration of Marriage','Rooms'].sort());
assert(rows.some(r=>r.lower_meaning==='Less than $100 '));
assert.equal(rows.find(r=>r.topic==='Year Moved In').upper_value,2022);
const copied=join(rust,'received-copy.csv');
await call('copy',['file',selection,'copy',copied]);
const original=await fs.readFile(join(delivery,'dataset.csv'));
assert.equal(digest(await fs.readFile(copied)),digest(original));
await call('reopen-recover',['dataset',id,'recover']);
await call('reopen-verify',['file',selection,'verify']);
const screenshots=[];
for(const name of ['merchant-desktop.png','merchant-mobile.png','annual-review-desktop.png','annual-review-mobile.png']){
 try{const bytes=await fs.readFile(join(run,name));screenshots.push({name,bytes:bytes.length,sha256:digest(bytes)});}
 catch(e){if(e.code!=='ENOENT')throw e;}
}
const result={
 schema:'stellar-forge.installed-census-customer-result.v1',status:'PASS',completedAt:new Date().toISOString(),
 source:{baseCommit:source,basePackageManifestSha256:manifestSha256,upgrades:[{commit:upgradeCommit,files:upgrades}],rustCommit:'712ae7f7d9fac5d2e3d3c239ac9dedf28d2d0f62',rustBinarySha256:binarySha256},
 runtime:{platform:process.platform,architecture:process.arch,node:process.version},
 inputs,phases:native.phases.map(p=>({name:p.name,completedAt:p.completedAt})),
 workbook:{rows:16,sheet:'Jam Values',range:'A20:G36',originalSnapshot:native.candidateSnapshot},
 annual:{changed:native.annual.counts.changed,unchanged:native.annual.counts.unchanged,snapshot:native.annual.snapshot},
 rust:{commands,records:rows.length,zeroTopics,trailingWhitespacePreserved:true,originalYearMovedInUpper:2022,datasetSha256:digest(original),copiedSha256:digest(await fs.readFile(copied))},
 screenshots
};
await write(join(work,'public-native-result.json'),result);
console.log(JSON.stringify(result));
