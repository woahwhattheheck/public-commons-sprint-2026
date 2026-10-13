/** Operate the original saved watershed product through its real browser interface.
 * Authored by TokenJunkieLabs. No remote map or data service is used.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i];
  if(!key?.startsWith('--')||process.argv[i+1]===undefined)throw Error('Use named argument/value pairs.');
  args[key.slice(2)]=process.argv[i+1];
}
for(const name of ['result','output','browser'])if(!args[name])throw Error('Missing --'+name);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const receipt=JSON.parse(fs.readFileSync(path.resolve(args.result),'utf8'));
const product=receipt.result||receipt;
if(product.network_huc12_count!==217)throw Error('Use the complete original 217-watershed receiving result.');
const root=path.resolve(product.directory), output=path.resolve(args.output);
fs.mkdirSync(output,{recursive:true});
const require=createRequire(import.meta.url);
const candidates=[args.playwright,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):null,'playwright'].filter(Boolean);
let playwright;
for(const candidate of candidates){try{playwright=require(candidate);break;}catch(error){if(candidate===args.playwright)throw error;}}
if(!playwright)throw Error('Use the existing installed Playwright module with --playwright.');
const mime={'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.csv':'text/csv; charset=utf-8','.gz':'application/gzip'};
const server=http.createServer((request,response)=>{
  try{
    const rel=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+rel);
    if(file!==root&&!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
    const actual=fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;
    response.writeHead(200,{'Content-Type':mime[path.extname(actual)]||'application/octet-stream'});
    fs.createReadStream(actual).pipe(response);
  }catch(error){response.writeHead(404);response.end('File not found');}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;
let browser;
const errors=[],steps=[],exports=[];
function check(value,message){if(!value)throw Error(message);}
async function visibleRows(page){return await page.locator('#members tbody tr:not([hidden])').count();}
try{
  browser=await playwright.chromium.launch({executablePath:path.resolve(args.browser),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(origin+'/index.html',{waitUntil:'load'});
  await page.waitForSelector('#watersheds path[data-huc]');
  check(await visibleRows(page)===product.membership_rows,'The browser membership count differs from the retained product.');
  const polygonCount=await page.locator('#watersheds path[data-huc]').count();
  check(polygonCount===217,'The map does not include all original source polygons.');
  await page.screenshot({path:path.join(output,'desktop-all-watersheds.png'),fullPage:true});
  steps.push({action:'open-original-product',polygon_count:polygonCount,memberships:await visibleRows(page)});
  for(const area of product.areas){
    await page.selectOption('#area',area.id);
    check(await visibleRows(page)===area.huc12_count,'The selected receiving area omitted original members: '+area.id);
    const mapped=await page.locator('#watersheds path.member').count();
    check(mapped===area.huc12_count,'The selected area map differs from its original memberships: '+area.id);
    steps.push({action:'select-area',area_id:area.id,memberships:await visibleRows(page),mapped});
  }
  await page.selectOption('#area','');
  const anchor=product.areas[0].anchor_huc12s[0];
  const shape=page.locator('#watersheds path[data-huc="'+anchor+'"]');
  await shape.focus();
  await page.keyboard.press('Enter');
  check(await page.inputValue('#search')===anchor,'Keyboard map selection did not select its original HUC12.');
  check((await page.locator('#map-selection').innerText()).includes(anchor),'The selected watershed was not announced.');
  const selected=await visibleRows(page);
  check(selected>0,'The selected original anchor has no browser membership.');
  steps.push({action:'keyboard-select-anchor',huc12:anchor,memberships:selected});
  const initialView=await page.locator('#watersheds').getAttribute('viewBox');
  await page.click('[data-map-action="in"]');
  const zoomed=await page.locator('#watersheds').getAttribute('viewBox');
  check(zoomed!==initialView,'Map zoom did not change the visible source extent.');
  await page.click('[data-map-action="reset"]');
  check(await page.locator('#watersheds').getAttribute('viewBox')==='0 0 1100 620','Reset did not restore the original full-domain view.');
  await page.fill('#search','  '+anchor+'  ');
  check(await visibleRows(page)===selected,'Whitespace changed the HUC12 search result.');
  await page.fill('#search','');
  check(await visibleRows(page)===product.membership_rows,'Clearing search did not restore the complete memberships.');
  await page.screenshot({path:path.join(output,'desktop-selected-source.png'),fullPage:true});
  const downloads=path.join(output,'browser-exports');fs.mkdirSync(downloads,{recursive:true});
  for(const [name,descriptor]of Object.entries(product.files)){
    const relative=descriptor.path||descriptor.filename;
    check(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.split(/[\\/]/).includes('..'),'Use original relative product file descriptors.');
    const response=await page.request.get(origin+'/'+relative.split('/').map(encodeURIComponent).join('/'));
    check(response.ok(),'The original browser export is unavailable: '+relative);
    const body=await response.body();
    check(body.equals(fs.readFileSync(path.join(root,relative))),'Browser export differs from the original saved bytes: '+relative);
    if(descriptor.sha256)check(sha(body)===descriptor.sha256,'Browser export does not match its source descriptor: '+relative);
    const destination=path.join(downloads,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,body);
    exports.push({name,path:relative,bytes:body.length,sha256:sha(body)});
  }
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
  const mobile=await phone.newPage();mobile.on('pageerror',error=>errors.push(String(error)));
  await mobile.goto(origin+'/index.html',{waitUntil:'load'});
  await mobile.selectOption('#area',product.areas[0].id);
  await mobile.fill('#search',anchor);
  check(await visibleRows(mobile)>0,'The phone view lost the chosen original anchor.');
  await mobile.screenshot({path:path.join(output,'phone-selected-watershed.png'),fullPage:true});
  const layout=await mobile.evaluate(()=>({viewport:window.innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  steps.push({action:'phone-selection',huc12:anchor,visible_memberships:await visibleRows(mobile),layout});
  check(layout.document<=layout.viewport+1,'The phone document overflows horizontally; inspect the retained screenshot.');
  await mobile.close();await phone.close();
  await context.close();
  const reopened=await browser.newContext({viewport:{width:1280,height:900}});
  const fresh=await reopened.newPage();fresh.on('pageerror',error=>errors.push(String(error)));
  await fresh.goto(origin+'/index.html',{waitUntil:'load'});
  check(await visibleRows(fresh)===product.membership_rows,'A fresh browser context did not reopen the complete product.');
  check(await fresh.inputValue('#search')==='','A new browser context inherited an unsaved search.');
  await fresh.selectOption('#area',product.areas[product.areas.length-1].id);
  check(await visibleRows(fresh)===product.areas[product.areas.length-1].huc12_count,'Reopened area selection changed the original membership.');
  await fresh.screenshot({path:path.join(output,'reopened-saved-product.png'),fullPage:true});
  steps.push({action:'cold-browser-reopen',id:product.id,memberships:product.membership_rows});
  await reopened.close();
  check(errors.length===0,'The original interface raised browser errors: '+errors.join('; '));
  const result={operation:'UPSTATE-RECEPTOR-RECEIVING-20261012',state:'BROWSER_COMPLETE',product_id:product.id,source_binding:product.source_binding,directory:root,steps,exports,errors};
  fs.writeFileSync(path.join(output,'browser-result.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){
  fs.writeFileSync(path.join(output,'browser-error.json'),JSON.stringify({operation:'UPSTATE-RECEPTOR-RECEIVING-20261012',error:String(error),steps,exports,errors},null,2)+'\n');
  throw error;
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
