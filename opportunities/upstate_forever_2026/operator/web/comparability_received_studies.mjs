/** Reopen the original saved cohort captured with a selected Scientific Report. */
const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validID=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const button=(action,label,index,disabled)=>'<button type="button" data-received-action="cohort-'+action+'" data-cohort-source="'+index+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';

export function receivedComparabilityHTML(detail,disabled=false){
  const rows=list(detail?.comparable_period_sources);
  if(!rows.length)return '';
  return '<section class="st-received-comparisons" aria-label="Original comparable observation periods"><h4>Comparable observation periods</h4>'+
    rows.map((row,index)=>{
      const native=row.native_comparison,selection=native?.selection;
      let html='<article class="st-received-source"><h4>'+esc(native?.title||row.source_id)+'</h4>';
      if(native){
        html+='<p>'+esc(selection.year_b)+' versus '+esc(selection.year_a)+
          '. The original analytical series, censoring intervals, activity weights and shared-month support remain in the saved comparison.</p>'+
          '<div class="st-actions">'+button('open','Open saved comparison',index,disabled)+
          button('report','Open this report only',index,disabled)+
          button('append','Add to current report',index,disabled)+'</div>'+
          '<p>Open the comparison to inspect its complete original rows and download the full source ZIP, offline desk and CSV files.</p>';
      }else{
        html+='<p>This source originated in project '+esc(row.source_project_id)+
          '. Its original report and complete source companions remain in this Study.</p>'+
          '<div class="st-actions">'+button('report','Open this report only',index,disabled)+
          button('append','Add to current report',index,disabled)+'</div>';
      }
      return html+'<details class="st-details"><summary>Original source identity</summary><dl>'+
        '<dt>Source collection</dt><dd><code>'+esc(row.source_collection_id)+'</code></dd>'+
        '<dt>Source</dt><dd>'+esc(row.source_id)+'</dd>'+
        '<dt>Original project</dt><dd>'+esc(row.source_project_id)+'</dd>'+
        '<dt>Recipe SHA256</dt><dd><code>'+esc(row.source_body_sha256)+'</code></dd>'+
        '</dl></details></article>';
    }).join('')+'</section>';
}

export async function openReceivedComparability(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;
  if(!action?.startsWith('cohort-'))return false;
  const index=Number(target.dataset.cohortSource);
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.comparable_period_sources)[index]:null;
  if(!row||detail.workspace_key!==workspace_key||!current())
    throw Error('Reopen this saved Study in its original receiving Workspace.');
  if(!validID(row.source_collection_id)||typeof row.source_id!=='string'||!row.source_id)
    throw Error('Choose this Study’s retained original comparison source.');
  if(action==='cohort-open'){
    if(!row.native_comparison||!validID(row.native_comparison.id))
      throw Error('This source retains another original project; open its captured scientific report.');
    if(typeof host.openExtension!=='function')throw Error('Use the maintained comparable-period desk.');
    await host.openExtension('observation-comparability','openSaved',row.native_comparison.id);
    return true;
  }
  if(action==='cohort-report'||action==='cohort-append'){
    if(typeof host.openScientificReport!=='function')throw Error('Use the maintained Scientific Reports composer.');
    await host.openScientificReport({
      workspace_key,sources:[{source_collection_id:row.source_collection_id,source_id:row.source_id}],
      title:row.native_comparison?.title||'',
      selection_mode:action==='cohort-report'?'replace':'append',
    });
    return true;
  }
  throw Error('Choose a retained original comparison action.');
}
