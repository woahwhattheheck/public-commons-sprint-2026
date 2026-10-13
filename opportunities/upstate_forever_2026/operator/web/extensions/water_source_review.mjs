import {prepareWaterSourceBrief, renderWaterSourceBrief} from './water_source_brief.mjs';
/** Full legal reach and native source context in the original operator. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const plain = value => value === null || value === undefined ? '' :
  typeof value === 'object' ? JSON.stringify(value) : String(value);
const number = value => typeof value === 'number' && Number.isFinite(value) ?
  value.toLocaleString(undefined,{maximumFractionDigits:3}) : '—';
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase();
const relationNames = {
  coextensive:'Explicit coextensive geometry',partial:'Partial geometry association',
  candidate:'Candidate for reach review','outside-scope':'Outside positive geographic scope',
  unassociated:'No source association recorded','crosswalk-unselected':'Choose a geographic crosswalk'
};
const sourceKey = row => JSON.stringify([row.collection_id,row.source_id]);
const recordKey = row => JSON.stringify([row.edition?.id,row.id]);
const jurisdiction = row => row.jurisdiction || (row.edition?.classification_system ? row.edition.jurisdiction : 'SC');
const classificationSystem = row => row.classification_system || row.edition?.classification_system || 'SC-R61-69';
const classComponents = row => row.class_components || (row.class_code ? [row.class_code] : []);
const classificationDetails = row => [
  ['Jurisdiction',jurisdiction(row)],['Classification system',classificationSystem(row)],
  ['Original components',classComponents(row).join(', ')],['Primary class',row.primary_class],
  ['Supplemental classes',(row.supplemental_classes||[]).join(', ')],
  ['Original special markers',(row.special_markers||[]).join(', ')],
  ['Original source index',row.original_index],['Reach effective date',row.effective_date],
  ['Native effective-date value',row.native_effective_date],['Classification role',row.classification_role]
].filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>'<dt>'+escape(k)+'</dt><dd>'+escape(plain(v))+'</dd>').join('');
const declaredBoolean = value => value===true?'Yes':value===false?'No':'Not declared in this source';
const safeHref = value => typeof value === 'string' &&
  (/^https?:\/\//i.test(value) || (value.startsWith('/') && !value.startsWith('//'))) ? value : '';
const link = (url,label) => safeHref(url) ?
  '<a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+escape(label)+'</a>' :
  escape(label);
const canonicalFilter = () => ({query:'',jurisdiction:'',component:'',class_code:'',county:'',edition:'',priority:false,
  relation:'',huc12:'',sort:'waterbody',page:0,pageSize:25});

export function filterRecords(records, filter={}) {
  const terms=normalize(filter.query).trim().split(/\s+/).filter(Boolean);
  const filtered=records.filter(row=>{
    if(filter.jurisdiction && jurisdiction(row)!==filter.jurisdiction)return false;
    if(filter.component && !classComponents(row).includes(filter.component))return false;
    if(filter.class_code && row.class_code!==filter.class_code)return false;
    if(filter.county && !(row.county_codes||[]).includes(filter.county))return false;
    if(filter.edition && row.edition?.id!==filter.edition)return false;
    if(filter.priority && row.rfp_high_quality_candidate!==true)return false;
    if(filter.huc12 && !(row.linked_huc12||[]).includes(filter.huc12))return false;
    if(filter.relation){
      const matched=['coextensive','partial','candidate'].includes(filter.relation) ?
        (row.native_associations||[]).some(item=>item.geometry_relation===filter.relation &&
          item.has_positive_intersection) : row.association_status===filter.relation;
      if(!matched)return false;
    }
    const search=normalize([row.waterbody_name,row.reach_description,row.id,row.class_raw,row.original_index,jurisdiction(row),classificationSystem(row),classComponents(row).join(' '),
      (row.county_codes||[]).join(' '),(row.linked_huc12||[]).join(' '),
      ...(row.native_associations||[]).map(item=>item.feature_id+' '+(item.native_waterbody_name||''))
    ].join(' '));
    return terms.every(term=>search.includes(term));
  });
  const sorting={
    waterbody:row=>row.waterbody_name,
    class:row=>row.class_raw,
    county:row=>(row.county_codes||[]).join(','),
    association:row=>relationNames[row.association_status]||row.association_status,
    source:row=>row.source_line_start
  };
  const key=sorting[filter.sort]||sorting.waterbody;
  return filtered.sort((a,b)=>{
    const aa=key(a),bb=key(b);
    const order=typeof aa==='number'&&typeof bb==='number'?aa-bb:
      String(aa??'').localeCompare(String(bb??''),undefined,{numeric:true,sensitivity:'base'});
    return order||String(a.id).localeCompare(String(b.id));
  });
}

export function reviewExport(snapshot, records, filter) {
  return {
    schema:'upstate.water-source-review-export/v1',exported_at:new Date().toISOString(),
    workspace_key:snapshot.workspace_key,registry_source:snapshot.registry_source,
    crosswalk_source:snapshot.crosswalk_source,editions:snapshot.editions,
    source_counts:snapshot.counts,source_inventories:snapshot.source_inventories||[],selection:{filter:{...filter},record_count:records.length,
      record_ids:records.map(row=>({edition_id:row.edition.id,record_id:row.id}))},
    records,interpretation:snapshot.interpretation
  };
}

export function recordsCsv(records) {
  const fields=['id','edition_id','edition_status','jurisdiction','classification_system','class_components',
    'primary_class','supplemental_classes','special_markers','original_index','effective_date','classification_role',
    'waterbody_name','county_codes','class_raw',
    'class_code','previous_class','site_specific','no_discharge_zone','rfp_high_quality_candidate',
    'reach_description','source_pdf_page','source_printed_page','source_line_start','source_line_end',
    'source_url','association_status','native_feature_count','linked_huc12','native_associations'];
  const cell=value=>{
    let text=plain(value);
    if(/^[\t\r\n ]*[=+\-@]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  return '\ufeff'+fields.map(cell).join(',')+'\r\n'+records.map(row=>{
    const value={...row,jurisdiction:jurisdiction(row),classification_system:classificationSystem(row),
      class_components:classComponents(row),edition_id:row.edition.id,edition_status:row.edition.status,
      source_url:row.edition.source_url};
    return fields.map(field=>cell(value[field])).join(',');
  }).join('\r\n')+'\r\n';
}



const nativeFilterDefault=()=>({query:'',source:'',jurisdiction:'',component:'',class_code:'',hydro_type:'',name_status:'',
  county:'',geography:'',relation:'',huc12:'',page:0,pageSize:25});
const geographyNames={positive:'Positive measured intersection',touch:'Boundary touch only',
  outside:'Outside loaded geographic scope'};
const nativeSourceKey=row=>JSON.stringify([row.collection_id,row.source_id]);

export function filterNativeFeatures(records,filter={}) {
  const terms=normalize(filter.query).trim().split(/\s+/).filter(Boolean);
  return records.filter(row=>{
    if(filter.jurisdiction && jurisdiction(row)!==filter.jurisdiction)return false;
    if(filter.component && !classComponents(row).includes(filter.component))return false;
    if(filter.source && nativeSourceKey(row)!==filter.source)return false;
    if(filter.class_code && row.class_code!==filter.class_code)return false;
    if(filter.hydro_type && (filter.hydro_type==='__blank__'?
        String(row.hydro_type_raw??'').trim()!=='' : row.hydro_type_raw!==filter.hydro_type))return false;
    if(filter.name_status==='blank' && !row.name_blank)return false;
    if(filter.name_status==='named' && row.name_blank)return false;
    if(filter.county && (filter.county==='__blank__'?!row.county_blank:
        !(row.county_codes||[]).includes(filter.county)))return false;
    if(filter.geography && row.geographic_status!==filter.geography)return false;
    if(filter.huc12 && !(row.positive_huc12||[]).includes(filter.huc12))return false;
    if(filter.relation && (filter.relation==='none'?(row.association_relations||[]).length>0:
        !(row.association_relations||[]).includes(filter.relation)))return false;
    const haystack=normalize([row.waterbody_name,row.feature_id,row.object_id,row.county_raw,
      row.class_raw,row.hydro_type_raw,row.publisher_huc12,
      ...(row.positive_huc12||[]),...(row.legal_record_ids||[])].join(' '));
    return terms.every(term=>haystack.includes(term));
  });
}

export function nativeFeaturesCsv(records) {
  const fields=['feature_id','collection_id','source_id','layer_id','id_field','object_id',
    'jurisdiction','classification_system','class_components','primary_class','supplemental_classes',
    'special_markers','original_index','native_effective_date','classification_role',
    'waterbody_name','name_blank','county_raw','county_codes','county_blank','class_raw',
    'class_code','previous_class','site_specific','no_discharge_zone','hydro_type_raw',
    'publisher_huc12','legal_edition_status','data_status','geographic_status',
    'positive_reporting','positive_huc12','touch_huc12','legal_record_ids',
    'association_relations','source_feature_refs'];
  const cell=value=>{let text=plain(value);if(/^[\t\r\n ]*[=+\-@]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';};
  return '\ufeff'+fields.map(cell).join(',')+'\r\n'+records.map(row=>
    fields.map(field=>cell(row[field])).join(',')).join('\r\n')+'\r\n';
}

export function nativeCohortSelection(catalogue,records,filter={}) {
  if(!records.length)throw Error('Choose at least one captured feature.');
  const sources=new Set(records.map(nativeSourceKey));
  if(sources.size!==1)throw Error('Choose one captured source edition for a saved feature selection.');
  const selected=[...sources][0],source=(catalogue.sources||[]).find(row=>nativeSourceKey(row)===selected);
  if(!source)throw Error('The captured source edition is unavailable.');
  const ids=new Set(records.map(row=>row.feature_id));
  const recordIds=new Set(records.flatMap(row=>row.legal_record_ids||[]));
  return designationSelection({
    collection_id:source.collection_id,source_collection_id:source.collection_id,
    source_id:source.source_id,layer:source.layer,id_field:source.id_field,
    native_oid_field:source.native_oid_field,class_field:source.class_field,
    expected_source_sha256:source.expected_source_sha256||source.sha256,
    source_feature_refs:records.flatMap(row=>row.source_feature_refs),
    source_legal_reference:source.source_legal_reference,rule_reference:source.rule_reference,
    rule_edition:source.rule_edition,
    legal_record_context:(catalogue.legal_records||[]).filter(item=>recordIds.has(item.record.id)),
    legal_associations:(catalogue.legal_associations||[]).filter(link=>ids.has(link.feature_id)),
    positive_huc12:[...new Set(records.flatMap(row=>row.positive_huc12||[]))].sort(),
    selection_scope:{kind:'captured-source-filter',count:records.length,filters:{...filter}},
    geography_role:'native-classified-water-features',origin:'water-source-review'
  });
}

export function designationSelection(context) {
  if(!context || !context.collection_id || !context.source_id)
    throw Error('Choose the original imported source collection and native feature.');
  const refs=context.source_feature_refs||[];
  if(!refs.length)throw Error('The selected source feature needs its original typed identifier.');
  const targetRefs=refs.map(ref=>{
    const value=ref.value;
    if((typeof value!=='string' && typeof value!=='number') ||
       (typeof value==='number' && !Number.isSafeInteger(value)) ||
       (typeof value==='string' && !value.length) || !ref.field)
      throw Error('The source feature reference has no usable original typed identifier.');
    if(ref.source_id!==context.source_id)
      throw Error('Open one retained source edition in the designation desk.');
    return {feature_id:value,collection_id:context.collection_id,source_id:ref.source_id};
  });
  const originalLegal=context.legal_record_context;
  const originalObject=originalLegal&&!Array.isArray(originalLegal)&&typeof originalLegal==='object'?originalLegal:{};
  const legalRecords=Array.isArray(originalLegal)?originalLegal:
    Array.isArray(originalObject.records)?originalObject.records:[];
  const notes=Array.isArray(originalObject.notes)?originalObject.notes.slice():
    originalObject.notes?[String(originalObject.notes)]:[];
  notes.push('Water source review: '+targetRefs.length+' original captured feature'+(targetRefs.length===1?'':'s')+
    '; native identifier field '+refs[0].field+'.');
  if(legalRecords.length)notes.push('Related legal reach records: '+legalRecords.length+
    '. Candidate, partial and coextensive relationships retain the supplied reach extents.');
  const legalContext={...originalObject,schema:'upstate.water-source-legal-context/v1',
    records:legalRecords,associations:context.legal_associations||originalObject.associations||[],
    rule_reference:context.rule_reference||originalObject.rule_reference||{},
    rule_edition:context.rule_edition||originalObject.rule_edition||null,
    source_legal_reference:context.source_legal_reference||originalObject.source_legal_reference||null,
    source_binding:{collection_id:context.collection_id,source_id:context.source_id,
      layer:context.layer??null,id_field:context.id_field||refs[0].field,
      class_field:context.class_field||null,sha256:context.expected_source_sha256||null},
    source_feature_refs:refs.map(ref=>({...ref})),positive_huc12:context.positive_huc12||[],
    selection_scope:context.selection_scope||null,notes};
  return {...context, purpose:context.purpose||'high_quality_waters',
    source_feature_refs:targetRefs,native_source_feature_refs:refs.map(ref=>({...ref})),
    legal_record_context:legalContext,
    selection_mode:'features',feature_ids:targetRefs.map(ref=>ref.feature_id)};
}

export function attachWaterSourceReview(host) {
  const {getState,api,endpoint,toast}=host;
  const document=host.document||globalThis.document;
  let root=null,frame=null,workspace=null,catalogue=null,snapshot=null,featureSnapshot=null;
  let nativeCatalogue=null,nativeFilter=nativeFilterDefault(),nativeSerial=0,nativeLoading=false;
  let nativeController=null,nativeError='';
  let filter=canonicalFilter(),selectedRecord='',registryChoice='',crosswalkChoice='';
  let sourceFingerprint='',pendingOpen=null,loadSerial=0,detailSerial=0,openSerial=0;
  let selectionTarget={extension_id:'water-designations',method:'openSelection'};
  let loadController=null,detailController=null,typingTimer=null,working=false;
  const node=selector=>frame?.querySelector(selector);
  const currentWorkspace=()=>getState()?.workspace_key??null;
  const storageKey=()=> 'upstate-water-source-review:'+workspace;
  const rows=()=>filterRecords(snapshot?.records||[],filter);
  const nativeRows=()=>filterNativeFeatures(nativeCatalogue?.records||[],nativeFilter);
  const sourceToken=state=>{const sources=state?.data?.sources||state?.sources||[];
    return JSON.stringify((Array.isArray(sources)?sources:[]).map(row=>
      [row.id,(row.entries||[]).map(entry=>[entry.id,entry.body?.sha256])]));};
  function status(message,isError=false){
    const target=node('[data-water-status]');
    if(target){target.textContent=message;target.setAttribute('role',isError?'alert':'status');}
  }
  function remember(){
    if(workspace===null)return;
    try{localStorage.setItem(storageKey(),JSON.stringify({registryChoice,crosswalkChoice,filter,selectedRecord,nativeFilter}));}catch(_){}
  }
  function restore(){
    let saved=null;try{saved=JSON.parse(localStorage.getItem(storageKey())||'null');}catch(_){}
    registryChoice=saved?.registryChoice||'';crosswalkChoice=saved?.crosswalkChoice||'';
    filter={...canonicalFilter(),...(saved?.filter||{}),page:0};
    selectedRecord=saved?.selectedRecord||'';
    nativeFilter={...nativeFilterDefault(),...(saved?.nativeFilter||{}),page:0};
  }
  function query(){
    const values={};
    if(registryChoice){const [collection,source]=JSON.parse(registryChoice);
      values.registry_collection=collection;values.registry_source=source;}
    if(crosswalkChoice){const [collection,source]=JSON.parse(crosswalkChoice);
      values.crosswalk_collection=collection;values.crosswalk_source=source;}
    return values;
  }
  function controls(){
    return '<header class="page-header"><div><h1>Water source review</h1>'+
      '<p>Read the complete legal reach register alongside captured stream classifications and measured watershed intersections.</p></div></header>'+
      '<section class="section water-source-controls"><h2>Source editions</h2><div class="water-source-grid">'+
      '<label>Legal register<select name="water-registry"></select></label>'+
      '<label>Geographic crosswalk<select name="water-crosswalk"><option value="">Choose an imported crosswalk</option></select></label>'+
      '</div><div class="water-source-toolbar"><button type="button" data-water-action="refresh">Refresh imported sources</button>'+
      '<button type="button" data-water-action="export-json">Export matching rows as JSON</button>'+
      '<button type="button" data-water-action="export-csv">Export matching rows as CSV</button></div>'+
      '<label>Briefing title<input name="water-brief-title" value="Classified-water source review" maxlength="300"></label>'+
      '<div class="water-source-toolbar"><button type="button" data-water-action="export-brief">Download printable source briefing</button></div>'+
      '<p class="small">The briefing retains every row in the current legal filter and, when loaded, the current captured-feature filter. Open the downloaded HTML to read, print, or download its complete CSV and JSON.</p>'+
      '<p data-water-status role="status" aria-live="polite">Opening imported source editions…</p></section>'+
      '<section class="section" data-water-summary></section>'+
      '<section class="section" data-water-inventory hidden></section>'+
      '<section class="section"><h2>Legal reaches</h2><div class="water-source-filters">'+
      '<label class="water-source-search">Find a reach<input name="water-query" type="search" placeholder="Name, reach description, native identifier or HUC12"></label>'+
      '<label>Jurisdiction<select name="water-jurisdiction"></select></label>'+
      '<label>Original component<select name="water-component"></select></label>'+
      '<label>Complete original class<select name="water-class"></select></label>'+
      '<label>County code<select name="water-county"></select></label>'+
      '<label>Legal edition<select name="water-edition"></select></label>'+
      '<label>Geometry association<select name="water-relation"></select></label>'+
      '<label>Associated feature HUC12<select name="water-huc"></select></label>'+
      '<label>Order<select name="water-sort"><option value="waterbody">Waterbody name</option><option value="class">Legal class</option>'+
      '<option value="county">County code</option><option value="association">Association</option><option value="source">Regulation source line</option></select></label>'+
      '<label>Rows per page<select name="water-page-size"><option value="25">25</option><option value="50">50</option><option value="all">All matching rows</option></select></label>'+
      '<label class="water-source-check"><input name="water-priority" type="checkbox">RFP priority class rows</label>'+
      '</div><p data-water-result-count aria-live="polite"></p><div class="water-source-table-wrap" data-water-table></div>'+
      '<div class="water-source-toolbar"><button type="button" data-water-action="previous">Previous page</button>'+
      '<button type="button" data-water-action="next">Next page</button></div></section>'+
      '<section class="section water-source-detail" data-water-record aria-live="polite"></section>'+
      '<section class="section" data-water-native-browser><h2>Captured native features</h2>'+
      '<p>Browse the complete captured source, including unnamed features and linework with no legal-row association.</p>'+
      '<div class="water-source-toolbar"><button type="button" data-water-action="load-native">Browse captured features</button>'+
      '<button type="button" data-water-action="native-json" disabled>Export matching feature inventory</button>'+
      '<button type="button" data-water-action="native-csv" disabled>Export matching features as CSV</button>'+
      '<button type="button" data-water-action="native-designation" disabled>Open matching features in designation desk</button></div>'+
      '<p data-water-native-status role="status" aria-live="polite">Choose an imported geographic crosswalk to browse its complete original captures.</p>'+
      '<div data-water-native-domain></div>'+
      '<div class="water-source-filters" data-water-native-filters hidden>'+
      '<label class="water-source-search">Find a native feature<input name="water-native-query" type="search" placeholder="Name, original identifier, county, publisher type or HUC12"></label>'+
      '<label>Captured source<select name="water-native-source"></select></label>'+
      '<label>Native class<select name="water-native-class"></select></label>'+
      '<label>Publisher linework type<select name="water-native-type"></select></label>'+
      '<label>Waterbody name<select name="water-native-name"><option value="">All names</option><option value="blank">Blank native name</option><option value="named">Named features</option></select></label>'+
      '<label>Jurisdiction<select name="water-native-jurisdiction"></select></label>'+
      '<label>Original component<select name="water-native-component"></select></label>'+
      '<label>County code<select name="water-native-county"></select></label>'+
      '<label>Geographic intersection<select name="water-native-geography"><option value="">All captured features</option><option value="positive">Positive measured intersection</option><option value="touch">Boundary touch only</option><option value="outside">Outside loaded geography</option></select></label>'+
      '<label>Legal association<select name="water-native-relation"><option value="">All relationships</option><option value="none">No legal-row association</option><option value="candidate">Candidate</option><option value="partial">Partial</option><option value="coextensive">Explicit coextensive</option></select></label>'+
      '<label>Positive WBD HUC12<select name="water-native-huc"></select></label>'+
      '<label>Features per page<select name="water-native-page-size"><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="all">All matching features</option></select></label></div>'+
      '<div class="water-source-table-wrap" data-water-native-table></div>'+
      '<div class="water-source-toolbar"><button type="button" data-water-action="native-previous" disabled>Previous feature page</button>'+
      '<button type="button" data-water-action="native-next" disabled>Next feature page</button></div>'+
      '<p data-water-native-downloads></p></section>'+
      '<section class="section water-source-detail" data-water-feature-section hidden><h2>Native feature review</h2>'+
      '<div data-water-native-inspector aria-live="polite"></div></section>'+
      '<details class="section water-source-provenance"><summary>Source coverage, geographic methods and original files</summary>'+
      '<div data-water-provenance></div></details>';
  }
  function options(target,values,selected,empty){
    if(!target)return;
    target.innerHTML='<option value="">'+escape(empty)+'</option>'+values.map(item=>
      '<option value="'+escape(item.value)+'">'+escape(item.label)+'</option>').join('');
    target.value=selected||'';
  }
  function sourceControls(){
    options(node('[name="water-registry"]'),(catalogue?.registries||[]).map(row=>({
      value:sourceKey(row),label:row.title+' · '+row.vintage+' · '+row.collection_id.slice(0,10)
    })),registryChoice,'Choose a complete legal register');
    options(node('[name="water-crosswalk"]'),(catalogue?.crosswalks||[]).map(row=>({
      value:sourceKey(row),label:row.title+' · '+row.vintage+' · '+row.collection_id.slice(0,10)
    })),crosswalkChoice,'Legal register without a crosswalk');
  }
  function filterControls(){
    const records=snapshot?.records||[];
    const unique=(field)=>[...new Set(records.flatMap(field))].sort((a,b)=>String(a).localeCompare(String(b)));
    for(const [key,allowed] of Object.entries({jurisdiction:unique(row=>[jurisdiction(row)]),component:unique(classComponents),
      class_code:unique(row=>row.class_code?[row.class_code]:[]),
      county:unique(row=>row.county_codes||[]),edition:(snapshot?.editions||[]).map(row=>row.id),
      huc12:unique(row=>row.linked_huc12||[])}))if(filter[key]&&!allowed.includes(filter[key]))filter[key]='';
    options(node('[name="water-jurisdiction"]'),unique(row=>[jurisdiction(row)]).map(value=>({value,label:value})),filter.jurisdiction,'All jurisdictions');
    options(node('[name="water-component"]'),unique(classComponents).map(value=>({value,label:value})),filter.component,'All original components');
    options(node('[name="water-class"]'),unique(row=>row.class_code?[row.class_code]:[]).map(value=>({value,label:value})),filter.class_code,'All classes');
    options(node('[name="water-county"]'),unique(row=>row.county_codes||[]).map(value=>({value,label:value})),filter.county,'All counties');
    options(node('[name="water-edition"]'),(snapshot?.editions||[]).map(row=>({value:row.id,label:row.regulation+' · '+row.status+' · '+row.id})),filter.edition,'All loaded editions');
    options(node('[name="water-huc"]'),unique(row=>row.linked_huc12||[]).map(value=>({value,label:value})),filter.huc12,'All associated HUCs');
    options(node('[name="water-relation"]'),Object.entries(relationNames).map(([value,label])=>({value,label})),filter.relation,'All association states');
    node('[name="water-query"]').value=filter.query;
    node('[name="water-sort"]').value=filter.sort;
    node('[name="water-page-size"]').value=String(filter.pageSize);
    node('[name="water-priority"]').checked=filter.priority;
  }
  function drawSummary(){
    const target=node('[data-water-summary]');if(!target)return;
    if(!snapshot){target.innerHTML='<h2>Imported source register</h2><p>Choose an imported complete legal reach register above.</p>';return;}
    const count=snapshot.counts,cw=snapshot.crosswalk_source;
    target.innerHTML='<h2>'+number(count.legal_rows)+' legal rows</h2><p>'+
      number(count.literal_waterbody_names)+' literal waterbody names · '+number(count.priority_rows)+
      ' priority class rows · '+number(count.no_discharge_zone_rows)+' no-discharge-zone rows</p>'+
      '<p>Named aliases and split reaches retain their separate regulation rows.</p>'+
      '<div class="water-source-editions">'+snapshot.editions.map(edition=>'<article><h3>'+
        escape((edition.jurisdiction||'South Carolina')+' · '+edition.regulation+' · '+edition.status)+'</h3><p>'+
        escape([edition.state_publication_date?'State publication '+edition.state_publication_date:'',
          edition.cwa_effective_date?'CWA effective '+edition.cwa_effective_date:'',
          edition.checked_at?'Source checked '+edition.checked_at:''].filter(Boolean).join(' · '))+'</p><p>'+
        link(edition.source_url,'Original regulation')+' · '+link(edition.effective_source_url,'Edition effective-date source')+'</p></article>').join('')+'</div>'+
      (cw?'<p>Selected crosswalk: '+number(cw.native_feature_count)+' native features with retained geographic intersections · '+
        escape(cw.analysis_crs)+' · generated '+escape(cw.generated_at||cw.vintage)+'.</p>':
        '<p>Choose an imported crosswalk to inspect each legal reach’s native geometry associations.</p>');
  }
  function drawInventories(){
    const target=node('[data-water-inventory]');if(!target)return;
    const values=snapshot?.source_inventories||[];
    target.hidden=values.length===0;
    if(!values.length){target.innerHTML='';return;}
    const diagnosticNames={
      blank_native_name:'Blank native name',
      literal_name_class_blank_county:'Name and class agree; native county blank',
      literal_name_class_county:'Literal name, class and county agree',
      literal_name_class_different_county:'Name and class agree; different county',
      literal_name_different_class:'Literal name agrees; different class',
      no_literal_registry_name:'Nonblank name absent from selected legal register'
    };
    target.innerHTML='<h2>Captured GIS source inventory</h2>'+values.map(item=>{
      const value=item.profile;
      const rows=(counts,first)=>'<div class="water-source-table-wrap"><table><thead><tr><th>'+escape(first)+
        '</th><th>Native features</th></tr></thead><tbody>'+Object.entries(counts||{}).map(([key,count])=>
        '<tr><td>'+escape(key.trim()?key:'Blank native value')+'</td><td>'+number(count)+'</td></tr>').join('')+'</tbody></table></div>';
      return '<article><h3>'+escape(item.source.title)+'</h3><p>'+number(value.feature_count)+' captured native features · '+
        number(value.distinct_native_id_count)+' distinct native identifiers · '+number(value.publisher_huc_count)+
        ' publisher HUC12 codes</p><p>'+number(value.nonblank_literal_name_count)+' distinct nonblank source names · '+
        number(value.blank_name_count)+' features with blank names · '+number(value.blank_county_count)+' with blank counties</p>'+
        '<p>Source capture '+escape(value.source_capture_date)+' · Legal edition '+escape(value.legal_edition_status)+
        ' · Publisher status '+escape(value.data_status)+
        (item.matches_selected_crosswalk_source?' · Matches the selected crosswalk’s captured source identity':'')+'</p>'+
        '<details><summary>Publisher classes and all linework types</summary>'+rows(value.class_counts,'Native class')+
        rows(value.hydro_type_counts,'Publisher HYDTYPE')+'</details>'+
        '<details><summary>Source names and county comparisons with the legal register</summary>'+
        '<p>The inventory compares literal names, classes and counties. Every category retains its complete source features and original legal reach descriptions.</p>'+
        '<div class="water-source-table-wrap"><table><thead><tr><th>Literal comparison</th><th>Native features</th></tr></thead><tbody>'+
        Object.entries(value.literal_join_counts||{}).map(([key,count])=>'<tr><td>'+escape(diagnosticNames[key]||key)+
        '</td><td>'+number(count)+'</td></tr>').join('')+'</tbody></table></div>'+
        '<p>Compared registry source: <code>'+escape(item.compared_registry_sha256||'')+'</code>'+
        (item.matches_selected_registry_body?' · Matches the selected standalone registry body':'')+'</p>'+
        (value.name_or_county_review_groups||[]).map(group=>'<details><summary>'+
          escape(group.waterbody_name_raw+' · '+group.class_raw+' · '+(group.county_raw?.trim()||'Blank county'))+
          ' · '+number(group.object_ids.length)+' native features</summary><p>'+escape(diagnosticNames[group.literal_join_status]||group.literal_join_status)+
          '</p><p>Related literal-name legal rows: '+group.literal_registry_record_ids.map(id=>{
            const record=snapshot.records.find(row=>row.id===id);
            return record?'<button type="button" class="water-source-row-button" data-water-record-id="'+escape(recordKey(record))+'">'+escape(id)+'</button>':'<code>'+escape(id)+'</code>';
          }).join(', ')+'</p><p>Original OBJECTID values: <code>'+escape(group.object_ids.join(', '))+'</code></p></details>').join('')+
        '</details><details><summary>Exact input files and capture selection</summary><pre>'+escape(JSON.stringify({
          source_id:value.source_id,layer_id:value.layer_id,source_uri:value.source_uri,
          identity:value.identity,inputs:value.inputs,source_selection:value.source_selection,
          metric_labels:value.metric_labels,interpretation:value.interpretation
        },null,2))+'</pre></details><p>'+(item.downloads||[]).map(file=>link(file.url,file.label)).join(' · ')+'</p></article>';
    }).join('');
  }

  function resetNativeBrowser(){
    nativeSerial++;nativeController?.abort();nativeCatalogue=null;nativeLoading=false;nativeError='';
    detailController?.abort();detailSerial++;featureSnapshot=null;
    const section=node('[data-water-feature-section]');if(section)section.hidden=true;
    const inspector=node('[data-water-native-inspector]');if(inspector)inspector.innerHTML='';
    drawNativeBrowser();
  }
  function nativeOptions(){
    if(!nativeCatalogue)return;
    const records=nativeCatalogue.records;
    const sourceOptions=nativeCatalogue.sources.map(source=>({value:nativeSourceKey(source),
      label:source.title+' · '+source.source_id}));
    const classOptions=[...new Set(records.map(row=>row.class_code).filter(Boolean))].sort().map(value=>({value,label:value}));
    const jurisdictionOptions=[...new Set(records.map(jurisdiction))].sort().map(value=>({value,label:value}));
    const componentOptions=[...new Set(records.flatMap(classComponents))].sort().map(value=>({value,label:value}));
    const types=[...new Set(records.map(row=>row.hydro_type_raw).filter(value=>String(value??'').trim()))].sort();
    const typeOptions=[...types.map(value=>({value,label:value})),{value:'__blank__',label:'Blank native type'}];
    const countyOptions=[...[...new Set(records.flatMap(row=>row.county_codes||[]))].sort().map(value=>({value,label:value})),
      {value:'__blank__',label:'Blank native county'}];
    const hucOptions=[...new Set(records.flatMap(row=>row.positive_huc12||[]))].sort().map(value=>({value,label:value}));
    for(const [key,items] of Object.entries({source:sourceOptions,class_code:classOptions,
      jurisdiction:jurisdictionOptions,component:componentOptions,
      hydro_type:typeOptions,county:countyOptions,huc12:hucOptions})){
      if(nativeFilter[key]&&!items.some(item=>item.value===nativeFilter[key]))nativeFilter[key]='';
    }
    if(sourceOptions.length===1)nativeFilter.source=sourceOptions[0].value;
    options(node('[name="water-native-source"]'),sourceOptions,nativeFilter.source,'All captured sources');
    options(node('[name="water-native-jurisdiction"]'),jurisdictionOptions,nativeFilter.jurisdiction,'All jurisdictions');
    options(node('[name="water-native-component"]'),componentOptions,nativeFilter.component,'All original components');
    options(node('[name="water-native-class"]'),classOptions,nativeFilter.class_code,'All native classes');
    options(node('[name="water-native-type"]'),typeOptions,nativeFilter.hydro_type,'All publisher linework types');
    options(node('[name="water-native-county"]'),countyOptions,nativeFilter.county,'All native counties');
    options(node('[name="water-native-huc"]'),hucOptions,nativeFilter.huc12,'All positive HUC12 intersections');
    const values={'water-native-query':'query','water-native-name':'name_status',
      'water-native-geography':'geography','water-native-relation':'relation','water-native-page-size':'pageSize'};
    for(const [name,key] of Object.entries(values)){const input=node('[name="'+name+'"]');if(input)input.value=nativeFilter[key];}
  }
  function drawNativeBrowser(){
    const table=node('[data-water-native-table]'),message=node('[data-water-native-status]');
    if(!table||!message)return;
    const filters=node('[data-water-native-filters]');filters.hidden=!nativeCatalogue;
    const coverage=node('[data-water-native-domain]');if(coverage)coverage.innerHTML=domainCoverageHtml();
    const load=node('[data-water-action="load-native"]');if(load)load.disabled=!crosswalkChoice||nativeLoading||working;
    for(const action of ['native-json','native-csv','native-designation','native-previous','native-next']){
      const button=node('[data-water-action="'+action+'"]');if(button)button.disabled=true;
    }
    const downloadTarget=node('[data-water-native-downloads]');if(downloadTarget)downloadTarget.innerHTML='';
    if(!nativeCatalogue){
      table.innerHTML='';
      message.textContent=nativeError||(nativeLoading?'Reading every retained native feature and its original source identity…':
        'Choose Browse captured features to inspect the complete original source independently of legal-reach links.');
      return;
    }
    const matching=nativeRows(),size=nativeFilter.pageSize==='all'?Math.max(matching.length,1):Number(nativeFilter.pageSize)||25;
    nativeFilter.page=Math.max(0,Math.min(Number(nativeFilter.page)||0,Math.max(0,Math.ceil(matching.length/size)-1)));
    const start=nativeFilter.page*size,visible=matching.slice(start,start+size);
    message.textContent=matching.length+' matching features of '+nativeCatalogue.counts.captured_features+
      ' captured; '+nativeCatalogue.counts.blank_names+' blank native names. '+
      (matching.length?'Showing '+(start+1)+'–'+(start+visible.length)+'. ':'')+
      'Pagination changes the visible page; exports and designation selection use every matching feature.';
    table.innerHTML='<table><thead><tr><th>Original feature</th><th>Native name and county</th><th>Native class</th>'+
      '<th>Publisher linework type</th><th>Geographic intersection</th><th>Publisher HUC12</th>'+
      '<th>Positive WBD HUC12</th><th>Legal association</th></tr></thead><tbody>'+
      visible.map(row=>'<tr><td><button type="button" class="water-source-row-button" data-water-feature="'+escape(row.feature_id)+'">'+
        escape(row.id_field+' = '+plain(row.object_id))+'</button><br><small>'+escape(row.layer_id)+'</small></td>'+
        '<td>'+escape(row.name_blank?'Blank native name':plain(row.waterbody_name))+'<br><small>'+
        escape(row.county_blank?'Blank native county':plain(row.county_raw))+'</small></td>'+
        '<td>'+escape(plain(row.class_raw))+'<br><small>'+escape(row.data_status||'')+'</small></td>'+
        '<td>'+escape(String(row.hydro_type_raw??'').trim()?plain(row.hydro_type_raw):'Blank native type')+'</td>'+
        '<td>'+escape(geographyNames[row.geographic_status]||row.geographic_status)+'</td>'+
        '<td>'+escape(plain(row.publisher_huc12)||'—')+'</td><td>'+escape(row.positive_huc12.join(', ')||'—')+'</td>'+
        '<td>'+escape(row.association_relations.map(value=>relationNames[value]||value).join(', ')||'No legal-row association')+
        (row.legal_record_ids.length?'<br><small>'+escape(row.legal_record_ids.join(', '))+'</small>':'')+'</td></tr>').join('')+
      '</tbody></table>';
    for(const action of ['native-json','native-csv']){
      const button=node('[data-water-action="'+action+'"]');if(button)button.disabled=nativeLoading||!matching.length;
    }
    const previous=node('[data-water-action="native-previous"]'),next=node('[data-water-action="native-next"]');
    if(previous)previous.disabled=nativeFilter.page===0;if(next)next.disabled=start+visible.length>=matching.length;
    const designation=node('[data-water-action="native-designation"]');
    if(designation)designation.disabled=!matching.length||new Set(matching.map(nativeSourceKey)).size!==1||
      typeof host.openExtension!=='function';
    if(downloadTarget)downloadTarget.innerHTML=(nativeCatalogue.downloads||[]).map(file=>link(file.url,file.label)).join(' · ');
    remember();
  }
  async function loadNativeFeatures(){
    if(!snapshot||!crosswalkChoice)throw Error('Choose the imported crosswalk containing the captured source.');
    const serial=++nativeSerial,requested=workspace,choice=crosswalkChoice;
    nativeController?.abort();nativeController=new AbortController();nativeLoading=true;nativeError='';drawNativeBrowser();
    try{
      const value=await api(endpoint('/api/water-source-review/features',query()),{signal:nativeController.signal});
      if(serial!==nativeSerial||workspace!==requested||choice!==crosswalkChoice||!frame)return;
      nativeCatalogue=value;nativeFilter.page=0;nativeOptions();
    }catch(error){if(serial===nativeSerial&&error.name!=='AbortError'){
      nativeError=error.message||String(error);
      const target=node('[data-water-native-status]');if(target)target.textContent=nativeError;
      throw error;}}
    finally{if(serial===nativeSerial){nativeLoading=false;drawNativeBrowser();}}
  }

  function drawTable(){
    const matching=rows(),size=filter.pageSize==='all'?Math.max(1,matching.length):Number(filter.pageSize)||25;
    filter.page=Math.max(0,Math.min(Number(filter.page)||0,Math.max(0,Math.ceil(matching.length/size)-1)));
    const start=filter.page*size,visible=matching.slice(start,start+size);
    const target=node('[data-water-table]');if(!target)return;
    node('[data-water-result-count]').textContent=matching.length ?
      (start+1)+'–'+(start+visible.length)+' of '+matching.length+' matching legal rows · '+(snapshot?.records.length||0)+' rows in the complete loaded register' :
      '0 matching legal rows · '+(snapshot?.records.length||0)+' rows in the complete loaded register';
    target.innerHTML=visible.length?'<table><thead><tr><th scope="col">Waterbody and legal reach</th><th scope="col">Legal class</th>'+
      '<th scope="col">County</th><th scope="col">Native association</th><th scope="col">Feature HUCs</th></tr></thead><tbody>'+
      visible.map(row=>'<tr'+(recordKey(row)===selectedRecord?' class="water-source-selected"':'')+'>'+
      '<td><button type="button" class="water-source-row-button" data-water-record-id="'+escape(recordKey(row))+'">'+escape(row.waterbody_name)+'</button>'+
      '<p class="water-source-reach-preview">'+escape(row.reach_description)+'</p></td><td>'+escape(row.class_raw)+
      '<br><small>'+escape(jurisdiction(row)+' · '+classificationSystem(row))+'</small>'+
      (row.no_discharge_zone?'<br><span>NDZ</span>':'')+(row.site_specific?'<br><span>Site specific</span>':'')+
      '</td><td>'+escape((row.county_codes||[]).join(', '))+'</td><td>'+
      escape(relationNames[row.association_status]||row.association_status)+'<br><span>'+
      number(row.native_feature_count||0)+' linked features</span></td><td>'+
      escape((row.linked_huc12||[]).join(', ')||'—')+'</td></tr>').join('')+'</tbody></table>':
      '<p>Adjust the filters to show legal reaches in this source edition.</p>';
    node('[data-water-action="previous"]').disabled=filter.page===0;
    node('[data-water-action="next"]').disabled=start+size>=matching.length;
    remember();
  }
  function legalDetail(row){
    const edition=row.edition,pageUrl=safeHref(edition.source_url)?
      edition.source_url.replace(/#.*$/,'')+'#page='+encodeURIComponent(row.source_pdf_page):'';
    const links=row.native_associations||[];
    return '<h2>'+escape(row.waterbody_name)+'</h2><p class="water-source-legal-description">'+escape(row.reach_description)+'</p>'+
      '<dl class="water-source-definition"><dt>Complete original class</dt><dd>'+escape(row.class_raw)+'</dd>'+classificationDetails(row)+
      '<dt>Previous class</dt><dd>'+escape(row.previous_class||'—')+'</dd>'+
      '<dt>County codes</dt><dd>'+escape((row.county_codes||[]).join(', '))+'</dd>'+
      '<dt>No discharge zone</dt><dd>'+declaredBoolean(row.no_discharge_zone)+'</dd>'+
      '<dt>Site specific</dt><dd>'+declaredBoolean(row.site_specific)+'</dd>'+
      '<dt>Legal edition</dt><dd>'+escape(edition.id+' · '+edition.status)+'</dd>'+
      '<dt>Original location</dt><dd>'+link(pageUrl,'PDF page '+row.source_pdf_page)+
      ' · printed page '+escape(row.source_printed_page)+' · lines '+escape(row.source_line_start)+'–'+escape(row.source_line_end)+'</dd>'+
      '<dt>Record identity</dt><dd><code>'+escape(row.id)+'</code></dd></dl>'+
      '<h3>Native geometry associations</h3><p>Each association retains its supplied relationship to this legal reach. Select a feature to inspect its original attributes and measured intersections.</p>'+
      (links.length?'<div class="water-source-table-wrap"><table><thead><tr><th>Native feature</th><th>Relationship</th><th>Native class</th><th>Positive feature HUC12</th></tr></thead><tbody>'+
      links.map(item=>'<tr><td>'+(item.geometry_available?
        '<button type="button" class="water-source-row-button" data-water-feature="'+escape(item.feature_id)+'">'+escape(item.feature_id)+'</button>':
        '<code>'+escape(item.feature_id)+'</code>')+(item.native_waterbody_name?'<br>'+escape(item.native_waterbody_name):'')+
        '</td><td>'+escape(relationNames[item.geometry_relation]||item.geometry_relation)+'<br>'+escape(item.method||'')+
        (!item.record_version_matches?'<br>Linked registry revision differs from the selected legal source':'')+
        (!item.has_positive_intersection?'<br>Outside positive geographic scope':'')+
        '</td><td>'+escape(plain(item.native_class_raw)||'—')+
        (item.data_status?'<br>Publisher status: '+escape(item.data_status):'')+
        (item.native_class_agrees===false?'<br>Native class differs from the linked legal row':'')+
        '</td><td>'+escape(item.huc12.join(', ')||'—')+
        (item.touch_huc12.length?'<br>Boundary touches: '+escape(item.touch_huc12.join(', ')):'')+'</td></tr>').join('')+
      '</tbody></table></div>':'<p>'+escape(relationNames[row.association_status]||row.association_status)+'.</p>')+
      '';
  }
  function drawRecord(){
    const target=node('[data-water-record]');if(!target)return;
    const matching=rows();
    let row=(snapshot?.records||[]).find(item=>recordKey(item)===selectedRecord);
    if(!row || !matching.some(item=>recordKey(item)===selectedRecord))row=matching[0];
    selectedRecord=row?recordKey(row):'';
    target.innerHTML=row?legalDetail(row):'<h2>Legal reach detail</h2><p>Select a legal reach in the complete register.</p>';
    remember();
  }

  function domainCoverageHtml(){
    return (snapshot?.domain_coverages||[]).map(item=>{
      const value=item.report,comparison=value.comparison||{},domain=value.domain||{};
      return '<article><h3>Selected-class inventory across the queried domain</h3>'+
        '<p>'+number(comparison.full_domain_feature_count)+' native feature IDs across '+number(domain.huc12_count)+
        ' queried HUC12s · Observed '+escape(value.source_observed_on)+
        ' · Classes '+escape((value.class_selection||[]).join(', '))+'</p>'+
        '<p>'+escape(comparison.identical_native_id_class_huc_inventory?
          'The observed native ID, class and publisher HUC inventory matches the retained capture.':
          'The domain report records differences from the retained capture.')+
        ' The remaining '+number(comparison.remaining_domain_huc_count)+' queried HUC12s contain '+
        number(comparison.remaining_domain_native_feature_count)+' additional selected-class features.</p>'+
        '<p>Geometry captured '+escape(value.original_geometry_capture_date)+
        ' · '+escape(item.matches_retained_geometry_page?'Original geometry hash matches a retained capture page.':
          'Compare the report’s original geometry reference with the selected source edition.')+'</p>'+
        '<p>'+escape(value.interpretation?.geographic_membership||'')+'</p>'+
        '<details><summary>Every queried publisher HUC12 and native class count</summary>'+
        '<div class="water-source-table-wrap"><table><thead><tr><th>Queried HUC12</th><th>Native features</th><th>Class counts</th></tr></thead><tbody>'+
        (value.publisher_huc_inventory||[]).map(row=>'<tr><td>'+escape(row.huc12)+'</td><td>'+number(row.native_features)+
          '</td><td>'+escape(Object.entries(row.class_counts||{}).map(([key,count])=>key+': '+count).join(', ')||'0')+'</td></tr>').join('')+
        '</tbody></table></div></details><p>'+(item.downloads||[]).map(file=>link(file.url,file.label)).join(' · ')+'</p></article>';
    }).join('');
  }

  function drawProvenance(){
    const target=node('[data-water-provenance]');if(!target)return;
    if(!snapshot){target.innerHTML='';return;}
    const cw=snapshot.crosswalk_source,source=snapshot.registry_source;
    let html='<h3>Legal source identity</h3><p>'+escape(source.title)+' · '+escape(source.vintage)+'</p>'+
      '<p><code>'+escape(source.sha256)+'</code></p>'+
      (source.legal_body_sha256?'<p>Retained legal companion: <code>'+escape(source.legal_body_sha256)+'</code></p>':'')+
      (snapshot.interpretation||[]).map(value=>'<p>'+escape(value)+'</p>').join('')+
      '<h3>Original downloads</h3><ul>'+(snapshot.downloads||[]).map(item=>'<li>'+
        link(item.url||item.href||item.download_url,item.label||item.title||item.filename||item.name||'Retained source file')+'</li>').join('')+'</ul>';
    if(cw){
      html+='<h3>Captured layer coverage</h3>'+(cw.layers||[]).map(layer=>
        '<details><summary>'+escape(layer.title||layer.id)+' · '+number(layer.feature_count)+' captured features</summary>'+
        '<p>'+link(layer.url,'Native service layer')+'</p><p>Object identifier: <code>'+escape(layer.oid_field)+'</code></p>'+
        '<p>Legal edition: '+escape(layer.mapping?.status||layer.status||'')+
        ' · Publisher status: '+escape(layer.mapping?.data_status||layer.data_status||'Unspecified')+'</p>'+
        '<pre>'+escape(JSON.stringify({mapping:layer.mapping,source_metadata:layer.source_metadata,
          capture_scope:layer.capture_scope,selection:layer.selection,where:layer.where},null,2))+'</pre></details>').join('')+
        '<h3>Classified source linework and water-area measures</h3><p>Each row is an independent region, class scope and geometry dimension. The unique measure comes from dissolved geometry within that row. Linework retains publisher types such as streams, separate bank lines, shorelines, dams and closure lines; inspect the native feature type with its measured length.</p>'+
        '<div class="water-source-table-wrap"><table><thead><tr><th>Region</th><th>Edition</th><th>Class scope</th><th>Features</th><th>Feature measure sum</th><th>Unique measure</th></tr></thead><tbody>'+
        (cw.coverage_summary||[]).map(item=>'<tr><td>'+escape(item.region_id)+'</td><td>'+escape(item.status)+'</td><td>'+escape(item.class_scope)+'</td><td>'+
          number(item.positive_feature_count)+'</td><td>'+number(item.source_feature_measure_sum)+' '+escape(item.measure_unit)+'</td><td>'+
          number(item.unique_geometry_measure)+' '+escape(item.measure_unit)+'</td></tr>').join('')+'</tbody></table></div>'+
        '<details><summary>Geography and crosswalk interpretation</summary><pre>'+escape(JSON.stringify({
          run_id:cw.run_id,analysis_crs:cw.analysis_crs,geography:cw.geography,source_scope:cw.scope,
          interpretation:cw.interpretation,unparsed_native_class_values:cw.unparsed_native_class_values
        },null,2))+'</pre></details>';
    }
    target.innerHTML=html+domainCoverageHtml();
  }
  function draw(){sourceControls();filterControls();drawSummary();drawInventories();drawRecord();drawTable();drawProvenance();}
  async function loadReview(){
    const serial=++loadSerial,requested=workspace;
    loadController?.abort();detailController?.abort();detailSerial++;resetNativeBrowser();
    if(!registryChoice){snapshot=null;working=false;draw();status('Import a complete legal registry, or choose a crosswalk containing its retained legal records.');return;}
    loadController=new AbortController();working=true;
    status('Reading the complete legal register and retained geometry associations…');
    try{
      const result=await api(endpoint('/api/water-source-review/review',query()),{signal:loadController.signal});
      if(serial!==loadSerial||workspace!==requested||!frame)return;
      snapshot=result;
      if(pendingOpen){
        if(pendingOpen.record_id){
          const item=result.records.find(row=>row.id===pendingOpen.record_id &&
            (!pendingOpen.edition_id||row.edition.id===pendingOpen.edition_id));
          if(item){filter=canonicalFilter();selectedRecord=recordKey(item);}
        }
        pendingOpen=null;
      }
      draw();status(result.counts.legal_rows+' complete legal rows loaded with their original descriptions and source identities.');
    }catch(error){if(serial===loadSerial&&error.name!=='AbortError')status(error.message||String(error),true);}
    finally{if(serial===loadSerial){working=false;drawNativeBrowser();}}
  }
  async function loadCatalog(){
    const serial=++loadSerial,requested=workspace;
    loadController?.abort();loadController=new AbortController();working=true;
    status('Reading imported source editions…');
    try{
      const result=await api(endpoint('/api/water-source-review/catalog'),{signal:loadController.signal});
      if(serial!==loadSerial||workspace!==requested||!frame)return;
      catalogue=result;
      const validRegistry=result.registries.some(row=>sourceKey(row)===registryChoice);
      if(!validRegistry)registryChoice=sourceKey(result.registries.find(row=>row.registry_origin==='standalone')||result.registries[0]||{collection_id:'',source_id:''});
      if(!result.registries.length)registryChoice='';
      if(crosswalkChoice&&!result.crosswalks.some(row=>sourceKey(row)===crosswalkChoice))crosswalkChoice='';
      if(!snapshot&&!crosswalkChoice&&result.crosswalks.length)crosswalkChoice=sourceKey(result.crosswalks[0]);
      sourceControls();await loadReview();
    }catch(error){if(serial===loadSerial&&error.name!=='AbortError')status(error.message||String(error),true);}
    finally{if(serial===loadSerial)working=false;}
  }
  function download(filename,content,type){
    const url=URL.createObjectURL(new Blob([content],{type}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function featureDetail(value){
    const actual=value.native_class,fields=new Map(value.native_fields.map(row=>[row.name,row]));
    return '<h3>Native feature '+escape(value.feature_id)+'</h3>'+
      '<p>Raw native class: '+escape(plain(actual.class_raw))+' · Resolved class: '+escape(actual.class_code||'Unparsed')+
      ' · Legal edition: '+escape(actual.legal_edition_status||actual.status||'')+
      ' · Publisher status: '+escape(actual.data_status||'Unspecified')+'</p><dl>'+classificationDetails(actual)+'</dl>'+
      (Object.hasOwn(value.native_attributes,'HYDTYPE')?'<p>Publisher linework type (HYDTYPE): '+escape(plain(value.native_attributes.HYDTYPE)||'Blank native value')+'</p>':'')+
      '<p>'+link(value.source_layer.url,'Original source layer')+' · Native identifier '+
      '<code>'+escape(value.source_feature_refs[0].field)+' = '+escape(plain(value.source_feature_refs[0].value))+'</code></p>'+
      '<div class="water-source-toolbar"><button type="button" data-water-action="feature-json">Export feature context</button>'+
      ((typeof host.onWaterSourceSelection==='function'||(selectionTarget&&typeof host.openExtension==='function'))&&value.source_imported?
        '<button type="button" data-water-action="open-designation">Open in designation desk</button>':'')+'</div>'+
      '<h4>Geographic intersections</h4><p>'+escape(geographyNames[value.geographic_status]||'Retained geographic intersections')+'</p><div class="water-source-table-wrap"><table><thead><tr><th>Region</th><th>Role</th><th>Measured intersection</th><th>Geometry status</th></tr></thead><tbody>'+
      value.intersections.map(row=>'<tr><td>'+escape(row.region_id)+'</td><td>'+escape(row.geography_role||row.region_kind)+'</td><td>'+
        (row.geometry_kind==='line'?number(row.intersection_length_m)+' m':number(row.intersection_area_ha)+' ha')+'</td><td>'+
        (row.counted?'Positive intersection':'Boundary touch')+'</td></tr>').join('')+'</tbody></table></div>'+
      '<details open><summary>Complete native attributes</summary><div class="water-source-table-wrap"><table><thead><tr><th>Original field</th><th>Publisher alias</th><th>Type</th><th>Original value</th></tr></thead><tbody>'+
      Object.entries(value.native_attributes).map(([key,item])=>'<tr><td><code>'+escape(key)+'</code></td><td>'+escape(fields.get(key)?.alias||'')+
        '</td><td>'+escape(fields.get(key)?.type||typeof item)+'</td><td>'+escape(item===null?'null':plain(item))+'</td></tr>').join('')+
      '</tbody></table></div></details><details><summary>Exact feature, source and association context</summary><pre>'+
      escape(JSON.stringify({source_feature_refs:value.source_feature_refs,source_layer:value.source_layer,
        legal_associations:value.legal_associations,map_sources:value.map_sources},null,2))+'</pre></details>';
  }
  async function inspectFeature(featureId){
    if(!snapshot||working)return;
    const target=node('[data-water-native-inspector]');if(!target)return;
    const section=node('[data-water-feature-section]');if(section)section.hidden=false;
    const serial=++detailSerial,requested=workspace;
    detailController?.abort();detailController=new AbortController();
    target.textContent='Reading the exact native feature and all retained intersections…';
    try{
      const value=await api(endpoint('/api/water-source-review/feature',{...query(),feature_id:featureId}),{signal:detailController.signal});
      if(serial!==detailSerial||workspace!==requested||!frame)return;
      featureSnapshot=value;target.innerHTML=featureDetail(value);
      section?.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){if(serial===detailSerial&&error.name!=='AbortError')target.textContent=error.message||String(error);}
  }
  async function act(action){
    if(action==='refresh')return loadCatalog();
    if(action==='load-native')return loadNativeFeatures();
    if(action==='native-previous'||action==='native-next'){
      nativeFilter.page+=action==='native-next'?1:-1;drawNativeBrowser();return;
    }
    if(action==='native-json'||action==='native-csv'||action==='native-designation'){
      if(!nativeCatalogue||nativeLoading)throw Error('Browse the captured features before selecting or exporting a cohort.');
      const matching=nativeRows();
      if(action==='native-csv')return download('water-source-native-features.csv',nativeFeaturesCsv(matching),'text/csv;charset=utf-8');
      if(action==='native-json')return download('water-source-native-inventory.json',
        JSON.stringify({...nativeCatalogue,records:matching,selection:{filters:{...nativeFilter},
          matching_count:matching.length,captured_count:nativeCatalogue.records.length}},null,2)+'\n','application/json');
      return host.openExtension('water-designations','openSelection',nativeCohortSelection(nativeCatalogue,matching,nativeFilter));
    }
    if(action==='previous'||action==='next'){filter.page+=action==='next'?1:-1;drawTable();return;}
    if(!snapshot||working)throw Error('Open the complete source register before exporting or selecting a feature.');
    if(action==='export-brief'){
      if(nativeLoading)throw Error('Wait for the complete native feature selection before preparing its briefing.');
      if(sourceKey(snapshot.registry_source)!==registryChoice ||
        (snapshot.crosswalk_source?sourceKey(snapshot.crosswalk_source):'')!==crosswalkChoice)
        throw Error('Refresh the selected source editions before preparing their briefing.');
      const selectedLegal=rows(),selectedNative=nativeCatalogue?nativeRows():[];
      const prepared=prepareWaterSourceBrief({snapshot,records:selectedLegal,filter,
        nativeCatalogue,nativeRecords:selectedNative,nativeFilter,
        legalCsv:recordsCsv(selectedLegal),nativeCsv:nativeCatalogue?nativeFeaturesCsv(selectedNative):'',
        title:node('[name="water-brief-title"]').value.trim()||'Classified-water source review'});
      download('water-source-brief.html',renderWaterSourceBrief(prepared),'text/html;charset=utf-8');
      status('Prepared '+prepared.payload.summary.legal_rows+' complete legal rows and '+
        prepared.payload.summary.native_features+' original native features in the portable briefing.');
      return;
    }
    if(action==='export-json')return download('water-source-review.json',
      JSON.stringify(reviewExport(snapshot,rows(),filter),null,2)+'\n','application/json');
    if(action==='export-csv')return download('water-source-review.csv',recordsCsv(rows()),'text/csv;charset=utf-8');
    if(action==='feature-json'&&featureSnapshot)return download('water-source-feature.json',
      JSON.stringify(featureSnapshot,null,2)+'\n','application/json');
    if(action==='open-designation'&&featureSnapshot){
      const request=getSelectionContext();
      if(typeof host.onWaterSourceSelection==='function')return host.onWaterSourceSelection(request);
      if(selectionTarget){
        const payload=selectionTarget.extension_id==='water-designations'&&selectionTarget.method==='openSelection'?
          designationSelection(request):request;
        return host.openExtension(selectionTarget.extension_id,selectionTarget.method,payload);
      }
      throw Error('Open the imported native feature in the connected designation desk.');
    }
  }
  function changed(event){
    const field=event.target,name=field.name;
    const nativeFields={'water-native-jurisdiction':'jurisdiction','water-native-component':'component',
      'water-native-query':'query','water-native-source':'source','water-native-class':'class_code',
      'water-native-type':'hydro_type','water-native-name':'name_status','water-native-county':'county',
      'water-native-geography':'geography','water-native-relation':'relation','water-native-huc':'huc12',
      'water-native-page-size':'pageSize'};
    if(nativeFields[name]){nativeFilter[nativeFields[name]]=field.value;nativeFilter.page=0;drawNativeBrowser();return;}
    if(name==='water-registry'){openSerial++;pendingOpen=null;registryChoice=field.value;selectedRecord='';filter.page=0;remember();loadReview();return;}
    if(name==='water-crosswalk'){openSerial++;pendingOpen=null;crosswalkChoice=field.value;remember();loadReview();return;}
    const fields={'water-jurisdiction':'jurisdiction','water-component':'component',
      'water-query':'query','water-class':'class_code','water-county':'county','water-edition':'edition',
      'water-relation':'relation','water-huc':'huc12','water-sort':'sort','water-page-size':'pageSize','water-priority':'priority'};
    if(fields[name]){filter[fields[name]]=name==='water-priority'?field.checked:field.value;filter.page=0;drawRecord();drawTable();}
  }
  function mount(container){
    const next=currentWorkspace();
    if(root===container&&frame?.isConnected&&workspace===next)return;
    const changedWorkspace=workspace!==next;
    detach();if(changedWorkspace){catalogue=null;snapshot=null;sourceFingerprint='';}
    root=container;workspace=next;restore();
    if(pendingOpen?.workspace_key && pendingOpen.workspace_key!==workspace){pendingOpen=null;openSerial++;}
    if(pendingOpen)applyOpenChoice(pendingOpen);
    frame=document.createElement('div');frame.className='water-source-review';frame.innerHTML=controls();root.replaceChildren(frame);
    frame.addEventListener('click',event=>{
      const target=event.target.closest('[data-water-action],[data-water-record-id],[data-water-feature]');
      if(!target)return;event.preventDefault();event.stopPropagation();
      if(target.dataset.waterRecordId){if(working)return;selectedRecord=target.dataset.waterRecordId;
        if(!rows().some(row=>recordKey(row)===selectedRecord)){filter=canonicalFilter();filterControls();}
        drawRecord();drawTable();return;}
      if(target.dataset.waterFeature){inspectFeature(target.dataset.waterFeature);return;}
      const action=target.dataset.waterAction;target.disabled=true;
      Promise.resolve(act(action)).catch(error=>status(error.message||String(error),true)).finally(()=>{
        if(target.isConnected){target.disabled=false;if(action==='previous'||action==='next')drawTable();if(action.startsWith('native-')||action==='load-native')drawNativeBrowser();}
      });
    });
    frame.addEventListener('change',changed);
    frame.addEventListener('input',event=>{
      if(event.target.name==='water-query'||event.target.name==='water-native-query'){
        clearTimeout(typingTimer);typingTimer=setTimeout(()=>changed(event),120);
      }
    });
    sourceFingerprint=sourceToken(getState());loadCatalog();
  }
  function update(state=getState()){
    if(currentWorkspace()!==workspace){detach();catalogue=null;snapshot=null;featureSnapshot=null;nativeCatalogue=null;return;}
    const next=sourceToken(state);
    if(frame&&next!==sourceFingerprint){sourceFingerprint=next;loadCatalog();}
  }
  function detach(){
    remember();loadSerial++;detailSerial++;loadController?.abort();detailController?.abort();clearTimeout(typingTimer);
    nativeSerial++;nativeController?.abort();nativeLoading=false;nativeCatalogue=null;
    root=null;frame=null;working=false;featureSnapshot=null;
  }
  function applyOpenChoice(selection){
    filter=canonicalFilter();
    registryChoice=JSON.stringify([selection.registry_collection,selection.registry_source]);
    crosswalkChoice=selection.crosswalk_collection&&selection.crosswalk_source?
      JSON.stringify([selection.crosswalk_collection,selection.crosswalk_source]):'';
  }
  async function openRecord(selection){
    if(!selection?.registry_collection||!selection?.registry_source||!selection?.record_id)
      throw Error('Choose the original imported registry collection, source and legal record.');
    if(selection.workspace_key&&selection.workspace_key!==currentWorkspace())
      throw Error('Open the workspace containing the selected legal source.');
    const requested=currentWorkspace(),intent=++openSerial;
    pendingOpen={...selection,workspace_key:requested};applyOpenChoice(pendingOpen);
    if(typeof host.navigate==='function')await host.navigate('water-source-review');
    if(intent!==openSerial||currentWorkspace()!==requested)return;
    if(frame&&workspace===requested)await loadReview();
    else if(typeof toast==='function')toast('Open Water source review to inspect the selected legal reach.');
  }
  async function openSource(selection){
    const collection=selection?.collection_id||selection?.source_collection_id;
    const source=selection?.source_id;
    if(typeof collection!=='string'||!collection||typeof source!=='string'||!source)
      throw Error('Choose the imported crosswalk collection and source.');
    const requested=currentWorkspace();
    if(!requested||selection.workspace_key&&selection.workspace_key!==requested)
      throw Error('Open the workspace containing the imported crosswalk.');
    const intent=++openSerial;
    pendingOpen={workspace_key:requested,registry_collection:collection,registry_source:source,
      crosswalk_collection:collection,crosswalk_source:source};
    selectedRecord='';nativeFilter=nativeFilterDefault();applyOpenChoice(pendingOpen);
    if(typeof host.navigate==='function')await host.navigate('water-source-review');
    if(intent!==openSerial||currentWorkspace()!==requested)return;
    if(!frame||workspace!==requested){
      if(typeof toast==='function')toast('Open Water source review to inspect the imported crosswalk.');
      return {workspace_key:requested,collection_id:collection,source_id:source};
    }
    await loadCatalog();
    if(intent!==openSerial||currentWorkspace()!==requested||workspace!==requested||!frame)return;
    const selected=snapshot?.crosswalk_source;
    if(selected?.collection_id!==collection||selected?.source_id!==source)
      throw Error('The selected crosswalk is not available in the current imported-source catalogue.');
    if(selection.load_native)await loadNativeFeatures();
    return {workspace_key:requested,collection_id:collection,source_id:source};
  }
  function setSelectionTarget(target){
    if(!target||!/^[a-z][a-z0-9-]*$/.test(target.extension_id||'')||!/^[A-Za-z_]\w*$/.test(target.method||''))
      throw Error('Provide the designation desk’s registered extension id and receiving method.');
    selectionTarget={extension_id:target.extension_id,method:target.method};
    const inspector=node('[data-water-native-inspector]');
    if(featureSnapshot&&inspector)inspector.innerHTML=featureDetail(featureSnapshot);
    return {...selectionTarget};
  }
  function getSelectionContext(){
    return featureSnapshot?{...featureSnapshot.selection_context,collection_id:featureSnapshot.collection_id,
      source_id:featureSnapshot.source_id,legal_record_context:featureSnapshot.legal_records,
      origin:'water-source-review'}:null;
  }
  function getDesignationSelection(){
    const context=getSelectionContext();
    return context?designationSelection(context):null;
  }
  return {mount,update,detach,openRecord,openSource,setSelectionTarget,getSelectionContext,getDesignationSelection};
}
