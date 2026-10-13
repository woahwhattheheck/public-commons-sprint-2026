/** Source-bound exploratory seasonal slopes. Shared by Node and the offline browser. */
export const VERSION = 'upstate.seasonal-interval-trends/v1';
export const COHORT_FIELDS = ['station_id','characteristic','sample_fraction','observation_unit',
  'method_id','method_context','method_name','result_type','activity_type','media',
  'media_subdivision','activity_depth','activity_depth_unit','result_depth','result_depth_unit',
  'weight_basis','time_basis','temperature_basis','particle_size_basis',
  'collection_method','collection_method_context','collection_equipment'];
export const DEFAULTS = Object.freeze({start_year:2020,end_year:2025,season:'month',
  max_flow_ratio:0,approved_flow_only:false,numeric_only:false,depth_mode:'strict'});
export function median(values) {
  if (!values.length) return null;
  const a=[...values].sort((a,b)=>a-b),n=a.length;
  return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;
}
export function grouped(rows,key) {
  const result=new Map();
  for(const row of rows){const k=key(row);if(!result.has(k))result.set(k,[]);result.get(k).push(row);}
  return result;
}
export function parseCsv(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
    else if(c==='"')quoted=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';
    } else cell+=c;
  }
  if(quoted)throw Error('Incomplete quoted CSV field');
  if(row.length||cell){row.push(cell);rows.push(row);}
  const fields=(rows.shift()||[]).map((x,i)=>i===0?x.replace(/^\uFEFF/,''):x);
  if(!fields.length||new Set(fields).size!==fields.length)throw Error('Missing or duplicate CSV headers');
  return rows.map((values,i)=>{
    if(values.length!==fields.length)throw Error(`CSV width differs at logical record ${i+2}`);
    return Object.fromEntries(fields.map((f,j)=>[f,values[j]]));
  });
}
export function csv(rows, fields) {
  fields=fields||[...new Set(rows.flatMap(r=>Object.keys(r)))];
  const cell=v=>{
    let s=v===undefined||v===null?'':typeof v==='object'?JSON.stringify(v):String(v);
    // Numeric negative slopes remain numeric; text formula cells are neutralized.
    if(typeof v==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;
    return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
  };
  return fields.map(cell).join(',')+'\n'+rows.map(r=>fields.map(f=>cell(r[f])).join(',')).join('\n')+(rows.length?'\n':'');
}
export function settings(input={}) {
  const o={...DEFAULTS,...input};
  if(!Number.isInteger(o.start_year)||!Number.isInteger(o.end_year)||o.start_year>o.end_year||o.start_year<1900||o.end_year>2200)
    throw Error('Choose a valid ordered start and end year');
  if(!['strict','combined'].includes(o.depth_mode))throw Error('Depth handling must be strict or combined');
  if(!['month','quarter','all'].includes(o.season))throw Error('Season must be month, quarter or all');
  if(typeof o.max_flow_ratio!=='number'||!Number.isFinite(o.max_flow_ratio)||(o.max_flow_ratio!==0&&o.max_flow_ratio<1))
    throw Error('Flow ratio must be zero (unrestricted) or at least one');
  if(typeof o.approved_flow_only!=='boolean'||typeof o.numeric_only!=='boolean')throw Error('Selection flags must be boolean');
  return o;
}
export function cohortKey(r){return JSON.stringify(COHORT_FIELDS.map(f=>r[f]||''));}
export function interval(r) {
  const num=v=>v===''||v===null||v===undefined?null:Number(v);
  const value=num(r.value),limit=num(r.limit_value);
  if(value!==null&&Number.isFinite(value)&&value>=0&&!r.detection_condition&&r.unit==='mg/L')
    return {lower:value,upper:value,state:'numeric',upper_open:false};
  if(value===null&&r.detection_condition==='Present Below Quantification Limit'&&Number.isFinite(limit)&&limit>0&&r.limit_unit==='mg/L')
    return {lower:0,upper:limit,state:'left_censored',upper_open:true};
  return {lower:null,upper:null,state:'unresolved',upper_open:null};
}
function finite(v){return typeof v==='number'&&Number.isFinite(v);}
export function prepareRecords(rows) {
  const ids=new Set();
  return rows.map(r=>{
    if(!r.record_id||ids.has(r.record_id))throw Error('Missing or duplicate original result identity');
    ids.add(r.record_id);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||new Date(r.date+'T00:00:00Z').toISOString().slice(0,10)!==r.date)
      throw Error('Invalid original sample date: '+r.record_id);
    const iv=interval(r);
    return {...r,interval:iv,year:Number(r.date.slice(0,4)),month:Number(r.date.slice(5,7)),
      flow:r.same_date_mean_cfs===''?null:Number(r.same_date_mean_cfs),cohort_key:cohortKey(r)};
  });
}
export function catalogue(records) {
  return [...grouped(records,r=>r.cohort_key)].map(([key,rows])=>({key,
    dimensions:Object.fromEntries(COHORT_FIELDS.map(f=>[f,rows[0][f]||''])),
    rows:rows.length,numeric:rows.filter(r=>r.interval.state==='numeric').length,
    censored:rows.filter(r=>r.interval.state==='left_censored').length,
    unresolved:rows.filter(r=>r.interval.state==='unresolved').length,
    first:rows.map(r=>r.date).sort()[0],last:rows.map(r=>r.date).sort().at(-1),
    years:[...new Set(rows.map(r=>r.year))].sort((a,b)=>a-b)}))
    .sort((a,b)=>a.dimensions.station_id.localeCompare(b.dimensions.station_id)||a.dimensions.characteristic.localeCompare(b.dimensions.characteristic)||a.key.localeCompare(b.key));
}
export function binsFor(records, selection) {
  const o=settings(selection),audit=[];
  const selected=records.filter(r=>r.year>=o.start_year&&r.year<=o.end_year);
  const accepted=[];
  for(const r of selected){
    let reason=null;
    if(r.interval.state==='unresolved')reason='unresolved concentration interval';
    else if(r.result_status!=='Final')reason='non-final result';
    else if(r.qualifier)reason='qualified original result';
    else if(o.numeric_only&&r.interval.state!=='numeric')reason='numeric-only sensitivity excludes censored result';
    else if(o.approved_flow_only&&(!r.flow_qualifiers.split('|').includes('A')||r.flow_qualifiers.split('|').some(q=>q==='P'||q==='e')))
      reason='daily-flow quality sensitivity';
    if(reason)audit.push({record_id:r.record_id,reason});else accepted.push(r);
  }
  const bins=[];
  const period=r=>o.season==='month'?r.month:o.season==='quarter'?Math.ceil(r.month/3):1;
  for(const [key,rows] of grouped(accepted,r=>`${r.year}:${period(r)}`)){
    // One interval median per sampling date, then one interval median per year/season.
    const days=[];
    for(const [date,items] of grouped(rows,r=>r.date)){
      const flows=[...new Set(items.map(r=>r.flow).filter(finite))];
      if(flows.length>1)throw Error('Conflicting source gauge values for the same sampling date');
      days.push({date,lower:median(items.map(r=>r.interval.lower)),upper:median(items.map(r=>r.interval.upper)),
        flow:flows.length?flows[0]:null,record_ids:items.map(r=>r.record_id)});
    }
    days.sort((a,b)=>a.date.localeCompare(b.date));
    bins.push({bin_id:key,year:rows[0].year,season:period(rows[0]),lower:median(days.map(d=>d.lower)),upper:median(days.map(d=>d.upper)),
      sample_dates:days.length,results:rows.length,censored:rows.filter(r=>r.interval.state==='left_censored').length,
      flow_median:days.every(d=>finite(d.flow))?median(days.map(d=>d.flow)):null,
      first_date:days[0].date,last_date:days.at(-1).date,record_ids:rows.map(r=>r.record_id),days});
  }
  return {bins:bins.sort((a,b)=>a.year-b.year||a.season-b.season),accepted,excluded:audit,selected_count:selected.length};
}
export function pairBins(bins,selection) {
  const o=settings(selection),included=[],excluded=[];
  for(const [season,items] of grouped(bins,r=>r.season)){
    items.sort((a,b)=>a.year-b.year);
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
      const a=items[i],b=items[j],dt=b.year-a.year;
      if(dt<=0)continue;
      const ratio=finite(a.flow_median)&&finite(b.flow_median)?
        a.flow_median===0&&b.flow_median===0?1:Math.min(a.flow_median,b.flow_median)>0?
          Math.max(a.flow_median,b.flow_median)/Math.min(a.flow_median,b.flow_median):null:null;
      const row={pair_id:`${a.bin_id}~${b.bin_id}`,season,earlier_year:a.year,later_year:b.year,year_gap:dt,
        earlier_bin:a.bin_id,later_bin:b.bin_id,earlier_lower:a.lower,earlier_upper:a.upper,
        later_lower:b.lower,later_upper:b.upper,lower:(b.lower-a.upper)/dt,upper:(b.upper-a.lower)/dt,
        earlier_flow_cfs:a.flow_median,later_flow_cfs:b.flow_median,flow_ratio:ratio,
        earlier_source_records:a.record_ids,later_source_records:b.record_ids};
      if(o.max_flow_ratio&&(!finite(ratio)||ratio>o.max_flow_ratio)){
        excluded.push({...row,reason:!finite(ratio)?'flow ratio not finite':'flow ratio above selection'});continue;
      }
      const eps=1e-12*Math.max(1,Math.abs(row.lower),Math.abs(row.upper));
      row.direction=row.lower>eps?'higher':row.upper< -eps?'lower':Math.abs(row.lower)<=eps&&Math.abs(row.upper)<=eps?'equal':'interval_overlap';
      included.push(row);
    }
  }
  return {included,excluded};
}
export function summarizePairs(pairs) {
  const lower=median(pairs.map(p=>p.lower)),upper=median(pairs.map(p=>p.upper));
  const eps=1e-12*Math.max(1,Math.abs(lower||0),Math.abs(upper||0));
  const direction=!pairs.length?'no_cross_year_pairs':lower>eps?'positive_envelope':upper< -eps?'negative_envelope':Math.abs(lower)<=eps&&Math.abs(upper)<=eps?'zero_envelope':'overlaps_zero';
  const counts={higher:0,lower:0,equal:0,interval_overlap:0};
  for(const p of pairs)counts[p.direction]++;
  return {pairs:pairs.length,slope_lower_mg_l_per_year:lower,slope_upper_mg_l_per_year:upper,direction,
    supporting_years:[...new Set(pairs.flatMap(p=>[p.earlier_year,p.later_year]))].sort((a,b)=>a-b),
    supporting_seasons:[...new Set(pairs.map(p=>p.season))].sort((a,b)=>a-b),...counts,
    sign_score_lower:counts.higher-counts.lower-counts.interval_overlap,
    sign_score_upper:counts.higher-counts.lower+counts.interval_overlap};
}
export function analyzeCohort(allRecords,key,selection={}) {
  const o=settings(selection);let records=allRecords.filter(r=>r.cohort_key===key);
  if(records.length&&o.depth_mode==='combined'){
    const first=records[0],otherFields=COHORT_FIELDS.filter(f=>!['activity_depth','activity_depth_unit','result_depth','result_depth_unit'].includes(f));
    records=allRecords.filter(r=>otherFields.every(f=>(r[f]||'')===(first[f]||'')));
  }
  if(!records.length)throw Error('The selected comparable cohort is absent from this source edition');
  const parts=binsFor(records,o),pairs=pairBins(parts.bins,o),summary=summarizePairs(pairs.included);
  const leave_one_year_out=[...new Set(parts.bins.map(b=>b.year))].sort((a,b)=>a-b)
    .map(year=>({omitted_year:year,...summarizePairs(pairs.included.filter(p=>p.earlier_year!==year&&p.later_year!==year))}));
  return {schema:VERSION,selection:o,cohort_key:key,dimensions:Object.fromEntries(COHORT_FIELDS.map(f=>[f,records[0][f]||''])),
    summary:{...summary,source_results:records.length,period_results:parts.selected_count,included_results:parts.accepted.length,
      excluded_results:parts.excluded.length,censored_results:parts.accepted.filter(r=>r.interval.state==='left_censored').length,
      calendar_bins:parts.bins.length,flow_excluded_pairs:pairs.excluded.length,
      full_period_years:o.end_year-o.start_year+1,
      observed_years:[...new Set(parts.bins.map(b=>b.year))].sort((a,b)=>a-b),
      leave_one_year_out_same_direction:leave_one_year_out.filter(x=>x.pairs&&x.direction===summary.direction).length,
      leave_one_year_out_estimable:leave_one_year_out.filter(x=>x.pairs).length},
    depth_series:[...grouped(records,r=>JSON.stringify([r.activity_depth,r.activity_depth_unit,r.result_depth,r.result_depth_unit]))].map(([key,rows])=>({depth_key:key,records:rows.length})),
    bins:parts.bins,pairs:pairs.included,excluded_pairs:pairs.excluded,excluded_records:parts.excluded,
    leave_one_year_out,records:records.filter(r=>r.year>=o.start_year&&r.year<=o.end_year)};
}
export function compareSelections(records,key,selection={}) {
  const base=settings(selection),specs=[
    ['Same calendar month',{...base,season:'month',max_flow_ratio:0}],
    ['Same month; flow ratio ≤ 2',{...base,season:'month',max_flow_ratio:2}],
    ['Same quarter',{...base,season:'quarter',max_flow_ratio:0}],
    ['Same quarter; flow ratio ≤ 2',{...base,season:'quarter',max_flow_ratio:2}],
    ['Unstratified annual median',{...base,season:'all',max_flow_ratio:0}],
    ['Same month; numeric-only subset',{...base,season:'month',max_flow_ratio:0,numeric_only:true}],
    ['Same month; approved, unestimated flow dates',{...base,season:'month',max_flow_ratio:0,approved_flow_only:true}],
    ['Same month; combine depth metadata',{...base,season:'month',max_flow_ratio:0,depth_mode:'combined'}],
  ];
  return specs.map(([label,o])=>({label,...analyzeCohort(records,key,o).summary,selection:o}));
}
