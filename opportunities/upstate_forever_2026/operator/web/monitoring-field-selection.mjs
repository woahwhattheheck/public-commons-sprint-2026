/** Retain exported field selections in the original scientific Workspace. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function attachMonitoringFieldSelection(node,host,key) {
  let panel=null,epoch=0,busy=false,loaded=false,catalog={sources:[],selections:[]};
  let sourceKey='',title='',selectionText='',filename='',preview=null,opened=null;
  const current=version=>epoch===version&&panel?.isConnected&&node.isConnected&&host.getState()?.workspace_key===key;
  const sourceValue=row=>JSON.stringify([row.source_collection_id,row.source_id]);
  async function read(operation,payload={}) {
    return host.api('/api/monitoring-field-selection/'+operation,{method:'POST',body:{workspace:key,...payload}});
  }
  function sourceArgs() {
    const row=catalog.sources.find(item=>sourceValue(item)===sourceKey);
    if(!row)throw Error('Choose the retained original field-planning source.');
    return {source_collection_id:row.source_collection_id,source_id:row.source_id};
  }
  function request() {
    if(!selectionText)throw Error('Open the selection JSON saved from the original field-planning desk.');
    return {...sourceArgs(),selection_text:selectionText,title};
  }
  function status(message) {if(panel)panel.querySelector('[data-field-selection-status]').textContent=message;}
  function downloadLinks(record) {
    return (record?._downloads||[]).map(file=>'<a href="'+esc(file.url+'?download=1')+'" download="'+esc(file.filename)+'">'+esc(file.label||file.filename)+'</a>').join(' · ');
  }
  function summary(record) {
    const value=record.summary,choice=record.selection;
    return '<h3>'+esc(record.title)+'</h3><p>$'+esc(value.budget_usd)+' · '+value.selected_search_areas+' original search areas · '+
      value.selected_stations+' source stations selected for review · '+value.visits+' retained calendar slots</p>'+
      '<p>Rounds: '+esc(value.rounds.join(', ')||'none selected')+'. '+esc(value.meaning)+'.</p>'+
      '<div class="table-wrap"><table><thead><tr><th>Search area</th><th>Source station</th><th>Original coordinate basis</th><th>Field note</th></tr></thead><tbody>'+
      value.locations.map(row=>{const s=row.station,p=s.source_properties||{},crs=s.original_coordinate_crs||p.coordinate_crs;
        const xy=s.original_coordinates||[p.coordinate_x,p.coordinate_y];
        return '<tr><td>'+esc(row.huc12)+'</td><td>'+esc(s.id)+'<br>'+esc(row.source_kind)+'</td><td>'+esc(crs)+'<br>'+esc(xy.join(', '))+'</td><td>'+esc(choice.notes[row.huc12]||'')+'</td></tr>';
      }).join('')+(value.locations.length?'':'<tr><td colspan="4">All locations remain catchment search areas.</td></tr>')+
      '</tbody></table></div><details><summary>Notes, exact source and calendar</summary><p>'+
      Object.entries(choice.notes).filter(([,note])=>note).map(([huc,note])=>'<strong>'+esc(huc)+'</strong>: '+esc(note)).join('<br>')+
      '</p><p>Source '+esc(record.source.source_collection_id)+' / '+esc(record.source.source_id)+
      '<br>Plan '+esc(choice.plan_id)+'<br>Selection SHA256 '+esc(record.selection_sha256)+'</p>'+
      '<div class="table-wrap"><table><thead><tr><th>Visit</th><th>Date and local time</th><th>Crew</th><th>Search area</th></tr></thead><tbody>'+
      value.calendar.map(row=>'<tr><td>'+esc(row.visit_key)+'</td><td>'+esc(row.date)+' · '+esc(row.start_local)+'–'+esc(row.finish_local)+
        '</td><td>'+esc(row.crew)+'</td><td>'+esc(row.site_id)+'</td></tr>').join('')+'</tbody></table></div></details>';
  }
  function paint() {
    if(!panel)return;
    panel.innerHTML='<h2>Saved field selections</h2><p>Retain the station choices, field notes and calendar rounds saved from the original field-planning desk. The selected source and working desk travel with a complete Workspace backup.</p>'+
      '<p>These are explicit source-station choices for scientific and access review. Saving them does not assign a station to a campaign or record a collected sample.</p>'+
      '<label>Original field study <select data-field-selection-source><option value="">Choose retained source</option>'+
      catalog.sources.map(row=>'<option value="'+esc(sourceValue(row))+'"'+(sourceValue(row)===sourceKey?' selected':'')+'>'+esc(row.title)+'</option>').join('')+
      '</select></label> <button type="button" data-field-selection-original>Download original working desk</button>'+
      '<p><label>Selection JSON <input data-field-selection-file type="file" accept=".json,application/json"></label> <span>'+esc(filename)+'</span></p>'+
      '<p><label>Saved selection title <input data-field-selection-title maxlength="200" value="'+esc(title)+'"></label></p>'+
      '<p><button type="button" data-field-selection-preview>Review selected source and calendar</button> '+
      '<button type="button" data-field-selection-save'+(!preview?' disabled':'')+'>Retain reviewed selection</button> '+
      '<button type="button" data-field-selection-refresh>Refresh saved selections</button></p>'+
      '<p role="status" data-field-selection-status></p>'+
      '<div data-field-selection-detail>'+(opened?summary(opened)+'<p>'+downloadLinks(opened)+'</p><p>Open the downloaded HTML in a browser to continue editing. Save its new selection JSON and receive that edition here.</p>':preview?summary(preview):'')+'</div>'+
      '<h3>Retained editions</h3><div data-field-selection-library>'+(
      catalog.selections.length?catalog.selections.map(row=>'<p><button type="button" data-field-selection-open="'+esc(row.id)+'">'+esc(row.title)+'</button> · $'+esc(row.selection.budget_usd)+' · '+Object.keys(row.selection.choices).length+' selected stations</p>').join(''):
      '<p>No saved field selection in this Workspace yet.</p>')+'</div>';
    const q=s=>panel.querySelector(s);
    q('[data-field-selection-source]').onchange=event=>{sourceKey=event.target.value;preview=null;opened=null;paint();};
    q('[data-field-selection-title]').oninput=event=>{title=event.target.value;preview=null;q('[data-field-selection-save]').disabled=true;};
    q('[data-field-selection-file]').onchange=event=>run(async version=>{
      const file=event.target.files[0];if(!file)return;
      if(!file.size||file.size>100000)throw Error('Choose the complete exported selection JSON of at most 100,000 bytes.');
      const text=await file.text();if(!current(version))return;
      JSON.parse(text);selectionText=text;filename=file.name;preview=null;opened=null;paint();
      status('Selection loaded. Review its original source and calendar before retaining it.');
    });
    q('[data-field-selection-preview]').onclick=()=>run(async version=>{
      const result=await read('preview',request());if(!current(version))return;
      preview=result;opened=null;paint();status('The original source, native plans and selection agree. Review the choices before retaining.');
    });
    q('[data-field-selection-save]').onclick=()=>run(async version=>{
      if(!preview)throw Error('Review the current source and selection first.');
      const payload=request();
      // Reuse the original Monitoring transport's persisted operation identity,
      // task observation and failed/interrupted task reopening.
      const result=await host.transport(key,'field-selection.receive',payload);
      const record=await read('inspect',{selection_id:result.id});
      if(!current(version))return;
      opened=record;preview=null;catalog=await read('catalog');
      if(!current(version))return;
      loaded=true;paint();status('Saved in the original Workspace. Download the selected working desk or reopen this edition below.');
    });
    q('[data-field-selection-original]').onclick=()=>run(async version=>{
      const result=await read('source',sourceArgs());if(!current(version))return;
      q('[data-field-selection-detail]').innerHTML='<p>'+downloadLinks(result)+'</p><p>Open the original HTML, choose stations and notes, and save its selection JSON. The original source remains unchanged.</p>';
    });
    q('[data-field-selection-refresh]').onclick=()=>run(async version=>{
      const result=await read('catalog');if(!current(version))return;catalog=result;loaded=true;paint();status('Saved source and field-selection catalog refreshed.');
    });
    for(const button of panel.querySelectorAll('[data-field-selection-open]'))button.onclick=()=>run(async version=>{
      const result=await read('inspect',{selection_id:button.dataset.fieldSelectionOpen});if(!current(version))return;
      opened=result;preview=null;paint();status('Reopened the retained exact selection and its source-bound working desk.');
    });
    disable();
  }
  function disable() {
    if(!panel)return;
    for(const control of panel.querySelectorAll('input,select,button'))
      control.disabled=busy||(control.hasAttribute('data-field-selection-save')&&!preview);
  }
  async function run(action) {
    if(busy)return;
    const version=epoch;busy=true;disable();
    try {await action(version);} catch(error) {if(current(version))status(error.message||String(error));}
    finally {busy=false;if(panel?.isConnected&&host.getState()?.workspace_key===key)disable();}
  }
  async function mount() {
    const version=++epoch;
    if(!panel){panel=node.ownerDocument.createElement('section');panel.className='monitoring-field-selections';panel.setAttribute('aria-label','Saved field selections');}
    const container=node.shadowRoot||node;
    if(!container.querySelector('link[data-field-selection-style]')){const style=node.ownerDocument.createElement('link');style.rel='stylesheet';style.href='/web/monitoring-field-selection.css';style.dataset.fieldSelectionStyle='';container.append(style);}
    container.append(panel);paint();
    if(!loaded)await run(async()=>{
      const value=await read('catalog');if(!current(version))return;catalog=value;loaded=true;
      if(!sourceKey&&catalog.sources.length===1)sourceKey=sourceValue(catalog.sources[0]);
      paint();
    });
  }
  function detach(){epoch++;panel?.remove();}
  return {mount,detach};
}
