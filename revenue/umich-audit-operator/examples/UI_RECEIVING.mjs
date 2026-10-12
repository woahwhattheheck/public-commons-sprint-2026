// One whole operator receiving journey. Practice records never represent a U-M audit.
const SEED_CODE = "import base64,copy,json,pathlib,sys\nsys.path.insert(0,sys.argv[1]);sys.path.insert(0,str(pathlib.Path(sys.argv[1])/\"examples\"))\nfrom audit_operator.service import AuditService\nfrom EXCHANGE_PRACTICE import practice_inputs\nfixture=practice_inputs();svc=AuditService(sys.argv[2])\ntry:\n actor=svc.store.authenticate_token((svc.store.root/\"operator.key\").read_text().strip())\n def call(name,op,p):return svc.dispatch(actor,name,p,op)\n evidence=call(\"upload_source\",\"ui-seed-evidence\",{\"name\":\"practice-workpaper.txt\",\"media_type\":\"text/plain\",\"role\":\"evidence\",\"namespace\":fixture[\"namespace\"],\"data_base64\":base64.b64encode(fixture[\"evidence\"]).decode()})[\"source\"]\n rows=copy.deepcopy(fixture[\"rows\"])\n rows.pop(\"questionnaire_response\",None);rows.pop(\"source_mapping\",None)\n rows[\"evidence\"][0][\"source_id\"]=evidence[\"id\"]\n rows[\"risk\"][0][\"unit_id\"]=rows[\"risk\"][0].get(\"owner_unit\",\"unit-a\")\n for row in rows[\"engagement\"]:row[\"normalized_stage\"]=\"Planning\"\n data=json.dumps({\"rows_by_kind\":rows},ensure_ascii=False).encode()\n original=call(\"upload_source\",\"ui-seed-original\",{\"name\":\"explicit-practice-rows.json\",\"media_type\":\"application/json\",\"role\":\"original\",\"namespace\":fixture[\"namespace\"],\"data_base64\":base64.b64encode(data).decode()})[\"source\"]\n plan=call(\"prepare_import\",\"ui-seed-prepare\",{\"source_id\":original[\"id\"],\"source_namespace\":fixture[\"namespace\"],\"kind\":\"engagement\"})\n if not plan[\"valid\"]:raise ValueError(plan[\"diagnostics\"])\n call(\"adopt_import\",\"ui-seed-adopt\",{\"preview_id\":plan[\"preview\"][\"id\"],\"decisions\":{}})\n print(json.dumps({\"seeded_records\":len(svc.store.snapshot()[\"records\"]),\"catalog_questions\":len(svc.catalog[\"questions\"])}))\nfinally:svc.close()\n";
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const require=createRequire(import.meta.url);
const here=path.dirname(fileURLToPath(import.meta.url)),source=path.dirname(here);
const options=Object.fromEntries(process.argv.slice(2).filter(v=>v.startsWith('--')).map(v=>{const i=v.indexOf('=');return i<0?[v.slice(2),true]:[v.slice(2,i),v.slice(i+1)];}));
if(!options.workspace||!options.operation)throw new Error('Use --workspace=/private/workspace --operation=/private/ui-operation [--seed] [--playwright=/installed/module] [--chromium=/existing/binary]');
const root=path.resolve(options.operation),workspace=path.resolve(options.workspace);
fs.mkdirSync(root,{recursive:true,mode:0o700});fs.chmodSync(root,0o700);
const stateFile=path.join(root,'UI-STATE.json'),resultFile=path.join(root,'UI-RESULT.json');
let journal=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)): {format:'commons-audit-ui-receiving/1',run_id:crypto.randomUUID(),workspace,phases:{},status:'RUNNING'};
if(journal.workspace!==workspace)throw new Error('Continue the same original UI workspace.');
function save(){const p=stateFile+'.tmp';fs.writeFileSync(p,JSON.stringify(journal,null,2),{mode:0o600});fs.renameSync(p,stateFile);}
if(journal.status==='COMPLETE'&&fs.existsSync(resultFile)){console.log(fs.readFileSync(resultFile,'utf8'));process.exit(0);}
save();
const tmp=path.join(root,'browser-temp');fs.mkdirSync(tmp,{recursive:true,mode:0o700});process.env.TMPDIR=tmp;
const python=options.python||'python3';
if(!fs.existsSync(path.join(workspace,'workspace.sqlite'))){
 if(!options.seed)throw new Error('Use an existing retained workspace, or explicitly pass --seed for a fresh Practice receiving install.');
 const seeded=spawnSync(python,['-B','-c',SEED_CODE,source,workspace],{encoding:'utf8',maxBuffer:1024*1024});
 if(seeded.status!==0)throw new Error('Practice receiving install failed: '+seeded.stderr+seeded.stdout);
 journal.seed=JSON.parse(seeded.stdout);save();
}
let browser,context,serverChild;
const readyFile=path.join(root,'HOST-READY.json'),serverLog=path.join(root,'HOST.log');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function healthy(ready){try{return (await fetch(ready.origin+'/health',{signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}}
let ready=fs.existsSync(readyFile)?JSON.parse(fs.readFileSync(readyFile)):null;
if(!ready||!await healthy(ready)){
 const log=fs.openSync(serverLog,'a',0o600);
 serverChild=spawn(python,['-B',path.join(source,'run.py'),'serve','--workspace',workspace,'--port','0','--ready-file',readyFile],{cwd:source,stdio:['ignore',log,log],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 fs.closeSync(log);
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  if(serverChild.exitCode!==null)throw new Error('Original host exited: '+fs.readFileSync(serverLog,'utf8').slice(-8000));
  if(fs.existsSync(readyFile)){ready=JSON.parse(fs.readFileSync(readyFile));if(await healthy(ready))break;}
  await wait(200);
 }
 if(!ready||!await healthy(ready))throw new Error('Original loopback host did not become ready; its original log and ready file are retained.');
}
const token=fs.readFileSync(path.join(workspace,'operator.key'),'utf8').trim();
const errors=[];
const phase=async(name,fn)=>{if(journal.phases[name])return journal.phases[name];journal.active_phase=name;save();const r=await fn();journal.phases[name]=r;journal.active_phase=null;save();return r;};
let playwright;
for(const module of [options.playwright,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES&&path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'),'playwright','playwright-core'].filter(Boolean)){
 try{playwright=require(module);break;}catch{}
}
if(!playwright?.chromium)throw new Error('Use --playwright with the already installed Playwright module path.');
async function jsonAPI(ctx,route,query={}){
 const url=ready.origin+route+'?'+new URLSearchParams({workspace:ready.workspace,...query});
 const r=await ctx.request.get(url);const value=await r.json();if(!r.ok())throw new Error(route+' '+r.status()+' '+JSON.stringify(value));return value;
}
let page;
try{
 browser=await playwright.chromium.launch({headless:true,...(options.chromium?{executablePath:options.chromium}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(ready.url,{waitUntil:'domcontentloaded'});
 await page.getByLabel('Workspace access key',{exact:true}).fill(token);
 await page.getByRole('button',{name:'Open workspace',exact:true}).click();
 await page.getByRole('heading',{name:'Audit workspace',exact:true}).waitFor();
 async function route(name,heading){
  const menu=page.getByRole('button',{name:'Workspace menu',exact:true});
  if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')!=='true')await menu.click();
  await page.locator('#navigation').getByRole('button',{name,exact:true}).click();
  await page.getByRole('heading',{name:heading,exact:true}).first().waitFor();
  if(await page.locator('#page .error').count())throw new Error(await page.locator('#page .error').innerText());
 }
 await phase('desktop-operator-views',async()=>{
  const routes=[['Overview','Audit workspace'],['Risk & audit plan','Risk register'],['Engagements','Engagements'],['Audit areas','Audit areas'],['Control activities','Control activities'],['Workpapers','Workpapers'],['Observations','Observations'],['Management actions','Management actions'],['Evidence','Evidence'],['Follow-up','Follow-up'],['Advisory memos','Advisory memos'],['Reports & handoffs','Reports & handoffs'],['Issuer questionnaire','Original issuer questionnaire'],['Source intake & mappings','Source intake & mappings'],['Receiving & reconciliation','Receiving & reconciliation'],['Activity & outputs','Activity & retained outputs'],['Access','Workspace access'],['Backup & recovery','Backup & recovery']];
  const outcomes=[];
  for(const [name,heading] of routes){await route(name,heading);const geometry=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));if(geometry.scroll>geometry.client+1)throw new Error(name+' overflows desktop width');outcomes.push({view:name,width:geometry.client,overflow:0});}
  await route('Overview','Audit workspace');await page.screenshot({path:path.join(root,'desktop-overview.png'),fullPage:true});
  return outcomes;
 });
 await phase('browser-record-correction-and-review',async()=>{
  const engagement=(await jsonAPI(context,'/api/records',{kind:'engagement',limit:50})).items[0].record;
  const label='Practice browser workpaper '+journal.run_id.slice(0,8);
  let existing=(await jsonAPI(context,'/api/records',{kind:'workpaper',q:label,limit:50})).items.find(x=>x.record.payload.title===label);
  await route('Workpapers','Workpapers');
  if(!existing){
   await page.getByRole('button',{name:'New Workpaper',exact:true}).click();
   await page.getByLabel('Workpaper title *',{exact:true}).fill(label);
   await page.getByLabel('Engagement *',{exact:true}).fill(engagement.id);
   await page.getByLabel('Procedure performed',{exact:true}).fill('Practice browser operation: inspect the original retained control evidence.');
   await page.getByLabel('Results and exceptions',{exact:true}).fill('Initial Practice browser entry.');
   await page.getByText('Original source identity',{exact:true}).click();
   await page.getByLabel('Source namespace',{exact:true}).fill('practice-ui-receiving');
   await page.getByLabel('Original record ID',{exact:true}).fill(journal.run_id+'-workpaper');
   await page.getByRole('button',{name:'Save record',exact:true}).click();
   await page.locator('#editor').waitFor({state:'hidden'});
   existing=(await jsonAPI(context,'/api/records',{kind:'workpaper',q:label,limit:50})).items.find(x=>x.record.payload.title===label);
  }
  if(!existing)throw new Error('Browser-authored workpaper was not retained.');
  await page.locator('#record-query').fill(label);await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('button',{name:label,exact:true}).click();
  if(existing.record.payload.results!=='Corrected Practice browser entry; original revision retained.'){
   await page.getByRole('button',{name:'Edit current revision',exact:true}).click();
   await page.getByLabel('Results and exceptions',{exact:true}).fill('Corrected Practice browser entry; original revision retained.');
   await page.getByRole('button',{name:'Save revision '+(existing.record.revision+1),exact:true}).click();
   await page.locator('#editor').waitFor({state:'hidden'});
   await page.getByRole('button',{name:label,exact:true}).click();
  }
  await page.getByRole('button',{name:'Record review',exact:true}).click();
  await page.getByLabel('Review reason',{exact:true}).fill('Reviewed the corrected retained workpaper in this receiving console.');
  await page.getByRole('button',{name:'Record review',exact:true}).click();
  await page.locator('#editor').waitFor({state:'hidden'});
  const retained=(await jsonAPI(context,'/api/records',{kind:'workpaper',q:label,limit:50})).items.find(x=>x.record.payload.title===label);
  if(retained.record.revision<2||retained.current_review?.decision!=='approved')throw new Error('The corrected current revision did not retain its review.');
  return {id:retained.record.id,revision:retained.record.revision,current_review:retained.current_review.decision};
 });

 await phase('browser-reviewed-report-and-handoff',async()=>{
  await route('Reports & handoffs','Reports & handoffs');
  await page.getByLabel('Audience',{exact:true}).selectOption('executive');
  await page.getByLabel('Review / release note',{exact:true}).fill('Practice browser receiving release '+journal.run_id);
  for(const box of await page.locator('#report-form input[name="engagements"]').all())await box.check();
  await page.getByRole('button',{name:'Prepare report preview',exact:true}).click();
  await page.getByRole('heading',{name:'Reviewed reporting release',exact:true}).waitFor();
  const frame=page.frameLocator('iframe[title="Reviewed audit report"]');
  await frame.locator('body').waitFor();
  const reportText=await frame.locator('body').innerText();
  if(/A_PRIVATE_DETAIL|B_PRIVATE_DETAIL|A_PRIVATE_PLAN|A_WORKPAPER_PRIVATE/.test(reportText))throw new Error('Private auditor text appeared in the executive report.');
  await page.getByRole('button',{name:'Build reviewed handoff ZIP',exact:true}).click();
  await page.getByRole('heading',{name:'Handoff retained',exact:true}).waitFor();
  const link=page.locator('#report-result a');
  const response=await context.request.get(new URL(await link.getAttribute('href'),ready.origin).href);
  if(!response.ok())throw new Error('Reviewed handoff download failed.');
  const bytes=await response.body();
  const output=path.join(root,'browser-executive-handoff.zip');fs.writeFileSync(output,bytes,{mode:0o600});
  await page.screenshot({path:path.join(root,'desktop-report.png'),fullPage:true});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  return {bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),private_text_absent:true};
 });
 await phase('browser-scoped-access-and-revocation',async()=>{
  const label='Practice receiving unit '+journal.run_id.slice(0,8);
  await route('Access','Workspace access');
  await page.getByRole('button',{name:'Create access link',exact:true}).click();
  await page.getByLabel('Person or team',{exact:true}).fill(label);
  await page.getByLabel('Role',{exact:true}).selectOption('unit_leadership');
  await page.getByLabel('Authorized unit IDs',{exact:true}).fill('unit-a');
  await page.getByRole('button',{name:'Create access link',exact:true}).last().click();
  await page.getByRole('heading',{name:'Scoped access created',exact:true}).waitFor();
  const access=await page.getByLabel('Private access link',{exact:true}).inputValue();
  const scoped=await browser.newContext({viewport:{width:1280,height:900}});
  const viewer=await scoped.newPage();await viewer.goto(access);await viewer.getByRole('heading',{name:'Audit workspace',exact:true}).waitFor();
  if(await viewer.locator('#navigation').getByRole('button',{name:'Source intake & mappings',exact:true}).count())throw new Error('Private intake controls appeared to a unit reader.');
  const denied=await scoped.request.get(ready.origin+'/api/sources?'+new URLSearchParams({workspace:ready.workspace}));
  if(denied.status()!==403)throw new Error('Private original sources were not denied to the actual unit session.');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await route('Access','Workspace access');
  await page.getByRole('row').filter({has:page.getByText(label,{exact:true})}).getByRole('button',{name:'Revoke this link',exact:true}).click();
  await page.getByRole('button',{name:'Revoke this access link',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});
  const revoked=await scoped.request.get(ready.origin+'/api/state?'+new URLSearchParams({workspace:ready.workspace}));
  if(revoked.status()!==401)throw new Error('Revocation did not invalidate the retained reader session.');
  await scoped.close();return {role:'unit_leadership',units:['unit-a'],private_source_status:403,revoked_session_status:401};
 });
 await phase('browser-encrypted-recovery',async()=>{
  const keyFile=path.join(root,'recovery-passphrase.private');
  if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,crypto.randomBytes(32).toString('base64url'),{mode:0o600});
  const phrase=fs.readFileSync(keyFile,'utf8'),label='Browser recovery '+journal.run_id;
  await route('Backup & recovery','Backup & recovery');
  let backups=(await jsonAPI(context,'/api/artifacts')).artifacts.filter(a=>a.payload.detail?.encrypted&&a.payload.detail.label===label);
  if(!backups.length){
   await page.getByLabel('Backup label',{exact:true}).fill(label);
   await page.getByLabel('Passphrase',{exact:true}).fill(phrase);
   await page.getByLabel('Repeat passphrase',{exact:true}).fill(phrase);
   await page.getByRole('button',{name:'Create encrypted snapshot',exact:true}).click();
   await page.getByRole('heading',{name:'Encrypted backup retained',exact:true}).waitFor();
   await page.getByRole('button',{name:'Refresh backup list',exact:true}).click();
  }
  const option=page.locator('#restore-artifact option').filter({hasText:label});
  await option.waitFor({state:'attached'});await page.locator('#restore-artifact').selectOption(await option.getAttribute('value'));
  await page.getByLabel('Backup passphrase',{exact:true}).fill(phrase);
  const destination='browser-restored-'+journal.run_id.slice(0,8);
  await page.getByLabel('New workspace folder name',{exact:true}).fill(destination);
  await page.getByRole('button',{name:'Restore and open a new workspace',exact:true}).click();
  await page.getByRole('heading',{name:'Restored workspace ready',exact:true}).waitFor();
  const href=await page.getByRole('link',{name:'Open the restored workspace',exact:true}).getAttribute('href');
  const receiving=await browser.newContext();const receiver=await receiving.newPage();
  await receiver.goto(href);await receiver.getByRole('heading',{name:'Audit workspace',exact:true}).waitFor();
  const receiverWorkspace=new URL(href).searchParams.get('workspace');
  const response=await receiving.request.get(ready.origin+'/api/state?'+new URLSearchParams({workspace:receiverWorkspace}));
  const restored=await response.json(),before=await jsonAPI(context,'/api/state');
  if(!response.ok()||restored.workspace_id!==before.workspace_id||restored.overview.engagements!==before.overview.engagements)throw new Error('The restored browser workspace changed its retained identity.');
  await receiving.close();return {workspace_id:restored.workspace_id,engagements:restored.overview.engagements,access_renewed:true,new_directory:destination};
 });
 await phase('mobile-operator-views',async()=>{
  await page.setViewportSize({width:390,height:844});
  const views=[['Overview','Audit workspace'],['Engagements','Engagements'],['Workpapers','Workpapers'],['Observations','Observations'],['Follow-up','Follow-up'],['Reports & handoffs','Reports & handoffs'],['Issuer questionnaire','Original issuer questionnaire'],['Receiving & reconciliation','Receiving & reconciliation'],['Access','Workspace access'],['Backup & recovery','Backup & recovery']];
  const out=[];for(const [name,heading] of views){await route(name,heading);const g=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));if(g.scroll>g.client+1)throw new Error(name+' overflows 390px');out.push({view:name,width:g.client,overflow:0});}
  await route('Observations','Observations');await page.screenshot({path:path.join(root,'mobile-observations.png'),fullPage:true});return out;
 });
 if(errors.length)throw new Error('Browser page errors: '+JSON.stringify(errors));
 const result={format:'commons-audit-ui-receiving-result/1',status:'COMPLETE',classification:'Practice software operation; original issuer catalog retained; no university audit or supplier submission',run_id:journal.run_id,source_workspace:workspace,phases:journal.phases,page_errors:errors,external_provider_calls:0};
 journal.status='COMPLETE';journal.active_phase=null;save();fs.writeFileSync(resultFile,JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify(result));
}catch(error){journal.status='CONTINUATION_REQUIRED';journal.error={message:error.message,at:new Date().toISOString()};save();throw error;}
finally{
 if(context){try{await context.request.post(ready.origin+'/api/shutdown?'+new URLSearchParams({workspace:ready.workspace}),{headers:{'X-Audit-Request':'1','Content-Type':'application/json'},data:{}});}catch{}}
 if(browser)await browser.close();
 if(serverChild&&serverChild.exitCode===null)await Promise.race([new Promise(resolve=>serverChild.once('exit',resolve)),wait(6000)]);
}
