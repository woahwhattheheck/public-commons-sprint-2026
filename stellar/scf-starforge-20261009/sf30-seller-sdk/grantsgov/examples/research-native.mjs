#!/usr/bin/env node
// MIT. One source-backed research, operator and receiving journey over a complete original capture.
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openGrantsWorkspace } from '../workspace.mjs';
import { readCaptureExport } from '../capture.mjs';
import { startGrantsServer } from '../server.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const timestamp=()=>new Date().toISOString();
const need=(value,message)=>{if(!value)throw Error(message);};
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
function options(argv){
  const result={};for(let i=0;i<argv.length;i+=2){
    need(argv[i]?.startsWith('--')&&argv[i+1]&&!Object.hasOwn(result,argv[i].slice(2)),'Use --source FILE --work DIRECTORY --out DIRECTORY --operation ID --playwright MODULE --chromium FILE.');
    result[argv[i].slice(2)]=argv[i+1];
  }return result;
}
async function save(file,value){
  await mkdir(resolve(file,'..'),{recursive:true,mode:0o700});
  const temporary=file+'.writing';await writeFile(temporary,json(value),{mode:0o600});await rename(temporary,file);
}
async function retain(file,data){await mkdir(resolve(file,'..'),{recursive:true,mode:0o700});await writeFile(file,data,{mode:0o600});}
function dataPage(result){return result.body??result.result?.body??result;}
const declarations={wholeOperationMemoryMiB:1024,privateWorkingStorageMiB:256,persistentOutputMiB:32};
export async function main(argv=process.argv.slice(2)){
  const args=options(argv),sourceFile=resolve(args.source),work=resolve(args.work),out=resolve(args.out);
  const operationId=args.operation??'grants-research-native';
  need(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/.test(operationId),'Choose a stable original operation ID.');
  need(work!==out&&!work.startsWith(out+'/')&&!out.startsWith(work+'/'),'Use separate private work and retained output directories.');
  await mkdir(work,{recursive:true,mode:0o700});await mkdir(out,{recursive:true,mode:0o700});
  const sourceBytes=await readFile(sourceFile),packet=JSON.parse(sourceBytes),capture=readCaptureExport(packet);
  need(capture.coverage.searchComplete&&capture.coverage.detailsComplete,'Use a complete original search and all notice details.');
  const operationFile=join(out,'operation.json'),inputSha256=hash(sourceBytes);
  let journal;
  try{journal=await readJSON(operationFile);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(journal){
    need(journal.operationId===operationId&&journal.inputSha256===inputSha256&&journal.work===work,'Resume the original operation, source and private work directory.');
    if(journal.status==='completed'){
      for(const output of journal.outputs){
        const data=await readFile(join(out,output.file));need(data.length===output.bytes&&hash(data)===output.sha256,'A retained final output changed.');
      }
      process.stdout.write(json({replayed:true,...journal}));return journal;
    }
    if(journal.steps.research){
      try{await stat(join(work,'workspace','workspace.json'));}catch(error){if(error.code==='ENOENT')throw Error('The original private workspace is missing. Resume from its retained complete export before continuing this operation.');throw error;}
    }
  }else journal={schema:'stellar-forge.grantsgov-research-native.v1',operationId,inputSha256,
    sourceFile,work,startedAt:timestamp(),status:'running',phase:'source',declarations,steps:{},outputs:[]};
  journal.status='running';journal.error=null;await save(operationFile,journal);
  const checkpoint=async(phase,value)=>{journal.phase=phase;journal.steps[phase]=value;journal.updatedAt=timestamp();await save(operationFile,journal);
    process.stdout.write(json({operationId,phase,at:journal.updatedAt}));};
  const requested=suffix=>operationId+':'+suffix;
  const outputDirectory=join(work,'delivery');
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  let workspace,server,browser,recipient,editionRecipient;
  try{
    await checkpoint('source',{captureId:capture.captureId,sourceSignature:capture.sourceSignature,
      sourcePacketSha256:packet.sha256,pages:capture.pages.length,details:capture.details.length,
      rows:capture.opportunities.length,coverage:capture.coverage,node:process.version});
    workspace=await openGrantsWorkspace({directory:join(work,'workspace')});
    const query=await workspace.querySave({requestId:requested('query'),expectedRevision:0,
      name:'Artificial intelligence · original Grants.gov research',definition:capture.query});
    const imported=await workspace.importOriginal({requestId:requested('source'),packet,name:'AI opportunities · original complete cohort'});
    const original=await workspace.createEdition({requestId:requested('full-edition'),captureId:imported.id,name:'AI opportunities · complete original edition'});
    const all=await workspace.rows(original.id,{limit:250});
    need(all.total===capture.opportunities.length&&all.nextOffset===null,'The original retained opportunity count differs.');
    const target=all.items.find(value=>value.opportunity_id==='363268')??all.items.find(value=>value.document_type==='synopsis')??all.items[0];
    const detail=await workspace.opportunity(original.id,target.opportunity_id);
    const originalRow=capture.opportunities.find(value=>value.opportunity_id===target.opportunity_id);
    need(JSON.stringify(detail.opportunity)===JSON.stringify(originalRow),'The selected original source row differs.');
    const review={status:'preparing',owner:'Commons grant research',fit:
      'The retained notice is a candidate for a source-backed dataset and implementation workshare. Scope selection follows its original current announcement, published date fields and eligibility narrative.',
      eligibilityAssessment:detail.opportunity.eligibility?.narrative??'Use the complete applicant types and published eligibility text retained in this edition.',
      partner:'Research and implementation partner selected from the published eligibility requirements.',
      workshare:'Deliver a maintainable source acquisition and qualification workspace, with complete notice details, retained revisions, an editable opportunity workshare and portable receiving.',
      deliverables:'Saved source search; complete original acquisition; opportunity and eligibility inventory; named workshare deliverables; queryable dataset; complete portable research handover.',
      acceptance:'The receiving operator opens every selected original notice, reads the preserved deadline and amount text, edits the saved qualification, and reopens the complete exported workspace.',
      schedule:'Prepare the implementation and application work plan against the notice’s original closing instructions and the selected partner’s delivery calendar.',
      fee:'Internal qualification. Record the partner’s agreed fixed scope and service fee here.',
      nextAction:'Use the retained original notice to assign the applicant team, complete the dataset implementation workshare and assemble the application materials.',
      notes:'Original public source observation: '+detail.opportunity.source_observed_at};
    const first=await workspace.reviewSave({requestId:requested('review'),editionId:original.id,opportunityId:target.opportunity_id,expectedRevision:0,review});
    const revised={...review,acceptance:review.acceptance+'\nEach exported dataset field maps to its retained original search or notice detail.'};
    await workspace.reviewSave({requestId:requested('review-refine'),editionId:original.id,opportunityId:target.opportunity_id,expectedRevision:first.revision,review:revised});
    const selectedIds=[target.opportunity_id,...all.items.filter(value=>value.opportunity_id!==target.opportunity_id&&
      value.document_type==='forecast').slice(0,2).map(value=>value.opportunity_id)];
    const selection=await workspace.createEdition({requestId:requested('priority-edition'),sourceEditionId:original.id,
      parentId:original.id,captureId:imported.id,opportunityIds:selectedIds,name:'Priority application and forecast review'});
    const comparison=await workspace.compare(original.id,selection.id,{limit:250});
    need(comparison.counts.added===0&&comparison.counts.changed===0&&comparison.counts.absent===all.total-selectedIds.length,'The selected-edition comparison differs.');
    const merchant=await workspace.merchant({requestId:requested('merchant'),editionId:original.id,defaultLimit:25,maxLimit:100});
    const served=[];let cursor;
    do{
      const result=await workspace.merchantPreview(merchant.id,{limit:25,...(cursor?{cursor}:{})}),page=dataPage(result);
      need(result.status===200&&page.schema==='stellar-forge.dataset-page.v1','The native SF30 dataset page was not returned.');
      served.push(...page.rows);cursor=page.page.nextCursor;
    }while(cursor);
    need(served.length===all.total&&new Set(served.map(value=>value.opportunity_id)).size===all.total,'The native dataset cursor chain differs from the complete source.');
    for(const row of served){
      const source=capture.opportunities.find(value=>value.opportunity_id===row.opportunity_id);
      need(row.award_ceiling_raw===(source.award_ceiling_raw??null)&&row.closing_date_raw===(source.closing_date_raw??null),'An original source amount or date changed in native dataset delivery.');
    }
    await checkpoint('research',{workspaceId:(await workspace.snapshot()).id,queryId:query.id,captureId:imported.id,
      originalEdition:original.id,selectedEdition:selection.id,sourcePacketSha256:original.sourcePacketSha256,
      opportunityId:target.opportunity_id,merchantId:merchant.id,datasetSnapshot:merchant.dataset.snapshot,
      datasetRows:served.length,comparison:comparison.counts});
    // Browser, server and original workspace stay in this same native operation.
    if(args.playwright&&args.chromium&&!journal.steps.browser){
      const playwright=await import(pathToFileURL(resolve(args.playwright,'index.mjs')).href);
      const profile=join(work,'browser');
      await mkdir(profile,{recursive:true,mode:0o700});
      browser=await playwright.chromium.launch({executablePath:resolve(args.chromium),headless:true,
        args:['--no-sandbox','--disable-dev-shm-usage'],env:{...process.env,TMPDIR:profile}});
      server=await startGrantsServer({workspace});
      const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
      const page=await context.newPage(),errors=[];
      page.on('pageerror',failure=>errors.push(failure.message));
      await page.goto(server.url,{waitUntil:'domcontentloaded'});
      await page.locator('#edition option[value="'+original.id+'"]').waitFor({state:'attached'});
      await page.selectOption('#edition',original.id);
      await page.fill('#row-search',target.opportunity_number);
      await page.click('#filter-rows');
      await page.locator('[data-opportunity="'+target.opportunity_id+'"]').click();
      await page.locator('#review-form textarea[name="deliverables"]').waitFor();
      const current=await page.locator('#review-form textarea[name="deliverables"]').inputValue();
      const browserDeliverables=current+'\nMachine-readable inventory of each original notice, named delivery owner and dated qualification.';
      await page.fill('#review-form textarea[name="deliverables"]',browserDeliverables);
      await page.locator('#review-form button[type="submit"],#review-form button.primary').click();
      await page.getByRole('status').filter({hasText:'Qualification and workshare saved.'}).waitFor();
      const browserReview=(await workspace.opportunity(original.id,target.opportunity_id)).review;
      need(browserReview.data.deliverables===browserDeliverables,'The browser qualification did not reach the original workspace.');
      await page.screenshot({path:join(out,'Grants_Opportunity_Desktop.png'),fullPage:true});
      await page.click('nav [data-view="compare"]');
      await page.selectOption('#compare-before',original.id);await page.selectOption('#compare-after',selection.id);
      await page.locator('#compare-form button.primary').click();
      await page.locator('#comparison .change').first().waitFor();
      await page.click('nav [data-view="opportunities"]');
      const waiting=page.waitForEvent('download');await page.click('#backup');const download=await waiting;
      const browserBackup=join(outputDirectory,'workspace-from-browser.json');await download.saveAs(browserBackup);
      const downloaded=await readJSON(browserBackup);
      need(downloaded.state.id===(await workspace.snapshot()).id&&downloaded.state.reviews[target.opportunity_id].revision===browserReview.revision,
        'The complete browser backup lost the original workspace or review revision.');
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'Grants_Opportunity_Mobile.png'),fullPage:true});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
      need(!overflow&&errors.length===0,'The original browser flow has page errors or viewport overflow: '+errors.join('; '));
      await context.close();await browser.close();browser=null;await server.close();server=null;
      await checkpoint('browser',{desktop:[1440,1000],mobile:[390,844],errors,overflow,reviewRevision:browserReview.revision,
        backupBytes:(await stat(browserBackup)).size,backupSha256:hash(await readFile(browserBackup))});
    }
    const exports=[];
    for(const specification of [
      {kind:'edition',editionId:selection.id,includeReviews:true},
      {kind:'merchant',merchantId:merchant.id},
      {kind:'comparison',before:original.id,after:selection.id},
      {kind:'workshare-md',editionId:original.id,opportunityId:target.opportunity_id},
      {kind:'workshare-html',editionId:original.id,opportunityId:target.opportunity_id},
      {kind:'workspace'}
    ]){
      const descriptor=await workspace.exportFile(specification),parts=[];let offset=0;
      while(true){
        const chunk=await workspace.readExport(descriptor.id,{offset,limit:offset===0?65536:8*1024*1024});
        parts.push(Buffer.from(chunk.data,'base64'));
        if(chunk.nextOffset===null)break;offset=chunk.nextOffset;
        if(specification.kind==='workspace'&&parts.length===1){
          await workspace.close();workspace=await openGrantsWorkspace({directory:join(work,'workspace')});
        }
      }
      const data=Buffer.concat(parts);need(data.length===descriptor.bytes&&hash(data)===descriptor.sha256,'An original export changed while reopening.');
      const file=specification.kind+(specification.kind==='workshare-md'?'.md':specification.kind==='workshare-html'?'.html':'.json');
      await retain(join(outputDirectory,file),data);exports.push({kind:specification.kind,file,bytes:data.length,sha256:hash(data)});
    }
    const backup=await readJSON(join(outputDirectory,'workspace.json'));
    recipient=await openGrantsWorkspace({directory:join(work,'recipient')});
    const restored=await recipient.restore({requestId:requested('restore'),packet:backup});
    const restoredAgain=await recipient.restore({requestId:requested('restore'),packet:backup});
    need(restored.workspaceId===backup.state.id&&restoredAgain.workspaceId===restored.workspaceId,'The original workspace identity did not survive receiving.');
    const receivedPage=await recipient.rows(original.id,{limit:250}),received=await recipient.opportunity(original.id,target.opportunity_id);
    need(receivedPage.total===all.total&&received.review.revision===backup.state.reviews[target.opportunity_id].revision,'The full original research or saved review is missing from receiving.');
    await recipient.close();recipient=await openGrantsWorkspace({directory:join(work,'recipient')});
    need((await recipient.opportunity(original.id,target.opportunity_id)).review.revision===received.review.revision,'The received qualification did not reopen.');
    const editionPacket=await readJSON(join(outputDirectory,'edition.json'));
    editionRecipient=await openGrantsWorkspace({directory:join(work,'edition-recipient')});
    const receivedEdition=await editionRecipient.receiveEdition({requestId:requested('receive-edition'),packet:editionPacket});
    const repeatedEdition=await editionRecipient.receiveEdition({requestId:requested('receive-edition'),packet:editionPacket});
    need(receivedEdition.id===selection.id&&repeatedEdition.sha256===selection.sha256,'The original selected edition did not replay intact.');
    need((await editionRecipient.opportunity(original.id,target.opportunity_id)).review.revision===received.review.revision,
      'The selected-edition package lost its referenced qualification edition.');
    await checkpoint('receiving',{workspaceId:restored.workspaceId,rows:receivedPage.total,editions:restored.editions,
      reviewRevision:received.review.revision,selectedEditionId:receivedEdition.id,sourceSignature:capture.sourceSignature,exports});
    await workspace.close();workspace=null;await recipient.close();recipient=null;await editionRecipient.close();editionRecipient=null;
    const cliResult=spawnSync(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),'status','--workspace',join(work,'recipient')],{encoding:'utf8',maxBuffer:2*1024*1024});
    need(cliResult.status===0,'The receiving CLI status failed: '+cliResult.stderr);
    const cliState=JSON.parse(cliResult.stdout);
    need(cliState.id===backup.state.id,'The CLI did not reopen the received original workspace.');
    await checkpoint('cli-receiving',{workspaceId:cliState.id,exitCode:cliResult.status});
    const guide='# Grants.gov opportunity workspace receiving\n\n'+
      'This package contains the complete original grant research, selected edition and source, merchant dataset, comparison and editable workshare exports.\n\n'+
      'Original operation: '+operationId+'\n\nOriginal capture: '+capture.captureId+'\n\n'+
      'Source: '+capture.opportunities.length+' opportunities, '+capture.pages.length+' search pages and '+capture.details.length+' full original notice records.\n\n'+
      'Restore the complete research with the maintained Grants.gov CLI:\n\n'+
      '    node grantsgov/cli.mjs restore --workspace /private/received-grants --file workspace.json --request original-grants-receiving\n'+
      '    node grantsgov/cli.mjs serve --workspace /private/received-grants\n\n'+
      'Receive only the selected edition and its original references:\n\n'+
      '    node grantsgov/cli.mjs receive --workspace /private/selected-grants --file edition.json --request selected-grants-receiving\n\n'+
      'The source preserves published calendar dates and timezone text, reported money text, current versus forecast fields, eligibility narratives and the original source bytes. The workshare records the operator’s analysis and proposed delivery work.\n';
    await retain(join(outputDirectory,'RECEIVING.md'),Buffer.from(guide));
    await retain(join(outputDirectory,'operation-result.json'),Buffer.from(json({...journal,status:'completed',phase:'receiving-complete',completedAt:timestamp(),outputs:exports})));
    const archive=join(out,'Grant_Opportunity_Workspace_Receiving_20261012.zip');
    const python="import pathlib,zipfile,sys,os; root=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2]); temporary=target.with_suffix('.zip.writing')\nwith zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:\n for path in sorted(root.rglob('*')):\n  if path.is_file(): archive.write(path,path.relative_to(root).as_posix())\nos.replace(temporary,target)\n";
    const packed=spawnSync('python',['-c',python,outputDirectory,archive],{encoding:'utf8',maxBuffer:1024*1024});
    need(packed.status===0,'Complete receiving archive failed: '+packed.stderr);
    const files=['Grant_Opportunity_Workspace_Receiving_20261012.zip',
      ...(journal.steps.browser?['Grants_Opportunity_Desktop.png','Grants_Opportunity_Mobile.png']:[])];
    journal.outputs=[];
    for(const file of files){const content=await readFile(join(out,file));journal.outputs.push({file,bytes:content.length,sha256:hash(content)});}
    journal.status='completed';journal.phase='completed';journal.completedAt=timestamp();await save(operationFile,journal);
    process.stdout.write(json(journal));return journal;
  }catch(failure){
    journal.status='interrupted';journal.error={code:failure.code??'NATIVE_RESEARCH_FAILED',message:failure.message,stack:failure.stack,at:timestamp()};
    await save(operationFile,journal).catch(()=>{});throw failure;
  }finally{
    await browser?.close().catch(()=>{});await server?.close().catch(()=>{});
    await workspace?.close().catch(()=>{});await recipient?.close().catch(()=>{});await editionRecipient?.close().catch(()=>{});
  }
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)
  main().catch(error=>{process.stderr.write(json({error:{code:error.code??'GRANTS_NATIVE_FAILED',message:error.message,stack:error.stack}}));process.exitCode=1;});
