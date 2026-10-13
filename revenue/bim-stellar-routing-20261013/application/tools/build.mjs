#!/usr/bin/env node
// MIT. Build the installed browser and seal one exact BIM application before use.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {confined,writeExact,lease,syncDirectory} from '../lib/files.mjs';
import {need,bytes,hash,identity} from '../lib/value.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const GENERATED=['BUILD_SELECTION.json','web/wallet-entry.bundle.mjs','web/wallet-entry.bundle.css','web/wallet-entry.bundle.mjs.LEGAL.txt','web/wallet-entry.bundle.css.LEGAL.txt','build-metafile.json','dependency-inputs.json','BUILD_RECEIPT.json','source-files.json'];
async function original(relative){
 const file=await confined(ROOT,relative),h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await h.stat({bigint:true});need(before.isFile()&&before.size<=512n*1024n*1024n,'ORDINARY_BOUNDED_BUILD_INPUT');const data=await h.readFile();const after=await h.stat({bigint:true});need(before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'BUILD_INPUT_CHANGED');await h.sync();return {path:relative,bytes:data.length,sha256:hash(data),data};}finally{await h.close();}
}
const publicDescriptor=({path,bytes,sha256})=>({path,bytes,sha256});
async function maybe(relative){try{return await original(relative);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function syncSelected(row){const actual=await original(row.path);need(actual.bytes===row.bytes&&actual.sha256===row.sha256,'BUILD_INPUT_CHANGED',{path:row.path});await syncDirectory(path.dirname(await confined(ROOT,row.path)));return publicDescriptor(actual);}
async function publication(relative,data){await writeExact(await confined(ROOT,relative,true),data,0o644);return await syncSelected({path:relative,bytes:data.length,sha256:hash(data)});}
function requiredRoster(input){
 need(input?.schema==='bim.authored-source.v1'&&Array.isArray(input.files)&&input.files.length>=25,'AUTHORED_SOURCE_REQUIRED');
 need(new Set(input.files.map(x=>x.path)).size===input.files.length,'DUPLICATE_AUTHORED_SOURCE');
 for(const name of ['tools/build.mjs','package.json','providers/index.mjs','lib/workspace.mjs','lib/moneygram.mjs','lib/socket.mjs','web/wallet-entry.mjs','web/index.html','web/app.mjs','BACKEND.md'])need(input.files.some(f=>f.path===name),'INCOMPLETE_AUTHORED_SOURCE',{path:name});
 for(const f of input.files)need(f.path!=='source-inputs.json'&&f.path!=='package-lock.json'&&!GENERATED.includes(f.path)&&!f.path.startsWith('node_modules/'),'AUTHORED_GENERATED_COLLISION');
}
async function completed(manifestFile,source,lock){
 const manifest=JSON.parse(manifestFile.data),receiptFile=await original('BUILD_RECEIPT.json'),receipt=JSON.parse(receiptFile.data);
 need(manifest.schema==='bim.installed-source.v1'&&receipt.schema==='bim.browser-build.v1'&&receipt.status==='COMPLETE','BUILD_COMPLETION_SCHEMA');
 need(receipt.authoredSource.sha256===source.sha256&&receipt.authoredSource.bytes===source.bytes&&receipt.packageLock.sha256===lock.sha256&&receipt.packageLock.bytes===lock.bytes,'BUILD_SELECTION_CHANGED');
 need(Array.isArray(manifest.files)&&new Set(manifest.files.map(f=>f.path)).size===manifest.files.length&&!manifest.files.some(f=>f.path==='source-files.json'),'BUILD_MANIFEST_ROSTER');
 const sourceRows=JSON.parse(source.data).files,expected=[...sourceRows.map(f=>f.path),'source-inputs.json','package-lock.json',...GENERATED.filter(p=>p!=='source-files.json')].sort();
 need(identity(manifest.files.map(f=>f.path).sort())===identity(expected),'BUILD_MANIFEST_INCOMPLETE');
 for(const f of manifest.files)await syncSelected(f);
 for(const f of receipt.outputs)need(manifest.files.some(m=>m.path===f.path&&m.bytes===f.bytes&&m.sha256===f.sha256),'BUILD_OUTPUT_BINDING');
 need(manifest.files.some(f=>f.path==='BUILD_RECEIPT.json'&&f.sha256===receiptFile.sha256),'BUILD_RECEIPT_BINDING');
 await syncDirectory(ROOT);return {status:'COMPLETE',replayed:true,manifest:publicDescriptor(manifestFile),receipt};
}
export async function build(){
 const [major,minor]=process.versions.node.split('.').map(Number);need(process.platform==='linux'&&(major>22||major===22&&minor>=16),'LINUX_NODE_22_16_REQUIRED');
 const owner=await lease(ROOT,'installation-build');let esbuild=null;
 try{
  const source=await original('source-inputs.json'),selection=JSON.parse(source.data);requiredRoster(selection);
  for(const f of selection.files)await syncSelected(f);
  const lock=await original('package-lock.json'),packageFile=await original('package.json'),pkg=JSON.parse(packageFile.data),resolved=JSON.parse(lock.data);
  need(resolved.lockfileVersion>=2&&resolved.packages?.[''],'EXACT_NPM_LOCK_REQUIRED');
  for(const [name,version]of Object.entries({...pkg.dependencies,...pkg.devDependencies})){
   need(resolved.packages['node_modules/'+name]?.version===version,'PINNED_DEPENDENCY_CHANGED',{name});
   const actual=JSON.parse((await original('node_modules/'+name+'/package.json')).data);need(actual.version===version,'INSTALLED_DEPENDENCY_CHANGED',{name});
  }
  const existing=await maybe('source-files.json');if(existing)return await completed(existing,source,lock);
  need(!await maybe('bim.sqlite'),'WORKSPACE_MUST_BE_OUTSIDE_INSTALLATION');
  const selectionReceipt={schema:'bim.build-selection.v1',authoredSource:publicDescriptor(source),packageLock:publicDescriptor(lock),package:publicDescriptor(packageFile),versions:{node:process.versions.node,esbuild:pkg.devDependencies.esbuild,stellarSdk:pkg.dependencies['@stellar/stellar-sdk'],walletsKit:pkg.dependencies['@creit.tech/stellar-wallets-kit']},options:{platform:'browser',format:'esm',target:['es2022'],bundle:true,legalComments:'linked',minify:false}};
  await publication('BUILD_SELECTION.json',bytes(selectionReceipt));
  // The outer original process owner retains/drains esbuild's native child before
  // accepting this build. This entry never starts a provider, signer or workspace.
  esbuild=await import('esbuild');need(esbuild.version===pkg.devDependencies.esbuild,'ESBUILD_VERSION_CHANGED');
  const result=await esbuild.build({absWorkingDir:ROOT,entryPoints:['web/wallet-entry.mjs'],outfile:'web/wallet-entry.bundle.mjs',...selectionReceipt.options,write:false,metafile:true,logLevel:'silent',charset:'utf8'});
  esbuild.stop();esbuild=null;
  const outputs=new Map();for(const out of result.outputFiles){const relative=path.relative(ROOT,path.resolve(out.path)).split(path.sep).join('/');need(GENERATED.includes(relative)&&!outputs.has(relative),'UNEXPECTED_BUNDLE_OUTPUT',{path:relative});outputs.set(relative,Buffer.from(out.contents));}
  need(outputs.has('web/wallet-entry.bundle.mjs'),'BROWSER_BUNDLE_MISSING');
  for(const relative of GENERATED.slice(1,5))if(!outputs.has(relative))outputs.set(relative,Buffer.alloc(0));
  for(const output of Object.values(result.metafile.outputs))need(!(output.imports??[]).some(i=>i.external),'UNBUNDLED_BROWSER_IMPORT');
  const dependencies=[];for(const name of Object.keys(result.metafile.inputs).sort()){
   const absolute=path.resolve(ROOT,name),relative=path.relative(ROOT,absolute).split(path.sep).join('/');
   need(relative&&!relative.startsWith('../')&&!path.isAbsolute(relative),'EXTERNAL_BUILD_INPUT');
   dependencies.push(publicDescriptor(await original(relative)));
  }
  outputs.set('build-metafile.json',bytes(result.metafile));outputs.set('dependency-inputs.json',bytes({schema:'bim.bundle-inputs.v1',files:dependencies}));
  const published=[await syncSelected(await original('BUILD_SELECTION.json'))];for(const [relative,data]of [...outputs].sort(([a],[b])=>a.localeCompare(b)))published.push(await publication(relative,data));
  for(const f of selection.files)await syncSelected(f);await syncSelected(lock);for(const f of dependencies)await syncSelected(f);
  const receipt={schema:'bim.browser-build.v1',status:'COMPLETE',authoredSource:publicDescriptor(source),packageLock:publicDescriptor(lock),selection:selectionReceipt,outputs:published,dependencyInputs:dependencies.length,warnings:result.warnings,providerExecution:false};
  const receiptDescriptor=await publication('BUILD_RECEIPT.json',bytes(receipt));
  const manifest={schema:'bim.installed-source.v1',edition:selection.edition,files:[...selection.files.map(publicDescriptor),publicDescriptor(source),publicDescriptor(lock),...published,receiptDescriptor].sort((a,b)=>a.path.localeCompare(b.path))};
  await publication('source-files.json',bytes(manifest));
  const final=await completed(await original('source-files.json'),source,lock);return {...final,replayed:false};
 }finally{try{esbuild?.stop();}finally{await owner.release();}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))build().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'BUILD_FAILED',message:error.code??'Build failed'}})+'\n');process.exitCode=1;});
