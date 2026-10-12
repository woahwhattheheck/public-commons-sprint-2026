#!/usr/bin/env node
// MIT. Complete original-source commissioning and independent operator receiving.
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,open,readFile,lstat,readdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {readBytes,writeBytes} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {openWaterQualityProject,operationId} from '../project.mjs';
import {startWaterQualityWorkspace} from '../workspace.mjs';
import {canonical,digest,importKiWISResponses} from './source.mjs';
import {emptyDecisions,previewCommissioning} from './model.mjs';
import {COMMISSIONING_FORMATS} from './formats.mjs';
import {acquireCommissioningSource,readCommissioningCapture,saveCommissioningSource,readCommissioningSource,
  saveCommissioningReview,readCommissioningReview,compareCommissioningEditions,
  exportCommissioningReview,receiveCommissioningReview} from './workflow.mjs';

const LIMIT=256*1024*1024;
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
async function jsonFile(path){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(resolve(path),LIMIT)));}
async function preserve(path,content){
  const bytes=Buffer.isBuffer(content)?content:Buffer.from(JSON.stringify(content,null,2)+'\n');
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;const info=await lstat(path);
    requireValue(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&Buffer.compare(await readBytes(path,LIMIT),bytes)===0,'The original receiving output changed: '+path);}
  return {path,filename:path.slice(path.lastIndexOf('/')+1),bytes:bytes.length,sha256:digest(bytes)};
}
async function retainedScreenshot(path,page){
  try{
    const info=await lstat(path);requireValue(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1,'Keep the original operator screenshot.');
    const bytes=await readBytes(path,LIMIT);
    return {path,filename:path.slice(path.lastIndexOf('/')+1),bytes:bytes.length,sha256:digest(bytes)};
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return preserve(path,await page.screenshot({fullPage:true}));
}
function exactChoices(source,configuration){
  if(configuration.document)return configuration.document;
  const document=emptyDecisions(source);
  for(const profile of configuration.profiles??[]){
    const matches=source.kiwis.series.filter(series=>series.tsId===String(profile.tsId)&&
      (profile.tableIndex===undefined||series.tableIndex===profile.tableIndex));
    requireValue(matches.length===1,'Select one original series table for the complete profile.');
    const {tsId,tableIndex,...mapping}=profile,series=matches[0];
    document.profiles.push({...mapping,seriesId:series.seriesId,seriesSha256:digest(canonical(series))});
  }
  for(const policy of configuration.quality??[]){
    const matches=source.kiwis.series.filter(series=>series.tsId===String(policy.tsId)&&
      (policy.tableIndex===undefined||series.tableIndex===policy.tableIndex));
    requireValue(matches.length===1,'Select one original series for each quality decision.');
    const {tsId,tableIndex,...selection}=policy;document.quality.push({...selection,seriesId:matches[0].seriesId});
  }
  document.times=configuration.times??[];document.correspondences=configuration.correspondences??[];
  if(configuration.selectUnique){
    requireValue(typeof configuration.selectUnique.reason==='string'&&configuration.selectUnique.reason.trim(),
      'Record the operator reason for selecting unique candidates.');
    const preview=previewCommissioning(source,document);
    for(const row of preview.records.filter(row=>row.candidates.length===1&&!row.choice)){
      const selected=row.candidates[0];document.correspondences.push({recordId:row.recordId,rowSha256:row.rowSha256,
        action:'link',observationId:selected.observationId,observationSha256:selected.observationSha256,
        reason:configuration.selectUnique.reason});
    }
  }
  return document;
}
async function counterpart(selected,base){
  const path=resolve(base,selected.file),kind=selected.kind;
  if(kind==='lab-edd-result'){const bytes=await readBytes(path,LIMIT);return {kind,bytes:bytes.length,sha256:digest(bytes),base64:bytes.toString('base64')};}
  const original=await jsonFile(path);
  if(kind==='kiwis-wqm')return {kind,response:original};
  return {kind,bundle:original};
}
async function operatorBrowser({projectDirectory,reviewId,previousReviewId,expectedCounts,output,configuration,saveAs}){
  const phaseInput={projectDirectory,reviewId,expectedCounts,configuration,saveAs:saveAs??null,...(previousReviewId?{previousReviewId}:{})},
    phaseSha256=digest(canonical(phaseInput)),phasePath=join(output,'COMPLETE.json');
  try{
    const previous=await jsonFile(phasePath);
    requireValue(previous.inputSha256===phaseSha256,'The original operator receiving phase changed.');
    for(const file of previous.files){const bytes=await readBytes(file.path,LIMIT);
      requireValue(bytes.length===file.bytes&&digest(bytes)===file.sha256,'An original operator deliverable changed.');}
    const original=await openWaterQualityProject(projectDirectory);
    try{
      const source=await readCommissioningReview({project:original,reviewId}),
        result=await readCommissioningReview({project:original,reviewId:previous.result.reviewId});
      requireValue(source.savedSha256===previous.originalSavedSha256&&result.savedSha256===previous.result.savedSha256,
        'Reopen the original accepted operator phase and its exact saved editions.');
    }finally{await original.close();}
    return previous.result;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const phaseFiles=[],playwright=await import(pathToFileURL(resolve(configuration.playwrightModule)).href);
  const workspace=await startWaterQualityWorkspace({directory:projectDirectory}),errors=[],downloads=[];
  let browser,comparisonResult;
  try{
    const originalSaved=await readCommissioningReview({project:workspace.project,reviewId});
    browser=await playwright.chromium.launch({executablePath:resolve(configuration.chromiumExecutable),headless:true,
      args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:1440,height:1040}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(workspace.url,{waitUntil:'networkidle'});
    await page.locator('[data-tab="kiwis"]').click();
    await page.locator('#kiwis-review').selectOption(reviewId);await page.locator('#kiwis-open-review').click();
    await page.locator('#kiwis-editor').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#kiwis-counts strong')!==null);
    const actual=await page.locator('#kiwis-counts > div').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[
      node.querySelector('span').textContent,Number(node.querySelector('strong').textContent)])));
    requireValue(canonical(actual)===canonical(expectedCounts),'The operator view differs from the complete native review.');
    if(expectedCounts.counterpartRecords){
      await page.getByRole('button',{name:'Open original',exact:true}).first().click();
      await page.locator('#kiwis-record-source').waitFor({state:'visible'});
      requireValue((await page.locator('#kiwis-record-source').textContent()).includes('"original"'),'Open the complete original counterpart record.');
    }
    const desktop=join(output,'operator-desktop.png');
    phaseFiles.push(await retainedScreenshot(desktop,page));
    await page.setViewportSize({width:390,height:844});
    phaseFiles.push(await retainedScreenshot(join(output,'operator-mobile.png'),page));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);
    requireValue(!overflow,'The complete operator page must fit the selected mobile viewport.');
    await page.setViewportSize({width:1440,height:1040});
    if(previousReviewId){
      const prior=await readCommissioningReview({project:workspace.project,reviewId:previousReviewId});
      await page.locator('#kiwis-previous-review').selectOption(previousReviewId);
      const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/kiwis/compare')&&response.request().method()==='POST');
      await page.locator('#kiwis-compare-form button[type="submit"]').click();
      const response=await responsePromise;
      requireValue(response.status()===200,'Compare both complete saved editions through the original operator workspace.');
      const comparison=await response.json(),{comparisonSha256,...body}=comparison,review=comparison.reviewComparison;
      requireValue(digest(canonical(body))===comparisonSha256&&review?.current.reviewId===reviewId&&
        review.previous.reviewId===previousReviewId&&review.current.savedSha256===originalSaved.savedSha256&&
        review.previous.savedSha256===prior.savedSha256,'The operator comparison must retain both exact saved editions.');
      requireValue(review.coverage.previousRecords===prior.review.records.length&&
        review.coverage.currentRecords===originalSaved.review.records.length&&
        review.coverage.paired+review.coverage.unpairedPrevious===prior.review.records.length&&
        review.coverage.paired+review.coverage.unpairedCurrent===originalSaved.review.records.length,
        'The operator comparison must account for every physical review record.');
      await page.locator('#kiwis-comparison').waitFor({state:'visible'});
      const summary=JSON.parse(await page.locator('#kiwis-comparison-summary').textContent());
      requireValue(summary.previousReviewId===previousReviewId&&summary.currentReviewId===reviewId&&
        canonical(summary.previousCounts)===canonical(prior.review.counts)&&canonical(summary.currentCounts)===canonical(expectedCounts)&&
        canonical(summary.reviewCoverage)===canonical(review.coverage),
        'The visible comparison must show the complete original count and decision change.');
      if(review.records.length){
        await page.getByRole('button',{name:'Open decision difference',exact:true}).first().click();
        await page.locator('#kiwis-comparison-record-detail').waitFor({state:'visible'});
        requireValue(canonical(JSON.parse(await page.locator('#kiwis-comparison-record-detail').textContent()))===canonical(review.records[0]),
          'The operator must open the complete original before/after decision record.');
      }
      phaseFiles.push(await preserve(join(output,'complete-saved-review-comparison.json'),comparison));
      comparisonResult={previousReviewId,currentReviewId:reviewId,comparisonSha256,
        reviewComparisonSha256:review.reviewComparisonSha256,coverage:review.coverage,countDelta:review.countDelta,
        statusTransitions:review.statusTransitions};
    }
    let selectedReviewId=reviewId;
    if(saveAs){
      selectedReviewId=operationId(saveAs);
      await page.locator('#kiwis-save-id').fill(selectedReviewId);
      await page.locator('#kiwis-save-title').fill('Operator receiving: '+selectedReviewId);
      const saved=page.waitForResponse(response=>response.url().endsWith('/api/kiwis/reviews')&&response.request().method()==='POST');
      await page.locator('#kiwis-save-form button[type="submit"]').click();
      requireValue((await saved).status()===200,'The operator must save the complete commissioning edition.');
      await page.locator('#kiwis-downloads a').first().waitFor();
    }
    for(const format of COMMISSIONING_FORMATS){
      const response=await page.request.get(workspace.url+'/api/kiwis/review/'+encodeURIComponent(selectedReviewId)+'/'+format);
      requireValue(response.status()===200,'Download the complete '+format+' deliverable through the original workspace.');
      const actual=await response.body(),native=await exportCommissioningReview({project:workspace.project,reviewId:selectedReviewId,format});
      requireValue(Buffer.compare(actual,native.bytes)===0,'The browser '+format+' download differs from the complete native export.');
      downloads.push({format,status:response.status(),bytes:actual.length,sha256:digest(actual)});
    }
    requireValue(!errors.length,'The operator encountered a browser error: '+errors.join('; '));
    const selectedSaved=await readCommissioningReview({project:workspace.project,reviewId:selectedReviewId}),
      result={reviewId:selectedReviewId,savedSha256:selectedSaved.savedSha256,counts:actual,downloads,browserErrors:errors,
        viewports:[[1440,1040],[390,844]],horizontalOverflow:overflow,...(comparisonResult?{comparison:comparisonResult}:{})};
    await preserve(phasePath,{schema:'starforge.kiwis-operator-phase.v1',inputSha256:phaseSha256,
      originalSavedSha256:originalSaved.savedSha256,result,files:phaseFiles});
    return result;
  }finally{try{await browser?.close();}finally{await workspace.close();}}
}
export async function receiveProgramme(configuration,{baseDirectory=process.cwd()}={}){
  requireValue(configuration?.schema==='starforge.kiwis-receiving-programme.v1','Select the complete original receiving programme.');
  operationId(configuration.operationId);
  for(const key of ['projectDirectory','receivingDirectory','outputDirectory'])
    requireValue(typeof configuration[key]==='string'&&configuration[key].trim(),'Select '+key+'.');
  const projectDirectory=resolve(baseDirectory,configuration.projectDirectory),receivingDirectory=resolve(baseDirectory,configuration.receivingDirectory),
    output=resolve(baseDirectory,configuration.outputDirectory);
  requireValue(projectDirectory!==receivingDirectory,'Select independent original and receiving projects.');
  requireValue(Array.isArray(configuration.sources)&&configuration.sources.length&&Array.isArray(configuration.reviews)&&configuration.reviews.length,
    'Select the complete original source and saved-review programme.');
  requireValue(new Set(configuration.sources.map(s=>s.sourceId)).size===configuration.sources.length&&
    new Set(configuration.reviews.map(s=>s.reviewId)).size===configuration.reviews.length,'Each selected source and review uses one original operation name.');
  await mkdir(output,{recursive:true,mode:0o700});
  const inputSha256=digest(canonical(configuration));
  await preserve(join(output,'programme.json'),configuration);
  const phasePath=join(output,'COMPLETE.json');
  try{
    const previous=await jsonFile(phasePath);
    requireValue(previous.inputSha256===inputSha256,'The original completed receiving programme changed.');
    for(const file of previous.files){const bytes=await readBytes(file.path,LIMIT);requireValue(bytes.length===file.bytes&&digest(bytes)===file.sha256,'An original completed deliverable changed.');}
    return previous;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  let project,received;
  const files=[],sources=[],reviews=[],comparisons=[],reopened=[],operator=[];
  try{
    project=await openWaterQualityProject(projectDirectory);
    for(const selected of configuration.sources){
      operationId(selected.sourceId);
      requireValue(Boolean(selected.captureFile)!==Boolean(selected.selection),'Select one retained source capture or full acquisition selection.');
      const captured=selected.captureFile?await jsonFile(resolve(baseDirectory,selected.captureFile)):
        await acquireCommissioningSource({project,sourceId:operationId(selected.captureId??selected.sourceId),selection:selected.selection,
          onProgress:progress=>process.stderr.write(JSON.stringify({sourceId:selected.sourceId,...progress})+'\n')});
      const capture=captured.schema?captured:importKiWISResponses(captured);
      const summary=await saveCommissioningSource({project,sourceId:selected.sourceId,capture,counterpart:await counterpart(selected.counterpart,baseDirectory)});
      const original=await readCommissioningSource({project,sourceId:selected.sourceId});
      sources.push(summary);files.push(await preserve(join(output,'sources',selected.sourceId+'-kiwis.json'),capture));
      files.push(await preserve(join(output,'sources',selected.sourceId+'-complete-originals.json'),original.source));
    }
    for(const selected of configuration.reviews){
      const {source}=await readCommissioningSource({project,sourceId:selected.sourceId});
      const choices=selected.documentFile?await jsonFile(resolve(baseDirectory,selected.documentFile)):exactChoices(source,selected.choices??{});
      const preview=previewCommissioning(source,choices);
      if(selected.expectedCounts)for(const[key,value]of Object.entries(selected.expectedCounts))
        requireValue(preview.counts[key]===value,'The full original programme differs for '+key+'.');
      const saved=await saveCommissioningReview({project,sourceId:selected.sourceId,reviewId:selected.reviewId,title:selected.title,
        document:preview.document,expectedReviewSha256:preview.reviewSha256});
      reviews.push({reviewId:saved.reviewId,sourceId:saved.sourceId,savedSha256:saved.savedSha256,reviewSha256:saved.review.reviewSha256,counts:saved.review.counts});
      for(const format of COMMISSIONING_FORMATS){
        const file=await exportCommissioningReview({project,reviewId:saved.reviewId,format});
        files.push(await preserve(join(output,'deliverables',saved.reviewId,file.filename),file.bytes));
      }
    }
    // All configured saved editions exist before comparisons, independent of configuration order.
    for(const selected of configuration.reviews.filter(review=>review.previousReviewId)){
      const comparison=await compareCommissioningEditions({project,sourceId:selected.sourceId,reviewId:selected.reviewId,
        previousReviewId:selected.previousReviewId});
      comparisons.push({reviewId:selected.reviewId,previousReviewId:selected.previousReviewId,comparisonSha256:comparison.comparisonSha256,
        changes:comparison.changes.length,reviewComparisonSha256:comparison.reviewComparison.reviewComparisonSha256,
        coverage:comparison.reviewComparison.coverage,countDelta:comparison.reviewComparison.countDelta,
        statusTransitions:comparison.reviewComparison.statusTransitions});
      files.push(await preserve(join(output,'deliverables',selected.reviewId,'complete-edition-comparison.json'),comparison));
    }
    await project.close();project=null;
    if(configuration.browser){
      requireValue(typeof configuration.browser.playwrightModule==='string'&&typeof configuration.browser.chromiumExecutable==='string',
        'Select the installed original Playwright module and Chromium executable.');
      for(const selected of configuration.reviews.filter(review=>review.browser===true)){
        const original=reviews.find(r=>r.reviewId===selected.reviewId);
        const value=await operatorBrowser({projectDirectory,reviewId:selected.reviewId,previousReviewId:selected.previousReviewId,expectedCounts:original.counts,
          output:join(output,'browser',selected.reviewId),configuration:configuration.browser,saveAs:selected.operatorReviewId});
        operator.push(value);
      }
    }
    project=await openWaterQualityProject(projectDirectory);received=await openWaterQualityProject(receivingDirectory);
    for(const reviewId of [...new Set([...reviews.map(r=>r.reviewId),...operator.map(r=>r.reviewId)])]){
      const complete=await exportCommissioningReview({project,reviewId,format:'bundle'}),bundle=JSON.parse(complete.bytes.toString('utf8'));
      const saved=await receiveCommissioningReview({project:received,bundle});
      requireValue(saved.savedSha256===bundle.review.savedSha256,'The independent project must reproduce the complete original edition.');
      for(const format of COMMISSIONING_FORMATS){
        const original=await exportCommissioningReview({project,reviewId,format}),restored=await exportCommissioningReview({project:received,reviewId,format});
        requireValue(Buffer.compare(original.bytes,restored.bytes)===0,'The independent '+format+' differs from its complete original.');
      }
      reopened.push({reviewId,savedSha256:saved.savedSha256,reviewSha256:saved.review.reviewSha256,formats:COMMISSIONING_FORMATS});
    }
    await received.close();received=null;await project.close();project=null;
    received=await openWaterQualityProject(receivingDirectory);
    for(const row of reopened){const actual=await readCommissioningReview({project:received,reviewId:row.reviewId});
      requireValue(actual.savedSha256===row.savedSha256,'Cold reopen must retain the exact original receiving edition.');}
    for(const comparison of comparisons){
      const actual=await compareCommissioningEditions({project:received,reviewId:comparison.reviewId,previousReviewId:comparison.previousReviewId});
      requireValue(actual.comparisonSha256===comparison.comparisonSha256,
        'Cold independent receiving must reproduce the complete saved-review comparison.');
      files.push(await preserve(join(output,'independent-comparisons',comparison.reviewId+'-complete-edition-comparison.json'),actual));
    }
    await received.close();received=null;
    if(configuration.browser){
      const chosen=configuration.reviews.find(review=>review.browser===true);
      if(chosen){
        const original=reviews.find(r=>r.reviewId===chosen.reviewId);
        operator.push(await operatorBrowser({projectDirectory:receivingDirectory,reviewId:chosen.reviewId,previousReviewId:chosen.previousReviewId,expectedCounts:original.counts,
          output:join(output,'browser','independent-receiving'),configuration:configuration.browser}));
      }
    }
    async function inventory(directory){
      for(const entry of await readdir(directory,{withFileTypes:true})){
        const path=join(directory,entry.name);if(entry.isSymbolicLink())throw Error('A receiving output became a symlink.');
        if(entry.isDirectory())await inventory(path);else if(entry.isFile()&&path!==phasePath&&!files.some(row=>row.path===path)){
          const bytes=await readBytes(path,LIMIT);files.push({path,filename:entry.name,bytes:bytes.length,sha256:digest(bytes)});
        }
      }
    }
    await preserve(join(output,'operator-receiving.json'),{operator,reopened});
    await inventory(output);
    const result={schema:'starforge.kiwis-receiving-result.v1',status:'COMPLETE',operationId:configuration.operationId,inputSha256,
      projectDirectory,receivingDirectory,sources,reviews,comparisons,reopened,operator,files,completeFormats:COMMISSIONING_FORMATS};
    await preserve(phasePath,result);return result;
  }finally{try{await project?.close();}finally{await received?.close();}}
}
export async function main(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{programme:{type:'string'},help:{type:'boolean'}}});
  if(values.help||!values.programme){process.stdout.write('node kiwis/receiving.mjs --programme complete-programme.json\n');return;}
  const path=resolve(values.programme),result=await receiveProgramme(await jsonFile(path),{baseDirectory:dirname(path)});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'KIWIS_RECEIVING',message:error.message})+'\n');process.exitCode=1;});
