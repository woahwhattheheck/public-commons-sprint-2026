// Operate the exact BroomDesk customer apps through an existing authorized browser.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const opts={},argv=process.argv.slice(2);for(let i=0;i<argv.length;i+=2)opts[argv[i]]=argv[i+1];
for(const k of ['--cdp','--delivery','--out','--playwright-module'])if(!opts[k])throw Error('Use --cdp EXISTING_ENDPOINT --delivery BUILT_DIRECTORY --out NEW_DIRECTORY --playwright-module EXISTING_ENTRY');
const req=createRequire(import.meta.url),entry=req.resolve(resolve(opts['--playwright-module']));let dir=dirname(entry),metadata;
while(true){try{const p=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));if(['playwright','playwright-core'].includes(p.name)){metadata=p;break;}}catch{}const parent=dirname(dir);if(parent===dir)break;dir=parent;}
const version=/^(\d+)\.(\d+)\./.exec(metadata?.version||'');if(!version||+version[1]<1||(+version[1]===1&&+version[2]<60))throw Error('Use installed Playwright1.60+ for noDefaults.');
const url=new URL(opts['--cdp']);if(!['http:','https:','ws:','wss:'].includes(url.protocol)||url.username||url.password)throw Error('Use an authorized endpoint without embedded credentials.');
const mod=await import(pathToFileURL(entry)),chromium=mod.chromium||mod.default?.chromium;
const out=resolve(opts['--out']),delivery=resolve(opts['--delivery']),hash=b=>createHash('sha256').update(b).digest('hex'),result={schema:'broomdesk.commissioning-browser-receiving.v1',status:'starting',views:[],downloads:[],events:[],errors:[]};
await mkdir(out,{mode:0o700});const save=()=>writeFile(join(out,'receiving.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});let browser,context,page;
try{
 const built=JSON.parse(await readFile(join(delivery,'build-result.json'),'utf8'));if(!built.validation.full_record_reopen_equal)throw Error('Build the complete original source first.');
 const bodies=new Map();for(const kind of ['sample','paid'])for(const p of ['profiles/'+kind+'/lead-pack.html','desk/'+kind+'/commissioning.html']){const b=await readFile(join(delivery,'customer',p));bodies.set('/'+p,b);await writeFile(join(out,p.replaceAll('/','-')),b,{flag:'wx',mode:0o600});}
 browser=await chromium.connectOverCDP(opts['--cdp'],{noDefaults:true,timeout:30000});context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000},timezoneId:'UTC'});
 await context.route('https://broomdesk-receiving.invalid/**',route=>{const b=bodies.get(new URL(route.request().url()).pathname);return b?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:b}):route.abort();});
 page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));page.on('dialog',d=>d.accept());
 const go=async p=>{const r=await page.goto('https://broomdesk-receiving.invalid/'+p);if(hash(await r.body())!==hash(bodies.get('/'+p)))throw Error('Original navigation bytes differ.');};
 const capture=async name=>{const file=name+'.png';await page.screenshot({path:join(out,file),fullPage:true});const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));if(layout.documentWidth>layout.width+1)throw Error('Page overflow: '+name);result.views.push({file,...layout});await save();};
 const tab=async name=>page.locator('[data-tab="'+name+'"]').click();
 const fill=async(kind,values)=>{const form=page.locator('form[data-form="'+kind+'"]');for(const[k,v]of Object.entries(values)){const field=form.locator('[name="'+k+'"]');if(!await field.count())continue;const tag=await field.evaluate(e=>({tag:e.tagName,type:e.type}));if(tag.tag==='SELECT')await field.selectOption(Array.isArray(v)?v:String(v??''));else await field.fill(v===null?'':tag.type==='datetime-local'&&v?String(v).slice(0,16):String(v??''));}};
 const submit=async kind=>{const before=Number(await page.locator('[data-revision]').getAttribute('data-revision'));await page.locator('form[data-form="'+kind+'"] button[type="submit"],form[data-form="'+kind+'"] button:not([type])').first().click();await page.waitForFunction(expected=>Number(document.querySelector('[data-revision]')?.dataset.revision)===expected||!!document.querySelector('.error'),before+1);if(await page.locator('.error').count())throw Error(await page.locator('.error').textContent());};
 const download=async(button,name)=>{const wait=page.waitForEvent('download');await button.click();const d=await wait,p=join(out,name);await d.saveAs(p);const b=await readFile(p);result.downloads.push({name,bytes:b.length,sha256:hash(b)});await save();return p;};
 for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});for(const kind of ['sample','paid']){await go('profiles/'+kind+'/lead-pack.html');await capture(kind+'-original-profile-'+width);await go('desk/'+kind+'/commissioning.html');await page.getByRole('heading',{name:'Original company selection'}).waitFor();if(await page.locator('article.card').count()!==(kind==='sample'?1:5))throw Error('Original company scope differs.');await capture(kind+'-companies-'+width);}}
 await page.setViewportSize({width:1440,height:1000});await go('desk/sample/commissioning.html');
 // Use the actual open-working control while newly typed fields arrive during reading.
 await tab('Setup');
 await page.evaluate(()=>{const original=File.prototype.text;window.__releaseWorkingRead=null;File.prototype.text=function(){return new Promise(resolve=>{window.__releaseWorkingRead=async()=>{File.prototype.text=original;resolve(await original.call(this));};});};});
 await page.locator('#open-working').setInputFiles(join(delivery,'customer/desk/sample/blank-working.json'));
 await page.waitForFunction(()=>typeof window.__releaseWorkingRead==='function');
 await page.locator('form[data-form="pilot"] [name="owner"]').fill('Unsaved receiving owner');
 await page.evaluate(()=>window.__releaseWorkingRead());
 await page.locator('.error').waitFor();
 if(await page.locator('form[data-form="pilot"] [name="owner"]').inputValue()!=='Unsaved receiving owner')throw Error('Late working-file intake erased new fields.');
 await tab('Companies');
 const example=JSON.parse(await readFile(new URL('./authored-receiving.json',import.meta.url),'utf8')),ids=new Map(),views={pilot:'Setup',property:'Setup',worker:'Setup',visit:'Visits',schedule_change:'Visits',time:'Time',attachment:'Intake',intake:'Intake',payroll:'Time',check:'Checks',decision:'Checks'};
 const refFields=new Set(['pilot_id','property_id','worker_id','visit_id','attachment_id','original_export_id']);
 let invalidEntryExercised=false;
 async function operate(action){
  const {kind,record}=action;await tab(views[kind]);const mapped=Object.fromEntries(Object.entries(record).map(([k,v])=>[k,refFields.has(k)?ids.get(v)||v:['worker_ids','time_ids'].includes(k)?v.map(x=>ids.get(x)||x):v]));
  if(ids.has(record.id)&&kind!=='schedule_change'){await page.locator('[data-edit="'+kind+'"][data-id="'+ids.get(record.id)+'"]').click();}
  if(kind==='attachment'){const file=Buffer.from(record.content_base64,'base64');await page.locator('form[data-form="attachment"] [name="file"]').setInputFiles({name:record.name,mimeType:record.type,buffer:file});await fill(kind,{source:record.source,purpose:record.purpose});}
  else if(kind==='schedule_change'){await fill(kind,{kind:record.kind,mode:record.mode,reason:record.reason,requested_by:record.requested_by,result_source:record.result_source,updates:record.updates.map(x=>[ids.get(x.id),x.starts_at,x.ends_at,x.status].join(', ')).join('\n')});}
  else await fill(kind,mapped);
  if(kind==='time'&&ids.has(record.id)&&!invalidEntryExercised){
   const revision=Number(await page.locator('[data-revision]').getAttribute('data-revision'));await fill(kind,{approved_minutes:9999});await page.locator('form[data-form="time"] button[type="submit"]').click();await page.locator('.error').waitFor();if(Number(await page.locator('[data-revision]').getAttribute('data-revision'))!==revision)throw Error('Invalid edited time was saved.');await fill(kind,{approved_minutes:record.approved_minutes});invalidEntryExercised=true;
   // The failed edit deliberately retains its form and record identity. Wait on
   // successful revision, not the already-visible prior validation message.
   await page.locator('form[data-form="time"] button[type="submit"]').click();await page.waitForFunction(expected=>Number(document.querySelector('[data-revision]')?.dataset.revision)===expected,revision+1);
  }else await submit(kind);
  if(!ids.has(record.id)){if(kind==='pilot')ids.set(record.id,await page.locator('#pilot-select option').last().getAttribute('value'));else if(kind==='attachment')ids.set(record.id,await page.locator('[data-file]').last().getAttribute('data-file'));else if(!['schedule_change','check'].includes(kind))ids.set(record.id,await page.locator('[data-edit="'+kind+'"]').last().getAttribute('data-id'));}
 }
 for(const action of example.operations.slice(0,-1)){
  await operate(action);
  if(action.kind==='pilot'){
   await tab('Intake');
   await page.evaluate(()=>{const original=File.prototype.arrayBuffer;window.__releaseAttachmentRead=null;File.prototype.arrayBuffer=function(){return new Promise(resolve=>{window.__releaseAttachmentRead=async()=>{File.prototype.arrayBuffer=original;resolve(await original.call(this));};});};});
   await page.locator('form[data-form="attachment"] [name="file"]').setInputFiles({name:'authored-late-source.csv',mimeType:'text/csv',buffer:Buffer.from('source\\nretained\\n')});
   await fill('attachment',{source:'Authored delayed intake',purpose:'schedule'});
   await page.locator('form[data-form="attachment"] button[type="submit"]').click();
   await page.waitForFunction(()=>typeof window.__releaseAttachmentRead==='function');
   await tab('Setup');await page.evaluate(()=>window.__releaseAttachmentRead());
   await page.locator('.error').waitFor();
   if(Number(await page.locator('[data-revision]').getAttribute('data-revision'))!==1)throw Error('Late attachment was attached after navigation.');
   await tab('Companies');
  }
 }
 for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});for(const name of ['Companies','Setup','Intake','Visits','Time','Checks','Delivery','Guide']){await tab(name);await capture('operated-'+name.toLowerCase()+'-'+width);}}
 const workingPath=await download(page.getByRole('button',{name:'Save working file',exact:true}),'operated-working.json'),working=JSON.parse(await readFile(workingPath,'utf8')),seed=JSON.parse(await page.locator('#desk-seed').textContent()),Core=req('./commissioning-core.cjs');
 if(working.revision!==27||working.times.length!==1||Core.canonical(Core.receive(working,seed))!==Core.canonical(working))throw Error('Actual complete working file did not reopen or failed edit duplicated time.');
 await tab('Delivery');const sourcePath=await download(page.getByRole('button',{name:'Download complete application source',exact:true}),'downloaded-application-source.json'),source=JSON.parse(await readFile(sourcePath,'utf8'));if(hash(req('./render.cjs').render(source))!==hash(bodies.get('/desk/sample/commissioning.html')))throw Error('Actual downloaded source did not rebuild the selected app.');
 const handover=await download(page.getByRole('button',{name:'Download selected handover',exact:true}),'BroomDesk-handover.json');await download(page.getByRole('button',{name:'Download readable handover',exact:true}),'BroomDesk-handover.html');const packet=JSON.parse(await readFile(handover,'utf8'));if(packet.properties.some(x=>'access_method'in x)||packet.workers.some(x=>'payroll_ref'in x))throw Error('Private custody fields leaked into handover.');
 await tab('Time');await download(page.locator('[data-payroll]').first(),'BroomDesk-approved-time.csv');
 // A fresh owned context receives the entire downloaded file through the app.
 await context.close();context=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844},timezoneId:'UTC'});
 await context.route('https://broomdesk-receiving.invalid/**',route=>{const b=bodies.get(new URL(route.request().url()).pathname);return b?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:b}):route.abort();});page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));page.on('dialog',d=>d.accept());await go('desk/sample/commissioning.html');await page.locator('#open-working').setInputFiles(workingPath);await page.waitForFunction(()=>Number(document.querySelector('[data-revision]')?.dataset.revision)===27);
 await operate(example.operations.at(-1));await tab('Checks');await page.getByText('review after changes',{exact:false}).first().waitFor();await capture('received-phone-later-review-open');
 const laterPath=await download(page.getByRole('button',{name:'Save working file',exact:true}),'later-working.json'),later=JSON.parse(await readFile(laterPath,'utf8'));if(later.revision!==28||Core.canonical(Core.receive(later,seed))!==Core.canonical(later)||Core.isCurrent(later,later.decisions[0]))throw Error('Actual later received edit did not reopen acceptance.');
 result.events.push({kind:'complete_original_commissioning_operated',accepted_revision:27,reopened_revision:28,invalid_edit_corrected_same_record:invalidEntryExercised});if(result.errors.length)throw Error(result.errors.join('\n'));result.status='PASS';
}catch(error){result.status='FAILED';result.error={message:error.message,stack:error.stack};throw error;}finally{if(context)try{await context.close();}catch(e){result.status='FAILED';result.cleanup_error=e.message;}result.attached_browser_preserved=true;await save();}
console.log(JSON.stringify({status:result.status,views:result.views.length,downloads:result.downloads.length}));process.exit(result.status==='PASS'?0:1);
