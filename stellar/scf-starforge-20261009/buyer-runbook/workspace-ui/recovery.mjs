// MIT. Existing private buyer workspace; original native recovery owns all state.
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const readable=value=>String(value??'').toLowerCase().replaceAll('_',' ');
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
const clock=value=>value?new Date(value).toLocaleString():'';
const size=value=>Number(value).toLocaleString()+' bytes';
export function createRunbookRecoveryUI({request,notice,refreshState,openPanel}) {
  let review=null,current={active:null,history:[]},busy=false,lastResult=null;
  const working=()=>busy||Boolean(current.active&&!current.active.finishedAt);
  function controls() {
    const active=working();
    $('#recovery-review-button').disabled=active;
    $('#recovery-capture').disabled=active||!review||!$('#recovery-quiesced').checked;
    $('#recovery-verify').disabled=active;
    $('#recovery-cancel').hidden=!current.active||Boolean(current.active.finishedAt);
    $('#recovery-cancel').disabled=Boolean(current.active?.cancelRequested)||busy;
  }
  function operators(rows,withCheckpoint=false) {
    return '<div class="table-wrap"><table><thead><tr><th>Original operator</th><th>Network / payer</th>'+(withCheckpoint?'<th>Retained ledger checkpoint</th>':'')+'</tr></thead><tbody>'+rows.map(row=>{
      const checkpoint=row.checkpoint;
      return '<tr><td><code>'+escape(row.directory)+'</code></td><td>'+escape(row.network)+'<br><code>'+escape(row.payer)+'</code></td>'+
        (withCheckpoint?'<td>'+escape(readable(checkpoint.outcome))+'<br>'+checkpoint.rows+' reservations · '+checkpoint.events+' journal events<br>'+checkpoint.reserved+' reserved · '+checkpoint.settled+' settled<br>Sequence '+checkpoint.sequence+'<br><code>'+escape(checkpoint.journalMac)+'</code></td>':'')+'</tr>';
    }).join('')+'</tbody></table></div>';
  }
  function renderReview() {
    $('#recovery-review').hidden=!review;
    if(!review)return;
    const profile=review.profile;
    $('#recovery-review-summary').textContent=profile.runs.length+' acquisitions · '+profile.requests.length+' received requests · '+profile.operators.length+' original operators';
    $('#recovery-operators').innerHTML=operators([review.native,...(review.native.operators??[])]);
    $('#recovery-paths').textContent=profile.selected.join('\n')+
      (profile.missing.length?'\n\nCurrently absent optional paths:\n'+profile.missing.join('\n'):'')+
      (profile.runtime.length?'\n\nRuntime files remain at their installed locations:\n'+profile.runtime.map(row=>typeof row==='string'?row:JSON.stringify(row)).join('\n'):'');
    $('#recovery-review-digest').textContent=profile.reviewSha256;
    controls();
  }
  function renderResult(result) {
    if(!result){$('#recovery-result').hidden=true;return;}
    const verified=result.status==='BUYER_STATE_BACKUP_VERIFIED';
    const application=result.application;
    const bundle=result.bundle;
    const passEnv=$('#recovery-pass-env').value;
    const python=$('#recovery-python').value||'/usr/bin/python3';
    const command='npx --no-install starforge buyer-runbook ';
    const selection=' --bundle '+quote(bundle)+' --expect '+quote(result.recordSha256)+' --pass-env '+quote(passEnv)+' --python '+quote(python);
    let html='<h3>'+(verified?'Archive verified':'Encrypted backup created')+'</h3><dl class="detail-grid">'+
      '<div><dt>Archive</dt><dd><code>'+escape(bundle)+'</code></dd></div>'+
      '<div><dt>Authenticated record SHA-256</dt><dd><code>'+escape(result.recordSha256)+'</code></dd></div>'+
      '<div><dt>Files retained</dt><dd>'+result.files+' · '+size(result.bytes)+'</dd></div>'+
      '<div><dt>Original state root</dt><dd><code>'+escape(result.stateRoot)+'</code></dd></div></dl>'+
      operators(result.operators??[],true);
    if(result.selectionRecordError)html+='<p class="error">The archive was created, but its local history could not be saved: '+escape(readable(result.selectionRecordError))+'. Keep the archive path and record SHA-256 shown above.</p>';
    if(result.leaseReleaseErrors?.length)html+='<p class="error">The archive was created. A source lease needs attention before another operation: '+escape(result.leaseReleaseErrors.map(row=>row.directory+' · '+row.code).join('; '))+'.</p>';
    html+='<h3>Verify or restore on the operator machine</h3><p>Keep the passphrase in the named environment variable and retain this record SHA-256 separately. Restore requires the original state root to be absent or empty. Stop the running buyer workspace before restoring it.</p>'+
      '<pre class="recovery-command">'+escape(command+'backup-verify'+selection+'\n\n'+command+'backup-restore'+selection)+
      (application?escape('\n\n'+command+'workspace --state '+quote(application.directory)):'')+'</pre>'+
      '<p class="muted">Restore checks every original ledger and reopens the saved workspace. It does not execute a purchase or refresh accounting. Review the restored acquisitions before choosing another action.</p>';
    $('#recovery-result').innerHTML=html;$('#recovery-result').hidden=false;
  }
  function history() {
    $('#recovery-history').innerHTML=current.history?.length?current.history.map((row,index)=>
      '<article class="panel"><strong>'+escape(clock(row.createdAt)||'Retained backup selection')+'</strong>'+
      '<p class="wrap"><code>'+escape(row.bundle??row.recordSha256)+'</code></p>'+
      (row.error?'<p class="error">'+escape(readable(row.error))+'</p>':
        '<p class="muted">'+(row.operators?.length??1)+' operators · '+row.files+' files · '+size(row.bytes)+'</p><button type="button" data-backup="'+index+'">Select for verification</button>')+'</article>').join(''):
      '<p class="muted">Backups created here will appear after publication. Keep the encrypted archive and its record SHA-256 in your backup storage.</p>';
  }
  function update(value) {
    current=value??{active:null,history:[]};
    const active=current.active;
    $('#recovery-status').textContent=active?readable(active.status)+(active.finishedAt?' · '+clock(active.finishedAt):''):'Ready';
    $('#recovery-progress').hidden=!active;
    if(active)$('#recovery-progress').textContent=(active.events??[]).map(event=>clock(event.at)+' · '+readable(event.stage)+(event.directory?' · '+event.directory:'')).join('\n')+
      (active.error?'\n'+readable(active.error):'')+(active.cancelRequested?'\nCancellation requested. Original capture workers are closing.':'');
    if(active?.result&&lastResult!==active.id) {
      lastResult=active.id;
      $('#recovery-bundle').value=active.result.bundle??'';
      $('#recovery-expected').value=active.result.recordSha256??'';
      renderResult(active.result);
    }
    history();controls();
  }
  const act=operation=>async event=>{
    event?.preventDefault();busy=true;controls();notice('');
    try{await operation(event);}catch(error){notice(error.message,true);}
    finally{busy=false;controls();}
  };
  $('#open-recovery').addEventListener('click',()=>{openPanel();notice('');});
  $('#recovery-state-root').addEventListener('input',()=>{review=null;renderReview();controls();});
  $('#recovery-quiesced').addEventListener('change',controls);
  $('#recovery-review-form').addEventListener('submit',act(async()=>{
    review=await request('/api/recovery/review',{stateRoot:$('#recovery-state-root').value});
    renderReview();notice('Review the included operators and paths before creating the backup.');
  }));
  $('#recovery-capture-form').addEventListener('submit',act(async()=>{
    if(!review||!$('#recovery-quiesced').checked)throw new Error('Review the source and confirm that its other writers are stopped.');
    await request('/api/recovery/start',{kind:'SNAPSHOT',stateRoot:review.profile.stateRoot,
      expectedReviewSha256:review.profile.reviewSha256,output:$('#recovery-output').value,
      passEnv:$('#recovery-pass-env').value,quiesced:true});
    await refreshState();
  }));
  $('#recovery-verify-form').addEventListener('submit',act(async()=>{
    await request('/api/recovery/start',{kind:'VERIFY',bundle:$('#recovery-bundle').value,
      ...($('#recovery-expected').value?{expected:$('#recovery-expected').value}:{}),
      passEnv:$('#recovery-pass-env').value,python:$('#recovery-python').value});
    await refreshState();
  }));
  $('#recovery-cancel').addEventListener('click',act(async()=>{
    await request('/api/recovery/cancel',{id:current.active.id});await refreshState();
  }));
  $('#recovery-history').addEventListener('click',event=>{
    const button=event.target.closest('[data-backup]');if(!button)return;
    const row=current.history[Number(button.dataset.backup)];if(!row||row.error)return;
    $('#recovery-bundle').value=row.bundle;$('#recovery-expected').value=row.recordSha256;
    $('#recovery-verify-form').scrollIntoView({block:'center'});notice('Saved archive and record SHA-256 selected. Verify before restoring.');
  });
  return {update};
}
