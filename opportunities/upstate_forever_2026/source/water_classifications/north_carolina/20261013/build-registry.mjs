/** Reconcile NC DEQ Savannah schedules and original native classified streams. */
export function buildNorthCarolinaSavannah(files, sha256Text) {
  const parse = path => { if(typeof files[path]!=="string") throw Error("Missing complete input: "+path); return JSON.parse(files[path]); };
  const canonical = x => x===null || typeof x!=="object" ? JSON.stringify(x) : Array.isArray(x) ? "["+x.map(canonical).join(",")+"]" : "{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+canonical(x[k])).join(",")+"}";
  const manifest=parse("source-manifest.json");
  const inputRows=manifest.files;
  for(const row of inputRows) {
    const content=files[row.path];
    if(typeof content!=="string" || sha256Text(content)!==row.sha256) throw Error("Original source hash changed: "+row.path);
  }
  const entry=needle=>{ const row=inputRows.find(x=>x.filename===needle); if(!row)throw Error("Missing original "+needle);return row; };
  const original=needle=>parse(entry(needle).path);
  const metadata=original("nc-surface-water-classifications-layer-original-20261013.json");
  const after=original("nc-surface-water-classifications-layer-after-capture-original-20261013.json");
  if(canonical(metadata)!==canonical(after))throw Error("Publisher metadata changed during capture");
  const ids=original("nc-savannah-classification-ids-original-20261013.json").objectIds;
  const count=original("nc-savannah-classification-count-original-20261013.json").count;
  const attributes=original("nc-savannah-classification-attributes-original-20261013.json").features;
  const pages=inputRows.filter(x=>/^nc-savannah-native-geometry-p\d+-/.test(x.filename));
  const features=[];
  for(const page of pages) {
    const body=parse(page.path);
    if(body.error || body.exceededTransferLimit)throw Error("Incomplete native page: "+page.path);
    if(body.geometryType!=="esriGeometryPolyline" || body.spatialReference.wkid!==32119)throw Error("Original CRS or geometry changed");
    const observed=body.features.map(x=>x.attributes.OBJECTID);
    if(canonical(observed)!==canonical(page.object_ids))throw Error("Native page IDs changed");
    features.push(...body.features);
  }
  const objectIDs=features.map(x=>x.attributes.OBJECTID);
  if(count!==103 || objectIDs.length!==count || new Set(objectIDs).size!==count ||
     canonical([...objectIDs].sort((a,b)=>a-b))!==canonical([...ids].sort((a,b)=>a-b)))throw Error("Incomplete Savannah source cohort");
  const nativeByIndex=new Map();
  for(const feature of features) {
    const a=feature.attributes, expected=attributes.find(x=>x.attributes.OBJECTID===a.OBJECTID);
    if(!expected || canonical(a)!==canonical(expected.attributes))throw Error("Native geometry/attribute source disagreement");
    if(nativeByIndex.has(a.BIMS_INDEX))throw Error("Repeated native BIMS index");
    nativeByIndex.set(a.BIMS_INDEX,a);
  }
  const hydro=parse("extracted/savannah-hydrologic-schedule-lines.json");
  const alpha=parse("extracted/savannah-alphabetic-schedule-lines.json");
  const alphaRecords=alpha.lines.flatMap(row=>{
    const match=row.text.match(/^(.*?)\s+(SAV0[12])\s+(\S+)\s+(\S+)\s+(\S+)\s*$/);
    return match?[{waterbody_name:match[1],subbasin:match[2],index:match[3],map_number:match[4],class_raw:match[5],source_line:row.line,source_page:row.page}]:[];
  });
  if(alphaRecords.length!==count || new Set(alphaRecords.map(x=>x.index)).size!==count)throw Error("Incomplete alphabetic classification schedule");
  const lines=hydro.lines.filter(x=>x.line>=4&&x.line<185&&!/^(?:\d?NC (?:DEQ|DENR)|Name of Stream|2B \.0300|\. 0303|\d$)/.test(x.text));
  let joined="";const spans=[];
  for(const row of lines){spans.push({...row,start:joined.length,end:joined.length+row.text.length});joined+=row.text+" ";}
  const hits=[...joined.matchAll(/(\S+)\s+(\d{2}\/\d{2}\/\d{2})\s+([34][\d().-]*)(?=\s)/g)].map(m=>({class_raw:m[1],date_raw:m[2],index:m[3],class_start:m.index,tail_end:m.index+m[0].length}));
  if(hits.length!==count)throw Error("Incomplete hydrologic schedule");
  for(let i=0;i<hits.length;i++){
    const h=hits[i],a=alphaRecords.find(x=>x.index===h.index);
    if(!a)throw Error("Hydrologic/alphabetic index mismatch: "+h.index);
    const start=joined.lastIndexOf(a.waterbody_name,h.class_start);
    if(start<(i?hits[i-1].tail_end:0))throw Error("Schedule name not located: "+h.index);
    h.name_start=start;h.name_end=start+a.waterbody_name.length;h.alpha=a;
  }
  const records=hits.map((h,i)=>{
    const a=nativeByIndex.get(h.index),end=i+1<hits.length?hits[i+1].name_start:joined.length;
    if(!a)throw Error("Missing native BIMS index: "+h.index);
    const description=(joined.slice(h.name_end,h.class_start)+joined.slice(h.tail_end,end)).replace(/\s+/g," ").trim();
    const [mm,dd,yy]=h.date_raw.split("/"),date=(Number(yy)>26?"19":"20")+yy+"-"+mm+"-"+dd;
    const nativeDate=new Date(a.BIMS_Date).toISOString().slice(0,10);
    if(h.alpha.waterbody_name!==a.BIMS_Name || description!==a.BIMS_Descr || h.class_raw!==a.BIMS_Class || h.alpha.class_raw!==a.BIMS_Class || date!==nativeDate)throw Error("Original schedule/native disagreement: "+h.index);
    const components=h.class_raw.replace(/:(?=[+@])/g,"").replace(/[+@]/g,"").split(/[;,]/).map(x=>x.trim()).filter(Boolean);
    const markers=["+","@"].filter(x=>h.class_raw.includes(x));
    return {
      id:"NC:NC-15A-NCAC-02B:savannah:"+h.index,original_index:h.index,
      jurisdiction:"NC",classification_system:"NC-15A-NCAC-02B",
      waterbody_name:h.alpha.waterbody_name,reach_description:description,county_codes:[],
      class_raw:h.class_raw,class_code:h.class_raw,source_class_label:h.class_raw,
      class_components:components,primary_class:components[0],supplemental_classes:components.slice(1),special_markers:markers,
      classification_role:"designated-water-class",rfp_high_quality_candidate:components.some(x=>["Tr","HQW","ORW"].includes(x)),
      effective_date:date,effective_date_source:h.date_raw,native_effective_date:a.BIMS_Date,native_effective_date_iso:nativeDate,
      subbasin:h.alpha.subbasin,map_number:h.alpha.map_number,
      source_pdf_page:spans.find(x=>x.end>h.name_start).page,
      source_line_start:spans.find(x=>x.end>h.name_start).line,
      source_line_end:[...spans].reverse().find(x=>x.start<end).line,
      alpha_source_pdf_page:h.alpha.source_page,alpha_source_line:h.alpha.source_line,
      native_object_id:a.OBJECTID,native_attributes:a,
      source_url:hydro.source_url
    };
  });
  const registry={
    schema:"upstate.classified-water-registry/v2",
    edition:{id:"nc-savannah-published-schedule-20160303-captured-20261013",jurisdiction:"NC",classification_system:"NC-15A-NCAC-02B",
      title:"North Carolina Savannah river-basin classification schedule",regulation:"15A NCAC 02B .0303 — Savannah classification schedule",status:"source-published",
      publisher:"North Carolina Department of Environmental Quality",source_url:hydro.source_url,
      printed_at_source:"2016/03/03 9:26:10",capture_date:"2026-10-13",native_data_last_edit_date:metadata.editingInfo.dataLastEditDate,
      legal_rule:"15A NCAC 02B .0303",scope:"Complete 103 named Savannah schedule records, independently reconciled to the publisher Savannah-labelled native GIS cohort"},
    source_notes:{special_markers:{
      "+":"Downstream ORW protection management strategy under 15A NCAC 02B .0225; does not itself add ORW to a reach's literal class.",
      "@":"Downstream HQW protection management strategy under 15A NCAC 02B .0201; does not itself add HQW to a reach's literal class."
    },priority_predicate:"Original class components contain Tr, HQW or ORW; a jurisdiction-specific screening field.",
    county_policy:"No county inferred: neither source schedule supplies county codes.",
    geographic_scope:"The publisher Savannah cohort must be intersected with the retained reporting domain and original217 HUC12 boundaries.",
    association:"Same-jurisdiction exact BIMS index and full class support candidate associations; reach coextensivity remains an explicit geometry determination."},
    records
  };
  const combined={objectIdFieldName:"OBJECTID",geometryType:"esriGeometryPolyline",spatialReference:{wkid:32119,latestWkid:32119},fields:metadata.fields,features};
  const layerID="nc-savannah-classified-water";
  const capture={
    schema:"upstate.classified-water-capture/v1",operation_id:manifest.operation_id,captured_at:"2026-10-13",
    files:inputRows.map(x=>({path:x.path,bytes:x.bytes,sha256:x.sha256})),
    layers:[{id:layerID,url:manifest.service_url,name:metadata.name,title:"NC DEQ Savannah native surface-water classifications",feature_count:count,oid_field:"OBJECTID",geometry_type:"esriGeometryPolyline",source_crs:{wkid:32119,latestWkid:32119},field_schema:metadata.fields,
      metadata_path:entry("nc-surface-water-classifications-layer-original-20261013.json").path,
      object_ids_path:entry("nc-savannah-classification-ids-original-20261013.json").path,
      count_path:entry("nc-savannah-classification-count-original-20261013.json").path,
      combined_path:"derived/combined-native-features.json",
      pages:pages.map(x=>({path:x.path,object_ids:x.object_ids,bytes:x.bytes,sha256:x.sha256,source_url:x.source_url}))}]
  };
  const mapping={schema:"upstate.classified-water-mapping/v1",layers:{[layerID]:{
    jurisdiction:"NC",classification_system:"NC-15A-NCAC-02B",status:"source-published",
    vintage:"NC DEQ source-published Savannah classification; captured2026-10-13; native data last edited "+new Date(metadata.editingInfo.dataLastEditDate).toISOString(),
    class_field:"BIMS_Class",name_field:"BIMS_Name",description_field:"BIMS_Descr",native_index_field:"BIMS_INDEX",effective_date_field:"BIMS_Date",
    data_status:"publisher-native",source_cohort_predicate:manifest.predicate
  }}};
  const classCounts={};for(const r of records)classCounts[r.class_code]=(classCounts[r.class_code]||0)+1;
  const summary={schema:"upstate.nc-classification-reconciliation/v1",original_records:count,native_features:features.length,independent_attribute_rows:attributes.length,
    compared_fields:["original_index","waterbody_name","reach_description","class_raw","alphabetic_class_raw","effective_date"],
    exact_agreement_records:count,differences:[],class_counts:classCounts,
    screening_candidate_records:records.filter(x=>x.rfp_high_quality_candidate).length,
    management_marker_records:records.filter(x=>x.special_markers.length).length,
    geometry_parts:features.reduce((n,f)=>n+f.geometry.paths.length,0),
    geometry_vertices:features.reduce((n,f)=>n+f.geometry.paths.reduce((n,p)=>n+p.length,0),0),
    native_crs:"EPSG:32119",original_geometry_preserved:true};
  const output={};
  const json=(path,value)=>{output[path]=JSON.stringify(value,null,2)+"\n";};
  json("derived/classification-registry.json",registry);output["derived/combined-native-features.json"]=JSON.stringify(combined)+"\n";
  json("capture.json",capture);json("mapping.json",mapping);json("derived/reconciliation.json",summary);
  const columns=["id","original_index","waterbody_name","reach_description","class_raw","primary_class","supplemental_classes","special_markers","effective_date","effective_date_source","native_effective_date","native_object_id","subbasin","map_number","source_pdf_page","source_line_start","source_line_end"];
  const cell=x=>'"'+String(Array.isArray(x)?x.join("|"):x??"").replace(/"/g,'""')+'"';
  output["derived/classification-register.csv"]=[columns.map(cell).join(","),...records.map(row=>columns.map(k=>cell(row[k])).join(","))].join("\r\n")+"\r\n";
  return {files:output,summary,registry,capture,mapping};
}
