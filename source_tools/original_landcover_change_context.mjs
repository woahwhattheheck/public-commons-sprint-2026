/** Publish the retained paired annual land-cover calculation without replaying pixels. */
import {createArchiveCodec} from "./archive_codec.mjs";
import {createObservedLandcoverSelectionContract} from "../operator/web/observed_landcover_selection.mjs";
const codec=createArchiveCodec();
const CODES=[11,12,21,22,23,24,31,41,42,43,52,71,81,82,90,95];
const NAMES=["Open water","Perennial ice/snow","Developed, open space","Developed, low intensity","Developed, medium intensity","Developed, high intensity","Barren land","Deciduous forest","Evergreen forest","Mixed forest","Shrub/scrub","Grassland/herbaceous","Pasture/hay","Cultivated crops","Woody wetlands","Emergent herbaceous wetlands"];
const GROUPS={water:[11],snow_ice:[12],developed:[21,22,23,24],barren:[31],forest:[41,42,43],shrub:[52],grass:[71],agriculture:[81,82],wetland:[90,95]};
const bytes=value=>typeof value==="string"?codec.utf8Encode(value):value;
const bodyText=value=>codec.utf8Decode(bytes(value));
const digest=value=>codec.sha256(bytes(value));
const json=value=>codec.utf8Encode(JSON.stringify(value,null,2)+"\n");
const equal=(a,b,label)=>{if(a!==b)throw Error(label+" differs from the original calculation");};
const integer=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw Error(label+" must be a nonnegative safe integer");return value;};
const near=(a,b,label)=>{if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>Math.max(1e-7,Math.abs(b)*1e-12))throw Error(label+" differs from native grid accounting");};
const exactObject=(a,b,label)=>equal(JSON.stringify(a),JSON.stringify(b),label);
const descriptor=(path,body)=>({path,bytes:bytes(body).length,sha256:digest(body)});
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=(value,digits=2)=>Number(value).toLocaleString("en-US",{maximumFractionDigits:digits});
const className=code=>NAMES[CODES.indexOf(code)];
const name=scope=>String(scope.properties?.name??scope.properties?.NAME??scope.properties?.Name??"");
const table=(columns,rows,widths)=>({kind:"table",columns,rows:rows.map(row=>row.map(String)),widths});
const csv=rows=>rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\r\n")+"\r\n";
const safeFile=path=>typeof path==="string"&&/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(path)&&path!=="."&&path!=="..";
const HASH=/^[a-f0-9]{64}$/;
function parseCSV(value) {
  const text=bodyText(value),rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;}
    else if(c==='"'){if(field)throw Error("Unexpected CSV quote");quoted=true;}
    else if(c===","){row.push(field);field="";}
    else if(c==="\r"||c==="\n"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(field);rows.push(row);row=[];field="";}
    else field+=c;
  }
  if(quoted)throw Error("Unclosed source CSV field");
  if(field||row.length){row.push(field);rows.push(row);}
  const headers=rows.shift();
  if(!headers||new Set(headers).size!==headers.length)throw Error("Invalid source CSV headers");
  return {headers,rows:rows.map(values=>{equal(values.length,headers.length,"CSV column count");return Object.fromEntries(headers.map((h,i)=>[h,values[i]]));})};
}
function uniqueScopes(rows,label){
  if(!Array.isArray(rows)||!rows.length)throw Error(label+" needs the complete watershed set");
  const result=new Map();
  for(const row of rows){if(!/^\d{12}$/.test(row.huc12)||result.has(row.huc12))throw Error(label+" has a missing/repeated original HUC12");result.set(row.huc12,row);}
  return result;
}
function annualClasses(scope,selected,nodata,area,label){
  integer(selected,label+" selected");integer(nodata,label+" NoData");
  equal(scope.classes.length,CODES.length,label+" class rows");
  const found=new Map();
  for(const row of scope.classes){
    if(!CODES.includes(row.class_code)||found.has(row.class_code))throw Error(label+" has an invalid class");
    integer(row.cells,label+" class cells");near(row.area_m2,row.cells*area,label+" class m²");near(row.area_ha,row.cells*area/10000,label+" class hectares");found.set(row.class_code,row);
  }
  equal([...found.values()].reduce((s,r)=>s+r.cells,0)+nodata,selected,label+" accounting");
  return found;
}
function checkScope(scope,before,after,area,label,scopeKind){
  const selected=integer(scope.selected_cells,label+" selected cells");
  const select=a=>scopeKind==="raster"?a.cell_count:scopeKind==="domain"?a.unique_cells:a.selected_cells;
  const noData=a=>scopeKind==="raster"?a.nodata_count:a.nodata_cells;
  equal(select(before),selected,label+" before selected support");equal(select(after),selected,label+" after selected support");
  for(const key of ["paired_valid_cells","valid_before_only_cells","valid_after_only_cells","both_nodata_cells","stable_class_cells","changed_class_cells"])integer(scope[key],label+" "+key);
  equal(scope.paired_valid_cells+scope.valid_before_only_cells+scope.valid_after_only_cells+scope.both_nodata_cells,selected,label+" paired coverage");
  equal(scope.valid_after_only_cells+scope.both_nodata_cells,noData(before),label+" before NoData");
  equal(scope.valid_before_only_cells+scope.both_nodata_cells,noData(after),label+" after NoData");
  const bc=annualClasses(before,selected,noData(before),area,label+" before"),ac=annualClasses(after,selected,noData(after),area,label+" after");
  const matrix=new Map(),marginsBefore=new Map(CODES.map(c=>[c,0])),marginsAfter=new Map(CODES.map(c=>[c,0]));
  equal(scope.transitions.length,CODES.length*CODES.length,label+" complete matrix");
  let total=0,stable=0;
  for(const row of scope.transitions){
    const key=row.before_class+":"+row.after_class;
    if(!CODES.includes(row.before_class)||!CODES.includes(row.after_class)||matrix.has(key))throw Error(label+" has an invalid/repeated matrix cell");
    integer(row.cells,label+" transition cells");near(row.area_ha,row.cells*area/10000,label+" transition hectares");matrix.set(key,row);
    total+=row.cells;if(row.before_class===row.after_class)stable+=row.cells;
    marginsBefore.set(row.before_class,marginsBefore.get(row.before_class)+row.cells);marginsAfter.set(row.after_class,marginsAfter.get(row.after_class)+row.cells);
  }
  equal(total,scope.paired_valid_cells,label+" matrix support");equal(stable,scope.stable_class_cells,label+" stable support");equal(total-stable,scope.changed_class_cells,label+" changed support");
  near(scope.paired_valid_area_ha,total*area/10000,label+" paired area");
  if(total)near(scope.changed_percent_of_paired_valid,(total-stable)/total*100,label+" changed percentage");
  else equal(scope.changed_percent_of_paired_valid,null,label+" absent percentage denominator");
  equal(scope.classes.length,CODES.length,label+" paired class margins");
  const classSeen=new Set();let missingBefore=0,missingAfter=0;
  for(const row of scope.classes){
    const code=row.class_code;if(!CODES.includes(code)||classSeen.has(code))throw Error(label+" has an invalid/repeated paired class");classSeen.add(code);
    equal(row.before_cells,marginsBefore.get(code),label+" before matrix margin");equal(row.after_cells,marginsAfter.get(code),label+" after matrix margin");equal(row.net_cells,row.after_cells-row.before_cells,label+" net cells");
    near(row.before_area_ha,row.before_cells*area/10000,label+" before hectares");near(row.after_area_ha,row.after_cells*area/10000,label+" after hectares");near(row.net_area_ha,row.net_cells*area/10000,label+" net hectares");
    const mb=bc.get(code).cells-row.before_cells,ma=ac.get(code).cells-row.after_cells;
    integer(mb,label+" before-only class support");integer(ma,label+" after-only class support");missingBefore+=mb;missingAfter+=ma;
  }
  equal(missingBefore,scope.valid_before_only_cells,label+" full before inventory reconciliation");equal(missingAfter,scope.valid_after_only_cells,label+" full after inventory reconciliation");
  equal(scope.grouped_transitions.length,Object.keys(GROUPS).length**2,label+" grouped matrix");const groupSeen=new Set();
  for(const row of scope.grouped_transitions){
    const from=GROUPS[row.before_group],to=GROUPS[row.after_group],key=row.before_group+":"+row.after_group;
    if(!from||!to||groupSeen.has(key))throw Error(label+" has an invalid/repeated class group");groupSeen.add(key);
    const expected=from.reduce((sum,a)=>sum+to.reduce((n,b)=>n+matrix.get(a+":"+b).cells,0),0);
    equal(row.cells,expected,label+" grouped cells");near(row.area_ha,expected*area/10000,label+" grouped hectares");
  }
  return {scope,matrix,beforeClasses:bc,afterClasses:ac};
}
function checkCSV(files,transitions,annualBefore,annualAfter,scopes,area){
  const read=(file,expected)=>{const value=parseCSV(files[file]);equal(value.headers.join(","),expected,file+" columns");return value.rows;};
  const uniqueRows=(rows,key,expected,label,check)=>{equal(rows.length,expected,label+" row count");const seen=new Set();for(const row of rows){const id=key(row);if(seen.has(id))throw Error(label+" duplicate row");seen.add(id);check(row);}return seen;};
  uniqueRows(read("huc12-transitions.csv","huc12,name,before_class,after_class,cells,area_ha"),r=>r.huc12+":"+r.before_class+":"+r.after_class,scopes.size*CODES.length**2,"All original HUC transitions",r=>{
    const state=scopes.get(r.huc12),cell=state?.matrix.get(r.before_class+":"+r.after_class);if(!cell)throw Error("CSV transition is outside the original paired cohort");
    equal(r.name,name(state.scope),"CSV watershed name");equal(Number(r.cells),cell.cells,"CSV transition cells");near(Number(r.area_ha),cell.area_ha,"CSV transition hectares");
  });
  const beforeMap=uniqueScopes(annualBefore.watersheds,"CSV before"),afterMap=uniqueScopes(annualAfter.watersheds,"CSV after");
  uniqueRows(read("annual-huc12-classes.csv","year,huc12,name,class_code,cells,area_ha"),r=>r.year+":"+r.huc12+":"+r.class_code,scopes.size*CODES.length*2,"Both original annual CSV inventories",r=>{
    const source=Number(r.year)===annualBefore.metadata.year?beforeMap:Number(r.year)===annualAfter.metadata.year?afterMap:null;
    const scope=source?.get(r.huc12),item=scope?.classes.find(c=>String(c.class_code)===r.class_code);if(!item)throw Error("Annual CSV row has no original annual source");
    equal(r.name,name(scope),"Annual CSV name");equal(Number(r.cells),item.cells,"Annual CSV cells");near(Number(r.area_ha),item.area_ha,"Annual CSV hectares");
  });
  uniqueRows(read("huc12-change-summary.csv","huc12,name,selected_cells,paired_valid_area_ha,stable_class_cells,changed_class_cells,changed_percent,changed_area_ha"),r=>r.huc12,scopes.size,"Original HUC summary",r=>{
    const w=scopes.get(r.huc12)?.scope;if(!w)throw Error("Unknown summary HUC");equal(r.name,name(w),"Summary name");
    for(const k of ["selected_cells","stable_class_cells","changed_class_cells"])equal(Number(r[k]),w[k],"Summary "+k);
    near(Number(r.paired_valid_area_ha),w.paired_valid_area_ha,"Summary paired area");near(Number(r.changed_area_ha),w.changed_class_cells*area/10000,"Summary changed area");
    if(w.changed_percent_of_paired_valid===null){if(r.changed_percent!=="")throw Error("Summary has no percentage denominator");}else near(Number(r.changed_percent),w.changed_percent_of_paired_valid,"Summary changed percent");
  });
  uniqueRows(read("domain-transitions.csv","before_class,after_class,cells,area_ha"),r=>r.before_class+":"+r.after_class,CODES.length**2,"Original union matrix",r=>{
    const cell=transitions.domain.transitions.find(c=>String(c.before_class)===r.before_class&&String(c.after_class)===r.after_class);if(!cell)throw Error("Unknown domain transition");
    equal(Number(r.cells),cell.cells,"Domain CSV cells");near(Number(r.area_ha),cell.area_ha,"Domain CSV hectares");
  });
  uniqueRows(read("domain-class-change.csv","class_code,before_cells,after_cells,net_cells,before_area_ha,after_area_ha,net_area_ha"),r=>r.class_code,CODES.length,"Original union margins",r=>{
    const item=transitions.domain.classes.find(c=>String(c.class_code)===r.class_code);if(!item)throw Error("Unknown domain margin");
    for(const k of ["before_cells","after_cells","net_cells"])equal(Number(r[k]),item[k],"Margin CSV "+k);
    for(const k of ["before_area_ha","after_area_ha","net_area_ha"])near(Number(r[k]),item[k],"Margin CSV "+k);
  });
  uniqueRows(read("domain-group-transitions.csv","before_group,after_group,cells,area_ha"),r=>r.before_group+":"+r.after_group,Object.keys(GROUPS).length**2,"Original grouped union matrix",r=>{
    const item=transitions.domain.grouped_transitions.find(c=>c.before_group===r.before_group&&c.after_group===r.after_group);if(!item)throw Error("Unknown original group");
    equal(Number(r.cells),item.cells,"Grouped CSV cells");near(Number(r.area_ha),item.area_ha,"Grouped CSV hectares");
  });
}

function htmlTable(headers,rows,id=""){
  return '<div class="scroll" tabindex="0" role="region" aria-label="Land-cover data table; scroll horizontally for all columns"><table'+(id?' id="'+esc(id)+'"':"")+'><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(row=>"<tr>"+row.map((v,i)=>'<'+(i?"td":"th")+'>'+esc(v)+'</'+(i?"td":"th")+'>').join("")+"</tr>").join("")+"</tbody></table></div>";
}
function netGroup(scope,codes){return scope.classes.filter(row=>codes.includes(row.class_code)).reduce((n,row)=>n+row.net_area_ha,0);}
function summaryRows(transitions){
  return transitions.watersheds.map(w=>({
    huc12:w.huc12,name:name(w),selected_cells:w.selected_cells,paired_valid_cells:w.paired_valid_cells,
    paired_valid_area_ha:w.paired_valid_area_ha,changed_cells:w.changed_class_cells,
    changed_area_ha:w.changed_class_cells*transitions.method.cell_area_m2/10000,
    changed_percent:w.changed_percent_of_paired_valid,developed_net_ha:netGroup(w,GROUPS.developed),
    forest_net_ha:netGroup(w,GROUPS.forest),agriculture_net_ha:netGroup(w,GROUPS.agriculture),
    before_only_cells:w.valid_before_only_cells,after_only_cells:w.valid_after_only_cells,both_nodata_cells:w.both_nodata_cells
  })).sort((a,b)=>(b.changed_percent??-1)-(a.changed_percent??-1)||a.huc12.localeCompare(b.huc12));
}
function matrixHTML(scope,unit="ha"){
  const lookup=new Map(scope.transitions.map(t=>[t.before_class+":"+t.after_class,t])),max=Math.max(1,...scope.transitions.map(t=>t.cells));
  return '<div class="scroll" tabindex="0" role="region" aria-label="Land-cover data table; scroll horizontally for all columns"><table class="matrix"><caption>Rows: earlier class. Columns: later class. '+(unit==="ha"?"Hectares":"Cells")+'. Diagonal cells retain the same class. · = zero paired cells; NoData is listed separately.</caption><thead><tr><th scope="col">From / to</th>'+CODES.map(c=>'<th scope="col" aria-label="'+esc(c+" "+className(c))+'" title="'+esc(className(c))+'">'+c+"</th>").join("")+'</tr></thead><tbody>'+CODES.map(a=>'<tr><th scope="row" aria-label="'+esc(a+" "+className(a))+'" title="'+esc(className(a))+'">'+a+"</th>"+CODES.map(b=>{
    const t=lookup.get(a+":"+b),value=unit==="ha"?t.area_ha:t.cells;
    const shade=255-Math.round(60*Math.sqrt(t.cells/max));
    return '<td style="background:rgb('+shade+','+shade+','+shade+')" title="'+esc(className(a)+" → "+className(b)+": "+t.cells+" cells")+'">'+(t.cells?num(value,unit==="ha"?2:0):"·")+"</td>";
  }).join("")+"</tr>").join("")+"</tbody></table></div>";
}

/** Source-bound analyst selections over the original integer transition matrices. */
export function createWatershedComparison(data, contractFactory=createObservedLandcoverSelectionContract) {
  const portable=contractFactory(), maxSelected=8;
  const groups=data.groups, ids=data.scopes.filter(s=>s.id!=="domain").map(s=>s.id);
  const sourceKeys=["analysis_manifest_sha256","before_year","after_year","before_raster_sha256","after_raster_sha256","original_polygon_sha256"];
  const source=Object.fromEntries(sourceKeys.map(k=>[k,data.source[k]]));
  if(sourceKeys.some(k=>k.endsWith("sha256")&&!/^[a-f0-9]{64}$/.test(source[k]))||
      !Number.isSafeInteger(source.before_year)||!Number.isSafeInteger(source.after_year)||
      source.before_year>=source.after_year)throw Error("Invalid original comparison source identity");
  const index=new Map(data.scopes.map(s=>[s.id,s]));
  if(index.size!==data.scopes.length||new Set(ids).size!==ids.length||ids.some(id=>!/^\d{12}$/.test(id)))
    throw Error("Invalid original watershed identities");
  if(!Number.isFinite(data.area)||data.area<=0||!groups||Object.keys(groups).length!==9)
    throw Error("Invalid original comparison grid or groups");
  const membership=new Map();
  for(const [key,codes] of Object.entries(groups))for(const code of codes){
    if(membership.has(code)||!data.codes.includes(code))throw Error("Land-cover groups overlap or change the original classes");
    membership.set(code,key);
  }
  if(membership.size!==data.codes.length)throw Error("Land-cover groups do not cover all original classes");
  const cache=new Map(), ha=cells=>cells*data.area/10000, ratio=(a,b)=>b?100*a/b:null;
  function metrics(id){
    if(cache.has(id))return cache.get(id);
    const s=index.get(id);if(!s)throw Error("Choose an original watershed");
    if(!Array.isArray(s.counts)||s.counts.length!==data.codes.length**2||
        s.counts.some(c=>!Number.isSafeInteger(c)||c<0))throw Error("Invalid original transition cells");
    const rows=Object.fromEntries(Object.keys(groups).map(group=>[group,{
      group,class_codes:[...groups[group]],before_cells:0,after_cells:0,
      gross_gain_cells:0,gross_loss_cells:0,retained_group_cells:0,within_group_class_change_cells:0
    }]));
    let paired=0,changed=0,cross=0;
    for(let i=0;i<data.codes.length;i++)for(let j=0;j<data.codes.length;j++){
      const cells=s.counts[i*data.codes.length+j],a=membership.get(data.codes[i]),b=membership.get(data.codes[j]);
      paired+=cells;if(i!==j)changed+=cells;
      rows[a].before_cells+=cells;rows[b].after_cells+=cells;
      if(a===b){rows[a].retained_group_cells+=cells;if(i!==j)rows[a].within_group_class_change_cells+=cells;}
      else{rows[a].gross_loss_cells+=cells;rows[b].gross_gain_cells+=cells;cross+=cells;}
    }
    if(paired!==s.paired||changed!==s.changed)throw Error("Original comparison support differs from its matrix");
    for(const row of Object.values(rows)){
      row.net_cells=row.after_cells-row.before_cells;
      if(row.net_cells!==row.gross_gain_cells-row.gross_loss_cells)throw Error("Original group balance differs");
      for(const key of ["before","after","gross_gain","gross_loss","retained_group","within_group_class_change","net"])
        row[key+"_ha"]=ha(row[key+"_cells"]);
      Object.freeze(row.class_codes);Object.freeze(row);
    }
    const value=Object.freeze({huc12:id,name:s.name,scope_kind:id==="domain"?"original_domain_union":"original_huc12",
      paired_valid_cells:paired,paired_valid_ha:ha(paired),changed_cells:changed,changed_ha:ha(changed),
      changed_percent_of_paired_valid:ratio(changed,paired),cross_group_changed_cells:cross,
      cross_group_changed_ha:ha(cross),within_group_class_changed_cells:changed-cross,
      before_only_cells:s.beforeOnly,after_only_cells:s.afterOnly,both_nodata_cells:s.bothNoData,
      groups:Object.freeze(rows)});
    cache.set(id,value);return value;
  }
  function selectedIds(value,{allowEmpty=false}={}){
    if(!Array.isArray(value)||value.length>maxSelected||(!allowEmpty&&!value.length)||
       value.some(id=>typeof id!=="string"||!ids.includes(id))||new Set(value).size!==value.length)
      throw Error("Choose one to eight distinct original HUC12 watersheds");
    return [...value];
  }
  const groupMetrics=["gross_gain_ha","gross_loss_ha","net_ha"];
  function view(value={}){
    const group=value.group??"developed",group_metric=value.group_metric??"net_ha";
    if(!Object.hasOwn(groups,group)||!groupMetrics.includes(group_metric))throw Error("Unknown comparison group or quantity");
    return {group,group_metric};
  }
  function save(value){
    const chosen=selectedIds(value.huc12_ids);
    return portable.make({selection:{analysis_source_id:data.native_binding.analysis_source_id,
      analysis_sha256:data.native_binding.analysis_sha256,title:value.title??"Selected watershed comparison",huc12s:chosen},
      binding:{analysis_manifest_sha256:source.analysis_manifest_sha256,source_domain_sha256:source.original_polygon_sha256,
        rasters:{before:{year:source.before_year,sha256:source.before_raster_sha256},after:{year:source.after_year,sha256:source.after_raster_sha256}}},
      view:view(value.view)});
  }
  function open(value){
    const parsed=portable.parse(value);
    portable.assertBinding(parsed,data.native_binding,{requireManifest:true});
    return {huc12_ids:selectedIds(parsed.selection.huc12s),title:parsed.selection.title,view:view(parsed.view)};
  }
  function aggregate(value){
    const selected=selectedIds(value);
    if(data.overlap_cells!==0)return null;
    const values=selected.map(metrics),paired=values.reduce((n,r)=>n+r.paired_valid_cells,0),
      changed=values.reduce((n,r)=>n+r.changed_cells,0);
    return {scope_kind:"selected_disjoint_huc12_union",huc12_ids:selected,
      paired_valid_cells:paired,paired_valid_ha:ha(paired),changed_cells:changed,changed_ha:ha(changed),
      changed_percent_of_paired_valid:ratio(changed,paired),
      before_only_cells:values.reduce((n,r)=>n+r.before_only_cells,0),
      after_only_cells:values.reduce((n,r)=>n+r.after_only_cells,0),
      both_nodata_cells:values.reduce((n,r)=>n+r.both_nodata_cells,0),
      groups:Object.fromEntries(Object.keys(groups).map(group=>{
        const row={group,class_codes:[...groups[group]]};
        for(const key of ["before","after","gross_gain","gross_loss","retained_group","within_group_class_change","net"]){
          row[key+"_cells"]=values.reduce((n,r)=>n+r.groups[group][key+"_cells"],0);
          row[key+"_ha"]=ha(row[key+"_cells"]);
        }
        return [group,row];
      }))};
  }
  const csv=rows=>rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\r\n")+"\r\n";
  const sourceColumns=sourceKeys, prefix=sourceKeys.map(k=>source[k]);
  function groupCSV(value,{includeDomain=false}={}){
    const selected=includeDomain?[...data.scopes.map(s=>s.id)]:selectedIds(value);
    const columns=["scope_kind","huc12","original_name","paired_valid_cells","paired_valid_ha","changed_class_cells",
      "changed_class_ha","changed_percent_of_paired_valid","cross_group_changed_cells","within_group_class_changed_cells",
      "before_only_valid_cells","after_only_valid_cells","both_nodata_cells","group","class_codes",
      "before_cells","after_cells","gross_gain_cells","gross_loss_cells","net_cells","retained_group_cells",
      "within_group_class_change_cells","before_ha","after_ha","gross_gain_ha","gross_loss_ha","net_ha",
      "retained_group_ha","within_group_class_change_ha",...sourceColumns];
    const rows=[];
    for(const id of selected){const r=metrics(id);for(const g of Object.values(r.groups))rows.push([
      r.scope_kind,r.huc12,r.name,r.paired_valid_cells,r.paired_valid_ha,r.changed_cells,r.changed_ha,
      r.changed_percent_of_paired_valid,r.cross_group_changed_cells,r.within_group_class_changed_cells,
      r.before_only_cells,r.after_only_cells,r.both_nodata_cells,g.group,g.class_codes.join(" "),
      g.before_cells,g.after_cells,g.gross_gain_cells,g.gross_loss_cells,g.net_cells,g.retained_group_cells,
      g.within_group_class_change_cells,g.before_ha,g.after_ha,g.gross_gain_ha,g.gross_loss_ha,g.net_ha,
      g.retained_group_ha,g.within_group_class_change_ha,...prefix]);}
    return csv([columns,...rows]);
  }
  function transitionCSV(value){
    const selected=selectedIds(value),rows=[["huc12","original_name","before_class","after_class","cells","ha",
      "percent_of_huc_paired_valid",...sourceColumns]];
    for(const id of selected){const s=index.get(id);for(let i=0;i<data.codes.length;i++)for(let j=0;j<data.codes.length;j++){
      const count=s.counts[i*data.codes.length+j];
      rows.push([id,s.name,data.codes[i],data.codes[j],count,ha(count),ratio(count,s.paired),...prefix]);
    }}
    return csv(rows);
  }
  return {maxSelected,ids:[...ids],source:{...source},groups,groupMetrics,metrics,selectedIds,save,open,aggregate,
    groupCSV,transitionCSV};
}


function watershedComparisonController(d, makeModel, contractFactory) {
  "use strict";
  const model=makeModel(d,contractFactory), byId=id=>document.getElementById(id);
  const nodes=Object.fromEntries(["picker","add","clear","title","selected","status","summary","groups","group","metric",
    "charts","group-chart","total","save","open","csv","transitions","print","heading","details"].map(k=>[k,byId("compare-"+k)]));
  let selection=[], revision=0, request=0, printDetails=null;
  const n=(x,p=3)=>x===null?"No paired valid cells":Number(x).toLocaleString("en-US",{maximumFractionDigits:p});
  const e=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const labels={gross_gain_ha:"Gross gain",gross_loss_ha:"Gross loss",net_ha:"Net change"};
  function status(text,error=false){nodes.status.textContent=text;nodes.status.className="status"+(error?" error":"");}
  function table(headers,rows){
    const t=document.createElement("table"),head=t.createTHead().insertRow();
    for(const text of headers){const c=document.createElement("th");c.scope="col";c.textContent=text;head.append(c);}
    const body=t.createTBody();
    for(const values of rows){const r=body.insertRow();values.forEach((text,i)=>{
      const c=i?document.createElement("td"):document.createElement("th");
      if(!i)c.scope="row";c.textContent=text;r.append(c);
    });}return t;
  }
  function chart(rows,quantity,title,{percent=false,signed=false}={}){
    const values=rows.map(quantity),finite=values.filter(x=>x!==null),maximum=percent?100:Math.max(1,...finite.map(Math.abs));
    const left=119,width=449,zero=signed?left+width/2:left,scale=width/(maximum*(signed?2:1));
    const height=48+rows.length*32,label=x=>n(x,2)+(percent?"%":" ha");
    let body='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 650 '+height+'" role="img" aria-label="'+e(title)+'"><title>'+e(title)+
      '</title><line x1="'+zero+'" x2="'+zero+'" y1="25" y2="'+(height-6)+'" stroke="#777"/>'+
      '<text x="'+left+'" y="16">'+e(label(signed?-maximum:0))+'</text>'+
      '<text x="'+(left+width)+'" y="16" text-anchor="end">'+e(label(maximum))+'</text>';
    if(signed)body+='<text x="'+zero+'" y="16" text-anchor="middle">0</text>';
    rows.forEach((r,i)=>{const y=33+i*32,v=values[i];body+='<text x="2" y="'+(y+11)+'">'+e(r.huc12)+'</text>';
      if(v===null)body+='<text x="'+(left+6)+'" y="'+(y+11)+'">No paired valid cells</text>';
      else{const end=zero+v*scale,w=Math.abs(v*scale);body+='<rect x="'+Math.min(zero,end)+'" y="'+y+'" width="'+w+
        '" height="13" fill="'+(v<0?"#a2a2a2":"#555")+'"><title>'+e(r.huc12+" · "+r.name+": "+label(v))+
        '</title></rect><text x="644" y="'+(y+24)+'" text-anchor="end">'+e(label(v))+'</text>';}
    });return '<figure class="comparison-chart"><figcaption>'+e(title)+'</figcaption><p class="chart-scroll-hint">Scroll horizontally to read the complete chart at its original text size.</p><div class="comparison-plot" tabindex="0" role="region" aria-label="'+e(title+'; scroll horizontally for the complete chart')+'">'+body+'</svg></div></figure>';
  }
  function view(){return {group:nodes.group.value,group_metric:nodes.metric.value};}
  function current(){return {huc12_ids:[...selection],title:nodes.title.value,view:view()};}
  function render(){
    const rows=selection.map(id=>model.metrics(id)),v=view(),count=rows.length;
    nodes.selected.replaceChildren();
    for(const r of rows){
      const item=document.createElement("div");item.className="chosen-watershed";
      const text=document.createElement("span");text.textContent=r.huc12+" · "+r.name;
      const button=document.createElement("button");button.type="button";button.textContent="Remove";
      button.setAttribute("aria-label","Remove "+r.huc12+" "+r.name);
      button.addEventListener("click",()=>{selection=selection.filter(id=>id!==r.huc12);revision++;render();});
      item.append(text,button);nodes.selected.append(item);
    }
    for(const option of nodes.picker.options)option.disabled=selection.includes(option.value);
    nodes.add.disabled=count>=model.maxSelected||!nodes.picker.value||selection.includes(nodes.picker.value);
    nodes.clear.disabled=!count;
    for(const k of ["save","csv","transitions","print"])nodes[k].disabled=!count;
    nodes.heading.textContent=nodes.title.value.trim()||"Selected watershed comparison";
    nodes.summary.replaceChildren(table(["HUC12","Original name","Paired-valid ha","Changed-class ha","Changed %","Earlier-only cells","Later-only cells","Both NoData cells"],
      rows.map(r=>[r.huc12,r.name,n(r.paired_valid_ha),n(r.changed_ha),n(r.changed_percent_of_paired_valid),n(r.before_only_cells,0),n(r.after_only_cells,0),n(r.both_nodata_cells,0)])));
    nodes.groups.replaceChildren(table(["HUC12","Group","Earlier ha","Later ha","Gross gain ha","Gross loss ha","Net ha","Retained group ha","Within-group class change ha"],
      rows.flatMap(r=>Object.values(r.groups).map(g=>[r.huc12,g.group.replaceAll("_"," "),n(g.before_ha),n(g.after_ha),n(g.gross_gain_ha),n(g.gross_loss_ha),n(g.net_ha),n(g.retained_group_ha),n(g.within_group_class_change_ha)]))));
    nodes.charts.innerHTML=count?chart(rows,r=>r.changed_ha,"Changed classification — common hectare scale")+chart(rows,r=>r.changed_percent_of_paired_valid,"Changed share — each HUC's paired-valid support",{percent:true}):"";
    nodes["group-chart"].innerHTML=count?chart(rows,r=>r.groups[v.group][v.group_metric],v.group.replaceAll("_"," ")+" — "+labels[v.group_metric],{signed:v.group_metric==="net_ha"}):"";
    if(count){
      const total=model.aggregate(selection);
      nodes.total.textContent=total?"Selected HUC12 union (disjoint original native cells): "+n(total.paired_valid_ha)+" paired-valid ha; "+
        n(total.changed_ha)+" changed-class ha; "+n(total.changed_percent_of_paired_valid)+"% changed. The percentage uses summed changed cells divided by summed paired-valid cells.":
        "The original domain reports overlapping HUC pixels. Individual results remain available; a sum of selected polygons is not shown.";
    }else nodes.total.textContent="Add up to eight original HUC12 watersheds to compare their retained source quantities.";
    status(count+" of "+model.maxSelected+" comparison places selected. All "+model.ids.length+" original watersheds remain available.");
  }
  function download(body,type,name){
    const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement("a");a.href=url;a.download=name;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function action(fn){try{fn();}catch(error){status(error.message,true);}}
  nodes.picker.addEventListener("change",()=>{nodes.add.disabled=!nodes.picker.value||selection.length>=model.maxSelected||selection.includes(nodes.picker.value);});
  nodes.add.addEventListener("click",()=>action(()=>{selection=model.selectedIds([...selection,nodes.picker.value]);nodes.picker.value="";revision++;render();}));
  nodes.clear.addEventListener("click",()=>{selection=[];revision++;render();});
  for(const node of [nodes.title,nodes.group,nodes.metric])node.addEventListener(node===nodes.title?"input":"change",()=>{revision++;render();});
  nodes.save.addEventListener("click",()=>action(()=>download(JSON.stringify(model.save(current()),null,2)+"\n","application/json","watershed-comparison-selection.json")));
  nodes.csv.addEventListener("click",()=>action(()=>download(model.groupCSV(selection),"text/csv;charset=utf-8","selected-watershed-group-comparison.csv")));
  nodes.transitions.addEventListener("click",()=>action(()=>download(model.transitionCSV(selection),"text/csv;charset=utf-8","selected-watershed-transitions.csv")));
  function preparePrint(){if(selection.length&&printDetails===null){printDetails=nodes.details.open;nodes.details.open=true;}}
  nodes.print.addEventListener("click",()=>{preparePrint();document.body.classList.add("print-comparison");window.print();});
  window.addEventListener("beforeprint",preparePrint);
  window.addEventListener("afterprint",()=>{document.body.classList.remove("print-comparison");if(printDetails!==null){nodes.details.open=printDetails;printDetails=null;}});
  nodes.open.addEventListener("change",async()=>{
    const file=nodes.open.files?.[0];if(!file)return;
    const generation=++request,edit=revision;
    try{
      if(file.size>65536)throw Error("Choose a saved comparison selection JSON smaller than 64 KiB");
      const text=await file.text();
      if(generation!==request||edit!==revision)return;
      const next=model.open(JSON.parse(text.replace(/^\uFEFF/,"")));
      selection=next.huc12_ids;nodes.title.value=next.title;nodes.group.value=next.view.group;nodes.metric.value=next.view.group_metric;
      revision++;render();status("Opened saved selection against the exact original source edition.");
    }catch(error){if(generation===request&&edit===revision)status("Selection was kept. "+error.message,true);}
    finally{if(generation===request)nodes.open.value="";}
  });
  render();
}

function htmlReport(transitions,rows,originalInputs,summary){
  const d=transitions.domain,area=transitions.method.cell_area_m2,before=transitions.metadata.before.year,after=transitions.metadata.after.year;
  const groupRows=Object.entries(GROUPS).map(([group,codes])=>{const values=transitions.domain.classes.filter(c=>codes.includes(c.class_code));return [group.replaceAll("_"," "),num(values.reduce((s,r)=>s+r.before_area_ha,0)),num(values.reduce((s,r)=>s+r.after_area_ha,0)),num(values.reduce((s,r)=>s+r.net_area_ha,0))];});
  const downloads=originalInputs.map(item=>'<li><a href="'+esc(item.path)+'" download>'+esc(item.path)+'</a> <span>'+num(item.bytes,0)+" bytes</span></li>").join("");
  const rowHTML=rows.map(row=>'<tr data-search="'+esc((row.huc12+" "+row.name).toLowerCase())+'"><th scope="row">'+row.huc12+"</th><td>"+esc(row.name)+'</td><td>'+num(row.paired_valid_area_ha)+"</td><td>"+num(row.changed_area_ha)+"</td><td>"+(row.changed_percent===null?"No paired cells":num(row.changed_percent)+"%")+"</td><td>"+num(row.developed_net_ha)+"</td><td>"+num(row.forest_net_ha)+"</td><td>"+num(row.agriculture_net_ha)+"</td></tr>").join("");
  const compact=[{id:"domain",name:"Complete original watershed union",...d},...transitions.watersheds.map(w=>({id:w.huc12,name:name(w),...w}))].map(w=>({id:w.id,name:w.name,paired:w.paired_valid_cells,changed:w.changed_class_cells,beforeOnly:w.valid_before_only_cells,afterOnly:w.valid_after_only_cells,bothNoData:w.both_nodata_cells,counts:CODES.flatMap(a=>CODES.map(b=>w.transitions.find(t=>t.before_class===a&&t.after_class===b).cells))}));
  const comparison={native_binding:{...summary.native_binding,analysis_manifest_sha256:summary.manifestSha256},codes:CODES,names:NAMES,area,scopes:compact,groups:GROUPS,overlap_cells:d.overlap_cells,source:{analysis_manifest_sha256:summary.manifestSha256,before_year:before,after_year:after,before_raster_sha256:transitions.metadata.before.sha256,after_raster_sha256:transitions.metadata.after.sha256,original_polygon_sha256:transitions.metadata.domain_sha256}};
  const embedded=JSON.stringify(comparison).replaceAll("<","\\u003c").replaceAll("\u2028","\\u2028").replaceAll("\u2029","\\u2029");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(summary.title)+'</title><style>'+
  '*{box-sizing:border-box}body{margin:0;background:#f5f5f5;color:#202020;font:15px/1.5 system-ui,sans-serif}main{max-width:1420px;margin:auto;padding:28px}h1{font-size:28px;line-height:1.2}h2{font-size:21px;margin-top:0}p{max-width:105ch}section{background:#fff;border:1px solid #aaa;padding:20px;margin:18px 0}nav{display:flex;flex-wrap:wrap;gap:18px}a{color:#222;text-decoration:underline}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}.metrics div{border-left:3px solid #555;padding:8px 12px}.metrics strong{display:block;font-size:23px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top}thead th{background:#eee}tbody th{font-weight:500}td:nth-child(n+3){text-align:right;font-variant-numeric:tabular-nums}caption{text-align:left;font-weight:600;margin:10px 0}.matrix{font-size:11px}.matrix th,.matrix td{padding:6px;text-align:right;white-space:nowrap;border:1px solid #ccc}.matrix td{font-variant-numeric:tabular-nums}.controls{display:flex;gap:14px;flex-wrap:wrap;align-items:end;margin:14px 0}label{display:flex;flex-direction:column;gap:5px;font-weight:600}input,select,button{font:inherit;padding:9px;border:1px solid #777;background:#fff;max-width:100%}select{max-width:550px}input{width:340px}code{overflow-wrap:anywhere;font-size:12px}.muted,small{color:#444}li{margin:5px 0}.downloads{columns:2}.downloads span{color:#555;font-size:12px}.status{margin:10px 0}.print-count{display:none}.method{border-left:4px solid #555;padding-left:14px}@media(max-width:640px){main{padding:12px}section{padding:12px}h1{font-size:23px}.downloads{columns:1}input{width:100%}}@media print{#watersheds tbody tr[hidden]{display:table-row!important}#watershed-count{display:none}.print-count{display:block!important}body{background:#fff}main{padding:0;max-width:none}section{border:0;padding:0}.controls,nav{display:none}.scroll{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}.matrix{font-size:8px}.matrix th,.matrix td{padding:3px}a{color:#000}}'+
  ".comparison-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px}.comparison-chart{margin:16px 0;min-width:0;max-width:100%}.comparison-plot{overflow-x:auto;max-width:100%;min-width:0}.chart-scroll-hint{font-size:12px;margin:0 0 6px;color:#444}.comparison-chart figcaption{font-weight:600;margin-bottom:7px}.comparison-chart svg{display:block;width:650px;min-width:650px;max-width:none;max-height:none;font:11px system-ui,sans-serif}.controls>*{min-width:0;max-width:100%}.controls label{flex:1 1 260px;min-width:0;max-width:100%}.controls select{width:100%;max-width:100%}.chosen-watersheds{display:flex;gap:8px;flex-wrap:wrap}.chosen-watershed{display:flex;gap:10px;align-items:center;border:1px solid #aaa;padding:5px 8px;max-width:100%}.chosen-watershed span{min-width:0;overflow-wrap:anywhere}.chosen-watershed button{padding:3px 7px;flex-shrink:0}.error{font-weight:600;border-left:3px solid #222;padding-left:9px}#compare-summary td,#compare-groups td{font-variant-numeric:tabular-nums}@media print{.chosen-watershed button{display:none}.comparison-charts{display:block}.comparison-chart{break-inside:avoid}.comparison-plot{overflow:visible}.chart-scroll-hint{display:none}.comparison-details>summary{display:none}.comparison-details .scroll{display:block!important}body.print-comparison main>h1,body.print-comparison main>p,body.print-comparison main>section:not(#comparison-section){display:none}body.print-comparison #comparison-section{display:block}body.print-comparison .comparison-source{font-size:10px}}"+
  '</style></head><body><main><h1>'+esc(summary.title)+'</h1><p>Paired original categorical raster cells within all '+rows.length+' retained HUC12 watersheds. The comparison preserves both annual inventories and every class transition.</p><nav><a href="#watershed-section">All watersheds</a><a href="#comparison-section">Compare selected watersheds</a><a href="#matrix-section">Inspect transitions</a><a href="#source-section">Original source downloads</a><a href="change-summary.csv" download>Complete interpreted summary CSV</a><a href="observed-report.json" download>Scientific report recipe</a></nav>'+
  '<section><div class="metrics"><div>Paired valid area<strong>'+num(d.paired_valid_area_ha)+' ha</strong></div><div>Changed classification<strong>'+num(d.changed_class_cells*area/10000)+' ha</strong></div><div>Share changed<strong>'+(d.changed_percent_of_paired_valid===null?"No paired valid area":num(d.changed_percent_of_paired_valid,4)+"%")+'</strong></div><div>Original HUC12 watersheds<strong>'+rows.length+'</strong></div></div><p class="method">'+esc(transitions.method.interpretation)+' The pixel-centre rule counts whole source cells whose centres fall in the original polygons. The separate native fractional-area ledger weights boundary intersections and can return different areas.</p><p>'+num(d.stable_class_cells,0)+' stable-class cells; '+num(d.changed_class_cells,0)+' changed-class cells. Earlier-only valid: '+num(d.valid_before_only_cells,0)+'; later-only valid: '+num(d.valid_after_only_cells,0)+'; NoData in both: '+num(d.both_nodata_cells,0)+'. Domain overlap: '+num(d.overlap_cells,0)+' cells. The full source rectangle additionally contains '+num(d.outside_domain_cells,0)+' cells outside the watershed union.</p></section>'+
  '<section><h2>Complete domain class balance</h2><p>Net change is later minus earlier area on cells valid in both years. It differs from gross exchanges in either direction. Forest groups41–43, developed21–24 and agriculture81–82; complete categories remain below and in the originals.</p>'+htmlTable(["Group",before+" ha",after+" ha","Net ha"],groupRows)+
  '<details><summary>All 16 original classes</summary>'+htmlTable(["Code","Land-cover class",before+" ha",after+" ha","Net ha"],d.classes.map(c=>[c.class_code,className(c.class_code),num(c.before_area_ha),num(c.after_area_ha),num(c.net_area_ha)]))+"</details></section>"+
  '<section id="watershed-section"><h2>Every original watershed</h2><p>Sorted by changed share. Each named row covers the full original HUC12 polygon and its exact source grid support. HUC totals are distinct from an observation gauge catchment or protection-area footprint.</p><div class="controls"><label>Find a HUC12 or original name<input type="search" id="watershed-search" placeholder="HUC12 or name"></label></div><p id="watershed-count" class="status" role="status">'+rows.length+' original watersheds</p><p class="print-count">Complete original table: '+rows.length+' watersheds. On-screen search does not remove printed rows.</p><div class="scroll" tabindex="0" role="region" aria-label="Land-cover data table; scroll horizontally for all columns"><table id="watersheds"><thead><tr><th>HUC12</th><th>Original name</th><th>Paired ha</th><th>Changed ha</th><th>Changed %</th><th>Developed net ha</th><th>Forest net ha</th><th>Agriculture net ha</th></tr></thead><tbody>'+rowHTML+"</tbody></table></div></section>"+

  '<section id="comparison-section"><h2 id="compare-heading">Selected watershed comparison</h2><p>Select up to eight of the complete original HUC12s. Comparisons use the same two source years, native cell rule and paired-valid support. A changed-class percentage has its own HUC paired-valid denominator; hectares compare physical area.</p><div class="controls"><label>Comparison title<input id="compare-title" maxlength="240" value="Selected watershed comparison"></label><label>Add an original HUC12<select id="compare-picker"><option value="">Choose a watershed</option>'+transitions.watersheds.map(w=>'<option value="'+w.huc12+'">'+w.huc12+" · "+esc(name(w))+"</option>").join("")+'</select></label><button id="compare-add" type="button" disabled>Add watershed</button><button id="compare-clear" type="button" disabled>Clear selection</button></div><div id="compare-selected" class="chosen-watersheds"></div><p id="compare-status" role="status" aria-live="polite"></p><p id="compare-total"></p><div id="compare-summary" class="scroll" tabindex="0" role="region" aria-label="Selected watershed support table"></div><div id="compare-charts" class="comparison-charts"></div><div class="controls"><label>Land-cover group<select id="compare-group">'+Object.keys(GROUPS).map(g=>'<option value="'+g+'"'+(g==="developed"?" selected":"")+'>'+g.replaceAll("_"," ")+' ['+GROUPS[g].join(", ")+']</option>').join("")+'</select></label><label>Group quantity<select id="compare-metric"><option value="net_ha">Net change (ha)</option><option value="gross_gain_ha">Gross gain (ha)</option><option value="gross_loss_ha">Gross loss (ha)</option></select></label></div><div id="compare-group-chart"></div><p>Gross gain counts transitions into the group from other groups; gross loss counts transitions out. Switches among classes inside a group remain in retained group area and are reported separately. Net change equals gain minus loss. Developed includes vegetated open space (21); it is not measured impervious area. Woody wetlands (90) stay in the wetland group.</p><details id="compare-details" class="comparison-details"><summary>All nine original groups for every selected watershed</summary><div id="compare-groups" class="scroll" tabindex="0" role="region" aria-label="All group changes for selected watersheds"></div></details><div class="controls"><button id="compare-csv" type="button" disabled>Export all selected group rows CSV</button><button id="compare-transitions" type="button" disabled>Export all selected transitions CSV</button><button id="compare-save" type="button" disabled>Save selection JSON</button><label>Open saved selection<input id="compare-open" type="file" accept=".json,application/json"></label><button id="compare-print" type="button" disabled>Print selected comparison</button></div><p class="muted">CSV exports retain exact native counts, unrounded hectares, all group rows or all 256 transitions per selected HUC, and original source hashes. Import HUC12 columns as text to preserve their leading zero. Saved JSON reopens only when original analysis, raster, polygon and year identities match. <a href="watershed-group-flows.csv" download>Complete original union and all-HUC group-flow CSV</a>.</p><p class="comparison-source">Source years '+before+' → '+after+'; original analysis manifest <code>'+esc(summary.manifestSha256)+'</code>.</p></section>'+

  '<section id="matrix-section"><h2>Complete directional transitions</h2><p>Each matrix includes every class pair, including zero-count pairs. Diagonal entries keep the same class. A class can have substantial exchanges while its net area changes little. Gray intensity uses the square root of the selected cell count solely for display.</p><div class="controls"><label>Original spatial scope<select id="scope"><option value="domain">Complete watershed union</option>'+transitions.watersheds.map(w=>'<option value="'+w.huc12+'">'+w.huc12+" · "+esc(name(w))+"</option>").join("")+'</select></label><label>Displayed quantity<select id="quantity"><option value="ha">Hectares</option><option value="cells">Native cells</option></select></label></div><p id="scope-status" class="status" role="status">Complete watershed union: '+num(d.paired_valid_cells,0)+' paired valid cells.</p><div id="matrix">'+matrixHTML(d)+'</div><details><summary>Class definitions</summary>'+htmlTable(["Code","Original category"],CODES.map((c,i)=>[c,NAMES[i]]))+"</details></section>"+
  '<section id="source-section"><h2>Original sources, checks and complete downloads</h2><p>All input bytes below are retained unchanged. The source manifest and producing operation bind each file by length and SHA256. Both annual inventories, all '+num(rows.length*CODES.length**2,0)+' watershed/class-pair CSV rows and complete JSON matrices reconcile exactly before this report is emitted.</p><p>'+esc(transitions.method.pixel_rule)+'. '+esc(transitions.method.temporal_pairing)+'. '+esc(transitions.metadata.coordinate_conversion.description)+'. Stated coordinate-operation accuracy: '+esc(transitions.metadata.coordinate_conversion.stated_accuracy_m)+' m. Original CRS EPSG:'+transitions.source_epsg+'; raster EPSG:'+transitions.metadata.before.epsg+'. Cell area: '+area+' m².</p><ul class="downloads">'+downloads+'</ul><p><a href="source-manifest.json">Import this scientific report</a> · <a href="reconciliation.json">Exact source and support reconciliation</a></p><details><summary>Original source identities</summary><p>Earlier raster <code>'+esc(transitions.metadata.before.sha256)+'</code></p><p>Later raster <code>'+esc(transitions.metadata.after.sha256)+'</code></p><p>Original polygon body <code>'+esc(transitions.metadata.domain_sha256)+'</code></p><p>Original analysis source manifest <code>'+esc(summary.manifestSha256)+'</code></p></details></section>'+
  '<script type="application/json" id="paired-data">'+embedded+'</script><script>(()=>{"use strict";const d=JSON.parse(document.getElementById("paired-data").textContent),scope=document.getElementById("scope"),unit=document.getElementById("quantity"),target=document.getElementById("matrix"),status=document.getElementById("scope-status"),field=document.getElementById("watershed-search"),rows=Array.from(document.querySelectorAll("#watersheds tbody tr"));const n=(x,p=2)=>Number(x).toLocaleString("en-US",{maximumFractionDigits:p});function render(){const s=d.scopes.find(x=>x.id===scope.value);if(!s)return;const t=document.createElement("table");t.className="matrix";const cap=document.createElement("caption");cap.textContent=s.id+" · "+s.name+". Rows: earlier class; columns: later class. "+(unit.value==="ha"?"Hectares.":"Native cells.")+" · = zero paired cells; NoData is listed separately.";t.append(cap);const head=t.createTHead().insertRow();for(const [i,v] of ["From / to",...d.codes].entries()){const h=document.createElement("th");h.scope="col";h.textContent=v;if(i){h.title=d.names[i-1];h.setAttribute("aria-label",v+" "+d.names[i-1]);}head.append(h);}const body=t.createTBody(),max=Math.max(1,...s.counts);for(let i=0;i<d.codes.length;i++){const r=body.insertRow(),h=document.createElement("th");h.textContent=d.codes[i];h.title=d.names[i];h.scope="row";h.setAttribute("aria-label",d.codes[i]+" "+d.names[i]);r.append(h);for(let j=0;j<d.codes.length;j++){const cells=s.counts[i*d.codes.length+j],c=r.insertCell(),shade=255-Math.round(60*Math.sqrt(cells/max));c.textContent=cells?n(unit.value==="ha"?cells*d.area/10000:cells,unit.value==="ha"?2:0):"·";c.title=d.names[i]+" → "+d.names[j]+": "+cells+" cells";c.style.backgroundColor="rgb("+shade+","+shade+","+shade+")";}}const wrap=document.createElement("div");wrap.className="scroll";wrap.tabIndex=0;wrap.setAttribute("role","region");wrap.setAttribute("aria-label","Directional land-cover matrix; scroll horizontally for all classes");wrap.append(t);target.replaceChildren(wrap);status.textContent=n(s.paired,0)+" paired valid cells; "+n(s.changed,0)+" changed; earlier-only "+n(s.beforeOnly,0)+"; later-only "+n(s.afterOnly,0)+"; both NoData "+n(s.bothNoData,0)+".";}scope.addEventListener("change",render);unit.addEventListener("change",render);field.addEventListener("input",()=>{const q=field.value.trim().toLowerCase();let count=0;for(const row of rows){const show=row.dataset.search.includes(q);row.hidden=!show;if(show)count++;}document.getElementById("watershed-count").textContent=count+" of "+rows.length+" original watersheds";});})();</script><script>('+watershedComparisonController.toString()+')(JSON.parse(document.getElementById("paired-data").textContent),('+createWatershedComparison.toString()+'),('+createObservedLandcoverSelectionContract.toString()+'));</script></main></body></html>\n';
}

/**
 * files is a plain filename -> original UTF-8 string/Uint8Array map from the
 * existing analysis directory. The independent manifest digest is mandatory.
 * Returned files include every unchanged original plus the scientific report.
 */
export function composeOriginalLandcoverChangeContext({files,expectedManifestSha256}){
  if(!files||typeof files!=="object"||!HASH.test(expectedManifestSha256||""))throw Error("Supply the original file map and independently retained manifest SHA256");
  const original={};for(const [path,value]of Object.entries(files)){if(!safeFile(path))throw Error("Original analysis members must be plain relative filenames");const b=bytes(value);if(!(b instanceof Uint8Array))throw Error("Supply complete original bytes for "+path);original[path]=b;}
  const manifestBody=original["model-sources.json"];if(!manifestBody)throw Error("Original model-sources.json is required");equal(digest(manifestBody),expectedManifestSha256,"Original manifest identity");
  const manifest=JSON.parse(bodyText(manifestBody));equal(manifest.schema,"upstate.sources/v1","Original manifest schema");
  if(!Array.isArray(manifest.entries)||!manifest.entries.length)throw Error("Original analysis source entries are required");
  const entries=new Map(),ids=new Set();
  for(const entry of manifest.entries){
    if(!safeFile(entry.path)||entries.has(entry.path)||!entry.id||ids.has(entry.id))throw Error("Duplicate/unsafe source identity");
    if(entry.kind!=="table"||entry.role!=="LANDCOVER_OBSERVED_CONTEXT")throw Error("Select the original annual comparison source collection");
    if(!HASH.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1)throw Error("Original source descriptor is incomplete");
    const body=original[entry.path];if(!body)throw Error("Missing original analysis member "+entry.path);
    equal(body.length,entry.bytes,entry.path+" original length");equal(digest(body),entry.sha256,entry.path+" original hash");
    if(typeof entry.uri!=="string"||!/^https?:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(entry.uri)||!entry.vintage)throw Error("Original source URL/vintage is incomplete");
    entries.set(entry.path,entry);ids.add(entry.id);
  }
  const run=JSON.parse(bodyText(original["analysis-run.json"]??"null"));
  if(run?.schema!=="upstate.original-landcover-analysis-run/v1")throw Error("Select the original producing operation");
  const beforeYear=run.rasters?.before?.year,afterYear=run.rasters?.after?.year;
  if(!Number.isInteger(beforeYear)||!Number.isInteger(afterYear)||beforeYear>=afterYear)throw Error("Retain ordered original product years");
  const beforeFile="annual-"+beforeYear+".json",afterFile="annual-"+afterYear+".json",transitionFile="transitions-"+beforeYear+"-"+afterYear+".json";
  const expectedFiles=[beforeFile,afterFile,transitionFile,"annual-huc12-classes.csv","huc12-change-summary.csv","huc12-transitions.csv","domain-transitions.csv","domain-class-change.csv","domain-group-transitions.csv"];
  equal(run.results?.length,expectedFiles.length,"Complete original result inventory");const retained=new Set();
  for(const item of run.results){
    const source=entries.get(item.path);if(!expectedFiles.includes(item.path)||retained.has(item.path)||!source)throw Error("Original producing inventory has an unknown/duplicate result");
    equal(item.sha256,source.sha256,"Producer/result source hash");equal(item.bytes,source.bytes,"Producer/result source bytes");retained.add(item.path);
  }
  const before=JSON.parse(bodyText(original[beforeFile])),after=JSON.parse(bodyText(original[afterFile])),paired=JSON.parse(bodyText(original[transitionFile]));
  equal(before.schema,"upstate.landcover-zonal-summary/v1","Earlier inventory schema");equal(after.schema,before.schema,"Later inventory schema");equal(paired.schema,"upstate.annual-landcover-transitions/v1","Paired result schema");
  exactObject(paired.grid,run.grid,"Producing grid");exactObject(before.grid,paired.grid,"Earlier grid");exactObject(after.grid,paired.grid,"Later grid");
  const affine=paired.grid.affine;if(!Array.isArray(affine)||affine.length!==6||affine.some(v=>!Number.isFinite(v)))throw Error("Retain the complete native affine transform");
  integer(paired.grid.width,"Native width");integer(paired.grid.height,"Native height");if(!paired.grid.width||!paired.grid.height)throw Error("Empty native grid");
  const cellArea=Math.abs(affine[0]*affine[4]-affine[1]*affine[3]);if(!(cellArea>0))throw Error("Degenerate source grid");
  near(paired.method.cell_area_m2,cellArea,"Paired cell determinant");near(before.method.cell_area_m2,cellArea,"Earlier cell determinant");near(after.method.cell_area_m2,cellArea,"Later cell determinant");
  exactObject(paired.method.matrix_classes,CODES,"Original categorical matrix order");
  equal(before.source_epsg,paired.source_epsg,"Earlier original polygon CRS");equal(after.source_epsg,paired.source_epsg,"Later original polygon CRS");
  const domainHash=paired.metadata.domain_sha256;if(!HASH.test(domainHash))throw Error("Original polygon identity is required");equal(domainHash,run.source_domain_sha256,"Producing polygon identity");
  for(const [annual,key,year]of [[before,"before",beforeYear],[after,"after",afterYear]]){
    const source=paired.metadata[key];exactObject(source,run.rasters[key],"Producing "+key+" raster");equal(source.year,year,"Original product year");
    equal(annual.metadata.year,year,"Annual product year");equal(annual.metadata.domain_sha256,domainHash,"Annual polygon identity");
    for(const hashKey of ["sha256","raster_sha256"])if(annual.metadata[hashKey]!==undefined)equal(annual.metadata[hashKey],source.sha256,"Annual raster identity");
    if(annual.metadata.sha256===undefined&&annual.metadata.raster_sha256===undefined)throw Error("Annual raster identity is missing");
    equal(annual.metadata.raster_bytes,source.bytes,"Annual raster bytes");equal(annual.metadata.epsg,source.epsg,"Annual raster CRS");equal(annual.metadata.nodata,source.nodata,"Annual NoData");
    exactObject(annual.method.coordinate_conversion,paired.metadata.coordinate_conversion,"Original coordinate operation");
    equal(annual.method.pixel_rule,paired.method.pixel_rule,"Original cell membership rule");
  }
  exactObject(paired.metadata.coordinate_conversion,run.coordinate_operation,"Producing coordinate operation");
  equal(run.source_crs,"EPSG:"+paired.source_epsg,"Producing original polygon CRS");
  if(!paired.method.pixel_rule||!paired.method.temporal_pairing||!paired.method.interpretation)throw Error("Retain the original method and interpretation");
  const beforeScopes=uniqueScopes(before.watersheds,"Earlier inventory"),afterScopes=uniqueScopes(after.watersheds,"Later inventory"),pairedScopes=uniqueScopes(paired.watersheds,"Paired inventory");
  equal(beforeScopes.size,pairedScopes.size,"Earlier watershed count");equal(afterScopes.size,pairedScopes.size,"Later watershed count");equal(run.result_checks.watersheds,pairedScopes.size,"Producing watershed count");
  for(const entry of entries.values()){
    equal(entry.metadata?.domain_features,pairedScopes.size,"Source watershed count");equal(entry.metadata?.domain_sha256,domainHash,"Source polygon identity");
    exactObject(entry.metadata?.source_years,[beforeYear,afterYear],"Source years");equal(entry.metadata?.pixel_rule,paired.method.pixel_rule,"Source membership rule");
  }
  const raster=checkScope(paired.raster,before.raster,after.raster,cellArea,"Full rectangular source","raster");
  equal(paired.raster.selected_cells,paired.grid.width*paired.grid.height,"Full raster dimensions");
  const domain=checkScope(paired.domain,before.domain,after.domain,cellArea,"Original watershed union","domain");
  equal(paired.domain.overlap_cells,before.domain.overlap_cells,"Earlier overlap");equal(paired.domain.overlap_cells,after.domain.overlap_cells,"Later overlap");integer(paired.domain.overlap_cells,"Overlap cells");
  equal(paired.domain.outside_domain_cells,before.domain.outside_domain_cells,"Earlier outside cells");equal(paired.domain.outside_domain_cells,after.domain.outside_domain_cells,"Later outside cells");
  equal(paired.domain.selected_cells+paired.domain.outside_domain_cells,paired.raster.selected_cells,"Union plus outside raster");
  const scopes=new Map();
  for(const [id,w]of pairedScopes){const b=beforeScopes.get(id),a=afterScopes.get(id);if(!b||!a)throw Error("Original annual watershed sets differ");exactObject(w.properties,b.properties,"Earlier original watershed properties");exactObject(w.properties,a.properties,"Later original watershed properties");scopes.set(id,checkScope(w,b,a,cellArea,"HUC12 "+id,"watershed"));}
  if(paired.domain.overlap_cells===0){
    equal([...scopes.values()].reduce((sum,v)=>sum+v.scope.selected_cells,0),paired.domain.selected_cells,"Nonoverlapping original watershed union");
    for(const [key,row]of domain.matrix)equal([...scopes.values()].reduce((sum,v)=>sum+v.matrix.get(key).cells,0),row.cells,"Per-HUC and union transition "+key);
  }
  checkCSV(original,paired,before,after,scopes,cellArea);
  const rows=summaryRows(paired),title="Original "+beforeYear+"–"+afterYear+" land-cover change — complete watershed domain";
  const sourcePaths=[...entries.keys(),"model-sources.json"];
  const outputs={};for(const path of sourcePaths)outputs[path]=original[path];
  const originalInputs=sourcePaths.map(path=>descriptor(path,outputs[path]));
  const summary={title,manifestSha256:expectedManifestSha256,watersheds:scopes.size,transition_rows:scopes.size*CODES.length**2,
    domain_cells:paired.domain.selected_cells,paired_valid_cells:paired.domain.paired_valid_cells,
    changed_cells:paired.domain.changed_class_cells,changed_area_ha:paired.domain.changed_class_cells*cellArea/10000,
    changed_percent:paired.domain.changed_percent_of_paired_valid,before_year:beforeYear,after_year:afterYear,
    original_polygon_sha256:domainHash,before_raster_sha256:paired.metadata.before.sha256,after_raster_sha256:paired.metadata.after.sha256,
    native_binding:{analysis_source_id:entries.get("analysis-run.json").id,analysis_sha256:entries.get("analysis-run.json").sha256,source_domain_sha256:domainHash,rasters:{before:paired.metadata.before,after:paired.metadata.after}}};
  const reconciliation={schema:"upstate.original-landcover-change-reconciliation/v1",...summary,source_members:originalInputs,
    source_operation_id:run.operation_id,method:paired.method,coordinate_operation:paired.metadata.coordinate_conversion,
    checks:{complete_original_source_hashes:true,all_original_csv_values:true,both_annual_inventories_reconciled:true,
      complete_paired_matrix_margins:true,grouped_matrix_matches_classes:true,domain_and_full_rectangle_separate:true,
      nonoverlapping_huc_matrices_sum_to_union:paired.domain.overlap_cells===0}};
  const columns=Object.keys(rows[0]);
  outputs["change-summary.csv"]=codec.utf8Encode(csv([columns,...rows.map(r=>columns.map(c=>r[c]))]));
  outputs["reconciliation.json"]=json(reconciliation);
  const groupData={native_binding:{...summary.native_binding,analysis_manifest_sha256:expectedManifestSha256},codes:CODES,names:NAMES,area:cellArea,groups:GROUPS,overlap_cells:paired.domain.overlap_cells,
    source:{analysis_manifest_sha256:expectedManifestSha256,before_year:beforeYear,after_year:afterYear,
      before_raster_sha256:paired.metadata.before.sha256,after_raster_sha256:paired.metadata.after.sha256,original_polygon_sha256:domainHash},
    scopes:[{id:"domain",name:"Complete original watershed union",...paired.domain},...paired.watersheds.map(w=>({id:w.huc12,name:name(w),...w}))].map(w=>({
      id:w.id,name:w.name,paired:w.paired_valid_cells,changed:w.changed_class_cells,beforeOnly:w.valid_before_only_cells,
      afterOnly:w.valid_after_only_cells,bothNoData:w.both_nodata_cells,counts:CODES.flatMap(a=>CODES.map(b=>w.transitions.find(t=>t.before_class===a&&t.after_class===b).cells))}))};
  outputs["watershed-group-flows.csv"]=codec.utf8Encode(createWatershedComparison(groupData).groupCSV([],{includeDomain:true}));
  outputs["landcover-change-report.html"]=codec.utf8Encode(htmlReport(paired,rows,originalInputs,summary));
  const inputs=Object.entries(outputs).map(([path,body])=>descriptor(path,body));
  const d=paired.domain;
  const groupRows=Object.entries(GROUPS).map(([group,codes])=>{const list=d.classes.filter(c=>codes.includes(c.class_code));return [group.replaceAll("_"," "),num(list.reduce((s,r)=>s+r.before_area_ha,0)),num(list.reduce((s,r)=>s+r.after_area_ha,0)),num(list.reduce((s,r)=>s+r.net_area_ha,0))];});
  const topChanges=d.transitions.filter(t=>t.before_class!==t.after_class&&t.cells).sort((a,b)=>b.cells-a.cells||a.before_class-b.before_class||a.after_class-b.after_class).slice(0,20);
  const sourceLinks=inputs.map(input=>({title:input.path,path:input.path}));
  const recipe={schema:"upstate.observed-report/v1",title,edition:"original-landcover-change-v1",vintage:entries.get(transitionFile).vintage,
    interpretation_kind:"original_native_landcover_change",original_source:{operation_id:run.operation_id,polygon_body_sha256:domainHash,
      before:paired.metadata.before,after:paired.metadata.after,analysis_manifest_sha256:expectedManifestSha256},
    inputs,sections:[
      ["Original paired land-cover change",[
        "The original "+beforeYear+" and "+afterYear+" annual products are paired at the same retained native raster cells inside "+rows.length+" original HUC12 watersheds.",
        table(["Measure","Value"],[["Paired valid cells",num(d.paired_valid_cells,0)],["Paired valid hectares",num(d.paired_valid_area_ha)],["Changed-class cells",num(d.changed_class_cells,0)],["Changed hectares",num(summary.changed_area_ha)],["Changed share of paired valid cells",d.changed_percent_of_paired_valid===null?"No paired valid cells":num(d.changed_percent_of_paired_valid,5)+"%"],["Stable-class cells",num(d.stable_class_cells,0)],["Earlier-only valid / later-only valid / both NoData",[d.valid_before_only_cells,d.valid_after_only_cells,d.both_nodata_cells].join(" / ")]],[0.65,0.35]),
        paired.method.interpretation,
        "This is native pixel-centre area accounting. The separate fractional-pixel ledger weights polygon intersections at cell boundaries. Both methods retain their own outputs."
      ]],
      ["Domain class balance",[
        "Net area is later minus earlier area on paired valid cells. Directional gross exchanges are retained separately, including exchanges between categories within the same group.",
        table(["Group",beforeYear+" ha",afterYear+" ha","Net ha"],groupRows,[0.31,0.23,0.23,0.23]),
        table(["Class","Original category",beforeYear+" ha",afterYear+" ha","Net ha"],d.classes.map(c=>[c.class_code,className(c.class_code),num(c.before_area_ha),num(c.after_area_ha),num(c.net_area_ha)]),[0.08,0.38,0.18,0.18,0.18])
      ]],
      ["Largest directional class exchanges",[
        "Twenty largest non-diagonal domain transitions, ranked by original cell count. The complete 256-pair union matrix and all "+num(summary.transition_rows,0)+" per-HUC class pairs remain in the retained CSV and JSON companions.",
        table(["Earlier class","Later class","Cells","Hectares"],topChanges.map(t=>[t.before_class+" "+className(t.before_class),t.after_class+" "+className(t.after_class),num(t.cells,0),num(t.area_ha)]),[0.34,0.34,0.15,0.17])
      ]],
      ["Complete original watershed comparison",[
        "All "+rows.length+" original HUC12s, sorted by changed share. Named HUC areas are distinct from exact gauge catchments and drinking-water protection footprints. The full companion summary also retains agriculture net change and per-year validity counts.",
        table(["HUC12","Original name","Paired ha","Changed ha","Changed %","Developed net ha","Forest net ha"],rows.map(r=>[r.huc12,r.name,num(r.paired_valid_area_ha),num(r.changed_area_ha),r.changed_percent===null?"":num(r.changed_percent,3),num(r.developed_net_ha),num(r.forest_net_ha)]),[0.16,0.27,0.12,0.12,0.1,0.115,0.115])
      ]],
      ["Source accounting and complete originals",[
        paired.method.pixel_rule+". "+paired.method.temporal_pairing+". "+paired.metadata.coordinate_conversion.description+". Stated coordinate-operation accuracy: "+paired.metadata.coordinate_conversion.stated_accuracy_m+" m.",
        "Union totals count selected pixels once. Full-rectangle "+num(paired.raster.selected_cells,0)+" cells include "+num(d.outside_domain_cells,0)+" outside-domain cells; those rectangle totals are retained separately. Original overlap is "+num(d.overlap_cells,0)+" cells.",
        "All source descriptors and producer output hashes are verified. Every CSV row agrees with the original matrices and annual inventories. HUC12 identifiers remain strings with their leading zero. Exact original source and interpretation records travel with this saved report.",
        {kind:"links",items:sourceLinks}
      ]]
    ],source_links:Object.keys(outputs)};
  const recipeBody=json(recipe),sourceId="original-landcover-change-"+digest(recipeBody).slice(0,24);
  const entry={id:sourceId,title,kind:"document",role:"OBSERVED_CONTEXT",vintage:recipe.vintage,uri:entries.get(transitionFile).uri,
    ...descriptor("observed-report.json",recipeBody),companions:inputs,
    description:"Complete original paired annual land-cover source with exact matrix/annual support and all HUC rows.",
    metadata:{interpretation_kind:recipe.interpretation_kind,product_years:[beforeYear,afterYear],watershed_count:rows.length,
      related_source_ids:[...ids],source_relationships:[...ids].map(id=>({id,relationship:"original_paired_landcover_result"})),
      source_manifest_sha256:expectedManifestSha256,pixel_rule:paired.method.pixel_rule}};
  const reportManifest={schema:"upstate.sources/v1",title,entries:[entry]};
  outputs["observed-report.json"]=recipeBody;outputs["source-manifest.json"]=json(reportManifest);
  return {sourceId,recipe,manifest:reportManifest,files:outputs,summary,reconciliation};
}
