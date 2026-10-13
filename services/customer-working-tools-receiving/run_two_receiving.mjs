import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const EXPECTED={
  "TWO_Free_Christie_Davis_Profile.html": "fb4b5abdb925cb2f0d20757ffb7e84f49f56dfa36ff551888e577fe782fbf860",
  "TWO_Free_Christie_Davis_Profile.csv": "3b8333398ed4b571acb06bde58ddad62b9963587235f46dad7b94244a6d0703d",
  "TWO_Free_Christie_Davis_Profile.json": "97e7d59bdba9a834f95fce658cfe298debdd376458aae58bfd1e285ae5fb5794",
  "TWO_Five_Writer_Profiles.html": "19856f2da64101c22968af56c73fa67dece054aa277a54e674185940f018decc",
  "TWO_Five_Writer_Profiles.csv": "eb9d08d10d7158cb09c0466f7668b57e671c00060444458f3d745347437a0063",
  "TWO_Five_Writer_Profiles.json": "011f91e3f6ae7fe9f607dbe189ff070f516df19eb31f944f5c2465a974c8e63f",
  "TWO_Writer_Trial_Desk.html": "ff883efe3f8e4bbdf4d7abd4ff33f0fe6ef31b84bedee76fc759cd9f0c4ade1b"
};
const KEY='tjlabs-two-writer-trial-v1';
const need=(v,m)=>{if(!v)throw Error(m);};
const digest=b=>createHash('sha256').update(b).digest('hex');
const identity=async file=>{const b=await fs.readFile(file);return{file,bytes:b.length,sha256:digest(b)};};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Use the original receiver's isolated context and page; this function owns only its added tabs.
 * All entered values are companion receiving examples. This course does not log in to TWO
 * or establish any writer's actual TWO trial outcome. Source files stay unchanged.
 */
export async function runTwoReceiving({page,context,outputDirectory,sourceDirectory}){
 need(page&&context&&page.context()===context,'Supply the existing isolated receiving page/context.');
 const source=path.resolve(sourceDirectory),run=path.join(path.resolve(outputDirectory),'two-writer-trial',randomUUID());
 await fs.mkdir(run,{recursive:true});
 const result={schema:'tjlabs.two-writer-trial-receiving.v1',operation:'TWO-WRITER-PILOT-PROSPECTS-SCOUT-20261013',started_at:new Date().toISOString(),run_directory:run,state:'RUNNING',source:[],outputs:[],screens:[],stages:[],image_review:'The original receiver must inspect the returned desktop/mobile/print images before marking the outgoing edition ready.',receiving_data:'Isolated companion-tool examples only; no TWO account or actual writer trial is operated.'};
 const errors=[],tabs=new Set(),onError=e=>errors.push(String(e));page.on('pageerror',onError);
 let stage='source',previous,observed=false,touched=false;
 const toolURL=pathToFileURL(path.join(source,'TWO_Writer_Trial_Desk.html')).href;
 async function retain(name,body){const file=path.join(run,name);await fs.writeFile(file,body,{flag:'wx'});result.outputs.push(await identity(file));return file;}
 async function shot(target,name,width,height=1000){await target.setViewportSize({width,height});const file=path.join(run,name+'.png');await target.screenshot({path:file,fullPage:true});result.screens.push({...await identity(file),width,height});}
 async function capture(target,name){await shot(target,name+'-desktop',1440);await shot(target,name+'-mobile',390,844);await target.setViewportSize({width:1440,height:1000});}
 async function begin(name){stage=name;result.stages.push({name,started_at:new Date().toISOString()});}
 function done(){result.stages.at(-1).completed_at=new Date().toISOString();}
 async function ready(p=page){await p.locator('[data-action="save"]:not([disabled])').waitFor();}
 async function settle(p=page){return p.evaluate(async()=>{await writing;return{revision:browserRevision,blocked:browserBlocked};});}
 async function download(selector,name,p=page){const [d]=await Promise.all([p.waitForEvent('download'),p.locator(selector+':visible').first().click()]);need(!await d.failure(),'Browser download failed.');const f=path.join(run,name);await d.saveAs(f);result.outputs.push({...await identity(f),browser_filename:d.suggestedFilename()});return f;}
 async function tab(){const p=await context.newPage();tabs.add(p);p.on('pageerror',onError);await p.goto(toolURL,{waitUntil:'load'});await ready(p);return p;}
 async function confirm(action,p=page){await Promise.all([p.waitForEvent('dialog').then(d=>d.accept()),action()]);}
 async function open(file,p=page){const saved=p.waitForEvent('download');await confirm(()=>p.locator('#open').setInputFiles(file),p);const d=await saved;const f=path.join(run,'before-open-'+randomUUID()+'.json');await d.saveAs(f);result.outputs.push(await identity(f));await p.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Opened '));await settle(p);}
 async function replace(p=page){const d=p.waitForEvent('download');await confirm(()=>p.locator('[data-action="replace"]').click(),p);const f=path.join(run,'before-explicit-replacement-'+randomUUID()+'.txt');await(await d).saveAs(f);result.outputs.push(await identity(f));await p.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Chosen current trial saved.'));await settle(p);}
 async function field(name,value,p=page){await p.locator('[data-field="'+name+'"]').fill(value);await settle(p);}
 try{
  for(const[name,sha]of Object.entries(EXPECTED)){const file=path.join(source,name),st=await fs.lstat(file);need(st.isFile()&&!st.isSymbolicLink(),'Expected a regular source file: '+name);const id=await identity(file);need(id.sha256===sha,'Exact source differs: '+name);result.source.push(id);}
  await begin('all-original-customer-documents');
  for(const name of['TWO_Free_Christie_Davis_Profile.html','TWO_Five_Writer_Profiles.html']){await page.goto(pathToFileURL(path.join(source,name)).href,{waitUntil:'load'});await page.locator('h1').waitFor();await capture(page,name.replace('.html',''));await page.emulateMedia({media:'print'});await shot(page,name.replace('.html','')+'-print',1440);await page.emulateMedia({media:'screen'});}
  for(const name of Object.keys(EXPECTED).filter(n=>/\.(csv|json)$/.test(n))){const bytes=await fs.readFile(path.join(source,name));if(name.endsWith('.json'))JSON.parse(bytes.toString('utf8'));await retain('opened-'+name,bytes);await page.setContent('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#fff;color:#20262c;font:16px/1.55 system-ui;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 monospace}</style><h1>'+escape(name)+'</h1><pre>'+escape(bytes.toString('utf8'))+'</pre></html>');await capture(page,name.replace(/\.[^.]+$/,''));}
  done();
  await begin('original-browser-record-and-trial');
  await page.goto(toolURL,{waitUntil:'load'});await ready();await settle();
  previous=await page.evaluate(async()=>await browserRead());observed=true;
  if(previous)await retain('preceding-browser-record.json',JSON.stringify(previous,null,2)+'\n');
  await page.evaluate(async key=>{await writing;await new Promise((resolve,reject)=>{const tx=browserDb.transaction('copies','readwrite');tx.objectStore('copies').delete(key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});},KEY);touched=true;
  await page.reload({waitUntil:'load'});await ready();
  await field('task','Receiving example: one permitted article');
  await field('audience','Receiving example readers');
  await field('current_editor','Receiving example current editor');
  await field('required_format','Receiving example: Word file after actual handoff check');
  await field('review_route','Receiving example: retain original reviewer route');
  await field('permission','Receiving example: use only our own notes');
  await field('baseline_minutes','.');
  await field('decision_note','Unfinished duration must preserve this complete decision note.');
  const unfinished=await download('[data-action="save"]','01-unfinished-workbook.json');
  let b=JSON.parse(await fs.readFile(unfinished,'utf8'));need(b.cases[0].baseline_minutes==='.'&&b.cases[0].decision_note.includes('complete decision'),'Unfinished trial values were lost.');
  const reopened=await tab();await open(unfinished,reopened);need(await reopened.locator('[data-field="baseline_minutes"]').inputValue()==='.'&&await reopened.locator('[data-field="decision_note"]').inputValue()===b.cases[0].decision_note,'Independent reopen lost unfinished writing.');await capture(reopened,'unfinished-reopened');await reopened.close();tabs.delete(reopened);
  await page.reload({waitUntil:'load'});await ready();await field('baseline_minutes','25');await field('trial_minutes','25');need((await page.locator('#measurement').textContent()).includes('difference: 0 min'),'Equal measured durations must show zero.');
  await capture(page,'trial-brief');done();
  await begin('paired-document-planning-and-original-edition');
  await page.locator('[data-tab="documents"]').click();
  await field('reference_title','Receiving source brief');await field('draft_title','Receiving draft plan');
  await field('reference_notes','Receiving-only original notes. These are not an actual writer’s client material.');
  await field('draft_outline','Receiving-only outline. Keep the final client format explicit.');
  await page.locator('[data-action="add-source"]').click();await settle();
  await page.locator('[data-source][data-key="title"]').fill('Original public TWO writer contract');
  await page.locator('[data-source][data-key="url"]').fill('https://www.two.so/solutions/writers');
  await page.locator('[data-source][data-key="checked_at"]').fill('Receiving example; refresh the actual source when used');
  await page.locator('[data-source][data-key="permission"]').fill('Public source link retained; own trial notes only');
  await page.locator('[data-source][data-key="note"]').fill('=Receiving example of a note preserved literally');
  await settle();
  const ref=await download('[data-action="reference-md"]','02-reference-plan.md'),draft=await download('[data-action="draft-md"]','03-draft-plan.md');
  need((await fs.readFile(ref,'utf8')).includes('Original public TWO writer contract')&&(await fs.readFile(draft,'utf8')).includes('Receiving-only outline'),'Full paired planning downloads differ.');
  await capture(page,'document-pair');
  await page.locator('[data-tab="checks"]').click();await page.locator('[data-check="export"][data-key="result"]').selectOption('Needs change');
  await page.locator('[data-check="export"][data-key="note"]').fill('Receiving example only: actual TWO export is still to be operated by the writer.');
  await page.locator('[data-action="add-observation"]').click();await page.locator('[data-observation][data-key="at"]').fill(new Date().toISOString());await page.locator('[data-observation][data-key="actor"]').fill('Companion receiving operator');await page.locator('[data-observation][data-key="step"]').fill('Companion Markdown plan download');await page.locator('[data-observation][data-key="observation"]').fill('=Receiving-only observation: full planning notes preserved');await page.locator('[data-observation][data-key="evidence"]').fill('02-reference-plan.md');await settle();
  const csv=await download('[data-action="observations-csv"]','04-complete-observations.csv');need((await fs.readFile(csv,'utf8')).includes("'=Receiving-only"),'CSV formula-leading writing was not escaped.');await capture(page,'actual-checks');
  await page.locator('[data-tab="editions"]').click();await page.locator('#edition-label').fill('Companion receiving preparation');await page.locator('#edition-by').fill('Receiving operator');await page.locator('[data-action="freeze"]').click();await settle();
  const original=await download('[data-edition]','05-original-trial-edition.json');const edition=JSON.parse(await fs.readFile(original,'utf8'));need(edition.edition.trial.checks.find(x=>x.id==='export').result==='Needs change','Original edition lost actual incomplete status.');
  await page.locator('[data-tab="documents"]').click();await field('draft_outline','Later receiving outline; prior frozen edition must remain unchanged.');
  await page.locator('[data-tab="editions"]').click();const same=await download('[data-edition]','06-same-original-trial-edition.json');need((await fs.readFile(same)).equals(await fs.readFile(original)),'Later work changed the frozen original.');
  await capture(page,'frozen-editions');done();
  await begin('complete-multiple-trial-export-and-reopen');
  await page.locator('[data-action="new"]').click();await settle();await field('writer','Second receiving trial');await field('task','Second receiving task');await field('decision_note','Retain the whole second trial in full exports.');
  const full=await download('[data-action="save"]','07-complete-two-trial-workbook.json'),single=await download('[data-action="single"]','08-selected-trial-workbook.json'),report=await download('[data-action="report"]','09-complete-current-report.html');
  const fullBody=JSON.parse(await fs.readFile(full,'utf8')),one=JSON.parse(await fs.readFile(single,'utf8'));need(fullBody.cases.length===2&&one.cases.length===1&&one.selected===one.cases[0].id,'Whole or selected trial export differs.');
  const reportText=await fs.readFile(report,'utf8');need(reportText.includes('Second receiving trial')&&reportText.includes('Later receiving outline')&&reportText.includes('Frozen edition index'),'Complete current report omits original work.');
  const reportPage=await context.newPage();tabs.add(reportPage);reportPage.on('pageerror',onError);await reportPage.goto(pathToFileURL(report).href,{waitUntil:'load'});await capture(reportPage,'complete-exported-report');await reportPage.emulateMedia({media:'print'});await shot(reportPage,'complete-report-print',1440);await reportPage.close();tabs.delete(reportPage);
  await open(full);await capture(page,'complete-reopened-workbook');done();
  await begin('competing-writers-and-retained-browser-recovery');
  const second=await tab();
  await field('decision_note','First receiving writer retains this exact note');need(!(await settle()).blocked,'First receiving writer could not save.');
  await field('decision_note','Second receiving writer retains a different exact note',second);need((await settle(second)).blocked,'Competing writer silently overwrote the browser record.');
  const current=await download('[data-action="save"]','10-second-writer-current.json',second),saved=await download('[data-action="saved-recovery"]','11-first-writer-preserved.json',second);
  need(JSON.parse(await fs.readFile(current,'utf8')).cases[1].decision_note.startsWith('Second receiving writer')&&JSON.parse(await fs.readFile(saved,'utf8')).cases[1].decision_note.startsWith('First receiving writer'),'Both competing writers were not retained.');
  await capture(second,'competing-writers');await replace(second);need((await second.evaluate(async()=>JSON.parse((await browserRead()).text))).cases[1].decision_note.startsWith('Second receiving writer'),'Explicit replacement lost the selected writer.');
  await second.close();tabs.delete(second);await page.reload({waitUntil:'load'});await ready();await open(full);done();
  await begin('invalid-import-preserves-complete-current-work');
  const before=await page.evaluate(()=>JSON.stringify(book)),invalid=structuredClone(fullBody);invalid.cases[0].editions.push(structuredClone(invalid.cases[0].editions[0]));
  const bad=await retain('12-invalid-duplicate-edition-input.json',JSON.stringify(invalid,null,2));
  await page.locator('#open').setInputFiles(bad);await page.waitForFunction(()=>document.getElementById('status').textContent.includes('identity is missing or repeated'));need(await page.evaluate(()=>JSON.stringify(book))===before,'Invalid edition import changed current work.');
  await capture(page,'invalid-import-preserved');done();
  need(errors.length===0,'Actual browser errors: '+errors.join('; '));result.state='COMPLETE';result.completed_at=new Date().toISOString();
 }catch(e){result.state='FAILED';result.failed_stage=stage;result.error={name:e.name,message:e.message};try{await shot(page,'failure-'+stage,1440);}catch(c){result.capture_error=String(c);}}
 finally{for(const p of tabs)try{await p.close();}catch{}if(observed&&touched){try{await page.goto(toolURL,{waitUntil:'load'});await ready();await settle();await page.evaluate(async({key,previous})=>{await writing;await new Promise((resolve,reject)=>{const tx=browserDb.transaction('copies','readwrite'),s=tx.objectStore('copies');if(previous)s.put(previous);else s.delete(key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});},{key:KEY,previous});result.preceding_browser_record_restored=true;}catch(e){result.restoration_error=String(e);result.state='FAILED';}}page.off('pageerror',onError);result.page_errors=errors;if(errors.length)result.state='FAILED';await fs.writeFile(path.join(run,'receiving-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
 return result;
}
