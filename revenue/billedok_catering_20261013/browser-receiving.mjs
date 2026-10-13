#!/usr/bin/env node
/**
 * Open the exact BilledOK original customer HTMLs in an existing authorized CDP browser.
 * Uses only a new private context. Never launches or closes the attached browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceSHA='c434397a8b7ea19283f7d1c3a0a7e6383e8eb2ebb4602ae5fd646def447aace1';
const origin='https://customer-documents.invalid/';
const expectedNames=['BilledOK-sample.html','BilledOK-paid.html'];
function cli(args){
 const options={source:fileURLToPath(new URL('./browser-originals.json',import.meta.url))};
 for(let i=0;i<args.length;i++){
  const key=args[i];if(!['--source','--out','--cdp','--playwright-module'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Use --out NEW_DIRECTORY --cdp EXISTING_AUTHORIZED_ENDPOINT [--source originals.json] [--playwright-module /installed/playwright/index.mjs].');
  if(options[key.slice(2)]!==undefined&&key!=='--source')throw Error('Duplicate argument: '+key);
  options[key.slice(2)]=args[++i];
 }
 if(!options.out||!options.cdp)throw Error('An existing authorized CDP endpoint and new output directory are required.');
 const endpoint=new URL(options.cdp);
 if(!['http:','https:','ws:','wss:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw Error('Use the authorized CDP endpoint without embedded credentials.');
 return options;
}
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
function loadOriginals(filename){
 const bytes=fs.readFileSync(filename);
 if(bytes.length!==21665||sha(bytes)!==sourceSHA)throw Error('Select the unchanged full originals.json published with this course.');
 const source=JSON.parse(bytes);
 if(source.schema!=='commons.billedok-original-documents.v1'||!Array.isArray(source.files)||source.files.length!==expectedNames.length)throw Error('The complete two-document original selection is required.');
 for(let i=0;i<source.files.length;i++){
  const f=source.files[i],b=Buffer.from(f.content,'utf8');
  if(f.name!==expectedNames[i]||b.length!==f.bytes||sha(b)!==f.sha256)throw Error('The original document changed: '+f.name);
  if(/<(?:script|iframe|img|link|video|audio|source)\b|url\s*\(/i.test(f.content))throw Error('This exact course expects self-contained original static documents: '+f.name);
 }
 return {source,bytes};
}
function indexHTML(report){
 const rows=report.views.map(v=>'<section><h2>'+escape(v.name)+' · '+v.width+' px</h2><p>'+escape(v.status)+' · document width '+(v.layout?.scrollWidth??'unavailable')+' px</p>'+v.screenshots.map(s=>'<p><a href="'+escape(s.path)+'">'+escape(s.kind)+'</a></p><a href="'+escape(s.path)+'"><img loading="lazy" src="'+escape(s.path)+'" alt="'+escape(v.name+' '+v.width+' px '+s.kind)+'"></a>').join('')+(v.problems.length?'<pre>'+escape(v.problems.join('\n'))+'</pre>':'')+'</section>').join('\n');
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BilledOK customer documents — rendered review</title><style>body{margin:24px;background:#fff;color:#202020;font:16px/1.5 system-ui}main{max-width:1440px;margin:auto}h1{font-size:27px}h2{font-size:21px}section{border-top:1px solid #bdbdbd;padding:24px 0}img{display:block;max-width:100%;height:auto;border:1px solid #bbb}a{color:#222;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin:8px 0}</style><main><h1>BilledOK customer documents</h1><p>'+escape(report.status)+' · '+report.views.length+' of 4 original desktop and phone views.</p><p>Producing peers must open and inspect every actual image and repair any visual defect before calling the corresponding outgoing document ready. This file records the rendering operation; it does not record human visual acceptance.</p><ul><li><a href="run.json">Complete browser observations and output identities</a></li><li><a href="originals.json">Complete unchanged original source</a></li><li><a href="OWNER_INSTRUCTION.md">Current owner instruction</a></li></ul>'+rows+'</main></html>\n';
}
const options=cli(process.argv.slice(2));
const {source,bytes}=loadOriginals(path.resolve(options.source));
const installed=installedPlaywright(options['playwright-module']);
const out=path.resolve(options.out);
fs.mkdirSync(out,{mode:0o700}); // Exclusive new directory; preserve any previous receiving output.
fs.mkdirSync(path.join(out,'source'),{mode:0o700});
fs.mkdirSync(path.join(out,'screens'),{mode:0o700});
fs.writeFileSync(path.join(out,'originals.json'),bytes,{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(out,'OWNER_INSTRUCTION.md'),source.owner_instruction,{flag:'wx',mode:0o600});
for(const f of source.files)fs.writeFileSync(path.join(out,'source',f.name),Buffer.from(f.content,'utf8'),{flag:'wx',mode:0o600});
const report={schema:'commons.billedok-original-browser.v1',operation_id:source.operation_id,started_at:new Date().toISOString(),status:'receiving',source_bytes:bytes.length,source_sha256:sourceSHA,source_selections:source.source_selections,playwright:{name:installed.metadata.name,version:installed.metadata.version},connection:'existing_authorized_cdp_private_context',widths:[1440,390],views:[],errors:[]};
const save=()=>{
 const temporary=path.join(out,'run.json.next');
 fs.writeFileSync(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 fs.renameSync(temporary,path.join(out,'run.json'));
 fs.writeFileSync(path.join(out,'index.html'),indexHTML(report),{mode:0o600});
};
save();
let browser,context,page,current,timer,interrupted=false;
const closed=[];
const writeScreenshot=async(view,kind)=>{
 const name=view.name.replace(/\.html$/,'')+'-'+view.width+'-'+kind+'.jpg';
 const image=await page.screenshot({type:'jpeg',quality:84,fullPage:kind==='full',animations:'disabled',timeout:15000});
 fs.writeFileSync(path.join(out,'screens',name),image,{flag:'wx',mode:0o600});
 view.screenshots.push({kind,path:'screens/'+name,bytes:image.length,sha256:sha(image)});
};
const operation=async()=>{
 const imported=await import(pathToFileURL(installed.entry).href);
 const pw=imported.chromium?imported:imported.default;
 if(!pw?.chromium)throw Error('The selected existing module does not expose Chromium.');
 browser=await pw.chromium.connectOverCDP(options.cdp,{timeout:20000,noDefaults:true});
 report.browser=browser.version();
 context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light',reducedMotion:'reduce',acceptDownloads:false,serviceWorkers:'block'});
 const originals=new Map(source.files.map(f=>[new URL(encodeURIComponent(f.name),origin).href,f]));
 await context.route('**/*',async route=>{
  const url=route.request().url(),f=originals.get(url);
  if(f&&route.request().isNavigationRequest())await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:Buffer.from(f.content,'utf8'),headers:{'cache-control':'no-store'}});
  else{
   if(current&& !url.endsWith('/favicon.ico'))current.problems.push('Unexpected document resource: '+url);
   await route.abort();
  }
 });
 page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
 page.on('pageerror',error=>{if(current)current.problems.push('Page error: '+error.message);});
 page.on('console',message=>{if(current)current.console.push({type:message.type(),text:message.text()});});
 console.log(JSON.stringify({event:'original_browser_started',operation_id:source.operation_id,browser:report.browser,documents:source.files.length,output:out}));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  for(const f of source.files){
   if(interrupted)throw Error('Original receiving was interrupted.');
   const view={name:f.name,customer:f.customer,edition:f.edition,source_sha256:f.sha256,width,status:'opening',screenshots:[],console:[],problems:[]};
   current=view;report.views.push(view);save();
   try{
    const response=await page.goto(new URL(encodeURIComponent(f.name),origin).href,{waitUntil:'load'});
    const received=response?await response.body():null;
    if(!received||received.length!==f.bytes||sha(received)!==f.sha256)throw Error('Browser did not receive the complete unchanged document bytes.');
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    view.layout=await page.evaluate(()=>({
     title:document.title,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
     bodyScrollWidth:document.body.scrollWidth,height:document.documentElement.scrollHeight,
     bodyFont:getComputedStyle(document.body).font,bodyColor:getComputedStyle(document.body).color,
     bodyBackground:getComputedStyle(document.body).backgroundColor,
     headings:[...document.querySelectorAll('h1,h2,h3')].map(x=>x.textContent.trim()),
     links:[...document.querySelectorAll('a[href]')].map(x=>({text:x.textContent.trim(),href:x.getAttribute('href')}))
    }));
    for(const link of view.layout.links){
     if(!/^(?:https?:|mailto:|tel:|#)/i.test(link.href))view.problems.push('Unexpected relative or unsupported link: '+link.href);
     if(link.href.startsWith('#')&&!await page.evaluate(id=>Boolean(document.getElementById(id)),decodeURIComponent(link.href.slice(1))))view.problems.push('Missing document anchor: '+link.href);
    }
    if(view.layout.viewport!==width||view.layout.scrollWidth>width||view.layout.bodyScrollWidth>width)view.problems.push('Horizontal overflow at '+width+' px.');
    await writeScreenshot(view,'viewport');
    await writeScreenshot(view,'full');
    view.status=view.problems.length?'captured_with_findings':'captured_for_visual_review';
   }catch(error){
    view.problems.push(String(error?.stack||error));view.status='interrupted';
   }
   save();console.log(JSON.stringify({event:'original_document_rendered',name:f.name,width,status:view.status,images:view.screenshots.length,problems:view.problems}));
  }
 }
 report.status=report.views.length===4&&report.views.every(v=>v.status==='captured_for_visual_review')?'captured_for_visual_review':'captured_with_findings';
};
let rejectSignal;
const interruptedPromise=new Promise((_,reject)=>{rejectSignal=reject;});
const stop=signal=>{interrupted=true;rejectSignal(Error('Original receiving interrupted by '+signal));};
process.once('SIGINT',()=>stop('SIGINT'));process.once('SIGTERM',()=>stop('SIGTERM'));
try{
 await Promise.race([operation(),interruptedPromise,new Promise((_,reject)=>{timer=setTimeout(()=>{interrupted=true;reject(Error('Original receiving exceeded its 240-second operation window.'));},240000);})]);
}catch(error){report.status='interrupted';report.errors.push(String(error?.stack||error));}
finally{
 clearTimeout(timer);current=null;
 // Only objects created by this course are closed. The attached browser remains open.
 for(const [name,owned] of [['page',page],['private_context',context]]){
  if(!owned)continue;
  try{await Promise.race([owned.close(),new Promise((_,reject)=>setTimeout(()=>reject(Error(name+' close timed out')),5000))]);closed.push(name);}
  catch(error){report.errors.push(String(error?.message||error));report.status='interrupted';}
 }
 report.finished_at=new Date().toISOString();report.closed_owned_objects=closed;
 try{save();}catch(error){console.error('Output save failed: '+String(error?.stack||error));process.exit(1);}
 console.log(JSON.stringify({event:'original_browser_closed',operation_id:source.operation_id,status:report.status,views:report.views.length,images:report.views.reduce((n,v)=>n+v.screenshots.length,0),output:out,closed_owned_objects:closed}));
}
// Explicit exit detaches this CDP client without Browser.close().
process.exit(report.status==='captured_for_visual_review'?0:1);
