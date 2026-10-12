// MIT. Frozen source-bound publications from the original analysis version.
import {identity,json,sha,stable,plain,fault} from '../contract.mjs';
import {validateSourceEdition,openPrivateFile,hashHeldFile} from '../portable.mjs';
import {selectedRows,selectedCSV,numericEligibility} from './model.mjs';
import {ANALYSIS_MEANING,ANALYSIS_SCHEMA} from './schema.mjs';
import {retainBytes,retainStream,retainedPath,safeFile} from './artifacts.mjs';

export const PUBLICATION_SCHEMA='stellar-forge.sensorthings-analysis-publication.v1';
const RENDER_SCHEMA='stellar-forge.sensorthings-analysis-source-rendering.v1',
  PREVIEW_PER_STREAM=600,ROW_PREVIEW=40,MAX_INLINE_EVIDENCE=8*1024*1024,
  HASH=/^[a-f0-9]{64}$/,OP=/^[A-Za-z0-9_-]{8,100}$/;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=v=>v===undefined?'Not supplied':v===null?'null':typeof v==='string'?v:JSON.stringify(v);
const number=v=>Number.isSafeInteger(v)?v.toLocaleString('en-US'):text(v);
const code=v=>'<code>'+esc(text(v))+'</code>';
const para=v=>'<p>'+esc(text(v))+'</p>';
const pre=v=>'<pre>'+esc(JSON.stringify(v,null,2))+'</pre>';
const short=(v,n=100)=>String(v??'').length>n?String(v).slice(0,n-1)+'…':String(v??'');
function table(head,rows){return '<div class="table-wrap"><table><thead><tr>'+head.map(h=>'<th>'+esc(h)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function safeUrl(value){
  try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;return u.href;}catch{return null;}
}
function link(url,label){const href=safeUrl(url);return href?'<a rel="noreferrer" href="'+esc(href)+'">'+esc(label??url)+'</a>':esc(label??url);}
function download(file,label=file.name){return '<a download href="'+encodeURIComponent(safeFile(file.name))+'">'+esc(label)+'</a>';}
function sourceRef(ref){
  if(!ref)return 'No original source reference';
  return code(ref.sha256)+'<br>'+code(ref.jsonPointer??'')+(ref.url?'<br>'+link(ref.url):'');
}
function categories(stream){
  return Object.entries(stream.categories??{}).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
function displayValue(row){return row.result_state==='value'?row.result:row.result_state==='null'?'null':'[missing result]';}
function laneKey(row){
  return row.result_state==='value'&&row.result_type==='string'?'category:'+row.result:
    row.result_state+':'+row.result_type;
}
function laneLabel(key){
  if(key.startsWith('category:'))return key.slice(9);
  return ({'value:number':'Numeric events','value:boolean':'Boolean events','value:array':'Array results','value:object':'Object results',
    'null:null':'Null results','missing:missing':'Missing results'})[key]??key;
}
function bounds(summary,selection){
  if(selection.period)return [Date.parse(selection.period.startUtc),Date.parse(selection.period.endUtc)];
  const starts=summary.streams.map(x=>Date.parse(x.firstUtc)).filter(Number.isFinite),
    ends=summary.streams.map(x=>Date.parse(x.lastUtc)).filter(Number.isFinite);
  if(!starts.length||!ends.length)return null;let a=Math.min(...starts),b=Math.max(...ends);if(b===a)b=a+1;return [a,b];
}
function svgStart(width,height,title,description){
  const tag='chart-'+sha(Buffer.from(title)).slice(0,12);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="'+tag+'-title '+tag+'-description">'+
    '<title id="'+tag+'-title">'+esc(title)+'</title><desc id="'+tag+'-description">'+esc(description)+'</desc>'+
    '<rect width="100%" height="100%" fill="#fff"/><g font-family="Arial,Helvetica,sans-serif" fill="#171717">';
}
function svgText(x,y,value,size=12,extra=''){return '<text x="'+x+'" y="'+y+'" font-size="'+size+'" '+extra+'>'+esc(value)+'</text>';}
function eventChart(summary,selection,render){
  const time=bounds(summary,selection),blocks=[];
  for(const s of summary.streams){
    const selected=render.streams.get(s.key),rows=selected.events,preferred=categories(s).map(([k])=>'category:'+k),
      lanes=[...new Set([...preferred,...rows.map(laneKey)])].slice(0,16);
    if(!lanes.length)lanes.push('No placed source occurrences');
    blocks.push({s,selected,rows,lanes,height:78+lanes.length*26});
  }
  const height=100+blocks.reduce((n,b)=>n+b.height,0),width=1120,left=290,right=1085,plot=right-left;
  let out=svgStart(width,height,'Retained categorical and source-time events',
    'Literal selected source occurrences. Circles are original instants; bars are explicit original intervals. Preview limits are stated per stream.');
  out+=svgText(22,28,'Retained source events',20)+svgText(22,49,'Circles: explicit instants. Bars: explicit intervals. Unplaced times remain in the complete data.',12);
  if(!time){out+=svgText(22,78,'No explicit source instants or intervals are available for positioning.');return out+'</g></svg>';}
  const x=t=>left+Math.max(0,Math.min(1,(t-time[0])/(time[1]-time[0])))*plot;
  out+=svgText(left,76,new Date(time[0]).toISOString(),10)+svgText(right,76,new Date(time[1]).toISOString(),10,'text-anchor="end"');
  let y=104;
  for(const {s,selected,rows,lanes,height:blockHeight}of blocks){
    out+=svgText(22,y,short(s.name??s.key,105),14);
    out+=svgText(22,y+18,'Preview '+rows.length+' / '+selected.placed+' placed occurrences; '+selected.unplaced+' unplaced; '+Math.max(0,preferredCount(s)-16)+' category lanes outside this preview.',10);
    const laneY=new Map(lanes.map((k,i)=>[k,y+43+i*26]));
    for(const k of lanes){const yy=laneY.get(k);out+=svgText(22,yy+4,short(laneLabel(k),38),11)+
      '<line x1="'+left+'" x2="'+right+'" y1="'+yy+'" y2="'+yy+'" stroke="#dedede"/>';}
    for(const r of rows){
      const yy=laneY.get(laneKey(r));if(yy===undefined)continue;
      const start=Date.parse(r.phenomenon_start_utc),end=Date.parse(r.phenomenon_end_utc);
      if(!Number.isFinite(start))continue;
      const title=esc(displayValue(r)+' · '+r.phenomenon_time+' · occurrence '+r.occurrence_id);
      if(r.phenomenon_time_kind==='explicit_interval'&&Number.isFinite(end)){
        const a=x(Math.max(start,time[0])),b=x(Math.min(end,time[1]));
        if(end>time[0]&&start<time[1])out+='<rect x="'+a.toFixed(2)+'" y="'+(yy-4)+'" width="'+Math.max(1,b-a).toFixed(2)+'" height="8" fill="#555" fill-opacity=".65"><title>'+title+'</title></rect>';
      }else if(r.phenomenon_time_kind==='explicit_instant'&&start>=time[0]&&start<=time[1])
        out+='<circle cx="'+x(start).toFixed(2)+'" cy="'+yy+'" r="3.1" fill="#202020" fill-opacity=".65"><title>'+title+'</title></circle>';
    }
    y+=blockHeight;
  }
  return out+'</g></svg>';
}
function preferredCount(stream){return Object.keys(stream.categories??{}).length;}
function numericChart(summary,selection,render){
  const blocks=summary.streams.filter(s=>render.streams.get(s.key).numeric.length),time=bounds(summary,selection);
  const height=100+blocks.length*260,width=1120,left=135,right=1085;
  let out=svgStart(width,height,'Original numeric instantaneous observations',
    'Points use only original JSON numeric instantaneous observations accepted by the source model. Series have separate units and axes. No interpolation or category coding.');
  out+=svgText(22,28,'Original numeric observations',20)+svgText(22,49,'Separate stream scales; original instants only. Exact decimal lexemes remain in the data files.',12);
  if(!blocks.length||!time){out+=svgText(22,79,'No selected observations meet the numeric source/time contract.');return out+'</g></svg>';}
  let y=78;
  for(const s of blocks){
    const state=render.streams.get(s.key),rows=state.numeric,values=rows.map(r=>Number(r.result));
    let low=Math.min(...values),high=Math.max(...values),range=high-low;
    if(!Number.isFinite(range)){low/=2;high/=2;range=high-low;}
    const equal=low===high;
    const numericPosition=value=>{
      if(equal)return y+115;
      const a=Number(value),ratio=!Number.isFinite(Math.max(...values)-Math.min(...values))?
        (a/2-low)/range:(a-low)/range;
      return y+190-Math.max(0,Math.min(1,ratio))*145;
    };
    out+=svgText(22,y,short(s.name??s.key,110),14)+svgText(22,y+18,'Unit '+text(s.unit)+' · preview '+rows.length+' / '+state.numericCount+' eligible original points',10);
    out+='<line x1="'+left+'" x2="'+right+'" y1="'+(y+190)+'" y2="'+(y+190)+'" stroke="#999"/>'+
      '<line x1="'+left+'" x2="'+left+'" y1="'+(y+40)+'" y2="'+(y+190)+'" stroke="#999"/>';
    out+=svgText(left-8,y+47,String(Math.max(...values)),10,'text-anchor="end"')+
      svgText(left-8,y+191,String(Math.min(...values)),10,'text-anchor="end"');
    for(const r of rows){
      const at=Date.parse(r.phenomenon_start_utc);if(!Number.isFinite(at))continue;
      const x=left+Math.max(0,Math.min(1,(at-time[0])/(time[1]-time[0])))*(right-left);
      out+='<circle cx="'+x.toFixed(2)+'" cy="'+numericPosition(r.result).toFixed(2)+'" r="3" fill="#252525" fill-opacity=".7"><title>'+
        esc(r.result+' · '+r.phenomenon_time+' · '+r.occurrence_id)+'</title></circle>';
    }
    out+=svgText(left,y+211,new Date(time[0]).toISOString(),10)+svgText(right,y+211,new Date(time[1]).toISOString(),10,'text-anchor="end"');y+=260;
  }
  return out+'</g></svg>';
}
function pointGeometry(entity){
  let v=entity?.location;if(v?.type==='Feature')v=v.geometry;
  if(v?.type!=='Point'||!Array.isArray(v.coordinates)||v.coordinates.length<2||!v.coordinates.slice(0,2).every(n=>typeof n==='number'&&Number.isFinite(n)))return null;
  return v.coordinates.slice(0,2);
}
function mapChart(summary){
  const points=[],other=[];
  for(const s of summary.streams)for(const loc of s.locations??[]){
    const xy=pointGeometry(loc.entity);if(xy)points.push({xy,s,loc});else other.push({streamKey:s.key,source:loc.sourceRef});
  }
  let out=svgStart(1120,620,'Original retained Thing Location points',
    'Unprojected original point coordinates without a basemap. Retained Thing Locations are not inferred observation locations.');
  out+=svgText(22,28,'Original retained Thing Locations',20)+svgText(22,49,'Point coordinates only, without a basemap. A Thing Location does not establish an observation location.',12);
  if(!points.length)return out+svgText(22,88,'No finite original Point coordinates are available. Other retained geometries remain in source/selection metadata.')+'</g></svg>';
  let xmin=Math.min(...points.map(p=>p.xy[0])),xmax=Math.max(...points.map(p=>p.xy[0])),
    ymin=Math.min(...points.map(p=>p.xy[1])),ymax=Math.max(...points.map(p=>p.xy[1]));
  const xspan=xmax-xmin||1,yspan=ymax-ymin||1;
  if(!Number.isFinite(xspan)||!Number.isFinite(yspan))return out+svgText(22,88,'Original coordinates exceed this finite rendering range; complete coordinates remain in source metadata.')+'</g></svg>';
  out+='<rect x="105" y="88" width="975" height="440" fill="none" stroke="#999"/>';
  for(let i=0;i<points.length;i++){const p=points[i],x=125+(p.xy[0]-xmin)/xspan*930,y=510-(p.xy[1]-ymin)/yspan*400;
    out+='<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="6" fill="#222" fill-opacity=".7"><title>'+
      esc((p.s.name??p.s.key)+' · '+JSON.stringify(p.xy)+' · '+p.loc.sourceRef?.jsonPointer)+'</title></circle>';
    out+=svgText(x+9,y-9,String(i+1),10);
  }
  out+=svgText(105,550,'Horizontal source coordinates: '+xmin+' to '+xmax,11)+
    svgText(105,570,'Vertical source coordinates: '+ymin+' to '+ymax,11)+
    svgText(105,592,points.length+' retained point occurrences; '+other.length+' non-Point/unavailable geometries remain in source metadata.',11);
  return out+'</g></svg>';
}
function initRendering(summary){
  return {schema:RENDER_SCHEMA,previewPerStream:PREVIEW_PER_STREAM,rows:[],total:0,
    streams:new Map(summary.streams.map(s=>[s.key,{events:[],numeric:[],placed:0,unplaced:0,numericCount:0}]))};
}
function captureRendering(render,row,key){
  const state=render.streams.get(key);if(!state)throw fault('ANALYSIS_PUBLICATION','A selected occurrence has another stream identity.',409);
  render.total++;if(render.rows.length<ROW_PREVIEW)render.rows.push({...row,stream_key:key});
  if(['explicit_instant','explicit_interval'].includes(row.phenomenon_time_kind)){
    state.placed++;if(state.events.length<PREVIEW_PER_STREAM)state.events.push(row);
  }else state.unplaced++;
  if(numericEligibility(row).eligible){state.numericCount++;if(state.numeric.length<PREVIEW_PER_STREAM)state.numeric.push(row);}
}
function renderingSummary(render){
  return {schema:render.schema,meaning:'Deterministic source-order previews. All selected occurrences remain in the full CSV/NDJSON; no duration is inferred between instants.',
    previewPerStream:PREVIEW_PER_STREAM,totalOccurrences:render.total,streams:[...render.streams].map(([key,s])=>({
      key,placedOccurrences:s.placed,unplacedOccurrences:s.unplaced,previewedEvents:s.events.length,
      eligibleNumericOccurrences:s.numericCount,previewedNumericPoints:s.numeric.length}))};
}
const CSS=':root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eee;color:#191919;font:14px/1.5 Arial,Helvetica,sans-serif}main{max-width:1180px;margin:24px auto;padding:44px;background:#fff;border:1px solid #bbb}h1{font-size:30px;font-weight:600;line-height:1.2;margin:12px 0 18px}h2{font-size:20px;margin:32px 0 12px;border-bottom:1px solid #999;padding-bottom:7px}h3{font-size:16px;margin:22px 0 10px}p{margin:10px 0}a{color:#202020;text-decoration:underline;text-underline-offset:2px}code{font:12px/1.45 ui-monospace,Consolas,monospace;overflow-wrap:anywhere}pre{font:11px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f6f6;border:1px solid #d4d4d4;padding:14px}.eyebrow{text-transform:uppercase;font-size:11px;letter-spacing:.12em}.subtle{color:#555}.box{border:1px solid #aaa;padding:16px;margin:18px 0}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}th,td{border:1px solid #ccc;padding:8px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee;font-weight:600}svg{width:100%;height:auto;border:1px solid #ccc;margin:14px 0}figure{margin:24px 0}figure img{max-width:100%;height:auto;border:1px solid #aaa}figcaption{font-size:12px;color:#444}details{margin:12px 0}summary{cursor:pointer;font-weight:600}nav{padding:12px 0;border-block:1px solid #bbb}nav a{margin-right:16px}.break{break-before:page}@media print{@page{size:A4;margin:15mm}body{background:#fff}main{margin:0;border:0;padding:0;max-width:none}h1,h2,h3,h4{break-after:avoid}tr,figure,svg{break-inside:avoid}thead{display:table-header-group}a{color:#111}nav{display:none}pre{font-size:9px}table{font-size:9px}details{display:block}details>*{display:block}details summary{display:none}}';
function comparisonContextHTML(comparison){
  const context=comparison.sourceContext;
  if(!context)return '<h3>Original response context</h3>'+para('This retained comparison predates source-context recording. No opening or closing response identity is inferred.');
  let out='<h3>Original response context</h3>'+para(context.meaning)+
    table(['Side','Original source / service','Selected query','Source scope','Retained source issues'],['left','right'].map(side=>{
      const record=context[side];return [esc(side),code(record.editionId)+'<br>'+code(record.sourceId)+'<br>'+link(record.serviceUrl),
        pre(record.query),pre(record.scope),pre(record.issues)];
    }))+
    table(['Selected stream','Opening / closing response','Original byte state','Left reads','Right reads'],context.brackets.map(b=>[
      code(b.streamKey),esc(b.phase),code(b.state),number(b.left.length),number(b.right.length)]));
  for(const bracket of context.brackets){
    out+='<details><summary>'+esc(bracket.phase+' · '+bracket.streamKey+' · '+bracket.state)+'</summary>';
    for(const side of ['left','right']){
      out+='<h4>'+esc(side)+' original responses</h4>';
      if(!bracket[side].length)out+=para('No original response is retained for this side and phase.');
      for(const response of bracket[side])out+=table(['Retained field','Original value'],[
        ['Source response / pointer',sourceRef(response)],['Exact bytes',number(response.bytes)],
        ['Original request / task',code(response.requestId)+'<br>'+code(response.taskId)],
        ['Source representation',esc(text(response.representation))],
        ['Source capture clock',code(response.sourceCapturedAt)],
        ['Connector received clock',code(response.connectorReceivedAt)],
        ['Native request started',code(response.nativeRequestStartedAt)],
        ['Native request completed',code(response.nativeRequestCompletedAt)]]); 
    }
    out+='</details>';
  }
  return out+para('Source capture, connector transfer and native request clocks retain their original meanings and values. A later response body is not an inferred provider revision or scientific approval.');
}
function briefHTML(meta,render,charts,files,evidenceFiles,images){
  const {title,version:v,edition:e,summary:s,review,comparisons,evidence,createdAt,actor,note}=meta;
  let out='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'">'+
    '<title>'+esc(title)+'</title><style>'+CSS+'</style></head><body><main><div class="eyebrow">SensorThings · retained observation analysis</div><h1>'+esc(title)+'</h1>'+
    para('Prepared '+createdAt+' · '+actor)+para(note)+
    '<nav><a href="#selection">Selection</a><a href="#source">Source review</a><a href="#views">Views</a><a href="#annotations">Annotations</a><a href="#comparison">Comparison</a><a href="#evidence">Viewer evidence</a><a href="#files">Files</a></nav>'+
    '<section id="selection"><h2>Saved selection</h2>'+table(['Field','Retained value'],[
      ['Project',code(v.projectId)],['Version',code(v.id)],['Parent version',code(v.parentId)],['Source edition',code(e.id)],
      ['Saved view',esc(v.selection.view)],['Native viewer edition',code(v.selection.viewerId)],['Source period',v.selection.period?pre(v.selection.period):'All retained source times'],
      ['Selection recorded',esc(v.createdAt)+' · '+esc(v.actor)],['Selection reason',esc(v.changeReason)]
    ])+
    table(['Selected occurrences','Distinct keyed observations','Repeated observation keys','Changed repeated keys','Instant events','Explicit intervals','Unplaced times'],[[
      number(s.totalOccurrences),number(s.distinctObservationKeys),number(s.duplicateObservationKeys),number(s.changedDuplicateKeys),
      number(s.instantEvents),number(s.explicitIntervals),number(s.unplacedOccurrences)]])+
    '<div class="box">'+para(ANALYSIS_MEANING.time)+para(ANALYSIS_MEANING.observations)+'</div></section>'+
    '<section id="source"><h2>Original source and review</h2>'+
    table(['Field','Retained source'],[['Service',link(e.source.serviceUrl)],['Source label',esc(e.source.label)],['Source licence',link(e.source.license?.url,e.source.license?.name)],
      ['Attribution',esc(e.source.license?.attribution)],['Source licence basis',link(e.source.license?.sourceUrl)],
      ['Capture started',esc(e.captureStartedAt??'Not supplied')],['Last retained response',esc(e.captureLastResponseAt??'Not supplied')]])+
    '<h3>Source scope</h3>'+pre(e.scope)+'<h3>Accepted original review</h3>'+pre(review)+
    '<h3>Retained issues</h3>'+pre(e.issues)+
    '<details><summary>Exact selected query and plan</summary>'+pre(e.plan)+'</details>';
  for(const stream of s.streams){
    out+='<h3>'+esc(stream.name??stream.key)+'</h3>'+
      table(['Original stream key','Typed source ID','Observation type','Unit','Occurrences'],[[
        code(stream.key),pre(stream.id),code(stream.observationType),pre(stream.unit),number(stream.rows)]])+
      table(['Numeric-eligible original instants','Excluded from numeric view','Source-time forms','Quality-field presence'],[[
        number(stream.numericEligibleRows),pre(stream.numericExclusionReasons),pre(stream.timeKinds),pre(stream.qualityStates)]])+
      '<details><summary>Original stream metadata, geometry and native compatibility</summary>'+pre(stream)+'</details>';
    const all=categories(stream),shown=all.slice(0,30);
    if(all.length)out+='<h3>Literal category counts</h3>'+table(['Original string','Occurrence count'],shown.map(([k,n])=>[esc(k),number(n)]))+
      (all.length>shown.length?para('The readable table displays '+shown.length+' of '+all.length+' categories. Every category/count remains in selected-view.json.'):'');
  }
  out+='</section><section id="views"><h2>Source-derived views</h2>'+
    para('The views below are generated from the selected original data. Supplied native Helgoland output is listed separately in the evidence section.')+
    para('Preview order follows the retained source. Each stream shows at most '+PREVIEW_PER_STREAM+' placed events and '+PREVIEW_PER_STREAM+' eligible numeric points; the CSV and NDJSON include all '+number(s.totalOccurrences)+' selected occurrences.')+
    charts.events+charts.numeric+charts.map+
    '<h3>Original row preview</h3>'+para('First '+render.rows.length+' retained occurrences; all original fields and rows are included in observations.csv and observations.ndjson.')+
    para('Quality-field presence counts describe whether a field was supplied, null or missing. The declarations below are the exact publisher-supplied resultQuality payloads; they are not independent quality approval.')+
    table(['Stream / observation','Phenomenon time','Result / type','Publisher quality declaration / presence','Original source position'],render.rows.map(r=>[
      code(r.stream_key)+'<br>'+code({type:r.observation_id_type,value:r.observation_id}),esc(r.phenomenon_time)+'<br>'+esc(r.phenomenon_time_kind),
      esc(short(displayValue(r),250))+'<br>'+esc(r.result_type)+' / '+esc(r.result_state),code(r.result_quality)+'<br>'+esc(r.result_quality_state),
      code(r.source_page_sha256)+'<br>'+code(r.source_pointer)]))+'</section>'+
    '<section id="annotations"><h2>Attributed operator annotations</h2>'+para(ANALYSIS_MEANING.authority);
  if(!v.annotations.length)out+=para('No operator annotations were selected.');
  for(const a of v.annotations)out+='<article><h3>'+esc(a.kind)+' · '+esc(a.status)+'</h3>'+para(a.text)+
    para('Recorded '+a.recordedAt+' · '+a.actor)+
    table(['Original cited edition','Source bytes / pointer','Occurrence'],a.refs.map(r=>[code(r.editionId),sourceRef(r),code(r.occurrenceId??null)]))+'</article>';
  out+='</section><section id="comparison"><h2>Retained-edition comparisons</h2>'+para(ANALYSIS_MEANING.comparison);
  if(!comparisons.length)out+=para('No saved comparison was selected for this publication.');
  for(const c of comparisons){
    out+='<h3>Comparison '+esc(c.id)+'</h3>'+
      table(['Left edition','Right edition','Query compatibility','Recorded by'],[[code(c.leftEditionId),code(c.rightEditionId),esc(String(c.sourceQueryCompatible)),esc(c.actor)]])+
      pre(c.counts)+para(c.note)+comparisonContextHTML(c)+para('Complete original changes and unkeyed occurrences are retained in comparison-'+c.id+'.json.')+
      table(['Original key','Observed difference','Left occurrences','Right occurrences'],c.changes.slice(0,30).map(x=>[
        code(x.key),esc(x.state),pre(x.left),pre(x.right)]))+
      (c.changes.length>30?para('The readable preview shows 30 of '+c.changes.length+' changed/one-sided/ambiguous keys. The accompanying comparison file is complete.'):'');
  }
  out+='</section><section id="evidence"><h2>Supplied viewer evidence</h2>'+
    para('These files were explicitly selected from the original host inbox and bound to this saved version. Their attributed titles and notes remain with the exact retained bytes.');
  if(!evidence.length)out+=para('No native viewer evidence file was supplied with this publication.');
  for(let i=0;i<evidence.length;i++){
    const original=evidence[i],file=evidenceFiles[i],image=images.get(file.name);
    out+='<h3>'+esc(original.title)+'</h3>'+para(original.note)+para('Recorded '+original.createdAt+' · '+original.actor)+
      table(['Original evidence ID','Version','File','Exact SHA256','Bytes'],[[code(original.id),code(original.versionId),download(file),code(file.sha256),number(file.bytes)]]);
    if(image)out+='<figure><img alt="'+esc(original.title)+'" src="'+image+'"><figcaption>'+esc(file.name)+' · '+esc(file.sha256)+'</figcaption></figure>';
  }
  out+='</section><section id="files"><h2>Complete publication files</h2>'+
    table(['File','Media type','Bytes','SHA256'],files.map(f=>[download(f),esc(f.type),number(f.bytes),code(f.sha256)]))+
    para('publication-manifest.json binds this full saved selection and every preceding file. The report and manifest are additional files; their own exact hashes are in the native publication record.')+
    '<h3>Original source members</h3>'+table(['Role / media type','Bytes','SHA256'],e.sourceFiles.map(f=>[esc(f.role??f.mediaType??''),number(f.bytes),code(f.sha256)]))+
    para('The project transfer contains the complete raw source and viewer-asset closure, editable saved versions and publication/receiving history. It does not create a new source capture or adopt a scientific review on the receiver.')+
    '</section><footer><h2>Interpretation</h2>'+Object.values(ANALYSIS_MEANING).map(para).join('')+
    '<p class="subtle">Generated by the retained SensorThings analysis publisher. The source edition, exact data files and attributed decisions remain available for review.</p></footer></main></body></html>';
  return out;
}
async function copyEvidence(store,item,{operationId,createdAt,versionId,index}){
  const original=item.file,path=retainedPath(store,original),ext=original.name.includes('.')?'.'+original.name.split('.').at(-1).replace(/[^A-Za-z0-9]/g,'').slice(0,12):'.bin',
    filename='evidence-'+String(index+1).padStart(3,'0')+'-'+item.id.slice(0,16)+ext;
  const held=await openPrivateFile(path,{expectedBytes:original.bytes,maximum:32*1024*1024});
  async function* parts(){
    const buffer=Buffer.alloc(65536);let offset=0;
    while(offset<original.bytes){const r=await held.handle.read(buffer,0,Math.min(buffer.length,original.bytes-offset),offset);
      if(!r.bytesRead)throw fault('ANALYSIS_EVIDENCE','An original evidence file ended early.',409);
      offset+=r.bytesRead;yield Buffer.from(buffer.subarray(0,r.bytesRead));}
    await hashHeldFile(held.handle,{expectedBytes:original.bytes,expectedSha256:original.sha256,maximum:32*1024*1024});
  }
  try{
    await hashHeldFile(held.handle,{expectedBytes:original.bytes,expectedSha256:original.sha256,maximum:32*1024*1024});
    return await retainStream(store,parts(),{operationId,createdAt,filename,type:original.type,
      inputIdentity:{versionId,evidenceId:item.id,originalFile:original},maximum:32*1024*1024});
  }finally{await held.handle.close();}
}
async function embeddedImages(store,files){
  const images=new Map();let used=0;
  for(const f of files){
    if(!['image/png','image/jpeg'].includes(f.type)||f.bytes>4*1024*1024||used+f.bytes>MAX_INLINE_EVIDENCE)continue;
    const held=await openPrivateFile(retainedPath(store,f),{expectedBytes:f.bytes,maximum:4*1024*1024});
    try{
      await hashHeldFile(held.handle,{expectedBytes:f.bytes,expectedSha256:f.sha256,maximum:4*1024*1024});
      const data=Buffer.alloc(f.bytes);let offset=0;
      while(offset<data.length){const r=await held.handle.read(data,offset,data.length-offset,offset);if(!r.bytesRead)throw fault('ANALYSIS_EVIDENCE','The selected image ended early.',409);offset+=r.bytesRead;}
      if(sha(data)!==f.sha256)throw fault('ANALYSIS_EVIDENCE','The selected image changed.',409);
      images.set(f.name,'data:'+f.type+';base64,'+data.toString('base64'));used+=data.length;
    }finally{await held.handle.close();}
  }
  return images;
}
export async function preparePublication(store,{version,edition,summary,comparisons,evidence,review,operationId,createdAt,title,actor,note}){
  validateSourceEdition(edition);
  const {id:versionId,...body}=version;
  if(!HASH.test(versionId??'')||identity(body)!==versionId||version.schema!==ANALYSIS_SCHEMA||version.editionId!==edition.id||
    summary.editionId!==edition.id||stable(summary.selection)!==stable(version.selection)||!Array.isArray(summary.streams)||
    !OP.test(operationId??'')||typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt))||
    typeof title!=='string'||!title.trim()||typeof actor!=='string'||!actor.trim()||!plain(review)||review.editionId!==edition.id||review.decision!=='accept')
    throw fault('ANALYSIS_PUBLICATION','Bind publication to the exact saved source selection and accepted original review.',409);
  if(!Array.isArray(comparisons)||!Array.isArray(evidence)||comparisons.some(c=>c.versionId!==versionId||c.projectId!==version.projectId)||
    evidence.some(e=>e.versionId!==versionId||e.projectId!==version.projectId))
    throw fault('ANALYSIS_PUBLICATION','Use only saved comparisons/evidence belonging to this exact view.',409);
  const selected={version:structuredClone(version),edition:structuredClone(edition),summary:structuredClone(summary),
    comparisons:structuredClone(comparisons),evidence:structuredClone(evidence),review:structuredClone(review),createdAt,title,actor,note:note??''},
    basis={versionId,editionId:edition.id,summarySha256:sha(json(summary)),reviewSha256:identity(review),
      comparisonIds:comparisons.map(c=>c.id),evidenceIds:evidence.map(e=>e.id),title,actor,note:note??''},
    files=[],render=initRendering(summary);
  const put=async(filename,body,type)=>{const f=await retainBytes(store,body,{operationId,createdAt,filename,type,inputIdentity:basis});files.push(f);return f;};
  files.push(await retainStream(store,selectedCSV(store,edition,version.selection),{operationId,createdAt,filename:'observations.csv',
    type:'text/csv; charset=utf-8',inputIdentity:basis}));
  async function* rows(){
    for await(const {row,original,streamKey}of selectedRows(store,edition,version.selection)){
      captureRendering(render,row,streamKey);
      yield Buffer.from(JSON.stringify({row:{...row,stream_key:streamKey},source:original.sourceRef,occurrenceId:original.occurrenceId,semanticHash:original.semanticHash})+'\n');
    }
  }
  // A completed retainStream may return before consuming the iterator. Rebuild
  // this small deterministic rendering separately on an original-operation replay.
  const rowFile=await retainStream(store,rows(),{operationId,createdAt,filename:'observations.ndjson',type:'application/x-ndjson; charset=utf-8',inputIdentity:basis});
  files.push(rowFile);
  if(render.total===0&&summary.totalOccurrences>0)
    for await(const {row,streamKey}of selectedRows(store,edition,version.selection))captureRendering(render,row,streamKey);
  if(render.total!==summary.totalOccurrences)throw fault('ANALYSIS_PUBLICATION','The saved summary and complete original rows differ.',409);
  const charts={events:eventChart(summary,version.selection,render),numeric:numericChart(summary,version.selection,render),map:mapChart(summary)};
  await put('events.svg',Buffer.from(charts.events),'image/svg+xml');
  await put('numeric.svg',Buffer.from(charts.numeric),'image/svg+xml');
  await put('locations.svg',Buffer.from(charts.map),'image/svg+xml');
  await put('selected-view.json',json({schema:'stellar-forge.sensorthings-analysis-publication-selection.v1',version,edition,summary,review,
    rendering:renderingSummary(render),meaning:ANALYSIS_MEANING}),'application/json');
  for(const c of comparisons)await put('comparison-'+c.id+'.json',json(c),'application/json');
  const evidenceFiles=[];
  for(let i=0;i<evidence.length;i++){const f=await copyEvidence(store,evidence[i],{operationId,createdAt,versionId,index:i});evidenceFiles.push(f);files.push(f);}
  const images=await embeddedImages(store,evidenceFiles),
    report=await put('analysis-brief.html',Buffer.from(briefHTML(selected,render,charts,[...files],evidenceFiles,images)),'text/html; charset=utf-8');
  const manifest={schema:'stellar-forge.sensorthings-analysis-publication-manifest.v1',id:operationId,projectId:version.projectId,versionId,
    editionId:edition.id,createdAt,title,actor,note:note??'',basis,selection:structuredClone(version.selection),
    source:{serviceUrl:edition.source.serviceUrl,license:structuredClone(edition.source.license),scope:structuredClone(edition.scope),
      issues:structuredClone(edition.issues),files:structuredClone(edition.sourceFiles)},
    sourceReview:structuredClone(review),viewerId:version.selection.viewerId,
    evidence:evidence.map((e,i)=>({record:structuredClone(e),publishedFile:evidenceFiles[i]})),
    rendering:renderingSummary(render),meaning:ANALYSIS_MEANING,files:structuredClone(files)};
  const manifestFile=await put('publication-manifest.json',json(manifest),'application/json');
  return {schema:PUBLICATION_SCHEMA,id:operationId,projectId:version.projectId,versionId,editionId:edition.id,
    createdAt,title,actor,note:note??'',selection:structuredClone(version.selection),sourceReview:structuredClone(review),
    sourceReviewSha256:basis.reviewSha256,source:{serviceUrl:edition.source.serviceUrl,license:structuredClone(edition.source.license),scope:structuredClone(edition.scope)},
    viewerId:version.selection.viewerId,evidenceIds:evidence.map(x=>x.id),comparisonIds:comparisons.map(x=>x.id),
    rendering:renderingSummary(render),reportFile:report.name,manifestFile:manifestFile.name,manifestSha256:identity(manifest),
    files:structuredClone(files),meaning:ANALYSIS_MEANING};
}
