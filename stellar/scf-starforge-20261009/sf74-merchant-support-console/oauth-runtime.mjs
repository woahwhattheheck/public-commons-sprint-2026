// MIT. Original OAuth observation files in the existing SF74 case.
// No verifier, credential resolver, network read, controller or case store lives here.
import {isDeepStrictEqual} from 'node:util';
import {oauthConditions} from '../sf93-seller-support-bundle/oauth-observation.mjs';

const STAGES = ['authentication','authorization','hostAuthority','jwks'];
const COUNTS = ['started','completed','allowed','denied','unavailable','failed'];
const clone = value => value === undefined ? null : structuredClone(value);
const when = value => typeof value === 'string' ? Date.parse(value) : NaN;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const OAUTH_REPAIR_ACTIONS = Object.freeze({
  OAUTH_SOURCE_UNAVAILABLE: 'Check the original host and its registered read-only observation endpoint with the host operator. Resolve the existing operator credential reference and source deadline; retain this failed read and select a later complete capture.',
  OAUTH_CONFIGURATION_CHANGED: 'Compare the observed resource and configuration SHA-256 with the reviewed registration. Have the original host operator review the authority change before explicitly updating the registered selection; keep both original identities.',
  OAUTH_SOURCE_INTEGRITY: 'Inspect the original source hashes, session identity, clock and cumulative counter continuity. Reconcile the original observer and capture records before using this interval or declaring recovery.',
  OAUTH_OBSERVER_INCOMPLETE: 'Inspect the original observer lifecycle, callback errors and clock state. After the original problem is resolved, retain a complete fresh observation window with successful checks before reviewing recovery.',
  OAUTH_VERIFIER_UNAVAILABLE: 'Inspect the original verifier or closed host resource and its configured issuer dependencies. Restore the existing runtime and retain a new source capture; keep its authority, signature and scope requirements in force.',
  OAUTH_HOST_AUTHORITY_ERROR: 'Inspect the actual exception from the original host authority callback and its owned operation log. This is a callback error; ordinary access denials remain expected enforcement observations.',
  OAUTH_JWKS_UNAVAILABLE: 'Inspect access to the original configured issuer key endpoint and the verifier cache state. Restore that dependency through its owner while retaining issuer, algorithm, token-type and scope requirements.',
  OAUTH_JWKS_RATE_LIMITED: 'Respect the observed key-service rate limit and the original verifier cooldown. Review duplicate refresh pressure with the host owner, then observe the existing cache/reload path without forcing another key request.'
});

/** A complete read-only original projection shared by runtime and incident detail. */
export function oauthObservationView({meta,source,summary}) {
  return {
    ...clone(summary),registration:clone(meta.registration),
    registrationSelection:clone(meta.selection),
    collectionStartedAt:meta.startedAt,collectedAt:meta.generatedAt,
    sourceFile:clone(meta.sources['oauth-source.json']),
    originalObservation:clone(source),
    originalJson:source===null?null:JSON.stringify(source,null,2),
    conditions:clone(oauthConditions(summary))
  };
}

/** The original codec has already validated these exact capture bytes and summary. */
export function oauthCaptureView(capture,currentInputs) {
  const {meta,summary}=capture.original;
  const alerts=[];
  if(summary.coverage==='SOURCE_UNAVAILABLE')
    alerts.push('The original OAuth source was unavailable. Its check counts and authority are not observed by this capture.');
  else if(summary.coverage==='IDENTITY_CHANGED')
    alerts.push('The observed OAuth resource or configuration differs from the reviewed source selection.');
  else if(summary.coverage!=='COMPLETE')
    alerts.push('The original OAuth observer coverage is incomplete. Missing observations are not zero activity.');
  if(summary.window?.complete!==true)
    alerts.push('The selected minute window is incomplete. Preserve its observed values without a full-window recovery claim.');
  if(summary.state?.closed===true)
    alerts.push('The original resource reports closed at this capture. This does not establish the state of a later host process.');
  return {
    kind:'OAUTH_RESOURCE',scope:clone(capture.scope),
    caseMatches:isDeepStrictEqual(capture.scope.inputs,currentInputs),
    capturedAt:meta.generatedAt,startedAt:summary.startedAt,sessionId:summary.sessionId,
    mode:'ORIGINAL_READ_ONLY_OAUTH',observerAttached:null,
    observerErrors:summary.state?.observerErrors??null,
    route:{id:meta.registration.id,method:'GET'},native:null,
    oauth:oauthObservationView(capture.original),
    alerts,
    files:Object.entries(capture.files).map(([name,value])=>({
      name,bytes:value.bytes,sha256:value.sha256
    }))
  };
}

function continuity(before,after,label,{unattributed=false}={}) {
  const problems=[];
  if(!record(before)||!record(after))return [label+': missing stage counters'];
  for(const stage of STAGES) {
    const a=before[stage],b=after[stage];
    if(!record(a)||!record(b)){problems.push(label+'.'+stage+': missing counters');continue;}
    for(const key of COUNTS) {
      if(!nonnegative(a[key])||!nonnegative(b[key]))
        problems.push(label+'.'+stage+'.'+key+': unavailable counter');
      // A pending authentication is initially unattributed. The original
      // observer moves its started check to the verified issuer on success.
      // Only this attribution balance may decrease; completions and outcomes
      // remain cumulative, as do all aggregate stage counters.
      else if(b[key]<a[key]&&!(unattributed&&stage==='authentication'&&key==='started'))
        problems.push(label+'.'+stage+'.'+key+': cumulative count decreased');
    }
    if(!record(a.outcomes)||!record(b.outcomes)){
      problems.push(label+'.'+stage+'.outcomes: unavailable outcome counts');continue;
    }
    for(const key of new Set([...Object.keys(a.outcomes),...Object.keys(b.outcomes)])) {
      // A missing key in a validated sparse outcome map denotes no occurrences
      // of that code. A missing stage or original counter is never substituted.
      const left=a.outcomes[key]??0,right=b.outcomes[key]??0;
      if(!nonnegative(left)||!nonnegative(right))
        problems.push(label+'.'+stage+'.outcomes.'+key+': unavailable count');
      else if(right<left)problems.push(label+'.'+stage+'.outcomes.'+key+': cumulative count decreased');
    }
  }
  return problems;
}
function counterDelta(before,after) {
  return Object.fromEntries(STAGES.map(stage=>{
    const a=before[stage],b=after[stage];
    return [stage,{
      ...Object.fromEntries(COUNTS.map(key=>[key,b[key]-a[key]])),
      outcomes:Object.fromEntries([...new Set([...Object.keys(a.outcomes),...Object.keys(b.outcomes)])]
        .sort().map(key=>[key,(b.outcomes[key]??0)-(a.outcomes[key]??0)])),
      outstandingBefore:a.started-a.completed,
      outstandingAfter:b.started-b.completed
    }];
  }));
}
function issuerContinuity(before,after) {
  if(!Array.isArray(before)||!Array.isArray(after))
    return ['issuers: missing original issuer counter inventory'];
  const right=new Map(after.map(row=>[row.issuer,row])),problems=[];
  let verifiedCompletions=0;
  for(const row of before) {
    const next=right.get(row.issuer);
    if(!next){problems.push('issuers: a previously observed issuer bucket is missing');continue;}
    const label='issuer '+(row.issuer??'unattributed');
    problems.push(...continuity(row.counters,next.counters,label,
      {unattributed:row.issuer===null}));
    if(row.issuer!==null) {
      const a=row.counters?.authentication,b=next.counters?.authentication;
      if(record(a)&&record(b)&&
          [a.started,b.started,a.completed,b.completed,a.allowed,b.allowed,
            a.outcomes?.ALLOWED,b.outcomes?.ALLOWED].every(nonnegative)) {
        const completed=b.completed-a.completed;
        // The original verifier returns the authenticated issuer only on success.
        // Its synchronous finish moves one start and adds that same ALLOWED
        // completion; an unexplained transfer cannot be accepted as attribution.
        if(b.started-a.started!==completed||b.allowed-a.allowed!==completed||
            b.outcomes.ALLOWED-a.outcomes.ALLOWED!==completed)
          problems.push(label+'.authentication: attributed starts must match verified ALLOWED completions');
        if(completed>=0&&Number.isSafeInteger(verifiedCompletions+completed))
          verifiedCompletions+=completed;
        else problems.push(label+'.authentication: invalid verified completion growth');
      }
    }
  }
  const a=before.find(row=>row.issuer===null)?.counters?.authentication?.started;
  const b=right.get(null)?.counters?.authentication?.started;
  if(nonnegative(a)&&nonnegative(b)&&a-b>verifiedCompletions)
    problems.push('issuer unattributed.authentication.started: decrease exceeds verified completions');
  return problems;
}
function issuerDelta(before,after) {
  const left=new Map(before.map(row=>[row.issuer,row]));
  return after.map(row=>{
    const prior=left.get(row.issuer);
    return {issuer:row.issuer,beforeObserved:!!prior,afterObserved:true,
      counters:prior?counterDelta(prior.counters,row.counters):null};
  });
}
function measures(capture) {
  const o=capture.oauth;
  return {
    collectedAt:capture.capturedAt,capturedAt:o.capturedAt,
    resource:o.resource,configurationSha256:o.configurationSha256,
    sessionId:o.sessionId,startedAt:o.startedAt,sequence:o.sequence,
    coverage:o.coverage,sourceError:clone(o.sourceError),
    identityContradiction:clone(o.identityContradiction),
    state:clone(o.state),counters:clone(o.counters),issuers:clone(o.issuers),
    window:clone(o.window),conditions:clone(o.conditions)
  };
}

/**
 * Compare original validated observations. Generic HTTP interval stays null:
 * authentication and authorization checks cannot be relabeled as HTTP requests.
 * Window snapshots remain independent and are never subtracted.
 */
export function compareOAuthCaptures(before,after) {
  if(before.kind!=='OAUTH_RESOURCE'||after.kind!=='OAUTH_RESOURCE')
    return {state:'DIFFERENT_OBSERVATION_KINDS',
      detail:'An OAuth resource observation and another source kind have different identities and measurement units. Review each original capture separately.',
      interval:null};
  const a=before.oauth,b=after.oauth,view={
    before:measures(before),after:measures(after),
    sameSession:a.sessionId!==null&&a.sessionId===b.sessionId,
    sourceIntegrity:false,continuityProblems:[],delta:null,
    windowComparison:{independent:false,overlap:null,percentagePointChange:null}
  };
  const result=(state,detail)=>({state,detail,interval:null,oauth:view});
  if(!isDeepStrictEqual(a.registrationSelection,b.registrationSelection))
    return result('OAUTH_REGISTRATION_CHANGED',
      'The selected endpoint, credential reference, resource, configuration or observation settings changed. Each capture keeps its original registration; counts are not subtracted.');
  if(a.resource===null||b.resource===null||a.configurationSha256===null||b.configurationSha256===null)
    return result('OAUTH_COVERAGE_INCOMPLETE',
      'At least one capture has no observed resource or configuration. The retained failed read and available observation stay separate; missing counts are not zero.');
  if(a.resource!==b.resource||a.configurationSha256!==b.configurationSha256||
      a.identityContradiction||b.identityContradiction)
    return result('OAUTH_IDENTITY_CHANGED',
      'The observed resource or authority configuration is different from the other capture or its reviewed selection. Preserve both identities and review the original host registration before comparing activity.');
  if(!Number.isFinite(when(a.capturedAt))||!Number.isFinite(when(b.capturedAt))||
      when(b.capturedAt)<when(a.capturedAt))
    return result('OAUTH_CAPTURE_ORDER',
      'The after observation must not precede the before source capture time. Original sequence advancement establishes a new snapshot even when millisecond timestamps are equal; collector read times alone do not establish an interval.');
  if(!view.sameSession)
    return result('OAUTH_SEPARATE_SESSIONS',
      'The source observations belong to separate verifier sessions. Their cumulative totals and retained windows stay separate; a restart is not a repair result.');
  if(a.startedAt!==b.startedAt||!nonnegative(a.sequence)||!nonnegative(b.sequence)||b.sequence<=a.sequence) {
    view.sourceIntegrity=true;
    view.continuityProblems.push(a.startedAt!==b.startedAt?
      'The same original session changed its start time.':'The same original session has an unavailable, repeated or decreasing sequence.');
    return result('OAUTH_SOURCE_CONTINUITY',
      'Original session continuity does not hold. Review the retained observer identity and sequence before using these counts.');
  }
  const problems=[...continuity(a.counters,b.counters,'counters'),...issuerContinuity(a.issuers,b.issuers)];
  if(problems.length) {
    view.sourceIntegrity=true;view.continuityProblems=problems;
    return result('OAUTH_COUNTERS_CHANGED',
      'At least one cumulative counter or issuer attribution is unavailable, regressed or inconsistent with verified completions inside the same original session. The case keeps both sources and makes no incremental activity claim.');
  }
  if(a.coverage!=='COMPLETE'||b.coverage!=='COMPLETE')
    return result('OAUTH_OBSERVER_INCOMPLETE',
      'Original source coverage is incomplete. Both observations remain visible; the comparison does not assign missing checks or claim recovery.');
  view.delta={
    from:a.capturedAt,through:b.capturedAt,
    elapsedMilliseconds:when(b.capturedAt)-when(a.capturedAt),
    sequenceFrom:a.sequence,sequenceThrough:b.sequence,
    counters:counterDelta(a.counters,b.counters),
    issuers:issuerDelta(a.issuers,b.issuers)
  };
  const fromA=when(a.window?.from),throughA=when(a.window?.through),
    fromB=when(b.window?.from),throughB=when(b.window?.through);
  const validWindows=a.window?.complete===true&&b.window?.complete===true&&
    [fromA,throughA,fromB,throughB].every(Number.isFinite);
  if(validWindows) {
    const independent=throughA<fromB;
    view.windowComparison={independent,overlap:!independent,percentagePointChange:null};
    // No rate-change claim is made from overlapping windows. Even independent
    // windows are shown as observed counts and are not evidence of causation.
  }
  const completed=STAGES.some(stage=>view.delta.counters[stage].completed>0);
  return result(completed?'OAUTH_CHECK_INTERVAL_OBSERVED':'OAUTH_NO_COMPLETED_CHECKS',
    completed?
      'These are per-stage check counts between two compatible original snapshots. Stage starts and completions can cross the interval boundary; one request can involve multiple checks. Retained minute windows are shown independently and no causal repair claim is inferred.':
      'No completed authentication, authorization, host-authority or key-fetch check was observed between these compatible snapshots. This does not establish an absence of HTTP requests or a recovered service.');
}

/** One signal classifier: the original SF93 codec owns thresholds and UNKNOWN. */
export function oauthRepairQueue(capture,side,{sourceIntegrity=false}={}) {
  const conditions=oauthConditions(capture.oauth,{sourceIntegrity}),queue=[];
  for(const [condition,value] of Object.entries(conditions)) {
    if(value.bad!==true)continue;
    queue.push({
      source:side,routeId:capture.scope.routeId,kind:'oauth',
      condition,values:clone(value.values),
      action:OAUTH_REPAIR_ACTIONS[condition]??
        'Review the original OAuth condition and retained source through its registered host owner.'
    });
  }
  return queue;
}
