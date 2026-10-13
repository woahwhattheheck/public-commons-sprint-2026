#!/usr/bin/env node
/* MIT. Operate the actual prepared merchant applications in one existing authorized browser. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const root=path.dirname(fileURLToPath(import.meta.url));
const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--out','--cdp','--playwright-module'].includes(key)||!process.argv[i+1]||options[key])throw Error('Use --out NEW_DIRECTORY --cdp EXISTING_AUTHORIZED_ENDPOINT [--playwright-module EXISTING_ENTRY]');options[key]=process.argv[i+1];}
if(!options['--out']||!options['--cdp'])throw Error('Choose an existing authorized browser and new output');
const endpoint=new URL(options['--cdp']);if(!['http:','https:','ws:','wss:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw Error('Use an existing authorized CDP endpoint without embedded credentials');
function installedPlaywright(selected){
 let entry,packagePath;
 if(selected){
  entry=path.resolve(selected);let directory=path.dirname(entry);
  while(true){
   const candidate=path.join(directory,'package.json');
   if(fs.existsSync(candidate)){
    const p=JSON.parse(fs.readFileSync(candidate,'utf8'));
    if(['playwright','playwright-core'].includes(p.name)){packagePath=candidate;break;}
   }
   const parent=path.dirname(directory);if(parent===directory)break;directory=parent;
  }
 }else{
  for(const name of ['playwright','playwright-core']){
   try{entry=require.resolve(name);packagePath=require.resolve(name+'/package.json');break;}catch{}
  }
 }
 if(!entry||!packagePath)throw Error('Select the existing Playwright installation with --playwright-module; this course performs no installation.');
 const metadata=JSON.parse(fs.readFileSync(packagePath,'utf8'));
 const version=/^(\d+)\.(\d+)\./.exec(metadata.version);
 if(!version||Number(version[1])<1||(Number(version[1])===1&&Number(version[2])<60))throw Error('The selected existing Playwright must support connectOverCDP noDefaults (version 1.60 or later).');
 return {entry,metadata};
}

const installed=installedPlaywright(options['--playwright-module']),out=path.resolve(options['--out']);
const originals=JSON.parse(fs.readFileSync(path.join(root,'browser-originals.json'),'utf8'));
if(originals.schema!=='unlost.localization-browser-originals.v1'||originals.files.length!==2)throw Error('The complete paired source is required');
for(const f of originals.files){const bytes=Buffer.from(f.content);if(bytes.length!==f.bytes||sha(bytes)!==f.sha256)throw Error('The prepared customer application differs');}
fs.mkdirSync(out,{mode:0o700});for(const dir of['originals','screens','downloads'])fs.mkdirSync(path.join(out,dir),{mode:0o700});
for(const f of originals.files)fs.writeFileSync(path.join(out,'originals',f.name),f.content,{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(out,'OWNER_INSTRUCTION.md'),originals.ownerInstruction,{flag:'wx',mode:0o600});
const report={schema:'unlost.localization-browser-operation.v1',startedAt:new Date().toISOString(),status:'starting',source:originals.files.map(({content,...f})=>f),views:[],downloads:[],errors:[]};
const save=()=>fs.writeFileSync(path.join(out,'operation.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
const origin='https://unlost-localization.invalid/',served=new Map(originals.files.map(f=>[origin+f.name,Buffer.from(f.content)]));
let browser,context,page,interrupted=false,timer,dialogPolicy='accept';
const inspect=async(kind,width,view)=>{
 const entry={kind,width,view,images:[],errors:[]};report.views.push(entry);
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 entry.layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,title:document.title}));
 if(entry.layout.width!==width||entry.layout.scrollWidth>width||entry.layout.bodyWidth>width)entry.errors.push('Horizontal overflow');
 for(const fullPage of[false,true]){const name=kind+'-'+width+'-'+view+'-'+(fullPage?'full':'viewport')+'.jpg';const bytes=await page.screenshot({type:'jpeg',quality:85,fullPage,animations:'disabled',timeout:15000});fs.writeFileSync(path.join(out,'screens',name),bytes,{flag:'wx',mode:0o600});entry.images.push({path:'screens/'+name,bytes:bytes.length,sha256:sha(bytes)});}
 save();if(entry.errors.length)throw Error(kind+' '+width+' '+view+': '+entry.errors.join(';'));
};
const download=async(kind,label,selector)=>{
 const promise=page.waitForEvent('download',{timeout:15000});await page.locator(selector).click();const file=await promise;
 const name=kind+'-'+label+'-'+path.basename(file.suggestedFilename()),destination=path.join(out,'downloads',name);await file.saveAs(destination);
 const bytes=fs.readFileSync(destination);report.downloads.push({kind,label,path:'downloads/'+name,bytes:bytes.length,sha256:sha(bytes)});save();return{bytes,path:destination};
};
const programme=async()=>{
 const imported=await import(pathToFileURL(installed.entry).href),pw=imported.chromium?imported:imported.default;
 browser=await pw.chromium.connectOverCDP(options['--cdp'],{noDefaults:true,timeout:20000});if(interrupted)throw Error('Interrupted during browser connection');
 context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,serviceWorkers:'block',colorScheme:'light',reducedMotion:'reduce'});if(interrupted)throw Error('Interrupted during private-context creation');
 await context.route('**/*',route=>{const bytes=served.get(route.request().url());return bytes?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:bytes,headers:{'cache-control':'no-store'}}):route.abort();});
 page=await context.newPage();page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(15000);page.on('dialog',dialog=>dialogPolicy==='dismiss'?dialog.dismiss():dialog.accept());page.on('pageerror',e=>report.errors.push(e.message));
 report.status='operating';report.browser=browser.version();save();console.log(JSON.stringify({stage:'unlost_localization_browser_started',out,browser:report.browser}));
 for(const f of originals.files){
  if(interrupted)throw Error('Interrupted before original application');
  const response=await page.goto(origin+f.name,{waitUntil:'load'}),bytes=await response.body();if(sha(bytes)!==f.sha256)throw Error('Browser navigation bytes differ');
  await inspect(f.kind,1440,'original-context');
  await page.locator('[data-tab=pilot]').click();
  for(const[name,value]of Object.entries({targetLocale:'fr',currentTool:'TJL preparation example; merchant process unconfirmed',reviewer:'TJL preparation operator',objective:'Prepare and revise a short internal localization note.',commercialNotes:'Separate operated example. Original customer opening is unchanged.'}))await page.locator('#pilot-form [name='+name+']').fill(value);
  await page.locator('#pilot-form [name=tone]').selectOption('formal');await page.locator('#pilot-form button[type=submit],#pilot-form button:not([type])').first().click();
  await page.locator('[data-tab=glossary]').click();await page.locator('#term-form [name=source]').fill('designer');await page.locator('#term-form [name=keepUnchanged]').check();await page.locator('#term-form button:not([type])').click();
  await page.locator('[data-tab=content]').click();await page.locator('#add-unit').click();
  await page.locator('#unit-form [name=resourceType]').selectOption('other');await page.locator('#unit-form [name=field]').fill('Preparation note');await page.locator('#unit-form [name=sourceText]').fill('Preserve designer names, dimensions and condition notes.');
  await page.locator('#unit-form [name=translation]').fill('Conserver les noms des designers, les dimensions et les remarques sur l’état.');await page.locator('#unit-form [name=notes]').fill('TJL-authored preparation note; this is separate from original merchant catalog text.');await page.locator('#unit-form button:not([type])').click();
  const review=page.locator('.review-form').first();await review.locator('xpath=..').locator('summary').click();await review.locator('[name=status]').selectOption('approved');await review.locator('[name=notes]').fill('Reviewed this exact authored preparation note.');await review.locator('button').click();
  await page.locator('.edit-unit').first().click();const changedSource='Preserve designer names, dimensions and condition notes. Keep shipping-quote instructions.';await page.locator('#unit-form [name=sourceText]').fill(changedSource);
  const otherReview=page.locator('.review-form').first();await otherReview.locator('xpath=..').locator('summary').click();await otherReview.locator('[name=notes]').fill('A separate unsaved review edit.');dialogPolicy='dismiss';await otherReview.locator('button').click();dialogPolicy='accept';if(await page.locator('#unit-form [name=sourceText]').inputValue()!==changedSource)throw Error('Declining to discard another form lost entered source text');
  await page.locator('#unit-form button:not([type])').click();
  if(await page.locator('.badge').first().textContent()!=='Changed since review')throw Error('Source change did not expose the old review');
  if(!await page.locator('#panel').textContent().then(t=>t.includes('Conserver les noms des designers')))throw Error('The entered translation was lost');
  await inspect(f.kind,1440,'source-change');
  await page.locator('.edit-unit').first().click();await page.locator('#unit-form [name=translation]').fill('Conserver les noms des designers, les dimensions et les remarques sur l’état. Conserver les instructions relatives au devis de livraison.');await page.locator('#unit-form button:not([type])').click();
  const revised=page.locator('.review-form').first();await revised.locator('xpath=..').locator('summary').click();await revised.locator('[name=status]').selectOption('approved');await revised.locator('[name=notes]').fill('The current source and added sentence are included.');await revised.locator('button').click();
  await download(f.kind,'content','#content-csv');
  await page.locator('[data-tab=handover]').click();await page.locator('#handover-form [name=title]').fill('Prepared localization pilot — original browser operation');await page.locator('#handover-form button:not([type])').click();
  await download(f.kind,'handover','.download-handover');
  const reportFile=await download(f.kind,'report','#merchant-report');
  const sourceFile=await download(f.kind,'source','#download-source');const source=JSON.parse(sourceFile.bytes.toString('utf8'));
  if(source.schema!=='tjlabs.localization-application-source.v1'||source.files.length!==6)throw Error('Complete application source download differs');for(const sf of source.files)if(Buffer.byteLength(sf.content)!==sf.bytes||sha(Buffer.from(sf.content))!==sf.sha256)throw Error('Downloaded source member differs');
  const working=await download(f.kind,'working','#export-working');const bundle=JSON.parse(working.bytes.toString('utf8'));if(bundle.workspace.selection.kind!==f.kind||bundle.workspace.merchants[bundle.workspace.selection.leadIds[0]].snapshots.length!==1)throw Error('Whole working download differs');
  const otherTab=await context.newPage();otherTab.setDefaultTimeout(12000);otherTab.on('pageerror',e=>report.errors.push(e.message));await otherTab.goto(origin+f.name,{waitUntil:'load'});await otherTab.locator('[data-tab=pilot]').click();await otherTab.locator('#pilot-form [name=notes]').fill('Saved by the second browser tab.');await otherTab.locator('#pilot-form button:not([type])').first().click();await page.locator('#import-working').setInputFiles(working.path);await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Another tab changed the browser copy'));
  const currentStored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),'tjlabs-localization:'+bundle.workspace.selection.editionId);if(currentStored.workspace.revision!==bundle.workspace.revision+1)throw Error('Stale working-file open overwrote the newer browser copy');await otherTab.close();await page.locator('#reopen-browser').click();
  await page.locator('#import-working').setInputFiles(working.path);await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Complete working file opened'));
  for(const width of[1440,390]){await page.setViewportSize({width,height:1000});for(const tab of['context','pilot','content','glossary','handover']){if(interrupted)throw Error('Interrupted during original workspace');await page.locator('[data-tab='+tab+']').click();await inspect(f.kind,width,tab);}}
  const reportUrl=origin+f.kind+'-received-report.html';served.set(reportUrl,reportFile.bytes);await page.goto(reportUrl,{waitUntil:'load'});await inspect(f.kind,390,'downloaded-report');await page.setViewportSize({width:1440,height:1000});await inspect(f.kind,1440,'downloaded-report');
 }
 if(report.errors.length)throw Error(report.errors.join('; '));
 report.status='operated_for_visual_review';
};
let rejectStop;const stopped=new Promise((_,reject)=>rejectStop=reject);
const stop=signal=>{interrupted=true;rejectStop(Error('Interrupted by '+signal));};
process.once('SIGINT',()=>stop('SIGINT'));process.once('SIGTERM',()=>stop('SIGTERM'));
let running;
try{running=programme();await Promise.race([running,stopped,new Promise((_,reject)=>timer=setTimeout(()=>{interrupted=true;reject(Error('Original browser operation exceeded10minutes'));},600000))]);}
catch(error){report.status='interrupted';report.errors.push(String(error.stack||error));}
finally{
 clearTimeout(timer);interrupted=true;
 if(context)await context.close().catch(e=>report.errors.push('Private context close: '+e.message));
 if(running)await Promise.race([running.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,20000))]);
 if(context)await context.close().catch(()=>{});
 if(report.errors.length)report.status='interrupted';
 report.closedAt=new Date().toISOString();save();
 const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const images=report.views.flatMap(v=>v.images.map(i=>'<section><h2>'+esc(v.kind+' / '+v.width+' / '+v.view)+'</h2><img src="'+esc(i.path)+'" alt="'+esc(v.view)+'"></section>')).join('');
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Merchant localization — actual rendered operation</title><style>body{font:16px system-ui;color:#222;margin:24px}img{max-width:100%;height:auto}section{border-top:1px solid #aaa;margin:24px 0;padding:18px 0}</style><h1>Actual merchant workspace operation</h1><p>The producing peer opens and views these real images and the complete downloaded source, working file, handover, CSV and report.</p>'+images,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({stage:'unlost_localization_browser_closed',status:report.status,out,views:report.views.length,downloads:report.downloads.length,errors:report.errors}));
}
process.exit(report.status==='operated_for_visual_review'?0:1);
