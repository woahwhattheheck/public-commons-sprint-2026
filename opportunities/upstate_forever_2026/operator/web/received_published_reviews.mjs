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
