// MIT. Operate the exact built VentCRM customer desks in an already authorized browser.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),opts={};for(let i=0;i<args.length;i+=2)opts[args[i]]=args[i+1];
for(const k of ['--cdp','--delivery','--out','--playwright-module'])if(!opts[k])throw Error('Use --cdp ENDPOINT --delivery COMPLETE_BUILT_DIRECTORY --out NEW_REVIEW_DIRECTORY --playwright-module EXISTING_ENTRY');
const out=resolve(opts['--out']),delivery=resolve(opts['--delivery']),hash=b=>createHash('sha256').update(b).digest('hex');
const mod=await import(pathToFileURL(resolve(opts['--playwright-module'])).href),chromium=mod.chromium||mod.default?.chromium;if(!chromium)throw Error('The existing Playwright entry has no Chromium connector.');
const result={schema:'ventcrm.original-browser-receiving.v1',status:'starting',startedAt:new Date().toISOString(),views:[],archives:[],operations:[],errors:[]};
await mkdir(out,{mode:0o700});
const save=()=>writeFile(join(out,'receiving.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
let browser,context,page;
try{
 const built=JSON.parse(await readFile(join(delivery,'build-result.json'),'utf8'));
 if(!built.validation?.whole_record_receive_equal||built.packages.length!==2)throw Error('Build the complete original customer programme first.');
 // Extract and read every actual stored ZIP member before the browser course.
 for(const pack of built.packages){
  const archive=await readFile(join(delivery,pack.name));if(archive.length!==pack.bytes||hash(archive)!==pack.sha256)throw Error('Built customer archive differs.');
  let offset=0;const extracted=[];
  const root=join(out,pack.name.replace(/\.zip$/,''));await mkdir(root,{mode:0o700});
  while(archive.readUInt32LE(offset)===0x04034b50){
   if(archive.readUInt16LE(offset+8)!==0)throw Error('The original archive expected stored members.');
   const size=archive.readUInt32LE(offset+18),nameLength=archive.readUInt16LE(offset+26),extra=archive.readUInt16LE(offset+28);
   const name=archive.subarray(offset+30,offset+30+nameLength).toString('utf8'),start=offset+30+nameLength+extra,body=archive.subarray(start,start+size);
   if(name.includes('/')||name.includes('\\')||name==='..'||body.length!==size)throw Error('Invalid complete customer archive member.');
   const expected=pack.members.find(x=>x.name===name);if(!expected||body.length!==expected.bytes||hash(body)!==expected.sha256||extracted.some(x=>x.name===name))throw Error('Actual customer member differs.');
   await writeFile(join(root,name),body,{flag:'wx',mode:0o600});
   if(name.endsWith('.json'))JSON.parse(body.toString('utf8'));
   extracted.push({name,bytes:body.length,sha256:hash(body)});offset=start+size;
  }
  if(extracted.length!==pack.members.length)throw Error('The complete archive selection was not received.');
  result.archives.push({...pack,extracted});
 }
 const documents=['sample.html','paid.html','sample-commissioning.html','paid-commissioning.html'];
 const originals=new Map();
 for(const name of documents){const body=await readFile(join(delivery,'customer',name));originals.set(name,body);await writeFile(join(out,name),body,{flag:'wx',mode:0o600});}
 browser=await chromium.connectOverCDP(opts['--cdp'],{timeout:30000,noDefaults:true});
 context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.route('https://ventcrm-receiving.invalid/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1),body=originals.get(name);if(!body)return route.abort();return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body});});
 page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
 const capture=async(name)=>{const f=name+'.png';await page.screenshot({path:join(out,f),fullPage:true});const m=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,title:document.title}));result.views.push({file:f,...m});if(m.scroll>m.width+1)throw Error('Page overflow in '+name);await save();};
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  for(const name of ['sample.html','paid.html']){
   const response=await page.goto('https://ventcrm-receiving.invalid/'+name,{waitUntil:'load'});if(hash(await response.body())!==hash(originals.get(name)))throw Error('Original profile navigation bytes differ.');
   await capture(name.replace('.html','')+'-'+width);
  }
  for(const name of ['sample-commissioning.html','paid-commissioning.html']){
   const response=await page.goto('https://ventcrm-receiving.invalid/'+name,{waitUntil:'load'});if(hash(await response.body())!==hash(originals.get(name)))throw Error('Original desk navigation bytes differ.');
   await page.getByRole('heading',{name:'Operator programmes',exact:true}).waitFor();
   await capture(name.replace('.html','')+'-operators-'+width);
   if(name.startsWith('sample')){
    for(const [tab,title] of [['setup','setup'],['records','records'],['checks','acceptance'],['handover','handover'],['guide','guide']]){
     await page.locator('[data-tab="'+tab+'"]').click({noWaitAfter:true});
     await capture('sample-'+title+'-'+width);
    }
   }
  }
 }
 // Continue the original sample desk through actual visible editing and file receiving.
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('https://ventcrm-receiving.invalid/sample-commissioning.html',{waitUntil:'load'});
 await page.locator('#reviewer').fill('Authored application receiving exercise');
 await page.locator('[data-tab="setup"]').click({noWaitAfter:true});
 await page.locator('[name="owner"]').fill('Authored receiving exercise — not operator data');
 await page.locator('[name="current_system"]').fill('Authored source used to operate this local desk');
 await page.getByRole('button',{name:'Save complete setup',exact:true}).click({noWaitAfter:true});
 const first=await page.evaluate(()=>window.ventcrmProgramme.read());if(first.revision!==1)throw Error('Actual setup save did not advance.');
 await page.locator('[data-tab="records"]').click({noWaitAfter:true});
 await page.locator('[name="name"]').fill('authored.csv');
 await page.locator('[name="entity"]').fill('customers');
 await page.locator('[name="rows"]').fill('1');
 await page.locator('[name="location"]').fill('Authored application receiving copy');
 await page.getByRole('button',{name:'Add record',exact:true}).click({noWaitAfter:true});
 await page.locator('[data-tab="checks"]').click({noWaitAfter:true});
 const sourceCheck=page.locator('form[data-check="source"]');
 await sourceCheck.locator('[name="status"]').selectOption('pass');
 await sourceCheck.locator('[name="evidence"]').fill('Authored application course: actual added source row retained. This is not an operator commissioning result.');
 await sourceCheck.getByRole('button',{name:'Save this check',exact:true}).click({noWaitAfter:true});
 const workingDownload=page.waitForEvent('download');
 await page.getByRole('button',{name:'Save working JSON',exact:true}).click({noWaitAfter:true});
 const downloaded=await workingDownload,jsonFile=join(out,'authored-working.json');await downloaded.saveAs(jsonFile);
 const sourceState=JSON.parse(await readFile(jsonFile,'utf8'));if(sourceState.revision!==3)throw Error('The three original UI operations are missing.');
 await page.locator('#open-file').setInputFiles(jsonFile);
 await page.getByRole('button',{name:'Open this complete working copy',exact:true}).click({noWaitAfter:true});
 const reopened=await page.evaluate(()=>window.ventcrmProgramme.read());if(JSON.stringify(reopened)!==JSON.stringify(sourceState))throw Error('Actual working JSON reopen differs.');
 await page.locator('[data-tab="handover"]').click({noWaitAfter:true});
 for(const [label,name] of [['Download check register CSV','authored-checks.csv'],['Download complete handover HTML','authored-handover.html']]){
  const event=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click({noWaitAfter:true});await (await event).saveAs(join(out,name));
 }
 await page.locator('[data-tab="setup"]').click({noWaitAfter:true});
 await page.locator('[name="notes"]').fill('Authored changed scope requires a renewed review.');
 await page.getByRole('button',{name:'Save complete setup',exact:true}).click({noWaitAfter:true});
 const changed=await page.evaluate(()=>window.ventcrmProgramme.read());
 if(changed.revision!==4||changed.operators[0].checks.source.status!=='unreviewed'||changed.operators[0].acceptance!==null)throw Error('Changed setup did not reopen review.');
 await page.reload({waitUntil:'load'});
 const cold=await page.evaluate(()=>window.ventcrmProgramme.read());if(JSON.stringify(cold)!==JSON.stringify(changed))throw Error('Cold local reopen differs.');
 result.operations.push({kind:'actual_visible_programme',revision:changed.revision,download_reopen_equal:true,changed_scope_reopened:true,cold_reopen_equal:true});
 await writeFile(join(out,'authored-operated-working.json'),JSON.stringify(changed,null,2)+'\n',{mode:0o600});
 if(result.errors.length)throw Error('Original browser reported a JavaScript error.');
 result.status='captured_for_producing_peer_view';
}catch(e){result.status='interrupted';result.error={message:e.message,stack:e.stack};process.exitCode=1;}
finally{await page?.close().catch(()=>{});await context?.close().catch(()=>{});result.closedAt=new Date().toISOString();await save();process.stdout.write(JSON.stringify({status:result.status,out,views:result.views.length,error:result.error})+'\n');}
// The process detaches its CDP client on exit. It never closes the shared browser.
