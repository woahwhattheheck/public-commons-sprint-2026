const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const short=value=>String(value??'').slice(0,12);
const button=(action,title,id='',primary=false)=>'<button type="button" '+(primary?'class="primary" ':'')+'data-action="calibration-review-'+action+'" data-id="'+esc(id)+'">'+esc(title)+'</button>';
const table=(heads,rows)=>'<div class="table-wrap"><table><thead><tr>'+heads.map(text=>'<th>'+esc(text)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const section=(title,note,body)=>'<section class="panel"><div class="section-heading"><h2>'+esc(title)+'</h2><p>'+esc(note)+'</p></div>'+body+'</section>';
const option=(id,text,selected)=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(text)+'</option>';

/** Whole original calibration review, within the maintained desk and task queue. */
export function createCalibrationReviews({current,read,submitAction,openForm,detail,fileList,getReport,getData,repaint,activate,openReport,openDelivery,openScientificReport,openItem}){
  let packet=null,request=0,formRevision=0,sourceFingerprint='';
  const active=()=>!!packet&&packet.workspace_key===current();
  function reset(){packet=null;request++;formRevision++;sourceFingerprint='';}
  function invalidate(){request++;formRevision++;}
  function sync(){
    if(packet&&packet.workspace_key!==current()){reset();return true;}
    if(active()){
      const signature=JSON.stringify(reportSources());
      if(signature!==sourceFingerprint){sourceFingerprint=signature;return true;}
    }
    return false;
  }
  function reportSources(){
    if(!active())return [];
    const selected=new Map();
    for(const row of [...(packet.report_sources??[]),...(getData().calibration_report_sources??[])]){
      if(row.review_id===packet.review.id)selected.set(row.id,row);
    }
    return [...selected.values()];
  }
  async function makeSource(id){
    if(!active()||packet.review.id!==id)throw Error('Open the exact retained review before preparing its report source.');
    return submitAction('calibration.review.source',{review_id:id});
  }
  async function scientificReport(id){
    const workspace=current(),revision=++request;
    const result=await read('report-source',{id});
    if(current()!==workspace||revision!==request)return;
    const record=result.report_source,selection=result.scientific_report_selection;
    if(result.workspace_key!==workspace||record?.id!==id)throw Error('The report source belongs to a different selection.');
    if(selection?.workspace_key!==workspace||!Array.isArray(selection.sources)||selection.sources.length!==1||
       selection.sources[0]?.source_collection_id!==record.source_collection_id||
       selection.sources[0]?.source_id!==record.source_id){
      throw Error('Receive the original scientific report selection for this retained calibration review.');
    }
    if(typeof openScientificReport!=='function')throw Error('Receive the current Sources desk and its scientific report composer.');
    return openScientificReport({workspace_key:workspace,
      sources:[{source_collection_id:record.source_collection_id,source_id:record.source_id}],
      title:selection.title});
  }
  async function delivery(id){
    const workspace=current(),revision=++request;
    const result=await read('report-source',{id});
    if(current()!==workspace||revision!==request)return;
    if(result.workspace_key!==workspace||result.report_source.id!==id)throw Error('The report source belongs to a different selection.');
    if(!result.delivery_selection)throw Error(result.delivery_issue||'Complete both native model families on the original selected baseline before map delivery. The registered report source remains available in the source catalogue.');
    if(typeof openDelivery!=='function')throw Error('Receive the current original delivery form with this calibration desk.');
    return openDelivery(result.delivery_selection);
  }
  function sourceSection(){
    const sources=reportSources();
    return section('Create a saved scientific report',
      'Prepare the original review as a scientific source, then open the existing ordered report composer. Nutrient-only, sediment-only and combined analyses keep their exact supported pollutants, tables, equal-axis figures and complete source companions. The composer preserves your other selected sources, report title and contact.',
      '<div class="section-body"><div class="page-actions">'+button('source','Prepare report source',packet.review.id,!sources.length)+'</div></div>'+
      (sources.length?table(['Registered source','Figures','Companions',''],sources.map(row=>
        '<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(short(row.source_collection_id))+' · '+esc(row.source_id)+'</small><small>'+esc(row.edition||'Retained original edition')+'</small></td>'+
        '<td>'+esc(row.figure_count)+'</td><td>'+esc(row.companion_count)+'</td><td>'+
        button('source-report','Open scientific report',row.id,true)+
        button('source-delivery','Open mapped report form',row.id)+
        button('source-edition','Open source edition',row.source_collection_id)+'</td></tr>')):
        '<p class="calibration-empty">The report source preserves this saved review and its exact native selection. Preparing it uses the current task queue.</p>'));
  }
  function rows(reportId){
    const report=getReport();
    const values=getData().calibration_reviews??report?.reviews??[];
    return values.filter(row=>row.calibration_id===reportId);
  }
  function summary(reportId){
    const saved=rows(reportId);
    return section('Complete calibration reviews',
      'Keep the original nominal analysis, chosen source-error edition and original catchment maps in one readable offline package.',
      '<div class="section-body"><div class="page-actions">'+button('prepare','Prepare review package',reportId,true)+'</div></div>'+
      (saved.length?table(['Review','Source errors','Catchment maps','Files',''],saved.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(short(row.id))+'</small></td>'+
        '<td>'+esc(row.uncertainty_id?short(row.uncertainty_id):'Nominal analysis')+'</td><td>'+esc(row.map_id?short(row.map_id):'Original source files')+'</td>'+
        '<td>'+esc(row.file_count)+'</td><td>'+button('open','Open review',row.id)+'</td></tr>')):
        '<p class="calibration-empty">Prepare a review after choosing the completed calibration and any saved supplements.</p>'));
  }
  function prepare(reportId){
    const original=getReport();
    if(!original||original.report.id!==reportId||original.workspace_key!==current()||original.report.state!=='complete'){
      throw Error('Open the original completed calibration before preparing its review.');
    }
    const workspace=current(),revision=++formRevision;
    const errors=(getData().calibration_uncertainties??original.uncertainties??[]).filter(row=>row.calibration_id===reportId);
    const maps=(getData().calibration_maps??original.maps??[]).filter(row=>row.calibration_id===reportId);
    const html='<div class="calibration-form"><div class="form-grid">'+
      '<label class="full"><span>Review title</span><input name="calibration_review_title" required maxlength="300" value="'+esc(original.report.title+' — calibration review')+'"></label>'+
      '<label><span>Published source-error edition</span><select name="calibration_review_uncertainty">'+option('','Nominal analysis without a sensitivity supplement','')+
        errors.map(row=>option(row.id,String(row.standard_errors)+' standard errors · '+String(row.selection_sensitivity?.state||row.state).replaceAll('_',' ')+' · '+short(row.id),'')).join('')+'</select></label>'+
      '<label><span>Original catchment map edition</span><select name="calibration_review_maps">'+option('','Original catchment files without a rendered atlas','')+
        maps.map(row=>option(row.id,String(row.layer_count??0)+' layers · '+short(row.id),'')).join('')+'</select></label>'+
      '<label class="full"><span>Notes for this review</span><textarea name="calibration_review_notes" rows="5" maxlength="20000" placeholder="Purpose, questions and interpretation for the selected original results"></textarea></label>'+
      '<div class="full calibration-source"><p>Map editions that contain error bands use their exact retained source-error edition. Choosing one sets that edition below; an incompatible selection is rejected before packaging.</p>'+
      '<p>The package keeps the nominal winner, source methods and periods, held-out selected-model results, complete scientific tables, and every selected map file. It opens offline and can be printed. Creating it does not rerun a model.</p></div></div></div>';
    const value=name=>document.querySelector('#operation-form [name="'+name+'"]')?.value??'';
    openForm('Prepare complete calibration review','Choose the exact saved supplements and review notes.',html,'Build review package',()=>{
      if(current()!==workspace||revision!==formRevision)throw Error('The workspace or review form changed. Open this review selection again.');
      const map=maps.find(row=>row.id===value('calibration_review_maps'));
      const errorId=value('calibration_review_uncertainty');
      if(map?.uncertainty_id&&map.uncertainty_id!==errorId)throw Error('Choose the exact source-error edition retained by this map.');
      const title=value('calibration_review_title').trim();
      if(!title)throw Error('Enter a review title.');
      return submitAction('calibration.review.prepare',{
        report_id:reportId,title,notes:value('calibration_review_notes'),
        uncertainty_id:errorId||null,map_id:map?.id||null
      });
    });
    const selector=document.querySelector('#operation-form [name="calibration_review_maps"]');
    selector?.addEventListener('change',()=>{
      if(current()!==workspace||revision!==formRevision)return;
      const map=maps.find(row=>row.id===selector.value);
      const target=document.querySelector('#operation-form [name="calibration_review_uncertainty"]');
      if(map?.uncertainty_id&&target)target.value=map.uncertainty_id;
    });
  }
  async function open(id){
    const workspace=current(),revision=++request;
    const result=await read('review',{id});
    if(current()!==workspace||revision!==request)return;
    if(result.workspace_key!==workspace||result.review.id!==id)throw Error('The returned review belongs to a different selection.');
    packet=result;sourceFingerprint=JSON.stringify(reportSources());activate();repaint();
  }
  function render(){
    if(!active())return '';
    const review=packet.review,selection=review.selection;
    return '<header class="page-header"><div><p class="eyebrow">CALIBRATION · COMPLETE REVIEW</p><h1>'+esc(review.title)+'</h1>'+
      '<p>Original calibration results and explicitly chosen supplements, retained as one portable review package.</p></div><div class="page-actions">'+
      button('nominal','Open nominal results',review.calibration_id)+button('preview','Read report',review.id,true)+button('open','Refresh original files',review.id)+'</div></header>'+
      '<div class="cards">'+[['Native selection',short(review.selected_run_id)],['Source errors',review.uncertainty_id?short(review.uncertainty_id):'Nominal analysis'],
        ['Catchment maps',review.map_id?short(review.map_id):'Original catchment files'],['Retained members',review.file_count]].map(([title,value])=>
        '<div class="card"><h3>'+esc(title)+'</h3><strong class="calibration-card-value">'+esc(value)+'</strong></div>').join('')+'</div>'+
      section('Readable report and complete package','Open the report in the current app, or download the ZIP and open index.html offline. The complete source files and relative links travel together.',
        '<div class="section-body"><div class="page-actions">'+button('preview','Read report',review.id,true)+'</div></div>'+fileList(packet._downloads??[]))+
      sourceSection()+
      section('Review notes and original selections','Notes belong to this retained review edition and do not change the scientific calibration.',
        '<div class="section-body"><p class="calibration-review-notes">'+esc(selection.notes||'No additional review notes.')+'</p><dl>'+
        [['Calibration',review.calibration_id],['Plan',review.plan_id],['Selected profile',review.selected_profile_id],['Source-error edition',review.uncertainty_id],['Map edition',review.map_id]].map(([key,value])=>
          '<dt>'+esc(key)+'</dt><dd class="mono">'+esc(value||'Not selected')+'</dd>').join('')+'</dl></div>')+
      section('Complete retained inventory','All artifacts remain checked against the original manifest when reopened or transferred.',
        table(['File','Bytes','SHA-256'],Object.entries(review.files).map(([name,item])=>'<tr><td>'+esc(name)+'</td><td>'+esc(item.bytes)+'</td><td class="mono">'+esc(item.sha256)+'</td></tr>')));
  }
  function preview(){
    if(!active())throw Error('Open the retained review first.');
    const src=packet.viewer_url;
    if(!src?.startsWith('/api/file/calibration-review/'))throw Error('Choose the retained authenticated review viewer.');
    detail(packet.review.title,'<iframe class="calibration-review-frame" title="'+esc(packet.review.title)+
      '" sandbox="allow-downloads allow-same-origin" referrerpolicy="no-referrer" src="'+esc(src)+'"></iframe>'+fileList(packet._downloads??[]),
      {kind:'calibration-review',id:packet.review.id});
  }
  async function dispatch(node){
    const action=node.dataset.action?.replace(/^calibration-review-/,'');
    if(action==='source')return makeSource(node.dataset.id);
    if(action==='source-report')return scientificReport(node.dataset.id);
    if(action==='source-delivery')return delivery(node.dataset.id);
    if(action==='source-edition'){
      if(!active()||!reportSources().some(row=>row.source_collection_id===node.dataset.id))throw Error('Open the original registered report source first.');
      return openItem('sources',node.dataset.id);
    }
    if(action==='prepare')return prepare(node.dataset.id);
    if(action==='open')return open(node.dataset.id);
    if(action==='preview')return preview();
    if(action==='nominal'){const id=packet?.review.calibration_id??node.dataset.id;reset();return openReport(id);}
  }
  return {active,reset,invalidate,sync,summary,prepare,open,render,dispatch};
}
