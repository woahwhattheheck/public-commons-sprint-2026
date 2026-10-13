// Operate the exact MapRank customer apps through an existing authorized browser.
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
const out=resolve(opts['--out']),delivery=resolve(opts['--delivery']),hash=b=>createHash('sha256').update(b).digest('hex'),result={schema:'maprank.pilot-browser-receiving.v1',status:'starting',views:[],downloads:[],events:[],errors:[]};
await mkdir(out,{mode:0o700});const save=()=>writeFile(join(out,'receiving.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});let browser,context,page;
try{
 const built=JSON.parse(await readFile(join(delivery,'build-result.json'),'utf8'));if(!built.validation.complete_reopen_equal)throw Error('Build the complete source first.');
 const bodies=new Map();for(const kind of ['sample','paid'])for(const p of ['profiles/'+kind+'.html','pilot/'+kind+'-desk.html']){const b=await readFile(join(delivery,'customer',p));bodies.set('/'+p,b);await writeFile(join(out,p.replaceAll('/','-')),b,{flag:'wx',mode:0o600});}
 browser=await chromium.connectOverCDP(opts['--cdp'],{noDefaults:true,timeout:30000});context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
 await context.route('https://maprank-receiving.invalid/**',route=>{const b=bodies.get(new URL(route.request().url()).pathname);return b?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:b}):route.abort();});
 page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));page.on('dialog',d=>d.accept());
 const go=async p=>{const r=await page.goto('https://maprank-receiving.invalid/'+p);if(hash(await r.body())!==hash(bodies.get('/'+p)))throw Error('Original navigation bytes differ.');};
 const capture=async name=>{const f=name+'.png';await page.screenshot({path:join(out,f),fullPage:true});const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));if(layout.documentWidth>layout.width+1)throw Error('Page overflow: '+name);result.views.push({file:f,...layout});await save();};
 const tab=async name=>page.locator('[data-tab="'+name+'"]').click();
 const fill=async(form,values)=>{for(const[k,v]of Object.entries(values)){const f=page.locator('#'+form+' [name="'+k+'"]');if(await f.evaluate(e=>e.tagName)==='SELECT')await f.selectOption(String(v));else await f.fill(String(v));}};
 const submit=async name=>{const previous=Number(await page.locator('#notice').getAttribute('data-revision'));await page.locator('#'+name+' button[type="submit"]').click();await page.waitForFunction(expected=>{const n=document.querySelector('#notice');return Number(n.dataset.revision)===expected||n.classList.contains('error');},previous+1);if(await page.locator('#notice').evaluate(n=>n.classList.contains('error')))throw Error(await page.locator('#notice').textContent());};
 const download=async(button,name)=>{const wait=page.waitForEvent('download');await button.click();const d=await wait,p=join(out,name);await d.saveAs(p);const b=await readFile(p);result.downloads.push({name,bytes:b.length,sha256:hash(b)});await save();return p;};
 for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});for(const k of ['sample','paid']){await go('profiles/'+k+'.html');await capture(k+'-profile-'+width);await go('pilot/'+k+'-desk.html');await page.getByRole('heading',{name:'Choose an agency profile'}).waitFor();if(await page.locator('[data-plan]').count()!==(k==='sample'?1:5))throw Error('Original agency scope differs.');await capture(k+'-agencies-'+width);}}
 await page.setViewportSize({width:1440,height:1000});await go('pilot/sample-desk.html');
 const sourcePath=await download(page.getByRole('button',{name:'Download complete application source',exact:true}),'downloaded-application-source.json'),downloadedSource=JSON.parse(await readFile(sourcePath,'utf8'));if(hash(req('./render.cjs').render(downloadedSource))!==hash(bodies.get('/pilot/sample-desk.html')))throw Error('Actual downloaded full source did not rebuild the exact selected app.');
 await page.locator('[data-plan]').first().click();
 await fill('pilot-form',{client:'Authored receiving example',location:'Example location — no live customer data',identity_source:'Authored receiving fixture',identity_review:'matched',operator:'Receiving operator',reviewer:'Receiving reviewer',question:'Receive exact original inputs through a complete pilot.',target:'Complete original workflow',timezone:'UTC'});await submit('pilot-form');
 await tab('Scope');await fill('account-form',{label:'Authored account',plan:'Entered example',source:'Authored account snapshot',owner:'Receiving operator',grid_ceiling:5,balance:100,topup:0});await submit('account-form');
 const points=Array.from({length:9},(_,i)=>'p'+i+'\t'+(10+Math.floor(i/3)*.01)+'\t'+(20+(i%3)*.01)).join('\n');
 await fill('scope-form',{keyword:'authored receiving phrase',rows:3,columns:3,center_latitude:10.01,center_longitude:20.01,spacing:1,unit:'km',expected_points:9,depth:20,occurrences:2,budget:18,points_text:points,reason:'Authored source-receiving geometry'});await submit('scope-form');
 await tab('Results');
 const attachment=page.locator('#attachment-form');await page.locator('details').first().locator('summary').click();
 await attachment.locator('[name="source_file"]').setInputFiles({name:'authored-source.txt',mimeType:'text/plain',buffer:Buffer.from('Authored source receiving file. No customer ranking data.\n')});await fill('attachment-form',{source:'Authored receiving fixture',visibility:'client_selected'});await submit('attachment-form');
 const pointResults=Array.from({length:9},(_,i)=>points.split('\n')[i]+'\t'+(i===8?'not_found':'ranked')+'\t'+(i===8?'':i+1)+'\tAuthored row '+i).join('\n');
 await fill('observation-form',{mode:'manual_transcription',status:'completed',captured_at:'2026-10-13T14:30',source:'Authored original result',points_text:pointResults,average_rank:'Provider text 4.5',top3_coverage:'Provider text 33.3%',notes:'Internal receiving note'});await submit('observation-form');
 await tab('Review');const observationId=await page.locator('#decision-form [name="baseline_id"] option').nth(1).getAttribute('value');
 await fill('decision-form',{baseline_id:observationId,outcome:'finish_pilot',decided_by:'Authored receiving reviewer',decided_at:'2026-10-13T14:31',rationale:'Authored original application path completed.',client_summary:'Authored receiving exercise only.'});await submit('decision-form');
 for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});for(const name of ['Agencies','Pilots','Scope','Results','Review','Delivery','Guide']){await tab(name);await capture('operated-'+name.toLowerCase()+'-'+width);}}
 const workingPath=await download(page.getByRole('button',{name:'Save working file',exact:true}),'operated-working.json'),working=JSON.parse(await readFile(workingPath,'utf8'));
 if(working.revision!==6)throw Error('Expected full six-action original UI course.');const seed=JSON.parse(await page.locator('#pilot-seed').textContent());
 const Core=req('./pilot-core.cjs');if(Core.canonical(Core.receive(working,seed))!==Core.canonical(working))throw Error('Downloaded full working file differs.');
 await tab('Delivery');await page.locator('#handover-form [name="decision_id"]').selectOption(working.decisions[0].id);await page.locator('#handover-form [name="attachment_ids"]').check();
 const files=[];let handler;const completed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Both handover downloads did not arrive.')),30000);handler=d=>{files.push(d);if(files.length===2){clearTimeout(timer);resolve();}};page.on('download',handler);});try{await page.locator('#handover-form button').click();await completed;}finally{page.off('download',handler);}
 if(files.length!==2)throw Error('Client handover must produce both packet and readable report.');for(const d of files){const name=d.suggestedFilename();await d.saveAs(join(out,name));const b=await readFile(join(out,name));result.downloads.push({name,bytes:b.length,sha256:hash(b)});}
 const packet=JSON.parse(await readFile(join(out,'MapRank-client-handover.json'),'utf8'));if(packet.attachments.length!==1||'notes'in packet.baseline)throw Error('Client handover selection differs.');
 await page.evaluate(()=>localStorage.clear());await page.reload();await page.locator('#working-file').setInputFiles(workingPath);await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Opened all 6'));
 await tab('Pilots');await page.locator('[data-edit-pilot]').first().click();await fill('pilot-form',{target:'Later changed target'});await submit('pilot-form');await tab('Review');await page.getByText('Review needed after changes',{exact:false}).waitFor();await capture('phone-received-and-review-invalidated');
 const finalPath=await download(page.getByRole('button',{name:'Save working file',exact:true}),'later-working.json');const final=JSON.parse(await readFile(finalPath,'utf8'));if(final.revision!==7||Core.canonical(Core.receive(final,seed))!==Core.canonical(final))throw Error('Changed full working file did not reopen.');
 result.events.push({kind:'whole_original_pilot_operated',accepted_revision:6,reopened_revision:7,client_attachments:1});if(result.errors.length)throw Error(result.errors.join('\n'));result.status='PASS';
}catch(error){result.status='FAILED';result.error={message:error.message,stack:error.stack};throw error;}finally{if(context)try{await context.close();}catch(e){result.status='FAILED';result.cleanup_error=e.message;}result.attached_browser_preserved=true;await save();}
console.log(JSON.stringify({status:result.status,views:result.views.length,downloads:result.downloads.length}));process.exit(result.status==='PASS'?0:1);
