// MIT. Analyst files, reviewed dispatch files and complete printable handoffs.
import { canonical, copy, digest, fail, object, parseJson, MAX_SOURCE_BYTES, MAX_ROWS } from './shared.mjs';
import { FILE_COLUMNS, columnText, numericCoordinate, normalizeGeometry, flatRow } from './fields.mjs';
import { ANALYST_SCHEMA, DISPATCH_SCHEMA } from './domain.mjs';
import { readGeoPackage, writeGeoPackage } from './geopackage.mjs';

const CSV_MARKER='open311_csv_encoding', CSV_ENCODING='apostrophe-v1';
const formula = value => /^[ \t\r\n]*[=+\-@]/.test(value);
const protect = value => formula(value)||value.startsWith("'")?"'"+value:value;
const unprotect = value => value.startsWith("'")&&(value.slice(1).startsWith("'")||formula(value.slice(1)))?value.slice(1):value;
export function csvEncode(columns, rows, { protectCells=true }={}) {
  if(!Array.isArray(columns)||new Set(columns).size!==columns.length||protectCells&&columns.includes(CSV_MARKER))fail('INVALID_CSV_COLUMNS','Choose distinct CSV columns; open311_csv_encoding is reserved for the declared reversible cell encoding.');
  const escape=value=>'"'+String(value).replace(/"/g,'""')+'"';
  const headers=protectCells?[...columns,CSV_MARKER]:columns;
  return [headers.map(escape).join(','),...rows.map(row=>[...columns.map(key=>{
    const value=columnText(row[key]);return protectCells?protect(value):value;
  }),...(protectCells?[CSV_ENCODING]:[])].map(escape).join(','))].join('\r\n')+'\r\n';
}
export function csvDecode(originalText) {
  const value=originalText.charCodeAt(0)===0xFEFF?originalText.slice(1):originalText;
  const records=[];let row=[],cell='',quoted=false,closed=false,index=0;
  const field=()=>{row.push(cell);cell='';closed=false;};
  const record=()=>{field();records.push(row);row=[];};
  while(index<value.length){
    const c=value[index++];
    if(quoted){if(c==='"'){if(value[index]==='"'){cell+='"';index++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)fail('INVALID_CSV','A CSV quote appears outside a quoted field.');quoted=true;continue;}
    if(c===','){field();continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&value[index]==='\n')index++;record();if(records.length>MAX_ROWS+1)fail('RETURN_ROW_LIMIT','The CSV exceeds 100,000 rows.',413);continue;}
    if(closed)fail('INVALID_CSV','Unexpected text follows a quoted CSV field.');
    cell+=c;
  }
  if(quoted)fail('INVALID_CSV','A quoted CSV field is incomplete.');
  if(cell||closed||row.length)record();
  if(!records.length)fail('INVALID_CSV','The CSV needs a complete header row.');
  const headers=records.shift();
  if(headers.some(key=>!key)||new Set(headers).size!==headers.length)fail('INVALID_CSV_HEADER','CSV columns must have distinct nonempty names.');
  const encoded=headers.includes(CSV_MARKER);
  return records.map((values,i)=>{
    if(values.length!==headers.length)fail('INVALID_CSV_ROW','CSV row '+(i+2)+' has a different number of columns.');
    const row=Object.fromEntries(headers.map((key,n)=>[key,values[n]]));
    if(encoded&&row[CSV_MARKER]!==CSV_ENCODING)fail('INVALID_CSV_ENCODING','Keep the declared CSV encoding on each row.');
    if(encoded)for(const key of headers)if(key!==CSV_MARKER)row[key]=unprotect(row[key]);
    return row;
  });
}
function utf8(bytes) {
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch{fail('INVALID_UTF8','The complete analyst text file is not valid UTF-8.');}
}
function rowGeometry(value) {
  try{return {geometry:normalizeGeometry(value)};}
  catch(error){if(error.status!==400)throw error;return {geometry:null,problem:{code:error.code,message:error.message}};}
}
function coordinates(properties) {
  if(!Object.hasOwn(properties,'longitude')||!Object.hasOwn(properties,'latitude'))return {geometry:null,problem:{code:'GEOMETRY_COLUMNS_MISSING',message:'Keep longitude and latitude columns, including empty cells for NULL geometry.'}};
  const lon=properties.longitude,lat=properties.latitude;
  if(columnText(lon).trim()===''&&columnText(lat).trim()==='')return {geometry:null};
  const x=numericCoordinate(lon),y=numericCoordinate(lat);
  if(x===null||y===null)return {geometry:null,problem:{code:'INVALID_GEOMETRY',message:'Use both numeric WGS84 coordinates or two empty cells.'}};
  return rowGeometry({type:'Point',coordinates:[x,y]});
}
export function decodeAnalystFile(bytes,format,options={}) {
  bytes=Buffer.from(bytes);
  if(bytes.length>MAX_SOURCE_BYTES)fail('RETURN_SIZE','An analyst file may contain at most 128 MiB.',413);
  if(format==='gpkg')return readGeoPackage(bytes,options);
  const text=utf8(bytes);
  if(format==='csv')return {metadata:null,problems:[],rows:csvDecode(text).map((properties,index)=>({rowNumber:index+2,properties,...coordinates(properties)}))};
  if(!['geojson','json'].includes(format))fail('INVALID_RETURN_FORMAT','Choose gpkg, geojson, csv or json.');
  const input=object(parseJson(text,'Analyst file'),'Analyst file');
  if(format==='json'){
    if(input.schema!==ANALYST_SCHEMA||!Array.isArray(input.rows))fail('INVALID_ANALYST_JSON','Use a complete GIS analyst JSON handoff.');
    if(input.rows.length>MAX_ROWS)fail('RETURN_ROW_LIMIT','The JSON exceeds 100,000 rows.',413);
    return {metadata:{handoffId:input.handoffId,handoffSha256:input.handoffSha256},problems:[],rows:input.rows.map((value,index)=>{
      if(!value||typeof value!=='object'||Array.isArray(value))return {rowNumber:index+1,properties:{},geometry:null,problem:{code:'INVALID_ANALYST_ROW',message:'Each analyst row must be an object.'}};
      const {geometry,...properties}=value;return {rowNumber:index+1,properties,...rowGeometry(geometry)};
    })};
  }
  if(input.type!=='FeatureCollection'||!Array.isArray(input.features)||input.crs!==undefined)fail('INVALID_GEOJSON','Use an RFC 7946 WGS84 FeatureCollection without a separate CRS member.');
  if(input.features.length>MAX_ROWS)fail('RETURN_ROW_LIMIT','The GeoJSON exceeds 100,000 features.',413);
  const metadata=input.open311?.handoffId?{handoffId:input.open311.handoffId,handoffSha256:input.open311.handoffSha256}:null;
  return {metadata,problems:[],rows:input.features.map((feature,index)=>{
    if(!feature||feature.type!=='Feature'||!feature.properties||typeof feature.properties!=='object'||Array.isArray(feature.properties))return {rowNumber:index+1,properties:{},geometry:null,problem:{code:'INVALID_GEOJSON_FEATURE',message:'Each feature needs its original properties object.'}};
    return {rowNumber:index+1,properties:feature.properties,...rowGeometry(feature.geometry)};
  })};
}
const sourceMetadata=sources=>sources.map(source=>({id:source.id,name:source.name,kind:source.kind,sha256:source.sha256,bytes:source.bytes,reportId:source.reportId,connections:copy(source.connections)}));
const binding=asset=>asset.schema===DISPATCH_SCHEMA?{id:asset.handoffId,sha256:asset.handoffSha256}:asset;
export function analystJson(asset,sources) {
  const handoff=binding(asset);
  if(asset.schema===DISPATCH_SCHEMA)return {...copy(asset),sources:sourceMetadata(sources)};
  return {schema:ANALYST_SCHEMA,handoffId:handoff.id,handoffSha256:handoff.sha256,name:asset.name,createdAt:asset.createdAt,
    coordinateReferenceSystem:'WGS 84 longitude, latitude (RFC 7946)',sources:sourceMetadata(sources),coverage:copy(asset.coverage),
    editableFields:['geometry','assigned_team','asset_id','work_order_id','priority','action','due_date','analyst_note'],
    rows:asset.rows.map(row=>({...flatRow(handoff,row),geometry:copy(row.geometry)}))};
}
export function geoJson(asset,sources) {
  const handoff=binding(asset),features=asset.rows.map(row=>({type:'Feature',id:row.key,geometry:copy(row.geometry),properties:flatRow(handoff,row)}));
  const points=asset.rows.filter(row=>row.geometry).map(row=>row.geometry.coordinates);
  const result={type:'FeatureCollection',open311:{schema:'commons.open311.gis-geojson.v1',handoffId:handoff.id,handoffSha256:handoff.sha256,
    ...(asset.schema===DISPATCH_SCHEMA?{dispatchId:asset.id,dispatchSha256:asset.sha256,destination:asset.destination}:{}),
    name:asset.name,sources:sourceMetadata(sources),coverage:copy(asset.coverage)},features};
  if(points.length)result.bbox=points.reduce((box,[x,y])=>[Math.min(box[0],x),Math.min(box[1],y),Math.max(box[2],x),Math.max(box[3],y)],[180,90,-180,-90]);
  return result;
}
function dispatchValue(row,field) {
  if(field==='longitude')return row.geometry?.coordinates[0]??'';
  if(field==='latitude')return row.geometry?.coordinates[1]??'';
  return Object.hasOwn(row.operator,field)?row.operator[field]:row[field];
}
export function assetCsv(asset) {
  const handoff=binding(asset);
  if(asset.schema===DISPATCH_SCHEMA){
    const identity=['feature_key','source_sha256','handoff_id','handoff_sha256'],columns=[...identity,...asset.definition.columns.map(column=>column.name)];
    return csvEncode(columns,asset.rows.map(row=>({
      feature_key:row.key,source_sha256:row.sourceSha256,handoff_id:handoff.id,handoff_sha256:handoff.sha256,
      ...Object.fromEntries(asset.definition.columns.map(column=>[column.name,dispatchValue(row,column.field)]))
    })));
  }
  return csvEncode([...FILE_COLUMNS,'longitude','latitude'],asset.rows.map(row=>({
    ...flatRow(handoff,row),longitude:row.geometry?.coordinates[0]??'',latitude:row.geometry?.coordinates[1]??''
  })));
}
const escape=value=>columnText(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function assetHtml(asset,sources) {
  const isDispatch=asset.schema===DISPATCH_SCHEMA,kind=isDispatch?'Reviewed dispatch':'GIS analyst handoff',handoff=binding(asset);
  const coverage=asset.coverage.map(value=>'<section><h3>'+escape(value.connection?.name??value.collectionId??'Original source selection')+'</h3><pre>'+escape(JSON.stringify(value,null,2))+'</pre></section>').join('');
  const rows=asset.rows.map(row=>'<tr><td>'+escape(row.serviceRequestId)+'<br><small>'+escape(row.key)+'</small></td><td>'+escape(row.sourceStatus)+'<br>'+escape(row.serviceName)+'<br>'+escape(row.address)+'</td><td>'+escape(row.geometry?row.geometry.coordinates.join(', '):'NULL')+'<br><small>'+escape(row.geometryOrigin??'source')+'</small></td><td>'+escape(row.operator.assignedTeam)+'<br>'+escape(row.operator.assetId)+'<br>'+escape(row.operator.workOrderId)+'</td><td>'+escape(row.operator.action)+' / '+escape(row.operator.priority)+'<br>'+escape(row.operator.dueDate)+'</td><td>'+escape(row.operator.note)+'<br><small>Decision '+escape(row.lastDecisionId??'unreviewed')+'</small></td></tr>').join('');
  const originals=asset.rows.map(row=>'<details><summary>'+escape(row.serviceRequestId)+' — source '+escape(row.sourceSha256)+'</summary><p>'+escape(row.description)+'</p><dl><dt>Original status notes</dt><dd>'+escape(row.sourceStatusNotes)+'</dd><dt>Original case-closure time</dt><dd>'+escape(row.sourceClosedAt??'Unavailable in this source selection')+'</dd><dt>Original observed time</dt><dd>'+escape(row.observedAt)+'</dd><dt>Original capture</dt><dd>'+escape(row.captureId)+'</dd><dt>Original geometry</dt><dd>'+escape(row.originalGeometry)+'</dd></dl><pre>'+escape(JSON.stringify(row.source,null,2))+'</pre></details>').join('');
  const credits=sources.map(source=>'<li>'+escape(source.name)+' — '+escape(source.sha256)+source.connections.map(c=>'<p>'+escape(c.baseUrl)+' '+escape(c.jurisdictionId)+'<br>'+escape(c.attribution?.publisher??'')+' '+escape(c.attribution?.title??'')+' '+escape(c.attribution?.license??'')+'<br>'+escape(c.attribution?.sourceUrl??'')+' '+escape(c.attribution?.licenseUrl??'')+'</p>').join('')+'</li>').join('');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(asset.name)+'</title><style>body{font:14px system-ui,sans-serif;margin:2rem;color:#181818;background:white}h1{font-size:25px}h2{font-size:19px;margin-top:2rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:.5rem;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{font-size:11px;overflow-wrap:anywhere}dt{font-weight:600}dd{margin:0 0 .6rem}details{border-top:1px solid #bbb;padding:.7rem 0}@media print{body{margin:.5cm}tr{break-inside:avoid}details{display:block}summary{font-weight:bold}}</style></head><body><p>'+kind+'</p><h1>'+escape(asset.name)+'</h1><p>Saved '+escape(asset.createdAt)+'. '+asset.rows.length+' request identities; '+asset.counts.located+' located and '+asset.counts.unlocated+' unlocated.</p><p>Handoff '+escape(handoff.id)+'<br>SHA-256 '+escape(handoff.sha256)+'</p>'+
    (isDispatch?'<p>Destination: '+escape(asset.destination)+'</p><p>'+escape(asset.definition.note)+'</p>':'<p>Source status and literal closure notes remain original. Team, asset, work-order, priority, action, due date, note and GIS geometry are separate analyst fields.</p>')+
    '<h2>Operating rows</h2><table><thead><tr><th>Request</th><th>Original source</th><th>Longitude, latitude</th><th>Assignment</th><th>Action / due date</th><th>Analyst note</th></tr></thead><tbody>'+rows+'</tbody></table><h2>Original selection and coverage</h2>'+coverage+'<h2>Source attribution</h2><ul>'+credits+'</ul><h2>Complete original selected records</h2>'+originals+'</body></html>\n';
}
export function exportAsset(asset,sources,kind,options={}) {
  const filename=asset.id;
  if(kind==='json')return {filename:filename+'.json',contentType:'application/json; charset=utf-8',body:canonical(analystJson(asset,sources))+'\n'};
  if(kind==='geojson')return {filename:filename+'.geojson',contentType:'application/geo+json; charset=utf-8',body:canonical(geoJson(asset,sources))+'\n'};
  if(kind==='csv')return {filename:filename+'.csv',contentType:'text/csv; charset=utf-8',body:assetCsv(asset)};
  if(kind==='gpkg')return {filename:filename+'.gpkg',contentType:'application/geopackage+sqlite3',body:writeGeoPackage(asset,sources,options)};
  if(kind==='html')return {filename:filename+'.html',contentType:'text/html; charset=utf-8',body:assetHtml(asset,sources)};
  fail('INVALID_EXPORT_KIND','Choose json, geojson, csv, gpkg or html for the selected handoff or dispatch.');
}
