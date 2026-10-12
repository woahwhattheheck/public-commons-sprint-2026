#!/usr/bin/env node
// MIT. Exercise one original package-to-host preparation without starting host services.
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {realpath,readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const allowed=new Set(['--source','--package','--output','--source-manifest']);
const args=process.argv.slice(2),o={};
for(let i=0;i<args.length;i+=2){assert(allowed.has(args[i])&&args[i+1]&&!o[args[i]]);o[args[i]]=args[i+1];}
for(const name of allowed)assert(isAbsolute(o[name]??''),'Absolute '+name+' is required');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=await realpath(o['--source']),out=resolve(o['--output']),packageRoot=await realpath(o['--package']);
const BASE='stellar/scf-starforge-20261009/';
const manifestBytes=await readFile(o['--source-manifest']),manifest=JSON.parse(manifestBytes);
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
const pkg=await merchant.inspectGeocodePackage(packageRoot);
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
await host.prepareGeocodeDeployment({packageDirectory:packageRoot,hostPlanFile:profilePath,directory:interruptedDirectory});
if(!await files.exists(join(interruptedDirectory,'host')))await mkdir(join(interruptedDirectory,'host'),{mode:0o700});
const interrupted=await host.checkGeocodeDeployment(interruptedDirectory);
assert.equal(interrupted.state,'HOST_BUNDLE_INCOMPLETE');
assert.equal(interrupted.recovery.packageDirectory,packageRoot);
const recovery=await host.prepareGeocodeDeployment(interrupted.recovery);
const recovered=await host.generateGeocodeDeployment({directory:recovery.directory,expectedReviewSha256:recovery.reviewSha256});
assert.equal(recovered.state,'BUNDLE_CHECKED');
assert.equal(recovered.packageIdentity,pkg.manifest.identity);
assert.equal(recovered.termsSha256,pkg.built.termsSha256);
assert.equal((await host.checkGeocodeDeployment(interruptedDirectory)).state,'HOST_BUNDLE_INCOMPLETE');
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
 incompleteRecovery:{previousDirectory:interruptedDirectory,previousReviewSha256:interrupted.reviewSha256,
  directory:recovery.directory,reviewSha256:recovery.reviewSha256,bundle:recovered.bundle},
 artifacts};
await files.putOnce(join(out,'host-receiving.json'),files.jsonBytes(report));
process.stdout.write(JSON.stringify({state:report.state,packageIdentity:pkg.manifest.identity,
 reviewSha256:prepared.reviewSha256,bundle:generated.bundle,artifacts:artifacts.length})+'\n');
