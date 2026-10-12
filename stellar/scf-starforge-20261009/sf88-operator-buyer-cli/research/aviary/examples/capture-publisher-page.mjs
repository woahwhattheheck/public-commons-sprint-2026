#!/usr/bin/env node
/** Capture original publisher HTTP response bodies using an installed Playwright browser. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const allowedHosts=new Set(['www.usgs.gov','d9-wret.s3.us-west-2.amazonaws.com','aviaryplatform.com','www.aviaryplatform.com']);
const keptHeaders=new Set(['content-type','content-length','content-encoding','etag','last-modified','retry-after','date','location']);
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const now=()=>new Date().toISOString();
function allowed(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||!allowedHosts.has(u.hostname)||u.username||u.password||(u.port&&u.port!=='443'))throw new Error('Unexpected publisher URL: '+value);
 return u.href;
}
async function save(target,raw){
 const temporary=target+'.'+randomUUID()+'.tmp';
 await writeFile(temporary,raw,{flag:'wx',mode:0o600});await rename(temporary,target);
}
const input=JSON.parse(await new Promise((resolve,reject)=>{let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{raw+=chunk;if(raw.length>65536)reject(new Error('Capture request exceeds 64 KiB'));});process.stdin.on('end',()=>resolve(raw));process.stdin.on('error',reject);}));
const item=input.item;
if(!item||typeof item.id!=='string'||item.media_type!=='text/html'||!Number.isSafeInteger(item.max_bytes)||item.max_bytes<1||item.max_bytes>8388608)throw new Error('A bounded publisher HTML item is required');
allowed(item.url);
const directory=path.resolve(input.directory);
await mkdir(directory,{recursive:true,mode:0o700});
const modulePath=input.playwright_module||process.env.PLAYWRIGHT_MODULE;
const imported=modulePath?await import(pathToFileURL(path.resolve(modulePath)).href):require('playwright');
const chromium=imported.chromium||imported.default?.chromium;
if(!chromium)throw new Error('The installed module does not expose Chromium');
const browserOptions={headless:true,args:['--disable-dev-shm-usage','--renderer-process-limit=1']};
if(input.executable)browserOptions.executablePath=path.resolve(input.executable);
let browser,context,page,navigationError=null;
const records=[],responses=[],cleanup=[],started=now();
try{
 browser=await chromium.launch(browserOptions);context=await browser.newContext({acceptDownloads:false});
 page=await context.newPage();
 page.on('response',response=>{if(response.request().isNavigationRequest()&&response.frame()===page.mainFrame())responses.push(response);});
 try{
  await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:45000});
  if(item.id.endsWith('-page'))await page.getByText(/Public\s+Domain/i).first().waitFor({state:'attached',timeout:15000});
 }catch(error){navigationError=error.name+': '+error.message;}
 const final=allowed(page.url());
 for(const [index,response] of responses.entries()){
  let raw=Buffer.alloc(0);
  const record={schema:'commons.http.source-capture.v2',request_url:item.url,final_url:null,status:null,started_at:started,completed_at:null,headers:{},bytes:0,sha256:digest(raw),source_page:item.source_page||item.url,transport:'node-playwright-chromium',body_complete:false,body_truncated:false,body_representation:'Browser-decoded HTTP response entity; Content-Length may describe encoded bytes',error:null,retry_at:null,navigation_error:navigationError};
  try{
   record.final_url=allowed(response.url());record.status=response.status();
   record.headers=Object.fromEntries(Object.entries(await response.allHeaders()).filter(([key])=>keptHeaders.has(key.toLowerCase())).map(([key,value])=>[key.toLowerCase(),value]));
   const full=await response.body();raw=full.subarray(0,item.max_bytes+1);
   record.body_complete=full.length<=item.max_bytes;record.body_truncated=full.length>item.max_bytes;
   if(record.body_truncated)record.error='Response exceeds declared maximum';
   const wait=record.headers['retry-after'];
   if(wait){const retry=/^\d+$/.test(wait.trim())?Date.now()+Number(wait.trim())*1000:Date.parse(wait);if(Number.isFinite(retry))record.retry_at=new Date(retry).toISOString();}
  }catch(error){record.error=error.name+': '+error.message;}
  record.completed_at=now();record.bytes=raw.length;record.sha256=digest(raw);
  const bodyName='response-'+index+'.bin',recordName='response-'+index+'.json';
  await save(path.join(directory,bodyName),raw);
  await save(path.join(directory,recordName),Buffer.from(JSON.stringify(record,null,2)+'\n'));
  records.push({record:recordName,body:bodyName,finalDocument:new URL(record.final_url||item.url).href.split('#')[0]===new URL(final).href.split('#')[0]});
 }
 if(!records.length)throw new Error(navigationError||'Browser returned no publisher navigation response');
}catch(error){
 navigationError=navigationError||error.name+': '+error.message;
}finally{
 for(const [name,value] of [['page',page],['context',context],['browser',browser]]){
  if(!value)continue;try{await value.close();}catch(error){cleanup.push({stage:name,error:error.name+': '+error.message});}
 }
}
const result={schema:'commons.browser.publisher-capture.v1',started_at:started,completed_at:now(),request_url:item.url,records,navigation_error:navigationError,cleanup};
await save(path.join(directory,'result.json'),Buffer.from(JSON.stringify(result,null,2)+'\n'));
console.log(JSON.stringify({state:records.length?'CAPTURED':'FAILED',records:records.length,result:path.join(directory,'result.json')}));
if(!records.length)process.exitCode=2;
