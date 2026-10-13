export function parseCsv(text){const rows=[];let row=[],value="",quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++}else if(c==='"')quoted=false;else value+=c}else if(c==='"')quoted=true;else if(c===","){row.push(value);value=""}else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(value);if(row.some(x=>x!==""))rows.push(row);row=[];value=""}else value+=c}if(quoted)throw Error("CSV quotation is incomplete");if(row.length||value){row.push(value);rows.push(row)}const columns=(rows.shift()||[]).map((x,i)=>i===0?x.replace(/^\uFEFF/,""):x);for(const r of rows)if(r.length!==columns.length)throw Error("CSV source row width differs: "+r.length+"/"+columns.length);return{columns,rows:rows.map(r=>Object.fromEntries(columns.map((c,i)=>[c,r[i]]))) }}

export function buildStudyFlowContext(dailyRows, dates, gauge="02186702") {
  const DAY=86400000;
  const parseDate=date=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Use an ISO reporting date");
    const t=Date.parse(date+"T00:00:00Z");
    if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==date)throw new Error("Invalid reporting date");
    return t;
  };
  const records=dailyRows.filter(r=>r.site===gauge).map(r=>({...r,q:r.reported_mean_cfs===""?null:Number(r.reported_mean_cfs)}));
  const byDate=new Map();
  for(const r of records){
    parseDate(r.date);
    if(byDate.has(r.date))throw new Error("Duplicate gauge reporting date: "+r.date);
    if(r.q!==null&&!Number.isFinite(r.q))throw new Error("Invalid original daily mean");
    byDate.set(r.date,r);
  }
  const mean=values=>values.length?values.reduce((s,v)=>s+v,0)/values.length:null;
  const percentile=(values,p)=>{if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),at=(a.length-1)*p,lo=Math.floor(at);return a[lo]+(a[Math.ceil(at)]-a[lo])*(at-lo)};
  const years=new Map();
  const rows=dates.map(date=>{
    const time=parseDate(date),year=date.slice(0,4),same=byDate.get(date);
    if(!same||same.q===null)throw new Error("Original sample-date flow absent: "+date);
    if(!years.has(year)){
      const y=records.filter(r=>r.date.startsWith(year)&&r.q!==null);
      const values=y.map(r=>r.q);
      years.set(year,{values,days:values.length,mean:mean(values),p95:percentile(values,.95),expected:(Date.UTC(Number(year)+1,0,1)-Date.UTC(Number(year),0,1))/DAY});
    }
    const y=years.get(year);
    const row={
      sampling_date:date,
      gauge_id:"USGS-"+gauge,
      same_date_mean_cfs:same.q,
      same_date_qualifiers:same.qualifiers,
      same_date_flow_source_id:same.source_id,
      same_date_flow_source_values_index:Number(same.source_values_index),
      same_date_flow_source_record_index:Number(same.source_record_index),
      annual_reference_year:year,
      annual_reference_valid_days:y.days,
      annual_reference_expected_days:y.expected,
      annual_mean_cfs:y.mean,
      annual_p95_daily_cfs:y.p95,
      annual_flow_percentile_midrank:100*(y.values.filter(q=>q<same.q).length+.5*y.values.filter(q=>q===same.q).length)/y.values.length,
      same_date_at_or_above_annual_p95:same.q>=y.p95
    };
    for(const days of [3,7]){
      const prior=[];
      for(let offset=days;offset>=1;offset--){
        const d=new Date(time-offset*DAY).toISOString().slice(0,10);
        const record=byDate.get(d);if(record&&record.q!==null)prior.push(record);
      }
      const prefix="prior_"+days+"d_";
      const maximum=prior.length?Math.max(...prior.map(r=>r.q)):null;
      row[prefix+"start"]=new Date(time-days*DAY).toISOString().slice(0,10);
      row[prefix+"end"]=new Date(time-DAY).toISOString().slice(0,10);
      row[prefix+"valid_days"]=prior.length;
      row[prefix+"expected_days"]=days;
      row[prefix+"mean_cfs"]=mean(prior.map(r=>r.q));
      row[prefix+"maximum_daily_cfs"]=maximum;
      row[prefix+"maximum_dates"]=prior.filter(r=>r.q===maximum).map(r=>r.date).join(";");
      row[prefix+"source_records"]=JSON.stringify(prior.map(r=>({date:r.date,source_id:r.source_id,values_index:Number(r.source_values_index),record_index:Number(r.source_record_index),qualifiers:r.qualifiers})));
    }
    return row;
  });
  return {rows,method:{gauge:"USGS-"+gauge,flow_unit:"ft3/s",statistic:"Original agency daily mean discharge (00060 / 00003)",date_join:"Identical original reporting calendar date",antecedent_window:"Previous3 or7 calendar dates, excluding the sample reporting date",empirical_percentile:"100*(count below +0.5*count equal)/valid annual reporting dates",source_records:"Each same-day and antecedent daily value links to its original response and record index"}};
}
