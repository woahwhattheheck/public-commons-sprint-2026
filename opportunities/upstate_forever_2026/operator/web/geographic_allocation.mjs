/** Present the saved native geographic allocation; no calculation or dispatch. */
const esc = value => String(value ?? "").replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const list = value => Array.isArray(value) ? value : [];
const label = value => String(value ?? "").replaceAll("_"," ");
const variableNames = {DEM:"Elevation",PRECIPITATION:"NDR runoff proxy",R_FACTOR:"Rainfall erosivity",K_FACTOR:"Soil erodibility",R_TIMES_K:"Rainfall × soil factor"};
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
function physicalMarkup(region,current,binding) {
  const classes=list(region.physical_contrasts?.classes);
  if(!classes.length)return "";
  const selected=classes.find(x=>String(x.baseline_class)===current)||classes[0];
  const sample=selected.samples||{},differences=selected.mean_differences||{};
  const variables=[...new Set([...Object.keys(sample.restoration||{}),...Object.keys(sample.control||{})])];
  const means=[],coverage=[];
  for(const variable of variables){
    const a=sample.restoration?.[variable]||{},b=sample.control?.[variable]||{},difference=differences[variable]||{};
    const variableLabel=binding?.variables?.[variable]?.label||(variable==="PRECIPITATION"&&(a.units||b.units)==="mm/year"?"Annual precipitation":variableNames[variable]||label(variable));
    const name=variableLabel+" ("+(a.units||b.units||difference.units||"see source")+")";
    means.push([name,allocationNumber(a.mean),allocationNumber(b.mean),allocationNumber(difference.restoration_minus_control,true)]);
    coverage.push([variableLabel,allocationNumber(a.valid_cells)+" / "+allocationNumber(a.selected_cells),
      allocationNumber(b.valid_cells)+" / "+allocationNumber(b.selected_cells),allocationNumber(a.population_standard_deviation),allocationNumber(b.population_standard_deviation)]);
  }
  return '<section class="geo-allocation-section"><h4>Physical conditions on changed cells</h4><p>Descriptive contrasts in the retained prepared physical inputs at the actual changed source pixels. Each variable uses its own valid cells; the original files retain the full distributions and source units.</p>'+
    '<div class="geo-allocation-controls">'+select("physical","Original land-cover group",classes.map(x=>({value:String(x.baseline_class),title:x.baseline_class==="all"?"All original classes":x.baseline_class==="other"?"All other original classes":"Baseline class "+x.baseline_class})),String(selected.baseline_class))+"</div>"+
    table(["Changed land","Restoration cells","Control cells","Changed in both"],[
      ["Selected original class",allocationNumber(selected.changed_cells?.restoration),allocationNumber(selected.changed_cells?.control),allocationNumber(selected.overlap_changed_cells)]])+
    table(["Input and units","Restoration mean","Control mean","R − C mean"],means)+
    '<details><summary>Physical input coverage and variation</summary>'+
    table(["Input","R valid / selected cells","C valid / selected cells","R population SD","C population SD"],coverage)+"</details></section>";
}
function sitingMarkup(region) {
  const entries=Object.entries(region.siting_contrasts||{});
  if(!entries.length)return "";
  const support=[],mass=[],avoided=[],areas=[],normalized=[],partitions=[],basis=[],shared=[];
  const unavailable=(value,reason)=>typeof value==="number"&&Number.isFinite(value)?"":label(reason||"unavailable in this retained edition");
  for(const [variable,value] of entries){
    const quantity=pollutantNames[variable]||label(variable);
    const name=quantity+" ("+value.units+")";
    const rateUnits=value.normalized_units||String(value.units||"").replace("/year","/(ha*year)");
    support.push([name,allocationNumber(value.native_common_cells),allocationNumber(value.native_common_hectares),allocationNumber(value.categorical_and_native_common_cells)]);
    shared.push([quantity,value.equal_positive_local_area_and_class_budget===true?"Equal positive area and class counts":value.equal_positive_local_area_and_class_budget===false?"Different or zero local budgets":"Unavailable",
      allocationNumber(value.shared_changed_hectares),allocationNumber(value.advantage_per_shared_changed_ha,true),
      rateUnits,unavailable(value.advantage_per_shared_changed_ha,value.shared_advantage_unavailable_reason)]);
    mass.push([name,allocationNumber(value.mass?.baseline),allocationNumber(value.mass?.restoration),allocationNumber(value.mass?.control),allocationNumber(value.restoration_advantage_mass,true)]);
    for(const arm of ["restoration","control"]){
      const item=value.alternatives?.[arm]||{};
      const regionArea=Object.hasOwn(item,"region_changed_hectares")?item.region_changed_hectares:item.actual_changed_hectares;
      const commonArea=item.native_common_changed_hectares;
      const armName=quantity+" · "+arm;
      avoided.push([armName,arm==="restoration"?"B − R":"B − C",allocationNumber(item.avoided_export_mass,true),value.units,
        allocationNumber(item.avoided_export_percent,true),unavailable(item.avoided_export_percent,item.avoided_export_percent_unavailable_reason)]);
      areas.push([armName,allocationNumber(item.whole_scenario_changed_hectares),allocationNumber(regionArea),
        allocationNumber(commonArea),allocationNumber(item.changed_native_support_fraction)]);
      for(const [areaLabel,key,reasonKey,basisKey] of [
        ["Whole-scenario changed ha","avoided_export_per_whole_scenario_changed_ha","whole_scenario_rate_unavailable_reason","whole_scenario_normalization_basis"],
        ["Changed ha inside this region","avoided_export_per_changed_ha","local_rate_unavailable_reason","normalization_basis"],
        ["Changed ha inside native common support","avoided_export_per_native_common_changed_ha","native_common_rate_unavailable_reason","native_common_normalization_basis"]
      ]){
        normalized.push([armName,areaLabel,allocationNumber(item[key],true),rateUnits,unavailable(item[key],item[reasonKey])]);
        if(item[basisKey])basis.push(armName+" · "+areaLabel+": "+item[basisKey]);
      }
      for(const [partition,part] of Object.entries(item.source_cell_partitions||{})){
        partitions.push([name+" · "+arm+" · "+label(partition),allocationNumber(part.cells),allocationNumber(part.baseline_mass),allocationNumber(part.alternative_mass),allocationNumber(part.avoided_export_mass,true)]);
      }
    }
  }
  return '<section class="geo-allocation-section"><h4>Native comparison on the same source pixels</h4><p>These retained three-way quantities share one original pollutant-specific baseline, restoration and control finite mask. Positive restoration advantage (control minus restoration) means less modeled export under restoration. Negative differences remain visible; absent common support stays unavailable.</p>'+
    table(["Quantity and annual units","Baseline","Restoration","Control","Restoration advantage (C − R)"],mass)+
    table(["Quantity / alternative","Difference","Avoided stream export","Annual units","Avoided percent","Percent unavailable reason"],avoided)+
    '<details><summary>Common support and three original intervention areas</summary>'+
    table(["Quantity","Native common cells","Native common ha","Categorical + native cells"],support)+
    '<p>Whole-scenario area is the complete original intervention. Regional area counts actual changed categorical cells inside this exact mask. Native-common changed area additionally requires finite output in all three runs for this pollutant. These areas are not interchangeable; common coverage is a fraction from zero to one.</p>'+
    table(["Quantity / alternative","Whole-scenario changed ha","Changed ha inside region","Changed ha inside native common support","Common / region fraction"],areas)+"</details>"+
    '<details><summary>Avoided export per explicitly selected changed hectare</summary>'+
    '<p>Each rate divides this region’s same-cell avoided export by its separately named original denominator. Zero area and absent native support stay unavailable for different stated reasons. Regional rates are descriptive: changes in retention or routing outside this mask can change export originating inside it, so the rate does not isolate a causal effect of local planted hectares or an intake load.</p>'+
    table(["Quantity / alternative","Original area denominator","Avoided export / ha","Rate units","Unavailable reason"],normalized)+
    '<p>C − R per equal local changed ha (descriptive) is supplied only for positive equal local changed area and original-class counts. Globally matched cases can have unequal local or native-common treatment budgets.</p>'+
    table(["Quantity","Local area and origin-class budget","Shared local changed ha","C − R / equal local ha","Rate units","Unavailable reason"],shared)+
    '<ul>'+basis.map(x=>"<li>"+esc(x)+"</li>").join("")+"</ul></details>"+
    '<details><summary>Response at changed and unchanged source cells</summary><p>These original partitions describe export originating from changed land, unchanged land and source cells lacking common categorical support, then delivered along modeled flow paths. Their mass difference can include nonlocal routing and retention responses.</p>'+
    table(["Quantity / alternative / source pixels","Cells","Baseline","Alternative","Avoided export"],partitions)+"</details></section>";
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
    '<h4>Changed area by original class</h4>'+table(["Original baseline class","Restoration ha","Control ha","R − C ha"],origins)+physicalMarkup(row,chosen.physicalClass,report.identity?.physical_input_binding)+
    '<h4>Common native-output support</h4><p>These counts intersect the three saved native output masks separately for each quantity. Changed hectares also require common categorical cells.</p>'+
    (support.length?table(["Quantity","Three-run native cells","Native + categorical cells","R changed ha","C changed ha"],support):"<p>No native support rows are retained in this edition.</p>")+
    sitingMarkup(row)+
    '<details><summary>Original baseline comparisons and annual quantities</summary><p>Each row uses its own original baseline-versus-alternative common support. Annual quantities describe export originating from those source pixels and modeled as delivered to streams. Signed change is the original alternative-minus-baseline Float32 difference-pixel sum.</p>'+
    (quantities.length?table(["Quantity / scenario / units","Pairwise cells","Baseline","Alternative","Alt − baseline"],quantities):"<p>This group retains allocation and three-run support. Its saved source does not contain a separate original native mass analysis for this exact union.</p>")+"</details>"+
    '<details><summary>Every land-cover transition in this region</summary>'+table(["Scenario","Original → final class","Cells","Hectares"],transitions)+"</details>"+
    (figures?'<section class="geo-allocation-figures"><h4>Saved figures for this geography group</h4><p>The map shows the original group boundaries. Values above refer to the selected region.</p><div>'+figures+"</div></section>":"<p>No saved figure has support for this selected region.</p>")+
    '<details><summary>Complete original data and source files</summary><div class="geo-actions">'+downloads(result._downloads)+'</div><p class="geo-small">The downloads retain every region, class transition, exact source identity and available physical-input distribution.</p></details>';
  return {selection:chosen,html};
}
