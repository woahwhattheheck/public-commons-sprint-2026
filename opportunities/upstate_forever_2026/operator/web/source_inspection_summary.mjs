/** Read-only meaning of existing source records. No requests, edits or inferred science. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arr=value=>Array.isArray(value)?value:[];
const present=value=>value!==undefined&&value!==null&&value!=='';
const text=value=>!present(value)?'Not supplied':Array.isArray(value)?value.map(text).join(', '):typeof value==='object'?JSON.stringify(value):String(value);
const name=value=>value?.title||value?.metadata?.title||value?.name||'Untitled saved source';
const fields=rows=>'<dl class="scientific-fields">'+rows.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(text(value))+'</dd>').join('')+'</dl>';
const note=value=>present(value)?'<p class="scientific-note">'+esc(text(value))+'</p>':'';
const section=(title,body)=>'<section class="scientific-section"><h2>'+esc(title)+'</h2>'+body+'</section>';
const roles={BIOPHYSICAL:'Biophysical parameter table',PRECIPITATION:'Precipitation',ORIGINAL_CLIENT_FILE:'Preserved original file',CLIENT_SOURCE_SELECTION:'Saved source choices',SOURCE_MANIFEST:'Original source definition'};
const parameters={flow_dir_algorithm:'Flow-routing algorithm',ic_0_param:'Connectivity-index midpoint',k_param:'Connectivity shape parameter k',l_max:'Maximum L factor (dimensionless)',sdr_max:'Maximum sediment delivery ratio',threshold_flow_accumulation:'Stream-initiation threshold (cells)'};
export const SOURCE_INSPECTION_SUMMARY_CSS='.source-summary-scroll{max-width:100%;overflow:auto;margin:12px 0;border:1px solid #cbd2d8}.source-summary-scroll:focus-visible{outline:3px solid #6b8ba0}.source-summary-table{border-collapse:collapse;width:100%;font-size:13px}.source-summary-table th,.source-summary-table td{text-align:left;vertical-align:top;padding:9px 12px;border-bottom:1px solid #e2e6e9;white-space:nowrap}.source-summary-table th{background:#f3f5f6;font-weight:600}.source-summary-table caption{text-align:left;padding:10px 12px;color:#435361}';
function originalCell(value,index,cells){
 if(index>=cells.length)return '<span class="scientific-empty">Absent cell</span>';
 if(value===null||value==='')return '<span class="scientific-empty">Blank cell</span>';
 return esc(typeof value==='object'?JSON.stringify(value):String(value));
}
function sampleTable(record){
 const columns=arr(record.columns),nativeRows=arr(record.sample_records),rows=arr(record.sample);
 if((!nativeRows.length&&!rows.length)||!columns.length)return '';
 const physical=nativeRows.length>0||arr(record.sample_row_numbers).length>0;
 const shown=nativeRows.length||rows.length;
 const ending=record.more_rows===true?' More original rows follow this retained preview.':record.more_rows===false?' This retained preview contains all data rows.':'';
 const body=(nativeRows.length?nativeRows:rows).map((row,index)=>{
  const cells=nativeRows.length?arr(row.cells):null;
  const number=nativeRows.length?row.row:record.sample_row_numbers?.[index];
  return '<tr>'+(physical?'<th scope="row">'+esc(number??'Not recorded')+'</th>':'')+
   columns.map((column,i)=>'<td>'+(cells?originalCell(cells[i],i,cells):Object.prototype.hasOwnProperty.call(row,column)?originalCell(row[column],0,[row[column]]):'<span class="scientific-empty">Absent cell</span>')+'</td>').join('')+'</tr>';
 }).join('');
 let html=section('Saved table preview','<p>Original values, without conversion. '+shown+' rows are shown.'+esc(ending)+'</p><div class="source-summary-scroll" tabindex="0" role="region" aria-label="Saved table values; scroll for more columns"><table class="source-summary-table"><caption>Use horizontal scroll to see every column.</caption><thead><tr>'+(physical?'<th scope="col">Original row</th>':'')+columns.map(c=>'<th scope="col">'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>');
 const preamble=arr(record.original_preamble);
 if(preamble.length)html+='<details class="scientific-group"><summary>Original rows before the selected header</summary><div class="source-summary-scroll" tabindex="0" role="region" aria-label="Original worksheet rows before the header"><table class="source-summary-table"><thead><tr><th scope="col">Original row</th>'+Array.from({length:Math.max(...preamble.map(row=>arr(row.cells).length))},(_,i)=>'<th scope="col">Original column '+(i+1)+'</th>').join('')+'</tr></thead><tbody>'+preamble.map(row=>'<tr><th scope="row">'+esc(row.row)+'</th>'+arr(row.cells).map((value,i)=>'<td>'+originalCell(value,i,row.cells)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details>';
 return html;
}
function collectionsFor(source,record,data){
 const explicit=record.source_collection_id||source.source_collection_id;
 const sources=arr(data?.sources);
 if(explicit)return sources.filter(x=>x.id===explicit);
 const matches=sources.filter(c=>arr(c.entries).some(e=>e.id===source.id&&(!source.body?.sha256||e.body?.sha256===source.body.sha256)));
 return matches;
}
function selectedField(value){
 if(!present(value))return 'Not selected';
 const match=/^c(\d+)$/.exec(String(value));
 return match?'Original column '+(Number(match[1])+1)+' ('+value+')':value;
}
function period(source,selection){
 if(present(selection.period))return selection.period;
 const support=source.temporal_support;
 if(support?.start&&support?.end)return support.start+' to '+support.end+' (exclusive end)';
 return 'Not supplied';
}
function choices(source){
 const selection=source.client_source?.selection||{},projection=source.field_projection||{};
 const rows=[['Saved role',roles[source.role]||source.role],['Declared units',selection.units||source.units],['Selected period',period(source,selection)]];
 if(source.client_source){
  rows.push(['Identifier column',selectedField(selection.identifier_field)],['Label column',selectedField(selection.label_field)],['Review status',selection.intake_status],['Source selection confirmed',present(selection.confirmed)?(selection.confirmed?'Yes':'No'):'Not supplied']);
 }
 if(present(selection.timezone))rows.push(['Declared time zone',selection.timezone]);
 if(source.role==='BIOPHYSICAL'&&arr(selection.models).length)rows.push(['Selected native models',selection.models]);
 let html=fields(rows);
 const mapping=projection.mapping||selection.mapping;
 if(mapping&&Object.keys(mapping).length)html+='<details class="scientific-group"><summary>Saved column mapping</summary>'+fields(Object.entries(mapping).map(([key,value])=>[key,selectedField(value)]))+'</details>';
 const notes=[source.use,selection.notes,source.notes].flat().filter(present);
 for(const n of new Set(notes.map(text)))html+=note(n);
 return html;
}
function profilesFor(source,collection,data){
 if(!collection?.id)return '';
 const profiles=arr(data?.profiles).filter(p=>p.source_collection_id===collection.id&&p.biophysical_source_id===source.id&&(!source.body?.sha256||p.table_summary?.sha256===source.body.sha256||p.profile_edition?.original_table?.sha256===source.body.sha256));
 if(!profiles.length)return '';
 return section('Saved scientific settings',profiles.map(p=>'<h3>'+esc(name(p))+'</h3>'+fields([['Profile source collection',name(collection)],['Profile status',p.scientific_status||p.status],['Native models',p.models],['Model period',p.model_period]])+arr(p.models).map(model=>{
  const values=p[model];
  return values&&typeof values==='object'?'<h4>'+esc(String(model).toUpperCase())+' settings</h4>'+fields(Object.entries(values).map(([key,value])=>[parameters[key]||key,value])):'';
 }).join('')+arr(p.notes).map(note).join('')).join(''));
}
function sourceSummary(record,data){
 const source=record.source,projection=source.field_projection||{},selection=source.client_source?.selection||{};
 const collections=collectionsFor(source,record,data),kind=source.kind;
 let rows=[['Source',name(source)],['Source type',kind]];
 if(collections.length)rows.push([collections.length===1?'Saved collection':'Collections retaining this source',collections.map(name)]);
 if(source.client_source?.filename)rows.push(['Original workbook / file',source.client_source.filename]);
 if(record.original_worksheet||projection.original_sheet||source.client_source?.part_name)rows.push(['Selected worksheet',record.original_worksheet||projection.original_sheet||source.client_source.part_name]);
 const header=record.original_header_row??projection.original_header_row;
 if(present(header))rows.push(['Original header row',header]);
 if(present(record.source_format))rows.push(['Original file format',record.source_format]);
 if(kind==='table'){
  if(present(projection.row_count))rows.push(['Rows in saved table',projection.row_count]);
  else rows.push(['Total table rows','Not recorded in this preview']);
  const columns=arr(record.columns).length?record.columns:arr(projection.columns);
  if(columns.length)rows.push(['Columns in saved table',columns.length],['Saved column names',columns]);
  if(Array.isArray(record.sample))rows.push(['Rows shown in this preview',record.sample.length]);
 }else if(kind==='raster'){
  for(const [key,label] of [['width','Grid columns'],['height','Grid rows'],['count','Bands'],['crs','Coordinate reference system'],['nodata','No-data value']])if(present(record[key]))rows.push([label,record[key]]);
  if(present(record.native_resolution_m))rows.push(['Native cell size (m)',record.native_resolution_m]);
  else if(Array.isArray(record.resolution))rows.push(['Native cell steps (coordinate units)',record.resolution]);
 }else if(kind==='vector'){
  for(const [key,label] of [['selected_layer','Selected layer'],['feature_count','Features'],['geometry_type','Geometry'],['crs','Coordinate reference system']])if(present(record[key]))rows.push([label,record[key]]);
  if(record.fields)rows.push(['Original fields',Object.keys(record.fields)]);
 }
 let html=section('What this source contains',fields(rows));
 if(kind==='table'&&projection.original_sheet)html+=note('Counts describe the saved model table. The original worksheet may contain additional columns, headings and notes; the preserved workbook and intake report retain those.');
 html+=section('Saved meaning and choices',choices(source));
 const options=record.reading_options;
 if(options&&typeof options==='object'){
  const optionLabels={header_row:'Selected header row',formula_mode:'Formula reading choice',encoding:'Text encoding',delimiter:'Column separator'};
  html+=section('Retained reading choices',fields(Object.entries(options).filter(([key])=>key==='formula_mode'?/^(xlsx|xlsm)$/i.test(String(record.source_format||'')):['encoding','delimiter'].includes(key)?/^(csv|tsv)$/i.test(String(record.source_format||'')):true).map(([key,value])=>[optionLabels[key]||key,value])));
 }
 if(kind==='table')html+=sampleTable(record);
 if(kind==='raster'){
  const interpretation=source.lineage?.native_model_interpretation;
  if(present(interpretation))html+=section('How the selected model uses this source',note(interpretation));
 }
 html+=collections.map(collection=>profilesFor(source,collection,data)).join('');
 const missing=[];
 if(!present(selection.units||source.units))missing.push('Declare the source units before quantitative use.');
 if(period(source,selection)==='Not supplied')missing.push('Review the intended source period; none is saved here.');
 if(source.client_source&&!present(selection.identifier_field))missing.push('No general identifier column was selected. The saved model-column mapping remains separate.');
 if(source.client_source&&!present(selection.label_field))missing.push('No display-label column was selected.');
 if(missing.length)html+=section('Choices still to review',missing.map(note).join(''));
 return html;
}
function collectionSummary(record,data){
 const entries=arr(record.entries),tables=entries.filter(s=>s.field_projection?.original_sheet);
 let html=section('What this collection contains',fields([['Collection',name(record)],['Saved sources',entries.length],['Saved worksheet tables',tables.length]])+note(tables.length?'These are the worksheet selections saved in this collection. Other sheets remain in the original workbook and its intake report.':record.scope?.purpose));
 for(const source of entries){
  const projection=source.field_projection||{};
  let rows=[['Source type',source.kind]];
  if(projection.original_sheet)rows.push(['Original worksheet',projection.original_sheet],['Original header row',projection.original_header_row],['Rows in saved table',projection.row_count],['Columns in saved table',arr(projection.columns).length]);
  if(source.body?.filename)rows.push(['Saved filename',source.body.filename]);
  html+=section(name(source),fields(rows)+choices(source));
  html+=profilesFor(source,record,data);
 }
 return html;
}
/** Empty string preserves existing rendering for records outside this module's scope. */
export function renderSourceInspectionSummary(record,{data={},kind=''}={}){
 if(!record||typeof record!=='object')return '';
 if(kind==='source-info'&&record.source)return sourceSummary(record,data);
 if((kind==='sources'||kind==='source-collection'||record.schema==='upstate.sources/v1')&&Array.isArray(record.entries))return collectionSummary(record,data);
 return '';
}
