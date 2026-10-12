// MIT. Source-faithful weather tables, interval review, comparisons and handovers.
import {COLUMNS,TABLES,SOURCE_CONTRACT} from './schema.mjs';
import {fault,hashBytes,normaliseBundle,urlKey} from './provider.mjs';
import {jsonBytes,stable} from '../stellar-expert/store.mjs';
import {csvBytes} from '../stellar-expert/domain.mjs';
const string=v=>v===undefined?'':v===null?'null':typeof v==='object'?JSON.stringify(v):String(v);
const json=v=>JSON.stringify(v===undefined?null:v);
const type=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
const html=v=>string(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function duration(v){
  const m=/^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v);
  if(!m||!m.slice(1).some(Boolean))return null;
  const n=((Number(m[1]??0)*7+Number(m[2]??0))*86400+Number(m[3]??0)*3600+Number(m[4]??0)*60+Number(m[5]??0))*1000;
  return Number.isFinite(n)?n:null;
}
export function interval(value){
  const original=typeof value==='string'?value:'',parts=original.split('/');
  if(parts.length!==2)return {validTime:original,validFrom:'',validUntil:'',resolution:'SOURCE_LITERAL'};
  const [a,b]=parts,ad=duration(a),bd=duration(b),at=Date.parse(a),bt=Date.parse(b);
  if(Number.isFinite(at)&&Number.isFinite(bt))return {validTime:original,validFrom:a,validUntil:b,resolution:'EXPLICIT_ENDPOINTS'};
  if(Number.isFinite(at)&&bd!==null)return {validTime:original,validFrom:a,validUntil:new Date(at+bd).toISOString(),resolution:'FIXED_DURATION'};
  if(ad!==null&&Number.isFinite(bt))return {validTime:original,validFrom:new Date(bt-ad).toISOString(),validUntil:b,resolution:'FIXED_DURATION'};
  return {validTime:original,validFrom:Number.isFinite(at)?a:'',validUntil:Number.isFinite(bt)?b:'',resolution:'SOURCE_LITERAL'};
}
function base(edition,page,index,table,recordId){
  return {...Object.fromEntries(COLUMNS.map(k=>[k,''])),siteId:edition.site.id,siteName:edition.site.label,
    latitude:String(edition.site.latitude),longitude:String(edition.site.longitude),table,recordId:string(recordId),
    sourcePageSha256:page.sha256,sourceRecord:String(index),sourceObservedAt:page.sourceObservedAt??page.finishedAt??page.capturedOn??'',
    sourceUrl:page.originalRequestUrl??page.url};
}
function measurement(out,value,unit,quality){
  out.value=string(value);out.valueType=type(value);
  out.unitCode=string(unit);out.qualityControl=string(quality);
}
function forecastRows(edition,page,body){
  return body.properties.periods.map((period,i)=>{
    const row=base(edition,page,'properties.periods['+i+']',page.kind,period.startTime??period.number??i);
    Object.assign(row,{validFrom:period.startTime??'',validUntil:period.endTime??'',validTime:period.startTime&&period.endTime?period.startTime+'/'+period.endTime:'',
      field:'temperature',label:period.name??'',description:period.detailedForecast??period.shortForecast??'',status:period.isDaytime===true?'day':period.isDaytime===false?'night':''});
    if(period.temperature&&typeof period.temperature==='object')measurement(row,period.temperature.value,period.temperature.unitCode,period.temperature.qualityControl);
    else measurement(row,period.temperature,period.temperatureUnit,undefined);
    // Ordinal period numbers may change when the same valid interval moves up the forecast.
    const {number,...details}=period;row.detailsJson=json(details);row.geometryJson=json(body.geometry);return row;
  });
}
function gridRows(edition,page,body){
  const rows=[];
  for(const [field,layer]of Object.entries(body.properties)){
    if(!layer||!Array.isArray(layer.values))continue;
    layer.values.forEach((entry,i)=>{
      const row=base(edition,page,'properties.'+field+'.values['+i+']','grid',field+'@'+String(entry.validTime??i)),span=interval(entry.validTime);
      Object.assign(row,{validTime:span.validTime,validFrom:span.validFrom,validUntil:span.validUntil,field,label:field,geometryJson:json(body.geometry),
        detailsJson:json({source:entry,unit:layer.uom??layer.unitCode??null,intervalResolution:span.resolution})});
      measurement(row,entry.value,layer.uom??layer.unitCode,entry.qualityControl);rows.push(row);
    });
  }
  return rows;
}
function observationRows(edition,page,feature,index,table='observations'){
  const p=feature.properties,timestamp=p.timestamp??'',id=feature.id??p['@id']??timestamp,
    stationId=p.stationId??p.stationIdentifier??String(p.station??'').split('/').at(-1)??edition.station?.id??'';
  const rows=[],add=(field,value,unit,quality,details)=>{
    const row=base(edition,page,'features['+index+'].properties.'+field,table,id+'#'+field);
    Object.assign(row,{validTime:timestamp,validFrom:timestamp,field,label:p.stationName??p.station??stationId,
      stationId,description:p.textDescription??'',geometryJson:json(feature.geometry),detailsJson:json(details)});
    measurement(row,value,unit,quality);rows.push(row);
  };
  for(const [field,q]of Object.entries(p)){
    if(q&&typeof q==='object'&&!Array.isArray(q)&&Object.hasOwn(q,'value')&&Object.hasOwn(q,'unitCode'))
      add(field,q.value,q.unitCode,q.qualityControl,q);
  }
  add('conditions',p.textDescription??null,undefined,undefined,p);
  return rows;
}
function alertRows(edition,page,body){
  return body.features.map((feature,i)=>{
    const p=feature.properties,row=base(edition,page,'features['+i+']',page.kind,p.id??feature.id??i);
    Object.assign(row,{validTime:p.effective??p.sent??'',validFrom:p.onset??p.effective??p.sent??'',validUntil:p.ends??p.expires??'',
      field:'event',label:p.headline??p.event??'',description:p.description??'',status:p.status??'',
      severity:p.severity??'',urgency:p.urgency??'',certainty:p.certainty??'',geometryJson:json(feature.geometry),detailsJson:json(p)});
    measurement(row,p.event,undefined,undefined);return row;
  });
}
function stationRows(edition,page,body){
  return body.features.map((feature,i)=>{
    const p=feature.properties,id=p.stationIdentifier??String(feature.id??p['@id']??'').split('/').at(-1),
      row=base(edition,page,'features['+i+']','stations',id);
    Object.assign(row,{field:'station',stationId:id,label:p.name??'',geometryJson:json(feature.geometry),detailsJson:json(p)});
    measurement(row,p.name??id,undefined,undefined);return row;
  });
}
export async function allRows(store,edition){
  const rows=[];let latest=null;
  for(const page of edition.pages){
    if(page.kind==='point')continue;
    const body=JSON.parse((await store.object(page.sha256)).toString('utf8'));
    if(['forecast','hourly'].includes(page.kind))rows.push(...forecastRows(edition,page,body));
    else if(page.kind==='grid')rows.push(...gridRows(edition,page,body));
    else if(page.kind==='stations')rows.push(...stationRows(edition,page,body));
    else if(['alerts','active-alerts'].includes(page.kind))rows.push(...alertRows(edition,page,body));
    else if(page.kind==='observations'){
      body.features.forEach((feature,index)=>{
        const t=Date.parse(feature.properties.timestamp);
        if(Number.isFinite(t)&&(t<Date.parse(edition.query.observationStart)||t>Date.parse(edition.query.observationEnd)))return;
        rows.push(...observationRows(edition,page,feature,index));
        if(Number.isFinite(t)&&(!latest||t>latest.time))latest={time:t,feature,index,page};
      });
    }
  }
  if(latest)rows.push(...observationRows(edition,latest.page,latest.feature,latest.index,'latest'));
  // Preserve source timestamps and provide separate UTC endpoints for chronological dataset queries.
  for(const row of rows)for(const [source,target]of [['validFrom','validFromUtc'],['validUntil','validUntilUtc']]){
    const value=row[source],time=typeof value==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)?Date.parse(value):NaN;
    row[target]=Number.isFinite(time)?new Date(time).toISOString():'';
  }
  return rows;
}
export async function editionRows(store,edition,{table='forecast',offset=0,limit=100}={}){
  if(!TABLES.some(t=>t.id===table))throw fault('NWS_TABLE','Choose a listed weather table.');
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>250000)
    throw fault('NWS_ROWS_RANGE','Choose a nonnegative offset and one to250000 rows.');
  const rows=(await allRows(store,edition)).filter(r=>r.table===table);
  return {columns:COLUMNS,rows:rows.slice(offset,offset+limit),total:rows.length,offset,limit,table};
}
export async function summarizeEdition(store,edition){
  const rows=await allRows(store,edition),tables=TABLES.map(t=>({...t,rows:rows.filter(r=>r.table===t.id).length})),
    observed=rows.filter(r=>r.table==='observations'),last=observed.map(r=>r.validFrom).filter(Boolean).sort().at(-1)??null,
    quantities=rows.filter(r=>r.valueType==='number'||r.valueType==='null');
  return {tables,totalRows:rows.length,nullMeasurements:quantities.filter(r=>r.valueType==='null').length,
    latestCapturedObservation:last,activeAlerts:tables.find(t=>t.id==='active-alerts').rows,
    historicalAlerts:tables.find(t=>t.id==='alerts').rows,
    forecastGeneratedAt:edition.pages.find(p=>p.kind==='forecast')?.providerGeneratedAt??null,
    firstSourceObservedAt:edition.pages.map(p=>p.sourceObservedAt??p.finishedAt).filter(Boolean).sort()[0]??null,
    lastSourceObservedAt:edition.pages.map(p=>p.sourceObservedAt??p.finishedAt).filter(Boolean).sort().at(-1)??null,
    retrievedDates:[...new Set(edition.pages.map(p=>p.capturedOn).filter(Boolean))],
    observationWindow:{start:edition.query.observationStart,end:edition.query.observationEnd},
    mapping:edition.mapping,station:edition.station,
    coverage:edition.coverage};
}
export async function compareEditions(store,left,right,table){
  if(left.site.id!==right.site.id||left.site.latitude!==right.site.latitude||left.site.longitude!==right.site.longitude)
    throw fault('NWS_COMPARISON_SITE','Compare editions of the same saved site and coordinates.',409);
  if(left.query.units!==right.query.units)throw fault('NWS_COMPARISON_UNITS','Compare editions using the same forecast units.',409);
  if(['observations','latest'].includes(table)&&left.station?.id!==right.station?.id)
    throw fault('NWS_COMPARISON_STATION','Compare observations from the same source station.',409);
  const a=await editionRows(store,left,{table,limit:250000}),b=await editionRows(store,right,{table,limit:250000});
  if(a.total>250000||b.total>250000)throw fault('NWS_COMPARISON_CAPACITY','A selected table exceeds the 250000-row comparison capacity. Both complete source editions remain retained.',413);
  const duplicates=[],index=(rows,label)=>{
      const m=new Map();for(const row of rows){const id=row.recordId;
        if(m.has(id)){duplicates.push({edition:label,recordId:id,sourcePageSha256:row.sourcePageSha256,sourceRecord:row.sourceRecord});continue;}m.set(id,row);}return m;},
    before=index(a.rows,'left'),after=index(b.rows,'right'),added=[],removed=[],changed=[];
  const fields=['validTime','validFrom','validUntil','field','value','valueType','unitCode','qualityControl','label','description','status','severity','urgency','certainty','geometryJson','detailsJson'];
  for(const [id,row]of after){
    if(!before.has(id)){added.push({id,row});continue;}
    const old=before.get(id),difference=fields.filter(k=>old[k]!==row[k]);
    if(difference.length)changed.push({id,fields:difference.map(field=>({field,before:old[field],after:row[field]})),before:old,after:row});
  }
  for(const [id,row]of before)if(!after.has(id))removed.push({id,row});
  return {schema:'stellar-forge.nws-comparison.v1',siteId:left.site.id,table,leftId:left.id,rightId:right.id,
    sourceIntervals:{left:left.query,right:right.query},coverage:{left:left.coverage,right:right.coverage},
    meaning:'Differences between these captured source editions and selected time intervals.',
    counts:{added:added.length,removed:removed.length,changed:changed.length,unchanged:after.size-added.length-changed.length},
    duplicates,added,removed,changed};
}
export async function exportEdition(store,edition,annotations,table,format){
  if(format==='source-package'){
    const pages=[];
    for(const page of edition.pages){
      const source={url:page.originalRequestUrl??page.url,receipt:page,bodyBase64:(await store.object(page.sha256)).toString('base64')};
      if(page.responseSha256&&page.responseSha256!==page.sha256)source.wireBase64=(await store.object(page.responseSha256)).toString('base64');
      pages.push(source);
    }
    if(edition.sourcePackageSha256){
      const imported=normaliseBundle(JSON.parse((await store.object(edition.sourcePackageSha256)).toString('utf8'))),selectedUrls=new Set(pages.map(p=>urlKey(p.url)));
      for(const page of imported.pages)if(!selectedUrls.has(urlKey(page.url)))pages.push({url:page.url,receipt:page.receipt,bodyBase64:page.bodyBase64,
        ...(page.receipt.responseSha256!==page.receipt.sha256?{wireBase64:page.wireBase64}:{}),selection:'SUPPLEMENTARY_RETAINED_SOURCE'});
    }
    return {bytes:jsonBytes({schema:'stellar-forge.nws-capture-package.v1',provider:SOURCE_CONTRACT.provider,source:SOURCE_CONTRACT,
      site:edition.site,query:edition.query,sourceEditionId:edition.id,sourceWorkspaceId:edition.workspaceId,
      capturedOn:edition.pages.find(p=>p.capturedOn)?.capturedOn??null,coverage:edition.coverage,annotations,pages}),
      type:'application/json; charset=utf-8',extension:'source.json'};
  }
  const {columns,rows,total}=await editionRows(store,edition,{table,limit:250000});
  if(total>250000)throw fault('NWS_EXPORT_CAPACITY','The complete table exceeds the 250000-row review export capacity. Export the complete source package or select another table.',413);
  if(format==='json')return {bytes:jsonBytes({schema:'stellar-forge.nws-weather-review.v1',source:SOURCE_CONTRACT,edition,annotations,table,columns,rows}),
    type:'application/json; charset=utf-8',extension:'json'};
  if(format==='csv')return {bytes:csvBytes(columns,rows,{spreadsheet:true}),type:'text/csv; charset=utf-8',extension:'csv',
    note:'Spreadsheet CSV protects formula-leading text with an apostrophe. The original response and JSON export retain source values.'};
  if(format!=='report')throw fault('NWS_EXPORT_FORMAT','Choose JSON, CSV, report or source-package.');
  const display=['recordId','validFrom','validUntil','field','value','unitCode','qualityControl','label','description'],
    document='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'+
    '<title>'+html(edition.site.label)+' — Weather review</title><style>body{font:14px system-ui;color:#191919;background:#fff;margin:32px;line-height:1.5}h1{font-size:24px}h2{font-size:18px;margin-top:30px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #aaa;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow:auto}@media print{body{margin:0}thead{display:table-header-group}tr{break-inside:avoid}}</style>'+
    '<h1>'+html(edition.site.label)+'</h1><p>'+html(TABLES.find(t=>t.id===table)?.label??table)+' · '+rows.length+' rows</p>'+
    '<p>Edition '+html(edition.id)+'</p><h2>Source and coverage</h2><pre>'+html(JSON.stringify(edition.summary,null,2))+'</pre>'+
    '<h2>Staff review</h2>'+annotations.map(a=>'<h3>'+html(a.subject)+' · '+html(a.status)+'</h3><p>'+html(a.note)+'</p><p>'+html(a.updatedAt)+'</p>').join('')+
    '<h2>Captured source rows</h2><div class="scroll"><table><thead><tr>'+display.map(k=>'<th>'+html(k)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(row=>'<tr>'+display.map(k=>'<td>'+html(row[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
    '<h2>Source responses</h2><pre>'+html(JSON.stringify(edition.pages,null,2))+'</pre></html>';
  return {bytes:Buffer.from(document),type:'text/html; charset=utf-8',extension:'html'};
}
