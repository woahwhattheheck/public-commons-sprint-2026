#!/usr/bin/env node
// MIT. Exercise one original package-to-host preparation without starting host services.
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {realpath,readFile,mkdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const allowed=new Set(['--source','--package','--output','--source-manifest','--manifest-sha256','--package-identity']);
const args=process.argv.slice(2),o={};
for(let i=0;i<args.length;i+=2){assert(allowed.has(args[i])&&args[i+1]&&!o[args[i]]);o[args[i]]=args[i+1];}
for(const name of ['--source','--package','--output','--source-manifest'])assert(isAbsolute(o[name]??''),'Absolute '+name+' is required');
for(const name of ['--manifest-sha256','--package-identity'])assert.match(o[name]??'',/^[a-f0-9]{64}$/,'Exact '+name+' is required');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=await realpath(o['--source']),out=resolve(o['--output']),packageRoot=await realpath(o['--package']);
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
await files.privateDirectory(out);
const pkg=await merchant.inspectGeocodePackage(packageRoot);assert.equal(pkg.manifest.identity,o['--package-identity']);
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
const staged=await merchant.stageGeocodePackage(join(out,'releases'),join(directory,'applications'),packageRoot,
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
 review:{directory,sha256:prepared.reviewSha256,handlerSha256:saved.review.handlerSha256},
 generated:reopened,originalStage:{id:'host-receiving-v1',handlerSha256:staged.handlerSha256},
 incompleteRecovery:{directory:interruptedDirectory,reviewSha256:interruptedReview.reviewSha256,
  bundle:recovered.bundle,retainedCaddyPrefix:{bytes:caddyPrefix.length,sha256:sha(caddyPrefix)},
  reusedRecovery:{bytes:expectedRecovery.length,sha256:sha(expectedRecovery)}},
 artifacts};
await files.putOnce(join(out,'host-receiving.json'),files.jsonBytes(report));
process.stdout.write(JSON.stringify({state:report.state,packageIdentity:pkg.manifest.identity,
 reviewSha256:prepared.reviewSha256,bundle:generated.bundle,artifacts:artifacts.length})+'\n');
