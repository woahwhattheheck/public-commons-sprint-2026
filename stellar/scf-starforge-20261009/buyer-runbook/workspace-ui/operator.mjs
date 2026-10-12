// MIT. Host setup in the original authenticated buyer workspace.
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const readable=value=>String(value??'').toLowerCase().replaceAll('_',' ');
const keys=['actor','service','payer','python','maxTotalAtomic','maxDailyAtomic','secretEnv','signerProvider','rpc','httpsProxyEnv'];
const ids={actor:'actor',service:'service',payer:'payer',python:'python',maxTotalAtomic:'total',maxDailyAtomic:'daily',
  secretEnv:'secret-env',signerProvider:'provider',rpc:'rpc',httpsProxyEnv:'proxy-env'};
function setting(value){return value===null||value===undefined?'<span class="muted">Not set</span>':'<code>'+escape(value)+'</code>';}
function availability(value) {
  if(!value)return '<p class="muted">Complete the host fields to inspect their local references.</p>';
  let html='<p>Python: <code>'+escape(value.python.path)+'</code> · '+(value.python.available?'executable available':'not executable on this host')+'</p>';
  const signer=value.signer;
  html+='<p>Signing reference: <code>'+escape(signer.name??signer.path)+'</code> · '+(signer.available?'available':'not available in this process')+'</p>';
  if(value.proxy)html+='<p>Proxy environment: <code>'+escape(value.proxy.name)+'</code> · '+(value.proxy.available?'available':'not set')+'</p>';
  return html+'<p class="muted">Availability is observed here. Native preparation and execution retain their original validation. Environment values are not returned.</p>';
}
function impact(value) {
  if(!value)return '';
  let html='<p>'+value.prepared+' prepared buyers and '+value.preparing+' retained buyer preparations keep their original settings and ledgers. '+value.needsReview+' pending request reviews need to be saved again for these settings.</p>';
  if(value.rows.length)html+='<div class="operator-table"><table><thead><tr><th>Received request</th><th>Current stage</th><th>Effect</th></tr></thead><tbody>'+
    value.rows.map(row=>'<tr><td><strong>'+escape(row.label)+'</strong><small>'+escape(readable(row.kind))+'</small></td><td>'+escape(readable(row.phase))+'</td><td>'+
      (row.phase==='PREPARED'?'Original buyer retained':row.phase==='PREPARING'?'Resume the same retained preparation':row.needsReview?'Save a current request review':row.phase==='REVIEWED'?'Review still matches':'Review with the saved host settings')+'</td></tr>').join('')+'</tbody></table></div>';
  if(value.errors.length)html+='<p class="muted">Retained items needing attention: '+value.errors.map(row=>escape(row.id)+' · '+escape(readable(row.code))).join('; ')+'</p>';
  return html;
}
export function createBuyerOperatorUI({request,notice,refreshState,openPanel}) {
  let snapshot=null,loaded=false,dirty=false,busy=false,version=0,reviewed=null,sourceRevision=null;
  const form=$('#operator-form');
  function changed(event) {
    dirty=true;version++;reviewed=null;
    if(event?.target?.id!=='operator-note')sourceRevision=null;
    $('#operator-review-panel').hidden=true;controls();
  }
  function collect() {
    const value={schema:'stellar-forge.buyer-runbook-operator.v1'};
    for(const key of ['actor','service','payer','python','maxTotalAtomic','maxDailyAtomic'])value[key]=$('#operator-'+ids[key]).value;
    if($('#operator-signer-kind').value==='PROVIDER')value.signerProvider=$('#operator-provider').value;
    else value.secretEnv=$('#operator-secret-env').value;
    for(const key of ['rpc','httpsProxyEnv'])if($('#operator-'+ids[key]).value!=='')value[key]=$('#operator-'+ids[key]).value;
    return value;
  }
  function fill(value) {
    for(const key of keys)$('#operator-'+ids[key]).value=value?.[key]??'';
    $('#operator-signer-kind').value=value?.signerProvider?'PROVIDER':'ENVIRONMENT';
    if(!value?.signerProvider&&!value?.secretEnv)$('#operator-secret-env').value='STELLAR_SECRET';
    if(!value?.python)$('#operator-python').value=snapshot?.defaultPython??'';
    $('#operator-note').value='';sourceRevision=null;reviewed=null;dirty=false;loaded=true;version++;
    $('#operator-review-panel').hidden=true;controls();
  }
  function controls() {
    const provider=$('#operator-signer-kind').value==='PROVIDER';
    $('#operator-provider-row').hidden=!provider;$('#operator-environment-row').hidden=provider;
    $('#operator-provider').required=provider;$('#operator-secret-env').required=!provider;
    for(const element of form.elements)element.disabled=busy;
    $('#operator-provider').disabled=busy||!provider;$('#operator-secret-env').disabled=busy||provider;
    $('#operator-review').disabled=busy||!snapshot?.stateSha256;
    $('#operator-save').disabled=busy||!reviewed||reviewed.version!==version||reviewed.result.noChange;
    $('#operator-reload').disabled=busy;
    $('#operator-draft-state').textContent=dirty?'Unsaved host settings':sourceRevision?'Saved version loaded for review':'Saved host settings';
  }
  function renderCurrent(value) {
    const state=value.configured?(value.mode==='WORKSPACE'?'Workspace revision '+value.revisionNumber:'Launcher-declared preset'):'Setup required';
    $('#operator-ready').textContent=value.configured?'Configured':'Set up';
    $('#operator-current').innerHTML='<div class="section-heading"><h2>'+escape(state)+'</h2><span class="badge">'+escape(readable(value.mode))+'</span></div>'+
      (value.error?'<p>'+escape(readable(value.error))+'. The received requests and earlier saved versions remain available.</p>':'')+
      (value.operator?'<p><strong>'+escape(value.operator.actor)+' / '+escape(value.operator.service)+'</strong></p><p>Payer <code>'+escape(value.operator.payer)+'</code></p>':'<p>Set the local host identity, payer, signing reference and ceilings before preparing a received request.</p>')+
      (value.settingsFile?'<p class="muted wrap">Selected settings: <code>'+escape(value.settingsFile)+'</code></p>':'')+
      (value.mode==='DECLARED'?'<p class="muted">Saving a workspace revision copies the reviewed host settings into this private workspace. The launcher-declared file stays intact.</p>':'')+
      availability(value.availability);
    $('#operator-history').innerHTML=value.history.length?'<div class="operator-table"><table><thead><tr><th>Version</th><th>Host and reason</th><th>Saved</th><th>Open</th></tr></thead><tbody>'+
      value.history.map(row=>row.error?'<tr><td>'+escape(row.id)+'</td><td colspan="3">'+escape(readable(row.error))+'</td></tr>':
        '<tr><td>'+row.revision+(row.current?' · current':'')+'</td><td><strong>'+escape(row.actor)+' / '+escape(row.service)+'</strong><small>'+escape(row.note??'')+'</small></td><td>'+escape(new Date(row.createdAt).toLocaleString())+'</td><td><button type="button" data-operator-revision="'+row.id+'">Use as draft</button> <a class="button quiet" href="/files/operator/'+row.id+'/settings.json">Download settings</a></td></tr>').join('')+'</tbody></table></div>':
      '<p class="muted">Saved host revisions appear here. Loading a version does not replace the active settings.</p>';
    if(value.impact)$('#operator-current-impact').innerHTML=impact(value.impact);
  }
  async function refresh({replaceDraft=false}={}) {
    const value=await request('/api/operator');snapshot=value;renderCurrent(value);
    if(!loaded||replaceDraft||!dirty&&!reviewed)fill(value.settings);
    controls();return value;
  }
  async function open() {openPanel();await refresh();}
  async function work(action) {
    if(busy)return;busy=true;controls();notice('');
    try{await action();}catch(error){notice(error.message,true);}
    finally{busy=false;controls();}
  }
  form.addEventListener('input',changed);
  $('#operator-signer-kind').addEventListener('change',controls);
  form.addEventListener('submit',event=>{event.preventDefault();work(async()=>{
    const draftVersion=version,settings=collect(),note=$('#operator-note').value,from=sourceRevision;
    // Review is the explicit comparison point. Keep edited fields while reading
    // the latest saved baseline, then pin that exact baseline through saving.
    const current=await request('/api/operator');snapshot=current;renderCurrent(current);
    const input={settings,note,expectedStateSha256:current.stateSha256,...(from?{sourceRevision:from}:{})};
    const result=await request('/api/operator/review',input);
    if(draftVersion!==version)return;
    reviewed={input,result,version:draftVersion};
    $('#operator-review-panel').hidden=false;
    $('#operator-review-summary').textContent=result.noChange?'These exact settings are already selected.':
      result.adoption?'Save these host settings inside this workspace.':result.repair?'Replace the selected damaged settings with this reviewed version.':'Save this host settings revision.';
    $('#operator-changes').innerHTML=result.changes.length?'<div class="operator-table"><table><thead><tr><th>Setting</th><th>Current</th><th>Proposed</th></tr></thead><tbody>'+
      result.changes.map(row=>'<tr><td>'+escape(row.field)+'</td><td>'+setting(row.before)+'</td><td>'+setting(row.after)+'</td></tr>').join('')+'</tbody></table></div>':
      '<p>The field values are unchanged. Original preset bytes are retained when adopting or restoring an exact saved version.</p>';
    $('#operator-review-availability').innerHTML=availability(result.availability);
    $('#operator-review-impact').innerHTML=impact(result.impact);
    $('#operator-review-digest').textContent=result.reviewSha256;
    $('#operator-settings-digest').textContent=result.settingsSha256;
    notice(result.noChange?'These host settings are already selected.':'Review the host fields and pending-request effects, then save this version.');
  });});
  $('#operator-save').addEventListener('click',()=>work(async()=>{
    if(!reviewed||reviewed.version!==version)throw new Error('Review the current host fields before saving.');
    const retained=reviewed,draftVersion=version;
    const result=await request('/api/operator/save',{...retained.input,expectedReviewSha256:retained.result.reviewSha256});
    if(draftVersion!==version)return;
    snapshot=result;fill(result.settings);renderCurrent(result);await refreshState();
    notice(result.alreadySaved?'The same host settings revision is already saved.':'Host settings saved. Received requests use this version for their next review; prepared buyers retain their original ledgers.');
  }));
  $('#operator-reload').addEventListener('click',()=>work(()=>refresh({replaceDraft:true})));
  $('#operator-history').addEventListener('click',event=>{
    const button=event.target.closest('[data-operator-revision]');if(!button)return;
    work(async()=>{const value=await request('/api/operator/'+button.dataset.operatorRevision);
      fill(value.settings);sourceRevision=value.id;dirty=true;version++;controls();
      notice('Saved version loaded as a draft. Review it against the current host settings before saving.');});
  });
  for(const id of ['open-operator','welcome-operator'])$('#'+id).addEventListener('click',()=>work(open));
  document.addEventListener('click',event=>{if(event.target.closest('[data-operator-setup]'))work(open);});
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  return {open,refresh,update(value){if(!value)return;snapshot=value;renderCurrent(value);
    if(!loaded||!dirty&&!reviewed)fill(value.settings);controls();}};
}
