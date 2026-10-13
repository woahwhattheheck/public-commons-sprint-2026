import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const EXPECTED={
  'Tweak_Free_Upgraded_Sample.html':'1b2e2bd21d5abbf14e6c6cc3b168f5af3bf4642d3c431f912dab564fe61b8a55',
  'Tweak_Free_Upgraded_Sample.csv':'7a883020eb2148072db229c272e0300ff19e5bedc0bb78f04254d52bb0e3b57f',
  'Tweak_Free_Upgraded_Sample.json':'61002e229bc824585ab5021a0e9453a2ce54b5f2d4a2f466905f000f694ec77d',
  'Tweak_Five_Additional_Profiles.html':'e9a5739972f45ae960931c6b5c4411c621c011dbe5a2416434471f2fd2488b9b',
  'Tweak_Five_Additional_Profiles.csv':'04b58dc1889bc4aa5169a829c70d3d7c8e662441a0fd9ae3581aad1dd8383e4c',
  'Tweak_Five_Additional_Profiles.json':'7a30ca52cf4bd28ec32ca42caa965e11091fa233135a28c66dc1b1608762c11d',
  'Tweak_Review_Pilot_Workspace.html':'892ac067df6c8b48e3e906e1793c497678b7e23b1d8f52356329c88e6147cfe9'
};
const KEY='tjlabs-tweak-pilot-v1';
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
export async function runTweakReceiving({page,context,outputDirectory,sourceDirectory}){
  need(page&&context&&page.context()===context,'Supply the existing same receiving page/context.');
  const sourceRoot=path.resolve(sourceDirectory),outRoot=path.resolve(outputDirectory);
  const run=path.join(outRoot,'tweak-pilot',randomUUID());
  await fs.mkdir(run,{recursive:true});
  const result={schema:'tjlabs.tweak-pilot-receiving.v1',operation:'TWEAK-AGENCY-PILOT-PROSPECTS-SCOUT-20261013',
    started_at:new Date().toISOString(),run_directory:run,state:'RUNNING',source:[],outputs:[],screens:[],stages:[],
    receiving_data:'All entered project/comment values are isolated receiving examples. Agency source context stays unchanged; no agency pilot result is asserted.'};
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
    const [download]=await Promise.all([target.waitForEvent('download'),target.locator(selector).click()]);need(!await download.failure(),'Browser download failed.');
    const file=path.join(run,retainedName);await download.saveAs(file);
    const identity={...await actualFile(file),browser_filename:download.suggestedFilename()};
    result.outputs.push(identity);return file;
  }
  async function confirmAction(action,target=page){
    await Promise.all([target.waitForEvent('dialog').then(dialog=>dialog.accept()),action()]);
  }
  async function openWorkbook(file,target=page){
    await confirmAction(()=>target.locator('#open').setInputFiles(file),target);
    await target.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Reopened '));
  }
  async function begin(name){stage=name;result.stages.push({name,started_at:new Date().toISOString()});}
  async function done(){result.stages.at(-1).completed_at=new Date().toISOString();}
  async function independentTab(url){const p=await context.newPage();ownedTabs.add(p);p.on('pageerror',recordError);await p.goto(url,{waitUntil:'load'});return p;}
  async function closeOwned(p){if(ownedTabs.delete(p))await p.close();}
  const toolURL=pathToFileURL(path.join(sourceRoot,'Tweak_Review_Pilot_Workspace.html')).href;
  try{
    for(const [name,sha256]of Object.entries(EXPECTED)){
      const file=path.join(sourceRoot,name),st=await fs.lstat(file);
      need(st.isFile()&&!st.isSymbolicLink(),'Source must be a retained regular file: '+name);
      const identity=await actualFile(file);need(identity.sha256===sha256,'Original source differs: '+name);result.source.push(identity);
    }
    await begin('complete-original-profiles');
    for(const name of ['Tweak_Free_Upgraded_Sample.html','Tweak_Five_Additional_Profiles.html']){
      await page.goto(pathToFileURL(path.join(sourceRoot,name)).href,{waitUntil:'load'});
      await page.locator('article').first().waitFor();
      await capture(page,name.replace('.html',''));
      await page.emulateMedia({media:'print'});
      await screen(page,name.replace('.html','')+'-print',1440);
      await page.emulateMedia({media:'screen'});
    }
    for(const name of Object.keys(EXPECTED).filter(n=>/\.(csv|json)$/.test(n))){
      const bytes=await fs.readFile(path.join(sourceRoot,name));if(name.endsWith('.json'))JSON.parse(bytes.toString('utf8'));
      await retain('opened-'+name,bytes);
    }
    await done();
    await begin('plan-and-unfinished-draft');
    await page.goto(toolURL,{waitUntil:'load'});
    originalStorage=await page.evaluate(key=>localStorage.getItem(key),KEY);storageObserved=true;
    if(originalStorage!==null)await retain('preceding-browser-record.json',originalStorage);
    storageTouched=true;await confirmAction(()=>page.locator('[data-act="reset"]').click());
    await page.locator('#f-project').fill('Receiving exercise — source and draft continuity');
    await page.locator('#f-decision_maker').fill('Receiving operator');
    await page.locator('#f-developer').fill('Receiving developer');
    await page.locator('#f-scope').fill('Receiving-only home and contact page review. Original Upgraded source remains retained.');
    await page.locator('#f-goal').fill('Operate the saved customer tool and its complete exports.');
    await page.locator('#f-pilot_fee').fill('.');
    await page.locator('#f-commercial_note').fill('Unfinished receiving-only fee. No proposed agency agreement or charge.');
    await capture(page,'pilot-plan');
    const first=await clickDownload('[data-act="save"]','01-unfinished-workbook.json');
    const firstBook=JSON.parse(await fs.readFile(first,'utf8'));
    need(firstBook.cases[0].pilot_fee==='.'&&firstBook.cases[0].commercial_note.includes('Unfinished'),'Unfinished writing was not retained.');
    await done();
    await begin('requests-snapshots-and-change');
    await page.locator('[data-act="tab"][data-id="requests"]').click();
    await page.locator('[data-round-field="owner"]').first().fill('Receiving operator');
    await page.locator('[data-act="newrequest"]').first().click();
    const input=async(field,value)=>page.locator('[data-request-field="'+field+'"]').fill(value);
    await input('title','Receiving comment A');
    await input('page_url','https://example.org/receiving-home');
    await input('element','Receiving-only home heading');
    await input('original_ref','Receiving-only original comment A');
    await input('change','First retained wording');
    await input('criterion','Receiving operator can read the intended heading');
    await input('owner','Receiving developer');
    await page.locator('[data-request-field="category"]').selectOption('Included fix');
    await input('implementation','Receiving-only changed build reference');
    await input('verification','Receiving operator inspected this isolated example');
    await page.locator('[data-request-field="state"]').selectOption('Verified');
    await confirmAction(()=>page.locator('[data-act="snapshot"]').first().click());
    await page.locator('[data-act="selectrequest"]').first().click();
    await input('change','Revised wording after the retained snapshot');
    need(await page.locator('[data-request-field="state"]').inputValue()==='Open','Changing verified work did not reopen it.');
    await page.locator('[data-act="newround"]').click();
    await page.locator('[data-act="newrequest"]').last().click();
    await input('title','Receiving comment B');
    await input('page_url','https://example.org/receiving-contact');
    await input('change','=Receiving-only literal request text');
    await input('criterion','Complete selected-case export keeps this request when filtered from view');
    await page.locator('[data-request-field="category"]').selectOption('Scope change');
    await input('verification','Receiving-only decision: qualify added scope before any quote');
    await capture(page,'pilot-requests');
    await page.locator('summary').filter({hasText:'Retained round snapshots'}).click();
    const snapshot=await clickDownload('[data-act="snapshotjson"]','02-original-round.json');
    const snapshotData=JSON.parse(await fs.readFile(snapshot,'utf8'));
    need(snapshotData.snapshot.requests.length===1&&snapshotData.snapshot.requests[0].change==='First retained wording'&&snapshotData.snapshot.requests[0].state==='Verified','The original snapshot changed after current editing.');
    await done();
    await begin('outcome-and-whole-exports');
    await page.locator('[data-act="tab"][data-id="outcome"]').click();
    await page.locator('#f-baseline_context').fill('No agency pilot has run; actual business observations remain empty in this receiving copy.');
    await page.locator('#f-actual_outcome').fill('The recipient controls are being operated. This receiving exercise supplies no customer outcome.');
    need((await page.locator('#comparison').innerText()).includes('Enter actual observations'),'Blank outcomes produced a comparison.');
    await capture(page,'pilot-outcome');
    await page.locator('[data-act="tab"][data-id="requests"]').click();
    await page.locator('#search').fill('Receiving comment A');
    const csvFile=await clickDownload('[data-act="csv"]','03-all-requests.csv');
    const csvText=await fs.readFile(csvFile,'utf8');
    need(csvText.includes('Receiving comment A')&&csvText.includes('Receiving comment B')&&csvText.includes("'=Receiving-only"),'Complete CSV lost hidden rows or spreadsheet escaping.');
    const reportFile=await clickDownload('[data-act="report"]','04-full-handover.html');
    const report=await fs.readFile(reportFile,'utf8');
    need(report.includes('First retained wording')&&report.includes('Revised wording after the retained snapshot')&&report.includes('Receiving comment B'),'Full handover lost current/original/filtered requests.');
    const finalFile=await clickDownload('[data-act="save"]','05-complete-workbook.json');
    const finalBook=JSON.parse(await fs.readFile(finalFile,'utf8'));
    need(finalBook.cases[0].requests.length===2&&finalBook.cases[0].snapshots.length===1,'Saved complete workbook differs.');
    const handoverTab=await independentTab(pathToFileURL(reportFile).href);
    await capture(handoverTab,'downloaded-handover');await closeOwned(handoverTab);
    await done();
    await begin('fresh-page-json-reopen');
    const restored=await independentTab(toolURL);
    await openWorkbook(finalFile,restored);
    need(await restored.locator('#f-pilot_fee').inputValue()==='.'&&await restored.locator('#f-project').inputValue()===finalBook.cases[0].project,'Fresh-page reopen lost unfinished planning.');
    await restored.locator('[data-act="tab"][data-id="requests"]').click();
    await capture(restored,'reopened-requests');
    const returnedFile=await clickDownload('[data-act="save"]','06-reopened-workbook.json',restored);
    const returned=JSON.parse(await fs.readFile(returnedFile,'utf8'));
    need(JSON.stringify(neutralCase(returned))===JSON.stringify(neutralCase(finalBook)),'Reopening altered original source, requests or snapshots.');
    await closeOwned(restored);await done();

    await begin('large-writing-recovery');
    // One valid, retained receiving input exercises the actual size boundary by
    // ordinary import and three user snapshot clicks. No app function is replaced.
    const large=structuredClone(finalBook),c=large.cases[0],r=c.requests[0];
    large.selected=c.id;c.snapshots=[];c.requests=[];
    const note='Receiving-only retained writing. '.repeat(312).slice(0,10000);
    for(let i=0;i<250;i++)c.requests.push({...structuredClone(r),id:'receiving-large-'+i,title:'Retained writing '+i,round_id:c.rounds[0].id,change:note,criterion:note,verification:note});
    const second=structuredClone(c);second.id=randomUUID();second.project='Second retained receiving case';second.requests=second.requests.map(r=>({...r,id:r.id+'-second'}));large.cases=[c,second];
    const largeBody=JSON.stringify(large,null,2);
    need(Buffer.byteLength(largeBody)<32*1024*1024,'Selected recovery input exceeds normal import budget.');
    const largeInput=await retain('07-recovery-input.json',largeBody);
    await openWorkbook(largeInput);
    await page.locator('[data-act="tab"][data-id="requests"]').click();
    await confirmAction(()=>page.locator('[data-act="snapshot"]').first().click());
    await confirmAction(()=>page.locator('[data-act="snapshot"]').first().click());
    await confirmAction(()=>page.locator('[data-act="snapshot"]').first().click());
    await page.locator('#oversize:not(.hidden)').waitFor();
    await screen(page,'retained-over-limit-writing-mobile',390,844);
    const recoveryFile=await clickDownload('[data-act="rawrecovery"]','08-complete-raw-recovery.json');
    const recoveryBytes=await fs.readFile(recoveryFile),recovery=JSON.parse(recoveryBytes.toString('utf8'));
    need(recoveryBytes.length>32*1024*1024&&recovery.cases.length===2&&recovery.cases[0].requests.length===250&&recovery.cases[0].snapshots.length===3,'Raw recovery is incomplete.');
    need(recovery.cases[0].requests[249].change===note&&recovery.cases[0].snapshots[2].requests[249].verification===note,'Over-limit writing was lost.');
    const oneCase=await clickDownload('[data-act="savecase"]','09-selected-case-workbook.json');
    const selected=JSON.parse(await fs.readFile(oneCase,'utf8'));
    need(selected.cases.length===1&&selected.cases[0].snapshots.length===3,'Selected-case export differs.');
    await openWorkbook(oneCase);await screen(page,'split-case-reopened-mobile',390,844);
    await openWorkbook(finalFile);
    await page.reload({waitUntil:'load'});
    await capture(page,'final-restored-plan');
    await done();
    need(pageErrors.length===0,'Browser page errors: '+pageErrors.join('; '));
    result.state='COMPLETE';result.completed_at=new Date().toISOString();
  }catch(error){
    result.state='FAILED';result.failed_stage=stage;result.error={name:error.name,message:error.message};
    result.finished_at=new Date().toISOString();
    try{await screen(page,'failure-'+stage,1440);}catch(screenError){result.failure_capture_error=String(screenError);}
  }finally{
    for(const tab of ownedTabs){try{await tab.close();}catch{}}
    if(storageObserved&&storageTouched){
      try{await page.goto(toolURL,{waitUntil:'load'});await page.evaluate(({key,previous})=>{if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous);},{key:KEY,previous:originalStorage});result.preceding_browser_record_restored=true;}
      catch(error){result.restoration_error=String(error);result.state='FAILED';}
    }
    page.off('pageerror',recordError);
    result.page_errors=pageErrors;if(pageErrors.length)result.state='FAILED';
    await fs.writeFile(path.join(run,'receiving-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  }
  return result;
}
