export function prepareTributaries({inputs, sha256, utf8, geodesic, capturedAt}) {
  const ROOT = "source/usgs-southeast-sparrow-2012/";
  const canonical = value => JSON.stringify((function ordered(x) {
    if (Array.isArray(x)) return x.map(ordered);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map(k => [k, ordered(x[k])]));
    if (typeof x === "number" && !Number.isFinite(x)) throw Error("Nonfinite prepared value");
    return x;
  })(value));
  const digest = value => sha256(utf8(canonical(value)));
  const describe = (path, content) => ({path, bytes:utf8(content).length, sha256:sha256(utf8(content))});
  const fail = (condition, reason) => {if (!condition) throw Error(reason);};
  const read = path => {fail(typeof inputs[path] === "string", "Missing original input " + path); return inputs[path];};
  const parse = path => JSON.parse(read(path));
  const py = read("source_tools/sparrow_reference.py");
  function literal(name, next) {
    const start = py.indexOf(name + " = ");
    fail(start >= 0, "Original helper constant is absent: " + name);
    const end = py.indexOf(next, start);
    fail(end > start, "Original helper constant boundary is absent: " + name);
    return JSON.parse(py.slice(start + name.length + 3, end).trim()
      .replace(/\bNone\b/g,"null").replace(/\bFalse\b/g,"false").replace(/\bTrue\b/g,"true")
      .replace(/,\s*([}\]])/g,"$1"));
  }
  const FILES = literal("FILES", "\n\n\n# Current");
  const TABLES = literal("TABLES", "\n# FILES");
  const choices = literal("CATCHMENT_CHOICES", "\n\n\nCOMPONENT_REVIEWS");
  const reviews = new Map(parse(ROOT+"geometry-review.json").reviews.map(x=>[x.published_comid,x]));
  const selection = parse(ROOT+"upper-savannah-tributaries-selection.json");
  fail(selection.schema === "upstate.sparrow-regional-reference-selection/v1", "Original selection schema differs");
  fail(selection.records.length === 7, "Use the complete original seven-record tributary selection");
  const source = {
    schema:"upstate.sparrow-regional-reference-source/v1",
    release:{doi:"10.5066/P9A682GW",reference_base_year:2012,service_edition:"Republished with 10.06.2019 data update -ESM",
      target_horizon:{start_inclusive:"1999-10-01",end_inclusive:"2014-09-30",end_exclusive:"2014-10-01",
        scope:"source_global",source_field:"FGDC timeperd/timeinfo/rngdates",
        meaning:"Period covered by model calibration targets and some input variables"},
      prediction_fields_excluded:["PLOAD_TOTA","PLOAD_MT"],
      uncertainty:"The original mapper does not publish target standard errors"},files:{}
  };
  for (const [name, expected] of Object.entries(FILES)) {
    const actual = describe(name, read(ROOT+name));
    fail(actual.bytes===expected.bytes && actual.sha256===expected.sha256, "Original source changed: "+name);
    source.files[name]={...actual,uri:expected.uri};
  }
  source.id=digest(source);
  fail(source.id===selection.source_id,"Original source and selection identities differ");
  const reaches={};
  function attributes(name,required) {
    const body=parse(ROOT+name),fields=body.fields.map(f=>f.name);
    fail(!body.error&&!body.exceededTransferLimit,"Incomplete original table "+name);
    fail(new Set(fields).size===fields.length&&required.every(k=>fields.includes(k)),"Original fields differ "+name);
    const rows=body.features.map(f=>f.attributes);
    fail(rows.every(r=>required.every(k=>Object.hasOwn(r,k))),"Missing original table field "+name);
    return {fields,rows};
  }
  for(const name of Object.keys(FILES).filter(n=>n.startsWith("reach-crosswalk-"))) {
    for(const row of attributes(name,["COMID","REACHCODE"]).rows) {
      const comid=String(row.COMID),code=String(row.REACHCODE);
      fail(/^[0-9]{14}$/.test(code),"Original reach code differs");
      fail(!reaches[comid]||canonical(reaches[comid].attributes)===canonical(row),"Conflicting original reach");
      reaches[comid]={file:name,attributes:row,huc8:code.slice(0,8)};
    }
  }
  const series={tn:{code:"00600",parameter:"nitrogen",title:"total nitrogen"},
    tp:{code:"00665",parameter:"phosphorus",title:"total phosphorus"},
    ssc:{code:"80154",parameter:"sediment",title:"suspended sediment"},
    tss:{code:"00530",parameter:"sediment",title:"total suspended solids"}};
  const all=[],tables=[];
  for(const [name, table] of Object.entries(TABLES)) {
    const required=["OBJECTID","COMID","LAT","LON","STATION_ID","STATION_NM",
      ...(table.series===null?["ACTUAL_MT","CONSTITUEN","TSS_CONV","PLOAD_MT"]:["ACTUAL","PLOAD_TOTA"])];
    const {fields,rows}=attributes(name,required);
    fail(rows.length===table.records&&new Set(rows.map(r=>r.OBJECTID)).size===rows.length,"Original complete table count differs");
    tables.push({series:table.series||"ssc/tss",
      loads:{...source.files[name],member:name,fields,records:rows.length},
      sites:"Original station attributes and publisher-network reach crosswalk retained together"});
    for(const row of rows) {
      fail(table.series!==null||["TSS","SUSPSED"].includes(row.CONSTITUEN),"Original sediment constituent differs");
      const key=table.series||(row.CONSTITUEN==="TSS"?"tss":"ssc"),definition=series[key];
      const field=definition.parameter==="sediment"?"ACTUAL_MT":"ACTUAL";
      const unit=definition.parameter==="sediment"?"metric_tonnes/year":"kg/year",comid=String(row.COMID);
      const reach=reaches[comid]||null,value=Number(row[field]),lon=Number(row.LON),lat=Number(row.LAT);
      const record={record_id:digest({source_id:source.id,layer:table.layer,object_id:row.OBJECTID}),
        series:key,parameter:definition.parameter,parameter_code:definition.code,
        source_constituent:row.CONSTITUEN??definition.title,station_id:String(row.STATION_ID),
        station_name:row.STATION_NM,flow_station_id:"",comid,huc8:reach?[reach.huc8]:[],
        huc8_original:reach?[reach.huc8]:[],original_reach:reach,member:{member:name},
        record_number:row.OBJECTID,original_attributes:row,row,final_method:"published_regional_target",
        selected_load_field:field,selected_standard_error_field:null,unit,value_unit:unit,
        period_start:"1999-10-01",period_end:"2014-10-01",
        uncertainty:{kind:"target standard error not published in regional mapper",value:null,unit,
          original_field:null,scope:"unknown; regional model prediction errors are not target errors"},
        temporal_basis:{kind:"published regional long-term average annual calibration target",scope:"source_global",
          flow_start_inclusive:"1999-10-01",flow_end_inclusive:"2014-09-30",station_sampling_start:null,
          station_sampling_end:null,reference_base_year:2012,complete_anniversary_period:true,
          source_metadata:"P9A682GW-original-metadata.xml",
          meaning:"Published global calibration-target horizon; individual station periods are not exposed"},issues:[]};
      if(!Number.isFinite(value)||value<0)record.issues.push(field+" must be a finite nonnegative value");
      if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon< -180||lon>180||lat< -90||lat>90)record.issues.push("Original station coordinates are outside geographic limits");
      if(!record.station_id)record.issues.push("Original station identifier is empty");
      if(!reach)record.issues.push("No exact published-network COMID/HUC attribution was returned");
      if(!record.issues.length)Object.assign(record,{value,value_exact:String(value),longitude:lon,latitude:lat});
      if(choices[comid])Object.assign(record,{retained_catchment:choices[comid],component_review:reviews.get(comid)});
      all.push(record);
    }
  }
  const byId=new Map(all.map(r=>[r.record_id,r]));
  const count=rows=>Object.fromEntries([...new Set(rows.map(r=>r.series))].map(k=>[k,rows.filter(r=>r.series===k).length]));
  const inventory={schema:"upstate.sparrow-regional-reference-inventory/v1",published_reach_count:Object.keys(reaches).length,
    source,selected_huc8:[],tables,record_counts:count(all),usable_counts:count(all.filter(r=>!r.issues.length)),
    station_count:new Set(all.map(r=>r.station_id)).size,
    selection_basis:"Original calibration-table COMID joined to the same publisher's layer 42 REACHCODE; its first eight digits identify HUC8",
    selected_original_records:selection.records.map(r=>{fail(byId.has(r.record_id),"Selected original record missing");return byId.get(r.record_id);})};
  const plan={schema:"upstate.sparrow-regional-reference-plan/v1",source,selection};
  const files={},copies={};
  const add=(path,body)=>{fail(!Object.hasOwn(files,path)||files[path]===body,"Prepared member changed "+path);files[path]=body;return describe(path,body);};
  const json=(path,body)=>add(path,canonical(body)+"\n");
  json("plan.json",plan);
  for(const [name,item]of Object.entries(source.files))copies[name]={...add("original/"+name,read(ROOT+name)),uri:item.uri};
  json("inventory.json",inventory);

  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function on(a,b,p) {return cross(a,b,p)===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);}
  function segments(a,b,c,d) {
    if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])||
       Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))return false;
    const p=cross(a,b,c),q=cross(a,b,d),r=cross(c,d,a),s=cross(c,d,b);
    return ((p<0&&q>0||p>0&&q<0)&&(r<0&&s>0||r>0&&s<0))||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
  }
  function inside(point,ring) {
    let state=false;
    for(let i=0;i<ring.length-1;i++) {
      const a=ring[i],b=ring[i+1];if(on(a,b,point))return true;
      if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])state=!state;
    }
    return state;
  }
  const geometries={},geometryChecks=[];
  function catchment(record,choice) {
    const id=choice.identifier;
    fail(["6269342","6280111","11730084"].includes(id)&&choice.source==="comid"&&choice.station_role==="published_reach"&&id===record.comid,"This prepared cohort selects its three original tributary reaches");
    fail(choice.split_catchment===false&&canonical(choice.component_indices)==="[0]","Original full-reach/component selection differs");
    const saved={},bodies={};
    for(const kind of ["feature","basin"]) {
      const item=choice[kind],body=read(ROOT+item.path),actual=describe(item.path,body);
      fail(actual.bytes===item.bytes&&actual.sha256===item.sha256,"Original NLDI body changed");
      const expected="https://api.water.usgs.gov/nldi/linked-data/comid/"+id+(kind==="basin"?"/basin?f=json&simplified=false&splitCatchment=false":"?f=json");
      fail(item.uri===expected,"Original NLDI full-reach URL differs");
      bodies[kind]=JSON.parse(body);
      const crs=bodies[kind].crs?.properties?.name;
      fail(crs===undefined||[null,"EPSG:4326","urn:ogc:def:crs:OGC:1.3:CRS84","urn:ogc:def:crs:EPSG::4326"].includes(crs),"Original geographic CRS differs");
      saved[kind]={...add("nldi/original/"+item.sha256+".json",body),uri:item.uri};
    }
    const feature=bodies.feature.features[0];
    fail(bodies.feature.type==="FeatureCollection"&&bodies.feature.features.length===1&&String(feature.properties.identifier)===id,"Original reach feature differs");
    fail(feature.properties.source===undefined||feature.properties.source===null||feature.properties.source==="comid","Original feature source differs");
    const basin=bodies.basin;
    fail(basin.type==="FeatureCollection"&&basin.features.length===1,"Original single complete basin differs");
    const geometry=basin.features[0].geometry;
    fail(geometry.type==="Polygon"&&geometry.coordinates.length===1,"These exact tributary originals each contain one complete polygon ring");
    if(!geometries[id]) {
      const ring=geometry.coordinates[0];
      fail(ring.length>=4&&canonical(ring[0])===canonical(ring.at(-1)),"Original polygon ring must be closed");
      fail(ring.every(p=>p.length===2&&p.every(Number.isFinite)&&p[0]>=-180&&p[0]<=180&&p[1]>=-90&&p[1]<=90),"Original coordinates differ");
      for(let i=0;i<ring.length-1;i++)for(let j=i+2;j<ring.length-1;j++) {
        if(i===0&&j===ring.length-2)continue;
        fail(!segments(ring[i],ring[i+1],ring[j],ring[j+1]),"Original polygon has an intersecting nonadjacent segment");
      }
      fail(feature.geometry.type==="LineString","Original NLDI COMID must retain its reach geometry");
      const line=feature.geometry.coordinates;
      let meets=line.some(p=>inside(p,ring));
      if(!meets)for(let i=0;i<line.length-1&&!meets;i++)for(let j=0;j<ring.length-1&&!meets;j++)meets=segments(line[i],line[i+1],ring[j],ring[j+1]);
      fail(meets,"Original published reach does not intersect its original basin");
      const polygon=new geodesic.PolygonArea.PolygonArea(geodesic.Geodesic.WGS84,false);
      for(const [lon,lat]of ring)polygon.AddPoint(lat,lon);
      const result=polygon.Compute(false,true),area=Math.abs(result.area);
      fail(Number.isFinite(area)&&area>0,"Original WGS84 polygon has no measurable area");
      geometries[id]={geometry,area};
      geometryChecks.push({comid:id,original_basin_sha256:choice.basin.sha256,vertices:ring.length,
        component_count:1,selected_components:[0],omitted_components:[],self_intersections:0,
        published_reach_intersects:true,area_m2:area,area_method:"GeographicLib "+geodesic.Constants.version_string+" WGS84 geodesic polygon; original coordinate sequence",
        geographiclib_version:geodesic.Constants.version_string});
    }
    const {area}=geometries[id];
    const catchment_id=digest({source:"comid",identifier:id,split_catchment:false,
      original_basin_sha256:choice.basin.sha256,component_indices:[0]});
    fail(catchment_id===reviews.get(id).catchment_id,"Original catchment digest differs");
    const context={catchment_id,annual_record_id:record.record_id,annual_release:"10.5066/P9A682GW",
      source:"comid",identifier:id,station_role:"published_reach",station_id:record.station_id,flow_station_id:"",
      published_comid:id,original_feature:feature,split_catchment:false,simplified:false,
      original_sources:saved,original_component_count:1,selected_component_indices:[0],omitted_component_indices:[],
      component_selection_reason:choice.component_selection_reason??null,omitted_components:[],
      upstream_area_km2:area/1000000,published_reach_attribution:record.original_reach};
    return {feature:{type:"Feature",id:catchment_id,geometry,
      properties:{catchment_id,station_id:record.station_id,station_name:record.station_name,
        nldi_source:"comid",nldi_identifier:id,upstream_area_km2:area/1000000}},context};
  }
  const features=new Map(),contexts=[],annual=[],seen=new Set(),pairs=new Set();
  for(const chosen of selection.records) {
    fail(!seen.has(chosen.record_id),"Repeated original annual record");seen.add(chosen.record_id);
    const record=byId.get(chosen.record_id);fail(!record.issues.length,"Selected original row requires source correction");
    const {feature,context}=catchment(record,chosen.retained_catchment),id=feature.id;
    const pair=id+"|"+record.parameter;fail(!pairs.has(pair),"Duplicate original constituent series");pairs.add(pair);
    fail(!features.has(id)||canonical(features.get(id).geometry)===canonical(feature.geometry),"Original catchment changed");
    features.set(id,feature);contexts.push(context);
    const source_records={...record,original_table:copies[record.member.member],
      dictionary:copies["P9A682GW-original-metadata.xml"],publisher_reach_table:copies[record.original_reach.file],
      catchment_source:context,comparability_note:chosen.comparability_note??null};
    annual.push({record_id:record.record_id,station_id:record.station_id,catchment_id:id,parameter:record.parameter,
      value:record.value,unit:record.unit,period_start:record.period_start,period_end:record.period_end,
      qualifier:"published_regional_calibration_target",
      method:"USGS published Southeast regional calibration target; underlying annual-load estimator family is documented in Saad et al. (2019)",
      uncertainty:record.uncertainty,source_records});
  }
  json("annual-records.json",annual);
  json("catchments.geojson",{type:"FeatureCollection",features:[...features.values()]});
  json("catchment-sources.json",{catchments:contexts});
  const columns=["record_id","station_id","catchment_id","parameter","value","unit","period_start","period_end","qualifier","method","uncertainty","source_records"];
  const cell=v=>{const text=v!==null&&typeof v==="object"?canonical(v):v===null?"":String(v);return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};
  add("annual-loads.csv",columns.join(",")+"\n"+annual.map(r=>columns.map(k=>cell(r[k])).join(",")).join("\n")+"\n");
  const metadata={
    title:selection.title,source_uri:"https://doi.org/10.5066/P9A682GW",release:source.release,
    value_basis:"annual_mass_rate",accepted_qualifiers:["published_regional_calibration_target"],
    annualization_method:"Use original ACTUAL for nitrogen/phosphorus in kg/year and ACTUAL_MT for sediment in metric tonnes/year. These are already annual calibration-target rates. Do not use PLOAD_TOTA/PLOAD_MT predictions or apply the model's TSS_CONV coefficient. The original regional FGDC metadata publishes a global target horizon 1999-10-01 through 2014-09-30; period_end is the exclusive 2014-10-01. This is source-global support, not an individual station sampling window, and rates are not multiplied by the horizon length.",
    recommended_temporal_weighting:"whole_years",sha256:sha256(utf8(files["annual-loads.csv"])),
    constituents:[...new Set(annual.map(r=>byId.get(r.record_id).parameter_code))].sort(),
    notes:[
      "The regional targets describe 2012 reference conditions; current land cover and climate scenarios retain their distinct vintages.",
      "Individual final estimator identity and target standard error are not exposed in this original mapper.",
      "The reported 15-year horizon is source-global. Selected targets must not be presented as individual yearly measurements.",
      "Suspended sediment 80154 and total suspended solids 00530 retain their original identity; the selection chooses one source series per catchment/native parameter."
    ]
  };
  json("observation-metadata.json",metadata);
  const companions=Object.keys(files).filter(n=>!["annual-loads.csv","catchments.geojson"].includes(n)).sort().map(n=>describe(n,files[n]));
  const prefix="usgs-southeast-reference-"+digest(plan).slice(0,16);
  const entries=[
    {id:prefix+"-loads",kind:"table",role:"OBSERVED_LOADS",title:selection.title,uri:"https://doi.org/10.5066/P9A682GW",
      vintage:"2012 reference conditions; global target horizon water years 2000–2014",...describe("annual-loads.csv",files["annual-loads.csv"]),
      observation_metadata:metadata,companions},
    {id:prefix+"-catchments",kind:"vector",role:"OBSERVATION_CATCHMENTS",title:"Upstream catchments for the selected published annual loads",
      uri:"https://api.water.usgs.gov/nldi/linked-data",vintage:"Original retained NLDI response edition",
      ...describe("catchments.geojson",files["catchments.geojson"]),id_field:"catchment_id",companions}
  ];
  fail(/^\d{4}-\d{2}-\d{2}T/.test(capturedAt),"Retain the actual preparation timestamp");
  json("source-manifest.json",{schema:"upstate.sources/v1",title:selection.title,captured_at:capturedAt,
    scope:selection.scope,entries,notes:metadata.notes});
  const result={schema:"upstate.sparrow-regional-reference-preparation/v1",plan_id:digest(plan),
    records:annual.length,stations:new Set(annual.map(r=>r.station_id)).size,catchments:features.size,
    parameters:[...new Set(annual.map(r=>r.parameter))].sort(),source_manifest:"source-manifest.json",
    observation_csv:"annual-loads.csv",observation_metadata:"observation-metadata.json",
    files:["source-manifest.json","annual-loads.csv","catchments.geojson"].map(n=>describe(n,files[n])).concat(companions)};
  result.id=digest(result);json("result.json",result);
  return {files,result,geometryChecks,source_id:source.id,plan_id:result.plan_id,
    records:annual.map(r=>({record_id:r.record_id,station_id:r.station_id,catchment_id:r.catchment_id,
      parameter:r.parameter,value:r.value,unit:r.unit,original_constituent:r.source_records.source_constituent,
      published_comid:r.source_records.comid,huc8:r.source_records.huc8}))};
}
