import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const CONFIG={
  milestage:{title:'MileStage',tool:'MileStage_Project_Qualification_Worksheet.html',toolSha:'ee090e0bef49d86196709e4ab276e2d29e47648c8f7705c1939779226bc7ba3c',
    profile:['MileStage_Free_CLH_Sample.html','MileStage_Five_Additional_Profiles.html'],project:'Selected project',owner:'Review owner'},
  glassdart:{title:'Glassdart',tool:'Glassdart_Website_Launch_Brief.html',toolSha:'984b443610e107e8024249a9bdd78c4083626e37dbcd2716d9621e9e29d7a13a',
    profile:['Glassdart_Free_Hart_Sample.html','Glassdart_Five_Additional_Profiles.html'],project:'Proposed website',owner:'Scope and approval owner'}
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const neutral=value=>{const next=structuredClone(value);delete next.updated_at;return next;};
async function identity(file){
  const stat=await fs.lstat(file);need(stat.isFile()&&!stat.isSymbolicLink(),'Read an ordinary complete source/output: '+file);
  const bytes=await fs.readFile(file);return {path:file,bytes:bytes.length,sha256:sha(bytes)};
}

/** Uses only the caller's browser/context. Each course operates a new downloaded
 * complete working copy, leaving the original customer file/browser copy intact. */
export async function runRevenueToolReceiving({page,context,outputDirectory,sourceDirectory,company}){
  const config=CONFIG[company];need(config&&page.context()===context,'Select the matching tool and caller-owned browser context.');
  const source=path.resolve(sourceDirectory),run=path.join(path.resolve(outputDirectory),company+'-working-tools',randomUUID());
  await fs.mkdir(run,{recursive:true});
  const result={schema:'commons.revenue-working-tools-browser.v1',company,started_at:new Date().toISOString(),
    state:'RUNNING',sources:[],files:[],screens:[],steps:[],page_errors:[],run_directory:run,
    input_scope:'Entered values are isolated receiving examples; original lead/company source and commercial records remain unchanged.'};
  const tabs=new Set(),watched=new Set();let stage='source';let work=null;
  const onError=error=>result.page_errors.push(String(error));
  function watch(target){if(!watched.has(target)){watched.add(target);target.on('pageerror',onError);}}
  async function retained(name,bytes){const file=path.join(run,name);await fs.writeFile(file,bytes,{flag:'wx'});const pin=await identity(file);result.files.push(pin);return file;}
  async function download(target,selector,name){
    const [item]=await Promise.all([target.waitForEvent('download'),target.locator(selector).click()]);
    const failure=await item.failure();need(!failure,'Complete browser download failed: '+failure);
    const file=path.join(run,name);await item.saveAs(file);const pin={...await identity(file),browser_filename:item.suggestedFilename()};result.files.push(pin);return file;
  }
  async function open(file){
    const target=await context.newPage();tabs.add(target);watch(target);
    await target.goto(pathToFileURL(file).href,{waitUntil:'load'});
    await target.locator('#working-html:not([disabled])').waitFor();
    return target;
  }
  async function settle(target){
    // Observe the application's actual pending browser transaction; no function or state is replaced.
    return target.evaluate(async()=>{await writing;return {revision:browserRevision,blocked:browserBlocked};});
  }
  async function capture(target,label,width,height){
    await target.setViewportSize({width,height});
    const layout=await target.evaluate(()=>({width:innerWidth,height:innerHeight,document_width:document.documentElement.scrollWidth,
      body_width:document.body.scrollWidth,title:document.title}));
    need(layout.document_width<=width+1&&layout.body_width<=width+1,'Visible horizontal overflow in '+label+' at '+width+'px.');
    const file=path.join(run,label+'-'+width+'.png');await target.screenshot({path:file,fullPage:true});
    const pin=await identity(file);result.screens.push({...pin,layout});result.files.push(pin);
  }
  async function views(target,label){for(const width of [1440,390,320])await capture(target,label,width,width===1440?1000:844);await target.setViewportSize({width:1440,height:1000});}
  async function begin(name){stage=name;result.steps.push({step:name,started_at:new Date().toISOString()});}
  function done(){result.steps.at(-1).completed_at=new Date().toISOString();}
  async function book(target,name){const file=await download(target,'#save',name);return {file,value:JSON.parse(await fs.readFile(file,'utf8'))};}
  async function reopen(target,file,beforeName){
    const [before]=await Promise.all([target.waitForEvent('download'),target.locator('#open').setInputFiles(file)]);
    const saved=path.join(run,beforeName);await before.saveAs(saved);result.files.push(await identity(saved));
    await settle(target);return JSON.parse(await fs.readFile(saved,'utf8'));
  }
  try{
    watch(page);
    const tool=path.join(source,config.tool),toolPin=await identity(tool);need(toolPin.sha256===config.toolSha,'Select the exact current full customer tool.');result.sources.push(toolPin);
    await begin('complete-profile-documents');
    for(const filename of config.profile){
      const file=path.join(source,filename);result.sources.push(await identity(file));
      await page.goto(pathToFileURL(file).href,{waitUntil:'load'});await page.locator('body').waitFor();
      await views(page,filename.replace('.html',''));
      await page.emulateMedia({media:'print'});await capture(page,filename.replace('.html','')+'-print',1440,1000);await page.emulateMedia({media:'screen'});
    }
    done();
    await begin('independent-complete-working-copy');
    await page.goto(pathToFileURL(tool).href,{waitUntil:'load'});await page.locator('#working-html:not([disabled])').waitFor();
    const original=await book(page,'00-original-displayed.json');
    const working=await download(page,'#working-html','01-independent-working.html');
    work=await open(working);
    const reopenedOriginal=await book(work,'02-independent-original.json');
    need(JSON.stringify(neutral(original.value))===JSON.stringify(neutral(reopenedOriginal.value)),'Independent working HTML lost original fields/source.');
    await views(work,'original-working-copy');done();
    await begin('unfinished-writing-and-editable-items');
    await work.getByLabel(config.project,{exact:true}).fill('Receiving — full writing and source continuity');
    await work.getByLabel(config.owner,{exact:true}).fill('Receiving operator');
    if(company==='milestage'){
      await work.locator('#total').fill('.');await settle(work);
      const draft=await book(work,'03-unfinished-draft.json');need(draft.value.total==='.'&&draft.value.stages.length===original.value.stages.length,'Unfinished fee or original checkpoints were lost.');
      await work.locator('#tab-checkpoints').click();await work.locator('#stages details').first().getByLabel('Checkpoint',{exact:true}).fill('');
      await settle(work);const empty=await book(work,'04-unfinished-title.json');need(empty.value.stages[0].name==='','Empty current title was lost.');
      await views(work,'unfinished-checkpoint');
      await work.locator('#stages details').first().getByLabel('Checkpoint',{exact:true}).fill('Receiving checkpoint A');
      await work.locator('#stages details').first().getByLabel('Approval evidence / owner',{exact:true}).fill('Receiving-only approval reference — original payment evidence remains separately named.');
      await work.locator('#add').click();const last=work.locator('#stages details').last();await last.locator('summary').click();
      await last.getByLabel('Checkpoint',{exact:true}).fill('Receiving checkpoint Ω');
      await last.getByLabel('Deliverable',{exact:true}).fill('=Literal receiving text');
      await last.getByLabel('Review state',{exact:true}).selectOption('Needs clarification');
      await last.getByRole('button',{name:'Move up',exact:true}).click();
      await work.locator('#tab-project').click();await work.locator('#total').fill('3900.00');
      await work.locator('#tab-checkpoints').click();await settle(work);
      need((await work.locator('#totals').innerText()).includes('100.00 remaining'),'Allocation difference does not follow edited total.');
    }else{
      await work.getByLabel('Agreed quote / payment terms',{exact:true}).fill('Unfinished receiving-only quote …');
      await work.getByLabel('Other complete working notes',{exact:true}).fill('Receiving-only Unicode notes Ω. No customer launch or agreed quote is asserted.');
      await work.locator('#tab-content').click();const first=work.locator('#sections details').first();
      await first.getByLabel('Page / section',{exact:true}).fill('');await settle(work);
      const empty=await book(work,'03-unfinished-draft.json');need(empty.value.sections[0].name===''&&empty.value.quote.includes('Unfinished'),'Unfinished section or quote was lost.');
      await views(work,'unfinished-content');
      await first.getByLabel('Page / section',{exact:true}).fill('Receiving content A');
      await first.getByLabel('Approved copy / decision',{exact:true}).fill('Receiving-only review of complete retained content.');
      await first.getByLabel('Review state',{exact:true}).selectOption('Needs clarification');
      await work.locator('#add-sections').click();const last=work.locator('#sections details').last();await last.locator('summary').click();
      await last.getByLabel('Page / section',{exact:true}).fill('Receiving content Ω');
      await last.getByLabel('Proposed copy',{exact:true}).fill('=Literal receiving text');
      await last.getByRole('button',{name:'Move up',exact:true}).click();
      await work.locator('#tab-launch').click();const task=work.locator('#tasks details').first();
      await task.getByLabel('Responsible person',{exact:true}).fill('Receiving operator');
      await task.getByLabel('Decision / result / reference',{exact:true}).fill('Receiving-only check of original editable handover.');
      await task.getByLabel('Review state',{exact:true}).selectOption('In progress');await settle(work);
    }
    await views(work,'edited-items');
    const edited=await book(work,'05-complete-edited.json');
    const initialRows=company==='milestage'?original.value.stages:original.value.sections,editedRows=company==='milestage'?edited.value.stages:edited.value.sections;
    need(editedRows.length===initialRows.length+1&&initialRows.every(row=>editedRows.some(x=>x.id===row.id)),'Editing/moving lost an original item identity.');
    done();
    await begin('full-download-print-and-cold-reopen');
    const csv=await download(work,'#csv','06-complete-register.csv'),notes=await download(work,'#report','07-complete-notes.md');
    need((await fs.readFile(csv,'utf8')).includes("'=Literal receiving text"),'CSV did not preserve formula-like text safely.');
    need((await fs.readFile(notes,'utf8')).includes('Receiving'),'Full notes lost the edited content.');
    const portable=await download(work,'#working-html','08-complete-working.html');
    const cold=await open(portable),coldBook=await book(cold,'09-cold-working.json');
    need(JSON.stringify(neutral(coldBook.value))===JSON.stringify(neutral(edited.value)),'Cold working HTML changed the complete current record.');
    const before=await reopen(cold,edited.file,'10-before-json-reopen.json');
    need(JSON.stringify(neutral(before))===JSON.stringify(neutral(edited.value)),'Reopen did not preserve the previous displayed copy.');
    const jsonRoundtrip=await book(cold,'11-cold-json.json');need(JSON.stringify(neutral(jsonRoundtrip.value))===JSON.stringify(neutral(edited.value)),'Cold JSON reopened different data.');
    await views(cold,'cold-reopened-working');
    const pdf=path.join(run,'12-complete-print.pdf');await cold.pdf({path:pdf,format:'A4',printBackground:true});result.files.push(await identity(pdf));
    await cold.emulateMedia({media:'print'});await capture(cold,'complete-print',1440,1000);await cold.emulateMedia({media:'screen'});
    done();
    await begin('competing-tabs-retain-both-writers');
    const other=await open(portable);await settle(cold);await settle(other);
    await cold.locator('#tab-project').click();await other.locator('#tab-project').click();
    await cold.getByLabel(config.owner,{exact:true}).fill('First receiving writer');const firstWrite=await settle(cold);need(!firstWrite.blocked,'The first isolated writer could not save.');
    await other.getByLabel(config.owner,{exact:true}).fill('Second receiving writer');const secondWrite=await settle(other);
    need(secondWrite.blocked&&await other.locator('#recovery').isVisible(),'Competing saved revision did not retain both writers.');
    const currentSecond=await book(other,'13-competing-displayed.json'),savedFirst=await download(other,'#recover','14-preserved-first-writer.json');
    need(currentSecond.value.owner==='Second receiving writer'&&JSON.parse(await fs.readFile(savedFirst,'utf8')).owner==='First receiving writer','Competing writer data was overwritten.');
    await views(other,'competing-writers');
    done();
    await begin('invalid-input-retains-writing');
    const invalid=structuredClone(edited.value);invalid.schema='unrelated.receiving.example';
    const invalidFile=await retained('15-rejected-input.json',JSON.stringify(invalid,null,2)+'\n');
    await cold.locator('#open').setInputFiles(invalidFile);
    await cold.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Choose a'));
    const after=await book(cold,'16-after-rejected-input.json');need(after.value.owner==='First receiving writer','Invalid incoming JSON changed the saved working copy.');
    await views(cold,'rejected-input-retained');done();
    need(result.page_errors.length===0,'The actual browser reported an application error.');
    result.state='COMPLETE';result.completed_at=new Date().toISOString();
  }catch(error){
    result.state='FAILED';result.failed_stage=stage;result.error={name:error.name,message:error.message};
    try{await capture(work||page,'failure-'+stage,1440,1000);}catch(captureError){result.capture_error=String(captureError);}
  }finally{
    for(const target of watched)target.off('pageerror',onError);
    for(const target of tabs){try{await target.close();}catch{}}
    result.finished_at=new Date().toISOString();
    const output=path.join(run,'receiving-result.json');await fs.writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});result.result=await identity(output);
  }
  return result;
}
export const runMileStageReceiving=options=>runRevenueToolReceiving({...options,company:'milestage'});
export const runGlassdartReceiving=options=>runRevenueToolReceiving({...options,company:'glassdart'});
