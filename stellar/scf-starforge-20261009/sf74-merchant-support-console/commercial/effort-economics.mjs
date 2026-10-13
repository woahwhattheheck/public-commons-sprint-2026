// MIT. Saved commercial Installation effort to original SF74 private economics.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,resolve,isAbsolute} from 'node:path';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {privateDirectory} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {canonical,jsonBytes,sha256,commercialError} from '../commercial-pricing.mjs';
import {emptyCommercialEconomicsInput,normalizeCommercialEconomicsInput,reviewCommercialEconomics} from './economics.mjs';
import {inspectEconomicsCase} from './economics-receiving.mjs';

export const EFFORT_ECONOMICS_SCHEMA='stellar-forge.merchant-effort-economics-handoff.v1';
const HASH=/^[a-f0-9]{64}$/,MAX=32*1024*1024;
const helper=fileURLToPath(new URL('../../../scf_2026/sf47_budget_model/workspace/commercial_effort_handoff.py',import.meta.url));
const copy=value=>JSON.parse(JSON.stringify(value));
const fail=message=>{throw commercialError('COMMERCIAL_EFFORT_ECONOMICS',message,409);};
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const same=(a,b,message)=>{if(canonical(a)!==canonical(b))fail(message);};
function absolute(value){
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/')
    fail('Use an absolute normalized private path.');
  return value;
}
function selection(args){
  if(!HASH.test(args.archiveSha256??'')||!HASH.test(args.installationSha256??'')||
    !HASH.test(args.reportSha256??'')||!Number.isSafeInteger(args.installationRevision)||
    args.installationRevision<1||typeof args.installationId!=='string'||!args.installationId)
    fail('Select the complete archive, saved Installation revision and report SHA-256.');
  if(!['RECORDED','PROJECTED'].includes(args.hoursBasis)||!['UNKNOWN','REUSE_SELECTED_PLAN'].includes(args.costBasis))
    fail('Explicitly select RECORDED or PROJECTED hours and UNKNOWN or REUSE_SELECTED_PLAN cost assumptions.');
  return {archiveSha256:args.archiveSha256,installationId:args.installationId,
    installationRevision:args.installationRevision,installationSha256:args.installationSha256,
    reportSha256:args.reportSha256,hoursBasis:args.hoursBasis,costBasis:args.costBasis};
}
async function runVerifier(args,archive){
  const argv=['-B',helper,'--archive',archive,'--sha256',args.archiveSha256,
    '--installation',args.installationId,'--revision',String(args.installationRevision),
    '--installation-sha',args.installationSha256,'--report-sha',args.reportSha256];
  if(args.signal?.aborted)throw args.signal.reason??new Error('Cancelled.');
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(args.python??'python3',argv,{env:args.environment??process.env,
      stdio:['ignore','pipe','pipe'],windowsHide:true});
    const output=[],errors=[];let size=0,errorSize=0,failure=null,closed=false,killTimer;
    const stop=error=>{
      failure??=error;
      if(!closed){child.kill('SIGTERM');killTimer??=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},5000);}
    };
    const abort=()=>stop(args.signal.reason??new Error('Cancelled.'));
    args.signal?.addEventListener('abort',abort,{once:true});
    if(args.signal?.aborted)abort();
    const timeout=setTimeout(()=>stop(new Error('The original full ZIP verifier exceeded five minutes.')),300000);
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>MAX)stop(new Error('The complete verifier result exceeds 32 MiB.'));else output.push(chunk);});
    child.stderr.on('data',chunk=>{errorSize+=chunk.length;if(errorSize<=1024*1024)errors.push(chunk);else stop(new Error('The verifier error output exceeds its bound.'));});
    child.on('error',error=>{failure??=error;});
    child.on('close',(code,signal)=>{
      closed=true;clearTimeout(timeout);clearTimeout(killTimer);args.signal?.removeEventListener('abort',abort);
      if(failure)return reject(failure);
      if(code!==0)return reject(commercialError('COMMERCIAL_EFFORT_VERIFY_FAILED',
        'Original native ZIP receiving failed: '+Buffer.concat(errors).toString('utf8').slice(0,4000)+
        (signal?' (signal '+signal+')':''),409));
      try{resolvePromise(JSON.parse(decode(Buffer.concat(output))));}catch(error){reject(error);}
    });
  });
}
async function readExact(path,descriptor){
  const body=await readPrivateFile(path,descriptor.bytes);
  if(body.length!==descriptor.bytes||sha256(body)!==descriptor.sha256)fail('A complete retained handoff member changed.');
  return body;
}
function compare(planned,review,effort,selected){
  // These are the original engine's exact results; no second cost calculator.
  return {schema:'stellar-forge.merchant-effort-economics-comparison.v1',
    hoursBasis:selected.hoursBasis,costBasis:selected.costBasis,
    planned:{assessmentId:planned.id,assessmentSha256:planned.sha256,
      hours:planned.review.input.implementation.hours,
      implementation:copy(planned.review.implementation),care:copy(planned.review.care),capacity:copy(planned.review.capacity)},
    observed:{reportSha256:effort.reportSha256,asOfDate:effort.asOfDate,
      readyForPlanning:effort.readyForPlanning,summary:copy(effort.summary),
      phases:copy(effort.phases),findings:copy(effort.findings)},
    selected:{hours:review.input.implementation.hours,reviewSha256:review.reviewSha256,
      implementation:copy(review.implementation),care:copy(review.care),capacity:copy(review.capacity),
      issues:copy(review.issues)},
    meaning:selected.hoursBasis==='RECORDED'
      ?'Recorded work is incomplete cost-to-date with remaining effort shown separately. Quote fee less selected effort cost is a planning contribution scenario, not recognized revenue or realized profit.'
      :'Recorded work plus reviewed remaining implementation effort, under the selected original saved source coverage. Quote fee less selected effort cost is a planning contribution scenario, not recognized revenue or realized profit.',
    costMeaning:selected.costBasis==='UNKNOWN'
      ?'All cash cost, planning valuation, care effort and care capacity inputs start unknown.'
      :'Costs, labor valuation, care and capacity are copied planning assumptions from the selected assessment, not recorded expenditure.'};
}
function deriveInput(planning,native,selected){
  const report=native.report,binding=report.commercial,plan=planning.assessment;
  if(report.sourceKind!=='COMMERCIAL'||report.reportSha256!==selected.reportSha256||
    binding?.quoteId!==planning.quote.id||binding?.quoteSha256!==planning.quote.sha256||
    binding?.caseId!==plan.review.quote.originCaseId)
    fail('The complete saved effort must belong to the exact original quotation and origin case.');
  if(selected.hoursBasis==='PROJECTED'&&(report.readyForPlanning!==true||
    native.current?.available!==true||native.current.selectedRecordsChanged!==false))
    fail('Projected hours require complete remaining reviews and a current saved Installation selection.');
  const hours=selected.hoursBasis==='RECORDED'?report.summary.recordedHours:report.summary.projectedTotalHours;
  if(typeof hours!=='string'||!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(hours))
    fail('The selected effort basis has no exact known nonnegative hours.');
  const input=selected.costBasis==='REUSE_SELECTED_PLAN'?copy(plan.review.input):
    emptyCommercialEconomicsInput(planning.quote,{asOfDate:report.asOfDate});
  input.asOfDate=report.asOfDate;input.implementation.hours=hours;
  const attribution='Original SF47 Installation '+selected.installationId+' revision '+selected.installationRevision+
    '; edition '+selected.installationSha256+'; report '+selected.reportSha256+
    '; full ZIP '+selected.archiveSha256+'; hours '+selected.hoursBasis+
    '; cost assumptions '+selected.costBasis+'; planning assessment '+plan.id+' / '+plan.sha256+
    '; original commercial case '+binding.caseId+'; family '+binding.caseKey+
    '; scope '+binding.scopeSha256+'; acceptance '+binding.acceptanceId+' / '+binding.acceptanceSha256+
    '; original source '+binding.sourceId+' / '+binding.sourceSha256+'.';
  input.note=(input.note?input.note+'\n\n':'')+attribution;
  normalizeCommercialEconomicsInput(input);
  return {input,report,binding,plan};
}
/** Retains the full ZIP and verifies it natively every time. Only preview is called. */
export async function prepareEffortEconomics(args){
  const selected=selection(args),directory=absolute(args.directory);
  await privateDirectory(directory);
  const request={schema:EFFORT_ECONOMICS_SCHEMA+'.selection',caseId:args.id,caseRevision:args.revision,
    quoteId:args.quoteId,quoteSha256:args.quoteSha256,assessmentId:args.assessmentId,
    assessmentSha256:args.assessmentSha256,...selected};
  await retainCaseArtifact(join(directory,'selection.json'),jsonBytes(request));
  // Prefer the retained original on resume; supplying a different source path
  // cannot replace the complete archive originally selected for this handoff.
  let archive;
  try{archive=await readPrivateFile(join(directory,'installation.zip'),MAX);}
  catch(error){if(error.code!=='ENOENT')throw error;archive=await readPrivateFile(absolute(args.archive),MAX);}
  if(!archive.length||sha256(archive)!==selected.archiveSha256)fail('The complete original Installation ZIP changed.');
  const archivePin=await retainCaseArtifact(join(directory,'installation.zip'),archive);
  const native=await runVerifier(args,join(directory,'installation.zip'));
  if(native.schema!=='stellar-forge.sf47-commercial-effort-handoff.v1'||native.state!=='VERIFIED')
    fail('The installed full original verifier returned an unsupported result.');
  same(native.archive,{bytes:archive.length,sha256:selected.archiveSha256},'The verifier read another archive.');
  same(native.selection,{id:selected.installationId,revision:selected.installationRevision,
    sha256:selected.installationSha256,reportSha256:selected.reportSha256},'The verifier selected a different saved report.');
  const model=openCaseCommercial({store:await openCaseStore(absolute(args.casesDirectory)),
    workspaceId:commercialWorkspaceId(args.casesDirectory)});
  const planning=await inspectEconomicsCase({...args,model});
  const {input,report,binding,plan}=deriveInput(planning,native,selected);
  const preview=await model.previewEconomics({id:args.id,expectedRevision:args.revision,input});
  const comparison=compare(plan,preview.review,report,selected);
  const members=[
    ['selection.json',jsonBytes(request),'original-complete-selection'],
    ['installation.zip',archive,'complete-native-case-and-source'],
    ['native-effort-verification.json',jsonBytes(native),'full-original-native-verification'],
    ['planned-assessment.json',jsonBytes(plan),'selected-original-private-plan'],
    ['quote.json',jsonBytes(planning.quote),'unchanged-original-quote'],
    ['economics-input.json',jsonBytes(input),'explicit-new-private-input'],
    ['economics-preview.json',jsonBytes(preview),'original-economics-engine-preview'],
    ['comparison.json',jsonBytes(comparison),'original-plan-and-source-comparison'],
    ['README.md',Buffer.from(renderEffortEconomics({request,comparison})),'private-operator-guide']
  ];
  const files=[];
  for(const [name,body,role]of members)files.push({name,role,...await retainCaseArtifact(join(directory,name),body)});
  const manifest={schema:EFFORT_ECONOMICS_SCHEMA,state:'PREVIEWED',audience:'PRIVATE_OPERATOR',
    selection:request,commercial:copy(binding),quote:planning.files.quote,
    originalAssessment:planning.files.assessment,inputSha256:sha256(jsonBytes(input)),
    reviewSha256:preview.review.reviewSha256,files,
    use:'Review the private input and original economics preview. Save explicitly through original saveEconomics with the same case revision, input bytes and review SHA. No merchant or operating case mutation was performed by this handoff.'};
  const descriptor=await retainCaseArtifact(join(directory,'effort-economics.json'),jsonBytes(manifest));
  for(const file of files)await readExact(join(directory,file.name),file);
  return {schema:EFFORT_ECONOMICS_SCHEMA,state:'PREVIEWED',directory,manifest:descriptor,
    input,preview,comparison,native,selection:request};
}
/** Reopens every complete member, reruns the full native ZIP verifier, then
 * reproduces the original merchant preview against its original saved revision. */
export async function reopenEffortEconomics(args){
  const directory=absolute(args.directory);
  const bytes=await readPrivateFile(join(directory,'effort-economics.json'),MAX);
  if(!HASH.test(args.manifestSha256??'')||sha256(bytes)!==args.manifestSha256)
    fail('Use the exact original complete handoff manifest SHA-256.');
  const manifest=JSON.parse(decode(bytes));
  if(manifest.schema!==EFFORT_ECONOMICS_SCHEMA||manifest.state!=='PREVIEWED'||!Array.isArray(manifest.files))
    fail('Select a complete original private effort handoff.');
  const expected=['selection.json','installation.zip','native-effort-verification.json','planned-assessment.json','quote.json',
    'economics-input.json','economics-preview.json','comparison.json','README.md'];
  if(manifest.files.length!==expected.length||new Set(manifest.files.map(x=>x.name)).size!==expected.length||
    manifest.files.some(x=>!expected.includes(x.name)))fail('The handoff must retain its exact complete member set.');
  for(const file of manifest.files)await readExact(join(directory,file.name),file);
  const s=manifest.selection,selected=selection(s);
  const native=await runVerifier({...args,...selected},join(directory,'installation.zip'));
  const original=JSON.parse(decode(await readPrivateFile(join(directory,'native-effort-verification.json'),MAX)));
  same(native,original,'The installed original native reader or selected saved source changed.');
  const planning=await inspectEconomicsCase({...args,id:s.caseId,revision:s.caseRevision,
    quoteId:s.quoteId,quoteSha256:s.quoteSha256,assessmentId:s.assessmentId,assessmentSha256:s.assessmentSha256});
  const planBytes=await readPrivateFile(join(directory,'planned-assessment.json'),MAX);
  const quoteBytes=await readPrivateFile(join(directory,'quote.json'),MAX);
  same(planning.assessment,JSON.parse(decode(planBytes)),'The selected original private assessment changed.');
  same(planning.quote,JSON.parse(decode(quoteBytes)),'The original quotation changed.');
  const {input,report,plan}=deriveInput(planning,native,selected);
  const savedInput=await readPrivateFile(join(directory,'economics-input.json'),MAX);
  if(sha256(savedInput)!==manifest.inputSha256)fail('The original input bytes differ from their manifest.');
  same(input,JSON.parse(decode(savedInput)),'The private input no longer follows its selected original effort and cost basis.');
  // The same pure native review engine can replay a saved quotation even after
  // a later case save, without reopening an obsolete mutable revision for writes.
  const review=reviewCommercialEconomics({quotes:[{...planning.quote,
    originCaseId:plan.review.quote.originCaseId}]},input);
  const preview=JSON.parse(decode(await readPrivateFile(join(directory,'economics-preview.json'),MAX)));
  same(review,preview.review,'The original economics review no longer reproduces from its complete sources.');
  if(review.reviewSha256!==manifest.reviewSha256)fail('The review differs from its selected digest.');
  const comparison=compare(plan,review,report,selected);
  same(comparison,JSON.parse(decode(await readPrivateFile(join(directory,'comparison.json'),MAX))),
    'The complete comparison differs from the original engines.');
  return {schema:EFFORT_ECONOMICS_SCHEMA,state:'VERIFIED',directory,manifest:{bytes:bytes.length,sha256:sha256(bytes)},
    selection:s,input,preview,comparison,native};
}
export function renderEffortEconomics({request,comparison}){
  return '# Private delivery-effort economics\n\n'+
    'Quote '+request.quoteId+' / '+request.quoteSha256+'\n\n'+
    'Installation '+request.installationId+' revision '+request.installationRevision+
    ' / '+request.installationSha256+'\n\n'+
    'Effort report '+request.reportSha256+'; complete ZIP '+request.archiveSha256+'\n\n'+
    comparison.meaning+'\n\n'+comparison.costMeaning+'\n\n'+
    'Planned implementation hours: '+(comparison.planned.hours??'unknown')+
    '\nSelected implementation hours: '+comparison.selected.hours+'\n\n'+
    'The complete source, saved report, phases, findings, original private assessment and original engine results are retained beside this guide. '+
    'Open comparison.json for the exact cash-cost and planning-valuation cases. No quoted task hours were inferred from price, quantity or duration. '+
    'Customer quotation prices, recorded Work, acceptance and Forecast are unchanged.\n\n'+
    'Review economics-input.json and economics-preview.json before an explicit original economics save. '+
    'Retain the original request ID, expected case revision, input bytes and review SHA across interrupted replies. '+
    'Use the ordinary merchant whole-case/source export after saving; keep this complete private directory with that receiving package.\n';
}
