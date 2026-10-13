#!/usr/bin/env node
// MIT. Continue the original private issuer receiving case through its browser.
import {mkdir,mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const HERE=dirname(fileURLToPath(import.meta.url)),sourceRoot=resolve(HERE,'../../../../../..'),
  sourceDirectory=resolve(HERE,'../..'),nativeCli=join(sourceDirectory,'cli.py'),execute=promisify(execFile);
const json=value=>JSON.stringify(value,null,2)+'\n',hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(value,message)=>{if(!value)throw new Error(message);};
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
async function save(path,value){await writeFile(path,typeof value==='string'||value instanceof Uint8Array?value:json(value),{flag:'wx',mode:0o600});return path;}
async function updateResult(path,value){
  const directory=await mkdtemp(join(dirname(path),'issuer-result-'));
  try{const pending=join(directory,'ISSUER_TERMS_RECEIVING.json');await save(pending,value);await rename(pending,path);}
  finally{await rm(directory,{recursive:true,force:true});}
}
async function native(workspace,args){
  try{
    // The existing Operations CLI opens an initialized original workspace.
    // Repeating init preserves its saved plans and original import request replay.
    if(args[0]==='import')await execute('python3',[nativeCli,'init','--workspace',workspace],
      {encoding:'utf8',maxBuffer:128*1024*1024});
    return JSON.parse((await execute('python3',[nativeCli,'operations','--workspace',workspace,...args],
      {encoding:'utf8',maxBuffer:128*1024*1024})).stdout);
  }catch(error){throw new Error(String(error.stderr||error.message));}
}
async function listener(workspace){
  const child=spawn('python3',[join(sourceDirectory,'server.py'),'--workspace',workspace,'--port','0'],
    {stdio:['ignore','pipe','pipe']});
  let stderr='',text='',timer;
  child.stderr.on('data',part=>{stderr+=part.toString();});
  const ready=await new Promise((done,reject)=>{
    let settled=false;
    const fail=error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);};
    child.once('error',fail);child.once('exit',code=>fail(new Error('Original listener exited '+code+': '+stderr)));
    timer=setTimeout(()=>{child.kill('SIGTERM');fail(new Error('The original listener did not announce its access file.'));},30000);
    child.stdout.on('data',part=>{text+=part.toString();if(settled||!text.includes('\n'))return;
      try{const value=JSON.parse(text.split('\n')[0]);settled=true;clearTimeout(timer);done(value);}catch(error){fail(error);}});
  });
  const token=(await readFile(join(workspace,'access.key'),'utf8')).trim(),url=ready.url.replace(/\/$/,'');
  return {url,token,async stop(){
    if(child.exitCode===null&&child.signalCode===null){
      const closed=new Promise(done=>child.once('exit',done));child.kill('SIGTERM');
      const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);await closed;clearTimeout(timeout);
    }
  }};
}
function browserLibrary(options){
  const require=createRequire(import.meta.url),paths=[sourceRoot,...(options.dependencyPaths||[]),
    process.env.PLAYWRIGHT_NODE_MODULES,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean);
  for(const name of ['playwright','playwright-core']){
    try{return require(require.resolve(name,{paths}));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
  }
  throw new Error('Use the installed Playwright browser runtime for this complete receiving flow.');
}
async function receiveBrowserDownload(workspace,file,termsId,originalSha,actor){
  const receipt=await native(workspace,['import','--file',file,'--name','Received complete browser issuer programme',
    '--actor',actor,'--request-id','issuer-browser-complete-receiving']);
  const current=await native(workspace,['show','--case',receipt.id]);
  const selected=await native(workspace,['award-terms-show','--case',receipt.id,'--terms',termsId,'--revision','3']);
  need(selected.history.length===3&&selected.commissioning.length===2,
    'The browser handover must receive all three terms editions and both native commissioning records.');
  need(selected.edition.document.stage==='INTEREST_ACKNOWLEDGED'&&selected.edition.document.proposalTrack==='OPEN'&&
    selected.edition.document.issuerTrack===null&&selected.edition.document.award===null,
    'The received issuer observation must retain the original acknowledgement and explicit proposal choice.');
  const fullIndex=await native(workspace,['award-terms','--case',receipt.id]);
  const correspondence=await native(workspace,['issuer-correspondence-show','--case',receipt.id,
    '--source',fullIndex.correspondence[0].sourceId]);
  need(correspondence.edition.inspection.original.sha256===originalSha,
    'The complete original correspondence identity must survive browser handover receiving.');
  const sourceId=correspondence.edition.selected.find(row=>row.path==='original')?.source.id;
  need(sourceId,'The retained original message source must reopen.');
  const rawProgram=[
    'import hashlib,json,sys',
    'from pathlib import Path',
    'sys.path.insert(0,sys.argv[1])',
    'from model import Workspace',
    'from operations import Operations',
    'w=Workspace(Path(sys.argv[2]),Path(sys.argv[1]).parent/"sf10_current_candidate.json")',
    'try:',
    '    metadata,raw=Operations(w).source(sys.argv[3],sys.argv[4])',
    '    print(json.dumps({"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}))',
    'finally:',
    '    w.close()',
  ].join('\n');
  // The original owner is opened only after each standalone CLI operation exits.
  const raw=JSON.parse((await execute('python3',['-c',rawProgram,sourceDirectory,workspace,receipt.id,sourceId],
    {encoding:'utf8',maxBuffer:1024*1024})).stdout);
  need(raw.sha256===originalSha,'The complete returned original message bytes must match the received email.');
  return {receipt,current,selected,originalSource:raw};
}
export async function resumeIssuerAwardTermsBrowser(directory,options={}){
  const root=resolve(directory),summaryPath=join(root,'ISSUER_TERMS_RECEIVING.json'),result=await readJson(summaryPath);
  need(result.schema==='stellar-forge.issuer-award-terms-operating-case.v1'&&result.status==='COMPLETE'&&result.wholeCaseReopenedTwice,
    'Continue the complete original native issuer receiving case.');
  if(result.browser?.status==='COMPLETE')return result;
  const attempt=await mkdtemp(join(root,'browser-review-')),workspace=join(attempt,'workspace'),
    receiving=join(attempt,'receiving'),actor=options.actor||'Grant Operations receiving operator';
  const restored=await native(workspace,['import','--file',join(root,'SCF_Issuer_Terms_Complete_Case.zip'),
    '--name','Browser review of the original issuer and delivery programme','--actor',actor,
    '--request-id','issuer-browser-original-case']);
  need(restored.selectedAwardTerms?.id===result.selection.termsId&&restored.selectedAwardTerms.revision===2,
    'Restore the same original selected issuer edition before the browser continuation.');
  await save(join(attempt,'restored-original-case.json'),restored);
  const library=browserLibrary(options),service=await listener(workspace);
  let browser,context,downloadPath,commissioned,finalCase,selected,sourceDownload;
  const errors=[],screenshots=[];
  try{
    browser=await library.chromium.launch({headless:true,
      ...(options.executablePath||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?
        {executablePath:options.executablePath||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),
      args:['--no-sandbox','--disable-dev-shm-usage']});
    context=await browser.newContext({viewport:{width:1365,height:980},acceptDownloads:true});
    const page=await context.newPage();page.setDefaultTimeout(30000);
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    const read=async suffix=>{
      const response=await fetch(service.url+'/api/operations/'+restored.id+suffix,
        {headers:{Authorization:'Bearer '+service.token}});
      need(response.ok,'The original issuer receiving read must return its selected native result.');
      return response.json();
    };
    const ready=async()=>{
      await page.waitForFunction(()=>document.querySelector('#workbench')?.getAttribute('aria-busy')==='false');
      const error=await page.locator('#message').evaluate(node=>node.dataset.error==='true'?node.textContent:null);
      need(!error,'Original browser operation: '+error);
      need(!errors.length,'Original browser module: '+errors.join('\n'));
    };
    const deskReady=async()=>{
      await page.locator('.award-terms-desk').waitFor();
      await page.waitForFunction(()=>document.querySelector('.award-terms-desk')?.getAttribute('aria-busy')==='false');
      const error=await page.locator('[data-terms-error]').textContent();
      need(!error?.trim(),'Issuer receiving browser: '+error);
      need(!errors.length,'Issuer browser module: '+errors.join('\n'));
    };
    const action=async(action,extra='')=>{
      await page.locator('[data-terms-action="'+action+'"]'+extra).first().click();
      await deskReady();
    };
    const openCase=async()=>{
      await page.locator('#plan-select').selectOption(restored.planId);await ready();
      await page.locator('[data-tab="operations"]').click();await ready();
      await page.locator('[name=caseSelect]').selectOption(restored.id);await ready();
      await page.locator('[name=recordingActor]').fill(actor);
      await page.locator('[data-ops-tab="award-terms"]').click();await deskReady();
    };
    const snapshot=async name=>{await page.screenshot({path:join(attempt,name),fullPage:true});screenshots.push(name);};
    await page.goto(service.url+'/#access='+encodeURIComponent(service.token),{waitUntil:'domcontentloaded'});
    await ready();await openCase();
    await action('open-terms','[data-revision="2"]');
    await action('tab','[data-tab="messages"]');
    await action('open-message');
    await page.getByText(result.originalMessage.messageId,{exact:false}).first().waitFor();
    await snapshot('issuer-original-correspondence.png');
    const [originalDownload]=await Promise.all([page.waitForEvent('download'),action('download-source')]);
    sourceDownload=join(attempt,'browser-original-message.eml');await originalDownload.saveAs(sourceDownload);
    const originalBytes=await readFile(sourceDownload);
    need(hash(originalBytes)===result.originalMessage.sha256&&originalBytes.length===result.originalMessage.bytes,
      'The original-message browser download must match the received source bytes.');
    await action('open-terms','[data-revision="2"]');
    await action('revise-terms');
    const draftNote='Reviewed the complete original acknowledgement, its selected public schedule and the retained Open Track proposal in the browser.';
    await page.locator('[data-path="draft.document.note"]').fill(draftNote);
    await page.locator('[data-path="termsNote"]').fill('Retain the reviewed original-message interpretation and public schedule.');
    await action('tab','[data-tab="history"]');
    await page.reload({waitUntil:'domcontentloaded'});await ready();await openCase();
    await action('tab','[data-tab="terms"]');
    need(await page.locator('[data-path="draft.document.note"]').inputValue()===draftNote,
      'The complete local interpretation draft must reopen before its native save.');
    await action('preview-terms');await snapshot('issuer-terms-reviewed-comparison.png');
    const [termResponse]=await Promise.all([
      page.waitForResponse(r=>r.url().endsWith('/api/operations/'+restored.id+'/command')&&
        r.request().method()==='POST'&&r.request().postDataJSON()?.action==='award-terms.save'),
      action('save-terms')]);
    need(termResponse.ok(),'The original browser must save the complete third issuer edition.');
    const savedTerms=await termResponse.json();
    need(savedTerms.awardTerms?.revision===3,'The browser review must create the third original edition.');
    await deskReady();await action('open-terms','[data-revision="3"]');
    await action('seed-plan');
    await page.locator('[data-path="planInputs.reason"]').fill('Commission the complete reviewed proposal and retained original issuer sources.');
    const planningNotes=page.locator('[data-path="planInputs.planning.notes"]');
    await planningNotes.fill((await planningNotes.inputValue())+'\nBrowser review retained the same acknowledged application stage and all six original work packages.');
    await action('preview-plan');
    await page.getByRole('heading',{name:'Complete reviewed plan',exact:true}).waitFor();
    await snapshot('issuer-native-plan-review.png');
    await page.locator('[data-path="reviewStatement"]').fill('Reviewed the complete source interpretation, unchanged requested amount, original work packages and native proposal calculation.');
    await page.locator('[data-path="commissionNote"]').fill('Save this reviewed proposal plan and its complete original issuer association.');
    await page.locator('[data-apply-plan]').check();
    const [planResponse]=await Promise.all([
      page.waitForResponse(r=>r.url().endsWith('/api/operations/'+restored.id+'/award-terms-commission')&&r.request().method()==='POST'),
      action('commission-plan')]);
    need(planResponse.ok(),'The browser must commit the complete original planner and amendment operation.');
    commissioned=await planResponse.json();await deskReady();
    finalCase=await read('');selected=await read('/award-terms/'+result.selection.termsId+'?revision=3');
    need(selected.edition.document.stage==='INTEREST_ACKNOWLEDGED'&&selected.edition.document.award===null&&
      selected.edition.document.issuerTrack===null&&selected.edition.document.proposalTrack==='OPEN',
      'The original observation and explicit proposal selection must remain unchanged through browser commissioning.');
    need(selected.history.length===3&&selected.commissioning.length===2&&
      finalCase.program.planRevision===commissioned.planRevision,
      'The complete native plan and both retained commissioning records must be current in the same case.');
    await action('open-terms','[data-revision="3"]');
    const [handover]=await Promise.all([page.waitForEvent('download'),action('export-case')]);
    downloadPath=join(attempt,'SCF_Issuer_Terms_Browser_Received_Case.zip');await handover.saveAs(downloadPath);
    await save(join(attempt,'browser-commissioning.json'),commissioned);
    await save(join(attempt,'browser-complete-case.json'),finalCase);
    await save(join(attempt,'browser-selected-terms.json'),selected);
    await page.reload({waitUntil:'domcontentloaded'});await ready();await openCase();
    await action('open-terms','[data-revision="3"]');
    await page.setViewportSize({width:390,height:844});await snapshot('issuer-reopened-phone.png');
    const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    need(overflow.document<=overflow.viewport+1,'The complete issuer page must fit the phone viewport with tables scrolling inside their own panels.');
    result.browser={status:'BROWSER_COMPLETE',caseId:restored.id,planId:restored.planId,
      termsRevision:3,planRevision:commissioned.planRevision,caseVersion:finalCase.program.version,
      draftReopened:true,originalMessageDownloaded:true,selectedEditionReopened:true,
      viewports:[{width:1365,height:980},{width:390,height:844}],overflow,pageErrors:errors,screenshots,
      outputDirectory:relative(root,attempt),handover:{path:relative(root,downloadPath),
        bytes:(await readFile(downloadPath)).length,sha256:hash(await readFile(downloadPath))}};
    await updateResult(summaryPath,result);
  }finally{await context?.close();await browser?.close();await service.stop();}
  const reopened=await receiveBrowserDownload(receiving,downloadPath,result.selection.termsId,result.originalMessage.sha256,actor);
  await save(join(attempt,'browser-handover-receiving.json'),reopened);
  result.browser.status='COMPLETE';result.browser.handoverReopened=true;
  result.browser.receiving={caseId:reopened.receipt.id,planId:reopened.receipt.planId,version:reopened.receipt.version,
    termsRevision:reopened.selected.edition.revision,originalSource:reopened.originalSource};
  await updateResult(summaryPath,result);
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]||process.argv[2]==='--help')process.stdout.write(
    'node receive-issuer-award-terms.mjs COMPLETE_PRIVATE_NATIVE_CASE_DIRECTORY --resume-browser\n'+
    'Opens the saved original case, reviews correspondence and terms, commissions the original native plan, downloads and receives the full handover.\n');
  else{
    need(process.argv.length===4&&process.argv[3]==='--resume-browser',
      'Use the complete private native output directory and --resume-browser.');
    resumeIssuerAwardTermsBrowser(process.argv[2]).then(value=>process.stdout.write(json(value)))
      .catch(error=>{process.stderr.write(json({error:{message:error.message,code:error.code}}));process.exitCode=1;});
  }
}
