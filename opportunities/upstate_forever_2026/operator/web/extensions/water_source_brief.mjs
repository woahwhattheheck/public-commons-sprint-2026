/** Portable source-cohort briefing for the existing Water source review desk. */
const VERSION = '1.1.0';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const show = value => value == null ? '—' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : text(value);
const count = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US', {maximumFractionDigits:3}) : '—';
const legalKey = row => JSON.stringify([row.edition?.id, row.id]);
const jurisdiction = row => row.jurisdiction || (row.edition?.classification_system ? row.edition.jurisdiction : 'SC');
const system = row => row.classification_system || row.edition?.classification_system || 'SC-R61-69';
const nativeKey = row => JSON.stringify([row.collection_id, row.source_id, row.feature_id]);
const sourceKey = row => JSON.stringify([row.collection_id, row.source_id, row.sha256 || row.expected_source_sha256]);
const relation = value => ({
  coextensive:'Explicit coextensive geometry', partial:'Partial geometry association',
  candidate:'Candidate for reach review', 'outside-scope':'Outside positive geographic scope',
  unassociated:'No recorded legal association', 'crosswalk-unselected':'Geographic crosswalk not selected',
  positive:'Positive measured intersection', touch:'Boundary touch only', outside:'Outside loaded geography'
}[value] || value || 'Unspecified');
const portable = value => JSON.parse(JSON.stringify(value, (key, item) =>
  ['downloads','download_url','file_ticket','file_tickets'].includes(key) ? undefined : item));
const jsonText = value => JSON.stringify(value, null, 2) + '\n';
const scriptJson = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char =>
  '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
function exactSubset(original, selected, key, label) {
  if (!Array.isArray(original) || !Array.isArray(selected)) throw Error(label + ' needs complete source and selected rows.');
  const byKey = new Map();
  for (const row of original) {
    const id = key(row);
    if (byKey.has(id)) throw Error(label + ' repeats an original identity.');
    byKey.set(id, row);
  }
  const used = new Set();
  return selected.map(row => {
    const id = key(row), retained = byKey.get(id);
    if (!retained || used.has(id)) throw Error(label + ' contains an absent or repeated source identity.');
    if (JSON.stringify(row) !== JSON.stringify(retained)) throw Error(label + ' differs from the current reviewed source.');
    used.add(id); return retained;
  });
}
function totals(rows, field) {
  const result = new Map();
  for (const row of rows) {
    const value = typeof field === 'function' ? field(row) : row[field];
    const label = String(value ?? '').trim() || 'Blank native value';
    result.set(label, (result.get(label) || 0) + 1);
  }
  return [...result].sort((a,b) => a[0].localeCompare(b[0])).map(([label, rows]) => ({label, rows}));
}

/**
 * Freeze the complete selected rows, independent of either rendered page.
 * Source URLs and identities survive; authenticated operator download tickets do
 * not belong to a portable file. Existing CSV producers remain authoritative.
 */
export function prepareWaterSourceBrief({snapshot, records, filter = {}, nativeCatalogue = null,
    nativeRecords = [], nativeFilter = {}, legalCsv, nativeCsv = '', title = 'Classified-water source review',
    preparedAt = new Date().toISOString()}) {
  if (snapshot?.schema !== 'upstate.water-source-review/v1')
    throw Error('Open the current original water-source review before preparing a briefing.');
  if (typeof title !== 'string' || !title.trim() || typeof legalCsv !== 'string')
    throw Error('Give the briefing a title and its complete selected legal CSV.');
  if (!Number.isFinite(Date.parse(preparedAt))) throw Error('The briefing needs a preparation date.');
  const legal = exactSubset(snapshot.records, records, legalKey, 'Legal selection');
  let native = [];
  if (nativeCatalogue) {
    if (nativeCatalogue.schema !== 'upstate.water-source-feature-catalog/v1'
        || nativeCatalogue.workspace_key !== snapshot.workspace_key
        || !snapshot.crosswalk_source
        || sourceKey(nativeCatalogue.crosswalk_source) !== sourceKey(snapshot.crosswalk_source))
      throw Error('The native selection must come from the same original crosswalk and workspace.');
    if (typeof nativeCsv !== 'string') throw Error('Retain the complete selected native-feature CSV.');
    native = exactSubset(nativeCatalogue.records, nativeRecords, nativeKey, 'Native selection');
  } else if (nativeRecords.length) {
    throw Error('Read the original native catalogue before selecting its features.');
  }
  if (!legal.length && !native.length) throw Error('Choose at least one original legal row or captured native feature.');
  const selectedNativeIds = new Set(native.map(row => row.feature_id));
  const associations = (nativeCatalogue?.legal_associations || []).filter(row => selectedNativeIds.has(row.feature_id));
  const associatedLegal = (nativeCatalogue?.legal_records || []).filter(item =>
    associations.some(link => link.registry_record_id === item.record.id
      && (!link.registry_edition_id || link.registry_edition_id === item.edition.id)));
  const selectedSources = new Set(native.map(row => JSON.stringify([row.collection_id, row.source_id])));
  const sourceDescriptors = (nativeCatalogue?.sources || []).filter(row =>
    selectedSources.has(JSON.stringify([row.collection_id, row.source_id])));
  const payload = portable({
    schema:'upstate.water-source-brief/v1', producer_version:VERSION, title:title.trim(), prepared_at:preparedAt,
    workspace_key:snapshot.workspace_key,
    selection:{
      legal:{filter:{...filter}, source_count:snapshot.records.length, selected_count:legal.length,
        record_ids:legal.map(row => ({edition_id:row.edition.id, record_id:row.id}))},
      native:nativeCatalogue ? {filter:{...nativeFilter}, source_count:nativeCatalogue.records.length,
        selected_count:native.length, feature_ids:native.map(row =>
          ({collection_id:row.collection_id, source_id:row.source_id, feature_id:row.feature_id}))} : null
    },
    registry_source:snapshot.registry_source, crosswalk_source:snapshot.crosswalk_source,
    editions:snapshot.editions, source_counts:snapshot.counts,
    source_inventories:snapshot.source_inventories || [], domain_coverages:snapshot.domain_coverages || [],
    legal_records:legal, native_sources:sourceDescriptors, native_records:native,
    native_legal_associations:associations, native_associated_legal_records:associatedLegal,
    summary:{
      legal_rows:legal.length, literal_names:new Set(legal.map(row => row.waterbody_name)).size,
      priority_rows:legal.filter(row => row.rfp_high_quality_candidate === true).length,
      no_discharge_zone_rows:legal.filter(row => row.no_discharge_zone === true).length,
      legal_jurisdictions:totals(legal,jurisdiction), native_jurisdictions:totals(native,jurisdiction),
      legal_classes:totals(legal,row=>jurisdiction(row)+' · '+row.class_raw), legal_association_states:totals(legal,'association_status'),
      native_features:native.length, native_blank_names:native.filter(row => row.name_blank).length,
      native_blank_counties:native.filter(row => row.county_blank).length,
      native_classes:totals(native,row=>jurisdiction(row)+' · '+row.class_raw), native_linework_types:totals(native,'hydro_type_raw'),
      native_geographic_states:totals(native,'geographic_status')
    },
    interpretation:[
      'The legal register and captured-feature filters are two explicitly selected source cohorts. Their row counts are independent.',
      'Named aliases and split legal reaches keep their original record identities and complete descriptions.',
      'Legal edition status, publisher data status, native class and geometry association remain separate attributes.',
      'Class labels, compound components and priority predicates retain their own state jurisdiction and classification system. Identically spelled classes across states are not treated as equivalent.',
      'Candidate and partial associations keep their original qualifications. A shared name or HUC does not establish coextensive legal reach geometry.',
      'Publisher HUC12 attributes and positive measured WBD HUC12 intersections retain separate meanings.',
      'The complete crosswalk coverage table describes its original full geographic scope, not a new calculation for the filtered cohort. Its independent region/class rows are not summed.',
      'Classified linework includes original banks, shorelines, dams and closure lines as well as streams.',
      'The data downloads retain every selected row. Visible source-review pagination does not reduce this briefing.',
      ...(snapshot.interpretation || []), ...(nativeCatalogue?.interpretation || [])
    ]
  });
  return {payload, csv:{legal:legalCsv, native:nativeCatalogue ? nativeCsv : null}};
}
function href(value, label, suffix='') {
  if (typeof value !== 'string' || !/^https?:\/\/[^/\s?#@]+(?:[/?#][^\s]*)?$/i.test(value))
    return esc(label);
  const target = suffix ? value.replace(/#.*$/, '') + suffix : value;
  return '<a href="'+esc(target)+'" rel="noopener noreferrer">'+esc(label)+'</a>';
}
function table(headers, rows, className='') {
  return '<div class="scroll '+className+'"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(show(x))+'</td>').join('')+
    '</tr>').join('')+'</tbody></table></div>';
}
function countTable(title, values, label='Original value') {
  return values.length ? '<section><h3>'+esc(title)+'</h3>'+table([label,'Selected rows'],values.map(row=>[row.label,row.rows]))+'</section>' : '';
}
function descriptionList(rows) {
  return '<dl>'+rows.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(show(value))+'</dd></div>').join('')+'</dl>';
}
function sourceCard(source, label) {
  if (!source) return '';
  return '<article class="source-card"><h3>'+esc(label)+'</h3>'+descriptionList([
    ['Title',source.title],['Source entry',source.source_id],['Collection',source.collection_id],
    ['Source vintage',source.vintage],['Captured',source.captured_at],['Body SHA-256',source.sha256 || source.expected_source_sha256],
    ['Legal companion SHA-256',source.legal_body_sha256],['Publisher status',source.data_status],
    ['Original source bytes',source.bytes]
  ])+(source.uri ? '<p>'+href(source.uri,'Original source location')+'</p>' : '')+'</article>';
}
function legalCards(rows, prefix='reach') {
  return rows.map((row,index)=>{
    const edition = row.edition || {}, links=row.native_associations || [];
    return '<article class="reach" id="'+prefix+'-'+index+'"><h3>'+esc(row.waterbody_name)+'</h3>'+
      '<p class="identity">'+esc(edition.id)+' · '+esc(row.id)+'</p>'+
      '<p class="description">'+esc(row.reach_description)+'</p>'+
      descriptionList([['Jurisdiction',jurisdiction(row)],['Classification system',system(row)],
        ['Original class',row.class_raw],['Complete source class',row.class_code],
        ['Original components',(row.class_components||[]).join(', ')],['Primary class',row.primary_class],
        ['Supplemental classes',(row.supplemental_classes||[]).join(', ')],
        ['Special source markers',(row.special_markers||[]).join(', ')],
        ['Original source index',row.original_index],['Reach effective date',row.effective_date],
        ['Classification role',row.classification_role],
        ['Previous class',row.previous_class],['County codes',(row.county_codes||[]).join(', ')],
        ['Site-specific criteria',row.site_specific],['No-discharge-zone flag',row.no_discharge_zone],
        ['RFP priority-class row',row.rfp_high_quality_candidate],['Legal edition status',edition.status],
        ['Association status',relation(row.association_status)],['Positive associated WBD HUC12',(row.linked_huc12||[]).join(', ')] ])+
      '<p class="citation">'+href(edition.source_url,'Original '+(edition.regulation||'regulation'),row.source_pdf_page?'#page='+row.source_pdf_page:'')+
      ' · PDF page '+esc(row.source_pdf_page)+' · printed page '+esc(row.source_printed_page)+
      ' · original lines '+esc(row.source_line_start)+'–'+esc(row.source_line_end)+'</p>'+
      (links.length ? table(['Original feature','Association','Selected legal edition agrees','Native class','Publisher status','Positive WBD HUC12','Boundary-touch HUC12'],
        links.map(link=>[link.feature_id,relation(link.geometry_relation),link.record_version_matches,link.native_class_raw,
          link.data_status,(link.huc12||[]).join(', '),(link.touch_huc12||[]).join(', ')])) : '')+'</article>';
  }).join('');
}
function coverageSections(value) {
  const crosswalk=value.crosswalk_source;
  let out='<section id="coverage"><h2>Original source coverage</h2>';
  if (crosswalk) {
    out+='<p>The following measures come from the complete retained crosswalk. They retain their original region, class scope and units independently of this briefing’s filters.</p>'+
      descriptionList([['Crosswalk run',crosswalk.run_id],['Analysis CRS',crosswalk.analysis_crs],['Generated',crosswalk.generated_at]])+
      table(['Region','Edition/status','Class scope','Positive features','Feature measure sum','Dissolved unique measure','Unit'],
        (crosswalk.coverage_summary||[]).map(row=>[row.region_id,row.status,row.class_scope,row.positive_feature_count,
          row.source_feature_measure_sum,row.unique_geometry_measure,row.measure_unit]));
  }
  for(const item of value.source_inventories) {
    const profile=item.profile||{};
    out+='<article><h3>'+esc(item.source?.title||'Original captured-layer inventory')+'</h3>'+
      descriptionList([['Captured features',profile.feature_count],['Distinct source IDs',profile.distinct_native_id_count],
        ['Source capture date',profile.source_capture_date],['Publisher status',profile.data_status],
        ['Blank native names',profile.blank_name_count],['Blank native counties',profile.blank_county_count],
        ['Matches selected crosswalk source',item.matches_selected_crosswalk_source]])+
      '<details><summary>Original selection, field identity and complete attribute counts</summary><pre>'+esc(jsonText(profile))+'</pre></details></article>';
  }
  for (const item of value.domain_coverages) {
    out+='<details><summary>Retained whole-domain coverage comparison</summary><pre>'+esc(jsonText(item))+'</pre></details>';
  }
  if (!crosswalk && !value.source_inventories.length && !value.domain_coverages.length)
    out+='<p>The selected briefing contains the original legal register; its geographic source scope remains available when a retained crosswalk is selected.</p>';
  return out+'</section>';
}

/** A complete, standalone HTML document. No remote scripts, fonts or services. */
export function renderWaterSourceBrief(prepared) {
  if (prepared?.payload?.schema !== 'upstate.water-source-brief/v1' || typeof prepared.csv?.legal !== 'string')
    throw Error('Prepare the complete selected source briefing first.');
  const value=prepared.payload, summary=value.summary, native=value.native_records;
  const sections=[
    '<header><p class="eyebrow">Water source review</p><h1>'+esc(value.title)+'</h1>'+
      '<p>Prepared '+esc(value.prepared_at)+' from the retained source editions below.</p>'+
      '<div class="toolbar"><button type="button" data-print>Print / save PDF</button>'+
      '<button type="button" data-download="json">Complete briefing JSON</button>'+
      '<button type="button" data-download="legal">Selected legal rows CSV</button>'+
      (prepared.csv.native!==null?'<button type="button" data-download="native">Selected native features CSV</button>':'')+'</div>'+
      '<nav><a href="#selection">Selection</a><a href="#legal">Legal reaches</a><a href="#native">Captured features</a><a href="#coverage">Source coverage</a><a href="#sources">Sources</a></nav></header>',
    '<main><section id="selection"><h2>Selected source cohorts</h2><div class="metrics">'+[
      [summary.legal_rows,'legal rows'],[summary.literal_names,'literal waterbody names'],
      [summary.priority_rows,'priority-class rows'],[summary.native_features,'captured native features']
    ].map(([number,label])=>'<div><strong>'+count(number)+'</strong><span>'+esc(label)+'</span></div>').join('')+'</div>'+
    '<p>The legal register contributes '+count(summary.legal_rows)+' of '+count(value.selection.legal.source_count)+' rows.'+
    (value.selection.native?' The captured-feature selection contributes '+count(native.length)+' of '+count(value.selection.native.source_count)+' original features.':' The captured-feature browser was not included in this selection.')+'</p>'+
    '<details><summary>Exact filters and original selected identities</summary><pre>'+esc(jsonText(value.selection))+'</pre></details>'+
    '<div class="columns">'+countTable('Selected legal classes',summary.legal_classes)+
    countTable('Selected legal association states',summary.legal_association_states.map(row=>({...row,label:relation(row.label)})))+'</div>'+
    '<h3>How to read the source</h3><ul>'+[...new Set(value.interpretation)].map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul></section>',
    '<section id="legal"><h2>Complete selected legal reaches</h2>'+
    (value.legal_records.length?legalCards(value.legal_records):'<p>No legal register rows were selected. Associated legal records for the native cohort remain in its complete source data.</p>')+'</section>',
    '<section id="native"><h2>Selected captured features</h2>'+
    (value.selection.native?'<p>'+count(native.length)+' original features; '+count(summary.native_blank_names)+' have blank names and '+
      count(summary.native_blank_counties)+' have blank native county attributes.</p><div class="columns">'+
      countTable('Native classes',summary.native_classes)+countTable('Publisher linework types',summary.native_linework_types)+
      countTable('Measured geographic relationship',summary.native_geographic_states.map(row=>({...row,label:relation(row.label)})))+'</div>'+
      '<p>The complete native inventory is in the CSV and JSON downloads. Open the appendix to read or include all selected rows in print.</p>'+
      '<details class="native-appendix"><summary>Complete native-feature appendix ('+count(native.length)+' rows)</summary>'+
      table(['Source entry / original feature','Native identifier','Jurisdiction / system','Name','County codes','Native class','Components / markers','Original index / effective date','Publisher type','Publisher status','Geographic relationship','Publisher HUC12','Positive WBD HUC12','Legal association'],
        native.map(row=>[row.source_id+' / '+row.feature_id,row.id_field+' = '+text(row.object_id),jurisdiction(row)+' / '+system(row),
          row.name_blank?'Blank native name':row.waterbody_name,(row.county_codes||[]).join(', '),row.class_raw,
          (row.class_components||[]).join('; ')+' / '+(row.special_markers||[]).join(' '),
          text(row.original_index)+' / '+text(row.effective_date??row.native_effective_date),row.hydro_type_raw,row.data_status,relation(row.geographic_status),row.publisher_huc12,
          (row.positive_huc12||[]).join(', '),(row.association_relations||[]).map(relation).join('; ')]))+'</details>'+
      (value.native_associated_legal_records.length?'<details><summary>Complete original legal context associated with the native cohort</summary>'+
       '<p>These are the crosswalk’s original association records. Its edition may differ from a separately selected legal register.</p>'+
       legalCards(value.native_associated_legal_records.map(item=>({...item.record,edition:item.edition})), 'associated-reach')+'</details>':''):
      '<p>No captured-feature selection was included. The legal cohort retains its existing source associations.</p>')+'</section>',
    coverageSections(value),
    '<section id="sources"><h2>Source editions and original identity</h2>'+sourceCard(value.registry_source,'Selected legal register')+
      sourceCard(value.crosswalk_source,'Selected geographic crosswalk')+
      value.native_sources.map(source=>sourceCard(source,'Selected original captured layer')).join('')+
      '<h3>Original legal editions</h3>'+value.editions.map(edition=>'<article><h4>'+esc(edition.regulation)+' · '+esc(edition.status)+'</h4>'+
        descriptionList([['Edition ID',edition.id],['Jurisdiction',edition.jurisdiction||'South Carolina'],
          ['Classification system',edition.classification_system||'SC-R61-69'],['State publication',edition.state_publication_date],
          ['CWA effective date',edition.cwa_effective_date],['Source checked',edition.checked_at]])+
        '<p>'+href(edition.source_url,'Original regulation')+' · '+href(edition.effective_source_url,'Edition effective-date source')+'</p></article>').join('')+
      '<details><summary>Complete portable source-cohort record</summary><pre>'+esc(jsonText(value))+'</pre></details>'+
      '<p>The portable briefing retains its original source identities and selected source rows. Authenticated operator file tickets remain in the live source desk.</p></section></main>'
  ];
  const css=':root{color-scheme:light}*{box-sizing:border-box}body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff;max-width:1200px;margin:0 auto;padding:32px}h1,h2,h3,h4{line-height:1.25}h1{font-size:32px}h2{font-size:23px;margin-top:34px;border-bottom:2px solid #333;padding-bottom:8px}h3{font-size:18px}a{color:inherit}header{border-bottom:1px solid #aaa;padding-bottom:18px}.eyebrow,.identity,.citation{font-size:12px;overflow-wrap:anywhere}.eyebrow{text-transform:uppercase;letter-spacing:.08em}.toolbar,nav{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}button{background:#fff;color:#202020;border:1px solid #777;border-radius:3px;padding:9px 14px;font:inherit;cursor:pointer}.metrics,.columns{display:flex;gap:22px;flex-wrap:wrap}.metrics>div{border:1px solid #aaa;padding:14px 20px;min-width:155px}.metrics strong{display:block;font-size:30px}.metrics span{display:block;font-size:13px}.columns>section{flex:1;min-width:230px}.reach,.source-card{border:1px solid #bbb;padding:16px;margin:18px 0}.description{white-space:pre-wrap;font-size:16px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px;margin:12px 0}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px 18px}dl>div{min-width:0}dt{font-size:12px;color:#555}dd{margin:0;overflow-wrap:anywhere}details{border-top:1px solid #ccc;padding:12px 0}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.4 ui-monospace,monospace;max-height:600px;overflow:auto}li{margin:6px 0}@page{margin:16mm}@media print{body{max-width:none;padding:0;font-size:10pt}.toolbar,nav{display:none}.metrics strong{font-size:20pt}h2{break-after:avoid}h3{break-after:avoid}.reach,.source-card{break-inside:avoid}.scroll{overflow:visible}table{font-size:8pt}tr{break-inside:avoid}thead{display:table-header-group}details:not([open])>:not(summary){display:none}pre{max-height:none;overflow:visible}.native-appendix:not([open]){display:none}a{overflow-wrap:anywhere}}';
  const script=String.raw`(()=>{'use strict';const value=JSON.parse(document.getElementById('water-brief-data').textContent);document.querySelector('[data-print]').addEventListener('click',()=>window.print());for(const button of document.querySelectorAll('[data-download]'))button.addEventListener('click',()=>{const key=button.dataset.download;const body=key==='json'?JSON.stringify(value.payload,null,2)+'\n':value.csv[key];if(typeof body!=='string')return;const blob=new Blob([body],{type:key==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=key==='json'?'water-source-brief.json':key==='legal'?'water-source-legal-rows.csv':'water-source-native-features.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);});})();`;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
    esc(value.title)+'</title><style>'+css+'</style></head><body>'+sections.join('')+
    '<script type="application/json" id="water-brief-data">'+scriptJson(prepared)+'</script><script>'+script+'</script></body></html>';
}
