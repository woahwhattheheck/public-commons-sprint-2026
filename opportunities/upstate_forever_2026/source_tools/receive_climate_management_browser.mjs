#!/usr/bin/env node
/** Original completed Climate/Management browser continuation. TokenJunkieLabs.
 * This course only opens the original copied applications and retained products.
 * It records actual browser operation and rendered files; human LOOK remains explicit.
 */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {hostname} from 'node:os';
import assert from 'node:assert/strict';

const SCHEMA='upstate.climate-management-browser/v1';
const now=()=>new Date().toISOString();
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(ordered(v))).digest('hex');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=v=>{assert.match(v||'',/^[0-9a-f]{64}$/);return v;};
const within=(root,p)=>{const r=path.relative(root,p);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
const member=v=>{assert.ok(typeof v==='string'&&v&&!path.isAbsolute(v)&&!v.includes('\\')&&v.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Use an original relative member');return v;};
async function read(p){return JSON.parse(await fs.readFile(p,'utf8'));}
async function regular(p){p=path.resolve(p);assert.equal(await fs.realpath(p),p,'No symbolic path aliases');assert.ok((await fs.lstat(p)).isFile());return p;}
async function executable(p){assert.ok(path.isAbsolute(p));const target=await fs.realpath(p);assert.ok((await fs.stat(target)).isFile(),'Select an installed executable');return p;}
async function hash(p){await regular(p);let bytes=0;const h=createHash('sha256');for await(const b of createReadStream(p)){bytes+=b.length;h.update(b);}return {bytes,sha256:h.digest('hex')};}
async function verify(p,d){const actual=await hash(p);assert.deepEqual(actual,{bytes:d.bytes,sha256:d.sha256},'Original file changed: '+p);return actual;}
async function atomic(p,v){const tmp=p+'.'+randomUUID()+'.pending';try{await fs.writeFile(tmp,JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});await fs.rename(tmp,p);}finally{await fs.rm(tmp,{force:true});}}
async function waitFor(fn,label,ms=90000){const end=Date.now()+ms;for(;;){if(await fn())return;if(Date.now()>end)throw Error('Timed out while opening '+label);await new Promise(r=>setTimeout(r,200));}}
function publicURL(value){const u=new URL(value);return u.origin+u.pathname;}
function spawnText(command,args,options={}){
 const child=spawn(command,args,{...options,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
 const finished=new Promise(resolve=>{child.once('error',error=>{stderr+=String(error);resolve({code:127,signal:null,stdout,stderr});});child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});
 return {child,finished,stdout:()=>stdout,stderr:()=>stderr};
}
async function run(command,args,options={}){const result=await spawnText(command,args,options).finished;assert.equal(result.code,0,'Original receiving helper failed: '+result.stderr.slice(-8000));return result;}
async function startAttachmentViewer(root){
 const files=new Set(),prefix='/retained/'+randomUUID()+'/',types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
 const server=createServer(async(request,response)=>{
  try{
   if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
   const url=new URL(request.url,'http://127.0.0.1');
   if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
   if(!url.pathname.startsWith(prefix)){response.writeHead(404);response.end();return;}
   const name=decodeURIComponent(url.pathname.slice(prefix.length));member(name);
   const selected=path.resolve(root,...name.split('/'));
   assert.ok(within(root,selected)&&files.has(selected),'Only explicit retained attachment files are served');await regular(selected);
   const stats=await fs.stat(selected);
   response.writeHead(200,{'Content-Type':types[path.extname(selected).toLowerCase()]||'application/octet-stream','Content-Length':stats.size,
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self' data: blob:; connect-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'self' data: blob:"});
   if(request.method==='HEAD'){response.end();return;}
   const stream=createReadStream(selected);stream.on('error',()=>response.destroy());stream.pipe(response);
  }catch(error){if(!response.headersSent)response.writeHead(404);response.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 return {origin,async add(file){file=await regular(file);assert.ok(within(root,file));files.add(file);return origin+prefix+path.relative(root,file).split(path.sep).map(encodeURIComponent).join('/');},
  url(file){assert.ok(files.has(file));return origin+prefix+path.relative(root,file).split(path.sep).map(encodeURIComponent).join('/');},
  close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
async function lock(output){
 const p=path.join(output,'.browser-receiving.lock');
 for(let tries=0;tries<2;tries++){
  try{const h=await fs.open(p,'wx',0o600);await h.writeFile(JSON.stringify({pid:process.pid,host:hostname(),started_at:now()}));await h.close();return p;}
  catch(e){if(e.code!=='EEXIST')throw e;const old=await read(p);assert.equal(old.host,hostname(),'Reconcile the original receiving process on its recorded host');let alive=true;try{process.kill(old.pid,0);}catch(c){if(c.code==='ESRCH')alive=false;else throw c;}assert.ok(!alive,'The original browser receiving process is still active');await fs.rm(p);}
 }
 throw Error('Could not hold the original browser receiving lock');
}
export function expectedDownloads(products){
 const families={management:products.management.files,scientific:products.scientific_members};
 for(const [role,record]of Object.entries(products.forcing_reports))families['forcing-'+role]=record.files;
 return Object.fromEntries(Object.entries(families).map(([family,files])=>[family,Object.fromEntries(Object.entries(files).map(([name,d])=>[name,{...d,path:member(d.path)}]))]));
}
export function validateCourse(result,journal){
 assert.equal(result.schema,'upstate.climate-management-receiving/v1');assert.equal(result.status,'native-course-complete');assert.equal(result.native_course_complete,true);
 const p=journal.products;assert.ok(p);assert.equal(p.project.id,result.project_id);
 assert.equal(p.management.id,id(result.management_report_id));assert.equal(p.scientific.id,id(result.scientific_report_edition_id));
 for(const [role,selected]of Object.entries(p.studies)){assert.equal(selected.id,id(result.studies[role]));assert.equal(p.forcing_reports[role].id,id(result.forcing_reports[role]));}
 assert.ok(result.receiving['selected-study'].cold_reopen&&result.receiving['complete-workspace'].cold_reopen,'Finish both original copied-application reopens');
 assert.deepEqual(Object.keys(p.studies).sort(),Object.keys(result.studies).sort());
 for(const native of Object.values(result.native_cases)){assert.ok(p.runs[id(native.run_id)]);assert.deepEqual(native.record,p.runs[native.run_id]);}
 return p;
}
async function main(argv){
 assert.equal(argv.length,1,'Usage: node receive_climate_management_browser.mjs ABSOLUTE_CONTROL.json');
 const controlPath=await regular(argv[0]),c=await read(controlPath);
 assert.equal(c.schema,SCHEMA);
 const allowed=['schema','native_result','journal','python','playwright_module','chromium','output','pdftoppm','locations'];
 assert.ok(Object.keys(c).every(k=>allowed.includes(k)),'Use the documented complete browser control');
 for(const field of ['native_result','python','playwright_module','chromium','output'])assert.ok(typeof c[field]==='string'&&path.isAbsolute(c[field]),'Supply an actual absolute '+field);
 const resultPath=await regular(c.native_result),result=await read(resultPath),journalPath=await regular(c.journal||result.journal),journal=await read(journalPath);
 const products=validateCourse(result,journal),expected=expectedDownloads(products);
 const python=await executable(c.python),playwright=await fs.realpath(c.playwright_module),chromiumPath=await executable(c.chromium);
 await regular(playwright);
 const support=await regular(path.join(path.dirname(fileURLToPath(import.meta.url)),'climate_management_browser_support.py'));
 const output=path.resolve(c.output);await fs.mkdir(output,{recursive:true,mode:0o700});assert.equal(await fs.realpath(output),output);
 const chosen={};
 for(const name of ['selected-study','complete-workspace']){
  const original=result.receiving[name].restore,location=c.locations?.[name]||original;
  const application=await fs.realpath(location.application),workspace=await fs.realpath(location.workspace);
  assert.ok(!within(application,output)&&!within(workspace,output),'Keep receiving output outside original applications and Workspaces');
  chosen[name]={application,workspace};
 }
 const lockPath=await lock(output),progressPath=path.join(output,'browser-receiving.json');
 let browser=null,context=null,server=null,viewer=null,attempt=null,saved=null,capability='';
 const redact=value=>capability?String(value).replaceAll(capability,'[private capability]'):String(value);
 const initialIdentity={native_result:await hash(resultPath),journal:await hash(journalPath),project_id:result.project_id,
  management_report_id:result.management_report_id,scientific_report_edition_id:result.scientific_report_edition_id,locations:chosen};
 async function checkpoint(){await atomic(progressPath,saved);}
 async function stopServer(){
  if(!server)return;
  if(server.child.exitCode===null)server.child.kill('SIGTERM');
  const done=await server.finished;server=null;assert.equal(done.code,0,'Original read-only operator did not close cleanly: '+redact(done.stderr.slice(-4000)));
 }
 let interrupted=false;
 const interrupt=()=>{interrupted=true;context?.close().catch(()=>{});if(server?.child.exitCode===null)server.child.kill('SIGTERM');};
 process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
 try{
  try{saved=await read(progressPath);assert.equal(saved.schema,SCHEMA);assert.deepEqual(saved.identity,initialIdentity);}
  catch(e){if(e.code!=='ENOENT')throw e;saved={schema:SCHEMA,identity:initialIdentity,attempts:[],complete:false};}
  attempt={id:randomUUID(),started_at:now(),operator_courses:[],screenshots:[],downloads:[],page_errors:[],http_errors:[],blocked_mutations:[],
   browser_source:await hash(fileURLToPath(import.meta.url)),support_source:await hash(support),
   visual_review:{state:'human-look-required',meaning:'Captured/rendered views are available; no human inspection is inferred'}};
  saved.attempts.push(attempt);saved.complete=false;await checkpoint();
  const attemptRoot=path.join(output,'attempts',attempt.id);await fs.mkdir(attemptRoot,{recursive:true});
  const {chromium}=await import(pathToFileURL(playwright));browser=await chromium.launch({headless:true,executablePath:chromiumPath,args:['--no-sandbox','--disable-dev-shm-usage']});
  const allFiles=[],uniqueFiles=new Map();
  async function artifact(file,extra={}){const row={path:file,...await hash(file),...extra};return row;}
  async function capture(page,label,width=1440){
   await page.setViewportSize({width,height:width===390?844:1080});
   await page.evaluate(()=>document.fonts?.ready);const file=path.join(attemptRoot,String(attempt.screenshots.length+1).padStart(5,'0')+'-'+label.replace(/[^A-Za-z0-9_-]/g,'_')+'-'+width+'.png');
   await page.screenshot({path:file,fullPage:false});attempt.screenshots.push(await artifact(file,{label,width}));await checkpoint();
  }
  async function images(page){
   await page.locator('img').evaluateAll(nodes=>nodes.forEach(x=>x.loading='eager'));
   await waitFor(()=>page.locator('img').evaluateAll(nodes=>nodes.every(x=>x.complete&&x.naturalWidth>0)),'all actual report images');
  }
  async function viewportTiles(page,prefix,width){
   const height=width===390?844:1080;await page.setViewportSize({width,height});
   await page.evaluate(()=>document.fonts?.ready);
   const positions=(extent,view)=>{const max=Math.max(0,extent-view),points=[];for(let v=0;v<max;v+=Math.max(1,view-64))points.push(v);points.push(max);return [...new Set(points)];};
   const geometry=await page.evaluate(()=>({width:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0),height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),viewWidth:innerWidth,viewHeight:innerHeight}));
   const seen=new Set();
   async function tile(x,y,label,extra={}){
    const actual=await page.evaluate(({x,y})=>{window.scrollTo({left:x,top:y,behavior:'instant'});return {x:scrollX,y:scrollY};},{x,y});
    const key=JSON.stringify({...actual,...extra});if(seen.has(key))return;seen.add(key);
    await capture(page,prefix+'-'+label+'-x'+Math.round(actual.x)+'-y'+Math.round(actual.y),width);
    Object.assign(attempt.screenshots.at(-1),{scroll:actual,document:geometry,...extra});await checkpoint();
   }
   for(const y of positions(geometry.height,geometry.viewHeight))for(const x of positions(geometry.width,geometry.viewWidth))await tile(x,y,'document');
   // Root scrolling does not expose overflowed table columns. Visit each additional
   // horizontal viewport over every vertical segment of that original table.
   const tables=page.locator('.table-wrap,.table-scroll,.cm-table,.cf-table');
   for(let i=0;i<await tables.count();i++){
    const table=tables.nth(i);if(!await table.isVisible())continue;
    const g=await table.evaluate(el=>{el.scrollLeft=0;const r=el.getBoundingClientRect();return {top:r.top+scrollY,left:r.left+scrollX,height:r.height,width:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight};});
    if(g.scrollWidth<=g.width+1&&g.scrollHeight<=g.clientHeight+1)continue;
    const ys=positions(g.height,geometry.viewHeight).map(v=>Math.min(Math.max(0,g.top+v),Math.max(0,geometry.height-geometry.viewHeight)));
    for(const innerY of positions(g.scrollHeight,g.clientHeight))for(const x of positions(g.scrollWidth,g.width)){
     if(x===0&&innerY===0)continue;
     const actual=await table.evaluate((el,{x,y})=>{el.scrollLeft=x;el.scrollTop=y;return {x:el.scrollLeft,y:el.scrollTop};},{x,y:innerY});
     for(const y of [...new Set(ys)])await tile(Math.min(g.left,Math.max(0,geometry.width-geometry.viewWidth)),y,'table-'+i,{table_index:i,table_scroll_x:actual.x,table_scroll_y:actual.y});
    }
    await table.evaluate(el=>{el.scrollLeft=0;el.scrollTop=0;});
   }
   await page.evaluate(()=>window.scrollTo({left:0,top:0,behavior:'instant'}));
  }
  async function sectionViews(page,prefix){
   await images(page);for(const width of [1440,390])await viewportTiles(page,prefix,width);
  }
  for(const name of ['selected-study','complete-workspace']){
   assert.ok(!interrupted,'The original browser course was interrupted');
   const location=chosen[name],course={archive:name,application:location.application,workspace:location.workspace,started_at:now(),actions:[],downloads:[]};
   attempt.operator_courses.push(course);
   for(const [file,descriptor]of Object.entries(result.receiving[name].application_sources))await verify(path.join(location.application,member(file)),descriptor);
   for(const [run,descriptor]of Object.entries(products.runs))await verify(path.join(location.workspace,'runs',id(run),'run.json'),descriptor);
   server=spawnText(python,['-u',support,'serve','--application',location.application,'--workspace',location.workspace,
    '--operator-state',path.join(attemptRoot,'operator-'+name),'--native-result',resultPath,'--journal',journalPath,'--archive',name],{cwd:location.application});
   let connection;
   await waitFor(async()=>{
    for(const line of server.stdout().split('\n')){try{const value=JSON.parse(line);if(value.operator_url&&value.workspace_key){connection=value;return true;}}catch{}}
    if(server.child.exitCode!==null)throw Error('Original operator could not open copied products: '+server.stderr().slice(-6000));return false;
   },'verified original copied operator',300000);
   assert.equal(connection.project.id,result.project_id);
   capability=new URLSearchParams(new URL(connection.operator_url).hash.slice(1)).get('token');assert.ok(capability);
   const origin=new URL(connection.operator_url).origin,workspace=connection.workspace_key;
   course.workspace_key=workspace;course.verification=connection.verification;await checkpoint();
   context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,timezoneId:'UTC',locale:'en-US',serviceWorkers:'block'});
   const readablePOST=new Set(['/api/session','/api/study-transfer/preview','/api/gis/preview','/api/source-reports/scientific-source-preview']);
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['http:','https:'].includes(url.protocol))return route.continue();
    if(url.origin!==origin){attempt.blocked_mutations.push({reason:'Unexpected external network request',url:publicURL(url)});await checkpoint();return route.abort('blockedbyclient');}
    if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!readablePOST.has(url.pathname)){
     attempt.blocked_mutations.push({method:request.method(),path:url.pathname,action:(()=>{try{return request.postDataJSON()?.action||null;}catch{return null;}})()});
     await checkpoint();return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'This receiving segment opens completed products only'})});
    }
    return route.continue();
   });
   const page=await context.newPage();page.setDefaultTimeout(90000);
   context.on('page',p=>p.on('pageerror',e=>attempt.page_errors.push({archive:name,message:redact(e.message)})));
   page.on('pageerror',e=>attempt.page_errors.push({archive:name,message:redact(e.message)}));
   context.on('response',r=>{if(r.url().startsWith(origin+'/api/')&&r.status()>=400)attempt.http_errors.push({archive:name,path:new URL(r.url()).pathname,status:r.status()});});
   const endpoint=(route,values={})=>route+'?'+new URLSearchParams({workspace,...values});
   async function api(route,values={}){
    const r=await context.request.get(origin+endpoint(route,values),{headers:{Authorization:'Bearer '+capability}});
    assert.ok(r.ok(),'Original API read '+route+' returned '+r.status());return r.json();
   }
   async function closeDialogs(){for(const [dialog,action]of [['#form-dialog','form-close'],['#detail-dialog','detail-close']]){const node=page.locator(dialog);if(await node.count()&&await node.evaluate(x=>x.open))await page.locator(dialog+' [data-action="'+action+'"]').first().click();}}
   async function navigate(view){await closeDialogs();await page.locator('[data-view="'+view+'"]').click();await page.waitForFunction(v=>document.querySelector('[data-view="'+v+'"]')?.getAttribute('aria-current')==='page',view);}
   async function downloadFamily(scope,tickets,descriptors,family){
    const map=new Map(Object.entries(descriptors).map(([key,d])=>[d.path,{key,...d}]));
    const used=new Set();
    for(const ticket of tickets){
     const original=ticket.artifact_id&&descriptors[ticket.artifact_id]?{key:ticket.artifact_id,...descriptors[ticket.artifact_id]}:map.get(ticket.path||ticket.filename);
     assert.ok(original,'Native ticket is not an exact selected original member: '+JSON.stringify({family,path:ticket.path,artifact_id:ticket.artifact_id,filename:ticket.filename}));
     assert.equal(ticket.bytes,original.bytes);assert.equal(ticket.sha256,original.sha256);assert.ok(!used.has(original.key),'Duplicate native download member');used.add(original.key);
     const u=new URL(ticket.url,origin);assert.equal(u.origin,origin);
     const link=scope.locator('a[download]');
     let target=null;for(const candidate of await link.all()){const href=await candidate.getAttribute('href');if(href&&new URL(href,origin).pathname===u.pathname){target=candidate;if(await candidate.isVisible())break;}}
     assert.ok(target,'The real UI does not expose original download '+original.path);
     await target.evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
     const pending=page.waitForEvent('download',{timeout:300000});await target.click();const downloaded=await pending;assert.equal(await downloaded.failure(),null);
     const destination=path.join(attemptRoot,name,'downloads',family,...member(original.path).split('/'));await fs.mkdir(path.dirname(destination),{recursive:true});
     await downloaded.saveAs(destination);await verify(destination,original);await downloaded.delete();
     const row={family,name:original.key,path:destination,bytes:original.bytes,sha256:original.sha256};
     course.downloads.push(row);attempt.downloads.push(row);
     // Preserve complete relative companions from one original copied edition for document opening.
     const unique=family+'/'+original.path;if(!uniqueFiles.has(unique)){uniqueFiles.set(unique,row);allFiles.push(row);}
    }
    assert.deepEqual([...used].sort(),Object.keys(descriptors).sort(),'Every original member must have a real displayed download');
    await checkpoint();
   }
   await page.goto(connection.operator_url,{waitUntil:'domcontentloaded'});
   await page.locator('#workspace-select option[value="'+workspace+'"]').waitFor({state:'attached'});
   const initial=await api('/api/state');assert.equal(initial.workspace_key,workspace);assert.equal(initial.data.project.id,result.project_id);
   course.original_run_ids=initial.data.runs.map(x=>x.id).sort();assert.ok(!initial.tasks.some(t=>['running','queued'].includes(t.state)),'Fresh observation state unexpectedly contains active scientific work');
   for(const [role,studyId]of Object.entries(result.studies)){
    const retained=await api('/api/climate-forcing/study',{id:studyId});assert.equal(retained.id,studyId);assert.equal(retained.state,'complete');assert.equal(retained.latest_report.id,result.forcing_reports[role]);
    await navigate('climate-forcing');await page.locator('[data-saved-study]').selectOption(studyId);await page.locator('[data-cf="open-study"]').click();
    await waitFor(()=>page.locator('[data-cf="run-detail"]').count().then(n=>n===retained.cases.length),'original complete forcing cohort');
    for(const row of retained.cases){assert.equal(row.state,'complete');await page.locator('[data-cf="run-detail"][data-run="'+id(row.run_id)+'"]').click();await page.locator('#detail-dialog[open]').waitFor();await capture(page,name+'-'+role+'-run-'+row.id);await closeDialogs();}
    const report=await api('/api/climate-forcing/report',{id:studyId,report_id:result.forcing_reports[role]});assert.equal(report.id,result.forcing_reports[role]);
    await downloadFamily(page.locator('.climate-forcing'),report._downloads,expected['forcing-'+role],'forcing-'+role);
    await sectionViews(page,name+'-forcing-'+role);
    course.actions.push({action:'open-original-forcing-study',role,id:studyId,report_id:report.id});
   }
   async function openManagement(){
    await navigate('climate-management');await page.locator('.climate-management [data-saved]').selectOption(result.management_report_id);
    await page.locator('[data-cm="open"]').click();await page.locator('[data-cm-view="area_id"]').waitFor();
   }
   await openManagement();
   const management=await api('/api/climate-management/report',{id:result.management_report_id});assert.equal(management.id,products.management.id);assert.deepEqual(management.selection,products.management.selection);
   await downloadFamily(page.locator('.climate-management'),management._downloads,expected.management,'management');
   for(const area of [...new Set(management.rows.map(x=>x.area_id))])for(const metric of [...new Set(management.rows.map(x=>x.pollutant))]){
    await page.locator('[data-cm-view="area_id"]').selectOption(area);await page.locator('[data-cm-view="pollutant"]').selectOption(metric);
    const rows=management.rows.filter(x=>x.area_id===area&&x.pollutant===metric);const table=page.locator('table').filter({has:page.locator('caption', {hasText:'Management benefit and change in benefit'})});
    assert.equal(await table.locator('tbody tr').count(),rows.length);
    const actualRows=await table.locator('tbody tr').evaluateAll(ns=>ns.map(row=>[...row.cells].map(cell=>cell.textContent.trim())));
    const fields=['period','units','benefit',...(management.roles.includes('control')?['control_adjusted_benefit']:[]),'interaction',...(management.roles.includes('control')?['control_adjusted_interaction']:[]),'benefit_percent_of_reference'];
    const display=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-US',{maximumSignificantDigits:8}):v==null?'Unavailable':String(v);
    assert.deepEqual(actualRows,rows.map(row=>fields.map(field=>display(row[field]))),'Visible signed benefits must match the original saved scientific rows');
    await sectionViews(page,name+'-management-'+area+'-'+metric);
    course.actions.push({action:'filter-original-results',area_id:area,pollutant:metric,rows:rows.length});
   }
   // Exercise editing without saving a scientific mutation.
   const title=page.locator('.climate-management [data-draft="title"]'),originalTitle=await title.inputValue();
   await title.fill(originalTitle+' — browser receiving draft');await page.locator('[data-cm="refresh"]').click();
   await waitFor(()=>title.inputValue().then(x=>x===originalTitle+' — browser receiving draft'),'editable draft retained through refresh');
   await title.fill(originalTitle);
   await page.locator('[data-cm="export"]').click();await page.locator('[data-study-field="kind"]').waitFor();
   const rootCheckbox=page.locator('[data-study-root="climate-management-reports:'+result.management_report_id+'"]');
   assert.ok(await rootCheckbox.isChecked(),'The original Management report must be the selected Study root');
   const previewResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/study-transfer/preview'&&r.request().method()==='POST');
   await page.locator('[data-study-action="preview"]').click();const previewReturn=await previewResponse;assert.ok(previewReturn.ok());const previewBody=await previewReturn.json();
   await page.locator('[data-study-plan] .st-totals').waitFor();course.study_preview=previewBody;
   assert.ok(JSON.stringify(previewBody).includes(result.management_report_id),'The selected Study closure omits the original management result');
   for(const studyId of Object.values(result.studies))assert.ok(JSON.stringify(previewBody).includes(studyId),'The selected Study closure omits an original forcing family');
   const selectedPreview=await page.locator('[data-study-action="open-climate-management"][data-study-id="'+result.management_report_id+'"]').count();
   course.actions.push({action:'open-original-study-transfer',management_id:result.management_report_id,visible_open_control:!!selectedPreview});
   await capture(page,name+'-study-selection',1440);await capture(page,name+'-study-selection',390);
   assert.ok(selectedPreview,'The selected Study plan must open its original Management root');
   if(selectedPreview){await page.locator('[data-study-action="open-climate-management"][data-study-id="'+result.management_report_id+'"]').first().click();await page.locator('[data-cm-view="area_id"]').waitFor();}
   await openManagement();
   if(management._gis_selection){
    await page.locator('[data-cm="gis"]').click();await page.locator('form[data-gis-export]').waitFor();
    const gisForm=page.locator('form[data-gis-export]');
    await waitFor(async()=>await gisForm.locator('[name="title"]').inputValue()===management._gis_selection.title&&await gisForm.locator('[name="project_crs"]').inputValue()===management._gis_selection.project_crs,'the exact original GIS source intake');
    const gisCatalog=await api('/api/gis/projects');
    const originalWorking=await import(pathToFileURL(path.join(location.application,'operator/web/gis-working-selection.mjs')));
    const normalized=originalWorking.normalizeSelectionSources(management._gis_selection,gisCatalog);
    const expectedSelection={...normalized,scenario_run_ids:normalized.scenario_run_ids||[],comparison_ids:normalized.comparison_ids||[],include_grid:normalized.include_grid??true,notes:normalized.notes||[]};
    async function receiveChoices(suffix){
     const event=page.waitForEvent('download');await page.locator('[data-gis-working-download]').click();const transfer=await event;assert.equal(await transfer.failure(),null);
     const file=path.join(attemptRoot,name,'gis-working-'+suffix+'.json');await transfer.saveAs(file);await transfer.delete();
     const value=originalWorking.validateWorking(await read(file),{projectId:result.project_id});assert.deepEqual(value.selection,expectedSelection,'The GIS basket must preserve all original source fields and only documented defaults');
     const originalSources=new Map(gisCatalog.sources.flatMap(collection=>collection.entries.map(entry=>[JSON.stringify([collection.id,entry.id]),entry])));
     for(const row of value.source_descriptions)assert.deepEqual(row.entry,originalSources.get(JSON.stringify([row.source_collection_id,row.source_id])),'GIS working choices must retain original complete source descriptions');
     return {file,value,descriptor:await artifact(file)};
    }
    const firstChoices=await receiveChoices('original'),previousForm=await gisForm.elementHandle();
    await page.locator('[data-gis-working-open]').setInputFiles(firstChoices.file);
    await page.waitForFunction(element=>!element.isConnected,previousForm);await previousForm.dispose();
    await waitFor(()=>gisForm.locator('[name="title"]').inputValue().then(v=>v===expectedSelection.title),'reopened original working choices');
    const reopenedChoices=await receiveChoices('reopened');assert.deepEqual(reopenedChoices.value,firstChoices.value,'Reopening the same complete GIS working file is idempotent');
    const workingFile={family:'gis-working',name:name+'.json',path:firstChoices.file,...await hash(firstChoices.file)};allFiles.push(workingFile);
    course.actions.push({action:'open-download-reopen-original-gis-choices',source_selection:management._gis_selection,working:firstChoices.descriptor,reopened:reopenedChoices.descriptor});
    await capture(page,name+'-gis-original-sources',1440);await capture(page,name+'-gis-original-sources',390);
   }else throw Error('The current management result does not expose its original GIS source intake');
   await navigate('sources');await page.locator('[data-action="source-reports-open"]').click();
   await page.locator('[data-scientific-report-action="open"][data-id="'+result.scientific_report_edition_id+'"]').click();
   const holder=page.locator('[data-scientific-report-document-host] iframe:not([hidden])');await holder.waitFor();
   const opened=await api('/api/source-reports/scientific-edition',{id:result.scientific_report_edition_id});assert.equal(opened.edition.id,result.scientific_report_edition_id);
   await downloadFamily(page.locator('[data-scientific-report-files]'),opened.files,expected.scientific,'scientific');
   assert.ok(opened.archive,'Open the original already-exported report ZIP');assert.equal(opened.archive.sha256,products.scientific_archive.sha256);assert.equal(opened.archive.bytes,products.scientific_archive.bytes);
   await downloadFamily(page.locator('[data-scientific-report-detail]'),[{...opened.archive,path:products.scientific_archive.path}],
    {[products.scientific_archive.path]:products.scientific_archive},'scientific-archive');
   const frame=await (await holder.elementHandle()).contentFrame();assert.ok(frame);await frame.locator('body').waitFor();
   await waitFor(()=>frame.locator('.scientific-figure img').evaluateAll(ns=>ns.every(x=>x.complete&&x.naturalWidth>0)),'all original Scientific Report figures');
   assert.equal(await frame.locator('.scientific-figure img').count(),opened.edition.figure_count,'The actual viewer must show every original scientific figure');
   const anchors=frame.locator('nav[aria-label="Report sections"] a[href^="#section-"]');
   for(let i=0;i<await anchors.count();i++){const href=await anchors.nth(i).getAttribute('href');await anchors.nth(i).click();assert.equal(await frame.evaluate(()=>location.hash),href,'Every original report section anchor must navigate');}
   // The original iframe is operated above. Open its exact HTML URL in the same
   // authenticated context to tile the full document without clipping it to the
   // embedded viewer's height. No report is generated or transformed.
   const fullReport=await context.newPage();
   try{assert.equal(new URL(frame.url()).origin,origin);await fullReport.goto(frame.url(),{waitUntil:'load'});await sectionViews(fullReport,name+'-scientific-complete-document');}
   finally{await fullReport.close();}
   course.actions.push({action:'open-original-scientific-edition',id:opened.edition.id,sections:await anchors.count(),files:opened.files.length});
   await page.locator('[data-scientific-report-action="transfer"]').click();await page.locator('[data-study-field="kind"]').waitFor();
   assert.ok(await page.locator('[data-study-root="scientific-report-editions:'+result.scientific_report_edition_id+'"]').isChecked(),'The original scientific edition must be selected for transfer');
   await capture(page,name+'-scientific-study-transfer',390);
   await openManagement();await page.setViewportSize({width:390,height:844});const bounds=await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth}));assert.ok(bounds.body<=bounds.width+1,'The actual mobile app spills outside its viewport');course.mobile=bounds;
   const after=await api('/api/state');assert.deepEqual(after.data.runs.map(x=>x.id).sort(),course.original_run_ids);assert.deepEqual(after.tasks,initial.tasks,'The browser course must not submit native or export tasks');
   await context.close();context=null;await stopServer();capability='';
   for(const [run,descriptor]of Object.entries(products.runs))await verify(path.join(location.workspace,'runs',run,'run.json'),descriptor);
   for(const [file,descriptor]of Object.entries(result.receiving[name].application_sources))await verify(path.join(location.application,member(file)),descriptor);
   course.complete=true;course.completed_at=now();await checkpoint();
  }
  const manifestPath=path.join(attemptRoot,'attachments-input.json');await atomic(manifestPath,{files:allFiles});
  const inspectionPath=path.join(attemptRoot,'attachment-inspection');
  const inspected=await run(python,[support,'inspect','--manifest',manifestPath,'--output',inspectionPath,...(c.pdftoppm?['--pdftoppm',await executable(c.pdftoppm)]:[])]);
  const receipt=JSON.parse(inspected.stdout.trim().split('\n').at(-1));await verify(receipt.path,receipt);const attachments=await read(receipt.path);attempt.attachments=receipt;
  viewer=await startAttachmentViewer(attemptRoot);
  for(const file of allFiles)await viewer.add(file.path);
  context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,serviceWorkers:'block'});
  await context.route(/^https?:\/\//,route=>new URL(route.request().url()).origin===viewer.origin?route.continue():route.abort('blockedbyclient'));
  context.on('response',r=>{if(r.status()>=400)attempt.http_errors.push({attachment:true,path:new URL(r.url()).pathname.replace(/\/retained\/[^/]+\//,'/retained/'),status:r.status()});});
  context.on('page',p=>p.on('pageerror',e=>attempt.page_errors.push({attachment:true,message:e.message})));
  attempt.attachment_viewer={transport:'Loopback HTTP over exact allowlisted original members; relative companions preserved',origin:viewer.origin};
  const index=[];
  for(const file of attachments.files){
   assert.ok(!interrupted,'The original browser course was interrupted');
   const visuals=[];
   if(file.rendered)visuals.push(...file.rendered.pages.map(p=>({...p,label:file.family+'/'+file.name+' · PDF page '+p.page})));
   if(file.raster)visuals.push({...file.raster.preview,label:file.family+'/'+file.name+' · original raster display'});
   if(/\.(?:html?|svg|png|jpe?g)$/i.test(file.path))visuals.push({path:file.path,label:file.family+'/'+file.name});
   if(/\.(?:csv|tsv|json|geojson|md|txt|xml|prj|cpg)$/i.test(file.path)){
    const text=await fs.readFile(file.path,'utf8'),preview=path.join(attemptRoot,'text-'+digest(file.path).slice(0,20)+'.html');
    await fs.writeFile(preview,'<!doctype html><meta charset="utf-8"><title>'+esc(file.name)+'</title><style>body{font:16px system-ui;margin:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+esc(file.family+'/'+file.name)+'</h1><p>Escaped display of the complete unchanged original text. Original SHA256 '+esc(file.sha256)+'.</p><pre>'+esc(text)+'</pre>');
    visuals.push({path:preview,label:file.family+'/'+file.name+' · complete original text'});
   }
   if(file.members||file.layers){const preview=path.join(attemptRoot,'inventory-'+digest(file.path).slice(0,20)+'.html');await fs.writeFile(preview,'<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;margin:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+esc(file.family+'/'+file.name)+'</h1><p>Complete original member/layer inventory. Open editable documents in their normal application.</p><pre>'+esc(JSON.stringify(file.members||file.layers,null,2))+'</pre>');visuals.push({path:preview,label:file.family+'/'+file.name+' · complete native inventory'});}
   for(const visual of visuals){const page=await context.newPage();try{await page.goto(await viewer.add(visual.path),{waitUntil:'load'});await sectionViews(page,'attachment-'+digest(visual.label).slice(0,16));index.push({label:visual.label,path:visual.path});}finally{await page.close();}}
  }
  await context.close();context=null;await viewer.close();viewer=null;
  const relativeURL=p=>path.relative(output,p).split(path.sep).map(encodeURIComponent).join('/');
  const opening=path.join(output,'OPEN_BROWSER_RECEIVING.html');
  await fs.writeFile(opening,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Climate receiving · actual views</title><style>body{font:16px/1.5 system-ui;max-width:1100px;margin:24px auto;padding:0 18px;color:#17212b}li{margin:12px 0}code{overflow-wrap:anywhere}a{color:#174db0}</style><h1>Climate and Management: original receiving views</h1><p>TokenJunkieLabs · '+esc(result.project_id)+'</p><p>The browser opened both received applications and retained products. Human inspection is still required: open each actual report, every PDF page, scientific figure, map and working attachment. Rendered capture is not customer acceptance.</p><h2>Actual reports, figures and attachment views</h2><ol>'+index.map(x=>'<li><a href="'+esc(relativeURL(x.path))+'">'+esc(x.label)+'</a></li>').join('')+'</ol><h2>Original downloaded files</h2><ol>'+allFiles.map(x=>'<li><a href="'+esc(relativeURL(x.path))+'">'+esc(x.family+'/'+x.name)+'</a><br><code>'+esc(x.sha256)+'</code></li>').join('')+'</ol><h2>Actual desktop and phone captures</h2><ol>'+attempt.screenshots.map(x=>'<li><a href="'+esc(relativeURL(x.path))+'">'+esc(x.label)+' · '+x.width+' px</a></li>').join('')+'</ol><p><a href="browser-receiving.json">Complete receiving record</a></p></html>');
  attempt.opening=await artifact(opening);assert.deepEqual(attempt.blocked_mutations,[]);assert.deepEqual(attempt.page_errors,[]);assert.deepEqual(attempt.http_errors,[]);
  attempt.complete=true;attempt.completed_at=now();saved.complete=true;saved.completed_at=now();await checkpoint();
  console.log(JSON.stringify({schema:SCHEMA,complete:true,progress:progressPath,opening,project_id:result.project_id,human_look:'required'},null,2));
 }catch(e){if(attempt){attempt.error={message:redact(e.message),stack:redact(e.stack)};attempt.completed_at=now();await checkpoint();}throw e;}
 finally{if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});if(viewer)await viewer.close().catch(()=>{});if(server)await stopServer().catch(e=>{process.stderr.write(redact(e.message)+'\n');});await fs.rm(lockPath,{force:true});process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
