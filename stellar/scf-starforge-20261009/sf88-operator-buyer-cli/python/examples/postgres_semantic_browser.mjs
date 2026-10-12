#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';

const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const require=createRequire(path.join(config.node_modules,'package.json'));
const {chromium}=require('playwright');
await fs.mkdir(config.directory,{recursive:true,mode:0o700});
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const result={schema:'stellar-forge.postgres-semantic-browser.v1',state:'RUNNING',
  started_at:new Date().toISOString(),version_ids:config.version_ids,views:[],downloads:[],screenshots:[],errors:[]};
let browser, page, closePromise, interruption;
const saved=async()=>{
  const temporary=path.join(config.directory,'.receiving-'+process.pid+'.json');
  await fs.writeFile(temporary,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  await fs.rename(temporary,path.join(config.directory,'receiving.json'));
};
async function closeBrowser(){
  if(!browser)return;
  closePromise??=browser.close();
  await closePromise;
  result.browser_closed=true;
}
const handlers=new Map(['SIGTERM','SIGINT','SIGHUP'].map(name=>[name,()=>{
  interruption??=name;
  result.state='INTERRUPTED';result.error='Receiving interrupted by '+interruption;
  if(browser)void closeBrowser().catch(error=>{result.close_error=error.message;});
}]));
for(const [name,handler] of handlers)process.on(name,handler);
const requireValue=(value,message)=>{if(!value)throw new Error(message);};
async function ready(){
  await page.waitForFunction(()=>document.getElementById('database-label')?.textContent.startsWith('PostgreSQL '));
  await page.waitForFunction(()=>!document.getElementById('refresh').disabled);
}
async function idle(){
  await page.waitForFunction(()=>!document.getElementById('refresh').disabled);
  const notice=page.locator('#message[data-level=error]:not([hidden])');
  if(await notice.count())throw new Error(await notice.innerText());
}
async function screen(name){
  await page.locator('[data-screen="'+name+'"]').click();
  await page.locator('#screen-'+name).waitFor({state:'visible'});
}
async function api(route){
  return page.evaluate(async route=>{
    const response=await fetch(route,{headers:{'X-Postgres-Capability':sessionStorage.getItem('postgres-capability')}});
    const value=await response.json();if(!response.ok)throw new Error(value.error);
    return value;
  },route);
}
async function screenshot(name){
  const target=path.join(config.directory,name);
  await page.screenshot({path:target,fullPage:true});
  const raw=await fs.readFile(target);result.screenshots.push({name,bytes:raw.length,sha256:sha(raw)});
}
async function geometry(name){
  const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  requireValue(size.document<=size.viewport+2&&size.body<=size.viewport+2,'The '+name+' page exceeds its mobile viewport.');
  result.views.push({name,...size});await saved();
}
async function download(button,name,expected){
  const waiting=page.waitForEvent('download');
  await button.click();const received=await waiting;
  const target=path.join(config.directory,name);await received.saveAs(target);
  const raw=await fs.readFile(target);
  if(expected)requireValue(sha(raw)===expected,'Original downloaded dictionary differs.');
  result.downloads.push({name,bytes:raw.length,sha256:sha(raw),suggested_name:received.suggestedFilename()});
  await idle();return JSON.parse(raw.toString('utf8'));
}
async function openEdition(id){
  await screen('editions');
  const choice=page.locator('#edition-list button.item').filter({hasText:id.slice(0,12)});
  while(await choice.count()===0){
    const more=page.locator('#more-editions');
    requireValue(await more.isVisible(),'The original retained edition is absent from the complete browser list: '+id);
    await more.click();await idle();
  }
  await choice.click();
  await page.waitForFunction(id=>document.getElementById('edition-json')?.textContent.includes(id),id);
  await idle();
  await page.locator('#edition-meanings').getByRole('heading',{name:'Original field meanings',exact:true}).waitFor();
}
try{
  browser=await chromium.launch({executablePath:config.chromium,headless:true,
    handleSIGTERM:false,handleSIGINT:false,handleSIGHUP:false,
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--renderer-process-limit=1']});
  requireValue(!interruption,'Receiving interrupted by '+interruption);
  page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  page.setDefaultTimeout(25000);
  page.on('pageerror',error=>result.errors.push(error.message));
  await page.goto(config.url,{waitUntil:'domcontentloaded'});await ready();
  const first=await api('/api/versions/'+config.version_ids[0]);
  requireValue(first.row_count===config.rows&&first.semantics_status==='RETAINED','The original received edition is required.');
  await screen('source');await page.locator('#report-path').fill(config.report);
  await page.getByRole('button',{name:'Inspect delivery',exact:true}).click();
  await page.locator('#source-panel').waitFor({state:'visible'});await idle();
  await page.locator('#source-meanings').getByRole('heading',{name:'Original field meanings',exact:true}).waitFor();
  requireValue(await page.locator('#mapping-rows tr').count()===first.mapping.columns.length,'The source mapping omitted a field.');
  result.views.push({name:'Original source and complete meanings',rows:config.rows,fields:first.mapping.columns.length,viewport:1440});
  await screenshot('source-meanings-desktop.png');
  await openEdition(config.version_ids[0]);
  const dictionary=await download(page.locator('#download-semantics'),'semantics.json',config.dictionary_sha256);
  requireValue(dictionary.sha256===first.semantics.semantic_sha256,'The dictionary semantic identity differs.');
  await page.locator('#edition-meanings').getByText('Original dictionary and source capture',{exact:true}).click();
  await screenshot('retained-meanings-desktop.png');
  await screen('views');await page.locator('#view-name').fill('source_data');
  await page.locator('#view-version').selectOption(config.version_ids[0]);
  await page.getByRole('button',{name:'Review current view and selection',exact:true}).click();
  await page.locator('#view-review').waitFor({state:'visible'});await idle();
  await page.locator('#view-meanings').getByRole('heading',{name:'Original field meanings',exact:true}).waitFor();
  result.views.push({name:'Original selected view and source meanings',viewport:1440});
  await screen('compare');
  await page.locator('#compare-previous').selectOption(config.version_ids[0]);
  await page.locator('#compare-current').selectOption(config.version_ids[1]);
  await page.getByRole('button',{name:'Compare source meanings',exact:true}).click();
  await page.locator('#compare-meaning-result').getByRole('heading',{name:'Source meaning comparison',exact:true}).waitFor();
  await idle();
  const compared=await download(page.locator('#compare-meaning-result').getByRole('button',{name:'Download complete meaning comparison',exact:true}),
    'meaning-comparison.json');
  requireValue(compared.mapping_changed&&!compared.definition_changed&&!compared.capture_changed&&compared.columns.length===1,
    'The original source and alternate receiving alias comparison differs.');
  await screenshot('meaning-comparison-desktop.png');
  await page.setViewportSize({width:390,height:844});
  await geometry('Source meaning comparison');
  await screenshot('meaning-comparison-390px.png');
  await openEdition(config.version_ids[0]);await geometry('Retained edition meanings');
  await screenshot('retained-meanings-390px.png');
  await screen('source');await geometry('Original source mapping and dictionary');
  await screenshot('source-meanings-390px.png');
  await screen('views');await geometry('Application view meanings');
  await screen('recovery');await geometry('Original import operations');
  await page.reload({waitUntil:'domcontentloaded'});await ready();
  const reopened=await api('/api/versions/'+config.version_ids[0]);
  const current=await api('/api/current?name=source_data');
  requireValue(reopened.semantics.file.sha256===config.dictionary_sha256&&
    current.version.version_id===config.version_ids[0],'The original dictionary or selected edition changed on reload.');
  result.reopened={warehouse_id:reopened.warehouse_id,version_id:reopened.version_id,
    semantic_sha256:reopened.semantics.semantic_sha256,selected_revision:current.revision};
  requireValue(result.errors.length===0,'The original browser reported an application error.');
  requireValue(!interruption,'Receiving interrupted by '+interruption);
  result.state='COMPLETE';result.completed_at=new Date().toISOString();
}catch(error){
  result.state=interruption?'INTERRUPTED':'FAILED';
  result.error=interruption?'Receiving interrupted by '+interruption:error.message;
  result.stack=error.stack?.split('\n').slice(0,6);
}finally{
  try{await closeBrowser();}
  catch(error){result.state='FAILED';result.close_error=error.message;result.browser_closed=false;}
  if(!browser)result.browser_closed=false;
  await saved();
  for(const [name,handler] of handlers)process.off(name,handler);
  process.stdout.write(JSON.stringify({state:result.state,result:path.join(config.directory,'receiving.json'),error:result.error})+'\n');
  process.exitCode=result.state==='COMPLETE'?0:1;
}
