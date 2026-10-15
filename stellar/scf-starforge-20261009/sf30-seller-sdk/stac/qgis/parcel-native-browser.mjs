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
  portfolioId:config.portfolioId,projectId:config.projectId??null,mapRequestId:config.mapRequestId??null,
  ...(config.portfolioComparisonId?{portfolioComparisonId:config.portfolioComparisonId,
    portfolioComparisonDefinition:config.portfolioComparisonDefinition,
    comparisonCreateFromUI:!!config.comparisonCreateFromUI}:{})};
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
  await activate(page.locator('#navigation').getByRole('button',{name:'History',exact:true}));
  await field('Saved request ID').fill(row.requestId);
  await activate(page.getByRole('button',{name:'Open original request',exact:true}));
  await page.waitForFunction(id=>document.querySelector('#operation')?.textContent.includes(id)&&
    document.querySelector('#operation')?.textContent.includes('COMPLETED'),row.requestId);
  return row;
}
function field(name) {
  const escaped=name.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&');
  return page.getByLabel(new RegExp('^'+escaped+'(?:\\s|$)'));
}
async function activate(control) {
  const node=await control.elementHandle();
  ensure(node,'The original operator control is unavailable.');
  try {
    await control.click();
    await page.waitForFunction(item=>!item.isConnected||!item.disabled,node);
    await page.waitForFunction(()=>document.querySelector('#content')?.getAttribute('aria-busy')==='false');
  } finally {await node.dispose();}
}
async function parcelTab(name) {
  await activate(page.locator('#navigation').getByRole('button',{name:'Parcels',exact:true}));
  const toolbar=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Parcel portfolios',exact:true})});
  await activate(toolbar.getByRole('button',{name,exact:true}));
  const heading={Sources:'Receive an original parcel source edition',Parcels:'Original parcels and source assertions',
    Responsibility:'Named accountable entities',Portfolios:'Build an assessment and area portfolio',
    'Later edition':'Review a later parcel source edition','Portfolio comparison':'Compare two frozen portfolios'}[name];
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
    const intendedOwner = body => {
      const decisions=body?.payload?.payload?.decisions;
      return body?.payload?.action==='review.preview'||body?.payload?.action==='review.save'
        ? Array.isArray(decisions)&&decisions.length===1&&decisions[0].key===config.review.key&&
          decisions[0].owner?.mode==='source'&&decisions[0].owner.claimId===config.review.ownerClaimId&&
          decisions[0].accountable?.mode==='unassigned'&&decisions[0].reason===config.review.reason
        : false;
    };
    const priorFiles=['owner-preview','owner-save'].map(name=>path.join(output,'steps',name+'.json'));
    const prior=[];
    for(const file of priorFiles)if(await exists(file))prior.push(JSON.parse(await fs.readFile(file,'utf8')));
    const correctedInput=prior.some(body=>!intendedOwner(body));
    const suffix=correctedInput?'-correction-'+sha(bytes(canonical(config.review))).slice(0,16):'';
    const previewName='owner-preview'+suffix, saveName='owner-save'+suffix;
    const previewFile=path.join(output,'steps',previewName+'.json');
    const saveFile=path.join(output,'steps',saveName+'.json');
    if(correctedInput)await write(path.join(output,'corrections','owner-review.json'),bytes({
      originalRequestIds:prior.map(body=>body.requestId),previewStep:previewName,saveStep:saveName,
      reason:'Retain the earlier request and review the exact originally selected City assertion after reopening the completed form.',
      intended:config.review
    }),true);
    if(!await exists(saveFile)) {
      if(!await exists(previewFile)) {
        await activate(page.getByRole('button',{name:'Reopen current source and saved decision',exact:true}));
        await field('Selected owner assertion').selectOption(config.review.ownerClaimId);
        await field('Accountable entity').selectOption('');
        await field('Reason for this staff decision').fill(config.review.reason);
        ensure(await field('Selected owner assertion').inputValue()===config.review.ownerClaimId,
          'The reopened current form must retain the selected original owner assertion.');
      }
      const preview=await step(previewName,()=>page.getByRole('button',{name:'Preview this parcel decision',exact:true}).click());
      ensure(intendedOwner(preview.input)&&preview.result.decisions.length===1&&
        preview.result.decisions[0].owner.claim?.id===config.review.ownerClaimId,
        'The original preview must contain the exact intended source-owner selection before saving.');
      await parcelTab('Parcels');
      await page.getByRole('heading',{name:'Exact decision preview',exact:true}).waitFor();
    }
    const savedOwner=await step(saveName,()=>page.getByRole('button',{name:'Save this reviewed decision batch',exact:true}).click());
    ensure(intendedOwner(savedOwner.input),'The retained owner save must contain the originally reviewed source choice.');
    const corrected=await api('/api/parcels/detail?'+new URLSearchParams({editionId:config.editionId,key:config.review.key}));
    ensure(corrected.decision.owner.claim.id===config.review.ownerClaimId&&corrected.decision.accountable.mode==='unassigned',
      'The actual staff review must preserve the selected source assertion and explicit responsibility choice.');
    await parcelTab('Responsibility');
    const entityId='c94-source-review-desk';
    data=await api('/api/parcels');
    if(!await exists(path.join(output,'steps','entity-create.json'))) {
      ensure(!data.activeEntities[entityId],'The chosen internal entity ID is already assigned outside this browser operation.');
      await activate(page.getByRole('button',{name:'Create another entity',exact:true}));
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

  if(config.portfolioComparisonId){
    await parcelTab('Portfolio comparison');
    const incoming=config.portfolioComparisonDefinition;
    ensure(incoming&&incoming.leftPortfolioId&&incoming.rightPortfolioId,'Retain the exact original comparison definition.');
    const savedPath=path.join(output,'steps','comparison-save.json');
    if(config.comparisonCreateFromUI){
      if(!await exists(savedPath)){
        if(!await exists(path.join(output,'steps','comparison-preview.json'))){
          await field('Comparison title').fill(('Browser: '+incoming.title).slice(0,512));
          await field('Left portfolio').selectOption(incoming.leftPortfolioId);
          await field('Right portfolio').selectOption(incoming.rightPortfolioId);
          await field('Assessment period policy').selectOption(incoming.periodPolicy);
          for(const group of ['owner','accountable','status','ward']){
            const control=field('Group transitions by '+group);
            if(incoming.groupBy.includes(group))await control.check();else await control.uncheck();
          }
          await field('Purpose, cohort scope and period interpretation').fill(incoming.note);
          await screenshot('08-comparison-original-input');
        }
        await step('comparison-preview',()=>page.getByRole('button',{name:'Preview this portfolio comparison',exact:true}).click());
        await parcelTab('Portfolio comparison');
        await page.getByRole('heading',{name:'Exact comparison preview',exact:true}).waitFor();
      }
      const created=await step('comparison-save',()=>page.getByRole('button',{name:'Save this exact comparison',exact:true}).click());
      ensure(created.input.payload.payload.definition.leftPortfolioId===incoming.leftPortfolioId&&
        created.input.payload.payload.definition.rightPortfolioId===incoming.rightPortfolioId,
        'The visible comparison must preserve its exact original source pair.');
      results.browserComparison=created.result.comparison;
    }
    await parcelTab('Portfolio comparison');
    data=await api('/api/parcels');
    const retained=data.comparisons.find(row=>row.id===config.portfolioComparisonId);
    ensure(retained,'The complete original comparison is missing.');
    await activate(page.getByRole('button',{name:retained.title,exact:true}));
    await page.getByRole('heading',{name:'Saved comparison: '+retained.title,exact:true}).waitFor();
    const expected=await api('/api/parcels/comparison?'+new URLSearchParams({comparisonId:retained.id,limit:'50'}));
    ensure(expected.sourceRowCount===retained.summary.added+retained.summary.removed+retained.summary.common,
      'The saved comparison coverage must retain the complete source-key union.');
    await field('Cohort filter').selectOption('attention');
    await activate(page.getByRole('button',{name:'Apply comparison filters',exact:true}));
    await screenshot('09-comparison-attention');
    await field('Cohort filter').selectOption('');
    await field('Search parcel, owner, responsible entity or ward').fill('');
    await activate(page.getByRole('button',{name:'Apply comparison filters',exact:true}));
    for(const file of retained.files){
      const name=path.basename(file.path);
      await download(page.getByRole('link',{name:'Download '+name,exact:true}),'comparison-'+name,file);
    }
    const actualJSON=JSON.parse(await fs.readFile(path.join(output,'downloads','comparison-comparison.json'),'utf8'));
    ensure(actualJSON.id===retained.id&&actualJSON.previewSha256===retained.previewSha256&&
      actualJSON.rows.length===expected.sourceRowCount,'The actual downloaded comparison lost source rows.');
    await screenshot('10-comparison-desktop');
    await page.setViewportSize({width:390,height:844});
    await screenshot('11-comparison-narrow');
    const comparisonOverflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    ensure(comparisonOverflow.document<=comparisonOverflow.viewport+2,'The saved comparison overflows the narrow desk.');
    await page.setViewportSize({width:1440,height:1050});
    const reportBytes=await fs.readFile(path.join(output,'downloads','comparison-report.html'));
    const reportRoute=origin+'/retained-comparison-report-'+retained.id+'.html';
    const reportPage=await context.newPage();
    await reportPage.route(reportRoute,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:reportBytes}));
    try{
      await reportPage.goto(reportRoute,{waitUntil:'domcontentloaded'});
      await reportPage.getByRole('heading',{name:retained.title,exact:true}).waitFor();
      const reportDesktop=path.join(output,'12-comparison-report-desktop.png');
      await reportPage.screenshot({path:reportDesktop,fullPage:true});files.push(await measured(reportDesktop));
      const details=reportPage.locator('details').first();
      if(await details.count())await details.locator('summary').click();
      await reportPage.setViewportSize({width:390,height:844});
      const reportNarrow=path.join(output,'13-comparison-report-narrow.png');
      await reportPage.screenshot({path:reportNarrow,fullPage:true});files.push(await measured(reportNarrow));
      const reportOverflow=await reportPage.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      ensure(reportOverflow.document<=reportOverflow.viewport+2,'The exact downloaded comparison report overflows the narrow page.');
    }finally{await reportPage.unroute(reportRoute);await reportPage.close();}
    results.retainedComparison={id:retained.id,previewSha256:retained.previewSha256,
      completeRows:actualJSON.rows.length,definition:actualJSON.definition,narrow:comparisonOverflow};
  }

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
  let visible;
  try {
    visible=await page.evaluate(()=>({
      contentBusy:document.querySelector('#content')?.getAttribute('aria-busy'),
      headings:[...document.querySelectorAll('#content h2')].map(node=>node.textContent),
      notice:document.querySelector('#notice')?.textContent,
      navigation:[...document.querySelectorAll('#navigation button')].map(node=>({
        name:node.textContent,current:node.getAttribute('aria-current'),disabled:node.disabled})),
      controls:[...document.querySelectorAll('#content input,#content select,#content textarea')].map(node=>({
        name:(node.getAttribute('aria-labelledby')||'').split(/\\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' '),
        kind:node.tagName,disabled:node.disabled}))
    }));
  } catch {}
  await write(path.join(output,'continuation.json'),bytes({status:'RETAINED_CONTINUATION',at:new Date().toISOString(),
    workspaceId:original.workspaceId,message:error.message,errors,visible}));
  throw error;
} finally {
  try {await context.close();}
  finally {await fs.rm(profile,{recursive:true,force:true});}
}
