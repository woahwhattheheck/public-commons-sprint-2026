function buildTraceMetalStudy(tables, input) {
  const metals = ["Cadmium","Chromium","Copper","Iron","Lead","Manganese","Mercury","Nickel","Zinc"];
  const contextNames = ["Calcium","Magnesium","Hardness, Ca, Mg"];
  const require = (ok,message) => { if (!ok) throw new Error(message); };
  const uniq = values => [...new Set(values)].sort();
  const number = (raw,name) => { if(raw===""||raw===null||raw===undefined)return null; const n=Number(raw);require(Number.isFinite(n),name+" is not a finite original number");return n; };
  const eventKey = r => JSON.stringify([r.organization_id,r.station_id,r.project_id,r.activity_id]);
  const records = tables.measurements.filter(r=>metals.includes(r.characteristic)).map(r=>({...r}));
  require(records.length===153,"This edition requires all 153 original metal results.");
  require(new Set(records.map(r=>r.record_id)).size===records.length,"Original metal result identities must be unique.");
  const events = new Map(), groups = new Map();
  for (const row of records) {
    require(row.project_id==="SWS-2023"&&row.media==="Water"&&row.sample_fraction==="Unfiltered","The original metal source medium, project or fraction differs.");
    require(/^\d{4}-\d{2}-\d{2}$/.test(row.sample_date)&&row.sample_date.startsWith("2023-"),"The original metal date differs.");
    const value=number(row.reported_value,"Reported value"),limit=number(row.detection_limit,"Reported quantification limit");
    const kind=row.quantitation_class==="reported_numeric"?"reported":row.quantitation_class==="censored_below"?"below":null;
    require(kind!==null,"Review the original metal quantitation condition before changing this source edition.");
    require((kind==="reported"&&value!==null&&row.detection_condition==="")||(kind==="below"&&value===null&&row.detection_condition==="Present Below Quantification Limit"&&limit!==null),"The original reported value and detection condition disagree.");
    require((value===null||value>=0)&&(limit===null||limit>=0),"Original metal support is negative.");
    const unit=kind==="reported"?row.reported_unit:row.detection_limit_unit;
    require(unit==="mg/L","This original edition uses mg/L support.");
    require(!row.reported_unit||!row.detection_limit_unit||row.reported_unit===row.detection_limit_unit,"Keep unlike result and limit units as separate source support.");
    row.interpretation={kind,value,limit,unit,display:kind==="reported"?row.reported_value+" "+row.reported_unit:"< "+row.detection_limit+" "+row.detection_limit_unit,scope:"Original unfiltered water sample"};
    const key=eventKey(row),signature=[row.sample_date,row.sample_time,row.sample_timezone,row.activity_type,row.media,row.activity_depth,row.activity_depth_unit];
    if(!events.has(key))events.set(key,{id:key,station_id:row.station_id,activity_id:row.activity_id,project_id:row.project_id,date:row.sample_date,time:row.sample_time,timezone:row.sample_timezone,signature,records:[],context:[]});
    const event=events.get(key);
    require(JSON.stringify(event.signature)===JSON.stringify(signature),"One original activity has conflicting sampling metadata.");
    event.records.push(row.record_id);
    const cohort=JSON.stringify([row.characteristic,row.media,row.sample_fraction,unit,row.analytical_method_context,row.analytical_method_id,row.result_time_basis,row.result_weight_basis,row.result_temperature_basis,row.result_particle_size_basis]);
    if(!groups.has(cohort))groups.set(cohort,{id:cohort,metal:row.characteristic,unit,media:row.media,fraction:row.sample_fraction,method:row.analytical_method_context+" "+row.analytical_method_id,records:[]});
    groups.get(cohort).records.push(row);
  }
  require(events.size===17&&uniq(records.map(r=>r.station_id)).length===5,"This source edition requires its original 17 activities at five stations.");
  for(const event of events.values()) {
    const present=records.filter(r=>eventKey(r)===event.id).map(r=>r.characteristic);
    require(present.length===9&&metals.every(m=>present.includes(m)),"An original activity lost one of its nine metal results.");
  }
  const context = tables.measurements.filter(r=>contextNames.includes(r.characteristic)&&events.has(eventKey(r))).map(r=>({...r}));
  require(context.length===51&&new Set(context.map(r=>r.record_id)).size===51,"Retain the 51 original same-activity hardness and major-ion results.");
  for(const row of context)events.get(eventKey(row)).context.push(row.record_id);
  for(const event of events.values()) require(event.context.length===3,"An original metal activity lost its three original chemistry context rows.");
  const summarize = rows => {
    const reported=rows.filter(r=>r.interpretation.kind==="reported"),below=rows.filter(r=>r.interpretation.kind==="below");
    const values=reported.map(r=>r.interpretation.value);
    return {records:rows.length,activities:uniq(rows.map(eventKey)).length,reported:reported.length,below:below.length,reported_min:values.length?Math.min(...values):null,reported_max:values.length?Math.max(...values):null,reported_range_record_ids:reported.filter(r=>r.interpretation.value===Math.min(...values)||r.interpretation.value===Math.max(...values)).map(r=>r.record_id),limits:uniq(rows.filter(r=>r.detection_limit!==""&&r.detection_limit!==null&&r.detection_limit!==undefined).map(r=>r.detection_limit+" "+r.detection_limit_unit)),dates:uniq(rows.map(r=>r.sample_date)),months:uniq(rows.map(r=>r.sample_date.slice(0,7))),record_ids:rows.map(r=>r.record_id)};
  };
  require(groups.size===metals.length&&metals.every(metal=>[...groups.values()].filter(group=>group.metal===metal).length===1),"This frozen source edition requires one original method/unit/fraction/basis cohort per metal.");
  const summaries=[...groups.values()].sort((a,b)=>metals.indexOf(a.metal)-metals.indexOf(b.metal)).map(({records:rows,...group})=>({...group,...summarize(rows)}));
  const stations=uniq(records.map(r=>r.station_id)).map(id=>{const {reported_min,reported_max,reported_range_record_ids,limits,...support}=summarize(records.filter(r=>r.station_id===id));return {id,...support,metals:metals.map(metal=>({metal,...summarize(records.filter(r=>r.station_id===id&&r.characteristic===metal))}))};});
  const activities=[...events.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.station_id.localeCompare(b.station_id)||a.activity_id.localeCompare(b.activity_id)).map(({signature,...event})=>event);
  const pairs=[];
  for(let a=0;a<stations.length;a++)for(let b=a+1;b<stations.length;b++){const first=stations[a],second=stations[b];pairs.push({first:first.id,second:second.id,first_activity_count:first.activities,second_activity_count:second.activities,shared_sampled_months:first.months.filter(m=>second.months.includes(m)),shared_sample_dates:first.dates.filter(d=>second.dates.includes(d)),first_only_months:first.months.filter(m=>!second.months.includes(m)),second_only_months:second.months.filter(m=>!first.months.includes(m)),basis:"Calendar overlap only; distinct activities and collection times remain separate."});}
  const all=summarize(records);
  require(all.reported===38&&all.below===115,"The original reported/below-limit metal counts changed.");
  return {schema:"upstate.eighteenmile-trace-metals/v1",edition:"20261013-original153",title:"Eighteenmile Creek 2023 — original trace-metal observations",input,metals,context_characteristics:contextNames,counts:{original_rows:tables.measurements.length,records:records.length,activities:activities.length,stations:stations.length,reported:38,below:115,context_records:context.length},period:{start:activities[0].date,end:activities.at(-1).date,sampled_months:all.months},interpretation:["Each sampling activity retains all nine original unfiltered metal results and its separate calcium, magnesium and hardness observations.","Below-limit markers are located at the original quantification limit. Their blank reported-value fields remain blank.","Reported ranges summarize only the quantified original results in the same analyte, unit, fraction and method group.","The calendar identifies actual sampled activities and dates. Different stations have different sampling schedules.","Original result, activity and laboratory comments, collection methods, analytical methods and source row identities travel with every selected result."],summaries,stations,activities,calendar_pairs:pairs,records,context};
}

export { buildTraceMetalStudy };
