// MIT. Original acquisition accounting in the existing operator workspace.
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const readable=value=>String(value??'Not recorded').toLowerCase().replaceAll('_',' ');
const time=value=>value?new Date(value).toLocaleString():'—';

export function createRunbookAccountingUI({current,action,notice}) {
  const edits=new Map();
  const key=(run,id)=>run+':'+id;
  const handle=fn=>async event=>{try{await fn(event);}catch(error){notice(error.message,true);}};
  document.querySelector('#finalize-run').addEventListener('click',handle(async()=>{
    await action('finalize');notice('Original accounting is running. Receipts and totals update as each existing attempt finishes.');
  }));
  const container=document.querySelector('#run-operations');
  container.addEventListener('input',event=>{
    const input=event.target.closest('[data-accounting-workspace]');
    if(input)edits.set(key(current().id,input.dataset.accountingWorkspace),input.value);
  });
  container.addEventListener('click',handle(async event=>{
    const finalize=event.target.closest('[data-finalize-operation]');
    if(finalize){await action('finalize',{only:finalize.dataset.finalizeOperation});return;}
    const bind=event.target.closest('[data-bind-accounting]');
    if(bind){
      const run=current().id,id=bind.dataset.bindAccounting;
      const row=current().state.operations.find(row=>row.id===id);
      const workspace=edits.get(key(run,id))??row.accounting?.workspace??'';
      if(!workspace.startsWith('/'))throw new Error('Enter the absolute path to this operation’s existing SF88 operator workspace.');
      await action('accounting-workspace',{only:id,workspace});
      edits.delete(key(run,id));notice('Original operator workspace selected for this operation’s accounting.');
    }
  }));
  function summary(run,disabled) {
    const state=run.accounting;
    document.querySelector('#finalize-run').disabled=disabled||!run.operations.some(row=>row.state!=='UNATTEMPTED');
    document.querySelector('#download-accounting').href=`/files/${current().id}/accounting.csv`;
    document.querySelector('#accounting-summary').textContent=
      `${state.finalizedOperations} finalized · ${state.unsignedOperations} unsigned responses · ${state.unresolvedOperations} awaiting accounting`;
    const failures=current().active?.kind==='ACCOUNTING'?
      (current().active.result?.results??[]).filter(row=>row.viewStatus==='SAVE_FAILED'):[];
    const live=document.querySelector('#accounting-live-result');live.hidden=!failures.length;
    live.innerHTML=failures.map(row=>`<p><strong>${escape(row.id)}: accounting view could not be saved.</strong> ${row.finalized?
      `Original finalized amount ${escape(row.finalized.actualAtomicUnits)} atomic. Receipt <code>${escape(row.finalized.receipt)}</code>.`:''} Restore local storage and refresh this same attempt. <code>${escape(row.saveError)}</code></p>`).join('');
    document.querySelector('#accounting-totals').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Network / asset</th><th>Finalized atomic</th><th>Finalized</th><th>Unsigned</th><th>Unresolved</th><th>Untouched</th></tr></thead><tbody>${state.groups.map(group=>
      `<tr><td>${escape(group.network)}<br><code>${escape(group.asset)}</code></td><td class="amount">${escape(group.finalizedActualAtomic)}</td><td>${group.finalizedOperations}</td><td>${group.unsignedOperations}</td><td>${group.unresolvedOperations}</td><td>${group.unattemptedOperations}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function operation(row,{runId,disabled,opened}) {
    const account=row.accounting,final=account.finalized;
    const workspace=edits.get(key(runId,row.id))??account.workspace??'';
    const selected=opened.has(row.id+'-accounting-workspace');
    const currentFinal=['FINALIZED','IDEMPOTENT_FINALIZED'].includes(account.outcome);
    const status=final?`${final.actualAtomicUnits} atomic finalized`:
      account.outcome==='NO_PAYMENT_REQUIRED'?'Original unsigned response':
        account.outcome==='NOT_RECORDED'?'Accounting not yet recorded':readable(account.outcome);
    return `<section class="operation-accounting" aria-label="Accounting for ${escape(row.label)}">
      <div class="accounting-heading"><strong>${escape(status)}</strong>${row.state!=='UNATTEMPTED'?`<button data-finalize-operation="${escape(row.id)}" ${disabled?'disabled':''}>Refresh accounting</button>`:''}</div>
      <dl class="detail-grid"><div><dt>Latest accounting check</dt><dd>${escape(readable(account.outcome))} · ${escape(time(account.checkedAt))}</dd></div><div><dt>Original operator</dt><dd><code>${escape(account.workspace??'Received requests reuse their retained operator; other configurations need a selection below.')}</code></dd></div>
      ${final?`<div><dt>Original receipt</dt><dd><code>${escape(final.receipt)}</code></dd></div><div><dt>Finalized request digest</dt><dd><code>${escape(final.requestSha256)}</code></dd></div>`:''}</dl>
      ${final&&!currentFinal?`<p class="accounting-note">The finalized receipt from ${escape(time(final.completedAt))} remains included in the totals. The latest check is shown above.</p>`:''}
      ${account.lastError?`<p class="accounting-note">Local accounting: <code>${escape(account.lastError)}</code>. Correct that condition and refresh this existing attempt.</p>`:''}
      <details data-detail="${escape(row.id)}-accounting-workspace" ${selected?'open':''}><summary>Select the existing operator workspace</summary>
        <p class="muted">Use the original SF88 operator directory for this request. Received requests select their retained operator automatically. Selection preserves the original payer, ledger and payment terms.</p>
        <label>Original operator directory<input data-accounting-workspace="${escape(row.id)}" value="${escape(workspace)}" maxlength="1024" autocomplete="off" spellcheck="false" placeholder="/absolute/original-sf88-workspace" ${disabled?'disabled':''}></label>
        <button class="accounting-bind" data-bind-accounting="${escape(row.id)}" ${disabled?'disabled':''}>Save operator selection</button>
      </details></section>`;
  }
  function preserveFocus() {
    const input=document.activeElement;
    if(!input?.matches('[data-accounting-workspace]'))return ()=>{};
    const id=input.dataset.accountingWorkspace,start=input.selectionStart,end=input.selectionEnd;
    return ()=>{const replacement=container.querySelector(`[data-accounting-workspace="${id}"]`);
      if(replacement&&!replacement.disabled){replacement.focus({preventScroll:true});replacement.setSelectionRange(start,end);}};
  }
  return {summary,operation,preserveFocus};
}
