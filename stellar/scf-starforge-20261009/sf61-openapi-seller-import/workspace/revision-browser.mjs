// MIT. Contract revision controls on the existing local API workspace.
const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const field=(label,value='')=>{const wrap=make('label',label),input=make('input');input.value=value;wrap.append(input);return {wrap,input};};
const button=label=>{const node=make('button',label);node.type='button';return node;};
const pretty=value=>JSON.stringify(value,null,2);
const key=row=>row.method+' '+row.path;
const display=value=>value.absent?'(absent)':JSON.stringify(value.value);

export function createRevisionDesk({container,api,act,notice,onSaved,connections}) {
  let baseName=null,source='',review=null,controls=[],candidate=null,retainingCandidate=false,blocked=false;
  const title=make('h2','Review an API contract revision');
  const intro=make('p','Reopen a saved project, select the provider’s replacement description, then decide what happens to each existing route. New provider operations are available for an explicit remap.','muted');
  const base=make('p','Open a saved project to select its original source.','small wrap');
  const sourceField=make('label','Replacement OpenAPI JSON or YAML'),file=make('input');
  file.type='file';file.accept='.json,.yaml,.yml,application/json,application/yaml,text/yaml';sourceField.append(file);
  const sourceLabel=make('p','','small wrap'),reviewButton=button('Review replacement'),keepUnchanged=button('Keep unchanged routes');
  const actions=make('div',undefined,'inline');actions.append(reviewButton,keepUnchanged);
  const overview=make('div'),routeList=make('div'),targets=make('datalist');targets.id='revision-operation-targets';
  const additionsPanel=make('details'),additions=make('textarea');additions.value='[]';additions.rows=8;additions.spellcheck=false;
  additions.setAttribute('aria-label','New selected operations');
  additionsPanel.append(make('summary','Add new provider operations'),make('p','Enter an array of additional original merchant-plan operations with their exact method, path and amountAtomic. Add only operations you intend to offer. Existing route IDs and prices remain retained by their mapping decisions.','hint'),additions);
  const draftName=field('New review snapshot name','revision-review-001'),saveDraft=button('Save review snapshot');
  const draftList=make('select');draftList.setAttribute('aria-label','Saved contract reviews');
  const loadDraft=button('Reopen review'),refreshDrafts=button('Refresh reviews');
  const draftActions=make('div',undefined,'inline');draftActions.append(draftName.wrap,saveDraft,draftList,loadDraft,refreshDrafts);
  const packageName=field('New candidate package name','merchant-api-v2'),save=button('Save reviewed candidate');save.className='primary';
  const saveActions=make('div',undefined,'inline');saveActions.append(packageName.wrap,save);
  const candidateView=make('div',undefined,'revision-candidate');
  const stageName=field('Release ID',''),store=field('Original release store',''),create=make('input');create.type='checkbox';
  const createLabel=make('label',undefined,'check');createLabel.append(create,make('span','Create this new release store'));
  const stage=button('Stage this saved candidate'),stageOutput=make('pre','','wrap');
  const releasePanel=make('details'),releaseSummary=make('summary','Stage with seller releases');
  const releaseFields=make('div',undefined,'fields');store.wrap.className='wide';releaseFields.append(store.wrap,stageName.wrap,createLabel);
  releasePanel.append(releaseSummary,make('p','Staging uses the original immutable release store. Open its release console to compare versions and select the next seller run.','hint'),releaseFields,stage,stageOutput);
  container.append(title,intro,base,sourceField,sourceLabel,actions,overview,targets,routeList,additionsPanel,
    make('h3','Save and reopen a review'),make('p','Each snapshot retains the exact replacement source and current decisions. Use a new name for each snapshot.','hint'),draftActions,
    make('h3','Prepare the candidate'),saveActions,candidateView,releasePanel);

  function available(value=blocked) {
    blocked=value;
    reviewButton.disabled=blocked||!baseName||!source;
    keepUnchanged.disabled=blocked||!review;
    saveDraft.disabled=blocked||!baseName||!source;
    save.disabled=blocked||!review?.ready;
    stage.disabled=blocked||!candidate;
    loadDraft.disabled=blocked||!draftList.value;
    for(const row of controls)if(row.oauth) {
      row.oauth.alias.disabled=blocked||row.action.value==='drop'||connections.pending();
      row.oauth.use.disabled=blocked||row.action.value==='drop'||!row.oauth.alias.value||connections.pending();
    }
  }
  function invalidate() {
    if(review)review={...review,ready:false};
    candidate=null;candidateView.replaceChildren();releasePanel.hidden=true;
    available();
  }
  function selections() {
    return controls.flatMap(row=>{
      const action=row.action.value;if(!action)return [];
      if(action==='drop')return [{routeId:row.id,action}];
      let target={};
      if(action==='remap') {
        const operation=review.operations.find(operation=>key(operation)===row.target.value);
        if(!operation?.supported)throw new Error('Select an exact supported replacement operation for '+row.id);
        target={method:operation.method,path:operation.path};
      }
      let settings;
      try{settings=JSON.parse(row.settings.value);}catch{throw new Error('Operation settings must be valid JSON for '+row.id);}
      return [{routeId:row.id,action,...target,settings}];
    });
  }
  const request=()=>({baseName,specText:source,decisions:selections(),additions:JSON.parse(additions.value)});
  function refreshConnectionControl(row) {
    if(!row.oauth)return;
    let settings={};try{settings=JSON.parse(row.settings.value);}catch{}
    const prior=row.oauth.alias.value||settings.oauthAlias||connections.selectedAlias();
    row.oauth.alias.replaceChildren();
    const empty=make('option','Choose a configured connection');empty.value='';row.oauth.alias.append(empty);
    for(const value of connections.list()) {
      const option=make('option',value.profile.label+' · '+value.alias+' · '+value.grant.state);
      option.value=value.alias;row.oauth.alias.append(option);
    }
    if(connections.list().some(value=>value.alias===prior))row.oauth.alias.value=prior;
    if(settings.oauthConnection) {
      const current=connections.get(settings.oauthAlias);
      const matches=current?.profileSha256===settings.oauthConnection.profileSha256&&
        current?.grant?.id===settings.oauthConnection.grantId&&current?.grant?.state==='connected';
      row.oauth.hint.textContent='Retained grant: '+settings.oauthConnection.grantId+'. '+
        (matches?'Its current host grant matches; review still checks this replacement source and selected operation.':
          'Select a current reviewed connection for this replacement before saving.');
      row.oauth.hint.className=matches?'hint wrap':'oauth-warning wrap';
    } else {
      row.oauth.hint.textContent='Use this control when the replacement operation declares authorization-code OAuth. The original source and current reviewed grant are checked together.';
      row.oauth.hint.className='hint';
    }
  }
  function connectionSelection(row,route) {
    let selected=route.from;
    if(row.action.value==='remap') {
      selected=review.operations.find(operation=>key(operation)===row.target.value);
      if(!selected?.supported)throw new Error('Select an exact supported replacement operation for '+row.id);
    }
    const settings=JSON.parse(row.settings.value);
    return {settings,selection:{method:selected.method,path:selected.path,
      serverIndex:Number(settings.serverIndex??0),securityAlternative:Number(settings.securityAlternative??0)}};
  }
  function differenceTable(label,difference) {
    const detail=make('details'),summary=make('summary',label+' — '+difference.count+' changes');detail.append(summary);
    if(!difference.count)return detail;
    const table=make('table'),head=make('tr');for(const label of ['Declaration','Saved source','Replacement'])head.append(make('th',label));table.append(head);
    for(const change of difference.items) {
      const row=make('tr');row.append(make('td',change.path));
      for(const value of [change.before,change.after]) {
        const cell=make('td'),text=display(value)??'null';cell.append(make('code',text.length>1500?text.slice(0,1500)+'… (full value retained in the source)':text));row.append(cell);
      }
      table.append(row);
    }
    const scroll=make('div',undefined,'table-wrap');scroll.append(table);detail.append(scroll);
    if(difference.truncated)detail.append(make('p','Showing the first '+difference.items.length+' changed declarations. The complete source remains pinned to this review.','hint'));
    return detail;
  }
  function draw(value) {
    review=value;controls=[];additions.value=pretty(review.additions);
    base.textContent='Original saved project: '+baseName+' · '+review.base.sourceSha256;
    sourceLabel.textContent='Replacement source: '+review.sourceSha256;
    overview.replaceChildren(make('p',review.routes.length+' existing routes · '+review.unchangedSelected+' with unchanged contracts and outputs · '+review.additions.length+' additions · '+review.unselectedOperations+' unselected provider operations.'),
      make('p',review.sourceChanged?'The source bytes changed. Inspect each selected route and retain its intended settings.':'The source bytes match the saved document. You can still review explicit settings or route selections.','hint'));
    if(review.compilationError)overview.append(make('p','Original compiler: '+review.compilationError,'error wrap'));
    if(review.authorization&&!review.authorization.ready)
      overview.append(make('p','Current provider authorization: '+review.authorization.message,'oauth-warning wrap'));
    if(review.pending.length)overview.append(make('p','Choose keep, remap or drop for '+review.pending.length+' routes.','hint'));
    else if(review.ready)overview.append(make('p','The complete candidate compiles with the existing merchant runtime.','small'));
    overview.append(differenceTable('Complete provider source',review.sourceChanges));
    targets.replaceChildren();
    for(const operation of review.operations.filter(operation=>operation.supported)) {
      const option=make('option');option.value=key(operation);option.label=operation.summary??'';targets.append(option);
    }
    routeList.replaceChildren();
    for(const route of review.routes) {
      const card=make('details',undefined,'route revision-route');card.open=route.changed||route.action==='pending'||route.errors.length>0;
      card.append(make('summary',route.routeId+' · '+key(route.from)+' · '+(route.changed?'contract or output changed':'contract and output unchanged')));
      const action=make('select');action.setAttribute('aria-label','Decision for '+route.routeId);
      for(const [value,label] of [['','Choose decision'],['keep','Keep operation'],['remap','Remap operation'],['drop','Drop from candidate']]) {
        const option=make('option',label);option.value=value;action.append(option);
      }
      action.value=route.action==='pending'?'':route.action;
      const actionLabel=make('label','Route decision');actionLabel.append(action);
      const target=field('Exact replacement operation',route.to?key(route.to):key(route.from));target.input.setAttribute('list',targets.id);
      target.input.setAttribute('aria-label','Replacement operation for '+route.routeId);
      const settingsDetail=make('details'),settingsSummary=make('summary','Retained operation settings');
      const settings=make('textarea');settings.value=pretty(route.settings);settings.rows=9;settings.spellcheck=false;
      settings.setAttribute('aria-label','Operation settings for '+route.routeId);
      settingsDetail.append(settingsSummary,make('p','All saved settings are included: authentication references, server choice, examples, cache, stream and durable-operation settings where configured. Edit this JSON for an explicit configuration change. The original source-refresh engine retains amountAtomic and route identity '+route.routeId+'.','hint'),settings);
      const selected=make('div',undefined,'fields');selected.append(actionLabel,target.wrap);
      const authorizationPanel=make('details',undefined,'oauth-revision');let oauth=null;
      if(connections) {
        authorizationPanel.append(make('summary','Provider authorization for the replacement'));
        authorizationPanel.open=Boolean(route.settings.oauthConnection);
        const alias=make('select');alias.setAttribute('aria-label','Revision provider connection for '+route.routeId);
        const label=make('label','Reviewed provider connection');label.append(alias);
        const use=button('Use reviewed grant for the replacement');
        use.setAttribute('aria-label','Use revision grant for '+route.routeId);
        const hint=make('p','','hint');oauth={alias,use,hint};
        authorizationPanel.append(make('p','A changed source requires a connection profile registered for its exact bytes. Complete provider authorization in the connection section, then select that reviewed grant here. Existing non-OAuth settings stay retained.','hint'),label,use,hint);
        alias.addEventListener('change',()=>available());
        use.addEventListener('click',()=>act(async()=>{
          const row=controls.find(value=>value.id===route.routeId);
          const chosen=connectionSelection(row,route);
          const bound=await connections.binding(alias.value,source,chosen.selection);
          delete chosen.settings.oauth2;
          chosen.settings.oauthAlias=bound.oauthAlias;chosen.settings.oauthProfile=bound.oauthProfile;
          chosen.settings.oauthConnection=bound.oauthConnection;
          settings.value=pretty(chosen.settings);refreshConnectionControl(row);invalidate();
          notice('Reviewed replacement grant selected for '+route.routeId+'. Review the complete candidate before saving.');
        }));
      } else authorizationPanel.hidden=true;
      const update=()=>{target.wrap.hidden=action.value!=='remap';settingsDetail.hidden=action.value==='drop';authorizationPanel.hidden=!connections||action.value==='drop';};update();
      action.addEventListener('change',()=>{update();invalidate();});
      target.input.addEventListener('input',invalidate);settings.addEventListener('input',()=>{
        const row=controls.find(value=>value.id===route.routeId);if(row)refreshConnectionControl(row);invalidate();
      });
      card.append(selected,settingsDetail,authorizationPanel,differenceTable('Contracts and generated bindings',route.changes),differenceTable('Explicit settings',route.settingChanges));
      for(const error of route.errors)card.append(make('p',error,'error wrap'));
      const control={id:route.routeId,action,target:target.input,settings,oauth};controls.push(control);refreshConnectionControl(control);routeList.append(card);
    }
    available();
  }
  async function refresh() {
    const before=draftList.value,value=await api('revisions/drafts');draftList.replaceChildren();
    for(const name of value.drafts){const option=make('option',name);option.value=name;draftList.append(option);}
    if(value.drafts.includes(before))draftList.value=before;available();
  }
  function showCandidate(value) {
    candidate=value;candidateView.replaceChildren(make('p','Saved candidate: '+value.name,'small'),
      make('pre',value.folder,'wrap'),make('p','Based on '+value.sourceRevision.base.name+' · review '+value.sourceRevision.reviewSha256,'hint wrap'));
    store.input.value=value.release.store;stageName.input.value=value.name;create.checked=false;stageOutput.textContent='';releasePanel.hidden=false;available();
  }
  file.addEventListener('change',()=>act(async()=>{
    const selected=file.files?.[0];if(!selected)return;
    if(selected.size>4*1024*1024)throw new Error('OpenAPI source exceeds 4 MiB');
    source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await selected.arrayBuffer());
    controls=[];review=null;invalidate();sourceLabel.textContent=selected.name;
    if(!baseName)throw new Error('Open a saved project, then select its replacement source file.');
    draw(await api('revisions/review',{baseName,specText:source,decisions:[],additions:[]}));
    notice('Replacement source loaded. Review the selected routes.');
  }));
  reviewButton.addEventListener('click',()=>act(async()=>{draw(await api('revisions/review',request()));notice('Contract revision reviewed.');}));
  keepUnchanged.addEventListener('click',()=>{
    for(const control of controls)if(!review.routes.find(route=>route.routeId===control.id).changed&&!control.action.value)control.action.value='keep';
    invalidate();notice('Unchanged routes selected. Review the complete candidate.');
  });
  saveDraft.addEventListener('click',()=>act(async()=>{
    const saved=await api('revisions/draft',{...request(),name:draftName.input.value.trim()});
    await refresh();draftList.value=saved.name;notice('Review snapshot saved: '+saved.name);available();
  }));
  loadDraft.addEventListener('click',()=>act(async()=>{
    const saved=await api('revisions/load?name='+encodeURIComponent(draftList.value));
    baseName=saved.base.name;source=saved.specText;candidate=null;releasePanel.hidden=true;candidateView.replaceChildren();file.value='';
    draw(saved.review);notice('Review reopened: '+saved.name);
  }));
  refreshDrafts.addEventListener('click',()=>act(refresh));draftList.addEventListener('change',()=>available());
  additions.addEventListener('input',invalidate);
  save.addEventListener('click',()=>act(async()=>{
    const saved=await api('revisions/save',{...request(),name:packageName.input.value.trim(),expectedReviewSha256:review.reviewSha256,expectedRefreshReviewId:review.refreshReviewId});
    retainingCandidate=true;
    try{await onSaved(saved,{specText:source,plan:review.plan});}finally{retainingCandidate=false;}
    showCandidate(saved);notice('Reviewed candidate saved and ready in the original workspace: '+saved.name);
  }));
  stage.addEventListener('click',()=>act(async()=>{
    const result=await api('revisions/stage',{name:candidate.name,id:stageName.input.value.trim(),store:store.input.value.trim(),createStore:create.checked});
    create.checked=false;stageOutput.textContent='Candidate staged in the original release store. Open its console:\n\n'+result.release.console;
    notice('Saved candidate staged: '+stageName.input.value.trim());
  }));
  releasePanel.hidden=true;available();
  return {refresh,available,connectionsChanged(changed=[]) {
    let stale=false;
    for(const row of controls) {
      let settings={};try{settings=JSON.parse(row.settings.value);}catch{}
      if(changed.includes(settings.oauthAlias))stale=true;
      refreshConnectionControl(row);
    }
    if(candidate?.sourceRevision&&changed.some(alias=>review?.plan?.operations?.some(row=>row.oauthAlias===alias)))stale=true;
    if(stale)invalidate();else available();
  },selectPackage(name,value) {
    if(retainingCandidate)return;
    baseName=name;source='';review=null;controls=[];candidate=null;file.value='';additions.value='[]';
    sourceLabel.textContent='';overview.replaceChildren();routeList.replaceChildren();candidateView.replaceChildren();releasePanel.hidden=true;
    base.textContent='Original saved project: '+name;packageName.input.value=(name.slice(0,60)+'-v2');
    if(value?.sourceRevision)showCandidate(value);
    available();
  }};
}
