/** Portable, source-bound requests shared by the offline report and native desk. */
export function createObservedLandcoverSelectionContract(){
  const REQUEST="upstate.observed-landcover-selection-request/v1",REPORT="upstate.observed-landcover-selection/v1";
  const normalized=new WeakSet();
  const HASH=/^[a-f0-9]{64}$/, groups=["water","snow_ice","developed","barren","forest","shrub","grass","agriculture","wetland"];
  const quantities=["gross_gain_ha","gross_loss_ha","net_ha"];
  const object=(value,label)=>{if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid "+label);return value;};
  const hash=(value,label)=>{if(typeof value!=="string"||!HASH.test(value))throw Error("Invalid "+label);return value;};
  function raster(value,label){
    object(value,label);if(!Number.isSafeInteger(value.year))throw Error("Invalid "+label+" year");
    return {year:value.year,sha256:hash(value.sha256,label+" raster identity")};
  }
  function binding(value,{native=false}={}){
    object(value,"source binding");
    const out={source_domain_sha256:hash(value.source_domain_sha256,"original polygon identity"),
      rasters:{before:raster(value.rasters?.before,"earlier"),after:raster(value.rasters?.after,"later")}};
    if(out.rasters.before.year>=out.rasters.after.year)throw Error("The original source years are out of order");
    if(value.analysis_manifest_sha256!==undefined)out.analysis_manifest_sha256=hash(value.analysis_manifest_sha256,"original manifest identity");
    if(!native&&out.analysis_manifest_sha256===undefined)throw Error("Keep the original analysis manifest identity");
    return out;
  }
  function selection(value,title){
    object(value,"watershed selection");
    const id=value.analysis_source_id;
    if(typeof id!=="string"||!id||id.length>256)throw Error("Choose the original analysis-run source");
    const ids=value.huc12s;
    if(!Array.isArray(ids)||!ids.length||ids.length>217||ids.some(id=>typeof id!=="string"||!/^\d{12}$/.test(id))||new Set(ids).size!==ids.length)
      throw Error("Choose distinct original twelve-character HUC12 identifiers");
    title=title??value.title;
    if(typeof title!=="string"||!title.trim()||title.trim().length>240)throw Error("Enter a comparison title of 1–240 characters");
    return {analysis_source_id:id,analysis_sha256:hash(value.analysis_sha256,"original analysis identity"),title:title.trim(),huc12s:[...ids]};
  }
  function view(value={}){
    object(value,"display hints");const group=value.group??"developed",group_metric=value.group_metric??"net_ha";
    if(!groups.includes(group)||!quantities.includes(group_metric))throw Error("Unknown comparison display hints");
    return {group,group_metric};
  }
  function parse(value){
    object(value,"saved comparison");
    if(value.schema===REPORT){
      const chosen=selection(value.selection,value.title),original=binding(value.binding,{native:true});
      if(value.binding.analysis_source_id!==chosen.analysis_source_id||value.binding.analysis_sha256!==chosen.analysis_sha256)
        throw Error("The native saved selection differs from its source binding");
      const parsed={schema:REQUEST,selection:chosen,binding:original,view:view(),source_format:"native_saved_comparison"};normalized.add(parsed);return parsed;
    }
    if(value.schema!==REQUEST||Object.keys(value).some(k=>!["schema","selection","binding","view"].includes(k)))
      throw Error("Choose a saved observed land-cover selection or portable request");
    const chosen=selection(value.selection),original=binding(value.binding);
    if(Object.keys(value.selection).some(k=>!["analysis_source_id","analysis_sha256","title","huc12s"].includes(k)))
      throw Error("Portable requests resolve collection IDs in the current Workspace");
    if(Object.keys(value.binding).some(k=>!["analysis_manifest_sha256","source_domain_sha256","rasters"].includes(k)))
      throw Error("Portable requests need the original source binding only");
    const parsed={schema:REQUEST,selection:chosen,binding:original,view:view(value.view),source_format:"portable_request"};normalized.add(parsed);return parsed;
  }
  function make(value){
    const p=parse({...value,schema:REQUEST});
    return {schema:REQUEST,selection:p.selection,binding:p.binding,view:p.view};
  }
  function assertBinding(request,actual,{requireManifest=false}={}){
    const p=normalized.has(request)?request:parse(request),expected=p.binding;
    object(actual,"current original binding");
    if(actual.analysis_source_id!==p.selection.analysis_source_id||actual.analysis_sha256!==p.selection.analysis_sha256||
       actual.source_domain_sha256!==expected.source_domain_sha256)
      throw Error("The selected analysis or original polygon edition differs");
    const got=binding(actual,{native:true});
    for(const side of ["before","after"])if(got.rasters[side].year!==expected.rasters[side].year||got.rasters[side].sha256!==expected.rasters[side].sha256)
      throw Error("The selected original raster years or identities differ");
    if(requireManifest&&p.source_format!=="native_saved_comparison"&&actual.analysis_manifest_sha256!==expected.analysis_manifest_sha256)
      throw Error("The original analysis manifest edition differs");
    return p;
  }
  function resolve(request,sources,preferredChoice=null){
    const p=normalized.has(request)?request:parse(request);
    let matches=(Array.isArray(sources)?sources:[]).filter(s=>s.analysis_source_id===p.selection.analysis_source_id&&s.analysis_sha256===p.selection.analysis_sha256);
    if(matches.length>1&&preferredChoice){const chosen=matches.filter(s=>s.source_collection_id===preferredChoice.source_collection_id&&s.analysis_source_id===preferredChoice.analysis_source_id&&s.analysis_sha256===preferredChoice.analysis_sha256);if(chosen.length===1)matches=chosen;}
    if(matches.length!==1)throw Error(matches.length?"Several retained sources match this analysis. Keep the current draft and choose one original source explicitly.":"Import the completed original analysis into this Workspace before opening this selection.");
    if(!HASH.test(matches[0].source_collection_id))throw Error("The retained source has no original Workspace collection identity");
    return {...matches[0]};
  }
  return {schema:REQUEST,parse,make,assertBinding,resolve};
}
