/** Run the field-assignment browser chapter against the already-running native Operator.
 * The caller supplies its private connection input, exact saved selection and installed browser.
 * This starts no Operator server, source import, scientific model or second receiving operation.
 */
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,basename,dirname,relative,isAbsolute} from 'node:path';
import {hostname} from 'node:os';
import {pathToFileURL} from 'node:url';
import {operateMonitoringFieldAssignment} from './monitoring_field_assignment_browser.mjs';
const now=()=>new Date().toISOString();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=value=>String(value).replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,180);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function atomic(file,bytes,{immutable=false}={}){
 await fs.mkdir(dirname(file),{recursive:true});
 if(immutable){try{const prior=await fs.readFile(file);if(!prior.equals(Buffer.from(bytes)))throw Error('Original receiving member differs: '+basename(file));return;}catch(e){if(e.code!=='ENOENT')throw e;}}
 const pending=file+'.'+process.pid+'.pending';const fd=await fs.open(pending,'wx',0o600);
 try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
 try{if(immutable){try{await fs.link(pending,file);}catch(e){if(e.code!=='EEXIST'||!(await fs.readFile(file)).equals(Buffer.from(bytes)))throw e;}await fs.unlink(pending);}
 else await fs.rename(pending,file);}finally{await fs.unlink(pending).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
function json(value){return JSON.stringify(value,null,2)+'\n';}
function args(argv){const result={};for(let n=0;n<argv.length;n+=2){if(!argv[n]?.startsWith('--')||!argv[n+1])throw Error('Use --input FILE --output DIRECTORY');result[argv[n].slice(2)]=argv[n+1];}if(!result.input||!result.output)throw Error('Use --input FILE --output DIRECTORY');return result;}
export async function runFieldAssignmentBrowser(inputFile,outputDirectory){
 const settings=JSON.parse(await fs.readFile(resolve(inputFile),'utf8'));
 const operator=new URL(settings.operator_url);
 if(!['http:','https:'].includes(operator.protocol)||!['127.0.0.1','localhost','[::1]'].includes(operator.hostname))throw Error('Use the original local native Operator URL.');
 const token=new URLSearchParams(operator.hash.slice(1)).get('token')||settings.token;
 if(typeof token!=='string'||!token)throw Error('Supply the existing private Operator connection.');
 if(typeof settings.workspace!=='string'||!settings.workspace)throw Error('Choose the actual Workspace key.');
 const output=resolve(outputDirectory);
 for(const original of [settings.application,settings.workspace_path]){if(typeof original!=='string'||!original)throw Error('Supply the original application and Workspace paths.');const source=resolve(original),outward=relative(source,output),inward=relative(output,source);if(!outward||(!outward.startsWith('..')&&!isAbsolute(outward))||!inward||(!inward.startsWith('..')&&!isAbsolute(inward)))throw Error('Keep browser output outside the original application and Workspace.');}
 const explicitCutoff=Object.hasOwn(settings,'cutoff');
 const cutoff=explicitCutoff?Date.parse(settings.cutoff):Infinity;
 if(explicitCutoff&&(typeof settings.cutoff!=='string'||!Number.isFinite(cutoff)))throw Error('Use a valid explicit receiving cutoff or omit cutoff.');
 const check=()=>{if(Date.now()>=cutoff)throw Error('The explicit receiving cutoff has been reached; current artifacts are retained.');};
 check();await fs.mkdir(output,{recursive:true});
 let admission={application:resolve(settings.application),workspace_path:resolve(settings.workspace_path),schema:'upstate.field-assignment-browser-admission/v1',origin:operator.origin,workspace:settings.workspace,
  input:settings.field_assignment,playwright_module:resolve(settings.playwright_module),executable:resolve(settings.executable),
  cutoff:explicitCutoff?new Date(cutoff).toISOString():null};
 const selectionPath=join(output,'selection.json');
 // Preserve the exact earlier journal identity when its sole difference is the
 // former implicit deadline. A caller-supplied deadline is always enforced above.
 try{
  const prior=JSON.parse(await fs.readFile(selectionPath,'utf8'));
  if(!explicitCutoff&&prior.cutoff==='2026-10-13T14:00:00.000Z'
      &&equal({...prior,cutoff:null},admission))admission=prior;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 await atomic(selectionPath,json(admission),{immutable:true});
 const completion=join(output,'complete.json');
 try{const saved=JSON.parse(await fs.readFile(completion,'utf8'));if(!equal(saved.selection,admission))throw Error('This browser output belongs to another original selection.');for(const row of saved.files){const file=resolve(output,row.path),rel=relative(output,file);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('An original browser artifact leaves its output.');const bytes=await fs.readFile(file);if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw Error('A retained browser artifact changed: '+row.path);}return saved;}
 catch(e){if(e.code!=='ENOENT')throw e;}
 // Every attempt owns a separate profile, download area and lock. Original attempts are retained.
 const lockPath=join(output,'.browser-running');
 let lock;
 try{lock=await fs.open(lockPath,'wx',0o600);}catch(error){
  if(error.code!=='EEXIST')throw error;
  const old=JSON.parse(await fs.readFile(lockPath,'utf8'));if(old.host!==hostname()||(!Number.isInteger(old.pid)||old.pid<=0))throw Error('Reconcile the original running browser owner before resuming.');
  try{process.kill(old.pid,0);throw Error('The original browser process is still running: '+old.pid);}catch(probe){if(probe.code!=='ESRCH')throw probe;}
  await fs.unlink(lockPath);lock=await fs.open(lockPath,'wx',0o600);
 }
 await lock.writeFile(json({pid:process.pid,host:hostname(),started_at:now()}));await lock.sync();
 let context,attempt;
 const events=[],files=[];
 const publicError=error=>String(error?.message||error).replaceAll(token,'[redacted]').replaceAll(settings.operator_url,operator.origin);
 const recordFile=async(file,label)=>{const bytes=await fs.readFile(file);const descriptor={path:file.slice(output.length+1).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes),label};files.push(descriptor);return descriptor;};
 const saveRecord=async(name,value)=>{const file=join(attempt,safe(name)+'.json');await atomic(file,json(value));await recordFile(file,name);return file;};
 const saveBytes=async(name,value,expected)=>{
  const bytes=Buffer.from(value);if(bytes.length!==expected.bytes||hash(bytes)!==expected.sha256)throw Error('Original browser response differs: '+name);
  const file=join(attempt,'downloads',expected.sha256+'-'+safe(expected.filename||name));await atomic(file,bytes,{immutable:true});
  return {file,item:await recordFile(file,name)};
 };
 const action=(name,detail)=>{events.push({at:now(),name,detail});};
 let page;
 try{
  attempt=await fs.mkdtemp(join(output,'attempt-'));
  for(const name of ['monitoring_field_assignment_browser.mjs','receive_monitoring_field_assignment_browser.mjs']){const bytes=await fs.readFile(new URL('./'+name,import.meta.url));const file=join(attempt,'source',name);await atomic(file,bytes,{immutable:true});await recordFile(file,name);}
  const loaded=await import(pathToFileURL(admission.playwright_module).href),chromium=loaded.chromium||loaded.default?.chromium;
  if(!chromium?.launchPersistentContext)throw Error('Use the installed original Playwright Chromium module.');
  context=await chromium.launchPersistentContext(join(attempt,'private-profile'),{executablePath:admission.executable,headless:true,acceptDownloads:true,viewport:{width:1440,height:1000}});
  context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(60000);
  page=context.pages()[0]||await context.newPage();
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(publicError(error)));
  const api=async(path,query={})=>{
   check();const url=new URL(path,operator.origin);for(const [key,value] of Object.entries({workspace:settings.workspace,...query}))url.searchParams.set(key,String(value));
   const response=await context.request.get(url.href,{headers:{Authorization:'Bearer '+token,'X-Workspace':settings.workspace}});
   if(!response.ok())throw Error('Native read failed: '+path+' HTTP '+response.status());
   return response.json();
  };
  const waitFor=async(predicate,label,timeout=30000)=>{
   const deadline=Math.min(Date.now()+timeout,cutoff);
   while(Date.now()<deadline){check();if(await predicate())return;await new Promise(done=>setTimeout(done,150));}
   throw Error('The original control did not become ready: '+label);
  };
  const closeDialog=async()=>{
   const detail=page.locator('#detail-dialog');
   if(await detail.count()&&await detail.isVisible())await page.keyboard.press('Escape');
   const form=page.locator('#form-dialog');if(await form.count()&&await form.isVisible())await page.keyboard.press('Escape');
  };
  const navigate=async(desk)=>{check();await closeDialog();await page.locator('[data-view="'+desk+'"]').click();};
  const screenshot=async(view,name,width)=>{
   check();await view.setViewportSize({width,height:1000});await view.evaluate(()=>document.fonts.ready);
   const file=join(attempt,safe(name)+'-'+width+'.png');await view.screenshot({path:file,fullPage:true});await recordFile(file,name+' '+width+'px');
  };
  const download=async(locator,name,expected=null)=>{
   check();const [received]=await Promise.all([page.waitForEvent('download'),locator.click()]);
   const error=await received.failure();if(error)throw Error('Original browser download failed: '+error);
   const bytes=await fs.readFile(await received.path());
   const actual={bytes:bytes.length,sha256:hash(bytes),filename:received.suggestedFilename()};
   if(expected&&(expected.bytes!==actual.bytes||expected.sha256!==actual.sha256))throw Error('Original browser download changed: '+name);
   const saved=await saveBytes(name,bytes,actual);await received.delete();return saved;
  };
  const connect=new URL(operator);connect.hash=new URLSearchParams({token}).toString();
  await page.goto(connect.href,{waitUntil:'domcontentloaded'});
  await waitFor(async()=>await page.locator('[data-view="monitoring-field-assignment"]').count()===1,'installed Field assignments desk');
  const workspaceSelector=page.locator('#workspace-select');
  await waitFor(async()=>await workspaceSelector.locator('option[value="'+settings.workspace+'"]').count()===1,'original Workspace choice');
  if(await workspaceSelector.inputValue()!==settings.workspace){
   await workspaceSelector.selectOption(settings.workspace);
  }
  // The chapter also verifies actual project/source identities before any action.
  const result=await operateMonitoringFieldAssignment({page,input:settings.field_assignment,workspace:settings.workspace,
   api,saveRecord,saveBytes,screenshot,download,readJSON:async file=>JSON.parse(await fs.readFile(file,'utf8')),
   navigate,waitFor,check,closeDialog,action});
  await saveRecord('browser-events',{events,page_errors:pageErrors});
  if(pageErrors.length)throw Error('The actual browser reported errors; retain the original event record.');
  const saved={schema:'upstate.field-assignment-browser-completion/v1',selection:admission,completed_at:now(),result,files,attempt:basename(attempt)};
  await atomic(completion,json(saved),{immutable:true});return saved;
 }catch(error){
  if(attempt)await saveRecord('interrupted-browser',{at:now(),error:publicError(error),events});
  throw Error(publicError(error));
 }finally{
  try{if(context)await context.close();}finally{await lock.close();await fs.unlink(lockPath);}
 }
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{const options=args(process.argv.slice(2));const result=await runFieldAssignmentBrowser(options.input,options.output);process.stdout.write(json(result));}
 catch(error){process.stderr.write(String(error?.message||error)+'\n');process.exitCode=1;}
}
