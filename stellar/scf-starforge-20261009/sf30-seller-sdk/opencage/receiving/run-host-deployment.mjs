#!/usr/bin/env node
// MIT. Receive a selected package and an explicitly linked generator continuation through the original host APIs.
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {realpath,readFile,mkdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const originalFlags=['--source','--package','--output','--source-manifest','--manifest-sha256','--package-identity'];
const priorFlags=['--previous-native','--previous-request-sha256','--previous-result-sha256','--previous-artifacts-sha256'];
const allowed=new Set([...originalFlags,...priorFlags]);
const args=process.argv.slice(2),o={};
for(let i=0;i<args.length;i+=2){assert(allowed.has(args[i])&&args[i+1]&&!o[args[i]]);o[args[i]]=args[i+1];}
for(const name of ['--source','--package','--output','--source-manifest'])assert(isAbsolute(o[name]??''),'Absolute '+name+' is required');
for(const name of ['--manifest-sha256','--package-identity'])assert.match(o[name]??'',/^[a-f0-9]{64}$/,'Exact '+name+' is required');
const derive=priorFlags.some(name=>o[name]!==undefined);
if(derive){
 for(const name of priorFlags)assert(o[name],'A generator continuation requires '+name);
 assert(isAbsolute(o['--previous-native']));
 for(const name of priorFlags.slice(1))assert.match(o[name],/^[a-f0-9]{64}$/);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=await realpath(o['--source']),out=resolve(o['--output']),originalPackageRoot=await realpath(o['--package']);
let packageRoot=originalPackageRoot;
const BASE='stellar/scf-starforge-20261009/';
const manifestBytes=await readFile(o['--source-manifest']);assert.equal(sha(manifestBytes),o['--manifest-sha256']);
const manifest=JSON.parse(manifestBytes);
assert.equal(manifest.sourceRoot,source);assert(Array.isArray(manifest.files));
for(const item of manifest.files){
 const r=relative(source,resolve(source,item.path));assert(r&&!r.startsWith('../')&&!isAbsolute(r));
 const bytes=await readFile(join(source,item.path));assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);
}
const here=fileURLToPath(import.meta.url);
assert(manifest.files.some(item=>resolve(source,item.path)===here),'Driver is in the original selected source');
const files=await import(pathToFileURL(join(source,BASE+'sf30-seller-sdk/twelvedata/files.mjs')));
const merchant=await import(pathToFileURL(join(source,BASE+'sf30-seller-sdk/opencage/merchant.mjs')));
const host=await import(pathToFileURL(join(source,BASE+'sf30-seller-sdk/opencage/deployment.mjs')));
const original=await import(pathToFileURL(join(source,BASE+'sf99-merchant-deploy/host.mjs')));
const cli=await import(pathToFileURL(join(source,BASE+'sf30-seller-sdk/opencage/cli.mjs')));

const {GeocodeWorkspace}=await import(pathToFileURL(join(source,BASE+'sf30-seller-sdk/opencage/workspace.mjs')));
const decode=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const canonical=async path=>{
 const absolute=resolve(path);assert.equal(await realpath(absolute),absolute,'Retain a canonical original path: '+absolute);return absolute;
};
async function originalBytes(path,limit=64*1024*1024){
 const absolute=await canonical(path),stat=await lstat(absolute);
 assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit,'Retain a complete original file: '+absolute);
 const bytes=await files.readBytes(absolute,limit);assert.equal(bytes.length,stat.size);return bytes;
}
function optionsOf(command){
 assert(Array.isArray(command)&&command.length===2+originalFlags.length*2,'Retain the original host receiving argv');
 const result={};
 for(let i=2;i<command.length;i+=2){
  assert(originalFlags.includes(command[i])&&typeof command[i+1]==='string'&&result[command[i]]===undefined);
  result[command[i]]=command[i+1];
 }
 for(const name of originalFlags)assert(result[name]);
 return result;
}
function inside(root,name){
 assert(typeof name==='string'&&name&&!isAbsolute(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Retain an original relative file');
 const path=resolve(root,name),r=relative(root,path);assert(r&&!r.startsWith('../')&&!isAbsolute(r));return path;
}
async function previousNative(){
 const record=await canonical(o['--previous-native']),records={};
 for(const [name,flag] of [['request','--previous-request-sha256'],['result','--previous-result-sha256'],['artifacts','--previous-artifacts-sha256']]){
  const bytes=await originalBytes(join(record,name+'.json'));assert.equal(sha(bytes),o[flag]);
  records[name]={bytes,value:decode(bytes)};
 }
 const request=records.request.value,result=records.result.value,artifacts=records.artifacts.value;
 assert.equal(result.state,'failed');assert.equal(result.exit_code,1);assert.equal(result.stop_requested,false);
 assert.deepEqual(result.artifacts.errors,[]);assert.deepEqual(artifacts.errors,[]);
 assert.equal(result.artifacts.files,artifacts.files.length);
 assert.equal(result.artifacts.bytes,artifacts.files.reduce((sum,item)=>sum+item.bytes,0));
 const project=await canonical(request.intent.project),old=optionsOf(request.intent.command);
 assert.equal(await canonical(old['--package']),originalPackageRoot);
 assert.equal(old['--package-identity'],o['--package-identity']);
 const oldSource=await canonical(old['--source']);
 assert.equal(resolve(request.intent.command[1]),join(oldSource,BASE+'sf30-seller-sdk/opencage/receiving/run-host-deployment.mjs'));
 const selection={always:[...new Set(request.intent.artifacts)].sort()};
 for(const [name,paths] of Object.entries(request.intent.artifact_conditions||{})){
  assert(['success','failure'].includes(name)&&Array.isArray(paths));selection[name]=[...new Set(paths)].sort();
 }
 const selected={schema:'commons.native-artifact-selection/v1',revision:0,selection,last_amendment:null,
  history:join(record,'artifact-history'),outcome:'failure',paths:[...new Set([...selection.always,...(selection.failure||[])])].sort()};
 assert.deepEqual(result.artifact_selection,selected);assert.deepEqual(artifacts.artifact_selection,selected);
 const savedFiles=new Map();
 for(const item of artifacts.files){
  assert(Number.isSafeInteger(item.bytes)&&item.bytes>=0&&/^[a-f0-9]{64}$/.test(item.sha256)&&!savedFiles.has(item.path));
  const path=inside(project,item.path),bytes=await originalBytes(path);assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);
  savedFiles.set(item.path,bytes);
 }
 const sourceRelative=relative(project,resolve(old['--source-manifest'])),oldManifestBytes=savedFiles.get(sourceRelative);
 assert(oldManifestBytes,'The preceding native artifacts retain its selected source manifest');
 assert.equal(sha(oldManifestBytes),old['--manifest-sha256']);
 const oldManifest=decode(oldManifestBytes);assert.equal(oldManifest.sourceRoot,oldSource);assert(Array.isArray(oldManifest.files));
 const originalDriver=oldManifest.files.find(item=>resolve(oldSource,item.path)===resolve(request.intent.command[1]));
 assert(originalDriver&&/^[a-f0-9]{64}$/.test(originalDriver.sha256));
 const log=await originalBytes(join(record,'output.log'),16*1024*1024);
 assert(log.includes(Buffer.from('GEOCODE_PACKAGE_CONTRACT_CHANGED')),'Retain the original package-contract failure');
 return {records,savedFiles,log,summary:{record,operationId:request.intent.operation_id,
  project,endedAt:result.ended_at,state:result.state,exitCode:result.exit_code,
  requestSha256:sha(records.request.bytes),resultSha256:sha(records.result.bytes),
  artifactsSha256:sha(records.artifacts.bytes),outputLogSha256:sha(log),outputLogBytes:log.length,
  source:{directory:oldSource,manifestSha256:sha(oldManifestBytes),sourceCommit:oldManifest.sourceCommit,
   driver:{path:originalDriver.path,bytes:originalDriver.bytes,sha256:originalDriver.sha256}},
  command:request.intent.command,selectedArtifacts:artifacts.files}};
}
async function retainCopy(path,bytes){
 await files.privateDirectory(dirname(path));await files.putOnce(path,bytes);
}
async function retainPrevious(previous){
 for(const [name,value] of Object.entries(previous.records))await retainCopy(join(out,'previous-native',name+'.json'),value.bytes);
 await retainCopy(join(out,'previous-native','output.log'),previous.log);
 for(const [name,bytes] of previous.savedFiles)await retainCopy(join(out,'previous-native','files',name),bytes);
}
function inventoryDiff(before,after){
 const names=[...new Set([...before.files.keys(),...after.files.keys()])].sort();
 return names.map(name=>{
  const a=before.files.get(name),b=after.files.get(name);
  return {name,state:!a?'ADDED':!b?'REMOVED':a.equals(b)?'UNCHANGED':'CHANGED',
   before:a?{bytes:a.length,sha256:sha(a)}:null,after:b?{bytes:b.length,sha256:sha(b)}:null};
 });
}

await files.privateDirectory(out);
let pkg,lineage=null,packageImport=null;
if(derive){
 const previous=await previousNative();
 const old=await files.readBundle(originalPackageRoot,{schema:merchant.PACKAGE});
 assert.equal(old.manifest.identity,o['--package-identity']);
 assert.equal(sha(files.jsonBytes(old.manifest.files.map(item=>({name:item.name,sha256:item.sha256})))),old.manifest.identity);
 for(const name of ['plan.json','terms.json','spec.json','selections.json','bindings.json','runtime-binding.json'])assert(old.files.has(name));
 assert.equal(sha(old.files.get('plan.json')),old.manifest.planSha256);
 assert.equal(sha(old.files.get('terms.json')),old.manifest.termsSha256);
 assert.equal(old.manifest.planId,decode(old.files.get('plan.json')).id);
 const recompileIntent={schema:'stellar-forge.opencage-generator-continuation-intent.v1',
  originalPackage:{directory:originalPackageRoot,identity:old.manifest.identity,manifestSha256:old.manifestSha256,
   planSha256:old.manifest.planSha256,termsSha256:old.manifest.termsSha256},
  previousNative:previous.summary,
  generator:{directory:source,manifestSha256:sha(manifestBytes),sourceCommit:manifest.sourceCommit},
  destination:join(out,'merchant-package')};
 await files.putOnce(join(out,'recompile-intent.json'),files.jsonBytes(recompileIntent));
 await retainPrevious(previous);
 await retainCopy(join(out,'original-package','manifest.json'),await originalBytes(join(originalPackageRoot,'manifest.json')));
 for(const [name,bytes] of old.files)await retainCopy(join(out,'original-package',name),bytes);
 packageRoot=join(out,'merchant-package');
 const generatedPackage=await cli.main(['package','--plan',join(originalPackageRoot,'plan.json'),
  '--terms',join(originalPackageRoot,'terms.json'),'--out',packageRoot]);
 pkg=await merchant.inspectGeocodePackage(packageRoot);
 assert.equal(generatedPackage.manifest.identity,pkg.manifest.identity);
 assert.equal(generatedPackage.manifestSha256,pkg.manifestSha256);
 assert.notEqual(pkg.manifest.identity,old.manifest.identity,'Retain a distinct edition for the selected generator');
 for(const name of ['plan.json','terms.json','spec.json','selections.json','bindings.json','runtime-binding.json'])
  assert.deepEqual(pkg.files.get(name),old.files.get(name),'Retain the exact reviewed '+name);
 const changes=inventoryDiff(old,pkg);
 assert.deepEqual(changes.filter(item=>item.state!=='UNCHANGED').map(item=>[item.name,item.state]),[
  ['offers.json','CHANGED'],['openapi.json','CHANGED'],['sdk/README.md','CHANGED'],
  ['sdk/seller-client.d.mts','CHANGED'],['sdk/seller-client.mjs','CHANGED'],['seller-service.json','CHANGED']]);
 const reread=await files.readBundle(originalPackageRoot,{schema:merchant.PACKAGE});
 assert.equal(reread.manifestSha256,old.manifestSha256);
 for(const [name,bytes] of old.files)assert.deepEqual(reread.files.get(name),bytes);
 const workspaceDirectory=join(out,'workspace');
 const workspace=await GeocodeWorkspace.open(workspaceDirectory,{plan:decode(old.files.get('plan.json')),terms:decode(old.files.get('terms.json'))});
 let primary;
 try{
  const imported=await workspace.importPackage(packageRoot);
  assert.equal(imported.packageId,'merchant-'+pkg.manifest.identity.slice(0,24));
  assert.equal(imported.manifestSha256,pkg.manifestSha256);
  const received=await merchant.inspectGeocodePackage(imported.directory);
  assert.equal(received.manifestSha256,pkg.manifestSha256);
  for(const [name,bytes] of pkg.files)assert.deepEqual(received.files.get(name),bytes);
  packageImport={workspace:workspaceDirectory,packageId:imported.packageId,directory:imported.directory,
   identity:received.manifest.identity,manifestSha256:received.manifestSha256};
 }catch(error){primary=error;throw error;}
 finally{try{await workspace.close();}catch(error){if(primary)throw new AggregateError([primary,error],'Package import and original workspace close failed');throw error;}}
 const reopened=await GeocodeWorkspace.open(workspaceDirectory,{readOnly:true});
 try{
  const selected=(await reopened.listPackages()).find(item=>item.packageId===packageImport.packageId);
  assert.deepEqual(selected?.manifest,pkg.manifest);
 }finally{await reopened.close();}
 lineage={schema:'stellar-forge.opencage-generator-continuation.v1',
  intentSha256:sha(files.jsonBytes(recompileIntent)),originalPackage:recompileIntent.originalPackage,
  previousNative:previous.summary,generator:recompileIntent.generator,
  package:{directory:packageRoot,identity:pkg.manifest.identity,manifestSha256:pkg.manifestSha256,
   planSha256:pkg.built.planSha256,termsSha256:pkg.built.termsSha256},imported:packageImport,changes};
 await files.putOnce(join(out,'package-lineage.json'),files.jsonBytes(lineage));
 const inspected=await cli.main(['package-inspect','--package',packageRoot]);
 assert.deepEqual(inspected.manifest,pkg.manifest);
}else{
 pkg=await merchant.inspectGeocodePackage(packageRoot);assert.equal(pkg.manifest.identity,o['--package-identity']);
}
const profilePath=join(out,'host-settings.json'),envPath=join(out,'opencage.env');
await files.putOnce(envPath,Buffer.from('# Private operator-owned environment; host preparation reads metadata only.\n'));
const settings={schema:original.SCHEMA,merchant:'opencage-receiving',kind:'api',mode:'challenge',
 serviceUser:'nobody',serviceGroup:'nogroup',privateRoot:join(out,'merchant-state'),environmentFile:envPath,
 ports:{seller:18423,operations:18424},runtime:{node:await realpath(process.execPath),python:'/usr/bin/python3'},
 maxInFlight:16,drainGraceMs:60000,historyDays:90};
await files.putOnce(profilePath,files.jsonBytes(settings));
const directory=join(out,'deployment');
const prepared=await cli.main(['host-review','--package',packageRoot,'--host-plan',profilePath,'--out',directory]);
const repeated=await host.prepareGeocodeDeployment({packageDirectory:packageRoot,hostPlanFile:profilePath,directory});
assert.equal(repeated.reviewSha256,prepared.reviewSha256);assert.equal(repeated.reused,true);
const generated=await cli.main(['host-bundle','--deployment',directory,'--review-sha256',prepared.reviewSha256]);
assert.equal(generated.state,'BUNDLE_CHECKED');
const reopened=await cli.main(['host-check','--deployment',directory]);
assert.deepEqual(reopened,{...generated,reused:true});
const reused=await host.generateGeocodeDeployment({directory,expectedReviewSha256:prepared.reviewSha256});
assert.deepEqual(reused,reopened);
const saved=await host.inspectGeocodeDeployment(directory),originalBundle=await original.checkBundle(generated.bundle);
assert.equal(saved.review.package.identity,pkg.manifest.identity);
assert.equal(saved.review.package.termsSha256,pkg.built.termsSha256);
assert.deepEqual(saved.review.commercial.paymentOptions,pkg.built.terms.paymentOptions);
assert.equal(originalBundle.publicOrigin,pkg.built.terms.publicOrigin);
const generatedEntry=await readFile(saved.review.handler.path);assert.equal(sha(generatedEntry),saved.review.handlerSha256);
let staged;
if(packageImport){
 const workspace=await GeocodeWorkspace.open(packageImport.workspace);let primary;
 try{
  staged=await workspace.stage({packageId:packageImport.packageId,id:'host-receiving-v1',
   label:'Original source and terms with reviewed generator continuation'});
 }catch(error){primary=error;throw error;}
 finally{try{await workspace.close();}catch(error){if(primary)throw new AggregateError([primary,error],'Original release staging and workspace close failed');throw error;}}
}else staged=await merchant.stageGeocodePackage(join(out,'releases'),join(directory,'applications'),packageRoot,
 {id:'host-receiving-v1',label:'Original package host receiving'});
assert.equal(staged.handlerSha256,saved.review.handlerSha256);
assert.equal(staged.packageIdentity,pkg.manifest.identity);
const interruptedDirectory=join(out,'incomplete-deployment');
const interruptedReview=await host.prepareGeocodeDeployment({
 packageDirectory:packageRoot,hostPlanFile:profilePath,directory:interruptedDirectory});
const interruptedSaved=await host.inspectGeocodeDeployment(interruptedDirectory);
const interruptedBundle=join(interruptedDirectory,'host');
if(!await files.exists(interruptedBundle))await mkdir(interruptedBundle,{mode:0o700});
const expectedCaddy=Buffer.from(original.caddyfile(interruptedSaved.review.host));
const caddyPrefix=expectedCaddy.subarray(0,Math.max(1,Math.floor(expectedCaddy.length/3)));
const expectedRecovery=files.jsonBytes(original.recoveryPlan(interruptedSaved.review.host));
const caddyPath=join(interruptedBundle,'Caddyfile'),recoveryPath=join(interruptedBundle,'recovery-plan.json');
// Retain actual generator bytes: one interrupted file and one complete file.
// A repeated receiving command rejoins these same original files and review.
if(!await files.exists(caddyPath))await files.putOnce(caddyPath,caddyPrefix);
if(!await files.exists(recoveryPath))await files.putOnce(recoveryPath,expectedRecovery);
const caddyBefore=await lstat(caddyPath),recoveryBefore=await lstat(recoveryPath);
const interrupted=await host.checkGeocodeDeployment(interruptedDirectory);
if(interrupted.state!=='BUNDLE_CHECKED'){
 assert.equal(interrupted.state,'HOST_BUNDLE_INCOMPLETE');
 assert.deepEqual(interrupted.recovery,{command:'host-bundle',directory:interruptedDirectory,
  expectedReviewSha256:interruptedReview.reviewSha256});
}
const recovered=await host.generateGeocodeDeployment({
 directory:interruptedDirectory,expectedReviewSha256:interruptedReview.reviewSha256});
assert.equal(recovered.state,'BUNDLE_CHECKED');
assert.equal(recovered.directory,interruptedDirectory);
assert.equal(recovered.reviewSha256,interruptedReview.reviewSha256);
assert.equal(recovered.packageIdentity,pkg.manifest.identity);
assert.equal(recovered.termsSha256,pkg.built.termsSha256);
assert.equal(recovered.bundle,interruptedBundle);
assert.deepEqual(await readFile(caddyPath),expectedCaddy);
assert.deepEqual(await readFile(recoveryPath),expectedRecovery);
const caddyAfter=await lstat(caddyPath),recoveryAfter=await lstat(recoveryPath);
assert.equal(caddyAfter.dev,caddyBefore.dev);assert.equal(caddyAfter.ino,caddyBefore.ino);
assert.equal(recoveryAfter.dev,recoveryBefore.dev);assert.equal(recoveryAfter.ino,recoveryBefore.ino);
assert.equal(recoveryAfter.mtimeMs,recoveryBefore.mtimeMs);
assert.deepEqual(await host.checkGeocodeDeployment(interruptedDirectory),{...recovered,reused:true});
assert.deepEqual(await host.generateGeocodeDeployment({
 directory:interruptedDirectory,expectedReviewSha256:interruptedReview.reviewSha256}),{...recovered,reused:true});
const artifacts=[];
for(const name of generated.files){
 const bytes=await readFile(join(generated.bundle,name));artifacts.push({path:'deployment/host/'+name,bytes:bytes.length,sha256:sha(bytes)});
}
const report={schema:'stellar-forge.opencage-host-receiving.v1',state:'COMPLETE',
 source:{directory:source,manifestSha256:sha(manifestBytes),sourceCommit:manifest.sourceCommit},
 package:{directory:packageRoot,identity:pkg.manifest.identity,manifestSha256:pkg.manifestSha256,
  termsSha256:pkg.built.termsSha256,publicOrigin:pkg.built.terms.publicOrigin},
 ...(lineage?{packageLineage:{path:'package-lineage.json',bytes:files.jsonBytes(lineage).length,sha256:sha(files.jsonBytes(lineage)),...lineage}}:{}),
 review:{directory,sha256:prepared.reviewSha256,handlerSha256:saved.review.handlerSha256},
 generated:reopened,originalStage:{id:'host-receiving-v1',handlerSha256:staged.handlerSha256,...(packageImport?{packageId:packageImport.packageId,workspace:packageImport.workspace}:{})},
 incompleteRecovery:{directory:interruptedDirectory,reviewSha256:interruptedReview.reviewSha256,
  bundle:recovered.bundle,retainedCaddyPrefix:{bytes:caddyPrefix.length,sha256:sha(caddyPrefix)},
  reusedRecovery:{bytes:expectedRecovery.length,sha256:sha(expectedRecovery)}},
 artifacts};
await files.putOnce(join(out,'host-receiving.json'),files.jsonBytes(report));
process.stdout.write(JSON.stringify({state:report.state,packageIdentity:pkg.manifest.identity,
 reviewSha256:prepared.reviewSha256,bundle:generated.bundle,artifacts:artifacts.length})+'\n');
