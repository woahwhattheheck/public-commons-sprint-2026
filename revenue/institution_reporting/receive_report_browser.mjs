#!/usr/bin/env node
// Real browser receiving for the generated institution-report directory.
import {createServer} from 'node:http';
import {readFile,mkdir,lstat,open,readdir,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i];
  if(!['--report','--output','--playwright-module','--chromium'].includes(k)||!process.argv[i+1]||args[k])
    throw Error('Use --report DIRECTORY --output NEW_DIRECTORY --playwright-module PATH --chromium PATH');
  args[k]=process.argv[i+1];
}
for(const k of ['--report','--output','--playwright-module','--chromium'])if(!args[k])throw Error('Missing '+k);
const source=resolve(args['--report']),out=resolve(args['--output']),received=join(out,'received');
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(v,m)=>{if(!v)throw Error(m);};
await mkdir(out,{recursive:true,mode:0o700});
need((await readdir(out)).length===0,'Use a new empty browser receiving directory');
await mkdir(received,{mode:0o700});
const names=['input.json','report.json','report.html','observations.csv','manifest.json'];
const originals=new Map();
for(const name of names){
  const p=join(source,name),s=await lstat(p);
  need(s.isFile()&&!s.isSymbolicLink()&&s.size<=128*1024*1024,'Choose exact ordinary report files');
  originals.set(name,await readFile(p));
}
const manifest=JSON.parse(originals.get('manifest.json').toString('utf8'));
need(manifest.schema==='commons.institution-report-delivery.v1','Unknown report delivery');
for(const item of manifest.files){
  const raw=originals.get(item.path);
  need(raw&&raw.length===item.bytes&&sha(raw)===item.sha256,'Original report member differs: '+item.path);
}
need(manifest.files.length===4&&new Set(manifest.files.map(x=>x.path)).size===4,'Complete report manifest required');
async function retain(name,bytes){
  const fd=await open(join(out,name),'wx',0o600);
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
}
const type=name=>name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.csv')?'text/csv; charset=utf-8':'application/json; charset=utf-8';
let receivedReady=false;
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    const match=/^\/(original|received)\/(input\.json|report\.json|report\.html|observations\.csv|manifest\.json)$/.exec(path);
    if(req.method!=='GET'||!match||match[1]==='received'&&!receivedReady){res.writeHead(404);res.end();return;}
    const name=match[2],raw=match[1]==='original'?originals.get(name):await readFile(join(received,name));
    res.setHeader('Content-Type',type(name));res.setHeader('Cache-Control','no-store');
    if(name!=='report.html'||new URL(req.url,'http://127.0.0.1').searchParams.has('download'))
      res.setHeader('Content-Disposition','attachment; filename="'+name+'"');
    res.writeHead(200);res.end(raw);
  }catch(e){res.writeHead(500);res.end('Private receiving read failed');}
});
const module=await import(pathToFileURL(resolve(args['--playwright-module'])).href);
const chromium=module.chromium??module.default?.chromium;
need(chromium,'Selected Playwright module must expose chromium');
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
const origin='http://127.0.0.1:'+server.address().port;
let browser;
const errors=[];
try{
  browser=await chromium.launch({headless:true,executablePath:resolve(args['--chromium'])});
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1360,height:960}});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(String(e)));
  const navigation=await page.goto(origin+'/original/report.html',{waitUntil:'networkidle'});
  const servedHtml=await navigation.body();
  need(servedHtml.equals(originals.get('report.html')),'Rendered HTML differs from complete source');
  await retain('received/report.html',servedHtml);
  need(await page.locator('h1').count()===1,'Readable title missing');
  const headings=await page.locator('h2').allTextContents();
  need(headings.some(x=>x.includes('Institution'))&&headings.some(x=>x.includes('Peer'))&&
       headings.some(x=>x.includes('Source')),'All three report sections must render');
  need(await page.locator('table').count()>=3,'Complete readable report tables missing');
  const wide=await page.screenshot({fullPage:true});await retain('report-wide.png',wide);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({fullPage:true}).then(x=>retain('report-narrow.png',x));
  const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,
    text:document.body.innerText,headings:[...document.querySelectorAll('h2')].map(x=>x.textContent)}));
  need(sizes.text.includes('30.00')&&sizes.text.includes('2.25'),'Actual expected results are not visible');
  need(sizes.document<=sizes.viewport+1,'Narrow report overflows the page; review table containers');
  const downloads=[{path:'report.html',bytes:servedHtml.length,sha256:sha(servedHtml),method:'actual_document_response'}];
  for(const name of names.filter(x=>x!=='report.html')){
    const anchor=page.locator('a[href="'+name+'"],a[href="'+name+'?download=1"]');
    need(await anchor.count()>=1,'Readable report needs a direct download for '+name);
    const pending=page.waitForEvent('download');
    await anchor.first().click();
    const download=await pending;
    const target=join(received,name);
    need(await download.failure()===null,'Download failed: '+name);
    await download.saveAs(target);await chmod(target,0o600);
    const actual=await readFile(target);
    need(actual.equals(originals.get(name)),'Downloaded original differs: '+name);
    downloads.push({path:name,bytes:actual.length,sha256:sha(actual),method:'report_download_link'});
  }
  receivedReady=true;
  await context.close();
  const cold=await browser.newContext({viewport:{width:1360,height:960}});
  const reopened=await cold.newPage();reopened.on('pageerror',e=>errors.push(String(e)));
  await reopened.goto(origin+'/received/report.html',{waitUntil:'networkidle'});
  need(await reopened.locator('h1').textContent()===JSON.parse(originals.get('report.json')).title,
       'Cold received report title differs');
  const coldText=await reopened.locator('body').innerText();
  need(coldText.includes('30.00')&&coldText.includes('2.25'),'Cold report values differ');
  await reopened.screenshot({fullPage:true}).then(x=>retain('report-reopened.png',x));
  await cold.close();
  need(errors.length===0,'Browser errors: '+errors.join('; '));
  const result={schema:'commons.institution-browser-receiving.v1',state:'RENDERED_AND_DOWNLOADED',
    runtime:'Actual installed Playwright/Chromium',viewports:[{width:1360,height:960},{width:390,height:844}],
    headingText:headings,narrowDimensions:{viewport:sizes.viewport,document:sizes.document},
    downloads,coldReopen:true,browserErrors:errors,
    visualInspection:'Open the actual screenshots or browser screen and record the observed layout/content before recipient-ready status.'};
  await retain('browser-result.json',Buffer.from(JSON.stringify(result,null,2)+'\n'));
  console.log(JSON.stringify(result,null,2));
}finally{
  if(browser)await browser.close();
  await new Promise((ok,fail)=>server.close(e=>e?fail(e):ok()));
}
