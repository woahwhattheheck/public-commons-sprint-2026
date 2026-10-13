/** Present the saved native geographic allocation; no calculation or dispatch. */
const esc = value => String(value ?? "").replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const list = value => Array.isArray(value) ? value : [];
const label = value => String(value ?? "").replaceAll("_"," ");
const variableNames = {DEM:"Elevation",PRECIPITATION:"Annual precipitation",R_FACTOR:"Rainfall erosivity",K_FACTOR:"Soil erodibility",R_TIMES_K:"Rainfall × soil factor"};
const pollutantNames = {nitrogen_export:"Nitrogen",phosphorus_export:"Phosphorus",sediment_export:"Sediment"};
export function allocationNumber(value, signed=false) {
  if(typeof value!=="number"||!Number.isFinite(value))return "Unavailable";
  if(value!==0&&Math.abs(value)<.0005)return (signed&&value>0?"+":"")+value.toExponential(3);
  return value.toLocaleString(undefined,{maximumFractionDigits:3,signDisplay:signed?"exceptZero":"auto"});
}
export function allocationTicket(value, download=false) {
  const url=value?.url;
  if(typeof url!=="string"||!url.startsWith("/api/file/")||/[\u0000-\u0020\\]/.test(url))return null;
  return url+(download?(url.includes("?")?"&":"?")+"download=1":"");
}
function table(headers,rows) {
  return '<div class="geo-scroll"><table><thead><tr>'+headers.map(x=>"<th scope=\"col\">"+esc(x)+"</th>").join("")+"</tr></thead><tbody>"+
    rows.map(row=>"<tr>"+row.map((x,i)=>i===0?"<th scope=\"row\">"+esc(x)+"</th>":"<td>"+esc(x)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";
}
const groupKey=row=>JSON.stringify([row.kind,row.relationship]);
const groupLabel=row=>label(row.kind)+" · "+label(row.relationship);
const scopeLabel=value=>value==="model_domain"?"Full upstream model domain":value==="reporting"?"SC reporting area":label(value);
function select(name,title,values,current) {
  return '<label>'+esc(title)+'<select data-geo-allocation-'+name+'>'+values.map(x=>'<option value="'+esc(x.value)+'"'+(x.value===current?' selected':'')+'>'+esc(x.title)+'</option>').join("")+"</select></label>";
}
export function allocationSelection(result,requested={}) {
  const rows=list(result?.report?.regions),scopes=[...new Set(rows.map(x=>x.quantity_scope))];
  const scope=scopes.includes(requested.scope)?requested.scope:scopes.includes("reporting")?"reporting":scopes[0];
  const scoped=rows.filter(x=>x.quantity_scope===scope),groups=new Map(scoped.map(x=>[groupKey(x),x]));
  const preferred=scoped.find(x=>x.kind==="utility_upstream_union")||scoped[0];
  const group=groups.has(requested.group)?requested.group:preferred?groupKey(preferred):null;
  const members=scoped.filter(x=>groupKey(x)===group);
  const region=members.find(x=>x.id===requested.region)||members[0];
  const classes=list(region?.physical_contrasts?.classes);
  const physicalClass=classes.some(x=>String(x.baseline_class)===requested.physicalClass)?requested.physicalClass:classes.length?String(classes[0].baseline_class):null;
  return {scope,group,region:region?.id,physicalClass,scopes,groups,members,selected:region};
}
function downloads(files) {
  return list(files).map(file=>{
    const url=allocationTicket(file,true);
    return url?'<a href="'+esc(url)+'" download>'+esc(file.label||file.filename||"Retained source")+"</a>":"";
  }).join("");
}
function physicalMarkup(region,current) {
  const classes=list(region.physical_contrasts?.classes);
  if(!classes.length)return "";
  const selected=classes.find(x=>String(x.baseline_class)===current)||classes[0];
  const sample=selected.samples||{},differences=selected.mean_differences||{};
  const variables=[...new Set([...Object.keys(sample.restoration||{}),...Object.keys(sample.control||{})])];
  const means=[],coverage=[];
  for(const variable of variables){
    const a=sample.restoration?.[variable]||{},b=sample.control?.[variable]||{},difference=differences[variable]||{};
    const name=(variableNames[variable]||label(variable))+" ("+(a.units||b.units||difference.units||"see source")+")";
    means.push([name,allocationNumber(a.mean),allocationNumber(b.mean),allocationNumber(difference.restoration_minus_control,true)]);
    coverage.push([variableNames[variable]||label(variable),allocationNumber(a.valid_cells)+" / "+allocationNumber(a.selected_cells),
      allocationNumber(b.valid_cells)+" / "+allocationNumber(b.selected_cells),allocationNumber(a.population_standard_deviation),allocationNumber(b.population_standard_deviation)]);
  }
  return '<section class="geo-allocation-section"><h4>Physical conditions on changed cells</h4><p>Descriptive contrasts in the retained simulated physical inputs at the actual changed source pixels. Each variable uses its own valid cells; the original files retain the full distributions and source units.</p>'+
    '<div class="geo-allocation-controls">'+select("physical","Original land-cover group",classes.map(x=>({value:String(x.baseline_class),title:x.baseline_class==="all"?"All original classes":x.baseline_class==="other"?"All other original classes":"Baseline class "+x.baseline_class})),String(selected.baseline_class))+"</div>"+
    table(["Changed land","Restoration cells","Control cells","Changed in both"],[
      ["Selected original class",allocationNumber(selected.changed_cells?.restoration),allocationNumber(selected.changed_cells?.control),allocationNumber(selected.overlap_changed_cells)]])+
    table(["Input and units","Restoration mean","Control mean","R − C mean"],means)+
    '<details><summary>Physical input coverage and variation</summary>'+
    table(["Input","R valid / selected cells","C valid / selected cells","R population SD","C population SD"],coverage)+"</details></section>";
}
export function allocationMarkup(result,requested={}) {
  const chosen=allocationSelection(result,requested),row=chosen.selected,report=result?.report;
  if(!row)return {selection:chosen,html:"<p>This saved allocation has no region records.</p>"};
  const r=row.alternatives?.restoration||{},c=row.alternatives?.control||{},balance=row.balance||{},common=row.common_valid_cells;
  const state=common===0?"No common categorical cells":balance.equal_local_changed_counts&&balance.equal_local_original_class_counts?"Equal local changed counts and original class mix":balance.equal_local_changed_counts?"Equal changed counts; original class mix differs":"Local changed counts differ";
  const origins=list(balance.by_origin).map(x=>["Baseline class "+x.from_code,allocationNumber(x.restoration_hectares),allocationNumber(x.control_hectares),allocationNumber(x.difference_hectares,true)]);
  const support=Object.entries(row.native_support||{}).map(([key,x])=>[pollutantNames[key]||label(key),allocationNumber(x.native_common_cells),allocationNumber(x.landcover_and_native_common_cells),allocationNumber(x.restoration_changed_hectares),allocationNumber(x.control_changed_hectares)]);
  const quantities=list(row.pairwise_native_quantities).map(x=>[(pollutantNames[x.pollutant]||label(x.pollutant))+" · "+x.scenario+" ("+x.units+")",allocationNumber(x.common_cells),allocationNumber(x.baseline_mass),allocationNumber(x.alternative_mass),allocationNumber(x.signed_change,true)]);
  const transitions=[];
  for(const arm of ["restoration","control"])for(const x of list(row.alternatives?.[arm]?.transitions))transitions.push([label(arm),x.from_code+" → "+x.to_code,allocationNumber(x.cells),allocationNumber(x.hectares)]);
  const figures=list(result.figures).filter(x=>list(x.region_ids).includes(row.id)).map(figure=>{
    const url=allocationTicket(figure.download);if(!url)return "";
    return '<figure><a href="'+esc(url)+'" target="_blank" rel="noopener"><img loading="lazy" src="'+esc(url)+'" alt="'+esc(figure.alt)+'"></a><figcaption><strong>'+esc(figure.title)+'</strong><p>'+esc(figure.caption)+'</p></figcaption></figure>';
  }).join("");
  const members=chosen.members.map(x=>({value:x.id,title:x.title+(x.common_valid_cells===0?" — no common cells":"")}));
  const controls=select("scope","Quantity scope",chosen.scopes.map(value=>({value,title:scopeLabel(value)})),chosen.scope)+
    select("group","Geographic relationship",[...chosen.groups].map(([value,x])=>({value,title:groupLabel(x)})),chosen.group)+select("region","Region",members,chosen.region);
  let html='<p class="geo-small">Saved '+esc(report.created_at)+' · '+esc(scopeLabel(chosen.scope))+'</p><div class="geo-allocation-controls">'+controls+'</div>'+
    '<h4>'+esc(row.title)+'</h4><p><strong>'+esc(state)+'</strong>. Control matching applies across the original reporting selection; these are the actual counts inside this region.</p>'+
    '<div class="geo-allocation-cards">'+[
      ["Common categorical support",allocationNumber(row.common_valid_hectares)+" ha"],
      ["Restoration changed",allocationNumber(r.changed_hectares)+" ha"],
      ["Control changed",allocationNumber(c.changed_hectares)+" ha"],
      ["Restoration − control",allocationNumber(balance.changed_hectares_difference,true)+" ha"]
    ].map(([name,value])=>'<div><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong></div>').join("")+"</div>";
  if(common===0)html+="<p>No shared baseline/restoration/control categorical support is available for this region. Zero changed-area counts here do not describe a locally balanced treatment.</p>";
  if(row.mask_basis)html+="<p>"+esc(row.mask_basis)+".</p>";
  if(list(row.anchor_huc12s).length)html+="<p>Original utility anchors: "+esc(row.anchor_huc12s.join(", "))+". Distinct upstream HUCs: "+esc(list(row.upstream_huc12s).length)+".</p>";
  if(row.vector_geometry_empty_with_selected_cells)html+="<p>The original mask retains boundary cells while its display geometry is empty. The counts below keep those original cells.</p>";
  html+=table(["Coverage","Cells"],[["Original region mask",allocationNumber(row.selected_cells)],["Baseline valid",allocationNumber(row.valid_cells?.baseline)],["Restoration valid",allocationNumber(row.valid_cells?.restoration)],["Control valid",allocationNumber(row.valid_cells?.control)],["Common to all three",allocationNumber(common)]])+
    '<h4>Changed area by original class</h4>'+table(["Original baseline class","Restoration ha","Control ha","R − C ha"],origins)+physicalMarkup(row,chosen.physicalClass)+
    '<h4>Common native-output support</h4><p>These counts intersect the three saved native output masks separately for each quantity. Changed hectares also require common categorical cells.</p>'+
    (support.length?table(["Quantity","Three-run native cells","Native + categorical cells","R changed ha","C changed ha"],support):"<p>No native support rows are retained in this edition.</p>")+
    '<details><summary>Original baseline comparisons and annual quantities</summary><p>Each row uses its own original baseline-versus-alternative common support. Annual quantities describe export originating from those source pixels and modeled as delivered to streams. Signed change is the original alternative-minus-baseline Float32 difference-pixel sum.</p>'+
    (quantities.length?table(["Quantity / scenario / units","Pairwise cells","Baseline","Alternative","Alt − baseline"],quantities):"<p>This group retains allocation and three-run support. Its saved source does not contain a separate original native mass analysis for this exact union.</p>")+"</details>"+
    '<details><summary>Every land-cover transition in this region</summary>'+table(["Scenario","Original → final class","Cells","Hectares"],transitions)+"</details>"+
    (figures?'<section class="geo-allocation-figures"><h4>Saved figures for this geography group</h4><p>The map shows the original group boundaries. Values above refer to the selected region.</p><div>'+figures+"</div></section>":"<p>No saved figure has support for this selected region.</p>")+
    '<details><summary>Complete original data and source files</summary><div class="geo-actions">'+downloads(result._downloads)+'</div><p class="geo-small">The downloads retain every region, class transition, exact source identity and available physical-input distribution.</p></details>';
  return {selection:chosen,html};
}
