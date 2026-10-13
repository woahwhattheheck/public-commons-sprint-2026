/** Original-station geography, mounted by the existing authenticated extension host. */
import {attachNativeAssessmentReview} from "./native_assessment_review.mjs";
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = value => Array.isArray(value) ? value : [];
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const short = value => String(value || '').slice(0, 12);
const number = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined,{maximumFractionDigits:6});
const button = (action, label, attrs='') => '<button type="button" data-sg-action="' + action + '" ' + attrs + '>' + esc(label) + '</button>';
const sourceKey = value => value ? String(value.collection_id) + '/' + String(value.source_id) : '';
const sourceRef = row => ({collection_id:row.collection_id,source_id:row.source_id});
const point = feature => feature?.geometry?.type === 'Point' && list(feature.geometry.coordinates).length >= 2 ? feature.geometry.coordinates : null;
const validPoint = coordinates => Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.slice(0,2).every(Number.isFinite);
const statuses = ['all','located','coincident','selected','ambiguous','missing','invalid','outside','boundary','overlap'];
const terminal = state => ['complete','failed','interrupted','cancelled'].includes(state);
const geographyActions = new Set(['station.geography.build','station.geography.receive','station.geography.utility-microbial','station.geography.review-selection']);
const nativeId = value => /^[a-f0-9]{64}$/.test(String(value||''));
const defaultDraft = () => ({title:'Study station geography',sources:[],watersheds:[],observation_ids:[],observation_tables:[],site_tables:[],sites:[],aliases:{},choices:{}});
const uriHTML = uri => /^https?:\/\//i.test(String(uri || '')) ? '<a href="' + esc(uri) + '" target="_blank" rel="noopener noreferrer">' + esc(uri) + '</a>' : esc(uri || '—');

const assessmentCauseLabels = {"BIO":"Biological assessment","CU":"Copper","PB":"Lead","LEAD":"Lead","TURB":"Turbidity","TURBIDITY":"Turbidity","PH":"pH","DO":"Dissolved oxygen","CHLA":"Chlorophyll a","TP":"Total phosphorus","NI":"Nickel","ECOLI":"E. coli","ZN":"Zinc","PCB":"PCBs in fish tissue","PCBS":"PCBs","TN":"Total nitrogen","HGF":"Mercury in fish tissue","HG":"Mercury in water column","NH3":"Ammonia nitrogen","FC":"Fecal coliform","ENTERO":"Enterococci","CR":"Chromium","CD":"Cadmium"};
const causeLabel = code => assessmentCauseLabels[code]||String(code||'');
const inventoryAliases = {cause:['cause_code','cause_raw','cause'],station_description:['description','station_description'],
  impaired_use:['use','impaired_use'],priority_rank:['priority_ranking','priority_rank'],
  source_vintage:['source_vintage','assessment_edition','vintage'],huc12:['publisher_huc12','huc12','source_huc12']};
const inventoryReferences = row => {
  const seen=new Set();
  return list(row?.source_references).filter(ref=>{
    if(!ref?.original||typeof ref.original!=='object')return false;
    const key=canonical([ref.source_sha256||ref.source_id,ref.row_number,ref.original]);
    if(seen.has(key))return false;seen.add(key);return true;
  });
};
const assessmentReferences = row => Array.isArray(row?.assessment_records) ?
  row.assessment_records.map(record=>({...record.inventory_source_ref,original:record.original,assessment_record:record})) :
  inventoryReferences(row);
const inventoryField = (reference,field) => {
  for(const key of inventoryAliases[field]||[field]){
    for(const record of [reference.assessment_record,reference.original]){
      const value=record?.[key];if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();
    }
  }
  return '';
};
const editionReferences = (row,edition='') => assessmentReferences(row).filter(ref=>!edition||inventoryField(ref,'source_vintage')===edition);
const inventoryValues = (row,field,edition='') => [...new Set(editionReferences(row,edition).map(ref=>inventoryField(ref,field)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
const assessmentCauses = (row,edition='') => inventoryValues(row,'cause',edition);
const csvCell = value => '"'+String(value??'').replace(/"/g,'""')+'"';

const assessmentMissing = 'null';
const assessmentValueKey = value => value ? JSON.stringify(value) : assessmentMissing;
const assessmentSourceKey = ref => canonical([inventoryField(ref,'source_id')||ref.source_id||'',inventoryField(ref,'source_sha256')||ref.source_sha256||'']);
const assessmentFields = {cause:'cause',use:'impaired_use',support:'use_support',publication:'publication_status'};
const matchesAssessment = (ref,selection={},omit='') =>
  (omit==='source'||!selection.source||assessmentSourceKey(ref)===selection.source)&&
  (omit==='edition'||!selection.edition||inventoryField(ref,'source_vintage')===selection.edition)&&
  Object.entries(assessmentFields).every(([key,field])=>omit===key||!selection[key]||
    (key==='cause'?inventoryField(ref,field)===selection[key]:assessmentValueKey(inventoryField(ref,field))===selection[key]));
const selectedAssessmentReferences = (row,selection={}) => assessmentReferences(row).filter(ref=>matchesAssessment(ref,selection));
const referenceValues = (references,field) => [...new Set(references.map(ref=>inventoryField(ref,field)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
const assessmentSelectionActive = selection => Object.values(selection).some(Boolean);
const assessmentValueLabel = value => value ? value.replace(/_/g,' ') : 'Not recorded';
const assessmentFacets = (stationRows,selection={}) => {
  const definitions={source:'source_id',edition:'source_vintage',...assessmentFields},result={};
  for(const [facet,field] of Object.entries(definitions)){
    const choices=new Map();
    for(const station of stationRows)for(const ref of assessmentReferences(station)){
      const value=inventoryField(ref,field);
      const key=facet==='source'?assessmentSourceKey(ref):facet==='edition'||facet==='cause'?value:assessmentValueKey(value);
      if(!key)continue;
      let entry=choices.get(key);
      if(!entry){entry={key,value,label:facet==='source'?
        (value||ref.source_id||'Original inventory')+' · '+short(inventoryField(ref,'source_sha256')||ref.source_sha256):
        facet==='cause'?causeLabel(value)+' ('+value+')':facet==='edition'?value:assessmentValueLabel(value),stations:new Set(),records:0};choices.set(key,entry);}
      if(matchesAssessment(ref,selection,facet)){entry.stations.add(String(station.station_id));entry.records++;}
    }
    result[facet]=[...choices.values()].map(({stations,...entry})=>({...entry,station_count:stations.size}))
      .sort((a,b)=>a.label.localeCompare(b.label)||a.key.localeCompare(b.key));
  }
  return result;
};
const filteredAssessmentCSV = (stationRows,editionId,coordinateFor,selection={}) => {
  const columns=['edition_id','station_id','assessment_source_id','publisher_source_sha256','inventory_body_sha256',
    'source_vintage','publication_status','evidence_kind','assessment_record_id','original_record_pointer',
    'original_record_index','inventory_row_number','cause_code','cause_label','use','use_support',
    'publisher_huc12','station_publisher_huc12','station_publisher_huc8','station_publisher_huc_relation',
    'geographic_huc12s','location_status','longitude_wgs84','latitude_wgs84','source_page','source_uri',
    'selected_assessment_filters','original_record','original_source_reference'];
  const records=[];
  for(const row of stationRows){
    const xy=coordinateFor(row)||[];
    for(const ref of selectedAssessmentReferences(row,selection)){
      const value=field=>inventoryField(ref,field),record=ref.assessment_record||{};
      records.push([editionId,row.station_id,value('source_id')||ref.source_id,
        value('source_sha256')||ref.source_sha256,record.inventory_body_sha256||ref.source_sha256,
        value('source_vintage'),value('publication_status'),value('evidence_kind'),
        value('assessment_record_id')||value('id'),value('original_record_pointer')||ref.record_pointer,
        record.original_record_index??ref.record_index??'',record.inventory_row_number??ref.row_number??'',
        value('cause'),value('cause_label')||causeLabel(value('cause')),value('impaired_use'),value('use_support'),
        value('huc12'),value('station_publisher_huc12'),value('station_publisher_huc8'),value('station_publisher_huc_relation'),
        list(row.watersheds).map(item=>item.watershed_id).join('; '),row.status,xy[0]??'',xy[1]??'',
        value('source_page'),value('source_uri'),JSON.stringify(selection),JSON.stringify(ref.original),JSON.stringify(ref)]);
    }
  }
  return [columns,...records].map(record=>record.map(csvCell).join(',')).join('\r\n')+'\r\n';
};

const filteredStationCSV = (stationRows,editionId,coordinateFor,selection={}) => {
  const columns=['edition_id','selected_assessment_edition','station_id','station_description','county',
    'selected_assessment_filters','assessment_editions','assessment_cause_codes','assessment_cause_labels','use_codes','use_support_labels',
    'publisher_huc12s','station_publisher_huc12s','station_publisher_huc8s','station_publisher_huc_relations','original_record_pointers','priority_codes','assessment_source_pages','location_status','longitude_wgs84','latitude_wgs84',
    'watershed_status','mapped_watershed_ids','linked_observation_rows','assessment_records','original_source_references'];
  const records=stationRows.map(row=>{
    const references=selectedAssessmentReferences(row,selection),xy=coordinateFor(row)||[],values=field=>referenceValues(references,field).join('; ');
    return [editionId,selection.edition||'',row.station_id,values('station_description'),values('county'),
      JSON.stringify(selection),values('source_vintage'),values('cause'),
      referenceValues(references,'cause').map(causeLabel).join('; '),values('impaired_use'),values('use_support'),
      values('huc12'),values('station_publisher_huc12'),values('station_publisher_huc8'),values('station_publisher_huc_relation'),values('original_record_pointer'),values('priority_rank'),values('source_page'),row.status,xy[0]??'',xy[1]??'',
      row.watershed_status||row.membership_status||'',list(row.watersheds).map(w=>w.watershed_id).join('; '),
      row.observation_count||0,references.length,JSON.stringify(references)];
  });
  return [columns,...records].map(record=>record.map(csvCell).join(',')).join('\r\n')+'\r\n';
};

const watershedKey = value => canonical({watershed_id:value?.watershed_id,source_ref:value?.source_ref||{}});
const watershedCoverage = (stationRows, watershedFeatures) => {
  const groups=new Map();
  function add(properties) {
    const key=watershedKey(properties);
    if(!groups.has(key))groups.set(key,{key,watershed_id:properties.watershed_id,
      name:properties.name??properties.NAME??properties.GNIS_NAME??'',
      source_ref:properties.source_ref||{},stations:new Map(),boundary:new Set(),overlap:new Set()});
    return groups.get(key);
  }
  for(const feature of list(watershedFeatures))add(feature.properties||{watershed_id:feature.id});
  for(const station of list(stationRows))for(const membership of list(station.watersheds)){
    const group=add(membership),id=String(station.station_id);
    group.stations.set(id,station);
    if(membership.relation==='boundary')group.boundary.add(id);
    if(list(station.watersheds).length>1)group.overlap.add(id);
  }
  return [...groups.values()].map(group=>{
    const stations=[...group.stations.values()],causes=new Map();
    for(const station of stations)for(const cause of assessmentCauses(station))causes.set(cause,(causes.get(cause)||0)+1);
    return {key:group.key,watershed_id:group.watershed_id,name:group.name,source_ref:group.source_ref,
      station_count:stations.length,station_ids:[...group.stations.keys()].sort(),
      boundary_station_count:group.boundary.size,overlap_station_count:group.overlap.size,
      original_inventory_rows:stations.reduce((sum,row)=>sum+inventoryReferences(row).length,0),
      linked_observation_rows:stations.reduce((sum,row)=>sum+Number(row.observation_count||0),0),
      listed_causes:Object.fromEntries([...causes].sort(([a],[b])=>a.localeCompare(b)))};
  }).sort((a,b)=>String(a.watershed_id).localeCompare(String(b.watershed_id))||a.key.localeCompare(b.key));
};
const coverageCSV = (coverage,editionId) => {
  const columns=['edition_id','watershed_id','watershed_name','distinct_station_count','station_ids',
    'listed_causes_distinct_station_counts','original_inventory_rows','linked_observation_rows',
    'boundary_station_count','overlap_station_count','original_watershed_source_reference'];
  return [columns,...coverage.map(row=>[editionId,row.watershed_id,row.name,row.station_count,
    JSON.stringify(row.station_ids),JSON.stringify(row.listed_causes),row.original_inventory_rows,
    row.linked_observation_rows,row.boundary_station_count,row.overlap_station_count,JSON.stringify(row.source_ref)])]
    .map(record=>record.map(csvCell).join(',')).join('\r\n')+'\r\n';
};

export function attachStationGeography(host) {
  let node=null, workspace=null, state=null, catalog=null, edition=null, draft=defaultDraft();
  let requests=[], currentTask=null, selectedEdition=null, selectedStation=null, filter='all', search='', causeFilter='', assessmentEdition='', assessmentSource='', useFilter='', supportFilter='', publicationFilter='', page=0;
  let watershedFilter='', coveragePage=0, coverageSearch='', coverageOpen=false, coverageCache=null;
  let generation=0, controller=null, loading=false, busy=false, error='', message='', taskFingerprint='';
  let sourceFingerprint='', viewBox=null, baseViewBox=null, projectPoint=null, drag=null, advancedOpen=false, formOpen=true;
  let aliasesText='{}', observationTablesText='[]', sourceOptionsText='{}';
  let microbialDomainMode='required', pendingEdition=null, nativeReview=null;
  const cacheKey = key => 'upstate-station-geography-v1:' + key;
  const read = (operation,payload={},key=workspace) => host.api('/api/station-geography/'+operation,{method:'POST',body:{workspace:key,...payload},signal:controller?.signal});
  const rows = () => list(edition?.result?.stations);
  const ownedTasks = () => list(state?.tasks).filter(t=>geographyActions.has(t.action)&&(!t.workspace||t.workspace===workspace));
  function save() {
    if (!workspace) return;
    try {
      sessionStorage.setItem(cacheKey(workspace),JSON.stringify({draft,requests:requests.slice(-32),currentTask,selectedEdition,
        selectedStation,filter,search,causeFilter,assessmentEdition,assessmentSource,useFilter,supportFilter,publicationFilter,watershedFilter,coveragePage,coverageSearch,coverageOpen,page,aliasesText,observationTablesText,sourceOptionsText,advancedOpen,formOpen,microbialDomainMode}));
    } catch (_) { /* Original server tasks and source editions remain retained. */ }
  }
  function restore() {
    draft=defaultDraft(); requests=[]; currentTask=null; selectedEdition=null; selectedStation=null;microbialDomainMode='required';
    filter='all';search='';causeFilter='';assessmentEdition='';assessmentSource='';useFilter='';supportFilter='';publicationFilter='';watershedFilter='';coveragePage=0;coverageSearch='';coverageOpen=false;page=0;aliasesText='{}';observationTablesText='[]';sourceOptionsText='{}';advancedOpen=false;formOpen=true;
    try {
      const value=JSON.parse(sessionStorage.getItem(cacheKey(workspace))||'{}');
      draft={...draft,...(value.draft||{})}; requests=list(value.requests);currentTask=value.currentTask||null;
      selectedEdition=value.selectedEdition||null;selectedStation=value.selectedStation||null;
      microbialDomainMode=['required','auto','none'].includes(value.microbialDomainMode)?value.microbialDomainMode:'required';
      filter=statuses.includes(value.filter)?value.filter:'all';search=value.search||'';causeFilter=typeof value.causeFilter==='string'?value.causeFilter:'';assessmentEdition=typeof value.assessmentEdition==='string'?value.assessmentEdition:'';page=Number(value.page)||0;
      for(const [key,set] of [['assessmentSource',value=>assessmentSource=value],['useFilter',value=>useFilter=value],['supportFilter',value=>supportFilter=value],['publicationFilter',value=>publicationFilter=value]])set(typeof value[key]==='string'?value[key]:'');
      watershedFilter=typeof value.watershedFilter==='string'?value.watershedFilter:'';
      coveragePage=Math.max(0,Number(value.coveragePage)||0);coverageSearch=typeof value.coverageSearch==='string'?value.coverageSearch:'';coverageOpen=!!value.coverageOpen;
      aliasesText=value.aliasesText||JSON.stringify(draft.aliases||{},null,2);
      observationTablesText=value.observationTablesText||JSON.stringify(draft.observation_tables||[],null,2);
      sourceOptionsText=value.sourceOptionsText||'{}';advancedOpen=!!value.advancedOpen;formOpen=value.formOpen!==false;
    } catch (_) {}
  }
  function notice() {
    if (!node) return;
    for (const [key,value] of [['error',error],['message',message]]) {
      const target=node.querySelector('[data-sg-'+key+']'); if(target){target.hidden=!value;target.textContent=value;}
    }
  }
  function fail(problem) {if(problem?.name==='AbortError')return;error=problem?.message||String(problem);notice();}
  function features(key) {return list(edition?.[key]?.features);}
  function stationPoint(row) {
    const feature=features('station_geojson').find(f=>String(f.properties?.station_id??f.id)===String(row.station_id));
    return point(feature);
  }
  function sourceLabel(ref) {
    const source=list(catalog?.sources).find(row=>sourceKey(row)===sourceKey(ref));
    return source?.title||ref?.source_id||'Original source';
  }
  function sourceOptions(picked,kind) {
    const selected=sourceKey(picked);
    return '<option value="">Choose an original source…</option>'+list(catalog?.sources).filter(s=>kind==='table'?s.kind==='table':kind!=='watershed'||s.kind==='vector').map(s=>
      '<option value="'+esc(sourceKey(s))+'"'+(sourceKey(s)===selected?' selected':'')+'>'+esc(s.title||s.source_id)+' · '+esc(s.source_id)+'</option>').join('');
  }
  function formHTML() {
    return '<details data-sg-form-box '+(formOpen?'open':'')+'><summary>Study selection and original inputs</summary><form data-sg-form><fieldset '+(busy?'disabled':'')+'>'+
      '<legend>Locate the selected observation stations</legend><div class="sg-form-grid"><label>Edition title<input data-sg-title value="'+esc(draft.title)+'" required></label>'+
      '<label>Original station layer<select data-sg-source required>'+sourceOptions(draft.sources?.[0],'station')+'</select></label>'+
      '<label>Exact native station identifier field<input data-sg-station-field value="'+esc(draft.sources?.[0]?.station_id_field||'STAT')+'" required></label>'+
      '<label>Native source feature identifier field<input data-sg-feature-field value="'+esc(draft.sources?.[0]?.native_id_field||'OBJECTID')+'"></label>'+
      '<label>Retained watershed geometry<select data-sg-watershed>'+sourceOptions(draft.watersheds?.[0],'watershed')+'</select></label>'+
      '<label>Native watershed identifier field<input data-sg-watershed-field value="'+esc(draft.watersheds?.[0]?.id_field||'HUC12')+'"></label>'+
      '<label>Original study station inventory<select data-sg-site-table>'+sourceOptions(draft.site_tables?.[0],'table')+'</select></label>'+
      '<label>Native study inventory station field<input data-sg-site-table-field value="'+esc(draft.site_tables?.[0]?.station_id_field||'site')+'"></label></div>'+
      '<label class="sg-wide">Exact study station IDs <span class="sg-help">One per line or comma separated. Matching preserves case, punctuation and prefixes.</span>'+
      '<textarea data-sg-sites rows="5" spellcheck="false" placeholder="CL-018&#10;SV-229A">'+esc(list(draft.sites).map(s=>typeof s==='string'?s:s.station_id).join('\n'))+'</textarea></label>'+
      '<fieldset class="sg-observations"><legend>Retained observation editions</legend>'+
      (list(catalog?.observations).length?list(catalog.observations).map(o=>'<label><input type="checkbox" data-sg-observation value="'+esc(o.id)+'"'+(list(draft.observation_ids).includes(o.id)?' checked':'')+'>'+
        esc(o.title||o.metadata?.title||short(o.id))+' <small>'+esc(o.row_count??o.rows??'')+' rows</small></label>').join(''):'<p class="sg-help">Import an observation edition in the observations desk, or select an exact retained table below.</p>')+'</fieldset>'+
      '<details data-sg-advanced '+(advancedOpen?'open':'')+'><summary>Additional sources, exact aliases and retained observation tables</summary><div class="sg-form-grid">'+
      '<label>Exact aliases by study station ID<textarea data-sg-aliases rows="5" spellcheck="false">'+esc(aliasesText)+'</textarea><small>Example: {"SV-054": ["SCDHEC-SV-054"]}. Aliases are explicit source IDs.</small></label>'+
      '<label>Retained observation source tables<textarea data-sg-tables rows="5" spellcheck="false">'+esc(observationTablesText)+'</textarea><small>Each entry needs collection_id, source_id and station_id_field. record_id_field is optional.</small></label>'+
      '<label class="sg-wide">Additional source options<textarea data-sg-options rows="5" spellcheck="false">'+esc(sourceOptionsText)+'</textarea><small>Additional point sources, native CSV x/y fields, source CRS, layer selection and source-specific field overrides. Use {"sources": [...], "watersheds": [...], "site_tables": [...]} to add originals.</small></label></div></details>'+
      '<div class="sg-actions"><button type="submit" class="sg-primary">'+(busy?'Saving operation…':'Build station geography')+'</button>'+
      button('clear-selection','New study selection')+button('go-sources','Open original sources')+'</div><p class="sg-help">Station locations and measured rows remain linked to their original sources. Watershed membership uses the selected retained polygon geometry.</p>'+
      '</fieldset></form></details>';
  }
  function renderMicrobial() {
    const target=node?.querySelector('[data-sg-microbial]');if(!target)return;
    const study=catalog?.utility_microbial;
    if(!study){target.innerHTML='';return;}
    target.innerHTML='<section class="sg-presets"><h2>Original utility E. coli study</h2><article><div><h3>'+esc(study.title)+'</h3>'+
      '<p>Explore 730 original sampled results at 36 stations during 2021–2025: 5 ARJWS stations and 31 Pioneer stations. The retained study preserves original values, censored-result conditions, station identifiers and complete source files.</p>'+
      '<label>Watershed context<select data-sg-microbial-domain '+(busy?'disabled':'')+'>'+
      [['required','Use the complete original 217-watershed domain'],['none','Station points and original utility context'],['auto','Use the original domain when retained']].map(([value,label])=>
        '<option value="'+value+'"'+(microbialDomainMode===value?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>'+
      '<p class="sg-help">The watershed option uses the exact original model-domain polygons retained in this Workspace. Station-only receiving preserves the original utility-source assignment. Sampled concentrations remain linked to their original activities.</p>'+
      (study.available?'':'<p class="sg-help">Import the complete original utility E. coli source edition or install its maintained source directory, then refresh originals.</p>')+
      '</div>'+button('build-microbial','Build original E. coli study',busy||!study.available?'disabled':'')+'</article></section>';
  }
  function renderPresets() {
    renderMicrobial();
    const target=node?.querySelector('[data-sg-presets]');if(!target)return;
    const studies=list(catalog?.prepared_studies);
    target.innerHTML=studies.length?'<section class="sg-presets"><h2>Prepared study selections</h2>'+studies.map(study=>
      '<article><div><h3>'+esc(study.title||study.id)+'</h3><p>'+
      (study.ready?'The exact original station inventory, point sources and retained watershed geometry are selected.':
        'Original sources to import: '+esc(list(study.missing).join('; ')))+'</p></div>'+
      (study.ready?button('build-preset','Build this study','data-sg-preset="'+esc(study.id)+'"'+(busy?' disabled':'')):
        button('go-sources','Open original sources'))+'</article>').join('')+'</section>':'';
  }
  function renderForm() {const target=node?.querySelector('[data-sg-form-area]');if(target)target.innerHTML=formHTML();}
  function editionOptions() {
    const select=node?.querySelector('[data-sg-editions]');if(!select)return;
    const values=list(catalog?.editions);
    select.innerHTML='<option value="">Choose a saved geography edition…</option>'+values.map(e=>'<option value="'+esc(e.id)+'"'+(e.id===selectedEdition?' selected':'')+'>'+
      esc(e.title||short(e.id))+' · '+esc(e.summary?.station_count??e.summary?.stations??'')+' stations</option>').join('');
  }
  function renderTasks() {
    const target=node?.querySelector('[data-sg-tasks]');if(!target)return;
    const tasks=ownedTasks();
    target.innerHTML=tasks.length?'<table><thead><tr><th>Geography operation</th><th>Status</th><th>Result</th><th>Operation</th></tr></thead><tbody>'+tasks.map(task=>{
      const id=task.result?.id;
      return '<tr><td>'+esc(task.payload?.selection?.title||task.payload?.title||(task.action==='station.geography.utility-microbial'?'Original utility E. coli study':task.action.endsWith('receive')?'Reopen original geography package':'Build station geography'))+
        '<small>'+esc(short(task.id))+'</small></td><td>'+esc(task.state)+(task.error?'<small>'+esc(task.error.message)+'</small>':'')+'</td><td>'+
        (id?button('open-edition','Open edition','data-sg-id="'+esc(id)+'"'):'—')+'</td><td>'+button('open-task','Details and files','data-sg-id="'+esc(task.id)+'"')+
        (['failed','interrupted','cancelled'].includes(task.state)?button('resume-task','Resume','data-sg-id="'+esc(task.id)+'"'):'')+'</td></tr>';
    }).join('')+'</tbody></table>':'<p class="sg-help">Geography builds and received packages appear here in the original operator queue.</p>';
  }
  const assessmentSelection = () => ({source:assessmentSource,edition:assessmentEdition,cause:causeFilter,use:useFilter,support:supportFilter,publication:publicationFilter});
  const selectedReferences = row => selectedAssessmentReferences(row,assessmentSelection());
  const selectedValues = (row,field) => referenceValues(selectedReferences(row),field);
  const selectedLabels = (row,field) => [...new Set(selectedReferences(row).map(ref=>inventoryField(ref,field)))].map(assessmentValueLabel).sort((a,b)=>a.localeCompare(b));
  function filteredRows() {
    const query=search.trim().toLocaleLowerCase(),selection=assessmentSelection();
    return rows().filter(row=>{
      const references=selectedAssessmentReferences(row,selection);
      const membership=row.watershed_status||row.membership_status;
      const geographyMatches=!watershedFilter||(watershedFilter==='__outside__'?membership==='outside':
        watershedFilter==='__unresolved__'?membership==='unresolved':list(row.watersheds).some(w=>watershedKey(w)===watershedFilter));
      return geographyMatches&&(filter==='all'||row.status===filter||membership===filter)&&
        (!assessmentSelectionActive(selection)||references.length>0)&&(!query||[row.station_id,row.label,row.name,
        ...list(row.watersheds).map(x=>x.watershed_id),...['station_description','county','cause','cause_label','impaired_use','source_vintage','huc12','use_support','publication_status'].flatMap(field=>referenceValues(references,field))].join(' ').toLocaleLowerCase().includes(query));
    });
  }

  function coverageRows() {
    if(!coverageCache||coverageCache.edition!==edition)coverageCache={edition,rows:watershedCoverage(rows(),features('watershed_geojson'))};
    return coverageCache.rows;
  }
  function renderWatershedFilter() {
    const target=node?.querySelector('[data-sg-watershed-filter]');if(!target)return;
    const coverage=coverageRows();
    if(watershedFilter&&!['__outside__','__unresolved__'].includes(watershedFilter)&&!coverage.some(row=>row.key===watershedFilter))watershedFilter='';
    const outside=rows().filter(row=>row.watershed_status==='outside').length;
    const unresolved=rows().filter(row=>row.watershed_status==='unresolved').length;
    const repeated=new Map();for(const row of coverage)repeated.set(String(row.watershed_id),(repeated.get(String(row.watershed_id))||0)+1);
    const options=[['','All retained watersheds'],['__outside__','Outside retained polygons · '+outside+' stations'],
      ['__unresolved__','Unresolved station location · '+unresolved+' stations'],
      ...coverage.map(row=>[row.key,String(row.watershed_id)+(row.name?' · '+row.name:'')+
        (repeated.get(String(row.watershed_id))>1?' · '+(row.source_ref.source_id||'original source')+' / '+short(row.source_ref.collection_id)+' / '+String(row.source_ref.native_feature_id??row.source_ref.source_feature_index??''):'')+
        ' · '+row.station_count+' stations'])];
    target.innerHTML=options.map(([value,label])=>'<option value="'+esc(value)+'"'+(value===watershedFilter?' selected':'')+'>'+esc(label)+'</option>').join('');
    target.disabled=!edition;
  }
  function coverageMatches() {
    const query=coverageSearch.trim().toLocaleLowerCase();
    return coverageRows().filter(row=>!query||[row.watershed_id,row.name,row.source_ref.source_id,
      ...row.station_ids,...Object.keys(row.listed_causes)].join(' ').toLocaleLowerCase().includes(query));
  }
  function renderCoverage() {
    const target=node?.querySelector('[data-sg-coverage-content]');if(!target)return;
    if(!edition){target.innerHTML='<p>Open a saved geography edition to inspect its watershed coverage.</p>';return;}
    const all=coverageRows(),selected=coverageMatches(),limit=40;
    coveragePage=Math.max(0,Math.min(coveragePage,Math.max(0,Math.ceil(selected.length/limit)-1)));
    const visible=selected.slice(coveragePage*limit,(coveragePage+1)*limit);
    const unique=new Set(rows().filter(row=>list(row.watersheds).length).map(row=>String(row.station_id)));
    target.innerHTML='<p>'+all.length+' retained watershed features · '+all.filter(row=>row.station_count>0).length+' with selected study stations · '+unique.size+
      ' distinct stations with a resolved polygon membership.</p><p class="sg-help">Counts describe this saved study inventory. A zero means no selected study station lies in that retained polygon. Boundary and overlap stations appear in every matching polygon; station counts across watersheds can overlap.</p>'+
      '<div class="sg-table-caption"><span>'+selected.length+' of '+all.length+' watershed features · page '+(coveragePage+1)+' of '+Math.max(1,Math.ceil(selected.length/limit))+'</span><div>'+
      button('export-coverage','Download coverage CSV')+button('coverage-previous','Previous',coveragePage===0?'disabled':'')+
      button('coverage-next','Next',(coveragePage+1)*limit>=selected.length?'disabled':'')+'</div></div>'+
      '<div class="sg-table-scroll"><table><thead><tr><th>Retained watershed</th><th>Distinct stations</th><th>Listed causes / stations</th><th>Inventory / observed rows</th><th>Boundary / overlap stations</th><th>Original source</th></tr></thead><tbody>'+
      visible.map(row=>'<tr'+(watershedFilter===row.key?' class="sg-selected"':'')+'><td>'+
        button('select-watershed',row.watershed_id,'data-sg-watershed-key="'+esc(row.key)+'"')+(row.name?'<small>'+esc(row.name)+'</small>':'')+'</td>'+
        '<td>'+row.station_count+'</td><td>'+esc(Object.entries(row.listed_causes).map(([cause,count])=>causeLabel(cause)+' ('+cause+') · '+count).join(', ')||'—')+'</td>'+
        '<td>'+row.original_inventory_rows+' / '+row.linked_observation_rows+'</td><td>'+row.boundary_station_count+' / '+row.overlap_station_count+'</td>'+
        '<td>'+esc(row.source_ref.source_id||'—')+'<small>Native feature '+esc(row.source_ref.native_feature_id??row.source_ref.source_feature_index??'—')+'</small></td></tr>').join('')+
      (!visible.length?'<tr><td colspan="6">No retained watersheds match this search.</td></tr>':'')+'</tbody></table></div>';
  }
  function applyWatershed(value) {
    watershedFilter=value;page=0;viewBox=null;
    renderWatershedFilter();renderTable();renderMap(true);renderCoverage();save();
  }
  function downloadCSV(body,filename) {
    const url=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=filename;link.hidden=true;
    node.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function downloadCoverage() {
    if(!edition)throw Error('Open a saved station geography edition first.');
    const selected=coverageMatches();
    downloadCSV(coverageCSV(selected,edition.id),'station-geography-'+short(edition.id)+'-watershed-coverage.csv');
    message='Downloaded '+selected.length+' watershed features with distinct station IDs, original cause counts and source references.';notice();
  }

  function renderAssessmentFilters() {
    const bindings=[
      ['source','[data-sg-assessment-source]','All publisher sources',()=>assessmentSource,value=>assessmentSource=value],
      ['edition','[data-sg-assessment-edition]','All assessment editions',()=>assessmentEdition,value=>assessmentEdition=value],
      ['cause','[data-sg-cause]','All assessment causes',()=>causeFilter,value=>causeFilter=value],
      ['use','[data-sg-use]','All designated uses',()=>useFilter,value=>useFilter=value],
      ['support','[data-sg-support]','All support labels',()=>supportFilter,value=>supportFilter=value],
      ['publication','[data-sg-publication]','All publication states',()=>publicationFilter,value=>publicationFilter=value]
    ];
    const available=assessmentFacets(rows(),{});
    for(const [key,,,get,set] of bindings)if(get()&&!available[key].some(item=>item.key===get())){set('');page=0;}
    const facets=assessmentFacets(rows(),assessmentSelection());
    for(const [key,selector,label,get] of bindings){
      const target=node?.querySelector(selector);if(!target)continue;
      target.innerHTML='<option value="">'+esc(label)+'</option>'+facets[key].map(item=>
        '<option value="'+esc(item.key)+'"'+(item.key===get()?' selected':'')+'>'+esc(item.label)+' · '+item.station_count+' stations / '+item.records+' records</option>').join('');
      target.disabled=!facets[key].length;
    }
  }
  function inventoryDetail(row) {
    const allReferences=assessmentReferences(row),references=selectedReferences(row);
    if(!allReferences.length)return '<h4>Original assessment and inventory</h4><p>No inventory rows are attached to this study station.</p>';
    const columns=[['source_vintage','Assessment edition'],['cause','Cause'],['impaired_use','Use'],
      ['use_support','Support'],['publication_status','Publication'],['source_id','Publisher source'],['huc12','Assessment HUC12'],['station_publisher_huc12','Station HUC12'],
      ['station_publisher_huc8','Station HUC8'],['station_publisher_huc_relation','Publisher comparison'],
      ['geographic_huc12s','Mapped HUC12'],['publisher_huc_relation','Spatial comparison'],
      ['priority_rank','Priority'],['source_page','Source page'],['original_record_pointer','Original record pointer']];
    return '<h4>Matching assessment records ('+references.length+' of '+allReferences.length+')</h4>'+
      '<p class="sg-help">Selected cause, use, support and edition must match the same original record. Each edition retains its original cause, use and published watershed. Station publisher assignments remain separate from assessment assignments. Mapped watershed membership follows the original station coordinates and selected polygons. Original JSON pointers retain distinct source records. Assessment TN is Total Nitrogen; reach-classification TN is Trout Natural.</p>'+
      '<p>'+esc(selectedValues(row,'station_description').join(' · '))+'</p>'+
      '<div class="sg-table-scroll"><table class="sg-assessment-table"><thead><tr>'+columns.map(([,label])=>'<th>'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+
      references.map(ref=>'<tr>'+columns.map(([field])=>{const value=inventoryField(ref,field);
        return '<td>'+esc(field==='cause'&&value?(inventoryField(ref,'cause_label')||causeLabel(value))+' ('+value+')':
          ['use_support','station_publisher_huc_relation','publisher_huc_relation'].includes(field)?value.replace(/_/g,' '):value||'—')+'</td>';}).join('')+'</tr>').join('')+'</tbody></table></div>'+
      (!references.length?'<p>No original record at this station matches all selected assessment filters.</p>':'')+
      '<details><summary>All original assessment rows and source references ('+allReferences.length+')</summary><pre>'+esc(JSON.stringify(allReferences,null,2))+'</pre></details>';
  }
  function downloadFilteredStations() {
    if(!edition)throw Error('Open a saved station geography edition first.');
    const selected=filteredRows();
    const body=filteredStationCSV(selected,edition.id,stationPoint,assessmentSelection());
    const url=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;
    link.download='station-geography-'+short(edition.id)+'-filtered.csv';link.hidden=true;
    node.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    message='Downloaded '+selected.length+' station rows and '+selected.reduce((total,row)=>total+selectedReferences(row).length,0)+' matching original assessment records.';notice();
  }
  function downloadFilteredAssessments() {
    if(!edition)throw Error('Open a saved station geography edition first.');
    const selected=filteredRows(),count=selected.reduce((total,row)=>total+selectedReferences(row).length,0);
    downloadCSV(filteredAssessmentCSV(selected,edition.id,stationPoint,assessmentSelection()),
      'station-geography-'+short(edition.id)+'-assessment-records.csv');
    message='Downloaded '+count+' matching original assessment records at '+selected.length+' stations.';notice();
  }
  function renderSummary() {
    const target=node?.querySelector('[data-sg-summary]');if(!target)return;
    if(!edition){target.innerHTML='<p class="sg-empty">Build or reopen a station geography edition to inspect the map, original coordinates and observation links.</p>';return;}
    const all=rows(),resolved=all.filter(r=>validPoint(stationPoint(r))),unresolved=all.filter(r=>!validPoint(stationPoint(r)));
    const observationCount=all.reduce((n,r)=>n+Number(r.observation_count||0),0);
    target.innerHTML='<header class="sg-result-heading"><div><h2>'+esc(edition.title||edition.result?.title||'Station geography')+'</h2>'+
      '<p>Retained edition <code>'+esc(short(edition.id))+'</code> · '+esc(edition.result?.selection?.title||'Exact study selection')+'</p></div>'+
      button('edit-edition','Use this selection')+
      (typeof host.openDesk==='function'&&list(edition.selection?.site_tables||edition.result?.selection?.site_tables).length?
        button('assessment-context','Use saved study in assessment context'):'')+'</header><div class="sg-metrics">'+
      [[all.length,'Study stations'],[resolved.length,'Located'],[unresolved.length,'Locations to resolve'],[all.reduce((n,row)=>n+inventoryReferences(row).length,0),'Original inventory rows'],[observationCount,'Linked observation rows']].map(([value,label])=>
        '<div><strong>'+esc(value.toLocaleString())+'</strong><span>'+esc(label)+'</span></div>').join('')+'</div>';
  }
  function renderDownloads() {
    const target=node?.querySelector('[data-sg-downloads]');if(!target)return;
    const files=list(edition?._downloads);
    const chosen=files.filter(f=>/\.(zip|html|csv|geojson|json)$/i.test(f.filename||'')&&!/sources\.json|metadata/.test(f.filename||''));
    target.innerHTML=chosen.length?'<h3>Complete edition exports</h3><div class="sg-downloads">'+chosen.map(f=>'<a href="'+esc(f.url)+'" download="'+esc(f.filename)+'">'+
      esc(f.filename)+' <small>'+esc(number(f.bytes))+' B</small></a>').join('')+'</div>':'';
  }
  function renderTable() {
    const target=node?.querySelector('[data-sg-table]');if(!target)return;
    const selected=filteredRows(),limit=75;page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(selected.length/limit)-1)));
    const visible=selected.slice(page*limit,(page+1)*limit);
    target.innerHTML='<div class="sg-table-caption"><span>'+esc(selected.length)+' of '+esc(rows().length)+' stations · '+selected.reduce((total,row)=>total+selectedReferences(row).length,0)+' matching assessment records · page '+esc(page+1)+' of '+Math.max(1,Math.ceil(selected.length/limit))+'</span>'+
      '<div>'+(typeof host.openDesk==='function'?button('published-cohort','Open matching observations',!edition||!selected.length?'disabled':''):'')+button('export-filtered','Download station CSV',!edition?'disabled':'')+button('export-assessments','Download assessment records CSV',!edition?'disabled':'')+button('previous','Previous',page===0?'disabled':'')+button('next','Next',(page+1)*limit>=selected.length?'disabled':'')+'</div></div>'+
      '<div class="sg-table-scroll"><table><thead><tr><th>Exact station ID</th><th>Assessment causes / county</th><th>Use / support / publication</th><th>Location</th><th>Longitude / latitude</th><th>Watershed membership</th><th>Observed rows</th></tr></thead><tbody>'+
      visible.map(row=>{const coordinates=stationPoint(row),descriptions=selectedValues(row,'station_description');return '<tr'+(String(row.station_id)===String(selectedStation)?' aria-selected="true" class="sg-selected"':'')+'>'+
        '<td>'+button('station',row.station_id,'data-sg-station="'+esc(row.station_id)+'"')+(row.label?'<small>'+esc(row.label)+'</small>':'')+(descriptions.length?'<small class="sg-station-description">'+esc(descriptions.join(' · '))+'</small>':'')+'</td>'+
        '<td>'+esc(selectedValues(row,'cause').map(code=>causeLabel(code)+' ('+code+')').join('; ')||'—')+'<small>'+esc(selectedValues(row,'county').join(', '))+'</small></td>'+
        '<td>'+esc(selectedLabels(row,'impaired_use').join('; ')||'Not recorded')+'<small>'+esc(selectedLabels(row,'use_support').join('; ')||'Not recorded')+'</small><small>'+esc(selectedLabels(row,'publication_status').join('; ')||'Not recorded')+'</small></td>'+
        '<td><span class="sg-status">'+esc(row.status)+'</span></td><td>'+ (coordinates?esc(number(coordinates[0]))+'<br>'+esc(number(coordinates[1])):'—')+'</td>'+
        '<td>'+esc(row.watershed_status||row.membership_status||'—')+
        (list(row.watersheds).length?'<small>'+esc(list(row.watersheds).map(w=>w.watershed_id).join(', '))+'</small>':'')+'</td>'+
        '<td>'+esc(row.observation_count||0)+'</td></tr>';}).join('')+
      (!visible.length?'<tr><td colspan="7">No stations match this filter.</td></tr>':'')+'</tbody></table></div>';
  }
  function sourceDetails(candidate) {
    const ref=candidate.source_ref||candidate.source||{}, coordinates=candidate.native_coordinates||candidate.coordinates_native;
    const native=ref.native_feature_id??candidate.native_feature_id;
    const crs=candidate.native_crs||candidate.source_crs||ref.source_crs;
    return '<dl class="sg-provenance"><dt>Original source</dt><dd>'+esc(ref.source_id||candidate.source_id||'—')+'</dd>'+
      '<dt>Native feature ID</dt><dd>'+esc(native??'Source feature position '+(candidate.source_feature_index??ref.source_feature_index??''))+'</dd>'+
      '<dt>Native coordinates</dt><dd>'+esc(Array.isArray(coordinates)?coordinates.join(', '):JSON.stringify(coordinates??null))+'</dd>'+
      '<dt>Native coordinate reference</dt><dd>'+esc(typeof crs==='object'?JSON.stringify(crs):crs||'—')+'</dd>'+
      '<dt>Original collection</dt><dd><code>'+esc(ref.collection_id||'—')+'</code></dd>'+
      '<dt>Provider reference</dt><dd>'+uriHTML(candidate.source_uri||ref.uri||candidate.uri)+'</dd></dl>';
  }
  function candidateCoordinates(candidate) {
    const f=features('candidate_geojson').find(f=>String(f.properties?.candidate_id??f.id)===String(candidate.candidate_id??candidate.id));
    return point(f)||candidate.coordinates_wgs84||candidate.wgs84;
  }
  function renderDetail() {
    const target=node?.querySelector('[data-sg-detail]');if(!target)return;
    const row=rows().find(r=>String(r.station_id)===String(selectedStation));
    if(!row){target.innerHTML='<h3>Station detail</h3><p class="sg-help">Choose a station on the map or in the table to inspect every original location and observation link.</p>';return;}
    const candidates=list(row.candidates), observations=list(edition.result?.observation_links).filter(r=>String(r.station_id)===String(row.station_id));
    target.innerHTML='<header class="sg-detail-header"><h3>'+esc(row.station_id)+'</h3>'+button('focus-station','Focus map')+(typeof host.openDesk==='function'?button('published-station','Open station observations'):'')+'</header>'+
      '<p><strong>'+esc(row.status)+'</strong> · '+esc(row.watershed_status||row.membership_status||'No resolved membership')+'</p>'+
      (list(row.issues).length?'<ul>'+row.issues.map(i=>'<li>'+esc(typeof i==='object'?i.message||JSON.stringify(i):i)+'</li>').join('')+'</ul>':'')+
      inventoryDetail(row)+'<h4>Original location candidates ('+candidates.length+')</h4>'+candidates.map((c,index)=>{
        const id=c.candidate_id??c.id, coordinates=candidateCoordinates(c);
        const chosen=row.selected_candidate_id===id||row.location?.candidate_id===id||row.chosen_candidate_id===id;
        return '<section class="sg-candidate"><h5>Source location '+(index+1)+(chosen?' · selected':'')+'</h5>'+
          '<p>'+ (validPoint(coordinates)?esc(number(coordinates[0]))+', '+esc(number(coordinates[1]))+' · EPSG:4326':'Original location needs correction')+'</p>'+
          sourceDetails(c)+(list(c.issues).length?'<p>'+esc(c.issues.map(i=>typeof i==='object'?i.message||JSON.stringify(i):i).join('; '))+'</p>':'')+
          (validPoint(coordinates)?button('choose-candidate','Use this original location','data-sg-station="'+esc(row.station_id)+'" data-sg-candidate="'+esc(id)+'"'+(busy?' disabled':'')):'')+
          '<details><summary>Complete native attributes and source identity</summary><pre>'+esc(JSON.stringify(c,null,2))+'</pre></details></section>';
      }).join('')+(!candidates.length?'<p>No exact native station identifier matched the selected original source. Add an explicit alias or original station source to this study selection.</p>':'')+
      '<h4>Retained watershed matches</h4>'+(list(row.watersheds).length?'<ul>'+row.watersheds.map(w=>'<li>'+esc(w.watershed_id)+' · '+esc(w.relation||w.membership||w.status||'covers point')+'</li>').join('')+'</ul>':'<p>No retained polygon covers the selected location.</p>')+
      '<details><summary>All linked observation rows ('+observations.length+')</summary><pre>'+esc(JSON.stringify(observations,null,2))+'</pre></details>';
  }
  function coordinatePairs(geometry) {
    if(!geometry)return[];
    if(geometry.type==='GeometryCollection')return list(geometry.geometries).flatMap(coordinatePairs);
    const pairs=[];function walk(value){if(validPoint(value))pairs.push(value);else for(const child of list(value))walk(child);}walk(geometry.coordinates);return pairs;
  }
  function renderMap(reset=false) {
    const target=node?.querySelector('[data-sg-map]');if(!target)return;
    const selected=filteredRows(), selectedIDs=new Set(selected.map(r=>String(r.station_id)));
    const stationFeatures=features('station_geojson').filter(f=>selectedIDs.has(String(f.properties?.station_id??f.id))&&point(f));
    const unresolved=new Set(selected.filter(r=>!validPoint(stationPoint(r))).map(r=>String(r.station_id)));
    const candidateFeatures=features('candidate_geojson').filter(f=>selectedIDs.has(String(f.properties?.station_id))&&unresolved.has(String(f.properties?.station_id))&&point(f));
    const polygons=features('watershed_geojson');
    const focused=watershedFilter&&!watershedFilter.startsWith('__')?polygons.filter(f=>watershedKey(f.properties)===watershedFilter):[];
    const extentPolygons=focused.length?focused:polygons;
    const pairs=[...extentPolygons.flatMap(f=>coordinatePairs(f.geometry)),
      ...(focused.length?stationFeatures:features('station_geojson')).map(point),
      ...candidateFeatures.map(point)].filter(validPoint);
    if(!pairs.length){target.innerHTML='<div class="sg-map-empty">No map coordinates are available for this selection. Original unmatched station rows remain in the table.</div>';return;}
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity; for(const p of pairs){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
    const aspect=Math.max(0.05,Math.cos((minY+maxY)/2*Math.PI/180));
    const width=Math.max((maxX-minX)*aspect,0.015),height=Math.max(maxY-minY,0.015),padding=Math.max(width,height)*0.045;
    baseViewBox=[-padding,-padding,width+padding*2,height+padding*2];
    if(reset||!viewBox)viewBox=[...baseViewBox];
    projectPoint=p=>[(p[0]-minX)*aspect,maxY-p[1]];
    const pathFor=geometry=>{
      if(!geometry)return '';
      if(geometry.type==='GeometryCollection')return list(geometry.geometries).map(pathFor).join(' ');
      const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
      return polygons.map(poly=>poly.map(ring=>ring.map((p,i)=>{const q=projectPoint(p);return(i?'L':'M')+q[0]+' '+q[1];}).join(' ')+'Z').join(' ')).join(' ');
    };
    const diameter=Math.max(viewBox[2],viewBox[3])/170;
    const mark=(f,candidate)=>{
      const station=String(f.properties?.station_id??f.id),xy=projectPoint(point(f)),active=station===String(selectedStation);
      return '<g role="button" tabindex="0" aria-label="'+esc(station+(candidate?' source candidate':' station'))+'" data-sg-map-station="'+esc(station)+'" class="sg-map-station'+(candidate?' sg-map-candidate':'')+(active?' sg-map-selected':'')+'">'+
        '<circle cx="'+xy[0]+'" cy="'+xy[1]+'" r="'+diameter*(active?1.4:1)+'" vector-effect="non-scaling-stroke"/>'+
        '<title>'+esc(station+(candidate?' · unresolved original location':' · '+(f.properties?.status||'located')))+'</title></g>';
    };
    target.innerHTML='<svg class="sg-map-svg" data-sg-svg viewBox="'+viewBox.join(' ')+'" role="img" aria-label="Selected original stations and retained watershed boundaries" tabindex="0">'+
      '<g class="sg-watersheds">'+polygons.map(f=>'<path class="'+(focused.length?(watershedKey(f.properties)===watershedFilter?'sg-watershed-focus':'sg-watershed-context'):'')+'" d="'+pathFor(f.geometry)+'" fill-rule="evenodd" vector-effect="non-scaling-stroke"><title>'+esc(f.properties?.watershed_id??f.id??'Retained watershed')+'</title></path>').join('')+'</g>'+
      '<g>'+candidateFeatures.map(f=>mark(f,true)).join('')+stationFeatures.map(f=>mark(f,false)).join('')+'</g></svg>'+
      '<p class="sg-map-note">● Resolved station · ○ Original candidate · Retained watershed boundaries · WGS84 display</p>';
  }
  function renderResult(reset=false) {renderAssessmentFilters();renderWatershedFilter();renderCoverage();renderSummary();renderDownloads();renderTable();renderDetail();renderMap(reset);save();}
  async function loadCatalog(refreshForm=false) {
    if(!node||loading)return;loading=true;
    const key=workspace,version=generation;
    try{
      const result=await read('catalog');
      if(key!==workspace||version!==generation||!node)return;
      catalog=result;
      nativeReview?.update(catalog);
      if(!draft.sources.length){
        const original=list(catalog.sources).find(s=>s.role==='MONITORING_STATIONS');
        if(original)draft.sources=[{...sourceRef(original),station_id_field:original.station_id_field||'STAT',native_id_field:original.native_id_field||'OBJECTID'}];
      }
      editionOptions();renderPresets();if(refreshForm)renderForm();renderTasks();save();
      if(pendingEdition)await openPendingEdition();
      else if(selectedEdition&&!edition)await openEdition(selectedEdition,false);
    }catch(problem){if(key===workspace&&version===generation)fail(problem);}
    finally{loading=false;}
  }
  async function openEdition(id,selectDraft=false) {
    const key=workspace,version=generation;
    error='';message='Opening the complete retained station edition…';notice();
    try{
      const result=await read('edition',{id});
      if(key!==workspace||version!==generation||!node)return;
      edition=result;selectedEdition=id;viewBox=null;
      if(!rows().some(r=>String(r.station_id)===String(selectedStation)))selectedStation=rows()[0]?.station_id||null;
      if(selectDraft)useEdition();
      message='Original stations, source references and complete exports opened.';editionOptions();renderResult(true);notice();
      return true;
    }catch(problem){if(key===workspace&&version===generation)fail(problem);}
    return false;
  }
  function useSelection(selection) {
    draft=clone(selection||defaultDraft());
    aliasesText=JSON.stringify(draft.aliases||{},null,2);observationTablesText=JSON.stringify(draft.observation_tables||[],null,2);
    sourceOptionsText=JSON.stringify({sources:list(draft.sources).slice(1),watersheds:list(draft.watersheds).slice(1),site_tables:list(draft.site_tables).slice(1)},null,2);
    formOpen=true;renderForm();save();
  }
  function useEdition() {if(edition)useSelection(edition.selection||edition.result?.selection);}
  function collectSelection(form) {
    if(!form.reportValidity())return null;
    const aliases=JSON.parse(aliasesText||'{}'),tables=JSON.parse(observationTablesText||'[]'),options=JSON.parse(sourceOptionsText||'{}');
    if(!aliases||Array.isArray(aliases)||typeof aliases!=='object')throw Error('Enter exact aliases as a JSON object.');
    if(!Array.isArray(tables))throw Error('Enter retained observation tables as a JSON array.');
    if(!options||Array.isArray(options)||typeof options!=='object')throw Error('Enter additional source options as a JSON object.');
    for(const key of Object.keys(options))if(!['sources','watersheds','site_tables'].includes(key))throw Error('Additional source options may contain sources, watersheds and site_tables.');
    const selection={...clone(draft),aliases,observation_tables:tables,
      sources:[...list(draft.sources).slice(0,1),...list(options.sources)],
      watersheds:[...list(draft.watersheds).slice(0,1),...list(options.watersheds)],
      site_tables:[...list(draft.site_tables).slice(0,1),...list(options.site_tables)]};
    if(!selection.sources.length)throw Error('Choose an original station source.');
    if(!selection.sites.length&&!selection.observation_ids.length&&!selection.observation_tables.length&&!selection.site_tables.length)
      throw Error('Choose an original study inventory, enter exact study station IDs, or select retained observations.');
    if(selection.watersheds.some(w=>!String(w.id_field||'').trim()))throw Error('Enter the exact native watershed identifier field.');
    return selection;
  }
  async function submit(action,payload) {
    if(busy)return;
    const key=workspace,version=generation,requestKey=canonical({workspace:key,action,payload,
      ...(action==='station.geography.utility-microbial'?{source_context:list(catalog?.sources).map(source=>
        [source.collection_id,source.source_id,source.source_sha256||source.sha256||null]).sort((a,b)=>canonical(a).localeCompare(canonical(b)))}:{})});
    const active=()=>key===workspace&&version===generation&&!!node&&
      key===(host.getWorkspace()||host.getState()?.workspace_key);
    let request=requests.find(r=>r.key===requestKey);
    if(!request){request={id:'station-geography-'+crypto.randomUUID(),key:requestKey};requests.push(request);}
    busy=true;nativeReview?.setBusy(true);error='';message='Saving the selected original inputs in the operator queue…';save();renderForm();renderPresets();notice();
    try {
      const task=await host.api('/api/actions',{method:'POST',body:{workspace:key,action,payload,operation_id:request.id}});
      if(!active())return;
      currentTask=task.id;save();message='Geography operation '+task.state+'. The saved operation can resume after this desk closes.';
      await host.refresh({force:true});
      if(!active())return;
      state=host.getState();renderTasks();notice();
      if(task.state==='complete'&&task.result?.id)await openEdition(task.result.id);
    }catch(problem){if(active())fail(new Error(problem.message+' Submit the same selection again to reuse its saved operation.'));}
    finally{if(active()){busy=false;nativeReview?.setBusy(false);renderForm();renderPresets();renderDetail();notice();}}
  }
  function editInput(event) {
    const target=event.target;
    if(target.matches('[data-sg-microbial-domain]'))microbialDomainMode=target.value;
    else if(target.matches('[data-sg-title]'))draft.title=target.value;
    else if(target.matches('[data-sg-source]')){
      const row=list(catalog?.sources).find(s=>sourceKey(s)===target.value);
      draft.sources=row?[{...sourceRef(row),station_id_field:row.station_id_field||node.querySelector('[data-sg-station-field]').value||'STAT',
        native_id_field:row.native_id_field||node.querySelector('[data-sg-feature-field]').value||'OBJECTID'}]:[];
    }
    else if(target.matches('[data-sg-station-field]')){if(draft.sources[0])draft.sources[0].station_id_field=target.value;}
    else if(target.matches('[data-sg-feature-field]')){if(draft.sources[0])draft.sources[0].native_id_field=target.value;}
    else if(target.matches('[data-sg-watershed]')){
      const row=list(catalog?.sources).find(s=>sourceKey(s)===target.value);
      draft.watersheds=row?[{...sourceRef(row),id_field:row.id_field||node.querySelector('[data-sg-watershed-field]').value||'HUC12'}]:[];
    }
    else if(target.matches('[data-sg-watershed-field]')){if(draft.watersheds[0])draft.watersheds[0].id_field=target.value;}
    else if(target.matches('[data-sg-site-table]')){
      const row=list(catalog?.sources).find(s=>sourceKey(s)===target.value);
      draft.site_tables=row?[{...sourceRef(row),station_id_field:row.station_id_field||node.querySelector('[data-sg-site-table-field]').value||'site'}]:[];
    }
    else if(target.matches('[data-sg-site-table-field]')){if(draft.site_tables[0])draft.site_tables[0].station_id_field=target.value;}
    else if(target.matches('[data-sg-sites]')){
      const original=new Map(list(draft.sites).map(s=>[typeof s==='string'?s:s.station_id,s]));
      draft.sites=[...new Set(target.value.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean))].map(s=>original.get(s)||{station_id:s});
    }
    else if(target.matches('[data-sg-observation]')){
      draft.observation_ids=[...node.querySelectorAll('[data-sg-observation]:checked')].map(n=>n.value);
    }
    else if(target.matches('[data-sg-aliases]'))aliasesText=target.value;
    else if(target.matches('[data-sg-tables]'))observationTablesText=target.value;
    else if(target.matches('[data-sg-options]'))sourceOptionsText=target.value;
    else if(target.matches('[data-sg-search]')){search=target.value;page=0;renderTable();renderMap();}
    else if(target.matches('[data-sg-filter]')){filter=target.value;page=0;renderTable();renderMap();}
    else if(target.matches('[data-sg-cause],[data-sg-assessment-edition],[data-sg-assessment-source],[data-sg-use],[data-sg-support],[data-sg-publication]')){
      if(target.matches('[data-sg-cause]'))causeFilter=target.value;
      else if(target.matches('[data-sg-assessment-edition]'))assessmentEdition=target.value;
      else if(target.matches('[data-sg-assessment-source]'))assessmentSource=target.value;
      else if(target.matches('[data-sg-use]'))useFilter=target.value;
      else if(target.matches('[data-sg-support]'))supportFilter=target.value;
      else publicationFilter=target.value;
      page=0;renderAssessmentFilters();renderTable();renderDetail();renderMap();
    }
    else if(target.matches('[data-sg-watershed-filter]'))applyWatershed(target.value);
    else if(target.matches('[data-sg-coverage-search]')){coverageSearch=target.value;coveragePage=0;renderCoverage();}
    save();
  }


  async function openAssessmentContext() {
    if(!edition||typeof host.openDesk!=='function')throw Error('Open a saved station geography study first.');
    const current=host.getWorkspace()||host.getState()?.workspace_key;
    if(current!==workspace)throw Error('Open the saved study in its original Workspace.');
    if(!list(edition.selection?.site_tables||edition.result?.selection?.site_tables).length)
      throw Error('This study needs a retained assessment inventory.');
    save();
    await host.openDesk('assessment-context','openForGeography',{workspace_key:workspace,geography_id:edition.id});
  }

  async function openObservationStudies(single = false) {
    if (!edition || typeof host.openDesk !== 'function')
      throw Error('Open a saved station geography edition in the current application.');
    const chosen = single ? rows().filter(row => String(row.station_id) === String(selectedStation)) : filteredRows();
    const ids = [...new Set(chosen.map(row => String(row.station_id)))].sort();
    if (!ids.length) throw Error('Choose at least one original station.');
    const key = workspace, id = edition.id;
    if (key !== host.getWorkspace()) throw Error('Open the original Workspace before selecting its stations.');
    const view = {scope:single?'Selected station':'All stations matching the current view',
      search:single?'':search, location_status:single?'':filter, watershed:single?'':watershedFilter,
      assessment_source:single?'':assessmentSource, assessment_edition:single?'':assessmentEdition,
      cause:single?'':causeFilter, use:single?'':useFilter, support:single?'':supportFilter,
      publication:single?'':publicationFilter};
    save();
    await host.openDesk('published-studies', 'openForStations', {
      workspace_key:key, geography_id:id, site_ids:ids, view
    });
  }
  function chooseStation(id) {selectedStation=id;renderTable();renderDetail();renderMap();save();}
  function moveView(dx=0,dy=0,scale=1) {
    if(!viewBox)return;
    const [x,y,w,h]=viewBox;
    viewBox=[x+w*(1-scale)/2+dx*w,y+h*(1-scale)/2+dy*h,w*scale,h*scale];
    renderMap();
  }
  async function action(event) {
    const mapTarget=event.target.closest('[data-sg-map-station]');
    if(mapTarget){chooseStation(mapTarget.dataset.sgMapStation);return;}
    const item=event.target.closest('[data-sg-action]');if(!item)return;
    const act=item.dataset.sgAction;
    try {
      if(act==='refresh'){catalog=null;await loadCatalog(true);message='Original source and station editions refreshed.';notice();}
      else if(act==='open-edition')await openEdition(item.dataset.sgId);
      else if(act==='open-task')await host.showTask(item.dataset.sgId);
      else if(act==='resume-task'){
        await host.api('/api/task/resume',{method:'POST',body:{id:item.dataset.sgId}});
        await host.refresh({force:true});
      }
      else if(act==='go-sources')host.navigate('sources');
      else if(act==='assessment-context')await openAssessmentContext();
      else if(act==='published-cohort')await openObservationStudies();
      else if(act==='published-station')await openObservationStudies(true);
      else if(act==='build-microbial'){
        if(!catalog?.utility_microbial?.available)throw Error('Import the complete original utility E. coli source and refresh this desk.');
        await submit('station.geography.utility-microbial',{domain_mode:microbialDomainMode});
      }
      else if(act==='build-preset'){
        const study=list(catalog?.prepared_studies).find(s=>s.id===item.dataset.sgPreset);
        if(!study?.ready||!study.selection)throw Error('Import the listed original study sources and refresh this desk.');
        useSelection(study.selection);await submit('station.geography.build',{selection:clone(study.selection)});
      }
      else if(act==='clear-selection'){draft=defaultDraft();aliasesText='{}';observationTablesText='[]';sourceOptionsText='{}';formOpen=true;renderForm();save();}
      else if(act==='edit-edition')useEdition();
      else if(act==='export-filtered')downloadFilteredStations();
      else if(act==='export-assessments')downloadFilteredAssessments();
      else if(act==='export-coverage')downloadCoverage();
      else if(act==='select-watershed')applyWatershed(item.dataset.sgWatershedKey);
      else if(act==='coverage-previous'){coveragePage=Math.max(0,coveragePage-1);renderCoverage();save();}
      else if(act==='coverage-next'){coveragePage++;renderCoverage();save();}
      else if(act==='station')chooseStation(item.dataset.sgStation);
      else if(act==='previous'){page=Math.max(0,page-1);renderTable();save();}
      else if(act==='next'){page++;renderTable();save();}
      else if(act==='zoom-in')moveView(0,0,0.7);
      else if(act==='zoom-out')moveView(0,0,1/0.7);
      else if(act==='fit-map'){viewBox=null;renderMap(true);}
      else if(act==='focus-station'){
        const row=rows().find(r=>String(r.station_id)===String(selectedStation)),coordinates=row&&stationPoint(row);
        if(validPoint(coordinates)&&projectPoint&&baseViewBox){const xy=projectPoint(coordinates),width=baseViewBox[2]/5,height=baseViewBox[3]/5;viewBox=[xy[0]-width/2,xy[1]-height/2,width,height];renderMap();}
      }
      else if(act==='choose-candidate'){
        const selected=clone(edition.selection||edition.result.selection);
        selected.choices={...(selected.choices||{}),[item.dataset.sgStation]:item.dataset.sgCandidate};
        selected.title=(edition.title||'Station geography')+' · location revision';
        await submit('station.geography.build',{selection:selected});
      }
    }catch(problem){fail(problem);}
  }
  async function openPendingEdition() {
    const target=pendingEdition;
    if(!target||!node||!catalog||target.workspace!==workspace)return;
    if(await openEdition(target.id) && pendingEdition===target)pendingEdition=null;
  }
  async function requestEdition(id,key=host.getWorkspace()||host.getState()?.workspace_key) {
    if(!nativeId(id)||!key)throw Error('Choose a retained station geography edition.');
    if(key!==(host.getWorkspace()||host.getState()?.workspace_key))
      throw Error('Open the original task Workspace before opening this station edition.');
    pendingEdition={workspace:key,id};
    host.navigate('station-geography');
    if(node&&workspace===key&&catalog)await openPendingEdition();
  }
  function taskActions(task) {
    const key=host.getWorkspace()||host.getState()?.workspace_key,id=task?.result?.id;
    if(task?.state!=='complete'||!geographyActions.has(task.action)||!task.workspace||
      task.workspace!==key||!nativeId(id))return '';
    return '<button type="button" data-action="station-geography-result-open" data-workspace="'+esc(task.workspace)+'" data-id="'+esc(id)+'">Open station geography</button>';
  }
  async function dispatch(button) {
    if(button?.dataset?.action!=='station-geography-result-open')return false;
    const key=button.dataset.workspace;
    if(!key||key!==(host.getWorkspace()||host.getState()?.workspace_key))
      throw Error('Open the original task Workspace before opening this station edition.');
    host.closeDetail();
    await requestEdition(button.dataset.id,key);
    return true;
  }
  function mount(container,initial=host.getState()) {
    detach();node=container;state=initial;workspace=host.getWorkspace()||state?.workspace_key;
    if(pendingEdition&&pendingEdition.workspace!==workspace)pendingEdition=null;
    generation++;controller=new AbortController();restore();catalog=null;edition=null;viewBox=null;loading=false;busy=false;error='';message='';
    node.innerHTML='<section class="sg-desk"><header class="sg-heading"><div><h1>Station geography</h1><p>Original station locations, observation links and retained watershed membership.</p></div>'+button('refresh','Refresh originals')+'</header>'+
      '<p class="sg-error" data-sg-error role="alert" hidden></p><p class="sg-message" data-sg-message role="status" hidden></p>'+
      '<div data-sg-microbial></div><div data-sg-native-review></div><div data-sg-presets></div><div data-sg-form-area></div><section class="sg-reopen"><label>Saved station geography<select data-sg-editions></select></label>'+
      '<label class="sg-upload">Reopen original geography package<input type="file" data-sg-receive accept=".zip,application/zip"></label></section>'+
      '<section data-sg-summary></section><section class="sg-results"><div class="sg-filters"><label>Find station<input type="search" data-sg-search value="'+esc(search)+'" placeholder="Station, watershed, description, county or cause"></label>'+
      '<label>Location status<select data-sg-filter>'+statuses.map(s=>'<option value="'+s+'"'+(s===filter?' selected':'')+'>'+esc(s==='all'?'All stations':s)+'</option>').join('')+'</select></label>'+
      '<label>Publisher source<select data-sg-assessment-source><option value="">All publisher sources</option></select></label>'+
      '<label>Assessment edition<select data-sg-assessment-edition><option value="">All assessment editions</option></select></label>'+
      '<label data-sg-cause-label>Assessment cause<select data-sg-cause><option value="">All assessment causes</option></select></label>'+
      '<label>Designated use<select data-sg-use><option value="">All designated uses</option></select></label>'+
      '<label>Use support<select data-sg-support><option value="">All support labels</option></select></label>'+
      '<label>Publication state<select data-sg-publication><option value="">All publication states</option></select></label>'+
      '<label class="sg-watershed-picker">Geometry-derived watershed<select data-sg-watershed-filter></select></label>'+
      '<div class="sg-map-controls">'+button('zoom-in','Zoom in')+button('zoom-out','Zoom out')+button('fit-map','Fit study')+'</div></div>'+
      '<p class="sg-help">Assessment filters match one original record together. Combined source use labels remain literal; Not recorded selects an empty source field. Each option counts matching original records and distinct stations with the other assessment filters applied. The station map, matching detail and both filtered downloads use this selection. Watershed coverage and complete edition downloads retain the whole saved study.</p>'+
      '<div class="sg-map-layout"><div data-sg-map></div><aside data-sg-detail></aside></div><div data-sg-table></div></section>'+
      '<details class="sg-coverage" data-sg-coverage '+(coverageOpen?'open':'')+'><summary>Watershed station coverage</summary><label>Find watershed, station or cause<input type="search" data-sg-coverage-search value="'+esc(coverageSearch)+'" placeholder="Watershed ID, native name, station or cause"></label><div data-sg-coverage-content></div></details>'+
      '<section data-sg-downloads></section><section class="sg-operations"><h2>Retained operations</h2><div class="sg-table-scroll" data-sg-tasks></div></section></section>';
    nativeReview=attachNativeAssessmentReview({container:node.querySelector('[data-sg-native-review]'),host,
      getWorkspace:()=>workspace,submit,onError:fail});
    const signal=controller.signal;
    node.addEventListener('input',editInput,{signal});
    node.addEventListener('change',async event=>{
      editInput(event);
      if(event.target.matches('[data-sg-editions]')&&event.target.value)await openEdition(event.target.value);
      if(event.target.matches('[data-sg-receive]')&&event.target.files[0]){
        const key=workspace,file=event.target.files[0];error='';message='Retaining the original geography package…';notice();
        try{const upload=await host.api('/api/upload',{method:'POST',raw:file,filename:file.name});if(key===workspace)await submit('station.geography.receive',{upload_id:upload.id});}
        catch(problem){if(key===workspace)fail(problem);}
      }
    },{signal});
    node.addEventListener('click',action,{signal});
    node.addEventListener('submit',event=>{if(!event.target.matches('[data-sg-form]'))return;event.preventDefault();try{const selection=collectSelection(event.target);if(selection)submit('station.geography.build',{selection});}catch(problem){fail(problem);}},{signal});
    node.addEventListener('toggle',event=>{if(event.target.matches('[data-sg-form-box]'))formOpen=event.target.open;else if(event.target.matches('[data-sg-advanced]'))advancedOpen=event.target.open;else if(event.target.matches('[data-sg-coverage]'))coverageOpen=event.target.open;save();},{signal,capture:true});
    node.addEventListener('keydown',event=>{
      const target=event.target.closest('[data-sg-map-station]');
      if(target&&['Enter',' '].includes(event.key)){event.preventDefault();chooseStation(target.dataset.sgMapStation);return;}
      if(!event.target.matches('[data-sg-svg]'))return;
      const moves={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,-.15],ArrowDown:[0,.15]};
      if(moves[event.key]){event.preventDefault();moveView(...moves[event.key]);node.querySelector('[data-sg-svg]')?.focus();}
      else if(['+','=','-'].includes(event.key)){event.preventDefault();moveView(0,0,event.key==='-'?1/0.7:0.7);node.querySelector('[data-sg-svg]')?.focus();}
    },{signal});
    node.addEventListener('pointerdown',event=>{
      const svg=event.target.closest('[data-sg-svg]');
      if(!svg||event.target.closest('[data-sg-map-station]')||!viewBox)return;
      const rect=svg.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,view:[...viewBox],width:rect.width,height:rect.height};
      svg.setPointerCapture(event.pointerId);
    },{signal});
    node.addEventListener('pointermove',event=>{
      if(!drag)return;
      viewBox=[drag.view[0]-(event.clientX-drag.x)/drag.width*drag.view[2],drag.view[1]-(event.clientY-drag.y)/drag.height*drag.view[3],drag.view[2],drag.view[3]];
      node.querySelector('[data-sg-svg]')?.setAttribute('viewBox',viewBox.join(' '));
    },{signal});
    node.addEventListener('pointerup',()=>{if(drag){drag=null;renderMap();}},{signal});
    node.addEventListener('pointercancel',()=>{drag=null;},{signal});
    renderForm();renderTasks();renderResult();loadCatalog(true);
  }
  function update(next=host.getState()) {
    state=next;if(!node)return;
    const key=next?.workspace_key||host.getWorkspace();if(key!==workspace){mount(node,next);return;}
    const fingerprint=canonical(ownedTasks().map(t=>[t.id,t.state,t.result?.id,t.error]));
    if(fingerprint!==taskFingerprint){
      taskFingerprint=fingerprint;renderTasks();
      const completed=ownedTasks().find(t=>t.id===currentTask&&t.state==='complete'&&t.result?.id);
      if(completed&&completed.result.id!==selectedEdition){openEdition(completed.result.id);loadCatalog(false);}
      const task=ownedTasks().find(t=>t.id===currentTask);
      if(task&&terminal(task.state)&&task.state!=='complete'&&task.error)fail(task.error);
    }
    const sources=canonical(list(next?.data?.sources).map(s=>s.id));
    if(sources!==sourceFingerprint){sourceFingerprint=sources;loadCatalog(false);}
  }
  function detach() {
    nativeReview?.detach();nativeReview=null;
    save();controller?.abort();controller=null;generation++;node=null;drag=null;loading=false;busy=false;
  }
  return {mount,update,detach,taskActions,dispatch,open:requestEdition};
}
