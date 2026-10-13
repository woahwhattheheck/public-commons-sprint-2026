// MIT. Browser-safe rendering of the original OAuth observation and SF74 comparison.
// This module reads no endpoint, resolves no credential and evaluates no authority.
const STAGES = [
  ['authentication','Authentication checks'],
  ['authorization','Tool authorization checks'],
  ['hostAuthority','Host authority checks'],
  ['jwks','Key-fetch checks (JWKS)']
];
const COUNTS = [
  ['started','Started'],['completed','Completed'],['allowed','Allowed outcome'],
  ['denied','Denied outcome'],['unavailable','Unavailable'],['failed','Failed']
];
const CONDITIONS = [
  ['OAUTH_SOURCE_UNAVAILABLE','Original source unavailable'],
  ['OAUTH_CONFIGURATION_CHANGED','Resource or configuration changed'],
  ['OAUTH_SOURCE_INTEGRITY','Original source continuity or integrity'],
  ['OAUTH_OBSERVER_INCOMPLETE','Observer incomplete'],
  ['OAUTH_VERIFIER_UNAVAILABLE','Original verifier unavailable'],
  ['OAUTH_HOST_AUTHORITY_ERROR','Host callback error'],
  ['OAUTH_JWKS_UNAVAILABLE','Issuer key service unavailable'],
  ['OAUTH_JWKS_RATE_LIMITED','Issuer key service rate limited']
];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const present=value=>value===null||value===undefined?'Not observed':
  typeof value==='object'?JSON.stringify(value):typeof value==='boolean'?value?'Yes':'No':String(value);
const list=value=>Array.isArray(value)?value.map(present).join(', '):present(value);
function table(headings,rows,label='Original OAuth observations') {
  return '<div class="scroll case-table-wrap"><table class="case-table" aria-label="'+esc(label)+'"><thead><tr>'+
    headings.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(present(value))+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div>';
}
function pairs(rows,label) {return table(['Original field','Retained value'],rows,label);}
function details(title,body) {return '<details class="source-details"><summary>'+esc(title)+'</summary>'+body+'</details>';}
function para(value,cls='') {return '<p'+(cls?' class="'+esc(cls)+'"':'')+'>'+esc(value)+'</p>';}
function counters(value,label,{delta=false,attributed=false}={}) {
  if(!value)return para('No original '+label.toLowerCase()+' are available. Missing counts are not zero.','hint');
  const heads=['Check stage',...COUNTS.map(([key,title])=>
    attributed&&key==='started'?(delta?'Attributed starts change':'Attributed starts'):title)];
  if(delta)heads.push('Outstanding before','Outstanding after');
  return table(heads,STAGES.map(([key,title])=>[
    title,...COUNTS.map(([count])=>value[key]?.[count]??null),
    ...(delta?[value[key]?.outstandingBefore??null,value[key]?.outstandingAfter??null]:[])
  ]),label);
}
function outcomes(value,label) {
  if(!value)return '';
  const rows=[];
  for(const [stage,title]of STAGES) {
    const selected=value[stage]?.outcomes;
    if(selected===null||selected===undefined){rows.push([title,'Not observed',null]);continue;}
    const entries=Object.entries(selected).sort(([a],[b])=>a.localeCompare(b));
    if(!entries.length)rows.push([title,'No recorded outcome codes',0]);
    else for(const [code,count]of entries)rows.push([title,code,count]);
  }
  return details(label,table(['Check stage','Exact outcome code','Count'],rows,label));
}
function conditions(value) {
  return table(['Original condition','Retained evaluation','Retained rule inputs'],CONDITIONS.map(([kind,label])=>{
    const condition=value?.[kind],bad=condition?.bad;
    return [label,bad===true?'Observed condition':bad===false?'Not active under the original rule':'Unknown',
      condition?.values??null];
  }),'Original SF93 condition evaluation');
}
function authority(o) {
  const a=o.authority;
  if(!a)return para('Original authority configuration was not observed.','hint');
  let html=pairs([
    ['Original metadata URL',o.originalObservation?.metadataUrl??o.metadataUrl??null],
    ['Host authority callback configured',a.hostCallback],
    ['Configured tool scope entries',a.toolScopeCount]
  ],'Original authority summary');
  const servers=Array.isArray(a.servers)?a.servers:null;
  if(servers===null)return html+para('Original issuer inventory was not observed.','hint');
  if(!servers.length)html+=para('The original authority reports no configured issuer entries.','hint');
  else for(const [index,server]of servers.entries())html+=details(
    'Configured issuer '+(index+1)+' · '+server.issuer,
    pairs([
      ['Issuer',server.issuer],['Original key-set URL',server.jwksUri],
      ['Allowed algorithms',list(server.algorithms)],['Allowed token types',list(server.tokenTypes)],
      ['Configured subject allowlist count',server.subjectAllowlistCount],
      ['Required scopes',list(server.requiredScopes)],
      ['Key cache fresh',server.keys?.fresh??null],
      ['Original reload in progress',server.keys?.reloading??null],
      ['Original reload cooldown',server.keys?.coolingDown??null]
    ],'Original configured issuer')
  );
  return html+para('A key-fetch HTTP 200 is an HTTP response observation. The original verifier remains responsible for validating the returned key set and token.','hint');
}
function issuerCounts(o) {
  if(!Array.isArray(o.issuers))return para('Original issuer check counts were not observed.','hint');
  if(!o.issuers.length)return para('No original issuer counter rows are present.','hint');
  return o.issuers.map(row=>details(row.issuer===null?'Unattributed original issuer bucket':row.issuer,
    counters(row.counters,'Original issuer check counters',{attributed:true})+
    outcomes(row.counters,'Original issuer outcome codes'))).join('');
}
function minuteRows(o) {
  const minutes=o.originalObservation?.minutes;
  if(!Array.isArray(minutes))return para('Complete original minute rows are not included in this summary. They remain in the original oauth-source.json capture and its runtime case.','hint');
  if(!minutes.length)return para('The original source contains no retained minute rows.','hint');
  const rows=[];
  for(const minute of minutes)for(const [stage,title]of STAGES)rows.push([
    minute.minute,title,...COUNTS.map(([key])=>minute.counters?.[stage]?.[key]??null)
  ]);
  return table(['UTC minute','Check stage',...COUNTS.map(([,title])=>title)],rows,'Complete original retained minute counters');
}

/** Accept the runtime oauth projection or the original summary used by Incidents. */
export function oauthObservationHtml(o,{title='Original OAuth resource observation'}={}) {
  if(!o)return para('No retained original OAuth observation is available.','hint');
  const selected=o.registrationSelection??o.selection;
  let html='<section class="runtime-capture oauth-observation"><h3>'+esc(title)+'</h3>'+
    para('Source coverage: '+present(o.coverage)+
      ' · Original capture: '+present(o.capturedAt)+
      (o.collectedAt?' · Collected: '+o.collectedAt:''),'hint')+
    pairs([
      ['Observed resource',o.resource],['Reviewed resource',selected?.resource??null],
      ['Observed configuration SHA-256',o.configurationSha256],
      ['Reviewed configuration SHA-256',selected?.configurationSha256??null],
      ['Original session ID',o.sessionId],['Original session started',o.startedAt],
      ['Original sequence',o.sequence],['Original source error',o.sourceError],
      ['Identity contradiction',o.identityContradiction]
    ],'OAuth source and registration identity');
  if(o.poll)html+=pairs([
    ['Original watcher applied at',o.poll.appliedAt],['Original source fresh for that poll',o.poll.fresh],
    ['Original poll successful',o.poll.successful],['Original poll reason',o.poll.reason]
  ],'Original retained watcher decision');
  if(o.sourceFile)html+=pairs([
    ['Original oauth-source.json bytes',o.sourceFile.bytes],
    ['Original oauth-source.json SHA-256',o.sourceFile.sha256]
  ],'Original observation source digest');
  html+='<h4>Original decision checks</h4>'+
    para('Authentication and authorization are check counts. A request may invoke several checks; these totals do not measure distinct HTTP requests. ACCESS_DENIED, INVALID_TOKEN and INSUFFICIENT_SCOPE are normal enforcement outcomes.','hint')+
    counters(o.counters,'Original cumulative check counters')+
    outcomes(o.counters,'Exact original cumulative outcome codes');
  html+='<h4>Selected minute window</h4>'+
    pairs([
      ['Window begins',o.window?.from??null],['Window through',o.window?.through??null],
      ['Selected window minutes',o.window?.minutes??null],
      ['Original window coverage complete',o.window?.complete??null]
    ],'Original selected window')+
    counters(o.window?.counters,'Original window check counters')+
    outcomes(o.window?.counters,'Exact original window outcome codes')+
    details('Complete original retained minute inventory',minuteRows(o))+
    para('Window counts use the original inclusive minute start and capture instant. The current final bucket may cover only part of its minute; complete coverage does not turn it into a full-minute count. An incomplete or empty success window cannot establish recovery.','hint');
  html+=details('Original authority and key-cache state',authority(o));
  html+=details('Original issuer counter buckets',issuerCounts(o)+
    para('An authentication start stays unattributed until the original verifier establishes its issuer. A successful completion moves that start to the verified issuer. Issuer starts are attribution balances; the aggregate start count and each issuer’s completed outcomes remain cumulative.','hint'));
  html+=details('Original observer state',pairs([
    ['Resource closed at capture',o.state?.closed??null],
    ['Original active requests',o.state?.activeRequests??null],
    ['Observer errors',o.state?.observerErrors??null],
    ['Observer clock error',o.state?.clockError??null]
  ],'Original observer state'));
  if(o.last)html+=details('Latest original stage outcomes',table(
    ['Stage','Time','Outcome','Issuer','Tool name','Duration ms'],
    STAGES.map(([stage,title])=>{
      const row=o.last[stage];
      return [title,row?.at??null,row?.outcome??null,row?.issuer??null,row?.tool??null,row?.durationMs??null];
    }),'Latest original stage outcomes'));
  if(o.conditions)html+=details('Original SF93 signal evaluation',conditions(o.conditions)+
    para('These are the original condition evaluations, not a new incident ledger. The existing SF93 watcher retains debounce, acknowledgment, notification and recovery history. Omitted or indeterminate signals remain unknown.','hint'));
  if(selected)html+=details('Reviewed source selection',pairs([
    ['Read-only observation endpoint',selected.endpoint],
    ['Operator credential environment reference (value omitted)',selected.tokenEnv],
    ['Source deadline ms',selected.timeoutMs],
    ['Window minutes',selected.windowMinutes],
    ['Unavailable minimum',selected.unavailableMinimum],
    ['Unavailable threshold percent',selected.unavailablePercent],
    ['Host error minimum',selected.hostErrorMinimum],
    ['Host error threshold percent',selected.hostErrorPercent]
  ],'Reviewed source selection'));
  if(o.originalJson!==null&&o.originalJson!==undefined)
    html+=details('Complete original observation JSON','<pre tabindex="0">'+esc(o.originalJson)+'</pre>'+
      para('Formatting in this view is for reading. The two original files and their byte hashes remain in the retained runtime handoff.','hint'));
  return html+para('Tokens, subject values and tool arguments are not part of this observation. Repairs remain with the original host and issuer owners.','hint')+'</section>';
}
export function oauthCaptureHtml(capture) {
  return oauthObservationHtml(capture.oauth,{
    title:'Original OAuth resource · '+(capture.oauth?.registration?.label??capture.scope.routeId)
  });
}

export function oauthComparisonHtml(comparison) {
  const o=comparison.oauth;if(!o)return '';
  const a=o.before,b=o.after;
  let html='<section class="oauth-comparison"><h3>OAuth observation comparison</h3>'+
    para(comparison.detail)+
    table(['Original field','Before','After'],[
      ['Resource',a.resource,b.resource],
      ['Configuration SHA-256',a.configurationSha256,b.configurationSha256],
      ['Session',a.sessionId,b.sessionId],['Session start',a.startedAt,b.startedAt],
      ['Source capture time',a.capturedAt,b.capturedAt],['Sequence',a.sequence,b.sequence],
      ['Source coverage',a.coverage,b.coverage],
      ['Selected window start',a.window?.from??null,b.window?.from??null],
      ['Selected window through',a.window?.through??null,b.window?.through??null],
      ['Complete window',a.window?.complete??null,b.window?.complete??null]
    ],'Original before and after identities');
  if(o.continuityProblems?.length)html+=details('Original continuity differences',
    '<ul>'+o.continuityProblems.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>');
  if(o.delta) {
    html+='<h4>Observed check interval</h4>'+para(o.delta.from+' → '+o.delta.through)+
      counters(o.delta.counters,'Original cumulative check differences',{delta:true})+
      outcomes(o.delta.counters,'Exact outcome differences in the compatible interval')+
      para('Stage starts and completions may refer to different requests. Outstanding counts belong to the respective original snapshots. No HTTP request total is derived from these checks.','hint');
    if(o.delta.issuers?.length)html+=details('Issuer check interval differences',
      para('Attributed starts change includes verified issuer reassignment. A negative change in the unattributed authentication bucket can reflect successful verification of an earlier pending check; it is not a negative number of new authentications. Completed outcome differences and original outstanding snapshots remain separate.','hint')+
      o.delta.issuers.map(row=>
      '<h4>'+esc(row.issuer??'Unattributed original issuer bucket')+'</h4>'+
      (row.counters?counters(row.counters,'Original issuer interval differences',{delta:true,attributed:true})+
        outcomes(row.counters,'Original issuer interval outcomes'):
        para('This issuer bucket was not present in the before observation. Its original after counts remain visible without substituting an unobserved zero.','hint'))).join(''));
  } else html+=para('No incremental check totals are calculated for this comparison.','hint');
  html+='<h4>Original selected window counts</h4>'+
    table(['Window measure','Before','After'],STAGES.flatMap(([stage,title])=>
      COUNTS.map(([key,label])=>[title+' · '+label,a.window?.counters?.[stage]?.[key]??null,b.window?.counters?.[stage]?.[key]??null])
    ),'Independent retained window counts');
  html+=para(o.windowComparison?.overlap===true?
    'These retained windows overlap. Counts remain side by side and are not subtracted or presented as a rate change.':
    o.windowComparison?.independent===true?
      'These retained complete windows are chronological and independent. They remain separate observations; a difference does not prove a repair caused it.':
      'The available source does not establish two independent complete windows. Recovery remains the original watcher’s decision.','hint');
  return html+'</section>';
}
