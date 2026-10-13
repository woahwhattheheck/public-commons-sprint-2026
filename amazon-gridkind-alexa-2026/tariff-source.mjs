import {createHash} from 'node:crypto';
import {dateAt,weekInputs,inspectWeek} from './weekly.mjs';

export const TARIFF_SCHEMA='gridkind-tariff-source/v1';
export const TARIFF_LIMITS=Object.freeze({bytes:1048576,rows:10000,columns:64,cell:4000});
const clone=value=>structuredClone(value);
function need(ok,message){if(!ok)throw Error(message);}
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
export const tariffDigest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function text(value,label,max,{blank=false}={}){
  need(typeof value==='string'&&value.length<=max&&!/[\u0000\uD800-\uDFFF]/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g,'')),label+' is invalid.');
  need(blank||value.trim().length>0,label+' is required.');return value;
}
/** RFC4180-style CSV. Original text is retained; CR/LF in quoted fields stay exact. */
export function parseTariffCSV(raw){
  text(raw,'CSV source',TARIFF_LIMITS.bytes);
  need(Buffer.byteLength(raw,'utf8')<=TARIFF_LIMITS.bytes,'CSV source exceeds 1 MiB.');
  const source=raw.charCodeAt(0)===0xfeff?raw.slice(1):raw,records=[];
  let cells=[],cell='',quoted=false,closed=false,line=1,start=1,i=0;
  function field(){need(cell.length<=TARIFF_LIMITS.cell,'A CSV cell exceeds 4000 characters.');cells.push(cell);cell='';closed=false;need(cells.length<=TARIFF_LIMITS.columns,'CSV exceeds 64 columns.');}
  function record(){field();records.push({cells,line:start});cells=[];need(records.length<=TARIFF_LIMITS.rows+1,'CSV exceeds 10,000 data records.');}
  while(i<source.length){
    const c=source[i++];
    if(quoted){
      if(c==='"'){if(source[i]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}
      else{cell+=c;if(c==='\n'||c==='\r'&&source[i]!=='\n')line++;}
    }else if(c==='"'){need(!closed&&cell==='','Unexpected quote at CSV line '+line+'.');quoted=true;}
    else if(c===','){field();}
    else if(c==='\r'||c==='\n'){if(c==='\r'&&source[i]==='\n')i++;record();line++;start=line;}
    else{need(!closed,'Unexpected text after quoted field at CSV line '+line+'.');cell+=c;}
    need(cell.length<=TARIFF_LIMITS.cell,'A CSV cell exceeds 4000 characters.');
  }
  need(!quoted,'Unclosed quoted CSV field.');
  if(cell!==''||cells.length||closed)record();
  need(records.length>=2,'Supply a header and at least one data record.');
  const headers=records.shift().cells;
  need(headers.every(v=>v.length>0&&v.length<=200)&&new Set(headers).size===headers.length,'CSV headers must be nonempty, unique and at most 200 characters; map their exact names.');
  return {headers,records};
}
function decimal(token,unit){
  const s=token.trim();need(s.length<=64&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s),'Use an unsigned decimal price without currency marks or exponent.');
  let [whole,fraction='']=s.split('.');whole=whole||'0';
  need(fraction.length<=12,'Source prices support at most 12 decimal places.');
  let digits=(whole+fraction).replace(/^0+(?=\d)/,'');let places=fraction.length+(unit==='cents/kWh'?2:0);
  while(digits.length<=places)digits='0'+digits;
  let exact=places?digits.slice(0,-places)+'.'+digits.slice(-places):digits;
  exact=exact.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
  const value=Number(exact);need(Number.isFinite(value)&&value>=0&&value<=10,'The maintained planner supports prices from 0 through 10 USD/kWh.');
  return {exact,value};
}
export function tariffSourceInput(input){
  need(input&&typeof input==='object'&&!Array.isArray(input),'Supply the original source fields.');
  const filename=text(input.filename,'Filename',200),title=text(input.title,'Title',100).trim();
  const sourceUrl=text(input.sourceUrl??'','Source URL',2000,{blank:true}),note=text(input.note??'','Source note',4000,{blank:true});
  need(!/[\x00-\x1f\x7f]/.test(filename+title),'Filename and title must be printable.');
  need(!sourceUrl||/^https?:\/\/[^\s]+$/i.test(sourceUrl),'Source URL must be empty or an HTTP(S) URL; it is retained without fetching.');
  need(['user_supplied','authored_example'].includes(input.role),'Identify a user-supplied source or authored example.');
  need(['USD/kWh','cents/kWh'].includes(input.unit),'Explicitly choose USD/kWh or cents/kWh.');
  need(input.clockBasis==='nominal-local-24h','Confirm nominal local dates and hours 00–23. No timezone conversion or daylight-saving repair is performed.');
  const mapping=input.mapping;need(mapping&&['date','hour','price'].every(k=>typeof mapping[k]==='string')&&new Set(Object.values(mapping)).size===3,'Map three distinct date, hour and price columns.');
  return {filename,title,sourceUrl,note,role:input.role,unit:input.unit,clockBasis:input.clockBasis,
    mapping:{date:mapping.date,hour:mapping.hour,price:mapping.price},csv:input.csv};
}
export function previewTariff(input){
  const source=tariffSourceInput(input),parsed=parseTariffCSV(source.csv),indices=Object.fromEntries(Object.entries(source.mapping).map(([k,name])=>[k,parsed.headers.indexOf(name)]));
  need(Object.values(indices).every(n=>n>=0),'A mapped column is absent from the original CSV header.');
  const rows=parsed.records.map((record,index)=>{
    const tokens={date:record.cells[indices.date]??'',hour:record.cells[indices.hour]??'',price:record.cells[indices.price]??''};
    const row={sourceRow:index+2,sourceLine:record.line,tokens,date:null,hour:null,exactUsdPerKwh:null,value:null,issues:[]};
    if(record.cells.length!==parsed.headers.length)row.issues.push('column_count');
    try{row.date=dateAt(tokens.date.trim());}catch{row.issues.push('invalid_date');}
    if(/^(?:[0-9]|[01][0-9]|2[0-3])$/.test(tokens.hour.trim()))row.hour=Number(tokens.hour.trim());else row.issues.push('invalid_hour');
    try{const p=decimal(tokens.price,source.unit);row.exactUsdPerKwh=p.exact;row.value=p.value;}catch(error){row.issues.push(error.message);}
    return row;
  });
  const days=new Map();
  for(const row of rows){if(row.date&&!days.has(row.date))days.set(row.date,{count:0,hours:Array.from({length:24},()=>[])});if(row.date){days.get(row.date).count++;if(row.hour!==null)days.get(row.date).hours[row.hour].push(row);}}
  const coverage=[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,{count,hours}])=>({
    date,rows:count,knownHours:hours.filter(r=>r.length===1&&!r[0].issues.length).length,
    missingHours:hours.flatMap((r,h)=>r.length?[]:[h]),duplicateHours:hours.flatMap((r,h)=>r.length>1?[h]:[]),
    invalidHours:hours.flatMap((r,h)=>r.some(v=>v.issues.length)?[h]:[])}));
  const sourceSha256=createHash('sha256').update(source.csv,'utf8').digest('hex');
  const edition={schema:TARIFF_SCHEMA,source:{...source,bytes:Buffer.byteLength(source.csv,'utf8'),sha256:sourceSha256},headers:parsed.headers,rows,
    summary:{rows:rows.length,invalidRows:rows.filter(r=>r.issues.length).length,dates:coverage.length,
      completeDays:coverage.filter(d=>d.knownHours===24).length,coverage},
    interpretation:'Nominal local 24-hour days, explicitly supplied units; no timezone, daylight-saving, utility entitlement, taxes or fixed-charge inference. The existing planner uses JavaScript numbers; original decimal strings remain retained.'};
  return {...edition,sha256:tariffDigest(edition)};
}
export function inspectTariff(edition){
  need(edition?.schema===TARIFF_SCHEMA,'Unknown tariff source edition.');
  const expected=previewTariff(edition.source);
  need(tariffDigest(expected)===tariffDigest(edition),'Tariff source, parsed rows or retained interpretation changed.');return edition;
}
export function tariffWeekInput(edition,week){
  inspectTariff(edition);const base=weekInputs(week),byKey=new Map(),selected=[],errors=[];
  for(const row of edition.rows){if(row.date&&row.hour!==null){const key=row.date+':'+row.hour;byKey.set(key,[...(byKey.get(key)||[]),row]);}}
  const input=clone(base);
  for(let d=0;d<7;d++){
    const date=dateAt(base.startDate,d);
    for(let hour=0;hour<24;hour++){
      const candidates=byKey.get(date+':'+hour)||[];
      if(candidates.length!==1||candidates[0].issues.length){errors.push({date,hour,status:candidates.length===0?'missing':candidates.length>1?'duplicate':'invalid',sourceRows:candidates.map(r=>r.sourceRow)});continue;}
      const row=candidates[0];input.days[d].scenario.prices[hour]=row.value;
      selected.push({date,hour,sourceRow:row.sourceRow,sourceLine:row.sourceLine,originalPrice:row.tokens.price,exactUsdPerKwh:row.exactUsdPerKwh,previousUsdPerKwh:base.days[d].scenario.prices[hour]});
    }
  }
  return {schema:'gridkind-tariff-week-preview/v1',complete:errors.length===0,startDate:base.startDate,unit:'USD/kWh',clockBasis:edition.source.clockBasis,
    sourceSha256:edition.source.sha256,editionSha256:edition.sha256,selectedRows:selected,errors,
    unselectedRows:edition.rows.length-selected.length,invalidUnselectedRows:edition.rows.filter(r=>r.issues.length&&!selected.some(s=>s.sourceRow===r.sourceRow)).length,
    input:errors.length?null:weekInputs(input),preserved:'All seven enabled/rest flags, load identities, labels, power, durations, windows, quiet flags, circuit caps and week name/date are retained. Prices are replaced only after explicit application.'};
}
export function tariffWeekPreview(tariffRecord,targetRecord){
  need(tariffRecord?.kind==='tariff'&&targetRecord?.kind==='week','Choose a saved tariff source and saved week.');
  inspectWeek(targetRecord.detail?.report);
  const preview=tariffWeekInput(tariffRecord.detail.edition,targetRecord.detail.report.input);
  const bound={...preview,tariffId:tariffRecord.id,tariffSha256:tariffRecord.sha256,targetId:targetRecord.id,targetSha256:targetRecord.sha256};
  return {...bound,sha256:tariffDigest(bound)};
}
function csvCell(value){let s=value===null?'':String(value);if(/^[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function tariffRowsCSV(edition){
  inspectTariff(edition);
  const rows=[['Source row','Source line','Original date','Original hour','Original price','Original unit','Nominal date','Hour','Exact USD/kWh','Issues'],
    ...edition.rows.map(r=>[r.sourceRow,r.sourceLine,r.tokens.date,r.tokens.hour,r.tokens.price,edition.source.unit,r.date,r.hour,r.exactUsdPerKwh,r.issues.join('; ')])];
  return rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function tariffHTML(record){
  need(record?.kind==='tariff','Choose a saved tariff source.');const edition=inspectTariff(record.detail.edition),s=edition.source;
  function table(headers,rows){return '<div class="scroll"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(s.title)+' — GridKind source</title><style>body{font:16px/1.5 Arial,sans-serif;color:#20252a;background:#fff;margin:0}main{max-width:1100px;margin:auto;padding:28px}h1{font-size:30px}h2{margin-top:32px}.note{background:#f0f2f4;padding:16px;border-left:4px solid #65717b}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;border:1px solid #d6dadd;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#edf0f2}code{overflow-wrap:anywhere}dt{font-weight:bold}dd{margin:0 0 12px;overflow-wrap:anywhere}@media print{body{font-size:11pt}main{padding:0}thead{display:table-header-group}tr{break-inside:avoid}.scroll{overflow:visible}table{font-size:9pt}}</style><main><p>GridKind / Retained tariff source</p><h1>'+esc(s.title)+'</h1><p class="note">'+esc(edition.interpretation)+'</p><dl>'+
    [['Record',record.id],['Saved at',record.createdAt],['Filename',s.filename],['Source role',s.role],['Source URL',s.sourceUrl||'Not supplied'],['Source note',s.note||'Not supplied'],['Original unit',s.unit],['Clock basis',s.clockBasis],['Original bytes',s.bytes],['Original SHA-256',s.sha256],['Edition SHA-256',edition.sha256],['Record SHA-256',record.sha256]].map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl><h2>Daily coverage</h2><p>'+edition.summary.rows+' original data records; '+edition.summary.invalidRows+' invalid records; '+edition.summary.completeDays+' complete nominal days. A selected week needs exactly one valid price in every hour, including retained rest days.</p>'+
    table(['Date','Rows','Known hours','Missing hours','Duplicate hours','Invalid hours'],edition.summary.coverage.map(d=>[d.date,d.rows,d.knownHours,d.missingHours.join(', '),d.duplicateHours.join(', '),d.invalidHours.join(', ')]))+
    '<h2>All original row references</h2><p>All '+edition.rows.length+' parsed records are shown. Original CSV bytes and the complete source edition are available from the original GridKind source workspace and household recovery file. Spreadsheet-facing normalized CSV escapes formula-leading text; the original source stays exact.</p>'+
    table(['Record / line','Original date','Original hour','Original price','Exact USD/kWh','Issues'],edition.rows.map(r=>[r.sourceRow+' / '+r.sourceLine,r.tokens.date,r.tokens.hour,r.tokens.price,r.exactUsdPerKwh??'Unknown',r.issues.join('; ')||'Valid']))+
    '<p class="note">This retained file records supplied prices and parsing. It is not evidence of a utility tariff contract, a billed amount, device operation or realized savings.</p></main></html>';
}
