// MIT. City-specific planning and phase views over the original retained jobs.
import {METADATA_SCHEMA,PROFILE_ID,domains,phases,criteria,sources,cohortDomain,procurement} from './profile.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const JOB=/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=message=>{throw new Error(message);};
const check=(value,message)=>{if(!value)fail(message);};
const text=(value,name,max=4000)=>{
  if(value===undefined||value===null)return '';
  check(typeof value==='string'&&value.length<=max&&!value.includes('\0'),name+' must be text of at most '+max+' characters');
  return value.trim();
};
const select=(value,choices,name)=>{
  check(choices.includes(value),name+' has an unknown selection');return value;
};
function positive(value,name,{zero=false,max=10000}={}) {
  if(value===undefined||value===null||value==='')return null;
  const number=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
  check(Number.isSafeInteger(number)&&number>=(zero?0:1)&&number<=max,name+' must be a whole number');
  return number;
}
function rows(value,name,normalize,max=100) {
  if(value===undefined)return [];
  check(Array.isArray(value)&&value.length<=max,name+' has too many rows');
  return value.map((row,index)=>{check(object(row),name+' row is invalid');return normalize(row,index);});
}
function identifier(value,name) {
  const result=text(value,name,96);check(JOB.test(result),name+' requires a stable ID');return result;
}

/** Plain operator metadata is saved by the original service inside spec.workspace.
 * Editing a plan therefore creates a linked immutable bundle, never rewriting a
 * previous input, comparison or review. No comparator arithmetic is copied here. */
export function normalizePlan(input={}) {
  check(object(input),'The Columbus plan must be an object');
  check(input.schema===undefined||input.schema===METADATA_SCHEMA,'Unknown Columbus plan version');
  check(input.profile===undefined||input.profile===PROFILE_ID,'This plan belongs to another profile');
  const projectId=identifier(input.projectId,'Project ID');
  const cohortId=identifier(input.cohortId,'Cohort ID');
  const plan={schema:METADATA_SCHEMA,profile:PROFILE_ID,projectId,cohortId,
    title:text(input.title,'Project title',240),
    domain:select(input.domain,domains.map(d=>d.id),'Domain'),
    phase:select(input.phase??'trial_conversion',phases.map(p=>p.id),'Phase'),
    trialNumber:positive(input.trialNumber,'Trial number'),
    plannedConversions:positive(input.plannedConversions,'Planned conversions'),
    historicalYears:positive(input.historicalYears,'Historical years',{zero:true}),
    sourceSystem:text(input.sourceSystem,'Source system',240),targetSystem:text(input.targetSystem,'Target system',240),
    scope:text(input.scope,'Data scope'),period:text(input.period,'Fiscal/pay period',240),
    sourceOwner:text(input.sourceOwner,'Source owner',240),targetOwner:text(input.targetOwner,'Target owner',240),
    primeOwner:text(input.primeOwner,'Prime conversion owner',240),cityOwner:text(input.cityOwner,'City acceptance owner',240),
    responsibilities:text(input.responsibilities,'Extraction/loading responsibilities'),
    mappingDecision:text(input.mappingDecision,'Mapping and key decision'),
    balanceEvidence:text(input.balanceEvidence,'Independent balance/payroll evidence'),
    phaseCriteria:text(input.phaseCriteria,'Phase acceptance criteria'),
    freeze:text(input.freeze,'Source freeze'),cutoverWindow:text(input.cutoverWindow,'Cutover window'),
    support:text(input.support,'Cutover support'),rollback:text(input.rollback,'Rollback contingency'),
    fiscalClose:text(input.fiscalClose,'First fiscal close'),payrollYearEnd:text(input.payrollYearEnd,'First payroll/tax year-end'),
    previousJobId:input.previousJobId?identifier(input.previousJobId,'Previous job ID'):null,
    previousBundleId:input.previousBundleId?text(input.previousBundleId,'Previous bundle ID',64):null,
    sourceVersions:input.sourceVersions===undefined?sources.map(({id,sha256})=>({id,sha256})):
      rows(input.sourceVersions,'Procurement source versions',row=>{
        check(SHA.test(row.sha256??''),'A procurement source version requires its SHA-256');
        return {id:identifier(row.id,'Procurement source ID'),sha256:row.sha256};
      },20),
  };
  check(plan.previousBundleId===null||SHA.test(plan.previousBundleId),'Previous bundle ID is invalid');
  plan.interfaces=rows(input.interfaces,'Interfaces',row=>({
    id:identifier(row.id,'Interface ID'),name:text(row.name,'Interface name',240),
    owner:text(row.owner,'Interface owner',240),result:text(row.result,'Interface result'),
    reference:text(row.reference,'Interface evidence reference'),
  }));
  check(new Set(plan.interfaces.map(i=>i.id)).size===plan.interfaces.length,'Interface IDs must be unique');
  plan.dispositions=rows(input.dispositions,'Discrepancy dispositions',row=>{
    check(SHA.test(row.reportSha256??''),'A disposition requires the original report SHA-256');
    const index=positive(row.index,'Discrepancy row',{zero:true,max:Number.MAX_SAFE_INTEGER});
    check(index!==null,'A disposition requires its original row');
    return {jobId:identifier(row.jobId,'Disposition job ID'),reportSha256:row.reportSha256,
      collection:select(row.collection,['discrepancies','group_discrepancies'],'Discrepancy collection'),index,
      owner:text(row.owner,'Discrepancy owner',240),
      status:select(row.status??'open',['open','investigating','corrected','accepted_exception'],'Disposition'),
      note:text(row.note,'Discrepancy disposition'),reference:text(row.reference,'Disposition reference')};
  },1000);
  const identities=plan.dispositions.map(d=>[d.jobId,d.reportSha256,d.collection,d.index].join(':'));
  check(new Set(identities).size===identities.length,'Each report discrepancy has one current disposition');
  plan.phaseSelection=rows(input.phaseSelection,'Phase report selection',row=>{
    check(SHA.test(row.reportSha256??'')&&SHA.test(row.bundleId??''),'Phase selection requires original bundle/report SHA-256');
    check(row.reviewId===undefined||row.reviewId===null||UUID.test(row.reviewId),'Phase review ID is invalid');
    return {jobId:identifier(row.jobId,'Phase job ID'),bundleId:row.bundleId,reportSha256:row.reportSha256,
      reviewId:row.reviewId??null};
  });
  check(new Set(plan.phaseSelection.map(r=>r.jobId)).size===plan.phaseSelection.length,'Phase report selections must be unique');
  return plan;
}

export function newColumbusPlan(draft={}) {
  return {schema:METADATA_SCHEMA,profile:PROFILE_ID,projectId:'columbus-27-0008',cohortId:draft.cohortId??'gl',
    title:'Columbus ERP conversion',domain:cohortDomain[draft.cohortId]??'financial',
    phase:draft.cohortId==='parallel_payroll'?'parallel_payroll':'trial_conversion',trialNumber:1,
    sourceSystem:procurement.incumbent,targetSystem:'',plannedConversions:null,historicalYears:null,
    sourceVersions:sources.map(({id,sha256})=>({id,sha256})),interfaces:[],dispositions:[],phaseSelection:[]};
}

export function fromSpec(spec) {
  const input=spec?.workspace?.columbus;
  if(input===undefined)return null;
  check(object(input)&&input.schema===METADATA_SCHEMA&&input.profile===PROFILE_ID,'Unknown Columbus metadata');
  return normalizePlan(input);
}

export function withPlan(spec,input) {
  check(object(spec)&&spec.version===1,'Choose the original version-1 comparison mapping');
  check(spec.workspace===undefined||object(spec.workspace),'Existing workspace metadata is invalid');
  const previous=spec.workspace?.previous;
  return {...spec,workspace:{...spec.workspace,columbus:normalizePlan({...input,
    previousJobId:previous?.jobId??null,previousBundleId:previous?.bundleId??null})}};
}

export function discrepancyRows(job,report,plan) {
  check(job?.state==='COMPLETED'&&job.result?.report&&object(report),'A completed original report is required');
  const reportSha256=job.result.report.sha256;
  const positions=new Map((plan?.dispositions??[]).filter(d=>d.jobId===job.jobId&&d.reportSha256===reportSha256)
    .map(d=>[d.collection+':'+d.index,d]));
  return ['discrepancies','group_discrepancies'].flatMap(collection=>(report[collection]??[]).map((finding,index)=>({
    jobId:job.jobId,reportSha256,collection,index,finding,
    disposition:positions.get(collection+':'+index)??null,
  })));
}

function latestReview(reviews,reportSha256) {
  return (reviews??[]).filter(r=>r.reportSha256===reportSha256)
    .sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??'')||(a.reviewId??'').localeCompare(b.reviewId??'')).at(-1)??null;
}

/** Entries are the shared operator's verified {bundle,spec,jobs,reviewsByJob}.
 * No directory scan, network request, job launch or independent store exists. */
export function projectView(entries,projectId) {
  check(Array.isArray(entries),'Retained source entries must be an array');
  const selected=[],retainedBundles=[];
  for(const entry of entries) {
    const plan=fromSpec(entry.spec);
    if(!plan||plan.projectId!==projectId)continue;
    check(entry.bundle?.bundleId&&SHA.test(entry.bundle.bundleId),'Retained bundle identity is invalid');
    retainedBundles.push({bundle:entry.bundle,spec:entry.spec,plan,jobIds:(entry.jobs??[]).map(j=>j.jobId)});
    for(const job of entry.jobs??[]) {
      check(job.bundleId===entry.bundle.bundleId,'Job belongs to a different retained bundle');
      const result=job.state==='COMPLETED'?job.result:null;
      const reviews=result?.report?(entry.reviewsByJob?.[job.jobId]??[]).filter(r=>
        r.jobId===job.jobId&&r.reportSha256===result.report.sha256):[];
      const review=result?.report?latestReview(reviews,result.report.sha256):null;
      selected.push({plan,bundleId:entry.bundle.bundleId,createdAt:job.createdAt??entry.bundle.createdAt,
        jobId:job.jobId,state:job.state,status:result?.status??null,
        counts:result?.counts??null,source:result?.source??null,target:result?.target??null,
        report:result?.report??null,review,reviews,engineSha256:entry.bundle.engine?.sha256??null});
    }
  }
  selected.sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??'')||a.jobId.localeCompare(b.jobId));
  retainedBundles.sort((a,b)=>(a.bundle.createdAt??'').localeCompare(b.bundle.createdAt??'')||a.bundle.bundleId.localeCompare(b.bundle.bundleId));
  const cohorts=new Map();
  for(const row of selected) {
    const key=row.plan.domain+':'+row.plan.cohortId;
    if(!cohorts.has(key))cohorts.set(key,{id:row.plan.cohortId,domain:row.plan.domain,trials:[],latest:null});
    const cohort=cohorts.get(key);cohort.trials.push(row);cohort.latest=row;
  }
  return {projectId,jobs:selected,bundles:retainedBundles,cohorts:[...cohorts.values()],
    completed:selected.filter(j=>j.state==='COMPLETED').length,
    comparisonPass:selected.filter(j=>j.status==='PASS').length,
    comparisonFail:selected.filter(j=>j.status==='FAIL').length,
    reviewed:selected.filter(j=>j.review!==null).length};
}

export function compareTrials(before,after) {
  check(before?.plan&&after?.plan,'Choose two retained trials');
  check(before.plan.projectId===after.plan.projectId&&before.plan.domain===after.plan.domain&&
    before.plan.cohortId===after.plan.cohortId,'Compare trials from the same project, domain and cohort');
  const counts={};
  for(const name of new Set([...Object.keys(before.counts??{}),...Object.keys(after.counts??{})]))
    counts[name]={before:before.counts?.[name]??null,after:after.counts?.[name]??null};
  return {beforeJobId:before.jobId,afterJobId:after.jobId,beforeStatus:before.status,afterStatus:after.status,
    sourceChanged:before.source?.sha256!==after.source?.sha256,
    targetChanged:before.target?.sha256!==after.target?.sha256,
    bundleChanged:before.bundleId!==after.bundleId,
    engineChanged:before.engineSha256!==after.engineSha256,counts};
}

/** Observable preparation findings, without turning a code PASS into City assent.
 * Selection is exact: later runs cannot silently replace a reviewed phase set. */
export function phaseView(plan,project) {
  const normalized=normalizePlan(plan),jobs=new Map(project.jobs.map(j=>[j.jobId,j]));
  check(normalized.projectId===project.projectId,'The phase belongs to a different project');
  const chosen=normalized.phaseSelection.map(pin=>{
    const job=jobs.get(pin.jobId);
    const matches=job&&job.bundleId===pin.bundleId&&job.report?.sha256===pin.reportSha256;
    const review=matches&&pin.reviewId?(job.reviews??[]).find(r=>r.reviewId===pin.reviewId)??null:null;
    return {selection:pin,job:matches?job:null,review,issue:!matches?'Selected original report is unavailable or changed':
      pin.reviewId&&!review?'Selected original reviewer record is unavailable':null};
  });
  const findings=[];
  const add=(id,message,source)=>findings.push({id,message,source});
  if(!normalized.scope)add('scope','Record the active and historical data scope','scope');
  if(normalized.historicalYears===null||normalized.plannedConversions===null)
    add('conversion-plan','Record the proposed history years and conversion count','conversion');
  const performed=new Set(project.jobs.filter(j=>j.plan.domain===normalized.domain&&
    j.plan.cohortId===normalized.cohortId&&j.state==='COMPLETED'&&j.plan.trialNumber!==null&&
    ['trial_conversion','parallel_payroll'].includes(j.plan.phase))
    .map(j=>j.plan.trialNumber));
  if(normalized.plannedConversions!==null&&performed.size<normalized.plannedConversions)
    add('conversion-count','The cohort has '+performed.size+' completed trial numbers against '+
      normalized.plannedConversions+' proposed conversions','conversion');
  if(!normalized.primeOwner||!normalized.cityOwner||!normalized.responsibilities)
    add('responsibilities','Record the vendor/City owners and extraction/loading responsibilities','conversion');
  if(!normalized.mappingDecision)add('mapping','Record the approved key, amount and crosswalk decisions','conversion');
  if(!normalized.phaseCriteria)add('criteria','Record the phase acceptance criteria','acceptance');
  if(!normalized.balanceEvidence)add('independent-control','Attach the independent financial/payroll control reference','acceptance');
  if(!chosen.length)add('phase-selection','Select the original job/report set for this phase','acceptance');
  if(['trial_conversion','parallel_payroll','phase_acceptance'].includes(normalized.phase)) {
    const related=chosen.some(item=>item.job?.plan.domain===normalized.domain&&
      item.job.plan.cohortId===normalized.cohortId&&
      (normalized.phase==='phase_acceptance'||item.job.plan.phase===normalized.phase));
    if(!related)add('cohort-selection','Select an original '+normalized.phase.replaceAll('_',' ')+
      ' report for this domain and trial cohort','acceptance');
  }
  for(const item of chosen) {
    if(item.issue)add('report:'+item.selection.jobId,item.issue,'acceptance');
    else if(!item.review)add('review:'+item.job.jobId,'Select an original business review for '+item.job.jobId,'acceptance');
    else if(item.review.decision!=='accepted')add('review:'+item.job.jobId,'Selected review for '+item.job.jobId+' requests changes','acceptance');
  }
  if(['cutover','fiscal_year_end','payroll_year_end'].includes(normalized.phase)) {
    if(!normalized.freeze||!normalized.cutoverWindow||!normalized.rollback||!normalized.support)
      add('cutover-plan','Record the freeze, window, support and rollback contingency','cutover');
    const payroll=chosen.filter(i=>i.job?.plan.domain==='payroll'&&i.job.plan.phase==='parallel_payroll');
    if(!payroll.length)add('parallel-payroll','Select the retained parallel-payroll report and its review','acceptance');
    if(!normalized.fiscalClose||!normalized.payrollYearEnd)
      add('year-end','Record both first-year-end owners and continuation plans','continuation');
  }
  for(const row of normalized.interfaces)
    if(!row.owner||!row.result||!row.reference)add('interface:'+row.id,'Complete the retained check for '+(row.name||row.id),'interfaces');
  return {phase:normalized.phase,selected:chosen,findings,
    preparation:findings.length?'Review items remain':'Recorded preparation complete',
    cityAcceptance:'Use the named City/prime authority and original review records',
    criteria:criteria.map(c=>({...c,findings:findings.filter(f=>f.source===c.id)}))};
}
