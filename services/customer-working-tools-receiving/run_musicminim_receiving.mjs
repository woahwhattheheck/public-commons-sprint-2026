import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const EXPECTED={
  "Musicminim_Free_Jenny_Thornton_Profile.html": "7292d1f23ce3c2a8efe1f60d1929591a57ed36d7816e8075857a0bfeecabf44e",
  "Musicminim_Free_Jenny_Thornton_Profile.csv": "c9a147d9651a7d83afd4027baca6b44e321e2996eb527136a076a9958f047b74",
  "Musicminim_Free_Jenny_Thornton_Profile.json": "f1dcab833fc411f926eb77c02b5e5aadd1dba5a50f76a0fb7f2560f9fe7e5231",
  "Musicminim_Five_Teacher_Profiles.html": "e27097291bb11341df56317262418e697deb1029c0726366bd805e2820a5b1e6",
  "Musicminim_Five_Teacher_Profiles.csv": "b5f31d56700270d3d5d9298d35b054015c8458e462adb9c909dea03f5aadc9a1",
  "Musicminim_Five_Teacher_Profiles.json": "96e83740b7f76a9bb71769ebae8d46786d8fe2b7698abf7cb4c6b1370920db0e",
  "Musicminim_Teacher_Review_Desk.html": "7757f7a0e29eabd67a3e4037c033b5ad493921863364131b19b55b00c67fce25"
};
const KEY='tjlabs-musicminim-review-v1';
const need=(v,m)=>{if(!v)throw Error(m);};
const digest=b=>createHash('sha256').update(b).digest('hex');
const identity=async file=>{const b=await fs.readFile(file);return{file,bytes:b.length,sha256:digest(b)};};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Use the original receiver's isolated context and page; this function owns only its added tabs.
 * All entered values are companion receiving examples. This course does not log in to musicminim
 * or establish any writer's actual musicminim trial outcome. Source files stay unchanged.
 */
export async function runMusicminimReceiving({page,context,outputDirectory,sourceDirectory}){
 need(page&&context&&page.context()===context,'Supply the existing isolated receiving page/context.');
 const source=path.resolve(sourceDirectory),run=path.join(path.resolve(outputDirectory),'musicminim-teacher-review',randomUUID());
 await fs.mkdir(run,{recursive:true});
 const result={schema:'tjlabs.musicminim-teacher-review-receiving.v1',operation:'MUSICMINIM-STUDIO-FOUNDING-PROSPECTS-SCOUT-20261013',started_at:new Date().toISOString(),run_directory:run,state:'RUNNING',source:[],outputs:[],screens:[],stages:[],image_review:'The original receiver must inspect the returned desktop/mobile/print images before marking the outgoing edition ready.',receiving_data:'Isolated companion-tool examples only; no musicminim account or actual writer trial is operated.'};
 const errors=[],tabs=new Set(),onError=e=>errors.push(String(e));page.on('pageerror',onError);
 let stage='source',previous,observed=false,touched=false;
 const toolURL=pathToFileURL(path.join(source,'Musicminim_Teacher_Review_Desk.html')).href;
 async function retain(name,body){const file=path.join(run,name);await fs.writeFile(file,body,{flag:'wx'});result.outputs.push(await identity(file));return file;}
 async function shot(target,name,width,height=1000){await target.setViewportSize({width,height});const file=path.join(run,name+'.png');await target.screenshot({path:file,fullPage:true});result.screens.push({...await identity(file),width,height});}
 async function capture(target,name){await shot(target,name+'-desktop',1440);await shot(target,name+'-mobile',390,844);await target.setViewportSize({width:1440,height:1000});}
 async function begin(name){stage=name;result.stages.push({name,started_at:new Date().toISOString()});}
 function done(){result.stages.at(-1).completed_at=new Date().toISOString();}
 async function ready(p=page){await p.locator('#save:not([disabled])').waitFor();}
 async function settle(p=page){return p.evaluate(async()=>{await writing;return{revision:browserRevision,blocked:browserBlocked};});}
 async function download(selector,name,p=page){const [d]=await Promise.all([p.waitForEvent('download'),p.locator(selector+':visible').first().click()]);need(!await d.failure(),'Browser download failed.');const f=path.join(run,name);await d.saveAs(f);result.outputs.push({...await identity(f),browser_filename:d.suggestedFilename()});return f;}
 async function tab(){const p=await context.newPage();tabs.add(p);p.on('pageerror',onError);await p.goto(toolURL,{waitUntil:'load'});await ready(p);return p;}
 async function confirm(action,p=page){await Promise.all([p.waitForEvent('dialog').then(d=>d.accept()),action()]);}
 async function open(file,p=page){const saved=p.waitForEvent('download');await confirm(()=>p.locator('#open').setInputFiles(file),p);const d=await saved;const f=path.join(run,'before-open-'+randomUUID()+'.json');await d.saveAs(f);result.outputs.push(await identity(f));await p.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Opened '));await settle(p);}
 async function replace(p=page){const d=p.waitForEvent('download');await confirm(()=>p.locator('#replace-browser').click(),p);const f=path.join(run,'before-explicit-replacement-'+randomUUID()+'.txt');await(await d).saveAs(f);result.outputs.push(await identity(f));await p.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Both the previous download'));await settle(p);}
 async function field(name,value,p=page){await p.locator('[data-field="'+name+'"]').fill(value);await settle(p);}
 try{
 for(const[name,sha]of Object.entries(EXPECTED)){const file=path.join(source,name),st=await fs.lstat(file);need(st.isFile()&&!st.isSymbolicLink(),'Expected a regular source file: '+name);const id=await identity(file);need(id.sha256===sha,'Exact source differs: '+name);result.source.push(id);}
 await begin('all-original-profile-formats');
 for(const name of ['Musicminim_Free_Jenny_Thornton_Profile.html','Musicminim_Five_Teacher_Profiles.html']){await page.goto(pathToFileURL(path.join(source,name)).href,{waitUntil:'load'});await page.locator('h1').waitFor();await capture(page,name.replace('.html',''));await page.emulateMedia({media:'print'});await shot(page,name.replace('.html','')+'-print',1440);await page.emulateMedia({media:'screen'});}
 for(const name of Object.keys(EXPECTED).filter(n=>/\.(csv|json)$/.test(n))){const body=await fs.readFile(path.join(source,name));if(name.endsWith('.json'))JSON.parse(body.toString('utf8'));await retain('opened-'+name,body);await page.setContent('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#fff;color:#252525;font:16px/1.5 system-ui;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+escape(name)+'</h1><pre>'+escape(body.toString('utf8'))+'</pre></html>');await capture(page,name.replace(/\.[^.]+$/,''));}
 done();
 await begin('selected-original-inputs');
 await page.goto(toolURL,{waitUntil:'load'});await ready();await settle();previous=await page.evaluate(async()=>await browserRead());observed=true;if(previous)await retain('preceding-browser-record.json',JSON.stringify(previous,null,2)+'\n');
 await page.evaluate(async key=>{await writing;await new Promise((resolve,reject)=>{const tx=browserDb.transaction('copies','readwrite');tx.objectStore('copies').delete(key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});},KEY);touched=true;
 await page.reload({waitUntil:'load'});await ready();
 await field('title','Receiving example: teacher-reviewed practice update');await field('learner_alias','Receiving example learner');await field('instrument','Piano');await field('lesson_date','Receiving example period');
 await field('goal','Receiving example: slow hands-separate practice.');await field('permission','Receiving example authored solely for this companion course; no real pupil.');
 await page.locator('#add-source').click();await page.locator('[data-source="0"][data-key="title"]').fill('Receiving example teacher notebook');await page.locator('[data-source="0"][data-key="note"]').fill('Original fictional instruction: hands separately at a slow comfortable tempo.');await settle();
 await capture(page,'trial-setup');
 await page.locator('[data-tab="draft"]').click();await field('source_notes','Receiving example original notes: practise the chosen passage hands separately, slowly; ask the teacher about fingering. No exam pass prediction.');await field('product_record','Receiving example only — no real musicminim record');await field('generated_text','Receiving example draft: practise hands together quickly and you will pass the exam.');await field('revised_text','Receiving example corrected update: practise the chosen passage hands separately at a slow, comfortable tempo. Ask your teacher about the fingering.');
 const inputs=await download('#input-notes','01-selected-input-notes.md');need((await fs.readFile(inputs,'utf8')).includes('hands separately'),'Original input export omitted selected notes.');
 await page.locator('#capture-draft').click();await settle();const draft=await download('[data-version]','02-original-draft-version.json');const capturedDraft=JSON.parse(await fs.readFile(draft,'utf8'));need(capturedDraft.edition.kind==='Draft'&&capturedDraft.edition.case.generated_text.includes('pass the exam'),'Complete original draft not captured.');
 done();
 await begin('factual-correction-and-exact-approval');
 await page.locator('[data-tab="review"]').click();await page.locator('#add-fact').click();await page.locator('[data-fact="0"][data-key="claim"]').fill('Receiving example draft predicts passing an exam and changes practice instructions.');await page.locator('[data-fact="0"][data-key="source"]').fill('Original fictional teacher note contains neither claim.');await field('reviewer','Receiving example teacher');
 await page.locator('#review-confirm').check();await page.locator('#capture-approved').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('unchecked factual'));need((await page.evaluate(()=>cur().editions)).length===1,'Unchecked draft became approved.');
 await page.locator('[data-fact="0"][data-key="verdict"]').selectOption('Corrected');await page.locator('[data-fact="0"][data-key="correction"]').fill('Removed prediction; restored exact teacher-selected practice instruction.');await settle();need(!await page.locator('#review-confirm').isChecked(),'Factual edit retained stale confirmation.');await page.locator('#review-confirm').check();await field('reviewer','Receiving example teacher — exact edited reviewer');need(!await page.locator('#review-confirm').isChecked(),'Reviewer edit retained stale confirmation.');await page.locator('#review-confirm').check();await capture(page,'teacher-factual-review');
 await page.locator('#capture-approved').click();await settle();need(await page.evaluate(()=>Boolean(currentApproval(cur()))),'Approved version does not bind current exact text.');
 const approved=await download('[data-version]','03-first-original-version-again.json');
 need((await fs.readFile(approved)).equals(await fs.readFile(draft)),'Review changed the captured draft.');
 const approvedId=await page.evaluate(()=>cur().editions.find(e=>e.kind==='Approved').id);
 const fullApproved=await download('[data-version="'+approvedId+'"]','04-full-approved-version.json'),handoff=await download('[data-handoff="'+approvedId+'"]','05-approved-text.txt');
 const approvedBody=JSON.parse(await fs.readFile(fullApproved,'utf8'));need(approvedBody.edition.case.facts[0].verdict==='Corrected'&&(await fs.readFile(handoff,'utf8')).includes('slow, comfortable tempo'),'Approved source or final handoff differs.');
 await capture(page,'approved-version');
 await page.locator('[data-tab="draft"]').click();await field('revised_text','Later receiving working draft — approved original must remain unchanged.');need(!await page.evaluate(()=>Boolean(currentApproval(cur()))),'Changed text inherited previous approval.');
 await page.locator('[data-tab="versions"]').click();const again=await download('[data-handoff="'+approvedId+'"]','06-unchanged-original-approved-text.txt');need((await fs.readFile(again)).equals(await fs.readFile(handoff)),'Later edits changed approved handoff.');
 done();
 await begin('unfinished-work-and-complete-reopen');
 await page.locator('[data-tab="observe"]').click();await field('baseline_minutes','.');await field('decision_note','Receiving example notes survive unfinished duration.');
 const unfinished=await download('#save','07-unfinished-complete-workbook.json');const reopened=await tab();await open(unfinished,reopened);need(await reopened.evaluate(()=>cur().baseline_minutes==='.'&&cur().decision_note.includes('survive')),'Reopen lost unfinished notes.');await capture(reopened,'unfinished-reopened');await reopened.close();tabs.delete(reopened);await page.reload({waitUntil:'load'});await ready();await page.locator('[data-tab="observe"]').click();
 await field('baseline_minutes','12');await field('trial_minutes','12');need((await page.locator('#measurement').innerText()).includes('0.00'),'Equal actual durations should give zero.');
 await page.locator('#add-observation').click();await page.locator('[data-observation="0"][data-key="action"]').fill('=RECEIVING_CELL_GUARD');await page.locator('[data-observation="0"][data-key="result"]').fill('Receiving example only; approved wording retained.');await page.locator('[data-observation="0"][data-key="evidence"]').fill('No actual vendor account was operated.');await settle();
 const csvFile=await download('#csv','08-all-review-rows.csv');need((await fs.readFile(csvFile,'utf8')).includes("'=RECEIVING_CELL_GUARD"),'Spreadsheet formula guard missing.');
 await page.locator('#new-case').click();await field('teacher','Second receiving teacher');await field('title','Second complete teacher trial');await page.locator('[data-tab="observe"]').click();await field('decision_note','Second receiving case full notes');
 const full=await download('#save','09-complete-two-case-workbook.json'),single=await download('#save-case','10-selected-case-workbook.json'),reportFile=await download('#report','11-complete-current-and-version-report.html');
 const fullBody=JSON.parse(await fs.readFile(full,'utf8')),singleBody=JSON.parse(await fs.readFile(single,'utf8'));need(fullBody.cases.length===2&&singleBody.cases.length===1,'Whole/selected export population differs.');
 const report=await fs.readFile(reportFile,'utf8');need(report.includes('Second receiving teacher')&&report.includes('Later receiving working draft')&&report.includes('slow, comfortable tempo')&&report.includes('pass the exam'),'Full report lost current or original version bodies.');
 const rp=await context.newPage();tabs.add(rp);rp.on('pageerror',onError);await rp.goto(pathToFileURL(reportFile).href,{waitUntil:'load'});await capture(rp,'whole-exported-report');await rp.emulateMedia({media:'print'});await shot(rp,'whole-report-print',1440);await rp.close();tabs.delete(rp);
 await open(full);await capture(page,'whole-workbook-reopened');done();
 await begin('competing-tabs-and-explicit-recovery');
 const peer=await tab();await page.locator('[data-tab="observe"]').click();await peer.locator('[data-tab="observe"]').click();await field('decision_note','First receiving writer keeps this exact text');need(!(await settle()).blocked,'First writer could not save.');
 await field('decision_note','Second receiving writer keeps a distinct text',peer);need((await settle(peer)).blocked,'Second tab silently overwrote the first.');
 const current=await download('#save','12-second-writer-current.json',peer),prior=await download('#recover-browser','13-first-writer-saved.json',peer);need(JSON.parse(await fs.readFile(current,'utf8')).cases[1].decision_note.startsWith('Second receiving writer')&&JSON.parse(await fs.readFile(prior,'utf8')).cases[1].decision_note.startsWith('First receiving writer'),'Competing drafts were not both retained.');
 await capture(peer,'competing-draft-recovery');await replace(peer);need((await peer.evaluate(async()=>JSON.parse((await browserRead()).text))).cases[1].decision_note.startsWith('Second receiving writer'),'Explicit replacement differs.');
 await peer.close();tabs.delete(peer);await page.reload({waitUntil:'load'});await ready();await open(full);done();
 await begin('invalid-captured-version-preserves-current-work');
 const before=await page.evaluate(()=>JSON.stringify(book)),bad=structuredClone(fullBody);bad.cases[0].editions.push(structuredClone(bad.cases[0].editions[0]));const badFile=await retain('14-invalid-duplicate-version.json',JSON.stringify(bad,null,2));
 await page.locator('#open').setInputFiles(badFile);await page.waitForFunction(()=>document.getElementById('status').textContent.includes('duplicate version identity'));need(await page.evaluate(()=>JSON.stringify(book))===before,'Invalid import replaced current work.');await capture(page,'invalid-import-retained');done();
 need(errors.length===0,'Actual browser errors: '+errors.join('; '));result.state='COMPLETE';result.completed_at=new Date().toISOString();
 }catch(e){result.state='FAILED';result.failed_stage=stage;result.error={name:e.name,message:e.message};try{await shot(page,'failure-'+stage,1440);}catch(c){result.capture_error=String(c);}}
 finally{for(const p of tabs)try{await p.close();}catch{}if(observed&&touched){try{await page.goto(toolURL,{waitUntil:'load'});await ready();await settle();await page.evaluate(async({key,previous})=>{await writing;await new Promise((resolve,reject)=>{const tx=browserDb.transaction('copies','readwrite'),s=tx.objectStore('copies');if(previous)s.put(previous);else s.delete(key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});},{key:KEY,previous});result.preceding_browser_record_restored=true;}catch(e){result.restoration_error=String(e);result.state='FAILED';}}page.off('pageerror',onError);result.page_errors=errors;if(errors.length)result.state='FAILED';await fs.writeFile(path.join(run,'receiving-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
 return result;
}
