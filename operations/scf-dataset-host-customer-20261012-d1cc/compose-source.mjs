// Original pinned distribution source selection for the completed dataset host workflow.
// No package archive, dependency installation, or application dispatch occurs here.
import {constants} from 'node:fs';
import {readFile,open,mkdir,link,rename,unlink,lstat,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,posix,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const selectionFile=resolve(process.argv[2]), root=dirname(selectionFile);
const selectionRaw=await readFile(selectionFile), selection=JSON.parse(selectionRaw);
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const check=(value,message)=>{if(!value)throw Error(message)};
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const inputsRoot=join(root,'selector-input/stellar/scf-starforge-20261009/distribution');
check(selection.schema==='stellar-forge.dataset-host-source-selection.v1','Unsupported original source selection');
const originals={};
for(const [name,blob] of Object.entries(selection.inputs)){
 check(/^[a-z-]+\.mjs$/.test(name)&&/^[a-f0-9]{40}$/.test(blob),'Invalid selector input');
 const raw=await readFile(join(inputsRoot,name));
 check(git(raw)===blob,'Original selector bytes changed: '+name); originals[name]=raw;
}
const {openGitSource,MAX_SOURCE_FILE_BYTES,MAX_SOURCE_BYTES}=await import(pathToFileURL(join(inputsRoot,'git-source.mjs')).href);
const {createBrowserAssetIndex}=await import(pathToFileURL(join(inputsRoot,'browser-assets.mjs')).href);
const {distributionPath,contributionPaths,composeDistribution}=await import(pathToFileURL(join(inputsRoot,'specification.mjs')).href);
const {productPackageMetadata}=await import(pathToFileURL(join(inputsRoot,'product-package.mjs')).href);
const builder=originals['build.mjs'].toString('utf8');
const helperStart=builder.indexOf('const json = '), helperEnd=builder.indexOf('export async function buildDistribution');
const bodyStart=builder.indexOf('  const source = openGitSource',helperEnd);
const bodyEnd=builder.indexOf('  // Runtime drivers follow',bodyStart);
check(helperStart>=0&&helperEnd>helperStart&&bodyStart>helperEnd&&bodyEnd>bodyStart,'Original source collector boundaries changed');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const select=new AsyncFunction('repo','ref','offline','onProgress','pin','openGitSource','createBrowserAssetIndex',
 'MAX_SOURCE_FILE_BYTES','MAX_SOURCE_BYTES','execFileSync','createHash','resolve','posix','distributionPath',
 'contributionPaths','composeDistribution','productPackageMetadata',
 builder.slice(helperStart,helperEnd)+builder.slice(bodyStart,bodyEnd)+'\nreturn {source,spec,selected,sources,specificationPaths,distribution};');
const donorRaw=await readFile(selection.donorClosure);
check(sha(donorRaw)===selection.donorClosureSha256,'Original completed donor closure changed');
const donor=JSON.parse(donorRaw), donorByPath=new Map(donor.files.map(x=>[x.path,x]));
check(donorByPath.size===donor.files.length,'Duplicate donor path');
check(await realpath(donor.sourceRoot)===donor.sourceRoot,'Original donor path changed');
const gitOptions={cwd:selection.repository,stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'},maxBuffer:2*1024*1024};
let available=false;
try{available=execFileSync('git',['--no-replace-objects','--no-lazy-fetch','rev-parse','--verify','--end-of-options',selection.sourceCommit+'^{commit}'],gitOptions).toString().trim()===selection.sourceCommit;}catch{}
if(!available){
 console.log(JSON.stringify({phase:'fetching-selected-commit',sourceCommit:selection.sourceCommit}));
 try{execFileSync('git',['--no-replace-objects','--no-lazy-fetch','-c','fetch.negotiationAlgorithm=noop','fetch','--no-tags',
 '--no-write-fetch-head','--no-auto-maintenance','--recurse-submodules=no','--filter=blob:none','--stdin','--','origin'],
 {...gitOptions,input:selection.sourceCommit+'\n'});}
 catch(e){throw Object.assign(new Error('The configured original Git cache could not retain the selected commit.'),{code:'GIT_SELECTED_COMMIT_FAILED'});}
}
check(execFileSync('git',['--no-replace-objects','--no-lazy-fetch','rev-parse','--verify','--end-of-options',
 selection.sourceCommit+'^{tree}'],gitOptions).toString().trim()===selection.sourceTree,'Original source tree changed');
const selected=await select(selection.repository,selection.sourceCommit,false,e=>{
 if(['selected','fetching','source-needed'].includes(e.phase))console.log(JSON.stringify(e));
},null,openGitSource,createBrowserAssetIndex,MAX_SOURCE_FILE_BYTES,MAX_SOURCE_BYTES,execFileSync,createHash,resolve,posix,
 distributionPath,contributionPaths,composeDistribution,productPackageMetadata);
check(selected.source.commit===selection.sourceCommit,'Original source commit changed');
const byPath=new Map(selected.selected.map(x=>[x.path,x]));
for(const [path,blob] of Object.entries(selection.hostFiles)){
 check(byPath.get(path)?.blob===blob&&git(selected.sources.get(path))===blob,'Final host setup source differs: '+path);
}
async function exact(path,raw,mode){
 let fd;
 try{
  fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  const before=await fd.stat({bigint:true});
  if(!before.isFile()||before.size!==BigInt(raw.length)||Number(before.mode&0o777n)!==mode)return false;
  const observed=await fd.readFile(),after=await fd.stat({bigint:true}),current=await lstat(path,{bigint:true});
  return observed.equals(raw)&&['dev','ino','size','mtimeNs','ctimeNs'].every(k=>before[k]===after[k])&&
   current.isFile()&&['dev','ino','size','mtimeNs','ctimeNs'].every(k=>current[k]===after[k]);
 }catch(e){if(e.code==='ENOENT')return false;throw e}finally{await fd?.close();}
}
async function atomic(path,raw,mode){
 await mkdir(dirname(path),{recursive:true,mode:0o755});
 const tmp=join(dirname(path),'.source-'+randomUUID()+'.tmp');let fd;
 try{
  fd=await open(tmp,'wx',mode);await fd.writeFile(raw);await fd.sync();await fd.close();fd=null;
  await rename(tmp,path);const parent=await open(dirname(path),'r');try{await parent.sync()}finally{await parent.close()}
 }finally{await fd?.close();await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e});}
}
const sourceRoot=join(root,'source-b1aff2c1228ad'), files=[],counts={reused:0,linked:0,written:0,writtenBytes:0};
for(const [path,raw] of [...selected.sources].sort(([a],[b])=>a.localeCompare(b))){
 check(path&&!path.startsWith('/')&&!path.split('/').some(x=>!x||x==='.'||x==='..'),'Invalid original source path');
 const original=byPath.get(path),mode=parseInt(original?.mode,8)&0o777;
 check(original&&git(raw)===original.blob&&[0o644,0o755].includes(mode),'Original file identity changed: '+path);
 const destination=join(sourceRoot,path),prior=donorByPath.get(path);
 if(await exact(destination,raw,mode))counts.reused++;
 else{
  try{await lstat(destination);throw Error('Existing selected source differs: '+path)}catch(e){if(e.code!=='ENOENT')throw e}
  await mkdir(dirname(destination),{recursive:true,mode:0o755});
  if(prior?.gitBlob===original.blob&&prior.bytes===raw.length&&prior.sha256===sha(raw)&&
    await exact(join(donor.sourceRoot,path),raw,mode)){
   await link(join(donor.sourceRoot,path),destination);
   check(await exact(destination,raw,mode),'Linked original source changed: '+path);counts.linked++;
  }else{await atomic(destination,raw,mode);counts.written++;counts.writtenBytes+=raw.length;}
 }
 files.push({path,gitBlob:original.blob,sha256:sha(raw),bytes:raw.length,mode});
}
const closure={schema:'stellar-forge.dataset-host-source-closure.v1',sourceRoot,sourceCommit:selection.sourceCommit,
 sourceTree:selection.sourceTree,selectionSha256:sha(selectionRaw),donorClosureSha256:sha(donorRaw),
 inputs:selection.inputs,hostFiles:selection.hostFiles,components:selected.spec.components,
 contributions:selected.distribution.contributions.map(({id,path})=>({id,path})),
 originalSpecificationFiles:selected.specificationPaths.map(path=>({path,gitBlob:byPath.get(path).blob,sha256:sha(selected.sources.get(path))})),files};
const encoded=json(closure),closureFile=join(root,'source-closure-b1aff.json');
try{check((await readFile(closureFile)).equals(encoded),'Existing complete source closure differs');}
catch(e){if(e.code!=='ENOENT')throw e;await atomic(closureFile,encoded,0o644);}
console.log(JSON.stringify({status:'COMPLETE_SOURCE_COMPOSED',sourceRoot,sourceCommit:selection.sourceCommit,
 closure:closureFile,sha256:sha(encoded),files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),
 counts,sourceMetrics:selected.source.metrics()}));
