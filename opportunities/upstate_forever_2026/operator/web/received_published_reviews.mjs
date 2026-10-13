/** Source-bound saved Published-study reviews in the original received Study. */
const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validID=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const reviewID=value=>typeof value==='string'&&/^review-[0-9a-f]{64}$/.test(value);
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const button=(action,label,index,disabled)=>'<button type="button" data-received-action="published-review-'+action+'" data-published-review="'+index+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
const values=(value,empty)=>list(value).length?list(value).map(esc).join(', '):esc(empty);
function fileLink(item,label){
  const url=item?.url;
  if(typeof url!=='string'||!url.startsWith('/api/file/')||/[\\\u0000-\u001f\u007f]/.test(url))return '';
  return '<a href="'+esc(url+(url.includes('?')?'&':'?')+'download=1')+'">'+esc(label||item.label||item.filename)+'</a>';
}
function files(row){
  const all=list(row._downloads),primary=new Map([
    ['original-review.zip','Complete original study and saved review ZIP'],
    ['review.json','Original saved review JSON'],
    ['selected-context.json','Captured selected interpretation JSON'],
  ]);
  const leading=all.filter(item=>primary.has(item.label));
  return '<div class="st-actions">'+leading.map(item=>fileLink(item,primary.get(item.label))).join(' ')+'</div>'+
    '<details class="st-details"><summary>All original source and selected-record files ('+all.length+')</summary>'+
    '<ul class="st-published-review-files">'+all.map(item=>'<li>'+fileLink(item)+' <span>'+esc(item.bytes)+' bytes</span></li>').join('')+'</ul></details>';
}

const admissionAction='received.published-review.admit';
const sourceKey=value=>JSON.stringify([value?.source_collection_id,value?.source_id]);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const pendingAdmissions=new Map(),activeAdmissions=new Map();
const pendingKey=(workspace,study,row)=>'upstate-published-review-admission:'+JSON.stringify([workspace,study,sourceKey(row.source),row.review.id,row.original_review_archive_sha256]);
function pendingAdmission(workspace,study,row){
  const key=pendingKey(workspace,study,row);
  if(pendingAdmissions.has(key))return pendingAdmissions.get(key);
  try{
    const value=JSON.parse(globalThis.sessionStorage?.getItem(key)||'null');
    if(value?.workspace===workspace&&value?.study_id===study&&sourceKey(value.source)===sourceKey(row.source)&&
       value?.body?.action===admissionAction&&typeof value.body.operation_id==='string'){
      pendingAdmissions.set(key,value);return value;
    }
  }catch{}
  return null;
}
function retainAdmission(key,value){
  if(value)pendingAdmissions.set(key,value);else pendingAdmissions.delete(key);
  try{if(value)globalThis.sessionStorage?.setItem(key,JSON.stringify(value));else globalThis.sessionStorage?.removeItem(key);}catch{}
}
function admissionControls(detail,row,index,disabled){
  const admissions=list(row.local_admissions);
  let html=admissions.length?'<div class="st-review-admissions"><h5>Admitted editable review</h5><ul>'+
    admissions.map((value,n)=>'<li>'+esc(value.title)+' · '+esc(value.created_at)+' '+
      '<button type="button" data-received-action="published-review-admitted-open" data-published-review="'+index+
      '" data-review-admission="'+n+'" '+(disabled?'disabled':'')+'>Open admitted review</button></li>').join('')+
      '</ul><p>The original foreign report is retained. The editable review uses its exact original study edition and filters.</p></div>':'';
  if(row.native)return html;
  const pending=pendingAdmission(detail.workspace_key,detail.id,row);
  if(!admissions.length||pending)html+='<div class="st-review-admission"><p>Import the complete captured review and original study into this project. This preserves any study edition already selected here. Use the original editor to change notes or filters and save a new review.</p>'+
    '<div class="st-actions">'+button('admit',pending?'Continue original import':'Import as editable review',index,disabled)+
    (pending?.task_id?button('admission-task','Open import task',index,disabled):'')+'</div>'+
    '<p data-review-admission-status="'+index+'" role="status" aria-live="polite"></p></div>';
  return html;
}
async function openAdmission(host,value,detail,row,{workspace_key,current}){
  if(value?.project_id!==detail.project.id||sourceKey(value.original_source)!==sourceKey(row.source)||
     value.original_source_body_sha256!==row.source_body_sha256||value.review_id!==row.review.id||
     value.native?.review_id!==row.review.id||canonical(value.binding)!==canonical(row.original_study)||
     canonical(value.selection)!==canonical(row.selection)||
     value.files?.original_review_archive?.sha256!==row.original_review_archive_sha256)
    throw Error('The editable review differs from this captured source and original archive.');
  if(typeof host.openExtension!=='function')throw Error('Use the maintained Published studies desk.');
  if(!current())return;
  await host.openExtension('published-studies','openSavedReview',{
    workspace_key,review_id:value.review_id,expected_binding:value.binding,expected_selection:value.selection,
  });
}
async function admitReview(host,detail,row,index,target,{workspace_key,current}){
  const storageKey=pendingKey(workspace_key,detail.id,row),active=activeAdmissions.get(storageKey);
  if(active?.current())return active.promise;
  const work=(async()=>{
    const status=target.closest?.('.st-received-source')?.querySelector('[data-review-admission-status="'+index+'"]');
    const say=text=>{if(current()&&status?.isConnected!==false)status.textContent=text;};
    let retained=pendingAdmission(workspace_key,detail.id,row);
    target.disabled=true;
    try{
      const expected={study_id:detail.id,...row.source,source_body_sha256:row.source_body_sha256,
        review_id:row.review.id,archive_sha256:row.original_review_archive_sha256};
      if(!retained){
        say('Verifying the original review archive and source edition…');
        const prepared=await host.api('/api/received-published-review/preview?'+new URLSearchParams({workspace:workspace_key,...expected}));
        if(!current())return;
        if(!validID(prepared.id)||prepared.project_id!==detail.project.id||sourceKey(prepared.source)!==sourceKey(row.source)||
           prepared.source_body_sha256!==row.source_body_sha256||prepared.review_id!==row.review.id||
           prepared.archive?.sha256!==row.original_review_archive_sha256||
           canonical(prepared.binding)!==canonical(row.original_study)||canonical(prepared.selection)!==canonical(row.selection))
          throw Error('The original import preview returned another review or source edition.');
        if(prepared.existing_admission){await openAdmission(host,prepared.existing_admission,detail,row,{workspace_key,current});return;}
        retained={workspace:workspace_key,study_id:detail.id,source:{...row.source},
          body:{workspace:workspace_key,action:admissionAction,payload:{...expected,admission_id:prepared.id},
            operation_id:'published-review-admission-'+prepared.id}};
        retainAdmission(storageKey,retained);
      }
      if(retained.body.workspace!==workspace_key||retained.body.action!==admissionAction||
         !validID(retained.body.payload?.admission_id)||
         canonical(retained.body.payload)!==canonical({...expected,admission_id:retained.body.payload.admission_id}))
        throw Error('The retained import belongs to another original review.');
      say('Importing through the original native review task…');
      let task=retained.task_id?await host.api('/api/task?id='+encodeURIComponent(retained.task_id)):
        await host.api('/api/actions',{method:'POST',body:retained.body});
      const checkTask=value=>{
        if(!validID(value?.id)||value.workspace!==workspace_key||value.action!==admissionAction||
           canonical(value.payload)!==canonical(retained.body.payload)||
           (retained.task_id&&value.id!==retained.task_id)||
           (retained.accepted_operation_id&&value.operation_id!==retained.accepted_operation_id))
          throw Error('The native queue returned another review import.');
      };
      checkTask(task);
      retained={...retained,task_id:task.id,accepted_operation_id:task.operation_id,state:task.state};
      retainAdmission(storageKey,retained);
      const deadline=Date.now()+120000;
      while(current()&&['queued','running'].includes(task.state)&&Date.now()<deadline){
        say(task.state==='queued'?'Original review import is queued.':'Importing the complete original study and saved review…');
        await new Promise(resolve=>setTimeout(resolve,600));
        if(!current())return;
        task=await host.api('/api/task?id='+encodeURIComponent(retained.task_id));checkTask(task);
        retained={...retained,state:task.state};retainAdmission(storageKey,retained);
      }
      if(!current())return;
      if(['queued','running'].includes(task.state)){say('The original import is still '+task.state+'. Continue this same request to open its result.');return;}
      if(task.state!=='complete'){
        say('The original import is '+task.state+'. Open its task to inspect or resume the same operation.');
        if(typeof host.showTask==='function')await host.showTask(task.id);
        throw Error(task.error?.message||'The original review import is '+task.state+'.');
      }
      if(task.result?.id!==retained.body.payload.admission_id)throw Error('The completed task returned another review admission.');
      const result=await host.api('/api/received-published-review/admission?'+new URLSearchParams({workspace:workspace_key,id:task.result.id}));
      if(!current())return;
      await openAdmission(host,result,detail,row,{workspace_key,current});
      retainAdmission(storageKey,null);
    }catch(error){
      if(retained&&!retained.task_id&&error?.status>=400&&error.status<500)retainAdmission(storageKey,null);
      if(current())say(error?.message||String(error));throw error;
    }finally{if(current())target.disabled=false;}
  })();
  const entry={promise:work,current};activeAdmissions.set(storageKey,entry);
  try{return await work;}finally{if(activeAdmissions.get(storageKey)===entry)activeAdmissions.delete(storageKey);}
}

export function receivedPublishedReviewsHTML(detail,disabled=false){
  const rows=list(detail?.published_reviews);if(!rows.length)return '';
  return '<section class="st-published-reviews" aria-label="Saved Published-study reviews"><h4>Saved Published-study reviews</h4>'+
    '<p>Each review retains its original study edition and selection. Different study editions and report interpretations remain separately identified.</p>'+
    rows.map((row,index)=>{
      const review=row.review,content=review?.content||{},binding=row.original_study||{},selection=row.selection||{};
      let html='<article class="st-received-source"><h4>'+esc(content.title||row.study_title)+'</h4>'+
        '<p>'+esc(row.study_title)+' · '+esc(review?.saved_at||'')+'</p>'+
        '<dl class="st-published-review-selection">'+
        '<dt>Stations</dt><dd>'+values(selection.site_ids,'All retained stations')+'</dd>'+
        '<dt>Parameters</dt><dd>'+values(selection.parameters,'All retained parameters')+'</dd>'+
        '<dt>Strata</dt><dd>'+values(selection.strata,'All retained strata')+'</dd>'+
        '<dt>Year</dt><dd>'+esc(selection.year??'All retained years')+'</dd>'+
        '<dt>Months</dt><dd>'+values(list(selection.months).map(value=>months[Number(value)-1]||value),'All retained months')+'</dd>'+
        '<dt>Saved table</dt><dd>'+esc(content.table)+'</dd></dl>'+
        (row.interpretation_matches_snapshot===false?
          '<p class="st-row-error">This captured report interpretation differs from the saved review’s coverage or temporal-support snapshot. Its original study edition and selection are retained.</p>':'')+
        (content.notes?'<details class="st-details"><summary>Authored review notes</summary><pre class="st-published-review-notes">'+esc(content.notes)+'</pre></details>':'');
      html+='<div class="st-actions">'+(row.native?button('open','Open exact saved review',index,disabled):'')+
        button('source','Open original source collection',index,disabled)+
        button('report','Open this report only',index,disabled)+
        button('append','Add to current report',index,disabled)+'</div>';
      if(!row.native)html+='<p>The review originated in project <code>'+esc(row.source_project_id)+
        '</code>. Its complete original review and study travel in the source ZIP below.</p>';
      html+=admissionControls(detail,row,index,disabled);
      html+=files(row)+'<details class="st-details"><summary>Original review and source identities</summary>'+
        '<dl class="st-published-review-selection"><dt>Review</dt><dd><code>'+esc(review?.id)+'</code></dd>'+
        '<dt>Study</dt><dd>'+esc(binding.study_id)+'</dd><dt>Study edition</dt><dd><code>'+esc(binding.version_id)+'</code></dd>'+
        '<dt>Original study source</dt><dd><code>'+esc(binding.source_collection_id)+'</code></dd>'+
        '<dt>Source manifest SHA256</dt><dd><code>'+esc(binding.source_manifest_sha256)+'</code></dd>'+
        '<dt>Report source</dt><dd><code>'+esc(row.source?.source_collection_id)+'</code> / '+esc(row.source?.source_id)+'</dd>'+
        '<dt>Captured interpretation SHA256</dt><dd><code>'+esc(row.interpretation_sha256)+'</code></dd>'+
        '</dl></details></article>';
      return html;
    }).join('')+'</section>';
}
export async function openReceivedPublishedReview(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;
  if(!action?.startsWith('published-review-'))return false;
  const index=Number(target.dataset.publishedReview);
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.published_reviews)[index]:null;
  if(!row||detail.workspace_key!==workspace_key||!current())
    throw Error('Reopen this saved Study in its receiving Workspace.');
  if(!validID(row.source?.source_collection_id)||typeof row.source?.source_id!=='string'||!row.source.source_id)
    throw Error('Choose the retained original review source.');
  if(action==='published-review-admit'){
    if(row.native||!reviewID(row.review?.id))throw Error('Open the existing native saved review.');
    await admitReview(host,detail,row,index,target,{workspace_key,current});return true;
  }
  if(action==='published-review-admitted-open'){
    const n=Number(target.dataset.reviewAdmission),admitted=Number.isSafeInteger(n)&&n>=0?list(row.local_admissions)[n]:null;
    if(!validID(admitted?.id))throw Error('Choose the retained original admission.');
    const value=await host.api('/api/received-published-review/admission?'+new URLSearchParams({workspace:workspace_key,id:admitted.id}));
    if(!current())return true;
    await openAdmission(host,value,detail,row,{workspace_key,current});return true;
  }
  if(action==='published-review-admission-task'){
    const retained=pendingAdmission(workspace_key,detail.id,row);
    if(!validID(retained?.task_id)||typeof host.showTask!=='function')throw Error('Continue the original import to obtain its native task.');
    await host.showTask(retained.task_id);return true;
  }
  if(action==='published-review-open'){
    if(!row.native||!reviewID(row.review?.id)||row.native.review_id!==row.review.id)
      throw Error('Open this external review through its complete original study ZIP.');
    if(typeof host.openExtension!=='function')throw Error('Use the maintained Published studies desk.');
    await host.openExtension('published-studies','openSavedReview',{
      workspace_key,review_id:row.review.id,
      expected_binding:row.original_study,expected_selection:row.selection,
    });
    return true;
  }
  if(action==='published-review-source'){
    if(typeof host.openItem!=='function')throw Error('Open the original collection in Sources.');
    await host.openItem('sources',row.source.source_collection_id);return true;
  }
  if(action==='published-review-report'||action==='published-review-append'){
    if(typeof host.openScientificReport!=='function')throw Error('Use the maintained Scientific Reports composer.');
    await host.openScientificReport({
      workspace_key,sources:[row.source],title:row.review?.content?.title||row.study_title||'',
      selection_mode:action==='published-review-report'?'replace':'append',
    });
    return true;
  }
  throw Error('Choose an original saved review action.');
}
