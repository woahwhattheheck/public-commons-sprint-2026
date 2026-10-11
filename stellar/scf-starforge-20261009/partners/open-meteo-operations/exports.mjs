// MIT. Frozen source/decision report, ordinary CSV/HTML, and a create-only ZIP.
import {spawn} from 'node:child_process';
import {publish} from './files.mjs';
import {need,encoded,sha,VARIABLES,ATTRIBUTION,localTimestamp} from './contract.mjs';
import {series} from './analysis.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function csvCell(value){
 if(value===null||value===undefined)return '';
 if(typeof value==='number'){need(Number.isFinite(value),'NONFINITE_CSV');return String(value);}
 let s=String(value);if(/^[\s]*[=+\-@]/.test(s))s="'"+s;
 return '"'+s.replaceAll('"','""')+'"';
}
const csvRow=values=>values.map(csvCell).join(',')+'\r\n';
const number=value=>value===null||value===undefined?'Not available':Number(value).toLocaleString('en',{maximumFractionDigits:4});
export function seriesCsv(capture){
 const fixed=['capture_id','source_sha256','family','model','requested_latitude','requested_longitude','grid_latitude','grid_longitude','utc','local_time','utc_offset','iana_timezone'];
 const columns=capture.view.columns,rows=[csvRow([...fixed,...columns.map(c=>c.key+' ['+c.unit+'] ('+c.interval+')')])];let bytes=Buffer.byteLength(rows[0]);
 for(let i=0;i<capture.view.times.length;i++){
  const t=localTimestamp(capture.view.times[i],capture.metadata.timezone);
  const line=csvRow([capture.id,capture.sha256,capture.metadata.family,capture.metadata.model,capture.metadata.requested.latitude,capture.metadata.requested.longitude,
   capture.metadata.grid.latitude,capture.metadata.grid.longitude,t.utc,t.local,t.offset,t.timezone,...columns.map(c=>c.values[i])]);
  bytes+=Buffer.byteLength(line);need(bytes<=32*1024*1024,'REPORT_ENTRY_TOO_LARGE');rows.push(line);
 }
 return Buffer.from(rows.join(''));
}
export function chartSvg(capture,variable,{unit,width=880,height=230}={}){
 const data=series(capture.view,variable,{unit,limit:2000}),available=data.rows.filter(r=>r.median!==null);
 if(!available.length)return '<p>No returned values for this variable.</p>';
 const values=available.flatMap(r=>[r.min,r.max]),low=Math.min(...values),high=Math.max(...values),span=high-low||1;
 const first=data.rows[0].epoch,last=data.rows.at(-1).epoch,range=last-first||3600;
 const x=t=>52+(t-first)/range*(width-72),y=v=>height-36-(v-low)/span*(height-64);
 let path='',band='',segment=[];
 const finish=()=>{if(!segment.length)return;
  path+=segment.map((r,i)=>(i?'L':'M')+x(r.epoch).toFixed(2)+' '+y(r.median).toFixed(2)).join(' ')+' ';
  band+='M'+segment.map(r=>x(r.epoch).toFixed(2)+' '+y(r.p90).toFixed(2)).join(' L')+
   ' L'+[...segment].reverse().map(r=>x(r.epoch).toFixed(2)+' '+y(r.p10).toFixed(2)).join(' L')+' Z ';segment=[];};
 let previous;
 for(const r of data.rows){if(r.median===null||previous!==undefined&&r.epoch-previous!==3600)finish();if(r.median!==null)segment.push(r);previous=r.epoch;}finish();
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+escape(VARIABLES[variable].title+' median and p10–p90 of returned values')+'">'+
  '<rect width="100%" height="100%" fill="#fff"/><path d="M52 20 V'+(height-36)+' H'+(width-20)+'" fill="none" stroke="#999"/>'+
  '<path d="'+band+'" fill="#ddd"/><path d="'+path+'" fill="none" stroke="#222" stroke-width="2"/>'+
  '<g font-family="system-ui,sans-serif" font-size="12" fill="#333"><text x="5" y="25">'+escape(number(high))+'</text><text x="5" y="'+(height-37)+'">'+escape(number(low))+'</text>'+
  '<text x="52" y="'+(height-10)+'">'+escape(data.rows[0].utc)+'</text><text x="'+(width-20)+'" y="'+(height-10)+'" text-anchor="end">'+escape(data.rows.at(-1).utc)+'</text></g></svg>';
}
export function reportHtml(report,captures){
 const byId=new Map(captures.map(c=>[c.id,c]));
 const content=report.decisions.map(d=>{
  const capture=byId.get(d.captureId);need(capture,'REPORT_SOURCE_MISSING');const result=d.result,r=result.rule;
  return '<section><h2>'+escape(d.title)+'</h2><p class="sub">'+escape(d.owner)+' · revision '+d.revision+' · '+escape(d.disposition)+'</p>'+
   '<div class="metric"><strong>'+escape(result.outcome.replaceAll('_',' '))+'</strong><span>'+result.thresholdMembers+' / '+result.eligibleMembers+' eligible members meet the threshold</span></div>'+
   '<p>'+escape(VARIABLES[r.variable].title)+' · '+escape(r.aggregation)+' '+escape(r.operator==='gte'?'≥':'≤')+' '+escape(number(r.threshold))+' '+escape(r.unit)+'</p>'+
   '<p>'+escape(r.startUtc)+' to '+escape(r.endUtc)+'<br>'+escape(result.windowConvention)+'</p>'+
   chartSvg(capture,r.variable,{unit:r.unit})+
   '<dl><dt>Available model columns</dt><dd>'+result.returnedColumns+'</dd><dt>Expected samples per member</dt><dd>'+result.expectedSamples+'</dd>'+
   '<dt>Minimum coverage</dt><dd>'+number(r.minimumCoverage*100)+'%</dd><dt>Aggregate p10 / median / p90</dt><dd>'+[result.aggregate.p10,result.aggregate.median,result.aggregate.p90].map(number).join(' / ')+' '+escape(r.unit)+'</dd>'+
   '<dt>Interpretation</dt><dd>'+escape(result.memberFractionMeaning)+'</dd><dt>Operator notes</dt><dd>'+escape(d.notes)+'</dd></dl>'+
   '<details><summary>Member coverage and evaluation</summary><table><thead><tr><th>Member</th><th>Available / expected</th><th>Coverage</th><th>Aggregate</th><th>Threshold</th></tr></thead><tbody>'+
   result.members.map(m=>'<tr><td>'+escape(m.member??'deterministic')+'</td><td>'+m.availableSamples+' / '+m.expectedSamples+'</td><td>'+number(m.coverage*100)+'%</td><td>'+number(m.aggregate)+'</td><td>'+escape(m.exceeded===null?'Insufficient coverage':m.exceeded?'Met':'Not met')+'</td></tr>').join('')+'</tbody></table></details></section>';
 }).join('');
 const sources=captures.map(c=>'<tr><td>'+escape(c.request.site.name)+'<br><small>'+escape(c.id)+'</small></td><td>'+escape(c.metadata.family)+'<br>'+escape(c.metadata.model)+'</td>'+
  '<td>'+escape(c.metadata.requested.latitude+', '+c.metadata.requested.longitude)+'<br>Grid '+escape(c.metadata.grid.latitude+', '+c.metadata.grid.longitude)+'</td>'+
  '<td>'+escape(c.metadata.timezone)+'<br>API offset '+c.metadata.apiUtcOffsetSeconds+' seconds</td><td>'+escape(c.provenance.kind)+'<br>'+escape(c.provenance.retrievedAt)+'</td><td class="digest">'+escape(c.sha256)+'</td></tr>').join('');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(report.title)+'</title>'+
  '<style>body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#eee;margin:0}main{max-width:1040px;margin:24px auto;padding:36px;background:white}h1{font-size:30px;margin:0}h2{font-size:21px}.sub,small{color:#555}.digest{font:11px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}.metric{border:1px solid #aaa;padding:16px;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}section{margin:32px 0;border-top:1px solid #aaa;padding-top:18px}dl{display:grid;grid-template-columns:200px 1fr;gap:8px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}th{background:#eee}svg{width:100%;height:auto}summary{cursor:pointer}a{color:#222}footer{border-top:1px solid #aaa;padding-top:18px;font-size:13px}@media(max-width:600px){main{margin:0;padding:18px}dl{grid-template-columns:1fr}table{display:block;overflow:auto}}@media print{body{background:white}main{margin:0;padding:0;max-width:none}details{display:block}section{break-inside:avoid}a{color:black}}</style></head><body><main>'+
  '<header><p class="sub">WEATHER OPERATIONS · FROZEN REPORT</p><h1>'+escape(report.title)+'</h1><p>'+escape(report.owner)+' · '+escape(report.createdAt)+'</p><p>'+escape(report.notes)+'</p>'+
  '<p class="digest">Report '+escape(report.id)+'<br>SHA-256 '+escape(report.sha256)+'</p></header>'+content+
  '<section><h2>Retained source selections</h2><table><thead><tr><th>Site</th><th>Product / model</th><th>Requested / selected grid</th><th>Time</th><th>Acquisition</th><th>Original response SHA-256</th></tr></thead><tbody>'+sources+'</tbody></table>'+
  '<p>Hourly timestamps are UTC epoch seconds. Local display uses each returned IANA time zone. The API fixed UTC offset is retained as source metadata; this report does not recast an API daily aggregation as a local calendar day.</p>'+
  '<p>Missing values remain missing. Historical reanalysis is model data. Forecast ensemble summaries describe returned members and do not assert calibrated probabilities. generationtime_ms describes API computation time, not forecast initialization.</p></section>'+
  '<footer><a href="'+ATTRIBUTION.url+'">Open-Meteo</a> · <a href="'+ATTRIBUTION.licenceUrl+'">'+ATTRIBUTION.licence+'</a><p>'+escape(ATTRIBUTION.modifications)+'</p><p>Archive sources contain the original JSON bytes, complete hourly CSV with every returned column, frozen decisions and a file manifest. Blank CSV value cells preserve source nulls; numerical zero remains 0.</p></footer></main></body></html>';
}
const ZIP_SCRIPT=[
 'import sys,json,zipfile',
 'source=sys.stdin.buffer',
 'total=0',
 'count=0',
 'with zipfile.ZipFile(sys.stdout.buffer,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=1) as archive:',
 ' while True:',
 '  line=source.readline(4097)',
 '  if not line: break',
 '  if len(line)>4096: raise ValueError("HEADER_LIMIT")',
 '  entry=json.loads(line)',
 '  name=entry["name"]; length=entry["bytes"]',
 '  if not isinstance(length,int) or length<0 or length>32*1024*1024: raise ValueError("ENTRY_LIMIT")',
 '  if not isinstance(name,str) or name.startswith("/") or "\\\\" in name or any(p in ("",".","..") for p in name.split("/")): raise ValueError("ENTRY_PATH")',
 '  total+=length; count+=1',
 '  if total>64*1024*1024 or count>128: raise ValueError("ARCHIVE_LIMIT")',
 '  info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED; info.external_attr=0o100600<<16',
 '  with archive.open(info,"w") as out:',
 '   remaining=length',
 '   while remaining:',
 '    chunk=source.read(min(65536,remaining))',
 '    if not chunk: raise ValueError("ENTRY_TRUNCATED")',
 '    out.write(chunk); remaining-=len(chunk)'
].join('\n');
async function zip(entries,{python='python3',signal}={}){
 const child=spawn(python,['-c',ZIP_SCRIPT],{stdio:['pipe','pipe','pipe'],signal});
 child.stdin.on('error',()=>{});child.stderr.resume();
 const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,exitSignal)=>code===0?resolve():reject(Object.assign(new Error('REPORT_ZIP_FAILED'),{code:exitSignal?'REPORT_ZIP_INTERRUPTED':'REPORT_ZIP_FAILED'})));});
 const feed=(async()=>{try{for await(const entry of entries){await new Promise((resolve,reject)=>child.stdin.write(Buffer.from(JSON.stringify({name:entry.name,bytes:entry.bytes.length})+'\n'),e=>e?reject(e):resolve()));
   await new Promise((resolve,reject)=>child.stdin.write(entry.bytes,e=>e?reject(e):resolve()));}child.stdin.end();}catch(error){child.stdin.destroy();throw error;}})();
 const output=(async()=>{const chunks=[];let length=0;for await(const chunk of child.stdout){length+=chunk.length;need(length<=32*1024*1024,'REPORT_ARCHIVE_TOO_LARGE');chunks.push(chunk);}return Buffer.concat(chunks);})();
 try{const [,result]=await Promise.all([feed,output,completion]);return result;}
 catch(error){child.kill('SIGKILL');await completion.catch(()=>{});await Promise.allSettled([feed,output]);throw error;}
}
async function* reportEntries(report,captures){
 const manifest=[],seen=new Set();
 const entry=(name,bytes)=>{need(!seen.has(name),'DUPLICATE_REPORT_FILE');seen.add(name);need(bytes.length<=32*1024*1024,'REPORT_ENTRY_TOO_LARGE');manifest.push({name,bytes:bytes.length,sha256:sha(bytes)});return {name,bytes};};
 yield entry('report.json',encoded(report));
 yield entry('report.html',Buffer.from(reportHtml(report,captures)));
 yield entry('decisions.json',encoded(report.decisions));
 for(const capture of captures){yield entry('sources/'+capture.id+'.json',capture.raw);yield entry('series/'+capture.id+'.csv',seriesCsv(capture));}
 yield {name:'manifest.json',bytes:encoded({schema:'stellar-forge.weather-report-files.v1',reportId:report.id,reportSha256:report.sha256,
  files:manifest,attribution:ATTRIBUTION})};
}
export async function frozenReportBytes(report,captures,{format='zip',python,signal}={}){
 need(['zip','html','json'].includes(format),'REPORT_FORMAT_INVALID');
 const expected=new Map(report.captures.map(c=>[c.id,c]));
 need(captures.length===expected.size,'REPORT_SOURCE_SELECTION_CHANGED');
 for(const c of captures){const original=expected.get(c.id);need(original&&original.sha256===sha(c.raw)&&original.sha256===c.sha256&&original.specSha256===c.specSha256,'REPORT_SOURCE_CHANGED');expected.delete(c.id);}
 need(expected.size===0,'REPORT_SOURCE_SELECTION_CHANGED');
 if(format==='json')return encoded(report);
 if(format==='html')return Buffer.from(reportHtml(report,captures));
 return zip(reportEntries(report,captures),{python,signal});
}
export async function exportFrozenReport(report,captures,{output,...options}){
 const bytes=await frozenReportBytes(report,captures,options);
 return {...await publish(output,bytes),reportId:report.id,reportSha256:report.sha256,format:options.format??'zip'};
}
