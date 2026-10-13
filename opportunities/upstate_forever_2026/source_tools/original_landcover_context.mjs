/** Original-grid land-cover summaries for the existing scientific report picker. */
import { createArchiveCodec } from "./archive_codec.mjs";
const codec = createArchiveCodec();
const json = value => JSON.stringify(value, null, 2) + "\n";
const raw = value => typeof value === "string" ? codec.utf8Encode(value) : value;
const parse = value => JSON.parse(codec.utf8Decode(raw(value)));
const CODES = [11,12,21,22,23,24,31,41,42,43,52,71,81,82,90,95];
const NAMES = ["Open water","Perennial ice/snow","Developed, open space","Developed, low intensity",
  "Developed, medium intensity","Developed, high intensity","Barren land","Deciduous forest",
  "Evergreen forest","Mixed forest","Shrub/scrub","Grassland/herbaceous","Pasture/hay",
  "Cultivated crops","Woody wetlands","Emergent herbaceous wetlands"];
const integer = (n, label) => {
  if (!Number.isSafeInteger(n) || n < 0) throw Error(label + " must be a nonnegative integer");
  return n;
};
const same = (a,b,label) => {if(a!==b)throw Error(label+" differs from the original source");};
const near = (a,b,label) => {
  if (!Number.isFinite(a) || Math.abs(a-b) > Math.max(1e-7,Math.abs(b)*1e-12))
    throw Error(label+" differs from original grid-cell accounting");
};
const digest = value => codec.sha256(raw(value));
const member = (path,body) => ({path,bytes:raw(body).length,sha256:digest(body)});
const escape = value => String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const number = (n, digits=2) => Number(n).toLocaleString("en-US",{maximumFractionDigits:digits});
const csv = rows => rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\r\n")+"\r\n";
const share = (part,total) => total ? part/total*100 : null;
const percent = n => n===null ? "No valid cells" : number(n)+"%";
const table = (columns,rows,widths) => ({kind:"table",columns,rows:rows.map(r=>r.map(String)),widths});
function httpUrl(value,label) {
  if(typeof value!=="string" || !/^https?:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(value))
    throw Error(label+" must retain its original HTTP(S) URL");
  return value;
}
function classes(rows,total,nodata,area,label) {
  if(!Array.isArray(rows)||rows.length!==CODES.length)throw Error(label+" needs all original class rows");
  const found=new Map();
  for(const row of rows){
    if(!CODES.includes(row.class_code)||found.has(row.class_code))throw Error(label+" has an unexpected/repeated class");
    integer(row.cells,label+" cells");
    near(row.area_m2,row.cells*area,label+" square metres");
    near(row.area_ha,row.cells*area/10000,label+" hectares");
    found.set(row.class_code,row);
  }
  same([...found.values()].reduce((s,r)=>s+r.cells,0)+integer(nodata,label+" NoData"),total,label+" total");
  return found;
}
function sourceHistogram(body,entry,area) {
  const bytes=raw(body);
  if(!(bytes instanceof Uint8Array))throw Error("Retain the original class-area.csv bytes");
  const original=entry.companions?.find(row=>row.path==="class-area.csv");
  if(!original)throw Error("Original raster entry lacks its class-area.csv companion");
  same(bytes.length,original.bytes,"Original class-area byte count");
  same(digest(bytes),original.sha256,"Original class-area identity");
  const lines=codec.utf8Decode(bytes).trimEnd().split(/\r?\n/);
  const header=lines.shift(),scoped=header==="class_code,cells,area_ha,scope";
  if(!scoped && header!=="class_code,cells,area_m2,area_ha")
    throw Error("Original class-area columns differ from the supported native source schemas");
  const result=new Map();
  for(const line of lines){
    const fields=line.split(",");
    if(fields.length!==4)throw Error("Original class-area row has changed columns");
    const code=Number(fields[0]),cells=Number(fields[1]),hectares=Number(fields[scoped?2:3]);
    if(!CODES.includes(code)||result.has(code))throw Error("Unexpected/repeated original class-area code");
    integer(cells,"Original class count");near(hectares,cells*area/10000,"Original class hectares");
    if(scoped)same(fields[3],"rectangular_native_source_grid","Original class-area scope");
    else near(Number(fields[2]),cells*area,"Original class square metres");
    result.set(code,cells);
  }
  same([...result.values()].reduce((a,b)=>a+b,0)+entry.metadata.nodata_cells,entry.metadata.cell_count,"Original class-area total");
  return result;
}

function originalMetadata(result,entry) {
  const metadata=result.metadata;
  if(!metadata||typeof metadata!=="object")throw Error("Retain the original producer metadata");
  const match=(keys,expected,label)=>{
    const present=keys.filter(key=>Object.prototype.hasOwnProperty.call(metadata,key));
    if(!present.length)throw Error(label+" is absent from the original result");
    for(const key of present)same(metadata[key],expected,label+" ("+key+")");
  };
  match(["sha256","raster_sha256"],entry.sha256,"Original raster identity");
  match(["domain_sha256","polygon_body_sha256"],entry.model_domain_decoded_sha256,"Original polygon identity");
  if(metadata.source_id!==undefined)same(metadata.source_id,entry.id,"Original raster source ID");
  if(metadata.raster_bytes!==undefined)same(metadata.raster_bytes,entry.bytes,"Original raster byte count");
  if(metadata.epsg!==undefined)same(metadata.epsg,5070,"Original raster CRS");
  const urls=[];
  if(metadata.source_uri!==undefined){
    same(metadata.source_uri,entry.uri,"Original source URL");
    urls.push(httpUrl(metadata.source_uri,"Source URL"));
  }
  if(metadata.source_urls!==undefined){
    if(!Array.isArray(metadata.source_urls)||!metadata.source_urls.length)throw Error("Retain original source URLs");
    const listed=metadata.source_urls.map(value=>httpUrl(value,"Source URL"));
    if(!listed.includes(entry.uri))throw Error("Original source URL is absent from source_urls");
    urls.push(...listed);
  }
  if(!urls.length)throw Error("Retain an original source URL");
  return [...new Set(urls)];
}
function coordinateMethod(method) {
  const operation=method.coordinate_conversion;
  if(typeof operation==="string" && operation.trim())return operation;
  if(!operation||typeof operation!=="object"||typeof operation.description!=="string"||!operation.description.trim())
    throw Error("Retain the declared original coordinate operation");
  const parts=[operation.description];
  if(operation.source_epsg!==undefined||operation.target_epsg!==undefined){
    if(!Number.isInteger(operation.source_epsg)||!Number.isInteger(operation.target_epsg))throw Error("Invalid coordinate operation CRS");
    parts.push("EPSG:"+operation.source_epsg+" to EPSG:"+operation.target_epsg);
  }
  if(operation.stated_accuracy_m!==undefined){
    if(!Number.isFinite(operation.stated_accuracy_m)||operation.stated_accuracy_m<0)throw Error("Invalid stated coordinate-operation accuracy");
    parts.push("Stated coordinate-operation accuracy: "+operation.stated_accuracy_m+" m");
  }
  return parts.join(". ");
}

function group(row,codes) {return codes.reduce((sum,code)=>sum+row.get(code).cells,0);}
function watershedName(properties) {
  for(const key of ["name","NAME","Name","gnis_name","GNIS_NAME"])
    if(properties?.[key]!==undefined && properties[key]!==null)return String(properties[key]);
  return "";
}
function htmlReport(result,entry,rows,summary) {
  const classRows=summary.domainClasses.map(r=>"<tr><td>"+r.class_code+"</td><td>"+escape(r.name)+"</td><td class=\"n\">"+number(r.cells,0)+"</td><td class=\"n\">"+number(r.area_ha)+"</td><td class=\"n\">"+percent(r.percent_valid)+"</td></tr>").join("");
  const watershedRows=rows.map(r=>"<tr data-search=\""+escape((r.huc12+" "+r.name).toLowerCase())+"\"><th scope=\"row\">"+r.huc12+"</th><td>"+escape(r.name)+"</td><td class=\"n\">"+number(r.valid_area_ha)+"</td><td class=\"n\">"+percent(r.forest_percent)+"</td><td class=\"n\">"+percent(r.developed_percent)+"</td><td class=\"n\">"+percent(r.agriculture_percent)+"</td><td class=\"n\">"+number(r.nodata_cells,0)+"</td></tr>").join("");
  const sourceLinks=summary.sourceUrls.map((url,i)=>'<li><a href="'+escape(httpUrl(url,"Source URL"))+'">Original source '+(i+1)+"</a></li>").join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(summary.title)+'</title><style>'+
  '*{box-sizing:border-box}body{margin:0;background:#f4f4f4;color:#202020;font:15px/1.5 system-ui,sans-serif}main{max-width:1250px;margin:auto;padding:28px}h1{font-size:27px;margin:0 0 10px}h2{font-size:20px;margin:28px 0 10px}p{max-width:95ch}a{color:#222;text-decoration:underline}nav{display:flex;gap:18px;flex-wrap:wrap;margin:20px 0}section{background:white;border:1px solid #aaa;padding:20px;margin:16px 0}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.metric{border-left:3px solid #555;padding:8px 12px}.metric strong{display:block;font-size:22px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px 10px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}thead th{background:#eee;position:sticky;top:0}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}tbody th{font-weight:500}input{width:min(100%,430px);padding:10px;border:1px solid #777;font:inherit}label{display:block;font-weight:600;margin:8px 0}.scope{font-size:14px;color:#444}details{margin:16px 0}code{overflow-wrap:anywhere;font-size:12px}.status{display:block;margin:8px 0;color:#444}@media(max-width:600px){main{padding:12px}section{padding:12px}h1{font-size:23px}}@media print{body{background:#fff}main{max-width:none;padding:0}nav,.filter{display:none}section{border:0;padding:0;break-inside:auto}tr{break-inside:avoid}thead{display:table-header-group}thead th{position:static}.scroll{overflow:visible}a{color:#000}}'+
  '</style></head><body><main><h1>'+escape(summary.title)+'</h1><p>Original categorical land cover summarized over the retained watershed polygons. Pixel centres determine membership on the unchanged EPSG:5070 source grid.</p><nav><a href="watersheds.csv" download>Watershed table · CSV</a><a href="watershed-classes.csv" download>All watershed classes · CSV</a><a href="original-zonal.json" download>Complete original calculation · JSON</a><a href="observed-report.json" download>Scientific report recipe</a></nav><section><div class="metrics">'+
  '<div class="metric">Original watersheds<strong>'+rows.length+'</strong></div><div class="metric">Unique domain area<strong>'+number(result.domain.unique_cells*summary.cellArea/10000)+' ha</strong></div><div class="metric">Valid domain cells<strong>'+number(summary.domainValid,0)+'</strong></div><div class="metric">Domain NoData cells<strong>'+number(result.domain.nodata_cells,0)+'</strong></div></div>'+
  '<p class="scope">Domain totals count the union once. Watershed rows retain individual polygon membership; '+number(result.domain.overlap_cells,0)+' cells occur in overlapping source watersheds. The full rectangular raster includes '+number(result.domain.outside_domain_cells,0)+' cells outside the polygon domain, including its model-context buffer.</p></section>'+
  '<section><h2>Land cover within the original watershed domain</h2><p>Percentages use valid classified domain cells. Hectares use the determinant of the retained native affine transform.</p><div class="scroll"><table><thead><tr><th>Class</th><th>Land cover</th><th class="n">Cells</th><th class="n">Hectares</th><th class="n">Share of valid area</th></tr></thead><tbody>'+classRows+'</tbody></table></div></section>'+
  '<section><h2>All original watersheds</h2><p>Forest combines classes 41–43; developed combines 21–24; agriculture combines pasture/hay 81 and cultivated crops 82. Each row covers its complete original HUC polygon, including portions across state boundaries. The complete class table preserves each category separately.</p><div class="filter"><label for="search">Find a HUC12 or watershed name</label><input id="search" type="search" placeholder="HUC12 or name" autocomplete="off"><span id="status" class="status" role="status">'+rows.length+' watersheds</span></div><div class="scroll"><table id="watersheds"><thead><tr><th>HUC12</th><th>Name</th><th class="n">Valid ha</th><th class="n">Forest</th><th class="n">Developed</th><th class="n">Agriculture</th><th class="n">NoData cells</th></tr></thead><tbody>'+watershedRows+'</tbody></table></div></section>'+
  '<section><h2>Original source and method</h2><p>'+escape(result.method.pixel_rule)+'. '+escape(summary.coordinateMethod)+'. '+escape(result.method.polygon_edges)+'.</p><p>Grid: '+result.grid.width+' × '+result.grid.height+'; cell area '+summary.cellArea+' m². Full raster: '+number(result.raster.cell_count,0)+' cells, '+number(result.raster.nodata_count,0)+' NoData cells.</p><p><a href="raster-source-entry.json">Original raster source entry</a> · <a href="class-area.csv">Original full-raster class counts</a> · <a href="observed-report.json">Scientific delivery recipe</a></p><ul>'+sourceLinks+'</ul><details><summary>Source identities</summary><p>Raster SHA256 <code>'+entry.sha256+'</code></p><p>Original decoded polygon SHA256 <code>'+entry.model_domain_decoded_sha256+'</code></p><p>Zonal result SHA256 <code>'+summary.zonalSha+'</code></p></details></section></main>'+
  '<script>const field=document.getElementById("search"),rows=Array.from(document.querySelectorAll("#watersheds tbody tr"));field.addEventListener("input",()=>{const q=field.value.trim().toLowerCase();let count=0;for(const row of rows){const show=row.dataset.search.includes(q);row.hidden=!show;if(show)count++;}document.getElementById("status").textContent=count+" of "+rows.length+" watersheds";});</script></body></html>\n';
}
export function composeOriginalLandcoverContext({zonalBody,rasterEntryBody,classAreaBody,expectedZonalSha256}) {
  if(!/^[a-f0-9]{64}$/.test(expectedZonalSha256||""))throw Error("Supply the retained original zonal-result SHA256");
  const zonalBytes=raw(zonalBody),entryBytes=raw(rasterEntryBody);
  if(!(zonalBytes instanceof Uint8Array)||!(entryBytes instanceof Uint8Array))throw Error("Supply complete original source bytes");
  same(digest(zonalBytes),expectedZonalSha256,"Zonal result hash");
  const result=parse(zonalBytes),entry=parse(entryBytes);
  same(result.schema,"upstate.landcover-zonal-summary/v1","Zonal schema");
  if(entry.kind!=="raster"||entry.role!=="NLCD"||entry.source_crs!=="EPSG:5070")throw Error("Select the actual native NLCD raster entry");
  const grid=entry.native_grid, count=integer(entry.domain_feature_count,"Original watershed count");
  if(!count||!Array.isArray(result.watersheds)||result.watersheds.length!==count)throw Error("Retain the complete original watershed set");
  same(result.grid.width,grid.window.width,"Grid width");same(result.grid.height,grid.window.height,"Grid height");
  if(!Array.isArray(result.grid.affine)||result.grid.affine.length!==6)throw Error("Original affine is missing");
  for(let i=0;i<6;i++)same(result.grid.affine[i],grid.transform[i],"Native affine");
  if(result.grid.affine[1]!==0||result.grid.affine[3]!==0)throw Error("Use the original north-up source grid");
  const area=Math.abs(result.grid.affine[0]*result.grid.affine[4]);
  if(!Number.isFinite(area)||area<=0)throw Error("Invalid original pixel area");
  near(result.method.cell_area_m2,area,"Method cell area");
  const sourceUrls=originalMetadata(result,entry),methodText=coordinateMethod(result.method);
  if(!/^[a-f0-9]{64}$/.test(entry.model_domain_decoded_sha256))throw Error("Original polygon identity is absent");
  same(result.metadata.year,Number(entry.source_time.slice(0,4)),"Original product year");
  same(result.metadata.nodata,entry.metadata.nodata,"Original NoData code");
  httpUrl(entry.uri,"Raster source URL");
  same(result.raster.cell_count,result.grid.width*result.grid.height,"Full raster cell count");
  same(result.raster.nodata_count,entry.metadata.nodata_cells,"Full raster NoData");
  classes(result.raster.classes,result.raster.cell_count,result.raster.nodata_count,area,"Full raster");
  const originalClasses=sourceHistogram(classAreaBody,entry,area);
  for(const row of result.raster.classes)
    same(row.cells,originalClasses.get(row.class_code)??0,"Original class "+row.class_code+" count");
  const domain=result.domain;
  integer(domain.unique_cells,"Domain cells");integer(domain.outside_domain_cells,"Outside-domain cells");integer(domain.overlap_cells,"Overlap cells");
  same(domain.unique_cells+domain.outside_domain_cells,result.raster.cell_count,"Domain coverage");
  if(domain.overlap_cells>domain.unique_cells)throw Error("Overlap exceeds domain coverage");
  const domainClasses=classes(domain.classes,domain.unique_cells,domain.nodata_cells,area,"Domain");
  const seen=new Set(),longRows=[["huc12","name","class_code","class_name","cells","area_m2","area_ha","percent_valid"]];
  const rows=result.watersheds.map(w=>{
    if(!/^\d{12}$/.test(w.huc12)||seen.has(w.huc12))throw Error("Retain unique original HUC12 IDs");
    seen.add(w.huc12);integer(w.selected_cells,"Selected cells");
    if(w.selected_cells>result.raster.cell_count)throw Error("Watershed exceeds raster coverage");
    const byClass=classes(w.classes,w.selected_cells,w.nodata_cells,area,"Watershed "+w.huc12),valid=w.selected_cells-w.nodata_cells;
    near(w.area_m2,w.selected_cells*area,"Watershed area");near(w.valid_area_m2,valid*area,"Valid watershed area");
    const name=watershedName(w.properties);
    for(const code of CODES){const c=byClass.get(code);longRows.push([w.huc12,name,code,NAMES[CODES.indexOf(code)],c.cells,c.area_m2,c.area_ha,share(c.cells,valid)??""]);}
    return {huc12:w.huc12,name,selected_cells:w.selected_cells,nodata_cells:w.nodata_cells,
      valid_cells:valid,valid_area_ha:valid*area/10000,forest_percent:share(group(byClass,[41,42,43]),valid),
      developed_percent:share(group(byClass,[21,22,23,24]),valid),agriculture_percent:share(group(byClass,[81,82]),valid)};
  }).sort((a,b)=>a.huc12.localeCompare(b.huc12));
  if(rows.reduce((s,r)=>s+r.selected_cells,0)<domain.unique_cells)throw Error("Watershed accounting is smaller than its union");
  const summary={title:"Original "+result.metadata.year+" land cover — complete watershed domain",cellArea:area,sourceUrls,coordinateMethod:methodText,
    domainValid:domain.unique_cells-domain.nodata_cells,zonalSha:expectedZonalSha256,
    domainClasses:CODES.map((code,i)=>({...domainClasses.get(code),name:NAMES[i],percent_valid:share(domainClasses.get(code).cells,domain.unique_cells-domain.nodata_cells)}))};
  const columns=["huc12","name","selected_cells","valid_cells","nodata_cells","valid_area_ha","forest_percent","developed_percent","agriculture_percent"];
  const files={"original-zonal.json":zonalBytes,"raster-source-entry.json":entryBytes,"class-area.csv":raw(classAreaBody),
    "watersheds.csv":raw(csv([columns,...rows.map(r=>columns.map(c=>r[c]??""))])),
    "watershed-classes.csv":raw(csv(longRows)),
    "landcover-report.html":raw(htmlReport(result,entry,rows,summary))};
  const inputs=Object.entries(files).map(([path,body])=>member(path,body));
  const recipe={schema:"upstate.observed-report/v1",title:summary.title,edition:"original-landcover-context-v1",
    vintage:entry.vintage,interpretation_kind:"original_native_landcover_zonal",
    original_source:{source_id:entry.id,raster_sha256:entry.sha256,polygon_body_sha256:entry.model_domain_decoded_sha256},
    inputs,sections:[
      ["Original land-cover domain",[
        "Original "+result.metadata.year+" categorical land cover covers "+rows.length+" retained watersheds. Domain totals count each pixel once; individual watershed rows preserve original polygon overlaps.",
        table(["Measure","Value"],[["Unique domain cells",domain.unique_cells],["Valid domain cells",summary.domainValid],["Domain NoData cells",domain.nodata_cells],["Cells shared by overlapping watersheds",domain.overlap_cells],["Native cell area (m²)",area],["Cells outside polygon domain",domain.outside_domain_cells]],[0.65,0.35]),
        "Percentages use valid classified cells. Area uses the retained native affine transform. The raster rectangle and its model-context buffer extend beyond the polygon domain."
      ]],
      ["Native land-cover classes",[
        table(["Class","Land cover","Domain hectares","Valid area (%)"],summary.domainClasses.map(r=>[r.class_code,r.name,number(r.area_ha),r.percent_valid===null?"No valid cells":number(r.percent_valid)]),[0.1,0.42,0.24,0.24])
      ]],
      ["Complete original watershed summary",[
        "Forest includes classes 41–43, developed includes 21–24, and agriculture includes 81–82. Each row covers its complete original HUC polygon, including portions across state boundaries. Full separate classes are retained in the linked CSV.",
        table(["HUC12","Name","Valid hectares","Forest (%)","Developed (%)","Agriculture (%)"],rows.map(r=>[r.huc12,r.name,number(r.valid_area_ha),r.forest_percent===null?"":number(r.forest_percent),r.developed_percent===null?"":number(r.developed_percent),r.agriculture_percent===null?"":number(r.agriculture_percent)]),[0.18,0.3,0.13,0.13,0.13,0.13])
      ]],
      ["Source and method",[
        result.method.pixel_rule+". "+summary.coordinateMethod+". "+result.method.polygon_edges+".",
        {kind:"links",items:[{title:"Searchable complete land-cover report",path:"landcover-report.html"},{title:"All watershed summary rows",path:"watersheds.csv"},{title:"All watershed and class rows",path:"watershed-classes.csv"},{title:"Original full zonal result",path:"original-zonal.json"},{title:"Original raster source entry",path:"raster-source-entry.json"}]}
      ]]
    ],source_links:Object.keys(files)};
  const recipeBody=raw(json(recipe)),id="original-landcover-context-"+expectedZonalSha256.slice(0,20);
  const reportEntry={id,title:summary.title,kind:"document",role:"OBSERVED_CONTEXT",vintage:entry.vintage,uri:entry.uri,
    ...member("observed-report.json",recipeBody),description:"Complete original native-grid watershed land cover and source accounting.",
    companions:inputs,metadata:{related_source_ids:[entry.id],interpretation_kind:recipe.interpretation_kind,
      source_relationships:[{id:entry.id,relationship:"original_categorical_raster"}],watershed_count:rows.length,product_year:result.metadata.year}};
  const manifest={schema:"upstate.sources/v1",title:summary.title,entries:[reportEntry]};
  files["observed-report.json"]=recipeBody;files["source-manifest.json"]=raw(json(manifest));
  return {sourceId:id,recipe,manifest,files,summary:{watersheds:rows.length,class_rows:longRows.length-1,domain_cells:domain.unique_cells,domain_valid_cells:summary.domainValid}};
}
