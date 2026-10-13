#!/usr/bin/env node
// MIT. One complete native saved-plan → editable workbook → receiving programme.
import {mkdir,mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {runPlanningSourceTables} from '../../source-tables-cli.mjs';
import {
  ROLES,importPlanningBook,serializePlanningBook,retainPlanningTableReview,
  rebasePlanningBook,preparePlanningImport,sourceEditionComparison,
} from '../../source-tables-core.mjs';
import {defaultPlanningWorkbookProfile,defaultPlanningWorkbookReturnProfile,
  createPlanningWorkbookArchive} from '../../source-workbook-export.mjs';
import {receivePlanningFile} from '../../../../../../stellar-forge/developer-site/dist/grant-plan-source.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),sourceRoot=resolve(HERE,'../../../../../..'),
  nativeCli=resolve(HERE,'../../cli.py'),execute=promisify(execFile);
const json=value=>JSON.stringify(value,null,2)+'\n',hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(value,message)=>{if(!value)throw new Error(message);};
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
async function save(path,value){await writeFile(path,typeof value==='string'||value instanceof Uint8Array?value:json(value),{flag:'wx',mode:0o600});return path;}
async function saveReceivingSummary(path,value){
  const directory=await mkdtemp(join(dirname(path),'workbook-result-'));
  const pending=join(directory,'WORKBOOK_HANDOVER_RECEIVING.json');
  try{
    // Complete the private new file before replacing the original native result.
    // Both paths share its filesystem, so an interrupted write keeps that result.
    await save(pending,value);
    await rename(pending,path);
  }finally{await rm(directory,{recursive:true,force:true});}
}
async function native(args){
  try{return JSON.parse((await execute('python3',[nativeCli,...args],{encoding:'utf8',maxBuffer:128*1024*1024})).stdout);}
  catch(error){throw new Error(String(error.stderr||error.message));}
}
const EDIT_WORKBOOK=String.raw`
import json,sys,zipfile
from decimal import Decimal
from xml.etree import ElementTree as ET
NS="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
ET.register_namespace("",NS)
def tag(name):return "{"+NS+"}"+name
plan=json.load(open(sys.argv[3],encoding="utf-8"))
packages=plan["scenario"]["future_costs"]
def cell(row,ref,value,numeric=False):
    item=ET.SubElement(row,tag("c"),{"r":ref,"s":"3" if numeric else "2"})
    if numeric:ET.SubElement(item,tag("v")).text=str(value)
    else:
        item.set("t","inlineStr")
        node=ET.SubElement(ET.SubElement(item,tag("is")),tag("t"))
        node.set("{http://www.w3.org/XML/1998/namespace}space","preserve");node.text=str(value)
def tables(raw,rows):
    root=ET.fromstring(raw);data=root.find(tag("sheetData"))
    for row in list(data)[1:]:data.remove(row)
    for number,values in enumerate(rows,2):
        row=ET.SubElement(data,tag("row"),{"r":str(number)})
        for column,(value,numeric) in enumerate(values,1):cell(row,chr(64+column)+str(number),value,numeric)
    end=chr(64+len(rows[0]))+str(len(rows)+1)
    root.find(tag("dimension")).set("ref","A1:"+end)
    root.find(tag("autoFilter")).set("ref","A1:"+end)
    return ET.tostring(root,encoding="utf-8",xml_declaration=True)
with zipfile.ZipFile(sys.argv[1]) as original,zipfile.ZipFile(sys.argv[2],"x",zipfile.ZIP_STORED) as output:
    for item in original.infolist():
        raw=original.read(item.filename)
        if item.filename=="xl/worksheets/sheet1.xml":
            root=ET.fromstring(raw)
            by_ref={cell.get("r"):cell for cell in root.iter(tag("c"))}
            hours=Decimal(str(packages[0]["estimated_hours"]))+Decimal(1)
            amount=Decimal(str(packages[0]["amount_usd"]))+Decimal(str(packages[0]["assumed_hourly_rate_usd"]))
            by_ref["E2"].find(tag("v")).text=str(hours)
            by_ref["G2"].find(tag("v")).text=str(amount)
            raw=ET.tostring(root,encoding="utf-8",xml_declaration=True)
        elif item.filename=="xl/worksheets/sheet3.xml":
            raw=tables(raw,[[("delivery-owner",False),("Example delivery owner",False),("40",True),
                ("Operator-selected walkthrough capacity; replace with the accountable contributor and confirmed capacity.",False)]])
        elif item.filename=="xl/worksheets/sheet4.xml":
            rows=[]
            for index,package in enumerate(packages):
                hours=Decimal(str(package["estimated_hours"]))+(Decimal(1) if index==0 else Decimal(0))
                rows.append([(package["id"],False),("delivery-owner",False),(str(hours),True)])
            raw=tables(raw,rows)
        output.writestr(item,raw)
print(json.dumps({"editedCells":["Work packages!E2","Work packages!G2"],
    "contributors":1,"assignments":len(packages),"addedHours":"1",
    "amountChangeUsd":str(packages[0]["assumed_hourly_rate_usd"])}))
`;
async function listener(workspace){
  const child=spawn('python3',[resolve(HERE,'../../server.py'),'--workspace',workspace,'--port','0'],{stdio:['ignore','pipe','pipe']});
  let stderr='',text='',timer;child.stderr.on('data',part=>{stderr+=part.toString();});
  const ready=await new Promise((done,reject)=>{
    const fail=error=>{clearTimeout(timer);reject(error);};
    child.once('error',fail);child.once('exit',code=>fail(new Error('Original listener exited '+code+': '+stderr)));
    timer=setTimeout(()=>{child.kill('SIGTERM');fail(new Error('Original listener did not announce its complete access file.'));},30000);
    child.stdout.on('data',part=>{
      text+=part.toString();if(!text.includes('\n'))return;
      try{const value=JSON.parse(text.split('\n')[0]);clearTimeout(timer);done(value);}catch(error){fail(error);}
    });
  });
  const token=(await readFile(join(workspace,'access.key'),'utf8')).trim(),url=ready.url.replace(/\/$/,'');
  return {url,token,async stop(){
    if(child.exitCode===null&&child.signalCode===null){
      const closed=new Promise(done=>child.once('exit',done));child.kill('SIGTERM');
      const timer=setTimeout(()=>child.kill('SIGKILL'),10000);await closed;clearTimeout(timer);
    }
  }};
}
async function browserCase(root,workspace,plan,returnedWorkbook,options={}){
  const require=createRequire(import.meta.url),paths=[sourceRoot,...(options.dependencyPaths||[]),
    process.env.PLAYWRIGHT_NODE_MODULES,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean);
  let library;
  for(const name of ['playwright','playwright-core']){
    try{library=require(require.resolve(name,{paths}));break;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
  }
  need(library?.chromium,'The selected browser programme needs the installed Playwright runtime.');
  const service=await listener(workspace);
  let browser,context;
  try{
    browser=await library.chromium.launch({headless:true,
      ...(options.executablePath||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?
        {executablePath:options.executablePath||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),
      args:['--no-sandbox','--disable-dev-shm-usage']});
    context=await browser.newContext({viewport:{width:1365,height:980},acceptDownloads:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    const ready=async()=>{
      await page.waitForFunction(()=>document.querySelector('#workbench')?.getAttribute('aria-busy')==='false');
      const error=await page.locator('#message').evaluate(node=>node.dataset.error==='true'?node.textContent:null);
      need(!error,'Browser operation: '+error);
      need(!errors.length,'Browser module: '+errors.join('\n'));
    };
    const click=async(label)=>{await page.getByRole('button',{name:label,exact:true}).click();await ready();};
    const disclosure=async(label)=>{
      const summary=page.locator('summary').filter({hasText:new RegExp('^'+label+'$')});
      if(!await summary.evaluate(node=>node.parentElement.open))await summary.click();
    };
    const download=async(label,path)=>{
      const [item]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:label,exact:true}).click()]);
      await item.saveAs(path);await ready();return {filename:item.suggestedFilename(),bytes:(await readFile(path)).length,path};
    };
    await page.goto(service.url+'/#access='+encodeURIComponent(service.token),{waitUntil:'networkidle'});
    await page.locator('#plan-select').selectOption(plan.id);await ready();
    await page.locator('[data-tab="source-tables"]').click();await ready();
    await page.getByRole('button',{name:'Export saved plan workbook',exact:true}).waitFor();
    await disclosure('Export choices');
    await page.getByLabel('Number storage',{exact:true}).selectOption('spreadsheet-numbers');await ready();
    await page.getByLabel('Work-package amount cells',{exact:true}).selectOption('formulas');await ready();
    const first=await download('Export saved plan workbook',join(root,'browser-initial-workbook-handover.zip'));
    await page.screenshot({path:join(root,'browser-workbook-export.png'),fullPage:true});
    await click('Use exported source project');
    await disclosure('Receive an edited workbook');
    await page.getByLabel('Returned workbook review note',{exact:true}).fill('Reviewed the complete returned four-sheet workbook and exact native values.');
    await page.getByLabel('Returned workbook review note',{exact:true}).blur();await ready();
    const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'Receive returned workbook',exact:true}).click()]);
    await chooser.setFiles(returnedWorkbook);await ready();
    for(const role of Object.keys(ROLES)){
      await page.getByRole('button',{name:ROLES[role].label+' · source retained',exact:true}).click();await ready();
      await click('Review current table mapping');
    }
    await click('Calculate native preview');
    await page.getByRole('heading',{name:'Complete native result',exact:true}).waitFor();
    need((await page.locator('.planning-source-tables').innerText()).includes('401 estimated hours'),
      'The browser must calculate the same complete native 401-hour result.');
    await page.screenshot({path:join(root,'browser-workbook-native-preview.png'),fullPage:true});
    await page.getByLabel('Source-import review note',{exact:true}).fill('Reviewed all returned rows, native hours, prices, capacity and the saved-source changes.');
    await page.getByLabel('Source-import review note',{exact:true}).blur();
    await page.getByLabel('I have reviewed the complete native result and these exact changes.',{exact:true}).check();
    await click('Apply reviewed changes to working plan');
    await page.locator('#change-note').fill('Saved the complete reviewed workbook receiving through the original browser.');
    const [response]=await Promise.all([page.waitForResponse(item=>/\/api\/plans\/plan-[a-f0-9]+\/save$/.test(item.url())&&item.request().method()==='POST'),
      page.locator('[data-action="save"]').click()]);
    need(response.ok(),'The original browser save must return its native saved result.');
    const saved=await response.json();await ready();
    need(String(saved.report.capacity.totalHours)==='401'&&String(saved.scenario.award_request_usd)==='38095',
      'The original browser save must preserve the same native budget.');
    await save(join(root,'browser-saved-native-plan.json'),saved);
    await save(join(root,'browser-saved-source-project.json'),serializePlanningBook(await importPlanningBook(saved.planning.sourceTables)));
    const final=await download('Export saved plan workbook',join(root,'browser-final-workbook-handover.zip'));
    await page.reload({waitUntil:'networkidle'});await page.locator('#plan-select').selectOption(saved.id);await ready();
    await page.locator('[data-tab="source-tables"]').click();await ready();
    await page.getByRole('button',{name:'Export saved plan workbook',exact:true}).waitFor();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:join(root,'browser-workbook-mobile-reopened.png'),fullPage:true});
    const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    need(overflow.document<=overflow.viewport+1,'The workbook flow must fit the narrow page; its source tables scroll within their own panels.');
    return {saved:{id:saved.id,revision:saved.revision,contentSha256:saved.contentSha256},
      firstDownload:first,finalDownload:final,reviewedRoles:Object.keys(ROLES),nativeHours:'401',
      nativeAwardRequestUsd:'38095',savedAndReopened:true,viewports:[{width:1365,height:980},{width:390,height:844}],
      pageErrors:errors,overflow,screenshots:['browser-workbook-export.png','browser-workbook-native-preview.png','browser-workbook-mobile-reopened.png']};
  }finally{await context?.close();await browser?.close();await service.stop();}
}
export async function receiveCurrentBudgetWorkbookHandover(directory,options={}){
  const root=resolve(directory);await mkdir(root,{mode:0o700});
  const workspace=join(root,'authoring'),receiving=join(root,'receiving');
  const initialized=await native(['init','--workspace',workspace]),id=initialized.plans[0]?.id;
  need(id,'The original planner must provide its complete candidate.');
  const original=await native(['show','--workspace',workspace,'--plan',id,'--part','all']);
  need(original.scenario.future_costs.length===6&&String(original.scenario.award_request_usd)==='38000'&&
    String(original.report.capacity.totalHours)==='400','Use the retained complete six-package 400-hour budget.');
  need(!original.planning.contributors.length&&!original.planning.assignments.length,'Start with the original empty staffing collections.');
  await save(join(root,'original-native-plan.json'),original);
  const profile={...defaultPlanningWorkbookProfile(),numberMode:'spreadsheet-numbers',precisionPolicy:'text',
    amountMode:'formulas',note:'Complete saved native plan for one explicit workbook revision and reviewed staffing.'};
  const profilePath=await save(join(root,'WORKBOOK_PROFILE.json'),profile),firstDirectory=join(root,'original-workbook-handover');
  const exportArgs=['export-plan-workbook','--workspace',workspace,'--plan',id,'--revision',String(original.revision),
    '--profile',profilePath,'--output-directory',firstDirectory];
  const first=await runPlanningSourceTables(exportArgs),exportReplay=await runPlanningSourceTables(exportArgs);
  need(exportReplay.replayed&&json(first.source)===json(exportReplay.source),'The same completed workbook export must reopen its original files.');
  need(first.tables.find(row=>row.role==='contributors').rows===0&&first.tables.find(row=>row.role==='assignments').rows===0,
    'The complete handover must retain the original empty native staffing sheets.');
  const returned=join(root,'returned-workbook.xlsx');
  const edited=JSON.parse((await execute('python3',['-c',EDIT_WORKBOOK,join(firstDirectory,'planning.xlsx'),returned,join(root,'original-native-plan.json')],
    {encoding:'utf8',maxBuffer:1024*1024})).stdout);
  await save(join(root,'workbook-edit-inputs.json'),edited);
  const returnProfile=defaultPlanningWorkbookReturnProfile();
  returnProfile.note='Reviewed one extra hour in the first original work package, one example contributor and all six explicit assignments.';
  const returnPath=await save(join(root,'RETURN_PROFILE.json'),returnProfile),receivedProject=join(root,'returned-project.json');
  const returnedResult=await runPlanningSourceTables(['receive-returned-workbook','--project',join(firstDirectory,'planning-source-project.json'),
    '--file',returned,'--return-profile',returnPath,'--output',receivedProject]);
  let book=await importPlanningBook(await readFile(receivedProject,'utf8'));
  for(const role of Object.keys(ROLES))book=await retainPlanningTableReview(book,role);
  book.settings.awardRequestUsd='38095';book.settings.scenarioName=original.scenario.scenario_name+' — returned workbook';
  const comparison=sourceEditionComparison(book,'packages');
  need(comparison.summary.changed===1&&comparison.summary.unchanged===5,'The source comparison must isolate the one complete changed package.');
  const project=await save(join(root,'reviewed-source-project.json'),serializePlanningBook(book));
  await save(join(root,'workbook-source-comparison.json'),comparison);
  const previewPath=join(root,'native-preview.json');
  const preview=await runPlanningSourceTables(['preview','--project',project,'--workspace',workspace,'--plan',id,'--output',previewPath]);
  need(String(preview.hours)==='401'&&String(preview.awardRequestUsd)==='38095','The original native calculator must produce the reviewed whole budget.');
  const saveArgs=['save','--preview',previewPath,'--workspace',workspace,
    '--note','Reviewed the complete returned workbook, exact values, staffing and original native plan.',
    '--request-id','current-budget-workbook-handover-save','--output-directory',join(root,'saved-edition')];
  const saved=await runPlanningSourceTables(saveArgs),replay=await runPlanningSourceTables(saveArgs);
  need(json(saved)===json(replay),'The same native save must reopen its original complete delivery.');
  const plan=await readJson(join(root,'saved-edition','plan.json'));
  const finalProfile={...defaultPlanningWorkbookProfile(),note:'Exact-text handover of the complete saved returned-workbook result.'};
  const finalProfilePath=await save(join(root,'FINAL_WORKBOOK_PROFILE.json'),finalProfile),finalDirectory=join(root,'final-workbook-handover');
  const final=await runPlanningSourceTables(['export-plan-workbook','--workspace',workspace,'--plan',plan.id,'--revision',String(plan.revision),
    '--profile',finalProfilePath,'--output-directory',finalDirectory]);
  const imported=await native(['import-bundle','--workspace',receiving,'--file',join(finalDirectory,'planning.zip'),
    '--name','Received complete editable workbook plan','--request-id','current-budget-workbook-handover-receive']);
  const reopenedPlan=await native(['show','--workspace',receiving,'--plan',imported.plan.id,'--part','all']);
  const reopened=await importPlanningBook(reopenedPlan.planning.sourceTables),continuation=rebasePlanningBook(reopened,reopenedPlan);
  const preparation=await preparePlanningImport(continuation);
  need(reopenedPlan.contentSha256===plan.contentSha256&&reopened.workbookSources.length===2&&
    reopened.workbookSelections.length===8&&preparation.review.sourceRows.length===16&&
    preparation.review.sourceRows.every(row=>row.workbook),'The received native case must reopen both workbook editions, all eight selections and every source cell.');
  await save(join(root,'received-source-project.json'),serializePlanningBook(continuation));
  const service=await listener(workspace);
  let immutable;
  try{
    const response=await fetch(service.url+'/api/plans/'+id+'/export.zip?revision='+original.revision,
      {headers:{Authorization:'Bearer '+service.token}});
    need(response.ok,'The original listener must export the exact earlier saved revision.');
    const bytes=new Uint8Array(await response.arrayBuffer()),receipt=await receivePlanningFile(bytes,{filename:'planning.zip',
      inflate:(raw,max)=>new Uint8Array(inflateRawSync(raw,{maxOutputLength:Math.max(1,max)}))});
    need(receipt.document.currentRevision===original.revision,'The earlier saved export must remain selected after a newer native save.');
    await save(join(root,'earlier-saved-revision.zip'),bytes);
    immutable={revision:receipt.document.currentRevision,bytes:bytes.length,sha256:hash(bytes)};
  }finally{await service.stop();}
  const result={schema:'stellar-forge.planning-workbook-handover.receiving.v1',
    original:{id:original.id,revision:original.revision,hours:'400',awardRequestUsd:'38000'},
    firstExport:first,exactExportReplay:true,enteredWorkbookEdits:edited,receivedSheets:returnedResult.received,
    reviewedNative:{id:plan.id,revision:plan.revision,hours:'401',awardRequestUsd:'38095'},
    sourceComparison:comparison.summary,nativeSave:saved,identicalNativeSaveReplay:true,finalExport:final,
    received:{id:reopenedPlan.id,revision:reopenedPlan.revision,contentSha256:reopenedPlan.contentSha256,
      workbookSources:reopened.workbookSources.length,worksheetSelections:reopened.workbookSelections.length,
      rows:preparation.review.sourceRows.length,allRowsRetainWorkbookCells:true},immutableSavedZip:immutable,
    nativePortableOutputComplete:true,browser:null};
  const summaryPath=join(root,'WORKBOOK_HANDOVER_RECEIVING.json');
  await save(summaryPath,result);
  if(options.browser){
    result.browser=await browserCase(root,receiving,reopenedPlan,returned,options);
    await saveReceivingSummary(summaryPath,result);
  }
  return result;
}
export async function resumeCurrentBudgetWorkbookBrowser(directory,options={}){
  const root=resolve(directory),summaryPath=join(root,'WORKBOOK_HANDOVER_RECEIVING.json'),
    result=await readJson(summaryPath);
  need(result.schema==='stellar-forge.planning-workbook-handover.receiving.v1'&&
    result.nativePortableOutputComplete&&result.received?.contentSha256,
    'Resume the browser from the complete original native workbook receiving case.');
  if(result.browser?.savedAndReopened)return result;
  // Restore the exact saved native ZIP into a private receiving workspace. The
  // portable operating case deliberately carries no live access keys or database.
  const receiving=join(root,'receiving');await mkdir(receiving,{recursive:true,mode:0o700});
  const workspace=await mkdtemp(join(receiving,'workbook-browser-'));
  const restored=await native(['import-bundle','--workspace',workspace,
    '--file',join(root,'final-workbook-handover','planning.zip'),
    '--name','Browser continuation of the complete workbook receiving case',
    '--request-id','current-budget-workbook-browser-continuation']);
  const plan=await native(['show','--workspace',workspace,'--plan',restored.plan.id,'--part','all']);
  need(plan.contentSha256===result.received.contentSha256,
    'The browser continuation must restore the exact previously received native plan.');
  // Keep completed and interrupted browser attempts beside the same portable
  // case. A late failure may already have saved native files with exclusive
  // creation; the next complete browser run needs its own output directory.
  const browserDirectory=await mkdtemp(join(root,'browser-review-'));
  result.browser=await browserCase(browserDirectory,workspace,plan,join(root,'returned-workbook.xlsx'),options);
  result.browser.outputDirectory=relative(root,browserDirectory);
  result.browser.resumedFromNativeResult=true;
  await saveReceivingSummary(summaryPath,result);
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]||process.argv[2]==='--help')process.stdout.write(
    'node receive-current-budget-workbook-handover.mjs NEW_PRIVATE_DIRECTORY [--browser]\n'+
    'node receive-current-budget-workbook-handover.mjs COMPLETE_NATIVE_CASE_DIRECTORY --resume-browser\n'+
    'Runs the whole native receiving programme or resumes its actual browser flow from the saved portable native case.\n');
  else{
    const flags=process.argv.slice(3);
    need(flags.length===0||(flags.length===1&&['--browser','--resume-browser'].includes(flags[0])),
      'Use one optional --browser or --resume-browser flag.');
    const run=flags[0]==='--resume-browser'?resumeCurrentBudgetWorkbookBrowser:receiveCurrentBudgetWorkbookHandover;
    run(process.argv[2],{browser:flags[0]==='--browser'}).then(value=>process.stdout.write(json(value)))
      .catch(error=>{process.stderr.write(json({error:{message:error.message,code:error.code}}));process.exitCode=1;});
  }
}
