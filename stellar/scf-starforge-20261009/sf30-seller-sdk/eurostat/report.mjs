// MIT. Complete portable economic briefing from original reviewed JSON-stat cells.
import { need,selectedCellIndexes,cubeCell,cellRow,queryColumns,compareText } from './model.mjs';
export const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const observationCsv=(cube,indexes)=>{const columns=queryColumns(cube).map(x=>x.name),q=v=>'"'+String(v).replaceAll('"','""')+'"';
  return [columns.map(q).join(','),...indexes.map(i=>{const row=cellRow(cube,i);return columns.map(k=>q(row[k])).join(',');})].join('\n')+'\n';};
function decimal(text){
  const m=/^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);need(m,'EUROSTAT_DECIMAL');
  const exponent=Number(m[4]??0),fraction=m[3]??'';need(Math.abs(exponent)<=1000&&m[2].length+fraction.length<=1000,'EUROSTAT_DECIMAL_REPORT_LIMIT');
  return {n:BigInt((m[1]??'')+m[2]+fraction),scale:fraction.length-exponent};
}
export function exactDifference(after,before){
  const a=decimal(after),b=decimal(before),scale=Math.max(a.scale,b.scale,0);
  const n=a.n*10n**BigInt(scale-a.scale)-b.n*10n**BigInt(scale-b.scale);
  const negative=n<0n;let s=(negative?-n:n).toString().padStart(scale+1,'0');
  if(scale)s=s.slice(0,-scale)+'.'+s.slice(-scale);return(negative?'-':'')+s;
}
export function createEurostatBriefing({cube,sourceUrl,retrievedAt,responseSha256,selection={},includeMissing=true,review=null}={}){
  const indexes=selectedCellIndexes(cube,selection,{includeMissing}),cells=indexes.map(i=>cubeCell(cube,i));
  const dimensions=cube.id.filter(id=>id!=='time'),groups=new Map();
  for(const c of cells){const period=c.dimensions.time;
    if(typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))continue;
    const key=JSON.stringify(dimensions.map(d=>[d,c.dimensions[d]]));
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);
  }
  const comparisons=[];
  for(const [key,items]of groups){
    items.sort((a,b)=>compareText(a.dimensions.time,b.dimensions.time));
    const current=items.at(-1),period=current.dimensions.time,previousPeriod=String(Number(period.slice(0,4))-1)+period.slice(4);
    const previous=items.find(c=>c.dimensions.time===previousPeriod);
    const comparable=current.valueState==='VALUE'&&previous?.valueState==='VALUE';
    const unit=current.dimensions.unit??'',frequency=current.dimensions.freq??'';
    comparisons.push({coordinates:JSON.parse(key),labels:Object.fromEntries(dimensions.map(d=>[d,current.labels[d]])),
      period,current:current.value,currentState:current.valueState,currentStatus:current.status,currentStatusState:current.statusState,
      previousPeriod,previous:previous?.value??null,previousState:previous?.valueState??'OUTSIDE_SELECTION',
      previousStatus:previous?.status??null,previousStatusState:previous?.statusState??'OUTSIDE_SELECTION',
      change:comparable&&frequency==='M'?exactDifference(current.value,previous.value):null,
      changeUnit:unit==='PC_ACT'?'percentage points':current.labels.unit??unit,
      state:comparable&&frequency==='M'?'MATCHED_MONTHLY_COMPARISON':'SOURCE_OR_BASE_NOT_COMPARABLE'});
  }
  const report={schema:'stellar-forge.eurostat-economic-briefing.v1',source:{sourceUrl,retrievedAt,responseSha256,
    label:cube.label,datasetCode:cube.datasetCode,source:cube.source,updated:cube.updated,dimensions:cube.dimensions,metadataJson:cube.metadataJson},
    selection,includeMissing,review,rows:cells.length,numericObservations:cells.filter(c=>c.valueState==='VALUE').length,
    explicitNulls:cells.filter(c=>c.valueState==='NULL').length,absentValues:cells.filter(c=>c.valueState==='ABSENT').length,
    comparisons,cells};
  const e=escapeHtml,td=values=>'<tr>'+values.map(v=>'<td>'+e(v??'')+'</td>').join('')+'</tr>';
  const comparativeHead=['Geography','Age','Sex','Period','Value','Prior period','Prior value','Change','Change unit','Source status'];
  const comparativeRows=comparisons.map(c=>td([c.labels.geo??c.coordinates.find(x=>x[0]==='geo')?.[1]??'',
    c.labels.age??'',c.labels.sex??'',c.period,c.current,c.previousPeriod,c.previous,c.change,c.changeUnit,
    [c.currentStatus,c.previousStatus].filter(x=>x!==null).join(' / ')])).join('');
  const cellHead=['Cell',...cube.id,'Value','Value state','Status','Status state'];
  const cellRows=cells.map(c=>td([c.index,...cube.id.map(d=>c.dimensions[d]),c.value,c.valueState,c.status,c.statusState])).join('');
  const header=names=>'<thead><tr>'+names.map(v=>'<th>'+e(v)+'</th>').join('')+'</tr></thead>';
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+e(cube.label)+' — economic edition</title><style>body{font:14px/1.5 Arial,Helvetica,sans-serif;color:#171717;background:#f4f4f4;margin:0}main{max-width:1380px;margin:auto;padding:32px}h1{font-size:30px;margin:8px 0}h2{font-size:20px;margin-top:30px}section{background:white;border:1px solid #ccc;padding:22px;margin:20px 0}.meta{color:#555;overflow-wrap:anywhere}.tables{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;border-bottom:1px solid #ccc;padding:8px;white-space:nowrap}th{background:#ececec}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}a{color:#222}.metrics{display:flex;gap:24px;flex-wrap:wrap}.metrics strong{font-size:24px;display:block}@media print{body{background:white}main{padding:0;max-width:none}section{border:0;padding:0}.tables{overflow:visible}table{font-size:9px}td,th{padding:4px}thead{display:table-header-group}tr{break-inside:avoid}}</style></head><body><main>'+
    '<p class="meta">STELLAR FORGE / EUROSTAT ECONOMIC EDITIONS</p><h1>'+e(cube.label)+'</h1>'+
    '<p>Complete retained source selection with exact numeric values, original categories, status flags and monthly comparisons.</p>'+
    '<p class="meta">Dataset '+e(cube.datasetCode)+' · Source '+e(cube.source)+' · Publisher update '+e(cube.updated)+' · Retrieved '+e(retrievedAt)+'</p>'+
    '<section class="metrics"><div><strong>'+cells.length+'</strong>Selected cells</div><div><strong>'+report.numericObservations+
    '</strong>Original numeric observations</div><div><strong>'+report.explicitNulls+'</strong>Explicit nulls</div><div><strong>'+
    report.absentValues+'</strong>Absent values</div><div><strong>'+comparisons.length+'</strong>Monthly series</div></section>'+
    '<section><h2>Latest selected month and the same month one year earlier</h2><p>Comparisons keep every non-time category unchanged. '+
    'For PC_ACT labour-force percentages, the difference is in percentage points. Original status fields remain attached to both observations.</p>'+
    '<div class="tables"><table>'+header(comparativeHead)+'<tbody>'+comparativeRows+'</tbody></table></div></section>'+
    '<section><h2>Source and reuse review</h2><p><a href="'+e(sourceUrl)+'">Original Eurostat selection</a></p>'+
    '<p class="meta">Original response SHA256 '+e(responseSha256)+'</p><pre>'+e(JSON.stringify(review,null,2))+'</pre>'+
    '<p><a href="observations.csv">Complete exact-value CSV</a> · <a href="briefing.json">Complete structured briefing</a> · '+
    '<a href="original-response.json">Complete original JSON-stat response</a></p></section>'+
    '<section><h2>Every selected original observation</h2><div class="tables"><table>'+header(cellHead)+'<tbody>'+cellRows+'</tbody></table></div></section>'+
    '<section><h2>Original dataset and category metadata</h2><pre>'+e(cube.metadataJson)+'</pre></section>'+
    '</main></body></html>';
  return {report,html,csv:observationCsv(cube,indexes)};
}
