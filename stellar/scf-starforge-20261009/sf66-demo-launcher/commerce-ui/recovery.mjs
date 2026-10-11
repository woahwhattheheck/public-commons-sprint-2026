// MIT. The original commerce console's retained operating-state recovery controls.
const element=(tag,text,className)=>{
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(className)node.className=className;
  return node;
};
const label=value=>String(value??'').replaceAll('_',' ').toLowerCase().replace(/^\w/,x=>x.toUpperCase());
const bytes=value=>Number.isSafeInteger(value)?new Intl.NumberFormat().format(value)+' bytes':'—';
const date=value=>value?new Date(value).toLocaleString():'—';
const messages={
  INITIALIZATION_ALREADY_RUNNING:'Another original commerce process owns this session. Stop and drain that process, then review again.',
  COMMERCE_RECOVERY_REVIEW_CHANGED:'The retained state changed after review. Pause and review the current state before capturing it.',
  COMMERCE_RECOVERY_REVIEW_REQUIRED:'Review the current retained state before creating its backup.',
  WORKSPACE_RECOVERY_RESTORE_TARGET_EXISTS:'The original state directory is populated. Retain it separately before restoring to the original empty location.',
  COMMERCE_RECOVERY_DEPENDENCY_OUTSIDE_ROOT:'A required operating file is outside the configured state root. Include its original location in the host recovery configuration.',
  COMMERCE_RECOVERY_DEPENDENCY_MISSING:'A required retained file is missing. Restore the original file before capturing this session.',
  COMMERCE_RECOVERY_INTERRUPTED:'The recovery task was cancelled. Existing completed backups and original state remain available.',
  WORKSPACE_RECOVERY_INTERRUPTED:'The recovery task was cancelled. Existing completed backups and original state remain available.',
};

/** Paths and secret values are host configuration. The browser selects an
 * authenticated retained backup ID and an exact reviewed state identity. */
export function createRecoveryPanel({host,request,notice,refreshSession}) {
  let view=null,pending=false,selected='',timer,loading=false,revision=0;
  host.className='panel commerce-recovery';host.hidden=true;
  const heading=element('div',undefined,'panel-heading');
  const title=element('div');title.append(element('span','Operating state','eyebrow'),element('h2','Backup and recovery'));
  const badge=element('span','Ready','badge');heading.append(title,badge);
  const introduction=element('p','Pause and review the retained merchant and buyer state. Create an encrypted backup, verify it, and restore this same session after a state-directory loss.','help');
  const facts=element('dl',undefined,'facts recovery-facts');
  const actions=element('div',undefined,'recovery-actions');
  const buttons={};
  function button(name,text) {
    const value=element('button',text);value.type='button';value.id='recovery-'+name;
    value.addEventListener('click',()=>act(name));buttons[name]=value;return value;
  }
  actions.append(button('review','Pause and review state'),button('capture','Create encrypted backup'),
    button('reopen','Reopen original session'),button('cancel','Cancel recovery task'));
  const progress=element('p',undefined,'recovery-progress');progress.id='recovery-job-status';
  progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');
  const result=element('dl',undefined,'facts recovery-facts');
  const selectionLabel=element('label','Retained backup');selectionLabel.htmlFor='recovery-selection';
  const selection=element('select');selection.id='recovery-selection';
  selection.addEventListener('change',()=>{selected=selection.value;render(view);});
  const record=element('dl',undefined,'facts recovery-facts');
  const savedActions=element('div',undefined,'recovery-actions');
  savedActions.append(button('verify','Verify selected backup'),button('restore','Restore original paths'));
  const restoreNote=element('p',undefined,'help');
  const review=element('details',undefined,'recovery-review');
  const summary=element('summary','Reviewed state closure'),reviewFacts=element('dl',undefined,'facts recovery-facts');
  const sessions=element('ul',undefined,'recovery-list'),paths=element('ul',undefined,'recovery-list'),
    runtime=element('ul',undefined,'recovery-list');
  review.append(summary,reviewFacts,element('h3','Original sessions'),sessions,
    element('h3','Retained locations'),paths,element('h3','Runtime and environment'),runtime);
  host.append(heading,introduction,facts,actions,progress,result,selectionLabel,selection,record,
    savedActions,restoreNote,review);
  function populate(target,entries) {
    target.replaceChildren();
    for(const [name,value] of entries)if(value!==undefined&&value!==null)target.append(
      element('dt',name),element('dd',String(value)));
  }
  function list(target,values) {
    target.replaceChildren(...values.map(value=>element('li',value)));
  }
  function render(next) {
    view=next;host.hidden=!next?.enabled;if(!next?.enabled)return;
    const job=next.job,controls=next.controls??{},saved=next.backups??[];
    badge.textContent=job?.running?'Working':job?.error?'Needs attention':job?label(job.result?.status??job.kind):'Ready';
    populate(facts,[['Session directory',next.directory],['State root',next.stateRoot],
      ['Backup location',next.backupDirectory],['Passphrase environment',next.passphraseEnvironment]]);
    buttons.review.disabled=pending||!controls.canReview;
    buttons.capture.disabled=pending||!controls.canCapture;
    buttons.reopen.disabled=pending||!controls.canReopen;
    buttons.cancel.hidden=!controls.canCancel;buttons.cancel.disabled=pending||!controls.canCancel;
    progress.textContent=job?.running?label(job.stage)+'…':job?.error?
      (messages[job.error]??label(job.error))+' ['+job.error+']':
      job?.result?label(job.result.status):
      'Backups retain original requests, responses, operator journals and payment records.';
    progress.dataset.error=String(Boolean(job?.error));
    populate(result,job?.result?[['Last result',label(job.result.status)],['Files',job.result.files],
      ['Retained size',bytes(job.result.bytes)],['Authenticated record',job.result.recordSha256],
      ['Original operator journals',job.result.operators?.length],
      ['Reopen diagnostics',(job.result.nativeReopenErrors?.length??0)+(job.result.commerceReopenErrors?.length??0)],
      ['Execution started',job.result.executionStarted===false?'No':undefined]]:[]);
    const previous=selected;
    if(!saved.some(item=>item.id===selected))selected=job?.backupId&&saved.some(item=>item.id===job.backupId)?
      job.backupId:saved[0]?.id??'';
    const choices=JSON.stringify(saved.map(item=>[item.id,item.status,item.createdAt,item.interrupted]));
    if(selection.dataset.choices!==choices) {
      selection.replaceChildren(...saved.map(item=>{
        const option=element('option',date(item.createdAt)+' · '+label(item.status)+(item.interrupted?' · interrupted capture':''));
        option.value=item.id;return option;
      }));
      selection.dataset.choices=choices;
    }
    selection.value=selected;selection.disabled=pending||Boolean(job?.running)||saved.length===0;
    const item=saved.find(value=>value.id===selected),usable=Boolean(item)&&item.status!=='UNAVAILABLE';
    populate(record,item?[['Backup',item.id],['Status',label(item.status)],['Created',date(item.createdAt)],
      ['Retained files',item.files],['Retained size',bytes(item.bytes)],['Record SHA-256',item.recordSha256],
      ['Verified',item.lastVerifiedAt?date(item.lastVerifiedAt):undefined],
      ['Result',item.error?messages[item.error]??label(item.error):undefined]]:[]);
    buttons.verify.disabled=pending||!controls.canVerify||!usable;
    buttons.restore.disabled=pending||!controls.canRestore||!usable;
    restoreNote.textContent=next.restoreable?
      'Restore authenticates the selected archive and publishes it at the original empty state location. Reopen starts the original session and retains every existing operation state.':
      'The original state location is populated. Keep that state separately before using Restore original paths. Verify can inspect an encrypted backup while the source still exists.';
    review.hidden=!next.review;
    if(next.review) {
      const profile=next.review;
      summary.textContent='Reviewed state · '+profile.sessions.length+' sessions · '+profile.operators.length+' operators';
      populate(reviewFacts,[['Review SHA-256',profile.reviewSha256],['Restore location',profile.stateRoot],
        ['Saved preparation',profile.preparation],['Missing optional locations',profile.missing?.length??0]]);
      list(sessions,profile.sessions.map(item=>item.directory+' — '+item.buyers.map(job=>
        job.intentId+' ('+label(job.state)+')').join('; ')));
      list(paths,(profile.selected??[]).map(item=>typeof item==='string'?item:JSON.stringify(item)));
      list(runtime,[...(profile.runtime??[]).map(item=>typeof item==='string'?item:JSON.stringify(item)),
        'Provide the original wallet and provider environment when reopening. Environment secret values are not exported.']);
    }
  }
  function schedule() {
    clearTimeout(timer);
    if(view?.job?.running)timer=setTimeout(()=>refresh(),1200);
  }
  async function refresh() {
    if(loading)return;
    loading=true;const order=++revision;
    try {
      const next=await request('/api/recovery');
      if(order===revision)render(next);
    } catch(error) {if(view?.enabled)notice(error.message,true);}
    finally {loading=false;schedule();}
  }
  async function act(name) {
    if(pending)return;
    pending=true;render(view);notice(null);
    try {
      const body=name==='capture'?{reviewSha256:view.review?.reviewSha256}:
        ['verify','restore'].includes(name)?{id:selected}:{};
      await request('/api/recovery/'+name,{method:'POST',body});
      // The accepted original job belongs to the console, not the HTTP request.
      await refresh();await refreshSession({quiet:true});
    } catch(error){notice(error.message,true);}
    finally {pending=false;render(view);schedule();}
  }
  return {refresh,render,destroy(){clearTimeout(timer);revision++;}};
}
