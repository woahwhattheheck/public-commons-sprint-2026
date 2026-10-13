// Receive both exact nine-member BroomDesk programme packages in an existing browser.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import Zip from './host/connected_zip.cjs';import {receiveOriginalPackages} from './build-package-viewer.mjs';import {renderBroomDeskCommissioningPackageViewer,previewBroomDeskCommissioningDocument} from './package-viewer.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex'),args=process.argv.slice(2),opts={};for(let i=0;i<args.length;i+=2)opts[args[i]]=args[i+1];
for(const k of ['--cdp','--delivery','--out','--playwright-module'])if(!opts[k])throw Error('Use --cdp EXISTING_ENDPOINT --delivery BUILT_DIRECTORY --out NEW_DIRECTORY --playwright-module EXISTING_ENTRY');
const pageSource=opts['--page-source']||'origin';if(!['origin','supplied-html'].includes(pageSource))throw Error('Use --page-source origin or supplied-html.');const supplied=pageSource==='supplied-html';
const req=createRequire(import.meta.url),entry=req.resolve(path.resolve(opts['--playwright-module']));let dir=path.dirname(entry),metadata;while(true){try{const p=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));if(['playwright','playwright-core'].includes(p.name)){metadata=p;break;}}catch{}const parent=path.dirname(dir);if(parent===dir)break;dir=parent;}const v=/^(\d+)\.(\d+)\./.exec(metadata?.version||'');if(!v||+v[1]<1||(+v[1]===1&&+v[2]<60))throw Error('Installed Playwright1.60+ required for noDefaults.');
const endpoint=new URL(opts['--cdp']);if(!['http:','https:','ws:','wss:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw Error('Use authorized CDP endpoint without credentials.');
const out=path.resolve(opts['--out']),delivery=path.resolve(opts['--delivery']);if(fs.existsSync(out))throw Error('Choose a new output directory.');fs.mkdirSync(out,{mode:0o700});
const result={schema:'broomdesk.full-package-browser.v1',status:'starting',pageSource,documents:[],views:[],downloads:[],errors:[]},save=()=>fs.writeFileSync(path.join(out,'receiving.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});const owned=new Set();let browser;
async function run(){
 try{
  const record=JSON.parse(fs.readFileSync(path.join(delivery,'working-record.json'),'utf8')),selections=[];
  for(const kind of ['sample','paid']){
   const input=JSON.parse(fs.readFileSync(path.join(here,kind+'-package-viewer-input.json'),'utf8')),pack=receiveOriginalPackages(record,input)[0],html=renderBroomDeskCommissioningPackageViewer(input);
   if(!pack.archive.equals(fs.readFileSync(path.join(delivery,pack.name))))throw Error('Built full archive differs.');
   const saved=fs.readFileSync(path.join(here,'BroomDesk-'+kind+'-complete-commissioning-package.html'),'utf8');if(html!==saved)throw Error('Generated selected full viewer differs.');
   const members=Zip.readStoredZip(pack.archive);for(const m of members){if(path.isAbsolute(m.name)||m.name.split(/[\\\/]/).includes('..'))throw Error('Unsafe original filename.');const p=path.join(out,'received',kind,m.name);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,m.data,{flag:'wx',mode:0o600});}
   fs.writeFileSync(path.join(out,kind+'-exact-viewer.html'),html,{flag:'wx',mode:0o600});selections.push({kind,input,pack,html,members});
  }
  const mod=await import(pathToFileURL(entry)),chromium=mod.chromium||mod.default?.chromium;browser=await chromium.connectOverCDP(opts['--cdp'],{noDefaults:true,timeout:30000});
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===390?844:1000},acceptDownloads:true});owned.add(context);
   await context.route(supplied?'**/*':'https://broomdesk-package-receiving.invalid/**',route=>{if(supplied)return route.abort();const name=new URL(route.request().url()).pathname.slice(1),selected=selections.find(s=>s.kind===name);return selected?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:selected.html}):route.abort();});
   let page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
   const capture=async name=>{const file=width+'-'+name+'.png';await page.screenshot({path:path.join(out,file),fullPage:true});const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));if(layout.documentWidth>layout.width+1)throw Error('Viewer overflow: '+name);result.views.push({file,...layout});save();};
   const download=async(button,name,expected)=>{const wait=page.waitForEvent('download');await button.click();const d=await wait,p=path.join(out,width+'-'+name.replace(/[^A-Za-z0-9_.-]/g,'_'));await d.saveAs(p);const b=fs.readFileSync(p);if(b.length!==expected.bytes||hash(b)!==expected.sha256)throw Error('Actual download differs: '+name);result.downloads.push({file:path.basename(p),bytes:b.length,sha256:hash(b)});save();return b;};
   for(const selected of selections){
    if(supplied){
     const previous=page;page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));await previous.close();
     await page.setContent(selected.html,{waitUntil:'load'});if(page.url()!=='about:blank')throw Error('The supplied original viewer left its permitted blank document.');
    }else{const response=await page.goto('https://broomdesk-package-receiving.invalid/'+selected.kind);if(hash(await response.body())!==hash(selected.html))throw Error('Served exact viewer differs.');}
    result.documents.push({kind:selected.kind,width,bytes:Buffer.byteLength(selected.html),sha256:hash(selected.html),pageSource});save();
    await page.locator('#downloads section').waitFor();await capture(selected.kind+'-packages');
    const section=page.locator('#downloads section').first();const bytes=await download(section.getByRole('button',{name:'Download complete pack',exact:true}),selected.pack.name,selected.pack);const reopened=Zip.readStoredZip(bytes);if(reopened.length!==9)throw Error('Actual downloaded archive is incomplete.');
    for(const member of selected.members){
     const f=selected.pack.files.find(f=>f.name===member.name);await section.locator('select').selectOption(member.name);await section.getByRole('button',{name:'Open document',exact:true}).click();await page.locator('#document-preview').waitFor({state:'visible'});
     if(await page.locator('#preview').getAttribute('srcdoc')!==previewBroomDeskCommissioningDocument(member.name,Zip.utf8Text(member.data)))throw Error('Actual document preview differs.');
     if(/^desk\/(?:sample|paid)\/commissioning\.html$/.test(member.name)){
      const frame=page.frameLocator('#preview');await frame.locator('body[data-broomdesk-commissioning-opening="complete"]').waitFor({state:'visible'});await frame.getByRole('heading',{name:'Open the working desk'}).waitFor();if(await frame.locator('body > ul > li').count()!==selected.pack.quantity)throw Error('Preview agency scope differs.');await frame.locator('summary').click();await frame.locator('details[open] pre').waitFor();const layout=await frame.locator('body').evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));if(layout.documentWidth>layout.width+1)throw Error('Embedded desk preview overflows.');
     }
     await capture(selected.kind+'-'+member.name.replace(/[^A-Za-z0-9_.-]/g,'_'));await download(section.getByRole('button',{name:'Download document',exact:true}),selected.kind+'-'+member.name,f);await page.locator('#close-preview').click();
    }
    if(supplied){
     const previous=page;page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));await previous.close();
     await page.setContent(selected.html,{waitUntil:'load'});if(page.url()!=='about:blank')throw Error('The reopened original viewer left its permitted blank document.');
     result.documents.push({kind:selected.kind,width,bytes:Buffer.byteLength(selected.html),sha256:hash(selected.html),pageSource,operation:'independent_fresh_document_reopen'});save();
    }else await page.reload();
    await page.locator('#downloads section').waitFor();await capture(selected.kind+'-reopened-packages');
   }
   await context.close();owned.delete(context);
  }
  if(result.errors.length)throw Error(result.errors.join('\n'));result.status='PASS';
 }catch(e){result.status='FAILED';result.error={message:e.message,stack:e.stack};throw e;}finally{for(const c of owned)try{await c.close();}catch(e){result.status='FAILED';result.cleanup_error=e.message;}result.attached_browser_preserved=true;save();}
 return result;
}
run().then(r=>{console.log(JSON.stringify({status:r.status,views:r.views.length,downloads:r.downloads.length}));process.exit(r.status==='PASS'?0:1);}).catch(e=>{console.error(e.stack);process.exit(1);});
