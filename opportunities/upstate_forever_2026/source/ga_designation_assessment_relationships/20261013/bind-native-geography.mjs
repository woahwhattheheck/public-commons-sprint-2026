/** Bind the maintained, completed original geometry operation to reviewed source relationships. */
const fail=message=>{throw Error("Georgia relationship geography: "+message)};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const same=(a,b,message)=>{if(JSON.stringify(canonical(a))!==JSON.stringify(canonical(b)))fail(message)};
const service=url=>String(url).split("/query?")[0];
const hash=value=>typeof value==="string"&&/^[0-9a-f]{64}$/.test(value);
const unique=values=>[...new Set(values)].sort();
const sourceKey=(kind,id)=>kind+":"+id;
export function bindNativeGeography(result,{context,relations,featureCollection,assessment,sourceDescriptor}) {
 if(result.register.schema!=="upstate.ga-designation-assessment-relationships/v1"||
    context.schema!=="upstate.assessment-reach-geography/v1"||context.jurisdiction!=="GA"||
    context.assessment_cycle!==2024||context.publication_status!=="EPA-approved"||
    context.comparison_crs!=="EPSG:26917"||
    assessment.schema!=="upstate.georgia-assessments/v1")fail("Use the completed approved-2024 Georgia geography and original relationship edition");
 if(!hash(context.domain_source?.sha256)||!Array.isArray(context.domain_hucs)||
    context.domain_hucs.length!==217||unique(context.domain_hucs).length!==217||
    context.domain_hucs.some(h=>!/^\d{12}$/.test(h)))fail("Keep the exact complete 217-HUC native domain");
 if(!Array.isArray(context.assessment_unit_ids_without_geometry)||!Array.isArray(context.unmatched_original_geometry)||context.assessment_unit_ids_without_geometry.length||context.unmatched_original_geometry.length)
   fail("The original complete Georgia source geometry has unresolved identities");
 same(context.relations,relations,"Native context and original relationship table differ");
 if(featureCollection.type!=="FeatureCollection"||!Array.isArray(featureCollection.features))
   fail("Use the completed original geographic feature collection");
 const nativeRows=new Map();
 for(const row of assessment.records||[]){
  const layer=row.source_locator?.layer_uri,id=row.native_feature_id;
  const key=JSON.stringify([layer,id]);
  if(!layer||!Number.isInteger(id)||nativeRows.has(key))fail("Original native assessment identity is missing or repeated");
  nativeRows.set(key,row);
 }
 if(nativeRows.size!==295)fail("Keep all 295 original assessment rows");
 const originalPairs=result.register.rows.flatMap(r=>r.candidates);
 const candidateIndex=new Map(originalPairs.map(p=>[p.source_key,p]));
 for(const pair of candidateIndex.values()){
  const row=nativeRows.get(JSON.stringify([pair.service_url,pair.FID]));
  if(!row||row.native_reach_id!==pair.ReachID)fail("Native assessed-reach identity differs from original review");
  same(row.raw,pair.original_attributes,"Native geometry assessment attributes differ from the reviewed original");
 }
 const nativeSources=new Map();
 for(const source of context.reach_sources||[]){
  if(nativeSources.has(source.id)||!hash(source.sha256)||!Number.isInteger(source.bytes)||
     source.source_crs!=="EPSG:3857")fail("Incomplete or duplicated original geometry source");
  nativeSources.set(source.id,source);
 }
 if(nativeSources.size!==11)fail("Keep all eleven original geometry pages");
 const staticRefs=new Map(result.selection.features.map(f=>[f.source_key,f]));
 const reviewedSourceHashes=new Map();
 for(const reference of staticRefs.values()){
  const originals=[...nativeSources.values()].filter(s=>s.uri===reference.source_query_url);
  if(originals.length!==1||originals[0].bytes!==reference.source_response_bytes||
     service(originals[0].uri)!==reference.service_url)fail("Reviewed original source is missing from the completed native operation");
  reviewedSourceHashes.set(reference.source_key,originals[0].sha256);
 }
 const nativeFeatureKey=(sourceId,fid,reachId)=>{
  const source=nativeSources.get(sourceId);if(!source)fail("Unrecognized original geometry source");
  const layer=service(source.uri),row=nativeRows.get(JSON.stringify([layer,Number(fid)]));
  if(!row||String(row.native_feature_id)!==String(fid)||row.native_reach_id!==reachId)
    fail("Native geographic feature differs from its original layer/FID/ReachID");
  const kind=layer.includes("Lakes_and_Sounds")?"lake":
    layer.includes("StreamsBeaches_xmlalt")?"stream":null;
  if(!kind)fail("Unknown original Georgia publisher layer");
  const key=sourceKey(kind,row.native_feature_id),expected=staticRefs.get(key);
  if(expected&&(expected.service_url!==layer||expected.reach_id!==reachId||
    expected.source_response_bytes!==source.bytes||expected.source_query_url!==source.uri))
    fail("Reviewed geometry source differs from its captured original response");
  return {key,source,row};
 };
 const byFeature=new Map(),seenRelations=new Set(),hucs=new Set(context.domain_hucs);
 for(const relation of relations){
  const id=relation.assessment_unit_id;
  const {key,source}=nativeFeatureKey(relation.geometry_source_id,relation.native_feature_id,id);
  if(relation.native_reach_id!==undefined&&relation.native_reach_id!==id)
    fail("Native assessment unit fields disagree");
  if(relation.geometry_sha256!==source.sha256||relation.geometry_source_uri!==source.uri||
     relation.domain_sha256!==context.domain_source.sha256||!hucs.has(relation.huc12)||
     relation.comparison_crs!==context.comparison_crs||
     !Number.isFinite(relation.intersection_measure)||relation.intersection_measure<0||
     !["positive_length","positive_area","boundary_touch"].includes(relation.relation))
    fail("Native source, domain, dimensional measure or HUC membership changed");
  const expectedUnit=key.startsWith("lake:")?"m2":"m";
  if(relation.measure_unit!==expectedUnit||
     (relation.relation==="boundary_touch"?relation.intersection_measure!==0:relation.intersection_measure<=0)||
     (relation.relation.startsWith("positive_")&&relation.relation!==(expectedUnit==="m2"?"positive_area":"positive_length")))
    fail("Native dimension and positive/boundary relation disagree");
  const relationKey=key+":"+relation.huc12;
  if(seenRelations.has(relationKey))fail("Repeated original feature/HUC relationship");
  seenRelations.add(relationKey);
  if(!byFeature.has(key))byFeature.set(key,[]);
  byFeature.get(key).push(relation);
 }
 const features=new Map();
 for(const feature of featureCollection.features){
  const p=feature.properties||{};
  const {key,source}=nativeFeatureKey(p.source_id,p.native_feature_id,p.assessment_unit_id);
  if(features.has(key)||!feature.geometry||feature.id!==p.source_id+":"+p.native_feature_id||
     p.source_sha256!==source.sha256||p.domain_source_sha256!==context.domain_source.sha256)
    fail("Native map feature identity changed");
  const rows=byFeature.get(key)||[],positive=unique(rows.filter(r=>r.relation!=="boundary_touch").map(r=>r.huc12));
  const touches=unique(rows.filter(r=>r.relation==="boundary_touch").map(r=>r.huc12));
  if(!rows.length)fail("Map feature has no retained original domain relationship");
  same(String(p.huc12s||"").split(", ").filter(Boolean).sort(),positive,"Map and original positive memberships differ");
  same(String(p.boundary_touch_huc12s||"").split(", ").filter(Boolean).sort(),touches,"Map and original boundary contacts differ");
  if(p.intersects_selected_domain!==Boolean(positive.length))fail("Map membership state differs");
  features.set(key,feature);
 }
 if(features.size!==context.feature_count||features.size!==byFeature.size||
    relations.filter(r=>r.relation!=="boundary_touch").length!==context.positive_relation_count||
    relations.filter(r=>r.relation==="boundary_touch").length!==context.boundary_touch_count)
   fail("Completed native feature and relation counts differ");
 const rows=result.selection.features.map(reference=>{
  const actual=byFeature.get(reference.source_key)||[];
  const positive=actual.filter(r=>r.relation!=="boundary_touch"),touches=actual.filter(r=>r.relation==="boundary_touch");
  return {...reference,original_geometry_sha256:reviewedSourceHashes.get(reference.source_key),domain_membership:positive.length?"positive_dimensional_intersection":
    touches.length?"boundary_contacts_only":"outside_original_selected_domain",
    positive_huc12s:unique(positive.map(r=>r.huc12)),boundary_touch_huc12s:unique(touches.map(r=>r.huc12)),
    native_relations:actual,legal_geometry_assignment:false,
    interpretation:"Membership and measures apply to the original assessment feature; the legal reach retains its separately stated boundary qualifications."};
 });
 const selectedFeatures=rows.filter(r=>features.has(r.source_key)).map(row=>{
  const original=features.get(row.source_key);
  return {...original,properties:{...original.properties,
    legal_relationship_source_key:row.source_key,
    legal_relationship_ids:JSON.stringify(row.relationships.map(x=>x.legal_id)),
    legal_relationships:JSON.stringify(row.relationships),
    legal_geometry_assignment:false,review_domain_membership:row.domain_membership}};
 });
 const count=state=>rows.filter(r=>r.domain_membership===state).length;
 const summary={reviewed_features:rows.length,
   positive_features:count("positive_dimensional_intersection"),
   boundary_only_features:count("boundary_contacts_only"),
   outside_features:count("outside_original_selected_domain"),
   native_map_features:selectedFeatures.length,
   legal_geometry_assignments:0,domain_hucs:217};
 return {schema:"upstate.ga-designation-assessment-native-review/v1",
   title:"Georgia legal source relationships with original 217 assessment geography",
   source:sourceDescriptor,domain_source:context.domain_source,
   comparison_crs:context.comparison_crs,domain_hucs:context.domain_hucs,
   method:context.method,summary,features:rows,
   map:{type:"FeatureCollection",name:"Original assessed-water geography with reviewed legal source relationships",
     features:selectedFeatures}};
}
export function nativeReviewRows(bound){
 return bound.features.flatMap(f=>f.native_relations.length?f.native_relations.map(r=>({
  source_key:f.source_key,service_url:f.service_url,FID:f.object_id,ReachID:f.reach_id,
  source_name:f.source_name,legal_ids:f.relationships.map(x=>x.legal_id).join(" | "),
  domain_membership:f.domain_membership,huc12:r.huc12,relation:r.relation,
  intersection_measure:r.intersection_measure,measure_unit:r.measure_unit,
  comparison_crs:r.comparison_crs,geometry_sha256:r.geometry_sha256,
  domain_sha256:r.domain_sha256,legal_geometry_assignment:false
 })): [{source_key:f.source_key,service_url:f.service_url,FID:f.object_id,ReachID:f.reach_id,
  source_name:f.source_name,legal_ids:f.relationships.map(x=>x.legal_id).join(" | "),
  domain_membership:f.domain_membership,huc12:"",relation:"no_intersection",intersection_measure:null,
  measure_unit:"",comparison_crs:bound.comparison_crs,geometry_sha256:f.original_geometry_sha256,
  domain_sha256:bound.domain_source.sha256,legal_geometry_assignment:false}]);
}
export function nativeReportSection(bound){
 return ["Original 217 membership of reviewed Georgia assessment features",[
  "The maintained original geographic operation supplies "+bound.summary.positive_features+
   " reviewed assessment features with positive-dimensional domain intersection, "+
   bound.summary.boundary_only_features+" with boundary-only contacts and "+
   bound.summary.outside_features+" outside the original selected domain.",
  "These memberships belong to complete original assessment features. The legal reach descriptions, named lake components and endpoint qualifications remain separate. Length and area measures retain their native units and are not added across different dimensions or overlapping feature supports.",
  {kind:"table",columns:["Original assessed feature","Source identity","Domain membership","Positive HUC12s","Boundary-only HUC12s"],
   rows:bound.features.map(f=>[f.source_name,f.source_key+" / "+f.reach_id,f.domain_membership,
    f.positive_huc12s.join(", "),f.boundary_touch_huc12s.join(", ")]),widths:[.2,.2,.2,.2,.2]}
 ]];
}
