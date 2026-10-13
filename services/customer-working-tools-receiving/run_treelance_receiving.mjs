import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const EXPECTED={
  "Treelance_Free_WalkTalk_Sample.html": "764522bf368be72beff390668950fe804563778f705f0157dcddbc9faa8925ec",
  "Treelance_Free_WalkTalk_Sample.csv": "4f5aee948690f72d2e96a79a0598a91c6bf508dc8adec3cd29bf541bb96a5cf0",
  "Treelance_Free_WalkTalk_Sample.json": "be8ad79813dd63cf1e82537dcef1ea9499fca8218c863b1d67685fa7e1eb7b0d",
  "Treelance_Five_Additional_Profiles.html": "9d97de2ce4c509020731001818a5b14162a7181d902c974c4d730af48f760656",
  "Treelance_Five_Additional_Profiles.csv": "7e3d0796b9113a46877a01b52f27e2fd52d1fc1ec813082e1e0473dcb0f6b86c",
  "Treelance_Five_Additional_Profiles.json": "4b8a07d61b96bf332a8dc1dbe55c385b3f131971b116ea9f7d068848a301ce53",
  "Treelance_Launch_Outcome_Desk.html": "0cceb877da68fbc72b7e7c0673e2a13b83ea23622146bfcdf0258def0664635e"
};
const KEY='tjlabs-treelance-outcome-desk-v1';
const digest=b=>createHash('sha256').update(b).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const actualFile=async file=>{const b=await fs.readFile(file);return {file,bytes:b.length,sha256:digest(b)};};
const neutralCase=book=>{const out=structuredClone(book);for(const c of out.cases)delete c.updated_at;return out;};

/**
 * Operates the complete prepared customer documents and their editable tool.
 * The existing receiver owns page/context/browser lifetime and any HTTP server.
 * This function creates only its own additional tabs; it closes those tabs.
 * sourceDirectory contains the exact seven unchanged customer files.
 * outputDirectory is the caller's existing private operation output directory.
 * No customer, email, API account, shared CaseStore or remote source is mutated.
 */
export async function runTreelanceReceiving({page,context,outputDirectory,sourceDirectory}){
  need(page&&context&&page.context()===context,'Supply the existing same receiving page/context.');
  const sourceRoot=path.resolve(sourceDirectory),outRoot=path.resolve(outputDirectory);
  const run=path.join(outRoot,'treelance-outcome',randomUUID());
  await fs.mkdir(run,{recursive:true});
  const result={schema:'tjlabs.treelance-outcome-receiving.v1',operation:'TREELANCE-LAUNCH-PROSPECTS-SCOUT-20261013',
    started_at:new Date().toISOString(),run_directory:run,state:'RUNNING',source:[],outputs:[],screens:[],stages:[],
    receiving_data:'All entered brief/order values are isolated receiving examples. Original launch source context stays unchanged; no actual founder order or customer outcome is entered.'};
  let stage='source',originalStorage,storageObserved=false,storageTouched=false;
  const ownedTabs=new Set(),pageErrors=[];
  const recordError=e=>pageErrors.push(String(e));
  page.on('pageerror',recordError);
  async function retain(name,body){const file=path.join(run,name);await fs.writeFile(file,body,{flag:'wx'});const identity=await actualFile(file);result.outputs.push(identity);return file;}
  async function screen(target,name,width,height=1000){
    await target.setViewportSize({width,height});await target.screenshot({path:path.join(run,name+'.png'),fullPage:true});
    result.screens.push({...await actualFile(path.join(run,name+'.png')),width,height});
  }
  async function capture(target,label){
    await screen(target,label+'-desktop',1440);
    await screen(target,label+'-mobile',390,844);
    await target.setViewportSize({width:1440,height:1000});
  }
  async function clickDownload(selector,retainedName,target=page){
    const [download]=await Promise.all([target.waitForEvent('download'),target.locator(selector+':visible').first().click()]);need(!await download.failure(),'Browser download failed.');
    const file=path.join(run,retainedName);await download.saveAs(file);
    const identity={...await actualFile(file),browser_filename:download.suggestedFilename()};
    result.outputs.push(identity);return file;
  }
  async function confirmAction(action,target=page){
    await Promise.all([target.waitForEvent('dialog').then(dialog=>dialog.accept()),action()]);
  }
  async function openWorkbook(file,target=page){
    await confirmAction(()=>target.locator('#open').setInputFiles(file),target);
    await target.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Reopened '));await settle(target);
  }
  async function ready(target=page){await target.locator('[data-action="save"]:not([disabled])').waitFor();}
  async function settle(target=page){return target.evaluate(async()=>{await writing;return {revision:browserRevision,blocked:browserBlocked};});}
  async function stored(target=page){await settle(target);return target.evaluate(async()=>await browserRead());}
  async function keepDisplayed(target=page,label='retained-before-explicit-replacement'){
    const [download]=await Promise.all([target.waitForEvent('download'),confirmAction(()=>target.locator('[data-action="replace"]').click(),target)]);
    const file=path.join(run,label+'.json');await download.saveAs(file);result.outputs.push(await actualFile(file));
    await target.waitForFunction(()=>document.getElementById('status').textContent==='Current workbook is now the saved browser record.');await settle(target);
  }
  async function begin(name){stage=name;result.stages.push({name,started_at:new Date().toISOString()});}
  async function done(){result.stages.at(-1).completed_at=new Date().toISOString();}
  async function independentTab(url){const p=await context.newPage();ownedTabs.add(p);p.on('pageerror',recordError);await p.goto(url,{waitUntil:'load'});if(url===toolURL)await ready(p);return p;}
  async function closeOwned(p){if(ownedTabs.delete(p))await p.close();}
  const toolURL=pathToFileURL(path.join(sourceRoot,'Treelance_Launch_Outcome_Desk.html')).href;
  try{
    for(const [name,sha256]of Object.entries(EXPECTED)){
      const file=path.join(sourceRoot,name),st=await fs.lstat(file);
      need(st.isFile()&&!st.isSymbolicLink(),'Source must be a regular retained file: '+name);
      const identity=await actualFile(file);need(identity.sha256===sha256,'Complete source differs: '+name);result.source.push(identity);
    }
    await begin('complete-customer-documents');
    for(const name of ['Treelance_Free_WalkTalk_Sample.html','Treelance_Five_Additional_Profiles.html']){
      await page.goto(pathToFileURL(path.join(sourceRoot,name)).href,{waitUntil:'load'});
      await page.locator('#profile').waitFor();await capture(page,name.replace('.html',''));
      await page.emulateMedia({media:'print'});await screen(page,name.replace('.html','')+'-print',1440);await page.emulateMedia({media:'screen'});
    }
    const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    for(const name of Object.keys(EXPECTED).filter(n=>/\.(csv|json)$/.test(n))){
      const bytes=await fs.readFile(path.join(sourceRoot,name)),s=bytes.toString('utf8');if(name.endsWith('.json'))JSON.parse(s);
      await retain('opened-'+name,bytes);
      await page.setContent('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#fff;color:#202326;font:15px/1.6 system-ui;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 monospace}h1{font-size:24px}</style><h1>'+escape(name)+'</h1><pre>'+escape(s)+'</pre></html>');
      await capture(page,name.replace(/\.[^.]+$/,''));
    }
    await done();
    await begin('whole-brief-and-unfinished-order');
    await page.goto(toolURL,{waitUntil:'load'});
    await ready();originalStorage=await stored();storageObserved=true;
    if(originalStorage)await retain('preceding-browser-record.json',JSON.stringify(originalStorage,null,2));
    storageTouched=true;await confirmAction(()=>page.locator('[data-action="reset"]').click());
    const field=async(scope,key,value)=>page.locator('[data-scope="'+scope+'"][data-key="'+key+'"]').fill(value);
    await field('case','company','Receiving example — launch handoff');
    await field('case','approver','Receiving operator');
    await field('case','destination','https://example.org/receiving-only');
    await field('case','scope','Receiving-only launch outcome. Original public prospect source stays retained.');
    await field('case','permissions','Receiving exercise uses a named example file only.');
    await capture(page,'launch-brief');
    await page.locator('[data-action="tab"][data-id="claims"]').click();await page.locator('[data-action="newclaim"]').click();
    await field('claim','statement','Receiving original product claim');
    await field('claim','source_url','https://example.org/original-source');
    await field('claim','reviewer','Receiving source reviewer');
    await page.locator('[data-scope="claim"][data-key="decision"]').selectOption('Confirmed');
    await page.locator('[data-action="tab"][data-id="outcomes"]').click();await page.locator('[data-action="newasset"]').click();
    await field('asset','name','=Receiving outcome A');
    await field('asset','brief','Original receiving brief');
    await field('asset','acceptance','Preserve the original source claim and named received file.');
    await field('asset','quote_amount','.');
    await field('asset','currency','USD');
    await field('asset','order_ref','Receiving exercise; no actual order');
    await field('asset','draft_filename','receiving-original.png');
    await field('asset','draft_reviewer','Receiving outcome reviewer');
    await page.locator('[data-scope="asset"][data-key="draft_decision"]').selectOption('Approved');
    const unfinishedFile=await clickDownload('[data-action="save"]','01-unfinished-workbook.json');
    const unfinished=JSON.parse(await fs.readFile(unfinishedFile,'utf8'));
    need(unfinished.cases[0].assets[0].quote_amount==='.'&&unfinished.cases[0].assets[0].brief==='Original receiving brief','Unfinished order lost.');
    const reopened=await independentTab(toolURL);await openWorkbook(unfinishedFile,reopened);
    const reopenedFile=await clickDownload('[data-action="save"]','02-independent-reopen.json',reopened);
    need(JSON.stringify(neutralCase(JSON.parse(await fs.readFile(reopenedFile,'utf8'))))===JSON.stringify(neutralCase(unfinished)),'Whole unfinished workbook changed on reopen.');
    await closeOwned(reopened);await page.reload({waitUntil:'load'});await ready();await page.locator('[data-action="tab"][data-id="outcomes"]').click();
    await field('asset','quote_amount','19.00');
    need((await page.locator('#quote-summary').textContent()).includes('USD 19.00'),'Quoted total did not refresh with editing.');
    await capture(page,'received-outcome');
    await done();
    await begin('received-version-and-source-change');
    await confirmAction(()=>page.locator('[data-action="version"]').click());
    const originalVersionFile=await clickDownload('[data-action="versionjson"]','03-original-received-version.json');
    const originalVersion=JSON.parse(await fs.readFile(originalVersionFile,'utf8'));
    need(originalVersion.version.claims[0].statement==='Receiving original product claim'&&originalVersion.version.specification.brief==='Original receiving brief','Captured version lost original claim/specification.');
    await field('asset','brief','Revised receiving brief');
    need(await page.locator('[data-scope="asset"][data-key="draft_decision"]').inputValue()==='Draft','Changed specification retained stale approval.');
    await page.locator('[data-action="tab"][data-id="claims"]').click();
    await field('claim','statement','Revised receiving product claim');
    need(await page.locator('[data-scope="claim"][data-key="decision"]').inputValue()==='To confirm','Changed factual statement retained old confirmation.');
    await page.locator('[data-action="tab"][data-id="outcomes"]').click();
    const originalAgain=await clickDownload('[data-action="versionjson"]','04-original-version-after-change.json');
    need((await fs.readFile(originalAgain)).equals(await fs.readFile(originalVersionFile)),'Earlier received version was rewritten.');
    await capture(page,'reopened-review');
    await done();
    await begin('frozen-edition-and-complete-exports');
    await page.locator('[data-action="tab"][data-id="editions"]').click();await confirmAction(()=>page.locator('[data-action="edition"]').click());
    const frozenFile=await clickDownload('[data-action="editionjson"]','05-frozen-handoff.json');
    const frozen=JSON.parse(await fs.readFile(frozenFile,'utf8'));
    await page.locator('[data-action="tab"][data-id="outcomes"]').click();await page.locator('[data-action="newasset"]').click();
    await field('asset','name','Receiving outcome B');await field('asset','brief','Second complete outcome remains in exports.');
    await page.locator('[data-action="tab"][data-id="editions"]').click();
    const frozenAgain=await clickDownload('[data-action="editionjson"]','06-frozen-handoff-after-edit.json');
    need((await fs.readFile(frozenAgain)).equals(await fs.readFile(frozenFile)),'Frozen handoff changed after current edits.');
    const editionReport=await clickDownload('[data-action="editionhtml"]','07-frozen-handoff.html');
    const csvFile=await clickDownload('[data-action="csv"]','08-complete-outcomes.csv');
    const csvText=await fs.readFile(csvFile,'utf8');
    need(csvText.includes("'=Receiving outcome A")&&csvText.includes('Receiving outcome B'),'Complete CSV missed a row or formula escape.');
    const reportFile=await clickDownload('[data-action="report"]','09-current-complete-handoff.html');
    const reportText=await fs.readFile(reportFile,'utf8');
    need(reportText.includes('Receiving outcome B')&&reportText.includes('Receiving original product claim')&&reportText.includes('Revised receiving product claim'),'Complete report lost current or prior context.');
    const finalFile=await clickDownload('[data-action="save"]','10-complete-final-workbook.json');
    const finalBook=JSON.parse(await fs.readFile(finalFile,'utf8'));
    need(finalBook.cases[0].assets.length===2&&finalBook.cases[0].editions.length===1&&finalBook.cases[0].assets[0].versions.length===1,'Whole final workspace incomplete.');
    for(const [file,label]of [[editionReport,'frozen-handoff'],[reportFile,'complete-handoff']]){
      const p=await independentTab(pathToFileURL(file).href);await capture(p,label);await p.emulateMedia({media:'print'});await screen(p,label+'-print',1440);await closeOwned(p);
    }
    await capture(page,'retained-handoffs');
    await done();
    await begin('invalid-binding-retains-current-work');
    const bad=structuredClone(finalBook);bad.cases[0].assets[0].versions[0].specification.id='other-outcome';
    const badFile=await retain('invalid-binding-input.json',JSON.stringify(bad,null,2));
    await page.locator('#open').setInputFiles(badFile);
    await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('File was not adopted.'));
    const afterBad=await clickDownload('[data-action="save"]','11-after-rejected-binding.json');
    need(JSON.stringify(neutralCase(JSON.parse(await fs.readFile(afterBad,'utf8'))))===JSON.stringify(neutralCase(finalBook)),'Rejected import replaced the current workspace.');
    await capture(page,'import-error-retains-work');
    await openWorkbook(finalFile);await page.reload({waitUntil:'load'});await capture(page,'complete-reopened-workspace');
    await done();
    await begin('oversize-recovery-without-discarding-writing');
    const large=structuredClone(finalBook);
    large.cases=[];
    for(let k=0;k<2;k++){
      const c=structuredClone(finalBook.cases[0]);c.id='capacity-case-'+k;c.company='Receiving capacity case '+(k+1);c.assets=[];c.editions=[];
      c.claims=Array.from({length:100},(_,i)=>({id:'capacity-claim-'+i,statement:'S'.repeat(11500),source_url:'https://example.org/receiving-only',
        observed_at:'',decision:'To confirm',reviewer:'Receiving operator',note:'N'.repeat(11500)}));
      const body=structuredClone(c);delete body.editions;
      for(let i=0;i<6;i++)c.editions.push({id:'capacity-edition-'+i,at:'2026-10-13T00:00:00.000Z',label:'Receiving retained capacity edition '+i,by:'Receiving operator',case:structuredClone(body)});
      large.cases.push(c);
    }
    large.selected=large.cases[0].id;
    const capacityText=JSON.stringify(large,null,2);
    need(Buffer.byteLength(capacityText)<32*1024*1024,'Receiving capacity input must begin within the actual limit.');
    const capacityFile=await retain('12-capacity-before-growth.json',capacityText);
    await openWorkbook(capacityFile);
    const priorBrowser=await stored();
    await page.locator('[data-action="tab"][data-id="editions"]').click();
    await confirmAction(()=>page.locator('[data-action="edition"]').click());
    need(await page.locator('#oversize').isVisible(),'Above-limit workbook did not expose its recovery controls.');
    const rawRecovery=await clickDownload('[data-action="raw"]','13-capacity-complete-raw-recovery.json');
    const rawText=await fs.readFile(rawRecovery,'utf8'),rawBook=JSON.parse(rawText);
    need(Buffer.byteLength(rawText)>32*1024*1024&&rawBook.cases[0].editions.length===7&&rawBook.cases[1].editions.length===6,'Above-limit writing or prior editions were discarded.');
    need(JSON.stringify(await stored())===JSON.stringify(priorBrowser),'Above-limit recovery overwrote the preceding browser record.');
    await page.locator('[data-action="save"]').click();
    need((await page.locator('#status').textContent()).includes('32MiB'),'Normal save did not report the same complete reopen limit.');
    await capture(page,'capacity-complete-recovery');
    const splitA=await clickDownload('[data-action="savecase"]','14-capacity-first-case.json');
    await page.locator('[data-action="case"][data-id="capacity-case-1"]').click();
    const splitB=await clickDownload('[data-action="savecase"]','15-capacity-second-case.json');
    for(const [file,index]of [[splitA,0],[splitB,1]]){
      const selected=JSON.parse(await fs.readFile(file,'utf8'));
      need(selected.cases.length===1&&JSON.stringify(neutralCase(selected).cases[0])===JSON.stringify(neutralCase(rawBook).cases[index]),'Selected-case recovery lost writing or frozen editions.');
      const tab=await independentTab(toolURL);await openWorkbook(file,tab);
      const saved=await clickDownload('[data-action="save"]','16-reopened-capacity-case-'+index+'.json',tab);
      need(JSON.stringify(neutralCase(JSON.parse(await fs.readFile(saved,'utf8'))))===JSON.stringify(neutralCase(selected)),'Split workbook failed its complete reopen.');
      await closeOwned(tab);
    }
    await openWorkbook(finalFile);if((await settle()).blocked)await keepDisplayed(page,'18-before-final-capacity-restoration');await done();
    await begin('unreadable-browser-record-is-preserved');
    const unreadable='{"original_receiving_record":';await page.evaluate(async value=>{await writing;await browserWrite(value,browserRevision);},unreadable);
    await page.reload({waitUntil:'load'});await ready();
    const retainedOld=await clickDownload('[data-action="old"]','17-preserved-unreadable-browser-record.txt');
    need(await fs.readFile(retainedOld,'utf8')===unreadable,'Prior unreadable browser record was altered.');
    await page.locator('[data-scope="case"][data-key="scope"]').fill('Recovery example remains separate until explicit replacement.');
    need((await stored()).text===unreadable,'Editing replaced the unreadable original record.');
    await capture(page,'preserved-browser-record');
    await keepDisplayed(page,'19-before-unreadable-record-replacement');
    need(JSON.parse((await stored()).text).cases[0].scope==='Recovery example remains separate until explicit replacement.','Explicit browser replacement did not retain the chosen current writing.');
    await openWorkbook(finalFile);await page.reload({waitUntil:'load'});await capture(page,'final-restored-complete-course');
    await done();
    await begin('competing-tabs-preserve-both-complete-workbooks');
    await ready();await settle();const second=await independentTab(toolURL);
    await page.locator('[data-action="tab"][data-id="brief"]').click();await second.locator('[data-action="tab"][data-id="brief"]').click();
    await page.locator('[data-scope="case"][data-key="approver"]').fill('First receiving writer');need(!(await settle()).blocked,'First writer could not save.');
    await second.locator('[data-scope="case"][data-key="approver"]').fill('Second receiving writer');need((await settle(second)).blocked,'Competing writer overwrote the saved workbook.');
    const secondFile=await clickDownload('[data-action="save"]','20-competing-current-workbook.json',second);
    const firstFile=await clickDownload('[data-action="old"]','21-competing-preserved-workbook.json',second);
    need(JSON.parse(await fs.readFile(secondFile,'utf8')).cases[0].approver==='Second receiving writer'&&JSON.parse(await fs.readFile(firstFile,'utf8')).cases[0].approver==='First receiving writer','Both original writers were not preserved.');
    await capture(second,'competing-writers');
    await keepDisplayed(second,'22-before-competing-explicit-replacement');
    need(JSON.parse((await stored(second)).text).cases[0].approver==='Second receiving writer','Explicit replacement did not retain the selected complete writer.');
    await closeOwned(second);await page.reload({waitUntil:'load'});await ready();await openWorkbook(finalFile);await capture(page,'final-reopened-course');await done();
    need(pageErrors.length===0,'Browser page errors: '+pageErrors.join('; '));
    result.state='COMPLETE';result.completed_at=new Date().toISOString();
  }catch(error){
    result.state='FAILED';result.failed_stage=stage;result.error={name:error.name,message:error.message};result.finished_at=new Date().toISOString();
    try{await screen(page,'failure-'+stage,1440);}catch(e){result.failure_capture_error=String(e);}
  }finally{
    for(const tab of ownedTabs){try{await tab.close();}catch{}}
    if(storageObserved&&storageTouched){try{await page.goto(toolURL,{waitUntil:'load'});await ready();await settle();await page.evaluate(async({key,previous})=>{await writing;await new Promise((resolve,reject)=>{const tx=browserDb.transaction('copies','readwrite'),store=tx.objectStore('copies');if(previous)store.put(previous);else store.delete(key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});},{key:KEY,previous:originalStorage});result.preceding_browser_record_restored=true;}catch(e){result.restoration_error=String(e);result.state='FAILED';}}
    page.off('pageerror',recordError);result.page_errors=pageErrors;if(pageErrors.length)result.state='FAILED';
    await fs.writeFile(path.join(run,'receiving-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  }
  return result;
}
