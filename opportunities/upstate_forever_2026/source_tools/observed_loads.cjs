/* Source-bound concentration × daily discharge integration.
 * No acquisition, station matching, annual extrapolation or native model run.
 * All source fields and omitted days remain available in the returned product.
 */
"use strict";
const DAY_MS = 86400000;
const VERSION = "upstate.observed-load-integration/v2";
const MASS_FACTOR = 86.4; // mg/L × m3/s × 86400 s/day × 1000 L/m3 / 1e6 mg/kg.
const LEFT_CENSOR_CONDITIONS = Object.freeze(["Not Detected","Present Below Quantification Limit"]);
const UNIT_FACTORS = Object.freeze({"mg/L":1,"ug/L":0.001,"µg/L":0.001,"μg/L":0.001,"g/L":1000});
const UNCERTAINTY = "Lower/upper loads propagate reported censoring limits through the selected interpolation only; they are not confidence intervals. Sampling frequency, event undersampling, daily-mean flow versus grab-sample timing, laboratory uncertainty and flow uncertainty remain unquantified. No missing day is scaled to an annual total.";
const clone = v => JSON.parse(JSON.stringify(v));
const text = v => v == null ? "" : String(v).trim();
function finite(v,label) {
  if(v === null || v === undefined || typeof v === "boolean" || text(v)==="") throw Error(label+" is missing");
  const n=Number(v); if(!Number.isFinite(n)||n<0) throw Error(label+" must be finite and nonnegative"); return n;
}
function day(v) {
  const s=text(v); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Error("Expected YYYY-MM-DD: "+s);
  const n=Date.parse(s+"T00:00:00Z"); if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==s)throw Error("Invalid date: "+s); return n/DAY_MS;
}
const iso = n=>new Date(n*DAY_MS).toISOString().slice(0,10);
function required(v,label){if(!text(v))throw Error(label+" is required");return text(v);}
function unique(values){return [...new Set(values)];}
function strings(value,label){if(!Array.isArray(value)||value.some(v=>typeof v!=="string"))throw Error(label+" must be an explicit string array");return value;}
function csvParse(input){
  const rows=[];let row=[],cell="",quoted=false,afterQuote=false;
  for(let i=0;i<input.length;i++){const c=input[i];
    if(quoted){if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;afterQuote=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell!==""||afterQuote)throw Error("Unexpected CSV quote");quoted=true;continue;}
    if(c===","||c==="\n"||c==="\r"){row.push(cell);cell="";afterQuote=false;if(c!==","){rows.push(row);row=[];if(c==="\r"&&input[i+1]==="\n")i++;}continue;}
    if(afterQuote)throw Error("Text after CSV quote");cell+=c;
  }
  if(quoted)throw Error("Unclosed CSV quote");if(cell!==""||row.length||afterQuote){row.push(cell);rows.push(row);}
  if(!rows.length)throw Error("CSV has no header");const header=rows.shift();header[0]=header[0].replace(/^\ufeff/,"");
  if(header.some(v=>!v)||unique(header).length!==header.length)throw Error("CSV headers must be nonempty and distinct");
  return rows.filter(r=>r.length!==1||r[0]!=="").map((r,i)=>{if(r.length!==header.length)throw Error("CSV width at row "+(i+2));return Object.fromEntries(header.map((k,j)=>[k,r[j]]));});
}
function csvString(rows,columns){
  const enc=v=>{const s=v==null?"":typeof v==="object"?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  return [columns.join(","),...rows.map(r=>columns.map(k=>enc(r[k])).join(","))].join("\n")+"\n";
}
function sampleId(s,i){return text(s.sample_id)||[required(s.source_file,"Sample source_file"),required(s.source_row,"Sample source_row")].join(":");}
function seriesKey(s){const key=[text(s.station_id),text(s.characteristic),text(s.sample_fraction),text(s.method_context),text(s.method_id)];if(s.series_context)key.push(s.series_context);return JSON.stringify(key);}
function normalizeSample(s,i,contract){
  const out={id:sampleId(s,i),date:text(s.date),day:day(s.date),station_id:required(s.station_id,"Sample station_id"),
    characteristic:required(s.characteristic,"Sample characteristic"),sample_fraction:s.source_mapping?text(s.sample_fraction):required(s.sample_fraction,"Sample fraction"),
    method_id:s.source_mapping?text(s.method_id):required(s.method_id,"Sample method_id"),method_context:text(s.method_context),original:clone(s),issues:[],
    ...(s.series_context?{series_context:clone(s.series_context)}:{})};
  out.series_key=seriesKey(out);
  try{
    if(s.integration_issues?.length)throw Error(s.integration_issues.join("; "));
    if(!out.sample_fraction||!out.method_id)throw Error("Sample fraction and analytical method are required for integration");
    const qualifier=text(s.qualifier),status=text(s.result_status);
    if(!contract.accepted_concentration_qualifiers.includes(qualifier))throw Error("Unaccepted concentration qualifier: "+qualifier);
    if(!contract.accepted_concentration_statuses.includes(status))throw Error("Unaccepted concentration status: "+status);
    if(s.event_sample===true||text(s.event_sample).toLowerCase()==="true"){
      if(contract.event_sampling_policy!=="include_with_declared_bias")throw Error("Event sample retained outside interpolation by selected policy");
    }
    const condition=text(s.detection_condition),raw=text(s.value),limit=text(s.limit_value);
    const censored=condition!=="";
    if(censored){
      if(!LEFT_CENSOR_CONDITIONS.includes(condition)||!contract.accepted_censoring_conditions.includes(condition))throw Error("Unsupported censor direction or detection condition: "+condition);
      const factor=UNIT_FACTORS[text(s.limit_unit)];if(factor===undefined)throw Error("Unsupported detection-limit unit");
      out.lower_mg_l=0;out.upper_mg_l=finite(limit,"Reported censoring limit")*factor;out.point_mg_l=null;out.censored=true;
    }else{
      const factor=UNIT_FACTORS[text(s.unit)];if(factor===undefined)throw Error("Unsupported concentration unit");
      const v=finite(raw,"Measured concentration")*factor;out.lower_mg_l=v;out.upper_mg_l=v;out.point_mg_l=v;out.censored=false;
    }
    out.usable=true;
  }catch(e){out.usable=false;out.issues.push(e.message);}
  return out;
}
function supportFor(station,contract){
  const choices=contract.support.filter(v=>v.station_id===station);
  if(choices.length!==1)return {station_id:station,admitted:false,issues:[choices.length?"Ambiguous station support":"No selected station/catchment support"]};
  const s=clone(choices[0]);const issues=[];
  if(s.accepted!==true)issues.push("Source support not accepted for mass integration");
  if(s.location_match!==true)issues.push("Concentration and discharge locations are not explicitly matched");
  if(s.catchment_match!==true||!text(s.catchment_id))issues.push("Matching original catchment is not established");
  if(!text(s.gauge_id))issues.push("No selected original gauge");
  if(!Array.isArray(s.evidence)||!s.evidence.length||s.evidence.some(x=>!text(x)))issues.push("Missing original support evidence");
  if(!text(s.gauge_relation))issues.push("Missing declared gauge relation");
  return {...s,admitted:issues.length===0,issues};
}
function normalizeFlow(f,contract){
  const out={id:required(f.observation_id,"Flow observation_id"),gauge_id:required(f.monitoring_location_id,"Flow monitoring_location_id"),
    date:text(f.date),day:day(f.date),original:clone(f),issues:[]};
  try{
    if(f.validity!==undefined&&!contract.accepted_flow_validity.includes(text(f.validity)))throw Error("Flow source validity is not admitted: "+text(f.validity));
    if(!contract.accepted_flow_approval_statuses.includes(text(f.approval_status)))throw Error("Flow approval status is not admitted: "+text(f.approval_status));
    if(!contract.accepted_flow_qualifiers.includes(text(f.qualifier)))throw Error("Flow qualifier is not admitted: "+text(f.qualifier));
    out.discharge_m3_s=finite(f.discharge_m3_s,"Daily mean discharge");out.usable=true;
  }catch(e){out.usable=false;out.issues.push(e.message);}
  return out;
}
function aggregateDays(rows,start,end){
  const selected=rows.filter(r=>r.day>=start&&r.day<end),ok=selected.filter(r=>r.load_lower_kg!==null);
  const reasons={};for(const r of selected)for(const reason of r.issues)reasons[reason]=(reasons[reason]||0)+1;
  const known=ok.length>0,allPoints=known&&ok.every(r=>r.load_kg!==null);
  const sum=key=>ok.reduce((n,r)=>n+r[key],0);
  const volume=ok.reduce((n,r)=>n+r.discharge_m3_s*86400,0);
  const weighted=key=>volume>0?1000*sum(key)/volume:null;
  return {period_start:iso(start),period_end:iso(end),period_end_exclusive:true,expected_days:end-start,
    quantified_days:ok.length,coverage_complete:ok.length===end-start,
    load_kg:allPoints?sum("load_kg"):null,load_lower_kg:known?sum("load_lower_kg"):null,
    load_upper_kg:known?sum("load_upper_kg"):null,censored_days:ok.filter(r=>r.censored).length,
    sampled_days:ok.filter(r=>r.concentration_basis==="sampled_day").length,interpolated_days:ok.filter(r=>r.concentration_basis==="linear_between_samples").length,
    quantified_flow_volume_m3:volume,
    flow_weighted_concentration_mg_l:allPoints?weighted("load_kg"):null,
    flow_weighted_concentration_lower_mg_l:known?weighted("load_lower_kg"):null,
    flow_weighted_concentration_upper_mg_l:known?weighted("load_upper_kg"):null,
    flow_weighted_concentration_basis:"Mass and flow volume over the identical quantified days; 1000 * kg / m3; null for zero volume",
    missing_reasons:reasons,annualized:false,quantity_basis:"mass_over_quantified_days",uncertainty:UNCERTAINTY};
}
function annualPeriods(start,end){
 const out=[];for(let year=new Date(start*DAY_MS).getUTCFullYear();year<=new Date((end-1)*DAY_MS).getUTCFullYear();year++){
   const a=day(year+"-01-01"),b=day((year+1)+"-01-01");out.push({label:String(year),start:Math.max(start,a),end:Math.min(end,b),whole_calendar_year:start<=a&&end>=b});
 }return out;
}
function integrate(input){
  if(!input||!input.contract||!Array.isArray(input.samples)||!Array.isArray(input.flows))throw Error("Complete contract, samples and flows are required");
  const c=clone(input.contract);if(c.schema!=="upstate.observed-loads-contract/v1")throw Error("Unknown observed-load contract");
  const start=day(c.period.start),end=day(c.period.end);if(end<=start)throw Error("End must be after start");
  if(!Number.isInteger(c.maximum_interpolation_gap_days)||c.maximum_interpolation_gap_days<1)throw Error("Set an explicit positive maximum_interpolation_gap_days");
  if(c.daily_concentration_basis!=="date_assigned_grab_with_daily_mean_flow")throw Error("Explicit daily-mean-flow/grab-sample temporal approximation is required");
  for(const field of ["accepted_concentration_qualifiers","accepted_concentration_statuses","accepted_censoring_conditions","accepted_flow_approval_statuses","accepted_flow_qualifiers","accepted_flow_validity"])strings(c[field],field);
  if(!["retain_only","include_with_declared_bias"].includes(c.event_sampling_policy))throw Error("Select explicit event sampling policy");
  if(!Array.isArray(c.support)||!Array.isArray(c.source_references)||!c.source_references.length)throw Error("Original support and source references are required");
  const samples=input.samples.map((s,i)=>normalizeSample(s,i,c));if(unique(samples.map(s=>s.id)).length!==samples.length)throw Error("Sample IDs must be unique; retain original row identities");
  const flows=input.flows.map(f=>normalizeFlow(f,c));if(unique(flows.map(f=>f.id)).length!==flows.length)throw Error("Flow IDs must be unique across source editions");
  const byFlow=new Map();for(const f of flows){const k=f.gauge_id+"|"+f.day; if(!byFlow.has(k))byFlow.set(k,[]);byFlow.get(k).push(f);}
  const groups=new Map();for(const s of samples){if(!groups.has(s.series_key))groups.set(s.series_key,[]);groups.get(s.series_key).push(s);}
  const series=[];
  for(const [key,measurements] of [...groups].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)){
    const first=measurements[0],support=supportFor(first.station_id,c);
    const base={series_key:key,station_id:first.station_id,characteristic:first.characteristic,sample_fraction:first.sample_fraction,
      method_id:first.method_id,method_context:first.method_context,
      ...(first.series_context?{series_context:clone(first.series_context)}:{}),support,sample_ids:measurements.map(s=>s.id),
      source_sample_count:measurements.length,usable_sample_count:measurements.filter(s=>s.usable).length,
      censored_sample_count:measurements.filter(s=>s.censored).length,uncertainty:UNCERTAINTY};
    if(!support.admitted){series.push({...base,status:"context_only_unmatched_support",daily:[],periods:[],annual:[]});continue;}
    const byDay=new Map();for(const s of measurements){if(!byDay.has(s.day))byDay.set(s.day,[]);byDay.get(s.day).push(s);}
    const points=[...byDay].sort((a,b)=>a[0]-b[0]).map(([d,values])=>{
      const p={day:d,sample_ids:values.map(s=>s.id),issues:[],usable:false};
      if(values.some(s=>!s.usable)){p.issues=unique(values.flatMap(s=>s.issues));return p;}
      const signatures=unique(values.map(s=>JSON.stringify([s.lower_mg_l,s.upper_mg_l,s.point_mg_l,s.censored])));
      if(signatures.length!==1){p.issues=["Conflicting same-day concentration observations; no automatic average"];return p;}
      const s=values[0];return {...p,usable:true,lower:s.lower_mg_l,upper:s.upper_mg_l,point:s.point_mg_l,censored:values.some(s=>s.censored)};
    });
    const daily=[];let right=0;
    for(let d=start;d<end;d++){
      while(right<points.length&&points[right].day<d)right++;
      const exact=points[right]?.day===d?points[right]:null;
      const left=exact||points[right-1],next=exact||points[right];
      const row={date:iso(d),day:d,station_id:first.station_id,gauge_id:support.gauge_id,series_key:key,
        flow_ids:[],sample_ids:unique([...(left?.sample_ids||[]),...(next?.sample_ids||[])]),issues:[],
        concentration_basis:null,concentration_lower_mg_l:null,concentration_upper_mg_l:null,concentration_mg_l:null,
        discharge_m3_s:null,load_lower_kg:null,load_upper_kg:null,load_kg:null,censored:false};
      let concentration=null;
      if(!left||!next)row.issues.push("No extrapolation outside bracketing samples");
      else if(!left.usable||!next.usable)row.issues.push(...unique([...(left.issues||[]),...(next.issues||[])]));
      else if(!exact&&next.day-left.day>c.maximum_interpolation_gap_days)row.issues.push("Concentration gap exceeds selected maximum");
      else{
        const w=exact?0:(d-left.day)/(next.day-left.day);
        const mix=(a,b)=>a*(1-w)+b*w;
        concentration={lower:mix(left.lower,next.lower),upper:mix(left.upper,next.upper),
          point:left.point===null||next.point===null?null:mix(left.point,next.point),censored:left.censored||next.censored};
        row.concentration_basis=exact?"sampled_day":"linear_between_samples";
      }
      const options=byFlow.get(support.gauge_id+"|"+d)||[];row.flow_ids=options.map(f=>f.id);
      if(options.length!==1)row.issues.push(options.length?"Multiple source-edition flows require explicit reconciliation":"Missing daily flow");
      else if(!options[0].usable)row.issues.push(...options[0].issues);
      else row.discharge_m3_s=options[0].discharge_m3_s;
      if(concentration){
        row.concentration_lower_mg_l=concentration.lower;row.concentration_upper_mg_l=concentration.upper;row.concentration_mg_l=concentration.point;row.censored=concentration.censored;
        if(row.discharge_m3_s!==null){
          row.load_lower_kg=concentration.lower*row.discharge_m3_s*MASS_FACTOR;
          row.load_upper_kg=concentration.upper*row.discharge_m3_s*MASS_FACTOR;
          row.load_kg=concentration.point===null?null:concentration.point*row.discharge_m3_s*MASS_FACTOR;
          if(![row.load_lower_kg,row.load_upper_kg,...(row.load_kg===null?[]:[row.load_kg])].every(Number.isFinite))throw Error("Nonfinite integrated mass");
        }
      }
      daily.push(row);
    }
    const periods=[{label:"selected_period",...aggregateDays(daily,start,end)}];
    for(const period of c.seasons||[]){const a=day(period.start),b=day(period.end);if(a<start||b>end||b<=a)throw Error("Season must lie inside selected period");periods.push({label:required(period.label,"Season label"),...aggregateDays(daily,a,b)});}
    const annual=annualPeriods(start,end).map(p=>({label:p.label,whole_calendar_year:p.whole_calendar_year,...aggregateDays(daily,p.start,p.end)}));
    series.push({...base,status:daily.some(r=>r.load_lower_kg!==null)?"quantified_partial_or_complete":"no_quantified_days",daily,periods,annual});
  }
  return {schema:VERSION,method:"date-assigned concentration interpolation multiplied by original daily mean discharge",
    mass_conversion:{equation:"kg/day = mg/L * m3/s * 86.4",factor:MASS_FACTOR},
    contract:c,source_samples:samples,source_flows:flows,series,
    counts:{source_samples:samples.length,source_flows:flows.length,series:series.length,
      support_admitted_series:series.filter(s=>s.support.admitted).length,
      context_only_series:series.filter(s=>!s.support.admitted).length,
      quantified_days:series.reduce((n,s)=>n+s.daily.filter(d=>d.load_lower_kg!==null).length,0)},
    uncertainty:UNCERTAINTY};
}
function observationExports(result){
  const otherContext=s=>!!s.original.series_context&&s.original.series_context.unit_kind!=="concentration";
  const mixedProperties=result.source_samples.some(otherContext);
  const context=result.source_samples.map(s=>({record_id:s.id,station_id:s.station_id,catchment_id:"",
    parameter:s.characteristic,value:s.original.value,unit:s.original.unit,period_start:s.date,period_end:s.date,
    qualifier:text(s.original.qualifier)||text(s.original.detection_condition),method:s.method_id,
    uncertainty:{source_detection_condition:s.original.detection_condition,limit:s.original.limit_value,limit_unit:s.original.limit_unit},
    source_records:[s.original],measurement_support:otherContext(s)?"other_context":"concentration",species:s.characteristic,
    quantity_basis:otherContext(s)?"original_measurement":"original_concentration",coverage_days:1,expected_days:1,coverage_complete:false,
    gauge_relation:supportFor(s.station_id,result.contract).gauge_relation||"",source_quantity:s.original}));
  const annual=[];
  for(const s of result.series){const mapping=(result.contract.native_comparison_mappings||[]).filter(m=>m.series_key===s.series_key);
    if(mapping.length>1)throw Error("Ambiguous explicit native comparison mapping");
    if(!mapping.length)continue;const m=mapping[0];
    if(!["nitrogen","phosphorus","sediment"].includes(m.parameter)||!text(m.species)||!Array.isArray(m.evidence)||!m.evidence.length)throw Error("Native mapping needs original species/evidence");
    // Fractions never become native total nutrient solely because the series is complete.
    const allowed={nitrogen:["Total Nitrogen","Nitrogen, total"],phosphorus:["Phosphorus","Total Phosphorus"],sediment:["Suspended sediment concentration"]};
    if(!allowed[m.parameter].includes(s.characteristic)||!["Unfiltered","Total"].includes(s.sample_fraction))continue;
    if(s.series_context&&((m.parameter==="nitrogen"&&s.series_context.chemical_basis!=="N")||
      (m.parameter==="phosphorus"&&s.series_context.chemical_basis!=="P")))continue;
    for(const a of s.annual){if(!a.whole_calendar_year||!a.coverage_complete||a.load_kg===null||a.censored_days)continue;
      annual.push({record_id:s.series_key+"|"+a.label,station_id:s.station_id,catchment_id:s.support.catchment_id,
        parameter:m.parameter,species:m.species,value:m.parameter==="sediment"?a.load_kg/1000:a.load_kg,
        unit:m.parameter==="sediment"?"metric_tonnes/year":"kg/year",period_start:a.period_start,period_end:a.period_end,
        qualifier:"",method:result.method,uncertainty:result.uncertainty,source_records:s.sample_ids,
        measurement_support:"catchment_export",gauge_id:s.support.gauge_id,gauge_relation:s.support.gauge_relation,
        relation_method:s.support.evidence,quantity_basis:"annual_mass_rate",coverage_days:a.quantified_days,
        expected_days:a.expected_days,coverage_complete:true,coverage_detail:a,
        source_quantity:{integration:VERSION,series_key:s.series_key,flow_ids:s.daily.map(d=>d.flow_ids),mapping:m}});
    }
  }
  const columns=["record_id","station_id","catchment_id","parameter","value","unit","period_start","period_end","qualifier","method","uncertainty","source_records","measurement_support","species","gauge_id","gauge_relation","relation_method","quantity_basis","coverage_days","expected_days","coverage_complete","coverage_detail","source_quantity"];
  const source_uri=result.contract.source_references[0];
  return {context_csv:csvString(context,columns),annual_csv:csvString(annual,columns),annual_count:annual.length,
    context_metadata:{title:mixedProperties?"Retained original measurement context used by load integration":"Retained concentration observations used by load integration",source_uri,value_basis:"source_context",observation_kind:mixedProperties?"source_context":"receiving_water_measurement",time_support:"original_sample"},
    annual_metadata:{title:"Complete explicitly matched integrated annual mass estimates",source_uri,value_basis:"annual_mass_rate",annualization_method:result.method,accepted_qualifiers:[""]}};
}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function renderHtml(result){
  const e=escapeHtml,number=value=>value==null?"—":e(value.toPrecision(6));
  const canonical=result.series.some(s=>s.series_context);
  const contextLabel=canonical?"original measurement context":"concentration context";
  const quantityTable=canonical?'<h2>Retained original quantities</h2><div class="scroll"><table><thead><tr><th>Station / characteristic</th><th>Original quantity kind / unit</th><th>Chemical basis / speciation</th><th>Fraction / method</th></tr></thead><tbody>'+result.series.map(s=>{const c=s.series_context||{};return "<tr><td>"+e(s.station_id)+"<br>"+e(s.characteristic)+"</td><td>"+e(c.unit_kind||"concentration")+" / "+e(c.normalized_unit||s.unit||"")+"<br>"+e(c.source_unit_basis||"")+"</td><td>"+e(c.chemical_basis||"unspecified")+" / "+e(c.source_speciation||"")+"</td><td>"+e(s.sample_fraction)+" / "+e(s.method_id)+"</td></tr>";}).join("")+"</tbody></table></div>":"";
  const interval=(point,lower,upper)=>point!=null?number(point):lower!=null?number(lower)+" – "+number(upper)+" (censor bounds)":"—";
  const mass=p=>interval(p?.load_kg,p?.load_lower_kg,p?.load_upper_kg);
  const concentration=p=>interval(p?.flow_weighted_concentration_mg_l,p?.flow_weighted_concentration_lower_mg_l,p?.flow_weighted_concentration_upper_mg_l);
  const rows=result.series.map(s=>{
    const p=s.periods[0];return "<tr><td>"+e(s.station_id)+"</td><td>"+e(s.characteristic)+" / "+e(s.sample_fraction)+"<br>"+e(s.method_id)+"</td><td>"+e(s.support.gauge_relation||"unmatched")+"</td><td>"+s.source_sample_count+"</td><td>"+(p?p.quantified_days+" / "+p.expected_days:"0 — support unresolved")+"</td><td>"+mass(p)+"</td><td>"+concentration(p)+"</td><td>"+e(s.support.issues.join("; ")||s.status)+"</td></tr>";
  }).join("");
  const periods=result.series.flatMap(s=>[...s.periods,...s.annual].map(p=>"<tr><td>"+e(s.station_id)+"<br>"+e(s.characteristic)+" / "+e(s.sample_fraction)+"<br>"+e(s.method_id)+"</td><td>"+e(p.label||"Selected period")+"<br>"+e(p.period_start)+" to "+e(p.period_end)+" (end exclusive)</td><td>"+p.quantified_days+" / "+p.expected_days+"<br>"+(p.coverage_complete?"Complete selected period":"Incomplete selected period")+"</td><td>"+mass(p)+"</td><td>"+number(p.quantified_flow_volume_m3)+"</td><td>"+concentration(p)+"</td></tr>")).join("");
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Observed concentration and discharge integration</title><style>body{font:16px/1.5 system-ui;margin:2rem auto;padding:0 1rem;max-width:1100px;color:#222}h1{line-height:1.15}table{border-collapse:collapse;width:100%}th,td{padding:.65rem;border-bottom:1px solid #ccc;text-align:left;vertical-align:top}.scroll{overflow:auto}th{background:#eee}a{color:#222;text-decoration:underline}.notice{border-left:4px solid #666;padding:1rem;background:#f5f5f5}</style><h1>Observed concentration and discharge integration</h1><p>'+e(result.contract.period.start)+' to '+e(result.contract.period.end)+' (end exclusive)</p><p class="notice">'+e(result.uncertainty)+'</p><p>'+result.counts.source_samples+' original measurements; '+result.counts.source_flows+' flow rows; '+result.counts.support_admitted_series+' series with accepted spatial support; '+result.counts.context_only_series+' retained as '+e(contextLabel)+'.</p>'+quantityTable+'<div class="scroll"><table><thead><tr><th>Station</th><th>Constituent / fraction / method</th><th>Gauge relation</th><th>Measurements</th><th>Quantified days</th><th>Mass or censor bounds over quantified days (kg)</th><th>Matching-volume mean or bounds (mg/L)</th><th>Interpretation</th></tr></thead><tbody>'+rows+'</tbody></table></div><h2>Selected, seasonal and calendar periods</h2><p>Flow-weighted concentration is 1000 × mass (kg) / matching flow volume (m³), using exactly the same quantified days in numerator and denominator. Censored periods retain lower/upper bounds without a point estimate. Zero-volume periods have no defined concentration. Incomplete periods describe only their quantified days; no missing day is extrapolated or scaled to a year.</p><div class="scroll"><table><thead><tr><th>Station / constituent / fraction / method</th><th>Period</th><th>Quantified days</th><th>Mass or bounds (kg)</th><th>Matching quantified volume (m³)</th><th>Flow-weighted mean or bounds (mg/L)</th></tr></thead><tbody>'+periods+'</tbody></table></div><h2>Reopen the complete source and results</h2><ul><li><a href="observed-loads.json">Full result, original rows and daily coverage</a></li><li><a href="daily-loads.csv">Daily estimated loads and missing-day reasons</a></li><li><a href="period-loads.csv">Selected, seasonal and calendar-year mass, volume and flow-weighted concentration</a></li><li><a href="concentration-context.csv">Original '+e(contextLabel)+' for the workbench</a></li><li><a href="annual-loads.csv">Only admissible complete annual mass rows</a></li></ul><h2>Declared support and assumptions</h2><pre style="white-space:pre-wrap">'+e(JSON.stringify(result.contract,null,2))+'</pre></html>\n';
}
module.exports={VERSION,MASS_FACTOR,UNCERTAINTY,csvParse,csvString,integrate,observationExports,renderHtml};

function retainJoinedRows(input, joins){
  if(!Array.isArray(joins))throw Error("Joined observations must be an array");
  const samples=new Map(input.samples.map((s,i)=>[sampleId(s,i),s]));
  const flows=new Map(input.flows.map(f=>[f.observation_id,f]));
  const retained=[];
  for(const j of joins){
    const id=required(j.sample_id,"Joined sample_id"),s=samples.get(id);
    if(!s)throw Error("Joined row references an unselected original sample: "+id);
    if(j.station_id!==s.station_id||j.date!==s.date)throw Error("Joined row differs from sample station/date: "+id);
    if(j.flow){
      const selected=flows.get(j.flow.observation_id);
      if(!selected||JSON.stringify(selected)!==JSON.stringify(j.flow))throw Error("Joined selected flow differs from complete selected daily edition: "+id);
      if(selected.date!==j.date||selected.monitoring_location_id!==j.gauge_id)throw Error("Joined flow has different date/gauge: "+id);
    }
    // A sample-day match never establishes whole-catchment support or fills unsampled flow days.
    retained.push(clone(j));
  }
  return retained;
}
module.exports.retainJoinedRows=retainJoinedRows;
