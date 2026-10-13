/** Open retained scientific reports and reviews through the original built-in views. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const validID=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const methods={'scientific-report-editions':'openSavedScientificReport',reviews:'openSavedCustomerReview','scientific-report-comparisons':'openDesk'};
const labels={'scientific-report-editions':'Open original report',reviews:'Open customer review','scientific-report-comparisons':'Open report comparison'};
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
    return value.kind==='scientific-report-comparisons'
      ?await (typeof host.openSavedReportComparison==='function'
        ?host.openSavedReportComparison({workspace_key,id})
        :host.openDesk('report-changes','openForStudy',{workspace_key,id}))
      :await host[method]({workspace_key,id,...(value.kind==='reviews'?{tab}:{})});
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
      for(const source of list(row.report_comparisons)){
        html+='<section aria-label="Reviewed report comparison"><p><strong>'+esc(source.title||'Original report comparison')+'</strong> '+
          (source.external?'Original project '+esc(source.project_id):
            retainedStudyControl(host,{kind:'scientific-report-comparisons',id:source.comparison_id},{prefix:'received',disabled}))+'</p>';
        for(const edition of list(source.edition_links)){
          html+='<p>'+(edition.side==='left'?'Earlier report: ':'Later report: ')+esc(edition.title)+' '+
            retainedStudyControl(host,{kind:'scientific-report-editions',id:edition.id},{prefix:'received',disabled})+'</p>';
        }
        html+='</section>';
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

export function reportComparisonHTML(host,row,{prefix='study',disabled=false}={}){
  const local=list(row.edition_links),original=list(row.original_editions);
  const viewer=(url,label)=>typeof url==='string'&&/^\/api\/file\/report-changes\//.test(url)
    ?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>':'';
  const pair=['left','right'].map(side=>{
    const saved=local.find(value=>value.side===side),fingerprint=original.find(value=>value.side===side);
    const id=saved?.id??fingerprint?.edition_id;
    if(!validID(id))return '';
    return '<p><strong>'+(side==='left'?'Earlier':'Later')+': '+esc(saved?.title||id.slice(0,16))+'</strong> '+
      retainedStudyControl(host,{kind:'scientific-report-editions',id},{prefix,disabled})+' '+
      viewer(saved?.viewer_url,'View retained report')+'</p>';
  }).join('');
  const plan=row.plan??{},keys=Object.entries(plan.row_keys??{}),tables=list(row.tables);
  const label=value=>typeof value==='string'?value:JSON.stringify(value);
  const matching=table=>{
    const columns=list(table.key_columns??plan.row_keys?.[table.id]);
    return columns.length?'Match by '+columns.map(index=>label(list(table.left_columns)[index]??index)).join(', '):'Exact rows, including duplicate counts';
  };
  return '<div><h4>'+esc(row.title)+'</h4><p>'+esc(row.change_count)+' recorded changes · '+
    esc(row.page_count)+' complete change pages</p><div class="st-actions">'+
    retainedStudyControl(host,{kind:'scientific-report-comparisons',id:row.id},{prefix,disabled})+' '+
    viewer(row._viewer_url,'View complete comparison')+'</div>'+pair+
    '<details class="st-details"><summary>Original record matching</summary><p>'+
    (plan.include_positions?'Individual position changes are included.':'Individual position changes were not requested; both original row sequences are retained.')+
    '</p>'+(tables.length?'<table class="st-table"><thead><tr><th>Original table</th><th>Matching</th><th>Earlier / later rows</th></tr></thead><tbody>'+
      tables.map(table=>'<tr><td>'+esc(table.heading)+' · '+esc(table.identity?.table_occurrence)+'</td><td>'+esc(matching(table))+'</td><td>'+esc(table.left_rows)+' / '+esc(table.right_rows)+'</td></tr>').join('')+'</tbody></table>':
      '<p>'+keys.length+' tables use selected unique record keys. Other tables use exact-row matching with duplicate counts retained.</p>')+'</details></div>';
}
