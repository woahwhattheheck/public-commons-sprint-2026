/** Original class pathways behind the retained watershed review criteria. */
import {GROUPS, toCsv} from "../../observations/landcover_observation_profiles_20261013/profiles_core.mjs";

export const CLASS_NAMES = Object.freeze({
  11:"Open water",12:"Perennial ice / snow",21:"Developed, open space",
  22:"Developed, low intensity",23:"Developed, medium intensity",24:"Developed, high intensity",
  31:"Barren land",41:"Deciduous forest",42:"Evergreen forest",43:"Mixed forest",
  52:"Shrub / scrub",71:"Grassland / herbaceous",81:"Pasture / hay",82:"Cultivated crops",
  90:"Woody wetlands",95:"Emergent herbaceous wetlands"
});
const codes=Object.keys(CLASS_NAMES).map(Number);
const groupOf=new Map(Object.entries(GROUPS).flatMap(([group,classes])=>classes.map(code=>[code,group])));
const groupNames={water:"Water",snow_ice:"Snow / ice",developed:"Developed",barren:"Barren",
  forest:"Forest",shrub_grass:"Shrub / grass",agriculture:"Agriculture",wetlands:"Wetlands"};
const sum=(xs,fn)=>xs.reduce((n,x)=>n+fn(x),0);
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-12);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=v=>Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const integer=(v,label)=>{const n=Number(v);if(v===""||v===null||!Number.isSafeInteger(n)||n<0)throw Error("Invalid "+label);return n;};
function criterionPairs(pairs,kind) {
  return pairs.filter(p=>kind==="forest_loss"?p.from_group==="forest"&&p.to_group!=="forest":
    kind==="forest_gain"?p.from_group!=="forest"&&p.to_group==="forest":
    kind==="developed_gain"?p.from_group!=="developed"&&p.to_group==="developed":
    kind==="wetland_loss"?p.from_group==="wetlands"&&p.to_group!=="wetlands":false);
}
const criteria=["forest_loss","forest_gain","developed_gain","wetland_loss"];
const criteriaNames={forest_loss:"Forest gross loss",forest_gain:"Forest gross gain",developed_gain:"Developed gross gain",wetland_loss:"Wetland gross loss"};
export function buildAttribution({validatedProfiles,transitionRows,cellAreaHa,scopes,reviewProject}) {
  if(!validatedProfiles?.profiles||!validatedProfiles?.groups||!Number.isFinite(cellAreaHa)||cellAreaHa<=0)
    throw Error("Use the original validated profile result and positive native cell area");
  if(reviewProject.schema!=="upstate.watershed-review/v1"||reviewProject.source_edition!==scopes.edition)
    throw Error("Review project and scope source editions differ");
  const profiles=new Map(validatedProfiles.profiles.map(p=>[p.huc12,p]));
  const groupProfiles=new Map(validatedProfiles.groups.map(p=>[p.huc12+":"+p.group,p]));
  const matrices=new Map([...profiles.keys()].map(id=>[id,new Map()]));
  for(const row of transitionRows) {
    const a=integer(row.before_class,"before class"),b=integer(row.after_class,"after class");
    const matrix=matrices.get(row.huc12),n=integer(row.cells,"original class count");
    if(!matrix||!groupOf.has(a)||!groupOf.has(b)||matrix.has(a+":"+b)||!close(Number(row.area_ha),n*cellAreaHa))
      throw Error("Unknown, duplicate or inconsistent original matrix row");
    matrix.set(a+":"+b,n);
  }
  for(const [id,matrix] of matrices)if(matrix.size!==256||sum([...matrix.values()],x=>x)!==profiles.get(id).selected_cells)
    throw Error("Incomplete original matrix "+id);
  const selected=Object.entries(reviewProject.notes||{}).filter(([,v])=>v.queued).map(([id])=>id).sort();
  if(!selected.length)throw Error("Select at least one queued watershed");
  const definitions=selected.map(id=>({id:"huc12:"+id,name:profiles.get(id)?.name||id,kind:"whole_huc12",ids:[id]}));
  for(const [id,label] of [["arjws-focus","ARJWS focus"],["arjws-upstream","ARJWS upstream"],["prwd-focus","Pioneer focus"],["prwd-upstream","Pioneer upstream"],["utility-union","Combined utility upstream union"]]) {
    if(!scopes.scopes[id])throw Error("Missing original scope "+id);
    definitions.push({id,name:label,kind:id==="utility-union"?"deduplicated_whole_huc_union":id.endsWith("upstream")?"whole_upstream_huc_union":"whole_focus_huc_union",ids:[...scopes.scopes[id].ids]});
  }
  const subjects=[];
  for(const definition of definitions) {
    const ids=definition.ids;
    if(new Set(ids).size!==ids.length||ids.some(id=>!profiles.has(id)))throw Error("Unknown or repeated HUC in "+definition.id);
    const matrix=new Map(codes.flatMap(a=>codes.map(b=>[a+":"+b,0])));
    for(const id of ids)for(const [key,n] of matrices.get(id))matrix.set(key,matrix.get(key)+n);
    const pairs=[...matrix].map(([key,cells])=>{const [from,to]=key.split(":").map(Number);return{from_class:from,to_class:to,from_group:groupOf.get(from),to_group:groupOf.get(to),cells,area_ha:cells*cellAreaHa};});
    const total=sum(pairs,p=>p.cells),changed=sum(pairs.filter(p=>p.from_class!==p.to_class),p=>p.cells);
    if(total!==sum(ids,id=>profiles.get(id).selected_cells))throw Error("Subject support differs");
    const groups=Object.keys(GROUPS).map(group=>{
      const first=sum(pairs.filter(p=>p.from_group===group),p=>p.cells);
      const last=sum(pairs.filter(p=>p.to_group===group),p=>p.cells);
      const gain=sum(pairs.filter(p=>p.from_group!==group&&p.to_group===group),p=>p.cells);
      const loss=sum(pairs.filter(p=>p.from_group===group&&p.to_group!==group),p=>p.cells);
      const internal=sum(pairs.filter(p=>p.from_group===group&&p.to_group===group&&p.from_class!==p.to_class),p=>p.cells);
      if(last-first!==gain-loss)throw Error("Subject group conservation differs");
      for(const [field,expected] of [["area_2023_ha",first*cellAreaHa],["area_2025_ha",last*cellAreaHa],["gross_gain_ha",gain*cellAreaHa],["gross_loss_ha",loss*cellAreaHa]])
        if(!close(sum(ids,id=>groupProfiles.get(id+":"+group)[field]),expected))throw Error("Original profile attribution differs: "+definition.id+" "+group+" "+field);
      return{group,before_cells:first,after_cells:last,gain_cells:gain,loss_cells:loss,net_cells:last-first,within_group_changed_cells:internal};
    });
    const groupPairs=Object.keys(GROUPS).flatMap(from=>Object.keys(GROUPS).map(to=>({
      from_group:from,to_group:to,cells:sum(pairs.filter(p=>p.from_group===from&&p.to_group===to),p=>p.cells)
    })));
    const attribution=Object.fromEntries(criteria.map(kind=>{
      const rows=criterionPairs(pairs,kind).filter(p=>p.cells).sort((a,b)=>b.cells-a.cells||a.from_class-b.from_class||a.to_class-b.to_class);
      const count=sum(rows,p=>p.cells);
      return[kind,{cells:count,area_ha:count*cellAreaHa,pathways:rows.map(p=>({...p,share_percent:count?100*p.cells/count:null}))}];
    }));
    const devUp=sum(pairs.filter(p=>p.from_group==="developed"&&p.to_group==="developed"&&p.to_class>p.from_class),p=>p.cells);
    const devDown=sum(pairs.filter(p=>p.from_group==="developed"&&p.to_group==="developed"&&p.to_class<p.from_class),p=>p.cells);
    subjects.push({...definition,states:[...new Set(ids.flatMap(id=>String(profiles.get(id).states).split(",")))].sort(),
      classified_cells:total,classified_area_ha:total*cellAreaHa,
      changed_class_cells:changed,changed_class_area_ha:changed*cellAreaHa,
      changed_group_cells:sum(pairs.filter(p=>p.from_group!==p.to_group),p=>p.cells),
      developed_higher_class_cells:devUp,developed_lower_class_cells:devDown,
      groups,group_pathways:groupPairs,criteria:attribution,
      class_pathways:pairs.filter(p=>p.cells)});
  }
  return{schema:"upstate.utility-class-attribution/v1",source_edition:scopes.edition,years:[2023,2025],cell_area_ha:cellAreaHa,
    class_names:CLASS_NAMES,groups:GROUPS,subjects,
    interpretation:[
      "Quantities describe the retained paired AnnualNLCD classifications on the original EPSG:5070 grid.",
      "Gross group gain and loss count crossings of the declared group boundary. Changes between classes in one group remain separately inspectable.",
      "Developed gain includes class21, developed open space. Transitions among21–24 are retained separately as moves to higher or lower classified intensity.",
      "Whole-HUC focus and upstream unions retain their original state membership. Actual South Carolina reporting masks and utility protection polygons are separate geographic selections.",
      "Before/after classifications identify the class pathway to inspect in the source maps. Determining the land-management activity or its water-quality effect uses the relevant mapped and modeled evidence."
    ]};
}
export function attributionTables(result) {
  const summary=[],groups=[],criteriaRows=[],classes=[];
  const ha=n=>n*result.cell_area_ha;
  for(const s of result.subjects) {
    summary.push({subject_id:s.id,name:s.name,subject_kind:s.kind,huc12_ids:s.ids.join("|"),states:s.states.join("|"),
      classified_cells:s.classified_cells,classified_area_ha:s.classified_area_ha,changed_class_cells:s.changed_class_cells,
      changed_class_area_ha:s.changed_class_area_ha,changed_group_cells:s.changed_group_cells,
      changed_group_area_ha:ha(s.changed_group_cells),developed_higher_class_cells:s.developed_higher_class_cells,
      developed_higher_class_area_ha:ha(s.developed_higher_class_cells),developed_lower_class_cells:s.developed_lower_class_cells,
      developed_lower_class_area_ha:ha(s.developed_lower_class_cells)});
    for(const g of s.groups)groups.push({subject_id:s.id,group:g.group,before_cells:g.before_cells,after_cells:g.after_cells,
      area_2023_ha:ha(g.before_cells),area_2025_ha:ha(g.after_cells),gross_gain_ha:ha(g.gain_cells),gross_loss_ha:ha(g.loss_cells),
      net_change_ha:ha(g.net_cells),within_group_changed_ha:ha(g.within_group_changed_cells)});
    for(const [criterion,value] of Object.entries(s.criteria))for(const p of value.pathways)
      criteriaRows.push({subject_id:s.id,criterion,from_class:p.from_class,from_name:CLASS_NAMES[p.from_class],to_class:p.to_class,
        to_name:CLASS_NAMES[p.to_class],cells:p.cells,area_ha:p.area_ha,criterion_area_ha:value.area_ha,share_percent:p.share_percent});
    for(const p of s.class_pathways)classes.push({subject_id:s.id,from_class:p.from_class,to_class:p.to_class,from_group:p.from_group,to_group:p.to_group,cells:p.cells,area_ha:p.area_ha});
  }
  return{"subject-summary.csv":toCsv(summary),"group-quantities.csv":toCsv(groups),"criterion-pathways.csv":toCsv(criteriaRows),"class-pathways.csv":toCsv(classes)};
}
export function renderAttributionSection(result,subjectId) {
  const s=result.subjects.find(s=>s.id===subjectId);if(!s)throw Error("Unknown attribution subject");
  const rows=Object.entries(s.criteria).map(([kind,value])=>{
    const top=value.pathways.slice(0,4);
    const rest=value.cells-sum(top,p=>p.cells);
    const detail=top.map(p=>esc(CLASS_NAMES[p.from_class])+" → "+esc(CLASS_NAMES[p.to_class])+": "+fmt(p.area_ha)+" ha ("+fmt(p.share_percent)+"%)");
    if(rest)detail.push("Remaining original pathways: "+fmt(rest*result.cell_area_ha)+" ha");
    return"<tr><th scope=\"row\">"+esc(criteriaNames[kind])+"</th><td>"+fmt(value.area_ha)+" ha</td><td>"+(detail.length?detail.join("<br>"):"No classified group crossing")+"</td></tr>";
  }).join("");
  const open=sum(s.class_pathways.filter(p=>p.to_class===21&&p.from_group!=="developed"),p=>p.cells)*result.cell_area_ha;
  return"<section class=\"utility-class-attribution\"><h3>"+esc(s.name)+": original class pathways</h3>"+
    "<p>"+s.ids.length+" whole HUC"+(s.ids.length===1?"":"s")+" · "+fmt(s.classified_area_ha)+" classified ha · 2023–2025 AnnualNLCD</p>"+
    "<div style=\"overflow-x:auto\"><table><thead><tr><th>Original quantity</th><th>Area</th><th>Largest original class pathways</th></tr></thead><tbody>"+rows+"</tbody></table></div>"+
    "<p>Developed gross gain includes "+fmt(open)+" ha entering developed open space. Within existing developed classes, "+fmt(s.developed_higher_class_cells*result.cell_area_ha)+
    " ha moves to a higher class and "+fmt(s.developed_lower_class_cells*result.cell_area_ha)+" ha to a lower class.</p>"+
    "<p>Whole-HUC membership: "+esc(s.ids.join(", "))+". States: "+esc(s.states.join(", "))+". Use the actual South Carolina and utility protection selections for their own reporting geometry.</p>"+
    "<p>The complete CSV retains every positive original class pair; omitted class pairs have zero cells. The original full 16 × 16 matrix and annual inventories remain the underlying source.</p></section>";
}
