/** Open retained scientific reports and reviews through the original built-in views. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const validID=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const methods={'scientific-report-editions':'openSavedScientificReport',reviews:'openSavedCustomerReview'};
const labels={'scientific-report-editions':'Open original report',reviews:'Open customer review'};
const tabs=new Set(['files','requirements','corrections','history','handbacks','exports','received']);
export function retainedStudyControl(host,row,{prefix='study',tab=null,label=null,disabled=false}={}){
  const method=methods[row?.kind];
  if(!method||!validID(row.id)||row.state==='unreadable'||typeof host[method]!=='function')return '';
  if(tab!==null&&(row.kind!=='reviews'||!tabs.has(tab)))return '';
  return '<button type="button" data-'+prefix+'-action="open-retained-report-review" '+
    'data-record-kind="'+esc(row.kind)+'" data-record-id="'+esc(row.id)+'"'+
    (tab?' data-record-tab="'+esc(tab)+'"':'')+(disabled?' disabled':'')+'>'+
    esc(label||labels[row.kind])+'</button>';
}
export async function openRetainedStudyRecord(host,value,{workspace_key,current=()=>true}={}){
  const method=methods[value?.kind],id=value?.id;
  if(!method||!validID(id))throw Error('Choose an original saved scientific report or customer review.');
  if(typeof host[method]!=='function')throw Error('Open this record in the maintained scientific operator.');
  const tab=value.tab??'files';
  if(value.kind==='reviews'&&!tabs.has(tab))throw Error('Choose an original review section.');
  const now=()=>host.getWorkspace?.()??host.getState?.()?.workspace_key;
  if(!workspace_key||now()!==workspace_key)throw Error('Open the saved record in its original workspace.');
  if(!current())return null;
  try{
    return await host[method]({workspace_key,id,...(value.kind==='reviews'?{tab}:{})});
  }catch(error){
    // The original destination reports a current error. A departed source view
    // must not replace a newer screen or show the error twice.
    if(!current()||now()!==workspace_key)return null;
    throw error;
  }
}
export function receivedReviewHTML(host,value,disabled=false){
  const rows=list(value.customer_reviews);
  if(!rows.length)return '';
  return '<section class="st-received-reviews" aria-label="Retained customer reviews"><h4>Customer reviews and feedback</h4>'+
    '<p>Open the retained review and its original files. Received feedback and engineering handbacks remain in the same editable history.</p>'+
    rows.map(row=>{
      const record={kind:'reviews',id:row.id,state:row.state};
      let html='<article class="st-export"><div><h4>'+esc(row.title)+'</h4><p>'+esc(row.purpose)+'</p>'+
        '<p>'+esc(String(row.state||'in-review').replaceAll('-',' '))+' · '+esc(row.captured_response_count)+
        ' responses captured with this study · '+esc(row.response_count)+' retained now</p>'+
        '<div class="st-actions">'+retainedStudyControl(host,record,{prefix:'received',disabled})+
        retainedStudyControl(host,record,{prefix:'received',tab:'history',label:'Open response history',disabled})+
        retainedStudyControl(host,record,{prefix:'received',tab:'corrections',label:'Open corrections',disabled})+
        (row.handback_count?retainedStudyControl(host,record,{prefix:'received',tab:'handbacks',label:'Open engineering handbacks',disabled}):'')+'</div>';
      for(const source of list(row.scientific_reports)){
        html+='<p>'+esc(source.title||'Original scientific report')+
          (source.external?' · original project '+esc(source.project_id):
            ' '+retainedStudyControl(host,{kind:'scientific-report-editions',id:source.scientific_report_edition_id},{prefix:'received',disabled}))+'</p>';
      }
      return html+'</div></article>';
    }).join('')+'</section>';
}
export function studyReviewPreview(host,rows){
  if(!list(rows).length)return '';
  return '<section class="st-details"><h4>Retained customer reviews</h4><p>These original reviews and their captured response history are included, whether selected directly or reached through a report.</p><ul>'+
    rows.map(row=>'<li><strong>'+esc(row.title)+'</strong> · '+list(row.response_ids).length+' captured responses '+
      retainedStudyControl(host,{kind:'reviews',id:row.id},{label:'Open included review'})+'</li>').join('')+'</ul></section>';
}
