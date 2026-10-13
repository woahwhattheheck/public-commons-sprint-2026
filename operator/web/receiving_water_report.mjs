/* Saved receiving-water sources in the maintained scientific-report workflow. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const labels={nitrogen_export:'Nitrogen',phosphorus_export:'Phosphorus',sediment_export:'Sediment'};
const button=(action,label,id='')=>'<button type="button" data-action="water-report-'+action+'"'+(id?' data-id="'+esc(id)+'"':'')+'>'+esc(label)+'</button>';
const selectionLabel=row=>row?.selection?.analysis_id?'Saved model analysis':'Saved source plan';

export function attachReceivingWaterReport(context){
  const {getState,api,endpoint,openForm,submitAction,detail,fileList,openDelivery,openScientificReport}=context;
  let generation=0,request=0,page=0,lastWorkspace=null;
  const workspace=()=>getState()?.workspace_key;
  const rows=()=>getState()?.data?.receiving_water_reports?.reports||[];
  const current=(key,version,sequence)=>workspace()===key&&generation===version&&request===sequence;
  const title=row=>row?.title||'Receiving-water scientific source';
  const input=(name,value,extra='')=>'<input name="'+esc(name)+'" value="'+esc(value)+'" '+extra+'>';
  function reportChoices(selected=''){
    const deliveries=getState()?.data?.deliveries||[];
    return '<label><span>Scientific delivery</span><select name="water_report_delivery"><option value="">New ordered report selection</option>'+
      deliveries.filter(row=>validId(row.id)).map(row=>'<option value="'+esc(row.id)+'"'+(row.id===selected?' selected':'')+'>'+esc(row.title||row.id)+'</option>').join('')+
      '</select><small>The prepared source is appended to the selected report; its existing source choices remain ordered.</small></label>';
  }
  function field(name){
    return document.querySelector('#operation-form [name="'+name+'"]')?.value?.trim()||'';
  }
  function render(){
    if(lastWorkspace!==workspace()){lastWorkspace=workspace();page=0;}
    const reports=rows(),pageSize=50,max=Math.max(0,Math.ceil(reports.length/pageSize)-1);
    page=Math.min(page,max);
    const visible=reports.slice(page*pageSize,(page+1)*pageSize);
    let html='<section class="water-section"><header><h2>Scientific report sources</h2><p>Publish an original source plan or a completed analysis through the existing scientific report. Source plans retain receiving areas, designations and contribution methods; analysis sources also retain their saved modeled exports and comparison support.</p></header>';
    if(!reports.length)return html+'<p class="water-empty">Open a saved source plan or completed analysis and choose Prepare scientific report source.</p></section>';
    html+='<div class="water-table-scroll"><table><thead><tr><th scope="col">Retained source</th><th scope="col">Selection</th><th scope="col">Prepared</th><th scope="col">Actions</th></tr></thead><tbody>'+
      visible.map(row=>'<tr><td><strong>'+esc(title(row))+'</strong><small>'+esc(row.id)+'</small></td><td>'+esc(selectionLabel(row))+'</td><td>'+esc(row.created_at?new Date(row.created_at).toLocaleString():'')+'</td><td class="water-row-actions">'+button('open','Inspect source',row.id)+button('use','Use in scientific report',row.id)+'</td></tr>').join('')+'</tbody></table></div>';
    if(reports.length>pageSize)html+='<p>Sources '+(page*pageSize+1)+'–'+Math.min(reports.length,(page+1)*pageSize)+' of '+reports.length+'</p><div class="water-actions">'+(page?button('previous','Previous sources'):'')+(page<max?button('next','Next sources'):'')+'</div>';
    return html+'</section>';
  }
  function detach(){generation++;request++;}
  function actionFor(kind,id){
    if(!['plan','analysis'].includes(kind)||!validId(id))throw Error('Choose an original saved receiving-water plan or analysis.');
    return kind==='analysis'?{analysis_id:id}:{plan_id:id};
  }
  async function create(kind,id){
    const selection=actionFor(kind,id),key=workspace(),version=generation,sequence=++request;
    const record=await api(endpoint('/api/receiving-waters/'+kind,selection));
    if(!current(key,version,sequence))return;
    if(record.id!==id||record.state!=='complete')throw Error('Complete the selected original receiving-water '+kind+' before publishing its scientific source.');
    const summary=kind==='analysis'
      ? 'Saved analysis '+id+' · '+(record.pollutants||[]).map(name=>labels[name]||name).join(', ')+' · '+String(record.quantity_scope||'').replaceAll('_',' ')+'. Its original quantities, overlapping individual areas and unduplicated family totals are retained.'
      : 'Saved source plan '+id+' · '+(record.receptors?.length||0)+' receiving waters. Its original source editions, native feature identifiers, geometry, designation vintage and contribution relationships are retained.';
    const html='<p>'+esc(summary)+'</p><label class="full"><span>Report source title</span>'+input('water_report_title',title(record), 'required maxlength="300"')+'</label>'+reportChoices();
    return openForm('Prepare receiving-water scientific source',
      'Use this exact saved selection in the original report queue.',html,'Prepare source',async()=>{
        if(workspace()!==key)throw Error('Return to the original Workspace before preparing this source.');
        const heading=field('water_report_title'),delivery=field('water_report_delivery');
        if(!heading||heading.length>300)throw Error('Use a report source title of 1–300 characters.');
        if(delivery&&!validId(delivery))throw Error('Choose an original saved scientific delivery.');
        return submitAction('receiving.water.report.prepare',{...selection,title:heading,...(delivery?{delivery_id:delivery}:{})});
      });
  }
  async function read(id,delivery=''){
    if(!validId(id))throw Error('Choose an original receiving-water report source.');
    return api(endpoint('/api/receiving-water-report',{action:'get',id,...(delivery?{delivery_id:delivery}:{})}));
  }
  async function inspect(id){
    const key=workspace(),version=generation,sequence=++request;
    const value=await read(id);
    if(!current(key,version,sequence))return;
    if(value.id!==id||value.workspace_key!==key)throw Error('The retained report source belongs to another selection.');
    const selected=value.selection||{};
    const body='<p>'+esc(selectionLabel(value))+': <code>'+esc(selected.analysis_id||selected.plan_id||'')+'</code></p>'+
      '<p>Source collection: <code>'+esc(value.source?.source_collection_id||'')+'</code><br>Source entry: <code>'+esc(value.source?.source_id||'')+'</code></p>'+
      '<div class="water-actions">'+button('use','Use in scientific report',id)+(typeof openDelivery==='function'?button('mapped','Open mapped report form',id):'')+'</div>'+
      '<details><summary>Original report selection and source summary</summary><pre class="json-view">'+esc(JSON.stringify({selection:selected,summary:value.summary},null,2))+'</pre></details>'+
      '<h3>Retained report and original sources</h3>'+fileList(value._downloads||[]);
    return detail(title(value),body,{kind:'receiving-water-report',id});
  }
  async function mapped(id){
    if(!validId(id))throw Error('Choose an original receiving-water report source.');
    if(typeof openDelivery!=='function')throw Error('Receive the maintained scientific report form.');
    const key=workspace(),record=rows().find(row=>row.id===id);
    return openForm('Use receiving-water scientific source',
      title(record)+' will join the selected ordered report.',reportChoices(),'Open report form',async()=>{
        if(workspace()!==key)throw Error('Return to the original Workspace before opening this report.');
        const delivery=field('water_report_delivery');
        if(delivery&&!validId(delivery))throw Error('Choose an original saved scientific delivery.');
        const version=generation,sequence=++request,value=await read(id,delivery);
        if(!current(key,version,sequence))return;
        if(value.id!==id||value.workspace_key!==key||!value.source||!value.delivery_selection)
          throw Error('The retained source has no original report selection.');
        return openDelivery(clone(value.delivery_selection));
      });
  }
  async function use(id){
    if(typeof openScientificReport!=='function')throw Error('Receive the maintained scientific report composer.');
    const key=workspace(),version=generation,sequence=++request,value=await read(id);
    if(!current(key,version,sequence))return;
    if(value.id!==id||value.workspace_key!==key||!value.source)
      throw Error('The retained source belongs to another selection.');
    return openScientificReport({workspace_key:key,sources:[clone(value.source)],title:value.title});
  }
  function taskActions(task){
    const result=task?._receiving_water_report;
    if(!validId(result?.id))return '';
    return '<div class="water-actions">'+button('open','Inspect receiving-water source',result.id)+button('use','Use in scientific report',result.id)+'</div>';
  }
  async function dispatch(control){
    const action=control.dataset.action,id=control.dataset.id;
    if(action==='water-report-new')return create(control.dataset.kind,id);
    if(action==='water-report-open')return inspect(id);
    if(action==='water-report-use')return use(id);
    if(action==='water-report-mapped')return mapped(id);
    if(action==='water-report-previous'||action==='water-report-next'){
      page=Math.max(0,page+(action==='water-report-next'?1:-1));
      context.refreshReportView?.();return;
    }
    throw Error('Choose a supported receiving-water report operation.');
  }
  return {render,detach,dispatch,taskActions,create,inspect,use,mapped};
}
