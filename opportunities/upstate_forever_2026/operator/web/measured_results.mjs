/** Read-only presentation of original immutable Measurements snapshots. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const array = value => Array.isArray(value) ? value : [];
const cell = value => value === null || value === undefined || value === '' ? 'Not supplied' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const title = value => String(value ?? '').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[-_]/g,' ').replace(/^./,c=>c.toUpperCase());
const REASONS = {
  'reach-unassigned':'No reviewed station-to-reach assignment.',
  'native-domain-unbound':'The original model reach identifiers have not been bound.',
  'native-domain-edition-changed':'The selected native reach source changed after the assignment.',
  'censored-result':'A detection limit or other censoring condition is retained; no point-value substitution was made.',
  'missing-numeric-result':'The source does not supply a usable numeric result.',
  'unmapped-constituent':'This constituent is outside the current native calibration-input parameter list; the original observation remains available.',
  'unmapped-characteristic-or-fraction':'The characteristic or fraction has no supported constituent mapping.',
  'unrecognized-unit':'The reported unit has no admitted normalization.',
  'negative-concentration':'A negative concentration requires source review.',
  'negative-detection-limit':'The source detection limit is negative.',
  'invalid-station-coordinate':'The reported station coordinate is invalid.',
  'non-water-or-unspecified-medium':'The sample medium is not confirmed as water.',
  'quality-control-sample':'The source identifies a quality-control sample.',
  'derived-source-value':'The source identifies a derived value.',
  'review-detection-condition':'The reported detection condition requires review.',
  'review-excluded':'A retained reviewer decision excludes this observation.',
  'review-required':'The retained quality flags still require a reviewer decision.',
  'superseded-by-explicit-selection':'A reviewer selected another source revision.',
  'source-revision-conflict':'Conflicting source revisions have no explicit selection.',
  'ambiguous-daily-flow':'More than one eligible daily-flow observation matches this source date.',
  'no-matching-daily-flow':'No eligible daily-flow observation matches this source date.',
  'censor-limit-unresolved':'The censored result has no resolved numeric bound.',
  'qualified-result':'The original result includes a qualification.',
  'review-source-status':'The source result status requires review.',
  'unit-from-single-detection-limit':'The unit was supplied by the single retained detection-limit record.'
};
export function reasonText(code) { return REASONS[code] || title(code); }
export function reasonList(values) {
  return array(values).length ? array(values).map(x => reasonText(x) + ' [' + x + ']').join(' ') : 'None recorded';
}
const pairColumns = [
 ['measurementId','Chemistry observation'],['flowMeasurementId','Flow observation'],['date','Source calendar date'],
 ['stationId','Chemistry station'],['flowStationId','Discharge station'],['parameter','Constituent'],
 ['basis','Chemical basis'],['fraction','Sample fraction'],['concentrationMgL','Concentration (mg/L)'],
 ['censor','Censoring'],['flowM3s','Daily mean discharge (m³/s)'],
 ['estimatedKgPerDay','Daily-equivalent rate (kg/day)'],['lowerKgPerDay','Lower bound (kg/day)'],
 ['upperKgPerDay','Upper bound (kg/day)'],['temporalSupport','Temporal support'],['rationale','Pairing rationale'],
 ['assumptions','Retained assumptions']
];
const inputColumns = [
 ['id','Observation'],['stationId','Station'],['reachId','Reviewed reach'],['sampledDate','Source calendar date'],
 ['sampledAt','Source timestamp'],['timePrecision','Time precision'],['parameter','Constituent'],
 ['value','Normalized value'],['unit','Normalized unit'],['censor','Censoring'],['lower','Lower bound'],['upper','Upper bound'],
 ['basis','Chemical basis'],['fraction','Sample fraction'],['method','Method'],
 ['sourceResultId','Original result ID'],['logicalKey','Source revision identity'],['sourceReferences','Original source references']
];
const noPairColumns = [['measurementId','Chemistry observation'],['date','Source calendar date'],['reasons','Why no pair was made']];
const exclusionColumns = [...inputColumns,['reasons','Why this input was excluded']];
export function describeResult(report) {
  if (!report || typeof report !== 'object' || report.version !== 1) throw new Error('This saved result format is not supported by the readable view; download its original JSON.');
  if (report.format === 'upper-savannah-paired-loads') {
    if (!Array.isArray(report.paired) || !Array.isArray(report.unpaired)) throw new Error('The saved paired-load result is incomplete.');
    return {
      title:'Concentration–discharge pairing',
      explanation:'Each rate uses one discrete concentration and one eligible daily mean discharge on the same source calendar date. The kg/day number is a daily-equivalent rate. It is not a measured daily mass, an annual load, or a regulatory finding. No interpolation or cross-station area scaling is applied.',
      groups:[{key:'paired',title:'Paired observations',rows:report.paired,columns:pairColumns},
        {key:'unpaired',title:'Observations without a pair',rows:report.unpaired,columns:noPairColumns}]
    };
  }
  if (report.format === 'upper-savannah-calibration-input') {
    if (!Array.isArray(report.accepted) || !Array.isArray(report.excluded)) throw new Error('The saved reviewed-input result is incomplete.');
    return {
      title:'Reviewed measurement inputs',
      explanation:'These are the accepted and excluded observations at the saved workspace revision. Units, fractions, censoring bounds, source references and reviewed reaches are retained. The downstream model still controls temporal matching and load derivation; concentrations do not become annual loads.',
      groups:[{key:'accepted',title:'Accepted observations',rows:report.accepted,columns:inputColumns},
        {key:'excluded',title:'Excluded observations',rows:report.excluded,columns:exclusionColumns}]
    };
  }
  throw new Error('This saved result format is not supported by the readable view; download its original JSON.');
}
function valueText(key,value) {
  if (key === 'reasons') return reasonList(value);
  if (key === 'assumptions') return array(value).join(' ');
  if (key === 'sourceReferences') return array(value).map(r =>
    [r.label || r.id, r.id && 'Source ' + r.id, r.sha && 'SHA-256 ' + r.sha,
      r.source_line != null && 'Line ' + r.source_line, r.created_at && 'Imported ' + r.created_at].filter(Boolean).join(' · ')).join('\n');
  return cell(value);
}
function table(group, offset=0, limit=50) {
  const rows = group.rows.slice(offset, offset+limit);
  return '<div class="mwr-table" tabindex="0" aria-label="'+esc(group.title)+'"><table><caption>'+esc(group.title)+' — '+group.rows.length+' total</caption><thead><tr>'+
    group.columns.map(([,label])=>'<th scope="col">'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+
    (rows.length ? rows.map(row=>'<tr>'+group.columns.map(([key])=>'<td>'+esc(valueText(key,row[key]))+'</td>').join('')+'</tr>').join('') :
      '<tr><td colspan="'+group.columns.length+'">No observations in this group.</td></tr>')+'</tbody></table></div>';
}
function fields(value) {
  if (!value || typeof value !== 'object' || !Object.keys(value).length) return '<p>None recorded.</p>';
  return '<dl class="mwr-fields">'+Object.entries(value).map(([key,v])=>'<dt>'+esc(title(key))+'</dt><dd>'+esc(cell(v))+'</dd>').join('')+'</dl>';
}
export function renderResult(report,{id=report.exportId||'',currentRevision,offsets={},limit=50,interactive=true}={}) {
  const d=describeResult(report);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('A positive table page size is required.');
  const stale=currentRevision!==undefined && report.workspaceRevision!==currentRevision;
  return '<section class="mwr"><h2>'+esc(d.title)+'</h2><p>'+esc(d.explanation)+'</p>'+
    '<dl class="mwr-fields"><dt>Saved result</dt><dd>'+esc(id||'Original report')+'</dd><dt>Created</dt><dd>'+esc(cell(report.createdAt))+
    '</dd><dt>Workspace revision used</dt><dd>'+esc(cell(report.workspaceRevision))+'</dd></dl>'+
    (stale?'<p class="mwr-notice">This is a saved historical result. The open workspace is at revision '+esc(currentRevision)+
      '; later source or review changes have not been applied to this result.</p>':'')+
    (interactive?'<div class="mw-buttons"><button data-result-download="html">Download readable report</button><button data-result-download="json">Download complete original JSON</button></div>':'')+
    d.groups.map(group=>{
      const offset=interactive?Math.min(Math.max(0,Number(offsets[group.key])||0),Math.max(0,Math.floor((group.rows.length-1)/limit)*limit)):0;
      return '<section><h3>'+esc(group.title)+' ('+group.rows.length+')</h3>'+
       (interactive?'<button data-result-download="csv" data-group="'+group.key+'">Download all '+esc(group.title.toLowerCase())+' as CSV</button>':'')+
       table(group,offset,interactive?limit:group.rows.length||1)+
       (interactive&&group.rows.length>limit?'<div class="mw-buttons"><button data-result-page="'+group.key+'" data-offset="'+Math.max(0,offset-limit)+'"'+(offset===0?' disabled':'')+'>Previous rows</button><span>Rows '+(offset+1)+'–'+Math.min(offset+limit,group.rows.length)+' of '+group.rows.length+'</span><button data-result-page="'+group.key+'" data-offset="'+(offset+limit)+'"'+(offset+limit>=group.rows.length?' disabled':'')+'>Next rows</button></div>':'')+'</section>';
    }).join('')+
    '<details'+(interactive?'':' open')+'><summary>Selected settings and retained scientific rules</summary><h3>Selected settings</h3>'+fields(report.input||report.filters)+
    '<h3>Saved rules</h3>'+fields(report.rules)+'</details></section>';
}
export const resultStyles = '.mwr{font:15px/1.5 system-ui,sans-serif;color:#20252b;background:#fff;text-align:left;padding:16px;min-width:0}.mwr h2,.mwr h3,.mwr p,.mwr dt,.mwr dd{color:inherit}.mwr h2{font-size:22px}.mwr h3{font-size:18px;margin-top:24px}.mwr-fields{display:grid;grid-template-columns:minmax(130px,200px) minmax(0,1fr);gap:7px 16px}.mwr-fields dt{font-weight:650}.mwr-fields dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}.mwr-table{max-width:100%;overflow:auto;border:1px solid #bcc2c9;margin:12px 0}.mwr table{border-collapse:collapse;width:100%;font-size:13px}.mwr caption{text-align:left;font-weight:650;padding:10px;background:#f1f3f5;color:#20252b}.mwr th,.mwr td{text-align:left;vertical-align:top;padding:9px;border:1px solid #d0d4d9;color:#20252b;background:#fff;min-width:110px;max-width:340px;overflow-wrap:anywhere;white-space:pre-wrap}.mwr th{background:#edf0f3;color:#20252b}.mwr-notice{padding:12px;border-left:4px solid #67717d;background:#f1f3f5;color:#20252b}.mwr pre{white-space:pre-wrap;overflow-wrap:anywhere}.mwr a{color:#203a52;text-decoration:underline}.mwr li{overflow-wrap:anywhere}@media(max-width:520px){.mwr{padding:10px}.mwr-fields{grid-template-columns:1fr;gap:3px}.mwr-fields dd{margin-bottom:9px}.mwr th,.mwr td{padding:7px}}@media print{.mwr-table{overflow:visible}.mwr table{font-size:9px}.mwr th,.mwr td{min-width:0;max-width:none;padding:3px}.mwr details{display:block}}';
export function resultHTML(report,options={}) {
  const d=describeResult(report);
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
    esc(d.title)+'</title><style>'+resultStyles+'</style></head><body>'+renderResult(report,{...options,interactive:false})+
    '<p class="mwr">This report presents the saved result. Complete original JSON retains every stored field. Spreadsheet CSV protects formula-like text with a leading apostrophe; numeric values are unchanged.</p></body></html>';
}
function quoteCSV(value) {
  if (value == null) return '""';
  let s=typeof value==='object'?JSON.stringify(value):String(value);
  if(typeof value!=='number'&&/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function resultCSV(report,groupKey) {
  const group=describeResult(report).groups.find(g=>g.key===groupKey);
  if(!group)throw new Error('Choose a saved result population.');
  const columns=[['savedResultId','Saved result'],['createdAt','Created'],['workspaceRevision','Workspace revision'],...group.columns];
  return columns.map(([,label])=>quoteCSV(label)).join(',')+'\r\n'+group.rows.map(row=>columns.map(([key])=>{
    const value=key==='savedResultId'?report.exportId||'':key==='createdAt'?report.createdAt:key==='workspaceRevision'?report.workspaceRevision:row[key];
    return quoteCSV(['reasons','assumptions','sourceReferences'].includes(key)?valueText(key,value):value);
  }).join(',')).join('\r\n')+(group.rows.length?'\r\n':'');
}
export function renderSourceInspection(source,{limit=100}={}) {
  const rejected=array(source.rejected),summary=source.summary||source;
  const metadata={source:source.label||source.kind,sourceId:source.id,kind:source.kind,sha256:source.sha||source.contentSha,
    imported:source.created_at||source.createdAt,rows:summary.rows,rejectedCount:summary.rejectedCount};
  const show=(value,depth=0)=>{
    if(value===null||typeof value!=='object')return esc(cell(value));
    if(depth>6)return esc(JSON.stringify(value));
    if(Array.isArray(value))return '<ol>'+value.map(v=>'<li>'+show(v,depth+1)+'</li>').join('')+'</ol>';
    return '<dl class="mwr-fields">'+Object.entries(value).map(([k,v])=>'<dt>'+esc(title(k))+'</dt><dd>'+show(v,depth+1)+'</dd>').join('')+'</dl>';
  };
  return '<section class="mwr"><h3>Source and retrieval record</h3>'+fields(metadata)+
    '<h3>Original column mapping</h3>'+fields(source.mapping)+
    '<h3>Retrieval provenance</h3>'+show(source.origin||{})+
    '<h3>Quality flags</h3>'+show(Object.fromEntries(Object.entries(summary.issues||{}).map(([k,v])=>[reasonText(k)+' ['+k+']',v])))+
    '<h3>Rejected rows ('+esc(summary.rejectedCount??rejected.length)+')</h3>'+
    (rejected.length?'<p>Showing '+Math.min(limit,rejected.length)+' retained rows. The complete rejected-row download keeps all original values.</p>'+
      rejected.slice(0,limit).map(r=>'<details><summary>Source line '+esc(r.line??r.sourceLine??'not supplied')+' · '+esc(r.reason||reasonList(r.reasons))+
      '</summary>'+show(r.raw||r.values||r)+'</details>').join(''):'<p>No rejected rows in this response.</p>')+'</section>';
}

/** Format retained point/bound values without replacing unresolved censoring by zero. */
export function measurementValue(row) {
  const number=value=>value===null||value===undefined||value===''?'—':Number(value).toLocaleString(undefined,{maximumSignificantDigits:8});
  const unit=row.unit?' '+String(row.unit):'';
  if(!row.censor||row.censor==='none')return number(row.value)+unit;
  if(row.censor==='left')return row.upper===null||row.upper===undefined?'Upper bound unresolved'+unit:'≤ '+number(row.upper)+unit;
  if(row.censor==='right')return row.lower===null||row.lower===undefined?'Lower bound unresolved'+unit:'≥ '+number(row.lower)+unit;
  return 'Censoring unresolved'+unit;
}
/** Present source semantics; recognition never changes model-input eligibility. */
export function renderObservationContext(row) {
  const interpretation=row.characteristicInterpretation||{},detection=row.detectionInterpretation||{};
  const list=entries=>'<dl class="mwr-fields">'+entries.map(([name,value])=>'<dt>'+esc(name)+'</dt><dd>'+esc(cell(value))+'</dd>').join('')+'</dl>';
  const depth=(value,unit,reference)=>[value===null||value===undefined||value===''?'Not supplied':String(value),unit,reference].filter(Boolean).join(' · ');
  return '<section class="mwr"><h3>Original quantity and interpretation</h3>'+
    '<p>Characteristic recognition describes the retained observation. Native calibration, temporal matching, flow support and annual-load eligibility remain separate decisions.</p>'+
    list([['Publisher characteristic',row.characteristic],['Recognized parameter',row.parameter],['Retained result',measurementValue(row)],
      ['Original value / unit',[row.reportedValue,row.reportedUnit].filter(x=>x!==null&&x!==undefined&&x!=='').join(' ')],
      ['Source chemical speciation',row.speciation||interpretation.sourceSpeciation],['Retained chemical basis',row.basis],
      ['Source sample fraction',row.fraction],['Basis source',interpretation.basisSource],['Chemical conversion',interpretation.chemicalConversion],
      ['Unit kind',interpretation.unitKind],['Microbial count method',interpretation.microbialCountMethod],['Turbidity scale',interpretation.turbidityScale],
      ['Conductivity temperature correction',interpretation.conductivityTemperatureCorrection]])+
    '<h4>Original method and sampling context</h4>'+
    list([['Method identifier',row.method],['Method authority / context',row.methodContext],['Method name',row.methodName],
      ['Laboratory',row.laboratory],['Result depth / unit / reference',depth(row.resultDepth,row.resultDepthUnit,row.resultDepthReference)],
      ['Activity depth / unit / reference',depth(row.activityDepth,row.activityDepthUnit,row.activityDepthReference)],
      ['Relative depth',row.relativeDepth],['Time basis',row.timeBasis],['Temperature basis',row.temperatureBasis],['Weight basis',row.weightBasis]])+
    '<h4>Retained interpretation editions</h4>'+
    list([['Characteristic edition',interpretation.edition||'Legacy normalization (no characteristic edition pinned)'],
      ['Detection edition',detection.edition||'Legacy normalization (no detection edition pinned)'],
      ['Publisher detection condition',row.detection],['Direction source',detection.directionSource],['Limit source',detection.limitSource]])+'</section>';
}
