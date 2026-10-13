#!/usr/bin/env node
// MIT. Operate one complete retained issuer case through the original grant application.
import {readFile,writeFile,mkdir,stat,access} from 'node:fs/promises';
import {dirname,join,resolve,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createRequire} from 'node:module';
import {makeSource,createDraft,retainVersion,validateDraft} from './dist/grant-submission-core.mjs';
import {emptyHandover} from './dist/grant-handover-core.mjs';
import {createSourceBundle,retainSourceBundle,prepareSubmission,comparePrepared,createDraftEnvelope,
  openDraftEnvelope,createReviewerSourcePackage,openReviewerSourcePackage,reviewerSourceFromDraft,
  receiveReviewerSource,verifyHandover,preparedReport,fileBytes} from './dist/grant-handover-source.mjs';
import {planSummary,preparedReview,applyPlanReview} from './dist/grant-plan-core.mjs';
import {choosePlanningUpdate,planningUpdateReviewBasis,finishPlanningUpdate} from './dist/grant-plan-update-core.mjs';
import {receiveIssuerProgrammeFile,reopenIssuerProgramme,issuerOriginal} from './dist/grant-issuer-source.mjs';
import {selectedIssuerContext} from './dist/grant-issuer-core.mjs';
import {ISSUER_PROFILE_SCHEMA,receiveIssuerContext} from './grant-issuer-context.mjs';
import {startSetupServer} from './serve.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const REPO=resolve(HERE,'../..');
const NATIVE_SOURCE=join(REPO,'stellar/scf_2026/sf47_budget_model/workspace');
const SCHEMA='stellar-forge.grant-issuer-receiving.v1';
const ACTOR='SCF application receiving operator';
const REVIEW_NOTE='Retain the original acknowledgement and explicit Open Track proposal while the delivery answer follows its reviewed native plan.';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(condition,message)=>{if(!condition)throw new Error(message);};
const clone=value=>JSON.parse(JSON.stringify(value));
const codecs={
  digest:async bytes=>sha(bytes),
  inflate:async(bytes,maximum)=>new Uint8Array(inflateRawSync(bytes,{maxOutputLength:maximum})),
  decode:bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),
  encode:text=>new TextEncoder().encode(text),
};
const now=()=>new Date().toISOString();
async function exists(path){try{await access(path);return true;}catch{return false;}}
async function put(path,value,{replace=false}={}){
  const bytes=typeof value==='string'?Buffer.from(value):value instanceof Uint8Array?Buffer.from(value):Buffer.from(JSON.stringify(value,null,2)+'\n');
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  await writeFile(path,bytes,{flag:replace?'w':'wx',mode:0o600});
  return {path:basename(path),bytes:bytes.length,sha256:sha(bytes)};
}
function native(command,args,{cwd=NATIVE_SOURCE}={}){
  const run=spawnSync(command,args,{cwd,encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000});
  if(run.error)throw run.error;
  need(run.status===0,'Original command failed: '+command+' '+args.slice(0,3).join(' ')+'\n'+run.stderr+'\n'+run.stdout);
  return run.stdout.trim();
}
function selectedProfile(title,note,receivePlan=true){
  return {schema:ISSUER_PROFILE_SCHEMA,title,actor:ACTOR,note,sourceUrl:'',receivePlan};
}
function observe(received){
  const document=received.selectedTerms.edition.document;
  return {stage:document.stage,proposalTrack:document.proposalTrack,issuerTrack:document.issuerTrack,award:document.award,
    termsRevision:received.selection.revision,selectedPlanRevision:received.document.program.planRevision,
    currentPlanRevision:received.planSource.document.currentRevision,sourceFiles:received.document.sources.length,
    messages:received.correspondence.map(row=>({sourceId:row.source.id,subject:row.edition.inspection.metadata.subject,
      bytes:row.edition.inspection.original.bytes,sha256:row.edition.inspection.original.sha256}))};
}

const NATIVE_PROGRAMME="import hashlib, io, json, os, sys, zipfile\nfrom pathlib import Path\nargs = json.loads(sys.argv[1])\nsource = Path(args[\"nativeSource\"])\nsys.path.insert(0, str(source))\nfrom model import Workspace\nfrom operations import Operations\n\ndef put(name, raw):\n    path = Path(args[\"out\"]) / name\n    with open(path, \"xb\") as target:\n        os.chmod(path, 0o600)\n        target.write(raw)\n    return {\"path\": name, \"bytes\": len(raw), \"sha256\": hashlib.sha256(raw).hexdigest()}\n\nraw = Path(args[\"case\"]).read_bytes()\nwith zipfile.ZipFile(io.BytesIO(raw)) as archive:\n    selection = json.loads(archive.read(\"award-terms-selection.json\"))\nworkspace = Workspace(Path(args[\"workspace\"]), source.parent / \"sf10_current_candidate.json\")\noperations = Operations(workspace)\ntry:\n    receipt = operations.import_bundle(raw, \"Issuer programme for prepared application\",\n        \"issuer-application-native-import\", args[\"actor\"])\n    replay = operations.import_bundle(raw, \"Issuer programme for prepared application\",\n        \"issuer-application-native-import\", args[\"actor\"])\n    if replay != receipt:\n        raise RuntimeError(\"The original case import changed on the same request replay.\")\n    state = operations.read(receipt[\"id\"])\n    terms = operations.award_terms(receipt[\"id\"], selection[\"id\"])\n    revisions = sorted(row[\"revision\"] for row in terms[\"history\"])\n    if len(revisions) < 2:\n        raise RuntimeError(\"This whole receiving programme uses the complete original case with two saved issuer interpretations.\")\n    first = operations.export_award_terms(receipt[\"id\"], selection[\"id\"], revisions[0], state[\"program\"][\"version\"])\n    first_file = put(\"issuer-edition-1.zip\", first)\n    current = workspace.read(receipt[\"planId\"])\n    working = workspace.save(receipt[\"planId\"], current[\"currentRevision\"],\n        {\"scenario_name\": current[\"scenario\"][\"scenario_name\"][:440] + \" — working application alignment\"},\n        current[\"planning\"],\n        \"Retain an unapplied working planning edition while the Operations case keeps its reviewed selection.\",\n        \"issuer-application-working-native-plan\")\n    selected = operations.read(receipt[\"id\"])\n    if selected[\"program\"][\"planRevision\"] != state[\"program\"][\"planRevision\"]:\n        raise RuntimeError(\"A working native plan changed the original Operations selection.\")\n    if working[\"revision\"] <= selected[\"program\"][\"planRevision\"]:\n        raise RuntimeError(\"The original writer did not retain the newer working native revision.\")\n    second = operations.export_award_terms(receipt[\"id\"], selection[\"id\"], revisions[-1], selected[\"program\"][\"version\"])\n    second_file = put(\"issuer-edition-2.zip\", second)\n    result = {\"caseId\": receipt[\"id\"], \"caseVersion\": selected[\"program\"][\"version\"],\n        \"planId\": receipt[\"planId\"], \"selectedPlanRevision\": selected[\"program\"][\"planRevision\"],\n        \"workingPlanRevision\": working[\"revision\"], \"termsId\": selection[\"id\"],\n        \"termsRevisions\": revisions, \"importReplay\": True, \"sources\": len(selected[\"sources\"]),\n        \"files\": [first_file, second_file],\n        \"workingEdition\": {\"revision\": working[\"revision\"], \"contentSha256\": working[\"contentSha256\"],\n            \"note\": working[\"note\"]}}\nfinally:\n    workspace.close()\nreopened = Workspace(Path(args[\"workspace\"]), source.parent / \"sf10_current_candidate.json\")\ntry:\n    current = Operations(reopened).read(result[\"caseId\"])\n    if current[\"program\"][\"planRevision\"] != result[\"selectedPlanRevision\"]:\n        raise RuntimeError(\"The reopened native case changed its selected plan.\")\n    result[\"nativeReopened\"] = True\nfinally:\n    reopened.close()\nput(\"native-receiving.json\", (json.dumps(result, ensure_ascii=False, indent=2) + \"\\n\").encode())\nprint(json.dumps(result, ensure_ascii=False))\n";

export async function operateIssuerApplication({casePath,out,nativeSource=NATIVE_SOURCE}){
  const startedAt=now();
  need((await stat(casePath)).isFile(),'Open the complete original issuer Operations case.');
  await mkdir(dirname(out),{recursive:true,mode:0o700});await mkdir(out,{mode:0o700});
  const raw=new Uint8Array(await readFile(casePath));
  const input=await put(join(out,'original-issuer-case.zip'),raw);
  const firstReceived=await receiveIssuerProgrammeFile(raw,{filename:basename(casePath),receivedAt:startedAt,planningOptions:codecs});
  const originalObservation=observe(firstReceived);
  need(originalObservation.stage==='INTEREST_ACKNOWLEDGED'&&originalObservation.proposalTrack==='OPEN'&&
    originalObservation.issuerTrack===null&&originalObservation.award===null,
    'Operate the retained interest acknowledgement and its actual Open Track proposal.');
  const workspace=join(out,'native-workspace');
  native(process.env.PYTHON||'python3',['cli.py','init','--workspace',workspace],{cwd:nativeSource});
  native(process.env.PYTHON||'python3',['-c',NATIVE_PROGRAMME,JSON.stringify({nativeSource,
    case:join(out,'original-issuer-case.zip'),out,workspace,actor:ACTOR})],{cwd:nativeSource});
  const nativeResult=JSON.parse(await readFile(join(out,'native-receiving.json'),'utf8'));
  const originalNames=['application.md','source-index.json','budget.csv','product-and-finance.md'];
  const original=await Promise.all(originalNames.map(name=>readFile(join(HERE,'dist/grant-data',name))));
  const index=JSON.parse(original[1].toString('utf8'));
  const sourceUrl='https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/developer-site/dist/grant-data/application.md';
  const source=makeSource({markdown:original[0].toString('utf8'),index,url:sourceUrl,receivedAt:startedAt});
  let draft=createDraft(source,{id:'issuer-application-'+randomUUID(),title:'SCF issuer context and prepared application',now:startedAt});
  const bundle=await createSourceBundle(source,{indexBytes:original[1],budgetBytes:original[2],companionBytes:original[3],receivedAt:startedAt});
  draft=retainSourceBundle(draft,bundle,{at:startedAt});
  draft=retainVersion(draft,'Before recording application receiving context');
  draft.answers.find(row=>row.id==='project').note=REVIEW_NOTE;
  draft.handover||=emptyHandover();draft.handover.selection.actor=ACTOR;
  await put(join(out,'baseline-draft.json'),await createDraftEnvelope(draft,{planningOptions:codecs}));
  for(let index=0;index<originalNames.length;index++)await put(join(out,'reviewer-source',originalNames[index]),original[index]);
  const profileA=selectedProfile('Original issuer interpretation',REVIEW_NOTE);
  const profileB=selectedProfile('Reviewed issuer interpretation and selected plan',
    'Receive the later retained interpretation while keeping the original case-selected native plan and complete earlier context.');
  await put(join(out,'issuer-profile-1.json'),profileA);await put(join(out,'issuer-profile-2.json'),profileB);
  const rawA=new Uint8Array(await readFile(join(out,'issuer-edition-1.zip')));
  const first=await receiveIssuerContext(draft,rawA,profileA,{filename:'issuer-edition-1.zip',planningOptions:codecs});
  draft=first.draft;
  need(draft.planningReview.revision===nativeResult.selectedPlanRevision,'Receive the original case-selected native revision.');
  const sourceA=draft.planSources.find(row=>row.sha256===draft.planningReview.sourceSha);
  draft=retainVersion(draft,'Before applying the reviewed original plan to Delivery');
  draft.planningReview=preparedReview(sourceA,draft.planningReview);
  draft.planningReview.note='Reviewed the complete native budget, work packages, timing and original issuer context.';
  draft.planningReview.summaryReviewed=true;
  draft=applyPlanReview(draft,{kind:'answer',id:'delivery',mode:'replace'});
  Object.assign(draft.handover.selection,{title:'Application with original issuer interpretation',actor:ACTOR,note:REVIEW_NOTE});
  const preparedA=await prepareSubmission(draft,{planningOptions:codecs});draft=preparedA.draft;
  const frozenA=JSON.stringify(preparedA.edition);
  await put(join(out,'prepared-edition-1.json'),await createDraftEnvelope(draft,{planningOptions:codecs}));
  await put(join(out,'prepared-edition-1.html'),preparedReport(draft,preparedA.edition.id));
  const rawB=new Uint8Array(await readFile(join(out,'issuer-edition-2.zip')));
  const second=await receiveIssuerContext(draft,rawB,profileB,{filename:'issuer-edition-2.zip',planningOptions:codecs});
  draft=second.draft;
  need(draft.planningUpdate?.status==='reviewing','Use the existing complete native-plan update review.');
  need(draft.planningUpdate.to.revision===nativeResult.selectedPlanRevision&&
    second.received.planSource.document.currentRevision===nativeResult.workingPlanRevision,
    'Keep the newer working revision separate from the reviewed case selection.');
  for(const row of draft.planningUpdate.targets)
    choosePlanningUpdate(draft,row.key,'incoming',{note:'Receive the complete scope of the native case-selected plan.'});
  draft.planningUpdate.note='Reviewed the original case selection against the retained newer working planning edition and unchanged project context.';
  draft.planningUpdate.reviewedBasis=planningUpdateReviewBasis(draft.planningUpdate);
  draft=retainVersion(draft,'Before applying the reviewed issuer plan selection');
  finishPlanningUpdate(draft);
  validateDraft(draft);
  need(draft.planningReview.revision===nativeResult.selectedPlanRevision,'The prepared application chose the wrong native revision.');
  need(draft.answers.find(row=>row.id==='project').note===REVIEW_NOTE,'Retain the operator’s original application note.');
  need(JSON.stringify(draft.handover.editions.find(row=>row.id===preparedA.edition.id))===frozenA,'The first prepared issuer context changed.');
  const comparison=comparePrepared(draft,preparedA.edition.id);
  need(comparison.context.some(row=>row.key==='issuerProgramme'),'Retain the complete comparison between issuer contexts.');
  Object.assign(draft.handover.selection,{title:'Application with reviewed issuer interpretation',note:profileB.note});
  const preparedB=await prepareSubmission(draft,{planningOptions:codecs});draft=preparedB.draft;
  need(preparedA.edition.body.issuerProgrammeId===first.context.id&&preparedB.edition.body.issuerProgrammeId===second.context.id,
    'Each prepared edition must freeze its own original issuer reception.');
  const sourcePackage=await createReviewerSourcePackage(await reviewerSourceFromDraft(draft,draft.handover.selection.bundleId));
  const incoming=await openReviewerSourcePackage(sourcePackage);
  draft=await receiveReviewerSource(draft,incoming,{planningOptions:codecs});
  need(draft.handover.issuerProgrammes.length===2&&draft.answers.find(row=>row.id==='project').note===REVIEW_NOTE,
    'Original source-package receiving must preserve the issuer context and application edits.');
  const envelope=await createDraftEnvelope(draft,{planningOptions:codecs});
  const reopened=await openDraftEnvelope(envelope,{planningOptions:codecs});
  need(JSON.stringify(reopened)===JSON.stringify(draft),'The complete editable application changed when reopened.');
  const selected=selectedIssuerContext(reopened),received=await reopenIssuerProgramme(reopened,selected.id,{planningOptions:codecs});
  need(sha(fileBytes(reopened,first.context.body.file.sha256))===sha(rawA)&&
    sha(fileBytes(reopened,second.context.body.file.sha256))===sha(rawB),'Retain both complete original issuer cases.');
  const messages=[];
  for(const correspondence of received.correspondence){
    const originalPart=correspondence.edition.selected.find(row=>row.path==='original');
    const returned=issuerOriginal(received,originalPart.source.id);
    need(sha(returned.bytes)===originalPart.source.sha256,'The reopened original correspondence changed.');
    messages.push({sourceId:returned.metadata.id,bytes:returned.bytes.length,sha256:sha(returned.bytes)});
  }
  const savedDraft=await put(join(out,'prepared-application.json'),envelope);
  await put(join(out,'source-package.json'),sourcePackage);
  await put(join(out,'prepared-edition-2.html'),preparedReport(reopened,preparedB.edition.id));
  await put(join(out,'prepared-comparison.json'),comparison);
  const cliOut=join(out,'portable-handover');
  native(process.execPath,[join(HERE,'grant-export.mjs'),'--draft',join(out,'prepared-application.json'),
    '--issuer-context',second.context.id,'--out',cliOut],{cwd:REPO});
  const exported=await openDraftEnvelope(await readFile(join(cliOut,'draft.json'),'utf8'),{planningOptions:codecs});
  const manifest=JSON.parse(await readFile(join(cliOut,'manifest.json'),'utf8'));
  for(const file of manifest.files){
    const bytes=await readFile(join(cliOut,file.path));
    need(bytes.length===file.bytes&&sha(bytes)===file.sha256,'The complete handover changed: '+file.path);
  }
  need(sha(await readFile(join(cliOut,'issuer-programme.zip')))===sha(rawB),'The exporter changed the selected original issuer case.');
  need(sha(await readFile(join(cliOut,'issuer-native-planning.zip')))===selected.body.plan.fileSha256,
    'The exporter changed the complete original native planning archive.');
  const cliReceiveOut=join(out,'cli-received-handover');
  native(process.execPath,[join(HERE,'grant-export.mjs'),'--draft',join(out,'baseline-draft.json'),
    '--receive-issuer-case',join(out,'issuer-edition-2.zip'),'--issuer-profile',join(out,'issuer-profile-2.json'),
    '--out',cliReceiveOut],{cwd:REPO});
  const cliReceived=await openDraftEnvelope(await readFile(join(cliReceiveOut,'draft.json'),'utf8'),{planningOptions:codecs});
  need(cliReceived.planningReview.revision===nativeResult.selectedPlanRevision&&
    selectedIssuerContext(cliReceived).body.selection.revision===nativeResult.termsRevisions.at(-1),
    'The CLI must receive the selected original terms and native planning revision.');
  const summary=planSummary(received.planSource,selected.body.plan.revision);
  const result={schema:SCHEMA,status:'NATIVE_COMPLETE',startedAt,completedAt:now(),
    originalCase:input,originalObservation,native:nativeResult,application:{id:reopened.id,sourceSha256:reopened.currentSource,
      issuerContexts:reopened.handover.issuerProgrammes.map(row=>({id:row.id,termsRevision:row.body.selection.revision,
        planRevision:row.body.plan.revision,stage:row.body.document.stage,proposalTrack:row.body.document.proposalTrack,
        issuerTrack:row.body.document.issuerTrack,award:row.body.document.award})),
      preparedEditions:[preparedA.edition.id,preparedB.edition.id],savedVersions:reopened.versions.length,
      selectedPlanRevision:reopened.planningReview.revision,retainedWorkingRevision:nativeResult.workingPlanRevision,
      workPackages:summary.costs.length,amountUsd:summary.amount,awardRequestUsd:summary.award,hours:summary.hours,durationDays:summary.duration,
      manualNoteRetained:true,sourcePackageReceived:true,wholeDraftReopened:true,preparedComparisonRetained:true,
      originalMessages:messages,savedDraft},
    handover:{files:manifest.files.length+1,selectedIssuerSha256:sha(rawB),draftId:exported.id,
      sourcePackage:await put(join(out,'source-package-reopened.json'),await createReviewerSourcePackage(await reviewerSourceFromDraft(exported,exported.handover.selection.bundleId))),
      cliReceivingSelectedRevision:cliReceived.planningReview.revision},
    browser:{status:'PENDING',programme:'Use --resume-browser with this same output directory.'}};
  await put(join(out,'ISSUER_APPLICATION_RECEIVING.json'),result);
  process.stdout.write(JSON.stringify({phase:'issuer-application-native-complete',result:join(out,'ISSUER_APPLICATION_RECEIVING.json'),
    caseId:nativeResult.caseId,contexts:result.application.issuerContexts.length,prepared:result.application.preparedEditions.length,
    selectedPlanRevision:result.application.selectedPlanRevision,workingPlanRevision:result.application.retainedWorkingRevision,
    handoverFiles:result.handover.files})+'\n');
  return result;
}

async function playwright(){
  const require=createRequire(import.meta.url);
  const paths=[REPO,process.env.PLAYWRIGHT_NODE_MODULES,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,
    '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules'].filter(Boolean);
  for(const name of ['playwright','playwright-core']){
    try{return require(require.resolve(name,{paths}));}catch{}
  }
  throw new Error('Use the existing installation’s Playwright or playwright-core dependency for the complete browser continuation.');
}
export async function operateIssuerApplicationBrowser({out}){
  const resultPath=join(out,'ISSUER_APPLICATION_RECEIVING.json');
  const result=JSON.parse(await readFile(resultPath,'utf8'));
  need(result.schema===SCHEMA&&['NATIVE_COMPLETE','COMPLETE'].includes(result.status),'Open the original completed native receiving output.');
  const originalA=await openDraftEnvelope(await readFile(join(out,'prepared-edition-1.json'),'utf8'),{planningOptions:codecs});
  const rawB=new Uint8Array(await readFile(join(out,'issuer-edition-2.zip')));
  const sourceB=await receiveIssuerProgrammeFile(rawB,{filename:'issuer-edition-2.zip',planningOptions:codecs});
  const {chromium}=await playwright();
  let executablePath=process.env.CHROMIUM_EXECUTABLE_PATH||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if(!executablePath){
    const candidates=[chromium.executablePath(),
      '/dev/mpi-organisation-94fe-20261012-r1/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell'];
    for(const candidate of candidates)if(await exists(candidate)){executablePath=candidate;break;}
  }
  need(executablePath&&await exists(executablePath),'Select the installed Chromium executable for the original application.');
  const server=await startSetupServer({port:0,entry:'/grant-submission.html'});
  let browser,context;const views=[],errors=[];
  const mark=(name,value={})=>{const row={name,at:now(),...value};views.push(row);process.stdout.write(JSON.stringify({phase:'issuer-application-browser',...row})+'\n');};
  try{
    browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    const settled=async()=>{
      await page.waitForFunction(()=>document.querySelector('#workspace-root')?.dataset.draftId&&
        !document.querySelector('#workspace-root').inert,{},{timeout:30000});
      const error=await page.locator('#error').evaluate(node=>node.hidden?'':node.textContent);
      need(!error,error);need(!errors.length,errors.join('\n'));
    };
    const openDraft=async file=>{
      await page.locator('#import-draft').click();await page.locator('#file-input').setInputFiles(file);await settled();
    };
    await page.goto(server.url,{waitUntil:'domcontentloaded'});await settled();
    mark('Original nine-answer application');
    await openDraft(join(out,'prepared-edition-1.json'));
    await page.locator('#view').selectOption('handover');await settled();
    mark('Original prepared issuer context');
    await page.getByRole('button',{name:'Review retained programme and sources',exact:true}).click();await settled();
    need((await page.locator('#editor').textContent()).includes('INTEREST ACKNOWLEDGED'),'Show the original observed issuer stage.');
    mark('Retained correspondence and terms history');
    await page.locator('[data-issuer-programme-file="native"]').setInputFiles(join(out,'issuer-edition-2.zip'));await settled();
    await page.getByLabel('Issuer context title',{exact:true}).fill('Browser receiving of reviewed issuer context');
    await page.getByLabel('Issuer context operator',{exact:true}).fill(ACTOR);
    await page.getByLabel('Issuer context reception note',{exact:true}).fill(REVIEW_NOTE);
    await page.getByRole('button',{name:'Review original programme',exact:true}).click();await settled();
    mark('Complete incoming issuer interpretation');
    await page.getByRole('button',{name:'Record issuer programme',exact:true}).click();await settled();
    await page.getByRole('button',{name:'Receive selected native plan',exact:true}).click();await settled();
    await page.locator('#view').selectOption('planning');await settled();
    const choices=page.locator('[data-plan-update-target] select');
    need(await choices.count()>0,'Open the original complete planning update choices.');
    for(let index=0;index<await choices.count();index++)await choices.nth(index).selectOption('incoming');
    await page.getByLabel('I have reviewed the exact chosen answers, native budget changes and related application context.',{exact:true}).check();
    await page.getByRole('button',{name:'Apply reviewed revision choices',exact:true}).click();await settled();
    mark('Original reviewed native plan update');
    await page.locator('#view').selectOption('handover');await settled();
    await page.getByLabel('Prepared edition title',{exact:true}).fill('Browser-prepared issuer application');
    await page.getByRole('button',{name:'Prepare this exact edition',exact:true}).click();await settled();
    await page.locator('#save').click();await settled();
    const savedId=await page.locator('#workspace-root').getAttribute('data-saved-draft-id');
    need(savedId,'Save through the original browser draft store.');
    mark('Prepared edition and original browser save',{savedId});
    await page.reload({waitUntil:'domcontentloaded'});await settled();
    await page.locator('#view').selectOption('saved');await settled();
    await page.waitForFunction(id=>[...document.querySelectorAll('[data-saved-draft-id]')].some(node=>node.dataset.savedDraftId===id&&node.querySelector('button')),savedId,{timeout:30000});
    const card=page.locator('[data-saved-draft-id="'+savedId+'"]').filter({has:page.getByRole('button',{name:'Open this draft',exact:true})});
    await card.getByRole('button',{name:'Open this draft',exact:true}).click();await settled();
    await page.locator('#view').selectOption('handover');await settled();
    mark('Reloaded original saved draft');
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#export-draft').click();const download=await downloadPromise;
    const downloadedPath=join(out,'browser-prepared-application.json');await download.saveAs(downloadedPath);await settled();
    const reopened=await openDraftEnvelope(await readFile(downloadedPath,'utf8'),{planningOptions:codecs});
    need(reopened.handover.issuerProgrammes.length===2&&reopened.planningReview.revision===result.native.selectedPlanRevision,
      'The original browser export must preserve both issuer contexts and its selected native plan.');
    need(reopened.answers.find(row=>row.id==='project').note===REVIEW_NOTE,'The browser receiving flow changed the retained application note.');
    need(JSON.stringify(reopened.handover.editions.find(row=>row.id===originalA.handover.editions[0].id))===
      JSON.stringify(originalA.handover.editions[0]),'The browser flow changed the earlier prepared edition.');
    const selected=selectedIssuerContext(reopened),exact=await reopenIssuerProgramme(reopened,selected.id,{planningOptions:codecs});
    need(exact.sha256===sourceB.sha256,'The browser export changed the complete original issuer case.');
    await page.getByRole('button',{name:'Review retained programme and sources',exact:true}).click();await settled();
    const sourceDownload=page.waitForEvent('download');
    const originalButton=page.getByRole('button',{name:'Download original message',exact:true}).first();
    await originalButton.locator('xpath=ancestor::details').evaluateAll(nodes=>nodes.forEach(node=>{node.open=true;}));
    await originalButton.click();const originalFile=await sourceDownload;
    const originalPath=join(out,'browser-original-message.eml');await originalFile.saveAs(originalPath);
    const expected=exact.correspondence[0].edition.selected.find(row=>row.path==='original').source;
    need(sha(await readFile(originalPath))===expected.sha256,'The browser changed the original correspondence download.');
    mark('Whole application and original correspondence reopened');
    for(const view of ['answers','planning','handover','history']){
      await page.locator('#view').selectOption(view);await settled();
      mark('Desktop '+view,{width:1440});
    }
    await page.setViewportSize({width:390,height:844});
    for(const view of ['answers','planning','handover','history']){
      await page.locator('#view').selectOption(view);await settled();
      const extent=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      need(extent.scroll<=extent.width+2,'Keep the complete '+view+' view within the phone viewport.');
      mark('Phone '+view,{...extent});
    }
    await verifyHandover(reopened,{planningOptions:codecs});
    result.status='COMPLETE';
    result.browser={status:'COMPLETE',completedAt:now(),views,errors,draftId:reopened.id,savedId,
      issuerContexts:reopened.handover.issuerProgrammes.length,selectedPlanRevision:reopened.planningReview.revision,
      preparedEditions:reopened.handover.editions.length,originalMessageSha256:expected.sha256,
      downloadedDraft:{bytes:(await stat(downloadedPath)).size,sha256:sha(await readFile(downloadedPath))}};
    await put(resultPath,result,{replace:true});
    process.stdout.write(JSON.stringify({phase:'issuer-application-complete',result:resultPath,views:views.length,
      selectedPlanRevision:reopened.planningReview.revision,issuerContexts:reopened.handover.issuerProgrammes.length})+'\n');
    return result;
  }catch(error){
    result.browser={status:'INTERRUPTED',at:now(),views,errors,issue:error.stack||error.message};
    await put(resultPath,result,{replace:true});throw error;
  }finally{
    if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});await server.stop();
  }
}
export async function runCLI(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{case:{type:'string'},out:{type:'string'},'native-source':{type:'string'},browser:{type:'boolean'},
    'resume-browser':{type:'boolean'},help:{type:'boolean'}},allowPositionals:false});
  if(values.help){process.stdout.write('Operate the original issuer case through the existing prepared application.\n\n'+
    'node GRANT_ISSUER_RECEIVING.mjs --case /private/complete-issuer-case.zip --out /private/new-receiving\n'+
    'node GRANT_ISSUER_RECEIVING.mjs --out /private/new-receiving --resume-browser\n'+
    'Use --browser for one uninterrupted native and browser operation. Native outputs are written before browser work.\n');return;}
  need(values.out,'Select one private output directory.');
  const out=resolve(values.out);
  if(values['resume-browser'])return operateIssuerApplicationBrowser({out});
  need(values.case,'Supply the complete original issuer Operations ZIP.');
  const result=await operateIssuerApplication({casePath:resolve(values.case),out,nativeSource:values['native-source']?resolve(values['native-source']):NATIVE_SOURCE});
  return values.browser?operateIssuerApplicationBrowser({out}):result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  runCLI().catch(error=>{process.stderr.write((error.stack||error.message)+'\n');process.exitCode=1;});
