// MIT. Immutable paired scientific reviews over complete original WQX receiving decisions.
import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../../routescan/quota.mjs';
import { joinCapture } from '../samples.mjs';
import { openWaterQualityProject } from '../project.mjs';
import { openWatersHash, openWatersCanonical } from '../openwaters.mjs';
import { readReviewSheet, exportReviewSheet, receiveReviewSheet } from '../review-sheet/workflow.mjs';
import { normalizeStandardizedOptions, analyzeStandardizedWaterQuality, verifyStandardizedAnalysis,
  compareStandardizedAnalyses, standardizedFail } from './model.mjs';
import { standardizedObservationsTable, standardizedGroupsTable, standardizedChangesTable, renderStandardizedReport } from './formats.mjs';

export const STANDARDIZED_REVIEW_SCHEMA='starforge.wqx-standardized-review.v1';
export const STANDARDIZED_PREVIEW_SCHEMA='starforge.wqx-standardized-preview.v1';
export const STANDARDIZED_BUNDLE_SCHEMA='starforge.wqx-standardized-bundle.v1';
const RECORD_LIMIT=128*1024*1024;
const BUNDLE_LIMIT=128*1024*1024;
const bundleJson=value=>JSON.stringify(value)+'\n';
const json=value=>JSON.stringify(value,null,2)+'\n';
const same=(a,b)=>openWatersCanonical(a)===openWatersCanonical(b);
const sha=(value,label)=>{if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))standardizedFail('Provide the exact '+label+' SHA-256.');return value;};
const id=(value,label)=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value))standardizedFail('Choose a stable '+label+' using letters, digits, underscores and hyphens.');return value;};
function projectOf(project) {
  if(!project||typeof project.root!=='string'||!['capture','readReview','readOpenWaters','receiveOpenWaters','exportOpenWaters'].every(key=>typeof project[key]==='function'))
    standardizedFail('Open the original water-quality project.');
  return project;
}
async function directory(project) { return privateDirectory(join(projectOf(project).root,'standardized-analysis')); }
async function maybe(path,limit=RECORD_LIMIT) { try{return await readPrivateJson(path,limit);}catch(error){if(error.code==='ENOENT')return null;throw error;} }
async function immutable(folder,name,value) {
  try{await atomicJson(folder,name,value,{exclusive:true});return value;}
  catch(error){if(error.code!=='EEXIST')throw error;const prior=await readPrivateJson(join(folder,name),name.endsWith('.bundle.json')?BUNDLE_LIMIT:RECORD_LIMIT);
    if(!same(prior,value))standardizedFail('This saved scientific review name already contains another exact operation.','WQX_STANDARDIZED_CONFLICT',409);return prior;}
}
function requestOf(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))standardizedFail('Provide the selected scientific review request.');
  const accepted=['reviewId','decisionReviewId','expectedDecisionReviewSha256','options','title','note','previousReviewId','expectedPreviousReviewSha256'];
  if(Object.keys(input).some(key=>!accepted.includes(key)))standardizedFail('Use the supported scientific review request fields.');
  const title=input.title??'Water-quality reporting-unit review',note=input.note??'';
  if(typeof title!=='string'||!title.trim()||title.length>240||typeof note!=='string'||note.length>4000)
    standardizedFail('Provide a title up to 240 characters and an optional note up to 4,000 characters.');
  const previousReviewId=input.previousReviewId?id(input.previousReviewId,'previous scientific review'):null;
  if(!previousReviewId&&input.expectedPreviousReviewSha256)standardizedFail('Select the previous review together with its exact hash.');
  const reviewId=id(input.reviewId,'scientific review');
  if(previousReviewId===reviewId)standardizedFail('Choose an earlier immutable review as the comparison edition.');
  return {reviewId,decisionReviewId:id(input.decisionReviewId,'receiving decision review'),
    expectedDecisionReviewSha256:sha(input.expectedDecisionReviewSha256,'receiving decision review'),
    options:normalizeStandardizedOptions(input.options??{}),title,note,previousReviewId,
    expectedPreviousReviewSha256:previousReviewId?sha(input.expectedPreviousReviewSha256,'previous scientific review'):null};
}
function decisionIdentity(record) {
  if(record?.status!=='COMPLETE')standardizedFail('Complete the original saved receiving decisions first.','WQX_STANDARDIZED_DECISIONS_INCOMPLETE',409);
  return {reviewId:record.reviewId,reviewSha256:record.reviewSha256,documentSha256:record.documentSha256,
    sourcePlanId:record.source.sourcePlanId,sourcePlanSha256:record.source.sourcePlanSha256,
    sourceReviewId:record.source.reviewId,sourceReviewSha256:record.source.reviewSha256,
    captureId:record.source.captureId,captureSha256:record.source.captureSha256,
    resultingPlanId:record.newPlanId,resultingPlanSha256:record.newPlanSha256};
}
function verifyDecisionAnalysis(decision,analysis) {
  const source=verifyStandardizedAnalysis(analysis).source;
  const selected={captureId:decision.captureId,captureSha256:decision.captureSha256,
    sourceReviewId:decision.sourceReviewId,sourceReviewSha256:decision.sourceReviewSha256,
    sourcePlanId:decision.sourcePlanId,sourcePlanSha256:decision.sourcePlanSha256,
    resultingPlanId:decision.resultingPlanId,resultingPlanSha256:decision.resultingPlanSha256,documentSha256:decision.documentSha256};
  if(!same(source,selected))standardizedFail('The scientific analysis differs from its complete receiving decision.','WQX_STANDARDIZED_CHANGED',409);
}
function verifyPrevious(value) {
  if(value===null)return null;
  if(!value||typeof value!=='object')standardizedFail('The selected comparison edition changed.','WQX_STANDARDIZED_CHANGED',409);
  return verifyStandardizedReview(value);
}
export function verifyStandardizedReview(input) {
  if(!input||input.schema!==STANDARDIZED_REVIEW_SCHEMA||input.status!=='COMPLETE')
    standardizedFail('Choose a complete saved reporting-unit review.','WQX_STANDARDIZED_NOT_FOUND',404);
  const {reviewSha256,files,...body}=input;
  if(openWatersHash(body)!==sha(reviewSha256,'scientific review'))standardizedFail('The saved scientific review changed.','WQX_STANDARDIZED_CHANGED',409);
  const request=requestOf(body.request);
  if(!same(request,body.request)||body.reviewId!==request.reviewId||body.title!==request.title||body.note!==request.note||
    body.requestSha256!==openWatersHash(request)||body.decision.reviewId!==request.decisionReviewId||
    body.decision.reviewSha256!==request.expectedDecisionReviewSha256||!same(body.analysis.options,request.options))
    standardizedFail('The saved scientific review no longer matches its exact request.','WQX_STANDARDIZED_CHANGED',409);
  verifyDecisionAnalysis(body.decision,body.analysis);
  const previous=verifyPrevious(body.previous);
  if(Boolean(previous)!==Boolean(request.previousReviewId)||previous&&
      (previous.reviewId!==request.previousReviewId||previous.reviewSha256!==request.expectedPreviousReviewSha256))
    standardizedFail('The previous scientific edition changed.','WQX_STANDARDIZED_CHANGED',409);
  if(previous) {
    const compared=compareStandardizedAnalyses(body.analysis,previous.analysis);
    if(!same(compared,body.comparison))standardizedFail('The saved cross-edition comparison changed.','WQX_STANDARDIZED_CHANGED',409);
  } else if(body.comparison!==null)standardizedFail('An unselected comparison was attached.','WQX_STANDARDIZED_CHANGED',409);
  const preview=previewBody(request,body.decision,body.analysis,previous,body.comparison);
  if(openWatersHash(preview)!==body.previewSha256)standardizedFail('The saved scientific preview changed.','WQX_STANDARDIZED_CHANGED',409);
  return {...body,reviewSha256};
}
async function exactDecision(project,identity) {
  const record=await readReviewSheet({project,reviewId:identity.reviewId});
  if(!same(decisionIdentity(record),identity))standardizedFail('This original receiving decision belongs to another edition.','WQX_STANDARDIZED_SOURCE',409);
  return record;
}
async function analyzeDecision(project,identity,options) {
  const decision=await exactDecision(project,identity),sourcePlan=await project.readOpenWaters(identity.sourcePlanId),
    resultPlan=await project.readOpenWaters(identity.resultingPlanId),capture=await project.capture(identity.captureId);
  if(capture.captureSha256!==identity.captureSha256)standardizedFail('The original capture changed.','WQX_STANDARDIZED_SOURCE',409);
  const model=await joinCapture(capture);
  return analyzeStandardizedWaterQuality({model,sourcePlan,resultPlan,document:decision.document,options});
}
function previousSnapshot(record) {
  // Carry the complete original hash preimage, including its selected prior-report
  // content. Receiving verifies the actual earlier review identity, not just a label.
  return verifyStandardizedReview(record);
}
function previewBody(request,decision,analysis,previous,comparison) {
  return {schema:STANDARDIZED_PREVIEW_SCHEMA,request,requestSha256:openWatersHash(request),decision,analysis,previous,comparison};
}
async function stored(project,reviewId) {
  const folder=await directory(project),value=await maybe(join(folder,id(reviewId,'scientific review')+'.json'));
  if(!value)standardizedFail('The selected scientific review is not saved in this project.','WQX_STANDARDIZED_NOT_FOUND',404);
  return verifyStandardizedReview(value);
}
async function withPreviousProject(project,previous,work) {
  let local=false;
  try {await exactDecision(project,previous.decision);local=true;}
  catch(error) {if(!['WQX_REVIEW_SHEET_NOT_FOUND','WQX_STANDARDIZED_SOURCE'].includes(error.code))throw error;}
  if(local)return work(project);
  const folder=join(await directory(project),'sources',previous.analysis.analysisSha256);
  try{const stat=await lstat(folder);if(!stat.isDirectory()||stat.isSymbolicLink())standardizedFail('Open the retained comparison source project.','WQX_STANDARDIZED_SOURCE',409);}
  catch(error){if(error.code==='ENOENT')standardizedFail('Receive the complete previous-edition source before reopening this comparison.','WQX_STANDARDIZED_SOURCE',409);throw error;}
  const source=await openWaterQualityProject(folder);
  try {await exactDecision(source,previous.decision);return await work(source);}
  finally {await source.close();}
}
export async function previewStandardizedReview({project,...input}={}) {
  projectOf(project);const request=requestOf(input),record=await readReviewSheet({project,reviewId:request.decisionReviewId});
  const decision=decisionIdentity(record);
  if(decision.reviewSha256!==request.expectedDecisionReviewSha256)standardizedFail('The selected receiving review changed.','WQX_STANDARDIZED_SOURCE',409);
  const analysis=await analyzeDecision(project,decision,request.options);
  let previous=null,comparison=null;
  if(request.previousReviewId) {
    const prior=await readStandardizedReview({project,reviewId:request.previousReviewId});
    if(prior.reviewSha256!==request.expectedPreviousReviewSha256)standardizedFail('The comparison edition changed.','WQX_STANDARDIZED_SOURCE',409);
    previous=previousSnapshot(prior);comparison=compareStandardizedAnalyses(analysis,previous.analysis);
  }
  const content=previewBody(request,decision,analysis,previous,comparison);
  return {...content,previewSha256:openWatersHash(content)};
}
export async function saveStandardizedReview({project,expectedPreviewSha256,...input}={}) {
  const request=requestOf(input);sha(expectedPreviewSha256,'scientific preview');const folder=await directory(project);
  return withPrivateLock(folder,request.reviewId+'.lock',async()=>{
    const existing=await maybe(join(folder,request.reviewId+'.json'));
    if(existing) {
      const saved=verifyStandardizedReview(existing);
      if(saved.requestSha256!==openWatersHash(request)||saved.previewSha256!==expectedPreviewSha256)
        standardizedFail('This review name already contains different scientific work.','WQX_STANDARDIZED_CONFLICT',409);
      return readStandardizedReview({project,reviewId:request.reviewId});
    }
    const pending=await maybe(join(folder,request.reviewId+'.receiving.json'));
    if(pending)standardizedFail('Resume the existing complete scientific receiving operation for this name.','WQX_STANDARDIZED_RECEIVING',409);
    const preview=await previewStandardizedReview({project,...request});
    if(preview.previewSha256!==expectedPreviewSha256)standardizedFail('The scientific preview changed. Preview the selected source again.','WQX_STANDARDIZED_PREVIEW_CHANGED',409);
    const {schema,...body}=preview;
    const content={schema:STANDARDIZED_REVIEW_SCHEMA,status:'COMPLETE',reviewId:request.reviewId,title:request.title,note:request.note,...body};
    const saved={...content,reviewSha256:openWatersHash(content)};
    await immutable(folder,request.reviewId+'.json',saved);
    await publishSummary(folder,saved);
    return readStandardizedReview({project,reviewId:request.reviewId});
  });
}
export async function readStandardizedReview({project,reviewId}={}) {
  const record=await stored(project,reviewId);await exactDecision(project,record.decision);
  if(record.previous)await withPreviousProject(project,record.previous,async()=>{});
  return {...record,files:standardizedExportFiles(record.reviewId)};
}
function reviewSummary(record) {
  return {schema:'starforge.wqx-standardized-summary.v1',reviewId:record.reviewId,title:record.title,status:record.status,
    reviewSha256:record.reviewSha256,analysisSha256:record.analysis.analysisSha256,decision:record.decision,
    options:record.request.options,previous:record.previous?{reviewId:record.previous.reviewId,reviewSha256:record.previous.reviewSha256}:null,
    inventory:record.analysis.inventory,files:standardizedExportFiles(record.reviewId)};
}
async function publishSummary(folder,record) {
  const summary=reviewSummary(record),body={...summary,summarySha256:openWatersHash(summary)};
  await immutable(folder,record.reviewId+'.summary.json',body);
  return summary;
}
export async function listStandardizedReviews({project}={}) {
  const folder=await directory(project),result=[];
  for(const name of (await readdir(folder)).sort()) {
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.json$/.test(name))continue;
    const reviewId=name.slice(0,-5),cached=await maybe(join(folder,reviewId+'.summary.json'),64*1024);
    if(cached) {
      const {summarySha256,...summary}=cached;
      if(summary.schema!=='starforge.wqx-standardized-summary.v1'||summary.reviewId!==reviewId||
        summary.status!=='COMPLETE'||openWatersHash(summary)!==summarySha256)
        standardizedFail('The saved scientific inventory changed.','WQX_STANDARDIZED_CHANGED',409);
      sha(summary.reviewSha256,'scientific review');result.push(summary);
    } else result.push(await publishSummary(folder,verifyStandardizedReview(await readPrivateJson(join(folder,name),RECORD_LIMIT))));
  }
  return result;
}
const FORMATS=Object.freeze({
  json:['application/json','-scientific-review.json'],
  observations:['text/csv; charset=utf-8','-paired-observations.csv'],
  'observations-tsv':['text/tab-separated-values; charset=utf-8','-paired-observations.tsv'],
  groups:['text/csv; charset=utf-8','-paired-groups.csv'],
  changes:['text/csv; charset=utf-8','-edition-changes.csv'],
  report:['text/html; charset=utf-8','-scientific-report.html'],
  bundle:['application/json','-complete-scientific-review.json']
});
export function standardizedExportFiles(reviewId) {
  id(reviewId,'scientific review');return Object.entries(FORMATS).map(([format,[mime,suffix]])=>({format,mime,filename:reviewId+suffix}));
}
async function nativeBundle(project,decision) {
  await exactDecision(project,decision);
  const file=await exportReviewSheet({project,reviewId:decision.reviewId,format:'bundle'});
  return {filename:file.filename,bytes:file.bytes.length,sha256:openWatersHash(file.bytes),bundle:JSON.parse(file.bytes.toString('utf8'))};
}
function verifyNativeBundle(input,decision) {
  const encoded=Buffer.from(json(input?.bundle));
  if(typeof input?.filename!=='string'||input.bytes!==encoded.length||input.sha256!==openWatersHash(encoded)||
    input.bundle?.decisionReview?.reviewSha256!==decision.reviewSha256||
    !same(decisionIdentity(input.bundle.decisionReview),decision))
    standardizedFail('The complete original receiving source bundle changed.','WQX_STANDARDIZED_BUNDLE_CHANGED',409);
  const {bundleSha256,...body}=input.bundle;
  if(openWatersHash(body)!==bundleSha256)standardizedFail('The original receiving bundle changed.','WQX_STANDARDIZED_BUNDLE_CHANGED',409);
}
export async function exportStandardizedReview({project,reviewId,format}={}) {
  const record=verifyStandardizedReview(await readStandardizedReview({project,reviewId}));
  if(!Object.hasOwn(FORMATS,format))standardizedFail('Choose an available complete scientific export.');
  let content;
  if(format==='json')content=json(record);
  else if(format==='observations'||format==='observations-tsv')content=standardizedObservationsTable(record.analysis,{delimiter:format==='observations'? ',':'\t'});
  else if(format==='groups')content=standardizedGroupsTable(record.analysis);
  else if(format==='changes')content=standardizedChangesTable(record.comparison);
  else if(format==='report')content=renderStandardizedReport(record);
  else {
    const current=await nativeBundle(project,record.decision);
    const previous=record.previous?await withPreviousProject(project,record.previous,source=>nativeBundle(source,record.previous.decision)):null;
    const body={schema:STANDARDIZED_BUNDLE_SCHEMA,review:record,current,previous};
    content=bundleJson({...body,bundleSha256:openWatersHash(body)});
  }
  const bytes=Buffer.from(content),maximum=format==='bundle'?BUNDLE_LIMIT:RECORD_LIMIT;
  if(bytes.length>maximum)standardizedFail('The selected complete scientific export exceeds '+maximum+' bytes.','WQX_STANDARDIZED_TOO_LARGE',413);
  return {filename:reviewId+FORMATS[format][1],mime:FORMATS[format][0],bytes};
}
export async function receiveStandardizedReview({project,bundle}={}) {
  projectOf(project);
  if(!bundle||bundle.schema!==STANDARDIZED_BUNDLE_SCHEMA)standardizedFail('Choose the complete scientific review bundle.');
  const {bundleSha256,...body}=bundle;
  if(Buffer.byteLength(bundleJson(bundle))>BUNDLE_LIMIT||openWatersHash(body)!==sha(bundleSha256,'complete scientific bundle'))
    standardizedFail('The complete scientific bundle changed or exceeds 128 MiB.','WQX_STANDARDIZED_BUNDLE_CHANGED',409);
  const record=verifyStandardizedReview(bundle.review);verifyNativeBundle(bundle.current,record.decision);
  if(Boolean(bundle.previous)!==Boolean(record.previous))standardizedFail('Retain the selected complete previous edition.','WQX_STANDARDIZED_BUNDLE_CHANGED',409);
  if(record.previous)verifyNativeBundle(bundle.previous,record.previous.decision);
  const folder=await directory(project),intent={schema:'starforge.wqx-standardized-receiving.v1',
    reviewId:record.reviewId,reviewSha256:record.reviewSha256,bundleSha256};
  return withPrivateLock(folder,record.reviewId+'.lock',async()=>{
    const existing=await maybe(join(folder,record.reviewId+'.json'));
    if(existing) {
      if(verifyStandardizedReview(existing).reviewSha256!==record.reviewSha256)
        standardizedFail('This review name already contains different scientific work.','WQX_STANDARDIZED_CONFLICT',409);
      return readStandardizedReview({project,reviewId:record.reviewId});
    }
    await immutable(folder,record.reviewId+'.receiving.json',intent);
    await receiveReviewSheet({project,bundle:bundle.current.bundle});
    const actual=await analyzeDecision(project,record.decision,record.request.options);
    if(actual.analysisSha256!==record.analysis.analysisSha256)
      standardizedFail('The original source and reviewed choices do not reproduce this scientific report.','WQX_STANDARDIZED_SOURCE',409);
    if(record.previous) {
      const sourceRoot=join(folder,'sources',record.previous.analysis.analysisSha256);
      const previousProject=await openWaterQualityProject(sourceRoot);
      try {
        await receiveReviewSheet({project:previousProject,bundle:bundle.previous.bundle});
        const previous=await analyzeDecision(previousProject,record.previous.decision,record.previous.analysis.options);
        if(previous.analysisSha256!==record.previous.analysis.analysisSha256||
          !same(compareStandardizedAnalyses(actual,previous),record.comparison))
          standardizedFail('The complete previous source does not reproduce the selected comparison.','WQX_STANDARDIZED_SOURCE',409);
      } finally {await previousProject.close();}
    }
    await immutable(folder,record.reviewId+'.json',record);
    await publishSummary(folder,record);
    return readStandardizedReview({project,reviewId:record.reviewId});
  });
}
