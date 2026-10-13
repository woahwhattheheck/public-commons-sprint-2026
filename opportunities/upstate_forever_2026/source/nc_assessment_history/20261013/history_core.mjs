/** Source-native assessment history. Original publisher strings and fixed 2022 cohort. */
export const EDITION = "nc-assessment-history-20261013-v1";
export const YEARS = [2008,2010,2012,2014,2016,2018,2020,2022];
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const key = value => JSON.stringify(value);
export function decimalSum(values) {
  const parts=values.map(value=>{
    const match=/^(-?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
    if(!match) throw new Error("Invalid original decimal size: "+value);
    const scale=(match[3]||"").length-Number(match[4]||0);
    return {n:BigInt((match[1]||"")+match[2]+(match[3]||"")),scale};
  });
  const scale=Math.max(0,...parts.map(x=>x.scale));
  const total=parts.reduce((s,x)=>s+x.n*10n**BigInt(scale-x.scale),0n);
  const sign=total<0n?"-":""; let digits=(total<0n?-total:total).toString().padStart(scale+1,"0");
  return sign+(scale?(digits.slice(0,-scale)+"."+digits.slice(-scale)).replace(/\.?0+$/,""):digits);
}
function groupSummary(rows,field) {
  const groups=new Map();
  for(const row of rows){const value=row[field],k=key(value); if(!groups.has(k))groups.set(k,{value,rows:[]});groups.get(k).rows.push(row);}
  return [...groups.values()].sort((a,b)=>compare(key(a.value),key(b.value))).map(g=>({
    value:g.value,assessment_units:g.rows.length,by_published_size_unit:sizeSummary(g.rows)
  }));
}
function sizeSummary(rows) {
  const groups=new Map();
  for(const row of rows){const k=key(row.published_size_unit);if(!groups.has(k))groups.set(k,{unit:row.published_size_unit,rows:[]});groups.get(k).rows.push(row);}
  return [...groups.values()].sort((a,b)=>compare(key(a.unit),key(b.unit))).map(g=>({
    unit:g.unit,assessment_units:g.rows.length,
    valid_size_units:g.rows.filter(r=>r.published_size_decimal!==null).length,
    missing_size_units:g.rows.filter(r=>r.published_size_decimal===null).length,
    fixed_2022_published_size_decimal:decimalSum(g.rows.flatMap(r=>r.published_size_decimal===null?[]:[r.published_size_decimal]))
  }));
}
export function analyze(originalText, metadataText, provenance) {
  const original=JSON.parse(originalText),metadata=JSON.parse(metadataText);
  if(original.error||metadata.error||!Array.isArray(original.features)||!Array.isArray(metadata.fields))throw new Error("Expected full official original feature response and layer metadata");
  if(original.exceededTransferLimit)throw new Error("Original source response is truncated");
  const fields=new Map(metadata.fields.map(f=>[f.name,f]));
  for(const field of ["OBJECTID","AU_ID","AU_Name","AU_Length","AU_Units",...YEARS.map(y=>"IR"+y)])if(!fields.has(field))throw new Error("Missing original field "+field);
  const sizeTokens=[...originalText.matchAll(/"AU_Length"\s*:\s*(null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)].map(m=>m[1]);
  if(sizeTokens.length!==original.features.length)throw new Error("Every original AU_Length lexical value must match one feature");
  const seenOID=new Set(),seenAU=new Set();
  const units=original.features.map((feature,index)=>{
    const a=feature.attributes;
    if(!a||!Number.isSafeInteger(a.OBJECTID)||!Number.isSafeInteger(a.AU_ID)||seenOID.has(a.OBJECTID)||seenAU.has(a.AU_ID))throw new Error("Unique original assessment and object IDs are required");
    seenOID.add(a.OBJECTID);seenAU.add(a.AU_ID);
    if(a.AU_Length!==null&&(!Number.isFinite(a.AU_Length)||a.AU_Length<0))throw new Error("Invalid original size");
    if((sizeTokens[index]==="null"?null:Number(sizeTokens[index]))!==a.AU_Length)throw new Error("Original size token does not match original record");
    const ratings=YEARS.map(year=>{
      const field="IR"+year;if(!Object.prototype.hasOwnProperty.call(a,field))throw new Error("Missing original rating cell");
      if(a[field]!==null&&typeof a[field]!=="string")throw new Error("Rating must retain the original string or null");
      return {year,field,alias:fields.get(field).alias,rating:a[field]};
    });
    const transitions=[];
    for(let i=1;i<ratings.length;i++)if(ratings[i-1].rating!==ratings[i].rating)transitions.push({from_year:ratings[i-1].year,to_year:ratings[i].year,from_rating:ratings[i-1].rating,to_rating:ratings[i].rating});
    return {
      object_id:a.OBJECTID,assessment_unit_id:a.AU_ID,assessment_unit_number:a.AU_Number,
      bims_index:a.BIMS_INDEX,name:a.AU_Name,description:a.AU_Desc,type:a.AU_Type,
      huc8_original:a.HUC8,basin:a.Basin,subbasin:a.Subbasin,bims_class:a.BIMS_CLASS,primary_class:a.PRIMARY_CLASS,
      published_size_decimal:sizeTokens[index]==="null"?null:sizeTokens[index],published_size_unit:a.AU_Units,
      original_feature_index:index,original_pointer:"/features/"+index+"/attributes",ratings,transitions,
      changed:transitions.length>0,change_count:transitions.length,original_attributes:a
    };
  }).sort((a,b)=>a.object_id-b.object_id);
  const history=units.flatMap(unit=>unit.ratings.map(r=>({
    object_id:unit.object_id,assessment_unit_id:unit.assessment_unit_id,assessment_unit_number:unit.assessment_unit_number,
    bims_index:unit.bims_index,name:unit.name,description:unit.description,type:unit.type,
    huc8_original:unit.huc8_original,subbasin:unit.subbasin,bims_class:unit.bims_class,primary_class:unit.primary_class,
    published_size_decimal:unit.published_size_decimal,published_size_unit:unit.published_size_unit,
    year:r.year,source_field:r.field,source_field_alias:r.alias,rating:r.rating,
    source_pointer:unit.original_pointer+"/"+r.field
  })));
  const ratings=[...new Map(history.map(row=>[key(row.rating),row.rating])).values()].sort((a,b)=>compare(key(a),key(b)));
  const cycles=YEARS.map(year=>{
    const rows=history.filter(r=>r.year===year);
    return {year,assessment_units:rows.length,by_rating:groupSummary(rows,"rating"),by_size_unit:sizeSummary(rows)};
  });
  const transitions=units.flatMap(unit=>unit.transitions.map(t=>({
    object_id:unit.object_id,assessment_unit_id:unit.assessment_unit_id,name:unit.name,description:unit.description,
    bims_index:unit.bims_index,bims_class:unit.bims_class,huc8_original:unit.huc8_original,
    published_size_decimal:unit.published_size_decimal,published_size_unit:unit.published_size_unit,...t,
    from_source_pointer:unit.original_pointer+"/IR"+t.from_year,to_source_pointer:unit.original_pointer+"/IR"+t.to_year
  }))).sort((a,b)=>a.from_year-b.from_year||a.object_id-b.object_id);
  const transition_matrices=YEARS.slice(1).map((year,index)=>{
    const fromYear=YEARS[index],cells=[];
    for(const from of ratings)for(const to of ratings){
      const members=units.filter(u=>u.ratings[index].rating===from&&u.ratings[index+1].rating===to);
      cells.push({from_rating:from,to_rating:to,assessment_units:members.length,assessment_unit_ids:members.map(u=>u.assessment_unit_id),by_published_size_unit:sizeSummary(members)});
    }
    return {from_year:fromYear,to_year:year,total_units:units.length,changed_units:cells.filter(c=>c.from_rating!==c.to_rating).reduce((n,c)=>n+c.assessment_units,0),cells};
  });
  const trajectories=new Map();
  for(const u of units){const k=JSON.stringify(u.ratings.map(r=>r.rating));if(!trajectories.has(k))trajectories.set(k,[]);trajectories.get(k).push(u);}
  const trajectory_groups=[...trajectories.entries()].map(([k,members])=>({ratings:JSON.parse(k),assessment_units:members.length,assessment_unit_ids:members.map(u=>u.assessment_unit_id),by_published_size_unit:sizeSummary(members)})).sort((a,b)=>b.assessment_units-a.assessment_units||compare(JSON.stringify(a.ratings),JSON.stringify(b.ratings)));
  const cohort_summary={
    assessment_units:units.length,rating_cells:history.length,cycle_count:YEARS.length,
    constant_units:units.filter(u=>!u.changed).length,changed_units:units.filter(u=>u.changed).length,
    adjacent_cycle_changes:transitions.length,by_published_size_unit:sizeSummary(units),
    always_rating:ratings.map(rating=>({rating,assessment_units:units.filter(u=>u.ratings.every(r=>r.rating===rating)).length})),
    by_subbasin:groupSummary(units,"subbasin"),
    by_current_class:groupSummary(units,"bims_class")
  };
  return {
    schema:"upstate.nc-assessment-history/v1",edition:EDITION,title:"North Carolina assessment rating history, 2008–2022",
    years:YEARS,ratings,source:provenance,
    scope:{
      source_edition:"NC DEQ Final 2022 Integrated Report",
      source_layer:2,source_huc8_filter:[3060101,3060102],
      historical_fields:YEARS.map(y=>({name:"IR"+y,alias:fields.get("IR"+y).alias})),
      cohort_basis:"The same assessment units present in the captured 2022 layer; earlier ratings are original columns on those current records.",
      size_basis:"AU_Length and AU_Units are the source's fixed 2022 published size. Size-weighted groupings use that fixed corpus, not reconstructed historical lengths or areas.",
      rating_interpretation:"Preserve each original publisher rating verbatim. No Data is an assessment label; null remains missing. Rating changes do not establish a causal or measured water-quality trend.",
      geometry_basis:"No historical geometry is reconstructed. The 34 polygon records are alternate geometries for units in this corpus and are not additional assessment units.",
      parameter_table_basis:"The separate parameter table's 2022 and 2020 CYCLE rows are not these eight overall-rating columns.",
      classification_basis:"BIMS_CLASS and PRIMARY_CLASS are retained current source attributes, not inferred historical legal classifications."
    },
    cohort_summary,cycles,transition_matrices,trajectory_groups,transitions,history,units
  };
}
export function csv(rows,columns) {
  const cell=value=>{const text=value===null||value===undefined?"":String(value);return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
  return [columns,...rows.map(row=>columns.map(c=>row[c]))].map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
export function tables(analysis) {
  const historyColumns=["object_id","assessment_unit_id","assessment_unit_number","bims_index","name","description","type","huc8_original","subbasin","bims_class","primary_class","published_size_decimal","published_size_unit","year","source_field","source_field_alias","rating","source_pointer"];
  const transitionColumns=["object_id","assessment_unit_id","name","description","bims_index","bims_class","huc8_original","published_size_decimal","published_size_unit","from_year","to_year","from_rating","to_rating","from_source_pointer","to_source_pointer"];
  const cycleRows=analysis.cycles.flatMap(c=>c.by_rating.map(r=>({year:c.year,rating:r.value,assessment_units:r.assessment_units,cohort_units:c.assessment_units})));
  const sizes=analysis.cycles.flatMap(c=>c.by_rating.flatMap(r=>r.by_published_size_unit.map(s=>({year:c.year,rating:r.value,...s}))));
  const matrix=analysis.transition_matrices.flatMap(m=>m.cells.map(c=>({from_year:m.from_year,to_year:m.to_year,from_rating:c.from_rating,to_rating:c.to_rating,assessment_units:c.assessment_units,assessment_unit_ids:JSON.stringify(c.assessment_unit_ids)})));
  const units=analysis.units.map(u=>({...u,...Object.fromEntries(u.ratings.map(r=>["IR"+r.year,r.rating]))}));
  return {
    "history.csv":csv(analysis.history,historyColumns),
    "transitions.csv":csv(analysis.transitions,transitionColumns),
    "cycle_counts.csv":csv(cycleRows,["year","rating","assessment_units","cohort_units"]),
    "fixed_2022_size_by_rating.csv":csv(sizes,["year","rating","unit","assessment_units","valid_size_units","missing_size_units","fixed_2022_published_size_decimal"]),
    "transition_matrices.csv":csv(matrix,["from_year","to_year","from_rating","to_rating","assessment_units","assessment_unit_ids"]),
    "unit_trajectories.csv":csv(units,["object_id","assessment_unit_id","assessment_unit_number","bims_index","name","description","huc8_original","subbasin","bims_class","published_size_decimal","published_size_unit","change_count",...YEARS.map(y=>"IR"+y)])
  };
}
