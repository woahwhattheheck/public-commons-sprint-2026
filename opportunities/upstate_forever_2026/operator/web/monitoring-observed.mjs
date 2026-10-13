/* Original Monitoring desk: retained observation context and exact-date support. */
export function attachObservedContext(host) {
  const panel=document.createElement('section');
  panel.className='observed-context-panel';
  panel.innerHTML='<h3>Observed support for this network</h3><p class="small">Match original station records and historical flow to the selected network and unchanged saved calendar.</p><div class="row"><label>Original observational source<select data-source><option value="">Select a retained source edition</option></select></label><label>Saved context<select data-saved><option value="">Open saved observational context</option></select></label></div><details><summary>Explicit source station mapping</summary><p class="small">Exact station IDs match automatically. For a different native identifier, map each full original station ID to its exact saved network station ID. Activity IDs remain separate.</p><textarea data-mapping aria-label="Original station to native station mapping">{}</textarea><div data-source-stations></div></details><label>Context title<input data-title value="Observed support for the monitoring network"></label><div class="row"><button data-preview>Preview original support</button><button data-save>Save this context</button><button data-context-export>Download complete context</button></div><p data-status class="small" role="status"></p><div data-downloads class="downloads"></div><div data-result></div>';
  host.shadowRoot.querySelector('.output').append(panel);
  const q=s=>panel.querySelector(s);
  let sources=[],saved=[],current=null,sequence=0,lastKey=null;
  const stateKey=()=>JSON.stringify([host.network?.id||null,host.plan?.id||null,host.campaign?.revision?.id||null]);
  const escapeJson=value=>JSON.stringify(value,null,2);
  function mapping(){
    const value=JSON.parse(q('[data-mapping]').value||'{}');
    if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Station mapping must be an object.');
    return value;
  }
  function selection(){
    if(!host.network)throw Error('Select the original saved network first.');
    const source=sources.find(r=>r.source_collection_id+'::'+r.source_id===q('[data-source]').value);
    if(!source)throw Error('Choose an imported original observational source.');
    const campaign=host.campaign&&host.plan&&host.campaign.plan.id===host.plan.id?host.campaign:null;
    return {source_collection_id:source.source_collection_id,source_id:source.source_id,
      network_id:host.network.id,...(campaign?{campaign_id:campaign.revision.campaign_id}:host.plan?{plan_id:host.plan.id}:{}),
      station_mapping:mapping(),title:q('[data-title]').value.trim()||'Observed monitoring support'};
  }
  function options(node,records,value,label,placeholder){
    const old=node.value;node.replaceChildren(new Option(placeholder,''));
    for(const row of records)node.add(new Option(label(row),value(row)));
    if([...node.options].some(o=>o.value===old))node.value=old;
  }
  function sourceDetails(){
    const row=sources.find(r=>r.source_collection_id+'::'+r.source_id===q('[data-source]').value);
    q('[data-source-stations]').replaceChildren(row?host.table(['Original station ID','Name'],row.stations.map(s=>[s.station_id,s.station_name])):document.createTextNode('Import the existing monitoring-context source manifest to make its original station cohort selectable.'));
  }
  function addTable(title,rows,fields,details=false){
    const wrapper=document.createElement(details?'details':'section'),heading=document.createElement(details?'summary':'h4');
    heading.textContent=title;wrapper.append(heading);
    const box=document.createElement('div');box.className='table-wrap';
    box.append(host.table(fields.map(f=>f[0]),rows.map(r=>fields.map(f=>{
      const v=typeof f[1]==='function'?f[1](r):r[f[1]];
      return Array.isArray(v)?v.join('; '):v===null||v===undefined?'—':typeof v==='number'?Number.isInteger(v)?v:v.toPrecision(7):typeof v==='boolean'?(v?'Yes':'No'):v;
    }))));wrapper.append(box);q('[data-result]').append(wrapper);
  }
  function render(){
    const key=stateKey();if(key!==lastKey){lastKey=key;sequence++;current=null;q('[data-result]').replaceChildren();q('[data-downloads]').replaceChildren();}
    const selectedNetwork=host.network?.id;
    options(q('[data-saved]'),saved.filter(r=>!selectedNetwork||r.network_id===selectedNetwork),r=>r.id,r=>r.title+' · '+(r.plan_id?'saved calendar':'network context'),'Open saved observational context');
    q('[data-preview]').disabled=!selectedNetwork;
    q('[data-save]').disabled=!selectedNetwork;
    q('[data-context-export]').disabled=!current?.id;
    if(!current)return;
    q('[data-result]').replaceChildren();
    const heading=document.createElement('h4');heading.textContent=current.title;q('[data-result]').append(heading);
    const notes=document.createElement('ul');for(const note of current.interpretation||[]){const li=document.createElement('li');li.textContent=note;notes.append(li);}q('[data-result]').append(notes);
    addTable('Original source and saved calendar coverage',Object.entries(current.summary).map(([key,value])=>({key:key.replaceAll('_',' '),value})),[['Measure','key'],['Value','value']]);
    addTable('Original station matches',current.station_matches,[['Source station','source_station_id'],['Native station','network_station_id'],['Match','match'],['Catchment','catchment_id'],['Selected area','selected_search_area'],['Position difference (m)','coordinate_difference_m'],['Position review','coordinate_review'],['Activities','activities'],['Dates','sampling_dates'],['Gauge relation','gauge_network_relation']]);
    addTable('Stream-network source relations',current.topology,[['Station A','station_a'],['Station B','station_b'],['A relative to B','relation'],['Source basis','relation_basis'],['Original path','path']],true);
    addTable('Exact saved calendar dates',current.calendar,[['Visit','visit_key'],['Date','date'],['Bound source station','source_station_id'],['Binding','station_basis'],['Original flow availability','original_flow_status'],['Daily mean (cfs)','mean_cfs'],['Source qualifier','flow_qualifiers'],['At annual P95','at_or_above_annual_p95'],['Same-station source activities','source_activity_ids_same_date']],true);
    addTable('Original high-flow episodes',current.high_flow_episodes,[['Episode','event_id'],['Start','start_date'],['End','end_date'],['Peak daily cfs','peak_cfs'],['Original sample dates','sampled_dates'],['Matched station activities','matching_network_station_activities'],['Saved calendar overlaps','saved_calendar_visit_keys']],true);
    addTable('Same-date concentration contrasts in network order',current.paired_contrasts,[['Date','date'],['Analyte','analyte'],['Upstream','upstream_station_id'],['Downstream','downstream_station_id'],['Unit','contrast_unit'],['Original interval direction','downstream_direction'],['Downstream minus upstream lower','downstream_minus_upstream_lower'],['Upper','downstream_minus_upstream_upper'],['Lower open','downstream_difference_lower_open'],['Upper open','downstream_difference_upper_open'],['Sample gap (minutes)','clock_separation_minutes'],['Both in network','both_stations_in_saved_network']],true);
    addTable('Original full-cohort annual support',current.annual_coverage,[['Year','period'],['Sample dates','sampled_dates'],['Gauge days','daily_records'],['High-flow days','extreme_flow_days'],['Sampled high-flow dates','extreme_sampled_dates'],['High-flow volume share (%)','extreme_flow_volume_percent']],true);
    const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
    summary.textContent='Complete immutable context and source identity';pre.textContent=escapeJson(current);details.append(summary,pre);q('[data-result]').append(details);
  }
  async function refresh(){
    const ticket=++sequence,key=stateKey();
    const [catalog,records]=await Promise.all([host.api('context.catalog'),host.api('context.list')]);
    if(ticket!==sequence||key!==stateKey())return;
    sources=catalog.sources;saved=records.records;
    options(q('[data-source]'),sources,r=>r.source_collection_id+'::'+r.source_id,r=>r.title+' · '+r.activities+' original activities','Select a retained source edition');
    sourceDetails();render();
  }
  async function calculate(save){
    const chosen=selection(),ticket=++sequence,key=stateKey();
    const result=await host.api(save?'context.prepare':'context.preview',chosen);
    if(ticket!==sequence||key!==stateKey())return;
    current=result;q('[data-status]').textContent=save?'Saved with its exact source, network and calendar identities.':'Preview of current source and saved selection.';
    if(save){saved=saved.filter(r=>r.id!==result.id).concat(result);}
    render();if(result.id)q('[data-saved]').value=result.id;
  }
  for(const selector of ['[data-mapping]','[data-title]'])q(selector).oninput=()=>{sequence++;current=null;q('[data-result]').replaceChildren();render();};
  q('[data-source]').onchange=()=>{sequence++;current=null;q('[data-result]').replaceChildren();sourceDetails();render();};
  q('[data-preview]').onclick=()=>host.run(()=>calculate(false),'Reading the retained original station and daily-flow support…');
  q('[data-save]').onclick=()=>host.run(()=>calculate(true),'Saving original observational support…');
  q('[data-saved]').onchange=()=>host.run(async()=>{
    const identity=q('[data-saved]').value;if(!identity)return;
    const ticket=++sequence,key=stateKey(),result=await host.api('context.get',{context_id:identity});
    if(ticket!==sequence||key!==stateKey())return;
    current=result;q('[data-status]').textContent='Opened the exact retained context. Its network and plan IDs remain visible in complete details.';
    q('[data-title]').value=result.title;q('[data-mapping]').value=escapeJson(result.station_mapping);
    q('[data-source]').value=result.source_binding.source_collection_id+'::'+result.source_binding.source_id;sourceDetails();render();q('[data-saved]').value=identity;
  });
  q('[data-context-export]').onclick=()=>host.run(async()=>{
    if(!current?.id)throw Error('Save or open an original context first.');
    const identity=current.id,key=stateKey(),ticket=++sequence;
    const result=await host.api('context.export',{context_id:identity});
    if(ticket!==sequence||key!==stateKey()||current?.id!==identity)return;
    const url=new URL(result.download_url,document.baseURI);if(url.origin!==location.origin)throw Error('Unexpected file-ticket origin');
    const a=document.createElement('a');a.href=url.href;a.download='';a.textContent='Complete original context package · '+result.bytes.toLocaleString()+' bytes';q('[data-downloads]').append(a);
  });
  const originalRender=host.render.bind(host);host.render=function(){originalRender();render();};
  const originalRefresh=host.refreshSources.bind(host);host.refreshSources=async function(){await originalRefresh();await refresh();};
  host.observedContextIdForPlan=function(planId){return current?.id&&current.plan_id===planId?current.id:null;};
}
