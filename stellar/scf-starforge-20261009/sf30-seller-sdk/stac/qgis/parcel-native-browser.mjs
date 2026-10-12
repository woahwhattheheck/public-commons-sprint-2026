#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Original analyst UI receiving, with exact request bodies retained before sends.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const configPath = process.argv[2];
if (!configPath) throw new Error('Pass the same private native browser configuration.');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const output = path.resolve(config.output);
await fs.mkdir(output, {recursive:true, mode:0o700});
const original = JSON.parse(await fs.readFile(config.connectionFile, 'utf8'));
const opened = new URL(original.operatorUrl);
const token = opened.hash.slice(1);
const origin = opened.origin;
const auth = {'X-Starforge-Qgis-Workspace':token, Origin:origin};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const equal = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const ensure = (condition,message) => {if (!condition) throw new Error(message);};
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const bytes = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
async function exists(file) {try {await fs.access(file);return true;} catch(error) {if(error.code==='ENOENT')return false;throw error;}}
async function write(file,body,immutable=false) {
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=file+'.pending-'+crypto.randomUUID();
  let handle;
  try {
    handle=await fs.open(temporary,'wx',0o600);
    await handle.writeFile(body);
    await handle.sync();
    await handle.close();
    handle=null;
    if (immutable) {
      try {await fs.link(temporary,file);}
      catch(error) {
        if(error.code!=='EEXIST')throw error;
        ensure((await fs.readFile(file)).equals(body),'A retained original browser file differs: '+file);
      }
    } else {
      await fs.rename(temporary,file);
    }
  } finally {
    if(handle)await handle.close();
    await fs.rm(temporary,{force:true});
  }
}
async function measured(file) {const body=await fs.readFile(file);return{path:file,bytes:body.length,sha256:sha(body)};}
const frozen={schema:'starforge.parcel-browser-input.v1',mode:config.mode,workspaceId:original.workspaceId,
  editionId:config.editionId,keys:config.keys,review:config.review,sourceManifestSha256:config.sourceManifestSha256,
  portfolioId:config.portfolioId,projectId:config.projectId??null,mapRequestId:config.mapRequestId??null};
await write(path.join(output,'input.json'),bytes(frozen),true);
const finalPath=path.join(output,'result.json');
if (await exists(finalPath)) {
  const result=JSON.parse(await fs.readFile(finalPath,'utf8'));
  if (result.status==='COMPLETED'&&result.workspaceId===original.workspaceId&&result.sourceSha256===original.sourceSha256) {
    for (const file of result.files) {const actual=await measured(file.path);ensure(actual.sha256===file.sha256&&actual.bytes===file.bytes,'A completed original browser output changed.');}
    process.stdout.write(JSON.stringify({status:'COMPLETED',result:finalPath,replayed:true})+'\n');
    process.exit(0);
  }
}
const {chromium}=await import(pathToFileURL(config.playwrightModule).href);
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'starforge-parcel-browser-'));
let context;
try {
  context=await chromium.launchPersistentContext(profile,{
    executablePath:config.chromium,headless:true,viewport:{width:1440,height:1050},
    args:['--no-sandbox','--disable-dev-shm-usage']
  });
} catch(error) {
  await fs.rm(profile,{recursive:true,force:true});
  throw error;
}
const errors=[],files=[],results={};
const page=await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror',error=>errors.push({type:'pageerror',message:error.message}));
page.on('console',message=>{if(message.type()==='error')errors.push({type:'console',message:message.text()});});
let activeStep=null;
await page.route(origin+'/api/operations',async route=>{
  const request=route.request();
  if(request.method()==='POST') {
    const body=request.postDataBuffer();
    ensure(body,'The original submitted operation has no body.');
    const value=JSON.parse(body.toString('utf8'));
    ensure(value.actor===config.actor&&value.action==='parcel.command',
      'Only this original parcel UI action is part of the current browser mutation.');
    await write(path.join(output,'requests',value.requestId+'.json'),body,true);
    if(activeStep)await write(path.join(output,'steps',activeStep+'.json'),body,true);
  }
  await route.continue();
});
async function api(route,{method='GET',body,missing=false}={}) {
  const response=await context.request.fetch(origin+route,{method,headers:{...auth,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{data:Buffer.isBuffer(body)?body:bytes(body)}:{})});
  if(missing&&response.status()===404)return null;
  const value=await response.json();
  ensure(response.ok(),'Original API '+route+' returned '+response.status()+': '+JSON.stringify(value));
  return value;
}
async function waitOperation(body) {
  let row=await api('/api/operations/'+encodeURIComponent(body.requestId),{missing:true});
  if(!row)row=await api('/api/operations',{method:'POST',body});
  else if(row.status!=='COMPLETED'&&!row.workerActive) {
    ensure(row.canResume,'The original UI request needs its selected source/runtime location.');
    row=await api('/api/operations/'+body.requestId+'/continue',{method:'POST',body:{inputSha256:row.inputSha256}});
  }
  const end=Date.now()+600000;
  while(row.status!=='COMPLETED') {
    if(row.status==='FAILED')throw new Error('Original saved browser request failed: '+JSON.stringify(row.error));
    ensure(Date.now()<end,'The original UI request remains saved after its wait interval: '+body.requestId);
    await pause(500);
    row=await api('/api/operations/'+body.requestId);
    if(!row.workerActive&&row.status!=='COMPLETED'&&row.status!=='FAILED') {
      ensure(row.canResume,'The original UI request cannot resume with another source binding.');
      row=await api('/api/operations/'+body.requestId+'/continue',{method:'POST',body:{inputSha256:row.inputSha256}});
    }
  }
  ensure(equal(row.input.payload,body.payload)&&row.input.actor===body.actor,
    'The original UI operation returned another reviewed input.');
  await write(path.join(output,'operations',body.requestId+'.json'),bytes(row));
  return row;
}
async function step(name,click) {
  const retained=path.join(output,'steps',name+'.json');
  if(!await exists(retained)) {
    activeStep=name;
    try {
      await click();
      const end=Date.now()+30000;
      while(!await exists(retained)){ensure(Date.now()<end,'The UI did not submit its original '+name+' request.');await pause(100);}
    } finally {activeStep=null;}
  }
  const body=JSON.parse(await fs.readFile(retained,'utf8'));
  const row=await waitOperation(body);
  results[name]={requestId:row.requestId,inputSha256:row.inputSha256,result:row.result};
  // Reopen that exact operation through the visible original History control. This
  // also consumes the retained result when the initial worker was still READY.
  await page.locator('#navigation').getByRole('button',{name:'History',exact:true}).click();
  await field('Saved request ID').fill(row.requestId);
  await page.getByRole('button',{name:'Open original request',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('#operation')?.textContent.includes(id)&&
    document.querySelector('#operation')?.textContent.includes('COMPLETED'),row.requestId);
  return row;
}
function field(name) {
  const escaped=name.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&');
  return page.getByLabel(new RegExp('^'+escaped+'(?:\\s|$)'));
}
async function parcelTab(name) {
  await page.locator('#navigation').getByRole('button',{name:'Parcels',exact:true}).click();
  const toolbar=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Parcel portfolios',exact:true})});
  await toolbar.getByRole('button',{name,exact:true}).click();
  const heading={Sources:'Receive an original parcel source edition',Parcels:'Original parcels and source assertions',
    Responsibility:'Named accountable entities',Portfolios:'Build an assessment and area portfolio',
    'Later edition':'Review a later parcel source edition'}[name];
  await page.getByRole('heading',{name:heading,exact:true}).waitFor();
  const edition=field('Working parcel edition');
  if(await edition.count()&&await edition.inputValue()!==config.editionId) {
    await edition.selectOption(config.editionId);
    await page.getByRole('heading',{name:heading,exact:true}).waitFor();
  }
}
async function screenshot(name) {
  const file=path.join(output,name+'.png');
  await page.screenshot({path:file,fullPage:true});
  files.push(await measured(file));
}
async function download(link,name,expected) {
  const pending=page.waitForEvent('download');
  await link.click();
  const item=await pending;
  const file=path.join(output,'downloads',name);
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  await item.saveAs(file);
  const actual=await measured(file);
  ensure(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'The actual browser download differs from its original file.');
  files.push(actual);
}
try {
  await page.goto(original.operatorUrl,{waitUntil:'domcontentloaded'});
  await field('Responsible analyst').fill(config.actor);
  await page.locator('#navigation').getByRole('button',{name:'Parcels',exact:true}).waitFor();
  let data=await api('/api/parcels');
  ensure(data.workspaceId===original.workspaceId&&data.editions.some(row=>row.id===config.editionId),
    'The original browser opened another parcel source edition.');
  await parcelTab('Sources');
  const source=data.editions.find(row=>row.id===config.editionId);
  ensure(source.id===config.sourceManifestSha256,'The browser source manifest identity differs.');
  await screenshot('01-original-source-register');
  await parcelTab('Parcels');
  await field('Parcel key, address or assertion').fill(config.review.key);
  await page.getByRole('button',{name:'Apply parcel filters',exact:true}).click();
  await page.getByRole('button',{name:config.review.key,exact:true}).click();
  await page.getByRole('heading',{name:'Review parcel '+config.review.key,exact:true}).waitFor();
  const originalDetail=await api('/api/parcels/detail?'+new URLSearchParams({editionId:config.editionId,key:config.review.key}));
  ensure(originalDetail.parcel.claims.some(row=>row.id===config.review.ownerClaimId&&row.kind==='owner-assertion'&&row.field==='owner'),
    'The selected owner must be an actual original City assertion.');
  if(config.mode==='review') {
    const previewFile=path.join(output,'steps','owner-preview.json');
    const saveFile=path.join(output,'steps','owner-save.json');
    if(!await exists(saveFile)) {
      if(!await exists(previewFile)) {
        await page.getByRole('button',{name:'Reopen current source and saved decision',exact:true}).click();
        await field('Selected owner assertion').selectOption(config.review.ownerClaimId);
        await field('Accountable entity').selectOption('');
        await field('Reason for this staff decision').fill(config.review.reason);
      }
      await step('owner-preview',()=>page.getByRole('button',{name:'Preview this parcel decision',exact:true}).click());
      await parcelTab('Parcels');
      await page.getByRole('heading',{name:'Exact decision preview',exact:true}).waitFor();
    }
    await step('owner-save',()=>page.getByRole('button',{name:'Save this reviewed decision batch',exact:true}).click());
    const corrected=await api('/api/parcels/detail?'+new URLSearchParams({editionId:config.editionId,key:config.review.key}));
    ensure(corrected.decision.owner.claim.id===config.review.ownerClaimId&&corrected.decision.accountable.mode==='unassigned',
      'The actual staff review must preserve the selected source assertion and explicit responsibility choice.');
    await parcelTab('Responsibility');
    const entityId='c94-source-review-desk';
    data=await api('/api/parcels');
    if(!await exists(path.join(output,'steps','entity-create.json'))) {
      ensure(!data.activeEntities[entityId],'The chosen internal entity ID is already assigned outside this browser operation.');
      await page.getByRole('button',{name:'Create another entity',exact:true}).click();
      await field('Stable entity ID').fill(entityId);
      await field('Name shown in reviews and portfolios').fill('C94 source review desk');
      await field('Entity type').selectOption('other');
      await field('Assignment context and reason').fill('Internal reviewer register for this original public-source case.');
    }
    const created=await step('entity-create',()=>page.getByRole('button',{name:'Save entity version',exact:true}).click());
    await parcelTab('Responsibility');
    if(!await exists(path.join(output,'steps','entity-revise.json'))) {
      await page.getByRole('button',{name:'C94 source review desk',exact:true}).click();
      await field('Assignment context and reason').fill(
        'Internal review register covering the original source capture, owner assertion choice and complete receiving handover.');
    }
    const revised=await step('entity-revise',()=>page.getByRole('button',{name:'Save entity version',exact:true}).click());
    ensure(created.result.version!==revised.result.version,'The staff entity revision must retain two distinct original versions.');
    data=await api('/api/parcels');
    ensure(data.entities.some(row=>row.id===created.result.version)&&data.activeEntities[entityId]===revised.result.version,
      'The original entity register must retain its earlier version.');
    await parcelTab('Responsibility');
    await screenshot('02-entity-version-history');
    await parcelTab('Portfolios');
    if(!await exists(path.join(output,'steps','portfolio-preview.json'))) {
      await field('Portfolio title').fill('Browser-reviewed original County portfolio');
      await field('Assessment basis').selectOption('county-assessed');
      await field('Area basis').selectOption('county-reported-square-feet');
      await field('Parcel selection').selectOption('keys');
      await field('Original parcel keys').fill(config.keys.join('\n'));
      await field('Require every selected parcel to have a saved review').check();
      await field('Portfolio scope and interpretation').fill(
        'The original reviewed public-source cohort, County assessed basis and reported County area, grouped by the original tax period.');
    }
    if(!await exists(path.join(output,'steps','portfolio-save.json'))) {
      await step('portfolio-preview',()=>page.getByRole('button',{name:'Preview complete portfolio',exact:true}).click());
      await parcelTab('Portfolios');
      await page.getByRole('heading',{name:'Frozen portfolio preview',exact:true}).waitFor();
    }
    const saved=await step('portfolio-save',()=>page.getByRole('button',{name:'Save this exact portfolio',exact:true}).click());
    config.portfolioId=saved.result.portfolio.id;
    results.browserPortfolio=saved.result.portfolio;
  }
  await parcelTab('Parcels');
  await field('Parcel key, address or assertion').fill(config.review.key);
  await page.getByRole('button',{name:'Apply parcel filters',exact:true}).click();
  await page.getByRole('button',{name:config.review.key,exact:true}).click();
  await page.getByRole('heading',{name:'Review parcel '+config.review.key,exact:true}).waitFor();
  await screenshot('03-reviewed-original-parcel');
  await page.getByRole('button',{name:'Read original record',exact:true}).first().click();
  await page.getByText('Original provider record',{exact:true}).waitFor();
  await parcelTab('Portfolios');
  data=await api('/api/parcels');
  const selected=data.portfolios.find(row=>row.id===config.portfolioId);
  ensure(selected,'The saved original portfolio is missing in the browser.');
  await page.getByRole('button',{name:selected.title,exact:true}).click();
  await page.getByRole('heading',{name:'Saved portfolio: '+selected.title,exact:true}).waitFor();
  for(const file of selected.files) {
    const name=path.basename(file.path);
    await download(page.getByRole('link',{name:'Download '+name,exact:true}),name,file);
  }
  await screenshot('04-frozen-portfolio');
  await parcelTab('Later edition');
  await page.getByRole('heading',{name:'Retained successor decisions',exact:true}).waitFor();
  ensure(data.successors.some(row=>row.rightEditionId===config.editionId),'The received source successor is missing.');
  await screenshot('05-source-successor-history');
  if(config.mode==='receiving') {
    await page.locator('#navigation').getByRole('button',{name:'History',exact:true}).click();
    await field('Saved request ID').fill(config.mapRequestId);
    await page.getByRole('button',{name:'Open original request',exact:true}).click();
    await page.waitForFunction(id=>document.querySelector('#operation')?.textContent.includes(id)&&
      document.querySelector('#operation')?.textContent.includes('COMPLETED'),config.mapRequestId);
    await page.locator('#navigation').getByRole('button',{name:'Maps',exact:true}).click();
    const project=field('Saved native project');
    // Selecting the same ID would intentionally clear the current native view.
    if(await project.inputValue()!==config.projectId) {
      await project.selectOption(config.projectId);
      await page.locator('#navigation').getByRole('button',{name:'History',exact:true}).click();
      await field('Saved request ID').fill(config.mapRequestId);
      await page.getByRole('button',{name:'Open original request',exact:true}).click();
      await page.locator('#navigation').getByRole('button',{name:'Maps',exact:true}).click();
    }
    await page.waitForFunction(()=>{const img=document.querySelector('img.native-map');return img?.complete&&img.naturalWidth>0;});
    await screenshot('06-received-native-map');
  }
  await page.setViewportSize({width:390,height:844});
  await parcelTab('Parcels');
  await page.getByRole('button',{name:config.review.key,exact:true}).click();
  await page.getByRole('heading',{name:'Review parcel '+config.review.key,exact:true}).waitFor();
  await screenshot('07-mobile-parcel-review');
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  ensure(overflow.document<=overflow.viewport+2,'The original parcel workspace overflows the mobile page.');
  ensure(errors.length===0,'The original browser reported an error: '+JSON.stringify(errors));
  const result={schema:'starforge.parcel-browser-receiving.v1',status:'COMPLETED',completedAt:new Date().toISOString(),
    mode:config.mode,workspaceId:original.workspaceId,sourceSha256:original.sourceSha256,
    editionId:config.editionId,reviewKey:config.review.key,sourceManifestSha256:config.sourceManifestSha256,
    portfolioId:config.portfolioId,steps:results,files,viewport:overflow,errors};
  await write(finalPath,bytes(result));
  process.stdout.write(JSON.stringify({status:'COMPLETED',result:finalPath,workspaceId:result.workspaceId})+'\n');
} catch(error) {
  await write(path.join(output,'continuation.json'),bytes({status:'RETAINED_CONTINUATION',at:new Date().toISOString(),
    workspaceId:original.workspaceId,message:error.message,errors}));
  throw error;
} finally {
  try {await context.close();}
  finally {await fs.rm(profile,{recursive:true,force:true});}
}
